import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { compareCaptures, matchesAlwaysProtect, minimumCaptureDuration, sampleIntervals } from './shared/winopti'

const MiB = 1024 ** 2
const isMetric = value => Number.isFinite(value)
const percent = value => isMetric(value) ? `${value.toFixed(1)}%` : 'Unavailable'
const rate = value => isMetric(value) ? `${(value / MiB).toFixed(1)} MB/s` : 'Unavailable'
const memory = value => !isMetric(value) ? 'Unavailable' : value >= 1024 * MiB ? `${(value / (1024 * MiB)).toFixed(1)} GB` : `${Math.round(value / MiB)} MB`
const milliseconds = value => isMetric(value) ? `${value.toFixed(1)} ms` : 'Unavailable'
const perMinute = value => isMetric(value) ? `${value.toFixed(1)} / min` : 'Unavailable'
const time = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`

const measures = [
  { key: 'backgroundCpuPercent', name: 'Background CPU', detail: 'Average share of system CPU', icon: 'chip', format: percent, unit: '%' },
  { key: 'memoryPressurePercent', name: 'Memory pressure', detail: 'Average system commit usage', icon: 'memory', format: percent, unit: '%' },
  { key: 'diskBytesPerSecond', name: 'Disk activity', detail: 'Average system read + write', icon: 'disk', format: rate, unit: ' MB/s' },
]
const timelineMeasures = [...measures,
  { key: 'systemCpuPercent', name: 'System CPU', unit: '%' },
]

function Button({ children, icon, variant = 'secondary', ...props }) {
  return <button type="button" className={`button button-${variant}`} {...props}>{icon && <Icon name={icon} size={16} />}{children}</button>
}

export function PowerBadge({ power }) {
  const source = { 'plugged-in': 'Plugged in', battery: 'On battery', unknown: 'Power unavailable' }[power.source] ?? 'Power unavailable'
  return <div className="power-badge" aria-label={`${source}, ${power.batteryPercent == null ? 'battery level unavailable' : `${power.batteryPercent}% battery`}, Battery Saver ${power.saver == null ? 'unavailable' : power.saver ? 'on' : 'off'}`}>
    <Icon name={power.source === 'battery' ? 'battery' : 'bolt'} size={15} /><span>{source}</span>
    {power.batteryPercent != null && <span className="power-value">{power.batteryPercent}%</span>}
    <span className="power-value">{power.saver == null ? 'Saver unavailable' : power.saver ? 'Saver on' : 'Saver off'}</span>
  </div>
}

function CaptureForm({ conditions, setConditions, phase, active, busy, isPreview, gameProcess, onPickGame, onStart, onBaseline }) {
  const fields = [
    ['scene', 'Scene or route', 'Firing range loop'], ['graphics', 'Graphics settings', 'High · 1440p'], ['frameCap', 'Frame cap', '144 or uncapped'],
  ]
  const interval = conditions.sampleIntervalSeconds ?? 1
  const minimum = minimumCaptureDuration(interval)
  const game = gameProcess ?? (conditions.gameExecutable
    ? { name: conditions.game || conditions.gameExecutable, executable: conditions.gameExecutable } : null)
  const disabled = Boolean(active) || busy
  return <form className="capture-form" onSubmit={onStart}>
    <div className="panel-heading"><div><h2>{phase === 'followup' ? 'Follow-up capture' : 'Capture setup'}</h2><p>{phase === 'followup'
      ? 'Repeat the same route, graphics settings, frame cap, power state, duration, and sampling interval.'
      : 'Record the conditions you want to repeat in your follow-up.'}</p></div>
    {phase === 'followup' && <Button onClick={onBaseline} disabled={disabled}>Use baseline mode</Button>}</div>
    <div className="field-grid">
      <div className="capture-process-field">
        <span id="game-process-label">Game process</span>
        <button type="button" className="button button-secondary process-trigger" aria-labelledby="game-process-label game-process-value"
          aria-haspopup="dialog" onClick={onPickGame} disabled={disabled}>
          <AppIcon item={game ?? { name: '' }} />
          <span id="game-process-value" className={`process-trigger-name${game ? '' : ' process-trigger-placeholder'}`} title={game?.executable}>
            {game ? `${game.name}${game.name === game.executable ? '' : ` · ${game.executable}`}` : 'Select a running process'}
          </span>
          <Icon name="down" size={15} />
        </button>
      </div>
      <label>Sample every
        <select className="setting-input" value={interval} disabled={disabled} onChange={event => {
          const value = Number(event.target.value)
          setConditions(previous => ({ ...previous, sampleIntervalSeconds: value,
            durationSeconds: Math.max(minimumCaptureDuration(value), previous.durationSeconds || 0) }))
        }}>
          {sampleIntervals.map(value => <option key={value} value={value}>{value} {value === 1 ? 'second' : 'seconds'}</option>)}
        </select>
      </label>
      <label>Capture duration
        <div className="duration-field"><input type="number" className="setting-input" required min={minimum} max="300" step="1" value={conditions.durationSeconds}
          disabled={disabled} onChange={event => setConditions(previous => ({ ...previous, durationSeconds: event.target.value === '' ? '' : event.target.valueAsNumber }))} /><span>seconds</span></div>
      </label>
      {fields.map(([key, label, placeholder]) => <label key={key} className={key === 'scene' ? 'capture-scene-field' : undefined}>{label}
        <input className="setting-input" placeholder={placeholder} maxLength={120}
          value={conditions[key]} disabled={disabled} onChange={event => setConditions(previous => ({ ...previous, [key]: event.target.value }))} />
      </label>)}
    </div>
    <div className="form-actions"><span><Icon name="flag" size={15} /> {isPreview ? 'Mark a simulated stutter during the sample capture.' : 'Use Ctrl+Shift+F9 to mark a stutter while playing.'}</span>
      <Button variant="primary" icon="play" type="submit" disabled={disabled || !game}>{phase === 'followup' ? 'Start follow-up' : 'Start scan'}</Button>
    </div>
  </form>
}

function MetricCards({ capture }) {
  return <div className="metric-grid">{measures.map(({ key, name, detail, icon, format }) => <section className="metric-card" key={key}>
    <div className="metric-head"><span className="metric-icon"><Icon name={icon} size={17} /></span><h2>{name}</h2></div>
    <strong className={isMetric(capture.resources[key]) ? '' : 'metric-unavailable'}>{format(capture.resources[key])}</strong>
    <p>{detail}</p>
  </section>)}</div>
}

function Timeline({ capture, initialMetric = measures[0].key }) {
  const [metric, setMetric] = useState(initialMetric)
  const measure = timelineMeasures.find(item => item.key === metric)
  const timeline = capture.timeline ?? []
  const divisor = metric === 'diskBytesPerSecond' ? MiB : 1
  const samples = timeline.map(sample => ({ second: sample.second, value: sample.resources[metric] }))
  const max = Math.max(metric === 'diskBytesPerSecond' ? 4 : 20, Math.ceil(Math.max(0, ...samples.filter(item => isMetric(item.value)).map(item => item.value / divisor)) / 4) * 4)
  const x = second => 57 + Math.max(0, Math.min(1, second / capture.durationSeconds)) * 820
  const y = value => 137 - (value / divisor / max) * 116
  const paths = []
  let points = []
  for (const sample of samples) {
    if (isMetric(sample.value)) points.push([x(sample.second), y(sample.value)])
    else if (points.length) { paths.push(points); points = [] }
  }
  if (points.length) paths.push(points)

  return <section className="panel timeline-panel">
    <div className="panel-heading"><div><h2>Capture timeline</h2><p>{capture.sampleCount} samples over {time(capture.durationSeconds)} <span className="separator">·</span> {capture.markers.length} stutter {capture.markers.length === 1 ? 'mark' : 'marks'}</p></div>
      <select className="setting-input chart-select" value={metric} aria-label="Timeline metric" onChange={event => setMetric(event.target.value)}>
        {timelineMeasures.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
      </select>
    </div>
    {paths.length ? <>
      <svg className="timeline-chart" role="img" aria-label={`${measure.name} over time with ${capture.markers.length} user-marked ${capture.markers.length === 1 ? 'stutter' : 'stutters'}`} viewBox="0 0 902 168" preserveAspectRatio="none">
        <defs><linearGradient id="timeline-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".26" /><stop offset="100%" stopColor="currentColor" stopOpacity=".018" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map(index => { const value = max * index / 4; return <g key={index}>
          <line x1="56" x2="878" y1={y(value * divisor)} y2={y(value * divisor)} className="chart-grid" />
          <text x="48" y={y(value * divisor) + 4} textAnchor="end">{value}{measure.unit}</text>
        </g> })}
        {paths.map((segment, index) => { const line = `M${segment.map(point => point.join(',')).join(' L')}`; return <g key={index}>
          <path d={`${line} L${segment.at(-1)[0]},137 L${segment[0][0]},137 Z`} fill="url(#timeline-fill)" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {segment.length === 1 && <circle cx={segment[0][0]} cy={segment[0][1]} r="3" fill="currentColor" />}
        </g> })}
        {[0, 1, 2, 3, 4, 5].map(index => <text key={index} x={x(capture.durationSeconds * index / 5)} y="159" textAnchor="middle">{time(capture.durationSeconds * index / 5)}</text>)}
        {capture.markers.map((second, index) => <g key={index} className="chart-marker"><title>Stutter marked at {time(second)}</title>
          <line x1={x(second)} x2={x(second)} y1="18" y2="137" strokeDasharray="3 4" />
          <path d={`M${x(second)},10 l4,5 -4,5 -4,-5 z`} /></g>)}
      </svg>
      <div className="chart-legend"><span><i />{measure.name}</span><span><i />User-marked stutter</span></div>
    </> : <p className="muted">{measure.name} was unavailable for this capture.</p>}
  </section>
}

export function ScanPage({ baseline, phase, conditions, setConditions, active, elapsed, busy, isPreview, gameProcess, recurringPanel, onPickGame, onStart, onFinish, onCancel, onMark, onReview, onBaseline }) {
  const capture = phase === 'baseline' ? baseline : null
  const [showSetup, setShowSetup] = useState(false)
  useEffect(() => { setShowSetup(false) }, [baseline?.id])
  const formProps = { conditions, setConditions, phase, active, busy, isPreview, gameProcess, onPickGame, onStart, onBaseline }
  const finishAfter = isPreview ? 5 : minimumCaptureDuration(active?.conditions.sampleIntervalSeconds ?? 1)
  const isSetup = !capture || showSetup
  const recommended = capture?.findings.filter(item => item.disposition === 'candidate').length ?? 0
  return <>
    <div className="page-heading workflow-heading"><div><h1>{phase === 'followup' ? 'Record follow-up' : 'Performance scan'}</h1><p>{phase === 'followup' ? 'Run the same test and compare it with your baseline.' : 'See what was running when your game stuttered.'}</p></div>
      {capture && !active && <Button icon="play" variant={showSetup ? 'secondary' : 'primary'} disabled={busy} onClick={() => setShowSetup(value => !value)}>{showSetup ? 'Hide setup' : 'Start new scan'}</Button>}
    </div>
    {active ? <section className="panel recording-panel">
      <div className="panel-heading"><div><span className="recording-label"><span className="status-dot" /> Recording {active.phase === 'followup' ? 'follow-up' : 'baseline'}</span>
        <h2>{time(Math.min(active.seconds, elapsed))} <small>/ {time(active.seconds)}</small></h2></div>
        <Button icon="flag" variant="primary" onClick={onMark}>Mark stutter</Button></div>
      <progress max={active.seconds} value={Math.min(active.seconds, elapsed)} aria-label="Capture progress" />
      <p>{active.markers.length} {active.markers.length === 1 ? 'stutter marked' : 'stutters marked'}. {isPreview ? 'This is an 8-second simulation.'
        : active.hotkeyAvailable ? 'Press Ctrl+Shift+F9 while playing to mark a stutter.' : 'The global shortcut is unavailable. Use Mark stutter here.'}</p>
      <div className="form-actions"><Button onClick={onCancel}>Cancel capture</Button><Button icon="stop" onClick={onFinish} disabled={elapsed < finishAfter || busy}>Finish capture</Button></div>
    </section> : isSetup && <section className="panel"><CaptureForm {...formProps} /></section>}
    {recurringPanel}
    {capture && !active && <>
      <div className="capture-strip"><div><Icon name="check" size={15} /><strong>{isPreview ? 'Sample baseline' : 'Baseline captured'}</strong></div>
        <span>{[capture.conditions.game || capture.conditions.gameExecutable || 'Game unavailable', capture.conditions.scene, time(capture.durationSeconds)].filter(Boolean).join('  ·  ')}</span></div>
      <MetricCards capture={capture} />
      <Timeline capture={capture} />
      <section className="panel scan-findings">
        <div className="panel-heading"><div><h2>Top findings</h2><p>Activity near a stutter mark is a clue. Other causes may be involved.</p></div>
          <Button onClick={onReview}>Review apps <Icon name="arrow" size={15} /></Button></div>
        <div>{capture.findings.slice(0, 3).map(item => <AppRow key={item.id} item={item} />)}
          {capture.findings.length === 0 && <p className="muted">There were no measured app findings.</p>}</div>
        <div className="findings-footer">{recommended} {recommended === 1 ? 'app candidate' : 'app candidates'} to review</div>
      </section>
    </>}
  </>
}

export function RecurringCapture({ capture }) {
  const initialMetric = capture.resources.backgroundCpuPercent === null ? 'systemCpuPercent' : 'backgroundCpuPercent'
  return <section className="recurring-capture" aria-labelledby="recurring-capture-title">
    <div className="capture-strip">
      <div><Icon name="check" size={15} /><strong id="recurring-capture-title">Latest recurring scan</strong></div>
      <span>{capture.conditions.game || capture.conditions.gameExecutable} · {time(capture.durationSeconds)}</span>
    </div>
    <MetricCards capture={capture} />
    <Timeline key={capture.id} capture={capture} initialMetric={initialMetric} />
    <section className="panel scan-findings">
      <div className="panel-heading"><h2>Top findings</h2></div>
      {capture.findings.slice(0, 3).map(item => <AppRow key={item.id} item={item} />)}
      {capture.findings.length === 0 && <p className="muted">There were no measured app findings.</p>}
    </section>
  </section>
}

export function AppIcon({ item }) {
  const [failedIcon, setFailedIcon] = useState(null)
  const name = item.name.toLowerCase()
  const fallback = name.includes('chrome') ? 'browser' : name.includes('discord') ? 'chat'
    : name.includes('onedrive') ? 'cloud' : name.includes('vite') || name.includes('node') ? 'terminal' : 'app'
  const icon = typeof item.icon === 'string' && item.icon.startsWith('data:image/png;base64,') ? item.icon : null
  return <span className="app-icon" aria-hidden="true">{icon && failedIcon !== icon
    ? <img src={icon} alt="" onError={() => setFailedIcon(icon)} />
    : <Icon name={fallback} size={18} />}</span>
}

export function ProcessPicker({ title, processes, current, loading, error, onRefresh, onSelect, onCancel }) {
  const dialog = useRef(null)
  const [query, setQuery] = useState('')
  useEffect(() => { dialog.current.showModal() }, [])
  const normalized = query.trim().toLowerCase()
  const choices = processes.filter(process => !normalized ||
    `${process.name} ${process.executable}`.toLowerCase().includes(normalized))
  function cancel() {
    dialog.current.close()
    onCancel()
  }

  return <dialog ref={dialog} className="confirm-dialog process-dialog" aria-labelledby="process-picker-title"
    onCancel={event => { event.preventDefault(); cancel() }}>
    <div className="panel-heading"><div><h2 id="process-picker-title">{title}</h2>
      {onRefresh && <p>Open the app first, then refresh the list.</p>}</div></div>
    <div className="process-picker-tools">
      <input className="setting-input" type="search" value={query} placeholder="Search name or executable"
        aria-label="Search running processes" onChange={event => setQuery(event.target.value)} autoFocus />
      {onRefresh && <Button icon="reset" disabled={loading} onClick={onRefresh}>Refresh</Button>}
    </div>
    <div className="process-list" aria-busy={loading}>
      {error && <p className="process-list-status" role="alert">{error}</p>}
      {loading && <p className="process-list-status" role="status">Loading processes…</p>}
      {!loading && !error && !choices.length && <p className="process-list-status" role="status">
        {normalized ? 'No processes match this search.' : 'No processes are available to select.'}
      </p>}
      {choices.map(process => <button type="button" className="process-option" key={process.id}
        disabled={loading} aria-pressed={process.executable.toLowerCase() === current?.toLowerCase()} onClick={() => {
          dialog.current.close()
          onSelect(process)
        }}>
        <AppIcon item={process} />
        <span className="process-option-copy"><strong>{process.name}</strong><small>{process.executable}</small></span>
        <span className="process-option-count">{process.processCount} {process.processCount === 1 ? 'process' : 'processes'}</span>
      </button>)}
    </div>
    <div className="dialog-actions"><Button onClick={cancel}>Cancel</Button></div>
  </dialog>
}

function AppRow({ item, checked, onChange, disabled, explanation, isProtected }) {
  return <div className="app-row">
    {onChange && <input type="checkbox" className="app-checkbox" aria-label={`Select ${item.name}`} checked={checked} onChange={onChange} disabled={disabled} />}
    <AppIcon item={item} />
    <div className="app-copy"><strong>{item.name}</strong>
      <p>{isProtected || explanation ? item.reason : item.observations.find(note => /near|within/.test(note)) ?? item.observations[0] ?? item.reason}</p>
      {explanation && !isProtected && item.observations.filter(note => /near|within/.test(note)).map(note => <p className="marker-observation" key={note}>{note}</p>)}
    </div>
    {isProtected ? <span className="protected-chip"><Icon name="shield" size={14} /> Protected</span> : <div className="app-metrics">
      <span><strong>{percent(item.average.cpuPercent)}</strong><small>CPU avg</small></span>
      <span><strong>{memory(item.average.memoryBytes)}</strong><small>Working set</small></span>
      <span><strong>{rate(item.average.ioBytesPerSecond)}</strong><small>Process I/O</small></span>
    </div>}
  </div>
}

const closeLabels = { closed: 'Closed', 'stayed-open': 'Stayed open', exited: 'Already exited', 'identity-changed': 'Identity changed', protected: 'Protected', 'no-window': 'No window', denied: 'Close unavailable' }

function CloseOutcomes({ results, findings }) {
  if (!results.length) return <p className="muted">No close requests recorded.</p>
  return <ul className="close-results">{results.map((item, index) => <li key={`${item.id}-${index}`}>
    <AppIcon item={findings.find(finding => finding.id === item.id) ?? item} />
    <div className="close-result-copy"><strong>{item.name}</strong><p>{item.detail}</p></div>
    <span className={item.status === 'closed' ? 'status-closed' : 'status-skipped'}>{closeLabels[item.status] ?? item.status}</span>
  </li>)}</ul>
}

export function ReviewPage({ baseline, closeResults, selected, alwaysProtect, busy, active, isPreview, reviewAvailable, onToggle, onPrepare, onCapture, onScan, onProtect }) {
  if (!baseline) return <>
    <div className="page-heading"><h1>Review apps</h1><p>Scan to see which apps could be contributing to background load.</p></div>
    <section className="panel empty-panel"><Icon name="shield" size={26} /><h2>No baseline capture yet</h2><Button variant="primary" onClick={onScan}>Go to scan <Icon name="arrow" size={15} /></Button></section>
  </>
  const closed = new Set(closeResults.filter(item => item.status === 'closed' || item.status === 'exited' || item.status === 'identity-changed').map(item => item.id))
  const findings = baseline.findings.filter(item => !closed.has(item.id)).map(item => matchesAlwaysProtect(alwaysProtect, item.executable, item.name)
    ? { ...item, disposition: 'protected', reason: 'Always protect list' } : item)
  const candidates = findings.filter(item => item.disposition === 'candidate')
  const protectedApps = findings.filter(item => item.disposition === 'protected')
  const selectedCount = candidates.filter(item => selected.includes(item.id)).length
  return <>
    <div className="page-heading"><h1>Review apps</h1><p>Choose which background apps you want to close. Apps may prompt you to save work.</p></div>
    <section className="panel">
      <div className="panel-heading"><div><h2>Close candidates <span className="count-label">{candidates.length}</span></h2>
        <p>Ranked by sustained use and activity near stutter marks. Process I/O can include file, network, and device activity.</p></div></div>
      {candidates.map(item => <AppRow key={item.id} item={item} explanation checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} disabled={busy || active || !reviewAvailable} />)}
      {candidates.length === 0 && <p className="muted">No close candidates remain for this capture.</p>}
      <div className="form-actions"><span>{!reviewAvailable && candidates.length ? 'Run a new scan to verify these apps are still running.' : `${selectedCount} selected`}</span>
        <Button variant="primary" disabled={selectedCount === 0 || busy || active || !reviewAvailable} onClick={onPrepare}>{isPreview ? 'Review simulated close' : 'Review close request'}</Button></div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Protected apps <span className="count-label">{protectedApps.length}</span></h2><p>WinOpti skips developer work, protected processes, and apps on your list.</p></div>
        <Button icon="shield" onClick={onProtect}>Always protect</Button></div>
      {protectedApps.map(item => <AppRow key={item.id} item={item} isProtected />)}
      {!protectedApps.length && <p className="muted">No protected apps were identified in this capture.</p>}
    </section>
    {closeResults.length > 0 && <section className="panel">
      <div className="panel-heading"><div><h2>Close results</h2><p>Apps that stayed open may still need your attention.</p></div><Button variant="primary" onClick={onCapture} disabled={active || busy}>Record follow-up <Icon name="arrow" size={15} /></Button></div>
      <CloseOutcomes results={closeResults} findings={baseline.findings} />
    </section>}
  </>
}

export function ConfirmDialog({ apps, isPreview, onCancel, onConfirm }) {
  const dialog = useRef(null)
  useEffect(() => { dialog.current.showModal() }, [])
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); onCancel() }}>
    <div className="panel-heading"><div><h2 id="confirm-title">{isPreview ? 'Simulate close request' : 'Close selected apps?'}</h2>
      <p>{isPreview ? 'The preview will simulate a normal close for these sample apps.' : 'WinOpti will ask these apps to close normally. They may prompt you to save work.'}</p></div></div>
    <ul className="confirmation-list">{apps.map(app => <li key={app.id}><AppIcon item={app} />
      <div><strong>{app.name}</strong>{app.executable && <span>{app.executable}{app.processCount ? ` · ${app.processCount} ${app.processCount === 1 ? 'process' : 'processes'}` : ''}</span>}</div></li>)}</ul>
    <div className="dialog-actions"><Button onClick={onCancel} autoFocus>Cancel</Button><Button variant="primary" onClick={onConfirm}>{isPreview ? 'Simulate close' : 'Confirm close'}</Button></div>
  </dialog>
}

function delta(before, after, unit, divisor = 1) {
  if (!isMetric(before) || !isMetric(after)) return 'Unavailable'
  const difference = (after - before) / divisor
  return `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${Math.abs(difference).toFixed(1)} ${unit}`
}

function ComparisonTable({ rows, title, description }) {
  return <section className="panel">
    <div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>
    <div className="table-scroll"><table className="comparison-table"><thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">Follow-up</th><th scope="col">Change</th></tr></thead>
      <tbody>{rows.map(([label, before, after, change]) => <tr key={label}><th scope="row">{label}</th><td>{before}</td><td>{after}</td><td>{change}</td></tr>)}</tbody></table></div>
  </section>
}

export function ComparePage({ baseline, followup, closeResults, busy, active, isPreview, onCapture, onExport, onImport, onReview, onExample }) {
  const canAct = !busy && !active
  if (!baseline || !followup) return <>
    <div className="page-heading"><h1>Compare captures</h1><p>Measure what changed after reviewing and closing apps.</p></div>
    <section className="panel empty-panel"><Icon name="compare" size={27} />
      <h2>{baseline ? 'Ready for a follow-up' : 'Record a baseline first'}</h2>
      <p>{baseline ? 'Repeat the same route, graphics settings, frame cap, power state, duration, and sampling interval.' : 'A baseline records the background load before you close apps.'}</p>
      <Button variant="primary" onClick={baseline && closeResults.length ? onCapture : onReview} disabled={!canAct}>{baseline && closeResults.length ? 'Record follow-up' : baseline ? 'Review apps' : 'Go to scan'} <Icon name="arrow" size={15} /></Button>
      {baseline && !isPreview && <Button onClick={() => onImport('baseline')} disabled={!canAct}>Attach baseline PresentMon CSV</Button>}
    </section>
    {isPreview && <section className="panel preview-examples"><h2>Try a sample comparison</h2>
      <Button onClick={() => onExample('improved')}>Frame times improve <Icon name="arrow" size={15} /></Button>
      <Button onClick={() => onExample('unchanged')}>Background load drops <Icon name="arrow" size={15} /></Button></section>}
  </>
  const report = compareCaptures(baseline, followup)
  const resourceRows = measures.map(item => [item.name, item.format(baseline.resources[item.key]), item.format(followup.resources[item.key]),
    delta(baseline.resources[item.key], followup.resources[item.key], item.key === 'diskBytesPerSecond' ? 'MB/s' : 'pp', item.key === 'diskBytesPerSecond' ? MiB : 1)])
  const frameRows = [['95th percentile', 'p95Ms', milliseconds, 'ms'], ['99th percentile', 'p99Ms', milliseconds, 'ms'], ['Spikes per minute', 'spikesPerMinute', perMinute, '/ min']]
    .map(([label, key, format, unit]) => [label, format(report.baselineFrame?.[key]), format(report.followupFrame?.[key]),
      report.frameComparable ? delta(report.baselineFrame?.[key], report.followupFrame?.[key], unit) : 'Unavailable'])
  const conditionRows = [['Game', 'game'], ['Game executable', 'gameExecutable'], ['Scene or route', 'scene'], ['Graphics settings', 'graphics'], ['Frame cap', 'frameCap']]
    .map(([label, key]) => [label, baseline.conditions[key] || 'Unavailable', followup.conditions[key] || 'Unavailable'])
  conditionRows.push(['Capture duration', time(baseline.durationSeconds), time(followup.durationSeconds)],
    ['Sampling interval', `${baseline.conditions.sampleIntervalSeconds ?? 1} s`, `${followup.conditions.sampleIntervalSeconds ?? 1} s`],
    ['Power source', powerText(baseline.power), powerText(followup.power)])
  const improved = report.outcome === 'Stutter decreased'
  const sameFrameMetrics = report.frameComparable && !report.differences.length && ['p95Ms', 'p99Ms', 'spikesPerMinute']
    .every(key => report.baselineFrame[key] === report.followupFrame[key])
  return <>
    <div className="page-heading workflow-heading"><div><h1>Compare captures</h1><p>Baseline and follow-up measured side by side.</p></div>
      <Button icon="download" onClick={onExport} disabled={!canAct}>Export report</Button></div>
    <section className={`panel outcome-panel${improved ? ' outcome-positive' : ''}`}>
      <span className="metric-icon"><Icon name={improved ? 'check' : 'compare'} size={20} /></span>
      <div><h2>{report.outcome}</h2><p>{improved ? 'Comparable captures show improved frame times.'
        : report.outcome === 'Background load decreased' && sameFrameMetrics
          ? 'Background activity fell. Frame times show no clear change.'
          : report.outcome === 'Background load decreased' ? 'Review frame times and capture conditions below.'
            : report.outcome === 'Not enough data' ? 'Too few comparable observations to assess a change.' : 'The measured changes do not establish an improvement.'}</p></div>
    </section>
    <ComparisonTable title="Resource usage" description="Capture averages. Changes in percent-based metrics are in percentage points (pp)." rows={resourceRows} />
    <ComparisonTable title="Frame times" description={`A spike is a frame longer than ${report.spikeThresholdMs} ms in either capture.${report.baselineFrame && report.followupFrame ? '' : ' Reliable frame times are unavailable for one or both captures.'}`} rows={frameRows} />
    {!isPreview && <div className="comparison-tools"><Button onClick={() => onImport('baseline')} disabled={!canAct}>Attach baseline PresentMon CSV</Button>
      <Button onClick={() => onImport('followup')} disabled={!canAct}>Attach follow-up PresentMon CSV</Button></div>}
    <section className="panel">
      <div className="panel-heading"><div><h2>User-marked stutters</h2><p>Marks record what you noticed during play. Frame-time measurements appear above.</p></div></div>
      <div className="split-detail">{[['Baseline', baseline], ['Follow-up', followup]].map(([label, capture]) => <div key={label}>
        <span>{label}</span><strong>{capture.markers.length}</strong><p>{capture.markers.map(time).join(' · ') || 'No marks recorded'}</p></div>)}</div>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><h2>Capture conditions</h2><p>{report.differences.length ? 'Review differences before drawing conclusions.' : 'Recorded capture conditions match.'}</p></div></div>
      {report.differences.length > 0 && <ul className="condition-warnings">{report.differences.map(difference => <li key={difference}>{difference}</li>)}</ul>}
      <div className="table-scroll"><table className="comparison-table"><thead><tr><th scope="col">Condition</th><th scope="col">Baseline</th><th scope="col">Follow-up</th></tr></thead>
        <tbody>{conditionRows.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th><td>{before}</td><td>{after}</td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>App close results</h2><p>Actual outcomes from each confirmed close request.</p></div></div><CloseOutcomes results={closeResults} findings={baseline.findings} /></section>
  </>
}

function powerText(power) {
  const source = { 'plugged-in': 'Plugged in', battery: 'On battery', unknown: 'Source unavailable' }[power.source]
  const saver = power.saver == null ? 'Saver unavailable' : power.saver ? 'Saver on' : 'Saver off'
  return [source, power.batteryPercent == null ? null : `${power.batteryPercent}%`, saver].filter(Boolean).join(' · ')
}
