const { app, BrowserWindow, ipcMain, net, protocol, session } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const scheme = 'winopti'
const host = 'app'
const entryURL = `${scheme}://${host}/index.html`
const rendererDir = path.resolve(__dirname, '../dist')
const live = process.platform === 'win32' && !process.argv.includes('--preview')
const primaryInstance = !live || app.requestSingleInstanceLock()
if (process.platform === 'win32') app.setAppUserModelId('com.imluri.winopti')
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window?.isMinimized()) window.restore()
  window?.focus()
})
const contentPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

async function serveRenderer(request) {
  try {
    const url = new URL(request.url)
    if (url.hostname !== host || request.method !== 'GET') return new Response(null, { status: 404 })
    const relative = decodeURIComponent(url.pathname).slice(1)
    if (relative !== 'index.html' && !/^index-[a-z0-9]+\.(js|css)$/i.test(relative)) {
      return new Response(null, { status: 404 })
    }
    const filename = path.join(rendererDir, relative)
    const response = await net.fetch(pathToFileURL(filename).href)
    if (relative !== 'index.html') return response
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', contentPolicy)
    return new Response(response.body, { status: response.status, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function windowFromEvent(event) {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || frame.url !== entryURL) return null
  return BrowserWindow.fromWebContents(event.sender)
}

function registerWindowActions() {
  ipcMain.on('window:minimize', event => windowFromEvent(event)?.minimize())
  ipcMain.on('window:close', event => windowFromEvent(event)?.close())
  ipcMain.handle('window:is-maximized', event => windowFromEvent(event)?.isMaximized() ?? false)
  ipcMain.handle('window:toggle-maximize', event => {
    const window = windowFromEvent(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1210,
    height: 850,
    minWidth: 420,
    minHeight: 520,
    frame: false,
    show: false,
    title: 'WinOpti',
    icon: path.join(__dirname, '../assets/winopti-icon.png'),
    backgroundColor: '#080808',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !live,
      additionalArguments: live ? ['--winopti-live'] : [],
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-frame-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => window.show())

  function reportMaximizeState() {
    if (!window.isDestroyed()) window.webContents.send('window:maximized-change', window.isMaximized())
  }
  window.on('maximize', reportMaximizeState)
  window.on('unmaximize', reportMaximizeState)
  window.loadURL(entryURL).catch(error => {
    console.error('Could not load the WinOpti interface.', error)
    app.exit(1)
  })
}

app.whenReady().then(async () => {
  if (!primaryInstance) {
    app.quit()
    return
  }
  protocol.handle(scheme, serveRenderer)
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  registerWindowActions()
  if (live) await require('./winopti-ipc.cjs').registerWinOpti(windowFromEvent, entryURL)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(error => {
  console.error('WinOpti could not start.', error)
  require('electron').dialog.showErrorBox('WinOpti could not start', error.message)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
