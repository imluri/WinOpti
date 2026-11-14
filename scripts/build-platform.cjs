const { existsSync, mkdirSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')

function compile(source, output, flags = []) {
  const frameworkRoot = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET')
  const framework = ['Framework64', 'Framework']
    .map(name => join(frameworkRoot, name, 'v4.0.30319'))
    .find(folder => existsSync(join(folder, 'csc.exe')))
  if (!framework) throw new Error('The Windows .NET Framework compiler was not found.')

  mkdirSync(resolve(output, '..'), { recursive: true })
  const result = spawnSync(join(framework, 'csc.exe'), [
    '/nologo',
    '/platform:anycpu',
    '/optimize+',
    ...flags,
    '/out:' + output,
    source
  ], { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('The Windows helper compiler exited with an error.')
}

if (require.main === module && process.platform === 'win32') {
  const root = resolve(__dirname, '..')
  const source = join(root, 'electron', 'winopti-platform.cs')
  const executable = join(root, 'dist', 'winopti-platform.exe')
  const latestSourceChange = Math.max(statSync(source).mtimeMs, statSync(__filename).mtimeMs)
  if (!existsSync(executable) || statSync(executable).mtimeMs < latestSourceChange) {
    try {
      compile(source, executable, ['/target:exe', '/reference:System.Web.Extensions.dll'])
    } catch (error) {
      if (existsSync(executable)) console.error('If WinOpti is running, close it and retry the build.')
      throw error
    }
  }
}

module.exports = { compile }
