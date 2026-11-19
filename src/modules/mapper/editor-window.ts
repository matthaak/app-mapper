import { MarkdownEditor } from '../md-editor';
import { NxWindow } from '../widgets';
import { basename, dirname } from './docs';
import type { EditorDock } from './editor-dock';

export interface EditorWindowOptions {
  path: string;
  project: string;
  text: string;
  /** Attributes highlights and tracked changes (see the MD Editor). */
  user: string;
  /** Start with Track Changes on. */
  trackChanges: boolean;
  /** Asks the user to confirm (see the MD Editor's `confirm`). */
  confirm(message: string, ok: string): Promise<boolean>;
  /** Show spelling errors (see the MD Editor), and the user's toggling of it. */
  spellcheck: boolean;
  onSpellcheckChange(on: boolean): void;
  onChange(markdown: string): void;
  /** The toolbar's Save button (⌘S). */
  onSave(): void;
  onClose(): void;
}

/** Marks a title that has unsaved changes. */
export const EDITED = '• ';

/**
 * One file open in the MD Editor, in a NeXT window titled like a NeXT document window
 * ("name — folder"), with a bullet while it has unsaved changes. No miniaturize button: a
 * window is open or closed.
 */
export class EditorWindow {
  readonly win: NxWindow;
  readonly editor: MarkdownEditor;
  readonly path: string;
  private readonly title: string;

  constructor(o: EditorWindowOptions) {
    this.path = o.path;
    const dir = dirname(o.path);
    this.title = `${basename(o.path)} — ${o.project}${dir ? `/${dir}` : ''}`;
    this.win = new NxWindow({
      title: this.title,
      miniaturizable: false,
      width: 760,
      height: 600,
      minWidth: 360,
      minHeight: 240,
      onClose: () => {
        this.editor.destroy();
        o.onClose();
      },
    });
    this.win.el.classList.add('mapper-editor');
    this.editor = new MarkdownEditor({
      value: o.text,
      user: o.user,
      trackChanges: o.trackChanges,
      confirm: o.confirm,
      spellcheck: o.spellcheck,
      onSpellcheckChange: o.onSpellcheckChange,
      onChange: (md) => o.onChange(md),
      onSave: () => o.onSave(),
    }).mount(this.win.content);
  }

  /** Replaces the text after it changed elsewhere (on disk, or from the canvas). */
  setText(md: string): void {
    if (this.editor.value !== md) this.editor.value = md;
  }

  /** Shows whether the file has unsaved changes (title bullet, Save button). */
  setEdited(edited: boolean): void {
    this.win.title = `${edited ? EDITED : ''}${this.title}`;
    this.editor.modified = edited;
  }

  /** Reports any edit still pending in the editor (before saving). */
  flush(): void {
    this.editor.flush();
  }

  close(): void {
    this.win.close();
  }
}

/**
 * One file open in the MD Editor in a tab of the paneled UI's dock, labelled with the file's
 * name (a bullet while it has unsaved changes; its path as the tooltip).
 */
export class EditorTab {
  readonly editor: MarkdownEditor;
  readonly path: string;
  private readonly name: string;

  constructor(
    o: EditorWindowOptions,
    private readonly dock: EditorDock,
  ) {
    this.path = o.path;
    this.name = basename(o.path);
    const page = document.createElement('div');
    page.className = 'mapper-dock-editor';
    this.editor = new MarkdownEditor({
      value: o.text,
      user: o.user,
      trackChanges: o.trackChanges,
      confirm: o.confirm,
      spellcheck: o.spellcheck,
      onSpellcheckChange: o.onSpellcheckChange,
      onChange: (md) => o.onChange(md),
      onSave: () => o.onSave(),
    }).mount(page);
    dock.add(o.path, this.name, `${o.project}/${o.path}`, page, () => {
      this.editor.destroy();
      o.onClose();
    });
  }

  setText(md: string): void {
    if (this.editor.value !== md) this.editor.value = md;
  }

  setEdited(edited: boolean): void {
    this.dock.setTitle(this.path, `${edited ? EDITED : ''}${this.name}`);
    this.editor.modified = edited;
  }

  flush(): void {
    this.editor.flush();
  }

  close(): void {
    this.dock.remove(this.path);
  }
}

/** An open file's editor, in a window or a dock tab. */
export type OpenEditor = EditorWindow | EditorTab;
