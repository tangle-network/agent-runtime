/**
 * Offline AEC-Bench adapter test. AEC's judge runs the task's own verify.py with
 * python3 (stdlib only, no Docker, no pip), so the FULL judge is exercised here:
 * gold → score 1, empty → score 0, with per-field partial credit in detail. Run:
 *   AEC_FIXTURES=1 npx tsx --test src/benchmarks/aec-bench.test.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAecBenchAdapter } from './aec-bench'

process.env.AEC_FIXTURES = '1'

const id = 'electrical/catenary-sag'

test('loadTasks (fixtures) yields self-contained tasks with verifier metadata', async () => {
  const a = createAecBenchAdapter()
  const tasks = await a.loadTasks({ ids: [id] })
  assert.equal(tasks.length, 1)
  const t = tasks[0]
  assert.equal(t.id, id)
  assert.equal(t.split, 'electrical')
  assert.ok(t.prompt.length > 0, 'prompt is the instruction.md')
  const md = t.metadata as Record<string, unknown>
  assert.equal(typeof md.verifyPy, 'string')
  assert.ok((md.verifyPy as string).length > 0)
  assert.equal(typeof md.goldenPassMd, 'string')
})

test('loadTasks limit slices the fixture set', async () => {
  const a = createAecBenchAdapter()
  const tasks = await a.loadTasks({ limit: 1 })
  assert.equal(tasks.length, 1)
})

test('judge: REAL verify.py — gold resolves with full per-field credit', async () => {
  const a = createAecBenchAdapter()
  const [t] = await a.loadTasks({ ids: [id] })
  const gold = await a.goldArtifact(t)
  assert.equal(typeof gold, 'string')
  const score = await a.judge(t, gold as string)
  assert.equal(score.resolved, true)
  assert.equal(score.score, 1)
  const detail = JSON.parse(score.detail as string) as { fields: Record<string, number> }
  for (const v of Object.values(detail.fields)) assert.equal(v, 1)
})

test('judge: REAL verify.py — empty artifact fails closed to 0 (no fabricated score)', async () => {
  const a = createAecBenchAdapter()
  const [t] = await a.loadTasks({ ids: [id] })
  const score = await a.judge(t, '')
  assert.equal(score.resolved, false)
  assert.equal(score.score, 0)
})
