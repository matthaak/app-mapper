/**
 * Formatting commands as pure markdown transforms: (markdown, selection) → (markdown,
 * selection). Both views use these — Visual maps its selection into the markdown, applies the
 * command, re-renders and maps the selection back — so a command does the same thing in each.
 */
import { cleanComment, verdictOf } from './notes';
import { continuesItem, render, type Mark, type MarkKind } from './parse';
import type { MdMode } from './types';

export type ActionId =
  | 'h1'
  | 'h2'
  | 'bold'
  | 'italic'
  | 'highlight'
  | 'code'
  | 'ul'
  | 'ol'
  | 'quote'
  | 'rule'
  | 'link'
  | 'break'
  | 'accept'
  | 'acceptAll'
  | 'reject';

export interface Edit {
  md: string;
  anchor: number;
  focus: number;
}

/**
 * Applies `id` to the selection [start, end) of `md`. `note` is a note block (see notes.ts):
 * for a new highlight or comment, or the user's "Accepted" or "Rejected" for Accept and Reject.
 */
export function applyAction(id: ActionId, md: string, start: number, end: number, mode: MdMode, note = ''): Edit {
  switch (id) {
    case 'h1':
      return heading(md, start, end, 1);
    case 'h2':
      return heading(md, start, end, 2);
    case 'bold':
      return toggleInline(md, start, end, '*', 2, 'bold text', '_');
    case 'italic':
      return toggleInline(md, start, end, '*', 1, 'italic text', '_');
    case 'highlight': {
      // Inside a highlight or at a comment (or touching one): remove it, notes and all.
      // Otherwise highlight the selection, or with none, anchor a comment at the caret.
      const r = render(md);
      const on = marksAt(r.marks, start, end, ['highlight', 'comment']);
      if (on.length) return cut(md, start, end, on.flatMap(unwrapRanges));
      return start === end ? anchor(md, r.code, start, note) : highlight(md, r.code, start, end, note);
    }
    case 'code':
      return toggleInline(md, start, end, '`', 1, 'code');
    case 'ul':
      return list(md, start, end, false);
    case 'ol':
      return list(md, start, end, true);
    case 'quote':
      return quote(md, start, end);
    case 'rule':
      return rule(md, end);
    case 'link':
      return link(md, start, end, mode);
    case 'break':
      return replace(md, start, end, '\n', 1, 1);
    case 'accept':
      return resolve(md, start, end, true, note);
    case 'acceptAll':
      return resolve(md, start, end, true, note, true);
    case 'reject':
      return resolve(md, start, end, false, note);
  }
}

/** Tracked changes: {++additions++} and {--deletions--}. */
export const CHANGES: readonly MarkKind[] = ['underline', 'strike'];

/**
 * The marks of `kinds` the selection touches: a caret must be strictly inside one (past its
 * opening delimiter, before the end of its closing one); a range must overlap it.
 */
export function marksAt(marks: readonly Mark[], start: number, end: number, kinds: readonly MarkKind[]): Mark[] {
  // A caret counts at a mark's edges too: right after typing an addition, or right before the
  // deletion Backspace just made, it is on that change.
  return marks.filter((m) => kinds.includes(m.kind) && (start === end ? m.from <= start && start <= m.to : start < m.to && end > m.from));
}

/** The delimiters and notes of a mark: removing them leaves its text (a comment: nothing). */
const unwrapRanges = (m: Mark): [number, number][] => [
  [m.from, m.body],
  [m.end, m.to],
];

/**
 * Accepts (additions keep their text, deletions go) or rejects (additions go, deletions keep
 * their text) the changes the selection touches. A change with comments in its thread keeps its
 * history: `note` (the user's "Accepted" or "Rejected") is added to the thread instead, and the
 * views show its outcome (see Mark.verdict) — unless it already ends with that verdict. One
 * without comments (or with no `note`, nobody to sign it) is settled for good: its markup and
 * thread go, and removed text takes its spacing with it. With `all`, every change in the
 * document not yet resolved either way, wherever the selection is.
 */
function resolve(md: string, start: number, end: number, accept: boolean, note: string, all = false): Edit {
  const r = render(md);
  const visible = shownChars(md, r.plain);
  const goes = (m: Mark) => (m.kind === 'strike') === accept;
  const edits: [number, number, string][] = [];
  const marks = all ? r.marks.filter((m) => CHANGES.includes(m.kind) && !m.verdict) : marksAt(r.marks, start, end, CHANGES);
  for (const m of marks) {
    if (note && m.notes.some((n) => n.comment)) {
      if (verdictOf(m.notes) === (accept ? 'accepted' : 'rejected')) continue;
      edits.push([m.to, m.to, note]);
    } else {
      for (const [a, b] of goes(m) ? markRemoval(md, visible, m) : unwrapRanges(m)) edits.push([a, b, '']);
    }
  }
  return splice(md, start, end, edits);
}

/**
 * Makes `edits` ([from, to) replaced by text) at once, carrying the selection over: removals
 * that overlap merge, and an insertion inside a removal goes with it.
 */
function splice(md: string, start: number, end: number, edits: [number, number, string][]): Edit {
  const cuts: [number, number][] = [];
  for (const [a, b] of edits.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = cuts[cuts.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else cuts.push([a, b]);
  }
  const all = [
    ...cuts.map(([a, b]): [number, number, string] => [a, b, '']),
    ...edits.filter(([a, b, t]) => a === b && t && !cuts.some(([x, y]) => a > x && a < y)),
  ].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let out = '';
  let pos = 0;
  for (const [a, b, t] of all) {
    out += md.slice(pos, a) + t;
    pos = b;
  }
  out += md.slice(pos);
  const map = (p: number) => {
    let shift = 0;
    for (const [a, b, t] of all) {
      if (p < a || (p === a && b === a)) break;
      shift += t.length - (Math.min(p, b) - a);
    }
    return p + shift;
  };
  return { md: out, anchor: map(start), focus: map(end) };
}

/**
 * Adds `note` (a note block, `{>>author 2026-11-18 13:55: comment<<}`) to mark `m`: as a reply after its
 * last note, or, when the mark is the note's author's own and has no comment yet, as that
 * comment (keeping the change's time). `map` carries a position over.
 */
export function commentOn(md: string, m: Mark, note: string): { md: string; map: (p: number) => number } {
  const text = note.slice(3, -3);
  const first = m.notes[0];
  const own = first && m.notes.length === 1 && !first.comment && first.author === /^\w+/.exec(text)?.[0];
  let a: number;
  let b: number;
  let put: string;
  if (own) [a, b, put] = [first.from, first.to, md.slice(first.from, first.to).trimEnd() + text.replace(/^\w+ \d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?/, '')];
  else [a, b, put] = [m.to, m.to, note];
  const map = (p: number) => (p < a ? p : p >= b ? p + put.length - (b - a) : a + put.length);
  return { md: md.slice(0, a) + put + md.slice(b), map };
}

/**
 * Changes note `i` of mark `m` to say `text` — anyone's note: it keeps its author and date.
 * Emptied, a reply goes entirely, as does a note by nobody in particular; the first note keeps
 * its author and date. `map` carries a position over.
 */
export function editNote(md: string, m: Mark, i: number, text: string): { md: string; map: (p: number) => number } {
  const n = m.notes[i];
  if (!n) return { md, map: (p) => p };
  const c = cleanComment(text);
  let a = n.from;
  let b = n.to;
  let put: string;
  if (!c && (i > 0 || !n.author)) {
    a -= 3;
    b += 3;
    put = '';
  } else {
    put = n.author ? `${n.author}${n.stamp ? ` ${n.stamp}` : ''}${c ? `: ${c}` : ''}` : c;
  }
  const map = (p: number) => (p < a ? p : p >= b ? p + put.length - (b - a) : a + Math.min(p - a, put.length));
  return { md: md.slice(0, a) + put + md.slice(b), map };
}

/** Whether each markdown character is shown in Visual (not markup), from render's `plain`. */
export function shownChars(md: string, plain: readonly number[]): Uint8Array {
  const v = new Uint8Array(md.length + 1);
  for (const i of plain) v[i] = 1;
  return v;
}

const HSPACE = /[^\S\n]/;
/** Delimiters a space may sit beyond: what is between them and a removed span. */
const INLINE_MARKUP = /[*_`{}+=<>-]/;
const CLOSING = /[.,;:!?)\]}\u201d\u2019]/;
const OPENING = /[([{\u201c\u2018]/;

/**
 * The ranges to delete to remove [from, to) from `md` cleanly: with it, any doubled spaces
 * the gap leaves, a space left at the start or end of a line or before punctuation, and the
 * whole line (or paragraph) if nothing is left on it. `visible` is from shownChars.
 */
export function removal(md: string, visible: ArrayLike<number>, from: number, to: number): [number, number][] {
  const ls = md.lastIndexOf('\n', from - 1) + 1;
  const le = md.indexOf('\n', to) === -1 ? md.length : md.indexOf('\n', to);
  const content = ls + (LINE_PREFIX.exec(md.slice(ls, le))?.[0].length ?? 0);
  // Spaces on each side, looking past inline delimiters (which stay).
  const left: number[] = [];
  let l = from - 1;
  for (; l >= content; l--) {
    if (HSPACE.test(md[l])) left.push(l);
    else if (visible[l] || !INLINE_MARKUP.test(md[l])) break;
  }
  const right: number[] = [];
  let r = to;
  for (; r < le; r++) {
    if (HSPACE.test(md[r])) right.push(r);
    else if (visible[r] || !INLINE_MARKUP.test(md[r])) break;
  }
  const atStart = l < content;
  const atEnd = r >= le;
  if (atStart && atEnd) return [lineRange(md, ls, le)];
  const out: [number, number][] = [[from, to]];
  const drop = (i: number) => out.push([i, i + 1]);
  if (atStart || atEnd || CLOSING.test(md[r]) || OPENING.test(md[l])) [...left, ...right].forEach(drop);
  else if (left.length && right.length) right.forEach(drop);
  return out;
}

/**
 * The ranges to delete to remove mark `m` with its text. Outside code, cleanly (see removal);
 * in code, exactly, its spacing being the code's: only a line left blank goes too.
 */
export function markRemoval(md: string, visible: ArrayLike<number>, m: Mark): [number, number][] {
  if (!m.code) return removal(md, visible, m.from, m.to);
  // In code: exactly the mark, or its line if nothing else is left on it.
  const ls = md.lastIndexOf('\n', m.from - 1) + 1;
  const le = md.indexOf('\n', m.to) === -1 ? md.length : md.indexOf('\n', m.to);
  if ((md.slice(ls, m.from) + md.slice(m.to, le)).trim()) return [[m.from, m.to]];
  return [ls > 0 ? [ls - 1, le] : [0, Math.min(md.length, le + 1)]];
}

/** The range that deletes line [ls, le) with its line break, and a paragraph's blank line too. */
function lineRange(md: string, ls: number, le: number): [number, number] {
  if (ls === 0) return [0, Math.min(md.length, le + (md[le + 1] === '\n' ? 2 : 1))];
  return [md[ls - 2] === '\n' && md.slice(le, le + 2) === '\n\n' ? ls - 2 : ls - 1, le];
}

/** Deletes the (possibly overlapping) ranges; the selection ends move with their text. */
function cut(md: string, start: number, end: number, ranges: [number, number][]): Edit {
  const merged: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let out = '';
  let pos = 0;
  for (const [a, b] of merged) {
    out += md.slice(pos, a);
    pos = b;
  }
  out += md.slice(pos);
  const map = (p: number) => {
    let removed = 0;
    for (const [a, b] of merged) {
      if (p <= a) break;
      removed += Math.min(p, b) - a;
    }
    return p - removed;
  };
  return { md: out, anchor: map(start), focus: map(end) };
}

// ---------------------------------------------------------------------------------------

const lineStart = (md: string, i: number) => md.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (md: string, i: number) => {
  const j = md.indexOf('\n', i);
  return j === -1 ? md.length : j;
};

/** Replaces [a, b) with `text` and selects [a + selA, a + selB). */
function replace(md: string, a: number, b: number, text: string, selA: number, selB: number): Edit {
  return { md: md.slice(0, a) + text + md.slice(b), anchor: a + selA, focus: a + selB };
}

/** The lines touched by [start, end): a selection ending at a line's very start excludes it. */
function touchedLines(md: string, start: number, end: number): { a: number; b: number } {
  const last = end > start && md[end - 1] === '\n' ? end - 1 : end;
  return { a: lineStart(md, start), b: lineEnd(md, Math.max(start, last)) };
}

/**
 * Rewrites the prefix of each line touched by the selection: `fn` returns how many leading
 * characters to cut and what to put there, or null to leave the line alone. Selection ends move
 * with their text (an end inside the old prefix lands just after the new one).
 */
function editLines(md: string, start: number, end: number, fn: (line: string, n: number) => { cut: number; put: string } | null): Edit {
  const { a, b } = touchedLines(md, start, end);
  const lines = md.slice(a, b).split('\n');
  const edits: { at: number; cut: number; put: string }[] = [];
  let pos = a;
  let n = 0;
  const out = lines.map((line) => {
    const e = fn(line, n);
    if (e) n++;
    const at = pos;
    pos += line.length + 1;
    if (!e) return line;
    edits.push({ at, ...e });
    return e.put + line.slice(e.cut);
  });
  const map = (p: number) => {
    let delta = 0;
    for (const e of edits) {
      if (p < e.at) break;
      if (p < e.at + e.cut) return e.at + delta + e.put.length;
      delta += e.put.length - e.cut;
    }
    return p + delta;
  };
  return { md: md.slice(0, a) + out.join('\n') + md.slice(b), anchor: map(start), focus: map(end) };
}

const blank = (l: string) => l.trim() === '';
const HEADING = /^#{1,6}\s+/;
const BULLET = /^\s*[*+-]\s+/;
const NUMBER = /^\s*\d+\.\s+/;
const QUOTE = /^>\s?/;

function heading(md: string, start: number, end: number, level: number): Edit {
  const { a, b } = touchedLines(md, start, end);
  const lines = md.slice(a, b).split('\n').filter((l) => !blank(l));
  const mark = '#'.repeat(level) + ' ';
  const on = lines.length > 0 && lines.every((l) => (HEADING.exec(l)?.[0].trimEnd().length ?? 0) === level);
  return editLines(md, start, end, (l) => {
    if (blank(l)) return null;
    const cut = HEADING.exec(l)?.[0].length ?? 0;
    return { cut, put: on ? '' : mark };
  });
}

/**
 * Turns the touched lines into list items, or back into plain lines if they all are items of
 * this kind already. A line continuing an item (indented, under a non-blank line) stays part
 * of it: it isn't made an item of its own, and loses its indent when the list goes.
 */
function list(md: string, start: number, end: number, ordered: boolean): Edit {
  const { a, b } = touchedLines(md, start, end);
  const all = md.slice(a, b).split('\n');
  const above = md.slice(0, Math.max(0, a - 1)).split('\n').pop() ?? '';
  const continuing = all.map((l, k) => continuesItem(l) && !blank(k ? all[k - 1] : a > 0 ? above : ''));
  const items = all.filter((l, k) => !blank(l) && !continuing[k]);
  const own = ordered ? NUMBER : BULLET;
  const on = items.length > 0 && items.every((l) => own.test(l));
  let k = -1;
  return editLines(md, start, end, (l, n) => {
    k++;
    if (blank(l)) return null;
    if (continuing[k]) return on ? { cut: l.length - l.trimStart().length, put: '' } : null;
    const cut = (BULLET.exec(l) ?? NUMBER.exec(l))?.[0].length ?? 0;
    return { cut, put: on ? '' : ordered ? `${n + 1}. ` : '* ' };
  });
}

function quote(md: string, start: number, end: number): Edit {
  const { a, b } = touchedLines(md, start, end);
  const lines = md.slice(a, b).split('\n').filter((l) => !blank(l));
  const on = lines.length > 0 && lines.every((l) => QUOTE.test(l));
  return editLines(md, start, end, (l) => {
    if (blank(l)) return null;
    return on ? { cut: QUOTE.exec(l)![0].length, put: '' } : { cut: 0, put: '> ' };
  });
}

/** Inserts a rule as its own block after the line holding `end`. */
function rule(md: string, end: number): Edit {
  const at = lineEnd(md, end);
  const prefix = md.slice(0, at);
  // A blank line before, or the line above would read as a setext heading.
  const before = prefix === '' || prefix.endsWith('\n\n') ? '' : prefix.endsWith('\n') ? '\n' : '\n\n';
  const after = md.slice(at, at + 2) === '\n\n' || at === md.length ? '' : '\n';
  const text = `${before}---${after}`;
  const caret = before.length + 3;
  return replace(md, at, at, text, caret, caret);
}

function link(md: string, start: number, end: number, mode: MdMode): Edit {
  const text = start === end ? 'link text' : md.slice(start, end);
  const url = 'url';
  const insert = `[${text}](${url})`;
  // In Raw, select the URL to type over; in Visual (where URLs are hidden) select the text.
  return mode === 'raw'
    ? replace(md, start, end, insert, text.length + 3, text.length + 3 + url.length)
    : replace(md, start, end, insert, 1, 1 + text.length);
}

// ---------------------------------------------------------------------------------------
// Inline toggles

const WORDCH = /[\p{L}\p{N}']/u;
/** Block markers at a line's start that inline formatting goes after. */
export const LINE_PREFIX = /^(?:\s*(?:#{1,6}\s+|>\s?|[*+-]\s+|\d+\.\s+))*\s*/;

/**
 * Highlights the selection, one highlight per line (`{==text==}` and then `note`), each line's
 * part trimmed of spaces and, outside code, of block markers. A selection only partly in a code
 * span takes all of it, highlighted from outside. In code a mark needs its notes, so with no
 * `note` nothing is highlighted there.
 */
function highlight(md: string, code: readonly [number, number][], start: number, end: number, note: string): Edit {
  const inSpan = ([f]: readonly [number, number]) => md[f - 1] === '`';
  const segs: { a: number; b: number }[] = [];
  for (let ls = lineStart(md, start); ls < end; ) {
    const le = lineEnd(md, ls);
    let a = Math.max(start, ls);
    let b = Math.min(end, le);
    const block = code.find((r) => !inSpan(r) && r[0] >= ls && r[1] <= le);
    if (block) {
      a = Math.max(a, block[0]);
      b = Math.min(b, block[1]);
    } else {
      a = Math.max(a, ls + (LINE_PREFIX.exec(md.slice(ls, le))?.[0].length ?? 0));
    }
    while (a < b && /\s/.test(md[a])) a++;
    while (b > a && /\s/.test(md[b - 1])) b--;
    let inCode = !!block;
    if (!block && a < b) {
      const spans = code.filter((r) => inSpan(r) && r[0] >= ls && r[1] <= le);
      inCode = spans.some(([f, t]) => a >= f && b <= t);
      if (!inCode) {
        for (const [f, t] of spans) {
          if (a >= f && a <= t) a = f - 1;
          if (b >= f && b <= t) b = t + 1;
        }
      }
    }
    if (a < b && (note || !inCode)) segs.push({ a, b });
    if (le >= md.length) break;
    ls = le + 1;
  }
  if (!segs.length) return { md, anchor: start, focus: end };
  let out = '';
  let pos = 0;
  let selA = 0;
  let selB = 0;
  segs.forEach(({ a, b }, i) => {
    out += md.slice(pos, a) + '{==';
    if (i === 0) selA = out.length;
    out += md.slice(a, b);
    selB = out.length;
    out += '==}' + note;
    pos = b;
  });
  return { md: out + md.slice(pos), anchor: selA, focus: selB };
}

/**
 * Anchors a comment (`note`) at the caret: at the end of the word it is in, after any marks and
 * notes that end there, and past a line's block markers. Nothing without a note.
 */
function anchor(md: string, code: readonly [number, number][], p: number, note: string): Edit {
  if (!note) return { md, anchor: p, focus: p };
  while (p < md.length && WORDCH.test(md[p])) p++;
  const marks = render(md).marks;
  for (let m = marks.find((x) => x.end === p || (x.kind === 'comment' && x.from === p)); m; m = marks.find((x) => x.end === p || (x.kind === 'comment' && x.from === p))) p = m.to;
  const ls = lineStart(md, p);
  const inCode = code.some(([f, t]) => f <= p && p <= t);
  if (!inCode) p = Math.max(p, ls + (LINE_PREFIX.exec(md.slice(ls, lineEnd(md, ls)))?.[0].length ?? 0));
  return replace(md, p, p, note, note.length, note.length);
}

/** Length of the run of `c` ending just before `i` (dir -1) or starting at `i` (dir 1). */
function run(md: string, i: number, c: string, dir: 1 | -1): number {
  let n = 0;
  if (dir < 0) while (md[i - 1 - n] === c) n++;
  else while (md[i + n] === c) n++;
  return n;
}

/** Whether a run of `n` delimiter characters includes a delimiter of size `k`. */
const runHas = (n: number, k: number) => (k === 1 ? n % 2 === 1 : n >= 2);

/**
 * Toggles an inline style built from `k` copies of `c` (e.g. '*' ×2 = bold). Works per line, so
 * a selection over several paragraphs or list items formats each one. With no selection: the
 * word at the caret, or else a selected placeholder. `lead` goes just inside each new opening
 * delimiter (an attribution).
 */
function toggleInline(md: string, start: number, end: number, c: string, k: number, placeholder: string, alt?: string, lead = ''): Edit {
  if (start === end) {
    let a = start;
    let b = end;
    while (a > 0 && WORDCH.test(md[a - 1])) a--;
    while (b < md.length && WORDCH.test(md[b])) b++;
    if (a === start || b === end) {
      // Not inside a word: insert a selected placeholder.
      const d = c.repeat(k);
      const at = k + lead.length;
      return replace(md, start, end, d + lead + placeholder + d, at, at + placeholder.length);
    }
    const e = toggleInline(md, a, b, c, k, placeholder, alt, lead);
    const shift = e.anchor - a;
    return { md: e.md, anchor: start + shift, focus: start + shift };
  }

  // Segments: the selected part of each line, after block markers, trimmed of spaces.
  const segs: { a: number; b: number }[] = [];
  for (let ls = lineStart(md, start); ls < end; ) {
    const le = lineEnd(md, ls);
    const content = ls + (LINE_PREFIX.exec(md.slice(ls, le))?.[0].length ?? 0);
    let a = Math.max(start, content);
    let b = Math.min(end, le);
    while (a < b && /\s/.test(md[a])) a++;
    while (b > a && /\s/.test(md[b - 1])) b--;
    if (a < b) segs.push({ a, b });
    if (le >= md.length) break;
    ls = le + 1;
  }
  if (!segs.length) return { md, anchor: start, focus: end };

  // For each segment: is the style already on (delimiters just outside, or just inside)?
  const chars = alt ? [c, alt] : [c];
  const state = segs.map(({ a, b }) => {
    for (const ch of chars) {
      if (runHas(run(md, a, ch, -1), k) && runHas(run(md, b, ch, 1), k)) return { inside: false };
      if (b - a > 2 * k && runHas(run(md, a, ch, 1), k) && runHas(run(md, b, ch, -1), k)) return { inside: true };
    }
    return null;
  });
  const unwrap = state.every(Boolean);

  let out = '';
  let pos = 0;
  let shift = 0;
  let selA = 0;
  let selB = 0;
  segs.forEach(({ a, b }, i) => {
    const s = state[i];
    let na: number;
    let nb: number;
    if (unwrap && s && !s.inside) {
      out += md.slice(pos, a - k) + md.slice(a, b);
      pos = b + k;
      na = a - k + shift;
      nb = b - k + shift;
      shift -= 2 * k;
    } else if (unwrap && s) {
      out += md.slice(pos, a) + md.slice(a + k, b - k);
      pos = b;
      na = a + shift;
      nb = b - 2 * k + shift;
      shift -= 2 * k;
    } else if (!unwrap && !s) {
      const d = c.repeat(k);
      out += md.slice(pos, a) + d + lead + md.slice(a, b) + d;
      pos = b;
      na = a + k + lead.length + shift;
      nb = b + k + lead.length + shift;
      shift += 2 * k + lead.length;
    } else {
      out += md.slice(pos, b); // already styled; leave it
      pos = b;
      na = a + shift;
      nb = b + shift;
    }
    if (i === 0) selA = na;
    selB = nb;
  });
  out += md.slice(pos);
  return { md: out, anchor: selA, focus: selB };
}
