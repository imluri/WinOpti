import React, { useEffect, useId, useState } from 'react'
import { Icon } from './icons'

const second = 1_000
const historyWindow = 60 * second
const GiB = 1024 ** 3
const MiB = 1024 ** 2
const integer = new Intl.NumberFormat()
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const valid = value => Number.isFinite(value) && value >= 0
const percent = value => valid(value) ? `${Math.round(value)}%` : 'Unavailable'
const bytes = value => valid(value) ? `${(value / GiB).toFixed(1)} GiB` : 'Unavailable'
const count = value => valid(value) ? integer.format(value) : 'Unavailable'
const rate = value => {
  if (!valid(value)) return 'Unavailable'
  if (value === 0) return '0 B/s'
  if (value >= MiB) return `${(value / MiB).toFixed(1)} MiB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB/s`
  return `${Math.round(value)} B/s`
}
const ratio = (used, total) => valid(used) && valid(total) && total > 0 ? used / total * 100 : null
const sumRates = (read, write) => valid(read) && valid(write) ? read + write : null

function uptime(value) {
  if (!valid(value)) return 'Unavailable'
  const days = Math.floor(value / 86400)
  const hours = Math.floor(value / 3600) % 24
  const minutes = Math.floor(value / 60) % 60
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ')
}

const resources = [
  { id: 'cpu', label: 'CPU', icon: 'chip', title: 'CPU utilization', value: sample => sample?.cpuPercent,
    detail: () => 'Total processor usage', format: percent },
  { id: 'gpu', label: 'GPU', icon: 'gpu', title: 'GPU utilization', value: sample => sample?.gpuPercent,
    detail: () => 'Busiest graphics engine', format: percent },
  { id: 'memory', label: 'Memory', icon: 'memory', title: 'Physical memory usage',
    value: sample => ratio(sample?.memoryUsedBytes, sample?.memoryTotalBytes), format: percent,
    detail: sample => valid(sample?.memoryUsedBytes) && valid(sample?.memoryTotalBytes)
      ? `${bytes(sample.memoryUsedBytes)} of ${bytes(sample.memoryTotalBytes)}` : 'Physical memory in use' },
  { id: 'storage', label: 'Storage', icon: 'disk', title: 'Disk throughput',
    value: sample => sumRates(sample?.diskReadBytesPerSecond, sample?.diskWriteBytesPerSecond), format: rate,
    detail: () => 'Physical disk read + write' },
]

const sampleHardware = {
  cpu: { name: 'AMD Ryzen 7 7800X3D', cores: 8, logicalProcessors: 16 },
  memoryTotalBytes: 32 * GiB,
  gpus: [{ name: 'NVIDIA GeForce RTX 4070', dedicatedBytes: 12 * GiB, sharedBytes: 16 * GiB }],
  drives: [{ letter: 'C:', label: 'Windows', totalBytes: 931.5 * GiB, freeBytes: 416 * GiB }],
}

function makeExample() {
  const now = Date.now()
  const workload = [22, 24, 26, 25, 24, 34, 46, 59, 52, 43, 43, 40, 44, 37, 33, 38, 36, 37, 42, 35, 39]
  return Array.from({ length: 61 }, (_, index) => {
    const load = workload[Math.floor(index / 3)]
    return {
      at: now - historyWindow + index * second,
      cpuPercent: load + Math.sin(index * 1.9) * 3,
      memoryUsedBytes: (13.8 + index / 240 + Math.sin(index / 4) * .07) * GiB,
      memoryTotalBytes: 32 * GiB,
      memoryPressurePercent: 37,
      diskReadBytesPerSecond: (1.3 + Math.max(0, load - 38) * 1.1 + Math.abs(Math.cos(index)) * 2) * MiB,
      diskWriteBytesPerSecond: (.4 + Math.max(0, load - 46) * .28 + Math.abs(Math.sin(index)) * .8) * MiB,
      diskActivePercent: 9,
      gpuPercent: 48 + load * .65 + Math.cos(index * 1.05) * 4,
      processCount: 167,
      uptimeSeconds: 18724,
    }
  })
}

function usePerformance(isPreview, fetchPerformance) {
  const [samples, setSamples] = useState(() => isPreview ? makeExample() : [])
  const [hardware, setHardware] = useState(() => isPreview ? sampleHardware : null)
  const [state, setState] = useState(isPreview ? 'sample' : 'loading')

  useEffect(() => {
    if (isPreview) return
    if (!fetchPerformance) {
      setState('unavailable')
      return
    }
    let running = false
    let stopped = false
    let timer
    async function poll() {
      if (running || stopped || document.hidden) return
      running = true
      const started = performance.now()
      try {
        const { hardware: device, sample } = await fetchPerformance()
        if (stopped) return
        if (!sample || !valid(sample.at)) {
          setState('unavailable')
          return
        }
        if (device) setHardware(device)
        setState('live')
        setSamples(previous => {
          if (sample.at === previous.at(-1)?.at) return previous
          if (sample.at < previous.at(-1)?.at) return [sample]
          const recent = previous.filter(item => item.at >= sample.at - historyWindow)
          return [...recent.slice(-60), sample]
        })
      } catch {
        if (!stopped) setState('unavailable')
      } finally {
        running = false
        if (!stopped && !document.hidden) {
          timer = setTimeout(poll, Math.max(150, second - (performance.now() - started)))
        }
      }
    }
    function onVisibilityChange() {
      clearTimeout(timer)
      if (!document.hidden) void poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isPreview, fetchPerformance])

  return { samples, hardware, state }
}

function trace(samples, value, max, width, height) {
  const last = samples.at(-1)?.at ?? 0
  const left = last - historyWindow
  const paths = []
  let active = []
  let previous
  for (const item of samples) {
    const reading = value(item)
    const outsideRange = item.at < left || item.at > last
    if (outsideRange || !valid(reading) || item.at - previous > 2.5 * second) {
      if (active.length) paths.push(active)
      active = []
    }
    if (!outsideRange && valid(reading)) {
      active.push([
        ((item.at - left) / historyWindow * width).toFixed(2),
        (height - Math.min(reading / max, 1) * height).toFixed(2),
      ])
    }
    previous = item.at
  }
  if (active.length) paths.push(active)
  return paths
}

const line = points => `M${points.map(point => point.join(',')).join(' L')}`

function Sparkline({ samples, resource }) {
  const max = resource.id === 'storage'
    ? Math.max(MiB, ...samples.map(sample => resource.value(sample) ?? 0))
    : 100
  const paths = trace(samples, resource.value, max, 100, 34)
  return <svg className="performance-spark" viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true">
    <path className="performance-gridline" d="M0 33.5h100" />
    {paths.map(points => points.length > 1
      ? <path key={points[0][0]} className="performance-line" d={line(points)} />
      : <circle key={points[0][0]} cx={points[0][0]} cy={points[0][1]} r="1" />)}
  </svg>
}

function plotMaximum(samples, series, isStorage) {
  if (!isStorage) return 100
  const peak = Math.max(MiB, ...samples.flatMap(sample => series.map(metric => metric.value(sample) ?? 0)))
  const step = 2 ** Math.floor(Math.log2(peak / 4))
  return Math.ceil(peak / (4 * step)) * 4 * step
}

function HistoryChart({ samples, resource, sample }) {
  const gradient = useId()
  const isStorage = resource.id === 'storage'
  const series = isStorage ? [
    { id: 'read', label: 'Read', value: sample => sample.diskReadBytesPerSecond },
    { id: 'write', label: 'Write', value: sample => sample.diskWriteBytesPerSecond },
  ] : [{ id: resource.id, label: resource.label, value: resource.value }]
  const maximum = plotMaximum(samples, series, isStorage)
  const format = isStorage ? rate : percent
  const width = 600
  const height = 150
  const plots = series.map(metric => trace(samples, metric.value, maximum, width, height))
  const empty = plots.every(paths => paths.length === 0)
  return <>
    <div className="performance-plot">
      <div className="performance-y-axis" aria-hidden="true">
        {[1, .75, .5, .25, 0].map(fraction => <span key={fraction}>{format(maximum * fraction)}</span>)}
      </div>
      <div className="performance-svg-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} className="performance-graph" preserveAspectRatio="none"
          role="img" aria-label={`${resource.title} over the last 60 seconds${empty ? ', waiting for readings' : ''}`}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="currentColor" stopOpacity=".18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity=".025" />
            </linearGradient>
          </defs>
          {[0, .25, .5, .75, 1].map(fraction => <path key={fraction} className="performance-gridline"
            d={`M0 ${height * fraction}h${width} M${width * fraction} 0v${height}`} />)}
          {plots.map((paths, index) => paths.map(points => <g key={`${index}-${points[0][0]}`} className={index ? 'performance-secondary-trace' : undefined}>
            {points.length > 1 ? <>
              {index === 0 && <path fill={`url(#${gradient})`} d={`${line(points)} L${points.at(-1)[0]},${height} L${points[0][0]},${height} Z`} />}
              <path className="performance-line" d={line(points)} />
            </> : <circle cx={points[0][0]} cy={points[0][1]} r="2" fill="currentColor" />}
          </g>))}
        </svg>
        {empty && <span className="performance-no-data">No readings available</span>}
        <div className="performance-x-axis" aria-hidden="true"><span>60 seconds ago</span><span>30 seconds ago</span><span>Now</span></div>
      </div>
    </div>
    <div className="performance-chart-details">
      {isStorage ? <>
        <span><i />Read <strong>{rate(sample?.diskReadBytesPerSecond)}</strong></span>
        <span><i className="performance-dashed" />Write <strong>{rate(sample?.diskWriteBytesPerSecond)}</strong></span>
        <span>Disk active <strong>{percent(sample?.diskActivePercent)}</strong></span>
      </> : resource.id === 'memory' ? <>
        <span>In use <strong>{bytes(sample?.memoryUsedBytes)}</strong></span>
        <span>Commit pressure <strong>{percent(sample?.memoryPressurePercent)}</strong></span>
      </> : resource.id === 'cpu' ? <>
        <span>Processes <strong>{count(sample?.processCount)}</strong></span>
        <span>Uptime <strong>{uptime(sample?.uptimeSeconds)}</strong></span>
      </> : <span>Busiest engine <strong>{percent(sample?.gpuPercent)}</strong></span>}
    </div>
  </>
}

function HardwareRow({ icon, title, children }) {
  return <div className="performance-hardware-row">
    <div className="metric-icon"><Icon name={icon} size={16} /></div>
    <div className="performance-hardware-copy"><h3>{title}</h3>{children}</div>
  </div>
}

function Hardware({ hardware, sample }) {
  const cpu = hardware?.cpu
  const adapters = hardware?.gpus ?? []
  const drives = hardware?.drives ?? []
  const threads = [
    valid(cpu?.cores) ? `${count(cpu.cores)} ${cpu.cores === 1 ? 'core' : 'cores'}` : null,
    valid(cpu?.logicalProcessors) ? `${count(cpu.logicalProcessors)} logical processors` : null,
  ].filter(Boolean).join(' · ')
  return <section className="panel performance-hardware" aria-labelledby="performance-hardware-heading">
    <div className="panel-heading"><h2 id="performance-hardware-heading">Hardware</h2></div>
    <HardwareRow icon="chip" title="Processor">
      <strong>{cpu?.name || 'Unavailable'}</strong>
      {threads && <p>{threads}</p>}
    </HardwareRow>
    <HardwareRow icon="memory" title="Physical memory">
      <strong>{bytes(hardware?.memoryTotalBytes ?? sample?.memoryTotalBytes)}</strong>
    </HardwareRow>
    <HardwareRow icon="gpu" title="Graphics">
      {adapters.length ? adapters.map((gpu, index) => <div className="performance-device" key={`${gpu.name}-${index}`}>
        <strong>{gpu.name || 'Graphics adapter'}</strong>
        <p>{valid(gpu.dedicatedBytes) ? `${bytes(gpu.dedicatedBytes)} dedicated` : 'Dedicated memory unavailable'}
          {valid(gpu.sharedBytes) && ` · ${bytes(gpu.sharedBytes)} shared`}</p>
      </div>) : <strong>Unavailable</strong>}
    </HardwareRow>
    <HardwareRow icon="disk" title="Storage volumes">
      {drives.length ? drives.map(drive => <div className="performance-device" key={drive.letter}>
        <strong>{drive.letter}{drive.label ? ` · ${drive.label}` : ''}</strong>
        <p>{bytes(drive.totalBytes)} capacity · {bytes(drive.freeBytes)} free at first read</p>
      </div>) : <strong>Unavailable</strong>}
    </HardwareRow>
  </section>
}

export function PerformancePage({ isPreview, bridge }) {
  return <PerformanceView key={isPreview ? 'preview' : 'live'} isPreview={isPreview} fetchPerformance={bridge?.getPerformance} />
}

function PerformanceView({ isPreview, fetchPerformance }) {
  const [selected, setSelected] = useState('cpu')
  const { samples, hardware, state } = usePerformance(isPreview, fetchPerformance)
  const latest = samples.at(-1)
  const current = state === 'unavailable' ? null : latest
  const resource = resources.find(metric => metric.id === selected)
  const status = state === 'loading' ? 'Connecting to Windows…'
    : state === 'unavailable' ? latest ? 'Live readings interrupted' : 'Windows readings unavailable'
      : state === 'sample' ? 'Example readings'
        : 'Updating every second'

  return <>
    <header className="page-heading performance-heading">
      <div><h1>System performance</h1><p>Monitor resource usage and see the hardware Windows detects.</p></div>
      <div className="performance-status" role="status"><span className={`status-dot${state === 'live' ? ' live-dot' : ''}`} />{status}</div>
    </header>
    <div className="performance-resources" role="group" aria-label="Performance resource">
      {resources.map(metric => {
        const reading = metric.value(current)
        return <button key={metric.id} type="button" className="performance-resource" aria-pressed={selected === metric.id}
          aria-controls="performance-history" onClick={() => setSelected(metric.id)}>
          <span className="performance-resource-title"><Icon name={metric.icon} size={16} />{metric.label}</span>
          <strong className={valid(reading) ? undefined : 'performance-resource-unavailable'}>{metric.format(reading)}</strong>
          <span className="performance-resource-detail">{metric.detail(current)}</span>
          <Sparkline resource={metric} samples={samples} />
        </button>
      })}
    </div>
    <div className="performance-detail-grid">
      <section className="panel performance-history" id="performance-history" aria-labelledby="performance-history-title">
        <div className="panel-heading">
          <div><h2 id="performance-history-title">{resource.title}</h2><p>Last 60 seconds</p></div>
          {latest && !isPreview && <time dateTime={new Date(latest.at).toISOString()} title="Last sample">{time.format(latest.at)}</time>}
        </div>
        <HistoryChart samples={samples} resource={resource} sample={current} />
      </section>
      <Hardware hardware={hardware} sample={current} />
    </div>
  </>
}
