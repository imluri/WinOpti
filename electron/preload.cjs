const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChange: callback => {
    const listener = (_event, maximized) => callback(maximized)
    ipcRenderer.on('window:maximized-change', listener)
    return () => ipcRenderer.removeListener('window:maximized-change', listener)
  },
})

if (process.argv.includes('--winopti-live')) {
  const methods = [
    'getState', 'getPerformance', 'getProcesses', 'refreshPower', 'listProcesses', 'setRecurring', 'startCapture', 'markStutter', 'finishCapture', 'cancelCapture',
    'prepareClose', 'cancelClose', 'confirmClose', 'setAlwaysProtect', 'importFrameTimes', 'exportReport',
    'getUpdateState', 'checkForUpdates', 'downloadUpdate', 'installUpdate',
  ]
  const bridge = Object.fromEntries(methods.map(method => [
    method, (...args) => ipcRenderer.invoke(`winopti:${method}`, ...args),
  ]))
  bridge.onStutterMarked = callback => {
    const listener = (_event, seconds) => callback(seconds)
    ipcRenderer.on('winopti:marked', listener)
    return () => ipcRenderer.removeListener('winopti:marked', listener)
  }
  bridge.onRecurringChanged = callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('winopti:recurring-changed', listener)
    return () => ipcRenderer.removeListener('winopti:recurring-changed', listener)
  }
  bridge.onUpdateChanged = callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('winopti:update-changed', listener)
    return () => ipcRenderer.removeListener('winopti:update-changed', listener)
  }
  contextBridge.exposeInMainWorld('winOpti', bridge)
}
