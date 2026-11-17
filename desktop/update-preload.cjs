'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  status: 'desktop-updates:status',
  check: 'desktop-updates:check',
  install: 'desktop-updates:install',
  later: 'desktop-updates:later',
  releases: 'desktop-updates:releases',
  changed: 'desktop-updates:changed',
}); // Whitelisted bridge for the sandboxed update UI; never expose Node or generic IPC.

contextBridge.exposeInMainWorld('desktopUpdates', {
  getStatus: () => ipcRenderer.invoke(CHANNELS.status),
  check: () => ipcRenderer.invoke(CHANNELS.check),
  install: () => ipcRenderer.invoke(CHANNELS.install),
  later: () => ipcRenderer.invoke(CHANNELS.later),
  releases: () => ipcRenderer.invoke(CHANNELS.releases),
  onStatus: callback => {
    const listener = (_event, state) => callback(state); // Receives only the updater's plain status snapshot.
    ipcRenderer.on(CHANNELS.changed, listener);
    return () => ipcRenderer.removeListener(CHANNELS.changed, listener);
  },
});
