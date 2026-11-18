/**
 * Notes: who made a highlight, addition or deletion, when, and why, and the replies to it — or
 * a comment anchored at a point in the text. CriticMarkup comments, each in its own block,
 * right after the mark they belong to:
 *
 *     {++new text++}{>>Claude 2026-11-18 13:55: Clarifies the claim<<}{>>Joe 2026-11-18 14:02: Agreed<<}
 *
 * A note is an author (\w+), a space and a date — `YYYY-MM-DD`, optionally followed by a time,
 * `HH:MM` or `HH:MM:SS`, and that optionally by a zone, `Z`, `UTC` or `±HH:MM` (a space before
 * it allowed) — then optionally a colon and a comment. A time without a zone is local. The
 * editor writes local time to the minute. The first note is the mark's author's; the rest are replies. A block that isn't
 * written that way is still a comment, by nobody in particular. Blocks after no mark are an
 * anchored comment, at that point in the text.
 */
import { h } from '../widgets';

export interface Note {
  /** '' for a comment that doesn't say who wrote it. */
  author: string;
  /** Its date and time as written (`2026-11-18 13:55`). */
  stamp?: string;
  /** That as a time (ms since the epoch), when it is a real date. */
  time?: number;
  /** Whether `stamp` has a time of day, not just a date. */
  timed?: boolean;
  comment?: string;
  /** Markdown index of the note's first character, just past its `{>>`. */
  from: number;
  /** Markdown index just past its last character, at its `<<}`. */
  to: number;
}

/** One note block, `{>>text<<}` (sticky: set lastIndex, then exec). Its text is one line. */
const NOTE = /\{>>([^\n]*?)<<\}/y;
/** A note's date, and optionally time and zone: `2026-11-18`, `2026-11-18 13:55:07Z`, … */
const STAMP = String.raw`\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?: ?(?:Z|UTC|[+-]\d{2}:?\d{2}))?)?`;
/** A note block with an author and date: in code, the only kind (sticky). */
const SIGNED_NOTE = new RegExp(String.raw`\{>>(\w+ ${STAMP}(?::[^\n]*?)?)<<\}`, 'y');
const SIGNED = new RegExp(String.raw`^(\w+) (${STAMP})(?::\s*(.*))?$`, 's');
const PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?: ?(Z|UTC|[+-]\d{2}:?\d{2}))?)?$/;

/** The time a stamp stands for (ms since the epoch), or undefined if it isn't a real date. */
function stampTime(stamp: string): number | undefined {
  const m = PARTS.exec(stamp);
  if (!m) return undefined;
  const [y, mo, d, hh = 0, mm = 0, ss = 0] = m.slice(1, 7).map((x) => (x === undefined ? undefined : Number(x))) as number[];
  const zone = m[7];
  let t: number;
  if (zone === undefined) {
    const local = new Date(y, mo - 1, d, hh, mm, ss);
    if (local.getMonth() !== mo - 1 || local.getDate() !== d) return undefined;
    t = local.getTime();
  } else {
    const off = zone === 'Z' || zone === 'UTC' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    t = Date.UTC(y, mo - 1, d, hh, mm, ss) - off * 60000;
  }
  return hh > 23 || mm > 59 || ss > 59 || Number.isNaN(t) ? undefined : t;
}

/**
 * The note blocks in a row at `t[i]`: each one's text and where it starts in `t`, and the
 * index just past the last. In code (`signed`), only blocks with an author and time count.
 */
export function notesAt(t: string, i: number, signed = false): { notes: { text: string; at: number }[]; end: number } {
  const re = signed ? SIGNED_NOTE : NOTE;
  const notes: { text: string; at: number }[] = [];
  let end = i;
  for (;;) {
    re.lastIndex = end;
    const m = re.exec(t);
    if (!m) return { notes, end };
    notes.push({ text: m[1], at: end + 3 });
    end += m[0].length;
  }
}

/** The note written as `text` (without its `{>>` and `<<}`), at markdown [from, to). */
export function noteOf(text: string, from: number, to: number): Note {
  const m = SIGNED.exec(text);
  if (!m) return { author: '', comment: text.trim() || undefined, from, to };
  const comment = m[3]?.trim();
  return { author: m[1], stamp: m[2], time: stampTime(m[2]), timed: m[2].length > 10, comment: comment || undefined, from, to };
}

/** A comment as a note can hold it: one line, and nothing that would close its block early. */
export function cleanComment(comment: string): string {
  return comment.replace(/\s+/g, ' ').replace(/<<\}/g, '<<').trim();
}

/** Local date and time to the minute, as a note's stamp: `2026-11-18 13:55`. */
export function stampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A new note block by `author` now (`{>>author 2026-11-18 13:55: comment<<}`), or '' if the name has no usable characters. */
export function makeNote(author: string, comment = '', when = new Date()): string {
  const who = author.replace(/\W+/g, '');
  if (!who) return '';
  const text = cleanComment(comment);
  return `{>>${who} ${stampOf(when)}${text ? `: ${text}` : ''}<<}`;
}

/** How a change was resolved, kept in its thread: its last comment is "Accepted" or "Rejected". */
export type Verdict = 'accepted' | 'rejected';

/** The verdict a thread ends with, if any: its last comment, any case, a final "." or "!" allowed. */
export function verdictOf(notes: readonly { comment?: string }[]): Verdict | null {
  const c = notes[notes.length - 1]?.comment?.trim().replace(/[.!]+$/, '').toLowerCase();
  return c === 'accepted' || c === 'rejected' ? c : null;
}

/** A note's date (and time, if it has one) to show: in local time, or as written if it isn't a real date. */
export function formatStamp(n: Pick<Note, 'stamp' | 'time' | 'timed'>): string {
  if (n.time === undefined) return n.stamp ?? '';
  const d = new Date(n.time);
  return n.timed ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** The hover card's contents: the author's note, then the replies. */
export function noteList(notes: readonly Note[]): HTMLElement {
  const list = h('div', { className: 'md-notes' });
  notes.forEach((n, i) => {
    const item = h('div', { className: i ? 'md-note reply' : 'md-note' });
    const head = h('div', { className: 'md-note-head' });
    if (n.author) head.append(h('span', { className: 'md-note-author', textContent: n.author }));
    if (n.stamp) head.append(h('span', { className: 'md-note-time', textContent: formatStamp(n) }));
    item.append(head);
    if (n.comment) item.append(h('div', { className: 'md-note-text', textContent: n.comment }));
    list.append(item);
  });
  return list;
}
