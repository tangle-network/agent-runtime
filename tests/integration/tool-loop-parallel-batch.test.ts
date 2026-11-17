import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { streamRouterChatWithTools } from '../../src/runtime/router-client'
import type { ToolSpec } from '../../src/runtime/router-request-body'
import {
  runToolLoop,
  streamToolLoop,
  type ToolCallExecutor,
  type ToolCallOutcome,
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

it("runs one turn's calls at once under the width cap and keeps their call order", async () => {
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
  for (const [width, atLeastMs, underMs] of [
    [6, 900, 2_000],
    [1, 2_800, 5_000],
  ] as const) {
    const runs = await bothLoops(reply, {
      executeToolCall: sleepingSearch,
      maxConcurrentToolCalls: width,
    })
    for (const run of runs) {
      console.log(`${run.loop} width=${width}: ${run.elapsedMs} ms`, run.steps)
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
