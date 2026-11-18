/*
 * MD Editor's preload (sandboxed, so CommonJS and only `electron` to require): exposes the
 * main process's document services to the page as `window.mdEditor` (see md-api.d.ts).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { MdEditorApi } from './md-api';

const api: MdEditorApi = {
  init: () => ipcRenderer.invoke('md-init'),
  save: (text, as) => ipcRenderer.invoke('md-save', text, as),
  setEdited: (edited) => ipcRenderer.send('md-edited', edited),
  setSpellcheck: (on) => ipcRenderer.send('md-spellcheck', on),
  confirm: (o) => ipcRenderer.invoke('md-confirm', o),
  onCommand: (f) => void ipcRenderer.on('md-command', (_e, cmd) => f(cmd)),
  onLoad: (f) => void ipcRenderer.on('md-load', (_e, doc) => f(doc)),
  onTheme: (f) => void ipcRenderer.on('md-theme', (_e, theme) => f(theme)),
  onSpellcheck: (f) => void ipcRenderer.on('md-spellcheck', (_e, on) => f(on)),
  onCloseRequest: (f) => {
    ipcRenderer.on('md-close-request', () => f());
    ipcRenderer.send('md-close-handler');
  },
  close: () => ipcRenderer.send('md-close-confirmed'),
  cancelClose: () => ipcRenderer.send('md-close-cancelled'),
};

contextBridge.exposeInMainWorld('mdEditor', api);
