/**
 * Offline Terminal-Bench adapter test. Live judging needs the official
 * terminal-bench harness + Docker, so this asserts the offline surfaces and the
 * fail-loud preflight path. Run: npx tsx --test src/benchmarks/terminal-bench.test.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTerminalBenchAdapter } from './terminal-bench'

test('goldArtifact returns portable shell solutions and rejects missing ones', async () => {
  const a = createTerminalBenchAdapter()
  assert.equal(await a.goldArtifact({ id: 'with-solution', prompt: '', metadata: { solution: 'echo ok\n' } }), 'echo ok\n')
  assert.equal(await a.goldArtifact({ id: 'without-solution', prompt: '', metadata: {} }), undefined)
})

test('preflight FAILS LOUD with isolated Terminal-Bench venv instructions when harness is absent', async () => {
  const prev = process.env.TERMINAL_BENCH_VENV
  process.env.TERMINAL_BENCH_VENV = '.venv-terminal-bench-does-not-exist'
  try {
    const a = createTerminalBenchAdapter()
    await assert.rejects(a.preflight(), (e: Error) => {
      assert.match(e.message, /pip install terminal-bench/)
      assert.match(e.message, /ISOLATED venv/)
      assert.match(e.message, /TERMINAL_BENCH_VENV/)
      assert.match(e.message, /Docker daemon/)
      return true
    })
  } finally {
    if (prev === undefined) delete process.env.TERMINAL_BENCH_VENV
    else process.env.TERMINAL_BENCH_VENV = prev
  }
})

