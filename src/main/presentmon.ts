import path from 'node:path'
import { frameDurationTolerance, type Capture, type FrameTimes } from '../shared/winopti'

// PresentMon uses one CSV record per frame. Handle quoted fields and escaped quotes.
function csvFields(line: string) {
  return Array.from(line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g), match =>
    (match[1]?.replaceAll('""', '"') ?? match[2]).trim())
}

export function readPresentMon(csv: string, capture: Capture): FrameTimes {
  const [header, ...lines] = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const columns = csvFields(header).map(name => name.toLowerCase())
  const app = columns.indexOf('application')
  const pid = columns.indexOf('processid')
  const chain = columns.indexOf('swapchainaddress')
  const displayed = columns.indexOf('displayedtime')
  const displayChange = columns.indexOf('msbetweendisplaychange')
  const present = columns.indexOf('msbetweenpresents')
  const appFrame = columns.indexOf('frametime')
  const interval = [displayed, displayChange, present, appFrame].find(index => index >= 0)
  const timeColumn = ['cpustarttime', 'timeinseconds', 'cpustarttimeinseconds', 'timeinms', 'cpustarttimeinms'].find(name => columns.includes(name))
  const time = timeColumn ? columns.indexOf(timeColumn) : -1
  if (interval === undefined || [app, pid, chain, time].some(index => index < 0)) {
    throw new Error('Choose a PresentMon CSV with process, swap chain, relative timestamp, and frame interval columns.')
  }

  const game = capture.conditions.gameExecutable.toLowerCase()
  if (!game) throw new Error('Set the game executable when recording the capture before importing frame times.')
  const streams = new Map<string, { first: number; last: number; rows: number; timesMs: number[] }>()
  for (const line of lines) {
    const fields = csvFields(line)
    if (path.win32.basename(fields[app] ?? '').toLowerCase() !== game) continue
    if (!/^\d+$/.test(fields[pid] ?? '') || !fields[chain] || !fields[time]) continue
    const timestamp = Number(fields[time]) / (timeColumn?.endsWith('inms') ? 1000 : 1)
    if (!Number.isFinite(timestamp) || timestamp < 0) continue
    const key = `${fields[pid]}:${fields[chain]}`
    const stream = streams.get(key) ?? { first: timestamp, last: timestamp, rows: 0, timesMs: [] }
    stream.first = Math.min(stream.first, timestamp)
    stream.last = Math.max(stream.last, timestamp)
    stream.rows++
    const value = Number(fields[interval])
    if (Number.isFinite(value) && value > 0 && value <= 60_000) stream.timesMs.push(value)
    streams.set(key, stream)
  }

  const [primary, secondary] = [...streams.values()].sort((a, b) => b.timesMs.length - a.timesMs.length)
  if (!primary) throw new Error(`No frame stream for ${capture.conditions.gameExecutable} was found in that CSV.`)
  const durationSeconds = primary.last - primary.first
  const measuredSeconds = primary.timesMs.reduce((sum, ms) => sum + ms, 0) / 1000
  const durationTolerance = frameDurationTolerance(capture.durationSeconds)
  const reliable = primary.timesMs.length >= 120 &&
    primary.timesMs.length / primary.rows >= 0.9 &&
    (!secondary || secondary.timesMs.length <= primary.timesMs.length * 0.1) &&
    Math.abs(measuredSeconds - durationSeconds) <= durationTolerance &&
    Math.abs(capture.durationSeconds - durationSeconds) <= durationTolerance
  return {
    gameExecutable: game,
    timesMs: primary.timesMs,
    durationSeconds,
    reliable,
    source: interval === appFrame ? 'presentmon-app' : interval === present ? 'presentmon-present' : 'presentmon-display',
  }
}
