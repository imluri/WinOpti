import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createWindowsPlatform } from '../src/main/winopti-platform'
import { createWinOptiService } from '../src/main/winopti-service'
import { classifyApps } from '../src/shared/winopti'
import { compile } from './build-platform.cjs'

if (process.platform !== 'win32') throw new Error('Run this test in an interactive Windows desktop session.')

const fixture = resolve('scripts', 'fixtures', 'DisposableWindow.cs')
await mkdir(resolve('dist'), { recursive: true })
const work = await mkdtemp(resolve('dist', 'windows-close-'))
const helper = join(work, 'winopti-platform.exe')
const appPath = join(work, 'WinOptiDisposableTest.exe')
const children: ChildProcess[] = []
const platform = createWindowsPlatform(helper)
const conditions = {
  game: 'Fixture Game', gameExecutable: 'fixture-game.exe', scene: 'Test route',
  graphics: 'Low', frameCap: '60', durationSeconds: 5,
}

function start(file: string, args: string[]) {
  const child = spawn(file, args, { cwd: work, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: file !== appPath })
  children.push(child)
  return child
}

async function until<T>(read: () => Promise<T | undefined>, message: string, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout
  do {
    const value = await read()
    if (value !== undefined) return value
    await delay(125)
  } while (Date.now() < end)
  throw new Error(message)
}

async function portForFixture() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()))
  return address.port
}

async function launchFixture(lifetime: number) {
  await rm(join(work, 'window.pid'), { force: true })
  await rm(join(work, 'window.closed'), { force: true })
  const launcher = start(appPath, ['launch', String(lifetime)])
  const [code] = await once(launcher, 'exit')
  assert.equal(code, 0)
  const pid = Number(await readFile(join(work, 'window.pid'), 'utf8'))
  assert.ok(Number.isInteger(pid) && pid > 0)
  return until(async () => (await platform.snapshot()).processes.find(row =>
    row.pid === pid && row.windowTitle === 'WinOpti disposable test window'),
  'No fixture window was visible to the helper. Use an interactive Windows desktop session.')
}

async function windowIsRunning(pid: number) {
  return (await platform.snapshot()).processes.some(row => row.pid === pid && row.executable === appPath)
}

async function windowClosedNormally(pid: number) {
  return (await readFile(join(work, 'window.closed'), 'utf8').catch(() => '')) === String(pid)
}

const activeWindows: { pid: number; startedAt: number; executable: string; creationToken: string }[] = []

try {
  compile(resolve('electron', 'winopti-platform.cs'), helper, ['/target:exe', '/reference:System.Web.Extensions.dll'])
  compile(fixture, appPath, ['/target:winexe', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll'])
  await writeFile(join(work, 'fixture.html'), '<h1>WinOpti disposable dev server</h1>')
  await writeFile(join(work, 'fixture-entry.js'), 'console.log("WinOpti build version 1")')

  const devFolder = join(work, 'dev-runtime')
  const devRuntime = join(devFolder, 'bun.exe')
  await mkdir(devFolder)
  await copyFile(process.execPath, devRuntime)
  const buildFolder = join(work, 'build-runtime')
  await mkdir(buildFolder)
  const buildRuntime = join(buildFolder, 'bun.exe')
  await copyFile(process.execPath, buildRuntime)
  const port = await portForFixture()
  const dev = start(devRuntime, [`--port=${port}`, './fixture.html'])
  const build = start(buildRuntime, ['build', './fixture-entry.js', '--watch', '--outfile=./fixture-bundle.js'])
  const anchor = start(helper, [])
  assert.ok(anchor.pid)

  const raw = await launchFixture(30000)
  assert.ok(raw.executable && raw.creationToken && raw.startedAt !== null)
  const identity = { pid: raw.pid, startedAt: raw.startedAt, executable: raw.executable, creationToken: raw.creationToken }
  activeWindows.push(identity)
  assert.equal((await platform.requestClose({ ...identity, creationToken: '1' })).status, 'identity-changed')
  assert.equal(await windowIsRunning(raw.pid), true)
  console.log('Native close rejected the changed identity and left the disposable window open.')

  const serverUrl = `http://localhost:${port}/fixture`
  const servedFixture = async () => {
    const response = await fetch(serverUrl, { signal: AbortSignal.timeout(500) }).catch(() => undefined)
    return (await response?.text())?.includes('WinOpti disposable dev server') ? true : undefined
  }
  await until(servedFixture, 'The Bun dev server did not serve the fixture.')
  await until(async () => (await readFile(join(work, 'fixture-bundle.js'), 'utf8').catch(() => ''))
    .includes('version 1') ? true : undefined, 'The Bun build did not produce its first output.')

  const service = await createWinOptiService({
    statePath: join(work, 'state.json'), helperPath: helper, ownPid: anchor.pid, platform, closeWaitMs: 1500,
  })
  service.startCapture(conditions, 'baseline')
  await delay(5050)
  const baseline = await service.finishCapture()
  const candidate = baseline.findings.find(row => row.executable?.toLowerCase() === appPath.toLowerCase())
  assert.equal(candidate?.disposition, 'candidate', candidate?.reason)
  assert.ok(candidate)
  const groups = classifyApps(await platform.snapshot(), { conditions, alwaysProtect: [], ownPid: anchor.pid })
  for (const [job, reason] of [[dev, /Active Bun development server/], [build, /Active (Bun build|test or watch job)/]] as const) {
    const group = groups.find(row => row.processes.some(process => process.pid === job.pid))
    assert.match(group?.protection ?? '', reason)
    assert.deepEqual(group?.windowTargets, [])
    await assert.rejects(async () => service.prepareClose([group!.id]))
  }

  await assert.rejects(service.confirmClose('unconfirmed'))
  const confirmation = service.prepareClose([candidate.id])
  assert.deepEqual(confirmation.apps.map(item => item.id), [candidate.id])
  await delay(200)
  assert.equal(await windowIsRunning(raw.pid), true, 'Preparing the confirmation must leave the fixture running.')
  const results = await service.confirmClose(confirmation.token)
  assert.equal(results.find(result => result.id === candidate.id)?.status, 'closed')
  assert.equal(await windowClosedNormally(raw.pid), true)
  assert.equal((await platform.requestClose(identity)).status, 'exited')
  await assert.rejects(service.confirmClose(confirmation.token))
  console.log('Only explicit confirmation closed the selected app normally. Its exited process was then skipped.')

  assert.equal(await servedFixture(), true)
  await writeFile(join(work, 'fixture-entry.js'), 'console.log("WinOpti build version 2")')
  await until(async () => (await readFile(join(work, 'fixture-bundle.js'), 'utf8').catch(() => ''))
    .includes('version 2') ? true : undefined, 'The Bun build stopped watching after the close.')
  assert.equal(dev.exitCode, null)
  assert.equal(build.exitCode, null)
  console.log('The protected Bun server still served requests and the build watcher still rebuilt.')

  const exitingApp = await launchFixture(7000)
  assert.ok(exitingApp.executable && exitingApp.creationToken && exitingApp.startedAt !== null)
  activeWindows.push({ pid: exitingApp.pid, startedAt: exitingApp.startedAt, executable: exitingApp.executable, creationToken: exitingApp.creationToken })
  service.startCapture(conditions, 'baseline')
  await delay(5050)
  const second = await service.finishCapture()
  const exitingCandidate = second.findings.find(row => row.executable?.toLowerCase() === appPath.toLowerCase())
  assert.equal(exitingCandidate?.disposition, 'candidate')
  const late = service.prepareClose([exitingCandidate!.id])
  await until(async () => (await windowIsRunning(exitingApp.pid)) ? undefined : true, 'The disposable fixture did not close on its own.')
  assert.equal(await windowClosedNormally(exitingApp.pid), true)
  const lateResults = await service.confirmClose(late.token)
  assert.equal(lateResults.find(result => result.id === exitingCandidate!.id)?.status, 'exited')
  console.log('Confirmation safely skipped an app that exited after the scan.')
  console.log(`Physical disk telemetry: ${baseline.resources.diskBytesPerSecond === null ? 'unavailable' : 'available'}.`)
} finally {
  for (const identity of activeWindows) {
    if ((await platform.requestClose(identity).catch(() => undefined))?.status === 'requested') {
      await until(async () => (await windowIsRunning(identity.pid)) ? undefined : true,
        'Waiting for the disposable window to finish.').catch(() => {})
    }
  }
  platform.dispose()
  // These handles belong only to disposable processes created by this test.
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
    const exited = once(child, 'exit')
    child.kill()
    await Promise.race([exited, delay(2500, undefined, { ref: false })])
  }))
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
