import {
  CanvasView,
  DependencyGraph,
  G,
  Hierarchy,
  NODE_H,
  NODE_W,
  addChildWithLayout,
  type CanvasState,
  type CanvasViewport,
  type DiagramNode,
  type Pt,
} from '../canvas';
import { hasRevisions } from '../md-editor';
import { NxDesktop, NxMenu, h, nxTheme, setNxTheme, type NxMenuItem, type NxTheme, type NxWindow } from '../widgets';
import { SKILL_PATH, SKILL_VERSION, agentSetup, setUpAgents, type AgentSetup } from './agents';
import { alertPanel, choicePanel, showCentered } from './dialogs';
import { addDependency, basename, newDocText, removeDependency, setDependencyLabel } from './docs';
import { EditorDock } from './editor-dock';
import { EDITED, EditorTab, EditorWindow, type OpenEditor } from './editor-window';
import { rememberMenu, showRemembered, storage } from './frames';
import { basenameAbs, connect, dirnameAbs, joinAbs, type Host, type HostInfo, type MenuCommand, type MenuSpec, type Recovery } from './host';
import { NEW_FILE_PANEL_SIZE, NewFilePanel, type NewFileRequest } from './new-file-panel';
import { PROJECT_PANEL_SIZE, ProjectPanel, type ProjectOptions } from './open-panel';
import { Project, mapText, parseMap, type MapFile } from './project';

const KEY = {
  last: 'app-mapper.last-project',
  /** View ▸ Use Editor Windows is on (off by default: files open in the dock). */
  windows: 'app-mapper.editor-windows',
  /** View ▸ Theme: 'classic', or none for Modern (the default). */
  theme: 'app-mapper.theme',
  view: (location: string) => `app-mapper.view:${location}`,
  /** A file's Review Mode, once the user set it ('1' on, '0' off). */
  annotations: (project: string, path: string) => `app-mapper.annotations:${project}:${path}`,
  /** Show spelling errors in the editors: '0' when turned off (on by default). */
  spelling: 'app-mapper.spelling',
  /** The skill version whose update the user declined for a project (asked once per version). */
  agentsDeclined: (project: string) => `app-mapper.agents-declined:${project}`,
};
/** Quiet time (ms) after a change before unsaved changes are kept aside for recovery. */
const RECOVERY_DELAY = 800;
/** The README the New Project panel can create in the project's folder. */
const README = 'README.md';
/** Room the canvas's hint line takes at the bottom, kept out of the viewable area. */
const HINT_ROOM = 32;

/** A canvas viewport as saved per project, with where the viewable area's middle was then. */
interface SavedView extends CanvasViewport {
  mid?: Pt;
}

/** Dependency ids are stable across re-reads of the files: source and target paths. */
const depId = (source: string, target: string) => `${source} → ${target}`;
const snap = (v: number) => Math.round(v / G) * G;

/**
 * App Mapper: a project's Markdown files as nodes on a canvas, mapping its architecture.
 *
 * A project is a project file (.json, such as app-map.json) holding the layout — positions
 * and parent links; the folder it is in is the project root, whose Markdown files (and those
 * below) are the project's files. Node labels are the files' first headings; dependency arrows
 * come from each file's Dependencies section (see docs.ts).
 *
 * The workspace is a NeXT desktop whose background is the canvas, with the panels and one MD
 * Editor window per open file over it. By default the open files are instead in the tabs of a
 * dock at the right of the canvas (see EditorDock); View ▸ Use Editor Windows switches to windows. The application menu is the desktop app's own:
 * File (projects; New MD File… and Add MD File, which lists the project's Markdown files to put
 * on the canvas; saving), Canvas, and View. The page describes it (menuSpec) and the host builds
 * it; in a browser, where there is none, the page shows the same menus as a NeXT menu.
 *
 * Nothing is saved until the user saves (File ▸ Save, Save All; an editor's Save button).
 * A bullet marks unsaved changes: in the window title for the project file, on a node and its
 * editor's title for a Markdown file. Unsaved changes are kept aside as they are made (the
 * host's recovery store) and dropped once saved or discarded, so a record left behind means
 * the app didn't close cleanly: opening that project again offers to recover them.
 */
export class MapperApp {
  private readonly desk: NxDesktop;
  private readonly layer: HTMLDivElement;
  /** The NeXT stand-in for the application menu, in a browser only. */
  private menu: NxMenu | null = null;
  /** The menu last sent to the host (as JSON), so only changes are sent. */
  private menuSent = '';
  private menuQueued = false;
  /** The paneled UI (the default): files open in the dock's tabs, not in windows. */
  private paneled = storage(KEY.windows) !== '1';
  private readonly dock: EditorDock;
  /** The canvas's state, for the Canvas menu (null with no project open). */
  private canvasState: CanvasState | null = null;
  private readonly newPanel: NewFilePanel;
  private canvas: CanvasView | null = null;
  private project: Project | null = null;
  private tree = new Hierarchy();
  private graph = new DependencyGraph();
  private readonly editors = new Map<string, OpenEditor>();
  private recoveryTimer = 0;
  private viewTimer = 0;
  private host: Host | null = null;
  private info: HostInfo | null = null;
  private projectPanel: ProjectPanel | null = null;
  /** The welcome panel, while no project has been opened. */
  private welcomeWin: NxWindow | null = null;
  /** The window is closing after the user was asked: nothing more to keep or ask. */
  private closing = false;
  /** Where the file being created goes on the canvas. */
  private newContext: { parent?: string; at?: Pt } = {};
  private scanning = false;
  private lastScan = 0;
  /** How far the open project is set up for AI agents (File ▸ Set Up for AI Agents). */
  private agents: AgentSetup | null = null;

  constructor(host: HTMLElement) {
    setNxTheme(storage(KEY.theme) === 'classic' ? 'classic' : 'modern');
    this.desk = new NxDesktop().mount(host);
    this.desk.el.classList.add('mapper');
    this.layer = h('div', { className: 'mapper-canvas' });
    this.desk.el.prepend(this.layer);
    this.dock = new EditorDock(() => this.layoutDock(), () => this.updateTitle());
    this.layer.after(this.dock.el);
    this.dock.visible = this.paneled;
    this.layer.style.setProperty('--mapper-reserve', `${this.dock.reserve}px`);
    window.addEventListener('resize', () => {
      this.dock.fit();
      this.layoutDock();
    });

    this.newPanel = new NewFilePanel({ create: (req) => this.createFile(req) });

    this.makeCanvas();

    window.addEventListener('focus', () => void this.rescan(true));
    // Unloading with unsaved changes (a reload, or a browser tab closing): keep them for
    // recovery. In a browser, also ask first; Electron asks before its window closes.
    window.addEventListener('beforeunload', (e) => {
      const p = this.project;
      if (!p || this.closing || !this.host) return;
      const r = this.recoveryData();
      if (!r) return;
      this.host.recoveryPutSync(p.file, r);
      if (this.host.kind === 'dev') e.preventDefault();
    });
    void this.start();
  }

  /* ---------------------------------------------------------------- */
  /* Project                                                          */
  /* ---------------------------------------------------------------- */

  private async start(): Promise<void> {
    this.host = await connect();
    if (!this.host) {
      alertPanel(this.desk, 'No File Access', 'App Mapper needs its desktop app (npm run app, or a packaged build) or the dev server (npm run dev) to reach your files.');
      return;
    }
    this.info = await this.host.info();
    if (this.host.kind === 'dev') {
      this.menu = this.makeDevMenu();
      rememberMenu(this.desk, this.menu, 'menu');
      this.makeCanvas(); // makes room for the menu
    }
    this.menuChanged();
    this.host.onMenu((cmd) => void this.menuCommand(cmd));
    this.host.onCloseRequest(() => void this.closeRequested());
    // The project open when the app was last left.
    const last = storage(KEY.last);
    if (last && /\.json$/i.test(last) && (await this.open(last, { quiet: true }))) return;
    void this.welcome();
  }

  private async welcome(): Promise<void> {
    const i = await choicePanel(
      this.desk,
      'App Mapper',
      'Open a project file — such as app-map.json — or start a new one. The folder it is in is the project’s root: its Markdown files, and those in folders below, are the project’s files.',
      ['New Project…', 'Open Project…'],
      (win) => (this.welcomeWin = win),
    );
    this.welcomeWin = null;
    if (i === 0) void this.newProject();
    if (i === 1) void this.openProject();
  }

  /** A command from the application menu (see menuSpec). */
  private async menuCommand(cmd: MenuCommand): Promise<void> {
    const canvas = (f: (c: CanvasView) => void) => {
      if (!this.project || !this.canvas) return;
      this.canvas.commitEdit();
      f(this.canvas);
    };
    if (cmd.startsWith('add-file:')) return this.placeFile(cmd.slice('add-file:'.length));
    switch (cmd) {
      case 'new-project':
        return this.newProject();
      case 'open-project':
        return this.openProject();
      case 'rescan':
        return this.rescan(false);
      case 'refresh-all':
        return this.refreshAll();
      case 'set-up-agents':
        return this.setUpAgents();
      case 'new-file':
        return this.newFile({});
      case 'save':
        return void (await this.save());
      case 'save-all':
        return void (await this.saveAll());
      case 'editor-windows':
        return this.setPaneled(!this.paneled);
      case 'theme:classic':
      case 'theme:modern':
        return this.setTheme(cmd.slice('theme:'.length) as NxTheme);
      case 'canvas:new-child':
        return this.newFile({ parent: this.selectedNode() ?? undefined });
      case 'canvas:set-parent':
        return canvas((c) => c.toggleReparent());
      case 'canvas:detach':
        return canvas((c) => c.detach());
      case 'canvas:dependency':
        return canvas((c) => c.toggleDependency());
      case 'canvas:remove':
        return canvas((c) => c.deleteSelection());
      case 'canvas:reset-view':
        return canvas((c) => c.resetView());
      case 'canvas:zoom-in':
        return canvas((c) => c.zoomBy(1.25));
      case 'canvas:zoom-out':
        return canvas((c) => c.zoomBy(1 / 1.25));
    }
  }

  /** Asks for a project file (in the Open Project panel, which lists only valid ones) and opens it. */
  private async openProject(): Promise<void> {
    if (!this.host) return;
    await this.showProjectPanel('open', (file) => this.open(file));
  }

  /**
   * Asks where to put a new project file (the New Project panel), writes an empty map there —
   * and, if asked, the folder's README.md, put on the map — and opens it.
   */
  private async newProject(): Promise<void> {
    const host = this.host;
    if (!host) return;
    await this.showProjectPanel('new', async (file, o) => {
      if ((await host.read(file).catch(() => null)) !== null) {
        alertPanel(this.desk, 'Can’t Create Project', `${basenameAbs(file)} already exists there. Open it instead, or pick another name.`);
        return false;
      }
      return this.createProject(file, o);
    });
  }

  private async createProject(file: string, o: ProjectOptions): Promise<boolean> {
    if (!(await this.confirmLeave())) return false;
    const host = this.host!;
    const dir = dirnameAbs(file);
    const readme = joinAbs(dir, README);
    let placeReadme = false;
    try {
      if (o.readme && (await host.read(readme).catch(() => null)) === null) {
        await host.write(readme, newDocText(basenameAbs(dir) || 'README'));
        placeReadme = true;
      }
      await host.write(file, mapText([]));
    } catch (e) {
      alertPanel(this.desk, 'Can’t Create Project', `${(e as Error).message}`);
      return false;
    }
    if (o.agents) {
      try {
        await setUpAgents(host, dir, basenameAbs(file));
      } catch (e) {
        alertPanel(this.desk, 'Can’t Set Up for AI Agents', `${(e as Error).message}`);
      }
    }
    if (!(await this.open(file, { confirmed: true }))) return false;
    if (placeReadme) {
      this.placeFile(README);
      await this.saveMap();
    }
    return true;
  }

  /**
   * File ▸ Set Up for AI Agents: writes the App Mapper skill into the open project (replacing
   * an older one) and its pointer in AGENTS.md (see agents.ts).
   */
  private async setUpAgents(): Promise<void> {
    const p = this.project;
    if (!p || !this.host) return;
    try {
      await setUpAgents(this.host, p.root, p.fileName);
    } catch (e) {
      alertPanel(this.desk, 'Can’t Set Up for AI Agents', `${(e as Error).message}`);
    }
    await this.checkAgents();
  }

  /** Reads how far the open project is set up for AI agents, for the File menu. */
  private async checkAgents(): Promise<AgentSetup | null> {
    const p = this.project;
    const state = p && this.host ? await agentSetup(this.host, p.root, p.fileName).catch(() => null) : null;
    if (p === this.project) {
      this.agents = state;
      this.menuChanged();
    }
    return state;
  }

  /**
   * A project opened with the skill of an older App Mapper: offers, once per version, to
   * update it.
   */
  private async offerAgentUpdate(): Promise<void> {
    const p = this.project;
    if (!p || (await this.checkAgents()) !== 'old' || p !== this.project) return;
    if (storage(KEY.agentsDeclined(p.file)) === String(SKILL_VERSION)) return;
    const i = await choicePanel(
      this.desk,
      'Update AI Agent Instructions?',
      `This project’s App Mapper skill (${SKILL_PATH}) is from an older version of App Mapper. Update it, and its pointer in AGENTS.md, to match this version?`,
      ['Not Now', 'Update'],
    );
    if (p !== this.project) return;
    if (i === 1) await this.setUpAgents();
    else storage(KEY.agentsDeclined(p.file), String(SKILL_VERSION));
  }

  private async showProjectPanel(mode: 'open' | 'new', done: (file: string, o: ProjectOptions) => Promise<boolean>): Promise<void> {
    this.projectPanel?.win.close();
    const panel = new ProjectPanel(this.desk, this.host!, mode, done);
    this.projectPanel = panel;
    const last = storage(KEY.last);
    // Where the open project is, else the last one, else home (or, under the dev server, its folder).
    const start = this.host?.kind === 'dev' ? this.info?.cwd : this.info?.home;
    await panel.prepare(this.project?.file ?? (last && /\.json$/i.test(last) ? last : null) ?? start ?? '/');
    const { width, height } = PROJECT_PANEL_SIZE[mode];
    showCentered(this.desk, panel.win, width, height, `${mode}-project`);
    panel.focus();
  }

  /**
   * Opens a project file: checks it is one, reads the Markdown files in its folder, offers to
   * recover unsaved changes left from a session that didn't close cleanly, and shows its map.
   * `quiet`: say nothing if the file is gone or can't be read. `confirmed`: the user was already asked about
   * the current project's unsaved changes.
   */
  private async open(file: string, o: { quiet?: boolean; confirmed?: boolean } = {}): Promise<boolean> {
    const host = this.host;
    if (!host) return false;
    const fail = (message: string) => {
      alertPanel(this.desk, 'Can’t Open Project', `${basenameAbs(file)}: ${message}`);
      return false;
    };
    let text: string | null;
    try {
      text = await host.read(file);
    } catch (e) {
      return o.quiet ? false : fail((e as Error).message);
    }
    if (text === null) return o.quiet ? false : fail('There’s no such file.');
    let map: MapFile;
    try {
      map = parseMap(text);
    } catch (e) {
      return fail((e as Error).message);
    }
    if (!o.confirmed && !(await this.confirmLeave())) return false;
    const project = new Project(host, file, text);
    try {
      await project.scan();
    } catch (e) {
      return fail(`Its folder can’t be read (${(e as Error).message}).`);
    }
    await this.closeProject();
    this.project = project;
    this.tree = new Hierarchy();
    this.loadMap(map);
    // What is on disk, as this app writes it: unsaved changes are differences from this.
    project.savedMap = this.currentMapText();

    const recovered = await this.offerRecovery(project);
    if (recovered?.map) {
      this.tree = new Hierarchy();
      this.loadMap(recovered.map);
    }
    for (const n of this.tree.all()) this.tree.update(n.id, this.nodeFields(n.id));
    this.graph = new DependencyGraph();
    this.syncGraph();
    this.makeCanvas();
    const view = storage(KEY.view(file));
    if (view) {
      try {
        // Saved with the viewable area's middle then (see onViewChange): what was there goes in
        // its middle now, whatever the window's size or the bezel's place. (Views saved before
        // that were as the whole width showed them.)
        const v = JSON.parse(view) as SavedView;
        const canvas = this.canvas!;
        const was = v.mid ?? { x: this.layer.clientWidth / 2, y: this.layer.clientHeight / 2 };
        const now = canvas.viewableMiddle;
        canvas.viewport = { x: v.x + now.x - was.x, y: v.y + now.y - was.y, k: v.k };
      } catch {
        // Keep the default view.
      }
    }
    this.lastScan = Date.now();
    storage(KEY.last, file);
    this.welcomeWin?.close();
    this.updateTitle();
    this.menuChanged();
    if (recovered) this.scheduleRecovery();
    this.agents = null;
    void this.offerAgentUpdate();
    return true;
  }

  /**
   * Unsaved changes left behind for this project (the app didn't close cleanly): asks whether
   * to recover them. Recovered Markdown texts are put into the project (unsaved); a recovered
   * map is returned for the caller to show. Declined or unreadable, they are dropped.
   */
  private async offerRecovery(project: Project): Promise<{ map: MapFile | null } | null> {
    const host = this.host!;
    const r = await host.recoveryGet(project.file).catch(() => null);
    if (!r) return null;
    let map: MapFile | null = null;
    try {
      map = r.map ? parseMap(r.map) : null;
    } catch {
      map = null;
    }
    const docs = Object.entries(r.docs ?? {}).filter(([path, text]) => typeof text === 'string' && /\.(md|markdown)$/i.test(path));
    if (!map && !docs.length) {
      await host.recoveryClear(project.file);
      return null;
    }
    const when = new Date(r.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const what = this.describe(!!map, docs.map(([p]) => p));
    const i = await choicePanel(
      this.desk,
      'Recover Unsaved Changes?',
      `App Mapper didn’t close cleanly while ${what} had unsaved changes (kept ${when}). Recover them? They stay unsaved until you save.`,
      ['Discard', 'Recover'],
    );
    if (i !== 1) {
      await host.recoveryClear(project.file);
      return null;
    }
    for (const [path, text] of docs) project.setText(path, text);
    return { map };
  }

  /** "the project file and 2 Markdown files", "readme.md", … */
  private describe(map: boolean, docs: string[]): string {
    const parts: string[] = [];
    if (map) parts.push(`the project file (${this.project?.fileName ?? 'the map'})`);
    if (docs.length === 1) parts.push(basename(docs[0]));
    else if (docs.length > 1) parts.push(`${docs.length} Markdown files`);
    return parts.join(' and ');
  }

  /**
   * Before the open project is left (another opened, the window closed): if it has unsaved
   * changes, asks whether to save them. False if the user cancelled (or a save failed).
   */
  private async confirmLeave(): Promise<boolean> {
    const p = this.project;
    if (!p) return true;
    for (const ed of this.editors.values()) ed.flush();
    const dirty = p.dirty();
    const map = this.mapDirty();
    if (!map && !dirty.length) return true;
    const what = this.describe(map, dirty);
    const has = `${what.replace(/^the /, 'The ')} ${(map && dirty.length) || dirty.length > 1 ? 'have' : 'has'} unsaved changes.`;
    // The desktop app asks in a native alert (bringing itself forward to); a browser, in a NeXT panel.
    const native = await this.host?.confirm({
      message: `Do you want to save the changes to ${p.name}?`,
      detail: `${has} Your changes will be lost if you don’t save them.`,
      buttons: ['Save All', 'Cancel', 'Don’t Save'],
      defaultId: 0,
      cancelId: 1,
    });
    if (native !== undefined && native !== null) {
      if (native === 0) return this.saveAll();
      return native === 2;
    }
    const i = await choicePanel(this.desk, 'Unsaved Changes', `${has} Save them before leaving ${p.name}?`, ['Don’t Save', 'Cancel', 'Save All']);
    if (i === 2) return this.saveAll();
    return i === 0;
  }

  /** The window is about to close (Electron): ask about unsaved changes, then let it close. */
  private async closeRequested(): Promise<void> {
    const host = this.host!;
    if (!(await this.confirmLeave())) return host.cancelClose();
    if (this.project) await host.recoveryClear(this.project.file).catch(() => undefined);
    this.closing = true;
    host.close();
  }

  /** Leaves the open project (its unsaved changes already saved or discarded). */
  private async closeProject(): Promise<void> {
    const p = this.project;
    clearTimeout(this.recoveryTimer);
    for (const ed of [...this.editors.values()]) ed.close();
    if (p) await this.host?.recoveryClear(p.file).catch(() => undefined);
    this.project = null;
  }

  private loadMap(map: MapFile): void {
    const nodes = map.nodes.filter((n) => typeof n?.file === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y));
    for (const n of nodes) if (!this.tree.has(n.file)) this.tree.add(null, '', n.x, n.y, { id: n.file });
    for (const n of nodes) {
      if (n.parent && this.tree.has(n.parent) && this.tree.canReparent(n.file, n.parent)) this.tree.reparent(n.file, n.parent);
    }
    for (const n of this.tree.all()) this.tree.update(n.id, this.nodeFields(n.id));
  }

  /**
   * File ▸ Refresh All: reads the project file and every Markdown file from disk again, as if
   * the project were just opened — discarding unsaved changes, after a (native) warning. The
   * same files stay open (the front one in front), and the canvas where it was.
   */
  private async refreshAll(): Promise<void> {
    const p = this.project;
    if (!p) return;
    for (const ed of this.editors.values()) ed.flush();
    const dirty = p.dirty();
    const map = this.mapDirty();
    if (map || dirty.length) {
      const what = this.describe(map, dirty);
      const has = `${what.replace(/^the /, 'The ')} ${(map && dirty.length) || dirty.length > 1 ? 'have' : 'has'} unsaved changes.`;
      const native = await this.host?.confirm({
        message: `Revert all unsaved changes to ${p.name}?`,
        detail: `${has} Refresh All reads everything from disk again, so they will be lost. This can’t be undone.`,
        buttons: ['Revert', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      const revert =
        native !== undefined && native !== null
          ? native === 0
          : (await choicePanel(this.desk, 'Refresh All', `${has} Refresh All reads everything from disk again, so they will be lost.`, ['Cancel', 'Revert'])) === 1;
      if (!revert) return;
    }
    const paths = [...this.editors.keys()];
    const front = this.paneled
      ? this.dock.selected
      : [...this.editors.values()].find((e) => e instanceof EditorWindow && e.win === this.desk.keyWindow)?.path;
    const collapsed = this.dock.collapsed;
    const view = this.canvas?.viewport;
    if (!(await this.open(p.file, { confirmed: true }))) return;
    if (view && this.canvas) this.canvas.viewport = view;
    const project = this.project as Project | null;
    if (!project) return;
    for (const path of paths) if (project.docs.has(path)) this.openEditor(path);
    if (front && project.docs.has(front)) this.openEditor(front);
    if (this.paneled && collapsed) this.dock.collapse();
  }

  /** Re-reads the project folder: new, changed and deleted files. `auto`: on window focus. */
  private async rescan(auto: boolean): Promise<void> {
    const project = this.project;
    if (!project || this.scanning || (auto && Date.now() - this.lastScan < 3000)) return;
    this.scanning = true;
    try {
      const changed = await project.scan();
      this.lastScan = Date.now();
      if (project !== this.project) return;
      for (const p of changed) {
        const doc = project.docs.get(p);
        if (doc) this.editors.get(p)?.setText(doc.text);
        this.editors.get(p)?.setEdited(project.isDirty(p));
      }
      for (const n of this.tree.all()) this.tree.update(n.id, this.nodeFields(n.id));
      this.syncGraph();
      this.canvas?.refresh();
      this.menuChanged();
      void this.checkAgents();
    } catch (e) {
      if (!auto) alertPanel(this.desk, 'Can’t Rescan', (e as Error).message);
    } finally {
      this.scanning = false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Canvas                                                           */
  /* ---------------------------------------------------------------- */

  private makeCanvas(): void {
    this.canvas?.destroy();
    // Null while the canvas is being made: the view it starts with isn't one to keep.
    let made: CanvasView | null = null;
    this.canvas = made = new CanvasView(this.layer, {
      tree: this.tree,
      graph: this.graph,
      renameNodes: false,
      directions: false,
      // In view: left of the dock's bezel (wherever it is, open or not), clear of the browser's
      // menu stand-in and the hint line.
      viewable: () => ({ left: this.menu?.el.offsetWidth ?? 0, top: 0, right: this.dock.reserve, bottom: HINT_ROOM }),
      hints: this.project
        ? {
            idle: 'File ▸ Add MD File puts a file on the canvas · drag to pan · scroll to zoom · double-click a node to open its file',
            node: 'Double-click (or Enter) opens the file · drag moves it with its subtree (Alt-drag alone) · Tab new child file · Del removes it from the canvas',
            dep: 'Written in the source file’s Dependencies section · Enter edits the label · Del removes it from the file',
          }
        : { idle: 'Open a project file to begin: File ▸ Open Project… (or New Project…)' },
      edits: {
        addChild: (parent) => this.newFile({ parent }),
        removeNode: (id) => {
          this.tree.remove(id);
          this.syncGraph();
          this.layoutChanged();
        },
        addDependency: (s, t) => this.addDependency(s, t),
        updateDependency: (id, patch) => {
          const d = this.graph.get(id);
          const doc = this.project?.docs.get(d.source);
          if (doc && patch.label !== undefined) this.applyText(d.source, setDependencyLabel(doc.text, d.source, d.target, patch.label));
        },
        removeDependency: (id) => {
          const d = this.graph.get(id);
          const doc = this.project?.docs.get(d.source);
          if (doc) this.applyText(d.source, removeDependency(doc.text, d.source, d.target));
        },
      },
      onState: (s) => {
        this.canvasState = this.project ? s : null;
        this.menuChanged();
      },
      onLayoutChange: () => this.layoutChanged(),
      onViewChange: (v) => {
        const loc = this.project?.file;
        if (!loc || !made) return;
        clearTimeout(this.viewTimer);
        const saved: SavedView = { ...v, mid: made.viewableMiddle };
        this.viewTimer = window.setTimeout(() => storage(KEY.view(loc), JSON.stringify(saved)), 300);
      },
      onNodeOpen: (id) => this.openEditor(id),
      onBackgroundDoubleClick: (at) => this.project && this.newFile({ at }),
      // As on NeXT, a click elsewhere closes the (browser) menu's popped-out submenus (torn-off ones stay).
      onBackgroundClick: () => NxMenu.closeAttached(),
    });
  }

  private selectedNode(): string | null {
    const sel = this.canvas?.state.selection;
    return sel?.kind === 'node' ? sel.id : null;
  }

  /** How a file's node looks: its title (with a bullet while unsaved), its file name below, faded if the file is gone. */
  private nodeFields(path: string): Pick<DiagramNode, 'label' | 'sublabel' | 'tooltip' | 'muted'> {
    const doc = this.project?.docs.get(path);
    return {
      label: `${this.project?.isDirty(path) ? EDITED : ''}${doc?.title || basename(path)}`,
      sublabel: basename(path),
      tooltip: doc ? path : `${path} (missing)`,
      muted: !doc,
    };
  }

  /** Rebuilds the dependency arrows from the files on the canvas. */
  private syncGraph(): void {
    this.graph.clear();
    for (const n of this.tree.all()) {
      for (const d of this.project?.docs.get(n.id)?.deps ?? []) {
        if (this.tree.has(d.target)) this.graph.add(n.id, d.target, d.label, 'forward', depId(n.id, d.target));
      }
    }
  }

  /** Puts a file on the canvas: at `at`, under `parent`, or in a free spot mid-view. */
  private placeFile(path: string, at?: Pt, parent?: string | null): void {
    const canvas = this.canvas;
    if (!this.project || !canvas) return;
    if (this.tree.has(path)) {
      canvas.reveal(path);
      return;
    }
    const fields = this.nodeFields(path);
    if (parent && this.tree.has(parent)) {
      addChildWithLayout(this.tree, parent, fields.label, { id: path, ...fields });
    } else {
      const p = at ?? canvas.center();
      const spot = at ? { x: snap(p.x - NODE_W / 2), y: snap(p.y - NODE_H / 2) } : this.freeSpot(p);
      this.tree.add(null, fields.label, spot.x, spot.y, { id: path, ...fields });
    }
    this.syncGraph();
    canvas.refresh();
    canvas.reveal(path);
    this.layoutChanged();
  }

  /** A grid spot centered near `p` that no node covers (stepping down until clear). */
  private freeSpot(p: Pt): Pt {
    const spot = { x: snap(p.x - NODE_W / 2), y: snap(p.y - NODE_H / 2) };
    const nodes = this.tree.all();
    const hits = () => nodes.some((n) => Math.abs(n.x - spot.x) < NODE_W + G && Math.abs(n.y - spot.y) < NODE_H + G);
    for (let i = 0; i < 200 && hits(); i++) spot.y += NODE_H + 2 * G;
    return spot;
  }

  private addDependency(source: string, target: string): string | null {
    const docs = this.project?.docs;
    const doc = docs?.get(source);
    if (!doc) {
      alertPanel(this.desk, 'Can’t Add Dependency', `${source} is missing, so the dependency can’t be written into it.`);
      return null;
    }
    this.applyText(source, addDependency(doc.text, source, target, docs?.get(target)?.title ?? basename(target)));
    const id = depId(source, target);
    return this.graph.has(id) ? id : null;
  }

  /* ---------------------------------------------------------------- */
  /* Files                                                            */
  /* ---------------------------------------------------------------- */

  /** A change made here (canvas): into the file, its open editor, and the map. */
  private applyText(path: string, md: string): void {
    const doc = this.project?.docs.get(path);
    if (!doc || doc.text === md) return;
    this.edited(path, md);
    this.editors.get(path)?.setText(md);
  }

  /** The file's text changed (in its editor, or from the canvas): update its node and what is unsaved. */
  private edited(path: string, md: string): void {
    const project = this.project;
    if (!project) return;
    const before = project.docs.get(path)?.title;
    const doc = project.setText(path, md);
    this.syncGraph();
    this.docStateChanged(path);
    if (doc.title !== before) this.menuChanged(); // Add MD File shows titles
  }

  /** Shows whether the file has unsaved changes (node bullet, editor title) and keeps them for recovery. */
  private docStateChanged(path: string): void {
    if (this.tree.has(path)) this.tree.update(path, this.nodeFields(path));
    this.canvas?.refresh();
    this.editors.get(path)?.setEdited(!!this.project?.isDirty(path));
    this.updateTitle();
    this.scheduleRecovery();
  }

  /** The map changed (a node placed, moved, removed or reparented). */
  private layoutChanged(): void {
    this.updateTitle();
    this.scheduleRecovery();
    this.menuChanged(); // Add MD File greys out files on the canvas
  }

  /** The project file's text for the map as it is now. */
  private currentMapText(): string {
    return mapText(this.tree.all().map((n) => ({ file: n.id, x: n.x, y: n.y, parent: n.parentId })));
  }

  private mapDirty(): boolean {
    return !!this.project && this.currentMapText() !== this.project.savedMap;
  }

  /**
   * The window title: with the dock open, its front file's title and name ("Title — file.md");
   * otherwise the project file and folder. A bullet marks unsaved changes to the one named.
   */
  private updateTitle(): void {
    const p = this.project;
    const front = this.paneled && !this.dock.collapsed ? this.dock.selected : null;
    const doc = front ? p?.docs.get(front) : undefined;
    if (p && front) document.title = `${p.isDirty(front) ? EDITED : ''}${doc?.title || basename(front)} — ${basename(front)}`;
    else document.title = p ? `${this.mapDirty() ? EDITED : ''}${p.fileName} — ${p.name}` : 'App Mapper';
    this.host?.setEdited(!!p && (this.mapDirty() || p.dirty().length > 0), p?.file ?? null);
  }

  /** Save: the file being edited (its window in front, or its tab in front and focused), or else the project file. */
  private async save(): Promise<boolean> {
    const key = this.desk.keyWindow;
    const ed = [...this.editors.values()].find((e) => (e instanceof EditorWindow ? e.win === key : this.dock.focused && this.dock.selected === e.path));
    return ed ? this.saveDoc(ed.path) : this.saveMap();
  }

  /** Save All: the project file and every Markdown file with unsaved changes. */
  private async saveAll(): Promise<boolean> {
    const p = this.project;
    if (!p) return true;
    for (const ed of this.editors.values()) ed.flush();
    let ok = await this.saveMap();
    for (const path of p.dirty()) ok = (await this.saveDoc(path)) && ok;
    return ok;
  }

  private async saveDoc(path: string): Promise<boolean> {
    const p = this.project;
    if (!p) return true;
    this.editors.get(path)?.flush();
    if (!p.isDirty(path)) return true;
    try {
      await p.save(path);
    } catch (e) {
      alertPanel(this.desk, 'Can’t Save', `${path}: ${(e as Error).message}`);
      return false;
    }
    if (this.project === p) this.docStateChanged(path);
    return true;
  }

  private async saveMap(): Promise<boolean> {
    const p = this.project;
    if (!p || !this.mapDirty()) return true;
    try {
      await p.saveMap(this.currentMapText());
    } catch (e) {
      alertPanel(this.desk, 'Can’t Save the Project', `${p.fileName}: ${(e as Error).message}`);
      return false;
    }
    if (this.project === p) {
      this.updateTitle();
      this.scheduleRecovery();
    }
    return true;
  }

  /** What is unsaved, for the recovery store; null when everything is saved. */
  private recoveryData(): Recovery | null {
    const p = this.project;
    if (!p) return null;
    const map = this.mapDirty() ? this.currentMapText() : null;
    const docs: Record<string, string> = {};
    for (const path of p.dirty()) docs[path] = p.docs.get(path)!.text;
    return map === null && !Object.keys(docs).length ? null : { time: Date.now(), map, docs };
  }

  /** Keeps the unsaved changes for recovery shortly after they stop changing (or drops them once all is saved). */
  private scheduleRecovery(): void {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = window.setTimeout(() => {
      const p = this.project;
      const host = this.host;
      if (!p || !host || this.closing) return;
      const r = this.recoveryData();
      void (r ? host.recoveryPut(p.file, r) : host.recoveryClear(p.file)).catch(() => undefined);
    }, RECOVERY_DELAY);
  }

  /** Opens the file's editor (a window, or a tab of the paneled UI's dock), or brings it to the front. */
  private openEditor(path: string): void {
    const project = this.project;
    if (!project) return;
    const open = this.editors.get(path);
    if (open) return open instanceof EditorWindow ? this.desk.makeKey(open.win) : this.dock.select(path);
    const doc = project.docs.get(path);
    if (!doc) return alertPanel(this.desk, 'Missing File', `${path} is no longer in the project. Remove its node, or Rescan once it’s back.`);
    // Review Mode, as the user last set it for this file (else the editor's default).
    const annotationsKey = KEY.annotations(project.file, path);
    const saved = storage(annotationsKey);
    const options = {
      path,
      project: project.name,
      text: doc.text,
      user: this.user(),
      // Already under review (tracked changes or comments in it): keep tracking. Else not.
      trackChanges: hasRevisions(doc.text),
      annotations: saved === null ? undefined : saved === '1',
      // Remembered once set by hand; turned back on by highlighting or Track Changes, that's kept too.
      onAnnotationsChange: (on: boolean, manual: boolean) => {
        if (manual || storage(annotationsKey) !== null) storage(annotationsKey, on ? '1' : '0');
      },
      spellcheck: storage(KEY.spelling) !== '0',
      // One setting for every editor: the others follow.
      onSpellcheckChange: (on: boolean) => {
        storage(KEY.spelling, on ? '1' : '0');
        for (const e of this.editors.values()) e.editor.spellcheck = on;
      },
      onChange: (md: string) => this.edited(path, md),
      onSave: () => void this.saveDoc(path),
      onClose: () => this.editors.delete(path),
    };
    if (this.paneled) {
      const tab = new EditorTab(options, this.dock);
      this.editors.set(path, tab);
      tab.setEdited(project.isDirty(path));
      return;
    }
    const ed = new EditorWindow(options);
    this.editors.set(path, ed);
    ed.setEdited(project.isDirty(path));
    const n = (this.editors.size - 1) % 8;
    const x = (this.menu?.el.offsetWidth ?? 0) + 2 * G + n * 24;
    const y = 40 + n * 24;
    const w = Math.max(420, Math.min(780, this.desk.width - x - 24));
    const hgt = Math.max(260, Math.min(760, this.desk.height - y - 16));
    // Each file's editor comes back where it was last left (per project, in this browser).
    showRemembered(this.desk, ed.win, `editor:${project.file}:${path}`, { x, y, width: w, height: hgt });
  }

  /**
   * View ▸ Use Editor Windows (off: the paneled UI): open files move between windows and the
   * dock's tabs (closed and reopened there — their text is kept in the project, so nothing is lost).
   */
  /** View ▸ Theme: the whole app in Classic (NeXT) or Modern dress, remembered. */
  private setTheme(theme: NxTheme): void {
    setNxTheme(theme);
    storage(KEY.theme, theme === 'classic' ? 'classic' : null);
    this.menuChanged();
    // The menu's width (in the browser) bounds the canvas's viewable area.
    this.layoutDock();
  }

  private setPaneled(on: boolean): void {
    if (on === this.paneled) return;
    const front = on
      ? [...this.editors.values()].find((e) => e instanceof EditorWindow && e.win === this.desk.keyWindow)?.path
      : this.dock.selected;
    const paths = [...this.editors.keys()];
    for (const ed of [...this.editors.values()]) {
      ed.flush();
      ed.close();
    }
    this.paneled = on;
    storage(KEY.windows, on ? null : '1');
    this.dock.visible = on;
    this.layoutDock();
    for (const p of paths) this.openEditor(p);
    if (front) this.openEditor(front);
    this.menuChanged();
  }

  /**
   * The window was resized or the dock's bezel moved: the canvas pans to keep what was in the
   * middle of its viewable area (left of the bezel) there. The canvas spans the whole window,
   * under the dock, so opening or closing the dock moves nothing.
   */
  private layoutDock(): void {
    this.layer.style.setProperty('--mapper-reserve', `${this.dock.reserve}px`);
    this.canvas?.relayout();
  }

  /** Who edits (highlights, comments, tracked changes): the computer's user name, else “Me”. */
  private user(): string {
    return (this.info?.user ?? '').trim().replace(/\W+/g, '_') || 'Me';
  }

  private newFile(context: { parent?: string; at?: Pt }): void {
    const project = this.project;
    if (!project) return void this.openProject();
    this.newContext = context;
    this.newPanel.prepare(project.name, project.dirs, project.paths());
    showCentered(this.desk, this.newPanel.win, NEW_FILE_PANEL_SIZE.width, NEW_FILE_PANEL_SIZE.height, 'new-file');
    this.newPanel.focus();
  }

  /** Creates the file and its node, and opens it. Returns an error message, or null. */
  private async createFile(req: NewFileRequest): Promise<string | null> {
    const project = this.project;
    if (!project) return 'No project is open.';
    const path = req.dir ? `${req.dir}/${req.name}` : req.name;
    try {
      await project.create(path, newDocText(req.title));
    } catch (e) {
      return (e as Error).message;
    }
    this.placeFile(path, this.newContext.at, this.newContext.parent);
    this.openEditor(path);
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Menu                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * File ▸ Add MD File: every Markdown file in the project, as “Title — project/path/file.md”.
   * Choosing one puts it on the canvas; those already there are greyed out.
   */
  private addItems(): MenuSpec[] {
    const p = this.project;
    if (!p) return [];
    return p.paths().map((path) => ({
      label: `${p.docs.get(path)?.title || basename(path)} — ${p.name}/${path}`,
      enabled: !this.tree.has(path),
      command: `add-file:${path}`,
    }));
  }

  /** The application menu as things are now: File, Canvas, Edit, View, Window (see menuCommand). */
  private menuSpec(): MenuSpec[] {
    const p = !!this.project;
    const st = this.canvasState;
    const sep: MenuSpec = { separator: true };
    const mac = this.info?.platform === 'darwin';
    return [
      {
        label: 'File',
        submenu: [
          { label: 'New Project…', command: 'new-project', accelerator: 'CmdOrCtrl+Shift+N' },
          { label: 'Open Project…', command: 'open-project', accelerator: 'CmdOrCtrl+O' },
          { label: 'Rescan Project', command: 'rescan', enabled: p },
          { label: 'Refresh All', command: 'refresh-all', enabled: p },
          { label: 'Set Up for AI Agents', command: 'set-up-agents', enabled: p && this.agents !== null && this.agents !== 'current' },
          sep,
          { label: 'New MD File…', command: 'new-file', accelerator: 'CmdOrCtrl+N', enabled: p },
          { label: 'Add MD File', enabled: !!this.project?.paths().length, submenu: this.addItems() },
          sep,
          { label: 'Save', command: 'save', accelerator: 'CmdOrCtrl+S', enabled: p },
          { label: 'Save All', command: 'save-all', accelerator: 'CmdOrCtrl+Alt+S', enabled: p },
          sep,
          { role: mac ? 'close' : 'quit' },
        ],
      },
      {
        label: 'Canvas',
        submenu: [
          { label: 'New Child…', command: 'canvas:new-child', enabled: !!st?.canAddChild },
          { label: 'Set Parent', command: 'canvas:set-parent', enabled: !!st?.canReparent || st?.mode === 'reparent', checked: st?.mode === 'reparent' },
          { label: 'Detach', command: 'canvas:detach', enabled: !!st?.canDetach },
          { label: 'Dependency', command: 'canvas:dependency', enabled: p, checked: st?.mode === 'dependency' },
          { label: 'Remove', command: 'canvas:remove', enabled: !!st?.canDelete },
          sep,
          { label: 'Reset View', command: 'canvas:reset-view', enabled: p },
          { label: 'Zoom In', command: 'canvas:zoom-in', enabled: p },
          { label: 'Zoom Out', command: 'canvas:zoom-out', enabled: p },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Use Editor Windows', command: 'editor-windows', checked: !this.paneled },
          sep,
          {
            label: 'Theme',
            submenu: [
              { label: 'Classic', command: 'theme:classic', checked: nxTheme() === 'classic', radio: true },
              { label: 'Modern', command: 'theme:modern', checked: nxTheme() === 'modern', radio: true },
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
  }

  /** Something the menu shows changed: sends the menu again (once, after the current task). */
  private menuChanged(): void {
    if (this.menuQueued) return;
    this.menuQueued = true;
    queueMicrotask(() => {
      this.menuQueued = false;
      if (this.menu) return NxMenu.validate();
      const json = JSON.stringify(this.menuSpec());
      if (json === this.menuSent || !this.host) return;
      this.menuSent = json;
      this.host.setMenu(JSON.parse(json) as MenuSpec[]);
    });
  }

  /**
   * In a browser (no application menu): the same menus as a NeXT menu, without Electron's
   * standard items. Read afresh from menuSpec whenever menus are validated.
   */
  private makeDevMenu(): NxMenu {
    const convert = (items: MenuSpec[]): NxMenuItem[] =>
      items
        .filter((m) => !m.role && !m.separator)
        .map((m) => ({
          label: m.label ?? '',
          enabled: () => m.enabled ?? true,
          ...(m.checked !== undefined ? { checked: () => !!m.checked } : {}),
          ...(m.submenu ? { submenu: () => convert(this.menuSpec().flatMap((t) => findSub(t, m.label))) } : {}),
          ...(m.command ? { action: () => void this.menuCommand(m.command!) } : {}),
        }));
    // A submenu's items, found again by label in a fresh menuSpec (so they are current).
    const findSub = (t: MenuSpec, label?: string): MenuSpec[] => {
      if (t.label === label && t.submenu) return t.submenu;
      return (t.submenu ?? []).flatMap((c) => findSub(c, label));
    };
    return new NxMenu({ title: 'App Mapper', items: () => convert(this.menuSpec()) });
  }
}
