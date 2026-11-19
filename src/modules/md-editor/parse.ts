/**
 * Markdown → HTML for the editor's dialect, with a source map.
 *
 * Dialect: ATX and setext headings; paragraphs (a single newline is a line break); fenced and
 * indented code; `---` rules; `>` quotes; `*`/`-`/`+` and `1.` lists (an indented line that
 * isn't an item continues the item above, as a line break); GFM tables (a header
 * row, a `| --- | :---: |` delimiter row setting each column's alignment, then body rows;
 * `\|` is a literal pipe in a cell); **bold**, *italic* /
 * _italic_, `code`, [links](url), ![images](src "title"); and review marks in CriticMarkup —
 * {==highlight==}, {--deletion--} and {++addition++}, each followed by its notes, and
 * {>>comments<<} anchored at a point (see notes.ts).
 *
 * A mark opens and closes anywhere: it may run over line breaks, paragraphs and other blocks,
 * ending at the first closing delimiter of its kind (marks of a kind inside it pair up first).
 * Its delimiters are taken out before blocks are read, so `{++### Title` is a heading whose
 * text is added; a line holding only delimiters (and a closing one's notes) is no block at all:
 *
 *     {++
 *     ### New section
 *
 *     A paragraph.
 *     ++}{>>Claude 2026-11-18 17:05: Added a section<<}
 *
 * An opening delimiter that never closes is just text.
 *
 * Code is literal but for review marks: there a mark must have notes signed with an author and
 * date (`{++i++}{>>Matt 2026-11-18<<}` adds `i++`), so code that happens to look like markup
 * stays code. A mark opened in a code block may run on over its lines; one opened in a code
 * span ends in it.
 *
 * Besides the HTML, `render` reports:
 * - `plain`: for each character of the rendered DOM text (in document order), its index in the
 *   markdown. The HTML contains no whitespace between tags, so the DOM's text nodes hold exactly
 *   these characters. This is what carries a caret or selection from Raw to Visual exactly.
 * - `marks`: where the marks sit in the markdown, delimiters and notes included, so the Raw
 *   view styles exactly what the Visual view styles; and their notes.
 *
 * In the HTML, each mark is an element per block it runs through (and more where it crosses
 * other formatting), each carrying `data-mark` (its index in `marks`). The first also carries
 * the notes' source text in `data-notes` (the notes themselves are not shown), so the
 * serializer can write them back after the Visual view is edited. An anchored comment is an
 * empty `span.md-anchor`, with its notes.
 */
import { noteOf, notesAt, verdictOf, type Note, type Verdict } from './notes';

/** A mark: a highlight, a deletion, an addition, or a comment anchored at a point. */
export type MarkKind = 'highlight' | 'strike' | 'underline' | 'comment';

export interface Mark {
  kind: MarkKind;
  /** Markdown index of the opening delimiter (an anchored comment's first `{>>`). */
  from: number;
  /** Markdown index just past its last note (or, with none, its closing delimiter). */
  to: number;
  /** Its notes, after its closing delimiter: its author first, then replies. */
  notes: Note[];
  /**
   * Markdown index where its text starts, after the opening delimiter (a comment's: `from`) —
   * or, if that is alone on its line, at the start of the next line with text.
   */
  body: number;
  /**
   * Markdown index where its text ends, at the closing delimiter (a comment's: `from`) — or, if
   * that starts a line of its own, at the end of the line with text before it.
   */
  end: number;
  /** Markdown index just past its closing delimiter, where its notes start (a comment's: `from`). */
  close: number;
  /** Opened in code. */
  code: boolean;
  /**
   * Part of a run that reads as one change, and so has one thread: marks of one kind with only
   * spaces, line breaks and block markers between them, each either without notes or signed
   * as the next is (the same author and time, and no other comment). The index (in `marks`) of
   * the run's last mark, whose thread it is. Unset for that mark and any other.
   */
  group?: number;
  /**
   * Completed in its thread (see verdictOf), and kept, with its history: an addition or deletion
   * accepted or rejected, a highlight or comment accepted (they can't be rejected). A run's marks
   * all have its last one's.
   */
  verdict: Verdict | null;
}

export interface Rendered {
  html: string;
  plain: number[];
  marks: Mark[];
  /** Markdown ranges [from, to) of code text (spans and blocks), where markup is literal. */
  code: [number, number][];
}

/** How many times to read again for openers that turned out never to close (see render). */
const PASSES = 4;

export function render(md: string): Rendered {
  const at = Array.from({ length: md.length + 1 }, (_, i) => i);
  const literal = new Set<number>();
  for (let pass = 0; ; pass++) {
    const out: Out = { html: [], plain: [], marks: [], code: [], open: [], literal, dead: [], sources: new Map() };
    blocks({ text: md, at }, out);
    // Openers that never closed are text after all: read it again with them as text.
    const dead = [...out.dead, ...out.open.map((o) => out.marks[o.index].from)];
    if (dead.length && pass < PASSES) {
      for (const d of dead) literal.add(d);
      continue;
    }
    for (const o of out.open) {
      const m = out.marks[o.index];
      m.end = m.close = m.to = md.length;
    }
    groupRuns(md, out.marks);
    return { html: finish(out), plain: out.plain, marks: out.marks, code: out.code };
  }
}

/** A mark's verdict, from its notes: a highlight's or comment's can only be "Accepted". */
function markVerdict(kind: MarkKind, notes: readonly Note[]): Verdict | null {
  const v = verdictOf(notes);
  return kind === 'highlight' || kind === 'comment' ? (v === 'accepted' ? v : null) : v;
}

/** Mark `i` and the marks whose run it ends (see Mark.group), by index in `marks`. */
export function groupOf(marks: readonly Mark[], i: number): number[] {
  const out: number[] = [];
  marks.forEach((m, k) => {
    if (k === i || m.group === i) out.push(k);
  });
  return out;
}

/** What may stand between the marks of a run: spaces, line breaks and block markers. */
const RUN_GAP = /^(?:\s|#{1,6}\s|[*+-]\s|\d+\.\s|>|\|)*$/;

/** Sets each mark's `group` (see Mark.group). */
function groupRuns(md: string, marks: Mark[]): void {
  const order = marks.map((_, k) => k).sort((a, b) => marks[a].from - marks[b].from);
  const joins = (m: Mark) => !m.code && m.kind !== 'comment';
  for (let x = order.length - 2; x >= 0; x--) {
    const m = marks[order[x]];
    if (!joins(m)) continue;
    let y = x + 1;
    while (y < order.length && marks[order[y]].from < m.to) y++;
    const k = order[y];
    const n = marks[k];
    if (!n || n.kind !== m.kind || !joins(n) || !RUN_GAP.test(md.slice(m.to, n.from))) continue;
    const [a, b] = [m.notes[0], n.notes[0]];
    // Signed, it is the same change only if signed the same: same author and time, and no other comment.
    if (a && !(b && a.author && a.author === b.author && a.stamp === b.stamp && (!a.comment || a.comment === b.comment))) continue;
    m.group = n.group ?? k;
  }
  // A run is one change: its marks share its last one's verdict.
  for (const m of marks) if (m.group !== undefined) m.verdict = marks[m.group].verdict;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

// ---------------------------------------------------------------------------------------
// Mapped text: a string plus the markdown index of each character. `at[text.length]` is the
// index just past the end (for a line, the position of its newline).

interface Src {
  text: string;
  at: number[];
}

/** A mark's element, opening: its tag is made once the mark's notes are known (see finish). */
interface Tag {
  mark: number;
  tag: string;
}

/** A mark open, waiting for its closing delimiter (perhaps in a later block). */
interface Open {
  index: number;
  d: string;
  tag: string;
  /** Opened in code: it closes only with signed notes. */
  code: boolean;
}

interface Out {
  html: (string | Tag)[];
  plain: number[];
  marks: Mark[];
  code: [number, number][];
  /** The marks open, outermost first. */
  open: Open[];
  /** Openers (by markdown index) read as text: they never close. */
  literal: Set<number>;
  /** Openers (by markdown index) that couldn't close where they must (in their code span). */
  dead: number[];
  /** Each mark's notes as written, by its index. */
  sources: Map<number, string>;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function sub(s: Src, a: number, b = s.text.length): Src {
  return { text: s.text.slice(a, b), at: s.at.slice(a, b + 1) };
}

/**
 * A line's end, kept as typed: spaces at the end stay in the rendered text (Visual shows them,
 * with pre-wrap), so a space just typed at the end of a paragraph has a place for the caret.
 * Only a stray carriage return goes.
 */
function trimEnd(s: Src): Src {
  return sub(s, 0, s.text.replace(/\r+$/, '').length);
}

function splitLines(s: Src): Src[] {
  const out: Src[] = [];
  let a = 0;
  for (;;) {
    const b = s.text.indexOf('\n', a);
    if (b === -1) {
      out.push(sub(s, a));
      return out;
    }
    out.push(sub(s, a, b));
    a = b + 1;
  }
}

/** Joins lines with '\n'; each separator maps to the end of the line before it. */
function joinLines(ls: Src[]): Src {
  const parts: string[] = [];
  const at: number[] = [];
  ls.forEach((l, i) => {
    if (i > 0) {
      parts.push('\n');
      at.push(ls[i - 1].at[ls[i - 1].text.length]);
    }
    parts.push(l.text);
    for (let k = 0; k < l.text.length; k++) at.push(l.at[k]);
  });
  const last = ls[ls.length - 1];
  at.push(last ? last.at[last.text.length] : 0);
  return { text: parts.join(''), at };
}

// ---------------------------------------------------------------------------------------
// Marks

/** The marks: each one's delimiter (`{==` … `==}`), kind and tag. */
const MARKS: [string, MarkKind, string][] = [
  ['==', 'highlight', 'mark'],
  ['--', 'strike', 'del'],
  ['++', 'underline', 'u'],
];

type Notes = ReturnType<typeof notesAt>;

/** The notes `r` found in `s`, as notes with their markdown positions. */
function notesIn(s: Src, r: Notes): Note[] {
  return r.notes.map((x) => noteOf(x.text, s.at[x.at], x.text ? s.at[x.at + x.text.length - 1] + 1 : s.at[x.at]));
}

/** Opens a mark with delimiter `d` (its kind's), its opening delimiter at markdown `from`, its text from `body`. */
function openMark(out: Out, d: string, from: number, body: number, code: boolean): Open {
  const [, kind, tag] = MARKS.find(([x]) => x === d)!;
  const index = out.marks.push({ kind, from, body, end: body, close: body, to: body, notes: [], code, verdict: null }) - 1;
  const o = { index, d, tag, code };
  out.open.push(o);
  return o;
}

/**
 * The innermost open mark that a closing delimiter `d` closes, with signed notes or not (in
 * code, or for a mark opened there, they must be signed); null if none. `among`, if given,
 * limits it to those.
 */
function closing(out: Out, d: string, signed: boolean, inCode: boolean, among?: readonly Open[]): Open | null {
  for (let x = out.open.length - 1; x >= 0; x--) {
    const o = out.open[x];
    if (o.d !== d || (among && !among.includes(o))) continue;
    return signed || !(inCode || o.code) ? o : null;
  }
  return null;
}

/** Closes open mark `o`: its text ends at `end`, its closing delimiter ends at `close`, then notes `r` in `s` to `to`. */
function closeMark(out: Out, o: Open, end: number, close: number, to: number, s: Src, r: Notes, source: string): void {
  out.open.splice(out.open.indexOf(o), 1);
  const m = out.marks[o.index];
  m.end = end;
  m.close = close;
  m.to = to;
  m.notes = notesIn(s, r);
  m.verdict = markVerdict(m.kind, m.notes);
  if (r.notes.length) out.sources.set(o.index, source);
}

/** The opening tag of mark `index`'s element (with its notes, for the first). */
function tagHtml(out: Out, index: number, tag: string, first: boolean): string {
  const m = out.marks[index];
  // A resolved change shows as its outcome: an accepted addition or rejected deletion as plain
  // text; the text an accepted deletion or rejected addition took out, not at all (still there
  // for the source map and the serializer, but not to be edited).
  const cls = [m.kind === 'comment' ? 'md-anchor' : '', m.notes.length ? 'noted' : '', m.verdict ?? ''].filter(Boolean).join(' ');
  const gone = m.kind === 'comment' || m.verdict === (m.kind === 'strike' ? 'accepted' : 'rejected');
  const base = `<${tag} data-mark="${index}"${cls ? ` class="${cls}"` : ''}${gone ? ' contenteditable="false"' : ''}`;
  const source = first ? out.sources.get(index) : undefined;
  return source ? `${base} data-notes="${escapeHtml(source)}">` : `${base}>`;
}

/** The HTML, each mark's tags made now that its notes are known (the first of each with them). */
function finish(out: Out): string {
  const seen = new Set<number>();
  return out.html
    .map((h) => {
      if (typeof h === 'string') return h;
      const first = !seen.has(h.mark);
      seen.add(h.mark);
      return tagHtml(out, h.mark, h.tag, first);
    })
    .join('');
}

/**
 * A line of nothing but delimiters, and the notes after closing ones: `{++`, `++}{>>…<<}`. It is
 * no block (if what it holds pairs up: see delimiterLine).
 */
const DELIMITER_LINE = /^ {0,3}(?:\{(?:\+\+|--|==)|(?:\+\+|--|==)\}(?:\{>>[^\n]*?<<\})*)+[ \t]*$/;

/**
 * Opens and closes the marks of the delimiter line `ls[i]` (see DELIMITER_LINE): a mark opened
 * there has its text from the next line with any, a mark closed there to the line with text
 * before it. False, doing nothing, if an opener there never closes or a closer closes nothing.
 */
function delimiterLine(ls: Src[], i: number, out: Out): boolean {
  const l = ls[i];
  const t = l.text;
  const toks: { k: number; d: string; r: Notes | null }[] = [];
  const last = t.trimEnd().length;
  for (let k = t.length - t.trimStart().length; k < last; ) {
    if (t[k] === '{') {
      toks.push({ k, d: t.slice(k + 1, k + 3), r: null });
      k += 3;
    } else {
      const r = notesAt(t, k + 3);
      toks.push({ k, d: t.slice(k, k + 2), r });
      k = r.end;
    }
  }
  // Does it all pair up?
  const open = [...out.open];
  for (const x of toks) {
    if (!x.r) {
      if (out.literal.has(l.at[x.k])) return false;
      open.push({ index: -1, d: x.d, tag: '', code: false });
      continue;
    }
    const y = open.map((o) => o.d).lastIndexOf(x.d);
    if (y < 0 || (open[y].code && notesAt(t, x.k + 3, true).end !== x.r.end)) return false;
    open.splice(y, 1);
  }
  let before = i - 1;
  while (before >= 0 && isBlank(ls[before].text)) before--;
  let after = i + 1;
  while (after < ls.length && isBlank(ls[after].text)) after++;
  const end = before >= 0 ? ls[before].at[ls[before].text.length] : l.at[0];
  const body = after < ls.length ? ls[after].at[0] : l.at[t.length];
  for (const x of toks) {
    if (!x.r) {
      openMark(out, x.d, l.at[x.k], body, false);
      continue;
    }
    const o = closing(out, x.d, true, false)!;
    const r = x.r;
    closeMark(out, o, end, l.at[x.k + 2] + 1, r.notes.length ? l.at[r.end - 1] + 1 : l.at[x.k + 2] + 1, l, r, t.slice(x.k + 3, r.end));
  }
  return true;
}

/** A line that opens a mark before its block markers: `{++### Title`, `{--- item`. */
const HOISTED = /^( {0,3})\{(\+\+|--|==)((?:#{1,6}[ \t]+|[*+-][ \t]+|\d+\.[ \t]+|>[ \t]?)+)/;

/**
 * A mark opened before a line's block markers (`{++### Title`), read as if opened after them
 * (`### {++Title`): the line is still a heading, item or quote, with its text marked. Accepted,
 * an addition keeps its markers; rejected, the line goes, markers and all.
 */
function hoist(l: Src, literal: ReadonlySet<number>): Src {
  const m = HOISTED.exec(l.text);
  if (!m || literal.has(l.at[m[1].length])) return l;
  const o = m[1].length;
  const p = o + 3;
  const q = p + m[3].length;
  const order = (a: string | number[]) => [a.slice(0, o), a.slice(p, q), a.slice(o, p), a.slice(q)];
  return { text: order(l.text).join(''), at: (order(l.at) as number[][]).flat() };
}

// ---------------------------------------------------------------------------------------
// Blocks

const ATX = /^(#{1,6})\s+/;
const UL = /^\s*[*+-]\s/;
const OL = /^\s*\d+\.\s/;
const QUOTE = /^>\s?/;
const SETEXT1 = /^=+\s*$/;
const SETEXT2 = /^-+\s*$/;

const isBlank = (t: string) => t.trim() === '';
const isFence = (t: string) => t.trimStart().startsWith('```');
const isIndented = (t: string) => t.startsWith('    ') || t.startsWith('\t');
const isRule = (t: string) => /^(\s*[-*_]\s*){3,}$/.test(t);
const isSetext = (t: string | undefined) => t !== undefined && (SETEXT1.test(t) || SETEXT2.test(t));

/** A table's delimiter row: `| --- | :--: | --: |` (outer pipes optional). */
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Splits a table row into its cells: on unescaped pipes, outer pipes dropped. A cell loses the
 * spaces before its text, and after it one space (the padding before the pipe) plus all but
 * one of any more: so a space just typed at the end of a cell stays there for the caret (like
 * one at the end of a paragraph), while a column padded with spaces doesn't grow.
 */
function tableCells(row: Src): Src[] {
  const t = row.text;
  let a = t.length - t.trimStart().length;
  let b = t.trimEnd().length;
  if (t[a] === '|') a++;
  if (b > a && t[b - 1] === '|' && t[b - 2] !== '\\') b--;
  const cells: Src[] = [];
  let start = a;
  for (let k = a; k <= b; k++) {
    if (k < b && t[k] === '\\' && t[k + 1] === '|') {
      k++;
      continue;
    }
    if (k < b && t[k] !== '|') continue;
    let cell = sub(row, start, k);
    cell = sub(cell, cell.text.length - cell.text.trimStart().length);
    const trailing = cell.text.length - cell.text.replace(/ +$/, '').length;
    if (trailing) cell = sub(cell, 0, cell.text.length - trailing + (trailing > 1 ? 1 : 0));
    cells.push(unescapePipes(cell));
    start = k + 1;
  }
  return cells;
}

/** Drops the backslash of each `\|` (the pipe keeps its own place in the markdown). */
function unescapePipes(s: Src): Src {
  if (!s.text.includes('\\|')) return s;
  let text = '';
  const at: number[] = [];
  for (let k = 0; k < s.text.length; k++) {
    if (s.text[k] === '\\' && s.text[k + 1] === '|') continue;
    text += s.text[k];
    at.push(s.at[k]);
  }
  at.push(s.at[s.text.length]);
  return { text, at };
}

/** Does a table start at line i: a row with a pipe, then a delimiter row with as many cells? */
function isTableStart(ls: Src[], i: number): boolean {
  const head = ls[i]?.text;
  const delim = ls[i + 1]?.text;
  if (!head || !delim || !head.includes('|') || !TABLE_DELIM.test(delim)) return false;
  return tableCells(ls[i]).length === tableCells(ls[i + 1]).length;
}

function table(ls: Src[], i: number, out: Out): number {
  const align = tableCells(ls[i + 1]).map((c) => {
    const t = c.text;
    return t.startsWith(':') && t.endsWith(':') ? 'center' : t.endsWith(':') ? 'right' : t.startsWith(':') ? 'left' : '';
  });
  const row = (l: Src, tag: 'th' | 'td') => {
    const cells = tableCells(l);
    out.html.push('<tr>');
    align.forEach((a, k) => {
      out.html.push(a ? `<${tag} style="text-align:${a}">` : `<${tag}>`);
      if (cells[k]) inline(cells[k], out);
      out.html.push(`</${tag}>`);
    });
    out.html.push('</tr>');
  };
  out.html.push('<table><thead>');
  row(ls[i], 'th');
  out.html.push('</thead><tbody>');
  let j = i + 2;
  // Rows run to a blank line or the start of another block.
  while (j < ls.length && continuesParagraph(ls[j].text)) row(ls[j++], 'td');
  out.html.push('</tbody></table>');
  return j;
}

/** Whether `t`, after a list item, continues it: indented, not blank, and not an item itself. */
export function continuesItem(t: string): boolean {
  return /^\s/.test(t) && !isBlank(t) && !UL.test(t) && !OL.test(t) && !DELIMITER_LINE.test(t);
}

/** Whether `t` continues a paragraph (rather than starting another block). */
function continuesParagraph(t: string): boolean {
  return !isBlank(t) && !ATX.test(t) && !isFence(t) && !isIndented(t) && !isRule(t) && !t.startsWith('>') && !UL.test(t) && !OL.test(t) && !DELIMITER_LINE.test(t);
}

function blocks(src: Src, out: Out): void {
  // (Not in fenced code, which is literal.)
  let fenced = false;
  const ls = splitLines(src).map((l) => {
    if (isFence(l.text)) fenced = !fenced;
    return fenced || isFence(l.text) ? l : hoist(l, out.literal);
  });
  let i = 0;
  while (i < ls.length) {
    const line = ls[i];
    const t = line.text;

    if (isBlank(t)) {
      i++;
      continue;
    }

    if (DELIMITER_LINE.test(t) && delimiterLine(ls, i, out)) {
      i++;
      continue;
    }

    const atx = ATX.exec(t);
    if (atx) {
      const n = atx[1].length;
      out.html.push(`<h${n}>`);
      inline(trimEnd(sub(line, atx[0].length)), out);
      out.html.push(`</h${n}>`);
      i++;
      continue;
    }

    if (isFence(t)) {
      const body: Src[] = [];
      i++;
      while (i < ls.length && !isFence(ls[i].text)) body.push(ls[i++]);
      i++; // closing fence
      code(body, out);
      continue;
    }

    if (isIndented(t)) {
      const body: Src[] = [];
      while (i < ls.length && isIndented(ls[i].text)) {
        const l = ls[i++];
        body.push(sub(l, l.text.startsWith('\t') ? 1 : 4));
      }
      code(body, out);
      continue;
    }

    if (isRule(t)) {
      out.html.push('<hr>');
      i++;
      continue;
    }

    if (t.startsWith('>')) {
      const body: Src[] = [];
      while (i < ls.length && ls[i].text.startsWith('>')) {
        const l = ls[i++];
        body.push(sub(l, QUOTE.exec(l.text)![0].length));
      }
      out.html.push('<blockquote>');
      blocks(joinLines(body), out);
      out.html.push('</blockquote>');
      continue;
    }

    if (isTableStart(ls, i)) {
      i = table(ls, i, out);
      continue;
    }

    const list = UL.test(t) ? UL : OL.test(t) ? OL : null;
    if (list) {
      const tag = list === UL ? 'ul' : 'ol';
      out.html.push(`<${tag}>`);
      while (i < ls.length && list.test(ls[i].text)) {
        const l = ls[i++];
        const item = [trimEnd(sub(l, list.exec(l.text)![0].length))];
        // An indented line that isn't an item itself continues the item: a line break in it,
        // as in a paragraph.
        while (i < ls.length && continuesItem(ls[i].text)) {
          const c = ls[i++];
          item.push(trimEnd(sub(c, c.text.length - c.text.trimStart().length)));
        }
        out.html.push('<li>');
        inline(joinLines(item), out);
        out.html.push('</li>');
      }
      out.html.push(`</${tag}>`);
      continue;
    }

    if (isSetext(ls[i + 1]?.text)) {
      const n = SETEXT1.test(ls[i + 1].text) ? 1 : 2;
      out.html.push(`<h${n}>`);
      inline(trimEnd(line), out);
      out.html.push(`</h${n}>`);
      i += 2;
      continue;
    }

    const para = [trimEnd(line)];
    i++;
    while (i < ls.length && continuesParagraph(ls[i].text) && !isSetext(ls[i + 1]?.text) && !isTableStart(ls, i)) para.push(trimEnd(ls[i++]));
    out.html.push('<p>');
    inline(joinLines(para), out);
    out.html.push('</p>');
  }
}

function code(body: Src[], out: Out): void {
  // Code is never spell-checked (in Visual; see the editor's `spellcheck`).
  out.html.push('<pre spellcheck="false"><code>');
  body.forEach((l, j) => {
    if (j > 0) {
      out.html.push('\n');
      out.plain.push(body[j - 1].at[body[j - 1].text.length]);
    }
    inline(l, out, true);
    out.code.push([l.at[0], l.at[l.text.length]]);
  });
  out.html.push('</code></pre>');
}


// ---------------------------------------------------------------------------------------
// Inline

interface Span {
  start: number;
  end: number;
  open: string | Tag;
  close: string;
  /** The tag to reopen with after closing it under a crossing span (default: `open`). */
  reopen?: string;
  /** Order made: of spans over the same text, the earlier is the outer. */
  seq: number;
}

const HIDDEN = 1; // a delimiter: not output
const LOCKED = 2; // inside code or a URL: output, but not parsed further

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;

/** Pairs of delimiters, in parse order (longer runs first so `***` isn't read as `**` + `*`). */
const PAIRS: [string, string, string][] = [
  ['***', '<strong><em>', '</em></strong>'],
  ['___', '<strong><em>', '</em></strong>'],
  ['**', '<strong>', '</strong>'],
  ['__', '<strong>', '</strong>'],
  ['*', '<em>', '</em>'],
  ['_', '<em>', '</em>'],
];

/**
 * Inline markdown. A `codeLine` (a line of a code block) is literal but for its review marks.
 * Marks open when it starts (from earlier blocks) take it in from its start; marks still open
 * at its end run on into the next.
 */
function inline(s: Src, out: Out, codeLine = false): void {
  const t = s.text;
  const n = t.length;
  const flag = new Uint8Array(n);
  const spans: Span[] = [];
  const inserts = new Map<number, string>();
  let seq = 0;

  const free = (i: number, len: number) => {
    if (i < 0 || i + len > n) return false;
    for (let k = i; k < i + len; k++) if (flag[k]) return false;
    return true;
  };
  const hide = (i: number, len: number) => flag.fill(HIDDEN, i, i + len);
  const span = (start: number, end: number, open: string | Tag, close: string, reopen?: string) => {
    if (start < end) spans.push({ start, end, open, close, reopen, seq: seq++ });
  };
  /** Where each open mark's element starts here: at 0 for one open from an earlier block. */
  const starts = new Map<Open, number>(out.open.map((o) => [o, 0]));

  /** Opens a mark at `t[k]`, unless that opener is text (see render). */
  const opener = (k: number, code: boolean): Open | null => {
    const d = MARKS.find(([x]) => t[k] === '{' && t.startsWith(x, k + 1))?.[0];
    if (!d || out.literal.has(s.at[k])) return null;
    const o = openMark(out, d, s.at[k], s.at[k + 2] + 1, code);
    starts.set(o, k + 3);
    hide(k, 3);
    return o;
  };
  /** Closes the mark the closing delimiter at `t[k]` closes, its notes `r` after it; false if none. */
  const closer = (k: number, r: Notes, inCode: boolean, among?: readonly Open[]): boolean => {
    const d = MARKS.find(([x]) => t.startsWith(`${x}}`, k))?.[0];
    if (!d) return false;
    const signed = notesAt(t, k + 3, true);
    const o = closing(out, d, signed.notes.length > 0 && signed.end === r.end, inCode, among);
    if (!o) return false;
    hide(k, r.end - k);
    closeMark(out, o, s.at[k], s.at[k + 2] + 1, r.notes.length ? s.at[r.end - 1] + 1 : s.at[k + 2] + 1, s, r, t.slice(k + 3, r.end));
    span(starts.get(o) ?? 0, k, { mark: o.index, tag: o.tag }, `</${o.tag}>`);
    starts.delete(o);
    return true;
  };
  /** Records the comment anchored at `t[k]`: notes after no mark. */
  const anchorAt = (k: number, r: Notes, code: boolean) => {
    hide(k, r.end - k);
    const at = s.at[k];
    const index = out.marks.push({ kind: 'comment', from: at, to: s.at[r.end - 1] + 1, notes: notesIn(s, r), body: at, end: at, close: at, code, verdict: null }) - 1;
    out.marks[index].verdict = markVerdict('comment', out.marks[index].notes);
    out.sources.set(index, t.slice(k, r.end));
    inserts.set(k, `${inserts.get(k) ?? ''}${tagHtml(out, index, 'span', true)}</span>`);
  };

  /**
   * The review marks in code text [a, b) (a code span's, or a code line's): a mark there opens
   * at any opener and closes only with signed notes, as does one opened in code anywhere; signed
   * notes after no mark are an anchored comment. Anything else is code. In a code span, a mark
   * opened there closes there or not at all.
   */
  const codeMarks = (a: number, b: number, inSpan: boolean) => {
    const mine: Open[] = [];
    for (let k = a; k < b; k++) {
      if (t.startsWith('{>>', k)) {
        const r = notesAt(t, k, true);
        if (r.notes.length && r.end <= b) {
          anchorAt(k, r, true);
          k = r.end - 1;
        }
        continue;
      }
      const o = opener(k, true);
      if (o) {
        mine.push(o);
        k += 2;
        continue;
      }
      const r = notesAt(t, k + 3, true);
      if (r.notes.length && r.end <= b && closer(k, r, true, inSpan ? mine : undefined)) k = r.end - 1;
    }
    if (inSpan) {
      for (const o of mine) {
        if (!out.open.includes(o)) continue;
        out.dead.push(out.marks[o.index].from);
        out.open.splice(out.open.indexOf(o), 1);
        starts.delete(o);
      }
    }
  };

  if (codeLine) {
    flag.fill(LOCKED);
    codeMarks(0, n, false);
  }

  // Code spans protect their contents from all other parsing (but their review marks).
  for (let i = 0; i < n && !codeLine; i++) {
    // Notes aren't code (a comment may hold a backtick).
    if (t.startsWith('{>>', i)) {
      const r = notesAt(t, i);
      if (r.notes.length) i = r.end - 1;
      continue;
    }
    if (t[i] !== '`') continue;
    // The closing backtick, past any notes (their comments may hold backticks too).
    let j = i + 1;
    for (; j < n && t[j] !== '`'; j++) {
      if (!t.startsWith('{>>', j)) continue;
      const r = notesAt(t, j, true);
      if (r.notes.length) j = r.end - 1;
    }
    if (j >= n) break;
    hide(i, 1);
    hide(j, 1);
    flag.fill(LOCKED, i + 1, j);
    span(i + 1, j, '<code spellcheck="false">', '</code>');
    out.code.push([s.at[i + 1], j > i + 1 ? s.at[j - 1] + 1 : s.at[i + 1]]);
    codeMarks(i + 1, j, true);
    i = j;
  }

  if (!codeLine) parse();

  /** Notes, images, links, review marks and emphasis (not in a code line). */
  function parse() {
    // Notes are never parsed inside (a comment may hold `*` or `_`). Those after a mark are
    // its; the rest are anchored comments.
    const runs = new Map<number, Notes>();
    for (let i = 0; i < n; i++) {
      if (!t.startsWith('{>>', i) || !free(i, 3)) continue;
      const r = notesAt(t, i);
      if (!r.notes.length) continue;
      flag.fill(LOCKED, i, r.end);
      runs.set(i, r);
      i = r.end - 1;
    }

    for (const m of t.matchAll(IMAGE)) {
      const i = m.index;
      if (!free(i, m[0].length)) continue;
      hide(i, m[0].length);
      const title = m[3] ? ` title="${escapeHtml(m[3])}"` : '';
      inserts.set(i, `${inserts.get(i) ?? ''}<img src="${escapeHtml(m[2])}" alt="${escapeHtml(m[1])}"${title}>`);
    }

    for (const m of t.matchAll(LINK)) {
      const i = m.index;
      const textEnd = i + 1 + m[1].length;
      const end = i + m[0].length;
      if (!free(i, 1) || !free(textEnd, end - textEnd)) continue;
      hide(i, 1);
      hide(textEnd, end - textEnd);
      span(i + 1, textEnd, `<a href="${escapeHtml(m[2])}" target="_blank" rel="noopener">`, '</a>');
    }

    // Review marks, in order: an opener opens one; a closer closes the innermost open of its
    // kind, from here or an earlier block.
    for (let i = 0; i + 3 <= n; i++) {
      if (!free(i, 3)) continue;
      if (opener(i, false)) {
        i += 2;
        continue;
      }
      const r = runs.get(i + 3) ?? { notes: [], end: i + 3 };
      if (!closer(i, r, false)) continue;
      runs.delete(i + 3);
      i = r.end - 1;
    }
    for (const [i, r] of runs) anchorAt(i, r, false);

    // Emphasis: an opener must be followed by non-space, a closer preceded by non-space (so
    // "2 * 3 * 4" stays literal), and the pair must enclose something.
    for (const [d, open, close] of PAIRS) {
      const len = d.length;
      let from = -1;
      for (let i = 0; i + len <= n; i++) {
        if (!t.startsWith(d, i) || !free(i, len)) continue;
        const before = t[i - 1];
        const after = t[i + len];
        const canOpen = after !== undefined && !SPACE.test(after);
        const canClose = before !== undefined && !SPACE.test(before);
        const intraword = d === '_' && canOpen && canClose && WORD.test(before) && WORD.test(after);
        if (!intraword) {
          if (from !== -1 && canClose && i > from + len) {
            hide(from, len);
            hide(i, len);
            span(from + len, i, open, close);
            from = -1;
          } else if (canOpen) {
            from = i;
          }
        }
        i += len - 1;
      }
    }
  }

  // Marks still open run on to the end (and into the next block), outermost first.
  for (const o of out.open) {
    const at = starts.get(o);
    if (at !== undefined) span(at, n, { mark: o.index, tag: o.tag }, `</${o.tag}>`);
  }

  // Emit, keeping tags well nested: when a span closes under others, close those too and
  // reopen them after it.
  const opens = new Map<number, Span[]>();
  const closes = new Map<number, Span[]>();
  for (const sp of spans) {
    opens.set(sp.start, [...(opens.get(sp.start) ?? []), sp]);
    closes.set(sp.end, [...(closes.get(sp.end) ?? []), sp]);
  }
  const html = out.html;
  const active: Span[] = [];
  const closeSpan = (sp: Span) => {
    const above: Span[] = [];
    for (;;) {
      const top = active.pop()!;
      html.push(top.close);
      if (top === sp) break;
      above.push(top);
    }
    for (let k = above.length - 1; k >= 0; k--) {
      html.push(above[k].reopen ?? above[k].open);
      active.push(above[k]);
    }
  };

  for (let i = 0; i <= n; i++) {
    // Inner first: the later opened, of those over the same text.
    for (const sp of (closes.get(i) ?? []).sort((a, b) => b.start - a.start || b.seq - a.seq)) closeSpan(sp);
    const ins = inserts.get(i);
    if (ins) html.push(ins);
    for (const sp of (opens.get(i) ?? []).sort((a, b) => b.end - a.end || a.seq - b.seq)) {
      html.push(sp.open);
      active.push(sp);
    }
    if (i === n) break;
    if (flag[i] === HIDDEN) continue;
    if (t[i] === '\n') {
      html.push('<br>');
    } else {
      html.push(ESC[t[i]] ?? t[i]);
      out.plain.push(s.at[i]);
    }
  }
  while (active.length) html.push(active.pop()!.close);
}
