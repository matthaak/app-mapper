import { h } from '../widget';
import { NxWidget, startDrag, toNode, type Content } from './base';

export interface NxSplitViewOptions {
  panes: Content[];
  /** Initial sizes in px for every pane but the last, which takes the rest. */
  sizes?: number[];
  /** 'column' stacks panes top to bottom (horizontal dividers). */
  direction?: 'column' | 'row';
  minSize?: number;
}

/** Panes separated by draggable dividers, each marked with a dimple. */
export class NxSplitView extends NxWidget<HTMLDivElement> {
  readonly panes: HTMLDivElement[] = [];
  private readonly column: boolean;
  private readonly min: number;

  constructor(o: NxSplitViewOptions) {
    super(h('div'), 'nx-split');
    this.column = (o.direction ?? 'column') === 'column';
    this.min = o.minSize ?? 20;
    if (!this.column) this.el.classList.add('row');
    o.panes.forEach((c, i) => {
      if (i > 0) this.el.append(this.divider(i - 1));
      const pane = h('div', { className: 'nx-pane' });
      pane.append(toNode(c));
      const size = o.sizes?.[i];
      if (size !== undefined && i < o.panes.length - 1) pane.style.flex = `0 0 ${size}px`;
      this.panes.push(pane);
      this.el.append(pane);
    });
  }

  private size(el: HTMLElement): number {
    return this.column ? el.offsetHeight : el.offsetWidth;
  }

  private divider(i: number): HTMLDivElement {
    const d = h('div', { className: 'nx-divider', role: 'separator' });
    d.append(h('div', { className: 'nx-dimple' }));
    d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const a = this.panes[i];
      const b = this.panes[i + 1];
      const lastB = i + 1 === this.panes.length - 1; // the last pane flexes on its own
      const a0 = this.size(a);
      const b0 = this.size(b);
      startDrag(e, {
        move: (dx, dy) => {
          const delta = Math.min(b0 - this.min, Math.max(this.min - a0, this.column ? dy : dx));
          a.style.flex = `0 0 ${a0 + delta}px`;
          if (!lastB) b.style.flex = `0 0 ${b0 - delta}px`;
        },
      });
    });
    return d;
  }
}
