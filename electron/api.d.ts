/*
 * The contract between App Mapper's page and its Electron main process: what the preload
 * script (preload.cts) exposes to the page as `window.appMapper`. The page uses it through
 * the Host in src/modules/mapper/host.ts, which has a dev-server equivalent for browsers.
 *
 * Paths are absolute, in the platform's own form.
 */

export interface ScanResult {
  /** Every Markdown file under the root, relative and '/'-separated. */
  files: string[];
  /** Every folder, '' being the root. */
  dirs: string[];
}

export interface HostInfo {
  /** The OS user name (the editors' default author). */
  user: string;
  home: string;
  cwd: string;
  platform: string;
}

/** Unsaved changes kept aside while a project is open, so a crash doesn't lose them. */
export interface Recovery {
  /** When they were kept (ms since the epoch). */
  time: number;
  /** The project file's unsaved text, if it has changes. */
  map: string | null;
  /** Unsaved Markdown files: path relative to the project root → text. */
  docs: Record<string, string>;
}

/**
 * A command from the application menu: one of the page's own (see `MenuSpec.command`), such as
 * `save` or `add-file:notes/a.md`.
 */
export type MenuCommand = string;

/**
 * One item of the application menu, as the page describes it (it owns the menu: its items
 * follow what is open and selected). Serializable, so the main process can build the native
 * menu from it; `role` items are Electron's standard ones (`editMenu`, `close`, `reload`…).
 */
export interface MenuSpec {
  label?: string;
  /** Sent back to the page when chosen. */
  command?: MenuCommand;
  accelerator?: string;
  /** Default true. */
  enabled?: boolean;
  /** A check box item when set (a radio item, with `radio`). */
  checked?: boolean;
  /** With `checked`: one of a group of choices (the items next to it with `radio`), exactly one checked. */
  radio?: boolean;
  submenu?: MenuSpec[];
  separator?: boolean;
  role?: string;
}

/** A native alert with buttons (see ElectronApi.confirm). */
export interface ConfirmOptions {
  message: string;
  detail?: string;
  /** Left to right as the page lists them; the platform lays them out (on macOS the first is rightmost). */
  buttons: string[];
  /** The button Return presses. */
  defaultId: number;
  /** The button Escape presses. */
  cancelId: number;
}

export interface ElectronApi {
  info(): Promise<HostInfo>;
  /**
   * The roots the Open and New Project panels start from: `/` on macOS; on Windows every drive
   * that answers (local or mapped, as `C:\\`, `Z:\\`).
   */
  roots(): Promise<string[]>;
  /** A folder's sub-folders (not hidden) and the valid project files in it, for the Open and New Project panels. */
  list(dir: string): Promise<{ dirs: string[]; files: string[] }>;
  /** Creates one folder (its parent must exist; it must not). For the New Project panel's Create Folder…. */
  mkdir(path: string): Promise<void>;
  scan(root: string): Promise<ScanResult>;
  /** The file's text, or null if there is no such file. Markdown and .json files only. */
  read(path: string): Promise<string | null>;
  /** Creates or replaces the file (its folder must exist). Markdown and .json files only. */
  write(path: string, text: string): Promise<void>;
  recoveryGet(project: string): Promise<Recovery | null>;
  recoveryPut(project: string, r: Recovery): Promise<void>;
  /** The same, synchronously: for the moment the page is unloading. */
  recoveryPutSync(project: string, r: Recovery): void;
  recoveryClear(project: string): Promise<void>;
  /** Marks the window as having unsaved changes (the dot in macOS's close button) and the file it shows. */
  setEdited(edited: boolean, file: string | null): void;
  /** Replaces the application menu (File, Canvas, View…). */
  setMenu(menu: MenuSpec[]): void;
  onMenu(f: (cmd: MenuCommand) => void): void;
  /**
   * Asks in a native alert (a sheet on the window, on macOS), first bringing the app forward —
   * the Dock icon bounces if it can't come forward by itself. Resolves with the button pressed;
   * null where there is no native alert (a browser: the page asks itself).
   */
  confirm(o: ConfirmOptions): Promise<number | null>;
  /** The window is about to close (or the app to quit): answer with close() or cancelClose(). */
  onCloseRequest(f: () => void): void;
  close(): void;
  cancelClose(): void;
}
