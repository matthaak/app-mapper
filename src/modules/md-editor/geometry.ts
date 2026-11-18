/** Text-offset ↔ DOM-point lookups and on-screen rects for caret positions. */
import type { DomPoint } from './serialize';

/** First index in sorted `a` whose value is ≥ `x` (a.length if none). */
export function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The text nodes under `root` in document order, addressed by character offset into their
 * concatenated text.
 */
export class TextIndex {
  readonly nodes: Text[] = [];
  readonly starts: number[] = [];
  readonly length: number;
  private readonly startOf = new Map<Text, number>();

  constructor(readonly root: Node) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (!n.length) continue;
      this.nodes.push(n);
      this.starts.push(total);
      this.startOf.set(n, total);
      total += n.length;
    }
    this.length = total;
  }

  /**
   * The DOM point at text offset `k`. With `after`, the point is the end of the node holding
   * character k-1 (e.g. still inside a <strong>); otherwise the start of the node holding k.
   */
  point(k: number, after: boolean): DomPoint {
    const { nodes, starts } = this;
    if (!nodes.length) return { node: this.root, offset: 0 };
    k = Math.max(0, Math.min(this.length, k));
    if (after && k > 0) {
      const j = lowerBound(starts, k) - 1; // last node starting before k
      return { node: nodes[j], offset: k - starts[j] };
    }
    if (k === this.length) {
      const last = nodes[nodes.length - 1];
      return { node: last, offset: last.length };
    }
    const j = lowerBound(starts, k + 1) - 1; // last node starting at or before k
    return { node: nodes[j], offset: k - starts[j] };
  }

  /**
   * Where a DOM point falls in the text: offset `k`, and whether it hugs character k-1 (`after`)
   * or character k. Null if the point is not under the root.
   */
  locate(p: DomPoint): { k: number; after: boolean } | null {
    if (!this.root.contains(p.node)) return null;
    const start = p.node instanceof Text ? this.startOf.get(p.node) : undefined;
    if (start !== undefined) return p.offset > 0 ? { k: start + p.offset, after: true } : { k: start, after: false };
    // An element position (or an empty text node): find the first text node at/after it.
    const r = document.createRange();
    r.setStart(p.node, p.offset);
    let lo = 0;
    let hi = this.nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r.comparePoint(this.nodes[mid], 0) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo < this.nodes.length ? { k: this.starts[lo], after: false } : { k: this.length, after: this.length > 0 };
  }
}

/** First non-empty client rect of a range. */
export function rangeRect(r: Range): DOMRect | null {
  for (const rect of r.getClientRects()) if (rect.height > 0) return rect;
  return null;
}

function lastRect(r: Range): DOMRect | null {
  const rects = Array.from(r.getClientRects()).filter((rect) => rect.height > 0);
  return rects[rects.length - 1] ?? null;
}

/**
 * The on-screen box of the line at a DOM point: the character after it, else the one before,
 * else the collapsed caret, else the enclosing element. Never mutates the DOM.
 */
export function pointRect(p: DomPoint): DOMRect | null {
  const { node, offset } = p;
  const r = document.createRange();
  if (node instanceof Text) {
    const d = node.data;
    if (offset < d.length && d[offset] !== '\n') {
      r.setStart(node, offset);
      r.setEnd(node, offset + 1);
      const rect = rangeRect(r);
      if (rect) return rect;
    }
    if (offset > 0 && d[offset - 1] !== '\n') {
      r.setStart(node, offset - 1);
      r.setEnd(node, offset);
      const rect = lastRect(r);
      if (rect) return rect;
    }
    r.setStart(node, offset);
    r.collapse(true);
    return rangeRect(r) ?? node.parentElement?.getBoundingClientRect() ?? null;
  }
  const child = node.childNodes[offset];
  if (child instanceof Text) return pointRect({ node: child, offset: 0 });
  if (child instanceof Element) {
    const rect = child.getBoundingClientRect();
    if (rect.height > 0) return rect;
  }
  return node instanceof Element ? node.getBoundingClientRect() : null;
}

/** Vertical centre of a rect. */
export const midY = (r: DOMRect) => (r.top + r.bottom) / 2;
