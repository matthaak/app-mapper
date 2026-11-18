import { LABEL_H, layoutDependencies, segmentsOf, type DependencyRoute, type Seg } from './dependencies';
import { G, NODE_H, NODE_W, layoutHierarchy, type Pt } from './geometry';
import { addChildWithLayout } from './layout';
import { DependencyGraph, Hierarchy, type Dependency, type DiagramNode, type Direction } from './model';

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

const toPoints = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
const snap = (v: number) => Math.round(v / G) * G;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type CanvasSelection = { kind: 'node' | 'dep'; id: string } | null;
export type CanvasMode = 'select' | 'dependency' | 'reparent';
/** screen = world * k + (x, y) */
export interface CanvasViewport {
  x: number;
  y: number;
  k: number;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | {
      kind: 'drag';
      cx: number;
      cy: number;
      sx: number;
      sy: number;
      leadId: string;
      origin: Map<string, Pt>;
      dx: number;
      dy: number;
      moved: boolean;
    };

export const ARROW: Record<Direction, string> = { forward: '→', backward: '←', both: '↔', none: '—' };
const NEXT_DIRECTION: Record<Direction, Direction> = {
  forward: 'backward',
  backward: 'both',
  both: 'none',
  none: 'forward',
};

/**
 * Model edits the canvas asks for. Each defaults to editing the canvas's own models; a host
 * that owns the data elsewhere (e.g. dependencies written in files) supplies its own, updates
 * the models synchronously, and the canvas re-renders.
 */
export interface CanvasEdits {
  /** Tab / Add Child on a selected node. */
  addChild(parentId: string): void;
  removeNode(id: string): void;
  /** Returns the new dependency's id (selected, with its label opened for editing), or null. */
  addDependency(source: string, target: string): string | null;
  updateDependency(id: string, patch: Partial<Pick<Dependency, 'label' | 'direction'>>): void;
  removeDependency(id: string): void;
}

/** What an outside toolbar needs to show. Reported through `onState`. */
export interface CanvasState {
  selection: CanvasSelection;
  mode: CanvasMode;
  canAddChild: boolean;
  canReparent: boolean;
  canDetach: boolean;
  canDelete: boolean;
  canRename: boolean;
  /** The selected dependency's direction (when directions can be changed). */
  direction: Direction | null;
  zoom: number;
}

/** Insets from the canvas's edges, in px. */
export interface CanvasInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A canvas-relative rectangle, in px. */
interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room Reset View leaves around the diagram, in px. */
const FIT_MARGIN = 3 * G;

export interface CanvasViewOptions {
  tree?: Hierarchy;
  graph?: DependencyGraph;
  edits?: Partial<CanvasEdits>;
  /** Node labels can be edited in place (double-click, Enter). Default true. */
  renameNodes?: boolean;
  /** Dependency directions can be cycled. Default true. */
  directions?: boolean;
  /**
   * The part of the canvas that counts as in view, as insets from its edges in px (something
   * else may cover the rest, or be meant to). Reset View fits the diagram in it, new things go
   * in its middle, zooming centers on it and `relayout` keeps its middle steady. Default: all of it.
   */
  viewable?: () => CanvasInsets;
  /** Overrides for the hint line at the bottom-left. */
  hints?: Partial<Record<'idle' | 'node' | 'dep', string>>;
  /** Selection, mode or zoom changed. */
  onState?: (state: CanvasState) => void;
  /** The user changed the tree: moved, added, removed, re-parented or detached a node. */
  onLayoutChange?: () => void;
  /** Pan or zoom changed. */
  onViewChange?: (view: CanvasViewport) => void;
  /**
   * A node was double-clicked, or Enter pressed on it — when node labels aren't edited in
   * place (`renameNodes: false`); otherwise those edit the label.
   */
  onNodeOpen?: (id: string) => void;
  /** Double-click on empty canvas, at this world point. */
  onBackgroundDoubleClick?: (at: Pt) => void;
  /** A click on empty canvas (a press and release without panning). */
  onBackgroundClick?: () => void;
}

/**
 * The interactive diagram surface: hierarchy lines, routed dependencies and nodes in an SVG
 * that pans (drag the background) and zooms (wheel). Nodes drag with their subtree (Alt alone).
 *
 * It has no toolbar of its own: commands are public methods, and `onState` reports what an
 * outside toolbar should enable. Mount it in a positioned container; it fills it.
 */
export class CanvasView {
  readonly tree: Hierarchy;
  readonly graph: DependencyGraph;
  readonly el: HTMLDivElement;

  private view: CanvasViewport = { x: 0, y: 0, k: 1 };
  /** The viewable area's middle when last measured (see `relayout`). */
  private mid: Pt | null = null;
  private selection: CanvasSelection = null;
  private mode: CanvasMode = 'select';
  private depSource: string | null = null;
  private dropTarget: string | null = null;
  private gesture: Gesture | null = null;
  private notice = '';
  private endEdit: (() => void) | null = null;
  private depRoutes = new Map<string, DependencyRoute>();
  private labelFit = new Map<string, string>();
  private nodeCount = 1;
  private readonly opts: CanvasViewOptions;
  private readonly edits: CanvasEdits;

  private readonly root: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly hierLayer: SVGGElement;
  private readonly depLayer: SVGGElement;
  private readonly nodeLayer: SVGGElement;
  private readonly overlay: SVGGElement;
  private readonly preview: SVGLineElement;
  private readonly hint: HTMLDivElement;

  constructor(host: HTMLElement, o: CanvasViewOptions = {}) {
    this.opts = o;
    this.tree = o.tree ?? new Hierarchy('Root', 0, 0);
    this.graph = o.graph ?? new DependencyGraph();
    this.nodeCount = this.tree.all().length;
    this.edits = {
      addChild: (parentId) => this.defaultAddChild(parentId),
      removeNode: (id) => {
        this.graph.removeForNode(id);
        this.tree.remove(id);
      },
      addDependency: (s, t) => this.graph.add(s, t).id,
      updateDependency: (id, patch) => this.graph.update(id, patch),
      removeDependency: (id) => this.graph.remove(id),
      ...o.edits,
    };

    this.el = document.createElement('div');
    this.el.className = 'canvas';
    this.el.tabIndex = -1;
    host.append(this.el);

    this.root = svg('svg', {}, this.el);
    const defs = svg('defs', {}, this.root);
    for (const [id, cls] of [
      ['arrow', 'dep-arrow'],
      ['arrow-sel', 'dep-arrow sel'],
    ]) {
      const marker = svg(
        'marker',
        { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
        defs,
      );
      svg('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, marker);
    }

    this.world = svg('g', {}, this.root);
    this.hierLayer = svg('g', {}, this.world);
    this.depLayer = svg('g', {}, this.world);
    this.nodeLayer = svg('g', {}, this.world);
    this.overlay = svg('g', {}, this.world);
    this.preview = svg('line', { class: 'preview', visibility: 'hidden' }, this.overlay);

    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.el.append(this.hint);

    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('dblclick', this.onDoubleClick);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);

    this.resetView();
    this.render();
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.el.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                       */
  /* ---------------------------------------------------------------- */

  get state(): CanvasState {
    const sel = this.selection;
    const nodeId = sel?.kind === 'node' ? sel.id : null;
    const isRoot = nodeId !== null && nodeId === this.tree.rootId;
    return {
      selection: sel,
      mode: this.mode,
      canAddChild: !!nodeId,
      canReparent: !!nodeId && !isRoot,
      canDetach: !!nodeId && this.tree.canDetach(nodeId),
      canDelete: !!sel && !isRoot,
      canRename: sel?.kind === 'dep' || (!!nodeId && this.opts.renameNodes !== false),
      direction: sel?.kind === 'dep' && this.opts.directions !== false ? this.graph.get(sel.id).direction : null,
      zoom: this.view.k,
    };
  }

  get viewport(): CanvasViewport {
    return { ...this.view };
  }
  set viewport(v: CanvasViewport) {
    this.view = { x: v.x, y: v.y, k: clamp(v.k, 0.2, 4) };
    this.applyView();
    this.updateChrome();
  }

  /** Re-renders after the models were changed from outside. Drops a selection that is gone. */
  refresh(): void {
    const sel = this.selection;
    if (sel && !(sel.kind === 'node' ? this.tree.has(sel.id) : this.graph.has(sel.id))) this.selection = null;
    if (this.depSource && !this.tree.has(this.depSource)) this.depSource = null;
    this.render();
  }

  select(sel: CanvasSelection): void {
    if (sel?.kind === this.selection?.kind && sel?.id === this.selection?.id) return;
    this.selection = sel;
    this.notice = '';
    this.render();
  }

  /** Selects a node and pans so it is in view (centered in the viewable area if it was outside it). */
  reveal(id: string): void {
    this.select({ kind: 'node', id });
    const n = this.tree.get(id);
    const a = this.area();
    const { x, y, k } = this.view;
    const left = n.x * k + x;
    const top = n.y * k + y;
    if (left < a.x || top < a.y || left + NODE_W * k > a.x + a.width || top + NODE_H * k > a.y + a.height) {
      this.view.x = a.x + a.width / 2 - (n.x + NODE_W / 2) * k;
      this.view.y = a.y + a.height / 2 - (n.y + NODE_H / 2) * k;
      this.applyView();
    }
  }

  /**
   * The viewable area changed size or place (the window was resized, or whatever covers the
   * rest of the canvas moved): pans so what was in its middle stays in its middle.
   */
  relayout(): void {
    const before = this.mid;
    const after = this.areaMid();
    this.mid = after;
    if (!before || (before.x === after.x && before.y === after.y)) return;
    this.view.x += after.x - before.x;
    this.view.y += after.y - before.y;
    this.applyView();
  }

  /** The middle of the viewable area, in canvas px (to restore a saved viewport with `relayout`'s shift). */
  get viewableMiddle(): Pt {
    return this.areaMid();
  }

  /** The world point under a screen point. */
  toWorld(e: { clientX: number; clientY: number }): Pt {
    const r = this.root.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k };
  }

  /** The world point at the middle of the viewable area. */
  center(): Pt {
    const r = this.root.getBoundingClientRect();
    const m = this.areaMid();
    return this.toWorld({ clientX: r.left + m.x, clientY: r.top + m.y });
  }

  /** Is the canvas itself (not something over it) at this screen point? */
  isOver(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY);
    return !!el && this.root.contains(el);
  }

  /** The node at a screen point, if the canvas is not covered there. */
  nodeAt(clientX: number, clientY: number): string | null {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !this.root.contains(el)) return null;
    const hit = this.hitTest(el);
    return hit?.kind === 'node' ? hit.id : null;
  }

  /** Highlights a node as the target of a drag from outside (null clears). */
  setDropTarget(id: string | null): void {
    if (id === this.dropTarget) return;
    this.dropTarget = id;
    this.render();
  }

  addChild(): void {
    if (this.selection?.kind !== 'node') return;
    this.edits.addChild(this.selection.id);
  }

  toggleReparent(): void {
    if (this.mode === 'reparent') return this.setMode('select');
    if (this.selection?.kind !== 'node' || this.selection.id === this.tree.rootId) return;
    this.setMode('reparent');
  }

  /** Makes the selected node top-level (forests only). */
  detach(): void {
    const sel = this.selection;
    if (sel?.kind !== 'node' || !this.tree.canDetach(sel.id)) return;
    this.tree.detach(sel.id);
    this.setMode('select');
    this.opts.onLayoutChange?.();
  }

  toggleDependency(): void {
    if (this.mode === 'dependency') return this.setMode('select');
    const source = this.selection?.kind === 'node' ? this.selection.id : null;
    this.setMode('dependency');
    this.depSource = source;
    this.render();
  }

  cycleDirection(): void {
    if (this.selection?.kind !== 'dep' || this.opts.directions === false) return;
    const dep = this.graph.get(this.selection.id);
    this.edits.updateDependency(dep.id, { direction: NEXT_DIRECTION[dep.direction] });
    this.render();
  }

  rename(): void {
    if (this.selection && this.state.canRename) this.editLabel(this.selection);
  }

  deleteSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    if (sel.kind === 'node') {
      if (sel.id === this.tree.rootId) return;
      // Deleting a component is the one case that removes its dependencies.
      this.edits.removeNode(sel.id);
      this.selection = null;
      this.setMode('select');
      this.opts.onLayoutChange?.();
    } else {
      this.edits.removeDependency(sel.id);
      this.selection = null;
      this.setMode('select');
    }
  }

  /**
   * Pans and zooms so the whole diagram fits in the viewable area, centered (never past 100%;
   * empty, the world's origin goes in the middle at 100%).
   */
  resetView(): void {
    const a = this.area();
    this.mid = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const nodes = this.tree.all();
    if (!nodes.length) {
      this.view = { x: this.mid.x, y: this.mid.y, k: 1 };
      return this.applyView();
    }
    const x0 = Math.min(...nodes.map((n) => n.x));
    const y0 = Math.min(...nodes.map((n) => n.y));
    const x1 = Math.max(...nodes.map((n) => n.x + NODE_W));
    const y1 = Math.max(...nodes.map((n) => n.y + NODE_H));
    const room = { w: Math.max(1, a.width - 2 * FIT_MARGIN), h: Math.max(1, a.height - 2 * FIT_MARGIN) };
    const k = clamp(Math.min(1, room.w / (x1 - x0), room.h / (y1 - y0)), 0.2, 4);
    this.view = { x: this.mid.x - ((x0 + x1) / 2) * k, y: this.mid.y - ((y0 + y1) / 2) * k, k };
    this.applyView();
  }

  /** Zooms by `factor` around the middle of the viewable area. */
  zoomBy(factor: number): void {
    const m = this.areaMid();
    this.zoomAt(this.view.k * factor, m.x, m.y);
  }

  /** The viewable area (see `viewable`), in canvas px. */
  private area(): Area {
    const { width, height } = this.root.getBoundingClientRect();
    const i = this.opts.viewable?.() ?? { left: 0, top: 0, right: 0, bottom: 0 };
    return { x: i.left, y: i.top, width: Math.max(0, width - i.left - i.right), height: Math.max(0, height - i.top - i.bottom) };
  }

  private areaMid(): Pt {
    const a = this.area();
    return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  private render(): void {
    // While nodes are dragged the dependency lines aren't re-routed (too slow to do live; they
    // are routed afresh on release). A line between two nodes that are both moving rides along
    // with them, as it is; one whose ends move apart stays put, faded; the rest are untouched.
    const g = this.gesture;
    const dragging = g?.kind === 'drag' && g.moved;
    this.hierLayer.replaceChildren();
    if (dragging) this.dragDependencies(g.origin, g.dx, g.dy);
    else this.depLayer.replaceChildren();
    this.nodeLayer.replaceChildren();

    const nodes = this.tree.all();

    // Structural layer: hierarchy lines are derived from parent links + positions.
    const { edges, ledges } = layoutHierarchy(nodes);
    const hierLines: Seg[] = [];
    for (const e of edges) {
      svg('polyline', { points: toPoints(e.points), class: 'hier' }, this.hierLayer);
      hierLines.push(...segmentsOf(e.points));
    }
    for (const l of ledges) {
      svg('line', { x1: l.from.x, y1: l.from.y, x2: l.to.x, y2: l.to.y, class: 'ledge' }, this.hierLayer);
      hierLines.push([l.from, l.to]);
    }

    // Relationship layer: routed around nodes, but never along hierarchy lines.
    if (!dragging) this.renderDependencies(nodes, hierLines);

    for (const n of nodes) {
      const cls = ['node'];
      if (this.isSelected('node', n.id)) cls.push('selected');
      if (n.id === this.depSource) cls.push('source');
      if (n.id === this.dropTarget) cls.push('target');
      if (n.id === this.tree.rootId) cls.push('root');
      if (n.muted) cls.push('muted');
      const g = svg('g', { class: cls.join(' '), 'data-node': n.id, transform: `translate(${n.x} ${n.y})` }, this.nodeLayer);
      if (n.tooltip) svg('title', {}, g).textContent = n.tooltip;
      svg('rect', { width: NODE_W, height: NODE_H, rx: 3 }, g);
      if (n.sublabel) {
        const t = svg('text', { x: NODE_W / 2, y: NODE_H / 2 - 7, class: 'node-label' }, g);
        this.setFittedText(t, n.label);
        const s = svg('text', { x: NODE_W / 2, y: NODE_H / 2 + 11, class: 'node-sublabel' }, g);
        this.setFittedText(s, n.sublabel);
      } else {
        const t = svg('text', { x: NODE_W / 2, y: NODE_H / 2, class: 'node-label' }, g);
        this.setFittedText(t, n.label);
      }
    }

    this.updateChrome();
  }

  /**
   * During a drag of `moving` by (dx, dy): a line with both ends moving follows them; one with
   * just one end moving (it will be re-routed) freezes, faded; one with neither stays as it is.
   */
  private dragDependencies(moving: Map<string, Pt>, dx: number, dy: number): void {
    for (const el of this.depLayer.children) {
      const id = (el as SVGGElement).dataset.dep;
      const d = id && this.graph.has(id) ? this.graph.get(id) : null;
      const ends = d ? +moving.has(d.source) + +moving.has(d.target) : 1;
      const rides = ends === 2;
      el.classList.toggle('frozen', ends === 1);
      el.classList.toggle('riding', rides);
      if (rides) el.setAttribute('transform', `translate(${dx} ${dy})`);
    }
  }

  private renderDependencies(nodes: DiagramNode[], hierLines: Seg[]): void {
    this.depRoutes = layoutDependencies(this.graph.all(), nodes, hierLines);
    for (const d of this.graph.all()) {
      const r = this.depRoutes.get(d.id);
      if (!r) continue;
      const selected = this.isSelected('dep', d.id);
      const g = svg('g', { class: selected ? 'dep selected' : 'dep', 'data-dep': d.id }, this.depLayer);
      const points = toPoints(r.points);
      svg('polyline', { points, class: 'dep-hit' }, g);
      const line = svg('polyline', { points, class: 'dep-line' }, g);
      const marker = `url(#${selected ? 'arrow-sel' : 'arrow'})`;
      if (d.direction === 'forward' || d.direction === 'both') line.setAttribute('marker-end', marker);
      if (d.direction === 'backward' || d.direction === 'both') line.setAttribute('marker-start', marker);
      if (d.label) {
        const x = r.align === 'end' ? r.label.x + r.label.w : r.align === 'middle' ? r.label.x + r.label.w / 2 : r.label.x;
        const t = svg('text', { x, y: r.label.y + LABEL_H - 3.5, 'text-anchor': r.align, class: 'dep-label' }, g);
        t.textContent = d.label;
      }
    }
  }

  /** Truncates a label with an ellipsis so it fits inside the node. */
  private setFittedText(t: SVGTextElement, label: string): void {
    const key = `${t.getAttribute('class')}|${label}`;
    const cached = this.labelFit.get(key);
    if (cached !== undefined) {
      t.textContent = cached;
      return;
    }
    const max = NODE_W - G;
    t.textContent = label;
    let s = label;
    while (s.length > 1 && t.getComputedTextLength() > max) {
      s = s.slice(0, -1);
      t.textContent = `${s.trimEnd()}…`;
    }
    // Text measures 0 until the canvas is laid out: don't remember a fit made then.
    if (t.getComputedTextLength() > 0) this.labelFit.set(key, t.textContent ?? label);
  }

  private updateChrome(): void {
    this.el.dataset.mode = this.mode;
    this.hint.textContent = this.notice || this.hintText();
    this.opts.onState?.(this.state);
  }

  private label(id: string): string {
    return this.tree.get(id).label;
  }

  private hintText(): string {
    if (this.mode === 'dependency') {
      return this.depSource
        ? `Dependency from “${this.label(this.depSource)}”: click the target node · Esc to cancel`
        : 'Dependency: click the source node · Esc to cancel';
    }
    if (this.mode === 'reparent' && this.selection) {
      return `Click the new parent for “${this.label(this.selection.id)}” · Esc to cancel`;
    }
    const h = this.opts.hints ?? {};
    if (this.selection?.kind === 'node') {
      return h.node ?? 'Drag to move with its subtree (Alt-drag moves the node alone) · Tab add child · Enter rename · Del delete';
    }
    if (this.selection?.kind === 'dep') {
      return h.dep ?? (this.opts.directions === false ? 'Enter edit label · Del delete' : 'Enter edit label · Direction cycles arrows · Del delete');
    }
    return h.idle ?? 'Drag the canvas to pan · scroll to zoom · click a node to select it';
  }

  private applyView(): void {
    const { x, y, k } = this.view;
    this.world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    const cell = G * k;
    this.el.style.backgroundSize = `${cell}px ${cell}px`;
    this.el.style.backgroundPosition = `${x}px ${y}px`;
    this.el.classList.toggle('grid-off', cell < 6);
    this.opts.onViewChange?.(this.viewport);
  }

  private drawPreview(at: Pt | null): void {
    if (!at || !this.depSource) {
      this.preview.setAttribute('visibility', 'hidden');
      return;
    }
    const s = this.tree.get(this.depSource);
    this.preview.setAttribute('x1', String(s.x + NODE_W / 2));
    this.preview.setAttribute('y1', String(s.y + NODE_H / 2));
    this.preview.setAttribute('x2', String(at.x));
    this.preview.setAttribute('y2', String(at.y));
    this.preview.setAttribute('visibility', 'visible');
  }

  /* ---------------------------------------------------------------- */
  /* Commands                                                         */
  /* ---------------------------------------------------------------- */

  private isSelected(kind: 'node' | 'dep', id: string): boolean {
    return this.selection?.kind === kind && this.selection.id === id;
  }

  private setMode(mode: CanvasMode): void {
    this.mode = mode;
    this.depSource = null;
    this.notice = '';
    this.drawPreview(null);
    this.render();
  }

  private defaultAddChild(parentId: string): void {
    const child = addChildWithLayout(this.tree, parentId, `Node ${++this.nodeCount}`);
    this.setMode('select');
    this.selection = { kind: 'node', id: child.id };
    this.render();
    this.ensureVisible(child);
    this.opts.onLayoutChange?.();
    this.editLabel(this.selection);
  }

  private pickParent(parentId: string): void {
    const id = this.selection!.id;
    if (parentId === id) {
      this.notice = 'A node can’t be its own parent — pick another node · Esc to cancel';
    } else if (!this.tree.canReparent(id, parentId)) {
      this.notice = 'Can’t move a node under its own descendant — pick another node · Esc to cancel';
    } else {
      this.tree.reparent(id, parentId);
      this.setMode('select');
      this.opts.onLayoutChange?.();
      return;
    }
    this.render();
  }

  private pickDependencyEnd(id: string): void {
    if (!this.depSource) {
      this.depSource = id;
    } else if (id === this.depSource) {
      this.depSource = null;
      this.drawPreview(null);
    } else {
      const depId = this.edits.addDependency(this.depSource, id);
      this.setMode('select');
      if (depId && this.graph.has(depId)) {
        this.selection = { kind: 'dep', id: depId };
        this.render();
        this.editLabel(this.selection);
      }
      return;
    }
    this.render();
  }

  private ensureVisible(n: Pt): void {
    const { width, height } = this.root.getBoundingClientRect();
    const { x, y, k } = this.view;
    const margin = 2 * G;
    const right = (n.x + NODE_W) * k + x;
    const bottom = (n.y + NODE_H) * k + y;
    if (right > width - margin) this.view.x -= right - (width - margin);
    if (bottom > height - margin) this.view.y -= bottom - (height - margin);
    this.applyView();
  }

  /** Inline label editor, placed in world space so it pans/zooms with the canvas. */
  private editLabel(sel: NonNullable<CanvasSelection>): void {
    this.endEdit?.();
    let box: { x: number; y: number; w: number; h: number };
    let value: string;
    let align = 'center';
    if (sel.kind === 'node') {
      const n = this.tree.get(sel.id);
      box = { x: n.x + 1, y: n.y + 1, w: NODE_W - 2, h: NODE_H - 2 };
      value = n.label;
    } else {
      const r = this.depRoutes.get(sel.id);
      if (!r) return;
      const w = Math.max(10 * G, r.label.w + 2 * G);
      const x =
        r.align === 'end' ? r.label.x + r.label.w + 4 - w : r.align === 'middle' ? r.label.x + r.label.w / 2 - w / 2 : r.label.x - 4;
      box = { x, y: r.label.y - 3, w, h: LABEL_H + 6 };
      align = r.align === 'end' ? 'right' : r.align === 'middle' ? 'center' : 'left';
      value = this.graph.get(sel.id).label;
    }

    const fo = svg('foreignObject', { x: box.x, y: box.y, width: box.w, height: box.h, class: 'editor' }, this.overlay);
    const input = document.createElement('input');
    input.className = sel.kind === 'node' ? 'node-editor' : 'dep-editor';
    input.style.textAlign = align;
    input.value = value;
    input.spellcheck = false;
    if (sel.kind === 'dep') input.placeholder = 'label (optional)';
    fo.append(input);

    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.endEdit = null;
      if (save) {
        const v = input.value.trim();
        if (sel.kind === 'node' && v && this.tree.has(sel.id)) this.tree.rename(sel.id, v);
        if (sel.kind === 'dep' && this.graph.has(sel.id) && v !== value) this.edits.updateDependency(sel.id, { label: v });
      }
      fo.remove();
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    // Committed by the next press elsewhere (canvas or toolbar) rather than on blur,
    // so the press that opened the editor can't immediately close it.
    this.endEdit = () => finish(true);
    const focus = () => {
      if (done || document.activeElement === input) return;
      input.focus();
      input.select();
    };
    focus();
    setTimeout(focus);
    requestAnimationFrame(focus);
  }

  /** Commits an open label editor (e.g. before a toolbar command runs). */
  commitEdit(): void {
    this.endEdit?.();
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                            */
  /* ---------------------------------------------------------------- */

  private hitTest(target: Element | null): NonNullable<CanvasSelection> | null {
    const node = target?.closest<SVGElement>('[data-node]');
    if (node) return { kind: 'node', id: node.dataset.node! };
    const dep = target?.closest<SVGElement>('[data-dep]');
    if (dep) return { kind: 'dep', id: dep.dataset.dep! };
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    if (target.closest('.editor')) return;
    this.endEdit?.();
    // Take keyboard focus from whatever had it (a text field, an editor window).
    this.el.focus({ preventScroll: true });
    const hit = e.button === 0 ? this.hitTest(target) : null;

    if (hit?.kind === 'node') {
      e.preventDefault();
      if (this.mode === 'dependency') return this.pickDependencyEnd(hit.id);
      if (this.mode === 'reparent') return this.pickParent(hit.id);
      this.select(hit);
      const ids = [hit.id, ...(e.altKey ? [] : this.tree.descendants(hit.id).map((n) => n.id))];
      const origin = new Map(ids.map((id): [string, Pt] => [id, { x: this.tree.get(id).x, y: this.tree.get(id).y }]));
      const w = this.toWorld(e);
      this.gesture = { kind: 'drag', cx: e.clientX, cy: e.clientY, sx: w.x, sy: w.y, leadId: hit.id, origin, dx: 0, dy: 0, moved: false };
      return;
    }
    if (hit?.kind === 'dep' && this.mode === 'select') {
      e.preventDefault();
      return this.select(hit);
    }

    e.preventDefault();
    this.gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
    this.el.classList.add('panning');
  };

  private onPointerMove = (e: PointerEvent) => {
    const g = this.gesture;
    if (g?.kind === 'pan') {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      this.view.x = g.vx + dx;
      this.view.y = g.vy + dy;
      this.applyView();
    } else if (g?.kind === 'drag') {
      if (!g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < 3) return;
      g.moved = true;
      const w = this.toWorld(e);
      const lead = g.origin.get(g.leadId)!;
      const dx = snap(lead.x + w.x - g.sx) - lead.x;
      const dy = snap(lead.y + w.y - g.sy) - lead.y;
      if (dx === g.dx && dy === g.dy) return;
      g.dx = dx;
      g.dy = dy;
      for (const [id, p] of g.origin) this.tree.move(id, p.x + dx, p.y + dy);
      this.render();
    }
    if (this.mode === 'dependency' && this.depSource) this.drawPreview(this.toWorld(e));
  };

  private onPointerUp = () => {
    const g = this.gesture;
    this.gesture = null;
    this.el.classList.remove('panning');
    if (g?.kind === 'pan' && !g.moved) {
      if (this.mode !== 'select') this.setMode('select');
      else this.select(null);
      this.opts.onBackgroundClick?.();
    } else if (g?.kind === 'drag' && g.moved) {
      this.render(); // the full dependency layout, now the drag is over
      if (g.dx || g.dy) this.opts.onLayoutChange?.();
    }
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (this.mode !== 'select') return;
    // The press re-rendered the scene, so find what is under the pointer now.
    const hit = this.hitTest(document.elementFromPoint(e.clientX, e.clientY));
    if (!hit) {
      this.opts.onBackgroundDoubleClick?.(this.toWorld(e));
      return;
    }
    this.select(hit);
    if (hit.kind === 'dep' || this.opts.renameNodes !== false) this.editLabel(hit);
    else this.opts.onNodeOpen?.(hit.id);
  };

  private zoomAt(k: number, mx: number, my: number): void {
    k = clamp(k, 0.2, 4);
    this.view.x = mx - ((mx - this.view.x) * k) / this.view.k;
    this.view.y = my - ((my - this.view.y) * k) / this.view.k;
    this.view.k = k;
    this.applyView();
    this.updateChrome();
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const rate = e.ctrlKey ? 0.01 : 0.0015; // ctrl+wheel = trackpad pinch
    const r = this.root.getBoundingClientRect();
    this.zoomAt(this.view.k * Math.exp(-e.deltaY * unit * rate), e.clientX - r.left, e.clientY - r.top);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.endEdit) return;
    // Only keys meant for the canvas: not those typed into windows or fields over it.
    const t = e.target as HTMLElement;
    if (t !== document.body && !this.el.contains(t)) return;
    if (e.metaKey || e.ctrlKey) return;
    switch (e.key) {
      case 'Escape':
        if (this.mode !== 'select') this.setMode('select');
        else this.select(null);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        break;
      case 'Tab':
        if (this.selection?.kind !== 'node') return;
        e.preventDefault();
        this.addChild();
        break;
      case 'Enter':
      case 'F2':
        if (!this.selection) return;
        e.preventDefault();
        if (this.selection.kind === 'node' && this.opts.renameNodes === false) this.opts.onNodeOpen?.(this.selection.id);
        else this.editLabel(this.selection);
        break;
    }
  };
}
