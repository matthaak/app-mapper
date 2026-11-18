import { h } from '../widget';
import { NxWidget, glyph, momentary, startDrag, toNode, type Content } from './base';
import { nxTheme } from './theme';

const ARROW = 16;
const MIN_KNOB = 16;

/** Every scroller, laid out again when the theme changes (see setNxTheme). */
const scrollers = new Set<WeakRef<NxScroller>>();
window.addEventListener('nx-theme', () => {
  for (const ref of scrollers) {
    const s = ref.deref();
    if (s) s.refresh();
    else scrollers.delete(ref);
  }
});

export interface NxScrollerOptions {
  orientation?: 'vertical' | 'horizontal';
  /** Pixels per arrow click. */
  step?: number;
  onScroll?: (offset: number) => void;
}

/**
 * A NeXT scroller: solid grey trough, dimpled knob, and both arrow buttons together
 * (at the bottom when vertical, at the left when horizontal). With nothing to scroll it
 * shows only the trough.
 */
export class NxScroller extends NxWidget<HTMLDivElement> {
  readonly vertical: boolean;
  onScroll?: (offset: number) => void;
  private readonly knob: HTMLDivElement;
  private readonly step: number;
  private content = 0;
  private view = 0;
  private _offset = 0;

  constructor(o: NxScrollerOptions = {}) {
    super(h('div', { role: 'scrollbar' }), 'nx-scroller');
    this.vertical = (o.orientation ?? 'vertical') === 'vertical';
    this.step = o.step ?? 15;
    this.onScroll = o.onScroll;
    this.el.classList.add(this.vertical ? 'v' : 'h', 'empty');

    this.knob = h('div', { className: 'nx-knob' });
    this.knob.append(h('div', { className: 'nx-dimple' }));
    const arrows = h('div', { className: 'nx-scroller-arrows' });
    for (const dir of this.vertical ? (['up', 'down'] as const) : (['left', 'right'] as const)) {
      const b = h('button', { type: 'button', className: 'nx-arrow', tabIndex: -1 });
      b.append(glyph.arrow(dir));
      momentary(b, () => this.scrollBy(dir === 'up' || dir === 'left' ? -this.step : this.step), undefined, { repeat: true });
      arrows.append(b);
    }
    this.el.append(this.knob, arrows);

    this.knob.addEventListener('pointerdown', (e) => this.dragKnob(e));
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target !== this.el || e.button !== 0 || this.max <= 0) return;
      // Clicking the trough jumps the knob there, then keeps dragging.
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const pos = (this.vertical ? e.clientY - r.top : e.clientX - r.left - this.arrowsLength) - this.knobLength / 2;
      this.offset = (pos / Math.max(1, this.track - this.knobLength)) * this.max;
      this.notify();
      this.dragKnob(e);
    });
    new ResizeObserver(() => this.layout()).observe(this.el);
    scrollers.add(new WeakRef(this));
  }

  /** Sets the scrollable range: total content length and visible length, in px. */
  setRange(content: number, view: number): void {
    this.content = content;
    this.view = view;
    this.offset = this._offset;
  }

  get offset(): number {
    return this._offset;
  }
  set offset(v: number) {
    this._offset = Math.min(this.max, Math.max(0, v));
    this.layout();
  }

  scrollBy(delta: number): void {
    this.offset = this._offset + delta;
    this.notify();
  }

  private get max(): number {
    return Math.max(0, this.content - this.view);
  }
  /** The theme shows arrows (`--nx-scroller-arrows: 0` hides them: the knob travels the whole trough). */
  private get hasArrows(): boolean {
    return getComputedStyle(this.el).getPropertyValue('--nx-scroller-arrows').trim() !== '0';
  }
  private get arrowsLength(): number {
    return this.vertical || !this.hasArrows ? 0 : ARROW * 2 + 2;
  }
  /** Length of the area the knob travels in. */
  private get track(): number {
    const len = this.vertical ? this.el.clientHeight : this.el.clientWidth;
    return Math.max(0, len - (this.hasArrows ? ARROW * 2 + 4 : 2));
  }

  /** Lays the knob out again (the theme changed: the arrows may have come or gone). */
  refresh(): void {
    this.layout();
  }
  private get knobLength(): number {
    return Math.max(MIN_KNOB, Math.round(this.track * (this.view / Math.max(1, this.content))));
  }

  private layout(): void {
    const scrollable = this.max > 0 && this.track >= MIN_KNOB;
    this.el.classList.toggle('empty', !scrollable);
    if (!scrollable) return;
    const len = this.knobLength;
    const pos = Math.round(((this.track - len) * this._offset) / this.max) + 1;
    if (this.vertical) Object.assign(this.knob.style, { top: `${pos}px`, height: `${len}px` });
    else Object.assign(this.knob.style, { left: `${pos + this.arrowsLength}px`, width: `${len}px` });
  }

  private dragKnob(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = this._offset;
    const ratio = this.max / Math.max(1, this.track - this.knobLength);
    startDrag(e, {
      move: (dx, dy) => {
        this.offset = start + (this.vertical ? dy : dx) * ratio;
        this.notify();
      },
    });
  }

  private notify(): void {
    this.onScroll?.(this._offset);
  }
}

export interface NxScrollViewOptions {
  content?: Content;
  vertical?: boolean;
  horizontal?: boolean;
  /** 'bezel' = sunken frame, 'line' = 1px black, 'none'. */
  border?: 'bezel' | 'line' | 'none';
}

/**
 * Content clipped to a viewport and scrolled by NeXT scrollers (vertical on the left). In
 * the Modern theme the scrollers are hidden and the viewport scrolls natively.
 */
export class NxScrollView extends NxWidget<HTMLDivElement> {
  readonly viewport: HTMLDivElement;
  readonly vScroller?: NxScroller;
  readonly hScroller?: NxScroller;
  private readonly observer: ResizeObserver;

  constructor(o: NxScrollViewOptions = {}) {
    super(h('div'), 'nx-scrollview');
    this.el.classList.add(o.border ?? 'bezel');
    const frame = h('div', { className: 'nx-sv-frame' });
    const row = h('div', { className: 'nx-sv-row' });
    this.viewport = h('div', { className: 'nx-viewport' });
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(this.viewport);

    if (o.vertical ?? true) {
      this.vScroller = new NxScroller({ onScroll: (v) => (this.viewport.scrollTop = v) });
      row.append(this.vScroller.el);
    }
    row.append(this.viewport);
    frame.append(row);
    if (o.horizontal) {
      this.el.classList.add('h-scroll');
      this.hScroller = new NxScroller({ orientation: 'horizontal', onScroll: (v) => (this.viewport.scrollLeft = v) });
      this.hScroller.el.classList.add('bottom');
      if (!this.vScroller) this.hScroller.el.classList.add('no-v');
      frame.append(this.hScroller.el);
    }
    this.el.append(frame);
    if (o.content !== undefined) this.setContent(o.content);

    this.viewport.addEventListener(
      'wheel',
      (e) => {
        if (nxTheme() === 'modern') return;
        e.preventDefault();
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        this.viewport.scrollTop += dy;
        this.viewport.scrollLeft += dx;
        this.sync();
      },
      { passive: false },
    );
    this.viewport.addEventListener('scroll', () => this.sync());
  }

  setContent(content: Content): void {
    for (const c of this.viewport.children) this.observer.unobserve(c);
    const node = toNode(content);
    this.viewport.replaceChildren(node);
    if (node instanceof Element) this.observer.observe(node);
    this.refresh();
  }

  /** Re-measures the content; call after changing it in a way that keeps its size. */
  refresh(): void {
    const v = this.viewport;
    this.vScroller?.setRange(v.scrollHeight, v.clientHeight);
    this.hScroller?.setRange(v.scrollWidth, v.clientWidth);
    this.sync();
  }

  /** Scrolls so that the vertical range [top, bottom) is visible. */
  reveal(top: number, bottom: number): void {
    const v = this.viewport;
    if (top < v.scrollTop) v.scrollTop = top;
    else if (bottom > v.scrollTop + v.clientHeight) v.scrollTop = bottom - v.clientHeight;
    this.sync();
  }

  private sync(): void {
    if (this.vScroller) this.vScroller.offset = this.viewport.scrollTop;
    if (this.hScroller) this.hScroller.offset = this.viewport.scrollLeft;
  }
}
