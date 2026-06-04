/**
 * Offline ProgramBench adapter test. The judge needs the official `programbench`
 * harness + Docker on linux/amd64, neither installed in CI, so this exercises the
 * offline parts (fixtures loadTasks, the file-manifest OutputAdapter, goldArtifact)
 * and asserts the harness-backed path FAILS LOUD with the documented fix — never a
 * fake score. Run: PROGRAMBENCH_FIXTURES=1 npx tsx --test src/benchmarks/programbench.test.mts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProgrambenchAdapter, programbenchSubmissionOutput } from './programbench'

process.env.PROGRAMBENCH_FIXTURES = '1'

type Events = Parameters<typeof programbenchSubmissionOutput.parse>[0]
const stream = (text: string): Events => [{ data: { finalText: text } }] as unknown as Events

test('loadTasks (fixtures) yields cleanroom tasks with instance metadata + submission contract', async () => {
  const a = createProgrambenchAdapter()
  const tasks = await a.loadTasks({ ids: ['abishekvashok__cmatrix.5c082c6'] })
  assert.equal(tasks.length, 1)
  const t = tasks[0]
  assert.equal(t.id, 'abishekvashok__cmatrix.5c082c6')
  assert.match(t.prompt, /compile\.sh/)
  assert.match(t.prompt, /path:<relative\/path>/)
  const md = t.metadata as Record<string, unknown>
  assert.equal(md.instanceId, 'abishekvashok__cmatrix.5c082c6')
})

test('loadTasks limit slices the fixture set', async () => {
  const a = createProgrambenchAdapter()
  const tasks = await a.loadTasks({ limit: 2 })
  assert.equal(tasks.length, 2)
})

test('submission OutputAdapter: ```path: blocks re-serialize into the ===FILE:=== envelope the driver splits on', () => {
  const out = programbenchSubmissionOutput.parse(
    stream('here\n```path:compile.sh\ncc -o executable main.c\n```\n```path:main.c\nint main(){}\n```\n'),
  )
  assert.match(out, /===FILE:compile\.sh===\ncc -o executable main\.c/)
  assert.match(out, /===FILE:main\.c===\nint main\(\)\{\}/)
})

test('submission OutputAdapter: no file block → empty (fail-closed, harness scores missing compile.sh as 0)', () => {
  assert.equal(programbenchSubmissionOutput.parse(stream('I could not solve it.')), '')
})

test('goldArtifact is undefined — oracle is stripped original source, documented, not fabricated', async () => {
  const a = createProgrambenchAdapter()
  const [t] = await a.loadTasks({ ids: ['abishekvashok__cmatrix.5c082c6'] })
  assert.equal(await a.goldArtifact(t), undefined)
})

test('preflight FAILS LOUD with the install/Docker fix when the harness is absent', async () => {
  const a = createProgrambenchAdapter()
  await assert.rejects(a.preflight(), (e: Error) => {
    assert.match(e.message, /pip install programbench/)
    assert.match(e.message, /amd64/)
    return true
  })
})
