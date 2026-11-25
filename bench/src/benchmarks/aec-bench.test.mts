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

test('loadAll (fixtures) yields self-contained tasks with verifier metadata', async () => {
  const a = createAecBenchAdapter()
  const tasks = await a.loadAll({ ids: [id] })
  assert.equal(tasks.length, 1)
  const t = tasks[0]
  assert.equal(t.id, id)
  assert.equal(t.payload.subset, 'electrical')
  assert.ok(t.payload.prompt.length > 0, 'prompt is the instruction.md')
  const md = t.metadata as Record<string, unknown>
  assert.equal(typeof md.verifyPy, 'string')
  assert.ok((md.verifyPy as string).length > 0)
  assert.equal(typeof md.goldenPassMd, 'string')
})

test('loadAll limit slices the fixture set', async () => {
  const a = createAecBenchAdapter()
  const tasks = await a.loadAll({ limit: 1 })
  assert.equal(tasks.length, 1)
})

test('judge: REAL verify.py — gold resolves with full per-field credit', async () => {
  const a = createAecBenchAdapter()
  const [t] = await a.loadAll({ ids: [id] })
  const gold = await a.runtime.goldArtifact!(t)
  assert.equal(typeof gold, 'string')
  const score = await a.evaluate(t, gold as string)
  assert.equal(score.passed, true)
  assert.equal(score.score, 1)
  const detail = JSON.parse(score.notes as string) as { fields: Record<string, number> }
  for (const v of Object.values(detail.fields)) assert.equal(v, 1)
})

test('judge: REAL verify.py — empty artifact fails closed to 0 (no fabricated score)', async () => {
  const a = createAecBenchAdapter()
  const [t] = await a.loadAll({ ids: [id] })
  const score = await a.evaluate(t, '')
  assert.equal(score.passed, false)
  assert.equal(score.score, 0)
})
