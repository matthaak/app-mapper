import { h, startDrag } from '../widgets';
import { storage } from './frames';

/** The bezel's place: the dock's share of the window's width (0–1). */
const KEY_SHARE = 'app-mapper.dock-share';
const KEY_HANDLE = 'app-mapper.drawer-tab';
/** By default the bezel stands 60% of the way across (canvas 60, dock 40). */
const DEFAULT_SHARE = 0.4;
const MIN_WIDTH = 320;
/** Room the canvas always keeps beside the dock. */
const MIN_CANVAS = 240;
/** Pointer travel (px) that makes a press on the resizer or drawer tab a drag, not a click. */
const DRAG = 3;

interface Tab {
  path: string;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  body: HTMLDivElement;
  onClose: () => void;
}

/**
 * The paneled UI's right side: the open Markdown files as NeXT folder tabs, and the front
 * file's editor (toolbar and all), joined to its tab. A bezel like a window's
 * resize bar, standing on end, separates it from the canvas: drag it to resize the dock (its
 * share of the window's width is remembered), click it to close the drawer. Closed — and
 * whenever its last file is closed — only a "Files" tab shows against the right edge; it can be
 * dragged up and down (its place, kept as a share of the height, is remembered), and a click
 * (or opening a file) opens the drawer again.
 *
 * The bezel's place marks the canvas's viewable area (`reserve`) whether the drawer is open,
 * closed, or the dock not in use at all (editor windows take that room then): opening or closing
 * it never moves the diagram.
 */
export class EditorDock {
  readonly el: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly handle: HTMLButtonElement;
  private readonly tabs: Tab[] = [];
  private current: Tab | null = null;
  /** The dock's share of the window's width, where the bezel puts it. */
  private share: number;
  /** Where the drawer tab's middle is, as a share of the height (0–1). */
  private handleAt: number;
  private shown = false;
  /** The drawer is open (else just its tab shows against the right edge). */
  private open = false;
  /** Constructed: draw() may tell the owner (it isn't holding the dock yet before). */
  private built = false;

  constructor(
    /** The dock opened, closed, or its bezel moved: the canvas re-centers its viewable area. */
    private readonly onLayout: () => void,
    /** The front tab changed, or the dock opened or closed (the window's title names the front file). */
    private readonly onFront: () => void = () => {},
  ) {
    this.el = h('div', { className: 'mapper-dock' });
    const resizer = h('div', { className: 'mapper-dock-resizer', role: 'separator', title: 'Drag to resize · click to close' });
    resizer.addEventListener('pointerdown', (e) => this.pressResizer(e));

    const panel = h('div', { className: 'mapper-dock-panel' });
    this.tabsEl = h('div', { className: 'mapper-dock-tabs', role: 'tablist' });
    this.bodyEl = h('div', { className: 'mapper-dock-body' });
    this.empty = h('div', { className: 'mapper-dock-empty', textContent: 'Double-click a node to open its file here.' });
    this.bodyEl.append(this.empty);
    panel.append(this.tabsEl, this.bodyEl);

    this.handle = h('button', { type: 'button', className: 'mapper-dock-handle', title: 'Click to open · drag to move' });
    this.handle.addEventListener('pointerdown', (e) => this.pressHandle(e));
    this.handle.addEventListener('click', (e) => {
      if (e.detail === 0) this.setOpen(true); // keyboard
    });
    this.el.append(resizer, panel, this.handle);

    const saved = Number(storage(KEY_SHARE) ?? NaN);
    this.share = Number.isFinite(saved) && saved > 0 && saved < 1 ? saved : DEFAULT_SHARE;
    const at = Number(storage(KEY_HANDLE) ?? NaN);
    this.handleAt = Number.isFinite(at) && at >= 0 && at <= 1 ? at : 0.5;
    this.draw();
    this.built = true;
  }

  /** The dock is in use (the paneled UI is on). */
  get visible(): boolean {
    return this.shown;
  }
  set visible(on: boolean) {
    this.shown = on;
    this.draw();
  }

  /** Collapsed to the drawer tab (it closes by itself when its last file is closed). */
  get collapsed(): boolean {
    return !this.open;
  }

  /**
   * Room at the right of the canvas outside its viewable area, in px: the dock's width where the
   * bezel puts it — open, closed, or not in use.
   */
  get reserve(): number {
    return this.clampedWidth();
  }

  /** The path of the tab in front, if any. */
  get selected(): string | null {
    return this.current?.path ?? null;
  }

  /** Whether the keyboard focus is in the front file's editor. */
  get focused(): boolean {
    return this.open && !!this.current?.body.contains(document.activeElement);
  }

  /** Adds a tab for `path` showing `content`, and brings it to the front. */
  add(path: string, title: string, tooltip: string, content: HTMLElement, onClose: () => void): void {
    const button = h('button', { type: 'button', className: 'nx-tab mapper-dock-tab', title: tooltip });
    button.setAttribute('role', 'tab');
    const label = h('span', { className: 'mapper-dock-tab-label', textContent: title });
    const close = h('span', { className: 'mapper-dock-tab-close', title: 'Close', textContent: '×' });
    button.append(label, close);
    const body = h('div', { className: 'mapper-dock-page' });
    body.append(content);
    const tab: Tab = { path, button, label, body, onClose };
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if ((e.target as Element).closest('.mapper-dock-tab-close')) return;
      this.select(path);
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove(path);
    });
    button.addEventListener('click', (e) => {
      if (e.detail === 0) this.select(path); // keyboard
    });
    this.tabs.push(tab);
    this.tabsEl.append(button);
    this.bodyEl.append(body);
    this.select(path);
  }

  /** Brings the file's tab to the front (opening the drawer). */
  select(path: string): void {
    const tab = this.tabs.find((t) => t.path === path);
    if (!tab) return;
    this.current = tab;
    if (!this.open) this.setOpen(true);
    else this.draw();
    tab.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** The tab's label: the file's name, with a bullet while it has unsaved changes. */
  setTitle(path: string, title: string): void {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab) tab.label.textContent = title;
  }

  /** Closes the file's tab (its owner's onClose runs); the next one comes to the front. */
  remove(path: string): void {
    const i = this.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    const [tab] = this.tabs.splice(i, 1);
    tab.button.remove();
    tab.body.remove();
    if (this.current === tab) this.current = this.tabs[Math.min(i, this.tabs.length - 1)] ?? null;
    tab.onClose();
    if (!this.tabs.length) this.setOpen(false);
    else this.draw();
  }

  /** Closes the drawer to its tab (its files stay open). */
  collapse(): void {
    this.setOpen(false);
  }

  /** The window was resized: the dock keeps its share of the width, within its room. */
  fit(): void {
    if (this.shown && this.open) this.el.style.width = `${this.clampedWidth()}px`;
  }

  private setOpen(on: boolean): void {
    if (this.open === on) return;
    this.open = on;
    this.draw();
    this.onLayout();
  }

  private room(): number {
    return this.el.parentElement?.clientWidth || window.innerWidth;
  }

  private clampedWidth(): number {
    const room = this.room();
    return Math.round(Math.max(0, Math.min(MIN_WIDTH, room - MIN_CANVAS), Math.min(this.share * room, room - MIN_CANVAS)));
  }

  private draw(): void {
    this.el.hidden = !this.shown;
    this.el.classList.toggle('collapsed', !this.open);
    this.el.style.width = this.open ? `${this.clampedWidth()}px` : '';
    this.handle.textContent = this.tabs.length ? `Files (${this.tabs.length})` : 'Files';
    this.handle.style.top = `${this.handleAt * 100}%`;
    for (const t of this.tabs) {
      const on = t === this.current;
      t.button.classList.toggle('selected', on);
      t.button.setAttribute('aria-selected', String(on));
      t.body.hidden = !on;
    }
    this.el.classList.toggle('empty', !this.tabs.length);
    this.empty.hidden = this.tabs.length > 0;
    if (this.built) this.onFront();
  }

  /** The resizer: a drag resizes the dock; a click closes the drawer. */
  private pressResizer(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const w0 = this.clampedWidth();
    startDrag(e, {
      threshold: DRAG,
      move: (dx) => {
        const room = this.room();
        this.share = Math.max(MIN_WIDTH, w0 - dx) / room;
        this.el.style.width = `${this.clampedWidth()}px`;
        this.onLayout();
      },
      end: (moved) => {
        if (!moved) return this.setOpen(false);
        this.share = this.clampedWidth() / this.room();
        storage(KEY_SHARE, this.share.toFixed(4));
      },
    });
  }

  /** The drawer tab: a drag moves it up or down the edge; a click opens the drawer. */
  private pressHandle(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = this.el.getBoundingClientRect();
    const half = this.handle.offsetHeight / 2;
    const y0 = box.height * this.handleAt;
    startDrag(e, {
      threshold: DRAG,
      move: (_dx, dy) => {
        const y = Math.max(half, Math.min(box.height - half, y0 + dy));
        this.handleAt = box.height ? y / box.height : 0.5;
        this.handle.style.top = `${this.handleAt * 100}%`;
      },
      end: (moved) => {
        if (!moved) return this.setOpen(true);
        storage(KEY_HANDLE, this.handleAt.toFixed(4));
      },
    });
  }
}
