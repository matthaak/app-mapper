import { h } from '../widget';
import { NxWidget, glyph } from './base';
import { NxScroller, NxScrollView, type NxScrollViewOptions } from './scroll';

// ---------------------------------------------------------------------------------------
// List

export interface NxListItem {
  label: string;
  /** Right-aligned text, e.g. an unread count. */
  detail?: string;
  /** Small blue dot after the detail. */
  dot?: boolean;
  /** Shows ▷: selecting it leads somewhere (browser branch). */
  branch?: boolean;
  disabled?: boolean;
}

export interface NxListOptions {
  items?: NxListItem[];
  selected?: number;
  onSelect?: (index: number, item: NxListItem) => void;
  /** Double-click or Enter. */
  onOpen?: (index: number, item: NxListItem) => void;
  scroll?: NxScrollViewOptions;
}

/** A cell's height when none is shown yet (the theme's stylesheet sets the real one). */
const CELL = 15;

/** The height of `rows`' first row as drawn (rows are all one height), else `fallback`. */
function rowHeight(rows: HTMLElement, fallback: number): number {
  return (rows.firstElementChild as HTMLElement | null)?.offsetHeight || fallback;
}

/** A scrolling single-selection list of text cells; the selected cell is white. */
export class NxList extends NxWidget<HTMLDivElement> {
  readonly scrollView: NxScrollView;
  private readonly cells: HTMLDivElement;
  private items: NxListItem[] = [];
  private index = -1;
  private readonly opts: NxListOptions;

  constructor(o: NxListOptions = {}) {
    super(h('div', { role: 'listbox', tabIndex: 0 }), 'nx-list');
    this.opts = o;
    this.cells = h('div', { className: 'nx-cells' });
    this.scrollView = new NxScrollView({ ...o.scroll, content: this.cells });
    this.scrollView.mount(this);
    this.setItems(o.items ?? [], o.selected ?? -1);

    this.cells.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const i = this.cellIndex(e);
      if (i >= 0) this.select(i, true);
      // Dragging through the list moves the selection, as in NeXT matrices.
      const move = (ev: PointerEvent) => {
        const j = this.cellIndex(ev);
        if (j >= 0 && j !== this.index) this.select(j, true);
      };
      this.cells.addEventListener('pointermove', move);
      addEventListener('pointerup', () => this.cells.removeEventListener('pointermove', move), { once: true });
    });
    this.cells.addEventListener('dblclick', (e) => {
      const i = this.cellIndex(e);
      if (i >= 0) this.opts.onOpen?.(i, this.items[i]);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.select(Math.min(this.items.length - 1, Math.max(0, this.index + (e.key === 'ArrowDown' ? 1 : -1))), true);
      } else if (e.key === 'Enter' && this.index >= 0) this.opts.onOpen?.(this.index, this.items[this.index]);
    });
  }

  get selectedIndex(): number {
    return this.index;
  }
  get selectedItem(): NxListItem | undefined {
    return this.items[this.index];
  }

  setItems(items: NxListItem[], selected = -1): void {
    this.items = items;
    this.cells.replaceChildren(
      ...items.map((it) => {
        const c = h('div', { className: 'nx-cell', role: 'option' });
        c.append(h('span', { className: 'label', textContent: it.label }));
        if (it.detail) c.append(h('span', { className: 'detail', textContent: it.detail }));
        if (it.dot) c.append(h('span', { className: 'dot' }));
        if (it.branch) c.append(glyph.branch());
        c.classList.toggle('disabled', !!it.disabled);
        return c;
      }),
    );
    this.index = -1;
    this.select(selected, false);
  }

  /** Selects cell `i` (−1 clears). */
  select(i: number, notify = false): void {
    if (i >= 0 && this.items[i]?.disabled) return;
    this.cells.children[this.index]?.classList.remove('selected');
    this.index = i >= 0 && i < this.items.length ? i : -1;
    if (this.index < 0) return;
    this.cells.children[this.index].classList.add('selected');
    const hgt = rowHeight(this.cells, CELL);
    this.scrollView.reveal(this.index * hgt, (this.index + 1) * hgt);
    if (notify) this.opts.onSelect?.(this.index, this.items[this.index]);
  }

  private cellIndex(e: MouseEvent): number {
    const r = this.cells.getBoundingClientRect();
    const i = Math.floor((e.clientY - r.top) / rowHeight(this.cells, CELL));
    return i >= 0 && i < this.items.length ? i : -1;
  }
}

// ---------------------------------------------------------------------------------------
// Browser

export interface NxBrowserNode {
  name: string;
  /** Present (even if empty) for branches. */
  children?: NxBrowserNode[];
}

export interface NxBrowserOptions {
  root: NxBrowserNode;
  /** Number of columns shown side by side. */
  columns?: number;
  /** Initial selection as names from the root, e.g. ['paul', 'Adv.NetInfo.rtf']. */
  path?: string[];
  /** A horizontal scroller above the columns, for paths deeper than `columns`. */
  scroller?: boolean;
  onSelect?: (path: NxBrowserNode[]) => void;
  onOpen?: (path: NxBrowserNode[]) => void;
}

/**
 * A NeXT column browser: each column lists one level of the tree; selecting a branch opens
 * the next column to the right. Every column scrolls on its own (scroller on the left).
 *
 * The columns stay put as you click: only when the newly opened column would be past the
 * right edge do they slide over one, briefly animated. A horizontal swipe (or Shift-wheel)
 * scrolls them, settling on a column when it stops.
 */
export class NxBrowser extends NxWidget<HTMLDivElement> {
  private readonly columnsEl: HTMLDivElement;
  private readonly strip: HTMLDivElement;
  private readonly scroller?: NxScroller;
  private readonly visible: number;
  private readonly root: NxBrowserNode;
  private readonly opts: NxBrowserOptions;
  /** Selected node per level. */
  private path: NxBrowserNode[] = [];
  private readonly lists = new Map<NxBrowserNode, NxList>();
  /** The column elements laid out (levels, then fillers). */
  private cols: HTMLDivElement[] = [];
  /** The leftmost column shown, in columns: fractional mid-swipe or mid-slide. */
  private pos = 0;
  /** Where a slide is heading (null when none is under way). */
  private target: number | null = null;
  private frame = 0;
  private settleTimer = 0;
  /** The axis the current wheel gesture is locked to, and when it last moved. */
  private swipe: { axis: 'x' | 'y'; at: number } | null = null;

  constructor(o: NxBrowserOptions) {
    super(h('div'), 'nx-browser');
    this.opts = o;
    this.root = o.root;
    this.visible = o.columns ?? 3;
    if (o.scroller ?? true) {
      this.scroller = new NxScroller({
        orientation: 'horizontal',
        step: 1,
        onScroll: (v) => {
          this.stop();
          this.setPos(Math.round(v));
        },
      });
      this.scroller.mount(this);
    }
    this.columnsEl = h('div', { className: 'nx-columns' });
    this.strip = h('div', { className: 'nx-strip' });
    this.strip.style.setProperty('--nx-browser-columns', String(this.visible));
    this.columnsEl.append(this.strip);
    this.el.append(this.columnsEl);
    // Captured, so a sideways swipe over a column moves the columns rather than its list.
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    new ResizeObserver(() => this.place()).observe(this.columnsEl);

    let node = this.root;
    for (const name of o.path ?? []) {
      const next = node.children?.find((c) => c.name === name);
      if (!next) break;
      this.path.push(next);
      node = next;
    }
    this.render('end');
  }

  /** The selected nodes from the root down. */
  get selection(): NxBrowserNode[] {
    return [...this.path];
  }

  /** Selects the nodes named by `path` from the root (as far as they exist), scrolled to show the last. Doesn't call onSelect. */
  show(path: string[]): void {
    const nodes: NxBrowserNode[] = [];
    let node = this.root;
    for (const name of path) {
      const next = node.children?.find((c) => c.name === name);
      if (!next) break;
      nodes.push(next);
      node = next;
    }
    this.path = nodes;
    this.render('reveal');
  }

  /**
   * Re-reads `node`'s children (every branch's, without an argument), e.g. after they were
   * loaded lazily into its `children` array. Selections that no longer exist are dropped.
   */
  refresh(node?: NxBrowserNode): void {
    for (const [n, list] of this.lists) {
      if (node && n !== node) continue;
      list.destroy();
      this.lists.delete(n);
    }
    // Keep the selected path only as far as it still exists.
    let parent = this.root;
    const kept: NxBrowserNode[] = [];
    for (const n of this.path) {
      if (!parent.children?.includes(n)) break;
      kept.push(n);
      parent = n;
    }
    this.path = kept;
    this.render('stay');
  }

  /** Column parents: root, then each selected branch. */
  private get parents(): NxBrowserNode[] {
    const out = [this.root];
    for (const n of this.path) if (n.children) out.push(n);
    return out;
  }

  /** Width of one column, in px. */
  private get columnWidth(): number {
    return this.columnsEl.clientWidth / this.visible;
  }

  private get maxPos(): number {
    return Math.max(0, this.cols.length - this.visible);
  }

  /**
   * Lays the columns out again. 'end' shows the deepest column at the right, at once;
   * 'reveal' slides over (animated) only if the deepest column is past the right edge;
   * 'stay' leaves the columns where they are.
   */
  private render(how: 'end' | 'reveal' | 'stay'): void {
    const parents = this.parents;
    const levels = parents.length;
    if (how === 'end') {
      this.stop();
      this.pos = Math.max(0, levels - this.visible);
    }
    const at = this.target ?? this.pos;
    // Never pull the columns back: past the last level, the ones in view stay as fillers.
    const count = Math.max(this.visible, levels, Math.ceil(at - 1e-6) + this.visible);

    // Forget lists for levels that no longer exist.
    for (const [node, list] of this.lists) {
      if (!parents.includes(node)) {
        list.destroy();
        this.lists.delete(node);
      }
    }
    // Columns are kept and only their contents swapped, so each list keeps its scroll position.
    for (let level = 0; level < count; level++) {
      let col = this.cols[level];
      if (!col) {
        col = h('div', { className: 'nx-column' });
        this.cols.push(col);
        this.strip.append(col);
      }
      const parent = parents[level];
      const content = parent ? this.listFor(parent, level).el : null;
      col.classList.toggle('filler', !content);
      if (content) {
        if (col.firstChild !== content) col.replaceChildren(content);
      } else if (col.firstChild) col.replaceChildren();
    }
    for (const col of this.cols.splice(count)) col.remove();
    this.scroller?.setRange(count, this.visible);
    this.place();
    for (const list of this.lists.values()) list.scrollView.refresh();

    if (how === 'reveal' && levels > at + this.visible) this.slideTo(levels - this.visible);
  }

  /** Drops filler columns past the right edge that are no longer in view. */
  private trim(): void {
    const keep = Math.max(this.visible, this.parents.length, Math.ceil(this.pos - 1e-6) + this.visible);
    if (keep >= this.cols.length) return;
    for (const col of this.cols.splice(keep)) col.remove();
    this.scroller?.setRange(this.cols.length, this.visible);
    this.place();
  }

  private setPos(p: number): void {
    this.pos = Math.min(this.maxPos, Math.max(0, p));
    this.place();
  }

  private place(): void {
    this.strip.style.transform = `translateX(${-this.pos * this.columnWidth}px)`;
    if (this.scroller) this.scroller.offset = this.pos;
  }

  /** Slides to column `to` over 250ms (ease-out), then drops fillers out of view. */
  private slideTo(to: number): void {
    this.stop();
    to = Math.min(this.maxPos, Math.max(0, to));
    if (to === this.pos) return this.trim();
    const from = this.pos;
    const start = performance.now();
    this.target = to;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 250);
      this.setPos(from + (to - from) * (1 - (1 - t) ** 3));
      if (t < 1) {
        this.frame = requestAnimationFrame(step);
        return;
      }
      this.frame = 0;
      this.target = null;
      this.trim();
    };
    this.frame = requestAnimationFrame(step);
  }

  /** Ends a slide where it is. */
  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.target !== null) this.setPos(this.target);
    this.target = null;
    clearTimeout(this.settleTimer);
  }

  private onWheel(e: WheelEvent): void {
    const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
    const dy = e.shiftKey ? 0 : e.deltaY;
    // A gesture keeps the axis it started on (trackpad swipes wobble), until it pauses.
    if (!this.swipe || e.timeStamp - this.swipe.at > 200) {
      if (dx === 0 && dy === 0) return;
      this.swipe = { axis: Math.abs(dx) > Math.abs(dy) ? 'x' : 'y', at: e.timeStamp };
    }
    this.swipe.at = e.timeStamp;
    if (this.swipe.axis !== 'x') return;
    e.preventDefault();
    e.stopPropagation();
    const w = this.columnWidth;
    if (!w || this.maxPos === 0) return;
    if (this.frame) this.stop();
    const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? dx * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? dx * w : dx;
    this.setPos(this.pos + px / w);
    clearTimeout(this.settleTimer);
    // Once the swipe (and its momentum) stops, settle on the nearest column.
    this.settleTimer = window.setTimeout(() => this.slideTo(Math.round(this.pos)), 120);
  }

  private listFor(parent: NxBrowserNode, level: number): NxList {
    const kids = parent.children ?? [];
    const sel = this.path[level] ? kids.indexOf(this.path[level]) : -1;
    let list = this.lists.get(parent);
    if (!list) {
      list = new NxList({
        scroll: { border: 'none' },
        onSelect: (i) => {
          this.path = [...this.path.slice(0, level), kids[i]];
          this.render('reveal');
          this.opts.onSelect?.(this.selection);
        },
        onOpen: () => this.opts.onOpen?.(this.selection),
      });
      list.setItems(kids.map((k) => ({ label: k.name, branch: !!k.children })));
      this.lists.set(parent, list);
    }
    if (list.selectedIndex !== sel) list.select(sel);
    return list;
  }
}

// ---------------------------------------------------------------------------------------
// Table

export interface NxTableColumn {
  /** CSS width; the last column always takes the remaining space. */
  width?: string;
  align?: 'left' | 'right' | 'center';
}

export interface NxTableRow {
  cells: string[];
  /** Mark drawn in the narrow leading gutter (e.g. a status triangle). */
  flag?: string;
  /** Lavender highlight (part of a multiple selection). */
  marked?: boolean;
}

export interface NxTableOptions {
  columns: NxTableColumn[];
  rows: NxTableRow[];
  selected?: number;
  onSelect?: (index: number, row: NxTableRow) => void;
  scroll?: NxScrollViewOptions;
}

const ROW = 17;

/**
 * A multi-column row list (like Mail's message list). Click selects (white);
 * Shift/⌘-click adds rows to a lavender multiple selection.
 */
export class NxTable extends NxWidget<HTMLDivElement> {
  readonly scrollView: NxScrollView;
  private readonly rowsEl: HTMLDivElement;
  private rows: NxTableRow[] = [];
  private index = -1;
  private readonly opts: NxTableOptions;

  constructor(o: NxTableOptions) {
    super(h('div', { role: 'grid', tabIndex: 0 }), 'nx-table');
    this.opts = o;
    this.rowsEl = h('div', { className: 'nx-rows' });
    this.scrollView = new NxScrollView({ ...o.scroll, content: this.rowsEl });
    this.scrollView.mount(this);
    this.setRows(o.rows, o.selected ?? -1);

    this.rowsEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = this.rowsEl.getBoundingClientRect();
      const i = Math.floor((e.clientY - r.top) / rowHeight(this.rowsEl, ROW));
      if (i < 0 || i >= this.rows.length) return;
      if (e.shiftKey || e.metaKey) this.toggleMarked(i);
      else this.select(i, true);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      this.select(Math.min(this.rows.length - 1, Math.max(0, this.index + (e.key === 'ArrowDown' ? 1 : -1))), true);
    });
  }

  get selectedIndex(): number {
    return this.index;
  }

  setRows(rows: NxTableRow[], selected = -1): void {
    this.rows = rows;
    this.rowsEl.replaceChildren(...rows.map((row) => this.rowEl(row)));
    this.index = -1;
    this.select(selected);
  }

  select(i: number, notify = false): void {
    this.rowsEl.children[this.index]?.classList.remove('selected');
    this.index = i >= 0 && i < this.rows.length ? i : -1;
    if (this.index < 0) return;
    this.rowsEl.children[this.index].classList.add('selected');
    const hgt = rowHeight(this.rowsEl, ROW);
    this.scrollView.reveal(this.index * hgt, (this.index + 1) * hgt);
    if (notify) this.opts.onSelect?.(this.index, this.rows[this.index]);
  }

  private toggleMarked(i: number): void {
    const row = this.rows[i];
    row.marked = !row.marked;
    this.rowsEl.children[i].classList.toggle('marked', row.marked);
  }

  private rowEl(row: NxTableRow): HTMLDivElement {
    const el = h('div', { className: 'nx-row', role: 'row' });
    el.classList.toggle('marked', !!row.marked);
    el.append(h('span', { className: 'flag', textContent: row.flag ?? '' }));
    row.cells.forEach((text, c) => {
      const col = this.opts.columns[c] ?? {};
      const cell = h('span', { textContent: text });
      if (col.width) cell.style.width = col.width;
      if (col.align) cell.style.justifyContent = { left: 'flex-start', right: 'flex-end', center: 'center' }[col.align];
      el.append(cell);
    });
    return el;
  }
}

// ---------------------------------------------------------------------------------------
// Text view

export interface NxTextViewOptions {
  text?: string;
  editable?: boolean;
  scroll?: NxScrollViewOptions;
}

/** White scrolling text (selectable; editable if asked). */
export class NxTextView extends NxWidget<HTMLDivElement> {
  readonly scrollView: NxScrollView;
  readonly textEl: HTMLDivElement;

  constructor(o: NxTextViewOptions = {}) {
    super(h('div'), 'nx-textview');
    this.textEl = h('div', { className: 'nx-text', textContent: o.text ?? '' });
    this.textEl.contentEditable = String(!!o.editable);
    this.textEl.spellcheck = false;
    this.textEl.addEventListener('keydown', (e) => e.stopPropagation());
    this.textEl.addEventListener('input', () => this.scrollView.refresh());
    this.scrollView = new NxScrollView({ border: 'line', ...o.scroll, content: this.textEl });
    this.scrollView.mount(this);
  }

  get text(): string {
    return this.textEl.textContent ?? '';
  }
  set text(v: string) {
    this.textEl.textContent = v;
    this.scrollView.refresh();
  }
}
