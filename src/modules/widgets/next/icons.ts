import { h } from '../widget';
import { NxWidget, glyph, startDrag, toNode, type Content } from './base';

export interface NxIconCellOptions {
  label: string;
  icon?: Content;
  selected?: boolean;
  onClick?: (cell: NxIconCell) => void;
  onOpen?: (cell: NxIconCell) => void;
}

/** A file icon with its name below; selected cells get a white rounded backing. */
export class NxIconCell extends NxWidget<HTMLDivElement> {
  private readonly labelEl: HTMLSpanElement;

  constructor(o: NxIconCellOptions) {
    super(h('div'), 'nx-iconcell');
    const icon = h('div', { className: 'nx-iconcell-icon' });
    if (o.icon !== undefined) icon.append(toNode(o.icon));
    this.labelEl = h('span', { className: 'nx-iconcell-label', textContent: o.label });
    this.el.append(icon, this.labelEl);
    this.selected = !!o.selected;
    this.el.addEventListener('click', () => o.onClick?.(this));
    this.el.addEventListener('dblclick', () => o.onOpen?.(this));
  }

  get label(): string {
    return this.labelEl.textContent ?? '';
  }
  set label(v: string) {
    this.labelEl.textContent = v;
    this.el.title = v;
  }

  get selected(): boolean {
    return this.el.classList.contains('selected');
  }
  set selected(v: boolean) {
    this.el.classList.toggle('selected', v);
  }
}

/** A free-form area (the File Viewer shelf) whose icon cells can be dragged around. */
export class NxShelf extends NxWidget<HTMLDivElement> {
  readonly cells: NxIconCell[] = [];

  constructor() {
    super(h('div'), 'nx-shelf');
  }

  add(cell: NxIconCell, x: number, y: number): NxIconCell {
    this.cells.push(cell);
    Object.assign(cell.el.style, { left: `${x}px`, top: `${y}px` });
    cell.mount(this);
    cell.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      for (const c of this.cells) c.selected = c === cell;
      const x0 = cell.el.offsetLeft;
      const y0 = cell.el.offsetTop;
      startDrag(e, {
        threshold: 3,
        move: (dx, dy) => {
          const maxX = this.el.clientWidth - cell.el.offsetWidth;
          const maxY = this.el.clientHeight - cell.el.offsetHeight;
          cell.el.style.left = `${Math.min(maxX, Math.max(0, x0 + dx))}px`;
          cell.el.style.top = `${Math.min(maxY, Math.max(0, y0 + dy))}px`;
        },
      });
    });
    return cell;
  }
}

export interface NxPathItem {
  label: string;
  icon?: Content;
}

/** A row of icon cells joined by ▷ — the path above the File Viewer browser. Last is selected. */
export class NxPathView extends NxWidget<HTMLDivElement> {
  onClick?: (index: number) => void;

  constructor(items: NxPathItem[] = []) {
    super(h('div'), 'nx-pathview');
    this.setPath(items);
  }

  setPath(items: NxPathItem[]): void {
    const kids: Node[] = [];
    items.forEach((it, i) => {
      if (i > 0) kids.push(glyph.branch());
      const cell = new NxIconCell({ ...it, selected: i === items.length - 1, onClick: () => this.onClick?.(i) });
      kids.push(cell.el);
    });
    this.el.replaceChildren(...kids);
  }
}
