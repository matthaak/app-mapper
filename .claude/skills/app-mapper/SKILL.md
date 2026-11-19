---
name: app-mapper
description: Work on this project's App Mapper specs — the Markdown files that describe the app, their Dependencies sections, and the app-map.json map — and run the review loop on tracked changes and comments in them. Use when writing or changing specs, linking modules, putting files on the map, or when the user says they have edited, marked up or commented on the specs and wants them checked, implemented or answered.
---

<!-- app-mapper-skill v6 — written by App Mapper. Don't edit: App Mapper replaces this file when it updates it. Put project-specific instructions in AGENTS.md or CLAUDE.md. -->

# App Mapper

This project is mapped with App Mapper. Its Markdown files are the specs of the application, one per module or concern; App Mapper shows them as nodes on a canvas, with arrows for their dependencies, and the user edits them there with tracked changes and comments. The specs and the code should always agree: a spec change is a change request, and code you change should be reflected in its spec.

* **The project root** is the folder holding `app-map.json`. Every `.md` file in it and below is a project file, except in hidden folders and `node_modules`, `dist`, `build`, `out`, `release`, `coverage`, `target`, `vendor` and `bower_components`.
* **`app-map.json`** is the map: which files are on the canvas, where, and their parents. Dependencies are never stored there.

## Before you edit

App Mapper keeps unsaved edits in memory, and saving writes them over whatever is on disk. Before changing a spec, make sure the user has saved in App Mapper (File ▸ Save All) — ask if you aren't sure. After you have changed files, tell the user: App Mapper picks up changed Markdown files when its window comes forward, but re-reads `app-map.json` only on File ▸ Refresh All.

## Writing a spec

* The node's label is the file's **first `#` heading** (any level, as plain text). Give every spec one.
* Say what the module is for, what it owns, the source files or folders it covers (in backticks), and its public interface. Prefer short sections and lists; keep it plain Markdown, so it reads the same anywhere.
* One spec per module or concern; split a spec that covers several. A folder's overview goes in its `README.md`.
* App Mapper's editor supports headings, paragraphs, lists, emphasis, code, links, block quotes, fenced code and GitHub tables. A list item can continue on an indented line below it.

## Dependencies

A spec lists what it depends on under a heading named **Dependencies** (or **Depends on**), any level, any case. Each list item whose first link points to another `.md` file is one dependency; the text after the link, past a dash or colon, is the arrow's label:

```markdown
## Dependencies

- [Canvas](canvas.md) — draws the map
- [Storage](../storage/README.md): reads and writes files
```

* Links are relative to the file; a leading `/` means the project root. Links outside the project, with a scheme (`https:`) or to other kinds of file are ignored, as are items without a link, so the section can hold notes too.
* The section runs to the next heading of the same or a higher level; only the first such section counts. A file can't depend on itself; a second item for the same target is ignored.
* Use the target's title as the link text, and a label of a few words. Add the section at the end of the file if there is none.
* Dependencies follow the code: when a module starts or stops using another, update its list.

## The map: app-map.json

```json
{
  "version": 1,
  "nodes": [
    {"file":"README.md","x":0,"y":0,"parent":null},
    {"file":"src/api/README.md","x":-224,"y":112,"parent":"README.md"}
  ]
}
```

* One entry per node: `file` (relative to the root, `/`-separated, listed once), `x` and `y` (numbers, multiples of 16), and `parent` (another node's file, or `null`).
* Keep entries sorted by `file`, one per line, exactly as above, so the file diffs well.
* When you create a spec, add its node: under the spec it belongs to, placed near its parent and its siblings without overlapping them (a node is 192 wide and 64 high; copy the spacing already used). If you're unsure where it goes, leave it off and tell the user — they can add it with File ▸ Add MD File.
* Never remove nodes unless asked. Removing a node never deletes its file, and deleting a file is never done through the map.

## Tracked changes and comments

App Mapper's editor writes its review markup into the Markdown itself, as [CriticMarkup](https://criticmarkup.com), so you read and write it as text:

| Markup | Meaning |
| --- | --- |
| `{++text++}` | An addition |
| `{--text--}` | A deletion |
| `{==text==}` | A highlight: a comment or question on that text |
| `{>>note<<}` | A note: right after a mark, it belongs to that mark; anywhere else, it is a comment anchored at that point |

Each note is its own block, right after the mark's closing delimiter (no space between), and the notes in a row make a thread. A note is an author, a space and a date — `YYYY-MM-DD`, optionally with a time, `HH:MM` or `HH:MM:SS`, and that optionally with a zone, `Z`, `UTC` or `±HH:MM` (without one it is local time) — then optionally `: ` and a comment:

```
{++and as SVG++}{>>Matt 2026-11-18 13:55: Users can export a map as SVG<<}{>>Opus 2026-11-18 14:02: Done: src/export/svg.ts<<}
```

The first note belongs to whoever made the mark; the rest are replies. A mark may also have no notes at all (`{++text++}`): it is unsigned. A note that isn't written as author and date is still read, as a comment by nobody in particular — `{>><<}`, an empty one, is how an unsigned mark's thread starts when someone replies to it.

A thread's **verdict** is its latest note whose comment is `Accepted` or `Rejected` (any case, a final `.` or `!` allowed), or starts with `Accepted.` or `Rejected.` and goes on with a comment: `Rejected. Contradicts mapper.md`. Notes after a verdict are comments on it and don't change it; a later verdict replaces it. An addition or deletion can be accepted or rejected; a highlight or an anchored comment can only be accepted (a `Rejected` there is just a comment). A mark is **completed** when it has a verdict — a change accepted or rejected, a comment accepted — and **pending** until then.

Completed marks keep their markup and history; the editor shows their outcome as if settled — an accepted addition or rejected deletion as plain text, an accepted deletion or rejected addition not at all, an accepted highlight or comment as plain text with no highlight — and by default hides their threads from the review column. **Purging** a completed mark takes its markup and history out for good, as its outcome says.

Write marks exactly this way:

* The author is letters, digits and underscores only (`\w+`). Sign as your own model's one-word name — `Opus`, `Sonnet`, `Fable` or whichever you are — not the name of the app or harness running you (not `Claude`, `ClaudeCode` or `Codex`), so the user can tell which model wrote what. Use the same name every time.
* Write the date and time to the minute, in local time: `date '+%Y-%m-%d %H:%M'`.
* A note is one line, with no `<<}` in it. Write a line break in a comment as `<br>`.
* **Sign every mark you write**: give each one its own note, with your name and the date and time, right after its closing delimiter. A mark without one shows as unsigned.
* To add a note to an unsigned mark (one with no notes), put an empty note before yours — `{++text++}{>><<}{>>Opus <date time>: …<<}` — or your note would be read as the mark's author's.
* **One mark per change, however long.** A mark opens and closes anywhere: it can run over line breaks, paragraphs, lists, tables, code blocks and whole sections. Put one mark around the whole change, never a mark per line or per paragraph. For whole blocks, the clearest form puts the opening delimiter alone on the line before them and the closing delimiter, with its notes and nothing else, at the start of the line after them:

  ```
  {++
  ### GET /users

  - **Description.** Looks up one participant.
  - **Errors.** 400 when the input is malformed.
  ++}{>>Opus 2026-11-18 17:05: Added the route, as requested<<}
  ```

  A mark can as well open and close mid-paragraph, taking paragraph breaks with it:

  ```
  The page caches each result.{++ Entries expire after a day.

  A new paragraph about how expiry works.++}{>>Opus 2026-11-18 17:05: Added: expiry<<}
  ```

  Keep a blank line between a mark's own delimiter lines and the blocks around them.
* When you change only part of a line, keep its markers (`#`, `-`, `1.`, `>`) outside the mark: `- {++A new item++}{>>Opus <date time>: …<<}`.
* To rewrite a passage, delete the old text and add the new beside it: `{--old wording--}{>>Opus <date time>: Reworded: …<<}{++new wording++}{>>Opus <date time>: Reworded: …<<}`.
* Don't put marks inside your own marks. A mark ends at the first closing delimiter of its kind (`++}`, `--}` or `==}`), so its text can't hold that delimiter — except in code.

**In code** (code spans and code blocks) markup is otherwise literal, so a mark there counts only if it is followed by notes with an author and date, and it ends at the first closing delimiter those notes follow: `{++i++}{>>Matt 2026-11-18 13:55<<}` adds `i++`. Anything else in code, such as `{++i;}`, is just code. A mark opened in a code block can run over its lines — end it at the end of the last line it takes in, not on a line of its own. In a code span, a mark stays inside the span and its text can't hold a backtick (its notes can).

Titles and dependencies are read as if every change were accepted: deleted text left out, added text kept, notes dropped. Read code under review the same way: added code in, deleted code out.

## The review loop

When the user says they have changed, marked up or commented on the specs:

1. **Find the work.** Search the project's Markdown files for marks and comments that are pending, or completed with comments after their verdict, and whose last note is not yours (`grep -rnE '\{(\+\+|--|==|>>)' --include='*.md' .`). Also check `git diff -- '*.md'` (if the project uses git) for edits made with Track Changes off. A comment on an earlier review of yours counts too.
2. **Read each one as a request:**
   * an addition is a new or changed requirement — implement it;
   * a deletion removes a requirement — take that behavior out;
   * a highlight or an anchored comment is a question or instruction about that text — answer or do it; it isn't a spec change by itself;
   * a reply on one of your changes is feedback on it.
3. **Act, then reply in the thread.** Add one note after the mark's last note saying what you did and where — `{>>Opus <date time>: Done: src/x.ts<<}` — or why you didn't. Keep the mark itself, and never delete others' marks or comments. **Don't give verdicts on other authors' changes or comments** except as [Verdicts](#verdicts) allows: implementing a request, or answering a question, isn't accepting it. The user accepts once they have checked your work; that is their sign-off. To raise something about a completed mark, anchor a new comment or highlight beside it rather than replying in its thread: completed threads are hidden from the user's review column by default.
4. **Clarify in the spec, as tracked changes.** When implementing shows that a spec is incomplete or wrong, change it as your own tracked change with a reason — `{++ (per project)++}{>>Opus <date time>: Clarified: the limit is per project<<}`, `{--…--}{>>Opus <date time>: No longer true: the cache was removed<<}` — so the user sees it in the review column and can accept or reject it.
5. **Ask rather than guess.** If a request is ambiguous or conflicts with another spec or the code, don't implement a guess: reply with the question, or highlight the text with your question (`{==text==}{>>Opus <date time>: Should this also apply to drafts?<<}`), or anchor it as a comment where it applies (`{>>Opus <date time>: Should this also apply to drafts?<<}`), and leave it open.
6. **Report.** Tell the user, briefly, which requests you implemented, which specs you clarified, and which questions are waiting for them.

Leave completed marks and their threads alone. Purge them only when the user asks: then an accepted addition or rejected deletion becomes its plain text, an accepted deletion or rejected addition goes entirely, an accepted highlight becomes its plain text, and an accepted anchored comment goes — each with its notes. A delimiter on a line of its own goes with its line. Pending marks stay as they are.

## Verdicts

Accept or reject another author's change, or accept another author's comment, only when:

1. **The user asks you to**, for particular marks ("accept Matt's changes in mapper.md", "close the comments you've answered").
2. **The user asks you to review changes and decide.** Accept those that are sensible and consistent with the other specs and the code; reject those that are untenable or a bad idea, saying why.
3. **What the user asked for can't be done otherwise**: they asked you to finalize the specs, publish them or make a clean copy, or an edit they asked for can't be made while the mark is still pending.

Never on your own initiative. Don't complete a mark whose thread holds a question or a request that hasn't been answered or carried out: ask instead.

To give a verdict, add a note after the thread's last note, signed with your own name (never the user's): `Accepted` or `Rejected`, followed — after a `.` and a space — by your reason, if you give one (always, when you reject):

```
{++a 30-day limit++}{>>Matt 2026-11-18 13:55<<}{>>Opus 2026-11-18 14:10: Rejected. Contradicts the 7-day limit in mapper.md<<}
{==weekly digest==}{>>Matt 2026-11-18 13:56: Is this still planned?<<}{>>Opus 2026-11-18 14:02: Yes, see digest.md<<}{>>Matt 2026-11-18 14:20: Accepted<<}
```

On an unsigned mark, put the empty note `{>><<}` before your verdict (see above).

Always record the verdict and keep the mark and its thread, so the user can review your decision and reverse it. Don't settle a mark by editing the text to its outcome, unless the user asked for a clean copy: then give the verdicts and purge, as above. To change a verdict, add the other one after it; don't change one you didn't give unless the user asks. In your report, list every verdict you gave and why.

## Writing specs yourself

* When you create a new spec, write it plainly, without tracked changes, and add its node to the map.
* When you change an existing spec that the user has reviewed — anything beyond keeping a file list or dependency list in step with the code — write the change as your tracked addition or deletion, with a one-line reason as its comment.
* Keep the rest of a file exactly as it was: change only what you mean to.
