/**
 * Attributions: who made a highlight, addition (++…++) or deletion (~~…~~), when, and why.
 *
 * Written at the very start of the section, inside its delimiters, as a thread: one opening
 * `@@`, the notes separated by `@@`, and one closing `@@`:
 *
 *     ++@@Claude.1794519000 Clarifies the claim@@Joe.1794588000 Agreed@@new text++
 *
 * Each note has an author (\w+), then optionally a dot and a unix timestamp (seconds), then
 * optionally a space and a comment. The first note is the section's author's; the rest are
 * replies. (The older form, each note in its own `@@…@@`, still reads the same.)
 */
import { h } from '../widgets';

export interface Note {
  author: string;
  /** Unix time in seconds. */
  time?: number;
  comment?: string;
  /** Markdown index of the note's first character (its author), just past an `@@`. */
  from: number;
  /** Markdown index just past its last character, at the `@@` that follows it. */
  to: number;
}

/**
 * One note's text. A comment holds no line break or `@@`, nor a mark's delimiter (`^^`, `~~`,
 * `++`): so a thread can't run on past the end of its mark.
 */
const TOKEN = String.raw`\w+(?:\.\d+)?(?: (?:(?!@@|\^\^|~~|\+\+)[^\n])*?)?`;
/** A thread of notes, `@@note@@note@@` (global: use with matchAll). */
export const THREAD = new RegExp(`@@${TOKEN}(?:@@${TOKEN})*@@`, 'g');

/** A thread's notes: the text of each (between the `@@`s) and where it starts in the thread. */
export function threadNotes(thread: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let at = 2;
  for (const text of thread.slice(2, -2).split('@@')) {
    out.push({ text, at });
    at += text.length + 2;
  }
  return out;
}

/** The note written as `text` (without its `@@`s), at markdown [from, to). */
export function noteOf(text: string, from: number, to: number): Note {
  const m = /^(\w+)(?:\.(\d+))?(?: (.*))?$/s.exec(text);
  const comment = m?.[3]?.trim();
  return { author: m?.[1] ?? text, time: m?.[2] ? Number(m[2]) : undefined, comment: comment || undefined, from, to };
}

/** A new one-note thread by `author` now (`@@author.time comment@@`), or '' if the name has no usable characters. */
export function makeNote(author: string, comment = '', time = Math.floor(Date.now() / 1000)): string {
  const who = author.replace(/\W+/g, '');
  if (!who) return '';
  // The comment can't hold a line break, "@@" or a mark's delimiter, and mustn't end in "@"
  // (it would run into the closing "@@").
  const text = comment
    .replace(/\s+/g, ' ')
    .replace(/([@^~+])\1+/g, '$1')
    .replace(/@+$/, '')
    .trim();
  return `@@${who}.${time}${text ? ` ${text}` : ''}@@`;
}

/** How a change was resolved, kept in its thread: its last comment is "Accepted" or "Rejected". */
export type Verdict = 'accepted' | 'rejected';

/** The verdict a thread ends with, if any: its last comment, any case, a final "." or "!" allowed. */
export function verdictOf(notes: readonly { comment?: string }[]): Verdict | null {
  const c = notes[notes.length - 1]?.comment?.trim().replace(/[.!]+$/, '').toLowerCase();
  return c === 'accepted' || c === 'rejected' ? c : null;
}

/** A readable date and time for a note's timestamp (milliseconds are accepted too). */
export function formatTime(t: number): string {
  const ms = t > 1e11 ? t : t * 1000;
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The hover card's contents: the author's note, then the replies. */
export function noteList(notes: readonly Note[]): HTMLElement {
  const list = h('div', { className: 'md-notes' });
  notes.forEach((n, i) => {
    const item = h('div', { className: i ? 'md-note reply' : 'md-note' });
    const head = h('div', { className: 'md-note-head' });
    head.append(h('span', { className: 'md-note-author', textContent: n.author }));
    if (n.time !== undefined) head.append(h('span', { className: 'md-note-time', textContent: formatTime(n.time) }));
    item.append(head);
    if (n.comment) item.append(h('div', { className: 'md-note-text', textContent: n.comment }));
    list.append(item);
  });
  return list;
}
