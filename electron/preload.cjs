const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('financeiro', {
  system: {
    health: () => ipcRenderer.invoke('system:health'),
  },
});
