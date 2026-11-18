/*
 * MD Editor's Electron main process: Markdown files edited directly, one window per document,
 * in the same editor App Mapper uses (src/md-app.ts, around the MD Editor module) — without
 * projects, the canvas or the map. The page talks to it through md-preload.cts (the contract is
 * md-api.d.ts).
 *
 * Everything around the editor is native: the File menu (New, Open…, Open Recent, Close, Save,
 * Save As…), the open and save dialogs, Edit, View (Electron's own items, and Theme) and Window;
 * the alert asking to save before a window with unsaved changes closes. Files also open from
 * the Finder or Explorer (and from the command line), into the window already showing them, or
 * an untouched Untitled one.
 *
 * Theme, Show Spelling Errors, the recent files and the window size are remembered in
 * settings.json in the app's user-data folder.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, shell, type MenuItemConstructorOptions, type OpenDialogOptions, type WebContents } from 'electron';
import { promises as fs, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfirmOptions } from './api.js';
import { showContextMenu } from './context-menu.js';
import type { MdCommand, MdDoc, MdInit, MdTheme } from './md-api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_MAC = process.platform === 'darwin';
const NAME = 'MD Editor';
const FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'All Files', extensions: ['*'] },
];
const RECENT_LIMIT = 10;

// Its own name and data folder, also when run from the repository (`npm run md`).
app.setName(NAME);
app.setPath('userData', path.join(app.getPath('appData'), NAME));

// ---------------------------------------------------------------------------------------
// Settings

interface Settings {
  /** View ▸ Theme, once chosen (Modern until then). */
  theme?: MdTheme;
  spellcheck: boolean;
  recent: string[];
  size?: { width: number; height: number };
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): Settings {
  const s: Settings = { spellcheck: true, recent: [] };
  try {
    const r = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Settings>;
    if (r.theme === 'classic' || r.theme === 'modern') s.theme = r.theme;
    if (r.spellcheck === false) s.spellcheck = false;
    if (Array.isArray(r.recent)) s.recent = r.recent.filter((p): p is string => typeof p === 'string').slice(0, RECENT_LIMIT);
    if (r.size && r.size.width > 300 && r.size.height > 200) s.size = { width: r.size.width, height: r.size.height };
  } catch {
    // First launch: the defaults.
  }
  return s;
}

let settings = loadSettings();

function saveSettings(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch {
    // Not remembered.
  }
}

function addRecent(file: string): void {
  settings.recent = [file, ...settings.recent.filter((p) => p !== file)].slice(0, RECENT_LIMIT);
  saveSettings();
  app.addRecentDocument(file);
  setMenu();
}

// ---------------------------------------------------------------------------------------
// Documents: one window each

interface Doc {
  win: BrowserWindow;
  path: string | null;
  /** For an untitled document: which Untitled it is (1 is plain "Untitled"). */
  untitled: number;
  text: string;
  edited: boolean;
  /** The page has said it will answer close requests (it may not have loaded, or may have crashed). */
  answers: boolean;
  asking: boolean;
  allowClose: boolean;
}

const docs = new Map<WebContents, Doc>();
let quitting = false;
/** Files asked to open before the app was ready (from the Finder, at launch). */
const pending: string[] = [];
let ready = false;

const nameOf = (d: Doc) => (d.path ? path.basename(d.path) : d.untitled > 1 ? `Untitled ${d.untitled}` : 'Untitled');
const docOf = (wc: WebContents) => docs.get(wc);
const asDoc = (d: Doc): MdDoc => ({ path: d.path, name: nameOf(d), text: d.text });

function nextUntitled(): number {
  const used = new Set([...docs.values()].filter((d) => !d.path).map((d) => d.untitled));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** The window's title and (on macOS) its file and unsaved-changes dot. */
function showState(d: Doc): void {
  d.win.setTitle(`${d.edited && !IS_MAC ? '• ' : ''}${nameOf(d)}`);
  if (IS_MAC) {
    d.win.setDocumentEdited(d.edited);
    d.win.setRepresentedFilename(d.path ?? '');
  }
}

function createWindow(file: string | null, text: string): Doc {
  const near = BrowserWindow.getFocusedWindow();
  const size = settings.size ?? { width: 900, height: 760 };
  const at = near ? { x: near.getBounds().x + 22, y: near.getBounds().y + 22 } : {};
  const win = new BrowserWindow({
    ...size,
    ...at,
    minWidth: 420,
    minHeight: 300,
    title: NAME,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(here, 'md-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const d: Doc = { win, path: file, untitled: file ? 0 : nextUntitled(), text, edited: false, answers: false, asking: false, allowClose: false };
  const wc = win.webContents;
  docs.set(wc, d);
  showState(d);

  const reveal = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  win.once('ready-to-show', reveal);
  setTimeout(reveal, 5000);
  // The window's title is the document's, not the page's.
  win.on('page-title-updated', (e) => e.preventDefault());
  // Links open in the system browser; the window never navigates away from the editor.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url === wc.getURL()) return;
    e.preventDefault();
    if (/^https?:/i.test(url) && !(DEV_URL && url.startsWith(DEV_URL))) void shell.openExternal(url);
  });
  wc.on('did-start-loading', () => (d.answers = false));
  wc.on('render-process-gone', () => (d.answers = false));
  wc.on('context-menu', (_e, params) => showContextMenu(win, params, !!DEV_URL));

  // Closing asks the page first (it may have edits not yet reported, and asks about unsaved changes).
  win.on('close', (e) => {
    if (d.allowClose || !d.answers) {
      if (!win.isMaximized() && !win.isFullScreen()) {
        settings.size = { width: win.getNormalBounds().width, height: win.getNormalBounds().height };
        saveSettings();
      }
      return;
    }
    e.preventDefault();
    if (d.asking) return;
    d.asking = true;
    if (win.isMinimized()) win.restore();
    wc.send('md-close-request');
  });
  win.on('closed', () => {
    docs.delete(wc);
    setMenu();
  });
  win.on('focus', () => setMenu());

  if (DEV_URL) void win.loadURL(new URL('md-app.html', DEV_URL).toString());
  else void win.loadFile(path.join(here, '..', 'dist', 'md-app.html'));
  setMenu();
  return d;
}

/** Opens a file: brings forward the window already showing it, else loads it (into an untouched Untitled window, if that is in front). */
async function openFile(file: string): Promise<void> {
  const target = path.resolve(file);
  const open = [...docs.values()].find((d) => d.path === target);
  if (open) {
    if (open.win.isMinimized()) open.win.restore();
    open.win.focus();
    return;
  }
  let text: string;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch (err) {
    settings.recent = settings.recent.filter((p) => p !== target);
    saveSettings();
    setMenu();
    dialog.showErrorBox(NAME, `“${path.basename(target)}” couldn’t be opened.\n\n${(err as Error).message}`);
    return;
  }
  addRecent(target);
  const front = BrowserWindow.getFocusedWindow();
  const blank = front ? docOf(front.webContents) : undefined;
  if (blank && !blank.path && !blank.edited && !blank.text && blank.answers) {
    Object.assign(blank, { path: target, untitled: 0, text });
    showState(blank);
    blank.win.webContents.send('md-load', asDoc(blank));
    return;
  }
  createWindow(target, text);
}

async function openDialog(): Promise<void> {
  const front = BrowserWindow.getFocusedWindow();
  const file = front ? docOf(front.webContents)?.path : null;
  const o: OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: FILTERS, defaultPath: file ? path.dirname(file) : undefined };
  const r = front ? await dialog.showOpenDialog(front, o) : await dialog.showOpenDialog(o);
  if (!r.canceled) for (const f of r.filePaths) await openFile(f);
}

/** Sends a menu command to the document in front. */
function command(cmd: MdCommand): void {
  const w = BrowserWindow.getFocusedWindow();
  if (w && docOf(w.webContents)) w.webContents.send('md-command', cmd);
}

// ---------------------------------------------------------------------------------------
// Menu

/** The theme: as chosen, else Modern. */
const theme = (): MdTheme => settings.theme ?? 'modern';

function setTheme(theme: MdTheme): void {
  settings.theme = theme;
  saveSettings();
  for (const d of docs.values()) d.win.webContents.send('md-theme', theme);
  setMenu();
}

function setMenu(): void {
  const front = BrowserWindow.getFocusedWindow();
  const hasDoc = !!front && !!docOf(front.webContents);
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  const recent: MenuItemConstructorOptions[] = settings.recent.length
    ? [...settings.recent.map((p) => ({ label: path.basename(p), sublabel: path.dirname(p), toolTip: p, click: () => void openFile(p) })), sep, { label: 'Clear Menu', click: () => clearRecent() }]
    : [{ label: 'No Recent Files', enabled: false }];
  const template: MenuItemConstructorOptions[] = [
    ...(IS_MAC ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow(null, '') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => void openDialog() },
        { label: 'Open Recent', submenu: recent },
        sep,
        { role: 'close' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', enabled: hasDoc, click: () => command('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', enabled: hasDoc, click: () => command('save-as') },
        ...(IS_MAC ? [] : [sep, { role: 'quit' } as MenuItemConstructorOptions]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Theme',
          submenu: [
            { label: 'Classic', type: 'radio', checked: theme() === 'classic', click: () => setTheme('classic') },
            { label: 'Modern', type: 'radio', checked: theme() === 'modern', click: () => setTheme('modern') },
          ],
        },
        sep,
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        sep,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        sep,
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function clearRecent(): void {
  settings.recent = [];
  saveSettings();
  app.clearRecentDocuments();
  setMenu();
}

// ---------------------------------------------------------------------------------------
// The page's requests

ipcMain.handle('md-init', (e): MdInit | null => {
  const d = docOf(e.sender);
  if (!d) return null;
  const user = os.userInfo().username.trim().replace(/\W+/g, '_') || 'Me';
  return { ...asDoc(d), user, theme: theme(), spellcheck: settings.spellcheck };
});

ipcMain.handle('md-save', async (e, text: unknown, as: unknown): Promise<MdDoc | null> => {
  const d = docOf(e.sender);
  if (!d || typeof text !== 'string') return null;
  let target = d.path;
  if (as || !target) {
    const r = await dialog.showSaveDialog(d.win, {
      defaultPath: target ?? path.join(app.getPath('documents'), `${nameOf(d)}.md`),
      filters: FILTERS,
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  try {
    await fs.writeFile(target, text, 'utf8');
  } catch (err) {
    await dialog.showMessageBox(d.win, { type: 'error', message: `“${path.basename(target)}” couldn’t be saved.`, detail: (err as Error).message });
    return null;
  }
  Object.assign(d, { path: target, untitled: 0, text, edited: false });
  showState(d);
  addRecent(target);
  return asDoc(d);
});

ipcMain.on('md-edited', (e, edited: unknown) => {
  const d = docOf(e.sender);
  if (!d) return;
  d.edited = !!edited;
  showState(d);
});

ipcMain.on('md-spellcheck', (e, on: unknown) => {
  settings.spellcheck = !!on;
  saveSettings();
  for (const [wc] of docs) if (wc !== e.sender) wc.send('md-spellcheck', settings.spellcheck);
});

ipcMain.handle('md-confirm', async (e, o: ConfirmOptions) => {
  const d = docOf(e.sender);
  const ok =
    !!o &&
    typeof o.message === 'string' &&
    Array.isArray(o.buttons) &&
    o.buttons.length > 0 &&
    o.buttons.every((b) => typeof b === 'string') &&
    Number.isInteger(o.defaultId) &&
    Number.isInteger(o.cancelId);
  if (!d || !ok) return null;
  if (d.win.isMinimized()) d.win.restore();
  d.win.focus();
  const r = await dialog.showMessageBox(d.win, {
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

ipcMain.on('md-close-handler', (e) => {
  const d = docOf(e.sender);
  if (d) d.answers = true;
});
ipcMain.on('md-close-confirmed', (e) => {
  const d = docOf(e.sender);
  if (!d) return;
  d.asking = false;
  d.allowClose = true;
  d.win.close();
  // Quitting goes on to the next window.
  if (quitting) app.quit();
});
ipcMain.on('md-close-cancelled', (e) => {
  const d = docOf(e.sender);
  if (d) d.asking = false;
  quitting = false;
});

// ---------------------------------------------------------------------------------------
// App

/** The files named on a command line (not options, nor the app itself). */
const filesIn = (argv: string[]) => argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && /\.(md|markdown|txt)$/i.test(a));

// Before ready: a file opened from the Finder at launch arrives here first.
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (ready) void openFile(file);
  else pending.push(file);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    const files = filesIn(argv).map((f) => path.resolve(cwd, f));
    if (files.length) for (const f of files) void openFile(f);
    else {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) {
        if (w.isMinimized()) w.restore();
        w.focus();
      } else createWindow(null, '');
    }
  });
  app.on('before-quit', () => (quitting = true));
  // On macOS the app stays open with no windows, as document apps do.
  app.on('window-all-closed', () => {
    if (!IS_MAC || quitting) app.quit();
  });
  app.on('activate', () => {
    if (!docs.size) createWindow(null, '');
  });
  void app.whenReady().then(async () => {
    ready = true;
    setMenu();
    const files = [...pending, ...filesIn(process.argv)];
    for (const f of files) await openFile(f);
    if (!docs.size) createWindow(null, '');
    // For automated checks only: reach the menu, dialogs and windows from a debugger.
    if (process.env.MD_EDITOR_TEST) Object.assign(globalThis, { mdEditorTest: { Menu, dialog, app, docs, openFile } });
  });
}
