/**
 * The two tau upstream-pin refusals that protect a benchmark receipt: a score
 * must never be attributed to code the checkout no longer holds.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertTauUpstreamPinUnchanged } from './tau-bench-shared'
import { createTau3BankingAdapter } from './tau3-banking'

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
}

test('a dirty upstream checkout is refused before any task load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tau-pin-'))
  const previous = process.env.TAU3_BENCH_DIR
  const fixtures = process.env.TAU3_FIXTURES
  try {
    await writeFile(join(dir, 'placeholder.txt'), 'committed')
    git(dir, 'init', '--quiet')
    // Fixture repo: keep machine-wide hooks out of the throwaway commit.
    git(dir, 'config', 'core.hooksPath', '/dev/null')
    git(dir, 'add', '-A')
    git(dir, '-c', 'user.email=bench@test', '-c', 'user.name=bench', 'commit', '--quiet', '-m', 'pin fixture')
    await writeFile(join(dir, 'placeholder.txt'), 'edited after the commit')

    delete process.env.TAU3_FIXTURES
    process.env.TAU3_BENCH_DIR = dir
    await assert.rejects(() => createTau3BankingAdapter().loadTasks({ limit: 1 }), /uncommitted changes/)
  } finally {
    if (previous === undefined) delete process.env.TAU3_BENCH_DIR
    else process.env.TAU3_BENCH_DIR = previous
    if (fixtures !== undefined) process.env.TAU3_FIXTURES = fixtures
    await rm(dir, { recursive: true, force: true })
  }
})

test('a checkout or interpreter that moved after load is refused at judge time', () => {
  const live = { upstreamCommit: 'abc', upstreamVersion: '1.0.1' }
  assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', live, live)
  assert.throws(
    () => assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', { upstreamCommit: 'def' }, live),
    /loaded from upstream commit def/,
  )
  assert.throws(
    () => assertTauUpstreamPinUnchanged('tau3-banking', 'task_001', { upstreamVersion: '0.9.0' }, live),
    /loaded with tau2 0\.9\.0/,
  )
})
