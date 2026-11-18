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
 * Code is literal but for review marks: there a mark must have notes signed with an author and
 * date, and it ends at the first closing delimiter they follow (`{++i++}{>>Matt 2026-11-18<<}`
 * adds `i++`), so code that happens to look like markup stays code.
 *
 * Besides the HTML, `render` reports:
 * - `plain`: for each character of the rendered DOM text (in document order), its index in the
 *   markdown. The HTML contains no whitespace between tags, so the DOM's text nodes hold exactly
 *   these characters. This is what carries a caret or selection from Raw to Visual exactly.
 * - `marks`: where the marks sit in the markdown, delimiters and notes included, so the Raw
 *   view styles exactly what the Visual view styles; and their notes.
 *
 * In the HTML, each mark element carries `data-mark` (its index in `marks`). Its first element
 * also carries the notes' source text in `data-notes` (the notes themselves are not shown), so
 * the serializer can write them back after the Visual view is edited. An anchored comment is an
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
  /** Markdown index where its text starts, after the opening delimiter (a comment's: `from`). */
  body: number;
  /** Markdown index where its text ends, at the closing delimiter (a comment's: `from`). */
  end: number;
  /** In code. */
  code: boolean;
  /** An addition or deletion resolved in its thread (see verdictOf); kept, with its history. */
  verdict: Verdict | null;
}

export interface Rendered {
  html: string;
  plain: number[];
  marks: Mark[];
  /** Markdown ranges [from, to) of code text (spans and blocks), where markup is literal. */
  code: [number, number][];
}

export function render(md: string): Rendered {
  const at = Array.from({ length: md.length + 1 }, (_, i) => i);
  const out: Out = { html: [], plain: [], marks: [], code: [] };
  blocks({ text: md, at }, out);
  return { html: out.html.join(''), plain: out.plain, marks: out.marks, code: out.code };
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

interface Out {
  html: string[];
  plain: number[];
  marks: Mark[];
  code: [number, number][];
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
  return /^\s/.test(t) && !isBlank(t) && !UL.test(t) && !OL.test(t);
}

/** Whether `t` continues a paragraph (rather than starting another block). */
function continuesParagraph(t: string): boolean {
  return !isBlank(t) && !ATX.test(t) && !isFence(t) && !isIndented(t) && !isRule(t) && !t.startsWith('>') && !UL.test(t) && !OL.test(t);
}

function blocks(src: Src, out: Out): void {
  const ls = splitLines(src);
  let i = 0;
  while (i < ls.length) {
    const line = ls[i];
    const t = line.text;

    if (isBlank(t)) {
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
  open: string;
  close: string;
  /** The tag to reopen with after closing it under a crossing span (default: `open`). */
  reopen?: string;
}

const HIDDEN = 1; // a delimiter: not output
const LOCKED = 2; // inside code or a URL: output, but not parsed further

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SPACE = /\s/;
const WORD = /[\p{L}\p{N}]/u;
/** The marks: each one's delimiter (`{==` … `==}`), kind and tag. */
const MARKS: [string, MarkKind, string][] = [
  ['==', 'highlight', 'mark'],
  ['--', 'strike', 'del'],
  ['++', 'underline', 'u'],
];

/** Pairs of delimiters, in parse order (longer runs first so `***` isn't read as `**` + `*`). */
const PAIRS: [string, string, string][] = [
  ['***', '<strong><em>', '</em></strong>'],
  ['___', '<strong><em>', '</em></strong>'],
  ['**', '<strong>', '</strong>'],
  ['__', '<strong>', '</strong>'],
  ['*', '<em>', '</em>'],
  ['_', '<em>', '</em>'],
];

type Notes = ReturnType<typeof notesAt>;

/**
 * Inline markdown. A `codeLine` (a line of a code block) is literal but for its review marks.
 */
function inline(s: Src, out: Out, codeLine = false): void {
  const t = s.text;
  const n = t.length;
  const flag = new Uint8Array(n);
  const spans: Span[] = [];
  const inserts = new Map<number, string>();

  const free = (i: number, len: number) => {
    if (i < 0 || i + len > n) return false;
    for (let k = i; k < i + len; k++) if (flag[k]) return false;
    return true;
  };
  const hide = (i: number, len: number) => flag.fill(HIDDEN, i, i + len);
  const span = (start: number, end: number, open: string, close: string, reopen?: string) => {
    if (start < end) spans.push({ start, end, open, close, reopen });
  };

  /** Records the mark of `kind` from `t[k]` whose closing delimiter is at `j`, then its notes. */
  const markAt = (k: number, j: number, r: Notes, kind: MarkKind, tag: string, code: boolean) => {
    hide(k, 3);
    hide(j, r.end - j);
    const html = record(kind, s.at[k], s.at[r.end - 1] + 1, s.at[k + 3], s.at[j], lead(r), t.slice(j + 3, r.end), tag, code);
    span(k + 3, j, html.open, `</${tag}>`, html.reopen);
  };
  /** Records the comment anchored at `t[k]`: notes after no mark. */
  const anchorAt = (k: number, r: Notes, code: boolean) => {
    hide(k, r.end - k);
    const at = s.at[k];
    const html = record('comment', at, s.at[r.end - 1] + 1, at, at, lead(r), t.slice(k, r.end), 'span', code);
    inserts.set(k, `${inserts.get(k) ?? ''}${html.open}</span>`);
  };
  const lead = (r: Notes) => r.notes.map((x) => noteOf(x.text, s.at[x.at], x.text ? s.at[x.at + x.text.length - 1] + 1 : s.at[x.at]));

  /**
   * The review marks in code text [a, b) (a code span's, or a code line's), nested ones too: a
   * mark ends at the first closing delimiter that signed notes follow; signed notes after no
   * mark are an anchored comment. Anything else is code.
   */
  const codeMarks = (a: number, b: number, inSpan: boolean) => {
    for (let k = a; k < b; k++) {
      if (t.startsWith('{>>', k)) {
        const r = notesAt(t, k, true);
        if (r.notes.length && r.end <= b) {
          anchorAt(k, r, true);
          k = r.end - 1;
        }
        continue;
      }
      const m = t[k] === '{' ? MARKS.find(([d]) => t.startsWith(d, k + 1)) : undefined;
      if (!m) continue;
      const close = `${m[0]}}`;
      let found: [number, Notes] | null = null;
      for (let j = k + 4; j + 3 <= b && t[j] !== '\n' && !(inSpan && t[j] === '`'); j++) {
        if (!t.startsWith(close, j)) continue;
        const r = notesAt(t, j + 3, true);
        if (r.notes.length && r.end <= b) {
          found = [j, r];
          break;
        }
      }
      if (!found) continue;
      const [j, r] = found;
      markAt(k, j, r, m[1], m[2], true);
      codeMarks(k + 3, j, inSpan);
      k = r.end - 1;
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

    // Review marks: each ends at its first closing delimiter, on its line.
    for (const [d, kind, tag] of MARKS) {
      const open = `{${d}`;
      const close = `${d}}`;
      for (let i = 0; i + 3 <= n; i++) {
        if (!t.startsWith(open, i) || !free(i, 3)) continue;
        let j = i + 4;
        while (j + 3 <= n && t[j - 1] !== '\n' && !(t.startsWith(close, j) && free(j, 3))) j++;
        if (j + 3 > n || t[j - 1] === '\n') continue;
        const r = runs.get(j + 3) ?? { notes: [], end: j + 3 };
        runs.delete(j + 3);
        markAt(i, j, r, kind, tag, false);
        i = r.end - 1;
      }
    }
    for (const [i, r] of runs) anchorAt(i, r, false);

    // Emphasis: an opener must be followed by non-space, a closer preceded by non-space (so
    // "2 * 3 * 4" stays literal), and the pair must enclose something.
    for (const [d, open, close] of PAIRS) {
      const len = d.length;
      let opener = -1;
      for (let i = 0; i + len <= n; i++) {
        if (!t.startsWith(d, i) || !free(i, len)) continue;
        const before = t[i - 1];
        const after = t[i + len];
        const canOpen = after !== undefined && !SPACE.test(after);
        const canClose = before !== undefined && !SPACE.test(before);
        const intraword = d === '_' && canOpen && canClose && WORD.test(before) && WORD.test(after);
        if (!intraword) {
          if (opener !== -1 && canClose && i > opener + len) {
            hide(opener, len);
            hide(i, len);
            span(opener + len, i, open, close);
            opener = -1;
          } else if (canOpen) {
            opener = i;
          }
        }
        i += len - 1;
      }
    }
  }

  /**
   * Adds a mark to `out.marks`, `source` being its notes' text; returns its opening tag (with
   * its notes, for the serializer) and the tag to reopen it with.
   */
  function record(kind: MarkKind, from: number, to: number, body: number, end: number, notes: Note[], source: string, tag: string, code: boolean) {
    const verdict = kind === 'highlight' || kind === 'comment' ? null : verdictOf(notes);
    const index = out.marks.push({ kind, from, to, notes, body, end, code, verdict }) - 1;
    // A resolved change shows as its outcome: an accepted addition or rejected deletion as plain
    // text; the text an accepted deletion or rejected addition took out, not at all (still there
    // for the source map and the serializer, but not to be edited).
    const cls = [kind === 'comment' ? 'md-anchor' : '', notes.length ? 'noted' : '', verdict ?? ''].filter(Boolean).join(' ');
    const gone = kind === 'comment' || verdict === (kind === 'strike' ? 'accepted' : 'rejected');
    const base = `<${tag} data-mark="${index}"${cls ? ` class="${cls}"` : ''}${gone ? ' contenteditable="false"' : ''}`;
    return { open: notes.length ? `${base} data-notes="${escapeHtml(source)}">` : `${base}>`, reopen: `${base}>` };
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
    for (const sp of (closes.get(i) ?? []).sort((a, b) => b.start - a.start)) closeSpan(sp);
    const ins = inserts.get(i);
    if (ins) html.push(ins);
    for (const sp of (opens.get(i) ?? []).sort((a, b) => b.end - a.end)) {
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
