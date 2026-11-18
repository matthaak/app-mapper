# Desktop App

The Electron app (`electron/`) that runs App Mapper on macOS and Windows: one window showing the app's page, and the services a page can't have by itself. Compiled with `tsconfig.electron.json` into `dist-electron/`; packaged with electron-builder (the `build` section of `package.json`) into `release/`.{++ The folder also holds the standalone MD Editor's main process, preload and contract (`md-main.ts`, `md-preload.cts`, `md-api.d.ts`; see [MD Editor App](md-editor-app.md)).++}{>>Claude 2026-11-18 15:24: Added: the standalone MD Editor app<<}

## Parts

* `main.ts` — the main process. It loads the page: the Vite dev server's address under `npm run app`, else the built `dist/index.html`. It also provides:
  * **Menus** — the page describes the menu (`MenuSpec`, sent with `setMenu` whenever what it shows changes) and the main process builds it, after the app menu on macOS: File (projects, Set Up for AI Agents, New MD File…, Add MD File, Save, Save All, Close Window or Exit), Canvas, Edit, View (Use Editor Windows; Theme, Classic or Modern; then reload, developer tools, actual size, zoom and full screen) and Window. An item with `checked` is a check box, or with `radio` too, one of a group of choices. Choosing one of the page's items sends its command back; Electron's standard items (`role`, from an allow-list) work by themselves. Until the page has sent its menu, and while it reloads, only the standard menus show.
  * {++**Context menu** — right-clicking shows a native menu (Electron has none by itself): for a misspelled word, up to six spelling suggestions and Learn Spelling; Look Up for a selection on macOS; Open Link and Copy Link on a link; Cut, Copy, Paste, Paste and Match Style and Select All where text can be edited, or Copy for other selected text; and Inspect Element under `npm run app`. Where none of these apply, nothing shows.++}{>>Claude 2026-11-17 23:49: Added: a right-click menu, so misspellings can be corrected<<}
  * **Files** — scan, read and write, for absolute paths of Markdown and `.json` files only; `roots`, where browsing starts (`/`; on Windows every drive that answers, mapped ones too); and `list`, a folder's sub-folders and valid project files, for the page's own NeXT Open and New Project panels (there are no system file dialogs); and `mkdir`, one new folder, for New Project's Create Folder….
  * **Auto-recovery store** — one JSON record per project in the app's data folder (`recovery/`), written atomically, read when a project opens, and removed when everything is saved or discarded.
  * **Closing** — closing the window or quitting first asks the page, which may ask about unsaved changes. The window closes only once the page agrees (or if the page isn't running, or crashed).
  * **Native alerts** — `confirm` shows the page's question in a native alert (a sheet on the window, on macOS): Save All, Cancel or Don't Save when leaving a project with unsaved changes. First it brings the window forward (out of the Dock, the app activated); if the app can't come forward by itself (macOS won't let it take over from the app in front), its Dock icon bounces until it is clicked (elsewhere the taskbar button flashes).
  * **The window** — its size and position are remembered. On macOS it shows the dot for unsaved changes and the file it represents. It runs a single instance, links open in the system browser, and the window never navigates away from the app. It shows once the page has drawn, or after 5 seconds regardless, so a page that fails never leaves the app running unseen; a page that doesn't load or whose renderer stops is reported in an alert, and those failures (and any crashed helper process) are logged to `app-mapper.log` in the app's user-data folder (`%APPDATA%\App Mapper` on Windows, `~/Library/Application Support/App Mapper` on macOS).
* `preload.cts` — the sandboxed preload. It exposes those services to the page as `window.appMapper`.
* `api.d.ts` — the contract between them, also used by the page's `host.ts`.
* {++`context-menu.ts` — the right-click menu, shared with MD Editor's main process.++}{>>Claude 2026-11-18 15:24: Added: the right-click menu is shared with MD Editor<<}
* `scan.ts` — finds a project's Markdown files, and lists project files. It is shared with the dev server's file API.
* `map-format.ts` — the project file's format (`parseMap`), with no imports, so the main process, the dev server and the page all check project files the same way.

The page runs with context isolation and the sandbox on, and without Node: everything it does on disk goes through `window.appMapper`.

## Dependencies

- [Project Files](project-files.md) — what it reads and writes
