/**
 * Canvas module — the diagram surface: hierarchy + dependency models, layout and routing, and
 * the interactive SVG view (`CanvasView`). It has no toolbar of its own; hosts drive it through
 * its public commands and `onState`. Demo with a plain toolbar at `/canvas.html`.
 *
 * Other modules import from here only, never from files inside this folder.
 */
import './canvas.css';

export {
  CanvasView,
  ARROW,
  type CanvasEdits,
  type CanvasMode,
  type CanvasSelection,
  type CanvasState,
  type CanvasViewOptions,
  type CanvasInsets,
  type CanvasViewport,
} from './canvas';
export { DependencyGraph, Hierarchy } from './model';
export type { Dependency, DiagramNode, Direction } from './model';
export { addChildWithLayout } from './layout';
export { G, NODE_H, NODE_W, type Pt } from './geometry';
