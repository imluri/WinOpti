import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DesktopShell from './DesktopShell'
import SettingsPanel from './SettingsPanel'
import { defaults, groups } from './demoSettings'
import { Icon } from './icons'
import { previewCapture, previewCloseResults, previewConditions, previewProcesses, previewState } from './preview'
import { AppIcon, ComparePage, ConfirmDialog, PowerBadge, ProcessPicker, RecurringCapture, ReviewPage, ScanPage } from './workflow'
import { RecurringScans } from './recurring'
import { UpdatesPanel } from './updater'
import { PerformancePage } from './performance'
import { compareCaptures, matchesAlwaysProtect, recurringScanInterval } from './shared/winopti'
import { version } from '../package.json'
import './styles.css'
import './dashboard.css'
import './performance.css'

const storageKey = 'winopti.appearance'
const previewProtectKey = 'winopti.preview-protected'
const emptyPower = { source: 'unknown', batteryPercent: null, saver: null }
const emptySession = { baseline: null, followup: null, closeResults: [], alwaysProtect: [], power: emptyPower, reviewAvailable: false }
const emptyConditions = { game: '', gameExecutable: '', scene: '', graphics: '', frameCap: '', durationSeconds: 60, sampleIntervalSeconds: 1 }
const emptySchedule = { enabled: false, intervalMinutes: recurringScanInterval.default, conditions: null, nextScanAt: null, running: false, latest: null, error: null }
const unavailableUpdate = {
  version, status: 'unavailable', updateVersion: null, progress: null, message: 'Updates are available in the installed Windows app.',
}
const brand = { name: 'WinOpti', caption: 'Game performance', mark: <Icon name="pulse" size={19} /> }
const items = [
  { id: 'performance', label: 'Performance', icon: <Icon name="monitor" /> },
  { id: 'scan', label: 'Scan', icon: <Icon name="pulse" /> },
  { id: 'review', label: 'Review apps', icon: <Icon name="shield" /> },
  { id: 'compare', label: 'Compare', icon: <Icon name="compare" /> },
  { id: 'settings', label: 'Settings', icon: <Icon name="settings" /> },
]

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

function initialPreview() {
  const stored = readLocal(previewProtectKey, [])
  const alwaysProtect = Array.isArray(stored) ? stored.filter(item => typeof item === 'string') : []
  return { ...previewState(), baseline: previewCapture({ alwaysProtect }), alwaysProtect }
}

function exportPreview(baseline, followup, closeResults) {
  const sanitize = capture => capture && ({ ...capture,
    frameTimes: capture.frameTimes && { ...capture.frameTimes, timesMs: undefined, frameCount: capture.frameTimes.timesMs.length },
  })
  const comparison = baseline && followup && compareCaptures(baseline, followup)
  const blob = new Blob([JSON.stringify({ version, preview: true, baseline: sanitize(baseline), followup: sanitize(followup), closeResults, comparison }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'WinOpti-sample-report.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const bridge = window.winOpti
  const [mode, setMode] = useState(bridge ? 'live' : 'preview')
  const [page, setPage] = useState('scan')
  const [live, setLive] = useState(emptySession)
  const [recurring, setRecurring] = useState(emptySchedule)
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [sample, setSample] = useState(initialPreview)
  const [liveConditions, setLiveConditions] = useState(emptyConditions)
  const [demoConditions, setDemoConditions] = useState(previewConditions)
  const [scenario, setScenario] = useState(null)
  const [phase, setPhase] = useState('baseline')
  const [active, setActive] = useState(null)
  const [selected, setSelected] = useState([])
  const [confirmation, setConfirmation] = useState(null)
  const [busy, setBusy] = useState(false)
  const operationInProgress = useRef(false)
  const [now, setNow] = useState(Date.now())
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState(() => ({ ...defaults, ...readLocal(storageKey, {}) }))
  const [draft, setDraft] = useState(saved)
  const [group, setGroup] = useState('appearance')
  const [processPicker, setProcessPicker] = useState(null)
  const [liveProcesses, setLiveProcesses] = useState([])
  const [processLoading, setProcessLoading] = useState(false)
  const [processError, setProcessError] = useState('')
  const [updates, setUpdates] = useState(unavailableUpdate)
  const [updatePending, setUpdatePending] = useState(false)
  const updateRequest = useRef(false)
  const processRequest = useRef(false)
  const isPreview = mode === 'preview'
  const session = isPreview ? sample : live
  const setSession = isPreview ? setSample : setLive
  const conditions = isPreview ? demoConditions : liveConditions
  const setConditions = isPreview ? setDemoConditions : setLiveConditions
  const { baseline, followup, closeResults, alwaysProtect, power, reviewAvailable } = session
  const processes = isPreview ? previewProcesses : liveProcesses
  const gameProcess = processes.find(process => process.executable.toLowerCase() === conditions.gameExecutable.toLowerCase())
    ?? baseline?.findings.find(item => item.executable?.split(/[\\/]/).at(-1).toLowerCase() === conditions.gameExecutable.toLowerCase())
  const elapsed = active ? Math.max(0, (now - active.startedAt) / 1000) : 0
  const dirty = Object.keys(defaults).some(key => draft[key] !== saved[key])

  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => { document.documentElement.dataset.theme = draft.theme === 'system' ? (scheme.matches ? 'dark' : 'light') : draft.theme }
    syncTheme()
    scheme.addEventListener('change', syncTheme)
    return () => scheme.removeEventListener('change', syncTheme)
  }, [draft.theme])

  useEffect(() => { document.documentElement.dataset.accent = draft.accent.toLowerCase() }, [draft.accent])

  useEffect(() => {
    let mounted = true
    let changed = false
    const unsubscribe = bridge?.onUpdateChanged?.(state => {
      changed = true
      if (mounted) setUpdates(state)
    })
    bridge?.getUpdateState?.().then(state => {
      if (mounted && !changed) setUpdates(state)
    }).catch(() => {
      if (mounted && !changed) setUpdates({ ...unavailableUpdate, status: 'error', message: 'Could not read the update status.' })
    })
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [bridge])

  useEffect(() => {
    let mounted = true
    let recurringChanged = false
    const unsubscribe = bridge?.onRecurringChanged?.(schedule => {
      recurringChanged = true
      if (mounted) setRecurring(schedule)
    })
    bridge?.getState().then(async state => {
      if (!mounted) return
      const { recurring: schedule, ...session } = state
      setLive({ ...emptySession, ...session })
      if (!recurringChanged && schedule) setRecurring(schedule)
      if (state.baseline || schedule?.conditions) setLiveConditions(state.baseline?.conditions ?? schedule.conditions)
      setScheduleLoaded(true)
      const status = await bridge.refreshPower?.()
      if (mounted && status) setLive(current => ({ ...current, power: status }))
    }).catch(error => { if (mounted) setNotice(error.message) })
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [bridge])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 180)
    return () => clearInterval(timer)
  }, [active?.startedAt])

  useEffect(() => bridge?.onStutterMarked?.(recordMarker), [bridge])

  useEffect(() => {
    if (page === 'settings' && group === 'protection' && !isPreview) void refreshProcesses()
  }, [page, group, isPreview])

  useEffect(() => {
    if (active && elapsed >= active.seconds && !busy) void finishCapture()
  }, [active, elapsed, busy])

  async function action(callback) {
    if (operationInProgress.current) return
    operationInProgress.current = true
    setBusy(true)
    setNotice('')
    try { return await callback() }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { operationInProgress.current = false; setBusy(false) }
  }

  function navigate(id) {
    setNotice('')
    setPage(id)
  }

  async function runUpdate(method) {
    if (updateRequest.current || !bridge?.[method]) return
    updateRequest.current = true
    setUpdatePending(true)
    try {
      const state = await bridge[method]()
      if (state) setUpdates(state)
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '')
      setUpdates(current => ({ ...current, status: method === 'installUpdate' ? current.status : 'error', message }))
    } finally {
      updateRequest.current = false
      setUpdatePending(false)
    }
  }

  function switchMode(value) {
    if (value === mode || busy || active) return
    setMode(value)
    setSelected([])
    setConfirmation(null)
    setPhase('baseline')
    navigate('scan')
    if (value === 'live') bridge.refreshPower?.().then(status => setLive(current => ({ ...current, power: status }))).catch(() => {})
  }

  async function saveSchedule(schedule) {
    await action(async () => setRecurring(await bridge.setRecurring(schedule)))
  }

  async function startCapture(event) {
    event.preventDefault()
    await action(async () => {
      const captureConditions = Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
      const timing = isPreview ? { startedAt: Date.now(), hotkeyAvailable: false } : await bridge.startCapture(captureConditions, phase)
      setNow(timing.startedAt)
      setActive({ ...timing, conditions: captureConditions, phase, seconds: isPreview ? 8 : captureConditions.durationSeconds, markers: [] })
    })
  }

  function recordMarker(second) {
    if (!Number.isFinite(second)) return
    setActive(current => current && !current.markers.includes(second) ? { ...current, markers: [...current.markers, second] } : current)
  }

  async function markStutter() {
    if (!active) return
    try {
      recordMarker(isPreview ? Math.round(Math.min(active.seconds, elapsed) / active.seconds * active.conditions.durationSeconds * 100) / 100 : await bridge.markStutter())
    } catch (error) { setNotice(error.message) }
  }

  async function finishCapture() {
    const recording = active
    if (!recording) return
    setActive(null)
    await action(async () => {
      const capture = isPreview ? previewCapture({ ...recording, scenario: scenario ?? 'improved', closeResults, alwaysProtect }) : await bridge.finishCapture()
      setSession(current => recording.phase === 'baseline'
        ? { ...current, baseline: capture, followup: null, closeResults: [], power: capture.power, reviewAvailable: true }
        : { ...current, followup: capture, power: capture.power })
      if (recording.phase === 'baseline') setSelected([])
      setPhase('baseline')
      setConditions(capture.conditions)
      navigate(recording.phase === 'followup' ? 'compare' : 'scan')
    })
  }

  async function cancelCapture() {
    setActive(null)
    if (!isPreview) await action(() => bridge.cancelCapture())
  }

  function captureAgain() {
    if (!baseline || active || busy) return
    setPhase('followup')
    setConditions({ ...baseline.conditions })
    navigate('scan')
  }

  function loadExample(nextScenario) {
    if (active || busy) return
    const example = previewState(nextScenario)
    setSample(current => ({ ...example, alwaysProtect: current.alwaysProtect }))
    setPhase('baseline')
    setDemoConditions(previewConditions)
    setScenario(nextScenario)
    setSelected([])
    navigate('compare')
  }

  function toggleSelected(id) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  async function prepareClose() {
    await action(async () => {
      const request = isPreview
        ? { token: 'preview', apps: baseline.findings.filter(item => selected.includes(item.id) && item.disposition === 'candidate').map(({ id, name }) => ({ id, name })) }
        : await bridge.prepareClose(selected)
      if (!request.apps.length) throw new Error('There are no apps eligible to close in this selection.')
      setConfirmation({ ...request, apps: request.apps.map(app => {
        const finding = baseline.findings.find(item => item.id === app.id)
        return { ...app, executable: finding?.executable?.split(/[\\/]/).at(-1), processCount: finding?.processCount, icon: finding?.icon }
      }) })
    })
  }

  async function confirmClose() {
    if (!confirmation) return
    const request = confirmation
    setConfirmation(null)
    await action(async () => {
      const result = isPreview ? request.apps.map(app => previewCloseResults.find(item => item.id === app.id)
        ?? { ...app, status: 'closed', detail: 'The app exited after a normal close request.' }) : await bridge.confirmClose(request.token)
      const updatedIds = new Set(result.map(item => item.id))
      setSession(current => ({ ...current, closeResults: isPreview ? [...current.closeResults.filter(item => !updatedIds.has(item.id)), ...result] : result }))
      setSelected([])
    })
  }

  async function cancelClose() {
    const request = confirmation
    setConfirmation(null)
    if (!isPreview && request) await action(() => bridge.cancelClose(request.token))
  }

  async function updateProtection(entries) {
    await action(async () => {
      const updated = isPreview ? entries : await bridge.setAlwaysProtect(entries)
      if (isPreview) localStorage.setItem(previewProtectKey, JSON.stringify(updated))
      setSession(current => ({ ...current, alwaysProtect: updated }))
      setSelected([])
    })
  }

  async function refreshProcesses() {
    if (isPreview || processRequest.current) return
    processRequest.current = true
    setProcessLoading(true)
    setProcessError('')
    try { setLiveProcesses(await bridge.listProcesses()) }
    catch { setProcessError('Could not read running processes. Try refreshing the list.') }
    finally { processRequest.current = false; setProcessLoading(false) }
  }

  function chooseProcess(purpose) {
    setProcessPicker(purpose)
    void refreshProcesses()
  }

  function applyProcess(process) {
    if (processPicker === 'game') {
      setConditions(current => ({ ...current, game: process.name, gameExecutable: process.executable }))
    } else if (!matchesAlwaysProtect(alwaysProtect, process.executable, process.name)) {
      void updateProtection([...alwaysProtect, process.executable])
    }
    setProcessPicker(null)
  }

  async function importFrameTimes(target) {
    await action(async () => {
      const capture = await bridge.importFrameTimes(target)
      if (capture) {
        setLive(current => ({ ...current, [target]: capture }))
        setNotice('Frame times attached to the capture.')
      }
    })
  }

  async function exportReport() {
    await action(async () => {
      if (isPreview) exportPreview(baseline, followup, closeResults)
      else if (await bridge.exportReport()) setNotice('Report saved.')
    })
  }

  function saveAppearance() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft))
      setSaved(draft)
      setNotice('Settings saved.')
    } catch { setNotice('Could not save appearance settings.') }
  }

  const footer = page === 'settings' && group === 'appearance' && (
    <footer className="action-bar">
      <div className="action-bar-content">
        <button type="button" className="button button-plain" onClick={() => { setDraft({ ...defaults }); setNotice('') }}>
          <Icon name="reset" size={16} /> Restore defaults
        </button>
        <div className="save-actions">
          <span className="save-message">{dirty ? 'Unsaved changes' : 'Appearance preferences'}</span>
          <button type="button" className="button button-primary" disabled={!dirty} onClick={saveAppearance}>Save changes</button>
        </div>
      </div>
    </footer>
  )

  return (
    <DesktopShell brand={brand} items={items} page={page} onNavigate={navigate} windowControls={window.desktopWindow} footer={footer}
      sidebarTools={<div className="sidebar-modes"><span className="nav-section">Capture mode</span>
        {bridge && <button className="nav-item" disabled={Boolean(active) || busy} aria-pressed={!isPreview} onClick={() => switchMode('live')}>
          <span className="status-dot live-dot" /> Live device</button>}
        <button className="nav-item" disabled={Boolean(active) || busy} aria-pressed={isPreview} onClick={() => switchMode('preview')}>
          <span className="status-dot" /> Interactive preview</button>
        {isPreview && <div className="sidebar-examples">
          <button className="nav-item" disabled={Boolean(active) || busy} aria-current={scenario === 'improved' && page === 'compare' ? 'true' : undefined} onClick={() => loadExample('improved')}>Frame times improve</button>
          <button className="nav-item" disabled={Boolean(active) || busy} aria-current={scenario === 'unchanged' && page === 'compare' ? 'true' : undefined} onClick={() => loadExample('unchanged')}>Background load drops</button>
        </div>}
      </div>}
      sidebarFooter={<>
        {updates.status === 'downloaded' && <button type="button" className="button button-secondary update-shortcut"
          onClick={() => { setGroup('updates'); navigate('settings') }}><Icon name="download" size={15} /> Update ready</button>}
        <div className="workspace"><div className="workspace-avatar" aria-hidden="true"><Icon name="lock" size={16} /></div>
          <div className="workspace-copy"><strong>Local captures</strong><span>WinOpti {updates.version}</span></div></div>
      </>}
    >
      <div className={`page-content dashboard${draft.compact ? ' page-content--compact' : ''}`} style={{ '--ui-text-scale': draft.scale / 100 }}>
        <div className="page-meta">
          <span className="mode-indicator"><span className={`status-dot${isPreview ? '' : ' live-dot'}`} /> {isPreview ? 'Sample data' : 'Live device'}</span>
          <PowerBadge power={power} />
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
        {page === 'performance' && <PerformancePage isPreview={isPreview} bridge={bridge} />}
        {page === 'scan' && <ScanPage {...{ baseline, phase, conditions, setConditions, active, elapsed, busy, isPreview, gameProcess }}
          recurringPanel={<RecurringScans schedule={isPreview ? emptySchedule : recurring} conditions={conditions}
            available={!isPreview && Boolean(bridge?.setRecurring)} pending={busy || !scheduleLoaded} onSave={saveSchedule}>
            {recurring.latest && <RecurringCapture capture={recurring.latest} />}
          </RecurringScans>}
          onStart={startCapture} onFinish={finishCapture} onCancel={cancelCapture} onMark={markStutter}
          onPickGame={() => chooseProcess('game')}
          onReview={() => navigate('review')} onBaseline={() => { setPhase('baseline'); if (baseline) setConditions(baseline.conditions) }} />}
        {page === 'review' && <ReviewPage {...{ baseline, closeResults, selected, alwaysProtect, busy, isPreview }} active={Boolean(active)} reviewAvailable={isPreview || reviewAvailable}
          onToggle={toggleSelected} onPrepare={prepareClose} onCapture={captureAgain} onScan={() => navigate('scan')}
          onProtect={() => { setGroup('protection'); navigate('settings') }} />}
        {page === 'compare' && <ComparePage {...{ baseline, followup, closeResults, busy, isPreview }} active={Boolean(active)}
          onCapture={captureAgain} onExport={exportReport} onImport={importFrameTimes} onReview={() => navigate(baseline ? 'review' : 'scan')}
          onExample={loadExample} />}
        {page === 'settings' && <>
          <div className="page-heading"><h1>Settings</h1><p>Manage appearance, app protection, and updates.</p></div>
          <SettingsPanel groups={groups} values={draft} onChange={(id, value) => { setNotice(''); setDraft(current => ({ ...current, [id]: value })) }} activeGroup={group} onGroupChange={setGroup}
            renderGroupContent={current => current.id === 'updates' ? <UpdatesPanel state={updates} pending={updatePending}
              installBlocked={Boolean(active || recurring.running || busy || confirmation)}
              onCheck={() => runUpdate('checkForUpdates')} onDownload={() => runUpdate('downloadUpdate')}
              onInstall={() => void action(() => runUpdate('installUpdate'))} /> : current.id === 'protection' ? <section className="setting-section protection-settings">
            <h2>Always protect</h2>
            <p>Apps on this list stay out of close recommendations.</p>
            <div className="protection-form">
              <button className="button button-primary" type="button" aria-haspopup="dialog" disabled={busy || Boolean(active)}
                onClick={() => chooseProcess('protection')}><Icon name="plus" size={16} /> Select running app</button>
            </div>
            {alwaysProtect.length === 0 ? <p>No apps added.</p> : <ul className="protection-list">{alwaysProtect.map(entry => {
              const process = processes.find(item => matchesAlwaysProtect([entry], item.executable, item.name))
              const finding = baseline?.findings.find(item => matchesAlwaysProtect([entry], item.executable, item.name))
              const item = process ?? finding ?? { name: entry }
              return <li key={entry}><AppIcon item={item} /><span className="protection-name">{item.name}
                {item.name !== entry && <small>{entry}</small>}</span>
                <button type="button" className="icon-button" disabled={busy}
                  onClick={() => updateProtection(alwaysProtect.filter(item => item !== entry))} aria-label={`Remove ${entry}`}><Icon name="close" size={17} /></button></li>
            })}</ul>}
          </section> : null} />
        </>}
      </div>
      {confirmation && <ConfirmDialog apps={confirmation.apps} isPreview={isPreview} onCancel={cancelClose} onConfirm={confirmClose} />}
      {processPicker && <ProcessPicker title={processPicker === 'game' ? 'Select game process' : 'Choose an app to protect'}
        processes={processPicker === 'game' ? processes : processes.filter(process => !matchesAlwaysProtect(alwaysProtect, process.executable, process.name))}
        current={processPicker === 'game' ? conditions.gameExecutable : undefined} loading={!isPreview && processLoading}
        error={isPreview ? '' : processError} onRefresh={isPreview ? undefined : refreshProcesses}
        onSelect={applyProcess} onCancel={() => setProcessPicker(null)} />}
    </DesktopShell>
  )
}

createRoot(document.getElementById('root')).render(<App />)
