import { describe, expect, it } from 'vitest'
import {
  type AgentBackendInput,
  type AgentExecutionBackend,
  BackendTransportError,
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

describe('createOpenAICompatibleBackend — typed transport errors surface to backend_error + final', () => {
  it('surfaces a 402 free-tier denial with kind=transport, status=402, and the upstream body', async () => {
    // This is the literal failure from /tmp/live-smoke-evidence.md: the
    // router returns 402 with `free_tier_limit` JSON and the runtime used to
    // emit `backend_error` with only the synthesized message string, so
    // consumers couldn't distinguish "model rejected free tier" from
    // "DNS failure". The error detail must now carry status + body.
    const body = JSON.stringify({
      error: {
        message: 'Model "claude-sonnet-4-6" requires credits.',
        type: 'insufficient_funds',
        code: 'free_tier_limit',
      },
    })
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-free-tier',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'claude-sonnet-4-6',
      retry: { maxAttempts: 1 },
      fetchImpl: async () => new Response(body, { status: 402 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: '402-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const backendError = events.find((e) => e.type === 'backend_error')
    expect(backendError).toBeDefined()
    if (backendError?.type !== 'backend_error') {
      throw new Error('expected backend_error')
    }
    expect(backendError.error).toEqual({
      kind: 'transport',
      message: expect.stringContaining('402'),
      status: 402,
      body,
    })
    // final carries the same typed detail.
    const final = events.at(-1)
    expect(final?.type).toBe('final')
    if (final?.type !== 'final') throw new Error('expected final')
    expect(final.status).toBe('failed')
    expect(final.error).toEqual({
      kind: 'transport',
      message: expect.stringContaining('402'),
      status: 402,
      body,
    })
  })

  it.each([
    [401, 'invalid api key'],
    [403, 'forbidden'],
    [404, 'model not found'],
  ])('surfaces hard 4xx (%i) with typed transport detail and a failed final', async (status) => {
    const body = JSON.stringify({ error: { code: 'auth_failed', message: 'rejected' } })
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-bad',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      retry: { maxAttempts: 1 },
      fetchImpl: async () => new Response(body, { status }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: `${status}-task`, intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const final = events.at(-1)
    expect(final?.type).toBe('final')
    if (final?.type !== 'final') throw new Error('expected final')
    expect(final.status).toBe('failed')
    expect(final.error?.kind).toBe('transport')
    expect(final.error?.status).toBe(status)
    expect(final.error?.body).toBe(body)
  })

  it('surfaces a 5xx after retry exhaustion with the last status and body', async () => {
    const body = '<html>Bad Gateway</html>'
    let attempts = 0
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      retry: { maxAttempts: 3, initialBackoffMs: 1, maxBackoffMs: 2 },
      fetchImpl: async () => {
        attempts += 1
        return new Response(body, { status: 502 })
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: '502-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    expect(attempts).toBe(3)
    const final = events.at(-1)
    if (final?.type !== 'final') throw new Error('expected final')
    expect(final.status).toBe('failed')
    expect(final.error?.kind).toBe('transport')
    expect(final.error?.status).toBe(502)
    expect(final.error?.body).toBe(body)
  })

  it('surfaces a connection failure (every attempt throws) with kind=transport, status=0', async () => {
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      retry: { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 2 },
      fetchImpl: async () => {
        throw new TypeError('fetch failed: ENETUNREACH')
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'net-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const final = events.at(-1)
    if (final?.type !== 'final') throw new Error('expected final')
    expect(final.status).toBe('failed')
    expect(final.error?.kind).toBe('transport')
    expect(final.error?.status).toBe(0)
    expect(final.error?.message).toContain('unreachable')
  })

  it('truncates oversized error bodies to ~2 KiB so persisted events stay bounded', async () => {
    const huge = 'A'.repeat(8192)
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      retry: { maxAttempts: 1 },
      fetchImpl: async () => new Response(huge, { status: 500 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'huge-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const final = events.at(-1)
    if (final?.type !== 'final') throw new Error('expected final')
    // 2 KiB cap + 1 ellipsis char.
    expect(final.error?.body?.length).toBeLessThanOrEqual(2049)
    expect(final.error?.body?.endsWith('…')).toBe(true)
  })

  it('classifies non-transport backend stream errors as kind=backend', async () => {
    // A custom backend whose stream() throws a plain Error (sandbox crash,
    // adapter bug). The runtime must still surface a typed error — just with
    // kind=backend and no status.
    const backend: AgentExecutionBackend<AgentBackendInput> = {
      kind: 'custom-sandbox',
      async *stream() {
        yield { type: 'text_delta', text: 'partial' }
        throw new Error('sandbox kernel died')
      },
    }
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'custom-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const final = events.at(-1)
    if (final?.type !== 'final') throw new Error('expected final')
    expect(final.status).toBe('failed')
    expect(final.error).toEqual({
      kind: 'backend',
      message: 'sandbox kernel died',
    })
    // Partial text is still surfaced so consumers can show whatever the model
    // produced before the crash.
    expect(final.text).toBe('partial')
  })

  it('leaves final.error undefined on a successful run', async () => {
    // The fail-loud change must not regress the success path — an absent
    // `error` field is the contract for "stream completed cleanly".
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      fetchImpl: async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
            'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n' +
            'data: [DONE]\n\n',
          { status: 200 },
        ),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'ok-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const final = events.at(-1)
    if (final?.type !== 'final') throw new Error('expected final')
    expect(final.status).toBe('completed')
    expect(final.error).toBeUndefined()
    const backendError = events.find((e) => e.type === 'backend_error')
    expect(backendError).toBeUndefined()
  })

  it('BackendTransportError exposes status + body for direct catchers', async () => {
    // Some consumers wrap the backend instead of running it through
    // runAgentTaskStream — they need to see the typed error directly.
    const body = 'rate-limited'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      retry: { maxAttempts: 1 },
      fetchImpl: async () => new Response(body, { status: 429 }),
    })
    let caught: unknown
    try {
      for await (const _ of backend.stream(
        { task: { id: 't', intent: 'go' }, message: 'hi' },
        {
          task: { id: 't', intent: 'go' },
          knowledge: {
            taskId: 't',
            blockingMissingRequirements: [],
            nonBlockingGaps: [],
            satisfiedRequirements: [],
            readinessScore: 1,
            severity: 'none',
            recommendedAction: 'proceed',
            reason: 'ready',
          },
          session: {
            id: 's',
            backend: 'tcloud',
            status: 'active',
            createdAt: '2026-05-24T00:00:00Z',
            updatedAt: '2026-05-24T00:00:00Z',
          },
        },
      )) {
        // drain
      }
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BackendTransportError)
    const transportErr = caught as BackendTransportError
    expect(transportErr.status).toBe(429)
    expect(transportErr.body).toBe(body)
    expect(transportErr.backend).toBe('tcloud')
  })
})
