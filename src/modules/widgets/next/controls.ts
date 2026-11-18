import { h } from '../widget';
import { NxWidget, glyph, momentary, toNode, type Content } from './base';

// ---------------------------------------------------------------------------------------
// Button

export interface NxButtonOptions {
  label?: string;
  /** Image or any node; drawn left of the label, above it, or alone. */
  icon?: Content;
  iconPosition?: 'left' | 'above' | 'only';
  /** Shows the ⏎ mark: this is the panel's default button. */
  returnKey?: boolean;
  /** Toggle (on/off, shown white when on) instead of momentary. */
  toggle?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: (button: NxButton) => void;
}

/** A bevelled NeXT push button. Highlights white while pressed. */
export class NxButton extends NxWidget<HTMLButtonElement> {
  private readonly labelEl: HTMLSpanElement;

  constructor(o: NxButtonOptions = {}) {
    super(h('button', { type: 'button', title: o.title ?? '' }), 'nx-button');
    this.labelEl = h('span', { className: 'label', textContent: o.label ?? '' });
    if (o.icon !== undefined) {
      const icon = h('span', { className: 'nx-button-icon' });
      icon.append(toNode(o.icon));
      this.el.append(icon);
      this.el.classList.add(o.iconPosition ?? 'left');
    }
    if (o.iconPosition !== 'only') this.el.append(this.labelEl);
    if (o.returnKey) {
      this.el.classList.add('has-key');
      this.el.append(glyph.ret());
    }
    this.disabled = !!o.disabled;
    momentary(this.el, () => {
      if (o.toggle) this.on = !this.on;
      o.onClick?.(this);
    });
  }

  get label(): string {
    return this.labelEl.textContent ?? '';
  }
  set label(v: string) {
    this.labelEl.textContent = v;
  }

  get disabled(): boolean {
    return this.el.disabled;
  }
  set disabled(v: boolean) {
    this.el.disabled = v;
  }

  /** Toggle state. */
  get on(): boolean {
    return this.el.classList.contains('on');
  }
  set on(v: boolean) {
    this.el.classList.toggle('on', v);
    this.el.setAttribute('aria-pressed', String(v));
  }

  /** Clicks the button as if pressed (e.g. Return for the default button). */
  performClick(): void {
    if (!this.disabled) this.el.dispatchEvent(new MouseEvent('click', { detail: 0 }));
  }
}

// ---------------------------------------------------------------------------------------
// Switch

export interface NxSwitchOptions {
  label: string;
  on?: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}

/** A NeXT switch (check box): a small raised square, checked when on, with its label to the right. */
export class NxSwitch extends NxWidget<HTMLButtonElement> {
  private readonly labelEl: HTMLSpanElement;

  constructor(o: NxSwitchOptions) {
    super(h('button', { type: 'button', role: 'checkbox' }), 'nx-switch');
    this.labelEl = h('span', { className: 'label', textContent: o.label });
    const box = h('span', { className: 'nx-switch-box' });
    box.append(glyph.check());
    this.el.append(box, this.labelEl);
    this.on = !!o.on;
    this.disabled = !!o.disabled;
    momentary(this.el, () => {
      this.on = !this.on;
      o.onChange?.(this.on);
    });
  }

  get label(): string {
    return this.labelEl.textContent ?? '';
  }
  set label(v: string) {
    this.labelEl.textContent = v;
  }

  get on(): boolean {
    return this.el.classList.contains('on');
  }
  set on(v: boolean) {
    this.el.classList.toggle('on', v);
    this.el.setAttribute('aria-checked', String(v));
  }

  get disabled(): boolean {
    return this.el.disabled;
  }
  set disabled(v: boolean) {
    this.el.disabled = v;
  }
}

// ---------------------------------------------------------------------------------------
// Pop-up button

export interface NxPopUpOptions {
  items: string[];
  value?: string;
  disabled?: boolean;
  onChange?: (value: string, index: number) => void;
}

/** A pop-up list button (the small raised bar at the right). The list opens over the button. */
export class NxPopUpButton extends NxWidget<HTMLButtonElement> {
  private items: string[];
  private index: number;
  private readonly labelEl: HTMLSpanElement;
  private readonly onChange?: (value: string, index: number) => void;
  private list?: HTMLDivElement;
  private scrim?: HTMLDivElement;

  constructor(o: NxPopUpOptions) {
    super(h('button', { type: 'button' }), 'nx-button');
    this.el.classList.add('nx-popup');
    this.items = o.items;
    this.index = Math.max(0, o.value === undefined ? 0 : o.items.indexOf(o.value));
    this.onChange = o.onChange;
    this.labelEl = h('span', { className: 'label', textContent: this.items[this.index] ?? '' });
    this.el.append(this.labelEl, h('span', { className: 'nx-popup-mark' }));
    this.el.disabled = !!o.disabled;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.el.disabled) return;
      e.preventDefault();
      this.openList();
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.select(this.index + (e.key === 'ArrowDown' ? 1 : -1), true);
      }
    });
  }

  get value(): string {
    return this.items[this.index] ?? '';
  }
  set value(v: string) {
    const i = this.items.indexOf(v);
    if (i >= 0) this.select(i, false);
  }

  get disabled(): boolean {
    return this.el.disabled;
  }
  set disabled(v: boolean) {
    this.el.disabled = v;
  }

  setItems(items: string[], value = items[0]): void {
    this.items = items;
    this.index = Math.max(0, items.indexOf(value));
    this.labelEl.textContent = this.value;
  }

  override destroy(): void {
    this.closeList();
    super.destroy();
  }

  private select(i: number, notify: boolean): void {
    if (i < 0 || i >= this.items.length) return;
    const changed = i !== this.index;
    this.index = i;
    this.labelEl.textContent = this.value;
    if (notify && changed) this.onChange?.(this.value, i);
  }

  private openList(): void {
    this.closeList();
    const r = this.el.getBoundingClientRect();
    const opened = performance.now();
    const scrim = h('div');
    Object.assign(scrim.style, { position: 'fixed', inset: '0', zIndex: '19999' });
    scrim.addEventListener('pointerdown', () => this.closeList());
    const list = h('div', { className: 'ui nx nx-popup-list', role: 'listbox' });
    // The current item sits exactly over the button.
    Object.assign(list.style, { left: `${r.left - 1}px`, top: `${r.top - this.index * 20 - 1}px`, width: `${r.width + 1}px` });
    this.items.forEach((label, i) => {
      const item = h('div', { className: 'nx-menu-item', role: 'option', textContent: label });
      item.classList.toggle('highlighted', i === this.index);
      item.addEventListener('pointerenter', () => {
        for (const c of list.children) c.classList.toggle('highlighted', c === item);
      });
      // Works for both click-then-click and press-drag-release; ignores the release of the
      // press that opened the list.
      item.addEventListener('pointerup', () => {
        if (performance.now() - opened < 300 && i === this.index) return;
        this.select(i, true);
        this.closeList();
      });
      list.append(item);
    });
    document.body.append(scrim, list);
    this.list = list;
    this.scrim = scrim;
  }

  private closeList(): void {
    this.scrim?.remove();
    this.list?.remove();
    this.list = this.scrim = undefined;
  }
}

// ---------------------------------------------------------------------------------------
// Text field & label

export interface NxTextFieldOptions {
  value?: string;
  /** Label drawn to the left, e.g. "Name:". */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * How many lines tall (default 1). Taller, the text wraps onto them — still one line of text:
   * Return commits, and line breaks typed or pasted become spaces.
   */
  lines?: number;
  /** Check spelling as it is typed (default off). */
  spellcheck?: boolean;
  onCommit?: (value: string) => void;
  onInput?: (value: string) => void;
}

/** A white, sunken text field, optionally with a left label: one line, or text wrapping over several. */
export class NxTextField extends NxWidget<HTMLLabelElement> {
  readonly input: HTMLInputElement | HTMLTextAreaElement;
  private readonly field: HTMLDivElement;

  constructor(o: NxTextFieldOptions = {}) {
    super(h('label'), 'nx-textfield');
    if (o.label) this.el.append(h('span', { className: 'nx-label', textContent: o.label }));
    const lines = Math.max(1, Math.floor(o.lines ?? 1));
    this.field = h('div', { className: lines > 1 ? 'nx-field multiline' : 'nx-field' });
    const props = { value: o.value ?? '', placeholder: o.placeholder ?? '', spellcheck: !!o.spellcheck };
    this.input = lines > 1 ? h('textarea', { ...props, rows: lines }) : h('input', { ...props, type: 'text' });
    if (lines > 1) this.field.style.setProperty('--nx-field-lines', String(lines));
    this.field.append(this.input);
    this.el.append(this.field);
    this.disabled = !!o.disabled;
    (this.input as HTMLElement).addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && o.onCommit) {
        // Consumed: if committing moves focus, the key must not land in the next element.
        e.preventDefault();
        o.onCommit(this.value);
      }
    });
    this.input.addEventListener('input', () => {
      if (this.input instanceof HTMLTextAreaElement && /[\r\n]/.test(this.input.value)) {
        const at = this.input.selectionStart;
        this.input.value = this.input.value.replace(/\r\n?|\n/g, ' ');
        this.input.setSelectionRange(at, at);
      }
      o.onInput?.(this.value);
    });
  }

  get value(): string {
    return this.input.value;
  }
  set value(v: string) {
    this.input.value = v;
  }

  get disabled(): boolean {
    return this.input.disabled;
  }
  set disabled(v: boolean) {
    this.input.disabled = v;
    this.field.classList.toggle('disabled', v);
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }
}

export interface NxLabelOptions {
  disabled?: boolean;
  bold?: boolean;
  size?: 'small' | 'normal' | 'large';
  align?: 'left' | 'center' | 'right';
}

/** Static text. */
export class NxLabel extends NxWidget<HTMLSpanElement> {
  constructor(text: string, o: NxLabelOptions = {}) {
    super(h('span', { textContent: text }), 'nx-label');
    this.el.classList.toggle('bold', !!o.bold);
    if (o.size && o.size !== 'normal') this.el.classList.add(o.size);
    if (o.align) Object.assign(this.el.style, { display: 'block', textAlign: o.align });
    this.disabled = !!o.disabled;
  }

  get text(): string {
    return this.el.textContent ?? '';
  }
  set text(v: string) {
    this.el.textContent = v;
  }

  get disabled(): boolean {
    return this.el.classList.contains('disabled');
  }
  set disabled(v: boolean) {
    this.el.classList.toggle('disabled', v);
  }
}

/** A horizontal etched separator line. */
export class NxSeparator extends NxWidget<HTMLDivElement> {
  constructor() {
    super(h('div', { role: 'separator' }), 'nx-etched');
  }
}

// ---------------------------------------------------------------------------------------
// Box

/** A grooved group box with its title centred on the top edge. Put controls in `body`. */
export class NxBox extends NxWidget<HTMLDivElement> {
  readonly body: HTMLDivElement;

  constructor(title = '', content?: Content) {
    super(h('div', { role: 'group' }), 'nx-box');
    this.body = h('div', { className: 'nx-box-body' });
    if (title) this.el.append(h('span', { className: 'nx-box-title', textContent: title }));
    if (content !== undefined) this.body.append(toNode(content));
    this.el.append(this.body);
  }
}
