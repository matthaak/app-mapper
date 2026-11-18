/*
 * MD Editor's page (md-app.html): one document in the MD Editor module, filling the window.
 * The main process (electron/md-main.ts) owns the file — the native menus and dialogs, reading
 * and writing — and this page asks it through `window.mdEditor` (electron/md-api.d.ts).
 *
 * Opened in a plain browser (`npm run dev`, /md-app.html) it edits an empty document that
 * can't be saved, which is enough to try the page.
 */
import './theme.css';
import type { MdDoc, MdEditorApi, MdInit } from '../electron/md-api';
import { MarkdownEditor, hasRevisions } from './modules/md-editor';
import { setNxTheme } from './modules/widgets';

/** In a plain browser: an untitled document, nowhere to save it. */
function browserApi(): MdEditorApi {
  const none = () => {};
  return {
    init: async () => ({ path: null, name: 'Untitled', text: '', user: 'Me', theme: 'modern', spellcheck: true }),
    save: async () => null,
    setEdited: none,
    setSpellcheck: none,
    confirm: async (o) => (window.confirm(o.message) ? o.defaultId : o.cancelId),
    onCommand: none,
    onLoad: none,
    onTheme: none,
    onSpellcheck: none,
    onCloseRequest: none,
    close: none,
    cancelClose: none,
  };
}

const api = (window as unknown as { mdEditor?: MdEditorApi }).mdEditor ?? browserApi();

async function start(): Promise<void> {
  const init: MdInit = await api.init();
  setNxTheme(init.theme);
  let doc: MdDoc = init;
  /** The text as last saved (or opened). */
  let saved = init.text;

  const editor = new MarkdownEditor({
    value: init.text,
    user: init.user,
    // Under review already: typing goes on being tracked.
    trackChanges: hasRevisions(init.text),
    spellcheck: init.spellcheck,
    onSpellcheckChange: (on) => api.setSpellcheck(on),
    onChange: () => showEdited(),
    onSave: () => void save(false),
  }).mount(document.getElementById('app')!);

  const edited = () => editor.value !== saved;
  const showEdited = () => {
    editor.modified = edited();
    api.setEdited(editor.modified);
  };

  /** Saves (as a new file, for Save As or an untitled document); false if cancelled or it failed. */
  const save = async (as: boolean): Promise<boolean> => {
    editor.flush();
    const text = editor.value;
    const r = await api.save(text, as);
    if (!r) return false;
    doc = r;
    saved = text;
    showEdited();
    return true;
  };

  api.onCommand((cmd) => void save(cmd === 'save-as'));
  api.onLoad((d) => {
    doc = d;
    saved = d.text;
    editor.value = d.text;
    editor.trackChanges = hasRevisions(d.text);
    showEdited();
  });
  api.onTheme((t) => setNxTheme(t));
  api.onSpellcheck((on) => (editor.spellcheck = on));
  api.onCloseRequest(async () => {
    editor.flush();
    if (!edited()) return api.close();
    const choice = await api.confirm({
      message: `Do you want to save the changes you made to “${doc.name}”?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Cancel', 'Don’t Save'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 2 || (choice === 0 && (await save(false)))) api.close();
    else api.cancelClose();
  });
  editor.focus();
  if (import.meta.env.DEV) Object.assign(window, { editor });
}

void start();
