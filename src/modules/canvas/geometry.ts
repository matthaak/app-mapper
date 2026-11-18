import type { DiagramNode } from './model';

/** One grid cell, in world units (≈ one line-height at 100% zoom). */
export const G = 16;
export const NODE_W = 12 * G;
export const NODE_H = 4 * G;
/** Spacing between parallel hierarchy lines sharing a side. */
export const LANE = G / 2;
export const CHILD_INDENT = 4 * G;
export const ROW_GAP = G;

export interface Pt {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Hierarchy lines                                                    */
/* ------------------------------------------------------------------ */

export interface HierarchyLayout {
  /** One orthogonal polyline (exit → elbow → entry) per parent→child edge. */
  edges: { parentId: string; childId: string; points: Pt[] }[];
  /** Extensions of a parent's top/bottom side line when its lanes outgrow the node's frontage. */
  ledges: { from: Pt; to: Pt }[];
}

interface Link {
  child: DiagramNode;
  entry: Pt;
  /** Vertical distance from the parent's exit side to the child's entry point. */
  dist: number;
}

/**
 * Each child sits in one of four quadrants around its parent (by center):
 *   upper-left  → exits parent top,    enters child right
 *   upper-right → exits parent top,    enters child left
 *   lower-left  → exits parent bottom, enters child right
 *   lower-right → exits parent bottom, enters child left
 * Every edge has its own lane (vertical segment) on the parent's side, 0.5 grid apart, and a
 * side's lanes are kept together near its middle (see assignLanes).
 */
export function layoutHierarchy(nodes: DiagramNode[]): HierarchyLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, DiagramNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n);
    else kids.set(n.parentId, [n]);
  }

  const out: HierarchyLayout = { edges: [], ledges: [] };

  for (const [parentId, children] of kids) {
    const p = byId.get(parentId);
    if (!p) continue;

    for (const side of ['top', 'bottom'] as const) {
      const sideY = side === 'top' ? p.y : p.y + NODE_H;
      const leftward: Link[] = [];
      const rightward: Link[] = [];

      for (const c of children) {
        // All nodes share one size, so comparing corners is comparing centers.
        if (c.y >= p.y !== (side === 'bottom')) continue;
        const toRight = c.x >= p.x;
        const entry = { x: toRight ? c.x : c.x + NODE_W, y: c.y + NODE_H / 2 };
        (toRight ? rightward : leftward).push({ child: c, entry, dist: Math.abs(entry.y - sideY) });
      }
      if (!leftward.length && !rightward.length) continue;

      // A child level with the parent (entry not beyond the exit side) can't be reached by a
      // lane under the rectangle without crossing it; give it a lane on the extended side line.
      const beside = (l: Link) => (side === 'bottom' ? l.entry.y <= sideY : l.entry.y >= sideY);
      const byDist = (a: Link, b: Link) => a.dist - b.dist;
      const sideL = leftward.filter(beside).sort(byDist);
      const sideR = rightward.filter(beside).sort(byDist);
      const left = leftward.filter((l) => !beside(l)).sort(byDist);
      const right = rightward.filter((l) => !beside(l)).sort(byDist);
      const [lx, rx] = assignLanes(p, left, right);
      const slx = sideL.map((_, i) => p.x - (i + 1) * LANE);
      const srx = sideR.map((_, i) => p.x + NODE_W + (i + 1) * LANE);

      const emit = (l: Link, x: number) =>
        out.edges.push({
          parentId,
          childId: l.child.id,
          points: [{ x, y: sideY }, { x, y: l.entry.y }, l.entry],
        });
      left.forEach((l, i) => emit(l, lx[i]));
      right.forEach((l, i) => emit(l, rx[i]));
      sideL.forEach((l, i) => emit(l, slx[i]));
      sideR.forEach((l, i) => emit(l, srx[i]));

      // Lanes that run off the rectangle's frontage get the side line extended to hold them.
      const xs = [...lx, ...rx, ...slx, ...srx];
      const min = Math.min(...xs);
      const max = Math.max(...xs);
      if (min < p.x + LANE / 2) {
        out.ledges.push({ from: { x: min - LANE, y: sideY }, to: { x: p.x, y: sideY } });
      }
      if (max > p.x + NODE_W - LANE / 2) {
        out.ledges.push({ from: { x: p.x + NODE_W, y: sideY }, to: { x: max + LANE, y: sideY } });
      }
    }
  }
  return out;
}

/**
 * Returns lane x positions for leftward and rightward links (each sorted nearest-first).
 * The lanes sit side by side, LANE apart, as near the middle of the parent's side as they can:
 * leftward lanes on the left (nearest child outermost), rightward ones on the right (likewise),
 * so no elbow crosses another lane. Each lane also stays at least G short of its child's
 * near side, so it never runs down through the child.
 */
function assignLanes(p: DiagramNode, left: Link[], right: Link[]): [number[], number[]] {
  // Left to right: leftward nearest…farthest, then rightward farthest…nearest.
  const order = [...left, ...[...right].reverse()];
  const n = order.length;
  if (!n) return [[], []];
  // The block's first lane is at s; lane k at s + k·LANE. Each child bounds s from one side.
  let lo = -Infinity;
  let hi = Infinity;
  order.forEach((l, k) => {
    if (k < left.length) lo = Math.max(lo, l.entry.x + G - k * LANE);
    else hi = Math.min(hi, l.entry.x - G - k * LANE);
  });
  const ideal = p.x + NODE_W / 2 - ((n - 1) * LANE) / 2;
  if (lo <= hi) {
    const s = Math.min(hi, Math.max(lo, ideal));
    // Keep on the half-grid: round inside [lo, hi] (both are on it, as nodes snap to the grid).
    const snapped = Math.min(Math.floor(hi / LANE) * LANE, Math.max(Math.ceil(lo / LANE) * LANE, Math.round(s / LANE) * LANE));
    const xs = order.map((_, k) => snapped + k * LANE);
    return [xs.slice(0, left.length), xs.slice(left.length).reverse()];
  }
  return packLanes(p, left, right);
}

/** When the children leave no common block: each group as near its own edge as its children allow. */
function packLanes(p: DiagramNode, left: Link[], right: Link[]): [number[], number[]] {
  // Rightward: nearest child takes the rightmost lane, farther ones step left.
  const rStart = Math.min(p.x + NODE_W - LANE, ...right.map((l) => l.entry.x - G));
  // Leftward: mirror image.
  const lStart = Math.max(p.x + LANE, ...left.map((l) => l.entry.x + G));
  return [left.map((_, i) => lStart + i * LANE), right.map((_, i) => rStart - i * LANE)];
}
