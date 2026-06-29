/**
 * Offline DABStep adapter test. Official live tasks need a DABStep checkout with
 * the released dataset.csv. Fixture mode only exercises adapter plumbing; it
 * never scores benchmark rows without the official grade.py.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDabstepAdapter, dabstepAnswerOutput } from './dabstep'

process.env.DABSTEP_FIXTURES = '1'

type Events = Parameters<typeof dabstepAnswerOutput.parse>[0]
const stream = (text: string): Events => [{ data: { finalText: text } }] as unknown as Events

test('loadTasks fixtures expose DABStep prompt and resource metadata shape', async () => {
  const adapter = createDabstepAdapter()
  const tasks = await adapter.loadTasks({ ids: ['1'] })
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].id, '1')
  assert.match(tasks[0].prompt, /DABStep data-analysis task/)
  const meta = tasks[0].metadata as Record<string, unknown>
  assert.equal(meta.taskId, 1)
  assert.equal(Array.isArray(meta.golds), true)
})

test('answer OutputAdapter extracts final fenced answer when present', () => {
  assert.equal(dabstepAnswerOutput.parse(stream('work\n```answer\n42\n```')), '42')
  assert.equal(dabstepAnswerOutput.parse(stream('Final Answer: 42')), 'Final Answer: 42')
})

test('goldArtifact exposes the fixture oracle without scoring it as a benchmark result', async () => {
  const adapter = createDabstepAdapter()
  const [task] = await adapter.loadTasks({ ids: ['1'] })
  const gold = await adapter.goldArtifact(task)
  assert.equal(gold, '42')
})

test('judge fails loud without an official DABSTEP_DIR/grade.py', async () => {
  const adapter = createDabstepAdapter()
  const [task] = await adapter.loadTasks({ ids: ['1'] })
  delete process.env.DABSTEP_DIR
  await assert.rejects(adapter.judge(task, '42'), /DABSTEP_DIR is required/)
})

test('preflight is fixture-safe and live mode fails loud without DABSTEP_DIR', async () => {
  const fixtureAdapter = createDabstepAdapter()
  await fixtureAdapter.preflight()
  delete process.env.DABSTEP_FIXTURES
  delete process.env.DABSTEP_DIR
  const liveAdapter = createDabstepAdapter()
  await assert.rejects(liveAdapter.preflight(), /DABSTEP_DIR is required/)
  process.env.DABSTEP_FIXTURES = '1'
})

test('live preflight fails loud when the checkout is missing released dataset.csv', async () => {
  delete process.env.DABSTEP_FIXTURES
  const dir = await mkdtemp(join(tmpdir(), 'dabstep-missing-dataset-'))
  process.env.DABSTEP_DIR = dir
  try {
    const adapter = createDabstepAdapter()
    await assert.rejects(adapter.preflight(), /released dataset\.csv/)
  } finally {
    process.env.DABSTEP_FIXTURES = '1'
    delete process.env.DABSTEP_DIR
    await rm(dir, { recursive: true, force: true })
  }
})
