import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { ProcessIdentity, Snapshot } from '../shared/winopti'

export type CloseAttempt = {
  status: 'requested' | 'exited' | 'identity-changed' | 'no-window' | 'denied'
  detail: string
}

type HelperAction = { action: 'snapshot' } | { action: 'close'; identity: ProcessIdentity }
type PendingRequest = {
  complete: (value: unknown) => void
  fail: (error: Error) => void
}

export function createWindowsPlatform(executable = resolve('dist', 'winopti-platform.exe')) {
  let child: ChildProcessWithoutNullStreams | null = null
  let requestId = 0
  let disposed = false
  const pending = new Map<number, PendingRequest>()

  function disconnect(process: ChildProcessWithoutNullStreams, message: string) {
    if (child !== process) return
    child = null
    process.stdin.end()
    // This is WinOpti's own telemetry helper. Target processes are never terminated here.
    if (process.exitCode === null) process.kill()
    const error = new Error(message)
    for (const request of pending.values()) request.fail(error)
    pending.clear()
  }

  function getHelper() {
    if (disposed) throw new Error('The Windows helper was closed.')
    if (process.platform !== 'win32') throw new Error('Windows process metrics require Windows.')
    if (child) return child
    const helper = spawn(executable, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child = helper
    helper.stderr.resume()
    helper.on('error', () => disconnect(helper, 'Could not start the Windows metrics helper.'))
    helper.on('exit', () => disconnect(helper, 'The Windows metrics helper exited.'))
    helper.stdin.on('error', () => disconnect(helper, 'Could not communicate with the Windows metrics helper.'))
    createInterface({ input: helper.stdout, crlfDelay: Infinity }).on('line', (line) => {
      if (child !== helper) return
      try {
        const message = JSON.parse(line)
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        if (typeof message.error === 'string') request.fail(new Error(message.error))
        else request.complete(message.result)
      } catch {
        disconnect(helper, 'Received an invalid response from the Windows metrics helper.')
      }
    })
    return helper
  }

  function send<T>(action: HelperAction): Promise<T> {
    return new Promise((complete, fail) => {
      const helper = getHelper()
      const id = ++requestId
      const timer = setTimeout(() => disconnect(helper, 'The Windows metrics helper timed out.'), 20_000)
      pending.set(id, {
        complete(value) {
          clearTimeout(timer)
          complete(value as T)
        },
        fail(error) {
          clearTimeout(timer)
          fail(error)
        }
      })
      helper.stdin.write(JSON.stringify({ id, ...action }) + '\n', 'utf8')
    })
  }

  return {
    snapshot: () => send<Snapshot>({ action: 'snapshot' }),
    requestClose(identity: ProcessIdentity): Promise<CloseAttempt> {
      if (!Number.isInteger(identity.pid) || identity.pid <= 0 || identity.pid > 0xffffffff ||
          typeof identity.creationToken !== 'string' || !/^\d+$/.test(identity.creationToken) ||
          typeof identity.executable !== 'string' || !identity.executable) {
        return Promise.resolve({ status: 'denied', detail: 'WinOpti could not verify this process identity.' })
      }
      return send<CloseAttempt>({ action: 'close', identity })
    },
    dispose() {
      disposed = true
      if (child) disconnect(child, 'The Windows helper was closed.')
    }
  }
}
