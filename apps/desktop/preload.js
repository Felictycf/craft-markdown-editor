/**
 * Craft — Electron preload script.
 * Exposes a minimal, safe bridge for the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('craft', {
  openDirectoryDialog: () => ipcRenderer.invoke('craft:openDirectory'),
})
