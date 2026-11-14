import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLiveProcesses, groupProcessCounters } from './live-processes'
import type { ProcessCounter, ProcessCounters } from '../shared/processes'

function process(pid: number, override: Partial<ProcessCounter> = {}): ProcessCounter {
  return {
    pid, parentPid: null, name: 'Browser.exe', creationToken: String(pid), sessionId: 1,
    executable: 'C:\\Apps\\Browser.exe', displayName: 'Browser', iconPath: null,
    cpuTimeMs: 200, workingSetBytes: 1000, ioBytes: 2000, diskBytesPerSecond: 0, gpuEngines: [],
    ...override,
  }
}

function sample(tickMs: number, ...processes: ProcessCounter[]): ProcessCounters {
  return { at: 1794600000000 + tickMs, tickMs, logicalCpus: 8, processes }
}

test('groups app processes and combines GPU work on the same engine before taking the maximum', () => {
  const previous = sample(1000, process(10), process(11))
  const current = sample(2000,
    process(0),
    process(10, { cpuTimeMs: 600, ioBytes: 6200, diskBytesPerSecond: 300,
      gpuEngines: [{ engine: 'GPU1-3D', percent: 19 }, { engine: 'GPU2-3D', percent: 28 }] }),
    process(11, { cpuTimeMs: 280, ioBytes: 3300, diskBytesPerSecond: 700,
      gpuEngines: [{ engine: 'GPU1-3D', percent: 17 }] }),
  )
  const [browser, extra] = groupProcessCounters(current, previous)
  assert.equal(extra, undefined)
  assert.equal(browser.name, 'Browser')
  assert.equal(browser.processCount, 2)
  assert.equal(browser.cpuPercent, 6)
  assert.equal(browser.memoryBytes, 2000)
  assert.equal(browser.gpuPercent, 36)
  assert.equal(browser.ioBytesPerSecond, 5500)
  assert.equal(browser.diskBytesPerSecond, 1000)
})

test('keeps same-name paths separate and leaves stale, reset, and unavailable readings blank', () => {
  const earlier = sample(1000, process(20), process(21, { executable: 'D:\\Other\\Browser.exe' }))
  const later = sample(2000,
    process(20, { creationToken: 'new', cpuTimeMs: 999, gpuEngines: null, workingSetBytes: null }),
    process(21, { executable: 'D:\\Other\\Browser.exe', cpuTimeMs: 100, ioBytes: null, diskBytesPerSecond: null }),
  )
  const [changed, other] = groupProcessCounters(later, earlier)
  assert.notEqual(changed.id, other.id)
  assert.equal(changed.cpuPercent, null)
  assert.equal(changed.memoryBytes, null)
  assert.equal(changed.gpuPercent, null)
  assert.equal(other.cpuPercent, null)
  assert.equal(other.ioBytesPerSecond, null)
  assert.equal(other.diskBytesPerSecond, null)
  assert.equal(other.gpuPercent, 0)
  const [stale] = groupProcessCounters(sample(6500, process(20, { cpuTimeMs: 800 })), earlier)
  assert.equal(stale.cpuPercent, null)
  assert.equal(stale.gpuPercent, null)
  assert.equal(stale.memoryBytes, 1000)
})

test('coalesces concurrent renderer polls and returns only the public row fields', async () => {
  let requests = 0
  const { getProcesses, getTarget } = createLiveProcesses(async () => {
    requests++
    return sample(1000, process(10))
  }, async () => null)
  const [first, second] = await Promise.all([getProcesses(), getProcesses()])
  assert.equal(requests, 1)
  assert.deepEqual(first, second)
  assert.equal(first.diskAt, null)
  assert.equal(first.rows[0].id, '1')
  assert.equal(getTarget('1'), undefined)
  assert.deepEqual(Object.keys(first.rows[0]).sort(), [
    'canInspect', 'canUninstall', 'cpuPercent', 'diskBytesPerSecond', 'executable', 'gpuPercent',
    'icon', 'id', 'ioBytesPerSecond', 'isSelf', 'memoryBytes', 'name', 'processCount',
  ])
})

test('marks WinOpti and keeps file paths private while limiting the uninstall handoff', async () => {
  const self = 'C:\\WinOpti\\WinOpti.exe'
  const windows = 'C:\\Windows\\explorer.exe'
  const browser = 'D:\\Apps\\Browser.exe'
  const { getProcesses, getTarget } = createLiveProcesses(async () => sample(1000,
    process(10, { executable: self, iconPath: self }),
    process(11, { executable: self, iconPath: self }),
    process(12, { executable: windows, iconPath: windows }),
    process(13, { executable: browser, iconPath: browser }),
    process(14, { executable: null, name: 'Unknown.exe' }),
  ), async () => null, { ownPid: 10 })
  const { rows } = await getProcesses()
  const winOpti = rows.find(row => row.isSelf)!
  assert.equal(winOpti.name, 'WinOpti')
  assert.equal(winOpti.processCount, 2)
  assert.equal(winOpti.canUninstall, false)
  assert.equal(rows.find(row => row.executable === 'explorer.exe')!.canUninstall, false)
  assert.equal(rows.find(row => row.executable === 'Unknown.exe')!.canInspect, false)
  const app = rows.find(row => row.executable === 'Browser.exe')!
  assert.equal(app.canUninstall, true)
  assert.deepEqual(getTarget(app.id), { executable: browser, canUninstall: true })
  assert.ok(!JSON.stringify(rows).includes('Apps'))
})
