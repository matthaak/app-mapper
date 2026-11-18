/**
 * Setting a project up for AI agents: App Mapper's skill — how to write specs, link them, keep
 * the map, and answer tracked changes and comments — in the project's
 * `.claude/skills/app-mapper/SKILL.md` (where Claude Code finds skills), and a pointer to it in
 * AGENTS.md (read by other agents).
 *
 * The skill is App Mapper's: written from the template shipped with this version, stamped with
 * SKILL_VERSION, and replaced outright when updated. In AGENTS.md only the block between the
 * markers is App Mapper's; the rest of the file is left as it was.
 */
import template from './agent-skill.md.tmpl?raw';
import { joinAbs, type Host } from './host';

/** Raise whenever the template changes, so projects with an older skill are offered the update. */
export const SKILL_VERSION = 2;
/** The skill, relative to the project root. */
export const SKILL_PATH = '.claude/skills/app-mapper/SKILL.md';
export const AGENTS_FILE = 'AGENTS.md';

const BEGIN = '<!-- app-mapper -->';
const END = '<!-- /app-mapper -->';
const BLOCK = [
  BEGIN,
  '## App Mapper',
  '',
  `This project is mapped with App Mapper: its Markdown files are the specs, linked by their Dependencies sections, and the user reviews them with tracked changes and comments written into the files. Before writing specs, changing dependencies or the map, or answering the user's spec changes, read and follow [${SKILL_PATH}](${SKILL_PATH}).`,
  END,
].join('\n');

/** The skill for a project whose project file is named `projectFile`. */
export function skillText(projectFile: string): string {
  return template.replace(/\{\{projectFile\}\}/g, projectFile).replace(/\{\{version\}\}/g, String(SKILL_VERSION));
}

/** The version a skill's text is stamped with, or null if it has none (not App Mapper's). */
export function skillVersion(text: string): number | null {
  const m = /<!--\s*app-mapper-skill v(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** AGENTS.md with App Mapper's block: replaced where it is, else added at the end (or the whole file, if there is none). */
export function agentsText(existing: string | null): string {
  if (existing === null || !existing.trim()) return `# Agent Instructions\n\n${BLOCK}\n`;
  const from = existing.indexOf(BEGIN);
  const to = from < 0 ? -1 : existing.indexOf(END, from);
  if (to >= 0) return existing.slice(0, from) + BLOCK + existing.slice(to + END.length);
  return `${existing.replace(/\s*$/, '')}\n\n${BLOCK}\n`;
}

/**
 * How far a project is set up:
 *  - 'none': no skill;
 *  - 'old': a skill from an older App Mapper (or one without a version);
 *  - 'stale': the skill or the AGENTS.md block differs from what this version would write
 *    (the project file was renamed, say, or the block was removed);
 *  - 'current': both are as this version writes them.
 */
export type AgentSetup = 'none' | 'old' | 'stale' | 'current';

export async function agentSetup(host: Host, root: string, projectFile: string): Promise<AgentSetup> {
  const [skill, agents] = await Promise.all([
    host.read(joinAbs(root, SKILL_PATH)).catch(() => null),
    host.read(joinAbs(root, AGENTS_FILE)).catch(() => null),
  ]);
  if (skill === null) return 'none';
  if ((skillVersion(skill) ?? 0) < SKILL_VERSION) return 'old';
  if (skill !== skillText(projectFile) || agents === null || agentsText(agents) !== agents) return 'stale';
  return 'current';
}

/** Writes the skill (making its folders) and App Mapper's block in AGENTS.md. */
export async function setUpAgents(host: Host, root: string, projectFile: string): Promise<void> {
  let dir = root;
  for (const name of SKILL_PATH.split('/').slice(0, -1)) {
    dir = joinAbs(dir, name);
    await ensureFolder(host, dir);
  }
  await host.write(joinAbs(root, SKILL_PATH), skillText(projectFile));
  const agents = joinAbs(root, AGENTS_FILE);
  const existing = await host.read(agents);
  const next = agentsText(existing);
  if (next !== existing) await host.write(agents, next);
}

/** Makes a folder unless it is there already (the host's mkdir makes only new ones). */
async function ensureFolder(host: Host, abs: string): Promise<void> {
  try {
    await host.mkdir(abs);
  } catch (e) {
    try {
      await host.list(abs);
    } catch {
      throw e;
    }
  }
}
