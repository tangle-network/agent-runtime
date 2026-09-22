import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export function createCommandRunner(packageManagerBin) {
  function captured(command, args, cwd, extraEnv = {}) {
    return run(command, args, cwd, extraEnv, 'pipe')
  }

  function run(command, args, cwd, extraEnv, stdio) {
    const env = {
      ...process.env,
      PATH: `${packageManagerBin}${delimiter}${process.env.PATH ?? ''}`,
      ...extraEnv,
    }
    delete env.FORCE_COLOR
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env,
      stdio,
      timeout: 15 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) {
      throw new Error(
        [
          `command failed: ${command} ${args.join(' ')}`,
          result.error?.message,
          typeof result.stdout === 'string' ? result.stdout.trim() : '',
          typeof result.stderr === 'string' ? result.stderr.trim() : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    return typeof result.stdout === 'string' ? result.stdout : ''
  }

  return { captured, run }
}

export function assertCleanGitCheckout(sourceRepo, packageName, captured) {
  if (!existsSync(join(sourceRepo, '.git'))) {
    throw new Error(`${packageName} source is not a Git checkout: ${sourceRepo}`)
  }
  const changes = captured(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    sourceRepo,
  ).trim()
  if (changes) {
    throw new Error(`${packageName} source has tracked changes:\n${changes}`)
  }
}

export function primaryCheckoutFor(path) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: path,
    encoding: 'utf8',
  })
  if (result.status !== 0) return path
  return dirname(result.stdout.trim())
}
