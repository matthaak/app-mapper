# Project Files

How App Mapper reads and writes a project (`src/modules/mapper/host.ts` and `project.ts`).

## Hosts

All file access goes through a `Host` (absolute paths, in the platform's own form):

* **Electron** — the [Desktop App](desktop-app.md)'s main process, through the preload's `window.appMapper`.
* **Dev** — a browser under `npm run dev`, through the [Dev Server File API](dev-fs-api.md). Auto-recovery data is kept in the page's localStorage.

Both can scan a folder for Markdown files and folders, and read and write Markdown and `.json` files. Scans skip hidden folders and `node_modules`, `dist`, `build`, `out`, `release`, `coverage`, `target`, `vendor` and `bower_components` (`electron/scan.ts`, shared by both).

## Project

A project is its project file and the folder that holds it (the root). `Project` holds every Markdown file's text in memory, along with what [Markdown Conventions](markdown-conventions.md) reads from it — title and dependencies — updated on every edit. It remembers each file's text as last read or written, so it knows which files have unsaved changes; rescans leave those alone. It lists files root-first, then by path; creates files (never over an existing one, and written at once); and writes the project file.

## The project file

Any `.json` name will do; `app-map.json` is the usual one. It holds the layout: one entry per node with its file (relative to the root), position (world units, on a 16-unit grid) and parent file. Nodes are sorted by file and written one per line, so the file diffs well under version control.

    {
      "version": 1,
      "nodes": [
        {"file":"README.md","x":0,"y":0,"parent":null}
      ]
    }

Only valid project files are listed in the Open Project panel, and opening one checks it again (`parseMap`, in `electron/map-format.ts`): it must be JSON with `"version": 1` and a `nodes` list whose entries each have a `file` inside the project folder (listed once), numbers `x` and `y`, and a `parent` that is a file or null. Other `.json` files are not listed; one typed in by path is refused, saying what is wrong. Files over 4 MB aren't read to check.

## Dependencies

- [Dev Server File API](dev-fs-api.md) — npm run dev
- [Markdown Conventions](markdown-conventions.md) — parses docs
