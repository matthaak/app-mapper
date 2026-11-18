# Markdown Conventions

What App Mapper reads from a Markdown file, and how it writes dependencies back (`src/modules/mapper/docs.ts`). Everything here is plain Markdown, so the files read the same on GitHub or in any editor.

## Title

A node's label is the text of the file's first `#` heading, at any level, as plain text: emphasis, code and links are reduced to their text. Front matter and fenced code are skipped. A file without a heading is labelled with its file name.

## Dependencies section

* A heading named **Dependencies** or **Depends on** (any level, any case) starts the section. It runs to the next heading of the same or a higher level; only the first such section counts.
* Each list item (`-`, `*`, `+` or numbered) whose first link points to a `.md` or `.markdown` file is one dependency of this file on that one.
* The label is the text after the link, without a leading dash, en or em dash, or colon. With nothing after the link, the text before it is used.
* Links are relative to the file's folder. A leading `/` means the project root. Links outside the project, to other kinds of file, or with a scheme (`https:`) are ignored, as are items without a link.
* A file can't depend on itself, and a second item for the same target is ignored.

## Tracked changes

The [MD Editor](md-editor.md) writes {--additions as `++…++`, deletions as `~~…~~` and highlights as `^^…^^`, each possibly opening with an `@@…@@` thread of attributions--}{>>Claude 2026-11-18 13:56: Changed: review marks are CriticMarkup<<}{++review marks in CriticMarkup: additions as `{++…++}`, deletions as `{--…--}` and highlights as `{==…==}`, each possibly followed by notes (`{>>…<<}`), and notes on their own as comments++}{>>Claude 2026-11-18 13:56<<}. Titles and dependencies are read as if every change were accepted: deleted text is left out, added text kept, and {--threads--}{>>Claude 2026-11-18 13:56<<}{++notes++}{>>Claude 2026-11-18 13:56<<} dropped.

## Writing

The canvas edits a file's Dependencies section as text:

* **Adding** appends an item after the section's last item, in the same list style — or, with no section yet, adds `## Dependencies` at the end of the file. The link text is the target's title and the link is relative.
* **Removing** deletes the items that link to the target.
* **Relabelling** rewrites the text after the item's link as ` — label`.

Everything else in the file is left exactly as it was.
