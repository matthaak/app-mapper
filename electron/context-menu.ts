/*
 * The right-click menu, shared by App Mapper's and MD Editor's main processes.
 */
import { Menu, clipboard, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';

const IS_MAC = process.platform === 'darwin';

/**
 * The right-click menu (Electron shows none by itself): spelling suggestions, Learn Spelling and
 * Look Up for a misspelled word; Cut, Copy, Paste, Paste and Match Style and Select All where
 * text can be edited; Copy (and Look Up, on macOS) for selected text; Open Link and Copy Link
 * on a link; and Inspect Element in development (`dev`). Nothing shows where none of these apply.
 */
export function showContextMenu(w: BrowserWindow, p: ContextMenuParams, dev = false): void {
  const wc = w.webContents;
  const f = p.editFlags;
  const groups: MenuItemConstructorOptions[][] = [];
  const selected = p.selectionText.trim();
  const lookUp = (): MenuItemConstructorOptions[] =>
    IS_MAC && selected && selected.length <= 60 ? [{ label: `Look Up “${selected}”`, click: () => wc.showDefinitionForSelection() }] : [];

  if (p.isEditable && p.misspelledWord) {
    const guesses = p.dictionarySuggestions.slice(0, 6);
    groups.push(
      guesses.length
        ? guesses.map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) }))
        : [{ label: 'No Guesses Found', enabled: false }],
      [{ label: 'Learn Spelling', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, ...lookUp()],
    );
  } else if (selected) {
    const items = lookUp();
    if (items.length) groups.push(items);
  }

  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    groups.push([
      { label: 'Open Link', click: () => void shell.openExternal(p.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) },
    ]);
  }

  if (p.isEditable) {
    groups.push(
      [
        { role: 'cut', enabled: f.canCut },
        { role: 'copy', enabled: f.canCopy },
        { role: 'paste', enabled: f.canPaste },
        { role: 'pasteAndMatchStyle', enabled: f.canPaste },
      ],
      [{ role: 'selectAll', enabled: f.canSelectAll }],
    );
  } else if (selected) {
    groups.push([{ role: 'copy', enabled: f.canCopy }]);
  }

  if (dev) groups.push([{ label: 'Inspect Element', click: () => wc.inspectElement(p.x, p.y) }]);

  const template = groups.filter((g) => g.length).flatMap((g, i) => (i ? [{ type: 'separator' as const }, ...g] : g));
  if (template.length) Menu.buildFromTemplate(template).popup({ window: w });
}
