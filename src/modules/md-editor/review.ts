/**
 * The review column: as in Word's review mode, a column down the right of the document (a
 * quarter of the editor's width) where every highlight, addition and deletion with notes, and
 * every anchored comment, shows as a grey box, at all times, in Visual and in Raw. Boxes scroll with the text.
 *
 * Each box is tied to its text by a dotted line: along the bottom of the text's last line, out to
 * 15px short of the column (where it would turn), then across into the middle of the box's left
 * side. A box is centered on its line, so the line runs straight in. Boxes that would crowd each
 * other form a cluster, stacked in the text's order, and the cluster is centered between its top
 * and bottom lines (where they leave the text); lines then turn up or down to their boxes, and
 * lines whose turns would run over each other turn a little further out.
 *
 * A click on a box (for someone who can comment) opens a field in it to comment or reply; Return
 * sends and keeps the field for more, Escape or a click elsewhere closes it. An open pending
 * change's box has Accept and Reject buttons at its foot, a pending comment's Accept; a completed
 * mark's box (a change accepted or rejected, a comment accepted) shows Purge at its top right
 * while pointed at or open, and its line only then. A new highlight or comment opens its box
 * straight away, with a button there to cancel it. The column shows only while it has boxes.
 */
import { NxButton, h } from '../widgets';
import { formatStamp, isVerdict, noteList, shownComment } from './notes';
import type { Mark } from './parse';

/** Identifies a mark across edits: by its first attribution, or (without one) by its text. */
function markKey(md: string, m: Mark): string {
  const n = m.notes[0];
  return n ? `${m.kind}|${n.author}|${n.stamp ?? ''}|${n.comment ?? ''}` : `${m.kind}||${md.slice(m.body, m.end)}`;
}

/**
 * Each mark's key (see markKey), made unique: a mark that shares one with marks before it (the
 * same author's changes in the same second, say) gets `#2`, `#3`, … in the order they come.
 */
export function markKeys(md: string, marks: readonly Mark[]): string[] {
  const seen = new Map<string, number>();
  const keys = marks.map((m) => {
    if (m.group !== undefined) return '';
    const key = markKey(md, m);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n > 1 ? `${key}#${n}` : key;
  });
  // A run's marks have its last one's key: one box for them all (see Mark.group).
  return marks.map((m, k) => (m.group === undefined ? keys[k] : keys[m.group]));
}

/** The mark with `key` (of a run, its last: the one with the thread), if there is one. */
export function markOf(md: string, marks: readonly Mark[], key: string): Mark | undefined {
  const m = marks[markKeys(md, marks).indexOf(key)];
  return m?.group === undefined ? m : marks[m.group];
}

/** Mark `i`'s key. */
export const keyOf = (md: string, marks: readonly Mark[], i: number): string => markKeys(md, marks)[i];

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
  /** An author's colour, if they have one. */
  noteColor(author: string): string | null;
  /** Mark `i`'s text is pointed at, here or in its box (null: none is): shades it. */
  hover(i: number | null): void;
  /**
   * Accepts or rejects the mark with `key`, as Accept and Reject do — with `comment`, if one is
   * given, in the verdict's note; returns its key after (null if it went).
   */
  resolve(key: string, accept: boolean, comment?: string): string | null;
  /** Purges the completed mark with `key`, as Purge does; returns its key after (null: it went). */
  purge(key: string): string | null;
  /** The box of the mark with `key` was opened (null: the open box closed). */
  opened(key: string | null): void;
  /** Takes away the new highlight or comment with `key` (its box was cancelled). */
  cancel(key: string): void;
  /** Whether the view has a review column at all (Preview hasn't): it shows while it has boxes. */
  enabled(): boolean;
  /** Whether mark `m` (a run's last) has a box in this view (Hide Completed hides completed ones'). */
  visible(m: Mark): boolean;
  /** Adds the user's `text` to the thread of the mark with `key`; returns the mark's key after. */
  comment(key: string, text: string): string | null;
  /** Changes note `index` of the mark with `key` to say `text`; returns the mark's key after (null if it went). */
  edit(key: string, index: number, text: string): string | null;
  /** Whether comment fields check spelling. */
  spellcheck(): boolean;
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
/** How long (ms) a box takes to open or close, and the others to make way. */
const ANIMATION = 250;
/** The box buttons' glyphs (16px, drawn at 12): Accept and Reject as on the toolbar, and Cancel. */
export const ACCEPT_GLYPH = '<path d="M2.5 8.5l3.5 4L13.5 3" fill="none" stroke="currentColor" stroke-width="1.8"/>';
export const REJECT_GLYPH = '<circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.9 3.9l8.2 8.2" stroke="currentColor" stroke-width="1.6"/>';
/** A trash can: Purge. */
const TRASH = (fill: string) =>
  `<path d="M3.5 4.5l.9 9.5h7.2l.9-9.5" fill="${fill}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 4.5h12M6 4.5V2.5h4v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.6 6.8v4.8M9.4 6.8v4.8" stroke="currentColor" stroke-width="1.1"/>`;
export const PURGE_GLYPH = TRASH('none');
/** Two trash cans, one behind the other: Purge All. */
export const PURGE_ALL_GLYPH = `<g transform="translate(5 0) scale(0.7)">${TRASH('none')}</g><g transform="translate(0 4.2) scale(0.74)">${TRASH('#fff')}</g>`;
const CANCEL_GLYPH = '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.8"/>';

interface Item {
  key: string;
  el: HTMLDivElement;
  /** Its buttons, top right: Accept and Reject (pending), Purge (completed), Cancel (a new mark's). */
  tools: HTMLDivElement;
  body: HTMLDivElement;
  /** The line to the text and its bump. */
  link: SVGGElement;
  /** What the box shows now, to redraw it only when that changes. */
  shown: string;
  /** As last laid out: its centre and where its line leaves the text (in the column's coordinates, unrounded). */
  mid?: number;
  line?: number;
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
  /**
   * The box with the comment field open; `fresh` while it is a new mark's with nothing sent yet;
   * `resting` once a comment was sent from it, its field read-only until clicked.
   */
  private active: { key: string; field: ReplyField; fresh: boolean; resting: boolean } | null = null;
  /** The note being edited, in the open box. */
  private editing: { key: string; index: number; el: HTMLElement; was: string; made: boolean } | null = null;
  /** Each mark's key, by its index (as of the last layout). */
  private keyAt: string[] = [];
  /** The mark whose text the pointer is over: its line is lit. */
  private pointed: string | null = null;
  private frame = 0;
  /** Where each box was before a box opened or closed: the next layout animates from there. */
  private before: Map<Item, { top: number; height: number }> | null = null;
  private animation = 0;
  /** A box just opened: its centre before it did (it opens about it). */
  private opening: { key: string; centre: number } | null = null;
  /** The open box's top, where it opened: it stays there while open, the others making way. */
  private anchor: { key: string; top: number } | null = null;

  constructor(
    private readonly host: ReviewHost,
    /** The document's scroller, which the column and lines scroll with. */
    private readonly scroller: HTMLElement,
  ) {
    // (`nx`: the theme's colours reach the column wherever the editor is placed.)
    this.el = h('div', { className: 'md-review nx' });
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
    clearTimeout(this.animation);
    this.animation = 0;
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
    this.host.hover(key === null ? null : this.leadOf(key));
    const item = key ? this.items.get(key) : null;
    if (!item) return;
    item.link.classList.add('lit');
    this.svg.append(item.link);
  }

  /** The index of the mark with `key` (a run's last), as of the last layout. */
  private leadOf(key: string): number | null {
    const { marks } = this.host.marks();
    const k = this.keyAt.findIndex((x, i) => x === key && marks[i]?.group === undefined);
    return k < 0 ? null : k;
  }

  /** Opens the box of the new mark with `key` for its comment, with a button to cancel it. */
  openNew(key: string): void {
    this.layout();
    const item = this.items.get(key);
    if (!item) return;
    this.open(item, true);
  }

  /** Places every box and draws its line. */
  layout(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { md, marks } = this.host.marks();
    const user = this.host.user;
    const keys = markKeys(md, marks);
    this.keyAt = keys;
    // (A run shows as its last mark, the one with the thread.)
    const wanted = marks
      .map((m, i) => ({ m, i, key: keys[i] }))
      .filter((x) => x.m.group === undefined && (user || x.m.notes.length) && this.host.visible(x.m));

    // Shown while it has boxes to show: set first, as it narrows the text.
    const open = this.host.enabled() && wanted.length > 0;
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
      if (this.editing?.key === key) this.editing = null;
      if (this.pointed === key) this.pointed = null;
      if (this.active?.key === key) {
        // (Its mark went, or was completed with Hide Completed on.)
        this.active = null;
        this.host.opened(null);
      }
    }
    if (!placed.length) {
      this.el.style.minHeight = '';
      this.before = null;
      return;
    }

    this.settle();
    this.alignField();
    for (const p of placed) p.height = p.item.el.offsetHeight;
    // In the text's order: by where their lines leave it, then (on the same line) left to right.
    placed.sort((a, b) => a.line - b.line || a.ext.last.left - b.ext.last.left);
    clusters(placed);
    this.pin(placed);
    let end = 0;
    for (const p of placed) {
      p.item.el.style.top = `${p.y}px`;
      p.item.mid = p.y + p.height / 2;
      p.item.line = p.line;
      end = Math.max(end, p.y + p.height);
    }
    // Room below the last box, so the document scrolls far enough to show it (a minimum: the
    // column still stretches, grey, to the bottom of a longer document).
    this.el.style.minHeight = `max(100cqh, ${end + GAP}px)`;
    const before = this.before;
    this.before = null;
    if (before) this.animate(placed, before);
    else this.draw(placed);
  }

  /**
   * Keeps the open box where it opened — centred on where it was, so it grows up and down from
   * there, and the page doesn't move — and moves the others out of its way: those above it up,
   * those below it down.
   */
  private pin(placed: Placed[]): void {
    const a = this.active;
    const k = a ? placed.findIndex((p) => p.item.key === a.key) : -1;
    if (!a || k < 0) {
      this.anchor = null;
      return;
    }
    const p = placed[k];
    // (Unrounded: a box whose line ran straight in keeps it straight.)
    if (this.opening?.key === a.key) this.anchor = { key: a.key, top: Math.max(0, this.opening.centre - p.height / 2) };
    this.opening = null;
    if (this.anchor?.key !== a.key) return;
    // Those above it go up out of its way — unless there is no room above, when it opens lower,
    // by as little as it must.
    const was = placed.map((x) => x.y);
    const above = (top: number) => {
      p.y = top;
      for (let i = k - 1; i >= 0; i--) placed[i].y = Math.min(was[i], placed[i + 1].y - GAP - placed[i].height);
      return k > 0 ? placed[0].y : 0;
    };
    const short = above(this.anchor.top);
    if (short < 0) {
      this.anchor.top -= short;
      above(this.anchor.top);
    }
    // Those below it go down out of its way.
    for (let i = k + 1; i < placed.length; i++) placed[i].y = Math.max(was[i], placed[i - 1].y + placed[i - 1].height + GAP);
  }

  /**
   * Lines the open box's comment field up with its last note: its edges where that note's
   * comment's outline is when edited (`--md-edit-out` outside it), indented as the note is.
   */
  private alignField(): void {
    const a = this.active;
    const item = a && this.items.get(a.key);
    const notes = item?.body.querySelectorAll<HTMLElement>('.md-note');
    const last = notes?.[notes.length - 1];
    const foot = a?.field.el.parentElement;
    if (!a || !last || !foot) return;
    const out = parseFloat(getComputedStyle(a.field.el).getPropertyValue('--md-edit-out')) || 0;
    const [n, f] = [last.getBoundingClientRect(), foot.getBoundingClientRect()];
    a.field.el.style.marginLeft = `${n.left - f.left - out}px`;
    a.field.el.style.marginRight = `${f.right - n.right - out}px`;
    a.field.measure();
  }

  /** Ends an animation still running (see animate): every box where it is going, the lines shown. */
  private settle(): void {
    if (!this.animation) return;
    clearTimeout(this.animation);
    this.animation = 0;
    for (const item of this.items.values()) item.el.style.transition = item.el.style.transform = item.el.style.height = item.el.style.overflow = '';
    this.svg.style.visibility = '';
  }

  /** Notes where every box is now, for the next layout to animate from (the first caller's, if several). */
  private snapshot(): void {
    if (this.before) return;
    this.before = new Map([...this.items.values()].map((item) => [item, { top: item.el.offsetTop, height: item.el.offsetHeight }]));
  }

  /**
   * Moves the boxes from where they were (`before`) to where they are now: a box that opened or
   * closed grows or shrinks, the others slide out of its way — those on screen; the rest just
   * go. The lines are drawn again once they are there.
   */
  private animate(placed: Placed[], before: Map<Item, { top: number; height: number }>): void {
    const view = this.scroller.getBoundingClientRect();
    const top0 = this.el.getBoundingClientRect().top;
    const seen = (y: number, height: number) => y + height > view.top - top0 && y < view.bottom - top0;
    const moving: { el: HTMLElement; height: number | null }[] = [];
    for (const p of placed) {
      const b = before.get(p.item);
      if (!b || (b.top === p.y && b.height === p.height) || (!seen(b.top, b.height) && !seen(p.y, p.height))) continue;
      const el = p.item.el;
      el.style.transition = 'none';
      el.style.transform = `translateY(${b.top - p.y}px)`;
      const grows = b.height !== p.height;
      if (grows) {
        el.style.height = `${b.height}px`;
        el.style.overflow = 'hidden';
      }
      moving.push({ el, height: grows ? p.height : null });
    }
    if (!moving.length) return this.draw(placed);
    this.svg.style.visibility = 'hidden';
    void this.el.offsetHeight; // (from where they were)
    for (const { el, height } of moving) {
      el.style.transition = `transform ${ANIMATION}ms ease, height ${ANIMATION}ms ease`;
      el.style.transform = '';
      if (height !== null) el.style.height = `${height}px`;
    }
    this.animation = window.setTimeout(() => this.layout(), ANIMATION);
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
    const tools = h('div', { className: 'md-review-tools' });
    const tool = (cls: string, title: string, glyph: string, act: () => void) => {
      const b = h('button', { type: 'button', className: `md-review-tool ${cls}`, title });
      b.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">${glyph}</svg>`;
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        act();
      });
      tools.append(b);
    };
    tool('accept', 'Accept', ACCEPT_GLYPH, () => this.resolve(item, true));
    tool('reject', 'Reject change', REJECT_GLYPH, () => this.resolve(item, false));
    tool('purge', 'Purge: remove its markup and history', PURGE_GLYPH, () => this.rekey(item.key, this.host.purge(item.key)));
    tool('cancel', 'Cancel', CANCEL_GLYPH, () => this.cancel());
    el.append(tools);
    const item: Item = { key, el, tools, body, link, shown: '' };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.host.user) return;
      const t = e.target instanceof Element ? e.target : null;
      if (this.active?.key === item.key) {
        // Its field, resting after a comment was sent, is clicked: it takes the next one.
        if (this.active.resting && !this.editing && t?.closest('.md-review-input')) {
          e.preventDefault();
          this.active.resting = false;
          this.active.field.disabled = false;
          this.active.field.focus();
          return;
        }
        // In the open box, a note (anyone's) is edited where it is.
        const note = t?.closest('.md-note');
        if (!note || t?.closest('.nx-textfield, [contenteditable]')) return;
        e.preventDefault();
        this.editNote(item, Array.from(item.body.querySelectorAll('.md-note')).indexOf(note));
        return;
      }
      e.preventDefault();
      this.open(item);
    });
    el.addEventListener('mouseenter', () => {
      link.classList.add('hot');
      this.svg.append(link);
      this.host.hover(this.leadOf(item.key));
    });
    el.addEventListener('mouseleave', () => {
      link.classList.remove('hot');
      this.host.hover(this.pointed === null ? null : this.leadOf(this.pointed));
    });
    this.items.set(key, item);
    this.el.append(el);
    this.svg.append(link);
    return item;
  }

  /**
   * Shows the mark's thread in its box (when it changed). Closed, a box is two lines: the
   * author and date, then the start of the comment and how many replies follow; open, the whole
   * thread. (What kind of mark it is shows in the text itself.)
   */
  private fill(item: Item, m: Mark, color: string | null): void {
    // Not while one of its notes is being edited (that would take the field away).
    if (this.editing?.key === item.key) return;
    const open = this.active?.key === item.key;
    const sig = JSON.stringify([open, m.kind, color, m.verdict, m.notes.map((n) => [n.author, n.stamp, n.comment])]);
    if (sig === item.shown) return;
    item.shown = sig;
    for (const el of [item.el, item.link]) {
      if (color) el.style.setProperty('--md-change', color);
      else el.style.removeProperty('--md-change');
    }
    item.el.dataset.kind = m.kind;
    item.el.classList.toggle('resolved', !!m.verdict);
    // A completed mark's line shows only while its box (or text) is pointed at, or it is open.
    item.link.classList.toggle('done', !!m.verdict);
    item.el.classList.toggle('open', open);
    const noteColor = (a: string) => this.host.noteColor(a);
    const { md } = this.host.marks();
    // Without notes nobody signed it: say so, rather than show no one.
    if (!m.notes.length) {
      const line = h('div', { className: 'md-review-line' });
      line.append(...badges(m), h('span', { className: 'md-review-unsigned', textContent: 'Unsigned' }));
      item.body.replaceChildren(line);
    }
    else if (open) item.body.replaceChildren(noteList(m.notes, noteColor, { lead: badges(m), after: goneLine(m, md, 'div') }));
    else item.body.replaceChildren(...summary(m, md, noteColor));
    item.el.classList.toggle('single', !open && item.body.childElementCount === 1 && !item.body.querySelector('.md-notes'));
    if (open) this.setPlaceholder(m);
  }

  /** Opens the comment field in a box (closing any other). */
  private open(item: Item, fresh = false): void {
    const user = this.host.user;
    if (!user) return;
    this.snapshot();
    this.close();
    // Its centre exactly as laid out (offsetTop and offsetHeight are whole pixels), or, if its
    // line ran straight in, the line itself, so it still does.
    const straight = item.mid !== undefined && item.line !== undefined && Math.abs(item.mid - item.line) < 0.5;
    this.opening = { key: item.key, centre: straight ? item.line! : (item.mid ?? item.el.offsetTop + item.el.offsetHeight / 2) };
    const field = new ReplyField({
      spellcheck: this.host.spellcheck(),
      onCommit: (text) => this.send(text),
      onEscape: () => (this.active?.fresh ? this.cancel() : this.close()),
      // Growing, it makes the box taller: the boxes around it make room.
      onInput: () => this.schedule(),
    });
    const foot = h('div', { className: 'md-review-foot' });
    // A change's Accept and Reject (shown while it is open: see md-editor.css).
    const actions = h('div', { className: 'md-review-actions' });
    const icon = (glyph: string) => {
      const t = document.createElement('template');
      t.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">${glyph}</svg>`;
      return t.content.firstElementChild!;
    };
    new NxButton({ label: 'Accept', icon: icon(ACCEPT_GLYPH), title: 'Accept', onClick: () => this.resolve(item, true) }).mount(actions).el.classList.add('md-review-accept');
    new NxButton({ label: 'Reject', icon: icon(REJECT_GLYPH), title: 'Reject this change', onClick: () => this.resolve(item, false) }).mount(actions).el.classList.add('md-review-reject');
    // Cancel: closes the box, dropping a comment typed and not sent (a new mark's box: the mark too).
    new NxButton({ label: 'Cancel', title: 'Close, discarding what is typed', onClick: () => (this.active?.fresh ? this.cancel() : this.close()) }).mount(actions);
    foot.append(field.el, h('div', { className: 'md-review-who', textContent: `As ${user}` }), actions);
    item.el.append(foot);
    item.el.classList.add('active');
    item.el.classList.toggle('fresh', fresh);
    item.link.classList.add('active');
    this.active = { key: item.key, field, fresh, resting: false };
    item.shown = '';
    this.host.opened(item.key);
    const { md, marks } = this.host.marks();
    const m = markOf(md, marks, item.key);
    if (m) this.setPlaceholder(m);
    field.focus();
    this.layout();
  }

  private close(): void {
    this.stopEditing();
    const a = this.active;
    if (!a) return;
    this.snapshot();
    // A new comment anchored with nothing said is no comment: it goes (a new highlight stays).
    if (a.fresh && !a.field.value.trim()) {
      const { marks } = this.host.marks();
      const lead = this.leadOf(a.key);
      if (lead !== null && marks[lead]?.kind === 'comment') return this.cancel();
    }
    this.active = null;
    const item = this.items.get(a.key);
    item?.el.querySelector('.md-review-foot')?.remove();
    item?.el.classList.remove('active', 'fresh');
    item?.link.classList.remove('active');
    if (item) item.shown = '';
    this.host.opened(null);
    this.schedule();
  }

  /** The author's own change with no comment yet gets theirs; otherwise it's a reply. */
  private setPlaceholder(m: Mark): void {
    const first = m.notes[0];
    const reply = !!first && !(m.notes.length === 1 && !first.comment && first.author === this.host.user);
    if (this.active) this.active.field.placeholder = reply ? 'Reply…' : 'Comment…';
  }

  private send(text: string): void {
    const a = this.active;
    if (!a || !text.trim()) return;
    const next = this.host.comment(a.key, text);
    a.field.value = '';
    a.fresh = false;
    this.items.get(a.key)?.el.classList.remove('fresh');
    this.rekey(a.key, next);
    // Sent: the field rests, read-only, until clicked (or the box is opened again).
    a.resting = true;
    a.field.disabled = true;
    this.schedule();
  }

  /**
   * Accepts or rejects the box's mark (Accept and Reject at its foot) — with a comment typed in
   * its field and not yet sent, if there is one, in the verdict's note ("Accepted. …").
   */
  private resolve(item: Item, accept: boolean): void {
    const a = this.active;
    let comment = '';
    if (a?.key === item.key && !a.field.disabled && a.field.value.trim()) {
      comment = a.field.value;
      a.field.value = '';
    }
    this.rekey(item.key, this.host.resolve(item.key, accept, comment));
    this.schedule();
  }

  /** Cancels the open box's new mark (its Cancel button, or Escape): the mark goes. */
  private cancel(): void {
    const a = this.active;
    if (!a?.fresh) return;
    this.snapshot();
    this.active = null;
    const item = this.items.get(a.key);
    item?.el.querySelector('.md-review-foot')?.remove();
    item?.el.classList.remove('active', 'fresh');
    item?.link.classList.remove('active');
    if (item) item.shown = '';
    this.host.cancel(a.key);
    this.host.opened(null);
    this.schedule();
  }

  /**
   * The mark's key changed (its first note did, when its author first comments on it, or a
   * note of it was edited): the box (field and all) goes with it. Null: the mark went.
   */
  private rekey(from: string, to: string | null): void {
    if (to === from) return;
    if (to === null) return this.close();
    const item = this.items.get(from);
    this.items.delete(from);
    if (item) {
      item.key = to;
      this.items.set(to, item);
    }
    if (this.pointed === from) this.pointed = to;
    if (this.anchor?.key === from) this.anchor.key = to;
    if (this.active?.key === from) {
      this.active.key = to;
      this.host.opened(to);
    }
  }

  /**
   * Edits note `index` of the open box's mark where its comment is: the comment itself becomes
   * editable, at the same size, so the box keeps its height; the reply field is disabled
   * meanwhile. Return saves (as does leaving it), Escape leaves it as it was.
   */
  private editNote(item: Item, index: number): void {
    // One note at a time: the one being edited is saved first (and the box drawn afresh).
    if (this.editing) {
      this.saveNote(this.editing.el.innerText);
      this.layout();
    }
    const { md, marks } = this.host.marks();
    const n = markOf(md, marks, item.key)?.notes[index];
    const note = item.body.querySelectorAll('.md-note')[index];
    if (!n || !note) return;
    let el = note.querySelector<HTMLElement>('.md-note-text');
    const made = !el;
    if (!el) {
      el = h('div', { className: 'md-note-text' });
      note.append(el);
    }
    el.textContent = shownComment(n.comment ?? '');
    el.contentEditable = 'plaintext-only';
    el.spellcheck = this.host.spellcheck();
    note.classList.add('editing');
    const editing = { key: item.key, index, el, was: n.comment ?? '', made };
    this.editing = editing;
    const text = el;
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.saveNote(text.innerText);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.stopEditing();
        this.wakeField(true);
      }
    });
    // Growing, it makes the box taller: the boxes around it make room.
    text.addEventListener('input', () => this.schedule());
    text.addEventListener('blur', () => {
      if (this.editing === editing) this.saveNote(text.innerText);
    });
    if (this.active) this.active.field.disabled = true;
    text.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(text);
    r.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
  }

  /** A note is no longer edited: the field is back as it was — taking comments (focused, with `focus`), or resting. */
  private wakeField(focus: boolean): void {
    const a = this.active;
    if (!a) return;
    a.field.disabled = a.resting;
    if (focus && !a.resting) a.field.focus();
  }

  /** Saves the note being edited as `text` (emptied, a reply goes). */
  private saveNote(text: string): void {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    this.wakeField(true);
    const item = this.items.get(e.key);
    if (item) item.shown = '';
    this.rekey(e.key, this.host.edit(e.key, e.index, text));
    this.schedule();
  }

  /** Stops editing a note, unchanged: it is read-only again, as it was. */
  private stopEditing(): void {
    const e = this.editing;
    if (!e) return;
    this.editing = null;
    e.el.removeAttribute('contenteditable');
    e.el.closest('.md-note')?.classList.remove('editing');
    if (e.made) e.el.remove();
    else e.el.textContent = shownComment(e.was);
    this.wakeField(false);
    const item = this.items.get(e.key);
    if (item) item.shown = '';
    this.schedule();
  }

  private readonly onOutside = (e: Event) => {
    const t = e.target;
    const item = this.active && this.items.get(this.active.key);
    // (The toolbar acts on the open box's change: see act.)
    if (item && t instanceof Node && !item.el.contains(t) && !(t instanceof Element && t.closest('.md-toolbar'))) this.close();
  };

  /** The key of the mark whose box is open, if one is. */
  openKey(): string | null {
    return this.active?.key ?? null;
  }

  /** Whether the open box is a new mark's, nothing sent in it yet. */
  openFresh(): boolean {
    return !!this.active?.fresh;
  }

  /** Accepts, rejects or purges the open box's mark (from the toolbar); false if no box is open. */
  act(what: 'accept' | 'reject' | 'purge'): boolean {
    const item = this.active && this.items.get(this.active.key);
    if (!item) return false;
    if (what === 'purge') this.rekey(item.key, this.host.purge(item.key));
    else this.resolve(item, what === 'accept');
    return true;
  }
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

/** A completed mark's verdict, leading its box: the toolbar's check or no-entry sign, in its author's colour. None for a pending one. */
function badges(m: Mark): Node[] {
  if (!m.verdict) return [];
  const verdict = h('span', { className: `md-review-badge ${m.verdict}`, title: m.verdict === 'accepted' ? 'Accepted' : 'Rejected' });
  verdict.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">${m.verdict === 'accepted' ? ACCEPT_GLYPH : REJECT_GLYPH}</svg>`;
  return [verdict];
}

/** The text a resolved change took out of view — an accepted deletion's, a rejected addition's — as "Deleted: …" / "Added: …"; null for any other. */
function goneLine(m: Mark, md: string, tag: 'div' | 'span'): HTMLElement | null {
  const gone = m.verdict === (m.kind === 'strike' ? 'accepted' : 'rejected');
  if (!m.verdict || !gone || (m.kind !== 'strike' && m.kind !== 'underline')) return null;
  const text = md
    .slice(m.body, m.end)
    .replace(/\{>>[^\n]*?<<\}/g, '')
    .replace(/\{(?:\+\+|--|==)|(?:\+\+|--|==)\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return h(tag, { className: 'md-review-gone', textContent: `${m.kind === 'strike' ? 'Deleted' : 'Added'}: ${text}` });
}

/**
 * A closed box's lines: the author and date (in their colour), after a resolved change's verdict;
 * then, if there is anything more to say, the text a resolved change took out of view (see
 * goneLine) or else the first comment — cut short with "…" — and "+1 reply" or "+N replies"
 * for the comments not shown. (Verdicts aren't comments: the badge shows them.)
 */
function summary(m: Mark, md: string, colorOf: (author: string) => string | null): HTMLElement[] {
  const first = m.notes[0];
  const head = h('div', { className: 'md-review-line' });
  const color = colorOf(first.author);
  if (color) head.style.setProperty('--md-note', color);
  head.append(...badges(m), h('span', { className: 'md-note-author', textContent: first.author || 'Unsigned' }));
  if (first.stamp) head.append(h('span', { className: 'md-note-time', textContent: formatStamp(first) }));
  const comments = m.notes.filter((n) => n.comment && !isVerdict(n));
  const line = h('div', { className: 'md-review-line' });
  let hidden = comments.length;
  const gone = goneLine(m, md, 'span');
  if (gone) {
    gone.classList.add('md-review-snippet');
    line.append(gone);
  } else if (comments.length) {
    const c = colorOf(comments[0].author);
    if (c) line.style.setProperty('--md-note', c);
    line.append(h('span', { className: 'md-note-text md-review-snippet', textContent: shownComment(comments[0].comment ?? '').replace(/\n/g, ' ') }));
    hidden--;
  }
  // (Under "Deleted: …" the first comment is hidden too: they are comments, not all replies.)
  const [one, many] = gone ? ['comment', 'comments'] : ['reply', 'replies'];
  if (hidden) line.append(h('span', { className: 'md-review-replies', textContent: `+${hidden} ${hidden === 1 ? one : many}` }));
  return line.childNodes.length ? [head, line] : [head];
}

/** An arrow up: Send. */
const SEND_GLYPH = '<path d="M8 13.5V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';

/**
 * The open box's comment field: one line to start, growing with its text, and a square Send
 * button at its right, as tall as one line of it, staying at its foot as it grows. Return (or
 * Send) sends, Shift-Return starts a new line, Escape gives up. Disabled (while a note is edited,
 * or resting after a comment was sent), it shows no hint, and looks it.
 */
class ReplyField {
  /** The field and its Send button, side by side. */
  readonly el: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly input: HTMLDivElement;
  private readonly sendButton: HTMLButtonElement;
  private hint = '';

  constructor(o: { spellcheck: boolean; onCommit(text: string): void; onEscape(): void; onInput(): void }) {
    this.input = h('div', { className: 'md-review-text' });
    this.input.contentEditable = 'plaintext-only';
    this.input.spellcheck = o.spellcheck;
    this.box = h('div', { className: 'nx-field multiline md-review-input' });
    this.box.append(this.input);
    this.sendButton = h('button', { type: 'button', className: 'md-review-send', title: 'Send (Return)' });
    this.sendButton.setAttribute('aria-label', 'Send');
    this.sendButton.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">${SEND_GLYPH}</svg>`;
    // (It leaves the focus in the field.)
    this.sendButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.sendButton.addEventListener('click', () => o.onCommit(this.value));
    this.el = h('div', { className: 'md-review-compose' });
    this.el.append(this.box, this.sendButton);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        o.onCommit(this.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        o.onEscape();
      }
    });
    this.input.addEventListener('input', () => {
      this.update();
      o.onInput();
    });
    this.update();
  }

  get value(): string {
    return this.input.innerText;
  }
  set value(v: string) {
    this.input.textContent = v;
    this.update();
  }

  set placeholder(v: string) {
    this.hint = v;
    this.update();
  }

  get disabled(): boolean {
    return this.box.classList.contains('disabled');
  }
  set disabled(v: boolean) {
    this.box.classList.toggle('disabled', v);
    this.input.contentEditable = v ? 'false' : 'plaintext-only';
    this.update();
  }

  focus(): void {
    // (Without scrolling: the box opens where it is.)
    this.input.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(this.input);
    r.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
  }

  /** Sizes Send to one line of the field: its line, padding and borders. */
  measure(): void {
    const px = (el: Element, ...props: string[]) => {
      const css = getComputedStyle(el);
      return props.reduce((sum, p) => sum + (parseFloat(css.getPropertyValue(p)) || 0), 0);
    };
    const line = px(this.input, 'line-height', 'padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width');
    this.el.style.setProperty('--md-send', `${line + px(this.box, 'border-top-width', 'border-bottom-width')}px`);
  }

  /** The hint shows while it is empty (and not disabled: then it is there, unseen, so the field keeps its height); Send, while there is something to send. */
  private update(): void {
    const empty = !this.input.innerText.trim();
    this.input.classList.toggle('empty', empty);
    this.input.dataset.placeholder = this.hint;
    this.sendButton.disabled = empty || this.disabled;
  }
}
