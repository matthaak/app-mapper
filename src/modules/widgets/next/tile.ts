import { h } from '../widget';
import { NxWidget, startDrag, toNode, type Content } from './base';

export interface NxTileOptions {
  /** Icon (or any content, e.g. an NxClock) drawn in the middle of the tile. */
  content?: Content;
  /** App tiles show "..." until the app is running. Default true (no dots). */
  running?: boolean;
  /** Small number in the top-left corner (e.g. unread mail). */
  badge?: string;
  /** Makes this a miniwindow tile with a small black title bar. */
  miniTitle?: string;
  title?: string;
  onClick?: (tile: NxTile) => void;
  /** Double-click: launch the app / restore the miniwindow. */
  onOpen?: (tile: NxTile) => void;
}

/** A 64×64 bevelled icon tile: dock app tiles, miniwindows, free desktop icons. */
export class NxTile extends NxWidget<HTMLDivElement> {
  private readonly badgeEl: HTMLSpanElement;

  constructor(o: NxTileOptions = {}) {
    super(h('div', { title: o.title ?? o.miniTitle ?? '' }), 'nx-tile');
    const body = h('div', { className: 'nx-tile-content' });
    if (o.content !== undefined) body.append(toNode(o.content));
    const dots = h('span', { className: 'nx-tile-dots' });
    dots.append(h('i'), h('i'), h('i'));
    this.badgeEl = h('span', { className: 'nx-tile-badge' });
    this.el.append(body, dots, this.badgeEl);
    if (o.miniTitle !== undefined) {
      this.el.classList.add('mini');
      this.el.append(h('div', { className: 'nx-tile-mini-title', textContent: o.miniTitle }));
    }
    this.running = o.running ?? true;
    this.badge = o.badge ?? '';

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.el.classList.add('pressed');
      const up = () => this.el.classList.remove('pressed');
      addEventListener('pointerup', up, { once: true });
    });
    this.el.addEventListener('click', () => o.onClick?.(this));
    this.el.addEventListener('dblclick', () => o.onOpen?.(this));
  }

  get running(): boolean {
    return this.el.classList.contains('running');
  }
  set running(v: boolean) {
    this.el.classList.toggle('running', v);
  }

  get badge(): string {
    return this.badgeEl.textContent ?? '';
  }
  set badge(v: string) {
    this.badgeEl.textContent = v;
  }

  get selected(): boolean {
    return this.el.classList.contains('selected');
  }
  set selected(v: boolean) {
    this.el.classList.toggle('selected', v);
  }

  /** Lets the tile be dragged freely inside its positioned parent. */
  draggable(onMoved?: (x: number, y: number) => void): this {
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = this.el.offsetLeft;
      const y0 = this.el.offsetTop;
      const parent = this.el.offsetParent as HTMLElement | null;
      startDrag(e, {
        threshold: 3,
        move: (dx, dy) => {
          const maxX = (parent?.clientWidth ?? Infinity) - 64;
          const maxY = (parent?.clientHeight ?? Infinity) - 64;
          // Switch to top/left positioning (the tile may have been anchored right/bottom).
          Object.assign(this.el.style, {
            right: '',
            bottom: '',
            left: `${Math.min(maxX, Math.max(0, x0 + dx))}px`,
            top: `${Math.min(maxY, Math.max(0, y0 + dy))}px`,
          });
        },
        end: (moved) => moved && onMoved?.(this.el.offsetLeft, this.el.offsetTop),
      });
    });
    return this;
  }
}

/** The vertical column of app tiles. Tiles below the first can be dragged to reorder. */
export class NxDock extends NxWidget<HTMLDivElement> {
  readonly tiles: NxTile[] = [];

  constructor(tiles: NxTile[] = []) {
    super(h('div'), 'nx-dock');
    for (const t of tiles) this.add(t);
  }

  add(tile: NxTile): NxTile {
    this.tiles.push(tile);
    tile.mount(this);
    tile.el.addEventListener('pointerdown', (e) => this.beginReorder(tile, e));
    return tile;
  }

  private beginReorder(tile: NxTile, e: PointerEvent): void {
    if (e.button !== 0 || this.tiles.indexOf(tile) === 0) return; // the first tile is fixed
    e.preventDefault();
    const from = this.tiles.indexOf(tile);
    startDrag(e, {
      threshold: 4,
      move: (_dx, dy) => {
        tile.el.classList.add('dragging');
        const lo = -from * 64 + 64; // can't go above the first tile
        const hi = (this.tiles.length - 1 - from) * 64;
        tile.el.style.transform = `translateY(${Math.min(hi, Math.max(lo, dy))}px)`;
      },
      end: (moved, ev) => {
        tile.el.classList.remove('dragging', 'pressed');
        tile.el.style.transform = '';
        if (!moved) return;
        const rect = this.el.getBoundingClientRect();
        const to = Math.min(this.tiles.length - 1, Math.max(1, Math.floor((ev.clientY - rect.top) / 64)));
        if (to === from) return;
        this.tiles.splice(from, 1);
        this.tiles.splice(to, 0, tile);
        this.el.insertBefore(tile.el, this.tiles[to + 1]?.el ?? null);
      },
    });
  }
}
