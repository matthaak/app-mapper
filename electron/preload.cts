/*
 * Preload (sandboxed, so CommonJS and only `electron` to require): exposes the main process's
 * file, recovery and window services to the page as `window.appMapper` (see api.d.ts).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronApi } from './api';

const api: ElectronApi = {
  info: () => ipcRenderer.invoke('info'),
  roots: () => ipcRenderer.invoke('roots'),
  list: (dir) => ipcRenderer.invoke('list', dir),
  mkdir: (path) => ipcRenderer.invoke('mkdir', path),
  scan: (root) => ipcRenderer.invoke('scan', root),
  read: (path) => ipcRenderer.invoke('read', path),
  write: (path, text) => ipcRenderer.invoke('write', path, text),
  recoveryGet: (project) => ipcRenderer.invoke('recovery-get', project),
  recoveryPut: (project, r) => ipcRenderer.invoke('recovery-put', project, r),
  recoveryPutSync: (project, r) => void ipcRenderer.sendSync('recovery-put-sync', project, r),
  recoveryClear: (project) => ipcRenderer.invoke('recovery-clear', project),
  setEdited: (edited, file) => ipcRenderer.send('set-edited', edited, file),
  confirm: (o) => ipcRenderer.invoke('confirm', o),
  setMenu: (menu) => ipcRenderer.send('set-menu', menu),
  onMenu: (f) => void ipcRenderer.on('menu', (_e, cmd) => f(cmd)),
  onCloseRequest: (f) => {
    ipcRenderer.on('close-request', () => f());
    ipcRenderer.send('close-handler');
  },
  close: () => ipcRenderer.send('close-confirmed'),
  cancelClose: () => ipcRenderer.send('close-cancelled'),
};

contextBridge.exposeInMainWorld('appMapper', api);
