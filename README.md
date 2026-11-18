# App Mapper

App Mapper maps an application's architecture from its Markdown files. Open a project file, put the `.md` files in its folder onto a canvas as nodes, arrange them into a hierarchy, and open any node to edit its file. Each node shows the file's first heading, with the file name below it; arrows between nodes come from the **Dependencies** section each file keeps about itself.

This project documents itself this way: open its `app-map.json` in App Mapper to see the map of its own modules.

## Running

App Mapper is an Electron app for macOS and Windows.

* `npm install` once.
* `npm run app` — runs the app from the source, with live reload (the Vite dev server inside the app window).
* `npm start` — builds, then runs the built app.
* `npm run dist:mac` / `npm run dist:win` — packages it into `release/`: a `.dmg` and `.zip` for the Mac (built for this Mac's processor), an installer (`App Mapper Setup ….exe`) and `.zip` for 64-bit Windows. `npm run dist` packages for the platform you're on. The Windows build can be made on a Mac; the Mac build needs a Mac.
* {++`npm run md`, `npm run start:md` and `npm run dist:md:mac` / `dist:md:win` / `dist:md` — the same for the standalone [MD Editor App](md-editor-app.md), App Mapper's editor on its own for editing Markdown files directly (packaged into `release/md-editor/`).++}{>>Claude 2026-11-18 15:24: Added: the standalone MD Editor app<<}
* `npm run dev` — runs the app in a browser instead, through the dev server's file API; ⌘S / ⌘⌥S stand in for the menu. Handy for development; the desktop app is the real thing.

Dev-only pages: `/canvas.html` (the bare canvas), `/widgets.html` (the widget gallery), `/md-editor.html` (the editor demo).

## Using it

* A project is a **project file** — a `.json` file such as `app-map.json` holding the layout. The folder it is in is the project root: its Markdown files, and those in folders below, are the project's files. **File ▸ Open Project…** opens one in a NeXT Open panel that lists only valid project files; **File ▸ New Project…** creates an empty one wherever you choose, in the same kind of panel, which can also create a folder (Create Folder…) and the folder's README.md (put on the map), unless it has one, and set the project up for AI agents (on unless you turn it off; see below). Both panels can be resized. On Windows they start from **This PC**, listing every drive, mapped network drives included.
* When the app starts, it reopens the project that was open when it was last quit.
* **File ▸ Add MD File** lists every Markdown file in the project as *Title — folder/path/file.md*; choose one to put it on the canvas. Files already there are listed greyed out.
* **File ▸ New MD File…** (⌘N) creates a file (in the project root unless you pick another folder) together with its node. Until you type a title or name, it suggests `README.md`, titled with the folder's name, for a folder that has no README.md yet. **New Child…** (or Tab) does the same under the selected node, and double-clicking empty canvas creates one there.
* Double-click a node (or select it and press Enter) to open its file in a tab of the panel at the right of the canvas. Drag the bar at the panel's left edge to resize it (as you do, and as you resize the window, the canvas pans to keep its middle in the middle), or click it to close the panel; then only a **Files** tab shows at the right edge — drag it up or down to move it, click it to open the panel again. **View ▸ Use Editor Windows** opens files in movable windows instead, and **View ▸ Theme** switches between **Classic** (the NeXT look) and **Modern** (flat, light and rounded){++ — Modern unless you choose Classic++}{>>Claude 2026-11-18 15:35: Changed: Modern is the default theme<<}. A single click on a node just selects it. The **Canvas** menu holds the canvas commands (New Child…, Set Parent, Detach, Dependency, Remove, Reset View, Zoom In and Out). The node's label and arrows follow your edits as you type. A file that already has tracked changes or comments in it opens with **Track Changes** on, so your edits are kept as additions and deletions to accept or reject; other files open with it off. Turn it on or off per file with the pencil button. Accepting or rejecting a change that has comments keeps its history — your “Accepted” or “Rejected” is added to its thread and the text shows the outcome; one without comments is simply applied. Who made each change or highlight, when and why shows in grey boxes in a review column at the right of the editor, each tied to its text by a dotted line; click a box to comment or reply. **Accept All Changes** (the double check mark) accepts every change not decided yet. **Review Mode** (at the right of the Visual / Raw tabs), turned off, shows the text as if every change were accepted, with no colours, highlights or review column, and turns Track Changes off; it's on to begin with for a file that has any changes or highlights, remembered per file once you set it, and comes back on whenever you highlight or use Track Changes. Your changes and comments are attributed to your computer user name.
* The **Canvas** menu holds the canvas commands: New Child…, Set Parent, Detach, Dependency, Remove, Reset View (fits the whole diagram left of the panel's bar, which stays put even with the panel closed or with editor windows) and zoom (a ✓ marks Set Parent or Dependency while that mode is on). **Remove** takes a node off the canvas; it never deletes the file.
* The layout — which files are on the canvas, where, and their parents — is kept in the project file. Dependencies are never stored there: they live in the files.
* **Nothing is saved until you save.** **File ▸ Save** (⌘S) saves the file in the front editor window (or the front tab, while you are typing in it) — or else the project file; each editor also has a Save button (the disk) at the left of its toolbar. **File ▸ Save All** (⌥⌘S) saves the project file and every changed Markdown file. With the panel open the window title names its front file — “Title — file.md” — and otherwise the project file. A bullet (•) marks unsaved changes: in the window title for the file it names, and on a node and its editor's title for a Markdown file. **File ▸ Refresh All** reads the project file and every Markdown file from disk again, keeping the same files open — after warning that it will revert any unsaved changes. Opening another project or quitting with unsaved changes asks whether to save them — in the desktop app, in a native alert; if App Mapper is in the background then, its Dock icon bounces until you come to it.
* **Auto-recovery**: unsaved changes are kept aside as you work (in the app's own data folder) and dropped once saved or discarded. If App Mapper doesn't close cleanly — a crash, a forced quit, a reload — opening that project again offers to recover them.
* The **View** menu has the usual commands: reload, full screen, developer tools, and zoom (actual size, zoom in, zoom out) for the whole window.
* Windows and panels open where you last left them, at the size you left them, on this computer.

## AI agents

A project can be set up for AI coding agents, so they write specs, link them and keep the map the way App Mapper reads them, and answer your tracked changes and comments. **Set up for AI agents** in the New Project panel, or **File ▸ Set Up for AI Agents** for an open project, writes:

* `.claude/skills/app-mapper/SKILL.md` — App Mapper's skill (Claude Code finds it there): the file conventions, the project file, the review markup, and the review loop. It is App Mapper's file, replaced when updated; opening a project whose skill is from an older App Mapper offers to update it (once per version).
* A short block in `AGENTS.md` (created if there is none), between `<!-- app-mapper -->` markers, pointing other agents to the skill. The rest of the file is left as it was.

The review loop: edit the specs with Track Changes on, add comments or highlights with questions, save, and ask the agent to check them. It implements each change and replies in its thread (“Done: …”), writes its own clarifications to the specs as tracked changes, and asks in a comment or highlight when it is unsure. It never accepts or rejects your changes — accepting them is your sign-off.

## Documenting dependencies

A file lists what it depends on under a heading named **Dependencies** (or **Depends on**), at any level. Each list item that links to another Markdown file is one dependency; text after the link, past a dash or a colon, is its label:

    ## Dependencies

    - [Canvas](canvas.md) — draws the map
    - [Widgets](widgets.md): windows and controls

* Links are relative to the file; a leading `/` means the project root.
* The section runs to the next heading of the same or a higher level. Items without a link to a `.md` file are ignored, so the section can hold other notes too.
* An arrow is drawn when both files are on the canvas.
* Drawing a dependency on the canvas adds such an item to the source file (adding the section if it has none); removing the arrow removes the item; editing its label rewrites the text after the link.

The full rules are in [Markdown Conventions](markdown-conventions.md).

## Project layout

* `electron/` — the desktop app's main process and preload (see [Desktop App](desktop-app.md)), compiled to `dist-electron/`.
* `src/main.ts` — starts the app (the page in the app window).{++ `src/md-app.ts` (with `md-app.html`) is the standalone MD Editor's page.++}{>>Claude 2026-11-18 15:24<<}
* `src/theme.css` — design tokens shared by every module (light and dark).
* `src/modules/` — one folder per module, each with an `index.ts` as its only public entry point (see `src/modules/README.md`).
* `server/fs-api.ts` — the dev server's file API, registered in `vite.config.ts` (for `npm run dev`).
* `scripts/dev-app.mjs` — `npm run app`: the dev server with the app window showing it.
* `*.md` in this folder — the module docs on the map, with the project file `app-map.json` holding their layout.

## Dependencies

- [Mapper](mapper.md) — the application
- [Desktop App](desktop-app.md) — runs it
- [MD Editor App](md-editor-app.md) — the editor on its own
