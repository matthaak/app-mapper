import { NxBrowser, NxButton, NxLabel, NxTextField, NxWindow, pin, type NxBrowserNode } from '../widgets';

export interface NewFileRequest {
  /** Project folder ('' = the root). */
  dir: string;
  /** File name, ending in .md. */
  name: string;
  /** The file's first heading. */
  title: string;
}

interface DirNode extends NxBrowserNode {
  path: string;
  children: DirNode[];
}

/** The panel's size when first shown (it resizes, and is remembered). */
export const NEW_FILE_PANEL_SIZE = { width: 440, height: 360 };

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';

/**
 * Creates a Markdown file: its title (the first heading), its name (from the title until
 * edited), and its folder, picked in a column browser of the project's folders — the project
 * root unless another is chosen.
 *
 * The panel resizes: the folder browser takes up the extra room.
 *
 * Until a title or name is typed, the panel suggests one for the folder chosen: README.md,
 * titled with the folder's name, when the folder has no README.md yet; else Untitled.
 */
export class NewFilePanel {
  readonly win: NxWindow;
  private readonly titleField: NxTextField;
  private readonly nameField: NxTextField;
  private readonly where: NxLabel;
  private browser: NxBrowser | null = null;
  private dir = '';
  private nameEdited = false;
  private titleEdited = false;
  private project = '';
  private dirs: string[] = [''];
  /** Folders ('' = the root) that already have a README.md. */
  private readmes = new Set<string>();

  constructor(private readonly host: { create(req: NewFileRequest): Promise<string | null> }) {
    this.win = new NxWindow({ title: 'New MD File', kind: 'panel', resizable: true, ...NEW_FILE_PANEL_SIZE, minWidth: 380, minHeight: 300 });
    this.win.el.classList.add('mapper-new-file');
    this.titleField = new NxTextField({
      label: 'Title:',
      onInput: (v) => {
        this.titleEdited = true;
        if (!this.nameEdited) this.nameField.value = `${slug(v)}.md`;
      },
      onCommit: () => this.create(),
    });
    this.nameField = new NxTextField({ label: 'Name:', onInput: () => (this.nameEdited = true), onCommit: () => this.create() });
    this.where = new NxLabel('');
    this.where.el.classList.add('mapper-ellipsis');
  }

  /** Resets the panel for a project with these folders and Markdown files. */
  prepare(project: string, dirs: string[], files: string[]): void {
    this.project = project;
    this.dirs = dirs;
    this.readmes = new Set(files.filter((f) => /(^|\/)readme\.md$/i.test(f)).map((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')));
    this.nameEdited = false;
    this.titleEdited = false;
    this.layout();
  }

  /** The suggested title and name for `dir`, while neither has been typed. */
  private suggest(dir: string): void {
    if (this.titleEdited || this.nameEdited) return;
    const readme = !this.readmes.has(dir);
    const title = readme ? (dir ? dir.slice(dir.lastIndexOf('/') + 1) : this.project) : 'Untitled';
    this.titleField.value = title;
    this.nameField.value = readme ? 'README.md' : `${slug(title)}.md`;
  }

  focus(): void {
    this.titleField.focus();
  }

  private layout(): void {
    const c = this.win.content;
    c.replaceChildren();
    this.browser = new NxBrowser({ root: this.tree(), columns: 2, onSelect: (sel) => this.setDir((sel[sel.length - 1] as DirNode).path) });
    this.setDir('');
    const folder = new NxLabel('Folder:');
    // Pinned to the edges, so the panel can be resized: the browser takes the extra room.
    const side = { left: '8px', right: '8px' };
    c.append(
      pin(this.titleField.el, { ...side, top: '10px' }),
      pin(this.nameField.el, { ...side, top: '42px' }),
      pin(folder.el, { left: '8px', top: '76px' }),
      pin(this.browser.el, { ...side, top: '94px', bottom: '72px' }),
      pin(this.where.el, { left: '9px', right: '9px', bottom: '46px' }),
      pin(new NxButton({ label: 'Project Root', onClick: () => this.layout() }).el, { left: '8px', bottom: '10px', width: '110px' }),
      pin(new NxButton({ label: 'Cancel', onClick: () => this.win.close() }).el, { right: '102px', bottom: '10px', width: '86px' }),
      pin(new NxButton({ label: 'Create', returnKey: true, onClick: () => this.create() }).el, { right: '8px', bottom: '10px', width: '88px' }),
    );
  }

  private setDir(dir: string): void {
    this.dir = dir;
    this.suggest(dir);
    this.where.disabled = false;
    this.where.text = `In: ${this.project}${dir ? `/${dir}` : ''}`;
  }

  private tree(): DirNode {
    const root: DirNode = { name: this.project, path: '', children: [] };
    const byPath = new Map<string, DirNode>([['', root]]);
    for (const path of [...this.dirs].sort()) {
      if (!path) continue;
      const node: DirNode = { name: path.slice(path.lastIndexOf('/') + 1), path, children: [] };
      byPath.set(path, node);
      byPath.get(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')?.children.push(node);
    }
    return root;
  }

  private async create(): Promise<void> {
    const title = this.titleField.value.trim();
    let name = this.nameField.value.trim();
    if (name && !/\.(md|markdown)$/i.test(name)) name += '.md';
    const problem = !title ? 'Give the file a title.' : !name || /[\\/]/.test(name) ? 'Give the file a name (no slashes).' : null;
    const error = problem ?? (await this.host.create({ dir: this.dir, name, title }));
    if (error) {
      this.where.text = error;
      this.where.disabled = true;
      return;
    }
    this.win.close();
  }
}
