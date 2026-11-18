import { Widget } from '../widget';

/** Base for every NeXT-style widget: adds the shared `nx` class (font, palette, box model). */
export abstract class NxWidget<E extends HTMLElement = HTMLElement> extends Widget<E> {
  protected constructor(el: E, className: string) {
    super(el, className);
    el.classList.add('nx');
  }
}

/** Parses one SVG element from markup. */
export function svg(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

/** The small drawn glyphs that are part of the widget chrome (not app icons). */
export const glyph = {
  close: () =>
    svg(`<svg width="11" height="11" viewBox="0 0 11 11"><path d="M1.5 1.5l8 8m0-8l-8 8" stroke="#000" stroke-width="1.3" fill="none"/></svg>`),
  /** Hollow right-pointing triangle used for submenus and browser branches. */
  branch: () =>
    svg(`<svg width="7" height="8" viewBox="0 0 7 8"><path d="M1 .5v7l5.5-3.5z" fill="#a0a0a0"/><path d="M1 7.5V.5l5.5 3.5" stroke="#000" fill="none"/><path d="M1.5 7.2l5-3.2" stroke="#fff" fill="none"/></svg>`),
  /** The return-key mark on default buttons. */
  ret: () =>
    svg(`<svg width="17" height="12" viewBox="0 0 17 12"><path d="M1 6.5L6 2v3.5h6.5V.5h3V8.5H6V11z" fill="#fff" stroke="#000"/></svg>`),
  arrow: (dir: 'up' | 'down' | 'left' | 'right') => {
    const d = { up: 'M4.5 1L8 7H1z', down: 'M1 1h7L4.5 7z', left: 'M1 4.5L7 1v7z', right: 'M1 1l6 3.5L1 8z' }[dir];
    const [w, h] = dir === 'up' || dir === 'down' ? [9, 8] : [8, 9];
    return svg(`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="#000"/></svg>`);
  },
  check: () =>
    svg(`<svg width="12" height="11" viewBox="0 0 12 11"><path d="M2.5 4.5l2.5 5L10.5 1" stroke="#000" stroke-width="1.4" fill="none"/><path d="M5.8 9.2L11 1.6" stroke="#fff" fill="none"/></svg>`),
  cross: () =>
    svg(`<svg width="9" height="9" viewBox="0 0 9 9"><path d="M1 1l7 7m0-7l-7 7" stroke="#000" stroke-width="1.3" fill="none"/></svg>`),
};

export interface DragHandlers {
  move(dx: number, dy: number, e: PointerEvent): void;
  end?(moved: boolean, e: PointerEvent): void;
  /** Pixels the pointer must travel before `move` fires (lets clicks/double-clicks through). */
  threshold?: number;
}

/** Tracks a pointer drag from `e` until release, reporting the offset from the start point. */
export function startDrag(e: PointerEvent, h: DragHandlers): void {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const threshold = h.threshold ?? 0;
  let moved = false;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!moved && Math.hypot(dx, dy) < threshold) return;
    moved = true;
    h.move(dx, dy, ev);
  };
  const up = (ev: PointerEvent) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    h.end?.(moved, ev);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

function inside(el: Element, e: PointerEvent): boolean {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
}

/**
 * NeXT-style momentary control: highlights (`.pressed`) while the mouse is down over it,
 * un-highlights if the pointer leaves, and fires only when released inside.
 * Keyboard activation (Enter/Space on a <button>) also fires.
 */
export function momentary(
  el: HTMLElement,
  onClick: () => void,
  enabled: () => boolean = () => !(el as HTMLButtonElement).disabled,
  opts: { repeat?: boolean } = {},
): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !enabled()) return;
    e.preventDefault();
    el.classList.add('pressed');
    let timer = 0;
    if (opts.repeat) {
      onClick();
      const tick = () => {
        if (el.classList.contains('pressed')) onClick();
        timer = window.setTimeout(tick, 50);
      };
      timer = window.setTimeout(tick, 350);
    }
    startDrag(e, {
      move: (_x, _y, ev) => el.classList.toggle('pressed', inside(el, ev)),
      end: (_m, ev) => {
        clearTimeout(timer);
        el.classList.remove('pressed');
        if (!opts.repeat && inside(el, ev)) onClick();
      },
    });
  });
  el.addEventListener('click', (e) => {
    if (e.detail === 0 && enabled()) onClick(); // keyboard
  });
}

/** Absolutely positions `el` inside its (positioned) parent. Returns `el`. */
export function place<T extends HTMLElement>(el: T, x: number, y: number, w?: number, h?: number): T {
  Object.assign(el.style, { position: 'absolute', left: `${x}px`, top: `${y}px` });
  if (w !== undefined) el.style.width = `${w}px`;
  if (h !== undefined) el.style.height = `${h}px`;
  return el;
}

/**
 * Pins `el` to edges of its (positioned) parent, so it follows the parent's size: e.g.
 * `{ left: '8px', right: '8px', top: '36px', bottom: '100px' }` stretches both ways. Any CSS
 * length works, `calc()` included. Returns `el`.
 * A size is freed (`auto`) only along an axis pinned at both ends; otherwise the widget keeps
 * its own (a button's 24px height, say).
 * (Buttons size to their content, so give them a `width` rather than both `left` and `right`.)
 */
export function pin<T extends HTMLElement>(el: T, edges: Partial<Record<'left' | 'right' | 'top' | 'bottom' | 'width' | 'height', string>>): T {
  const width = edges.left && edges.right ? 'auto' : '';
  const height = edges.top && edges.bottom ? 'auto' : '';
  Object.assign(el.style, { position: 'absolute', width, height, left: '', right: '', top: '', bottom: '', ...edges });
  return el;
}

export type Content = Node | Widget | string;

/** Normalizes widget/node/text content to a DOM node. */
export function toNode(c: Content): Node {
  if (typeof c === 'string') return document.createTextNode(c);
  return c instanceof Widget ? c.el : c;
}
