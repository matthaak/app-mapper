import { parseDoc, type DocDependency } from './docs';
import { basenameAbs, dirnameAbs, joinAbs, type Host } from './host';
import type { MapNode } from '../../../electron/map-format';

export { parseMap, type MapFile, type MapNode } from '../../../electron/map-format';

/** One Markdown file of the project, as last read or edited. */
export interface Doc {
  path: string;
  text: string;
  title: string;
  deps: DocDependency[];
}

/** The usual project file name (any .json name will do). */
export const DEFAULT_PROJECT_FILE = 'app-map.json';

/** A project file's text: nodes sorted by file and written one per line, so it diffs well. */
export function mapText(nodes: MapNode[]): string {
  const sorted = [...nodes].sort((a, b) => a.file.localeCompare(b.file));
  const lines = sorted.map((n) => `    ${JSON.stringify({ file: n.file, x: n.x, y: n.y, parent: n.parent })}`);
  return lines.length ? `{\n  "version": 1,\n  "nodes": [\n${lines.join(',\n')}\n  ]\n}\n` : `{\n  "version": 1,\n  "nodes": []\n}\n`;
}

/**
 * A project: its project file (the map), and the Markdown files in the folder that holds it
 * and below (read into memory). Tracks what has been saved, so unsaved changes can be shown.
 */
export class Project {
  readonly docs = new Map<string, Doc>();
  /** Every folder, '' being the root. */
  dirs: string[] = [''];
  /** The folder holding the project file. */
  readonly root: string;
  /** Each file's text as last read from or written to disk. */
  private readonly saved = new Map<string, string>();
  /** The project file's text as last read or saved. */
  savedMap: string;

  constructor(
    readonly host: Host,
    /** The project file's absolute path. */
    readonly file: string,
    mapText: string,
  ) {
    this.root = dirnameAbs(file);
    this.savedMap = mapText;
  }

  /** The project's folder name. */
  get name(): string {
    return basenameAbs(this.root);
  }

  get fileName(): string {
    return basenameAbs(this.file);
  }

  abs(path: string): string {
    return joinAbs(this.root, path);
  }

  /** Paths sorted for listing: root files first, then by path. */
  paths(): string[] {
    const depth = (p: string) => (p.includes('/') ? 1 : 0);
    return [...this.docs.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  isDirty(path: string): boolean {
    const doc = this.docs.get(path);
    return !!doc && doc.text !== this.saved.get(path);
  }

  /** Files with unsaved changes. */
  dirty(): string[] {
    return [...this.docs.keys()].filter((p) => this.isDirty(p));
  }

  /**
   * Re-reads the folder. Files with unsaved changes keep their text in memory.
   * Returns the paths whose text changed on disk, appeared or disappeared.
   */
  async scan(): Promise<string[]> {
    const { files, dirs } = await this.host.scan(this.root);
    this.dirs = dirs;
    const changed: string[] = [];
    const found = new Set(files);
    for (const path of [...this.docs.keys()]) {
      if (!found.has(path) && !this.isDirty(path)) {
        this.docs.delete(path);
        this.saved.delete(path);
        changed.push(path);
      }
    }
    const keep = new Set(this.dirty());
    const texts = await mapLimit(files, 8, (p) => (keep.has(p) ? Promise.resolve(null) : this.host.read(this.abs(p))));
    files.forEach((path, i) => {
      const text = texts[i];
      if (text === null) return;
      this.saved.set(path, text);
      if (this.docs.get(path)?.text === text) return;
      this.setText(path, text);
      changed.push(path);
    });
    return changed;
  }

  /** Updates a file's text in memory (and what it says: title, dependencies). */
  setText(path: string, text: string): Doc {
    const doc = { path, text, ...parseDoc(text, path) };
    this.docs.set(path, doc);
    return doc;
  }

  /** Writes the file's text to disk. */
  async save(path: string): Promise<void> {
    const doc = this.docs.get(path);
    if (!doc) return;
    const text = doc.text;
    await this.host.write(this.abs(path), text);
    this.saved.set(path, text);
  }

  /** Creates a new file on disk. Fails if one is already there. */
  async create(path: string, text: string): Promise<Doc> {
    if (this.docs.has(path) || (await this.host.read(this.abs(path))) !== null) throw new Error(`${path} already exists.`);
    await this.host.write(this.abs(path), text);
    this.saved.set(path, text);
    return this.setText(path, text);
  }

  /** Writes the project file. */
  async saveMap(text: string): Promise<void> {
    await this.host.write(this.file, text);
    this.savedMap = text;
  }
}

/** Runs `f` over `items`, at most `limit` at a time, keeping the order of results. */
async function mapLimit<T, R>(items: T[], limit: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
