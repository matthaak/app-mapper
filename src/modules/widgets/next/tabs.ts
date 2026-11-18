import { h } from '../widget';
import { NxWidget } from './base';

export interface NxTabsOptions {
  tabs: string[];
  selected?: number;
  onSelect?: (index: number, label: string) => void;
}

/**
 * A row of folder tabs sitting on a black base line; the selected tab is taller and open at
 * the bottom, so it joins whatever is below. Tabs switch on mouse-down (and never take focus
 * from the mouse, so an editor below keeps its selection). Arrow keys move between tabs.
 *
 * Set `--nx-tab-selected` on the element to colour the selected tab like the content below
 * (default: panel grey).
 */
export class NxTabs extends NxWidget<HTMLDivElement> {
  private readonly buttons: HTMLButtonElement[];
  private readonly onSelect?: (index: number, label: string) => void;
  private index: number;

  constructor(o: NxTabsOptions) {
    super(h('div', { role: 'tablist' }), 'nx-tabs');
    this.onSelect = o.onSelect;
    this.index = Math.max(0, Math.min(o.tabs.length - 1, o.selected ?? 0));
    this.buttons = o.tabs.map((label, i) => {
      const b = h('button', { type: 'button', className: 'nx-tab', textContent: label });
      b.setAttribute('role', 'tab');
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.choose(i);
      });
      b.addEventListener('click', (e) => {
        if (e.detail === 0) this.choose(i); // keyboard
      });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + o.tabs.length) % o.tabs.length;
        this.buttons[next].focus();
        this.choose(next);
      });
      return b;
    });
    this.el.append(...this.buttons);
    this.draw();
  }

  get selected(): number {
    return this.index;
  }
  /** Selects a tab without notifying. */
  set selected(i: number) {
    if (i < 0 || i >= this.buttons.length) return;
    this.index = i;
    this.draw();
  }

  private choose(i: number): void {
    if (i === this.index) return;
    this.selected = i;
    this.onSelect?.(i, this.buttons[i].textContent ?? '');
  }

  private draw(): void {
    this.buttons.forEach((b, i) => {
      b.classList.toggle('selected', i === this.index);
      b.setAttribute('aria-selected', String(i === this.index));
      b.tabIndex = i === this.index ? 0 : -1;
    });
  }
}
