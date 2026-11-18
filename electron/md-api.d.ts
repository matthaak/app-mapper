/*
 * The contract between MD Editor's main process (md-main.ts) and its page (src/md-app.ts),
 * exposed by md-preload.cts as `window.mdEditor`. One window per document; the main process
 * owns which file a window shows, and reads and writes it.
 */
import type { ConfirmOptions } from './api';

/** View ▸ Theme. */
export type MdTheme = 'classic' | 'modern';

/** The document a window shows: its file (null until first saved), name and text. */
export interface MdDoc {
  path: string | null;
  /** The file's name, or "Untitled" (numbered after the first). */
  name: string;
  text: string;
}

/** What a window starts with. */
export interface MdInit extends MdDoc {
  /** Who edits (highlights, comments, tracked changes): the computer's user name, else “Me”. */
  user: string;
  theme: MdTheme;
  spellcheck: boolean;
}

/** A command from the menu, for the page to carry out. */
export type MdCommand = 'save' | 'save-as';

export interface MdEditorApi {
  init(): Promise<MdInit>;
  /** Writes `text` to the window's file — asking where first for Save As, or if it has none. Null if cancelled. */
  save(text: string, as: boolean): Promise<MdDoc | null>;
  /** Whether the document has unsaved changes (the window's dot and title). */
  setEdited(edited: boolean): void;
  /** Show Spelling Errors was toggled: remembered, and passed to every other window. */
  setSpellcheck(on: boolean): void;
  /** A native alert on the window; the index of the button chosen. */
  confirm(o: ConfirmOptions): Promise<number | null>;
  onCommand(f: (cmd: MdCommand) => void): void;
  /** Another document is loaded into this (untouched, untitled) window. */
  onLoad(f: (doc: MdDoc) => void): void;
  onTheme(f: (theme: MdTheme) => void): void;
  onSpellcheck(f: (on: boolean) => void): void;
  /** The window is about to close: the page answers with close() or cancelClose(). */
  onCloseRequest(f: () => void): void;
  close(): void;
  cancelClose(): void;
}
