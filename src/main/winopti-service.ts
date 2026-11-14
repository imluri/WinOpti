import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { version } from '../../package.json'
import {
  analyzeCapture, classifyApps, compareCaptures, minimumCaptureDuration, recurringScanInterval, sampleIntervals,
  type Capture, type CaptureConditions, type CloseResult, type PowerStatus,
  type ProcessIdentity, type RawProcess, type RecurringScanSettings, type RecurringScanState, type Snapshot,
} from '../shared/winopti'
import { readPresentMon } from './presentmon'
import { createWindowsPlatform } from './winopti-platform'
export { createWindowsPlatform } from './winopti-platform'
export { createLiveProcesses } from './live-processes'

type Phase = 'baseline' | 'followup'
type Platform = Pick<ReturnType<typeof createWindowsPlatform>, 'snapshot' | 'requestClose'>
type History = { baseline: Capture | null; followup: Capture | null; closeResults: CloseResult[]; alwaysProtect: string[] }
type Recording = {
  phase: Phase | 'recurring'; startedAt: number; conditions: CaptureConditions & { sampleIntervalSeconds: number };
  snapshots: Snapshot[]; markers: number[]; endTimer?: ReturnType<typeof setTimeout>;
  timer?: ReturnType<typeof setInterval>; pending?: Promise<void>; finishing?: boolean;
}
type Confirmation = { token: string; expiresAt: number; ids: string[] }

const unknownPower: PowerStatus = { source: 'unknown', batteryPercent: null, saver: null }
const emptyHistory = (): History => ({ baseline: null, followup: null, closeResults: [], alwaysProtect: [] })
const normalize = (value: string) => value.toLowerCase()

function validRecurringInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= recurringScanInterval.minimum && value <= recurringScanInterval.maximum
}

function stringField(input: unknown, label: string, limit = 160) {
  if (typeof input !== 'string' || input.length > limit) throw new Error(`Invalid ${label}.`)
  return input.trim()
}

function validateConditions(input: CaptureConditions): Recording['conditions'] {
  if (!input || !Number.isInteger(input.durationSeconds) || input.durationSeconds < 5 || input.durationSeconds > 300) {
    throw new Error('Choose a capture duration between 5 and 300 seconds.')
  }
  const interval = input.sampleIntervalSeconds ?? 1
  if (!(sampleIntervals as readonly number[]).includes(interval)) {
    throw new Error('Choose a sampling interval of 1, 2, 3, or 5 seconds.')
  }
  const minimum = minimumCaptureDuration(interval)
  if (input.durationSeconds < minimum) throw new Error(`Record for at least ${minimum} seconds at this sampling interval.`)
  const gameExecutable = stringField(input.gameExecutable, 'game executable', 260)
  if (!/^[^<>:"/\\|?*\x00-\x1f]+\.exe$/i.test(gameExecutable)) {
    throw new Error('Enter the game executable name, such as game.exe.')
  }
  return {
    game: stringField(input.game, 'game name'),
    gameExecutable,
    scene: stringField(input.scene, 'scene or route'),
    graphics: stringField(input.graphics, 'graphics settings'),
    frameCap: stringField(input.frameCap, 'frame cap'),
    durationSeconds: input.durationSeconds,
    sampleIntervalSeconds: interval,
  }
}

function matchesIdentity(actual: RawProcess, expected: ProcessIdentity) {
  return actual.pid === expected.pid && actual.startedAt === expected.startedAt &&
    actual.executable !== null && normalize(actual.executable) === normalize(expected.executable) &&
    (!expected.creationToken || actual.creationToken === expected.creationToken)
}

export async function createWinOptiService(options: {
  statePath: string; helperPath: string; ownPid: number; platform?: Platform;
  getIcon?: (executable: string) => Promise<string | null>;
  closeWaitMs?: number;
  onRecurringChanged?: (state: RecurringScanState) => void;
  scheduleRecurring?: (callback: () => void, delayMs: number) => () => void;
}) {
  const platform = options.platform ?? createWindowsPlatform(options.helperPath)
  let history = emptyHistory()
  let recurring: RecurringScanSettings = { enabled: false, intervalMinutes: recurringScanInterval.default, conditions: null }
  let latestRecurring: Capture | null = null
  try {
    const saved = JSON.parse(await readFile(options.statePath, 'utf8'))
    if (saved.version === 1 && Array.isArray(saved.history?.alwaysProtect) && Array.isArray(saved.history?.closeResults)) {
      history = saved.history
    }
    if (saved.version === 1 && validRecurringInterval(saved.recurring?.intervalMinutes)) {
      recurring.intervalMinutes = saved.recurring.intervalMinutes
      latestRecurring = saved.recurring.latest ?? null
      try {
        if (saved.recurring.conditions) recurring.conditions = validateConditions(saved.recurring.conditions)
        recurring.enabled = saved.recurring.enabled === true && recurring.conditions !== null
      } catch {
        // Leave a stale or invalid schedule disabled.
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }

  let power = unknownPower
  let recording: Recording | undefined
  let targets: Record<string, ProcessIdentity[]> = {}
  let confirmation: Confirmation | undefined
  let closing = false
  let installingUpdate = false
  let saving = Promise.resolve()
  let pendingSaves = 0
  let nextScanAt: number | null = null
  let cancelDueTimer: (() => void) | undefined
  let recurringError: string | null = null
  let suspended = false
  let disposed = false

  const recurringState = (): RecurringScanState => ({
    ...recurring, nextScanAt, running: recording?.phase === 'recurring', latest: latestRecurring, error: recurringError,
  })
  const publishRecurring = () => options.onRecurringChanged?.(recurringState())

  function scheduleNext() {
    cancelDueTimer?.()
    cancelDueTimer = undefined
    nextScanAt = null
    if (recurring.enabled && !suspended && !disposed) {
      const delayMs = recurring.intervalMinutes * 60_000
      nextScanAt = Date.now() + delayMs
      if (options.scheduleRecurring) {
        cancelDueTimer = options.scheduleRecurring(runRecurringIfIdle, delayMs)
      } else {
        const timer = setTimeout(runRecurringIfIdle, delayMs)
        cancelDueTimer = () => clearTimeout(timer)
      }
    }
    publishRecurring()
  }

  function runRecurringIfIdle() {
    cancelDueTimer = undefined
    if (!recurring.enabled || !recurring.conditions || suspended || disposed) return
    const awaitingConfirmation = confirmation && confirmation.expiresAt > Date.now()
    if (!recording && !closing && !installingUpdate && !awaitingConfirmation) {
      const current = beginRecording(validateConditions(recurring.conditions), 'recurring')
      recurringError = null
      current.endTimer = setTimeout(() => {
        const endedAt = current.startedAt + current.conditions.durationSeconds * 1000
        void finishRecording(current, endedAt).catch(() => {
          if (disposed || suspended) return
          recurringError = 'The recurring scan could not finish. WinOpti will try again at the next interval.'
          publishRecurring()
        })
      }, current.conditions.durationSeconds * 1000)
    }
    scheduleNext()
  }

  async function setRecurring(input: Omit<RecurringScanSettings, 'conditions'> & { conditions?: CaptureConditions }) {
    if (installingUpdate) throw new Error('WinOpti is restarting to install an update.')
    if (!input || typeof input.enabled !== 'boolean' || !validRecurringInterval(input.intervalMinutes)) {
      throw new Error('Choose a recurring scan interval from 1 to 60 whole minutes.')
    }
    const conditions = input.conditions === undefined ? recurring.conditions : validateConditions(input.conditions)
    if (input.enabled && !conditions) throw new Error('Select a game process in the scan setup first.')
    const previous = recurring
    const updated = { enabled: input.enabled, intervalMinutes: input.intervalMinutes, conditions }
    recurring = updated
    if (!updated.enabled || input.conditions) stopRecurringCapture()
    recurringError = null
    scheduleNext()
    try {
      await persist()
    } catch (error) {
      if (recurring === updated) {
        recurring = previous
        scheduleNext()
      }
      throw error
    }
    return recurringState()
  }

  function setSuspended(value: boolean) {
    if (suspended === value) return
    suspended = value
    if (suspended) stopRecurringCapture()
    scheduleNext()
  }

  function persist() {
    const json = JSON.stringify({ version: 1, history, recurring: { ...recurring, latest: latestRecurring } })
    pendingSaves++
    const save = saving.catch(() => {}).then(async () => {
      await mkdir(path.dirname(options.statePath), { recursive: true })
      const temporary = `${options.statePath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, json, { encoding: 'utf8', flag: 'wx' })
        await rename(temporary, options.statePath)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    }).finally(() => { pendingSaves-- })
    saving = save
    return save
  }

  async function snapshot() {
    const reading = await platform.snapshot()
    power = reading.power
    return reading
  }

  async function listProcesses() {
    if ((recording && recording.phase !== 'recurring') || closing) {
      throw new Error('Refresh running processes after the current operation finishes.')
    }
    const current = recording
    if (current && !current.snapshots.length) await current.pending
    const { processes } = current?.snapshots.at(-1) ?? (current ? { processes: [] } : await snapshot())
    const ownProcess = processes.find(process => process.pid === options.ownPid)
    if (!ownProcess?.sessionId) return []

    const groups = new Map<string, {
      id: string; name: string; executable: string; processCount: number;
      iconPath: string | null; hasWindow: boolean;
    }>()
    for (const process of processes) {
      if (process.sessionId !== ownProcess.sessionId || !process.executable || !process.creationToken ||
          process.pid === options.ownPid || normalize(process.executable) === normalize(ownProcess.executable ?? '')) continue
      const executable = path.win32.basename(process.executable)
      const id = normalize(executable)
      if (!id.endsWith('.exe') || id === 'winopti.exe' || id === 'winopti-platform.exe') continue
      const hasWindow = process.windowTitle !== null
      const existing = groups.get(id)
      if (!existing || (hasWindow && !existing.hasWindow)) {
        groups.set(id, {
          id, name: process.displayName || executable, executable, iconPath: process.iconPath ?? null,
          processCount: (existing?.processCount ?? 0) + 1, hasWindow,
        })
      } else {
        existing.processCount++
      }
    }
    const ordered = [...groups.values()].sort((a, b) => Number(b.hasWindow) - Number(a.hasWindow) || a.name.localeCompare(b.name))
    return Promise.all(ordered.map(async ({ hasWindow, iconPath, ...choice }) => ({
      ...choice, icon: iconPath && options.getIcon ? await options.getIcon(iconPath) : null,
    })))
  }

  async function attachFindingIcons(capture: Capture, snapshots: Snapshot[]) {
    if (!options.getIcon) return
    const trustedPaths = new Map<string, string>()
    for (const reading of snapshots) {
      for (const process of reading.processes) {
        if (process.executable && process.iconPath) trustedPaths.set(normalize(process.executable), process.iconPath)
      }
    }
    await Promise.all(capture.findings.filter((finding, index) => index < 3 || finding.disposition !== 'other').map(async finding => {
      const iconPath = finding.executable && trustedPaths.get(normalize(finding.executable))
      if (iconPath) finding.icon = await options.getIcon!(iconPath)
    }))
  }

  function sample(current: Recording) {
    if (current.pending || current.finishing || recording !== current) return
    current.pending = snapshot().then(reading => {
      if (recording !== current) return
      // Windows and Electron can round the same instant differently.
      const at = Math.max(current.startedAt, reading.at)
      current.snapshots.push({ ...reading, at })
    }).catch(() => {
      // Gaps are represented by missing readings and handled by capture coverage.
    }).finally(() => { current.pending = undefined })
  }

  function beginRecording(conditions: Recording['conditions'], phase: Recording['phase']) {
    const current: Recording = { phase, conditions, startedAt: Date.now(), snapshots: [], markers: [] }
    recording = current
    sample(current)
    current.timer = setInterval(() => {
      if (Date.now() < current.startedAt + current.conditions.durationSeconds * 1000) sample(current)
      else clearInterval(current.timer)
    }, conditions.sampleIntervalSeconds * 1000)
    return current
  }

  function startCapture(input: CaptureConditions, phase: Phase) {
    if ((recording && recording.phase !== 'recurring') || closing || installingUpdate) throw new Error('Another WinOpti operation is in progress.')
    if (phase !== 'baseline' && phase !== 'followup') throw new Error('Unknown capture.')
    if (phase === 'followup' && !history.baseline) throw new Error('Record a baseline first.')
    const conditions = validateConditions(input)
    confirmation = undefined
    stopRecurringCapture()
    return { startedAt: beginRecording(conditions, phase).startedAt }
  }

  function finishCapture() {
    const current = recording
    if (!current || current.phase === 'recurring' || current.finishing) throw new Error('There is no manual capture to finish.')
    const endedAt = Math.min(Date.now(), current.startedAt + current.conditions.durationSeconds * 1000)
    const minimum = minimumCaptureDuration(current.conditions.sampleIntervalSeconds)
    if (endedAt - current.startedAt < minimum * 1000) throw new Error(`Record for at least ${minimum} seconds.`)
    return finishRecording(current, endedAt)
  }

  async function finishRecording(current: Recording, endedAt: number) {
    if (recording !== current) return
    current.finishing = true
    clearInterval(current.timer)
    try {
      await current.pending
      if (recording !== current) return
      const snapshots = current.snapshots.filter(reading => reading.at <= endedAt)
      if (snapshots.length < 3) throw new Error('Windows returned too few samples. Try a longer capture.')
      if (current.phase === 'recurring' && endedAt - snapshots.at(-1)!.at > current.conditions.sampleIntervalSeconds * 2500) {
        throw new Error('Windows stopped returning samples before the capture ended.')
      }
      const result = analyzeCapture({
        id: randomUUID(), startedAt: current.startedAt, endedAt, snapshots, markers: current.markers,
        conditions: current.conditions, alwaysProtect: history.alwaysProtect, ownPid: options.ownPid,
      })
      await attachFindingIcons(result.capture, snapshots)
      if (recording !== current) return
      if (current.phase === 'baseline') {
        history = { ...history, baseline: result.capture, followup: null, closeResults: [] }
        targets = result.targets
      } else if (current.phase === 'followup') {
        history = { ...history, followup: result.capture }
      } else {
        const previous = latestRecurring
        latestRecurring = result.capture
        try {
          await persist()
        } catch (error) {
          if (latestRecurring === result.capture) latestRecurring = previous
          throw error
        }
        return result.capture
      }
      await persist()
      return result.capture
    } finally {
      if (recording === current) {
        recording = undefined
        if (current.phase === 'recurring') publishRecurring()
      }
    }
  }

  function stopRecording() {
    clearInterval(recording?.timer)
    clearTimeout(recording?.endTimer)
    recording = undefined
  }

  function stopRecurringCapture() {
    if (recording?.phase !== 'recurring') return
    stopRecording()
    publishRecurring()
  }

  function cancelCapture() {
    if (recording?.phase === 'recurring') return
    if (recording?.finishing) throw new Error('The capture is finishing.')
    stopRecording()
  }

  function markStutter() {
    if (!recording || recording.phase === 'recurring' || recording.finishing) throw new Error('Start a manual capture to mark a stutter.')
    const seconds = (Date.now() - recording.startedAt) / 1000
    if (seconds >= recording.conditions.durationSeconds) throw new Error('The capture has ended.')
    if (seconds - (recording.markers.at(-1) ?? -1) < 0.3) return recording.markers.at(-1)!
    recording.markers.push(seconds)
    return seconds
  }

  function prepareClose(ids: unknown) {
    confirmation = undefined
    if ((recording && recording.phase !== 'recurring') || closing || installingUpdate) throw new Error('Wait for the current operation to finish.')
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 ||
        ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw new Error('Choose the apps to review.')
    }
    const apps = ids.map(id => {
      const finding = history.baseline?.findings.find(entry => entry.id === id && entry.disposition === 'candidate')
      if (!finding || !Object.hasOwn(targets, id) || !targets[id]?.length) {
        throw new Error('Record a new baseline before requesting a close for these apps.')
      }
      return { id: finding.id, name: finding.name }
    })
    confirmation = { token: randomUUID(), expiresAt: Date.now() + 120_000, ids: [...ids] }
    stopRecurringCapture()
    return { token: confirmation.token, apps }
  }

  function cancelClose(token: unknown) {
    if (confirmation?.token === token) confirmation = undefined
  }

  async function closeApp(id: string, baseline: Capture): Promise<CloseResult> {
    const name = baseline.findings.find(finding => finding.id === id)!.name
    const result = (status: CloseResult['status'], detail: string): CloseResult => ({ id, name, status, detail })
    const expected = targets[id]
    const requested: ProcessIdentity[] = []
    const knownMembers = new Map<number, ProcessIdentity>()
    let skipped: CloseResult | undefined
    for (const target of expected) {
      const latest = await snapshot()
      const groups = classifyApps(latest, {
        conditions: baseline.conditions, ownPid: options.ownPid, alwaysProtect: history.alwaysProtect,
      })
      const process = latest.processes.find(entry => entry.pid === target.pid)
      if (!process) {
        skipped ??= result('exited', 'A process had already exited before the close request.')
        continue
      }
      if (!matchesIdentity(process, target)) {
        skipped = result('identity-changed', 'The process identity changed after the scan. No request was sent to it.')
        break
      }
      const group = groups.find(entry => entry.processes.some(member => member.pid === target.pid))
      if (!group || group.protection) {
        skipped = result('protected', group?.protection ?? 'WinOpti could not recheck this app’s protection status.')
        break
      }
      if (!group.windowTargets.some(member => member.pid === target.pid)) {
        skipped = result('no-window', 'No eligible window is available. Close the app manually if needed.')
        break
      }
      for (const member of group.processes) {
        if (member.startedAt !== null && member.executable) {
          knownMembers.set(member.pid, {
            pid: member.pid, startedAt: member.startedAt, executable: member.executable, creationToken: member.creationToken,
          })
        }
      }
      const attempt = await platform.requestClose(target)
      if (attempt.status !== 'requested') {
        skipped = result(attempt.status, attempt.detail)
        if (attempt.status === 'exited') continue
        break
      }
      requested.push(target)
    }

    if (!requested.length) return skipped ?? result('denied', 'No normal close was requested.')
    const deadline = Date.now() + (options.closeWaitMs ?? 4500)
    do {
      await delay(250)
      const latest = await snapshot()
      const remaining = latest.processes.some(process => {
        const member = knownMembers.get(process.pid)
        return member && matchesIdentity(process, member)
      })
      if (!remaining) {
        return skipped && skipped.status !== 'exited' ? skipped : result('closed', 'The app exited after the normal close request.')
      }
    } while (Date.now() < deadline)
    const partial = skipped?.detail ? ` ${skipped.detail}` : ''
    return result('stayed-open', `The app is still running. Check for a save prompt or close it manually.${partial}`)
  }

  async function confirmClose(token: unknown) {
    if (closing || recording || installingUpdate) throw new Error('Wait for the current operation to finish.')
    if (typeof token !== 'string' || confirmation?.token !== token ||
        Date.now() > confirmation.expiresAt || !history.baseline) {
      throw new Error('Review the selected apps again before closing them.')
    }
    const { ids } = confirmation
    const baseline = history.baseline
    confirmation = undefined
    closing = true
    try {
      const results: CloseResult[] = []
      for (const id of ids) {
        try {
          results.push(await closeApp(id, baseline))
        } catch {
          results.push({
            id, name: baseline.findings.find(finding => finding.id === id)!.name, status: 'denied',
            detail: 'WinOpti could not verify the close result. Check the app and close it manually if needed.',
          })
        }
      }
      const replaced = new Set(ids)
      history = { ...history, closeResults: [...history.closeResults.filter(item => !replaced.has(item.id)), ...results] }
      await persist()
      return history.closeResults
    } finally {
      closing = false
    }
  }

  async function setAlwaysProtect(input: unknown) {
    if (closing || installingUpdate) throw new Error('Wait for the current operation to finish.')
    if (!Array.isArray(input) || input.length > 200) throw new Error('Enter up to 200 app or executable names.')
    const names = new Map<string, string>()
    for (const item of input) {
      const name = stringField(item, 'protected app')
      if (name) names.set(normalize(name), name)
    }
    history = { ...history, alwaysProtect: [...names.values()] }
    await persist()
    return history.alwaysProtect
  }

  async function importFrameTimes(phase: Phase, csv: string) {
    if (phase !== 'baseline' && phase !== 'followup') throw new Error('Unknown capture.')
    if ((recording && recording.phase !== 'recurring') || closing || installingUpdate) throw new Error('Wait for the current operation to finish.')
    const capture = history[phase]
    if (!capture) throw new Error('Record the capture before importing frame times.')
    const updated = { ...capture, frameTimes: readPresentMon(csv, capture) }
    history = { ...history, [phase]: updated }
    await persist()
    return updated
  }

  function exportReport() {
    if (!history.baseline) throw new Error('Record a baseline before exporting.')
    const { baseline, followup, closeResults } = history
    const exportCapture = (capture: Capture | null) => capture && ({
      ...capture,
      frameTimes: capture.frameTimes && {
        gameExecutable: capture.frameTimes.gameExecutable, durationSeconds: capture.frameTimes.durationSeconds,
        reliable: capture.frameTimes.reliable, source: capture.frameTimes.source, frameCount: capture.frameTimes.timesMs.length,
      },
      findings: capture.findings.map(({ id: _id, icon: _icon, executable, ...finding }) => ({
        ...finding, executable: executable && path.win32.basename(executable),
      })),
    })
    return JSON.stringify({
      app: 'WinOpti', version, baseline: exportCapture(baseline), followup: exportCapture(followup),
      closeResults: closeResults.map(({ id: _id, ...result }) => result),
      comparison: followup && compareCaptures(baseline, followup),
    }, null, 2)
  }

  function reserveUpdateInstall() {
    if (disposed || recording || closing || installingUpdate || pendingSaves || (confirmation && confirmation.expiresAt > Date.now())) {
      return false
    }
    installingUpdate = true
    return true
  }

  scheduleNext()
  return {
    getState: () => ({ ...history, power, reviewAvailable: Object.keys(targets).length > 0, recurring: recurringState() }),
    refreshPower: async () => recording || closing ? power : (await snapshot()).power,
    listProcesses,
    startCapture, markStutter, finishCapture, cancelCapture, prepareClose, cancelClose, confirmClose, setAlwaysProtect,
    importFrameTimes, exportReport, setRecurring, setSuspended, reserveUpdateInstall,
    releaseUpdateInstall: () => { installingUpdate = false },
    dispose: () => {
      disposed = true
      cancelDueTimer?.()
      stopRecording()
      if ('dispose' in platform && typeof platform.dispose === 'function') platform.dispose()
    },
  }
}
