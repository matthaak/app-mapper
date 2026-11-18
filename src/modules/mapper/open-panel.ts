import { NxBrowser, NxButton, NxSwitch, NxTextField, NxWindow, pin, type NxBrowserNode, type NxDesktop } from '../widgets';
import { SKILL_PATH, SKILL_VERSION, skillVersion } from './agents';
import { alertPanel, namePanel } from './dialogs';
import { storage } from './frames';
import { basenameAbs, dirnameAbs, joinAbs, splitAbs, type Host } from './host';
import { DEFAULT_PROJECT_FILE } from './project';

interface Entry extends NxBrowserNode {
  abs: string;
  loaded: boolean;
  /** Present for folders. */
  children?: Entry[];
}

/** What to do besides writing the project file (New Project). */
export interface ProjectOptions {
  /** Also create README.md in the project's folder (it has none). */
  readme: boolean;
  /** Also set the project up for AI agents (see agents.ts). */
  agents: boolean;
}

/** The AI agents switch, once turned off ('0'): remembered across launches. */
const AGENTS_KEY = 'app-mapper.new-project-agents';

/** The top of the browser with several roots (Windows drives): it has no path of its own. */
const COMPUTER = 'This PC';
/** How a root is listed: `C:`, `\\server\share`, `/`. */
const rootName = (root: string) => (root === '/' ? root : root.replace(/[\\/]+$/, ''));
const sameRoot = (a: string, b: string) => rootName(a).toLowerCase() === rootName(b).toLowerCase();

const folder = (name: string, abs: string): Entry => ({ name, abs, loaded: false, children: [] });
const isJson = (p: string) => /\.json$/i.test(p);

/** Sizes the panels open at (both can be resized). */
export const PROJECT_PANEL_SIZE = { open: { width: 560, height: 340 }, new: { width: 560, height: 394 } };

/**
 * The NeXT Open and New Project panels: a column browser of folders and the project files in
 * them (only .json files that are valid App Mapper projects are listed), the file's path, and
 * Open — or, to start a new project, Create (never over an existing file), with Create Folder…
 * and switches to also create the folder's README.md and set the project up for AI agents (the
 * App Mapper skill and AGENTS.md, see agents.ts). Both panels resize, the browser taking
 * up the room. On Windows the browser starts from This PC, listing every drive (mapped ones
 * too), so any of them can be browsed.
 */
export class ProjectPanel {
  readonly win: NxWindow;
  private browser: NxBrowser | null = null;
  private readonly path: NxTextField;
  private top: Entry | null = null;
  /** The folder the browser is in: where Create Folder… puts a folder. */
  private dir: Entry | null = null;
  private readonly readme: NxSwitch | null = null;
  /** Whether the user wants a README (the switch shows it while it is enabled). */
  private wantReadme = true;
  private readonly agents: NxSwitch | null = null;
  /** Whether the user wants the project set up for AI agents (remembered). */
  private wantAgents = storage(AGENTS_KEY) !== '0';
  private folderCheck = 0;

  constructor(
    private readonly desk: NxDesktop,
    private readonly host: Host,
    private readonly mode: 'open' | 'new',
    /** Opens or creates the project file; false if it couldn't (and said why). */
    private readonly done: (file: string, o: ProjectOptions) => Promise<boolean>,
  ) {
    const size = PROJECT_PANEL_SIZE[mode];
    this.win = new NxWindow({
      title: mode === 'open' ? 'Open Project' : 'New Project',
      kind: 'panel',
      resizable: true,
      ...size,
      minWidth: 420,
      minHeight: mode === 'open' ? 240 : 296,
    });
    this.win.el.classList.add('mapper-open');
    this.path = new NxTextField({
      label: mode === 'open' ? 'Project:' : 'Save as:',
      onCommit: () => void this.finish(),
      onInput: () => this.checkFolder(),
    });
    if (mode === 'new') {
      this.readme = new NxSwitch({ label: 'Create root README.md file', on: true, onChange: (on) => (this.wantReadme = on) });
      this.agents = new NxSwitch({
        label: 'Set up for AI agents (App Mapper skill and AGENTS.md)',
        on: this.wantAgents,
        onChange: (on) => {
          this.wantAgents = on;
          storage(AGENTS_KEY, on ? null : '0');
        },
      });
    }
  }

  private async load(node: Entry): Promise<void> {
    if (node.loaded || !node.children) return;
    node.loaded = true;
    try {
      const { dirs, files } = await this.host.list(node.abs);
      node.children.push(...dirs.map((n) => folder(n, joinAbs(node.abs, n))));
      node.children.push(...files.map((n): Entry => ({ name: n, abs: joinAbs(node.abs, n), loaded: true })));
    } catch {
      // Unreadable: shown empty.
    }
  }

  /** The names the browser shows for `abs`, from its top: with drives, the drive first. */
  private browserPath(abs: string): string[] {
    const { root, names } = splitAbs(abs);
    return this.top?.name === COMPUTER ? [rootName(root), ...names] : names;
  }

  /** The folder entry at `abs`, if the browser has loaded that far. */
  private entryAt(abs: string): Entry | null {
    let node = this.top;
    for (const name of this.browserPath(abs)) node = node?.children?.find((e) => e.name.toLowerCase() === name.toLowerCase() && e.children) ?? null;
    return node;
  }

  /** Fills the panel, starting at `start` (a project file or folder) or the home folder. */
  async prepare(start: string): Promise<void> {
    const c = this.win.content;
    c.replaceChildren();
    const startDir = isJson(start) ? dirnameAbs(start) : start;
    const { root, names } = splitAbs(startDir);
    // One root (macOS: `/`) is the top; several (Windows drives) sit under This PC.
    const roots = await this.host.roots().catch(() => [root]);
    if (!roots.some((r) => sameRoot(r, root))) roots.push(root);
    let top: Entry;
    let node: Entry;
    const path: string[] = [];
    if (roots.length === 1) {
      top = node = folder(rootName(root), root);
    } else {
      top = { name: COMPUTER, abs: '', loaded: true, children: roots.map((r) => folder(rootName(r), r)) };
      node = top.children!.find((e) => sameRoot(e.abs, root))!;
      path.push(node.name);
    }
    this.top = top;
    // Load each folder along the starting path, so the browser opens there.
    for (const name of names) {
      await this.load(node);
      const next = node.children?.find((e) => e.name === name && e.children);
      if (!next) break;
      path.push(name);
      node = next;
    }
    await this.load(node);
    this.dir = node;
    if (this.mode === 'new') this.path.value = joinAbs(node.abs, DEFAULT_PROJECT_FILE);
    else this.path.value = isJson(start) ? start : node.abs;

    this.browser = new NxBrowser({
      root: top,
      columns: 3,
      path,
      onSelect: (sel) => {
        const last = sel[sel.length - 1] as Entry;
        if (last.children) {
          this.dir = last;
          this.path.value = this.mode === 'new' ? joinAbs(last.abs, basenameAbs(this.path.value) || DEFAULT_PROJECT_FILE) : last.abs;
          if (!last.loaded) void this.load(last).then(() => this.browser?.refresh(last));
        } else {
          this.dir = (sel[sel.length - 2] as Entry | undefined) ?? top;
          this.path.value = last.abs;
        }
        this.checkFolder();
      },
      onOpen: (sel) => {
        const last = sel[sel.length - 1] as Entry;
        if (!last.children) void this.finish();
      },
    });

    // Laid out from the bottom up, pinned to the edges so the panel can be resized.
    const side = { left: '8px', right: '8px' };
    const row = (n: number) => `${8 + n}px`;
    const buttons = [
      pin(new NxButton({ label: 'Cancel', onClick: () => this.win.close() }).el, { right: '102px', bottom: row(0), width: '86px' }),
      pin(new NxButton({ label: this.mode === 'open' ? 'Open' : 'Create', returnKey: true, onClick: () => void this.finish() }).el, {
        right: '8px',
        bottom: row(0),
        width: '88px',
      }),
    ];
    if (this.mode === 'open') {
      c.append(pin(this.browser.el, { ...side, top: '8px', bottom: row(62) }), pin(this.path.el, { ...side, bottom: row(32) }), ...buttons);
    } else {
      const mkdir = new NxButton({ label: 'Create Folder…', onClick: () => void this.createFolder() });
      c.append(
        pin(this.browser.el, { ...side, top: '8px', bottom: row(114) }),
        pin(this.path.el, { ...side, bottom: row(84) }),
        pin(this.readme!.el, { left: '8px', bottom: row(58) }),
        pin(this.agents!.el, { left: '8px', bottom: row(32) }),
        pin(mkdir.el, { left: '8px', bottom: row(0), width: '120px' }),
        ...buttons,
      );
      this.checkFolder();
    }
  }

  focus(): void {
    this.path.focus();
  }

  /**
   * Enables the README switch only if the folder the project file would go in has no
   * README.md, and the AI agents switch only if it hasn't this version's skill (or a newer
   * one) already (checked on disk, after typing settles).
   */
  private checkFolder(): void {
    const sw = this.readme;
    const ai = this.agents;
    if (!sw || !ai) return;
    const check = ++this.folderCheck;
    window.setTimeout(async () => {
      if (check !== this.folderCheck) return;
      const dir = dirnameAbs(this.path.value.trim());
      const names = ['README.md', 'readme.md', 'Readme.md'];
      const [skill, ...found] = await Promise.all([SKILL_PATH, ...names].map((n) => this.host.read(joinAbs(dir, n)).catch(() => null)));
      if (check !== this.folderCheck) return;
      const has = found.some((t) => t !== null);
      sw.disabled = has;
      sw.on = !has && this.wantReadme;
      const setUp = skill !== null && (skillVersion(skill) ?? 0) >= SKILL_VERSION;
      ai.disabled = setUp;
      ai.on = !setUp && this.wantAgents;
    }, 150);
  }

  /** Asks for a name and makes that folder in the browser's current folder, then goes into it. */
  private async createFolder(): Promise<void> {
    const parent = this.dir ?? this.top;
    // This PC holds drives, not folders.
    if (!parent?.children || !parent.abs) return;
    const name = await namePanel(this.desk, 'Create Folder', 'Name:', 'Create');
    if (name === null) return this.path.focus();
    const fail = (message: string) => alertPanel(this.desk, 'Can’t Create Folder', message);
    if (/[\\/:]/.test(name) || name === '.' || name === '..') return fail(`“${name}” can’t be a folder name.`);
    if (name.startsWith('.')) return fail('A folder whose name starts with “.” is hidden, so it wouldn’t be listed.');
    if (parent.children.some((e) => e.name.toLowerCase() === name.toLowerCase())) return fail(`There’s already a “${name}” in ${parent.name}.`);
    const abs = joinAbs(parent.abs, name);
    try {
      await this.host.mkdir(abs);
    } catch (e) {
      return fail(`${name}: ${(e as Error).message}`);
    }
    // A new folder is empty: no need to list it.
    const entry: Entry = { ...folder(name, abs), loaded: true };
    const folders = parent.children.filter((e) => e.children);
    const at = folders.findIndex((e) => e.name.localeCompare(name) > 0);
    parent.children.splice(at < 0 ? folders.length : parent.children.indexOf(folders[at]), 0, entry);
    this.browser?.refresh(parent);
    this.browser?.show(this.browserPath(abs));
    this.dir = this.entryAt(abs) ?? entry;
    this.path.value = this.mode === 'new' ? joinAbs(abs, basenameAbs(this.path.value) || DEFAULT_PROJECT_FILE) : abs;
    this.checkFolder();
    this.path.focus();
  }

  private async finish(): Promise<void> {
    let file = this.path.value.trim();
    if (this.mode === 'new' && file && !isJson(file)) file += '.json';
    if (!isJson(file)) return;
    const readme = !!this.readme && !this.readme.disabled && this.readme.on;
    const agents = !!this.agents && !this.agents.disabled && this.agents.on;
    if (await this.done(file, { readme, agents })) this.win.close();
  }
}
