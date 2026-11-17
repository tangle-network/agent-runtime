import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { streamRouterChatWithTools } from '../../src/runtime/router-client'
import type { ToolSpec } from '../../src/runtime/router-request-body'
import {
  type RunToolLoopOptions,
  runToolLoop,
  type StreamToolLoopYield,
  streamToolLoop,
  type ToolCallExecutor,
  type ToolCallOutcome,
  type ToolLoopCall,
  type ToolLoopEvent,
  type ToolLoopMessage,
} from '../../src/tool-loop'

// Hardware walk Z (2026-11-17): one model turn streamed three parallel `web_search` calls with
// empty arguments, and the stuck-loop guard ended the turn as if the model had looped. Both loops
// run here against a loopback OpenAI-compatible server through the Runtime's own Router client.

type Reply = { calls: string[] } | { text: string }

const webSearch: ToolSpec = {
  type: 'function',
  function: {
    name: 'web_search',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
}
const missingQuery = 'web_search needs query; call it again with that filled in'

// The caller's executor, as Hardware's: a call missing a required argument gets a readable error.
const executeToolCall: ToolCallExecutor = async (call) =>
  typeof call.args.query === 'string'
    ? { ok: true, result: `results for ${call.args.query}` }
    : { ok: false, code: 'invalid_arguments', message: missingQuery }

async function loopbackModel(reply: (request: number) => Reply) {
  const requests: Array<{ messages: ToolLoopMessage[] }> = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const answer = reply(requests.length)
    requests.push(JSON.parse(body))
    const delta =
      'text' in answer
        ? { content: answer.text }
        : {
            tool_calls: answer.calls.map((args, index) => ({
              index,
              id: `call_${requests.length}_${index}`,
              type: 'function',
              function: { name: 'web_search', arguments: args },
            })),
          }
    const finish = 'text' in answer ? 'stop' : 'tool_calls'
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const chunk of [
      { choices: [{ index: 0, delta }] },
      { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]) {
      res.write(`data: ${JSON.stringify({ model: 'loopback', ...chunk })}\n\n`)
    }
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const cfg = { routerBaseUrl: `http://127.0.0.1:${port}/v1`, routerKey: 'k', model: 'loopback' }
  async function* streamTurn(messages: ToolLoopMessage[]): AsyncIterable<ToolLoopEvent> {
    const turn = await streamRouterChatWithTools(cfg, messages, [webSearch])
    if (turn.content) yield { type: 'text', text: turn.content }
    for (const call of turn.toolCalls) {
      const args = JSON.parse(call.arguments)
      yield { type: 'tool_call', call: { toolCallId: call.id, toolName: call.name, args } }
    }
  }
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
  return { requests, streamTurn, close }
}

/** The same scripted model through `runToolLoop` and `streamToolLoop`. */
async function bothLoops(
  reply: (request: number) => Reply,
  overrides: { executeToolCall?: ToolCallExecutor; maxConcurrentToolCalls?: number } = {},
) {
  const runs = []
  for (const loop of ['runToolLoop', 'streamToolLoop'] as const) {
    const model = await loopbackModel(reply)
    const options = {
      systemPrompt: 'You design hardware.',
      userMessage: 'Design a solar chicken coop door.',
      streamTurn: model.streamTurn,
      executeToolCall,
      isExecutableTool: (name: string) => name === 'web_search',
      maxToolTurns: 6,
      ...overrides,
    }
    let stopReason = 'completed'
    let text = ''
    const results: ToolCallOutcome[] = []
    // The streamed tool steps, as `kind:toolCallId`, to check progress attribution and order.
    const steps: string[] = []
    const started = Date.now()
    try {
      if (loop === 'runToolLoop') {
        const run = await runToolLoop(options)
        stopReason = run.stopReason
        text = run.finalText
        results.push(...run.toolResults.map((item) => item.outcome))
      } else {
        for await (const step of streamToolLoop<ToolLoopEvent>({
          ...options,
          extractText: (event) => (event.type === 'text' ? event.text : ''),
          extractToolCall: (event) => (event.type === 'tool_call' ? event.call : null),
        })) {
          if (step.kind === 'capped') stopReason = step.stopReason
          if (step.kind === 'tool_result') results.push(step.outcome)
          if (step.kind === 'tool_result' || step.kind === 'tool_progress') {
            steps.push(`${step.kind}:${step.toolCallId}`)
          }
          if (step.kind === 'event' && step.event.type === 'text') text += step.event.text
        }
      }
    } finally {
      await model.close()
    }
    const elapsedMs = Date.now() - started
    console.log(`${loop}: stopReason=${stopReason} toolResults=${results.length}`, { text })
    runs.push({ loop, stopReason, results, text, requests: model.requests, steps, elapsedMs })
  }
  return runs
}

it('runs a parallel batch of identical calls and the model answers from their errors', async () => {
  const runs = await bothLoops((request) =>
    request === 0 ? { calls: ['{}', '{}', '{}'] } : { text: 'Here is the door design.' },
  )
  const error = { ok: false, code: 'invalid_arguments', message: missingQuery }
  const readBack = expect.stringContaining(missingQuery)
  for (const run of runs) {
    expect(run).toMatchObject({ stopReason: 'completed', text: 'Here is the door design.' })
    expect(run.results).toEqual([error, error, error])
    const toolMessages = run.requests[1]!.messages.filter((message) => message.role === 'tool')
    expect(toolMessages.map((message) => message.content)).toEqual([readBack, readBack, readBack])
  }
})

it('still stops a model that repeats the same call across three model turns', async () => {
  const runs = await bothLoops(() => ({ calls: ['{"query":"solar coop door"}'] }))
  for (const run of runs) {
    expect(run.stopReason).toBe('stuck-loop')
    expect(run.results).toHaveLength(2)
    expect(run.requests).toHaveLength(3)
  }
})

it("runs a turn's calls at once when opted in, keeps call order, defaults to serial", async () => {
  // Call a sleeps longest, so the calls settle in the reverse of call order.
  const sleepMs: Record<string, number> = { a: 1000, b: 950, c: 900 }
  const sleepingSearch: ToolCallExecutor = async (call, context) => {
    const query = String(call.args.query)
    context.progress({ message: `searching ${query}` })
    await new Promise((resolve) => setTimeout(resolve, sleepMs[query]))
    return { ok: true, result: `results for ${query}` }
  }
  const reply = (request: number): Reply =>
    request === 0
      ? { calls: ['{"query":"a"}', '{"query":"b"}', '{"query":"c"}'] }
      : { text: 'Found all three.' }
  const inOrder = ['a', 'b', 'c'].map((query) => `results for ${query}`)
  // Width 6 is opted in; no option keeps the default of one call at a time.
  for (const [width, atLeastMs, underMs] of [
    [6, 900, 2_000],
    [undefined, 2_800, 5_000],
  ] as const) {
    const runs = await bothLoops(reply, {
      executeToolCall: sleepingSearch,
      maxConcurrentToolCalls: width,
    })
    for (const run of runs) {
      console.log(`${run.loop} width=${width ?? 'default'}: ${run.elapsedMs} ms`, run.steps)
      expect(run.elapsedMs).toBeGreaterThanOrEqual(atLeastMs)
      expect(run.elapsedMs).toBeLessThan(underMs)
      expect(run).toMatchObject({ stopReason: 'completed', text: 'Found all three.' })
      expect(run.results.map((outcome) => outcome.ok && outcome.result)).toEqual(inOrder)
      const toolMessages = run.requests[1]!.messages.filter((message) => message.role === 'tool')
      expect(toolMessages.map((message) => message.content)).toEqual(
        inOrder.map((result) => expect.stringContaining(result)),
      )
      if (run.loop !== 'streamToolLoop') continue
      const results = run.steps.filter((step) => step.startsWith('tool_result:'))
      expect(results).toEqual(['call_1_0', 'call_1_1', 'call_1_2'].map((id) => `tool_result:${id}`))
      for (const id of ['call_1_0', 'call_1_1', 'call_1_2']) {
        const progressAt = run.steps.indexOf(`tool_progress:${id}`)
        expect(progressAt).toBeGreaterThanOrEqual(0)
        expect(progressAt).toBeLessThan(run.steps.indexOf(`tool_result:${id}`))
      }
    }
  }
})

// Call a settles first. Width 1 stops on a's progress; width 2 stops on a's result.
const sleepMs: Record<string, number> = { a: 20, b: 60, c: 60, d: 60 }
for (const { width, queries, stopOn } of [
  { width: 1, queries: ['a', 'b', 'c'], stopOn: 'tool_progress' },
  { width: 2, queries: ['a', 'b', 'c', 'd'], stopOn: 'tool_result' },
]) {
  it(`starts no queued call after the consumer stops reading at width ${width}`, async () => {
    const model = await loopbackModel((request) =>
      request === 0
        ? { calls: queries.map((query) => JSON.stringify({ query })) }
        : { text: 'Done.' },
    )
    const ran: string[] = []
    const hookEvents: string[] = []
    let ranAtStop: string[] = []
    try {
      for await (const step of streamToolLoop<ToolLoopEvent>({
        systemPrompt: 'You design hardware.',
        userMessage: 'Design a solar chicken coop door.',
        streamTurn: model.streamTurn,
        extractText: (event) => (event.type === 'text' ? event.text : ''),
        extractToolCall: (event) => (event.type === 'tool_call' ? event.call : null),
        isExecutableTool: (name) => name === 'web_search',
        maxConcurrentToolCalls: width,
        executeToolCall: async (call, context) => {
          const query = String(call.args.query)
          ran.push(query)
          context.progress({ message: `searching ${query}` })
          await sleep(sleepMs[query])
          return { ok: true, result: `results for ${query}` }
        },
        hooks: {
          onEvent: (event) => {
            if (event.target !== 'agent.tool_call') return
            const { toolCallId } = event.payload as { toolCallId: string }
            hookEvents.push(`${event.phase}:${toolCallId}`)
          },
        },
      })) {
        if (step.kind === stopOn) {
          ranAtStop = [...ran]
          break
        }
      }
      // Longer than the queued calls would take if the batch kept starting them.
      await sleep(400)
    } finally {
      await model.close()
    }
    console.log(`width=${width} stop on ${stopOn}: started at stop ${ranAtStop}, ran ${ran}`)
    expect(ran).toEqual(ranAtStop)
    expect(ran).not.toContain(queries.at(-1))
    if (width === 1) expect(ran).toEqual(['a'])
    // One before and one after event per call that ran; none for a call that never started.
    const ids = ran.map((query) => `call_1_${queries.indexOf(query)}`)
    const expected = ids.flatMap((id) => [`after:${id}`, `before:${id}`])
    expect([...hookEvents].sort()).toEqual(expected.sort())
  })
}

const loops = ['runToolLoop', 'streamToolLoop'] as const

/** One model turn with a `web_search` call per query, through one loop. Each call sleeps
 *  `durations[query]` and logs its start and finish. `consume` sees each streamed step and may
 *  stop reading. A loop that rejects returns its error and the log as it stood then. */
async function oneTurn(
  loop: (typeof loops)[number],
  queries: string[],
  durations: Record<string, number>,
  options: Partial<RunToolLoopOptions> = {},
  consume?: (step: StreamToolLoopYield<ToolLoopEvent>, log: string[]) => unknown,
) {
  const model = await loopbackModel((request) =>
    request === 0
      ? { calls: queries.map((query) => JSON.stringify({ query })) }
      : { text: 'Done.' },
  )
  const log: string[] = []
  const logged: ToolCallExecutor = async (call) => {
    const query = String(call.args.query)
    log.push(`start:${query}`)
    await sleep(durations[query])
    log.push(`finish:${query}`)
    return { ok: true, result: query }
  }
  const shared = {
    systemPrompt: 'You design hardware.',
    userMessage: 'Design a solar chicken coop door.',
    streamTurn: model.streamTurn,
    isExecutableTool: (name: string) => name === 'web_search',
    executeToolCall: logged,
    ...options,
  }
  const answer = (outcome: ToolCallOutcome) => (outcome.ok ? outcome.result : outcome.code)
  let stopReason = 'completed'
  const results: unknown[] = []
  let failure: { error: unknown; log: string[] } | undefined
  try {
    if (loop === 'runToolLoop') {
      const run = await runToolLoop(shared)
      stopReason = run.stopReason
      results.push(...run.toolResults.map((item) => answer(item.outcome)))
    } else {
      for await (const step of streamToolLoop<ToolLoopEvent>({
        ...shared,
        extractText: (event) => (event.type === 'text' ? event.text : ''),
        extractToolCall: (event) => (event.type === 'tool_call' ? event.call : null),
      })) {
        if (step.kind === 'capped') stopReason = step.stopReason
        if (step.kind === 'tool_result') results.push(answer(step.outcome))
        if ((await consume?.(step, log)) === 'stop') break
      }
    }
  } catch (error) {
    failure = { error, log: [...log] }
  } finally {
    await model.close()
  }
  return { log, stopReason, results, failure }
}

it("starts the stream's next call only after its consumer takes the previous result", async () => {
  const atResult: string[][] = []
  // A slow consumer: the next call waits for it instead of running meanwhile.
  const consume = async (step: StreamToolLoopYield<ToolLoopEvent>, log: string[]) => {
    if (step.kind !== 'tool_result') return
    atResult.push([...log])
    await sleep(50)
  }
  const turn = await oneTurn('streamToolLoop', ['a', 'b'], { a: 20, b: 20 }, {}, consume)
  expect(turn.results).toEqual(['a', 'b'])
  expect(atResult).toEqual([
    ['start:a', 'finish:a'],
    ['start:a', 'finish:a', 'start:b', 'finish:b'],
  ])
})

it("streams the refused call's result before a tool-limited consumer stops", async () => {
  // A chat turn with its own limit of one tool call: the executor refuses later calls, and the
  // consumer ends the turn at the result that follows the refusal.
  let ran = 0
  let limitReached = false
  const executeToolCall: ToolCallExecutor = async (call) => {
    if (ran >= 1) {
      limitReached = true
      return { ok: false, code: 'tool_limit', message: 'The turn reached its tool-call limit.' }
    }
    ran++
    await sleep(20)
    return { ok: true, result: String(call.args.query) }
  }
  const stop = (step: StreamToolLoopYield<ToolLoopEvent>) =>
    step.kind === 'tool_result' && limitReached ? 'stop' : undefined
  const turn = await oneTurn('streamToolLoop', ['a', 'b'], {}, { executeToolCall }, stop)
  expect(turn.results).toEqual(['a', 'tool_limit'])
})

it('settles in-flight calls, then rethrows a costOf throw, in both loops', async () => {
  const durations = { a: 10, b: 60, c: 10, d: 10 }
  const costOf = (call: ToolLoopCall) => {
    if (call.args.query === 'a') throw new Error('meter unavailable')
    return 0
  }
  for (const loop of loops) {
    const turn = await oneTurn(loop, Object.keys(durations), durations, {
      maxConcurrentToolCalls: 2,
      maxCostUsd: 10,
      costOf,
    })
    // Long enough for c and d to run if anything still admitted them.
    await sleep(200)
    console.log(`${loop} costOf throw: at rejection ${turn.failure?.log}; later ${turn.log}`)
    expect(turn.failure?.error).toMatchObject({ message: 'meter unavailable' })
    expect(turn.failure?.log).toEqual(['start:a', 'start:b', 'finish:a', 'finish:b'])
    expect(turn.log).toEqual(turn.failure?.log)
  }
})

it('stops a turn at its budget in both loops, with the serial rule at width 1', async () => {
  // Every call costs 1. Before concurrency the budget was checked after each call, so a budget of
  // 0 still ran the turn's first call.
  const durations = { a: 10, b: 20, c: 30, d: 40, e: 50 }
  for (const loop of loops) {
    for (const [width, maxCostUsd, ran] of [
      [1, 2, 'a,b'],
      // a settles at 1 of 2 spent and frees its slot, so d starts; b then spends the rest.
      [3, 2, 'a,b,c,d'],
      [1, 0, 'a'],
      [3, 0, 'a'],
    ] as const) {
      const turn = await oneTurn(loop, Object.keys(durations), durations, {
        maxConcurrentToolCalls: width,
        maxCostUsd,
        costOf: () => 1,
      })
      console.log(`${loop} width=${width} maxCostUsd=${maxCostUsd}: ${turn.stopReason}`, turn.log)
      expect(turn.stopReason).toBe('budget')
      expect(turn.results.join(',')).toBe(ran)
      const started = turn.log.filter((entry) => entry.startsWith('start:'))
      expect(started.map((entry) => entry.slice('start:'.length)).join(',')).toBe(ran)
    }
  }
})
