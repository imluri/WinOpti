import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { CaptureConditions, RawProcess, RecurringScanState, Snapshot } from '../shared/winopti'
import { readPresentMon } from './presentmon'
import { createWinOptiService } from './winopti-service'

const ownPid = 100
const candidatePid = 101
const start = 1_790_000_000_000
const conditions: CaptureConditions = {
  game: 'Test game', gameExecutable: 'game.exe', scene: 'Same route',
  graphics: 'High', frameCap: '60', durationSeconds: 5,
}
const proc = (pid: number, name: string, fields: Partial<RawProcess> = {}): RawProcess => ({
  pid, name, executable: `C:\\Apps\\${name}`, startedAt: start - pid * 20, creationToken: String(start - pid * 20),
  parentPid: null, commandLine: `C:\\Apps\\${name}`, cpuTimeMs: 400, workingSetBytes: 250 * 1024 * 1024,
  ioBytes: 2048, windowTitle: name, sessionId: 1, ...fields,
})

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function fixture(captureConditions = conditions, schedule?: {
  after: (callback: () => void, delayMs: number) => () => void;
  onChange: (state: RecurringScanState) => void;
}) {
  const testParent = path.resolve('dist')
  await mkdir(testParent, { recursive: true })
  const folder = await mkdtemp(path.join(testParent, 'winopti-test-'))
  cleanups.push(() => rm(folder, { recursive: true, force: true }))
  let at = Date.now()
  const processes = [
    proc(ownPid, 'WinOpti.exe'),
    proc(candidatePid, 'Disposable.exe', { iconPath: 'C:\\Apps\\Disposable.exe', displayName: 'Disposable' }),
    proc(102, 'game.exe'),
    proc(103, 'node.exe', { windowTitle: null, commandLine: 'node node_modules/vite/bin/vite.js' }),
    proc(104, 'node.exe', { windowTitle: null, commandLine: 'node node_modules/vite/bin/vite.js build' }),
  ]
  const requested: number[] = []
  const statePath = path.join(folder, 'captures.json')
  const service = await createWinOptiService({
    ownPid, statePath, helperPath: '', closeWaitMs: 0,
    getIcon: async () => 'data:image/png;base64,fixture',
    scheduleRecurring: schedule?.after,
    onRecurringChanged: schedule?.onChange,
    platform: {
      async snapshot(): Promise<Snapshot> {
        at = Math.max(at + 1, Date.now())
        return {
          at: at - 12, logicalCpus: 8, processes: processes.map(process => ({
            ...process, cpuTimeMs: 400 + (at - start) / 10,
          })),
          cpuPercent: 20, memoryPressurePercent: 45, diskBytesPerSecond: 250_000,
          power: { source: 'plugged-in', batteryPercent: 85, saver: false },
        }
      },
      async requestClose(identity) {
        requested.push(identity.pid)
        processes.splice(processes.findIndex(process => process.pid === identity.pid), 1)
        return { status: 'requested', detail: 'Requested normal close.' }
      },
    },
  })
  cleanups.push(async () => service.dispose())
  const choices = await service.listProcesses()
  service.startCapture(captureConditions, 'baseline')
  await expect(service.listProcesses()).rejects.toThrow('after the current operation finishes')
  await Bun.sleep(captureConditions.durationSeconds * 1000 + 50)
  const baseline = await service.finishCapture()
  const disposable = baseline.findings.find(finding => finding.name === 'Disposable')!
  expect(disposable.disposition).toBe('candidate')
  expect(baseline.findings.find(finding => finding.name === 'node')?.disposition).toBe('protected')
  return { service, processes, requested, disposable, statePath, baseline, choices }
}

describe('WinOpti close confirmation', () => {
  test('only a matching, current confirmation requests a normal close', async () => {
    const { service, requested, disposable, statePath, processes } = await fixture()
    await expect(service.confirmClose('without-review')).rejects.toThrow('Review')
    const canceled = service.prepareClose([disposable.id])
    expect(canceled.apps).toEqual([{ id: disposable.id, name: 'Disposable' }])
    service.cancelClose(canceled.token)
    await expect(service.confirmClose(canceled.token)).rejects.toThrow('Review')
    expect(requested).toEqual([])

    const confirmed = service.prepareClose([disposable.id])
    expect((await service.confirmClose(confirmed.token))[0].status).toBe('closed')
    expect(requested).toEqual([candidatePid])
    expect(processes.filter(process => process.name === 'node.exe')).toHaveLength(2)
    await expect(service.confirmClose(confirmed.token)).rejects.toThrow('Review')
    expect(await readFile(statePath, 'utf8')).not.toContain('node_modules/vite/bin/vite.js')
    expect(service.exportReport()).not.toContain('commandLine')
  }, 10000)

  test('skips changed identities, exited processes, and newly protected apps', async () => {
    const { service, requested, disposable, processes } = await fixture()
    const index = processes.findIndex(process => process.pid === candidatePid)
    const original = { ...processes[index] }

    const changed = service.prepareClose([disposable.id])
    processes[index].creationToken = '999'
    expect((await service.confirmClose(changed.token))[0].status).toBe('identity-changed')
    const gone = service.prepareClose([disposable.id])
    processes.splice(index, 1)
    expect((await service.confirmClose(gone.token))[0].status).toBe('exited')

    processes.splice(index, 0, original)
    const protectedAfterReview = service.prepareClose([disposable.id])
    await service.setAlwaysProtect(['Disposable.exe'])
    expect((await service.confirmClose(protectedAfterReview.token))[0].status).toBe('protected')
    expect(requested).toEqual([])
  }, 10000)

  test('imports a local single-stream PresentMon recording and checks coverage', async () => {
    const { baseline } = await fixture()
    const header = 'Application,ProcessID,SwapChainAddress,CPUStartTime,DisplayedTime'
    const frames = Array.from({ length: 288 }, (_, i) => `"game.exe",42,0xff,${i / 60},${1000 / 60}`)
    const csv = [header, ...frames].join('\n')
    expect(readPresentMon(csv, baseline)).toMatchObject({
      gameExecutable: 'game.exe', source: 'presentmon-display', reliable: true,
    })
    const ambiguous = [csv, ...frames.map(row => row.replace('0xff', '0xfe'))].join('\n')
    expect(readPresentMon(ambiguous, baseline).reliable).toBe(false)
    expect(readPresentMon(csv.replace('DisplayedTime', 'FrameTime'), baseline)).toMatchObject({
      source: 'presentmon-app', reliable: true,
    })
    expect(() => readPresentMon(csv.replaceAll('game.exe', 'other.exe'), baseline)).toThrow('No frame stream')
  }, 10000)

  test('groups process choices, attaches icons, and samples at the selected cadence', async () => {
    const { service, baseline, choices, disposable } = await fixture({
      ...conditions, durationSeconds: 7, sampleIntervalSeconds: 2,
    })
    expect(choices.find(choice => choice.id === 'node.exe')?.processCount).toBe(2)
    expect(choices.find(choice => choice.id === 'winopti.exe')).toBeUndefined()
    expect(choices.find(choice => choice.id === 'disposable.exe')).toEqual({
      id: 'disposable.exe', name: 'Disposable', executable: 'Disposable.exe', processCount: 1,
      icon: 'data:image/png;base64,fixture',
    })
    expect(disposable.icon).toBe('data:image/png;base64,fixture')
    expect(service.exportReport()).not.toContain('data:image')
    expect(baseline.conditions.sampleIntervalSeconds).toBe(2)
    expect(baseline.sampleCount).toBe(4)
    expect(baseline.timeline![1].second - baseline.timeline![0].second).toBeGreaterThan(1.8)
    expect(() => service.startCapture({ ...conditions, sampleIntervalSeconds: 5 }, 'baseline')).toThrow('15 seconds')
  }, 12000)
})

test('recurring scans honor the schedule, persist separately, and stop when disabled', async () => {
  let due: (() => void) | undefined
  let waitMs = 0
  let completed!: (state: RecurringScanState) => void
  const latest = new Promise<RecurringScanState>(resolve => { completed = resolve })
  const { service, baseline, requested, statePath, disposable } = await fixture(conditions, {
    after: (callback, delayMs) => {
      expect(due).toBeUndefined()
      due = () => { due = undefined; callback() }
      waitMs = delayMs
      return () => { due = undefined }
    },
    onChange: state => { if (state.latest && !state.running) completed(state) },
  })
  expect(service.getState().recurring.enabled).toBe(false)
  await expect(service.setRecurring({ enabled: true, intervalMinutes: 0 })).rejects.toThrow('1 to 60')
  await expect(service.setRecurring({ enabled: true, intervalMinutes: 1 })).rejects.toThrow('Select a game')
  await service.setRecurring({ enabled: true, intervalMinutes: 2, conditions })
  expect(waitMs).toBe(120_000)
  await service.setRecurring({ enabled: true, intervalMinutes: 1 })
  expect(waitMs).toBe(60_000)

  const review = service.prepareClose([disposable.id])
  due!()
  expect(service.getState().recurring.running).toBe(false)
  service.cancelClose(review.token)
  due!()
  expect(service.getState().recurring.running).toBe(true)
  expect(() => service.markStutter()).toThrow('manual capture')
  service.startCapture(conditions, 'baseline')
  expect(service.getState().recurring.running).toBe(false)
  due!()
  expect(service.getState().recurring.running).toBe(false)
  service.cancelCapture()
  service.setSuspended(true)
  expect(due).toBeUndefined()
  service.setSuspended(false)
  expect(waitMs).toBe(60_000)
  due!()
  const finished = await latest
  expect(finished.latest?.sampleCount).toBeGreaterThanOrEqual(3)
  expect(service.getState().baseline?.id).toBe(baseline.id)
  expect(service.getState().followup).toBeNull()
  expect(requested).toEqual([])

  due!()
  expect(service.getState().recurring.running).toBe(true)
  await service.setRecurring({ enabled: false, intervalMinutes: 1 })
  expect(service.getState().recurring.running).toBe(false)
  expect(service.getState().recurring.nextScanAt).toBeNull()
  expect(due).toBeUndefined()
  const reopened = await createWinOptiService({ ownPid, statePath, helperPath: '' })
  expect(reopened.getState().recurring).toMatchObject({
    enabled: false, intervalMinutes: 1, latest: { id: finished.latest!.id },
  })
  await service.setRecurring({ enabled: true, intervalMinutes: 1 })
  const enabledAgain = await createWinOptiService({ ownPid, statePath, helperPath: '' })
  expect(enabledAgain.getState().recurring.nextScanAt).toBeGreaterThan(Date.now())
  enabledAgain.dispose()
  reopened.dispose()
}, 15000)
