/*
 * Finds a project's Markdown files, and project files to open: shared by the Electron main
 * process and the dev server's file API (server/fs-api.ts).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseMap } from './map-format.js';

/** Folders never scanned for docs. Hidden folders (".git", ".claude", …) are skipped too. */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'bower_components', 'release']);
const MAX_ENTRIES = 20000;
const MAX_DEPTH = 16;

export const isMarkdown = (p: string): boolean => /\.(md|markdown)$/i.test(p);
/** What App Mapper may read and write: Markdown files and project files. */
export const isProjectFile = (p: string): boolean => isMarkdown(p) || /\.json$/i.test(p);

/** Every Markdown file and folder under `root`, relative and '/'-separated (bounded in depth and size). */
export async function scan(root: string): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [''];
  let seen = 0;
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || seen > MAX_ENTRIES) return;
    let entries;
    try {
      entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) return;
      if (e.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        dirs.push(child);
        await walk(child, depth + 1);
      } else if (e.isFile() && isMarkdown(e.name)) {
        files.push(child);
      }
    }
  };
  await walk('', 0);
  return { files, dirs };
}

/** Larger .json files aren't read to see whether they are project files. */
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;

/** Whether the file is an App Mapper project file (valid JSON in its format). */
async function isProject(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile() || st.size > MAX_PROJECT_BYTES) return false;
    parseMap(await fs.readFile(p, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

/**
 * A folder's sub-folders (not hidden) and the project files in it: only .json files that are
 * valid App Mapper projects, for the Open Project panel.
 */
export async function listProjects(dir: string): Promise<{ dirs: string[]; files: string[] }> {
  const entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  const byName = (a: string, b: string) => a.localeCompare(b);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(byName);
  const json = entries.filter((e) => (e.isFile() || e.isSymbolicLink()) && /\.json$/i.test(e.name)).map((e) => e.name);
  const ok = await Promise.all(json.map((n) => isProject(path.join(dir, n))));
  return { dirs, files: json.filter((_, i) => ok[i]).sort(byName) };
}

/** A file's text, or null if there is none. */
export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EISDIR') return null;
    throw e;
  }
}
