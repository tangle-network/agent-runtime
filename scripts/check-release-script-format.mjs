#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RELEASE_SCRIPT_PATHS = Object.freeze([
  'scripts/verify-packed-cohort.mjs',
  'scripts/lib/packed-cohort-archive.mjs',
  'scripts/lib/packed-cohort-build.mjs',
  'scripts/lib/packed-cohort-metadata.mjs',
  'scripts/lib/packed-cohort-process.mjs',
])

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function runReleaseScriptFormatCheck(root = workspaceRoot) {
  const checkedRoot = resolve(root)
  const missing = RELEASE_SCRIPT_PATHS.filter((relativePath) => {
    const path = join(checkedRoot, relativePath)
    return !existsSync(path) || !statSync(path).isFile()
  })
  if (missing.length > 0) {
    throw new Error(
      `release-script format check could not find targeted files: ${missing.join(', ')}`,
    )
  }

  const biome = join(
    workspaceRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'biome.cmd' : 'biome',
  )
  if (!existsSync(biome)) {
    throw new Error(`release-script format check could not find the local Biome binary: ${biome}`)
  }

  const result = spawnSync(
    biome,
    [
      'check',
      '--files-ignore-unknown=false',
      '--vcs-use-ignore-file=false',
      ...RELEASE_SCRIPT_PATHS,
    ],
    { cwd: checkedRoot, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  return result.status ?? 1
}

function main(args) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--root')) {
    throw new Error('usage: node scripts/check-release-script-format.mjs [--root <directory>]')
  }
  return runReleaseScriptFormatCheck(args.length === 0 ? workspaceRoot : args[1])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
