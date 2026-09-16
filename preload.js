'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadLibrary: (opts = {}) => ipcRenderer.invoke('library:load', opts),
  getRoot: () => ipcRenderer.invoke('library:root'),
  chooseRoot: () => ipcRenderer.invoke('library:chooseRoot'),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch) => ipcRenderer.invoke('state:set', patch),
  reveal: (p) => ipcRenderer.send('sample:reveal', p),
  setTheme: (pref) => ipcRenderer.send('theme:set', pref),
  startDrag: (files) => ipcRenderer.send('sample:drag', files),
  onProgress: (cb) => ipcRenderer.on('library:progress', (_e, d) => cb(d)),
});
