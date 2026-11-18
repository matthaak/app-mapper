import { h } from '../widget';
import { NxWidget, toNode, type Content } from './base';

export interface NxPopoverOptions {
  /** Shown in a black strip across the top (none if empty). */
  title?: string;
  content?: Content;
  /** Lets the mouse pass through, for a hover card that must not take the hover from its target. */
  passive?: boolean;
  /** Makes it a small modal panel: a mouse-down outside it or Escape closes it and calls this. */
  onDismiss?: () => void;
}

/** A box in viewport coordinates, such as a DOMRect. */
export interface NxRect {
  left: number;
  top: number;
  bottom: number;
}

const MARGIN = 8;

/**
 * A small floating panel pointed at a spot on screen: a hover card, or a little prompt. It sits
 * in document.body above everything, just below its target (above it when there is no room
 * below), always kept inside the window.
 */
export class NxPopover extends NxWidget<HTMLDivElement> {
  readonly body: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly onDismiss?: () => void;

  constructor(o: NxPopoverOptions = {}) {
    super(h('div'), 'nx-popover');
    this.el.setAttribute('role', o.passive ? 'tooltip' : 'dialog');
    this.el.classList.toggle('passive', !!o.passive);
    this.titleEl = h('div', { className: 'nx-popover-title' });
    this.body = h('div', { className: 'nx-popover-body' });
    this.el.append(this.titleEl, this.body);
    this.title = o.title ?? '';
    if (o.content !== undefined) this.body.append(toNode(o.content));
    this.onDismiss = o.onDismiss;
    // Capture, so Escape is seen even in a text field (which stops its key events).
    this.el.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.onDismiss) return;
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      },
      true,
    );
  }

  get title(): string {
    return this.titleEl.textContent ?? '';
  }
  set title(v: string) {
    this.titleEl.textContent = v;
    this.titleEl.hidden = !v;
  }

  /** Replaces the contents. */
  setContent(...content: Content[]): void {
    this.body.replaceChildren(...content.map(toNode));
  }

  get open(): boolean {
    return this.el.isConnected;
  }

  /** Opens (or moves) the popover below `target`, or above it if there is no room below. */
  showAt(target: NxRect, gap = 4): this {
    if (!this.open) {
      document.body.append(this.el);
      if (this.onDismiss) document.addEventListener('pointerdown', this.onOutside, true);
    }
    const { offsetWidth: w, offsetHeight: ht } = this.el;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let top = target.bottom + gap;
    if (top + ht > vh - MARGIN && target.top - gap - ht >= MARGIN) top = target.top - gap - ht;
    // A target off screen (or a popover taller than the room) still leaves it in view.
    top = Math.max(MARGIN, Math.min(top, vh - MARGIN - ht));
    const left = Math.max(MARGIN, Math.min(target.left, vw - MARGIN - w));
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px` });
    return this;
  }

  close(): void {
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.el.remove();
  }

  override destroy(): void {
    this.close();
    super.destroy();
  }

  private dismiss(): void {
    this.close();
    this.onDismiss?.();
  }

  private readonly onOutside = (e: PointerEvent) => {
    if (!this.el.contains(e.target as Node)) this.dismiss();
  };
}
