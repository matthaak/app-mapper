/*
 * Two independent models:
 *  - Hierarchy: the structural component tree (positions + parent links).
 *  - DependencyGraph: explicit relationships between components.
 * Neither knows about the other, so moving or re-parenting a node can never
 * touch its dependencies.
 */

export interface DiagramNode {
  id: string;
  label: string;
  /** Second line in smaller, faded text (e.g. a file name). */
  sublabel?: string;
  /** Tooltip shown on hover. */
  tooltip?: string;
  /** Drawn faded with a dashed outline (e.g. its file is missing). */
  muted?: boolean;
  /** Top-left corner, in world units. */
  x: number;
  y: number;
  parentId: string | null;
}

export type Direction = 'forward' | 'backward' | 'both' | 'none';

export interface Dependency {
  id: string;
  source: string;
  target: string;
  label: string;
  direction: Direction;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}${++counter}`;

/**
 * The component tree. With a root label it has one permanent root that every other node
 * descends from; without one it is a forest of top-level nodes (`parentId: null`).
 */
export class Hierarchy {
  private readonly nodes = new Map<string, DiagramNode>();
  readonly rootId: string | null = null;

  constructor(rootLabel?: string, x = 0, y = 0) {
    if (rootLabel === undefined) return;
    const root: DiagramNode = { id: nextId('n'), label: rootLabel, x, y, parentId: null };
    this.nodes.set(root.id, root);
    this.rootId = root.id;
  }

  all(): DiagramNode[] {
    return [...this.nodes.values()];
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  get(id: string): DiagramNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown node ${id}`);
    return node;
  }

  children(id: string): DiagramNode[] {
    return this.all().filter((n) => n.parentId === id);
  }

  descendants(id: string): DiagramNode[] {
    const out: DiagramNode[] = [];
    const stack = [id];
    while (stack.length) {
      for (const child of this.children(stack.pop()!)) {
        out.push(child);
        stack.push(child.id);
      }
    }
    return out;
  }

  /** True when `ancestorId` is `id` itself or one of its ancestors. */
  isSelfOrAncestor(ancestorId: string, id: string): boolean {
    for (let cur: string | null = id; cur; cur = this.get(cur).parentId) {
      if (cur === ancestorId) return true;
    }
    return false;
  }

  /** Adds a node under `parentId` (or at the top level, for null). `id` defaults to a fresh one. */
  add(
    parentId: string | null,
    label: string,
    x: number,
    y: number,
    extra: Partial<Pick<DiagramNode, 'id' | 'sublabel' | 'tooltip' | 'muted'>> = {},
  ): DiagramNode {
    if (parentId !== null) this.get(parentId);
    if (parentId === null && this.rootId) throw new Error('Every node descends from the root');
    const id = extra.id ?? nextId('n');
    if (this.nodes.has(id)) throw new Error(`Duplicate node ${id}`);
    const node: DiagramNode = { ...extra, id, label, x, y, parentId };
    this.nodes.set(id, node);
    return node;
  }

  move(id: string, x: number, y: number): void {
    const node = this.get(id);
    node.x = x;
    node.y = y;
  }

  rename(id: string, label: string): void {
    this.get(id).label = label;
  }

  /** Updates a node's display fields. */
  update(id: string, patch: Partial<Pick<DiagramNode, 'label' | 'sublabel' | 'tooltip' | 'muted'>>): void {
    Object.assign(this.get(id), patch);
  }

  /** A node may move under any node that is not itself or one of its descendants. */
  canReparent(id: string, parentId: string): boolean {
    return id !== this.rootId && !this.isSelfOrAncestor(id, parentId);
  }

  reparent(id: string, parentId: string): void {
    if (!this.canReparent(id, parentId)) throw new Error('Invalid re-parent');
    this.get(id).parentId = parentId;
  }

  /** Only in a forest: a child node can become a top-level node again. */
  canDetach(id: string): boolean {
    return !this.rootId && this.get(id).parentId !== null;
  }

  detach(id: string): void {
    if (!this.canDetach(id)) throw new Error('Invalid detach');
    this.get(id).parentId = null;
  }

  /** Removes a node; its children are adopted by its parent (or become top-level). */
  remove(id: string): void {
    const node = this.get(id);
    if (id === this.rootId) throw new Error('The root cannot be removed');
    for (const child of this.children(id)) child.parentId = node.parentId;
    this.nodes.delete(id);
  }
}

export class DependencyGraph {
  private readonly deps = new Map<string, Dependency>();

  all(): Dependency[] {
    return [...this.deps.values()];
  }

  has(id: string): boolean {
    return this.deps.has(id);
  }

  get(id: string): Dependency {
    const dep = this.deps.get(id);
    if (!dep) throw new Error(`Unknown dependency ${id}`);
    return dep;
  }

  add(source: string, target: string, label = '', direction: Direction = 'forward', id = nextId('d')): Dependency {
    if (source === target) throw new Error('A dependency needs two different nodes');
    const dep: Dependency = { id, source, target, label, direction };
    this.deps.set(dep.id, dep);
    return dep;
  }

  update(id: string, patch: Partial<Pick<Dependency, 'label' | 'direction'>>): void {
    Object.assign(this.get(id), patch);
  }

  remove(id: string): void {
    this.deps.delete(id);
  }

  clear(): void {
    this.deps.clear();
  }

  /** Called only when a component is deleted outright. */
  removeForNode(nodeId: string): void {
    for (const dep of this.deps.values()) {
      if (dep.source === nodeId || dep.target === nodeId) this.deps.delete(dep.id);
    }
  }
}
