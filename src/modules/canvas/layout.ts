import { CHILD_INDENT, NODE_H, NODE_W, ROW_GAP } from './geometry';
import type { DiagramNode, Hierarchy } from './model';

/**
 * Adds a child in the parent's lower-right quadrant, below the parent's existing
 * lower subtree (tree-view style). Nodes further down in that region — siblings,
 * aunts, uncles, cousins — are pushed down to make room.
 */
export function addChildWithLayout(
  tree: Hierarchy,
  parentId: string,
  label: string,
  extra: Parameters<Hierarchy['add']>[4] = {},
): DiagramNode {
  const p = tree.get(parentId);
  const subtree = tree.descendants(parentId);
  const keep = new Set([parentId, ...subtree.map((n) => n.id)]);
  for (let a = p.parentId; a; a = tree.get(a).parentId) keep.add(a);

  let bottom = p.y + NODE_H;
  for (const d of subtree) if (d.y > p.y) bottom = Math.max(bottom, d.y + NODE_H);

  const x = p.x + CHILD_INDENT;
  const y = bottom + ROW_GAP;

  const blockers = tree
    .all()
    .filter((n) => !keep.has(n.id) && n.y >= bottom && n.x + NODE_W > p.x - CHILD_INDENT);

  if (blockers.length) {
    const shift = y + NODE_H + ROW_GAP - Math.min(...blockers.map((n) => n.y));
    if (shift > 0) {
      const moving = new Set<string>();
      for (const b of blockers) {
        moving.add(b.id);
        for (const d of tree.descendants(b.id)) moving.add(d.id);
      }
      for (const id of moving) {
        if (keep.has(id)) continue;
        const n = tree.get(id);
        tree.move(id, n.x, n.y + shift);
      }
    }
  }

  return tree.add(parentId, label, x, y, extra);
}
