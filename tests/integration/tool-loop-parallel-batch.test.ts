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
async function bothLoops(reply: (request: number) => Reply) {
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
    }
    let stopReason = 'completed'
    let text = ''
    const results: ToolCallOutcome[] = []
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
          if (step.kind === 'event' && step.event.type === 'text') text += step.event.text
        }
      }
    } finally {
      await model.close()
    }
    console.log(`${loop}: stopReason=${stopReason} toolResults=${results.length}`, { text })
    runs.push({ loop, stopReason, results, text, requests: model.requests })
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
