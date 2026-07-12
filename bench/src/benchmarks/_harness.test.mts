import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { resolveBenchPython, runStagedJudge } from './_harness'

test('resolveBenchPython defaults to the bench-local virtual environment', () => {
  assert.equal(resolveBenchPython({}, '/opt/agent-bench'), join('/opt/agent-bench', '.venv', 'bin', 'python'))
})

test('resolveBenchPython accepts an absolute consumer-managed interpreter', () => {
  assert.equal(
    resolveBenchPython({ AGENT_BENCH_PYTHON: '/srv/bench-venv/bin/python' }, '/opt/agent-bench'),
    '/srv/bench-venv/bin/python',
  )
})

test('resolveBenchPython rejects relative and empty interpreter paths', () => {
  assert.throws(
    () => resolveBenchPython({ AGENT_BENCH_PYTHON: '.venv/bin/python' }, '/opt/agent-bench'),
    /must be an absolute path/,
  )
  assert.throws(
    () => resolveBenchPython({ AGENT_BENCH_PYTHON: '' }, '/opt/agent-bench'),
    /must be an absolute path/,
  )
})

test('runStagedJudge terminates a hung evaluator at its explicit timeout', async () => {
  const started = Date.now()
  await assert.rejects(
    () => runStagedJudge({
      tmpPrefix: 'timeout-test-',
      async stage() {},
      bin: process.execPath,
      argv: () => ['-e', 'setInterval(() => {}, 1_000)'],
      timeoutMs: 100,
      async parseReport() {
        throw new Error('timed-out evaluator must not reach report parsing')
      },
    }),
    /evaluator failed/,
  )
  assert.ok(Date.now() - started < 5_000)
})
