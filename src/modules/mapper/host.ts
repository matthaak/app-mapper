/*
 * What App Mapper runs in, behind one interface:
 *  - Electron: the main process, through the preload's `window.appMapper` (electron/api.d.ts):
 *    the files, the application menu, and auto-recovery on disk.
 *  - Dev: a plain browser under `npm run dev`, through the dev server's /__fs API
 *    (server/fs-api.ts); ⌘S / ⌘⌥S stand in for the menu, and auto-recovery data is kept in
 *    localStorage.
 * Either way, projects are picked in the app's own NeXT panels, which list only valid
 * project files.
 * Paths are absolute, in the platform's own form; inside a project they are '/'-separated.
 */
import type { ConfirmOptions, ElectronApi, HostInfo, MenuCommand, MenuSpec, Recovery, ScanResult } from '../../../electron/api';

export type { ConfirmOptions, HostInfo, MenuCommand, MenuSpec, Recovery, ScanResult };

export interface Host extends ElectronApi {
  readonly kind: 'electron' | 'dev';
}

/** The host this page runs in, or null with neither Electron nor the dev server (a static build in a browser). */
export async function connect(): Promise<Host | null> {
  const electron = (window as unknown as { appMapper?: ElectronApi }).appMapper;
  if (electron) return { ...electron, kind: 'electron' };
  try {
    const info = await api<HostInfo>('info');
    return new DevHost(info);
  } catch {
    return null;
  }
}

// ---- Paths ----

const sepOf = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');

/** Joins an absolute folder and a relative ('/'-separated) path with the folder's own separator. */
export function joinAbs(dir: string, rel: string): string {
  const sep = sepOf(dir);
  const tail = sep === '/' ? rel : rel.replace(/\//g, sep);
  return dir.endsWith(sep) ? dir + tail : `${dir}${sep}${tail}`;
}

/**
 * An absolute path's root and the names after it. Roots are `/`, a drive (`C:\\`) or a Windows
 * network share (`\\\\server\\share\\`).
 */
export function splitAbs(abs: string): { root: string; names: string[] } {
  const unc = /^\\\\[^\\/]+[\\/][^\\/]+/.exec(abs);
  const drive = /^[A-Za-z]:[\\/]/.exec(abs);
  const root = unc ? `${unc[0]}\\` : drive ? drive[0] : '/';
  return { root, names: abs.slice(unc ? unc[0].length : root.length).split(/[\\/]/).filter(Boolean) };
}

/** The folder an absolute path is in. */
export function dirnameAbs(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return p;
  const dir = p.slice(0, i);
  return dir === '' ? '/' : /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir;
}

export function basenameAbs(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

// ---- Dev server ----

const HEADERS = { 'X-App-Mapper': '1' };
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const RECOVERY = 'app-mapper.recovery:';

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/__fs/${path}`, { ...init, headers: { ...HEADERS, ...init.headers } });
  if (!res.ok) throw new Error((await res.text()) || `${res.status} ${res.statusText}`);
  const type = res.headers.get('Content-Type') ?? '';
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>;
}

function local(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable.
  }
  return null;
}

class DevHost implements Host {
  readonly kind = 'dev';

  constructor(private readonly about: HostInfo) {}

  async info(): Promise<HostInfo> {
    return this.about;
  }

  /** The root of the dev server's home folder (the dev server lists no drives). */
  async roots(): Promise<string[]> {
    return [splitAbs(this.about.home).root];
  }

  list(dir: string): Promise<{ dirs: string[]; files: string[] }> {
    return api(`list?path=${encodeURIComponent(dir)}`);
  }

  async mkdir(path: string): Promise<void> {
    await api(`mkdir?path=${encodeURIComponent(path)}`, { method: 'POST' });
  }

  scan(root: string): Promise<ScanResult> {
    return api(`scan?root=${encodeURIComponent(root)}`);
  }

  async read(path: string): Promise<string | null> {
    const res = await fetch(`/__fs/read?path=${encodeURIComponent(path)}`, { headers: HEADERS });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  }

  async write(path: string, text: string): Promise<void> {
    await api(`write?path=${encodeURIComponent(path)}`, { method: 'PUT', body: text });
  }

  async recoveryGet(project: string): Promise<Recovery | null> {
    try {
      return JSON.parse(local(RECOVERY + project) ?? 'null') as Recovery | null;
    } catch {
      return null;
    }
  }
  async recoveryPut(project: string, r: Recovery): Promise<void> {
    this.recoveryPutSync(project, r);
  }
  recoveryPutSync(project: string, r: Recovery): void {
    local(RECOVERY + project, JSON.stringify(r));
  }
  async recoveryClear(project: string): Promise<void> {
    local(RECOVERY + project, null);
  }

  setEdited(): void {
    // The page title shows it.
  }

  setMenu(): void {
    // No application menu in a browser: the page shows the same menus as a NeXT menu itself.
  }

  /** ⌘S saves, ⌘⌥S saves all (Ctrl elsewhere): the browser has no application menu. */
  onMenu(f: (cmd: MenuCommand) => void): void {
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyS' || !(IS_MAC ? e.metaKey : e.ctrlKey) || e.shiftKey) return;
      e.preventDefault();
      f(e.altKey ? 'save-all' : 'save');
    });
  }

  /** No native alerts in a browser: the page shows its own. */
  async confirm(): Promise<null> {
    return null;
  }

  // A browser tab asks on leaving by itself (beforeunload).
  onCloseRequest(): void {}
  close(): void {}
  cancelClose(): void {}
}
