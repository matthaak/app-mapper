/** Base class for every widget: owns one root element and its lifecycle. */
export abstract class Widget<E extends HTMLElement = HTMLElement> {
  readonly el: E;

  protected constructor(el: E, className: string) {
    this.el = el;
    this.el.classList.add('ui', className);
  }

  get hidden(): boolean {
    return Boolean(this.el.hidden); // DOM type also allows 'until-found'
  }
  set hidden(v: boolean) {
    this.el.hidden = v;
  }

  /** Appends this widget to `parent` and returns it, for chaining. */
  mount(parent: Element | Widget): this {
    (parent instanceof Widget ? parent.el : parent).append(this.el);
    return this;
  }

  /** Removes the element. Subclasses that add global listeners must override and call super. */
  destroy(): void {
    this.el.remove();
  }
}

/** Creates an element with properties assigned in one call. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}
