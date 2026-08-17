#!/usr/bin/env node
/**
 * Fail a workspace package that would publish an exact first-party version pin.
 *
 * An exact pin is not a compatibility statement. It names one version and
 * refuses every other, so a consumer that already holds a later cohort member
 * installs a SECOND physical copy of the pinned package. Two copies of
 * `@tangle-network/agent-interface` in one tree means two class identities, two
 * module registries, and `instanceof` answering false across the seam.
 *
 * The pin is rarely written by hand. A `catalog:` entry and a `workspace:*`
 * specifier are both replaced by an exact version when the package is packed,
 * so the source manifest looks clean and only the PACKED manifest carries the
 * defect. This check therefore packs and reads the archive, never the source.
 *
 * Usage: node scripts/check-published-ranges.mjs [package-directory ...]
 *   Defaults to every publishable package in the workspace.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  assertFirstPartyRangeSpecs,
  assertPublishableDependencySpecs,
} from './lib/packed-package-test.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function workspacePackageDirectories() {
  const workspacePath = join(repoRoot, 'pnpm-workspace.yaml')
  const directories = [repoRoot]
  if (!existsSync(workspacePath)) return directories
  const workspace = parseYaml(readFileSync(workspacePath, 'utf8'))
  for (const entry of workspace?.packages ?? []) {
    if (typeof entry !== 'string' || entry.includes('*')) {
      throw new Error(`pnpm-workspace.yaml entry is not a plain directory: ${String(entry)}`)
    }
    directories.push(resolve(repoRoot, entry))
  }
  return directories
}

function packedManifest(packageDirectory) {
  const scratch = mkdtempSync(join(tmpdir(), 'agent-runtime-published-ranges-'))
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', scratch], {
      cwd: packageDirectory,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    })
    const archives = readdirSync(scratch).filter((name) => name.endsWith('.tgz'))
    if (archives.length !== 1) {
      throw new Error(
        `${packageDirectory} produced ${archives.length} archives, expected exactly one`,
      )
    }
    return JSON.parse(
      execFileSync('tar', ['-xOzf', join(scratch, archives[0]), 'package/package.json'], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }),
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const requested = process.argv.slice(2).map((entry) => resolve(repoRoot, entry))
const directories = requested.length > 0 ? requested : workspacePackageDirectories()
const failures = []

for (const directory of directories) {
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`no package.json at ${directory}`)
  const source = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (source.private === true) continue
  const manifest = packedManifest(directory)
  try {
    assertPublishableDependencySpecs(manifest)
    assertFirstPartyRangeSpecs(manifest)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
    continue
  }
  const firstParty = Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  })
    .filter(([name]) => name.startsWith('@tangle-network/'))
    .map(([name, spec]) => `${name}@${spec}`)
    .sort()
  process.stdout.write(
    `${manifest.name}@${manifest.version} packed from ${relative(repoRoot, directory) || '.'}: ${
      firstParty.length > 0 ? firstParty.join(', ') : 'no first-party dependencies'
    }\n`,
  )
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n\n')}\n`)
  process.exitCode = 1
}
