/*
 * App Mapper's Electron main process: one window showing the app (the Vite dev server's page
 * under `npm run app`, else the built dist/index.html); the application menu, as the page
 * describes it; file access for the page (Markdown and .json files only; folder listings of
 * project files for the page's Open and New Project panels); and the auto-recovery store. The
 * page talks to it through preload.cts (the contract is api.d.ts).
 *
 * Closing the window (or quitting) first asks the page, which may ask the user to save — in a
 * native alert it asks for (`confirm`), shown with the app brought forward to get attention.
 *
 * The window shows once the page has drawn, or after a few seconds regardless, so a page that
 * fails (a crashed or blocked renderer, say) never leaves the app running unseen; failures are
 * reported in an alert and logged to app-mapper.log in the app's user-data folder.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, screen, shell, type MenuItemConstructorOptions } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs, appendFileSync, mkdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfirmOptions, MenuSpec, Recovery } from './api.js';
import { showContextMenu } from './context-menu.js';
import { isProjectFile, listProjects, readText, scan } from './scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_MAC = process.platform === 'darwin';

let win: BrowserWindow | null = null;
/** The page has said it will answer close requests (it may not have loaded, or may have crashed). */
let pageAnswers = false;
let allowClose = false;
let asking = false;
let quitting = false;

// ---------------------------------------------------------------------------------------
// Log

const logFile = () => path.join(app.getPath('userData'), 'app-mapper.log');

/** Appends a line to app-mapper.log (startup and renderer failures, for diagnosis). */
function log(message: string): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    appendFileSync(logFile(), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Not logged.
  }
}

/** Says the page failed, once per kind of failure, in a native alert. */
const reported = new Set<string>();
function reportFailure(kind: string, detail: string): void {
  log(`${kind}: ${detail}`);
  if (reported.has(kind)) return;
  reported.add(kind);
  dialog.showErrorBox('App Mapper', `${kind}: ${detail}\n\nDetails are logged in ${logFile()}`);
}

// ---------------------------------------------------------------------------------------
// Window

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds(): Bounds {
  try {
    const b = JSON.parse(readFileSync(boundsFile(), 'utf8')) as Bounds;
    if (!(b.width > 200 && b.height > 200)) throw new Error('too small');
    // Somewhere no display is any more (a monitor gone): let the window be placed afresh.
    const onScreen =
      b.x === undefined ||
      b.y === undefined ||
      screen.getAllDisplays().some(({ workArea: a }) => b.x! < a.x + a.width - 100 && b.x! + b.width > a.x + 100 && b.y! >= a.y - 10 && b.y! < a.y + a.height - 50);
    return onScreen ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch {
    // First launch: the default size.
  }
  return { width: 1400, height: 900 };
}

function saveBounds(w: BrowserWindow): void {
  try {
    const b: Bounds = { ...w.getNormalBounds(), maximized: w.isMaximized() };
    writeFileSync(boundsFile(), JSON.stringify(b));
  } catch {
    // Not remembered.
  }
}

function createWindow(): void {
  const b = loadBounds();
  const w = new BrowserWindow({
    ...b,
    minWidth: 800,
    minHeight: 500,
    title: 'App Mapper',
    backgroundColor: '#4f5170',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win = w;
  if (b.maximized) w.maximize();
  // Shown once drawn — or after a few seconds regardless, so a page that never draws doesn't
  // leave the app running unseen (and holding the single-instance lock).
  const reveal = () => {
    if (!w.isDestroyed() && !w.isVisible()) w.show();
  };
  w.once('ready-to-show', reveal);
  setTimeout(() => {
    if (!w.isDestroyed() && !w.isVisible()) log('The page had not drawn after 5s; showing the window anyway.');
    reveal();
  }, 5000);
  w.webContents.on('did-fail-load', (_e, code, description, url, mainFrame) => {
    if (!mainFrame) return;
    reveal();
    reportFailure('The app’s page didn’t load', `${description} (${code}) — ${url}`);
  });

  // Links open in the system browser; the window never navigates away from the app.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:/i.test(url) && !(DEV_URL && url.startsWith(DEV_URL))) void shell.openExternal(url);
    }
  });
  w.webContents.on('did-start-loading', () => {
    pageAnswers = false;
    setMenu(DEFAULT_MENU);
  });
  w.webContents.on('context-menu', (_e, params) => showContextMenu(w, params, !!DEV_URL));
  w.webContents.on('render-process-gone', (_e, d) => {
    pageAnswers = false;
    if (d.reason === 'clean-exit') return;
    reveal();
    reportFailure('The app’s page stopped', `${d.reason} (exit code ${d.exitCode})`);
  });

  w.on('close', (e) => {
    if (allowClose || !pageAnswers) {
      saveBounds(w);
      return;
    }
    e.preventDefault();
    if (asking) return;
    asking = true;
    w.webContents.send('close-request');
  });
  w.on('closed', () => {
    win = null;
  });

  if (DEV_URL) void w.loadURL(DEV_URL);
  else void w.loadFile(path.join(here, '..', 'dist', 'index.html'));
}

// ---------------------------------------------------------------------------------------
// Menu

/** Electron's standard items the page may use in its menu. */
const ROLES = new Set([
  'editMenu', 'windowMenu', 'viewMenu', 'close', 'quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen', 'minimize', 'zoom', 'front',
]);

function toItem(s: MenuSpec): MenuItemConstructorOptions {
  if (s.separator) return { type: 'separator' };
  if (s.role) {
    if (!ROLES.has(s.role)) return { type: 'separator', visible: false };
    return { role: s.role as MenuItemConstructorOptions['role'], ...(s.label ? { label: s.label } : {}) };
  }
  const command = s.command;
  return {
    label: s.label ?? '',
    accelerator: s.accelerator,
    enabled: s.enabled ?? true,
    ...(s.checked !== undefined ? { type: s.radio ? ('radio' as const) : ('checkbox' as const), checked: s.checked } : {}),
    ...(s.submenu ? { submenu: s.submenu.map(toItem) } : {}),
    ...(command ? { click: () => win?.webContents.send('menu', command) } : {}),
  };
}

/** Until the page sends its own (and after it reloads): just the standard menus. */
const DEFAULT_MENU: MenuSpec[] = [
  { label: 'File', submenu: [{ role: IS_MAC ? 'close' : 'quit' }] },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' },
];

/** The application menu: the app menu on macOS, then the page's menus (File, Edit, Canvas, View, Window). */
function setMenu(spec: MenuSpec[]): void {
  const template: MenuItemConstructorOptions[] = [...(IS_MAC ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []), ...spec.map(toItem)];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('set-menu', (e, spec: unknown) => {
  if (e.sender !== win?.webContents || !Array.isArray(spec)) return;
  setMenu(spec as MenuSpec[]);
});

// ---------------------------------------------------------------------------------------
// Files

function checked(p: unknown): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('An absolute path is required.');
  if (!isProjectFile(p)) throw new Error('Only Markdown and .json files can be read or written.');
  return path.resolve(p);
}

ipcMain.handle('info', () => ({ user: os.userInfo().username, home: os.homedir(), cwd: process.cwd(), platform: process.platform }));

// Windows: each drive letter that answers within a moment (a mapped drive whose server is gone
// can take a long time to fail). A and B are left out: probing an empty floppy drive can hang.
ipcMain.handle('roots', async () => {
  if (process.platform !== 'win32') return ['/'];
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const answers = await Promise.all(
    letters.map((l) =>
      Promise.race([
        fs.access(`${l}:\\`).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
      ]),
    ),
  );
  return letters.filter((_, i) => answers[i]).map((l) => `${l}:\\`);
});

ipcMain.handle('list', (_e, dir: unknown) => {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('An absolute path is required.');
  return listProjects(path.resolve(dir));
});

ipcMain.handle('mkdir', async (_e, p: unknown) => {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('An absolute path is required.');
  await fs.mkdir(path.resolve(p));
});

ipcMain.handle('scan', (_e, root: unknown) => {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('An absolute path is required.');
  return scan(path.resolve(root));
});
ipcMain.handle('read', (_e, p: unknown) => readText(checked(p)));
ipcMain.handle('write', async (_e, p: unknown, text: unknown) => {
  if (typeof text !== 'string') throw new Error('Nothing to write.');
  await fs.writeFile(checked(p), text, 'utf8');
});

// ---------------------------------------------------------------------------------------
// Auto-recovery: each open project's unsaved changes, kept in the app's data folder until
// they are saved or discarded. A record left behind means the app didn't close cleanly.

const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const recoveryFile = (project: string) => path.join(recoveryDir(), `${createHash('sha1').update(path.resolve(project)).digest('hex').slice(0, 20)}.json`);

function putRecovery(project: unknown, r: Recovery): void {
  if (typeof project !== 'string') throw new Error('No project.');
  mkdirSync(recoveryDir(), { recursive: true });
  const file = recoveryFile(project);
  writeFileSync(`${file}.tmp`, JSON.stringify({ project: path.resolve(project), ...r }));
  renameSync(`${file}.tmp`, file);
}

ipcMain.handle('recovery-get', async (_e, project: unknown) => {
  if (typeof project !== 'string') return null;
  try {
    const r = JSON.parse(await fs.readFile(recoveryFile(project), 'utf8')) as Recovery & { project: string };
    return r.project === path.resolve(project) ? { time: r.time, map: r.map, docs: r.docs } : null;
  } catch {
    return null;
  }
});
ipcMain.handle('recovery-put', (_e, project: unknown, r: Recovery) => putRecovery(project, r));
ipcMain.on('recovery-put-sync', (e, project: unknown, r: Recovery) => {
  try {
    putRecovery(project, r);
  } catch {
    // Best effort while unloading.
  }
  e.returnValue = true;
});
ipcMain.handle('recovery-clear', async (_e, project: unknown) => {
  if (typeof project === 'string') await fs.rm(recoveryFile(project), { force: true });
});

// ---------------------------------------------------------------------------------------
// Window state and closing

ipcMain.on('set-edited', (_e, edited: unknown, file: unknown) => {
  if (!win || !IS_MAC) return;
  win.setDocumentEdited(!!edited);
  win.setRepresentedFilename(typeof file === 'string' ? file : '');
});

/**
 * Brings the window forward to ask something: out of the Dock (or hidden), and the app made
 * active. On macOS the Dock icon bounces until the app is active — which it stops doing at once
 * if the app could come forward; elsewhere the taskbar button flashes until the window has focus.
 */
function getAttention(w: BrowserWindow): void {
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  if (w.isFocused()) return;
  if (IS_MAC) {
    app.dock?.bounce('critical');
    app.focus({ steal: true });
  } else {
    w.flashFrame(true);
    w.once('focus', () => w.flashFrame(false));
  }
  w.focus();
}

ipcMain.handle('confirm', async (e, o: ConfirmOptions) => {
  const w = win;
  const ok =
    !!o &&
    typeof o.message === 'string' &&
    Array.isArray(o.buttons) &&
    o.buttons.length > 0 &&
    o.buttons.every((b) => typeof b === 'string') &&
    Number.isInteger(o.defaultId) &&
    Number.isInteger(o.cancelId);
  if (!w || e.sender !== w.webContents || !ok) return null;
  getAttention(w);
  const r = await dialog.showMessageBox(w, {
    type: 'warning',
    message: o.message,
    detail: typeof o.detail === 'string' ? o.detail : undefined,
    buttons: o.buttons,
    defaultId: o.defaultId,
    cancelId: o.cancelId,
    noLink: true,
  });
  return r.response;
});

ipcMain.on('close-handler', () => (pageAnswers = true));
ipcMain.on('close-confirmed', () => {
  asking = false;
  allowClose = true;
  if (quitting) app.quit();
  else win?.close();
});
ipcMain.on('close-cancelled', () => {
  asking = false;
  quitting = false;
});

// ---------------------------------------------------------------------------------------
// App

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  });
  app.on('child-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') log(`${d.type} process gone: ${d.reason} (exit code ${d.exitCode})`);
  });
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    setMenu(DEFAULT_MENU);
    createWindow();
    // For automated checks only: reach the menu and window from a debugger.
    if (process.env.APP_MAPPER_TEST) Object.assign(globalThis, { appMapperTest: { Menu, dialog, win: () => win, app } });
  });
}
