import type { NxDesktop, NxFrame, NxMenu, NxWindow } from '../widgets';

/*
 * Window frames remembered in this browser (localStorage), so windows come back where they
 * were left across launches. A window is remembered by name; its size only if it is
 * resizable (a fixed panel's size belongs to the code).
 */

const PREFIX = 'app-mapper.frame:';

/** Reads or writes (null removes) a stored string; storage may be unavailable. */
export function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: nothing is remembered.
  }
  return null;
}

function load(name: string): Partial<NxFrame> | null {
  try {
    const f = JSON.parse(storage(PREFIX + name) ?? 'null');
    return f && typeof f.x === 'number' && typeof f.y === 'number' ? f : null;
  } catch {
    return null;
  }
}

function save(name: string, f: Partial<NxFrame>): void {
  storage(PREFIX + name, JSON.stringify(f));
}

/**
 * Shows `win` on `desk` at its remembered frame (pulled back on screen if the desktop has
 * shrunk), else at `fallback`, and remembers it whenever the user moves or resizes it.
 * Returns whether a remembered frame was used.
 */
export function showRemembered(
  desk: NxDesktop,
  win: NxWindow,
  name: string,
  fallback: { x: number; y: number; width?: number; height?: number },
  opts: { key?: boolean } = {},
): boolean {
  const saved = load(name);
  const f = saved ?? fallback;
  const width = win.resizable ? f.width ?? fallback.width : undefined;
  const height = win.resizable ? f.height ?? fallback.height : undefined;
  if (width !== undefined && height !== undefined) win.resize(Math.min(width, desk.width), Math.min(height, desk.height));
  desk.addWindow(win, Math.max(0, Math.min(f.x!, desk.width - 60)), Math.max(0, Math.min(f.y!, desk.height - 30)), opts);
  win.onFrameChange = (w) => {
    const { x, y, width, height } = w.frame;
    save(name, w.resizable ? { x, y, width, height } : { x, y });
  };
  return !!saved;
}

/** Puts the menu where it was left, and remembers where it is dragged. */
export function rememberMenu(desk: NxDesktop, menu: NxMenu, name: string): void {
  const saved = load(name);
  desk.place(menu, saved ? Math.max(0, Math.min(saved.x!, desk.width - 60)) : 0, saved ? Math.max(0, Math.min(saved.y!, desk.height - 30)) : 0);
  menu.onMoved = (m) => save(name, { x: m.x, y: m.y });
}
