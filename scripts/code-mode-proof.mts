import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeCodeModeTools, runCodeMode } from '../src/runtime/code-mode.ts'

const opts = { callId: 'runtime-proof', timeoutMs: 10_000 }

test('Runtime scripts use real QuickJS, structured tools, and a bounded queue', async () => {
  let active = 0
  let peak = 0
  const ids: string[] = []
  const result = await runCodeMode(`
    const rows = await Promise.all(Array.from({length:12}, (_, i) => tools.read({i})));
    text('read ' + rows.length);
    return rows.reduce((sum, row) => sum + row.value, 0);
  `, { ...opts, concurrency: 2, tools: [{
    name: 'read',
    execute: async (args, context) => {
      assert.equal(context.parentCallId, opts.callId)
      ids.push(context.callId)
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { value: (args as { i: number }).i + 1, intermediate: 'not emitted to the model' }
    },
  }] })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value, 78)
  assert.deepEqual(result.output, [{type:'text', text:'read 12'}])
  assert.equal(peak, 2)
  assert.equal(result.calls.length, 12)
  assert.equal(new Set(ids).size, 12)
})

test('no ambient host filesystem, network, timers, process, or wasm', async () => {
  const result = await runCodeMode(`return [typeof process, typeof require, typeof fetch,
    typeof setTimeout, typeof WebAssembly, Function('return typeof process')()];`, { ...opts, tools: [] })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, Array(6).fill('undefined'))
})

for (const loop of ['while (true) {}', 'while (true) await null']) {
  test(`a spinning script cannot starve the host deadline: ${loop}`, async () => {
    let started = false
    const result = await runCodeMode(`await tools.started({}); ${loop}`, {
      ...opts, timeoutMs: 2000, tools: [{name:'started', execute: () => { started = true; return null }}],
    })
    assert.equal(started, true)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.kind, 'timeout')
  })
}

test('returning aborts unawaited tool authority', async () => {
  let signal: AbortSignal | undefined
  const result = await runCodeMode('tools.pending({}); return "done"', {
    ...opts, tools: [{name:'pending', execute: async (_args, context) => {
      signal = context.signal
      await new Promise<void>((resolve) => {
        if (signal!.aborted) resolve()
        else signal!.addEventListener('abort', () => resolve(), {once:true})
      })
      return 'late'
    }}],
  })
  assert.equal(result.ok, true)
  assert.equal(signal?.aborted, true)
  assert.equal(result.calls[0]?.status, 'cancelled')
})

test('caller cancellation revokes running and queued tool calls', async () => {
  const controller = new AbortController()
  let count = 0
  const result = await runCodeMode('await Promise.all(Array.from({length:20}, () => tools.hold({})))', {
    ...opts, concurrency: 1, signal: controller.signal,
    tools: [{name:'hold', execute: async (_args, {signal}) => {
      count++
      setImmediate(() => controller.abort(new Error('cancelled by owner')))
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), {once:true}))
      return null
    }}],
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.kind, 'aborted')
  assert.equal(count, 1)
})

test('store writes are explicit, detached, and absent after failure', async () => {
  const first = await runCodeMode('store("rows", [1,2,3]); return 3', {...opts, tools:[]})
  assert.equal(first.ok, true)
  if (!first.ok) return
  const saved = first.storeWrites.set
  const second = await runCodeMode('const xs = load("rows"); xs.push(4); return xs.length', {...opts, tools:[], store:saved})
  assert.equal(second.ok, true)
  if (second.ok) assert.equal(second.value, 4)
  assert.deepEqual(saved.rows, [1,2,3])
  const failed = await runCodeMode('store("rows", []); throw new Error("no commit")', {...opts, tools:[], store:saved})
  assert.equal(failed.ok, false)
  assert.equal('storeWrites' in failed, false)
})

test('native image output is preserved, not rendered as text containing base64', async () => {
  const result = await runCodeMode('image({type:"image", data:"aGVsbG8=", mimeType:"image/png"}); text("image attached")', {...opts, tools:[]})
  assert.equal(result.ok, true)
  assert.deepEqual(result.output, [
    {type:'image', data:'aGVsbG8=', mimeType:'image/png'},
    {type:'text', text:'image attached'},
  ])
})

test('generated declarations include output schemas from the executed descriptors', async () => {
  const text = await describeCodeModeTools([{
    name:'read', inputSchema:{type:'object', properties:{id:{type:'string'}}, required:['id']},
    outputSchema:{type:'number'}, execute: () => 1,
  }])
  assert.match(text, /Promise<number>/)
  assert.match(text, /id/)
})
