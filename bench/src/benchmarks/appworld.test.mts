/**
 * Offline AppWorld adapter test. AppWorld has NO committed fixture (task data
 * exists only after `appworld download data`; fabricating a task would be a fake),
 * so loadTasks/judge both require the live engine. This exercises the only offline
 * surface (the solution OutputAdapter, goldArtifact) and asserts preflight + the
 * engine-backed loadTasks FAIL LOUD with the documented install steps — never a
 * fabricated task or score. Run: npx tsx --test src/benchmarks/appworld.test.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appworldSolutionOutput, createAppWorldAdapter } from './appworld'

type Events = Parameters<typeof appworldSolutionOutput.parse>[0]
const stream = (text: string): Events => [{ data: { finalText: text } }] as unknown as Events

test('solution OutputAdapter: last fenced ```python wins; fence-less falls back to trimmed text', () => {
  const fenced = appworldSolutionOutput.parse(stream('plan\n```python\napis.supervisor.complete_task()\n```\n'))
  assert.equal(fenced, 'apis.supervisor.complete_task()')
  const last = appworldSolutionOutput.parse(stream('```python\nFIRST\n```\nmid\n```py\nSECOND\n```'))
  assert.equal(last, 'SECOND')
  const raw = appworldSolutionOutput.parse(stream('  bare code  '))
  assert.equal(raw, 'bare code')
})

test('goldArtifact is undefined — reference solution ships only inside the engine bundle, not portable', async () => {
  const a = createAppWorldAdapter()
  assert.equal(await a.goldArtifact({ id: 't', prompt: '', metadata: { taskId: 't', split: 'dev' } }), undefined)
})

test('preflight passes when installed or FAILS LOUD with the install + download-data fix', async () => {
  const a = createAppWorldAdapter()
  try {
    await a.preflight()
  } catch (err) {
    const e = err as Error
    assert.match(e.message, /pip install appworld/)
    assert.match(e.message, /appworld download data/)
  }
})

test('loadTasks either enumerates live engine rows or FAILS LOUD without fabricating tasks', async () => {
  const a = createAppWorldAdapter()
  try {
    const tasks = await a.loadTasks({ limit: 1 })
    assert.equal(tasks.length, 1)
    assert.ok(tasks[0].id.length > 0)
    assert.match(tasks[0].prompt, /Solve this by writing Python/)
  } catch (err) {
    assert.match((err as Error).message, /appworld driver failed|appworld import failed/)
  }
})
