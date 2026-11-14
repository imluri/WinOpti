const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream, existsSync } = require('node:fs')
const { mkdir, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const repository = 'imluri/WinOpti'
const latestReleaseURL = `https://api.github.com/repos/${repository}/releases/latest`
const releaseAssetHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const versionPattern = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/
const maxInstallerBytes = 512 * 1024 * 1024

function newerVersion(release, installed) {
  if (release?.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') return null
  const version = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : ''
  if (!versionPattern.test(version) || !versionPattern.test(installed)) return null
  const current = installed.split('.').map(Number)
  const remote = version.split('.').map(Number)
  const firstDifference = remote.findIndex((part, index) => part !== current[index])
  return firstDifference >= 0 && remote[firstDifference] > current[firstDifference] ? version : null
}

function selectReleaseAsset(release, version) {
  const name = `WinOpti-Setup-${version}-x64.exe`
  const asset = Array.isArray(release.assets) ? release.assets.find(asset => asset?.name === name) : null
  if (asset?.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxInstallerBytes ||
      !/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? '')) return null
  return {
    version, size: asset.size, digest: asset.digest.slice(7).toLowerCase(),
    url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
  }
}

function request(fetch, url, options) {
  return fetch(url, {
    credentials: 'omit',
    redirect: 'manual',
    cache: 'no-store',
    ...options,
    headers: { 'User-Agent': 'WinOpti', ...options.headers },
  })
}

async function requestAsset(fetch, url, signal) {
  let target = new URL(url)
  for (let i = 0; i < 5; i++) {
    const response = await request(fetch, target.href, { signal })
    if (!redirectStatuses.has(response.status)) {
      if (response.ok && response.body) return response.body
      await response.body?.cancel()
      break
    }
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) break
    target = new URL(location, target)
    if (target.protocol !== 'https:' || target.username || target.password || target.port ||
        !releaseAssetHosts.has(target.hostname)) break
  }
  throw new Error('GitHub could not provide the installer.')
}

async function verifyInstaller(file, asset) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length
    if (bytes > asset.size) return false
    hash.update(chunk)
  }
  return bytes === asset.size && hash.digest('hex') === asset.digest
}

async function downloadInstaller(fetch, asset, file, onProgress) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  const partial = file + '.partial'
  const hash = createHash('sha256')
  let bytes = 0
  let lastPercent = 0
  try {
    await rm(partial, { force: true })
    const body = await requestAsset(fetch, asset.url, controller.signal)
    await pipeline(Readable.fromWeb(body), new Transform({
      transform(chunk, _encoding, callback) {
        timeout.refresh()
        bytes += chunk.length
        if (bytes > asset.size) return callback(new Error('The installer is larger than its published size.'))
        hash.update(chunk)
        const percent = Math.min(99, Math.floor(bytes * 100 / asset.size))
        if (percent > lastPercent) {
          lastPercent = percent
          onProgress(percent)
        }
        callback(null, chunk)
      },
    }), createWriteStream(partial, { flags: 'wx' }), { signal: controller.signal })
    if (bytes !== asset.size || hash.digest('hex') !== asset.digest) {
      throw new Error('The installer does not match the published release.')
    }
    await rm(file, { force: true })
    await rename(partial, file)
  } finally {
    clearTimeout(timeout)
    await rm(partial, { force: true }).catch(() => {})
  }
}

function launchInstaller(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, ['--updated', '--force-run'], {
      cwd: path.dirname(file), detached: true, stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function createWinOptiUpdater({
  onChange = () => {},
  canInstall = () => true,
  app = require('electron').app,
  fetch = globalThis.fetch,
  startInstaller = launchInstaller,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const enabled = platform === 'win32' && arch === 'x64' && app.isPackaged &&
    existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall WinOpti.exe'))
  const directory = enabled ? path.join(app.getPath('userData'), 'update') : null
  const file = directory ? path.join(directory, 'winopti-update.exe') : null
  // The installer may still be exiting when NSIS relaunches WinOpti.
  const clearCache = file ? Promise.allSettled([rm(file, { force: true }), rm(file + '.partial', { force: true })]) : null
  let state = {
    version: app.getVersion(),
    status: enabled ? 'idle' : 'unavailable',
    updateVersion: null,
    progress: null,
    message: enabled ? null : 'Updates are available in the installed Windows app.',
  }
  const getState = () => ({ ...state })

  let operation
  let asset
  let installer
  let installing = false

  function change(status, { updateVersion = null, progress = null, message = null } = {}) {
    state = { ...state, status, updateVersion, progress, message }
    onChange(getState())
  }

  function run(action) {
    operation = Promise.resolve().then(action).finally(() => { operation = undefined }).then(getState)
    return operation
  }

  async function checkForUpdates() {
    if (operation) return operation
    if (!enabled || state.status === 'downloaded' || installing) return getState()
    return run(async () => {
      asset = undefined
      change('checking')
      try {
        const response = await request(fetch, latestReleaseURL, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15_000),
        })
        if (response.status === 404) {
          await response.body?.cancel()
          change('not-available', { message: 'No public WinOpti release was found.' })
          return
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error('GitHub release check failed.')
        }
        const release = await response.json()
        const version = newerVersion(release, state.version)
        if (!version) {
          change('not-available')
          return
        }
        asset = selectReleaseAsset(release, version)
        if (!asset) {
          change('error', { updateVersion: version, message: 'The new release is missing a verifiable WinOpti installer.' })
          return
        }
        change('available', { updateVersion: version })
      } catch {
        change('error', { message: 'WinOpti could not check GitHub Releases. Try again.' })
      }
    })
  }

  async function downloadUpdate() {
    if (operation) return operation
    if (state.status !== 'available' || !asset) return getState()
    return run(async () => {
      const { version } = asset
      change('downloading', { updateVersion: version, progress: 0 })
      try {
        await clearCache
        await mkdir(directory, { recursive: true })
        await downloadInstaller(fetch, asset, file, percent => {
          change('downloading', { updateVersion: version, progress: percent })
        })
        installer = file
        change('downloaded', { updateVersion: version, progress: 100 })
      } catch {
        change('error', { updateVersion: version, message: 'WinOpti could not download or verify the installer. Check for updates and try again.' })
      }
    })
  }

  async function installUpdate() {
    if (installing) return
    if (state.status !== 'downloaded' || !asset || !installer || operation) {
      throw new Error('Download the update before installing it.')
    }
    const busyMessage = 'Finish your scan or app-close operation before restarting WinOpti.'
    installing = true
    let started = false
    try {
      if (!await verifyInstaller(installer, asset).catch(() => false)) {
        await rm(installer, { force: true }).catch(() => {})
        installer = undefined
        change('error', { updateVersion: asset.version, message: 'The saved installer could not be verified. Download it again.' })
        return
      }
      if (!canInstall()) throw new Error(busyMessage)
      try {
        await startInstaller(installer)
      } catch {
        throw new Error('Windows could not start the update installer. Try again.')
      }
      started = true
      app.quit()
    } finally {
      if (!started) installing = false
    }
  }

  return { getState, checkForUpdates, downloadUpdate, installUpdate }
}

module.exports = { createWinOptiUpdater }
