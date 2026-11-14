import React, { useEffect, useState } from 'react'
import { Icon } from './icons'
import { minimumCaptureDuration, recurringScanInterval } from './shared/winopti'

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function NextScan({ timestamp }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [timestamp])

  const seconds = Math.ceil((timestamp - now) / 1000)
  if (seconds <= 0) return 'Waiting for the current operation to finish'
  const minutes = Math.floor(seconds / 60)
  const remaining = String(seconds % 60).padStart(2, '0')
  return <>Next scan in <time dateTime={new Date(timestamp).toISOString()} title={dateTime.format(timestamp)}>{minutes}:{remaining}</time></>
}

export function RecurringScans({ schedule, conditions, available, pending, onSave, children }) {
  const [minutes, setMinutes] = useState(schedule.intervalMinutes)
  const [showLatest, setShowLatest] = useState(false)
  useEffect(() => setMinutes(schedule.intervalMinutes), [schedule.intervalMinutes])

  const minutesValid = Number.isInteger(minutes) && minutes >= recurringScanInterval.minimum && minutes <= recurringScanInterval.maximum
  const changed = minutesValid && minutes !== schedule.intervalMinutes
  const durationReady = Number.isInteger(conditions.durationSeconds) &&
    conditions.durationSeconds >= minimumCaptureDuration(conditions.sampleIntervalSeconds ?? 1) &&
    conditions.durationSeconds <= 300
  const setupReady = Boolean(conditions.gameExecutable) && durationReady
  const savedGame = schedule.conditions?.game || schedule.conditions?.gameExecutable
  const hasNewSetup = setupReady && schedule.conditions && [
    'gameExecutable', 'scene', 'graphics', 'frameCap', 'durationSeconds', 'sampleIntervalSeconds',
  ].some(key => key === 'sampleIntervalSeconds'
    ? (conditions[key] ?? 1) !== (schedule.conditions[key] ?? 1)
    : conditions[key] !== schedule.conditions[key])

  function toggle(event) {
    const enabled = event.target.checked
    onSave({
      enabled,
      intervalMinutes: enabled ? minutes : schedule.intervalMinutes,
      ...(enabled && !schedule.conditions && setupReady ? { conditions } : {}),
    })
  }

  function saveInterval(event) {
    event.preventDefault()
    if (changed) onSave({ enabled: schedule.enabled, intervalMinutes: minutes })
  }

  return <>
    <section className="panel recurring-panel" aria-labelledby="recurring-scans">
      <div className="panel-heading">
        <div>
          <h2 id="recurring-scans"><Icon name="clock" size={17} /> Recurring scans</h2>
          <p>{available ? 'Automatically record a scan while WinOpti is open.' : 'Recurring scans are available in Live device mode.'}</p>
        </div>
        {available && <label className="setting-switch">
          <input className="setting-switch-input" type="checkbox" role="switch" aria-label="Recurring scans"
            checked={schedule.enabled} disabled={pending || (!schedule.enabled && (!minutesValid || (!setupReady && !savedGame)))}
            onChange={toggle} />
          <span className="setting-switch-track" aria-hidden="true" />
        </label>}
      </div>
      {available && <>
        <div className="recurring-controls">
          <form className="recurring-interval" onSubmit={saveInterval}>
            <label htmlFor="recurring-interval">Scan every</label>
            <input className="setting-input" id="recurring-interval" type="number" min={recurringScanInterval.minimum} max={recurringScanInterval.maximum} step="1" required
              value={minutes} onChange={event => setMinutes(event.target.value === '' ? '' : event.target.valueAsNumber)} disabled={pending} />
            <span>minutes</span>
            <button type="submit" className="button button-secondary" disabled={pending || !changed}>Apply interval</button>
          </form>
          <span className="recurring-status">
            <span className={`status-dot${schedule.enabled ? ' live-dot' : ''}`} aria-hidden="true" />
            {schedule.running ? 'Recurring scan in progress' : !schedule.enabled ? 'Off'
              : schedule.nextScanAt ? <NextScan timestamp={schedule.nextScanAt} /> : 'Scheduled'}
          </span>
        </div>
        {schedule.error && <p className="recurring-error" role="status">{schedule.error}</p>}
        <div className="recurring-details">
          <p>{savedGame ? <>Scan setup: <strong>{savedGame}</strong> · {schedule.conditions.durationSeconds} s per scan</>
            : setupReady ? <>Scan setup: <strong>{conditions.game || conditions.gameExecutable}</strong> · {conditions.durationSeconds} s per scan</>
              : 'Choose a game process and capture duration in Capture setup to turn on recurring scans.'}</p>
          {hasNewSetup && <button type="button" className="button button-secondary" disabled={pending} onClick={() => onSave({
            enabled: schedule.enabled, intervalMinutes: schedule.intervalMinutes, conditions,
          })}>Use current scan setup</button>}
        </div>
      </>}
      {schedule.latest && <div className="recurring-latest">
        <p>Latest scan <time dateTime={new Date(schedule.latest.startedAt).toISOString()}>{dateTime.format(schedule.latest.startedAt)}</time></p>
        <button type="button" className="button button-secondary" aria-expanded={showLatest} onClick={() => setShowLatest(value => !value)}>
          {showLatest ? 'Hide latest recurring scan' : 'View latest recurring scan'}
        </button>
      </div>}
    </section>
    {schedule.latest && showLatest && children}
  </>
}
