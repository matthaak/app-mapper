import { NxButton, NxPopover, NxScroller, NxSwitch, NxTabs, NxTextField, Widget, h } from '../widgets';
import { CHANGES, applyAction, commentOn, editNote, marksAt, type ActionId } from './actions';
import { Review, markKeys, type Box, type Extent } from './review';
import { TextIndex, lowerBound, midY, pointRect, rangeRect } from './geometry';
import { makeNote } from './notes';
import { escapeHtml, render, type Mark, type MarkKind, type Rendered } from './parse';
import { toMarkdown, type DomPoint } from './serialize';
import { trackedEdit } from './track';
import { IS_MAC, TOOLS, toolForKey, toolTitle, type ToolId } from './toolbar';
import type { MdMode } from './types';

export interface MarkdownEditorOptions {
  value?: string;
  mode?: MdMode;
  placeholder?: string;
  /**
   * The current user's name or initials (letters, digits, _). New highlights are attributed to
   * them, with an optional comment asked for when highlighting. Without it, highlights are plain
   * (and no comments can be anchored).
   */
  user?: string;
  /**
   * Start with Track Changes on: the user's typing becomes {++additions++} and their deletions
   * {--deletions--}, attributed to them. Needs `user`. Toggled from the toolbar too.
   */
  trackChanges?: boolean;
  /** Called when the markdown changes (Visual edits are reported after a short pause). */
  onChange?: (markdown: string) => void;
  /**
   * Adds a Save button (⌘S) to the toolbar: called with the latest markdown reported through
   * `onChange`. The button is enabled while `modified` is true.
   */
  onSave?: () => void;
  onModeChange?: (mode: MdMode) => void;
  /**
   * Start with Review Mode on or off. On: changes, highlights and threads are shown (in their
   * colours, with the review column). Off: Visual shows the text as if every open change were
   * accepted, Raw shows it uncoloured, and Track Changes, Accept and Reject are off. Default: on
   * if the document has any change or highlight.
   */
  annotations?: boolean;
  /**
   * Review Mode was turned on or off: by the user (`manual`, to remember for next time), or
   * because they highlighted or used the Track Changes button, which always turn it on.
   */
  onAnnotationsChange?: (on: boolean, manual: boolean) => void;
  /**
   * Show spelling errors (the toolbar's Show Spelling Errors button): Visual's text is spell-checked,
   * code excepted. Raw never is: a textarea is checked all or nothing, so its code and threads
   * would be too. Default: on.
   */
  spellcheck?: boolean;
  /** The user turned spelling errors on or off with the toolbar button. */
  onSpellcheckChange?: (on: boolean) => void;
}

/** A document state for undo: the markdown and the selection, as markdown indices. */
interface Snapshot {
  md: string;
  anchor: number;
  focus: number;
}

/** A place in the document, independent of the view, so the other view can show the same place. */
interface ViewAnchor {
  /** Markdown index to keep at the same height in the viewport… */
  md: number;
  /** …at this fraction of the viewport height. */
  ratio: number;
  /** Near either end of the document, the target is pulled toward that end (blend 0 = pinned). */
  edge?: { pin: 'top' | 'bottom'; distance: number; blend: number };
}

const HISTORY_LIMIT = 200;
/** Quiet time (ms) that ends one undo step while typing. */
const TYPING_PAUSE = 600;
/** Delay (ms) before Visual edits are read back into the markdown. */
const SYNC_DELAY = 150;
/** Within this fraction of a viewport of either end, scroll positions pin to that end. */
const EDGE_ZONE = 0.6;

const MARK_CLASS: Record<MarkKind, string> = { highlight: 'mk-hl', strike: 'mk-st', underline: 'mk-un', comment: 'mk-hl' };
/** How many author colours there are (`--md-author-1` …, in md-editor.css); then they repeat. */
const AUTHOR_COLORS = 8;

/**
 * Each change's colour (by index in `marks`; null for highlights and comments), as Word colours changes by
 * author: one colour per author for both additions and deletions. Authors take the colours in
 * the order of their first change (by its time; changes with no time after, in document order;
 * changes with no author count as one more author), so a colour stays with its author as
 * edits are made, and a new author takes the next one.
 */
function authorColors(marks: Mark[]): (string | null)[] {
  const changes = marks.filter((m) => m.kind === 'strike' || m.kind === 'underline');
  const first = new Map<string, { time: number; at: number }>();
  for (const m of changes) {
    const who = m.notes[0]?.author ?? '';
    const time = m.notes[0]?.time ?? Infinity;
    const seen = first.get(who);
    if (!seen || time < seen.time || (time === seen.time && m.from < seen.at)) first.set(who, { time, at: m.from });
  }
  const order = [...first].sort(([, a], [, b]) => a.time - b.time || a.at - b.at).map(([who]) => who);
  return marks.map((m) =>
    m.kind === 'highlight' || m.kind === 'comment' ? null : `var(--md-author-${(order.indexOf(m.notes[0]?.author ?? '') % AUTHOR_COLORS) + 1})`,
  );
}
/** The elements each kind of mark renders as (or is pasted as) in Visual. */
const MARK_TAGS: Record<MarkKind, string> = { highlight: 'mark', strike: 'del, s, strike', underline: 'u, ins', comment: '.md-anchor' };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const normalize = (s: string) => s.replace(/\r\n?/g, '\n');

/**
 * A markdown editor with two views of one document: Visual (rendered, editable in place) and
 * Raw (the markdown source, with highlights and tracked changes styled in place too).
 *
 * Review marks are CriticMarkup. Tracked changes: {++additions++} and {--deletions--}, which
 * Accept or Reject Change(s) resolves, and which Track Changes records as the user types (see
 * track.ts). They and {==highlights==} may be followed by notes (`{>>author 2026-11-18 13:55: comment<<}`,
 * then replies, see notes.ts), and notes after no mark are a comment anchored there. Notes show
 * in boxes in the review column at the right (see review.ts), in both views; Raw also shows
 * them as text.
 *
 * The markdown is the single source of truth. Switching views carries the selection across
 * exactly (Raw → Visual through the renderer's source map, Visual → Raw through sentinels in
 * the serializer) and keeps the same text at the same height on screen. Every toolbar command
 * is a markdown transform, so it behaves the same in both views, and undo works across both.
 */
export class MarkdownEditor extends Widget<HTMLDivElement> {
  private md: string;
  private current: MdMode;
  private readonly opts: MarkdownEditorOptions;

  private readonly tabs: NxTabs;
  private readonly toolbarEl: HTMLDivElement;
  private readonly buttons = new Map<ToolId, NxButton>();
  private isModified = false;
  private readonly scroller: HTMLDivElement;
  /** The NeXT scroller at the left; mirrors the document's (hidden) native scrolling. */
  private readonly vbar: NxScroller;
  private readonly resizes: ResizeObserver;
  private readonly visual: HTMLDivElement;
  private readonly rawPanel: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;

  /** The render last put into Visual, and the index of Visual's text nodes. */
  private shown: Rendered | null = null;
  private visualText: TextIndex | null = null;
  /** Visual's DOM is exactly the render of `md`, so `shown.plain` maps it. */
  private pristine = false;
  /** Visual was edited since `md` was last read from it. */
  private mdStale = false;
  private layerText: TextIndex | null = null;
  private cache: { md: string; r: Rendered } | null = null;

  private history: Snapshot[];
  private pos = 0;
  /** Edits since the last undo step was recorded. */
  private pending = false;
  private historyTimer = 0;
  private syncTimer = 0;
  /** Visual's last selection, for when focus has moved elsewhere. */
  private savedRange: Range | null = null;
  private lastEmitted: string;

  /** The review column: marks' threads in boxes beside the text. */
  private readonly review: Review;
  /** Review Mode: changes, highlights and the review column shown (else the text as if accepted). */
  private showAnnotations: boolean;
  private readonly annotationSwitch: NxSwitch;
  /** The markdown Visual was last rendered from (its marks are `shown.marks`). */
  private shownMd = '';
  private colorCache: { marks: readonly Mark[]; colors: (string | null)[] } | null = null;
  /** The highlight comment prompt, while open. */
  private prompt: NxPopover | null = null;
  /** Track Changes is on (only ever with a user). */
  private tracking: boolean;
  /** Spelling errors are shown (in Visual). */
  private spelling: boolean;
  /** Puts back the selection the prompt took focus from. */
  private restoreFocus: (() => void) | null = null;

  constructor(o: MarkdownEditorOptions = {}) {
    super(h('div'), 'md-editor');
    this.opts = o;
    this.md = normalize(o.value ?? '');
    this.lastEmitted = this.md;
    this.current = o.mode ?? 'visual';
    this.tracking = !!(o.trackChanges && o.user);
    this.spelling = o.spellcheck ?? true;
    this.history = [{ md: this.md, anchor: 0, focus: 0 }];

    // Header: toolbar and tabs. Mouse-downs there never take focus from the text.
    const header = h('div', { className: 'nx md-header' });
    header.addEventListener('mousedown', (e) => e.preventDefault());
    const toolbar = (this.toolbarEl = h('div', { className: 'md-toolbar', role: 'toolbar' }));
    for (const group of TOOLS) {
      const g = h('div', { className: 'md-group' });
      for (const t of group) {
        if (t.id === 'save' && !o.onSave) continue;
        const b = new NxButton({ icon: t.glyph(), iconPosition: 'only', title: toolTitle(t), onClick: () => this.command(t.id) });
        b.el.setAttribute('aria-label', t.title);
        this.buttons.set(t.id, b.mount(g));
      }
      if (g.childElementCount) toolbar.append(g);
    }
    this.tabs = new NxTabs({
      tabs: ['Visual', 'Raw'],
      selected: this.current === 'raw' ? 1 : 0,
      onSelect: (i) => (this.mode = i ? 'raw' : 'visual'),
    });
    this.showAnnotations = o.annotations ?? render(this.md).marks.length > 0;
    // No tracking outside Review Mode.
    if (!this.showAnnotations) this.tracking = false;
    this.annotationSwitch = new NxSwitch({ label: 'Review Mode', on: this.showAnnotations, onChange: (on) => this.setAnnotations(on, true) });
    this.annotationSwitch.el.classList.add('md-annotations');
    header.append(toolbar, this.tabs.el, this.annotationSwitch.el);
    this.el.classList.toggle('md-plain', !this.showAnnotations);

    // Document: one scroller holding both views (only one shown).
    this.scroller = h('div', { className: 'md-scroll' });
    this.visual = h('div', { className: 'md-visual md-panel', contentEditable: 'true', spellcheck: this.spelling });
    this.visual.dataset.placeholder = o.placeholder ?? 'Start typing…';
    this.rawPanel = h('div', { className: 'md-raw md-panel' });
    this.layer = h('div', { className: 'md-raw-layer' });
    this.layer.setAttribute('aria-hidden', 'true');
    this.textarea = h('textarea', { className: 'md-raw-input', spellcheck: false, placeholder: o.placeholder ?? '' });
    this.rawPanel.append(this.layer, this.textarea);
    this.review = new Review(
      {
        user: o.user,
        marks: () => this.reviewMarks(),
        extent: (i) => this.markExtent(i),
        color: (i) => this.markColor(i),
        enabled: () => this.showAnnotations,
        comment: (key, text) => this.addComment(key, text),
        edit: (key, index, text) => this.editComment(key, index, text),
        spellcheck: () => this.spellcheck,
      },
      this.scroller,
    );
    this.scroller.append(this.visual, this.rawPanel, this.review.el, this.review.svg);
    // The document scrolls natively (wheel, trackpad, caret following) with its own scrollbar
    // hidden; the NeXT scroller shows and drives the same scroll position. (Modern hides the
    // NeXT scroller and shows the native scrollbar instead.)
    this.vbar = new NxScroller({ step: 22, onScroll: (v) => (this.scroller.scrollTop = v) });
    const body = h('div', { className: 'md-body' });
    body.append(this.vbar.el, this.scroller);
    this.el.append(header, body);
    this.scroller.addEventListener('scroll', () => (this.vbar.offset = this.scroller.scrollTop));
    this.resizes = new ResizeObserver(() => this.syncScroller());
    for (const el of [this.scroller, this.visual, this.rawPanel]) this.resizes.observe(el);

    for (const ed of [this.visual, this.textarea] as HTMLElement[]) {
      ed.addEventListener('beforeinput', this.onBeforeInput);
      ed.addEventListener('keydown', this.onKey);
    }
    this.visual.addEventListener('input', this.onVisualInput);
    // Pointing at a change or highlight lights the line to its box.
    this.visual.addEventListener('mouseover', (e) => {
      const el = (e.target as Element).closest?.('[data-mark]');
      this.review.point(el instanceof HTMLElement && this.visual.contains(el) ? Number(el.dataset.mark) : null);
    });
    this.visual.addEventListener('mouseleave', () => this.review.point(null));
    this.visual.addEventListener('paste', this.onPaste);
    void document.fonts?.ready.then(() => this.review.schedule());
    // Raw selection changes (the document's selectionchange doesn't cover textareas everywhere).
    for (const type of ['select', 'selectionchange', 'keyup', 'mouseup']) this.textarea.addEventListener(type, () => this.updateAccept());
    this.textarea.addEventListener('input', this.onRawInput);
    // The textarea is always as tall as its text, so it should never scroll itself.
    this.textarea.addEventListener('scroll', () => this.textarea.scrollTop && (this.textarea.scrollTop = 0));
    this.scroller.addEventListener('mousedown', this.onMarginDown);
    document.addEventListener('selectionchange', this.onSelectionChange);

    this.show();
    this.updateUndo();
    this.updateAccept();
    this.updateTrack();
    this.buttons.get('spelling')!.on = this.spelling;
    this.modified = false;
  }

  /** Re-measures the document for the NeXT scroller. */
  private syncScroller(): void {
    const sc = this.scroller;
    this.vbar.setRange(sc.scrollHeight, sc.clientHeight);
    this.vbar.offset = sc.scrollTop;
    this.review.schedule();
  }

  // -------------------------------------------------------------------------------------
  // Public API

  /** The markdown. Setting it replaces the document and clears undo. */
  get value(): string {
    this.flushVisual();
    return this.md;
  }
  set value(v: string) {
    clearTimeout(this.historyTimer);
    clearTimeout(this.syncTimer);
    this.md = this.lastEmitted = normalize(v);
    this.pending = false;
    this.history = [{ md: this.md, anchor: 0, focus: 0 }];
    this.pos = 0;
    this.show();
    this.scroller.scrollTop = 0;
    this.updateUndo();
    this.updateAccept();
  }

  get mode(): MdMode {
    return this.current;
  }
  /** Switches views, keeping the selection and the visible text in place. */
  set mode(next: MdMode) {
    if (next === this.current) return;
    this.closePrompt();
    this.checkpoint();
    const { anchor, focus, view } = this.captureView();
    this.current = next;
    this.show();
    this.setSelection(anchor, focus);
    this.restoreView(view);
    this.opts.onModeChange?.(next);
  }

  /** Spelling errors shown (see `spellcheck` in the options). */
  get spellcheck(): boolean {
    return this.spelling;
  }
  set spellcheck(on: boolean) {
    if (on === this.spelling) return;
    this.spelling = on;
    this.visual.spellcheck = on;
    this.buttons.get('spelling')!.on = on;
    // The browser checks text only as it changes, so Visual is drawn afresh to be checked again.
    if (on && this.current === 'visual') this.redrawVisual();
  }

  /** Renders Visual again, keeping its selection, focus and scroll position. */
  private redrawVisual(): void {
    this.flushVisual();
    const focused = document.activeElement === this.visual;
    const { anchor, focus } = this.selection();
    const top = this.scroller.scrollTop;
    this.renderVisual();
    this.scroller.scrollTop = top;
    if (focused) this.setSelection(anchor, focus);
    else this.parkSelection(anchor, focus);
  }

  /** Review Mode (see `annotations` in the options). */
  get annotations(): boolean {
    return this.showAnnotations;
  }
  set annotations(on: boolean) {
    this.setAnnotations(on, false);
  }

  private setAnnotations(on: boolean, manual: boolean): void {
    if (on === this.showAnnotations) return;
    this.showAnnotations = on;
    this.annotationSwitch.on = on;
    this.el.classList.toggle('md-plain', !on);
    if (!on && this.tracking) this.trackChanges = false;
    if (this.current === 'visual') this.markGone();
    this.updateAccept();
    this.review.schedule();
    this.opts.onAnnotationsChange?.(on, manual);
  }

  /** Track Changes: whether the user's edits are recorded as additions and deletions. */
  get trackChanges(): boolean {
    return this.tracking;
  }
  /** Reports through `onChange` an edit still waiting to be read back (Visual edits wait a moment). */
  flush(): void {
    this.flushVisual();
    this.emit();
  }

  /** Whether there are unsaved changes: enables the Save button (with `onSave`). */
  get modified(): boolean {
    return this.isModified;
  }
  set modified(on: boolean) {
    this.isModified = on;
    const b = this.buttons.get('save');
    if (b) b.disabled = !on;
  }

  set trackChanges(on: boolean) {
    this.checkpoint();
    const was = this.tracking;
    this.tracking = on && !!this.opts.user;
    // Tracking needs Review Mode, to see what it records.
    if (this.tracking) this.setAnnotations(true, false);
    this.updateTrack();
    if (was && !this.tracking) this.leaveAddition();
  }

  /**
   * Turning Track Changes off with the caret in an addition moves it out, to the nearer end, so
   * what is typed next is not part of the addition (in Visual, edgeInput sees to that).
   */
  private leaveAddition(): void {
    const { anchor, focus } = this.selection();
    if (anchor !== focus) return;
    const m = this.rendered().marks.find((x) => x.kind === 'underline' && x.body <= focus && focus <= x.end);
    if (!m) return;
    const after = focus - m.body >= m.end - focus;
    const at = after ? m.to : m.from;
    this.setSelection(at, at);
  }

  /**
   * With Track Changes off, text typed in Visual at the very start or end of an addition or
   * deletion goes just outside it — before or after it (and any change it ends or starts with) —
   * not into it, as the browser would put it: a caret at a change's edge can't be told from one
   * just inside. Typed further in, it edits the change's text.
   */
  private edgeInput(e: InputEvent): boolean {
    if (this.tracking || this.current !== 'visual' || e.isComposing || e.inputType !== 'insertText' || !e.data) return false;
    const sel = getSelection();
    const node = sel?.anchorNode;
    if (!sel?.isCollapsed || !node || !this.visual.contains(node)) return false;
    // The changes the text either side of the caret is in (the browser would type into the one before).
    const tags = CHANGES.map((k) => MARK_TAGS[k]).join(', ');
    const [before, after] = this.textsBeside(node, sel.anchorOffset).map((t) => t?.parentElement?.closest(tags) ?? null);
    const end = !!before && before !== after && !before.contains(after);
    const start = !end && !!after && after !== before && !after.contains(before);
    if (!end && !start) return false;
    const { focus: k } = this.selection();
    const marks = this.rendered().marks.filter((m) => CHANGES.includes(m.kind));
    // The change(s) the caret is at the end (or start) of, from inside or out, then out through
    // any they end (or start) with.
    const at0 = end ? marks.filter((x) => x.end === k || x.to === k).map((x) => x.to) : marks.filter((x) => x.body === k || x.from === k).map((x) => x.from);
    if (!at0.length) return false;
    let at = end ? Math.max(...at0) : Math.min(...at0);
    for (let outer = true; outer; ) {
      const o = marks.find((x) => (end ? x.end === at : x.body === at));
      outer = !!o;
      if (o) at = end ? o.to : o.from;
    }
    e.preventDefault();
    this.beginEdit();
    const data = this.forCell(e.data);
    this.md = this.md.slice(0, at) + data + this.md.slice(at);
    const caret = at + data.length;
    this.renderCurrent();
    this.setSelection(caret, caret);
    this.reveal(caret);
    this.edited();
    this.emit();
    this.updateAccept();
    return true;
  }

  /**
   * Takes the toolbar out of the editor's header and returns it, for the host to show
   * elsewhere — one toolbar slot shared by several editors, showing the front one's, say. It is
   * still this editor's: its buttons act on this editor and follow its state. Mouse-downs on it
   * still leave the focus in the text.
   */
  detachToolbar(): HTMLElement {
    const t = this.toolbarEl;
    if (t.parentElement?.classList.contains('md-header')) {
      t.remove();
      t.classList.add('nx', 'detached');
      t.addEventListener('mousedown', (e) => e.preventDefault());
      this.el.classList.add('toolbar-detached');
    }
    return t;
  }

  focus(): void {
    (this.current === 'raw' ? this.textarea : this.visual).focus();
  }

  /**
   * Applies a formatting command to the selection. A new highlight is attributed to the user
   * (if set), with `comment` if given.
   */
  exec(id: ActionId, comment = ''): void {
    // So does highlighting.
    if (id === 'highlight') this.setAnnotations(true, false);
    this.checkpoint();
    const { anchor, focus } = this.selection();
    this.history[this.pos] = { md: this.md, anchor, focus };
    const user = this.opts.user;
    const verdict = id === 'accept' || id === 'acceptAll' ? 'Accepted' : id === 'reject' ? 'Rejected' : null;
    const note = !user ? '' : id === 'highlight' ? makeNote(user, comment) : verdict ? makeNote(user, verdict) : '';
    const e = applyAction(id, this.md, Math.min(anchor, focus), Math.max(anchor, focus), this.current, note);
    this.md = e.md;
    this.renderCurrent();
    this.setSelection(e.anchor, e.focus);
    this.reveal(e.focus);
    this.push({ md: e.md, anchor: e.anchor, focus: e.focus });
    this.emit();
    this.updateAccept();
  }

  undo(): void {
    this.checkpoint();
    if (this.pos > 0) this.restore(this.history[--this.pos]);
  }

  redo(): void {
    this.checkpoint();
    if (this.pos < this.history.length - 1) this.restore(this.history[++this.pos]);
  }

  override destroy(): void {
    clearTimeout(this.historyTimer);
    clearTimeout(this.syncTimer);
    document.removeEventListener('selectionchange', this.onSelectionChange);
    this.resizes.disconnect();
    this.closePrompt();
    this.review.destroy();
    super.destroy();
  }

  // -------------------------------------------------------------------------------------
  // Rendering

  private rendered(): Rendered {
    if (this.cache?.md !== this.md) this.cache = { md: this.md, r: render(this.md) };
    return this.cache.r;
  }

  /** Shows the current view, rendered from `md`. */
  private show(): void {
    const raw = this.current === 'raw';
    this.visual.hidden = raw;
    this.rawPanel.hidden = !raw;
    this.tabs.selected = raw ? 1 : 0;
    this.renderCurrent();
  }

  private renderCurrent(): void {
    if (this.current === 'raw') this.renderRaw();
    else this.renderVisual();
  }

  private renderVisual(): void {
    const r = this.rendered();
    this.visual.innerHTML = r.html;
    const colors = authorColors(r.marks);
    for (const el of this.visual.querySelectorAll<HTMLElement>('[data-mark]')) {
      const c = colors[Number(el.dataset.mark)];
      if (c) el.style.setProperty('--md-change', c);
    }
    this.markGone();
    this.shown = r;
    this.shownMd = this.md;
    this.review.schedule();
    this.visualText = new TextIndex(this.visual);
    this.pristine = true;
    this.mdStale = false;
    this.savedRange = null;
    clearTimeout(this.syncTimer);
    if (import.meta.env.DEV && this.visualText.length !== r.plain.length) {
      console.warn(`md-editor: rendered text (${this.visualText.length}) and source map (${r.plain.length}) differ`);
    }
  }

  /**
   * Marks the changes whose text isn't shown (`gone`, hidden by md-editor.css, and not to be
   * edited): what a resolved change took out — and, outside Review Mode, what every change still
   * open would take out if accepted (its deletions). Then closes the gaps they leave.
   */
  private markGone(): void {
    for (const el of this.visual.querySelectorAll<HTMLElement>(CHANGES.map((k) => MARK_TAGS[k]).join(', '))) {
      if (!el.hasAttribute('data-mark')) continue;
      const deletion = el.matches(MARK_TAGS.strike);
      const verdict = el.classList.contains('accepted') ? 'accepted' : el.classList.contains('rejected') ? 'rejected' : null;
      const outcome = verdict ?? (this.showAnnotations ? null : 'accepted');
      const gone = outcome === (deletion ? 'accepted' : 'rejected');
      el.classList.toggle('gone', gone);
      if (gone) el.contentEditable = 'false';
      else el.removeAttribute('contenteditable');
      el.style.marginLeft = el.style.marginRight = '';
    }
    this.closeGaps();
  }

  /**
   * Text a resolved change took out isn't shown (see md-editor.css), but the spaces either side
   * of it still are: "drop  there". Pulls the one before it back over it (or, at the start of a
   * line, the one after) where two would show, or a space would stand before punctuation.
   */
  private closeGaps(): void {
    const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote';
    for (const el of this.visual.querySelectorAll<HTMLElement>('.gone')) {
      const block = el.closest(BLOCK);
      const [before, after] = [this.textBeside(el, true, block), this.textBeside(el, false, block)];
      const prev = before?.data.slice(-1) ?? '';
      const next = after?.data[0] ?? '';
      const space = (c: string) => c === ' ' || c === '\t';
      const r = document.createRange();
      if (before && space(prev) && (!after || space(next) || /[.,;:!?)\]}\u201d\u2019]/.test(next))) {
        r.setStart(before, before.length - 1);
        r.setEnd(before, before.length);
        el.style.marginLeft = `${-r.getBoundingClientRect().width}px`;
      } else if (!before && after && space(next)) {
        r.setStart(after, 0);
        r.setEnd(after, 1);
        el.style.marginRight = `${-r.getBoundingClientRect().width}px`;
      }
    }
  }

  /** The text node just before (or after) `el` within `block`, skipping other hidden changes' text. */
  private textBeside(el: Element, back: boolean, block: Element | null): Text | null {
    const walker = document.createTreeWalker(this.visual, NodeFilter.SHOW_TEXT);
    walker.currentNode = back ? el : (el.lastChild ?? el);
    if (!back) {
      let last: Node = el;
      while (last.lastChild) last = last.lastChild;
      walker.currentNode = last;
    }
    for (let n = (back ? walker.previousNode() : walker.nextNode()) as Text | null; n; n = (back ? walker.previousNode() : walker.nextNode()) as Text | null) {
      if (block && !block.contains(n)) return null;
      if (n.parentElement?.closest('.gone')) continue;
      if (n.length) return n;
    }
    return null;
  }

  private renderRaw(): void {
    if (this.textarea.value !== this.md) this.textarea.value = this.md;
    this.renderLayer();
  }

  /**
   * Redraws the layer under the textarea: the same text (the textarea's own is transparent),
   * with the marks drawn, coloured as in Visual.
   */
  private renderLayer(): void {
    const text = this.textarea.value;
    const marks = this.rendered().marks; // text === md in Raw
    const colors = authorColors(marks);
    const ranges = [
      // A mark, to its closing delimiter; then its notes, in the change's colour (a highlight's
      // highlighted too; an anchored comment is all notes, and highlighted).
      ...marks.map((m, k) => ({ from: m.from, to: m.kind === 'comment' ? m.to : m.end + 3, cls: MARK_CLASS[m.kind], color: colors[k] })),
      ...marks
        .map((m, k) => ({ m, k }))
        .filter(({ m }) => m.kind !== 'comment' && m.notes.length)
        .map(({ m, k }) => ({ from: m.end + 3, to: m.to, cls: m.kind === 'highlight' ? 'mk-hl' : 'mk-nc', color: colors[k] })),
    ];
    const cuts = [...new Set([0, text.length, ...ranges.flatMap((m) => [m.from, m.to])])].sort((a, b) => a - b);
    let html = '';
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      const t = escapeHtml(text.slice(a, b));
      const over = ranges.filter((m) => m.from <= a && m.to >= b);
      const cls = [...new Set(over.map((m) => m.cls))];
      // The innermost change decides the colour.
      const inner = over.filter((m) => m.color).sort((x, y) => y.from - x.from)[0];
      const style = inner ? ` style="--md-change:${inner.color}"` : '';
      html += cls.length ? `<span class="${cls.join(' ')}"${style}>${t}</span>` : t;
    }
    // A trailing newline starts a line the textarea shows; give the layer that line too.
    if (!text || text.endsWith('\n')) html += '<br>';
    this.layer.innerHTML = html;
    this.layerText = null;
    this.review.schedule();
  }

  // -------------------------------------------------------------------------------------
  // Positions: markdown index ↔ DOM point ↔ screen

  /** Markdown index of a point in a pristine Visual DOM. */
  private mdIndexOf(p: DomPoint): number | null {
    const loc = this.visualText!.locate(p);
    if (!loc) return null;
    const plain = this.shown!.plain;
    if (loc.after) return plain[loc.k - 1] + 1;
    if (loc.k < plain.length) return plain[loc.k];
    return plain.length ? plain[plain.length - 1] + 1 : 0;
  }

  /** The point in a pristine Visual DOM for a markdown index. */
  private domPointOf(i: number): DomPoint {
    const plain = this.shown!.plain;
    const k = lowerBound(plain, i);
    // Hug the character before when the index sits right after it (so the end of a bold word
    // stays inside the <strong>), or after it with only markup between at the end of its line
    // (past a closing `++`) or of its table cell (before the `|`), or on a blank line (where an
    // emptied paragraph was); else the character after.
    const md = this.md;
    const lineAt = (j: number) => md.slice(md.lastIndexOf('\n', j - 1) + 1, md.indexOf('\n', j) === -1 ? md.length : md.indexOf('\n', j));
    const after =
      k > 0 &&
      (k === plain.length ||
        plain[k - 1] + 1 === i ||
        (!md.slice(plain[k - 1] + 1, i).includes('\n') && md.slice(i, plain[k]).includes('\n')) ||
        (!md.slice(plain[k - 1] + 1, i).includes('|') && md.slice(i, plain[k]).includes('|')) ||
        !lineAt(i).trim());
    return this.visualText!.point(k, after);
  }

  /** Reads Visual into `md` if it was edited, and maps `points` to markdown indices. */
  private readVisual(points: (DomPoint | null)[] = []): (number | null)[] {
    if (this.pristine) return points.map((p) => (p ? this.mdIndexOf(p) : null));
    const r = toMarkdown(this.visual, points);
    this.mdStale = false;
    clearTimeout(this.syncTimer);
    if (r.md !== this.md) {
      this.md = r.md;
      this.emit();
    }
    return r.at;
  }

  private flushVisual(): void {
    if (this.current === 'visual' && this.mdStale) this.readVisual();
  }

  /** Visual's selection ends: the live selection if it is in Visual, else the last one there. */
  private visualEnds(): { anchor: DomPoint; focus: DomPoint } | null {
    const sel = getSelection();
    if (sel?.anchorNode && sel.focusNode && this.visual.contains(sel.anchorNode) && this.visual.contains(sel.focusNode)) {
      return { anchor: { node: sel.anchorNode, offset: sel.anchorOffset }, focus: { node: sel.focusNode, offset: sel.focusOffset } };
    }
    const r = this.savedRange;
    if (r && this.visual.contains(r.startContainer) && this.visual.contains(r.endContainer)) {
      return { anchor: { node: r.startContainer, offset: r.startOffset }, focus: { node: r.endContainer, offset: r.endOffset } };
    }
    return null;
  }

  /** The selection as markdown indices (reading Visual's edits into `md` first). */
  private selection(): { anchor: number; focus: number } {
    if (this.current === 'raw') {
      const { selectionStart: s, selectionEnd: e, selectionDirection: d } = this.textarea;
      return d === 'backward' ? { anchor: e, focus: s } : { anchor: s, focus: e };
    }
    const ends = this.visualEnds();
    const [a, f] = this.readVisual(ends ? [ends.anchor, ends.focus] : []);
    const anchor = a ?? this.md.length;
    return { anchor, focus: f ?? anchor };
  }

  /** Selects markdown [anchor → focus] in the current view (rendered from `md`) and focuses it. */
  /** Sets the selection without focusing the editor: it is there when focus comes back. */
  private parkSelection(anchor: number, focus: number): void {
    anchor = clamp(anchor, 0, this.md.length);
    focus = clamp(focus, 0, this.md.length);
    if (this.current === 'raw') {
      this.textarea.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), anchor > focus ? 'backward' : 'forward');
      return;
    }
    const a = this.domPointOf(Math.min(anchor, focus));
    const f = this.domPointOf(Math.max(anchor, focus));
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(f.node, f.offset);
    this.savedRange = r;
  }

  private setSelection(anchor: number, focus: number): void {
    anchor = clamp(anchor, 0, this.md.length);
    focus = clamp(focus, 0, this.md.length);
    if (this.current === 'raw') {
      this.textarea.focus({ preventScroll: true });
      this.textarea.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), anchor > focus ? 'backward' : 'forward');
      return;
    }
    const a = this.domPointOf(anchor);
    const f = anchor === focus ? a : this.domPointOf(focus);
    this.visual.focus({ preventScroll: true });
    getSelection()?.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  }

  /** On-screen line box at markdown index `i` in the current view (rendered from `md`). */
  private rectAt(i: number): DOMRect | null {
    return this.current === 'raw' ? this.layerRect(i) : pointRect(this.domPointOf(i));
  }

  /** Line box at index `i` of the Raw text, measured on the styling layer (it mirrors the textarea). */
  private layerRect(i: number): DOMRect | null {
    const text = this.textarea.value;
    i = clamp(i, 0, text.length);
    const index = (this.layerText ??= new TextIndex(this.layer));
    const r = document.createRange();
    const charRect = (k: number) => {
      const a = index.point(k, false);
      const b = index.point(k + 1, true);
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return rangeRect(r);
    };
    const rect = (i < text.length && text[i] !== '\n' && charRect(i)) || (i > 0 && text[i - 1] !== '\n' && charRect(i - 1));
    if (rect) return rect;
    // An empty line: measure a zero-width marker placed there.
    const p = index.point(i, false);
    const marker = h('span', { textContent: '​' });
    r.setStart(p.node, p.offset);
    r.collapse(true);
    r.insertNode(marker);
    const box = marker.getBoundingClientRect();
    marker.remove();
    this.layer.normalize();
    this.layerText = null;
    return box;
  }

  /** The Raw index whose line is at viewport height `y`. */
  private rawIndexAtY(y: number): number {
    let lo = 0;
    let hi = this.textarea.value.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const rect = this.layerRect(mid);
      if (rect && rect.bottom <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** The Visual DOM point nearest the start of the line at viewport height `y`. */
  private visualPointAt(x: number, y: number): DomPoint | null {
    const doc = document as Document & {
      caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
    };
    if (doc.caretPositionFromPoint) {
      const p = doc.caretPositionFromPoint(x, y);
      return p && this.visual.contains(p.offsetNode) ? { node: p.offsetNode, offset: p.offset } : null;
    }
    const r = document.caretRangeFromPoint?.(x, y);
    return r && this.visual.contains(r.startContainer) ? { node: r.startContainer, offset: r.startOffset } : null;
  }

  /** Left edge of Visual's text column, in viewport x. */
  private visualTextLeft(): number {
    return this.visual.getBoundingClientRect().left + parseFloat(getComputedStyle(this.visual).paddingLeft) + 1;
  }

  /** Scrolls just enough to show markdown index `i`. */
  private reveal(i: number): void {
    const rect = this.rectAt(i);
    if (!rect) return;
    const sc = this.scroller;
    const top = sc.getBoundingClientRect().top + sc.clientTop;
    const margin = 8;
    if (rect.top < top + margin) sc.scrollTop -= top + margin - rect.top;
    else if (rect.bottom > top + sc.clientHeight - margin) sc.scrollTop += rect.bottom - (top + sc.clientHeight - margin);
  }

  // -------------------------------------------------------------------------------------
  // Keeping the place when switching views

  /**
   * The selection and a view anchor for the current view. The anchor is the caret if it is on
   * screen (it stays at the same height); otherwise the text at the middle of the viewport —
   * pulled toward the top or bottom when the view is near either end, so a document scrolled to
   * its top or bottom stays there.
   */
  private captureView(): { anchor: number; focus: number; view: ViewAnchor } {
    const sc = this.scroller;
    const top = sc.getBoundingClientRect().top + sc.clientTop;
    const height = sc.clientHeight;
    const centre = top + height / 2;
    const onScreen = (r: DOMRect | null): r is DOMRect => !!r && midY(r) >= top && midY(r) <= top + height;

    let anchor: number;
    let focus: number;
    let caret: DOMRect | null;
    let probe: number | null = null;
    let probeRect: DOMRect | null = null;
    if (this.current === 'raw') {
      ({ anchor, focus } = this.selection());
      caret = this.layerRect(focus);
      if (!onScreen(caret)) {
        probe = this.rawIndexAtY(centre);
        probeRect = this.layerRect(probe);
      }
    } else {
      const ends = this.visualEnds();
      const probePoint = this.visualPointAt(this.visualTextLeft(), centre);
      const [a, f, p] = this.readVisual([ends?.anchor ?? null, ends?.focus ?? null, probePoint]);
      anchor = a ?? this.md.length;
      focus = f ?? anchor;
      caret = ends ? pointRect(ends.focus) : null;
      probe = p;
      probeRect = probePoint && pointRect(probePoint);
    }

    if (onScreen(caret)) return { anchor, focus, view: { md: focus, ratio: (midY(caret) - top) / height } };

    const max = Math.max(0, sc.scrollHeight - height);
    const zone = Math.min(height * EDGE_ZONE, max / 2);
    const st = sc.scrollTop;
    const edge: ViewAnchor['edge'] =
      max <= 0 || zone <= 0
        ? { pin: 'top', distance: 0, blend: 0 }
        : st < zone
          ? { pin: 'top', distance: st, blend: st / zone }
          : max - st < zone
            ? { pin: 'bottom', distance: max - st, blend: (max - st) / zone }
            : undefined;
    const ratio = probeRect ? (midY(probeRect) - top) / height : 0.5;
    return { anchor, focus, view: { md: probe ?? 0, ratio, edge } };
  }

  private restoreView(v: ViewAnchor): void {
    const sc = this.scroller;
    const height = sc.clientHeight;
    const max = Math.max(0, sc.scrollHeight - height);
    const rect = this.rectAt(v.md);
    let target = sc.scrollTop;
    if (rect) target += midY(rect) - (sc.getBoundingClientRect().top + sc.clientTop) - v.ratio * height;
    if (v.edge) {
      const pinned = v.edge.pin === 'top' ? v.edge.distance : max - v.edge.distance;
      target = pinned + (target - pinned) * v.edge.blend;
    }
    sc.scrollTop = clamp(target, 0, max);
  }

  // -------------------------------------------------------------------------------------
  // Undo

  /** Before an edit starts a new undo step, remember where the selection was. */
  private beginEdit(): void {
    if (this.pending) return;
    const sel = this.selection();
    this.history[this.pos] = { md: this.md, ...sel };
  }

  private edited(): void {
    this.pending = true;
    clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => this.checkpoint(), TYPING_PAUSE);
    this.updateUndo();
  }

  /** Records pending edits as an undo step. */
  private checkpoint(): void {
    clearTimeout(this.historyTimer);
    if (!this.pending) return;
    this.pending = false;
    const sel = this.selection();
    this.push({ md: this.md, ...sel });
  }

  private push(s: Snapshot): void {
    if (s.md === this.history[this.pos].md) {
      this.history[this.pos] = s;
    } else {
      this.history.length = this.pos + 1;
      this.history.push(s);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.pos = this.history.length - 1;
    }
    this.updateUndo();
  }

  private restore(s: Snapshot): void {
    this.md = s.md;
    this.renderCurrent();
    this.setSelection(s.anchor, s.focus);
    this.reveal(s.focus);
    this.emit();
    this.updateUndo();
    this.updateAccept();
  }

  private updateUndo(): void {
    this.buttons.get('undo')!.disabled = !(this.pos > 0 || this.pending);
    this.buttons.get('redo')!.disabled = this.pending || this.pos >= this.history.length - 1;
  }

  // -------------------------------------------------------------------------------------
  // Events

  private command(id: ToolId): void {
    if (id === 'undo') this.undo();
    else if (id === 'redo') this.redo();
    else if (id === 'highlight') this.highlight();
    else if (id === 'spelling') {
      this.spellcheck = !this.spelling;
      this.opts.onSpellcheckChange?.(this.spelling);
    }
    else if (id === 'track') {
      // Using Track Changes always brings the annotations back into view.
      this.setAnnotations(true, false);
      this.trackChanges = !this.tracking;
    }
    else if (id === 'save') this.save();
    else this.exec(id);
  }

  /** Reports any edit still pending, then asks for a save. */
  private save(): void {
    this.flush();
    this.opts.onSave?.();
  }

  private updateTrack(): void {
    const b = this.buttons.get('track')!;
    b.on = this.tracking;
    b.disabled = !this.opts.user;
    this.review.schedule();
  }

  /**
   * With Track Changes on, makes a typing or deleting edit as a tracked change instead of
   * letting the browser make it. Returns false to leave the edit to the browser (IME
   * composition, new paragraphs, drag and drop, …).
   */
  private trackInput(e: InputEvent): boolean {
    if (!this.tracking || e.isComposing) return false;
    const type = e.inputType;
    const insert = type === 'insertText' || type === 'insertReplacementText' || type === 'insertFromPaste' || type === 'insertFromYank';
    if (!insert && !type.startsWith('delete')) return false;
    const raw = insert ? (e.data ?? e.dataTransfer?.getData('text/plain') ?? '') : null;
    const text = raw !== null && this.current === 'visual' ? this.forCell(raw) : raw;

    let range: [number, number] | null;
    if (this.current === 'raw') {
      const { selectionStart: s, selectionEnd: end, value } = this.textarea;
      range = insert ? [s, end] : rawDeleteRange(value, s, end, type);
    } else {
      // What the browser would replace or delete (it knows characters, words and lines).
      const target = e.getTargetRanges()[0];
      if (!target && !insert) return false;
      if (target) {
        const [a, b] = this.readVisual([
          { node: target.startContainer, offset: target.startOffset },
          { node: target.endContainer, offset: target.endOffset },
        ]);
        range = a === null || b === null ? null : [Math.min(a, b), Math.max(a, b)];
      } else {
        const { anchor, focus } = this.selection();
        range = [Math.min(anchor, focus), Math.max(anchor, focus)];
      }
    }
    e.preventDefault();
    if (range) this.applyTracked(range[0], range[1], text, type.endsWith('Backward'));
    return true;
  }

  /** Replaces markdown [a, b) with `text` (null: deletes it) as a tracked change. */
  private applyTracked(a: number, b: number, text: string | null, backward = false): void {
    if (text === null && a === b) return;
    this.beginEdit();
    const ed = trackedEdit(this.md, a, b, text, this.opts.user!, backward);
    this.md = ed.md;
    this.renderCurrent();
    this.setSelection(ed.anchor, ed.focus);
    this.reveal(ed.focus);
    this.edited();
    this.emit();
    this.updateAccept();
  }

  /**
   * Accept and Reject Change(s) are enabled while the selection touches an addition or deletion;
   * Accept All Changes while there is one not yet resolved.
   */
  private updateAccept(): void {
    // None of them outside Review Mode. Accept All: while any change is still open.
    const off = !this.showAnnotations || !this.selectionTouches(CHANGES);
    this.buttons.get('accept')!.disabled = off;
    this.buttons.get('reject')!.disabled = off;
    const open = this.showAnnotations && this.rendered().marks.some((m) => CHANGES.includes(m.kind) && !m.verdict);
    this.buttons.get('acceptAll')!.disabled = !open;
  }

  private selectionTouches(kinds: readonly MarkKind[]): boolean {
    if (this.current === 'raw') {
      const { selectionStart: s, selectionEnd: e } = this.textarea;
      return marksAt(this.rendered().marks, s, e, kinds).length > 0;
    }
    // Visual may be mid-edit, so look at the DOM: a caret inside, or a range overlapping.
    const sel = getSelection();
    const range = sel?.rangeCount && this.visual.contains(sel.anchorNode) ? sel.getRangeAt(0) : this.savedRange;
    if (!range || !this.visual.contains(range.startContainer)) return false;
    const tags = kinds.map((k) => MARK_TAGS[k]).join(', ');
    if (range.collapsed) {
      // A caret is on a change it is inside or right beside (in the same block).
      return this.textsBeside(range.startContainer, range.startOffset).some((t) => !!t?.parentElement?.closest(tags));
    }
    return Array.from(this.visual.querySelectorAll(tags)).some((el) => range.intersectsNode(el));
  }

  /** The text nodes just before and just after a DOM point in Visual, within its block. */
  private textsBeside(node: Node, offset: number): (Text | null)[] {
    const BLOCK = 'p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote';
    const walker = document.createTreeWalker(this.visual, NodeFilter.SHOW_TEXT);
    const step = (from: Node, back: boolean): Text | null => {
      walker.currentNode = from;
      return (back ? walker.previousNode() : walker.nextNode()) as Text | null;
    };
    let before: Text | null;
    let after: Text | null;
    if (node instanceof Text) {
      before = offset > 0 ? node : step(node, true);
      after = offset < node.length ? node : step(node, false);
    } else {
      const child = node.childNodes[offset];
      if (child) {
        before = step(child, true);
        after = child instanceof Text ? child : step(child, false);
      } else {
        // At the element's end: its last text, and whatever text follows it.
        let last: Node = node;
        while (last.lastChild) last = last.lastChild;
        before = last instanceof Text ? last : step(last, true);
        after = step(last, false);
      }
    }
    const block = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest(BLOCK) ?? null;
    const here = block(node);
    return [before, after].map((t) => (t && block(t) === here ? t : null));
  }

  /**
   * Highlights the selection, first asking for an optional comment (when there is a user to
   * attribute it to). Inside an existing highlight, removes it straight away.
   */
  /**
   * The highlight button: removes the highlight or comment the selection is in, or asks for a
   * comment and highlights the selection — or, with none, anchors the comment at the caret.
   */
  private highlight(): void {
    if (this.prompt) return;
    this.checkpoint();
    const { anchor, focus } = this.selection();
    const removing = marksAt(this.rendered().marks, Math.min(anchor, focus), Math.max(anchor, focus), ['highlight', 'comment']).length > 0;
    if (!this.opts.user || removing) this.exec('highlight');
    else if (anchor === focus) this.ask({ id: 'highlight', title: 'Comment', button: 'Comment', placeholder: 'Comment' });
    else this.ask({ id: 'highlight', title: 'Highlight', button: 'Highlight', placeholder: 'Comment (optional)' });
  }

  /**
   * Opens the comment prompt by the selection (a panel that can be moved by its title); on OK,
   * runs `id` with the comment. While it is open, the document shows what `id` will do — the
   * highlight, or the anchored comment — with the comment as typed so far in its box; Cancel
   * takes that away again.
   */
  private ask(o: { id: ActionId; title: string; button: string; placeholder: string }): void {
    const user = this.opts.user;
    if (!user) return;
    this.flushVisual();
    this.reveal(this.selection().focus);
    const raw = this.current === 'raw';
    const ends = raw ? null : this.visualEnds();
    const at = raw ? this.layerRect(this.textarea.selectionEnd) : ends && pointRect(ends.focus);
    const before = { md: this.md, ...this.selection() };
    const start = Math.min(before.anchor, before.focus);
    const end = Math.max(before.anchor, before.focus);
    const when = new Date();
    // The preview: drawn, but not a change (no undo step, nothing reported).
    const preview = (comment: string) => {
      this.md = applyAction(o.id, before.md, start, end, this.current, makeNote(user, comment, when)).md;
      this.renderCurrent();
    };
    this.restoreFocus = () => {
      if (this.md !== before.md) {
        this.md = before.md;
        this.renderCurrent();
      }
      (raw ? this.textarea : this.visual).focus({ preventScroll: true });
      this.setSelection(before.anchor, before.focus);
    };

    const done = (v: string) => this.closePrompt(o.id, v);
    const field = new NxTextField({ placeholder: o.placeholder, lines: 2, spellcheck: this.spellcheck, onCommit: done, onInput: preview });
    const buttons = h('div', { className: 'md-prompt-buttons' });
    new NxButton({ label: 'Cancel', onClick: () => this.closePrompt() }).mount(buttons);
    new NxButton({ label: o.button, returnKey: true, onClick: () => done(field.value) }).mount(buttons);
    const who = h('div', { className: 'md-prompt-who', textContent: `As ${user}` });
    this.prompt = new NxPopover({ title: o.title, movable: true, onDismiss: () => this.closePrompt() });
    this.prompt.el.classList.add('md-prompt');
    this.prompt.setContent(field, who, buttons);
    const box = this.scroller.getBoundingClientRect();
    this.prompt.showAt(at ?? { left: box.left + 24, top: box.top, bottom: box.top + 24 });
    preview('');
    field.focus();
  }

  /** Closes the comment prompt, putting the text and selection back; with an `id`, then runs it. */
  private closePrompt(id?: ActionId, comment = ''): void {
    const p = this.prompt;
    if (!p) return;
    this.prompt = null;
    p.destroy();
    this.restoreFocus?.();
    this.restoreFocus = null;
    if (id) this.exec(id, comment);
  }

  /** The marks the current view shows: Visual's as last rendered (its DOM still holds them while edited), Raw's from `md`. */
  private reviewMarks(): { md: string; marks: readonly Mark[] } {
    if (this.current === 'visual') return { md: this.shownMd, marks: this.shown?.marks ?? [] };
    return { md: this.md, marks: this.rendered().marks };
  }

  /** Mark `i`'s author colour, of reviewMarks(). */
  private markColor(i: number): string | null {
    const { marks } = this.reviewMarks();
    if (this.colorCache?.marks !== marks) this.colorCache = { marks, colors: authorColors([...marks]) };
    return this.colorCache.colors[i] ?? null;
  }

  /** Where mark `i` (of the current render) is on screen in the current view: its first and last lines. */
  private markExtent(i: number): Extent | null {
    if (this.current === 'raw') {
      const m = this.rendered().marks[i];
      const a = m && this.layerRect(m.from);
      const b = m && this.layerRect(m.to - 1);
      if (!a || !b) return null;
      if (b.top <= a.top + 1) {
        const box = { left: a.left, top: a.top, right: b.right, bottom: b.bottom };
        return { first: box, last: box };
      }
      // Over more than one line: the first runs to the column's right, the last from its left.
      const col = this.layer.getBoundingClientRect();
      const css = getComputedStyle(this.layer);
      return {
        first: { left: a.left, top: a.top, right: col.right - parseFloat(css.paddingRight), bottom: a.bottom },
        last: { left: col.left + parseFloat(css.paddingLeft), top: b.top, right: b.right, bottom: b.bottom },
      };
    }
    const rects = Array.from(this.visual.querySelectorAll(`[data-mark="${i}"]`))
      .flatMap((el) => Array.from(el.getClientRects()))
      .filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) return null;
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    // The rects on the first line, and on the last (half a line from the ends).
    const span = (rs: DOMRect[]): Box => ({
      left: Math.min(...rs.map((r) => r.left)),
      top: Math.min(...rs.map((r) => r.top)),
      right: Math.max(...rs.map((r) => r.right)),
      bottom: Math.max(...rs.map((r) => r.bottom)),
    });
    const firstLine = rects.filter((r) => r.top < top + r.height / 2);
    const lastLine = rects.filter((r) => r.bottom > bottom - r.height / 2);
    return { first: span(firstLine), last: span(lastLine) };
  }

  /** Adds the user's `text` to the thread of the mark with `key`, keeping the selection. */
  private addComment(key: string, text: string): string | null {
    const user = this.opts.user;
    if (!user || !text.trim()) return null;
    return this.changeThread(key, (md, m) => commentOn(md, m, makeNote(user, text)));
  }

  /** Changes note `index` of the mark with `key` to say `text` (anyone's note), keeping the selection. */
  private editComment(key: string, index: number, text: string): string | null {
    return this.changeThread(key, (md, m) => editNote(md, m, index, text));
  }

  /**
   * Changes the thread of the mark with `key` by `change` (typed in the review column: the
   * selection moves with the text, but focus and the scroll position stay where they are), as
   * one undo step. Returns the mark's key after, or null if it went.
   */
  private changeThread(key: string, change: (md: string, m: Mark) => { md: string; map: (p: number) => number }): string | null {
    this.flushVisual();
    this.checkpoint();
    // Typed in the review column: the editor's selection moves with the text, but focus (and
    // the scroll position) stay where they are.
    const a = document.activeElement;
    const focused = !!a && (this.visual.contains(a) || a === this.textarea);
    const sel = this.selection();
    const marks = this.rendered().marks;
    const m = marks[markKeys(this.md, marks).indexOf(key)];
    if (!m) return null;
    this.history[this.pos] = { md: this.md, ...sel };
    const r = change(this.md, m);
    if (r.md === this.md) return key;
    const anchor = r.map(sel.anchor);
    const focus = r.map(sel.focus);
    this.md = r.md;
    this.renderCurrent();
    if (focused) this.setSelection(anchor, focus);
    else this.parkSelection(anchor, focus);
    this.push({ md: this.md, anchor, focus });
    this.emit();
    this.updateAccept();
    // The same mark, where it now starts.
    const after = this.rendered().marks.find((x) => x.kind === m.kind && x.from === m.from);
    const now = this.rendered().marks;
    return after ? markKeys(this.md, now)[now.indexOf(after)] : null;
  }

  private emit(): void {
    if (this.md === this.lastEmitted) return;
    this.lastEmitted = this.md;
    this.opts.onChange?.(this.md);
  }

  /**
   * Text typed or pasted into the markdown directly from the Visual view: inside a table cell
   * it must stay in its cell — pipes escaped, line breaks as spaces.
   */
  private forCell(text: string): string {
    return this.inTableCell() ? text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|') : text;
  }

  /** Is the Visual caret (or selection start) inside a table cell? */
  private inTableCell(): boolean {
    const sel = getSelection();
    const n = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = n instanceof Element ? n : n?.parentElement;
    return !!el && this.visual.contains(el) && !!el.closest('td, th');
  }

  private readonly onBeforeInput = (e: InputEvent) => {
    // No native formatting (⌘U would make a "change", for one): the toolbar does formatting.
    if (e.inputType.startsWith('format')) {
      e.preventDefault();
      return;
    }
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      if (e.inputType === 'historyUndo') this.undo();
      else this.redo();
      return;
    }
    // A table cell is one line of markdown: no paragraphs or line breaks inside one.
    if ((e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') && this.inTableCell()) {
      e.preventDefault();
      return;
    }
    if (this.edgeInput(e)) return;
    this.beginEdit();
    this.trackInput(e);
  };

  private readonly onVisualInput = (e: Event) => {
    const type = (e as InputEvent).inputType;
    if (type === 'insertParagraph' || type === 'insertLineBreak') this.dropEmptyMarks();
    this.pristine = false;
    this.mdStale = true;
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => this.flushVisual(), SYNC_DELAY);
    this.edited();
    this.review.schedule();
  };

  /**
   * After Return, the browser copies the marks the caret was in into the new block (or line),
   * empty, with their attributions — so what is typed there would join them. Unwraps those
   * around the caret, leaving it where they were.
   */
  private dropEmptyMarks(): void {
    const sel = getSelection();
    if (!sel?.isCollapsed || !sel.anchorNode) return;
    let node: Node = sel.anchorNode;
    let offset = sel.anchorOffset;
    let moved = false;
    for (;;) {
      const el: Element | null | undefined = (node instanceof Element ? node : node.parentElement)?.closest('[data-mark]');
      if (!el || !this.visual.contains(el) || el.textContent || el.classList.contains('md-anchor')) break;
      const parent: Node = el.parentNode!;
      offset = Array.prototype.indexOf.call(parent.childNodes, el);
      el.replaceWith(...el.childNodes);
      node = parent;
      moved = true;
    }
    if (moved) sel.collapse(node, offset);
  }

  private readonly onRawInput = () => {
    this.md = this.textarea.value;
    this.renderLayer();
    this.textarea.scrollTop = 0;
    const { selectionStart: s, selectionEnd: e, selectionDirection: d } = this.textarea;
    this.reveal(d === 'backward' ? s : e);
    this.edited();
    this.emit();
    this.updateAccept();
  };

  private readonly onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // typing here must not trigger app-level shortcuts
    if (e.isComposing) return;
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (mod && !e.altKey && (e.code === 'KeyZ' || (e.code === 'KeyY' && !e.shiftKey))) {
      e.preventDefault();
      if (e.code === 'KeyY' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    const tool = toolForKey(e);
    if (tool && (tool.id !== 'save' || this.opts.onSave)) {
      e.preventDefault();
      this.command(tool.id);
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      this.insertText('  ');
    }
  };

  /** Pastes into Visual as plain text (rich HTML from other apps brings stray wrappers). */
  private readonly onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) this.insertText(text);
  };

  /** Types `text` over the selection (tracked, if Track Changes is on). */
  private insertText(text: string): void {
    this.beginEdit();
    if (!this.tracking) {
      document.execCommand('insertText', false, text);
      return;
    }
    const { anchor, focus } = this.selection();
    this.applyTracked(Math.min(anchor, focus), Math.max(anchor, focus), text);
  }

  /** A click in the margin beside Visual's column puts the caret on that line. */
  private readonly onMarginDown = (e: MouseEvent) => {
    if (e.target !== this.scroller || this.current !== 'visual' || e.button !== 0) return;
    e.preventDefault();
    const r = this.visual.getBoundingClientRect();
    const x = clamp(e.clientX, this.visualTextLeft(), r.right - parseFloat(getComputedStyle(this.visual).paddingRight) - 1);
    const p = this.visualPointAt(x, e.clientY);
    this.visual.focus({ preventScroll: true });
    if (p) getSelection()?.collapse(p.node, p.offset);
  };

  private readonly onSelectionChange = () => {
    if (this.current !== 'visual') return;
    const sel = getSelection();
    if (sel?.rangeCount && this.visual.contains(sel.anchorNode)) this.savedRange = sel.getRangeAt(0).cloneRange();
    this.updateAccept();
  };
}

/** In Raw, what a delete edit of `type` removes from `text` with the selection [s, e). */
function rawDeleteRange(text: string, s: number, e: number, type: string): [number, number] | null {
  if (s !== e) return [s, e];
  const low = (i: number) => /[\uDC00-\uDFFF]/.test(text[i] ?? '');
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = text.indexOf('\n', s) === -1 ? text.length : text.indexOf('\n', s);
  let a = s;
  let b = s;
  switch (type) {
    case 'deleteContentBackward':
      a = s - (s > 1 && low(s - 1) ? 2 : 1);
      break;
    case 'deleteContentForward':
      b = s + (low(s + 1) ? 2 : 1);
      break;
    case 'deleteWordBackward':
      while (a > 0 && /\s/.test(text[a - 1])) a--;
      while (a > 0 && !/\s/.test(text[a - 1])) a--;
      break;
    case 'deleteWordForward':
      while (b < text.length && /\s/.test(text[b])) b++;
      while (b < text.length && !/\s/.test(text[b])) b++;
      break;
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward':
      a = s === lineStart ? s - 1 : lineStart;
      break;
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward':
      b = s === lineEnd ? s + 1 : lineEnd;
      break;
    default:
      return null;
  }
  a = Math.max(0, a);
  b = Math.min(text.length, b);
  return a < b ? [a, b] : null;
}
