const { app } = require('electron')
const { realpath } = require('node:fs/promises')

const cacheLimit = 256
const retryAfter = 30_000
const icons = new Map()

function localExecutable(path) {
  if (typeof path !== 'string') return null
  const file = path.replace(/^\\\\\?\\(?=[a-z]:\\)/i, '')
  return /^[a-z]:\\[^<>:"|?*\x00-\x1f]+\.exe$/i.test(file) ? file : null
}

async function loadIcon(file) {
  const resolved = localExecutable(await realpath(file))
  if (!resolved) return null
  const icon = await app.getFileIcon(resolved, { size: 'normal' })
  return icon.isEmpty() ? null : 'data:image/png;base64,' + icon.toPNG().toString('base64')
}

async function getExecutableIcon(path) {
  if (process.platform !== 'win32') return null
  const file = localExecutable(path)
  if (!file) return null

  const key = file.toLowerCase()
  const cached = icons.get(key)
  icons.delete(key)
  if (cached && Date.now() < cached.retryAt) {
    icons.set(key, cached)
    return cached.promise
  }

  const entry = { retryAt: Infinity }
  entry.promise = loadIcon(file).catch(() => null).then(icon => {
    if (!icon) entry.retryAt = Date.now() + retryAfter
    return icon
  })
  icons.set(key, entry)
  if (icons.size > cacheLimit) icons.delete(icons.keys().next().value)
  return entry.promise
}

module.exports = { getExecutableIcon }
