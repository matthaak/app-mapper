/**
 * Track changes: typing and deleting as markdown transforms that record the edit instead of
 * just making it. Inserted text becomes an addition (`{++text++}{>>user 2026-11-18 13:55<<}`);
 * deleted text is kept, as a deletion (`{--text--}{>>user 2026-11-18 13:55<<}`).
 *
 * Like a word processor:
 * - typing inside (or right at either end of) the user's own addition just extends it, spaces
 *   and all, and deleting from it really deletes (an addition emptied this way goes entirely);
 * - deletions by the user that touch merge into one, so backspacing over a phrase makes one
 *   deletion (its spaces included), not one per letter;
 * - a deletion runs on over the paragraph and line breaks inside it (so accepting it joins the
 *   paragraphs either side);
 * - text already deleted is skipped over, and typing inside a deletion goes after it;
 * - typing inside someone else's addition makes an addition inside it, theirs staying whole.
 *
 * Code is tracked too, the same way (a change there must be signed, which these always are).
 *
 * Not tracked: edits with no visible text — a paragraph or line break joined or split by
 * itself (in code, the line breaks that join or split its lines), or markup typed in Raw.
 */
import { LINE_PREFIX, markRemoval, shownChars, type Edit } from './actions';
import { makeNote } from './notes';
import { render, type Mark } from './parse';

/**
 * Whether the text is under review: it has additions or deletions, or comments (on any of
 * those, on a highlight, or anchored). A plain highlight with no comment doesn't count.
 */
export function hasRevisions(md: string): boolean {
  return render(md).marks.some((m) => m.kind === 'strike' || m.kind === 'underline' || m.notes.some((n) => !!n.comment));
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
  /** Whether text inserted at each position goes into code (a code text's end included). */
  codeAt: Uint8Array;
}

function context(md: string): Context {
  const r = render(md);
  const visible = shownChars(md, r.plain);
  const code = new Uint8Array(md.length + 1);
  const codeAt = new Uint8Array(md.length + 1);
  for (const [from, to] of r.code) {
    code.fill(1, from, to);
    codeAt.fill(1, from, to + 1);
  }
  return { marks: r.marks, visible, code, codeAt };
}

const authoredBy = (m: Mark, user: string) => m.notes[0]?.author === user;
/** Whether index `i` is in a mark's text (past its notes, before its closing delimiter). */
const inText = (m: Mark, i: number) => m.body <= i && i < m.end;
/** Of marks inside one another, the innermost. */
const innermost = (ms: Mark[]): Mark | undefined => ms.sort((x, y) => y.from - x.from)[0];

function trackDelete(md: string, a: number, b: number, user: string, backward: boolean): Edit {
  if (a >= b) return { md, anchor: a, focus: a };
  const { marks, visible, code } = context(md);

  // A line break in code is visible text, but isn't tracked: joining code lines is a plain edit.
  const text = (i: number) => !!visible[i] && md[i] !== '\n';
  let shown = false;
  for (let i = a; i < b && !shown; i++) shown = text(i);
  if (!shown) {
    let out = md;
    for (let i = b - 1; i >= a; i--) if (visible[i]) out = out.slice(0, i) + out.slice(i + 1);
    if (out !== md) return { md: out, anchor: a, focus: a };
    // Nothing visible (a paragraph break, or markup in Raw): a plain edit.
    return joinLines(md, a, b);
  }

  const note = makeNote(user);
  const mine = marks.filter((m) => m.kind === 'underline' && authoredBy(m, user));
  const changes = marks.filter((m) => m.kind === 'underline' || m.kind === 'strike');
  const deleted = marks.filter((m) => m.kind === 'strike');
  const myDeletions = deleted.filter((m) => authoredBy(m, user));
  const rw = new Rewrite(md);

  // Runs of visible text (spaces too) become deletions, merging into the user's deletions they
  // touch on either side (keeping the notes of the one on the left, else the right).
  const strike = (x: number, y: number) => {
    // In code a deletion must be signed: with nobody to sign it, the text just goes.
    if (code[x] && !note) return rw.remove(x, y);
    const left = myDeletions.find((m) => m.to === x);
    const right = myDeletions.find((m) => m.from === y);
    // The merged deletion's end: the left one's, notes and all, else a new one.
    const close = left ? md.slice(left.end, left.to) : `--}${note}`;
    if (left) rw.remove(left.end, left.to);
    else rw.insert(x, '{--');
    if (!right) return rw.insert(y, close);
    rw.remove(right.from, right.body);
    if (left) {
      rw.remove(right.end, right.to);
      rw.insert(right.to, close);
    }
  };
  // A deletion runs on over line and paragraph breaks and the block markers after them (out of
  // code), so deleting across paragraphs makes one, which joins them when accepted.
  const prefixEnd = (i: number) => {
    const ls = md.lastIndexOf('\n', i - 1) + 1;
    const le = md.indexOf('\n', ls) === -1 ? md.length : md.indexOf('\n', ls);
    return ls + (LINE_PREFIX.exec(md.slice(ls, le))?.[0].length ?? 0);
  };
  const gap = (i: number) => !code[i] && !visible[i] && (md[i] === '\n' || i < prefixEnd(i));
  let run = -1;
  let last = -1;
  for (let i = a; i < b; i++) {
    // By the change the text is in (the innermost): the user's own addition really goes; a deletion stays as it is.
    const at = text(i) ? innermost(changes.filter((m) => inText(m, i))) : undefined;
    const kind = !text(i) ? (gap(i) ? 'gap' : 'markup') : at?.kind === 'strike' ? 'skip' : at && authoredBy(at, user) ? 'remove' : 'strike';
    if (kind === 'gap') continue;
    if (kind === 'strike') {
      if (run < 0) run = i;
      last = i + 1;
      continue;
    }
    if (run >= 0) strike(run, last);
    run = -1;
    if (kind === 'remove') rw.remove(i, i + 1);
  }
  if (run >= 0) strike(run, last);

  // The user's own additions left with no text go entirely, tidying the spacing they leave.
  for (const m of mine) {
    if (m.to <= a || m.from >= b) continue;
    let empty = true;
    for (let i = m.body; i < m.end && empty; i++) empty = !visible[i] || rw.removed(i);
    if (empty) for (const [x, y] of markRemoval(md, visible, m)) rw.remove(x, y);
  }

  const { md: out, map } = rw.apply();
  const caret = backward ? map(a, false) : map(b, true);
  return { md: out, anchor: caret, focus: caret };
}

/**
 * Deletes a range with no visible text — in Visual, the break between two blocks. Only the
 * line breaks and the next line's block markers go: inline delimiters on either side (an
 * addition's closing `++}`, a bold's `**`) stay, so formatting and changes stay intact.
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
  const { marks, codeAt } = context(md);

  // (In Raw) inside a delimiter or an attribution: plain text.
  if (marks.some((m) => (m.from < p && p < m.body) || (m.end < p && p < m.to))) return plain(p);

  const note = makeNote(user);
  // In code an addition must be signed: with nobody to sign it, plain text.
  if (codeAt[p] && !note) return plain(p);
  const close = `++}${note}`;
  const addition = (s: string) => `{++${s}${close}`;
  const wrap = (at: number): Edit => {
    const ins = addition(text);
    const caret = at + ins.length - close.length;
    return { md: md.slice(0, at) + ins + md.slice(at), anchor: caret, focus: caret };
  };

  // Typing inside a deletion goes after it.
  for (let m = marks.find((x) => x.kind === 'strike' && x.from < p && p < x.to); m; m = marks.find((x) => x.kind === 'strike' && x.from < p && p < x.to)) p = m.to;

  // Inside, or at either end of, the user's own addition: extend it.
  const mine = innermost(marks.filter((m) => m.kind === 'underline' && authoredBy(m, user) && m.from <= p && p <= m.to));
  const other = innermost(marks.filter((m) => m.kind === 'underline' && !authoredBy(m, user) && m.body <= p && p <= m.end));
  if (mine && !(other && other.from > mine.from)) return plain(Math.min(Math.max(p, mine.body), mine.end));

  // Inside someone else's addition: ours goes inside it, which stays whole — or, right at either
  // end (a delimiter there, not on a line of its own), just outside it.
  if (other && p === other.body && other.body === other.from + 3) return wrap(other.from);
  if (other && p === other.end && other.close === other.end + 3) return wrap(other.to);
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
