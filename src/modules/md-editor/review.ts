/**
 * The review column: as in Word's review mode, a column down the right of the document (a
 * quarter of the editor's width) where every highlight, addition and deletion with a thread
 * shows as a grey box, at all times, in Visual and in Raw. Boxes scroll with the text.
 *
 * Each box is tied to its text by a dotted line: along the bottom of the text's last line, out to
 * 15px short of the column (where it would turn), then across into the middle of the box's left
 * side. A box is centered on its line, so the line runs straight in. Boxes that would crowd each
 * other form a cluster, stacked in the text's order, and the cluster is centered between its top
 * and bottom lines (where they leave the text); lines then turn up or down to their boxes, and
 * lines whose turns would run over each other turn a little further out.
 *
 * A click on a box (for someone who can comment) opens a field in it to comment or reply; Return
 * sends and keeps the field for more, Escape or a click elsewhere closes it.
 */
import { NxTextField, h } from '../widgets';
import { noteList } from './notes';
import type { Mark, MarkKind } from './parse';

export const KIND_TITLE: Record<MarkKind, string> = { highlight: 'Highlight', strike: 'Deletion', underline: 'Addition' };

/** Identifies a mark across edits: by its first attribution, or (without one) by its text. */
function markKey(md: string, m: Mark): string {
  const n = m.notes[0];
  return n ? `${m.kind}|${n.author}|${n.time ?? ''}|${n.comment ?? ''}` : `${m.kind}||${md.slice(m.body, m.to - 2)}`;
}

/**
 * Each mark's key (see markKey), made unique: a mark that shares one with marks before it (the
 * same author's changes in the same second, say) gets `#2`, `#3`, … in the order they come.
 */
export function markKeys(md: string, marks: readonly Mark[]): string[] {
  const seen = new Map<string, number>();
  return marks.map((m) => {
    const key = markKey(md, m);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n > 1 ? `${key}#${n}` : key;
  });
}

/** A box on screen. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a mark is on screen: the boxes of its first and last lines (the same box for one line). */
export interface Extent {
  first: Box;
  last: Box;
}

/** What the review column needs from the editor. */
export interface ReviewHost {
  /** Who comments (no field to comment without one; marks without a thread aren't shown then). */
  readonly user?: string;
  /** The marks shown in the current view, and the markdown they were read from. */
  marks(): { md: string; marks: readonly Mark[] };
  /** Where mark `i` of marks() is on screen, or null if it isn't shown. */
  extent(i: number): Extent | null;
  /** Mark `i`'s author colour (a CSS colour), if it has one. */
  color(i: number): string | null;
  /** Whether annotations are shown at all (Review Mode): the column shows exactly while it's on, boxes or none. */
  enabled(): boolean;
  /** Adds the user's `text` to the thread of the mark with `key`; returns the mark's key after. */
  comment(key: string, text: string): string | null;
}

/** How far short of the column a line turns. */
const LINE_OUT = 15;
/** How much further out a line turns for each line whose turn it would run over. */
const LINE_STEP = 4;
/** Radius of the half-circle bump where a line meets its box. */
const BUMP = 4;
/** Space between boxes, and kept above the first and below the last. */
const GAP = 6;
/** A cluster moves up or down by as much as this to run one of its lines in straight. */
const SNAP = 10;
const SVG = 'http://www.w3.org/2000/svg';

interface Item {
  key: string;
  el: HTMLDivElement;
  body: HTMLDivElement;
  /** The line to the text and its bump. */
  link: SVGGElement;
  /** What the box shows now, to redraw it only when that changes. */
  shown: string;
}

interface Placed {
  item: Item;
  ext: Extent;
  /** Where its line leaves the text (the bottom of the text's last line), in the column's coordinates. */
  line: number;
  height: number;
  /** Where the box goes. */
  y: number;
}

export class Review {
  /** The column (in the scroller's second grid column). */
  readonly el: HTMLDivElement;
  /** The lines, over the whole document. */
  readonly svg: SVGSVGElement;
  private readonly items = new Map<string, Item>();
  /** The box with the comment field open. */
  private active: { key: string; field: NxTextField } | null = null;
  /** Each mark's key, by its index (as of the last layout). */
  private keyAt: string[] = [];
  /** The mark whose text the pointer is over: its line is lit. */
  private pointed: string | null = null;
  private frame = 0;

  constructor(
    private readonly host: ReviewHost,
    /** The document's scroller, which the column and lines scroll with. */
    private readonly scroller: HTMLElement,
  ) {
    this.el = h('div', { className: 'md-review' });
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('md-review-lines');
    document.addEventListener('pointerdown', this.onOutside, true);
  }

  /** Lays the column out again on the next frame (the text, its layout or the marks changed). */
  schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.layout());
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.el.remove();
    this.svg.remove();
  }

  /**
   * The pointer is over mark `i`'s text (null: over none): lights its line, drawn over the others,
   * as pointing at its box does.
   */
  point(i: number | null): void {
    const key = i === null ? null : (this.keyAt[i] ?? null);
    if (key === this.pointed) return;
    if (this.pointed) this.items.get(this.pointed)?.link.classList.remove('lit');
    this.pointed = key;
    const item = key ? this.items.get(key) : null;
    if (!item) return;
    item.link.classList.add('lit');
    this.svg.append(item.link);
  }

  /** Places every box and draws its line. */
  layout(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { md, marks } = this.host.marks();
    const user = this.host.user;
    const keys = markKeys(md, marks);
    this.keyAt = keys;
    const wanted = marks.map((m, i) => ({ m, i, key: keys[i] })).filter((x) => user || x.m.notes.length);

    // Shown in Review Mode, with or without boxes: set first, as it narrows the text.
    const open = this.host.enabled();
    this.scroller.classList.toggle('md-reviewing', open);

    const keep = new Set<string>();
    const placed: Placed[] = [];
    if (open) {
      const origin = this.origin();
      for (const { m, i, key } of wanted) {
        const ext = this.host.extent(i);
        if (!ext || keep.has(key)) continue;
        keep.add(key);
        const item = this.item(key);
        this.fill(item, m, this.host.color(i));
        placed.push({ item, ext, line: ext.last.bottom - origin.y, height: 0, y: 0 });
      }
    }
    for (const [key, item] of this.items) {
      if (keep.has(key)) continue;
      item.el.remove();
      item.link.remove();
      this.items.delete(key);
      if (this.active?.key === key) this.active = null;
      if (this.pointed === key) this.pointed = null;
    }
    if (!placed.length) {
      this.el.style.minHeight = '';
      return;
    }

    for (const p of placed) p.height = p.item.el.offsetHeight;
    // In the text's order: by where their lines leave it, then (on the same line) left to right.
    placed.sort((a, b) => a.line - b.line || a.ext.last.left - b.ext.last.left);
    let end = 0;
    for (const cluster of clusters(placed)) {
      for (const p of cluster) {
        p.item.el.style.top = `${p.y}px`;
        end = Math.max(end, p.y + p.height);
      }
    }
    // Room below the last box, so the document scrolls far enough to show it (a minimum: the
    // column still stretches, grey, to the bottom of a longer document).
    this.el.style.minHeight = `max(100cqh, ${end + GAP}px)`;
    this.draw(placed);
  }

  /** The document's top-left on screen (where the column's and lines' coordinates start). */
  private origin(): { x: number; y: number } {
    const r = this.scroller.getBoundingClientRect();
    return { x: r.left - this.scroller.scrollLeft, y: r.top - this.scroller.scrollTop };
  }

  /** The lines, each from its text to its box: along the text's last line, out to the turn, across into the box. */
  private draw(placed: Placed[]): void {
    const origin = this.origin();
    const col = this.el.getBoundingClientRect();
    const colLeft = col.left - origin.x;
    const edge = colLeft - LINE_OUT;
    const s = (v: number) => Math.round(v) + 0.5;
    const lines = placed.map((p) => {
      const y = p.line;
      const midY = p.y + p.height / 2;
      return { p, y, midY, lo: Math.min(y, midY), hi: Math.max(y, midY), step: 0 };
    });
    // How far out each line turns, in steps. Of two lines whose vertical runs would overlap, one
    // turns inside the other — the one that can without crossing it (see `inside`); when either
    // could, the shorter run (the box nearer its text), so the lines nest concentrically, the most
    // remote box's line furthest out. Each line then turns one step outside every line inside it.
    const runs = lines.filter((l) => l.hi - l.lo > 1);
    const outer = new Map(runs.map((l) => [l, [] as typeof runs]));
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i];
        const b = runs[j];
        if (!clash(a, b)) continue;
        const aIn = inside(a, b);
        const bIn = inside(b, a);
        const aFirst = aIn !== bIn ? aIn : a.hi - a.lo <= b.hi - b.lo;
        if (aFirst) outer.get(a)!.push(b);
        else outer.get(b)!.push(a);
      }
    }
    // Longest path from the innermost (capped, should the choices ever form a loop).
    for (let round = 0, moved = true; moved && round < runs.length; round++) {
      moved = false;
      for (const [l, outs] of outer) {
        for (const o of outs) {
          if (o.step > l.step) continue;
          o.step = l.step + 1;
          moved = true;
        }
      }
    }
    for (const { p, y, midY, step } of lines) {
      const box = p.item.el.getBoundingClientRect();
      const boxLeft = box.left - origin.x;
      const x0 = Math.min(p.ext.last.left - origin.x, edge);
      const turn = Math.max(x0, edge - step * LINE_STEP);
      const d = `M${s(x0)} ${s(y)}H${s(turn)}V${s(midY)}H${s(boxLeft)}`;
      const [path, bump] = p.item.link.children;
      path.setAttribute('d', d);
      bump.setAttribute('cx', String(s(boxLeft)));
      bump.setAttribute('cy', String(s(midY)));
    }
    // The open box's line on top.
    const active = this.active && this.items.get(this.active.key);
    if (active) this.svg.append(active.link);
  }

  private item(key: string): Item {
    const found = this.items.get(key);
    if (found) return found;
    const el = h('div', { className: 'md-review-box' });
    const body = h('div', { className: 'md-review-body' });
    el.append(body);
    const link = document.createElementNS(SVG, 'g');
    link.append(document.createElementNS(SVG, 'path'), document.createElementNS(SVG, 'circle'));
    link.lastElementChild!.setAttribute('r', String(BUMP));
    const item: Item = { key, el, body, link, shown: '' };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.host.user || this.active?.key === item.key) return;
      e.preventDefault();
      this.open(item);
    });
    el.addEventListener('mouseenter', () => link.classList.add('hot'));
    el.addEventListener('mouseleave', () => link.classList.remove('hot'));
    this.items.set(key, item);
    this.el.append(el);
    this.svg.append(link);
    return item;
  }

  /** Shows the mark's kind and thread in its box (when they changed). */
  private fill(item: Item, m: Mark, color: string | null): void {
    const sig = JSON.stringify([m.kind, color, m.verdict, m.notes.map((n) => [n.author, n.time, n.comment])]);
    if (sig === item.shown) return;
    item.shown = sig;
    if (color) item.el.style.setProperty('--md-change', color);
    else item.el.style.removeProperty('--md-change');
    item.el.dataset.kind = m.kind;
    item.el.classList.toggle('resolved', !!m.verdict);
    const kind = h('div', { className: 'md-review-kind', textContent: KIND_TITLE[m.kind] });
    if (m.verdict) kind.append(' · ', h('span', { className: 'md-review-verdict', textContent: m.verdict === 'accepted' ? 'Accepted' : 'Rejected' }));
    item.body.replaceChildren(kind, ...(m.notes.length ? [noteList(m.notes)] : []));
    if (this.active?.key === item.key) this.setPlaceholder(m);
  }

  /** Opens the comment field in a box (closing any other). */
  private open(item: Item): void {
    const user = this.host.user;
    if (!user) return;
    this.close();
    const field = new NxTextField({ onCommit: (text) => this.send(text) });
    field.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    const foot = h('div', { className: 'md-review-foot' });
    foot.append(field.el, h('div', { className: 'md-review-who', textContent: `As ${user} · Return to send` }));
    item.el.append(foot);
    item.el.classList.add('active');
    item.link.classList.add('active');
    this.active = { key: item.key, field };
    const { md, marks } = this.host.marks();
    const m = marks[markKeys(md, marks).indexOf(item.key)];
    if (m) this.setPlaceholder(m);
    field.focus();
    this.layout();
  }

  private close(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const item = this.items.get(a.key);
    item?.el.querySelector('.md-review-foot')?.remove();
    item?.el.classList.remove('active');
    item?.link.classList.remove('active');
    this.schedule();
  }

  /** The author's own change with no comment yet gets theirs; otherwise it's a reply. */
  private setPlaceholder(m: Mark): void {
    const first = m.notes[0];
    const reply = !!first && !(m.notes.length === 1 && !first.comment && first.author === this.host.user);
    if (this.active) this.active.field.input.placeholder = reply ? 'Reply…' : 'Comment…';
  }

  private send(text: string): void {
    const a = this.active;
    if (!a || !text.trim()) return;
    const next = this.host.comment(a.key, text);
    a.field.value = '';
    // The mark's key changes when its author first comments on it: the box (field and all) goes with it.
    if (next && next !== a.key) {
      const item = this.items.get(a.key);
      this.items.delete(a.key);
      if (item) {
        item.key = next;
        this.items.set(next, item);
      }
      if (this.pointed === a.key) this.pointed = next;
      a.key = next;
    }
    a.field.focus();
    this.schedule();
  }

  private readonly onOutside = (e: Event) => {
    const t = e.target;
    const item = this.active && this.items.get(this.active.key);
    if (item && t instanceof Node && !item.el.contains(t)) this.close();
  };
}

/**
 * Whether two lines' vertical runs (from where they leave the text, `y`, to their boxes) can't
 * share a turn: they overlap, or come within 2px (they'd look like one line). Two that only
 * meet where both leave the same line of text, one going up and the other down, can.
 */
function clash(a: { lo: number; hi: number; y: number }, b: { lo: number; hi: number; y: number }): boolean {
  const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
  if (overlap > 0) return true;
  if (Math.abs(overlap) < 0.5) return Math.abs(a.y - b.y) >= 0.5;
  return overlap > -2;
}

/**
 * Whether line `a` can turn inside line `b` (nearer the column) without crossing it. `a`'s first
 * leg runs from its text out past `b`'s turn, so it mustn't leave the text partway along `b`'s
 * vertical run; `b`'s last leg runs into its box past `a`'s turn, so it mustn't arrive partway
 * along `a`'s.
 */
function inside(a: { lo: number; hi: number; y: number; midY: number }, b: { lo: number; hi: number; y: number; midY: number }): boolean {
  const within = (v: number, r: { lo: number; hi: number }) => v > r.lo + 0.5 && v < r.hi - 0.5;
  return !within(a.y, b) && !within(b.midY, a);
}

/**
 * Groups boxes (sorted by their lines) into clusters that don't crowd each other, and sets each
 * box's `y`: a cluster's boxes are stacked in order, the stack centered between its top and
 * bottom lines (a single box on its line), no higher than the top of the column — then moved
 * up or down by up to SNAP px if that runs one of its lines straight into its box (the one
 * closest to straight). A cluster that
 * would come within GAP of the one above joins it, and the joined cluster is centered again,
 * which can make it join the one above that.
 */
function clusters(placed: Placed[]): Placed[][] {
  interface Cluster {
    items: Placed[];
    top: number;
    bottom: number;
    height: number;
    y: number;
  }
  const at = (c: Cluster) => {
    let y = (c.top + c.bottom) / 2 - c.height / 2;
    let snap = Infinity;
    let off = 0;
    for (const p of c.items) {
      const d = p.line - (y + off + p.height / 2);
      if (Math.abs(d) < Math.abs(snap)) snap = d;
      off += p.height + GAP;
    }
    if (Math.abs(snap) <= SNAP) y += snap;
    return Math.max(GAP, y);
  };
  const out: Cluster[] = [];
  for (const p of placed) {
    let c: Cluster = { items: [p], top: p.line, bottom: p.line, height: p.height, y: 0 };
    c.y = at(c);
    for (let prev = out[out.length - 1]; prev && c.y < prev.y + prev.height + GAP; prev = out[out.length - 1]) {
      out.pop();
      c = {
        items: [...prev.items, ...c.items],
        top: Math.min(prev.top, c.top),
        bottom: Math.max(prev.bottom, c.bottom),
        height: prev.height + GAP + c.height,
        y: 0,
      };
      c.y = at(c);
    }
    out.push(c);
  }
  for (const c of out) {
    let y = c.y;
    for (const p of c.items) {
      p.y = y;
      y += p.height + GAP;
    }
  }
  return out.map((c) => c.items);
}
