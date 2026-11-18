import { h, type Widget } from '../widget';
import { NxWidget } from './base';
import { NxTile } from './tile';
import type { NxWindow } from './window';

/**
 * The key window's stacking level when it is a panel: over page-wide overlays (such as the MD
 * Editor's comment lines, at 9000) but under menus (10000). A utility window the user is
 * working in is never covered.
 */
export const KEY_PANEL_Z = 9001;

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * The workspace background. Hosts windows, menus, the dock and free tiles; keeps window
 * stacking order, tracks the key window, and turns miniaturized windows into tiles along
 * the bottom edge.
 */
export class NxDesktop extends NxWidget<HTMLDivElement> {
  private readonly windows: NxWindow[] = [];
  private key?: NxWindow;
  private z = 1;
  /** Bottom-left icon row, left to right; `null` is a free slot. */
  private readonly bottomRow: (NxTile | null)[] = [];
  onKeyChange?: (win: NxWindow | undefined) => void;

  /** Without a size the desktop fills its container (give the container a size). */
  constructor({ width, height }: { width?: number; height?: number } = {}) {
    super(h('div'), 'nx-desktop');
    if (width) this.el.style.width = `${width}px`;
    if (height) this.el.style.height = `${height}px`;

    this.el.addEventListener('nx-activate', (e) => this.makeKey((e as CustomEvent<NxWindow>).detail));
    this.el.addEventListener('nx-miniaturize', (e) => this.miniaturize((e as CustomEvent<NxWindow>).detail));
    this.el.addEventListener('nx-close', (e) => this.forget((e as CustomEvent<NxWindow>).detail));
    new ResizeObserver(() => this.keepWindowsReachable()).observe(this.el);
    // A press outside the desktop (in a page-wide overlay's own window, say) takes the key
    // panel's place over the overlays; pressing the panel again brings it back up.
    document.addEventListener(
      'pointerdown',
      (e) => {
        const k = this.key;
        if (k?.kind === 'panel' && !this.el.contains(e.target as Node) && k.el.style.zIndex === String(KEY_PANEL_Z)) k.el.style.zIndex = String(++this.z);
      },
      true,
    );
  }

  get width(): number {
    return this.el.clientWidth;
  }
  get height(): number {
    return this.el.clientHeight;
  }

  get keyWindow(): NxWindow | undefined {
    return this.key;
  }

  /** Shows `win` at (x, y) and makes it key. Re-adding a closed window reopens it. */
  addWindow(win: NxWindow, x?: number, y?: number, { key = true } = {}): NxWindow {
    if (!this.windows.includes(win)) this.windows.push(win);
    win.hidden = false;
    if (x !== undefined && y !== undefined) win.moveTo(x, y);
    if (!win.el.isConnected) this.el.append(win.el);
    if (key) this.makeKey(win);
    else {
      win.state = 'inactive';
      win.el.style.zIndex = String(++this.z);
    }
    return win;
  }

  /** Brings `win` to the front and gives it the black (key) title bar. */
  makeKey(win: NxWindow): void {
    if (this.key && this.key !== win) {
      this.key.state = 'inactive';
      // Back among the other windows, under the new key window.
      if (this.key.kind === 'panel') this.key.el.style.zIndex = String(++this.z);
    }
    win.el.style.zIndex = win.kind === 'panel' ? String(KEY_PANEL_Z) : String(++this.z);
    if (this.key === win) return;
    this.key = win;
    win.state = 'key';
    this.onKeyChange?.(win);
  }

  /**
   * Places any widget (menu, dock, tile, …). `x`/`y` are distances from the edges named by
   * `corner`, so e.g. a dock placed 'top-right' stays on the right as the desktop resizes.
   */
  place<W extends Widget>(widget: W, x: number, y: number, corner: Corner = 'top-left'): W {
    const [v, hz] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
    Object.assign(widget.el.style, { left: '', right: '', top: '', bottom: '', [hz]: `${x}px`, [v]: `${y}px` });
    widget.mount(this);
    return widget;
  }

  /** Adds a tile to the bottom-left icon row (where miniwindows also go). */
  addToBottomRow(tile: NxTile): NxTile {
    let slot = this.bottomRow.indexOf(null);
    if (slot < 0) slot = this.bottomRow.push(null) - 1;
    this.bottomRow[slot] = tile;
    this.place(tile, slot * 65, 0, 'bottom-left');
    tile.draggable(() => {
      const i = this.bottomRow.indexOf(tile);
      if (i >= 0) this.bottomRow[i] = null; // moved away: free its slot
    });
    return tile;
  }

  private miniaturize(win: NxWindow): void {
    win.hidden = true;
    this.forget(win);
    const tile = new NxTile({
      miniTitle: win.title,
      onOpen: () => {
        const i = this.bottomRow.indexOf(tile);
        if (i >= 0) this.bottomRow[i] = null;
        tile.destroy();
        win.hidden = false;
        this.makeKey(win);
      },
    });
    this.addToBottomRow(tile);
  }

  /** If `win` was key, passes key status to the frontmost remaining window. */
  private forget(win: NxWindow): void {
    if (this.key !== win) return;
    this.key = undefined;
    win.state = 'inactive';
    const visible = this.windows.filter((w) => w !== win && !w.hidden && w.el.isConnected);
    const next = visible.sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex)[0];
    if (next) this.makeKey(next);
    else this.onKeyChange?.(undefined);
  }

  /** After the desktop shrinks, pulls windows back so each title bar can still be grabbed. */
  private keepWindowsReachable(): void {
    const { width, height } = this;
    if (!width || !height) return;
    for (const w of this.windows) {
      if (!w.el.isConnected) continue;
      const x = Math.min(w.x, width - 60);
      const y = Math.min(w.y, height - 30);
      if (x !== w.x || y !== w.y) w.moveTo(Math.max(0, x), Math.max(0, y));
    }
  }

  /** Hides every window (the Workspace "Hide" command); `unhide` brings them back. */
  hideAll(): void {
    for (const w of this.windows) if (w.el.isConnected) w.el.style.visibility = 'hidden';
  }
  unhideAll(): void {
    for (const w of this.windows) w.el.style.visibility = '';
  }
}
