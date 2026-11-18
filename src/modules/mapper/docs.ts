/*
 * What App Mapper reads from (and writes to) a Markdown file.
 *
 * Title: the text of the file's first `#` heading (any level), as plain text.
 *
 * Dependencies: the list items in the file's "Dependencies" section — a heading named
 * "Dependencies" (or "Depends on"), up to the next heading of the same or a higher level.
 * Each item that links to another Markdown file is one dependency of this file on that one;
 * text after the link (past a dash or colon) is the dependency's label:
 *
 *     ## Dependencies
 *
 *     - [Canvas](canvas.md) — draws the map
 *     - [Widgets](../widgets.md): windows and controls
 *     - [MD Editor](/docs/md-editor.md)
 *
 * Links are relative to the file's folder; a leading `/` means the project root. Items without
 * a link to a .md file are ignored, so the section can hold other notes too.
 *
 * Review markup from the MD Editor (CriticMarkup: {++added++}, {--deleted--}, {==highlighted==}
 * and {>>comments<<}) is read as if the changes were accepted.
 */

export interface DocDependency {
  /** The target file's project path. */
  target: string;
  label: string;
}

export interface DocInfo {
  /** The first heading's text ('' if there is none). */
  title: string;
  deps: DocDependency[];
}

/** The section heading names that hold dependencies (compared case-insensitively). */
const SECTION = /^(dependencies|depends on)$/i;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const LINK = /(?<!!)\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/;
/** MD Editor review markup read as accepted: notes dropped, deletions dropped, the rest kept. */
const accepted = (s: string) =>
  s
    .replace(/\{>>[^\n]*?<<\}/g, '')
    .replace(/\{--[^\n]*?--\}/g, '')
    .replace(/\{\+\+([^\n]*?)\+\+\}/g, '$1')
    .replace(/\{==([^\n]*?)==\}/g, '$1');

// ---------------------------------------------------------------------------------------
// Paths

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Resolves `.` and `..`; null if the path climbs above the root. */
function normalize(parts: string[]): string | null {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join('/');
}

/** The project path a link in `from` points to, if it is a Markdown file in the project. */
export function resolveLink(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  let path = href.replace(/[?#].*$/, '');
  try {
    path = decodeURI(path);
  } catch {
    // Keep it as written.
  }
  if (!/\.(md|markdown)$/i.test(path)) return null;
  const base = path.startsWith('/') ? [] : dirname(from).split('/');
  return normalize([...base, ...path.split('/')]);
}

/** A relative link from file `from` to file `to`. */
export function relativeLink(from: string, to: string): string {
  const a = dirname(from).split('/').filter(Boolean);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  const rel = [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
  return encodeURI(rel).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// ---------------------------------------------------------------------------------------
// Reading

/** Plain text of inline markdown: formatting dropped, tracked changes as if accepted. */
export function plainText(s: string): string {
  return accepted(s)
    .replace(/!?\[((?:[^\]\\]|\\.)*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_(?!\s)(.+?)_(?!\w)/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!~^@])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Line {
  /** Index in the file's lines. */
  index: number;
  text: string;
  heading?: { level: number; text: string };
}

/** The file's lines outside front matter and fenced code, with headings recognized. */
function lines(md: string): { all: string[]; content: Line[] } {
  const all = md.split('\n');
  const content: Line[] = [];
  let i = 0;
  // YAML front matter.
  if (all[0]?.trim() === '---') {
    const end = all.findIndex((l, j) => j > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < all.length; i++) {
    const text = all[i];
    const f = FENCE.exec(text);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const h = HEADING.exec(text);
    content.push(h ? { index: i, text, heading: { level: h[1].length, text: h[2] ?? '' } } : { index: i, text });
  }
  return { all, content };
}

interface Item {
  /** Line index of the list item. */
  index: number;
  target: string;
  label: string;
}

interface Section {
  /** Line index of the section heading. */
  heading: number;
  /** Line index just past the section. */
  end: number;
  items: Item[];
}

/** The Dependencies section (the first, if there are several). */
function section(md: string, path: string): { all: string[]; section: Section | null } {
  const { all, content } = lines(md);
  let sec: Section | null = null;
  let level = 0;
  for (const line of content) {
    if (line.heading) {
      if (sec) {
        if (line.heading.level <= level) {
          sec.end = line.index;
          break;
        }
        continue;
      }
      if (SECTION.test(plainText(line.heading.text))) {
        sec = { heading: line.index, end: all.length, items: [] };
        level = line.heading.level;
      }
      continue;
    }
    if (!sec) continue;
    const item = ITEM.exec(line.text);
    if (!item) continue;
    const parsed = parseItem(item[3], path);
    if (parsed) sec.items.push({ index: line.index, ...parsed });
  }
  return { all, section: sec };
}

/** An item's target and label (text after the link, or before it if there is none after). */
function parseItem(text: string, path: string): { target: string; label: string } | null {
  const clean = accepted(text);
  const m = LINK.exec(clean);
  if (!m) return null;
  const target = resolveLink(path, m[2]);
  if (!target) return null;
  const after = plainText(clean.slice(m.index + m[0].length)).replace(/^[\s—–:-]+/, '');
  const before = plainText(clean.slice(0, m.index)).replace(/[\s—–:-]+$/, '');
  return { target, label: after || before };
}

/** The title and dependencies of the file at project path `path`. */
export function parseDoc(md: string, path: string): DocInfo {
  const first = lines(md).content.find((l) => l.heading);
  const deps: DocDependency[] = [];
  for (const item of section(md, path).section?.items ?? []) {
    if (item.target !== path && !deps.some((d) => d.target === item.target)) deps.push({ target: item.target, label: item.label });
  }
  return { title: first ? plainText(first.heading!.text) : '', deps };
}

// ---------------------------------------------------------------------------------------
// Writing

const escapeLinkText = (s: string) => s.replace(/([[\]\\])/g, '\\$1');

function itemLine(marker: string, from: string, to: string, title: string, label: string): string {
  const link = `[${escapeLinkText(title || basename(to))}](${relativeLink(from, to)})`;
  return `${marker} ${link}${label ? ` — ${label}` : ''}`;
}

/** Adds a dependency of `from` on `to` to its Dependencies section (creating the section). */
export function addDependency(md: string, from: string, to: string, toTitle: string, label = ''): string {
  const { all, section: sec } = section(md, from);
  if (sec?.items.some((i) => i.target === to)) return md;
  if (!sec) {
    const body = md.replace(/\s+$/, '');
    return `${body}${body ? '\n\n' : ''}## Dependencies\n\n${itemLine('-', from, to, toTitle, label)}\n`;
  }
  const last = sec.items[sec.items.length - 1];
  if (last) {
    const [, indent, lastMarker] = ITEM.exec(all[last.index])!;
    const marker = lastMarker.replace(/^(\d+)([.)])$/, (_, n: string, p: string) => `${Number(n) + 1}${p}`);
    all.splice(last.index + 1, 0, indent + itemLine(marker, from, to, toTitle, label));
  } else {
    // Right under the heading: one blank line before the list, and one after it unless the
    // section ends there.
    let at = sec.heading + 1;
    while (at < sec.end && !all[at].trim()) at++;
    const next = at < all.length && all[at].trim() ? [''] : [];
    all.splice(sec.heading + 1, at - sec.heading - 1, '', itemLine('-', from, to, toTitle, label), ...next);
  }
  return all.join('\n');
}

/** Removes `from`'s dependency items on `to`. */
export function removeDependency(md: string, from: string, to: string): string {
  const { all, section: sec } = section(md, from);
  const drop = new Set(sec?.items.filter((i) => i.target === to).map((i) => i.index));
  if (!drop.size) return md;
  return all.filter((_, i) => !drop.has(i)).join('\n');
}

/** Rewrites the label of `from`'s dependency on `to` (the text after its link). */
export function setDependencyLabel(md: string, from: string, to: string, label: string): string {
  const { all, section: sec } = section(md, from);
  const item = sec?.items.find((i) => i.target === to);
  if (!item) return md;
  const line = all[item.index];
  const m = LINK.exec(line);
  if (!m) return md;
  all[item.index] = line.slice(0, m.index + m[0].length) + (label ? ` — ${label}` : '');
  return all.join('\n');
}

/** A new file's starting text. */
export const newDocText = (title: string) => `# ${title}\n\n`;
