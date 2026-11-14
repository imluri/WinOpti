import React from 'react'
import { Icon } from './icons'

const statusLabels = {
  unavailable: 'Updates unavailable',
  idle: 'Check for new versions',
  checking: 'Checking for updates…',
  available: 'Update available',
  'not-available': 'WinOpti is up to date',
  downloading: 'Downloading update…',
  downloaded: 'Update ready to install',
  error: 'Update failed',
}

export function UpdatesPanel({ headingRef, state, pending, installBlocked, onCheck, onDownload, onInstall }) {
  const { version, status, updateVersion, progress, message } = state
  const percentage = Number.isFinite(progress) ? Math.round(Math.min(100, Math.max(0, progress))) : null
  const inProgress = status === 'checking' || status === 'downloading'
  const button = status === 'available'
    ? { label: 'Download update', icon: 'download', onClick: onDownload }
    : status === 'downloaded'
      ? { label: 'Restart and install', icon: 'reset', onClick: onInstall }
      : { label: 'Check for updates', icon: 'reset', onClick: onCheck }
  const installWaiting = status === 'downloaded' && installBlocked

  return <section className="setting-section update-settings" aria-labelledby="updates-heading">
    <div className="update-version">
      <div className="metric-icon"><Icon name="download" size={17} /></div>
      <div><h2 id="updates-heading" ref={headingRef} tabIndex={-1}>WinOpti updates</h2><p>Installed version <strong>{version}</strong></p></div>
    </div>
    <div className="update-content">
      <div className="update-status" role="status">
        <strong>{statusLabels[status]}</strong>
        {updateVersion && ['available', 'downloading', 'downloaded'].includes(status) && <span>Version {updateVersion}</span>}
        {message && <p>{message}</p>}
        {installWaiting && <p>Finish the active scan or app review before restarting.</p>}
      </div>
      {status === 'downloading' && <div className="update-progress">
        <progress aria-label="Update download progress" max={100} value={percentage ?? undefined} />
        {percentage !== null && <span>{percentage}%</span>}
      </div>}
      {status !== 'unavailable' && <div className="update-actions">
        <button type="button" className="button button-primary" onClick={button.onClick}
          disabled={pending || inProgress || installWaiting}><Icon name={button.icon} size={16} /> {button.label}</button>
      </div>}
    </div>
  </section>
}
