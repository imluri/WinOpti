import path from 'node:path'
import type { LiveProcesses, LiveProcessRow, ProcessCounter, ProcessCounters } from '../shared/processes'

type Metric = 'cpuPercent' | 'memoryBytes' | 'diskBytesPerSecond' | 'ioBytesPerSecond'
type ProcessGroup = Omit<LiveProcessRow, 'gpuPercent'> & {
  hasDisplayName: boolean
  iconPath: string | null
  engines: Map<string, number> | null
}

const metrics: Metric[] = ['cpuPercent', 'memoryBytes', 'diskBytesPerSecond', 'ioBytesPerSecond']
const valid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function rate(current: number | null | undefined, previous: number | null | undefined, scale: number) {
  return valid(current) && valid(previous) && current >= previous ? (current - previous) * scale : null
}

function groupIdentity(process: ProcessCounter) {
  return process.executable
    ? `${process.sessionId ?? 'unknown'}:${process.executable.toLowerCase()}`
    : `pid:${process.pid}:${process.creationToken ?? 'unknown'}`
}

export function groupProcessCounters(current: ProcessCounters, previous?: ProcessCounters) {
  const before = new Map(previous?.processes.map(process => [process.pid, process]))
  const elapsed = previous ? current.tickMs - previous.tickMs : 0
  const validInterval = elapsed >= 250 && elapsed <= 3500
  const groups = new Map<string, ProcessGroup>()

  for (const process of current.processes) {
    // PID 0 is the Windows idle accounting row.
    if (process.pid === 0) continue
    const id = groupIdentity(process)
    const executable = path.win32.basename(process.executable ?? process.name) || process.name
    const group = groups.get(id) ?? {
      id, name: process.displayName || executable, executable, processCount: 0,
      hasDisplayName: Boolean(process.displayName), iconPath: null, engines: new Map(),
      cpuPercent: 0, memoryBytes: 0, diskBytesPerSecond: 0, ioBytesPerSecond: 0,
    }
    if (!group.hasDisplayName && process.displayName) {
      group.name = process.displayName
      group.hasDisplayName = true
    }
    group.iconPath ??= process.iconPath
    group.processCount++

    const prior = before.get(process.pid)
    const old = validInterval && process.creationToken && process.creationToken === prior?.creationToken ? prior : undefined
    const values: Record<Metric, number | null> = {
      cpuPercent: old && current.logicalCpus > 0 && current.logicalCpus === previous?.logicalCpus
        ? rate(process.cpuTimeMs, old.cpuTimeMs, 100 / elapsed / current.logicalCpus) : null,
      memoryBytes: valid(process.workingSetBytes) ? process.workingSetBytes : null,
      diskBytesPerSecond: valid(process.diskBytesPerSecond) ? process.diskBytesPerSecond : null,
      ioBytesPerSecond: old ? rate(process.ioBytes, old.ioBytes, 1000 / elapsed) : null,
    }
    for (const metric of metrics) {
      const value = values[metric]
      const accumulated = group[metric]
      group[metric] = value === null || accumulated === null ? null : accumulated + value
    }
    if (!validInterval || process.gpuEngines === null) {
      group.engines = null
    } else if (group.engines) {
      for (const { engine, percent } of process.gpuEngines) {
        if (valid(percent)) group.engines.set(engine, (group.engines.get(engine) ?? 0) + percent)
      }
    }
    groups.set(id, group)
  }

  return [...groups.values()].map(({ engines, hasDisplayName: _hasDisplayName, ...group }) => {
    let busiest = 0
    if (engines) for (const percent of engines.values()) busiest = Math.max(busiest, percent)
    return {
      ...group,
      cpuPercent: group.cpuPercent === null ? null : Math.min(100, group.cpuPercent),
      gpuPercent: engines ? Math.min(100, busiest) : null,
    }
  })
}

export function createLiveProcesses(
  sample: () => Promise<ProcessCounters>,
  loadIcon: (executable: string) => Promise<string | null>,
) {
  let previous: ProcessCounters | undefined
  let latest: LiveProcesses | undefined
  let receivedAt = 0
  let pending: Promise<LiveProcesses> | undefined
  const publicIds = new Map<string, number>()
  let nextId = 0
  const icons = new Map<string, { icon: string | null; expires: number }>()
  const loadingIcons = new Set<string>()

  function iconFor(executable: string) {
    const key = executable.toLowerCase()
    const cached = icons.get(key)
    if (cached && cached.expires > Date.now()) return cached.icon
    if (loadingIcons.size >= 8 || loadingIcons.has(key)) return null
    loadingIcons.add(key)
    void loadIcon(executable).catch(() => null).then(icon => {
      icons.delete(key)
      if (icons.size >= 512) icons.delete(icons.keys().next().value!)
      icons.set(key, { icon, expires: Date.now() + (icon ? 300_000 : 30_000) })
    }).finally(() => { loadingIcons.delete(key) })
    return null
  }

  function getProcesses() {
    if (pending) return pending
    if (latest && Date.now() - receivedAt < 950) return latest
    pending = sample().then(current => {
      const groups = groupProcessCounters(current, previous)
      previous = current
      // Prioritize app icons for the busiest visible rows without blocking telemetry.
      groups.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) || a.name.localeCompare(b.name))
      const activeIds = new Set(groups.map(group => group.id))
      for (const id of publicIds.keys()) {
        if (!activeIds.has(id)) publicIds.delete(id)
      }
      const rows = groups.map(({ id, iconPath, ...group }) => {
        if (!publicIds.has(id)) publicIds.set(id, ++nextId)
        return { ...group, id: String(publicIds.get(id)), icon: iconPath ? iconFor(iconPath) : null }
      })
      latest = { at: current.at, diskAt: current.diskAt ?? null, rows }
      receivedAt = Date.now()
      return latest
    }).finally(() => { pending = undefined })
    return pending
  }

  return getProcesses
}
