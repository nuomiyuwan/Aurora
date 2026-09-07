const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('auroraPlayer', {
  onState(listener) {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('standalone-player:state', handler)
    return () => ipcRenderer.removeListener('standalone-player:state', handler)
  },
  ready: () => ipcRenderer.send('standalone-player:ready'),
  preparePreview: (id) => ipcRenderer.invoke('standalone-player:preview', id),
  retry: (id) => ipcRenderer.send('standalone-player:retry', id),
})
