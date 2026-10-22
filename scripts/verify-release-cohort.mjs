#!/usr/bin/env node
/**
 * Run the packed-cohort check that Publish runs, before the release is tagged.
 *
 * It checks out the exact Interface, Eval and Knowledge commits named by release/cohort.json and
 * runs scripts/verify-packed-cohort.mjs against them, so a cohort error fails release:prepare
 * instead of the Publish run (0.343.0 and 0.343.1 each failed there first).
 *
 * Usage: pnpm run release:cohort
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readReleaseCohort } from './release-cohort.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkouts = { agentInterface: 'agent-interface', agentEval: 'agent-eval', agentKnowledge: 'agent-knowledge' }
const cohort = readReleaseCohort()
const root = mkdtempSync(join(tmpdir(), 'release-cohort-'))

try {
  const args = []
  for (const [key, flag] of Object.entries(checkouts)) {
    const { repository, ref } = cohort.packages[key]
    const dir = join(root, key)
    const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, stdio: 'inherit' })
    git('clone', '--quiet', '--filter=blob:none', '--no-checkout', `https://github.com/${repository}.git`, dir)
    git('-C', dir, 'checkout', '--quiet', '--detach', ref)
    args.push(`--${flag}-repo`, dir)
  }
  execFileSync(
    'node',
    [
      'scripts/verify-packed-cohort.mjs',
      ...args,
      '--cohort-manifest', 'release/cohort.json',
      '--report', join(root, 'cohort-report.json'),
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
