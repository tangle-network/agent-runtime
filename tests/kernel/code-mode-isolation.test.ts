import assert from 'node:assert/strict'
import { expect, test } from 'vitest'
import { runCodeMode } from '../../src/runtime/code-mode'

const opts = { callId: 'runtime-proof', timeoutMs: 10_000 }

test('Runtime scripts use real QuickJS, structured tools, and a bounded queue', async () => {
  let active = 0
  let peak = 0
  const ids: string[] = []
  const result = await runCodeMode(
    `
    const rows = await Promise.all(Array.from({length:12}, (_, i) => tools.read({i})));
    text('read ' + rows.length);
    return rows.reduce((sum, row) => sum + row.value, 0);
  `,
    {
      ...opts,
      concurrency: 2,
      tools: [
        {
          name: 'read',
          execute: async (args, context) => {
            assert.equal(context.parentCallId, opts.callId)
            ids.push(context.callId)
            peak = Math.max(peak, ++active)
            await new Promise((resolve) => setTimeout(resolve, 5))
            active--
            return {
              value: (args as { i: number }).i + 1,
              intermediate: 'not emitted to the model',
            }
          },
        },
      ],
    },
  )
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value, 78)
  assert.deepEqual(result.output, [{ type: 'text', text: 'read 12' }])
  assert.equal(peak, 2)
  assert.equal(result.calls.length, 12)
  assert.equal(new Set(ids).size, 12)
})

test('no ambient host filesystem, network, timers, process, or wasm', async () => {
  const result = await runCodeMode(
    `return [typeof process, typeof require, typeof fetch,
    typeof setTimeout, typeof WebAssembly, Function('return typeof process')()];`,
    { ...opts, tools: [] },
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, Array(6).fill('undefined'))
})

for (const loop of ['while (true) {}', 'while (true) await null']) {
  test(`a spinning script cannot starve the host deadline: ${loop}`, async () => {
    let started = false
    const result = await runCodeMode(`await tools.started({}); ${loop}`, {
      ...opts,
      timeoutMs: 2000,
      tools: [
        {
          name: 'started',
          execute: () => {
            started = true
            return null
          },
        },
      ],
    })
    assert.equal(started, true)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'timeout')
  })
}

test('returning aborts unawaited and queued tool authority', async () => {
  let signal: AbortSignal | undefined
  let calls = 0
  const result = await runCodeMode(
    'for (let i = 0; i < 20; i++) tools.pending({}); return "done"',
    {
      ...opts,
      concurrency: 1,
      tools: [
        {
          name: 'pending',
          execute: async (_args, context) => {
            calls++
            signal = context.signal
            await new Promise<void>((resolve) => {
              if (signal!.aborted) resolve()
              else signal!.addEventListener('abort', () => resolve(), { once: true })
            })
            return 'late'
          },
        },
      ],
    },
  )
  assert.equal(result.ok, true)
  assert.equal(signal?.aborted, true)
  assert.equal(calls, 1)
  assert.equal(result.calls.length, 20)
  assert.equal(
    result.calls.every((call) => call.status === 'cancelled'),
    true,
  )
})

test('caller cancellation revokes running and queued tool calls', async () => {
  const controller = new AbortController()
  let count = 0
  const result = await runCodeMode(
    'await Promise.all(Array.from({length:20}, () => tools.hold({})))',
    {
      ...opts,
      concurrency: 1,
      signal: controller.signal,
      tools: [
        {
          name: 'hold',
          execute: async (_args, { signal }) => {
            count++
            setImmediate(() => controller.abort(new Error('cancelled by owner')))
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            )
            return null
          },
        },
      ],
    },
  )
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.kind, 'aborted')
  assert.equal(count, 1)
})

test('native image output is preserved, not rendered as text containing base64', async () => {
  const result = await runCodeMode(
    'image({type:"image", data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", mimeType:"image/png"}); text("image attached")',
    { ...opts, tools: [] },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.output, [
    {
      type: 'image',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
      mimeType: 'image/png',
    },
    { type: 'text', text: 'image attached' },
  ])
})

test('refuses a wall deadline that would overflow the worker timer before executing tools', async () => {
  let effects = 0
  await expect(
    runCodeMode('await tools.effect({})', {
      ...opts,
      timeoutMs: 2_147_483_648,
      tools: [{ name: 'effect', execute: () => ++effects }],
    }),
  ).rejects.toThrow(/timeoutMs must be at most/)
  expect(effects).toBe(0)
})
