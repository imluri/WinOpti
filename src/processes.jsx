import React, { useCallback, useMemo, useState } from 'react'
import { Icon } from './icons'
import { AppIcon } from './workflow'
import { useLivePolling } from './use-live-polling'

const MiB = 1024 ** 2
const GiB = 1024 ** 3
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const measured = value => Number.isFinite(value) && value >= 0
const percentage = value => `${value.toFixed(1)}%`
const memory = value => value >= GiB ? `${(value / GiB).toFixed(2)} GiB` : `${(value / MiB).toFixed(1)} MiB`
const io = value => {
  if (value >= MiB) return `${(value / MiB).toFixed(2)} MiB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB/s`
  return `${Math.round(value)} B/s`
}

const columns = [
  { key: 'name', label: 'App' },
  { key: 'cpuPercent', label: 'CPU', format: percentage, bar: true },
  { key: 'gpuPercent', label: 'GPU', format: percentage, bar: true },
  { key: 'memoryBytes', label: 'RAM', format: memory },
  { key: 'diskBytesPerSecond', label: 'Disk', format: io },
  { key: 'ioBytesPerSecond', label: 'Process I/O', format: io },
]

const exampleRows = [
  ['game', 'Apex Legends', 'r5apex.exe', 1, 22.7, 68.4, 6400, 1.9, 1.1],
  ['browser', 'Google Chrome', 'chrome.exe', 14, 8.4, 5.2, 2360, 2.8, .9],
  ['stream', 'OBS Studio', 'obs64.exe', 1, 5.6, 12.9, 840, 8.4, 6.1],
  ['chat', 'Discord', 'Discord.exe', 6, 3.8, 2.0, 660, .24, .06],
  ['steam', 'Steam', 'steam.exe', 8, 1.2, .6, 780, .42, .18],
  ['sync', 'Microsoft OneDrive', 'OneDrive.exe', 1, .9, 0, 191, 5.1, 2.5],
  ['node', 'Node.js', 'node.exe', 2, .4, null, 281, .03, .01],
  ['winopti', 'WinOpti', 'WinOpti.exe', 5, .2, .1, 323, .06, .02],
  ['system', 'Windows system process', 'System', 1, null, null, null, null, null],
].map(([id, name, executable, processCount, cpuPercent, gpuPercent, memoryMiB, ioMiB, diskMiB]) => ({
  id, name, executable, processCount, cpuPercent, gpuPercent,
  memoryBytes: memoryMiB === null ? null : memoryMiB * MiB,
  ioBytesPerSecond: ioMiB === null ? null : ioMiB * MiB,
  diskBytesPerSecond: diskMiB === null ? null : diskMiB * MiB,
}))

function compareRows(left, right, sort) {
  const a = left[sort.key]
  const b = right[sort.key]
  const direction = sort.descending ? -1 : 1
  if (sort.key === 'name') return names.compare(a, b) * direction || names.compare(left.id, right.id)
  if (measured(a) !== measured(b)) return measured(a) ? -1 : 1
  return (measured(a) ? (a - b) * direction : 0) || names.compare(left.name, right.name) || names.compare(left.id, right.id)
}

function ValueCell({ row, column }) {
  const value = row[column.key]
  const available = measured(value)
  return <td className="process-value">
    {available ? <>
      {column.bar && value > 0 && <span className="process-usage-bar" aria-hidden="true" style={{ width: `${Math.min(value, 100)}%` }} />}
      <span>{column.format(value)}</span>
    </> : <span className="process-value-missing"><span aria-hidden="true">—</span><span className="process-screen-reader">Unavailable</span></span>}
  </td>
}

export function ProcessesPage({ isPreview, fetchProcesses }) {
  const [snapshot, setSnapshot] = useState(null)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'cpuPercent', descending: true })
  const onError = useCallback(() => setFailed(true), [])
  const onResult = useCallback(result => {
    if (!Array.isArray(result?.rows) || !measured(result.at)) {
      setFailed(true)
      return
    }
    setSnapshot(result)
    setFailed(false)
  }, [])
  const live = !isPreview && Boolean(fetchProcesses)
  useLivePolling(fetchProcesses, live && !paused, onResult, onError)

  const allRows = isPreview ? exampleRows : snapshot?.rows ?? []
  const query = search.trim().toLowerCase()
  const rows = useMemo(() => allRows.filter(row => (
    !query || row.name.toLowerCase().includes(query) || row.executable?.toLowerCase().includes(query)
  )).sort((left, right) => compareRows(left, right, sort)), [allRows, query, sort])
  const connected = live && !paused && !failed && snapshot
  const status = isPreview ? 'Example readings' : paused ? 'Updates paused' : !live || failed
    ? snapshot ? 'Readings interrupted' : 'Readings unavailable'
    : snapshot ? 'Updating every second' : 'Collecting processes…'
  const empty = !snapshot && !isPreview
    ? !live || failed ? 'Windows process readings are unavailable.' : paused ? 'Resume to collect readings.' : 'Waiting for the first sample.'
    : query ? 'No apps match your search.' : 'No running apps were found.'

  function changeSort(key) {
    setSort(current => ({ key, descending: current.key === key ? !current.descending : key !== 'name' }))
  }

  return <>
    <header className="page-heading processes-heading">
      <div><h1>Processes</h1><p>See which running apps are using the most resources.</p></div>
      <div className="performance-status" role="status"><span className={`status-dot${connected ? ' live-dot' : ''}`} aria-hidden="true" />{status}</div>
    </header>
    <section className="panel processes-panel" aria-label="Running apps">
      <div className="processes-toolbar">
        <label className="processes-search">
          <Icon name="search" size={16} />
          <input className="setting-input" type="search" aria-label="Search running apps" placeholder="Search apps"
            value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <div className="processes-toolbar-actions">
          {(snapshot || isPreview) && <span>{query ? `${rows.length} of ` : ''}{allRows.length} {allRows.length === 1 ? 'app' : 'apps'}</span>}
          {live && <button className="button button-secondary" type="button" onClick={() => setPaused(value => !value)}>
            <Icon name={paused ? 'play' : 'pause'} size={15} />{paused ? 'Resume updates' : 'Pause updates'}
          </button>}
        </div>
      </div>
      <div className="processes-scroll" role="region" aria-label="Process usage table" tabIndex={0}>
        <table className="processes-table">
          <caption className="process-screen-reader">Running apps grouped by executable. Select a column heading to sort.</caption>
          <thead><tr>{columns.map(column => {
            const selected = sort.key === column.key
            return <th key={column.key} scope="col" aria-sort={selected ? sort.descending ? 'descending' : 'ascending' : undefined}>
              <button type="button" className="process-sort" onClick={() => changeSort(column.key)}>
                {column.label}<span className={`process-sort-arrow${selected && !sort.descending ? ' process-sort-up' : ''}`} aria-hidden="true">
                  <Icon name="down" size={13} />
                </span>
              </button>
            </th>
          })}</tr></thead>
          <tbody>{rows.length ? rows.map(row => <tr key={row.id}>
            <th scope="row"><div className="process-name-cell">
              <AppIcon item={row} />
              <div className="process-name"><strong title={row.name}>{row.name}</strong>
                <small title={row.executable}>{row.executable}{row.processCount > 1 && ` · ${row.processCount} processes`}</small></div>
            </div></th>
            {columns.slice(1).map(column => <ValueCell key={column.key} row={row} column={column} />)}
          </tr>) : <tr><td className="processes-empty" colSpan={columns.length}>{empty}</td></tr>}</tbody>
        </table>
      </div>
      <div className="processes-footer">
        <p>RAM is the combined working set and may include shared pages. GPU shows the busiest engine. Disk refreshes less often than other readings. Process I/O includes file, network, and device reads and writes.</p>
        {snapshot && <div className="processes-timestamps">
          <time dateTime={new Date(snapshot.at).toISOString()}>Last sample {clock.format(snapshot.at)}</time>
          {measured(snapshot.diskAt)
            ? <time dateTime={new Date(snapshot.diskAt).toISOString()}>Disk sample {clock.format(snapshot.diskAt)}</time>
            : <span>Disk is warming up or unavailable</span>}
        </div>}
      </div>
    </section>
  </>
}
