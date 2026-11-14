import { matchesAlwaysProtect } from './shared/winopti.ts'

const MiB = 1024 ** 2

export const previewPower = { source: 'plugged-in', batteryPercent: 86, saver: false }
export const previewConditions = {
  game: 'Apex Legends', gameExecutable: 'r5apex.exe', scene: 'Firing range loop',
  graphics: 'High · 1440p', frameCap: '144', durationSeconds: 60, sampleIntervalSeconds: 2,
}

const resources = (cpu, memory, disk, total) => ({
  backgroundCpuPercent: cpu, memoryPressurePercent: memory,
  diskBytesPerSecond: disk * MiB, systemCpuPercent: total,
})

function app({ id, name, executable, processCount, cpu, memory, io, peak, marker, reason, observations, disposition = 'candidate' }) {
  return {
    id, name, executable, processCount, disposition, reason, observations,
    average: { cpuPercent: cpu, memoryBytes: memory * MiB, ioBytesPerSecond: io * MiB },
    peak: { cpuPercent: peak, memoryBytes: memory * MiB, ioBytesPerSecond: io * 2 * MiB },
    markerPeak: { cpuPercent: marker, memoryBytes: memory * MiB, ioBytesPerSecond: io * 1.6 * MiB },
  }
}

const findings = [
  app({ id: 'chrome', name: 'Google Chrome', executable: 'chrome.exe', processCount: 12, cpu: 8.4, memory: 1434, io: 1.2, peak: 18.2, marker: 18.2,
    observations: ['8.4% average CPU and 1.4 GB working set.', 'CPU reached 18.2% within 2 seconds of a stutter mark.'],
    reason: 'Closing unused tabs or windows may free CPU time and memory.' }),
  app({ id: 'discord', name: 'Discord', executable: 'Discord.exe', processCount: 5, cpu: 4.1, memory: 624, io: 0.5, peak: 8.8, marker: 7.5,
    observations: ['4.1% average CPU and 624 MB working set.', 'CPU reached 7.5% near a stutter mark.'],
    reason: 'Closing Discord may reduce background CPU activity while you play.' }),
  app({ id: 'onedrive', name: 'Microsoft OneDrive', executable: 'OneDrive.exe', processCount: 2, cpu: 1.6, memory: 188, io: 8.4, peak: 4.5, marker: 3.7,
    observations: ['8.4 MB/s average process I/O and 188 MB working set.', 'Process I/O includes file, network, and device activity.'],
    reason: 'Closing OneDrive may reduce I/O while it is syncing.' }),
  app({ id: 'vite', name: 'Vite dev server', executable: 'node.exe', processCount: 3, cpu: 1.2, memory: 276, io: 0.3, peak: 2.1, marker: 1.8,
    observations: ['1.2% average CPU and 276 MB working set.'], reason: 'Active Vite dev server', disposition: 'protected' }),
  app({ id: 'node', name: 'Node.js', executable: 'node.exe', processCount: 1, cpu: 0.3, memory: 66, io: 0.1, peak: 0.8, marker: 0.3,
    observations: ['0.3% average CPU and 66 MB working set.'], reason: 'Could not identify this Node.js workload.', disposition: 'protected' }),
]

export const previewProcesses = [
  { id: 'apex', name: previewConditions.game, executable: previewConditions.gameExecutable, processCount: 1 },
  ...findings.filter(item => item.id !== 'vite').map(({ id, name, executable, processCount }) => ({ id, name, executable, processCount })),
]

const cpuShape = [11, 12, 11, 16, 14, 18, 15, 19, 16, 21, 19, 20, 33, 37, 32, 24, 18, 17, 20, 21, 18, 16, 20, 18, 28, 33, 27, 21, 18, 16, 16]

function frameTimes(conditions, improvement) {
  const count = Math.round(conditions.durationSeconds * 1000 / (improvement ? 7.9 : 8.7))
  const timesMs = Array.from({ length: count }, (_, index) => {
    if (index % (improvement ? 151 : 63) === 0) return improvement ? 23 + (index % 13) : 37 + (index % 17)
    if (index % 17 === 0) return improvement ? 13 + (index % 4) : 20 + (index % 7)
    return (improvement ? 6.6 : 7.1) + (index % 19) / 12
  })
  const ratio = conditions.durationSeconds * 1000 / timesMs.reduce((sum, value) => sum + value, 0)
  return { gameExecutable: conditions.gameExecutable, durationSeconds: conditions.durationSeconds,
    reliable: true, source: 'preview', timesMs: timesMs.map(value => value * ratio) }
}

export function previewCapture({ conditions = previewConditions, phase = 'baseline', markers, scenario = 'improved', closeResults = [], alwaysProtect = [] } = {}) {
  const after = phase === 'followup'
  const duration = conditions.durationSeconds
  const interval = conditions.sampleIntervalSeconds ?? 1
  const sampleCount = Math.ceil(duration / interval)
  const timestamp = Date.now() - (after ? 0 : duration * 1000)
  const closed = new Set(after ? closeResults.filter(item => item.status === 'closed').map(item => item.id) : [])
  const improved = closed.size > 0 && scenario === 'improved'
  const savings = after && closed.size ? 0.46 : 1
  const defaultMarkers = [duration * 0.42, duration * 0.8].slice(0, improved ? 1 : 2)
  const stutterMarks = markers ?? defaultMarkers
  const nearSpike = stutterMarks.some(mark => defaultMarkers.some(spike => Math.abs(mark - spike) <= 2))
  return {
    id: `preview-${phase}-${timestamp}`, startedAt: timestamp, durationSeconds: duration, conditions, power: previewPower,
    powerChanged: false, sampleCount, markers: stutterMarks,
    resources: resources(18.6 * savings, savings < 1 ? 49.2 : 62.4, savings < 1 ? 4.5 : 10.8, 57.3 * (savings < 1 ? 0.76 : 1)),
    findings: findings.filter(item => !closed.has(item.id)).map(item => {
      const finding = nearSpike ? item : {
        ...item,
        observations: item.observations.filter(note => !/near|within/.test(note)),
        markerPeak: { cpuPercent: null, memoryBytes: null, ioBytesPerSecond: null },
      }
      if (item.executable.toLowerCase() === conditions.gameExecutable.toLowerCase()) {
        return { ...finding, disposition: 'protected', reason: 'Game process selected for this capture' }
      }
      return matchesAlwaysProtect(alwaysProtect, item.executable, item.name)
        ? { ...finding, disposition: 'protected', reason: 'Always protect list' } : finding
    }),
    timeline: Array.from({ length: sampleCount }, (_, index) => {
      const cpu = cpuShape[Math.round(index * (cpuShape.length - 1) / Math.max(1, sampleCount - 1))]
      return { second: index * interval,
        resources: resources(cpu * savings, (55 + (index % 13)) * (savings < 1 ? 0.82 : 1), (4 + cpu * 0.34 + index % 4) * savings, cpu + 30) }
    }),
    frameTimes: frameTimes(conditions, improved),
  }
}

export const previewCloseResults = [
  { id: 'chrome', name: 'Google Chrome', status: 'closed', detail: 'The app exited after a normal close request.' },
  { id: 'discord', name: 'Discord', status: 'stayed-open', detail: 'The app stayed open. Check its window or system tray.' },
]

export function previewState(scenario) {
  return {
    baseline: previewCapture({ scenario }),
    followup: scenario ? previewCapture({ phase: 'followup', scenario, closeResults: previewCloseResults }) : null,
    closeResults: scenario ? previewCloseResults : [],
    alwaysProtect: [], power: previewPower,
  }
}
