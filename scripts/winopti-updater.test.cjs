const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { createWinOptiUpdater } = require('../electron/winopti-updater.cjs')

const latest = 'https://api.github.com/repos/imluri/WinOpti/releases/latest'
const assetURL = 'https://github.com/imluri/WinOpti/releases/download/v0.10.0/WinOpti-Setup-0.10.0-x64.exe'
const signedURL = 'https://release-assets.githubusercontent.com/asset?sig=example'
const installerBytes = Buffer.from('test installer bytes')
const digest = 'sha256:' + createHash('sha256').update(installerBytes).digest('hex')
const defaultRelease = () => ({
  tag_name: 'v0.10.0',
  draft: false,
  prerelease: false,
  assets: [{ name: 'WinOpti-Setup-0.10.0-x64.exe', state: 'uploaded', size: installerBytes.length, digest }],
})

async function fixture(t, options = {}) {
  const parent = path.resolve('dist')
  await mkdir(parent, { recursive: true })
  const folder = await mkdtemp(path.join(parent, 'updater-test-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  if (!options.unpacked) await writeFile(path.join(folder, 'Uninstall WinOpti.exe'), '')
  const events = []
  const calls = []
  const launches = []
  let quits = 0
  let allowInstall = true
  const file = path.join(folder, 'update', 'winopti-update.exe')
  const app = {
    isPackaged: true,
    getVersion: () => '0.9.0',
    getPath: name => name === 'exe' ? path.join(folder, 'WinOpti.exe') : folder,
    quit: () => quits++,
  }
  const updater = createWinOptiUpdater({
    app,
    platform: 'win32',
    arch: 'x64',
    onChange: event => events.push(event),
    canInstall: () => allowInstall,
    startInstaller: async installer => launches.push(installer),
    fetch: async (url, request) => {
      calls.push(url)
      assert.equal(request.credentials, 'omit')
      assert.equal(request.redirect, 'manual')
      if (url === latest) return Response.json(options.release ?? defaultRelease())
      if (url === assetURL) return Response.redirect(options.redirect ?? signedURL)
      if (url === signedURL) return new Response(options.bytes ?? installerBytes)
      assert.fail(`Unexpected request: ${url}`)
    },
  })
  return { updater, events, calls, launches, file, getQuits: () => quits, blockInstall: () => { allowInstall = false } }
}

test('downloads a verified newer installer and restarts only after an allowed install request', async t => {
  const { updater, events, calls, launches, file, getQuits } = await fixture(t)
  assert.equal(updater.getState().status, 'idle')
  assert.equal((await updater.downloadUpdate()).status, 'idle')
  await assert.rejects(updater.installUpdate(), /Download the update/)
  const [first, second] = await Promise.all([updater.checkForUpdates(), updater.checkForUpdates()])
  assert.equal(first.status, 'available')
  assert.equal(first.updateVersion, '0.10.0')
  assert.deepEqual(second, first)
  assert.deepEqual(calls, [latest])
  assert.equal((await updater.downloadUpdate()).status, 'downloaded')
  assert.deepEqual(calls, [latest, assetURL, signedURL])
  assert.deepEqual(await readFile(file), installerBytes)
  assert.deepEqual(launches, [])
  assert.equal(getQuits(), 0)
  await updater.installUpdate()
  await updater.installUpdate()
  assert.deepEqual(launches, [file])
  assert.equal(getQuits(), 1)
  assert.ok(events.some(state => state.status === 'downloading' && state.progress === 99))
})

test('skips older, prerelease, and malformed versions', async t => {
  for (const tag_name of ['v0.8.9', 'v0.9.0', 'v0.10.0-rc.1', 'v0.09.0', '0.10.0']) {
    const { updater } = await fixture(t, { release: { ...defaultRelease(), tag_name } })
    assert.equal((await updater.checkForUpdates()).status, 'not-available')
  }
  const { updater } = await fixture(t, { release: { ...defaultRelease(), prerelease: true } })
  assert.equal((await updater.checkForUpdates()).status, 'not-available')
})

test('rejects unavailable builds, unverified assets, and redirects outside GitHub release storage', async t => {
  const unpacked = await fixture(t, { unpacked: true })
  assert.equal((await unpacked.updater.checkForUpdates()).status, 'unavailable')
  assert.deepEqual(unpacked.calls, [])
  const release = defaultRelease()
  release.assets[0].digest = 'sha256:bad'
  const unverified = await fixture(t, { release })
  assert.equal((await unverified.updater.checkForUpdates()).status, 'error')
  const redirected = await fixture(t, { redirect: 'https://example.org/update.exe' })
  await redirected.updater.checkForUpdates()
  assert.equal((await redirected.updater.downloadUpdate()).status, 'error')
  assert.deepEqual(redirected.calls, [latest, assetURL])
})

test('rejects a bad download or a modified cache and honors the install reservation', async t => {
  const badDownload = await fixture(t, { bytes: Buffer.alloc(installerBytes.length, 'x') })
  await badDownload.updater.checkForUpdates()
  assert.equal((await badDownload.updater.downloadUpdate()).status, 'error')
  await assert.rejects(readFile(badDownload.file + '.partial'), { code: 'ENOENT' })
  const { updater, file, blockInstall, launches } = await fixture(t)
  await updater.checkForUpdates()
  await updater.downloadUpdate()
  blockInstall()
  await assert.rejects(updater.installUpdate(), /Finish your scan/)
  assert.equal(updater.getState().status, 'downloaded')
  await writeFile(file, Buffer.alloc(installerBytes.length, 'x'))
  await updater.installUpdate()
  assert.equal(updater.getState().status, 'error')
  assert.deepEqual(launches, [])
})
