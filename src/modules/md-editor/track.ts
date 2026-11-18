/**
 * Track changes: typing and deleting as markdown transforms that record the edit instead of
 * just making it. Inserted text becomes an addition (`++@@user.time@@text++`); deleted text is
 * kept, as a deletion (`~~@@user.time@@text~~`).
 *
 * Like a word processor:
 * - typing inside (or right at either end of) the user's own addition just extends it, spaces
 *   and all, and deleting from it really deletes (an addition emptied this way goes entirely);
 * - deletions by the user that touch merge into one, so backspacing over a phrase makes one
 *   deletion (its spaces included), not one per letter;
 * - text already deleted is skipped over, and typing inside a deletion goes after it;
 * - typing inside someone else's addition splits it around the new one.
 *
 * Not tracked: code (where markup would be literal), and edits with no visible text — the
 * paragraph and line breaks that join or split blocks, or markup typed in Raw.
 */
import { LINE_PREFIX, removal, shownChars, type Edit } from './actions';
import { makeNote } from './notes';
import { render, type Mark } from './parse';

const D = 2; // ++ ~~

/**
 * Whether the text is under review: it has additions or deletions, or comments (on any of
 * those, or on a highlight). A plain highlight with no comment doesn't count.
 */
export function hasRevisions(md: string): boolean {
  return render(md).marks.some((m) => m.kind !== 'highlight' || m.notes.some((n) => !!n.comment));
}

/**
 * Applies a tracked edit by `user`: deletes [a, b), then (for an insertion) inserts `text`
 * there. `backward` puts the caret before a deletion (Backspace) rather than after it.
 */
export function trackedEdit(md: string, a: number, b: number, text: string | null, user: string, backward = false): Edit {
  if (text === null) return trackDelete(md, a, b, user, backward);
  let at = a;
  if (b > a) ({ md, focus: at } = trackDelete(md, a, b, user, false));
  return trackInsert(md, at, text, user);
}

interface Context {
  marks: Mark[];
  /** Whether each markdown character is shown in Visual (not markup). */
  visible: Uint8Array;
  /** Whether each markdown character is code text. */
  code: Uint8Array;
}

function context(md: string): Context {
  const r = render(md);
  const visible = shownChars(md, r.plain);
  const code = new Uint8Array(md.length + 1);
  for (const [from, to] of r.code) code.fill(1, from, to);
  return { marks: r.marks, visible, code };
}

const authoredBy = (m: Mark, user: string) => m.notes[0]?.author === user;
/** Whether index `i` is in a mark's text (past its notes, before its closing delimiter). */
const inText = (m: Mark, i: number) => m.body <= i && i < m.to - D;

function trackDelete(md: string, a: number, b: number, user: string, backward: boolean): Edit {
  if (a >= b) return { md, anchor: a, focus: a };
  const { marks, visible, code } = context(md);

  // Nothing visible (a paragraph break, or markup in Raw): a plain edit.
  let shown = false;
  for (let i = a; i < b && !shown; i++) shown = !!visible[i];
  if (!shown) return joinLines(md, a, b);

  const mine = marks.filter((m) => m.kind === 'underline' && authoredBy(m, user));
  const deleted = marks.filter((m) => m.kind === 'strike');
  const myDeletions = deleted.filter((m) => authoredBy(m, user));
  const note = makeNote(user);
  const rw = new Rewrite(md);

  // Runs of visible text (spaces too) become deletions, merging into the user's deletions they
  // touch on either side (keeping that deletion's attributions).
  const strike = (x: number, y: number) => {
    const left = myDeletions.find((m) => m.to === x);
    const right = myDeletions.find((m) => m.from === y);
    if (left) rw.remove(left.to - D, left.to);
    else rw.insert(x, `~~${right ? md.slice(right.from + D, right.body) : note}`);
    if (right) rw.remove(right.from, right.body);
    else rw.insert(y, '~~');
  };
  let run = -1;
  for (let i = a; i < b; i++) {
    const kind = !visible[i] ? 'markup' : code[i] || mine.some((m) => inText(m, i)) ? 'remove' : deleted.some((m) => inText(m, i)) ? 'skip' : 'strike';
    if (kind === 'strike') {
      if (run < 0) run = i;
      continue;
    }
    if (run >= 0) strike(run, i);
    run = -1;
    if (kind === 'remove') rw.remove(i, i + 1);
  }
  if (run >= 0) strike(run, b);

  // The user's own additions left with no text go entirely, tidying the spacing they leave.
  for (const m of mine) {
    if (m.to <= a || m.from >= b) continue;
    let empty = true;
    for (let i = m.body; i < m.to - D && empty; i++) empty = !visible[i] || rw.removed(i);
    if (empty) for (const [x, y] of removal(md, visible, m.from, m.to)) rw.remove(x, y);
  }

  const { md: out, map } = rw.apply();
  const caret = backward ? map(a, false) : map(b, true);
  return { md: out, anchor: caret, focus: caret };
}

/**
 * Deletes a range with no visible text — in Visual, the break between two blocks. Only the
 * line breaks and the next line's block markers go: inline delimiters on either side (an
 * addition's closing `++`, a bold's `**`) stay, so formatting and changes stay intact.
 */
function joinLines(md: string, a: number, b: number): Edit {
  const first = md.indexOf('\n', a);
  // No line break (markup typed in Raw): exactly what was asked.
  if (first === -1 || first >= b) return { md: md.slice(0, a) + md.slice(b), anchor: a, focus: a };
  const next = md.lastIndexOf('\n', b - 1) + 1;
  const lineEnd = md.indexOf('\n', next) === -1 ? md.length : md.indexOf('\n', next);
  const end = Math.min(b, next + (LINE_PREFIX.exec(md.slice(next, lineEnd))?.[0].length ?? 0));
  return { md: md.slice(0, first) + md.slice(Math.max(end, first + 1)), anchor: first, focus: first };
}

function trackInsert(md: string, p: number, text: string, user: string): Edit {
  const plain = (at: number): Edit => ({ md: md.slice(0, at) + text + md.slice(at), anchor: at + text.length, focus: at + text.length });
  if (!text) return { md, anchor: p, focus: p };
  const { marks, code } = context(md);

  // In code, or (in Raw) inside a delimiter or an attribution: plain text.
  if (code[p] || (p > 0 && code[p - 1] && md[p] === '`')) return plain(p);
  if (marks.some((m) => (m.from < p && p < m.body) || (m.to - D < p && p < m.to))) return plain(p);

  const note = makeNote(user);
  const addition = (s: string) => `++${note}${s}++`;
  const wrap = (at: number, before = '', after = ''): Edit => {
    // Each line of the text is its own addition (a line break can't be inside one).
    const lines = text.split('\n');
    const ins = before + lines.map((l) => (l ? addition(l) : '')).join('\n') + after;
    const caret = at + ins.length - after.length - (lines[lines.length - 1] ? D : 0);
    return { md: md.slice(0, at) + ins + md.slice(at), anchor: caret, focus: caret };
  };

  // Typing inside a deletion goes after it.
  for (let m = marks.find((x) => x.kind === 'strike' && x.from < p && p < x.to); m; m = marks.find((x) => x.kind === 'strike' && x.from < p && p < x.to)) p = m.to;

  if (text.includes('\n')) return wrap(p);

  // Inside, or at either end of, the user's own addition: extend it.
  const own = marks.filter((m) => m.kind === 'underline' && authoredBy(m, user));
  const mine = own.find((m) => m.from <= p && p <= m.to);
  if (mine) return plain(Math.min(Math.max(p, mine.body), mine.to - D));

  // Inside someone else's addition: before or after it at its ends, else split it around ours.
  const other = marks.find((m) => m.kind === 'underline' && m.body <= p && p <= m.to - D);
  if (other) {
    if (p === other.body) return wrap(other.from);
    if (p === other.to - D) return wrap(other.to);
    const first = other.notes[0];
    const tail = first ? `@@${first.author}${first.time !== undefined ? `.${first.time}` : ''}@@` : '';
    return wrap(p, '++', `++${tail}`);
  }

  return wrap(p);
}

/**
 * Edits to a string, as characters to remove and text to insert at positions, applied together;
 * `map` carries an old position into the result.
 */
class Rewrite {
  private readonly cut: Uint8Array;
  private readonly ins = new Map<number, string>();

  constructor(private readonly s: string) {
    this.cut = new Uint8Array(s.length);
  }

  remove(a: number, b: number): void {
    this.cut.fill(1, a, b);
  }

  removed(i: number): boolean {
    return !!this.cut[i];
  }

  insert(at: number, text: string): void {
    this.ins.set(at, (this.ins.get(at) ?? '') + text);
  }

  /** The result, and a map of old positions to new: before or after text inserted there. */
  apply(): { md: string; map: (p: number, after: boolean) => number } {
    const { s, cut, ins } = this;
    const before = new Int32Array(s.length + 1);
    const after = new Int32Array(s.length + 1);
    let out = '';
    for (let i = 0; i <= s.length; i++) {
      before[i] = out.length;
      out += ins.get(i) ?? '';
      after[i] = out.length;
      if (i < s.length && !cut[i]) out += s[i];
    }
    return { md: out, map: (p, a) => (a ? after[p] : before[p]) };
  }
}
