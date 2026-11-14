import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { win32 } from 'node:path'

export type ExecutableEvidence = {
  sha256: string | null
  signature: 'valid' | 'unsigned' | 'invalid' | 'unavailable'
  publisher: string | null
}

const unavailable: ExecutableEvidence = { sha256: null, signature: 'unavailable', publisher: null }
const timeoutMs = 10_000

// The process path is data in the child environment and never enters the script text.
const signatureCommand = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $env:WINOPTI_INSPECTION_PATH
$publisher = if ($signature.Status -eq 'Valid' -and $signature.SignerCertificate) {
  $signature.SignerCertificate.GetNameInfo('SimpleName', $false)
}
@{ status = [string]$signature.Status; publisher = $publisher } | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
`

async function hashFile(filePath: string) {
  const hash = createHash('sha256')
  try {
    const stream = createReadStream(filePath, { signal: AbortSignal.timeout(timeoutMs) })
    for await (const chunk of stream) hash.update(chunk)
    return hash.digest('hex')
  } catch {
    return null
  }
}

function readSignature(filePath: string): Promise<Pick<ExecutableEvidence, 'signature' | 'publisher'>> {
  const systemRoot = process.env.SystemRoot
  if (!systemRoot) return Promise.resolve(unavailable)
  const powerShellRoot = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  const executable = win32.join(powerShellRoot, 'powershell.exe')
  return new Promise((resolve) => {
    execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', signatureCommand], {
      cwd: powerShellRoot,
      env: {
        SystemRoot: systemRoot,
        PSModulePath: win32.join(powerShellRoot, 'Modules'),
        WINOPTI_INSPECTION_PATH: filePath,
      },
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) return resolve(unavailable)
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, ''))
        if (result.status === 'NotSigned') return resolve({ signature: 'unsigned', publisher: null })
        if (result.status === 'HashMismatch' || result.status === 'NotTrusted') {
          return resolve({ signature: 'invalid', publisher: null })
        }
        if (result.status !== 'Valid') return resolve(unavailable)
        const publisher = typeof result.publisher === 'string'
          ? result.publisher.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 256)
          : null
        resolve({ signature: 'valid', publisher: publisher || null })
      } catch {
        resolve(unavailable)
      }
    })
  })
}

export async function inspectExecutable(filePath: string): Promise<ExecutableEvidence> {
  if (process.platform !== 'win32' || !/^[a-z]:\\[^:\0]+\.exe$/i.test(filePath)) return { ...unavailable }
  try {
    const before = await stat(filePath, { bigint: true })
    if (!before.isFile()) return { ...unavailable }
    const [sha256, signature] = await Promise.all([hashFile(filePath), readSignature(filePath)])
    const after = await stat(filePath, { bigint: true })
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return { ...unavailable }
    return { ...signature, sha256 }
  } catch {
    return { ...unavailable }
  }
}
