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

describe('createOpenAICompatibleBackend — OpenAI usage emission', () => {
  it('emits a synthesized llm_call event from the final OpenAI usage chunk', async () => {
    // Regression: prior to this fix the backend never read `parsed.usage` and
    // never emitted `llm_call`, so RunRecord.tokenUsage was always zero.
    let capturedBody: string | undefined
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      fetchImpl: async (_url, init) => {
        capturedBody = init?.body as string | undefined
        return new Response(
          'data: {"choices":[{"index":0,"delta":{"content":"hel"}}],"model":"gpt-4.1-mini"}\n\n' +
            'data: {"choices":[{"index":0,"delta":{"content":"lo"}}],"model":"gpt-4.1-mini"}\n\n' +
            'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"model":"gpt-4.1-mini"}\n\n' +
            'data: {"choices":[],"model":"gpt-4.1-mini","usage":{"prompt_tokens":42,"completion_tokens":7,"total_tokens":49}}\n\n' +
            'data: [DONE]\n\n',
          { status: 200 },
        )
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'usage-task', intent: 'hi', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )

    // The request body must include `stream_options.include_usage` so the
    // router forwards usage upstream and back.
    expect(capturedBody).toBeDefined()
    expect(JSON.parse(capturedBody as string)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    })

    const llmCalls = events.filter((e) => e.type === 'llm_call')
    expect(llmCalls).toHaveLength(1)
    const llmCall = llmCalls[0]
    if (llmCall.type !== 'llm_call') throw new Error('expected llm_call')
    expect(llmCall.tokensIn).toBe(42)
    expect(llmCall.tokensOut).toBe(7)
    expect(llmCall.model).toBe('gpt-4.1-mini')
    expect(llmCall.finishReason).toBe('stop')
    // Latency is wall-clock, so just check it's a finite non-negative number.
    expect(typeof llmCall.latencyMs).toBe('number')
    expect(llmCall.latencyMs).toBeGreaterThanOrEqual(0)
    // Text deltas still flow.
    expect(
      events
        .filter((e) => e.type === 'text_delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('hello')
  })

  it('does NOT synthesize an llm_call event when the stream never reports usage', async () => {
    // Truthful absence: better to emit nothing than to emit zero tokens and
    // poison every downstream ledger with silent zeros.
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      fetchImpl: async () =>
        new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' + 'data: [DONE]\n\n', {
          status: 200,
        }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'no-usage', intent: 'hi', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const llmCalls = events.filter((e) => e.type === 'llm_call')
    expect(llmCalls).toHaveLength(0)
  })
})
