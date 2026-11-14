import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { processTags, type LiveProcesses, type ProcessTag } from '../shared/processes'
import { inspectExecutable } from './process-evidence'
import type { LiveProcessTarget } from './live-processes'

function validTags(value: unknown): value is ProcessTag[] {
  return Array.isArray(value) && value.length <= processTags.length && value.every(tag => processTags.includes(tag))
}

export async function createProcessReview(options: {
  statePath: string
  getProcesses: () => LiveProcesses | Promise<LiveProcesses>
  getTarget: (id: string) => LiveProcessTarget | undefined
  openExternal: (url: string) => Promise<void>
  inspect?: typeof inspectExecutable
}) {
  let tags = new Map<string, ProcessTag[]>()
  try {
    const saved = JSON.parse(await readFile(options.statePath, 'utf8'))
    if (saved?.version === 1 && Array.isArray(saved.tags)) {
      for (const entry of saved.tags) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && validTags(entry[1])) tags.set(entry[0], entry[1])
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  let saving = Promise.resolve()
  let checking = false
  let checked: { id: string; key: string; sha256: string } | undefined

  const keyFor = (target: LiveProcessTarget) => path.win32.normalize(target.executable).toLowerCase()

  async function resolveTarget(id: unknown) {
    if (typeof id !== 'string' || !/^\d{1,16}$/.test(id)) throw new Error('Choose a process from the list.')
    await options.getProcesses()
    const target = options.getTarget(id)
    if (!target) throw new Error('This process is no longer available for review. Refresh the process list.')
    return { id, target, key: keyFor(target) }
  }

  return {
    async getProcesses() {
      const reading = await options.getProcesses()
      return {
        ...reading,
        rows: reading.rows.map(row => {
          const target = options.getTarget(row.id)
          return { ...row, tags: target ? tags.get(keyFor(target)) ?? [] : [] }
        }),
      }
    },
    async setProcessTags(id: unknown, value: unknown) {
      if (!validTags(value)) throw new Error('Choose a valid process tag.')
      const { key } = await resolveTarget(id)
      const selected = processTags.filter(tag => value.includes(tag))
      const save = saving.catch(() => {}).then(async () => {
        const updated = new Map(tags)
        if (selected.length) updated.set(key, selected)
        else updated.delete(key)
        const temporary = `${options.statePath}.${randomUUID()}.tmp`
        try {
          await mkdir(path.dirname(options.statePath), { recursive: true })
          await writeFile(temporary, JSON.stringify({ version: 1, tags: [...updated] }), { encoding: 'utf8', flag: 'wx' })
          await rename(temporary, options.statePath)
          tags = updated
        } finally {
          await rm(temporary, { force: true }).catch(() => {})
        }
      })
      saving = save
      await save
      return selected
    },
    async inspectProcess(id: unknown) {
      if (checking) throw new Error('Wait for the current file check to finish.')
      checking = true
      checked = undefined
      try {
        const row = await resolveTarget(id)
        const evidence = await (options.inspect ?? inspectExecutable)(row.target.executable)
        if (evidence.sha256) checked = { id: row.id, key: row.key, sha256: evidence.sha256 }
        return evidence
      } finally {
        checking = false
      }
    },
    async lookupProcessReputation(id: unknown, sha256: unknown) {
      const row = await resolveTarget(id)
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
          checked?.id !== row.id || checked.key !== row.key || checked.sha256 !== sha256) {
        throw new Error('Check this executable before opening its VirusTotal report.')
      }
      await options.openExternal(`https://www.virustotal.com/gui/file/${sha256}`)
    },
    async openInstalledApps(id: unknown) {
      const { target } = await resolveTarget(id)
      if (!target.canUninstall) throw new Error('Uninstall is unavailable for this process.')
      await options.openExternal('ms-settings:appsfeatures')
    },
  }
}
