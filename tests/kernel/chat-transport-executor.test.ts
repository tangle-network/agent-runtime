/**
 * chatTransportExecutor — the worker that IS a conversation on a bare chat-completions transport
 * (#721). All offline (injected `complete` transport, zero network). The load-bearing cases:
 *
 *   1. One fresh shot: system + task seed the conversation, the loop settles with the final
 *      assistant text as `out`, and spend is metered from the transport's OWN usage/cost fields.
 *      Sampling honesty: `temperature`/`maxTokens` reach the wire on EVERY request when set (one
 *      request class), and neither field appears when unset.
 *   2. Continuity: the conversation is recorded under the session key, and a `resume` shot
 *      CONTINUES that exact message list (the resumed-history chain, asserted at the transport).
 *   3. Resume fails loud BEFORE any spend when the store has no recorded conversation.
 *   4. Metering honesty: a turn without usage marks `tokensKnown: false`; a turn without a cost
 *      field marks `usdKnown: false` — never a silent estimate, never a fabricated zero.
 *   5. The tool table: tool_calls run on the host and fold back as `tool` messages; unknown tools
 *      and malformed arguments are fed back to the model, never thrown.
 *   6. Transport failures remain visible to the scope as INFRA — and the turns that DID run are
 *      still recorded, because resume-after-failure is a kernel-supported path.
 *   7. `chatWorkerSeam`: profile model/prompt win, the graph's appended directive instructions
 *      reach the system message, the node id keys the recorded session, and a missing model
 *      fails loud.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import type { WorkerSpawnContext } from '../../src/mcp/tools/coordination'
import {
  type ChatCompletionsTransport,
  chatTransportExecutor,
  chatWorkerSeam,
  createChatSessionStore,
} from '../../src/runtime/supervise/chat-transport-executor'
import type {
  AgentSpec,
  Budget,
  Executor,
  ExecutorContext,
  ExecutorResult,
} from '../../src/runtime/supervise/types'

/** The seam's agents expose their `AgentSpec` (the scope contract); narrow to it. */
function specOf(agent: unknown): AgentSpec {
  return (agent as { executorSpec: AgentSpec }).executorSpec
}

/** Build the per-spawn executor exactly as the scope would: factory(spec, ctx). */
function buildExecutor(spec: AgentSpec, ctx: ExecutorContext): Executor<unknown> {
  const factory = spec.executorFactory
  if (!factory) throw new Error('expected an executorFactory on the seam spec')
  return factory(spec, ctx)
}

const never = new AbortController().signal

function chatProfile(
  overrides: Partial<AgentProfile> & Pick<AgentProfile, 'name'> = { name: 'chat-worker' },
): AgentProfile {
  return {
    harness: 'cli-base',
    model: { provider: 'scripted', default: 'test/model' },
    ...overrides,
  }
}

/** A scripted transport: replies in order (last repeats), captures every request body. */
function scriptedTransport(replies: Array<Record<string, unknown>>): {
  transport: ChatCompletionsTransport
  requests: Array<Record<string, unknown>>
} {
  const requests: Array<Record<string, unknown>> = []
  return {
    requests,
    transport: async (body) => {
      requests.push(structuredClone(body))
      return replies[Math.min(requests.length - 1, replies.length - 1)]
    },
  }
}

const reply = (content: string, usage?: Record<string, unknown>) => ({
  choices: [{ message: { content } }],
  ...(usage !== undefined ? { usage } : {}),
})

describe('chatTransportExecutor — one conversation shot on a bare transport', () => {
  it('settles with the final assistant text and meters usage + response cost fields', async () => {
    const { transport, requests } = scriptedTransport([
      reply('the answer', { prompt_tokens: 11, completion_tokens: 7, cost: 0.002 }),
    ])
    const ex = chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({ name: 'terse', prompt: { systemPrompt: 'Be terse.' } }),
      complete: transport,
    })
    const result = await (ex.execute('what is 2+2?', never) as Promise<ExecutorResult<string>>)
    expect(result.out).toBe('the answer')
    expect(result.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 11, output: 7 },
      usd: 0.002,
    })
    // Both channels measured — neither honesty marker is set.
    expect(result.spent.tokensKnown).toBeUndefined()
    expect(result.spent.usdKnown).toBeUndefined()
    // The wire body: system seed + the task as the user message, model verbatim, no tools field,
    // and no sampling fields the caller never set (the endpoint's own defaults govern).
    expect(requests).toHaveLength(1)
    expect(requests[0]?.model).toBe('test/model')
    expect(requests[0]?.tools).toBeUndefined()
    expect(requests[0]?.temperature).toBeUndefined()
    expect(requests[0]?.max_tokens).toBeUndefined()
    expect(requests[0]?.messages).toEqual([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'what is 2+2?' },
    ])
    expect(ex.resultArtifact().out).toBe('the answer')
  })

  it('sends the configured temperature + maxTokens as sampling fields on EVERY request', async () => {
    const { transport, requests } = scriptedTransport([
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [{ id: 'c1', function: { name: 'step', arguments: '{}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
      },
      reply('done', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
    ])
    await (chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({
        name: 'tool-user',
        model: {
          provider: 'scripted',
          default: 'test/model',
          metadata: { temperature: 0.7, maxTokens: 2500 },
        },
        tools: { step: true },
      }),
      complete: transport,
      tools: [
        {
          spec: { type: 'function', function: { name: 'step', parameters: {} } },
          execute: async () => 'ok',
        },
      ],
    }).execute('go', never) as Promise<unknown>)
    // Both the turn-initial and the tool-follow-up completion carry the SAME pinned sampling —
    // this executor has exactly one request class (the P1 parity contract).
    expect(requests).toHaveLength(2)
    for (const req of requests) {
      expect(req.temperature).toBe(0.7)
      expect(req.max_tokens).toBe(2500)
    }
  })

  it('rejects a non-positive or fractional maxTokens before any transport call', () => {
    const { transport, requests } = scriptedTransport([reply('never')])
    for (const maxTokens of [0, -1, 1.5]) {
      expect(() =>
        chatTransportExecutor({
          url: 'http://unused.invalid',
          profile: chatProfile({
            name: 'invalid-token-limit',
            model: {
              provider: 'scripted',
              default: 'test/model',
              metadata: { maxTokens },
            },
          }),
          complete: transport,
        }),
      ).toThrow(/maxTokens must (?:be positive|be a safe integer)/)
    }
    expect(requests).toHaveLength(0)
  })

  it('records the conversation and a resume shot continues the exact message list', async () => {
    const sessions = createChatSessionStore()
    const shot1 = scriptedTransport([
      reply('draft v1', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
    ])
    await (chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({ name: 'persistent', prompt: { systemPrompt: 'Persist.' } }),
      complete: shot1.transport,
      sessions,
      sessionKey: 'run:s0',
    }).execute('shot 1: draft it', never) as Promise<unknown>)

    const shot2 = scriptedTransport([
      reply('draft v2', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
    ])
    const result = await (chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({ name: 'persistent', prompt: { systemPrompt: 'Persist.' } }),
      complete: shot2.transport,
      sessions,
      sessionKey: 'run:s1',
      resume: { ofWorker: 'run:s0', sequence: 2 },
    }).execute('shot 2: revise it', never) as Promise<ExecutorResult<string>>)
    expect(result.out).toBe('draft v2')
    // THE resumed-history chain: shot 2's request carries shot 1's whole conversation
    // (system, user, assistant) plus the new user turn — same session, one message list.
    expect(shot2.requests[0]?.messages).toEqual([
      { role: 'system', content: 'Persist.' },
      { role: 'user', content: 'shot 1: draft it' },
      { role: 'assistant', content: 'draft v1' },
      { role: 'user', content: 'shot 2: revise it' },
    ])
    // And shot 2's own record extends the chain under ITS key, for shot 3.
    expect(sessions.load('run:s1')?.at(-1)).toEqual({ role: 'assistant', content: 'draft v2' })
    expect(sessions.load('run:s1')).toHaveLength(5)
  })

  it('a resume with no recorded conversation fails loud before any transport call', () => {
    const { transport, requests } = scriptedTransport([reply('never')])
    expect(() =>
      chatTransportExecutor({
        url: 'http://unused.invalid',
        profile: chatProfile(),
        complete: transport,
        sessions: createChatSessionStore(),
        resume: { ofWorker: 'ghost:s9', sequence: 2 },
      }),
    ).toThrow(/no recorded conversation for worker 'ghost:s9'/)
    expect(() =>
      chatTransportExecutor({
        url: 'http://unused.invalid',
        profile: chatProfile(),
        complete: transport,
        resume: { ofWorker: 'ghost:s9', sequence: 2 },
      }),
    ).toThrow(/needs the session store/)
    expect(requests).toHaveLength(0)
  })

  it('marks tokensKnown/usdKnown false when the transport omits usage or cost — never estimates', async () => {
    const noUsage = scriptedTransport([{ choices: [{ message: { content: 'blind turn' } }] }])
    const r1 = await (chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile(),
      complete: noUsage.transport,
    }).execute('t', never) as Promise<ExecutorResult<string>>)
    expect(r1.spent.tokensKnown).toBe(false)
    expect(r1.spent.usdKnown).toBe(false)
    expect(r1.spent.tokens).toEqual({ input: 0, output: 0 })
    expect(r1.spent.usd).toBe(0)

    // Tokens reported, cost not: tokens stay known, dollars are explicitly unknown — the priced
    // model id must NOT tempt a local estimate.
    const tokensOnly = scriptedTransport([
      reply('metered tokens', { prompt_tokens: 3, completion_tokens: 4 }),
    ])
    const r2 = await (chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({
        name: 'priced-model',
        model: { provider: 'openai', default: 'openai/gpt-4o-mini' },
      }),
      complete: tokensOnly.transport,
    }).execute('t', never) as Promise<ExecutorResult<string>>)
    expect(r2.spent.tokens).toEqual({ input: 3, output: 4, cacheBreakdownKnown: false })
    expect(r2.spent.tokensKnown).toBeUndefined()
    expect(r2.spent.usd).toBe(0)
    expect(r2.spent.usdKnown).toBe(false)
  })

  it('runs the tool table on the host and feeds unknown/malformed calls back to the model', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const { transport, requests } = scriptedTransport([
      {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'c1', function: { name: 'lookup', arguments: '{"q":"x"}' } },
                { id: 'c2', function: { name: 'nope', arguments: '{}' } },
                { id: 'c3', function: { name: 'lookup', arguments: '{broken' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
      },
      reply('done with tools', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
    ])
    const result = await (chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({ name: 'lookup-user', tools: { lookup: true } }),
      complete: transport,
      tools: [
        {
          spec: { type: 'function', function: { name: 'lookup', parameters: {} } },
          execute: async (args) => {
            calls.push({ name: 'lookup', args })
            return 'result:42'
          },
        },
      ],
    }).execute('use the tool', never) as Promise<ExecutorResult<string>>)
    expect(result.out).toBe('done with tools')
    expect(result.spent.iterations).toBe(2)
    expect(calls).toEqual([{ name: 'lookup', args: { q: 'x' } }])
    // Turn 2's request folds all three outcomes back as tool messages, in call order.
    const turn2 = requests[1]?.messages as Array<Record<string, unknown>>
    expect(turn2.slice(-3)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: 'result:42' },
      {
        role: 'tool',
        tool_call_id: 'c2',
        content: 'error: tool "nope" is not enabled by AgentProfile.tools',
      },
      { role: 'tool', tool_call_id: 'c3', content: 'error: tool arguments were not valid JSON' },
    ])
    expect(requests[0]?.tools).toBeDefined()
    expect(requests[0]?.tool_choice).toBe('auto')
  })

  it('surfaces a transport failure — and still records the turns that ran', async () => {
    const sessions = createChatSessionStore()
    let turn = 0
    const ex = chatTransportExecutor({
      url: 'http://unused.invalid',
      profile: chatProfile({
        name: 'fallible-tool-user',
        prompt: { systemPrompt: 'S.' },
        tools: { step: true },
      }),
      sessions,
      sessionKey: 'run:s0',
      tools: [
        {
          spec: { type: 'function', function: { name: 'step', parameters: {} } },
          execute: async () => 'ok',
        },
      ],
      complete: async () => {
        turn += 1
        if (turn === 1) {
          return {
            choices: [
              {
                message: {
                  content: 'working',
                  tool_calls: [{ id: 'c1', function: { name: 'step', arguments: '{}' } }],
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
          }
        }
        throw new Error('socket hang up')
      },
    })
    await expect(ex.execute('go', never) as Promise<unknown>).rejects.toThrow('socket hang up')
    // The failed shot's REAL first turn is recorded, so a resume can continue the session.
    const recorded = sessions.load('run:s0')
    expect(recorded?.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
  })

  it('fails loud on a malformed completion', async () => {
    const empty = scriptedTransport([{ choices: [] }])
    await expect(
      chatTransportExecutor({
        url: 'http://unused.invalid',
        profile: chatProfile(),
        complete: empty.transport,
      }).execute('t', never) as Promise<unknown>,
    ).rejects.toThrow(/no choices\[0\]\.message/)
  })
})

describe('chatWorkerSeam — the continuity-honoring makeWorkerAgent over the executor', () => {
  const budget: Budget = { maxIterations: 10, maxTokens: 10_000 }
  const nodeCtx = (nodeId: string): ExecutorContext => ({
    signal: never,
    node: { rootId: 'r', parentId: 'r', nodeId, attemptId: `${nodeId}:attempt:test` },
    seams: {},
  })
  const spawnContext = (over: Partial<WorkerSpawnContext>): WorkerSpawnContext => ({
    assignmentId: 'a1',
    parentNodeId: 'r',
    budget,
    task: 't',
    label: 'chat',
    ...over,
  })

  it('spawns a chat worker from the profile (model + prompt + appended directive) and records under the node id', async () => {
    const { transport, requests } = scriptedTransport([
      reply('hi there', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
    ])
    const sessions = createChatSessionStore()
    const seam = chatWorkerSeam({
      url: 'http://unused.invalid',
      complete: transport,
      sessions,
    })
    const agent = seam(
      {
        name: 'product-agent',
        harness: 'cli-base',
        model: {
          provider: 'scripted',
          default: 'profile/model',
          metadata: { temperature: 0.7, maxTokens: 2500 },
        },
        // The graph pins the delegates directive by APPENDING to instructions — it must reach
        // the system message.
        prompt: { systemPrompt: 'Sell.', instructions: ['directive: be helpful'] },
      },
      spawnContext({}),
    )
    expect(agent.name).toBe('product-agent')
    const ex = buildExecutor(specOf(agent), nodeCtx('run:s0'))
    const result = await (ex.execute('opening message', never) as Promise<ExecutorResult<string>>)
    expect(result.out).toBe('hi there')
    expect(requests[0]?.model).toBe('profile/model')
    // The seam's sampling options thread through to the executor's wire body.
    expect(requests[0]?.temperature).toBe(0.7)
    expect(requests[0]?.max_tokens).toBe(2500)
    expect(requests[0]?.messages).toEqual([
      { role: 'system', content: 'Sell.\ndirective: be helpful' },
      { role: 'user', content: 'opening message' },
    ])
    expect(sessions.load('run:s0')).toBeDefined()
  })

  it("a 'resume' spawn continues the prior node worker's recorded conversation", async () => {
    const replies = [
      reply('turn 1 reply', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
      reply('turn 2 reply', { prompt_tokens: 1, completion_tokens: 1, cost: 0 }),
    ]
    const { transport, requests } = scriptedTransport(replies)
    const seam = chatWorkerSeam({
      url: 'http://unused.invalid',
      complete: transport,
    })
    const profile = chatProfile({
      name: 'agent',
      model: { provider: 'scripted', default: 'm' },
      prompt: { systemPrompt: 'S.' },
    })

    const first = seam(profile, spawnContext({}))
    await (buildExecutor(specOf(first), nodeCtx('g:s0')).execute(
      'user turn 1',
      never,
    ) as Promise<unknown>)

    const second = seam(
      profile,
      spawnContext({ continuity: 'resume', resume: { ofWorker: 'g:s0', sequence: 2 } }),
    )
    await (buildExecutor(specOf(second), nodeCtx('g:s1')).execute(
      'user turn 2',
      never,
    ) as Promise<unknown>)

    expect(requests[1]?.messages).toEqual([
      { role: 'system', content: 'S.' },
      { role: 'user', content: 'user turn 1' },
      { role: 'assistant', content: 'turn 1 reply' },
      { role: 'user', content: 'user turn 2' },
    ])
  })

  it('fails loud when the exact profile omits execution identity', () => {
    const seam = chatWorkerSeam({ url: 'http://unused.invalid', complete: async () => reply('x') })
    expect(() => seam({ name: 'agent', prompt: { systemPrompt: 'S.' } }, undefined)).toThrow(
      /harness must be explicit/,
    )
  })
})
