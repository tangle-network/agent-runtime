import { describe, expect, it } from 'vitest'
import {
  createOpenAICompatibleBackend,
  type KnowledgeRequirement,
  type RuntimeStreamEvent,
  runAgentTaskStream,
} from '../src/index'

const readyReq: KnowledgeRequirement = {
  id: 'build-command',
  description: 'Build command',
  requiredFor: ['test'],
  category: 'codebase_specific',
  acquisitionMode: 'inspect_repo',
  importance: 'blocking',
  freshness: 'weekly',
  sensitivity: 'public',
  confidenceNeeded: 0.8,
  currentConfidence: 0.9,
}

async function collect(iter: AsyncIterable<RuntimeStreamEvent>): Promise<RuntimeStreamEvent[]> {
  const out: RuntimeStreamEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

describe('createOpenAICompatibleBackend — Anthropic usage emission', () => {
  it('synthesizes llm_call from Anthropic message_start + message_delta usage', async () => {
    // The router proxies Anthropic models (e.g. claude-sonnet-4-6) through the
    // same chat-completions endpoint. Anthropic SSE carries:
    //   - message_start.message.usage.input_tokens
    //   - content_block_delta with delta.text
    //   - message_delta.usage.output_tokens + delta.stop_reason
    //   - message_stop
    // None of the OpenAI fields (`choices`, `usage` at the top) are present.
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'claude-sonnet-4-6',
      fetchImpl: async () =>
        new Response(
          'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":128,"output_tokens":1}}}\n\n' +
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hel"}}\n\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n' +
            'data: {"type":"content_block_stop","index":0}\n\n' +
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":24}}\n\n' +
            'data: {"type":"message_stop"}\n\n',
          { status: 200 },
        ),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'anthropic-task', intent: 'hi', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )

    const llmCalls = events.filter((e) => e.type === 'llm_call')
    expect(llmCalls).toHaveLength(1)
    const llmCall = llmCalls[0]
    if (llmCall.type !== 'llm_call') throw new Error('expected llm_call')
    expect(llmCall.tokensIn).toBe(128)
    // message_start carries output_tokens:1 (the streamed acknowledgement
    // partial), message_delta adds 24 — total 25.
    expect(llmCall.tokensOut).toBe(25)
    expect(llmCall.model).toBe('claude-sonnet-4-6')
    expect(llmCall.finishReason).toBe('end_turn')

    // Anthropic-shape text deltas should also flow through.
    expect(
      events
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('hello')
  })

  it('captures usage even when only message_delta carries output_tokens (no message_start usage)', async () => {
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'claude-haiku-4-6',
      fetchImpl: async () =>
        new Response(
          'data: {"type":"message_start","message":{"id":"msg_2","model":"claude-haiku-4-6","usage":{"input_tokens":11}}}\n\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"text":"ok"}}\n\n' +
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n' +
            'data: {"type":"message_stop"}\n\n',
          { status: 200 },
        ),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'anthropic-min', intent: 'hi', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const llmCall = events.find((e) => e.type === 'llm_call')
    expect(llmCall).toBeDefined()
    if (!llmCall || llmCall.type !== 'llm_call') throw new Error('expected llm_call')
    expect(llmCall.tokensIn).toBe(11)
    expect(llmCall.tokensOut).toBe(3)
    expect(llmCall.model).toBe('claude-haiku-4-6')
    expect(llmCall.finishReason).toBe('end_turn')
  })
})
