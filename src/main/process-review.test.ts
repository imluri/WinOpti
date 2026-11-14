import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import type { LiveProcessRow } from '../shared/processes'
import { createProcessReview } from './process-review'

function row(id: string): LiveProcessRow {
  return {
    id, name: 'Example', executable: 'Example.exe', processCount: 1,
    cpuPercent: null, gpuPercent: null, memoryBytes: null, diskBytesPerSecond: null, ioBytesPerSecond: null,
  }
}

async function testDirectory() {
  const parent = path.resolve('dist')
  await mkdir(parent, { recursive: true })
  return mkdtemp(path.join(parent, 'winopti-review-'))
}

test('keeps tags by executable path across concurrent edits and restart', async () => {
  const directory = await testDirectory()
  const target = new Map([
    ['1', { executable: 'C:\\Apps\\Example.exe', canUninstall: true }],
    ['2', { executable: 'D:\\Apps\\Example.exe', canUninstall: true }],
  ])
  const options = {
    statePath: path.join(directory, 'tags.json'),
    getProcesses: () => ({ at: 1, diskAt: null, rows: [...target.keys()].map(row) }),
    getTarget: (id: string) => target.get(id),
    openExternal: async () => {},
  }
  try {
    const review = await createProcessReview(options)
    await assert.rejects(review.setProcessTags('1', ['trusted']), /valid process tag/)
    assert.deepEqual(await Promise.all([
      review.setProcessTags('1', ['bloat', 'bloat']), review.setProcessTags('2', ['suspicious']),
    ]), [['bloat'], ['suspicious']])
    target.delete('1')
    target.set('3', { executable: 'c:\\apps\\EXAMPLE.EXE', canUninstall: true })
    const restarted = await createProcessReview(options)
    assert.deepEqual((await restarted.getProcesses()).rows.map(row => row.tags), [['suspicious'], ['bloat']])
    await restarted.setProcessTags('3', [])
    assert.deepEqual((await restarted.getProcesses()).rows.map(row => row.tags), [['suspicious'], []])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('opens only fixed destinations for available processes and shares a locally checked hash', async () => {
  const directory = await testDirectory()
  const sha256 = 'a'.repeat(64)
  const urls: string[] = []
  const target = new Map([
    ['1', { executable: 'C:\\Apps\\Example.exe', canUninstall: true }],
    ['2', { executable: 'C:\\Windows\\explorer.exe', canUninstall: false }],
  ])
  try {
    const review = await createProcessReview({
      statePath: path.join(directory, 'tags.json'),
      getProcesses: () => ({ at: 1, diskAt: null, rows: [...target.keys()].map(row) }),
      getTarget: id => target.get(id),
      openExternal: async url => { urls.push(url) },
      inspect: async executable => {
        assert.equal(executable, 'C:\\Apps\\Example.exe')
        return { sha256, signature: 'unsigned', publisher: null }
      },
    })
    await assert.rejects(review.inspectProcess('C:\\elsewhere.exe'), /Choose a process/)
    await assert.rejects(review.lookupProcessReputation('1', sha256), /Check this executable/)
    await assert.rejects(review.openInstalledApps('2'), /Uninstall is unavailable/)
    assert.equal((await review.inspectProcess('1')).sha256, sha256)
    await assert.rejects(review.lookupProcessReputation('1', 'b'.repeat(64)), /Check this executable/)
    await assert.rejects(review.lookupProcessReputation('2', sha256), /Check this executable/)
    await review.lookupProcessReputation('1', sha256)
    await review.openInstalledApps('1')
    target.delete('1')
    await assert.rejects(review.openInstalledApps('1'), /no longer available/)
    assert.deepEqual(urls, [`https://www.virustotal.com/gui/file/${sha256}`, 'ms-settings:appsfeatures'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
