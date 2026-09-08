import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { packageNodeTestArgs, resolvePackageTestTimeoutMs, run, runPythonTests } from './run-package-tests.mjs'

test('package test concurrency reaches Node without changing selected files', () => {
  const files = ['src/first.test.mts', 'src/second.test.ts']
  assert.deepEqual(packageNodeTestArgs(files, {}), ['--test', '--import', 'tsx', ...files])
  assert.deepEqual(packageNodeTestArgs(files, { AGENT_BENCH_PACKAGE_TEST_CONCURRENCY: '1' }), [
    '--test', '--test-concurrency=1', '--import', 'tsx', ...files,
  ])
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.throws(
      () => packageNodeTestArgs(files, { AGENT_BENCH_PACKAGE_TEST_CONCURRENCY: value }),
      /must be a positive safe integer/,
    )
  }
})

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

test('Python fixtures use physical temporary paths without relaxing symlink guards', async () => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'bench-python-temp-'))
  try {
    const target = path.join(root, 'physical')
    const linked = path.join(root, 'linked')
    const recorded = path.join(root, 'recorded.json')
    const launcher = path.join(root, 'python-fixture')
    await mkdir(target)
    await symlink(target, linked, 'dir')
    await writeFile(launcher, `#!${process.execPath}
const fs = require('node:fs'); fs.writeFileSync(process.env.RECORDED, JSON.stringify({ temporary: process.env.TMPDIR, args: process.argv.slice(2) }))
`, { mode: 0o755 })
    await runPythonTests(launcher, { ...process.env, TMPDIR: linked, RECORDED: recorded })
    assert.deepEqual(JSON.parse(await readFile(recorded, 'utf8')), {
      temporary: target,
      args: ['-m', 'unittest', 'discover', '-s', 'pier_agents', '-p', '*_test.py'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
