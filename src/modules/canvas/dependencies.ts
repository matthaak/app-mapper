import { G, NODE_H, NODE_W, type Pt } from './geometry';
import type { Dependency, DiagramNode } from './model';

/*
 * Dependency connector routing: orthogonal, NeXTSTEP-style. Only horizontal and vertical runs
 * with square corners, on a half-grid (R = G/2) so lines sit on the canvas grid and can still
 * pass between nodes stacked a grid apart.
 *
 * Ends: a line leaves and enters a node perpendicular to one of its sides, at a port (a
 * half-grid point along the side, corners excluded), with a straight stub of STUB steps so
 * the arrowhead is square to the node. No two lines share a port; ports next to a used one,
 * and away from the side's middle, cost a little more; ports where a hierarchy line attaches
 * are not used.
 *
 * Path: A* over (grid point, heading) from every free port of the source to every free port
 * of the target, minimizing length plus a cost per bend, with penalties for running along
 * another line (hierarchy or an earlier dependency), running right beside one or beside a
 * node, and crossing one. Nodes are solid. Shorter dependencies are routed first, so they get
 * the direct paths.
 *
 * Port arrangement: after a first pass, other arrangements are routed and kept when they score
 * better (fewer crossings, then bends, then length) — each side's lines in the order their
 * routes turn (sidePorts), and crossing lines from one node with their ports swapped, even
 * across sides (swaps). See improve.
 *
 * Labels: centered along the route's longest horizontal run that holds them (above it, else
 * below), else beside a vertical run — wherever no node, label or line is in the way.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Seg = readonly [Pt, Pt];

export interface DependencyRoute {
  /** Ordered source → target. */
  points: Pt[];
  /** The label's box (for an empty label: where one would go). */
  label: Rect;
  /** Text alignment within the box: hugging a line on its left ('start') or right ('end'), or centered on it. */
  align: 'start' | 'middle' | 'end';
}

/** Routing grid step, in world units. */
const R = G / 2;
/** Straight steps out of a node at each end. */
const STUB = 2;
const COST = {
  bend: 3 * G,
  cross: G,
  /** Per step run along another line. */
  overlap: 6 * G,
  /** Per step run right beside another line or a node. */
  near: R,
  /** Per world unit a port is from the middle of its side. */
  portOffset: 0.1,
  /** A port next to one already used. */
  portNear: G,
};
/** Free space kept around the diagram for routes going round it. */
const MARGIN = 6 * G;
/**
 * Heuristic weight: above 1 the search goes straight for the target instead of fanning out over
 * equally good detours. Routes cost at most this factor more than the best (in practice they
 * are nearly always the same), and searching is many times faster.
 */
const WEIGHT = 1.2;
/** Search budget per dependency before falling back to a simple shape. */
const MAX_POPS = 300_000;
export const LABEL_H = 14;
const LABEL_CHAR_W = 6.2;

/** Headings: right, down, left, up. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export const segmentsOf = (pts: Pt[]): Seg[] => pts.slice(1).map((p, i): Seg => [pts[i], p]);

interface Port {
  /** Grid point on the node's side. */
  p: number;
  /** Heading out of the node. */
  d: number;
  /** End of the stub, STUB steps out. */
  end: number;
  /** Cost of the port and its stub. */
  cost: number;
}

/** The routing grid: obstacles and what earlier lines occupy. Points are indices j * w + i. */
class Grid {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  /** Inside or on the outline of a node. */
  readonly blocked: Uint8Array;
  /** One step outside a node. */
  readonly nearNode: Uint8Array;
  /** Lines along the edge from p to p + 1 (h) or p + w (v), and lines one step beside it. */
  readonly hOcc: Uint8Array;
  readonly vOcc: Uint8Array;
  readonly hNear: Uint8Array;
  readonly vNear: Uint8Array;
  /** 2: a route ends here; 1: next to such a port. */
  readonly port: Uint8Array;

  constructor(nodes: DiagramNode[], lines: Seg[]) {
    const xs = nodes.flatMap((n) => [n.x, n.x + NODE_W]);
    const ys = nodes.flatMap((n) => [n.y, n.y + NODE_H]);
    for (const [a, b] of lines) xs.push(a.x, b.x), ys.push(a.y, b.y);
    this.x0 = Math.floor((Math.min(...xs) - MARGIN) / R) * R;
    this.y0 = Math.floor((Math.min(...ys) - MARGIN) / R) * R;
    this.w = Math.ceil((Math.max(...xs) + MARGIN - this.x0) / R) + 1;
    this.h = Math.ceil((Math.max(...ys) + MARGIN - this.y0) / R) + 1;
    this.n = this.w * this.h;
    this.blocked = new Uint8Array(this.n);
    this.nearNode = new Uint8Array(this.n);
    this.hOcc = new Uint8Array(this.n);
    this.vOcc = new Uint8Array(this.n);
    this.hNear = new Uint8Array(this.n);
    this.vNear = new Uint8Array(this.n);
    this.port = new Uint8Array(this.n);

    for (const nd of nodes) {
      const [i0, i1, j0, j1] = this.box(nd);
      for (let j = Math.max(0, j0 - 1); j <= Math.min(this.h - 1, j1 + 1); j++) {
        for (let i = Math.max(0, i0 - 1); i <= Math.min(this.w - 1, i1 + 1); i++) {
          const inside = i >= i0 && i <= i1 && j >= j0 && j <= j1;
          if (inside) this.blocked[j * this.w + i] = 1;
          else this.nearNode[j * this.w + i] = 1;
        }
      }
    }
    for (const [a, b] of lines) this.markSeg(a, b);
  }

  i(x: number): number {
    return Math.round((x - this.x0) / R);
  }
  j(y: number): number {
    return Math.round((y - this.y0) / R);
  }
  /** Grid extent of a node: [left, right, top, bottom]. */
  box(n: DiagramNode): [number, number, number, number] {
    return [this.i(n.x), this.i(n.x + NODE_W), this.j(n.y), this.j(n.y + NODE_H)];
  }
  pt(p: number): Pt {
    return { x: this.x0 + (p % this.w) * R, y: this.y0 + Math.floor(p / this.w) * R };
  }
  /** The neighbor of p in heading d, or -1 off the grid. */
  step(p: number, d: number): number {
    const i = (p % this.w) + DX[d];
    const j = Math.floor(p / this.w) + DY[d];
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  /** Records a horizontal or vertical segment (others are ignored). */
  markSeg(a: Pt, b: Pt): void {
    if (a.y === b.y) {
      const j = this.j(a.y);
      const [lo, hi] = [this.i(Math.min(a.x, b.x)), this.i(Math.max(a.x, b.x))];
      for (let i = lo; i < hi; i++) this.markEdge(j * this.w + i, true);
    } else if (a.x === b.x) {
      const i = this.i(a.x);
      const [lo, hi] = [this.j(Math.min(a.y, b.y)), this.j(Math.max(a.y, b.y))];
      for (let j = lo; j < hi; j++) this.markEdge(j * this.w + i, false);
    }
  }

  /** Marks the edge from e to e + 1 (horizontal) or e + w (vertical), and its sides. */
  markEdge(e: number, horizontal: boolean): void {
    if (e < 0 || e >= this.n) return;
    const occ = horizontal ? this.hOcc : this.vOcc;
    const near = horizontal ? this.hNear : this.vNear;
    if (occ[e] < 255) occ[e]++;
    for (const side of horizontal ? [e - this.w, e + this.w] : [e - 1, e + 1]) {
      if (side >= 0 && side < this.n) near[side] = 1;
    }
  }

  /** Does a horizontal line touch point p? A vertical one? */
  hTouch(p: number): boolean {
    return this.hOcc[p] > 0 || (p % this.w > 0 && this.hOcc[p - 1] > 0);
  }
  vTouch(p: number): boolean {
    return this.vOcc[p] > 0 || (p >= this.w && this.vOcc[p - this.w] > 0);
  }

  /** Cost of the step from p in heading d to q (not counting a bend). */
  edgeCost(p: number, d: number, q: number): number {
    let c = R;
    if (d === 0 || d === 2) {
      const e = d === 0 ? p : q;
      c += this.hOcc[e] * COST.overlap + (this.hNear[e] ? COST.near : 0);
      if (this.vTouch(q)) c += COST.cross;
    } else {
      const e = d === 1 ? p : q;
      c += this.vOcc[e] * COST.overlap + (this.vNear[e] ? COST.near : 0);
      if (this.hTouch(q)) c += COST.cross;
    }
    if (this.nearNode[q]) c += COST.near;
    return c;
  }

  /** The free ports of a node, with their stubs — or just port `only`, reserved for this line. */
  ports(n: DiagramNode, only?: number): Port[] {
    const [i0, i1, j0, j1] = this.box(n);
    const out: Port[] = [];
    const add = (i: number, j: number, d: number, offset: number) => {
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
      const p = j * this.w + i;
      if (only !== undefined ? p !== only : this.port[p] === 2 || this.hTouch(p) || this.vTouch(p)) return;
      let cost = COST.portOffset * Math.abs(offset) + (only === undefined && this.port[p] ? COST.portNear : 0);
      let q = p;
      for (let s = 0; s < STUB; s++) {
        const next = this.step(q, d);
        if (next < 0 || this.blocked[next]) return;
        cost += this.edgeCost(q, d, next);
        q = next;
      }
      out.push({ p, d, end: q, cost });
    };
    const ci = (i0 + i1) / 2;
    const cj = (j0 + j1) / 2;
    for (let i = i0 + 1; i < i1; i++) {
      add(i, j0, 3, (i - ci) * R);
      add(i, j1, 1, (i - ci) * R);
    }
    for (let j = j0 + 1; j < j1; j++) {
      add(i0, j, 2, (j - cj) * R);
      add(i1, j, 0, (j - cj) * R);
    }
    return out;
  }

  /** Takes a port (and makes its neighbours dearer). */
  claimPort(end: number): void {
    this.port[end] = 2;
    for (let d = 0; d < 4; d++) {
      const q = this.step(end, d);
      if (q >= 0 && !this.port[q]) this.port[q] = 1;
    }
  }

  /** Records a routed path (grid points, each next to the one before). */
  claim(path: number[]): void {
    for (let k = 1; k < path.length; k++) {
      const [a, b] = [path[k - 1], path[k]];
      const horizontal = Math.abs(b - a) === 1;
      this.markEdge(Math.min(a, b), horizontal);
    }
    for (const end of [path[0], path[path.length - 1]]) this.claimPort(end);
  }
}

/** A binary min-heap of (key, value) pairs. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }
  clear(): void {
    this.keys.length = this.vals.length = 0;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (k[up] <= key) break;
      k[i] = k[up];
      v[i] = v[up];
      i = up;
    }
    k[i] = key;
    v[i] = val;
  }
  /** Removes the smallest; its key is in `topKey` afterwards. */
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const val = v[0];
    this.topKey = k[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return val;
  }
  topKey = 0;
}

/** Search state, reused between searches (and layouts) of the same size or smaller. */
let gBuf = new Float64Array(0);
let stampBuf = new Uint32Array(0);
let parentBuf = new Int32Array(0);
let goalBuf = new Uint32Array(0);
let stamp = 0;
const heap = new Heap();

/**
 * The cheapest path from a port of `src` to a port of `tgt`, as grid points, or null.
 * `fixed` pins both ends to given ports.
 */
function search(grid: Grid, src: DiagramNode, tgt: DiagramNode, weight: number, fixed?: Ends): number[] | null {
  const from = grid.ports(src, fixed?.[0]);
  const to = grid.ports(tgt, fixed?.[1]);
  if (!from.length || !to.length) return null;
  const S = grid.n * 4;
  if (gBuf.length < S) {
    gBuf = new Float64Array(S);
    stampBuf = new Uint32Array(S);
    parentBuf = new Int32Array(S);
  }
  const g = gBuf;
  const seen = stampBuf;
  const parent = parentBuf;
  if (++stamp === 0xffffffff) {
    seen.fill(0);
    goalBuf.fill(0);
    stamp = 1;
  }

  // Heuristic: distance to the target's box grown by its stubs (where every approach ends),
  // plus a bend when it is off in both axes; weighted (see WEIGHT).
  const [ti0, ti1, tj0, tj1] = grid.box(tgt);
  const h = (p: number) => {
    const i = p % grid.w;
    const j = Math.floor(p / grid.w);
    const dx = Math.max(0, ti0 - STUB - i, i - ti1 - STUB);
    const dy = Math.max(0, tj0 - STUB - j, j - tj1 - STUB);
    return (dx + dy) * R + (dx && dy ? COST.bend : 0);
  };
  const TIE = weight;
  // Approach points (stub ends) of the target's ports, marked on the grid for a fast check.
  if (goalBuf.length < grid.n) goalBuf = new Uint32Array(grid.n);
  const goalAt = goalBuf;
  for (const t of to) goalAt[t.end] = stamp;

  heap.clear();
  from.forEach((s, k) => {
    const st = s.end * 4 + s.d;
    if (seen[st] === stamp && g[st] <= s.cost) return;
    seen[st] = stamp;
    g[st] = s.cost;
    parent[st] = -1 - k;
    heap.push(s.cost + h(s.end) * TIE, st);
  });

  let best = Infinity;
  let bestGoal = -1;
  let bestState = -1;
  for (let pops = 0; heap.size && pops < MAX_POPS; pops++) {
    const st = heap.pop();
    const key = heap.topKey;
    if (key >= best) break;
    const p = st >> 2;
    const d = st & 3;
    const cost = g[st];
    if (key - h(p) * TIE > cost + 1e-9) continue; // stale entry

    if (goalAt[p] === stamp) {
      for (let k = 0; k < to.length; k++) {
        const t = to[k];
        if (t.end !== p || d === t.d) continue; // heading away from the target: would need a U-turn
        const total = cost + (d === (t.d + 2) % 4 ? 0 : COST.bend) + t.cost;
        if (total < best) {
          best = total;
          bestGoal = k;
          bestState = st;
        }
      }
    }
    for (let turn = 0; turn < 3; turn++) {
      const nd = turn === 0 ? d : turn === 1 ? (d + 1) & 3 : (d + 3) & 3;
      const q = grid.step(p, nd);
      if (q < 0 || grid.blocked[q]) continue;
      const ng = cost + grid.edgeCost(p, nd, q) + (nd === d ? 0 : COST.bend);
      const ns = q * 4 + nd;
      if (seen[ns] === stamp && g[ns] <= ng) continue;
      seen[ns] = stamp;
      g[ns] = ng;
      parent[ns] = st;
      heap.push(ng + h(q) * TIE, ns);
    }
  }
  if (bestGoal < 0) return null;

  // Walk back: target stub end → … → source stub end, then add the stubs.
  const mid: number[] = [];
  let st = bestState;
  while (st >= 0) {
    mid.push(st >> 2);
    st = parent[st];
  }
  const s = from[-1 - st];
  const t = to[bestGoal];
  mid.reverse();
  const stub = (port: Port) => {
    const out = [port.p];
    for (let q = port.p, k = 0; k < STUB; k++) out.push((q = grid.step(q, port.d)));
    return out;
  };
  return [...stub(s), ...mid.slice(1, -1), ...stub(t).reverse()];
}

/** Drops points in the middle of straight runs. */
function corners(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1];
    const b = pts[k];
    const c = pts[k + 1];
    if (a.x === b.x && a.y === b.y) continue;
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** When no path is found: across from the facing sides, with one jog in the middle. */
function fallback(src: DiagramNode, tgt: DiagramNode): Pt[] {
  const right = tgt.x + NODE_W / 2 >= src.x + NODE_W / 2;
  const a = { x: right ? src.x + NODE_W : src.x, y: src.y + NODE_H / 2 };
  const b = { x: right ? tgt.x : tgt.x + NODE_W, y: tgt.y + NODE_H / 2 };
  const mx = Math.round((a.x + b.x) / 2 / R) * R;
  return corners([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
}

export function layoutDependencies(deps: Dependency[], nodes: DiagramNode[], fixedLines: Seg[]): Map<string, DependencyRoute> {
  const out = new Map<string, DependencyRoute>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = deps.filter((d) => d.source !== d.target && byId.has(d.source) && byId.has(d.target));
  if (!live.length) return out;

  const span = (d: Dependency) => {
    const a = byId.get(d.source)!;
    const b = byId.get(d.target)!;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  const order = [...live].sort((a, b) => span(a) - span(b));

  // Routing depends only on where the nodes and lines are: re-renders that change nothing
  // else (a selection, a label) reuse the last routes.
  const key = [
    nodes.map((n) => `${n.id}@${n.x},${n.y}`).join('|'),
    order.map((d) => `${d.id}:${d.source}>${d.target}`).join('|'),
    fixedLines.map(([a, b]) => `${a.x},${a.y},${b.x},${b.y}`).join('|'),
  ].join('#');
  let routes = memo?.key === key ? memo.routes : null;
  if (!routes) {
    const pass = improve(order, nodes, byId, fixedLines);
    routes = new Map<string, Pt[]>();
    for (const d of order) {
      const path = pass.paths.get(d.id);
      routes.set(d.id, path ? corners(path.map((p) => pass.grid.pt(p))) : fallback(byId.get(d.source)!, byId.get(d.target)!));
    }
    memo = { key, routes };
  }

  // Labels, in the dependencies' order, avoiding nodes, earlier labels and every line.
  const lines: Seg[] = [...fixedLines, ...[...routes.values()].flatMap(segmentsOf)];
  const boxes = nodes.map((n) => ({ x: n.x, y: n.y, w: NODE_W, h: NODE_H }));
  const labels: Rect[] = [];
  for (const d of live) {
    const points = routes.get(d.id)!;
    // An empty label still gets a spot (for editing one in), sized for a short word.
    const w = (d.label ? d.label.length : 10) * LABEL_CHAR_W + 2;
    const { rect, align } = placeLabel(points, w, boxes, labels, lines);
    if (d.label) labels.push(rect);
    out.set(d.id, { points, label: rect, align });
  }
  return out;
}

/** A line's source and target ports. */
type Ends = readonly [number, number];

/** The last layout's routes, and what they were routed for. */
let memo: { key: string; routes: Map<string, Pt[]> } | null = null;

/** Extra time the search for a better port arrangement may take, beyond the first pass. */
const IMPROVE_MS = 40;

/**
 * Routes once with a free choice of ports, then looks for better port arrangements, routing
 * again with each and keeping whichever layout scores best:
 * - each side's lines in the order that keeps them from crossing as they leave it (sidePorts);
 * - for two lines leaving the same node that cross, their ports there swapped — which can move
 *   a line round a corner to another side, where it no longer crosses.
 * Repeats from the best layout while it improves, within a time budget.
 */
function improve(order: Dependency[], nodes: DiagramNode[], byId: Map<string, DiagramNode>, fixedLines: Seg[]): Pass {
  const t0 = performance.now();
  let best = routeAll(order, nodes, byId, fixedLines);
  const budget = Math.max(IMPROVE_MS, 2 * (performance.now() - t0));
  const fresh = new Grid(nodes, fixedLines);
  const tried = new Set<string>();
  for (let round = 0; round < 6; round++) {
    const candidates: Map<string, Ends>[] = [];
    const sided = sidePorts(best.grid, fresh, best.paths, order, byId);
    if (sided) candidates.push(sided);
    candidates.push(...swaps(best, order));
    let next: Pass | null = null;
    for (const ports of candidates) {
      if (performance.now() - t0 > budget) break;
      const sig = [...ports.values()].join(';');
      if (tried.has(sig)) continue;
      tried.add(sig);
      const pass = routeAll(order, nodes, byId, fixedLines, ports);
      if (pass.score < (next ?? best).score) next = pass;
    }
    if (!next) break;
    best = next;
  }
  return best;
}

/** Each line's current ports. */
function endsOf(pass: Pass): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const [id, path] of pass.paths) if (path) out.set(id, [path[0], path[path.length - 1]]);
  return out;
}

/**
 * Port arrangements to try: for each pair of lines that leave the same node and cross each
 * other, the two swap their ports at that node. Most crossings first.
 */
function swaps(pass: Pass, order: Dependency[]): Map<string, Ends>[] {
  const ends = endsOf(pass);
  const segs = new Map<string, Seg[]>();
  for (const [id, path] of pass.paths) if (path) segs.set(id, segmentsOf(corners(path.map((p) => pass.grid.pt(p)))));
  const found: { n: number; ports: Map<string, Ends> }[] = [];
  const live = order.filter((d) => ends.has(d.id));
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const da = live[a];
      const db = live[b];
      let n = 0;
      for (const s of segs.get(da.id)!) for (const t of segs.get(db.id)!) if (crosses(s, t)) n++;
      if (!n) continue;
      const nodesA = [da.source, da.target];
      const nodesB = [db.source, db.target];
      for (let i = 0; i < 2; i++) {
        const j = nodesB.indexOf(nodesA[i]);
        if (j < 0) continue;
        const ports = new Map<string, Ends>([...ends].map(([id, e]) => [id, [...e] as const]));
        const ea = [...ends.get(da.id)!] as [number, number];
        const eb = [...ends.get(db.id)!] as [number, number];
        [ea[i], eb[j]] = [eb[j], ea[i]];
        ports.set(da.id, ea);
        ports.set(db.id, eb);
        found.push({ n, ports });
      }
    }
  }
  return found.sort((x, y) => y.n - x.n).map((f) => f.ports);
}

interface Pass {
  grid: Grid;
  /** Grid paths, by dependency id (null: no path found). */
  paths: Map<string, number[] | null>;
  /** Lower is better: crossings weigh most, then bends, then length. */
  score: number;
}

/** Routes `order` in turn, each claiming its path. With `fixed`, each line's ports are given. */
function routeAll(order: Dependency[], nodes: DiagramNode[], byId: Map<string, DiagramNode>, fixedLines: Seg[], fixed?: Map<string, Ends>): Pass {
  const grid = new Grid(nodes, fixedLines);
  if (fixed) for (const [a, b] of fixed.values()) grid.claimPort(a), grid.claimPort(b);
  const paths = new Map<string, number[] | null>();
  for (const d of order) {
    const path = search(grid, byId.get(d.source)!, byId.get(d.target)!, WEIGHT, fixed?.get(d.id));
    if (path) grid.claim(path);
    paths.set(d.id, path);
  }
  return { grid, paths, score: scorePass(grid, paths) };
}

function scorePass(grid: Grid, paths: Map<string, number[] | null>): number {
  let score = 0;
  const segs: Seg[] = [];
  for (const path of paths.values()) {
    if (!path) {
      score += 1e6; // a fallback shape ignores everything
      continue;
    }
    const pts = corners(path.map((p) => grid.pt(p)));
    score += (path.length - 1) * R + (pts.length - 2) * COST.bend;
    segs.push(...segmentsOf(pts));
  }
  for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length; b++) if (crosses(segs[a], segs[b])) score += 4 * COST.bend;
  return score;
}

/** Do a horizontal and a vertical segment cross (not merely touch at an end)? */
function crosses(s: Seg, t: Seg): boolean {
  const sh = s[0].y === s[1].y;
  if (sh === (t[0].y === t[1].y)) return false;
  const [h, v] = sh ? [s, t] : [t, s];
  const x = v[0].x;
  const y = h[0].y;
  return x > Math.min(h[0].x, h[1].x) && x < Math.max(h[0].x, h[1].x) && y > Math.min(v[0].y, v[1].y) && y < Math.max(v[0].y, v[1].y);
}

/** The heading of the step a → b (adjacent grid points). */
function heading(grid: Grid, a: number, b: number): number {
  return b - a === 1 ? 0 : b - a === grid.w ? 1 : b - a === -1 ? 2 : 3;
}

/**
 * Port order on each side of a node, so lines sharing a side don't cross as they leave it.
 * Each line's end is described by its route: how far it runs straight out before its first
 * turn (all the way, if it never turns), and which way it turns — toward the side's start
 * (up, on a left or right side; left, on a top or bottom one) or its end. Of two lines on a
 * side, the one turning toward the other crosses it if the other is still running out at that
 * depth: so a line turning down to reach a node lower on the canvas belongs below the lines
 * that run on further. Each side takes the order with the fewest such crossings, and the lines
 * then take the side's usable ports (those of `fresh`, a grid with no dependencies on it) in
 * that order, each moving as little as it can — a line running straight out, least of all.
 * Returns every line's ports, or null if no side has a better order than it has already.
 */
function sidePorts(
  grid: Grid,
  fresh: Grid,
  paths: Map<string, number[] | null>,
  deps: Dependency[],
  byId: Map<string, DiagramNode>,
): Map<string, Ends> | null {
  interface End {
    id: string;
    which: 0 | 1;
    node: string;
    out: number;
    port: number;
    /** Position along the side. */
    at: number;
    /** Steps straight out before the first turn. */
    run: number;
    /** The first turn: -1 toward the side's start, 1 toward its end, 0 none. */
    turn: number;
  }
  const nodesOf = new Map(deps.map((d) => [d.id, [d.source, d.target]]));
  const sides = new Map<string, End[]>();
  const ends = new Map<string, [number, number]>();
  for (const [id, path] of paths) {
    if (!path) continue;
    ends.set(id, [path[0], path[path.length - 1]]);
    for (const which of [0, 1] as const) {
      const walk = which === 0 ? path : [...path].reverse();
      const out = heading(grid, walk[0], walk[1]);
      const port = walk[0];
      const vertical = out === 0 || out === 2; // the side runs vertically
      let run = walk.length - 1;
      let turn = 0;
      for (let k = 1; k < walk.length; k++) {
        const d = heading(grid, walk[k - 1], walk[k]);
        if (d % 2 === out % 2) continue;
        run = k - 1;
        turn = (vertical ? d === 1 : d === 0) ? 1 : -1;
        break;
      }
      const node = nodesOf.get(id)![which];
      const key = `${out}:${node}`;
      const end: End = { id, which, node, out, port, at: vertical ? Math.floor(port / grid.w) : port % grid.w, run, turn };
      const list = sides.get(key);
      if (list) list.push(end);
      else sides.set(key, [end]);
    }
  }

  /** Do a (nearer the side's start) and b cross on leaving the side? */
  const cross = (a: End, b: End) => (a.turn === 1 && b.run > a.run) || (b.turn === -1 && a.run > b.run);
  const crossings = (order: End[]) => {
    let n = 0;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if (cross(order[i], order[j])) n++;
    return n;
  };

  let changed = false;
  for (const list of sides.values()) {
    if (list.length < 2) continue;
    const current = [...list].sort((a, b) => a.at - b.at);
    if (!crossings(current)) continue;
    const { node, out } = list[0];
    const vertical = out === 0 || out === 2;
    const slots = fresh
      .ports(byId.get(node)!)
      .filter((q) => q.d === out)
      .map((q) => q.p)
      .sort((a, b) => a - b);
    const pos = slots.map((p) => (vertical ? Math.floor(p / grid.w) : p % grid.w));
    // Try every order (sides rarely hold more than a few lines; beyond 6, by turn and run).
    let best: { order: End[]; picked: number[]; cost: number } | null = null;
    for (const order of orders(current)) {
      const picked = assignInOrder(
        order.map((e) => ({ at: e.at, weight: e.turn === 0 ? 4 : 1 })),
        pos,
      );
      if (!picked) continue;
      let cost = crossings(order) * 1e6;
      order.forEach((e, k) => (cost += (e.turn === 0 ? 4 : 1) * Math.abs(pos[picked[k]] - e.at)));
      if (!best || cost < best.cost) best = { order, picked, cost };
    }
    if (!best) continue;
    best.order.forEach((e, k) => {
      const p = slots[best!.picked[k]];
      if (p === e.port) return;
      changed = true;
      ends.get(e.id)![e.which] = p;
    });
  }
  return changed ? (ends as Map<string, Ends>) : null;
}

/** Every ordering of a few items; for more, just one: by turn, then nearest turn outermost. */
function orders<T extends { turn: number; run: number }>(items: T[]): T[][] {
  if (items.length > 6) {
    const key = (e: T) => (e.turn === -1 ? -1e6 + e.run : e.turn === 1 ? 1e6 - e.run : 0);
    return [[...items].sort((a, b) => key(a) - key(b))];
  }
  const out: T[][] = [];
  const walk = (rest: T[], acc: T[]) => {
    if (!rest.length) return void out.push(acc);
    rest.forEach((e, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, e]));
  };
  walk(items, []);
  return out;
}

/**
 * Gives items (in order) strictly increasing slots, minimizing the weighted distance each
 * moves from where it is. Returns slot indices, or null if there are too few slots.
 */
function assignInOrder(items: { at: number; weight: number }[], slots: number[]): number[] | null {
  const n = items.length;
  const m = slots.length;
  if (n > m) return null;
  // best[i][j]: cost of placing items 0..i with item i in slot j.
  const best = items.map(() => new Float64Array(m).fill(Infinity));
  const from = items.map(() => new Int32Array(m).fill(-1));
  for (let i = 0; i < n; i++) {
    let run = Infinity;
    let runAt = -1;
    for (let j = i; j < m - (n - 1 - i); j++) {
      if (i > 0 && best[i - 1][j - 1] < run) {
        run = best[i - 1][j - 1];
        runAt = j - 1;
      }
      const move = items[i].weight * Math.abs(slots[j] - items[i].at);
      best[i][j] = (i === 0 ? 0 : run) + move;
      from[i][j] = runAt;
    }
  }
  let j = -1;
  for (let k = 0; k < m; k++) if (j < 0 || best[n - 1][k] < best[n - 1][j]) j = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = j;
    j = from[i][j];
  }
  return out;
}

type Placed = { rect: Rect; align: DependencyRoute['align'] };

/** The best spot for a w-wide label along a route. */
function placeLabel(points: Pt[], w: number, nodes: Rect[], labels: Rect[], lines: Seg[]): Placed {
  const segs = segmentsOf(points);
  const len = ([a, b]: Seg) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  const at = (x: number, y: number, align: Placed['align']): Placed => ({ rect: { x, y, w, h: LABEL_H }, align });
  const candidates: Placed[] = [];
  for (const [a, b] of segs.filter(([a, b]) => a.y === b.y).sort((s, t) => len(t) - len(s))) {
    if (len([a, b]) < w + 2 * R) continue;
    const x = (a.x + b.x) / 2 - w / 2;
    candidates.push(at(x, a.y - LABEL_H - 1, 'middle'), at(x, a.y + 2, 'middle'));
  }
  for (const [a, b] of segs.filter(([a, b]) => a.x === b.x).sort((s, t) => len(t) - len(s))) {
    if (len([a, b]) < LABEL_H + 2 * R) continue;
    const y = (a.y + b.y) / 2 - LABEL_H / 2;
    candidates.push(at(a.x + 5, y, 'start'), at(a.x - 5 - w, y, 'end'));
  }
  // Last resort: beside the line where it leaves the source.
  const [p0, p1] = points;
  const y0 = p1.y < p0.y ? p0.y - LABEL_H - 1 : p0.y + 1;
  candidates.push(at(p0.x + 4, y0, 'start'), at(p0.x - 4 - w, y0, 'end'));

  let best = candidates[0];
  let bestScore = Infinity;
  candidates.forEach((c, k) => {
    const r = c.rect;
    let score = k * 0.01;
    if (nodes.some((n) => intersects(n, r))) score += 1000;
    if (labels.some((l) => intersects(shrink(l, -2), r))) score += 1000;
    for (const s of lines) if (hitsRect(s, shrink(r, 1))) score += 10;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  });
  return best;
}

/* ---- small geometry helpers ---- */

const shrink = (r: Rect, m: number): Rect => ({ x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m });

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Does the segment pass through the rectangle's open interior? (Liang–Barsky) */
function hitsRect([a, b]: Seg, r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return (
    clip(-dx, a.x - r.x) &&
    clip(dx, r.x + r.w - a.x) &&
    clip(-dy, a.y - r.y) &&
    clip(dy, r.y + r.h - a.y) &&
    t1 - t0 > 1e-6
  );
}
