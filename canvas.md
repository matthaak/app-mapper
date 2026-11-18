# Canvas

The diagram surface (`src/modules/canvas/`): a hierarchy of nodes with routed dependency arrows, in an SVG that pans and zooms. Demo with a plain toolbar at `/canvas.html`.

## Models

`model.ts` keeps two models that never touch each other, so moving or re-parenting a node can't disturb its dependencies:

* **Hierarchy** — nodes (position, label, optional sublabel, tooltip and muted look) and their parent links. With a root label it has one permanent root; without, it is a forest of top-level nodes, which can also be detached back to the top level.
* **DependencyGraph** — relationships between nodes, each with a label and a direction (forward, backward, both, none). Ids can be supplied, so a host can keep them stable.

## Layout and routing

* `geometry.ts` — the 16-unit grid and node size (12 × 4 cells), and the hierarchy lines: each child sits in one of four quadrants around its parent and is reached by an orthogonal line with its own lane. The lanes on a side keep half a grid apart and gather near its middle, as far as the children's positions allow.
* `layout.ts` — places a new child below its parent's subtree, tree-view style, pushing nodes further down out of the way.
* `dependencies.ts` — routes the arrows NeXTSTEP-style: horizontal and vertical runs with square corners, on a half-grid so they sit on the canvas grid and fit between nodes stacked a grid apart. Each end leaves or enters a node square to one of its sides, with a short straight stub so arrowheads meet nodes head-on; no two arrows share an end, and ends stay clear of where hierarchy lines attach. An A* search picks the path with the least length and fewest bends, steering away from running along, or right beside, other lines and nodes, and from crossings. Shorter dependencies are routed first. Then better port arrangements are tried, each routed afresh and kept if it scores better (fewer crossings, then bends, then length): the lines sharing each side of a node put in the order that keeps them from crossing as they leave it — a line turning down toward a node lower on the canvas leaves below the lines that run on further — and, for two lines from the same node that still cross, their ports swapped, which can move one round a corner to another side. This repeats while it helps, within a small time budget, and the routes are reused until a node or line moves. Labels sit centered on a route's longest horizontal run, or beside a vertical one, wherever nothing is in the way.
* While nodes are dragged nothing is re-routed: a dependency between two moving nodes (within a dragged subtree, say) moves with them; one with only one end moving keeps its old route, faded; the rest stay as they are. On release the whole layout is routed again.

## CanvasView

`canvas.ts` draws the models and handles the input: drag the background to pan, the wheel to zoom, a node to move it with its subtree (Alt-drag alone). It has no toolbar of its own — commands are public methods (`toggleDependency`, `toggleReparent`, `detach`, `deleteSelection`, `resetView`, `zoomBy`, `reveal`, …) and `onState` reports what a toolbar or menu should enable. A host that covers part of the canvas gives `viewable` (insets from its edges): Reset View fits the whole diagram there, centered (never past 100%); `center`, `reveal` and `zoomBy` use its middle; and `relayout`, called when that area changes, pans to keep its middle steady.

A host can take over the model edits through `edits` (e.g. to keep dependencies in files) and hears about the rest through callbacks: `onNodeOpen` for a double-click (or Enter) on a node, `onLayoutChange`, `onViewChange` and `onBackgroundDoubleClick`. For drags from outside it offers `isOver`, `nodeAt`, `toWorld` and `setDropTarget`.

Colors come from the shared tokens in `src/theme.css`, light and dark.
