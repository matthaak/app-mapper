/*
 * Markdown editor demo — a dev-only page (/md-editor.html): the editor in a NeXT window on the
 * workspace desktop. Not part of the production build.
 */
import '../../theme.css';
import { NxDesktop, NxWindow } from '../widgets';
import { MarkdownEditor } from './index';

const SAMPLE = `# Welcome to the Markdown Editor

This is a paragraph with **bold text**, _italic text_ and \`inline code\`.
A single line break stays inside the paragraph.

You're editing as **Joe**. Claude has already been through this document: its additions are ++@@Claude.1794603600@@underlined++, its deletions are ~~@@Claude.1794603620@@struck through~~ — both in Claude's colour — and its notes are ^^@@Claude.1794603640 Like this one.@@highlighted^^. Each author's changes get a colour of their own, yours included. The review column at the right shows who, when and why for each — click a box to comment or reply.

## Text Formatting

You can combine **bold and _italic_ together** for emphasis.

Use \`code\` for technical terms and file names.

---

## Lists

### Bullet List

* First item
* Second item
* Third item

### Numbered List

1. Step one
2. Step two
3. Step three

## Tables

| View | Shows | Edits |
| :--- | :--- | :---: |
| Visual | The rendered page | In place |
| Raw | The markdown source | As text |

## Links

Visit [Example Website](https://example.com) for more information.

## Blockquotes

> This is a blockquote.
> It can span multiple lines.

> ## Nested heading in quote
> With a paragraph.

## Code Blocks

    function hello() {
        console.log("Hello, world!");
    }

## Tracked Changes

Additions are written \`++like this++\`, deletions \`~~like this~~\` and highlights \`^^like this^^\`. Each can start with a thread of attributions — \`@@author.timestamp comment@@reply@@\` — naming who made it, when and why: one opening \`@@\`, the notes separated by \`@@\`, one closing \`@@\`; any after the first are replies. In Raw they're right there in the text; in Visual, hover over the change.

The markdown is ~~@@Claude.1794604500 "Only" already says this.@@the one and only~~ the single source of truth, and every toolbar command is a transform of it, ++@@Claude.1794604560 Worth saying why this matters.@@so a command does exactly the same thing in either view++.

^^@@Claude.1794605400 Is this still true for very long documents?@@Joe.1794625200 Yes — tried it with a 5,000-line file.@@Claude.1794625500 Great, then let's keep it.@@Switching views is instant^^, even for long documents.

To accept a change, put the caret in it — or select across several — and press **Accept Change(s)** (the ✓): an addition keeps its text, a deletion goes. **Reject Change(s)** (the ✗) does the opposite: an addition goes, a deletion keeps its text.

Changes don't need an attribution: ^^a plain highlight^^, ~~a plain deletion~~ and ++a plain addition++. They combine with the rest too: **^^bold and highlighted^^**, ~~deleted with _italic_~~, and ++added \`code\`++.

Highlight some text yourself: you'll be asked for an optional comment, and the highlight is attributed to Joe.

To comment on a change or highlight, click its box in the review column: a field opens in it. Your comment is a reply to someone else's change, or the comment on your own. Boxes sit level with their text, tied to it by dotted lines, in Visual and Raw; boxes that would crowd each other stack together, centered on all their text. To comment on untouched text, highlight it.

**Track Changes** (the pencil) is on: whatever you type becomes Joe's addition, and whatever you delete stays, struck through, as Joe's deletion. Deleting from your own addition really deletes it. Spaces at either end of a change stay outside it, and when a deletion is accepted (or an addition rejected) the spacing around it is tidied: no doubled spaces, and no space left before punctuation or at the end of a paragraph. Turn Track Changes off to edit freely.

## Switching Views

Switch between **Visual** and **Raw** with the tabs. The selection comes along exactly — select a few words here, switch to Raw, and the same characters are selected there. The text you were looking at stays at the same height on screen, and a document scrolled to its very top or bottom stays there.

Undo and redo work across both views: an edit made in Raw can be undone in Visual, and the other way round.

## A Longer Section

Markdown was designed so that a document reads naturally as plain text, ++@@Claude.1794606300 Clarifies the point.@@long++ before it is ever rendered. Headings are lines that begin with hashes, emphasis is a pair of asterisks or underscores, and lists are just lines that start with a bullet or a number.

That makes the raw text a ~~@@Claude.1794606360@@perfectly~~ good place to write. Some edits are simply easier there — rearranging lists, fixing a link's address, or cleaning up nested formatting — while others, like reading a long passage or checking how a section flows, are easier in the rendered view.

This section is here mostly to give the page some length, so that scrolling and switching views can be tried out on a document taller than the window. Scroll to the middle of it, switch views, and the paragraph you were reading should stay where it was.

* Keyboard shortcuts are listed in each button's tooltip.
* With no selection, Bold, Italic and the other styles apply to the word at the caret.
* With a selection across several paragraphs or list items, each one is formatted.

The end.
`;

const desk = new NxDesktop().mount(document.getElementById('app')!);
const win = new NxWindow({ title: 'Markdown Editor — Joe', width: 820, height: 640, minWidth: 360, minHeight: 240 });
// Most of the screen, leaving some desktop around it.
const w = Math.min(980, Math.max(360, desk.width - 260));
const h = Math.max(240, desk.height - 60);
desk.addWindow(win, 24, 24);
win.resize(w, h);
const editor = new MarkdownEditor({ value: SAMPLE, user: 'Joe', trackChanges: true }).mount(win.content);
if (import.meta.env.DEV) Object.assign(window, { editor });
