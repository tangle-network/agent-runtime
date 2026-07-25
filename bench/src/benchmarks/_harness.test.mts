import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  benchRoot,
  resolveBenchPython,
  runStagedJudge,
  venvBin,
  venvBinAt,
} from './_harness'

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

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

test('venv executable paths support package-owned and external environments', () => {
  assert.equal(venvBinAt('/srv/terminal-bench', 'tb'), join('/srv/terminal-bench', 'bin', 'tb'))
  assert.equal(
    venvBinAt('.venv-commit0', 'python'),
    join(benchRoot, '.venv-commit0', 'bin', 'python'),
  )
  assert.equal(venvBin('python'), venvBinAt('.venv', 'python'))
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

test('runStagedJudge durably captures exact evaluator and process bytes with hashes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'staged-judge-capture-test-'))
  const destination = join(scratch, 'attempt-001')
  const perTestBytes = Buffer.from([0x00, 0xff, 0x80, 0x0a, 0x41])
  const stdoutBytes = Buffer.from([0x53, 0x00, 0xff, 0x0a])
  const stderrBytes = Buffer.from([0x45, 0x80, 0x0a])
  try {
    const score = await runStagedJudge({
      tmpPrefix: 'capture-test-',
      async stage(dir) {
        await writeFile(join(dir, 'preds.json'), Buffer.from([0x7b, 0x7d]))
      },
      bin: process.execPath,
      argv: () => [
        '-e',
        [
          "const fs = require('node:fs')",
          "fs.mkdirSync('logs/run_evaluation/run/model/task', { recursive: true })",
          `fs.writeFileSync('logs/run_evaluation/run/model/task/test_output.txt', Buffer.from(${JSON.stringify([...perTestBytes])}))`,
          "fs.writeFileSync('official.report.json', Buffer.from('{\"resolved\":true}'))",
          `process.stdout.write(Buffer.from(${JSON.stringify([...stdoutBytes])}))`,
          `process.stderr.write(Buffer.from(${JSON.stringify([...stderrBytes])}))`,
        ].join(';'),
      ],
      capture: { destination },
      async parseReport(dir) {
        assert.deepEqual(
          await readFile(join(dir, 'logs/run_evaluation/run/model/task/test_output.txt')),
          perTestBytes,
        )
        return { resolved: true, score: 1 }
      },
    })

    const receipt = score.judgeArtifacts
    assert.ok(receipt)
    assert.equal(receipt.schema, 'agent-bench/judge-artifacts/v1')
    assert.equal(receipt.evaluatorSucceeded, true)
    assert.equal(receipt.directory, destination)
    assert.deepEqual(
      await readFile(join(destination, 'evaluator/logs/run_evaluation/run/model/task/test_output.txt')),
      perTestBytes,
    )
    assert.deepEqual(await readFile(join(destination, 'process/stdout.bin')), stdoutBytes)
    assert.deepEqual(await readFile(join(destination, 'process/stderr.bin')), stderrBytes)
    assert.deepEqual(
      JSON.parse(await readFile(receipt.manifestPath, 'utf8')),
      receipt,
    )

    const expected = new Map([
      ['evaluator/logs/run_evaluation/run/model/task/test_output.txt', perTestBytes],
      ['evaluator/official.report.json', Buffer.from('{"resolved":true}')],
      ['evaluator/preds.json', Buffer.from('{}')],
      ['process/stderr.bin', stderrBytes],
      ['process/stdout.bin', stdoutBytes],
    ])
    assert.deepEqual(receipt.files.map((file) => file.path), [...expected.keys()])
    for (const file of receipt.files) {
      const bytes = expected.get(file.path)
      assert.ok(bytes)
      assert.equal(file.kind, 'file')
      assert.equal(file.byteLength, bytes.byteLength)
      assert.equal(file.sha256, digest(bytes))
    }
    const treeBytes = Buffer.from(
      receipt.files
        .map((file) => `${file.path}\0${file.kind}\0${file.byteLength}\0${file.sha256}\n`)
        .join(''),
    )
    assert.equal(receipt.treeSha256, digest(treeBytes))
    assert.equal(receipt.fileCount, expected.size)
    assert.equal(
      receipt.byteLength,
      [...expected.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('runStagedJudge captures partial evaluator evidence before throwing', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'staged-judge-failure-capture-test-'))
  const destination = join(scratch, 'attempt-failed')
  try {
    let caught: unknown
    try {
      await runStagedJudge({
        tmpPrefix: 'capture-failure-test-',
        async stage() {},
        bin: process.execPath,
        argv: () => [
          '-e',
          [
            "const fs = require('node:fs')",
            "fs.mkdirSync('logs/run_evaluation/run/model/task', { recursive: true })",
            "fs.writeFileSync('logs/run_evaluation/run/model/task/run_instance.log', Buffer.from([1, 2, 255]))",
            'process.stderr.write(Buffer.from([69, 82, 82, 0, 255]))',
            'process.exit(9)',
          ].join(';'),
        ],
        capture: { destination },
        async parseReport() {
          throw new Error('failed evaluator must not reach report parsing')
        },
      })
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof Error)
    assert.match(caught.message, /evaluator failed/)
    const receipt = (caught as Error & { judgeArtifacts?: { evaluatorSucceeded: boolean } })
      .judgeArtifacts
    assert.ok(receipt)
    assert.equal(receipt.evaluatorSucceeded, false)
    assert.deepEqual(
      await readFile(join(destination, 'evaluator/logs/run_evaluation/run/model/task/run_instance.log')),
      Buffer.from([1, 2, 255]),
    )
    assert.deepEqual(
      await readFile(join(destination, 'process/stderr.bin')),
      Buffer.from([69, 82, 82, 0, 255]),
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
