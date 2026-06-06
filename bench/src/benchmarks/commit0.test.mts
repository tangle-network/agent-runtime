/**
 * Offline commit0 adapter test. The judge needs the official `commit0` harness +
 * a Docker daemon, neither installed in CI, so this exercises the parts that run
 * offline (fixtures loadTasks, the diff OutputAdapter, goldArtifact) and asserts
 * the harness-backed path FAILS LOUD with the documented fix — never a fake score.
 * Run: COMMIT0_FIXTURES=1 npx tsx --test src/benchmarks/commit0.test.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commit0DiffOutput, createCommit0Adapter } from './commit0'

process.env.COMMIT0_FIXTURES = '1'

type Events = Parameters<typeof commit0DiffOutput.parse>[0]
const stream = (text: string): Events => [{ data: { finalText: text } }] as unknown as Events

test('loadTasks (fixtures) yields stubbed-library tasks with diff-deliverable prompt + metadata', async () => {
  const a = createCommit0Adapter()
  const tasks = await a.loadTasks({ ids: ['commit-0/wcwidth'] })
  assert.equal(tasks.length, 1)
  const t = tasks[0]
  assert.equal(t.id, 'commit-0/wcwidth')
  assert.match(t.prompt, /```diff/)
  const md = t.metadata as Record<string, unknown>
  assert.equal(md.instanceId, 'commit-0/wcwidth')
  assert.equal(typeof md.referenceCommit, 'string')
  assert.equal(md.srcDir, 'wcwidth/')
})

test('loadTasks limit slices the fixture set', async () => {
  const a = createCommit0Adapter()
  const tasks = await a.loadTasks({ limit: 2 })
  assert.equal(tasks.length, 2)
})

test('diff OutputAdapter: last fenced ```diff wins; fence-less falls back to trimmed text', () => {
  const fenced = commit0DiffOutput.parse(stream('preamble\n```diff\n--- a/x\n+++ b/x\n@@\n+1\n```\n'))
  assert.equal(fenced, '--- a/x\n+++ b/x\n@@\n+1')
  const last = commit0DiffOutput.parse(stream('```diff\nFIRST\n```\nmid\n```diff\nSECOND\n```'))
  assert.equal(last, 'SECOND')
  const raw = commit0DiffOutput.parse(stream('  bare patch text  '))
  assert.equal(raw, 'bare patch text')
})

test('goldArtifact is undefined — oracle is a git ref, documented, not a fabricated diff', async () => {
  const a = createCommit0Adapter()
  const [t] = await a.loadTasks({ ids: ['commit-0/wcwidth'] })
  assert.equal(await a.goldArtifact(t), undefined)
})

test('preflight FAILS LOUD with the install/Docker fix when the harness venv is absent', async () => {
  // Point the isolated-venv override at a non-existent dir so the interpreter is
  // missing — proves preflight throws the documented fix rather than fabricating a
  // score, independent of whether a real .venv-commit0 happens to be installed.
  const prev = process.env.COMMIT0_VENV
  process.env.COMMIT0_VENV = '.venv-commit0-does-not-exist'
  try {
    const a = createCommit0Adapter()
    await assert.rejects(a.preflight(), (e: Error) => {
      assert.match(e.message, /pip install commit0/)
      assert.match(e.message, /Docker daemon/)
      return true
    })
  } finally {
    if (prev === undefined) delete process.env.COMMIT0_VENV
    else process.env.COMMIT0_VENV = prev
  }
})
