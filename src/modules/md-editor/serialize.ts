/**
 * Visual DOM → markdown.
 *
 * `toMarkdown` can also carry DOM points (the caret, the selection's ends) into the markdown
 * exactly: each point becomes a private-use sentinel character in the text it sits in, the
 * sentinels ride through the conversion with that text, and at the end they are removed and
 * their positions reported. No offset arithmetic, so it stays right however the conversion
 * reshapes the text (quote prefixes, list markers, delimiters moved past spaces, …).
 */

export interface DomPoint {
  node: Node;
  offset: number;
}

export interface Serialized {
  md: string;
  /** Markdown index of each requested point (null for a point that was not inside `root`). */
  at: (number | null)[];
}

export function toMarkdown(root: Element, points: readonly (DomPoint | null)[] = []): Serialized {
  const raw = new Converter(points, pieces(root)).blocks(root).join('\n\n');
  const at: (number | null)[] = points.map(() => null);
  let removed = 0;
  const md = raw.replace(SENTINELS, (ch, offset: number) => {
    at[ch.charCodeAt(0) - SENTINEL] = offset - removed++;
    return '';
  });
  return { md, at };
}

const SENTINEL = 0xe000;
const SENTINELS = /[-]/g;

const BLOCKS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'HR',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE', 'TABLE', 'DL',
]);

const isBlock = (n: Node | string): n is Element => n instanceof Element && BLOCKS.has(n.tagName);
const hasBlockChild = (el: Element) => Array.from(el.children).some((c) => BLOCKS.has(c.tagName));
/** Anything besides whitespace (a sentinel counts: it marks where the caret is). */
const hasContent = (s: string) => /\S/.test(s);
/** Visible text: anything besides whitespace and sentinels. */
const hasText = (s: string) => /[^\s-]/.test(s);

/** Wraps `inner` in delimiter `d`, keeping edge whitespace outside so the pair still parses. */
function wrap(d: string, inner: string): string {
  if (!hasText(inner)) return inner;
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return `${lead}${d}${core}${d}${trail}`;
}

/**
 * A piece of a review mark (`d` is `++`, `--` or `==`; see Piece): `{d` before it if it starts
 * the mark, `d}` and the notes after it if it ends it. Spaces stay inside, so a tracked change
 * keeps the spaces it added or deleted; line breaks at its ends (such as a trailing <br>) go
 * outside. A mark all in one piece with no text (bar a space, with notes) is dropped, notes and all.
 */
function markup(d: string, inner: string, p: Piece): string {
  if (p.opens && p.closes && !hasText(inner) && !(p.notes && /[^\S\n]/.test(inner))) return inner;
  const [, lead, core, trail] = /^(\n*)([\s\S]*?)(\n*)$/.exec(inner)!;
  return `${lead}${p.opens ? `{${d}` : ''}${core}${p.closes ? `${d}}${p.notes}` : ''}${trail}`;
}

/**
 * One element of a review mark. A mark the renderer drew in several (one per block it runs
 * through) is written as one mark again — opened at its first, closed with its notes after its
 * last — so long as no text outside it came between them; where some did, it is written as
 * marks of its own either side, each with the mark's notes.
 */
interface Piece {
  opens: boolean;
  closes: boolean;
  notes: string;
}

/** Each review mark element's piece (see Piece). */
function pieces(root: Element): Map<Element, Piece> {
  const out = new Map<Element, Piece>();
  /** The last piece of each mark (by its `data-mark`), and whether text outside it came since. */
  const last = new Map<string, { piece: Piece; broken: boolean }>();
  /** Those that no text outside them has come after yet. */
  const waiting = new Map<string, { piece: Piece; broken: boolean }>();
  /** Each mark's notes, from its first element. */
  const notes = new Map<string, string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Text) {
      if (!hasText(n.data)) continue;
      for (const [id, l] of waiting) {
        if (n.parentElement?.closest(`[data-mark="${id}"]`)) continue;
        l.broken = true;
        waiting.delete(id);
      }
      continue;
    }
    if (!(n instanceof Element) || !MARK_DELIMS[n.tagName]) continue;
    const id = n.getAttribute('data-mark');
    const own = notesOf(n);
    if (id === null) {
      out.set(n, { opens: true, closes: true, notes: own });
      continue;
    }
    if (own && !notes.has(id)) notes.set(id, own);
    const prev = last.get(id);
    const piece: Piece = { opens: true, closes: true, notes: notes.get(id) ?? own };
    if (prev && !prev.broken) {
      prev.piece.closes = false;
      piece.opens = false;
    }
    const l = { piece, broken: false };
    last.set(id, l);
    waiting.set(id, l);
    out.set(n, piece);
  }
  return out;
}

/** Each mark element's delimiter. */
const MARK_DELIMS: Record<string, string> = { U: '++', INS: '++', DEL: '--', S: '--', STRIKE: '--', MARK: '==' };

/** The notes an element carries from the renderer (see parse.ts). */
const notesOf = (el: Element) => (el instanceof HTMLElement ? el.dataset.notes ?? '' : '');
/** An anchored comment's element: its notes are all of it. */
const isAnchor = (el: Element) => el.classList.contains('md-anchor');

class Converter {
  private readonly marks = new Map<Node, { offset: number; ch: string }[]>();

  constructor(
    points: readonly (DomPoint | null)[],
    private readonly pieces: Map<Element, Piece>,
  ) {
    points.forEach((p, k) => {
      if (!p) return;
      const list = this.marks.get(p.node) ?? [];
      list.push({ offset: p.offset, ch: String.fromCharCode(SENTINEL + k) });
      this.marks.set(p.node, list);
    });
  }

  /** The markdown blocks for `el`'s children. Runs of inline content become paragraphs. */
  blocks(el: Node): string[] {
    const out: string[] = [];
    let run: (Node | string)[] = [];
    const flush = () => {
      if (!run.length) return;
      const p = this.paragraph(run);
      if (p) out.push(p);
      run = [];
    };
    for (const c of this.kids(el)) {
      if (isBlock(c)) {
        flush();
        out.push(...this.block(c));
      } else {
        run.push(c);
      }
    }
    flush();
    return out;
  }

  private block(el: Element): string[] {
    const tag = el.tagName;
    switch (tag) {
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const s = this.line(this.kids(el));
        return hasContent(s) ? [`${'#'.repeat(Number(tag[1]))} ${s}`] : [];
      }
      case 'BLOCKQUOTE': {
        const inner = this.blocks(el).join('\n\n');
        return inner ? [inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')] : [];
      }
      case 'UL':
      case 'OL':
        return this.list(el, tag === 'OL');
      case 'PRE':
        return ['```\n' + this.code(el).replace(/\n$/, '') + '\n```'];
      case 'HR':
        return ['---'];
      case 'TABLE':
        return this.table(el);
      default: {
        if (hasBlockChild(el)) return this.blocks(el);
        const p = this.paragraph(this.kids(el));
        return p ? [p] : [];
      }
    }
  }

  private list(el: Element, ordered: boolean): string[] {
    const items: string[] = [];
    let carry = ''; // sentinels sitting between items
    for (const c of this.kids(el)) {
      if (typeof c === 'string') {
        carry += c;
        continue;
      }
      const content = c instanceof Element && c.tagName === 'LI' ? c : null;
      const s = carry + (content && hasBlockChild(content) ? this.blocks(content).join(' ').replace(/\s*\n\s*/g, ' ').trim() : this.itemText(content ? this.kids(content) : [c]));
      carry = '';
      if (!hasContent(s)) continue;
      const marker = ordered ? `${items.length + 1}.` : '*';
      // A line break in an item: its next line is indented under the item's text.
      items.push(`${marker} ${s.replace(/\n/g, `\n${' '.repeat(marker.length + 1)}`)}`);
    }
    if (carry && items.length) items[items.length - 1] += carry;
    return items.length ? [items.join('\n')] : carry ? [carry] : [];
  }

  /**
   * A GFM table: the first row is the header (a <thead>'s, else the table's first), then the
   * delimiter row with each column's alignment (from the header cells), then the body. Cells
   * are one line each, their pipes escaped; short rows are padded with empty cells.
   */
  private table(el: Element): string[] {
    const rows = Array.from(el.querySelectorAll('tr')).filter((tr) => tr.closest('table') === el);
    if (!rows.length) return [];
    const cellsOf = (tr: Element) => Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    const width = Math.max(1, ...rows.map((tr) => cellsOf(tr).length));
    const line = (tr: Element) => {
      // One line each; spaces at the end are kept (the parser takes one as padding).
      const cell = (c: Element) => this.inline(this.kids(c)).replace(/\s*\n\s*/g, ' ').replace(/^\s+/, '');
      const cells = cellsOf(tr).map((c) => cell(c).replace(/\|/g, '\\|'));
      while (cells.length < width) cells.push('');
      return `| ${cells.join(' | ')} |`;
    };
    const align = cellsOf(rows[0]).map((c) => {
      const a = (c as HTMLElement).style?.textAlign || c.getAttribute('align') || '';
      return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
    });
    while (align.length < width) align.push('---');
    return [[line(rows[0]), `| ${align.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')];
  }

  /** A list item's inline content: its line breaks kept (blank lines dropped), ends trimmed. */
  private itemText(nodes: (Node | string)[]): string {
    return this.inline(nodes)
      .replace(/[^\S\n]*\n\s*/g, '\n')
      .trim();
  }

  /** Inline content as one line (for headings and table cells). */
  private line(nodes: (Node | string)[]): string {
    return this.inline(nodes).replace(/\s*\n\s*/g, ' ').trim();
  }

  private paragraph(nodes: (Node | string)[]): string {
    const s = this.inline(nodes).replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
    return hasContent(s) ? s : '';
  }

  private inline(nodes: Iterable<Node | string>): string {
    let s = '';
    for (const c of nodes) s += typeof c === 'string' ? c : this.node(c);
    return s;
  }

  private node(n: Node): string {
    if (n instanceof Text) return this.text(n);
    if (!(n instanceof Element)) return '';
    if (isAnchor(n)) return notesOf(n) + this.inline(this.kids(n));
    const inner = () => this.inline(this.kids(n));
    const d = MARK_DELIMS[n.tagName];
    if (d) return markup(d, inner(), this.piece(n));
    switch (n.tagName) {
      case 'BR':
        return '\n';
      case 'STRONG':
      case 'B':
        return wrap('**', inner());
      case 'EM':
      case 'I':
        return wrap('*', inner());
      case 'CODE':
        return wrap('`', this.code(n).replace(/\n/g, ' '));
      case 'A': {
        const s = inner();
        return hasText(s) ? `[${s}](${n.getAttribute('href') || 'url'})` : s;
      }
      case 'IMG': {
        const title = n.getAttribute('title');
        return `![${n.getAttribute('alt') ?? ''}](${n.getAttribute('src') ?? ''}${title ? ` "${title}"` : ''})`;
      }
      default:
        return isBlock(n) ? `\n${inner()}\n` : inner();
    }
  }

  /**
   * Literal text of a code element; <br> and line <div>s become newlines. Review marks with
   * notes, and anchored comments, are written as they are anywhere.
   */
  private code(el: Node): string {
    let s = '';
    for (const c of this.kids(el)) {
      if (typeof c === 'string') s += c;
      else if (c instanceof Text) s += this.text(c);
      else if (c instanceof Element) {
        if (c.tagName === 'BR') {
          s += '\n';
        } else if (c.tagName === 'DIV' || c.tagName === 'P') {
          if (s && !s.endsWith('\n')) s += '\n';
          s += this.code(c);
          if (!s.endsWith('\n')) s += '\n';
        } else if (isAnchor(c)) {
          s += notesOf(c) + this.code(c);
        } else {
          const d = MARK_DELIMS[c.tagName];
          const p = this.piece(c);
          // In code a mark needs its notes: without, it is just code.
          s += d && p.notes ? markup(d, this.code(c), p) : this.code(c);
        }
      }
    }
    return s;
  }

  /** Element `el`'s piece of its mark (a whole mark, if it wasn't seen: see pieces). */
  private piece(el: Element): Piece {
    return this.pieces.get(el) ?? { opens: true, closes: true, notes: notesOf(el) };
  }

  private text(n: Text): string {
    let s = n.data.replace(/ /g, ' ');
    const ms = this.marks.get(n);
    if (ms) for (const m of [...ms].sort((a, b) => b.offset - a.offset)) s = s.slice(0, m.offset) + m.ch + s.slice(m.offset);
    return s;
  }

  /** Child nodes, with sentinels for points that address a child position of `el`. */
  private kids(el: Node): (Node | string)[] {
    const ms = this.marks.get(el);
    const nodes = Array.from(el.childNodes) as (Node | string)[];
    if (!ms) return nodes;
    const out: (Node | string)[] = [];
    for (let i = 0; i <= nodes.length; i++) {
      for (const m of ms) if (m.offset === i) out.push(m.ch);
      if (i < nodes.length) out.push(nodes[i]);
    }
    return out;
  }
}
