import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AgentSpec, createBudgetPool, createExecutor, createInbox } from '../../src/runtime'
import { testAgentProfile } from './test-agent-profile'

describe('worker inbox (down-leg receive end)', () => {
  it('parses the down-message shapes; ignores malformed', () => {
    const inbox = createInbox()
    expect(inbox.deliver({ steer: 'do X' })).toBe(true)
    expect(inbox.deliver({ answer: 'use v2', questionId: 'q1' })).toBe(true)
    expect(inbox.deliver({ junk: true })).toBe(false)
    expect(inbox.deliver(null)).toBe(false)
    const drained = inbox.drain()
    expect(drained).toEqual([
      { kind: 'steer', text: 'do X', interrupt: false },
      { kind: 'answer', text: 'use v2', interrupt: false, questionId: 'q1' },
    ])
    // drain is destructive
    expect(inbox.pending()).toBe(0)
  })

  it('folds queued messages into one operator turn', () => {
    const inbox = createInbox()
    inbox.deliver({ steer: 'switch to recursion' })
    inbox.deliver({ answer: 'v2', questionId: 'q7' })
    const folded = inbox.fold(inbox.drain())
    expect(folded).toContain('[SUPERVISOR]')
    expect(folded).toContain('New instruction from your supervisor: switch to recursion')
    // Every line names its sender, the supervisor's own answer included: once peer mail can also
    // reach this inbox, "unattributed" must not be a renderable state.
    expect(folded).toContain('Answer from your supervisor to your question (q7): v2')
  })

  it('a forceful message aborts the live turn signal; a queued one does not', () => {
    const inbox = createInbox()
    const sig = inbox.freshInterrupt()
    expect(sig.aborted).toBe(false)
    inbox.deliver({ steer: 'note for later' }) // queued — no interrupt
    expect(sig.aborted).toBe(false)
    inbox.deliver({ steer: 'STOP, wrong path', interrupt: true }) // forceful
    expect(sig.aborted).toBe(true)
  })

  it('each freshInterrupt is independent — a stale signal is not re-aborted', () => {
    const inbox = createInbox()
    const first = inbox.freshInterrupt()
    inbox.deliver({ steer: 'x', interrupt: true })
    expect(first.aborted).toBe(true)
    // A new turn opens a fresh signal; the prior forceful message does not abort it.
    const second = inbox.freshInterrupt()
    expect(second.aborted).toBe(false)
  })
})

describe('router-tools executor drains the inbox', () => {
  afterEach(() => vi.unstubAllGlobals())

  const noToolReply = () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'done', tool_calls: [] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )

  it('a worker may not settle while a steer is pending — it flushes, folds it in, and continues', async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = []
    let calls = 0
    let deliver: (m: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string }) => {
        bodies.push(JSON.parse(init?.body ?? '{}'))
        calls += 1
        // The driver steers the worker WHILE it is mid-turn, just as it first tries to finish.
        if (calls === 1) deliver({ steer: 'also handle the wide-char edge case' })
        return noToolReply()
      }),
    )

    const factory = createExecutor({
      backend: 'router-tools',
      model: 'test-model',
      routerBaseUrl: 'http://router.test',
      routerKey: 'k',
      tools: [],
      executeToolCall: async () => '',
    })
    const spec: AgentSpec = {
      profile: testAgentProfile('w', {
        harness: 'cli-base',
        model: { provider: 'test', default: 'test-model' },
        prompt: { systemPrompt: 'sys' },
      }),
      harness: null,
    } as AgentSpec
    const exec = factory(spec, { signal: new AbortController().signal, seams: {} })
    deliver = (m) => exec.deliver?.(m)

    await exec.execute('implement wcwidth', new AbortController().signal)

    // Turn 1 saw no tool calls but DID NOT settle — the pending steer forced a second turn...
    expect(calls).toBe(2)
    // ...and that second turn's conversation carries the folded steer.
    const turn2 = bodies[1]?.messages ?? []
    expect(turn2.some((m) => m.content?.includes('also handle the wide-char edge case'))).toBe(true)
  })

  it('a FORCEFUL steer aborts the in-flight turn and records its unknown spend before re-planning', async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = []
    let calls = 0
    let deliver: (m: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { body?: string; signal?: AbortSignal }) => {
        calls += 1
        if (calls === 1) {
          // The driver forcefully interrupts mid-inference — the turn signal aborts and fetch rejects.
          deliver({ steer: 'STOP — wrong file, edit src/core.ts', interrupt: true })
          throw new DOMException('aborted', 'AbortError')
        }
        bodies.push(JSON.parse(init?.body ?? '{}'))
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'done', tool_calls: [] } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0.01 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const factory = createExecutor({
      backend: 'router-tools',
      model: 'test-model',
      routerBaseUrl: 'http://router.test',
      routerKey: 'k',
      tools: [],
      executeToolCall: async () => '',
    })
    const spec: AgentSpec = {
      profile: testAgentProfile('w', {
        harness: 'cli-base',
        model: { provider: 'test', default: 'test-model' },
        prompt: { systemPrompt: 'sys' },
      }),
      harness: null,
    } as AgentSpec
    const exec = factory(spec, { signal: new AbortController().signal, seams: {} })
    deliver = (m) => exec.deliver?.(m)

    const result = await exec.execute('edit the file', new AbortController().signal)

    // The aborted response was discarded and the worker re-planned on turn 2...
    expect(calls).toBe(2)
    // ...which carries the forceful steer. The accepted first request still consumed an iteration
    // and one transport attempt; absent a terminal receipt its token and dollar totals are unknown.
    expect(
      bodies[0]?.messages.some((m) => m.content?.includes('wrong file, edit src/core.ts')),
    ).toBe(true)
    expect(result.spent).toMatchObject({
      iterations: 2,
      tokens: { input: 1, output: 1 },
      tokensKnown: false,
      usd: 0.01,
      usdKnown: false,
    })
    expect((result.out as { transportAttempts: number }).transportAttempts).toBe(2)
  })

  it('marks dollar cost unknown for an unpriced model even when token usage is complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => noToolReply()),
    )
    const factory = createExecutor({
      backend: 'router-tools',
      model: 'unpriced-test-model',
      routerBaseUrl: 'http://router.test',
      routerKey: 'k',
      tools: [],
      executeToolCall: async () => '',
    })
    const exec = factory(
      {
        profile: testAgentProfile('w', {
          harness: 'cli-base',
          model: { provider: 'test', default: 'unpriced-test-model' },
        }),
        harness: null,
      },
      { signal: new AbortController().signal, seams: {} },
    )

    const result = await exec.execute('do the task', new AbortController().signal)

    expect(result.spent).toMatchObject({
      tokens: { input: 1, output: 1 },
      usd: 0,
      usdKnown: false,
    })
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 10, maxUsd: 1 }, 0)
    const reservation = pool.reserve({ maxIterations: 1, maxTokens: 2, maxUsd: 1 })
    if (!reservation.ok) throw new Error('reservation should fit')
    expect(() => pool.reconcile(reservation.ticket, result.spent)).toThrow(/unknown dollar cost/)
    expect(pool.readout()).toMatchObject({ usdLeft: 0, usdKnown: false })
  })

  it('keeps complete Router cache classes in the worker spend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'done', tool_calls: [] } }],
              usage: {
                prompt_tokens: 20,
                completion_tokens: 2,
                prompt_cache: { read_tokens: 7, write_tokens: 3 },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const factory = createExecutor({
      backend: 'router-tools',
      model: 'test-model',
      routerBaseUrl: 'http://router.test',
      routerKey: 'k',
      tools: [],
      executeToolCall: async () => '',
    })
    const exec = factory(
      {
        profile: testAgentProfile('w', {
          harness: 'cli-base',
          model: { provider: 'test', default: 'test-model' },
        }),
        harness: null,
      },
      { signal: new AbortController().signal, seams: {} },
    )

    const result = await exec.execute('do the task', new AbortController().signal)

    expect(result.spent.tokens).toEqual({
      input: 20,
      output: 2,
      freshInput: 10,
      cacheRead: 7,
      cacheWrite: 3,
    })
  })

  it('marks dollar cost unknown for a priced model when token usage is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const factory = createExecutor({
      backend: 'router-tools',
      model: 'gpt-4o',
      routerBaseUrl: 'http://router.test',
      routerKey: 'k',
      tools: [],
      executeToolCall: async () => '',
    })
    const exec = factory(
      {
        profile: testAgentProfile('w', {
          harness: 'cli-base',
          model: { provider: 'openai', default: 'gpt-4o' },
        }),
        harness: null,
      },
      { signal: new AbortController().signal, seams: {} },
    )

    const result = await exec.execute('do the task', new AbortController().signal)

    expect(result.spent).toMatchObject({
      tokens: { input: 0, output: 0 },
      tokensKnown: false,
      usd: 0,
      usdKnown: false,
    })
  })
})
