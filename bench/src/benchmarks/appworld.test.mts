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

test('preflight FAILS LOUD with the install + download-data fix when the engine is absent', async () => {
  const a = createAppWorldAdapter()
  await assert.rejects(a.preflight(), (e: Error) => {
    assert.match(e.message, /pip install appworld/)
    assert.match(e.message, /appworld download data/)
    return true
  })
})

test('loadTasks FAILS LOUD (engine enumeration) rather than fabricating tasks offline', async () => {
  const a = createAppWorldAdapter()
  await assert.rejects(a.loadTasks({ limit: 1 }), (e: Error) => {
    assert.match(e.message, /appworld driver failed|appworld import failed/)
    return true
  })
})
