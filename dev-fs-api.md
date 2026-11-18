# Dev Server File API

A small Vite plugin (`server/fs-api.ts`, registered in `vite.config.ts`) that lets App Mapper browse folders and read and write a project's files when it runs in a browser under `npm run dev` — what the [Desktop App](desktop-app.md)'s main process does for the app itself. It exists only in the dev server.

## Endpoints

All under `/__fs`:

* `GET /info` — the home and working folders (the Open Project panel starts in the last project, or the working folder — the home folder in the desktop app), the OS user name (the editors' default author) and the platform.
* `GET /list?path=` — a folder's sub-folders and the valid project files in it (`.json` files that pass `parseMap`), hidden ones left out (for the Open and New Project panels).
* `POST /mkdir?path=` — creates one folder; its parent must exist and it must not (New Project's Create Folder…).
* `GET /scan?root=` — every Markdown file and folder under a project root, relative and `/`-separated, skipping hidden and build folders (at most 16 levels and 20,000 entries).
* `GET /read?path=` — a file's text, or 404.
* `PUT /write?path=` — writes the request body to a file whose folder exists.

## Safety

* Every request must carry the header `X-App-Mapper: 1`. A page on another site can't send a custom header without a CORS preflight, which this API never answers, so only App Mapper itself can call it.
* Only Markdown (`*.md`, `*.markdown`) and `.json` files can be read or written. Folder listings show names only.
* Paths must be absolute. Vite's dev server listens on localhost unless told otherwise; don't expose it (`--host`) while this API is in use.
