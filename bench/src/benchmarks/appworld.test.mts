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
import {
  appworldReactResultWithUsage,
  appworldReactUsageEvent,
  appworldSolutionOutput,
  appworldToolLoopClient,
  createAppWorldAdapter,
} from './appworld'

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

test('successful react episode survives unknown catalog dollars without fabricating billed cost', () => {
  const result = appworldReactResultWithUsage(
    { success: true, passes: 3, fails: 0, num_tests: 3 },
    {
      input: 120,
      output: 30,
      tokensKnown: true,
      costUsd: 0.0042,
      usdKnown: false,
    },
    2,
    'completed task',
  )

  assert.equal(result.success, true)
  assert.equal(result.input_tokens, 120)
  assert.equal(result.output_tokens, 30)
  assert.equal(result.cost_usd, undefined)
  const event = appworldReactUsageEvent(result, 'deepseek-v4-flash')
  assert.deepEqual(event?.data, {
    model: 'deepseek-v4-flash',
    tokensIn: 120,
    tokensOut: 30,
  })
  assert.equal(Object.hasOwn(event?.data ?? {}, 'costUsd'), false)
})

interface TestToolLoopBox {
  streamPrompt(
    prompt: string,
    opts?: { signal?: AbortSignal },
  ): AsyncGenerator<Record<string, unknown>>
}

async function testToolLoopBox(client: unknown): Promise<TestToolLoopBox> {
  return (client as { create(): Promise<TestToolLoopBox> }).create()
}

async function drain(stream: AsyncGenerator<Record<string, unknown>>): Promise<void> {
  for await (const _event of stream) {
    // drain
  }
}

test('react client refuses an already-aborted round before a Python session or model call', async () => {
  let sessionCalls = 0
  let modelCalls = 0
  const controller = new AbortController()
  controller.abort(new Error('already stopped'))
  const client = appworldToolLoopClient({
    model: 'offline-model',
    routerBaseUrl: 'https://router.invalid',
    routerKey: 'offline',
    runWorldSession: async () => {
      sessionCalls += 1
      throw new Error('unexpected world session')
    },
    complete: async () => {
      modelCalls += 1
      return {}
    },
  })
  const box = await testToolLoopBox(client)

  await assert.rejects(
    drain(box.streamPrompt('@appworld-react task-1 test_normal\n', { signal: controller.signal })),
    /already stopped/,
  )
  assert.equal(sessionCalls, 0)
  assert.equal(modelCalls, 0)
})

test('react client threads late abort to both the world session and Router call', async () => {
  const controller = new AbortController()
  let sessionSignal: AbortSignal | undefined
  let modelSignal: AbortSignal | undefined
  let sessionStopped = false
  const client = appworldToolLoopClient({
    model: 'offline-model',
    routerBaseUrl: 'https://router.invalid',
    routerKey: 'offline',
    runWorldSession: async (_taskId, _split, signal, fn) => {
      sessionSignal = signal
      try {
        return await fn(async () => ({ success: true, num_tests: 1, passes: 1 }), 'offline task')
      } finally {
        sessionStopped = signal.aborted
      }
    },
    complete: async (_body, request) => {
      modelSignal = request?.signal
      return new Promise((_resolve, reject) => {
        request?.signal?.addEventListener(
          'abort',
          () => reject(request.signal?.reason ?? new Error('aborted')),
          { once: true },
        )
      })
    },
  })
  const box = await testToolLoopBox(client)
  const running = drain(
    box.streamPrompt('@appworld-react task-1 test_normal\n', { signal: controller.signal }),
  )
  setTimeout(() => controller.abort(new Error('late stop')), 0)

  await assert.rejects(running, /aborted|late stop/i)
  assert.equal(sessionSignal, controller.signal)
  assert.equal(modelSignal?.aborted, true)
  assert.equal(sessionStopped, true)
})
