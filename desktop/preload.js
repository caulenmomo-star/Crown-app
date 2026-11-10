/* Kingpin for Mac and Windows: lets Kingpin's screens know they're inside the app, so they can offer to link it to
   Kingpin Online and add this computer's data to the account. Only works for Kingpin's own pages. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
let info = null;
try { info = ipcRenderer.sendSync('kd:info'); } catch (_) { info = null; }
if (info) {
  contextBridge.exposeInMainWorld('kingpinDesktop', {
    mode: info.mode, hasLocal: !!info.hasLocal, imported: !!info.imported, platform: info.platform,
    readLocal: () => ipcRenderer.invoke('kd:readLocal'),
    setImported: v => ipcRenderer.send('kd:imported', !!v),
    setMode: m => ipcRenderer.send('kd:mode', m),
  });
}
