import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { AppIcon } from './workflow'

export const processTagLabels = { suspicious: 'Suspicious', bloat: 'Bloat' }

const signatureLabels = {
  valid: 'Valid Windows signature',
  unsigned: 'Unsigned',
  invalid: 'Windows could not validate the signature',
  unavailable: 'Unavailable',
}

function previewEvidence(row) {
  return {
    signature: row.id === 'overlay' || row.isSelf ? 'unsigned' : 'valid',
    publisher: row.id === 'sync' ? 'Microsoft Corporation' : null,
    sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  }
}

export function ProcessDetails({ row, tags, isPreview, bridge, onSaveTags, onClose }) {
  const dialog = useRef(null)
  const [evidence, setEvidence] = useState(null)
  const [inspecting, setInspecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [tagStatus, setTagStatus] = useState(null)
  const [evidenceStatus, setEvidenceStatus] = useState(null)
  const [uninstallStatus, setUninstallStatus] = useState(null)

  useEffect(() => { dialog.current.showModal() }, [])

  function close() {
    dialog.current.close()
    onClose()
  }

  async function toggleTag(tag) {
    setSaving(true)
    setTagStatus(null)
    const updated = tags.includes(tag) ? tags.filter(value => value !== tag) : [...tags, tag]
    try {
      await onSaveTags(row.id, updated)
    } catch {
      setTagStatus('Could not save the tags. Check that the app is still running and try again.')
    } finally {
      setSaving(false)
    }
  }

  async function inspect() {
    setInspecting(true)
    setEvidence(null)
    setEvidenceStatus(null)
    try {
      setEvidence(isPreview ? previewEvidence(row) : await bridge.inspectProcess(row.id))
    } catch {
      setEvidenceStatus('Could not check the executable. Check that the app is still running and try again.')
    } finally {
      setInspecting(false)
    }
  }

  async function openVirusTotal() {
    setOpening(true)
    setEvidenceStatus(null)
    try {
      if (!isPreview) await bridge.lookupProcessReputation(row.id, evidence.sha256)
      setEvidenceStatus(isPreview ? 'In live mode, this opens the file hash report in your browser.' : 'Opened the file hash report in your browser.')
    } catch {
      setEvidenceStatus('Could not open the report. Try checking the executable again.')
    } finally {
      setOpening(false)
    }
  }

  async function openInstalledApps() {
    setOpening(true)
    setUninstallStatus(null)
    try {
      if (!isPreview) await bridge.openInstalledApps(row.id)
      setUninstallStatus(isPreview ? 'In live mode, this opens Installed apps in Windows Settings.' : 'Opened Installed apps in Windows Settings.')
    } catch {
      setUninstallStatus('Could not open Installed apps. Open Windows Settings and choose Apps, then Installed apps.')
    } finally {
      setOpening(false)
    }
  }

  return <dialog ref={dialog} className="confirm-dialog process-details" aria-labelledby="process-details-title"
    onCancel={event => { event.preventDefault(); close() }}>
    <header className="process-details-heading">
      <AppIcon item={row} />
      <div><h2 id="process-details-title">{row.name}</h2><p>{row.executable}{row.isSelf && ' · This app'}</p></div>
      <button className="icon-button" type="button" aria-label="Close app details" autoFocus onClick={close}><Icon name="close" size={18} /></button>
    </header>

    {row.canInspect && <fieldset className="process-detail-section" disabled={saving}>
      <legend>Tags</legend>
      <p>Use these labels to keep track of apps you want to review.</p>
      <div className="process-tag-choices">{Object.entries(processTagLabels).map(([tag, label]) => <label key={tag}>
        <input type="checkbox" className="app-checkbox" checked={tags.includes(tag)} onChange={() => void toggleTag(tag)} />{label}
      </label>)}</div>
      {tagStatus && <p className="process-detail-message" role="alert">{tagStatus}</p>}
    </fieldset>}

    <section className="process-detail-section" aria-labelledby="process-evidence-title" aria-busy={inspecting}>
      <h3 id="process-evidence-title">Executable checks</h3>
      {row.canInspect ? <>
        <p>Check the Windows signature and SHA-256 file hash on this device.</p>
        <button className="button button-secondary" type="button" disabled={inspecting || opening} onClick={() => void inspect()}>
          <Icon name="shield" size={16} />{inspecting ? 'Checking…' : evidence ? 'Check again' : 'Check executable'}
        </button>
        {evidence && <>
          <dl className="process-evidence">
            <div><dt>Signature</dt><dd>{signatureLabels[evidence.signature] ?? 'Unavailable'}</dd></div>
            <div><dt>Publisher</dt><dd>{evidence.publisher || 'Unavailable'}</dd></div>
            <div><dt>SHA-256</dt><dd>{evidence.sha256 ? <code>{evidence.sha256}</code> : 'Unavailable'}</dd></div>
          </dl>
          {evidence.sha256 && <>
            <p id="process-reputation-copy">VirusTotal receives the SHA-256 hash and opens a report in your browser. A valid signature or a missing report can’t rule out malware.</p>
            <button className="button button-secondary" type="button" aria-describedby="process-reputation-copy"
              disabled={opening || inspecting} onClick={() => void openVirusTotal()}><Icon name="arrow" size={15} />Look up hash on VirusTotal</button>
          </>}
        </>}
        {evidenceStatus && <p className="process-detail-message" role="status">{evidenceStatus}</p>}
      </> : <p>Executable details are unavailable for this process.</p>}
    </section>

    {row.canUninstall && <section className="process-detail-section" aria-labelledby="process-uninstall-title">
      <h3 id="process-uninstall-title">Uninstall</h3>
      <p id="process-uninstall-copy">Find the app in Windows Installed apps, then review and confirm removal there. Portable apps may be absent.</p>
      <button className="button button-secondary" type="button" aria-describedby="process-uninstall-copy"
        disabled={opening} onClick={() => void openInstalledApps()}>Uninstall in Windows<Icon name="arrow" size={15} /></button>
      {uninstallStatus && <p className="process-detail-message" role="status">{uninstallStatus}</p>}
    </section>}
  </dialog>
}
