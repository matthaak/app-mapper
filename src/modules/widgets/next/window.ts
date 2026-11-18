import { h } from '../widget';
import { NxWidget, glyph, momentary, startDrag } from './base';

export type NxWindowState = 'key' | 'main' | 'inactive';

export interface NxWindowOptions {
  title: string;
  /** Standard windows get a miniaturize button and resize bar; panels only a close button. */
  kind?: 'standard' | 'panel';
  closable?: boolean;
  miniaturizable?: boolean;
  resizable?: boolean;
  /** Outer size in px. */
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  onClose?: () => void;
  /** The user finished moving or resizing the window. */
  onFrameChange?: (win: NxWindow) => void;
}

/** A window's place and outer size, in its container's px. */
export interface NxFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A movable NeXTSTEP window: title bar (black when key), close / miniaturize buttons,
 * optional resize bar. Put your controls in `content`.
 *
 * Dispatches bubbling DOM events so a container (NxDesktop) can manage it:
 * `nx-activate` on any press, `nx-miniaturize`, and `nx-close`.
 */
export class NxWindow extends NxWidget<HTMLDivElement> {
  readonly titleBar: HTMLDivElement;
  readonly content: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  private readonly minW: number;
  private readonly minH: number;
  private readonly onClose?: () => void;
  /** Has a resize bar. */
  readonly resizable: boolean;
  /** A panel (a utility window: an inspector, a dialog) or a standard document window. */
  readonly kind: 'standard' | 'panel';
  /** Called when the user has finished moving or resizing the window (to remember its frame, say). */
  onFrameChange?: (win: NxWindow) => void;

  constructor(o: NxWindowOptions) {
    super(h('div', { role: 'dialog' }), 'nx-window');
    const kind = (this.kind = o.kind ?? 'standard');
    this.minW = o.minWidth ?? 120;
    this.minH = o.minHeight ?? 60;
    this.onClose = o.onClose;
    this.onFrameChange = o.onFrameChange;
    this.resizable = o.resizable ?? kind === 'standard';

    this.titleEl = h('span', { className: 'nx-title', textContent: o.title });
    this.titleBar = h('div', { className: 'nx-titlebar' });
    this.titleBar.append(this.titleEl);

    if (o.miniaturizable ?? kind === 'standard') {
      const mini = h('button', { type: 'button', className: 'nx-title-btn mini', title: 'Miniaturize' });
      mini.append(h('span', { className: 'nx-mini-glyph' }));
      momentary(mini, () => this.miniaturize());
      this.titleBar.append(mini);
    }
    if (o.closable ?? true) {
      const close = h('button', { type: 'button', className: 'nx-title-btn close', title: 'Close' });
      close.append(glyph.close());
      momentary(close, () => this.close());
      this.titleBar.append(close);
    }

    this.content = h('div', { className: 'nx-window-content' });
    this.el.append(this.titleBar, this.content);
    if (this.resizable) this.el.append(this.resizeBar());

    if (o.width) this.el.style.width = `${o.width}px`;
    if (o.height) this.el.style.height = `${o.height}px`;

    this.el.addEventListener('pointerdown', () => this.emit('nx-activate'), true);
    this.titleBar.addEventListener('pointerdown', (e) => this.beginMove(e));
  }

  get title(): string {
    return this.titleEl.textContent ?? '';
  }
  set title(v: string) {
    this.titleEl.textContent = v;
  }

  get state(): NxWindowState {
    return this.el.classList.contains('key') ? 'key' : this.el.classList.contains('main') ? 'main' : 'inactive';
  }
  set state(s: NxWindowState) {
    this.el.classList.toggle('key', s === 'key');
    this.el.classList.toggle('main', s === 'main');
  }

  get x(): number {
    return this.el.offsetLeft;
  }
  get y(): number {
    return this.el.offsetTop;
  }

  moveTo(x: number, y: number): void {
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  get frame(): NxFrame {
    return { x: this.x, y: this.y, width: this.el.offsetWidth, height: this.el.offsetHeight };
  }

  resize(width: number, height: number): void {
    this.el.style.width = `${Math.max(this.minW, Math.round(width))}px`;
    this.el.style.height = `${Math.max(this.minH, Math.round(height))}px`;
  }

  close(): void {
    this.emit('nx-close');
    this.el.remove();
    this.onClose?.();
  }

  miniaturize(): void {
    this.emit('nx-miniaturize');
  }

  private emit(type: string): void {
    this.el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: this }));
  }

  private beginMove(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.nx-title-btn')) return;
    e.preventDefault();
    const x0 = this.x;
    const y0 = this.y;
    const parent = this.el.offsetParent as HTMLElement | null;
    startDrag(e, {
      move: (dx, dy) => {
        // Keep some of the title bar on screen so the window can always be grabbed again.
        const maxX = parent ? parent.clientWidth - 40 : Infinity;
        const maxY = parent ? parent.clientHeight - 22 : Infinity;
        this.moveTo(Math.min(maxX, Math.max(40 - this.el.offsetWidth, x0 + dx)), Math.min(maxY, Math.max(0, y0 + dy)));
      },
      end: (moved) => moved && this.onFrameChange?.(this),
    });
  }

  private resizeBar(): HTMLDivElement {
    const bar = h('div', { className: 'nx-resizebar' });
    for (const edge of ['sw', 's', 'se'] as const) {
      const seg = h('div', { className: edge });
      seg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const { x, y } = this;
        const w0 = this.el.offsetWidth;
        const h0 = this.el.offsetHeight;
        startDrag(e, {
          move: (dx, dy) => {
            const w = edge === 's' ? w0 : edge === 'se' ? w0 + dx : w0 - dx;
            this.resize(w, h0 + dy);
            if (edge === 'sw') this.moveTo(x + w0 - this.el.offsetWidth, y);
          },
          end: (moved) => moved && this.onFrameChange?.(this),
        });
      });
      bar.append(seg);
    }
    return bar;
  }
}
