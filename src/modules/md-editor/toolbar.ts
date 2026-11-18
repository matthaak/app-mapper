/** The editor's toolbar: buttons, their glyphs and keyboard shortcuts. */
import { h } from '../widgets';
import type { ActionId } from './actions';

export type ToolId = ActionId | 'undo' | 'redo' | 'track' | 'spelling' | 'save';

export interface Tool {
  id: ToolId;
  title: string;
  /** KeyboardEvent.code with the platform modifier (⌘ on Mac, Ctrl elsewhere). */
  code?: string;
  shift?: boolean;
  alt?: boolean;
  glyph: () => Node;
}

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** Toolbar groups, left to right. (Save is shown only when the editor is given `onSave`.) */
export const TOOLS: Tool[][] = [
  [
    {
      id: 'save',
      title: 'Save',
      code: 'KeyS',
      glyph: () =>
        svg(
          '<path d="M1.5 1.5h11l2 2v11h-13z" fill="#fff" stroke="#000"/><path d="M4.5 1.5v4h7v-4" fill="#a0a0a0" stroke="#000"/><path d="M9 2.5h1.5v2H9z"/><path d="M3.5 8.5h9v6h-9z" fill="#fff" stroke="#000"/><path d="M5 10.5h6M5 12.5h6" stroke="#808080"/>',
        ),
    },
  ],
  [
    { id: 'h1', title: 'Heading 1', code: 'Digit1', alt: true, glyph: () => text('H1', 'heading') },
    { id: 'h2', title: 'Heading 2', code: 'Digit2', alt: true, glyph: () => text('H2', 'heading') },
  ],
  [
    { id: 'bold', title: 'Bold', code: 'KeyB', glyph: () => text('B', 'bold') },
    { id: 'italic', title: 'Italic', code: 'KeyI', glyph: () => text('I', 'italic') },
    { id: 'highlight', title: 'Highlight or Comment', code: 'KeyH', shift: true, glyph: () => text('ab', 'highlight') },
    { id: 'code', title: 'Inline code', code: 'KeyE', glyph: () => svg('<path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4" fill="none" stroke="#000" stroke-width="1.4"/>') },
  ],
  [
    {
      id: 'ul',
      title: 'Bulleted list',
      code: 'Digit8',
      shift: true,
      glyph: () => svg('<path d="M2 3.5h2v2H2zM2 7.5h2v2H2zM2 11.5h2v2H2z"/><path d="M6 4.5h8M6 8.5h8M6 12.5h8" stroke="#000"/>'),
    },
    {
      id: 'ol',
      title: 'Numbered list',
      code: 'Digit7',
      shift: true,
      glyph: () =>
        svg(
          '<g font-family="Helvetica, Arial, sans-serif" font-size="5.5" font-weight="bold"><text x="1" y="6.2">1</text><text x="1" y="10.2">2</text><text x="1" y="14.2">3</text></g><path d="M6 4.5h8M6 8.5h8M6 12.5h8" stroke="#000"/>',
        ),
    },
    {
      id: 'quote',
      title: 'Quote',
      code: 'Digit9',
      shift: true,
      glyph: () => svg('<path d="M2 3h2v11H2z"/><path d="M6 4.5h8M6 8.5h8M6 12.5h6" stroke="#000"/>'),
    },
  ],
  [
    { id: 'rule', title: 'Horizontal rule', glyph: () => svg('<path d="M3 4.5h10M3 12.5h10" stroke="#505050"/><path d="M1 8h14v1.4H1z"/>') },
    {
      id: 'link',
      title: 'Link',
      code: 'KeyK',
      glyph: () =>
        svg(
          '<g fill="none" stroke="#000" stroke-width="1.4"><path d="M7 10.5l-1.6 1.6a2.5 2.5 0 0 1-3.5-3.5l2.1-2.1a2.5 2.5 0 0 1 3.5 0"/><path d="M9 5.5l1.6-1.6a2.5 2.5 0 0 1 3.5 3.5l-2.1 2.1a2.5 2.5 0 0 1-3.5 0"/></g>',
        ),
    },
    { id: 'break', title: 'Line break', glyph: () => svg('<path d="M13 3v6H4" fill="none" stroke="#000" stroke-width="1.4"/><path d="M6.5 5.5L3 9l3.5 3.5" fill="none" stroke="#000" stroke-width="1.4"/>') },
  ],
  [
    {
      id: 'track',
      title: 'Track changes',
      code: 'KeyE',
      shift: true,
      glyph: () =>
        svg(
          '<path d="M10.5 2.5l3 3-7 7H3.5v-3z" fill="none" stroke="#000" stroke-width="1.3"/><path d="M9 4l3 3" stroke="#000" stroke-width="1.3"/><path d="M1 15h14" stroke="#000" stroke-width="1.4"/>',
        ),
    },
    {
      id: 'acceptAll',
      title: 'Accept all changes',
      code: 'Enter',
      shift: true,
      alt: true,
      glyph: () =>
        svg('<g fill="none" stroke="#000" stroke-width="1.6"><path d="M1.5 5.5l3 3.2L10.5 2"/><path d="M5 11l3 3.2L14.5 7.5"/></g>'),
    },
    {
      id: 'accept',
      title: 'Accept change(s)',
      code: 'Enter',
      shift: true,
      glyph: () => svg('<path d="M2.5 8.5l3.5 4L13.5 3" fill="none" stroke="#000" stroke-width="1.8"/>'),
    },
    {
      id: 'reject',
      title: 'Reject change(s)',
      code: 'Backspace',
      shift: true,
      glyph: () => svg('<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="#000" stroke-width="1.8"/>'),
    },
  ],
  [
    {
      id: 'spelling',
      title: 'Show spelling errors',
      glyph: () =>
        svg(
          '<text x="0.5" y="9" font-family="Helvetica, Arial, sans-serif" font-size="8" font-weight="bold">abc</text><path d="M1 12.5l1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5" fill="none" stroke="#d00000" stroke-width="1.2"/>',
        ),
    },
  ],
  [
    { id: 'undo', title: 'Undo', code: 'KeyZ', glyph: () => svg(UNDO) },
    { id: 'redo', title: 'Redo', code: 'KeyZ', shift: true, glyph: () => svg(UNDO, true) },
  ],
];

/** "Bold (⌘B)" / "Bold (Ctrl+B)". */
export function toolTitle(t: Tool): string {
  if (!t.code) return t.title;
  const named: Record<string, [string, string]> = { Enter: ['↩', 'Enter'], Backspace: ['⌫', 'Backspace'] };
  const key = named[t.code] ? named[t.code][IS_MAC ? 0 : 1] : t.code.replace(/^(Key|Digit)/, '');
  const mods = IS_MAC ? `${t.alt ? '⌥' : ''}${t.shift ? '⇧' : ''}⌘` : `Ctrl+${t.alt ? 'Alt+' : ''}${t.shift ? 'Shift+' : ''}`;
  return `${t.title} (${mods}${key})`;
}

/** The tool whose shortcut `e` is, if any (undo/redo are handled by the editor itself). */
export function toolForKey(e: KeyboardEvent): Tool | undefined {
  if (!(IS_MAC ? e.metaKey : e.ctrlKey)) return undefined;
  return TOOLS.flat().find((t) => t.code === e.code && !!t.shift === e.shiftKey && !!t.alt === e.altKey && t.id !== 'undo' && t.id !== 'redo');
}

const UNDO = '<path d="M4.5 7H10a3.5 3.5 0 0 1 0 7H7" fill="none" stroke="#000" stroke-width="1.4"/><path d="M7.5 3.5L4 7l3.5 3.5" fill="none" stroke="#000" stroke-width="1.4"/>';

function text(s: string, style: string): HTMLElement {
  return h('span', { className: `md-glyph ${style}`, textContent: s });
}

function svg(body: string, mirror = false): SVGSVGElement {
  const t = document.createElement('template');
  const flip = mirror ? ' transform="matrix(-1 0 0 1 16 0)"' : '';
  t.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><g${flip}>${body}</g></svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}
