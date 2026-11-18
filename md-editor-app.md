# MD Editor App

A standalone desktop app, **MD Editor**, for editing Markdown files directly: the same editor App Mapper uses, with tracked changes and comments, but no projects, canvas or map. It is built from this repository alongside App Mapper and shares its code, so the editor improves in both at once.

## How it works

* **One window per document**, filled by the editor. The window's title is the file's name ("Untitled", "Untitled 2", … until first saved); on macOS it shows the file it represents and the dot for unsaved changes, elsewhere a bullet (•) before the name.
* **All native around the editor.** File: New (⌘N), Open… (⌘O, Markdown files, several at once), Open Recent (the last ten, and Clear Menu), Close (⌘W), Save (⌘S) and Save As… (⇧⌘S), in the system's open and save dialogs. Edit: the standard items. View: Theme (Classic or Modern; Modern until another is chosen), then Electron's own reload, developer tools, actual size, zoom and full screen. Window: the standard items. The editor's own Save button does what File ▸ Save does.
* **Opening a file** that is already open brings its window forward; otherwise it opens in a new window — or in the window in front, if that is an untouched Untitled one. Files open from the Finder or Explorer (it registers as an editor for `.md` and `.markdown`), from the command line, and from a second launch, which hands them to the app already running.
* **Closing a window with unsaved changes** asks, in a native alert on the window: Save, Cancel or Don't Save. Quitting asks for each such window in turn. On macOS the app stays open with no windows, as document apps do; New or Open starts again, and so does clicking its Dock icon.
* **Editing**: a file that already has tracked changes or comments opens with Track Changes on. Changes and comments are attributed to the computer's user name.
* **Remembered** in `settings.json` in the app's user-data folder (`~/Library/Application Support/MD Editor` on macOS, `%APPDATA%\MD Editor` on Windows): the theme, Show Spelling Errors (changed in one window, it changes in all), the recent files and the window size.

## Files

* `electron/md-main.ts` — the main process: windows and documents, the menus and dialogs, reading and writing files, settings.
* `electron/md-preload.cts` — exposes the main process's services to the page as `window.mdEditor`.
* `electron/md-api.d.ts` — the contract between them.
* `md-app.html` and `src/md-app.ts` — the page: one `MarkdownEditor`, saving through the main process and asking before a window with unsaved changes closes. In a plain browser (`/md-app.html` under `npm run dev`) it edits an empty document that can't be saved.
* `electron/context-menu.ts` — the right-click menu, shared with App Mapper.
* `electron-builder.md-editor.json` — how it is packaged (`release/md-editor/`).

## Running

* `npm run md` — runs it from the source, with live reload.
* `npm run start:md` — builds, then runs the built app.
* `npm run dist:md:mac` / `npm run dist:md:win` (or `npm run dist:md` for this platform) — packages it into `release/md-editor/`, as App Mapper's `dist` scripts do.

## Dependencies

- [MD Editor](md-editor.md) — the editor itself
- [Widgets](widgets.md) — the themes
- [Desktop App](desktop-app.md) — shares the right-click menu
