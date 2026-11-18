/*
 * The project file's format, checked by the page as it opens a project and by the Electron main
 * process and the dev server as they list project files (only valid ones are offered). No
 * imports: it runs in both.
 */

/** A node of the map, as saved in the project file. */
export interface MapNode {
  file: string;
  x: number;
  y: number;
  parent: string | null;
}

export interface MapFile {
  version: 1;
  nodes: MapNode[];
}

/**
 * Reads a project file's text, checking it is one: `{ "version": 1, "nodes": [...] }`, each
 * node a file (relative to the project root), a position and a parent file or null.
 * Throws with what is wrong.
 */
export function parseMap(text: string): MapFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`It isn’t valid JSON (${(e as Error).message}).`);
  }
  const fail = (what: string): never => {
    throw new Error(`It isn’t an App Mapper project: ${what}.`);
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('it should be an object with “version” and “nodes”');
  const o = data as Record<string, unknown>;
  if (o.version !== 1) fail(o.version === undefined ? '“version” is missing' : `“version” is ${JSON.stringify(o.version)}, not 1`);
  if (!Array.isArray(o.nodes)) fail('“nodes” should be a list');
  const seen = new Set<string>();
  const nodes = (o.nodes as unknown[]).map((n, i): MapNode => {
    const at = `node ${i + 1}`;
    if (!n || typeof n !== 'object') fail(`${at} isn’t an object`);
    const { file, x, y, parent } = n as Record<string, unknown>;
    if (typeof file !== 'string' || !file) fail(`${at} has no “file”`);
    const f = file as string;
    if (/^([\\/]|[A-Za-z]:)/.test(f) || f.split(/[\\/]/).includes('..')) fail(`${at}’s file “${f}” must be inside the project folder`);
    if (seen.has(f)) fail(`“${f}” is listed twice`);
    seen.add(f);
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) fail(`${at} (“${f}”) needs numbers “x” and “y”`);
    if (parent !== null && parent !== undefined && typeof parent !== 'string') fail(`${at} (“${f}”) has a “parent” that isn’t a file or null`);
    return { file: f, x: x as number, y: y as number, parent: (parent as string | null | undefined) ?? null };
  });
  return { version: 1, nodes };
}
