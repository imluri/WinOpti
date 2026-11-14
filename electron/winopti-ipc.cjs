const { app, BrowserWindow, dialog, globalShortcut, ipcMain, powerMonitor, shell } = require('electron')
const { open, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { getExecutableIcon } = require('./winopti-icons.cjs')
const { createWinOptiUpdater } = require('./winopti-updater.cjs')

const markerShortcut = 'Control+Shift+F9'
const maxCsvBytes = 25 * 1024 * 1024

async function registerWinOpti(windowFromEvent, entryURL) {
  const { createWinOptiService, createWindowsPlatform, createLiveProcesses, createProcessReview } = require('../dist/winopti-service.cjs')
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'winopti-platform.exe')
    : path.join(__dirname, '../dist/winopti-platform.exe')
  const dashboardPlatform = createWindowsPlatform(helperPath)
  const liveProcesses = createLiveProcesses(dashboardPlatform.processes, getExecutableIcon, {
    ownPid: process.pid,
    windowsDirectory: process.env.SystemRoot,
  })
  const processReview = await createProcessReview({
    ...liveProcesses,
    statePath: path.join(app.getPath('userData'), 'winopti-process-tags.json'),
    openExternal: url => shell.openExternal(url),
  })
  let hardware
  let pendingPerformance
  let recentPerformance
  function getPerformance() {
    if (pendingPerformance) return pendingPerformance
    if (recentPerformance && Date.now() - recentPerformance.receivedAt < 950) return recentPerformance.reading
    pendingPerformance = (async () => {
      // Inventory is collected once per app session. Live counters run in a
      // separate helper so they cannot advance the counters used for scans.
      hardware ??= await dashboardPlatform.hardware()
      const sample = await dashboardPlatform.performance()
      const reading = { hardware, sample }
      recentPerformance = { reading, receivedAt: Date.now() }
      return reading
    })().finally(() => { pendingPerformance = undefined })
    return pendingPerformance
  }
  const broadcast = (channel, state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL() === entryURL) window.webContents.send(channel, state)
    }
  }
  const service = await createWinOptiService({
    helperPath,
    statePath: path.join(app.getPath('userData'), 'winopti-captures.json'),
    ownPid: process.pid,
    getIcon: getExecutableIcon,
    onRecurringChanged: state => broadcast('winopti:recurring-changed', state),
  })
  let launchingUpdate = false
  const updater = createWinOptiUpdater({
    onChange: state => broadcast('winopti:update-changed', state),
    canInstall: service.reserveUpdateInstall,
  })

  let shortcutRegistered = false
  function clearMarkerShortcut() {
    if (shortcutRegistered) globalShortcut.unregister(markerShortcut)
    shortcutRegistered = false
  }

  const methods = {
    getState: () => service.getState(),
    getPerformance,
    getProcesses: processReview.getProcesses,
    setProcessTags: (_window, id, tags) => processReview.setProcessTags(id, tags),
    inspectProcess: (_window, id) => processReview.inspectProcess(id),
    lookupProcessReputation: (_window, id, sha256) => processReview.lookupProcessReputation(id, sha256),
    openInstalledApps: (_window, id) => processReview.openInstalledApps(id),
    refreshPower: () => service.refreshPower(),
    listProcesses: () => service.listProcesses(),
    setRecurring: (_window, settings) => service.setRecurring(settings),
    getUpdateState: () => updater.getState(),
    checkForUpdates: () => updater.checkForUpdates(),
    downloadUpdate: () => updater.downloadUpdate(),
    installUpdate: async () => {
      if (launchingUpdate) return
      launchingUpdate = true
      try {
        await updater.installUpdate()
      } catch (error) {
        service.releaseUpdateInstall()
        throw error
      } finally {
        launchingUpdate = false
      }
    },
    startCapture: (window, conditions, phase) => {
      const started = service.startCapture(conditions, phase)
      shortcutRegistered = globalShortcut.register(markerShortcut, () => {
        if (window.isDestroyed()) return
        try {
          window.webContents.send('winopti:marked', service.markStutter())
        } catch {
          clearMarkerShortcut()
        }
      })
      return { ...started, hotkeyAvailable: shortcutRegistered }
    },
    markStutter: () => service.markStutter(),
    finishCapture: async () => {
      try {
        return await service.finishCapture()
      } finally {
        clearMarkerShortcut()
      }
    },
    cancelCapture: () => {
      service.cancelCapture()
      clearMarkerShortcut()
    },
    prepareClose: (_window, ids) => service.prepareClose(ids),
    cancelClose: (_window, token) => service.cancelClose(token),
    confirmClose: (_window, token) => service.confirmClose(token),
    setAlwaysProtect: (_window, entries) => service.setAlwaysProtect(entries),
    importFrameTimes: async (window, phase) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: 'Import PresentMon frame times', properties: ['openFile'],
        filters: [{ name: 'PresentMon CSV', extensions: ['csv'] }],
      })
      if (canceled) return null
      const file = await open(filePaths[0], 'r')
      try {
        const stats = await file.stat()
        if (!stats.isFile() || stats.size > maxCsvBytes) throw new Error('Choose a CSV file smaller than 25 MB.')
        const buffer = Buffer.alloc(stats.size + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead !== stats.size) throw new Error('The CSV changed while opening it. Try again.')
        return await service.importFrameTimes(phase, buffer.toString('utf8', 0, bytesRead))
      } finally {
        await file.close()
      }
    },
    exportReport: async (window) => {
      const report = service.exportReport()
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Save WinOpti report', defaultPath: 'WinOpti-report.json',
        filters: [{ name: 'JSON report', extensions: ['json'] }],
      })
      if (canceled) return false
      await writeFile(filePath, report, 'utf8')
      return true
    },
  }

  for (const [method, handler] of Object.entries(methods)) {
    ipcMain.handle(`winopti:${method}`, (event, ...args) => {
      const window = windowFromEvent(event)
      if (!window) throw new Error('WinOpti can only run actions from its own window.')
      return handler(window, ...args)
    })
  }

  const suspend = () => service.setSuspended(true)
  const resume = () => service.setSuspended(false)
  powerMonitor.on('suspend', suspend)
  powerMonitor.on('resume', resume)
  app.once('will-quit', () => {
    powerMonitor.off('suspend', suspend)
    powerMonitor.off('resume', resume)
    clearMarkerShortcut()
    dashboardPlatform.dispose()
    service.dispose()
  })
}

module.exports = { registerWinOpti }
