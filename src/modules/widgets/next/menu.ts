import { h } from '../widget';
import { NxWidget, glyph, momentary, startDrag } from './base';

export interface NxMenuItem {
  label: string;
  /** Key equivalent shown at the right (e.g. 'h' for Hide). */
  key?: string;
  disabled?: boolean;
  /**
   * Asked whenever menus are validated (`NxMenu.validate()`, and as a menu opens) — NeXT's
   * validateMenuItem: false greys the item out. Overrides `disabled`.
   */
  enabled?: () => boolean;
  /** Asked likewise: true shows a check mark at the right, where a key equivalent goes (a mode that is on, say). */
  checked?: () => boolean;
  /**
   * Items of a submenu; the item then shows a ▷ and opens it to the right. A function makes the
   * submenu's items as it opens, and again whenever menus are validated (a list that changes).
   */
  submenu?: NxMenuItems;
  action?: () => void;
}

/** A menu's items, or a function that makes them (asked again whenever menus are validated). */
export type NxMenuItems = NxMenuItem[] | (() => NxMenuItem[]);

export interface NxMenuOptions {
  title: string;
  items: NxMenuItems;
  /** A torn-off menu has a close box and stays put on its own. */
  torn?: boolean;
}

/**
 * The one torn-off copy of each submenu, keyed by the submenu's item list (shared by every
 * copy of that submenu, however it was opened). A new tear-off of the same submenu replaces
 * the old one; different submenus can each have their own.
 */
const tornOffs = new WeakMap<NxMenuItems, NxMenu>();
/** Every menu on screen, for `NxMenu.validate()`. */
const live = new Set<NxMenu>();

/**
 * A NeXTSTEP vertical menu: black title bar, bevelled items, ▷ submenus that attach to the
 * right edge. Drag a menu by its title; dragging an attached submenu tears it off.
 * A submenu can be popped out while its torn-off copy is open elsewhere, but there is never
 * more than one torn-off copy: tearing off the new one closes the old.
 * Mount it in a positioned container (e.g. `NxDesktop.place`).
 */
export class NxMenu extends NxWidget<HTMLDivElement> {
  /** Re-asks every item's `enabled` and `checked` in every menu on screen (call after state changes). */
  static validate(): void {
    for (const m of [...live]) if (live.has(m)) m.validate();
  }

  /**
   * Closes every attached (popped-out, not torn-off) submenu, as a click elsewhere does on
   * NeXT. Fixed and torn-off menus stay.
   */
  static closeAttached(): void {
    for (const m of [...live]) if (live.has(m) && (!m.parentMenu || m.torn)) m.closeSubmenu();
  }

  readonly title: string;
  private parentMenu?: NxMenu;
  private parentItem?: HTMLDivElement;
  private open?: { item: HTMLDivElement; menu: NxMenu };
  private readonly items = new Map<string, { el: HTMLDivElement; def: NxMenuItem }>();
  private readonly titleBar: HTMLDivElement;
  private readonly source: NxMenuItems;
  /** The labels shown, to tell when a dynamic menu's items have changed. */
  private shown = '';
  private torn = false;
  /** Called when the user has finished dragging the menu somewhere (to remember where, say). */
  onMoved?: (menu: NxMenu) => void;

  constructor({ title, items, torn = false }: NxMenuOptions) {
    super(h('div', { role: 'menu' }), 'nx-menu');
    this.title = title;
    this.source = items;
    this.titleBar = h('div', { className: 'nx-menu-title', textContent: title });
    this.titleBar.addEventListener('pointerdown', (e) => this.beginMove(e));
    this.el.append(this.titleBar);
    this.build(typeof items === 'function' ? items() : items);
    if (torn) this.tear();
    live.add(this);
    this.validate();
  }

  /** Re-asks this menu's items' `enabled` and `checked`. */
  validate(): void {
    if (typeof this.source === 'function') {
      const defs = this.source();
      if (defs.map((d) => d.label).join('\n') !== this.shown) this.build(defs);
      else for (const d of defs) {
        // The same items: take the new definitions (their actions and tests).
        const it = this.items.get(d.label);
        if (it && !it.def.submenu) it.def = d;
      }
    }
    for (const { el, def } of this.items.values()) {
      if (def.enabled) def.disabled = !def.enabled();
      el.classList.toggle('disabled', !!def.disabled);
      if (def.checked) el.classList.toggle('checked', def.checked());
    }
  }

  get x(): number {
    return this.el.offsetLeft;
  }
  get y(): number {
    return this.el.offsetTop;
  }

  moveTo(x: number, y: number): void {
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.fitHeight();
    this.layoutSubmenu();
  }

  /** A menu too long for the space below it scrolls (its title stays). */
  private fitHeight(): void {
    const room = this.el.parentElement?.clientHeight;
    this.el.style.maxHeight = room ? `${Math.max(60, room - this.y - 4)}px` : '';
  }

  /** (Re)makes the item rows. */
  private build(defs: NxMenuItem[]): void {
    this.closeSubmenu();
    for (const { el } of this.items.values()) el.remove();
    this.items.clear();
    for (const def of defs) this.el.append(this.itemEl(def));
    this.shown = defs.map((d) => d.label).join('\n');
  }

  /** Enables/disables an item by label. */
  setEnabled(label: string, enabled: boolean): void {
    const it = this.items.get(label);
    if (!it) return;
    it.def.disabled = !enabled;
    it.el.classList.toggle('disabled', !enabled);
  }

  /** Opens the submenu under `label` and tears it off at (x, y) in the parent's coordinates. */
  tearOff(label: string, x: number, y: number): NxMenu | undefined {
    const it = this.items.get(label);
    if (!it?.def.submenu) return;
    if (this.open?.item !== it.el) this.openSubmenu(it.el, it.def);
    const sub = this.open!.menu;
    sub.detach();
    sub.moveTo(x, y);
    return sub;
  }

  closeSubmenu(): void {
    if (!this.open) return;
    this.open.menu.closeSubmenu();
    this.open.menu.destroy();
    this.open.item.classList.remove('highlighted');
    this.open = undefined;
  }

  override destroy(): void {
    this.closeSubmenu();
    if (tornOffs.get(this.source) === this) tornOffs.delete(this.source);
    live.delete(this);
    super.destroy();
  }

  private itemEl(def: NxMenuItem): HTMLDivElement {
    const el = h('div', { className: 'nx-menu-item', role: 'menuitem' });
    el.append(h('span', { className: 'label', textContent: def.label }));
    if (def.submenu) {
      const k = h('span', { className: 'key' });
      k.append(glyph.branch());
      el.append(k);
    } else if (def.checked) {
      el.append(h('span', { className: 'key check', textContent: '✓' }));
    } else if (def.key) {
      el.append(h('span', { className: 'key', textContent: def.key }));
    }
    el.classList.toggle('disabled', !!def.disabled);
    this.items.set(def.label, { el, def });

    if (def.submenu) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || def.disabled) return;
        e.preventDefault();
        if (this.open?.item === el) this.closeSubmenu();
        else this.openSubmenu(el, def);
      });
    } else {
      // Leaf items highlight while pressed, like a momentary button.
      const current = () => this.items.get(def.label)?.def ?? def;
      momentary(
        el,
        () => {
          current().action?.();
          this.dismissAttached();
        },
        () => !current().disabled,
      );
    }
    return el;
  }

  private openSubmenu(item: HTMLDivElement, def: NxMenuItem): void {
    this.closeSubmenu();
    const sub = new NxMenu({ title: def.label, items: def.submenu! });
    sub.parentMenu = this;
    sub.parentItem = item;
    item.classList.add('highlighted');
    this.open = { item, menu: sub };
    this.el.parentElement?.append(sub.el);
    this.layoutSubmenu();
    sub.fitHeight();
  }

  /** Keeps an attached submenu glued to the right of its item. */
  private layoutSubmenu(): void {
    if (!this.open) return;
    const { item, menu } = this.open;
    menu.moveTo(this.x + this.el.offsetWidth, this.y + item.offsetTop - 1);
  }

  /** After choosing a command, close attached submenus back up to the nearest fixed menu. */
  private dismissAttached(): void {
    let m: NxMenu = this;
    while (m.parentMenu && !m.torn) m = m.parentMenu;
    m.closeSubmenu();
  }

  /** Turns an attached submenu into a free-standing torn-off menu with a close box. */
  private detach(): void {
    if (this.parentMenu?.open?.menu === this) {
      this.parentMenu.open = undefined;
      this.parentItem?.classList.remove('highlighted');
    }
    this.tear();
  }

  private tear(): void {
    if (this.torn) return;
    this.torn = true;
    const previous = tornOffs.get(this.source);
    if (previous && previous !== this) previous.destroy();
    tornOffs.set(this.source, this);
    const close = h('button', { type: 'button', className: 'nx-title-btn close', title: 'Close' });
    close.append(glyph.close());
    momentary(close, () => this.destroy());
    this.titleBar.append(close);
  }

  private beginMove(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.nx-title-btn')) return;
    e.preventDefault();
    const x0 = this.x;
    const y0 = this.y;
    startDrag(e, {
      threshold: 2,
      move: (dx, dy) => {
        if (this.parentMenu && !this.torn) this.detach();
        this.moveTo(x0 + dx, Math.max(0, y0 + dy));
      },
      end: (moved) => moved && this.onMoved?.(this),
    });
  }
}
