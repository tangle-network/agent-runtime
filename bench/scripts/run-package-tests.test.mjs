import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolvePackageTestTimeoutMs, run } from './run-package-tests.mjs'

test('package test timeout is optional and caller-controlled', () => {
  assert.equal(resolvePackageTestTimeoutMs({}), undefined)
  assert.equal(resolvePackageTestTimeoutMs({ AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS: '0' }), 0)
  assert.equal(resolvePackageTestTimeoutMs({ AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS: '900000' }), 900_000)

  for (const value of ['', '-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.throws(
      () => resolvePackageTestTimeoutMs({ AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS: value }),
      /must be a non-negative safe integer/,
    )
  }
})

test('package test timeout reaches the child process', async () => {
  const env = {
    ...process.env,
    AGENT_BENCH_PACKAGE_TEST_TIMEOUT_MS: '100',
  }
  const startedAt = Date.now()

  await assert.rejects(
    run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], env),
    (error) => {
      assert.equal(error.cause?.killed, true)
      return true
    },
  )
  assert.ok(Date.now() - startedAt < 2_000)
})
