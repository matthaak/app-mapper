# Modules

Each folder here is one major part of App Mapper.

| Module | What it owns |
| --- | --- |
| `mapper/` | The App Mapper application: a project's Markdown files as nodes on the canvas, MD Editor windows, the Files panel and the app menu, project file access. See `/mapper.md`. |
| `canvas/` | The diagram surface: models, layout/routing, the interactive SVG view (`CanvasView`). Demo at `/canvas.html`. |
| `widgets/` | The app's own UI kit: NeXTSTEP-style `Nx*` widgets (windows, menus, browser, tabs, popovers, dock tiles, …) in `widgets/next/`. Gallery at `/widgets.html`. |
| `md-editor/` | The Markdown editor: Visual/Raw views kept in sync, tracked changes with attributions and comments, markdown parser and serializer. Demo at `/md-editor.html`.{++ All of the standalone MD Editor app's page (`src/md-app.ts`).++}{>>Claude 2026-11-18 15:24: Added: the standalone MD Editor app<<} |

## Rules

* **`index.ts` is the public API.** Code outside a module imports only from
  `modules/<name>` (its `index.ts`), never from a file inside the folder.
* **A module brings its own CSS.** Its `index.ts` imports its stylesheet, so
  importing the module is enough.
* **Shared design tokens live in `src/theme.css`**, not in any one module.
* **Dependencies point one way.** `mapper` may use `canvas`, `md-editor` and `widgets`;
  `canvas` and `md-editor` may use `widgets`; `widgets` must not import from any feature module.
* `src/main.ts` starts the app (`MapperApp`); the `mapper` module wires the others together.{++ `src/md-app.ts` starts the standalone MD Editor, with only `md-editor` and `widgets`.++}{>>Claude 2026-11-18 15:24<<}
* Each module is documented in a Markdown file at the project root, mapped in the project file `app-map.json`.