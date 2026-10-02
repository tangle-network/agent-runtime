import { estimateCost, HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
import {
  type AgentExactRunControlRef,
  type AgentProfile,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  replaySpawnTree,
} from '../durable/spawn-journal'
import {
  type AgentEnvironment,
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  type AgentSession,
  type AgentTurnInput,
  createAgentEnvironmentProviderRegistry,
  type ProviderLeafOut,
  providerAsExecutor,
  providerAsSandboxClient,
} from './environment-provider'
import { harnessTranscriptArtifact } from './harness-transcript'
import { bindProfileChat } from './profile-chat-client'
import { type ProviderPlacement, selectProviderPlacement } from './provider-placement'
import { retainedCreateMaterial } from './retained-run-intent'
import { collectAgentTurn, streamAgentTurn } from './stream-agent-turn'
import { createBudgetPool } from './supervise/budget'
import { createExecutor, createExecutorRegistry } from './supervise/runtime'
import { createScope } from './supervise/scope'
import { superviseWithTestBrain } from './supervise/supervise'
import type { AgentSpec, ExecutorContext, UsageEvent } from './supervise/types'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const value of iterable) out.push(value)
  return out
}

describe('environment provider adapters', () => {
  it('refuses a substituted subscription profile before creating an environment', async () => {
    let creates = 0
    const profile: AgentProfile = {
      name: 'exact-subscription',
      harness: 'claude-code',
      model: {
        provider: 'anthropic',
        default: 'claude-opus-5-5',
        metadata: { credentialSource: 'subscription' },
      },
      tools: {},
    }
    const provider: AgentEnvironmentProvider = {
      name: 'tangle-sandbox',
      capabilities: fakeCapabilities,
      async create() {
        creates++
        throw new Error('Unexpected environment creation')
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, {
      taskToTurn: (_task, _profile, turn) => ({
        ...turn,
        providerOptions: { backend: { profile: { ...profile, tools: { Read: true } } } },
      }),
    })({ profile, harness: null }, { signal, seams: {} })
    const execution = executor.execute('work', signal)
    if (!(Symbol.asyncIterator in execution)) {
      throw new Error('Expected streamed provider execution')
    }
    await expect(collect(execution)).rejects.toThrow('cannot replace its exact AgentProfile')
    expect(creates).toBe(0)
  })

  it.each(['managed', 'subscription'] as const)(
    'preserves explicit %s credentials through the actual provider executor',
    async (credentialSource) => {
      let createdProfile: AgentProfile | undefined
      let streamedProfile: AgentProfile | undefined
      const provider: AgentEnvironmentProvider = {
        name: 'tangle-sandbox',
        capabilities: fakeCapabilities,
        async create(input) {
          if (typeof input.profile === 'string') throw new Error('expected inline profile')
          createdProfile = input.profile
          return fakeEnvironment({
            async *stream(turn) {
              streamedProfile = (
                turn.providerOptions?.backend as { profile?: AgentProfile } | undefined
              )?.profile
              yield { type: 'done', data: { finalText: 'subscription result' } }
            },
          })
        },
      }
      const profile: AgentProfile = {
        name: 'subscription-worker',
        harness: 'claude-code',
        model: {
          provider: 'anthropic',
          default: 'claude-opus-5-5',
          reasoningEffort: 'high',
          metadata: { credentialSource },
        },
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile, harness: null },
        { signal, seams: {} },
      )
      await collect(executor.execute('task', signal) as AsyncIterable<UsageEvent>)
      expect(createdProfile).toEqual(profile)
      expect(streamedProfile).toEqual(credentialSource === 'subscription' ? profile : undefined)
      expect(canonicalAgentProfileDigest(createdProfile!)).toBe(
        canonicalAgentProfileDigest(profile),
      )
      expect(executor.resultArtifact().out).toMatchObject({ content: 'subscription result' })
      expect(
        bindProfileChat({
          profile,
          executor: { backend: 'provider', provider },
          context: 'subscription chat',
        }).profile,
      ).toEqual(profile)
    },
  )

  it.each([
    { credentialSource: 'api-key' },
    { credentialSource: null },
    { credentialSource: 1 },
    { credentialSource: { subscription: true } },
    { credentialSource: 'subscription', unknownControl: true },
  ])(
    'refuses invalid credential intent or unknown controls before provider creation: %j',
    (metadata) => {
      let creates = 0
      const provider: AgentEnvironmentProvider = {
        name: 'tangle-sandbox',
        capabilities: fakeCapabilities,
        async create() {
          creates += 1
          throw new Error('creation must remain unreachable')
        },
      }
      expect(() =>
        providerAsExecutor(provider)(
          {
            profile: {
              name: 'invalid-worker',
              model: { provider: 'anthropic', default: 'claude-opus-5-5', metadata },
            },
            harness: null,
          },
          { signal: new AbortController().signal, seams: {} },
        ),
      ).toThrow(/credentialSource|unknownControl/)
      expect(creates).toBe(0)
    },
  )

  it('still refuses unenforceable completion ceilings before creating a subscription environment', () => {
    let creates = 0
    const provider: AgentEnvironmentProvider = {
      name: 'tangle-sandbox',
      capabilities: fakeCapabilities,
      async create() {
        creates += 1
        throw new Error('creation must remain unreachable')
      },
    }
    expect(() =>
      providerAsExecutor(provider)(
        {
          profile: {
            name: 'bounded-subscription',
            model: {
              provider: 'anthropic',
              default: 'claude-opus-5-5',
              metadata: { credentialSource: 'subscription' },
              maxTotalOutputTokens: 100,
            },
          },
          harness: null,
        },
        { signal: new AbortController().signal, seams: {} },
      ),
    ).toThrow(/maxTotalOutputTokens cannot be enforced on the provider path/)
    expect(creates).toBe(0)
  })

  it.each([false, true])(
    'reconciles interim unpriced work with a complete terminal bill (estimate=%s)',
    async (estimate) => {
      const provider: AgentEnvironmentProvider = {
        name: 'terminal-bill-fixture',
        capabilities: fakeCapabilities,
        create: async () =>
          fakeEnvironment({
            async *stream() {
              yield {
                type: 'llm_call',
                data: {
                  tokensIn: 7,
                  tokensOut: 11,
                  costUsd: 0.03,
                  costProvenance: 'billing-receipt',
                },
              }
              yield {
                type: 'llm_call',
                data: {
                  tokensIn: 5,
                  tokensOut: 9,
                  ...(estimate
                    ? { estimatedCostUsd: 0.02, costProvenance: 'catalog-estimate' }
                    : {}),
                },
              }
              yield {
                type: 'result',
                data: {
                  finalText: 'result',
                  costProvenance: 'billing-receipt',
                  usage: {
                    tokensIn: 12,
                    tokensOut: 20,
                    costUsd: 0.05,
                    costProvenance: 'billing-receipt',
                  },
                },
              }
            },
          }),
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile: { name: 'worker' }, harness: null },
        { signal, seams: {} },
      )
      const events = await collect(executor.execute('task', signal) as AsyncIterable<UsageEvent>)
      const costs = events.filter((event) => event.kind === 'cost')
      expect(costs.reduce((sum, event) => sum + event.usd, 0)).toBeCloseTo(0.05)
      expect(costs.every((event) => event.usdKnown)).toBe(true)
      expect(executor.resultArtifact().spent.usd).toBeCloseTo(0.05)
      expect(executor.resultArtifact().spent.usdKnown).toBe(true)
      expect(executor.resultArtifact().spent.usdEstimated).toBeUndefined()
    },
  )

  it.each([
    { provenance: 'billing-receipt', expectedKnown: true, expectedEstimate: undefined },
    { provenance: 'uncaptured', expectedKnown: false, expectedEstimate: 0.03 },
  ])(
    'keeps terminal cost provenance consistent with streamed receipts ($provenance)',
    async ({ provenance, expectedKnown, expectedEstimate }) => {
      const provider: AgentEnvironmentProvider = {
        name: 'cost-fixture',
        capabilities: fakeCapabilities,
        create: async () =>
          fakeEnvironment({
            async *stream() {
              yield {
                type: 'llm_call',
                data: { tokensIn: 7, tokensOut: 11, costUsd: 0.03, costProvenance: provenance },
              }
              yield { type: 'done', data: { finalText: 'result' } }
            },
          }),
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile: { name: 'worker' }, harness: null },
        { signal, seams: {} },
      )
      await collect(executor.execute('task', signal) as AsyncIterable<UsageEvent>)
      const spent = executor.resultArtifact().spent
      expect(spent.usd).toBeCloseTo(0.03)
      expect(spent.usdKnown).toBe(expectedKnown)
      expect(spent.usdEstimated).toBe(expectedEstimate)
    },
  )

  it('does not relabel the billed part as estimated in a mixed-cost execution', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'mixed-cost-fixture',
      capabilities: fakeCapabilities,
      create: async () =>
        fakeEnvironment({
          async *stream() {
            yield {
              type: 'llm_call',
              data: {
                tokensIn: 7,
                tokensOut: 11,
                costUsd: 0.03,
                costProvenance: 'billing-receipt',
              },
            }
            yield {
              type: 'llm_call',
              data: { tokensIn: 5, tokensOut: 9, costUsd: 0.02, costProvenance: 'uncaptured' },
            }
            yield { type: 'done', data: { finalText: 'result' } }
          },
        }),
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: { name: 'worker' }, harness: null },
      { signal, seams: {} },
    )
    await collect(executor.execute('task', signal) as AsyncIterable<UsageEvent>)
    expect(executor.resultArtifact().spent).toMatchObject({ usdKnown: false })
    expect(executor.resultArtifact().spent.usd).toBeCloseTo(0.05)
    expect(executor.resultArtifact().spent.usdEstimated).toBeCloseTo(0.02)
  })

  it.each([
    { data: { tokensIn: 5, tokensOut: 9 }, expectedUsd: 0.03, expectedEstimate: undefined },
    {
      data: {
        tokensIn: 5,
        tokensOut: 9,
        estimatedCostUsd: 0.02,
        costProvenance: 'catalog-estimate',
      },
      expectedUsd: 0.05,
      expectedEstimate: 0.02,
    },
  ])(
    'preserves incomplete dollars when a later call has no billing receipt ($expectedUsd)',
    async ({ data, expectedUsd, expectedEstimate }) => {
      const provider: AgentEnvironmentProvider = {
        name: 'partially-priced-fixture',
        capabilities: fakeCapabilities,
        create: async () =>
          fakeEnvironment({
            async *stream() {
              yield {
                type: 'llm_call',
                data: {
                  tokensIn: 7,
                  tokensOut: 11,
                  costUsd: 0.03,
                  costProvenance: 'billing-receipt',
                },
              }
              yield { type: 'llm_call', data }
              yield { type: 'done', data: { finalText: 'result' } }
            },
          }),
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile: { name: 'worker' }, harness: null },
        { signal, seams: {} },
      )
      const events = await collect(executor.execute('task', signal) as AsyncIterable<UsageEvent>)
      expect(events.some((event) => event.kind === 'cost' && event.usdKnown === false)).toBe(true)
      const spent = executor.resultArtifact().spent
      expect(spent.usdKnown).toBe(false)
      expect(spent.usd).toBeCloseTo(expectedUsd)
      expect(spent.usdEstimated).toBe(expectedEstimate)
    },
  )

  it('prices unreceipted provider work from the catalog instead of settling a bare zero', async () => {
    const executor = unreceiptedProviderExecutor('glm-5.3')
    const events = await collect(
      executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    const expected = estimateCost(200_000, 20_000, 'glm-5.3')
    expect(expected).toBeGreaterThan(0)
    expect(events).toContainEqual({
      kind: 'cost',
      usd: expected,
      usdKnown: false,
      usdEstimated: expected,
      provenance: 'catalog-estimate',
    })
    const spent = executor.resultArtifact().spent
    // A price is not a receipt, so the whole amount stays subtractable and no dollar is proven.
    expect(spent.usdKnown).toBe(false)
    expect(spent.usd).toBeCloseTo(expected)
    expect(spent.usd - (spent.usdEstimated ?? 0)).toBe(0)
  })

  it('settles a model the catalog cannot price with no estimate at all', async () => {
    const executor = unreceiptedProviderExecutor('model-with-no-catalog-entry')
    const events = await collect(
      executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )
    expect(events).toContainEqual({
      kind: 'cost',
      usd: 0,
      usdKnown: false,
      provenance: 'uncaptured',
    })
    const spent = executor.resultArtifact().spent
    expect(spent.usd).toBe(0)
    expect(spent.usdKnown).toBe(false)
    // Absence, not a zero estimate: nothing was priced, rather than priced at nothing.
    expect(spent.usdEstimated).toBeUndefined()
  })

  it('does not price an execution that already put billed dollars on the channel', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'partly-billed-fixture',
      capabilities: fakeCapabilities,
      create: async () =>
        fakeEnvironment({
          async *stream() {
            yield {
              type: 'llm_call',
              data: {
                tokensIn: 100_000,
                tokensOut: 10_000,
                costUsd: 0.03,
                costProvenance: 'billing-receipt',
              },
            }
            yield { type: 'llm_call', data: { tokensIn: 100_000, tokensOut: 10_000 } }
            yield { type: 'done', data: { finalText: 'result' } }
          },
        }),
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: { name: 'worker', model: { default: 'glm-5.3' } }, harness: null },
      { signal, seams: {} },
    )
    await collect(executor.execute('task', signal) as AsyncIterable<UsageEvent>)
    const spent = executor.resultArtifact().spent
    // The token total is the whole execution's, not the unbilled remainder, so pricing it here
    // would charge the first call's 100k prompt tokens a second time.
    expect(spent.usd).toBeCloseTo(0.03)
    expect(spent.usdEstimated).toBeUndefined()
    expect(spent.usdKnown).toBe(false)
  })

  it('joins two independently refined provider snapshots without replacing the other worker', async () => {
    const done: AgentEnvironmentEvent = {
      type: 'done',
      data: {},
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadInputTokens: 60,
        cacheCreationInputTokens: 20,
      },
    }
    const { terminals, budget } = await settleProviderEvents(
      [{ type: 'llm_call', data: { tokensIn: 80, tokensOut: 8 } }, done, done],
      2,
      50,
    )
    expect(terminals).toHaveLength(2)
    for (const terminal of terminals) {
      expect(terminal.spent.tokens).toEqual({
        input: 100,
        output: 10,
        freshInput: 20,
        cacheRead: 60,
        cacheWrite: 20,
      })
    }
    expect(budget.tokensLeft).toBe(0)
    expect(budget.cacheBreakdownKnown).toBe(true)
  })

  it('does not promote a platform model binding into upstream served-model evidence', async () => {
    const { terminal } = await settleProviderEvents([
      {
        type: 'execution.started',
        data: { effectiveBackend: { provider: 'fixture', model: 'fixture/model@revision-1' } },
      },
      {
        type: 'done',
        data: { effectiveBackend: { provider: 'fixture', model: 'fixture/model@revision-1' } },
      },
    ])
    expect(terminal).toMatchObject({
      status: 'done',
    })
    expect(terminal?.providerModel).toBeUndefined()
  })

  it('keeps model identity unknown without a platform receipt', async () => {
    const { terminal } = await settleProviderEvents([
      { type: 'done', data: { model: 'fixture/model', finalText: 'fixture/model' } },
    ])
    expect(terminal).toMatchObject({
      status: 'done',
    })
    expect(terminal?.providerModel).toBeUndefined()
  })

  it.each([80, 100])(
    'refines cache classes after crediting %i unclassified input tokens',
    async (input) => {
      const { terminal } = await settleProviderEvents([
        { type: 'llm_call', data: { tokensIn: input, tokensOut: 10 } },
        {
          type: 'done',
          data: {},
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cacheReadInputTokens: 60,
            cacheCreationInputTokens: 20,
          },
        },
      ])
      expect(terminal?.spent.tokens).toEqual({
        input: 100,
        output: 10,
        freshInput: 20,
        cacheRead: 60,
        cacheWrite: 20,
      })
    },
  )

  it('preserves prompt-cache classes across per-call and repeated cumulative receipts', async () => {
    const first: AgentEnvironmentEvent = {
      id: 'call-1',
      type: 'llm_call',
      data: {
        tokensIn: 40,
        tokensOut: 4,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 5,
      },
    }
    const terminal: AgentEnvironmentEvent = {
      type: 'done',
      data: { finalText: 'complete' },
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadInputTokens: 60,
        cacheCreationInputTokens: 20,
      },
    }
    const provider: AgentEnvironmentProvider = {
      name: 'cache-receipts',
      capabilities: fakeCapabilities,
      create: async () =>
        fakeEnvironment({
          stream: async function* () {
            yield first
            yield first
            yield {
              id: 'call-2',
              type: 'llm_call',
              data: {
                tokensIn: 60,
                tokensOut: 6,
                cacheReadInputTokens: 30,
                cacheCreationInputTokens: 15,
              },
            }
            yield terminal
            yield terminal
          },
        }),
    }
    const signal = new AbortController().signal
    const executor = createExecutor({ backend: 'provider', provider })(
      {
        profile: {
          name: 'cache-receipts',
          harness: 'opencode',
          model: { provider: 'fixture', default: 'fixture/model' },
        },
        harness: null,
      },
      { signal, seams: {} },
    )
    await collect(executor.execute('complete the task', signal) as AsyncIterable<UsageEvent>)
    expect(executor.resultArtifact?.()?.spent?.tokens).toEqual({
      input: 100,
      output: 10,
      freshInput: 20,
      cacheRead: 60,
      cacheWrite: 20,
    })
  })

  it.each([
    { cache: {}, expected: { input: 100, output: 10, cacheBreakdownKnown: false } },
    {
      cache: { cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      expected: { input: 100, output: 10, freshInput: 100, cacheRead: 0, cacheWrite: 0 },
    },
    {
      cache: { cacheReadInputTokens: 60 },
      expected: { input: 100, output: 10, cacheRead: 60, cacheBreakdownKnown: false },
    },
    {
      cache: { cacheReadInputTokens: 101 },
      expected: { input: 100, output: 10, cacheBreakdownKnown: false },
    },
  ])(
    'preserves cache absence, zeroes, and incomplete classifications: $cache',
    async ({ cache, expected }) => {
      const { terminal } = await settleProviderEvents([
        { type: 'done', data: {}, usage: { inputTokens: 100, outputTokens: 10, ...cache } },
      ])
      expect(terminal?.spent.tokens).toEqual(expected)
    },
  )

  it.each([
    { type: 'error', attachedUsage: false, disconnect: false },
    { type: 'done', attachedUsage: false, disconnect: false },
    { type: 'error', attachedUsage: true, disconnect: false },
    { type: 'usage', attachedUsage: true, disconnect: true },
  ])(
    'keeps failed-attempt usage incomplete through $type with attachedUsage=$attachedUsage and disconnect=$disconnect',
    async ({ type, attachedUsage, disconnect }) => {
      const provider: AgentEnvironmentProvider = {
        name: 'failed-attempt-receipt',
        capabilities: () => fakeCapabilities(),
        create: async () =>
          fakeEnvironment({
            stream: async function* () {
              const usage = {
                inputTokens: 49661,
                outputTokens: 1164,
                totalTokens: 50825,
                reasoningTokens: 417,
                cacheReadInputTokens: 29696,
              }
              yield {
                type,
                ...(attachedUsage ? { usage } : {}),
                data: {
                  message: 'attempt failed',
                  finalText: 'retained partial evidence',
                  ...(attachedUsage ? {} : { tokenUsage: usage }),
                  totalCostUsd: 0.02,
                  usageMode: 'cumulative',
                  tokensKnown: false,
                  usdKnown: false,
                },
              }
              if (disconnect) throw new Error('provider stream disconnected')
            },
          }),
      }
      const turn = await collectAgentTurn(
        streamAgentTurn(
          {
            kind: 'executor',
            factory: createExecutor({ backend: 'provider', provider }),
            profile: {
              name: 'failed-attempt-receipt',
              harness: 'opencode',
              model: { provider: 'fixture', default: 'fixture/model' },
            },
          },
          { prompt: 'complete the task' },
        ),
      )
      expect(turn.status).toBe(type === 'done' ? 'completed' : 'failed')
      const final = turn.events.at(-1)
      if (final?.type !== 'final') throw new Error('expected a terminal final event')
      expect(final.metadata).toMatchObject({
        tokenUsage: { input: 49661, output: 1164 },
        tokensKnown: false,
        usdKnown: false,
      })
    },
  )

  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    'settles provider failure=%s with teardown failure=%s through the real supervised child seam',
    async (failed, teardownFailed) => {
      const events: AgentEnvironmentEvent[] = [
        { type: 'start', data: {} },
        { type: 'execution.started', data: {} },
        { type: 'status', data: { status: 'generating_response' } },
        { type: 'text', data: { text: 'partial evidence' } },
        ...(failed
          ? [{ type: 'error', data: { message: 'permission alias refused' } }]
          : [{ type: 'task.failed', data: { error: 'recoverable tool failure' } }]),
        { type: 'done', data: {} },
      ]
      const provider: AgentEnvironmentProvider = {
        name: 'supervised-outcome',
        capabilities: () => fakeCapabilities(),
        create: async () =>
          fakeEnvironment({
            stream: async function* () {
              yield* events
            },
            destroy: async () => {
              if (teardownFailed) throw new Error('release refused')
            },
          }),
      }
      const journal = new InMemorySpawnJournal()
      const blobs = new InMemoryResultBlobStore()
      await journal.beginTree('root', new Date(0).toISOString())
      const scope = createScope({
        parentId: 'root',
        root: 'root',
        journal,
        blobs,
        pool: createBudgetPool({ maxIterations: 2, maxTokens: 100 }, 0),
        executors: createExecutorRegistry(),
        seams: {},
        depth: 0,
        signal: new AbortController().signal,
      })
      const profile: AgentProfile = {
        name: 'outcome-worker',
        harness: 'claude-code',
        model: { provider: 'fixture', default: 'fixture/model' },
      }
      const spawned = scope.spawn(
        Object.assign(
          { name: profile.name!, act: async () => 'unused' },
          {
            executorSpec: { profile, harness: null, executorFactory: providerAsExecutor(provider) },
          },
        ),
        'task',
        { label: 'outcome', budget: { maxIterations: 1, maxTokens: 100 } },
      )
      expect(spawned.ok).toBe(true)
      const settled = await scope.next()
      expect(settled?.kind).toBe(failed ? 'down' : 'done')
      if (failed) expect(settled).toMatchObject({ reason: 'permission alias refused' })
      const terminal = (await journal.loadTree('root'))?.find((event) => event.kind === 'settled')
      expect(terminal).toMatchObject({
        status: failed ? 'down' : 'done',
        spent: {
          iterations: 1,
          tokens: { input: 0, output: 0 },
          tokensKnown: false,
          usdKnown: false,
        },
      })
      if (terminal?.kind !== 'settled' || !terminal.outRef)
        throw new Error('missing terminal evidence')
      const artifact = await blobs.get(terminal.outRef)
      expect(contentAddress(artifact)).toBe(terminal.outRef)
      expect(artifact).toMatchObject({ events })
    },
  )

  it('archives each cumulative part once, at its latest frame, through the real supervised child seam', async () => {
    // A harness streams a text or reasoning part cumulatively: every frame restates the part so far.
    // Archiving every frame retained frames times text, and settlement hashes and stores the archive.
    // 27,144 frames of one pi reasoning part exhausted a 4 GB supervisor heap (agent-runtime#1211).
    const frames = 2_000
    const partUpdate = (
      id: string,
      type: 'text' | 'reasoning',
      text: string,
      delta: string,
    ): AgentEnvironmentEvent => {
      const part = { id, sessionID: 'ses-1', messageID: 'msg-1', type, text }
      return {
        type: 'message.part.updated',
        data: { part, delta },
        normalized: { type: 'message.part.updated', part, delta },
      }
    }
    const toolUpdate = (status: 'pending' | 'completed'): AgentEnvironmentEvent => {
      const input = { command: 'ls' }
      const part = {
        id: 'prt-tool',
        sessionID: 'ses-1',
        messageID: 'msg-1',
        type: 'tool',
        tool: 'bash',
        callID: 'call-1',
        state:
          status === 'pending'
            ? { status, input }
            : {
                status,
                input,
                output: 'ok',
                title: 'ls',
                metadata: {},
                time: { start: 1, end: 2 },
              },
      }
      return {
        type: 'message.part.updated',
        data: { part },
        normalized: { type: 'message.part.updated', part } as AgentEnvironmentEvent['normalized'],
      }
    }
    const started: AgentEnvironmentEvent = { type: 'execution.started', data: {} }
    const pending = toolUpdate('pending')
    const completed = toolUpdate('completed')
    const processing: AgentEnvironmentEvent = { type: 'status', data: { status: 'processing' } }
    const reasoningFrames: AgentEnvironmentEvent[] = []
    let reasoning = ''
    for (let frame = 0; frame < frames; frame += 1) {
      const delta = `step ${frame}. `
      reasoning += delta
      reasoningFrames.push(partUpdate('prt-reasoning', 'reasoning', reasoning, delta))
    }
    // The same part id restated with text that does not extend the part is different content.
    const rewritten = partUpdate('prt-reasoning', 'reasoning', 'revised', 'revised')
    const answer = partUpdate('prt-text', 'text', 'visible answer', ' answer')
    const usage = { inputTokens: 7, outputTokens: 11 }
    const result: AgentEnvironmentEvent = {
      type: 'result',
      data: { finalText: 'visible answer', usage },
      usage,
      usageMode: 'cumulative',
    }
    const done: AgentEnvironmentEvent = { type: 'done', data: {} }
    const streamed = [
      started,
      pending,
      completed,
      ...reasoningFrames.slice(0, frames / 2),
      processing,
      ...reasoningFrames.slice(frames / 2),
      rewritten,
      partUpdate('prt-text', 'text', 'visible', 'visible'),
      answer,
      result,
      done,
    ]
    const provider: AgentEnvironmentProvider = {
      name: 'cumulative-parts',
      capabilities: () => fakeCapabilities(),
      create: async () =>
        fakeEnvironment({
          stream: async function* () {
            yield* streamed
          },
        }),
    }
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    await journal.beginTree('root', new Date(0).toISOString())
    const scope = createScope({
      parentId: 'root',
      root: 'root',
      journal,
      blobs,
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 1_000 }, 0),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
    })
    const profile: AgentProfile = {
      name: 'cumulative-worker',
      harness: 'claude-code',
      model: { provider: 'fixture', default: 'fixture/model' },
    }
    const spawned = scope.spawn(
      Object.assign(
        { name: profile.name!, act: async () => 'unused' },
        {
          executorSpec: { profile, harness: null, executorFactory: providerAsExecutor(provider) },
        },
      ),
      'task',
      { label: 'cumulative', budget: { maxIterations: 1, maxTokens: 1_000 } },
    )
    expect(spawned.ok).toBe(true)
    expect((await scope.next())?.kind).toBe('done')
    const terminal = (await journal.loadTree('root'))?.find((event) => event.kind === 'settled')
    if (terminal?.kind !== 'settled' || !terminal.outRef) {
      throw new Error('missing terminal evidence')
    }
    const artifact = (await blobs.get(terminal.outRef)) as ProviderLeafOut
    expect(contentAddress(artifact)).toBe(terminal.outRef)
    // The answer and the metered usage come from the stream, so leaving frames out changes neither.
    expect(artifact.content).toBe('visible answer')
    expect(terminal.spent.tokens).toMatchObject({ input: 7, output: 11 })
    // Bounded retention: the archived part text is the text the turn produced, not frames times text.
    const archivedPartText = artifact.events.reduce((chars, event) => {
      const normalized = event.normalized
      if (normalized?.type !== 'message.part.updated') return chars
      const part = normalized.part
      return part.type === 'text' || part.type === 'reasoning' ? chars + part.text.length : chars
    }, 0)
    expect(archivedPartText).toBe(reasoning.length + 'revised'.length + 'visible answer'.length)
    expect(artifact.events).toEqual([
      started,
      pending,
      completed,
      processing,
      reasoningFrames.at(-1),
      rewritten,
      answer,
      result,
      done,
    ])
    expect(artifact.supersededPartUpdates).toBe(frames)
  })

  it('adapts a neutral provider to SandboxClient without losing profile/backend/dispatch data', async () => {
    let created: unknown
    let turn: AgentTurnInput | undefined
    let sessionPrompt: AgentTurnInput | undefined
    let cancelled = 0
    const session: AgentSession = {
      id: 'provider-session',
      async status() {
        return 'running'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {
        yield { type: 'result', data: { finalText: 'detached result' } }
      },
      async result() {
        return {
          text: 'detached result',
          success: true,
          usage: { inputTokens: 3, outputTokens: 5, cost: 0.02 },
        }
      },
      async prompt(input) {
        sessionPrompt = input
        return { text: 'continued', success: true }
      },
      async cancel() {
        cancelled += 1
      },
    }
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          dispatch: async () => ({
            id: 'provider-session',
            provider: 'fake-provider',
            metadata: { status: 'running', alreadyExisted: true },
          }),
          session(id) {
            if (id !== session.id) throw new Error(`unexpected session ${id}`)
            return session
          },
          stream: async function* (input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
            turn = input
            yield {
              type: 'result',
              data: { finalText: `ok:${input.prompt}` },
              usage: {
                inputTokens: 2,
                outputTokens: 3,
                totalTokens: 7,
                cacheReadInputTokens: 4,
                cacheCreationInputTokens: 1,
                reasoningTokens: 2,
                cost: 0.01,
              },
            }
          },
        })
      },
    }

    const client = providerAsSandboxClient(provider)
    const box = await client.create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
      environment: 'universal',
      git: { url: 'https://example.com/repo.git', ref: 'main' },
      cwd: './packages//runtime/',
      env: { A: '1' },
      name: 'box-name',
      idempotencyKey: 'create-1',
    })
    const events = await collect(box.streamPrompt('hello', { sessionId: 's1', turnId: 't1' }))
    const dispatched = await box.dispatchPrompt?.('detached')

    expect(created).toMatchObject({
      profile: { name: 'worker' },
      backend: 'codex',
      workspace: {
        environment: 'universal',
        repoUrl: 'https://example.com/repo.git',
        gitRef: 'main',
        cwd: { base: 'repository', path: 'packages/runtime' },
      },
      env: { A: '1' },
      name: 'box-name',
      idempotencyKey: 'create-1',
    })
    expect(turn).toMatchObject({ prompt: 'hello', sessionId: 's1', turnId: 't1' })
    expect(dispatched).toMatchObject({
      sessionId: 'provider-session',
      status: 'running',
      alreadyExisted: true,
    })
    const resumed = box.session('provider-session')
    await expect(resumed.status()).resolves.toMatchObject({
      id: 'provider-session',
      status: 'running',
    })
    expect(await collect(resumed.events())).toMatchObject([
      { type: 'result', data: { finalText: 'detached result' } },
    ])
    await expect(resumed.result()).resolves.toMatchObject({
      response: 'detached result',
      success: true,
      status: 'success',
    })
    await resumed.prompt('continue')
    expect(sessionPrompt).toMatchObject({ prompt: 'continue' })
    await resumed.interrupt()
    expect(cancelled).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'result',
      data: {
        finalText: 'ok:hello',
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 7,
          cacheReadInputTokens: 4,
          cacheCreationInputTokens: 1,
          reasoningTokens: 2,
          totalCostUsd: 0.01,
        },
      },
    })
    await expect(
      client.create({
        backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
        cwd: '/workspace/repo',
      }),
    ).rejects.toThrow('Workspace cwd must be relative')
  })

  it('preserves Sandbox 0.34 all-secret selection through the neutral adapter', async () => {
    let created: unknown
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
        })
      },
    }

    await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
      secrets: 'all',
    })

    expect(created).toMatchObject({
      providerOptions: { sandboxCreateOptions: { secrets: 'all' } },
    })
    expect(created).not.toHaveProperty('secrets')
  })

  it('round-trips exact dispatch identity through both adapter directions', async () => {
    const controlRef: AgentExactRunControlRef = {
      runId: 'round-trip-run',
      provider: 'fake-provider',
      environmentId: 'environment-1',
      sessionId: 'round-trip-session',
      executionId: 'round-trip-execution',
      requestDigest: `sha256:${'d'.repeat(64)}` as `sha256:${string}`,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events(): AsyncIterable<AgentEnvironmentEvent> {},
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider: AgentEnvironmentProvider = {
      name: controlRef.provider,
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          dispatch: async () => ({
            id: controlRef.sessionId,
            provider: controlRef.provider,
            controlRef,
            metadata: {
              status: 'running',
              executionId: controlRef.executionId,
              dispatched: true,
            },
          }),
          session: () => session,
          stream: async function* () {},
        })
      },
    }
    const box = await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })
    await expect(box.dispatchPrompt?.('detached')).resolves.toMatchObject({
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
      runControlRef: controlRef,
      dispatched: true,
    })
  })

  it('fails closed when a neutral session only reports stopped', async () => {
    const session: AgentSession = {
      id: 'stopped-session',
      status: async () => 'stopped',
      events: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
      result: async () => ({ text: '', success: false }),
      prompt: async () => ({ text: '', success: false }),
      cancel: async () => {},
    }
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          session: () => session,
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
        })
      },
    }
    const box = await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })

    await expect(box.session('stopped-session').status()).resolves.toEqual({
      id: 'stopped-session',
      status: 'failed',
    })
  })

  it('rejects provider prompt streams that end without a terminal event', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'partial' } }
          },
        })
      },
    }
    const client = providerAsSandboxClient(provider)
    const box = await client.create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })

    await expect(box.prompt('hello')).rejects.toThrow(/terminal result/)
  })

  it.each([
    ['error', false],
    ['done', false],
    ['result', false],
    ['done', true],
    ['result', true],
  ] as const)('preserves %s prompt success=%s', async (type, success) => {
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'partial' } }
            yield {
              type,
              data: {
                status: success ? 'success' : 'failed',
                ...(success ? {} : { error: 'provider execution failed' }),
              },
            }
          },
        })
      },
    }
    const box = await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })

    const result = await box.prompt('hello')
    expect(result).toMatchObject({
      success,
      status: success ? 'success' : 'failed',
    })
    expect(result.error).toBe(success ? undefined : 'provider execution failed')
  })

  it('destroys an environment that cannot satisfy a required session', async () => {
    let destroyed = 0
    const provider: AgentEnvironmentProvider = {
      name: 'stream-only-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
          async destroy() {
            destroyed += 1
          },
        })
      },
    }

    await expect(
      providerAsSandboxClient(provider, { requireSession: true }).create({
        backend: { type: 'pi', profile: { name: 'worker' } },
      }),
    ).rejects.toThrow(/session\(\) is required/)
    expect(destroyed).toBe(1)
  })

  it('rejects providers that cannot support live continuation before creating an environment', async () => {
    for (const disabled of ['continuation', 'live-streaming'] as const) {
      const capabilities = fakeCapabilities()
      if (disabled === 'continuation') capabilities.sessions.continue = false
      else capabilities.streaming.live = false
      let createCalls = 0
      const provider: AgentEnvironmentProvider = {
        name: `no-${disabled}`,
        capabilities: () => capabilities,
        async create() {
          createCalls += 1
          return fakeEnvironment({
            session: () => ({
              id: 'session',
              status: async () => 'running',
              events: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
              result: async () => ({ text: '', success: true }),
              prompt: async () => ({ text: '', success: true }),
              cancel: async () => {},
            }),
            stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
          })
        },
      }

      await expect(
        providerAsSandboxClient(provider, { requireSession: true }).create({
          backend: { type: 'pi', profile: { name: 'worker' } },
        }),
      ).rejects.toThrow(/live session continuation is required/)
      expect(createCalls).toBe(0)
    }
  })

  it.each([
    [
      'continuation',
      (capabilities: ReturnType<typeof fakeCapabilities>) => {
        capabilities.sessions.continue = false
      },
    ],
    [
      'live streaming',
      (capabilities: ReturnType<typeof fakeCapabilities>) => {
        capabilities.streaming.live = false
      },
    ],
  ])(
    'rejects a steerable provider executor without %s before creating an environment',
    async (_label, disable) => {
      const capabilities = fakeCapabilities()
      disable(capabilities)
      let createCalls = 0
      const provider: AgentEnvironmentProvider = {
        name: 'missing-live-capability',
        capabilities: () => capabilities,
        async create() {
          createCalls += 1
          throw new Error('must not create')
        },
      }
      const factory = createExecutor({
        backend: 'provider',
        provider,
        steering: {
          maxTurns: 1,
          activityWindow: 4,
          turnTimeoutMs: 10_000,
        },
      })
      const spec: AgentSpec = {
        profile: {
          name: 'pi-worker',
          harness: 'pi',
          model: { provider: 'offline', default: 'offline-test-model' },
        },
        harness: null,
      }
      const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
      const executor = factory(spec, ctx)

      await expect(
        collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>),
      ).rejects.toThrow(/live session continuation is required/)
      expect(createCalls).toBe(0)
    },
  )

  it('adapts a provider to an ExecutorFactory and reports real usage', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'hello ' } }
            yield {
              type: 'result',
              data: { finalText: 'hello world' },
              usage: { inputTokens: 7, outputTokens: 11, reasoningTokens: 5, cost: 0.03 },
            }
          },
        })
      },
    }
    const factory = providerAsExecutor(provider)
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    const usage = await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)
    const artifact = executor.resultArtifact()

    expect(usage).toEqual([
      { kind: 'tokens', mode: 'cumulative', input: 7, output: 11, cacheBreakdownKnown: false },
      // A provider event's dollar figure carries no receipt, so it is a price rather than a
      // charge: the whole amount rides `usdEstimated` and a dollar cap is not enforced against it.
      { kind: 'cost', usd: 0.03, usdKnown: false, usdEstimated: 0.03, provenance: 'uncaptured' },
      { kind: 'iteration' },
    ])
    expect(artifact.out).toMatchObject({ content: 'hello world' })
    expect(artifact.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 7, output: 11 },
      usd: 0.03,
      usdKnown: false,
      // `usd - usdEstimated` is what names billed money, so the settlement reports none.
      usdEstimated: 0.03,
    })
  })

  // #1244. The capture PR (#1243) reads the transcript just before the settled result is built,
  // so a child whose stream throws never reaches it and its reasoning dies with the box. Measured
  // 2026-09-15: 45 children in one evening executed, reasoned, and settled `down` with nothing.
  it('keeps a dropped child transcript that has no result artifact to ride in', async () => {
    const transcript = '{"role":"assistant","text":"I proved the corner case"}'
    const provider: AgentEnvironmentProvider = {
      name: 'dropping-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          exec: async () => ({
            stdout: '/root/.claude/projects/a/session.jsonl',
            stderr: '',
            exitCode: 0,
          }),
          read: async () => transcript,
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'working' } }
            // A platform 502 mid-stream: the exact shape that dropped 38 of 68 children on
            // capability-per-parameter-cpp-glm-20260915c.
            throw new Error('Platform key verification unavailable')
          },
        }) as AgentEnvironment
      },
    }
    const spec: AgentSpec = {
      profile: { name: 'worker', harness: 'claude-code' } as AgentProfile,
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = providerAsExecutor(provider)(spec, ctx)

    await expect(
      collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/Platform key verification unavailable/u)

    // The executor threw and produced NO artifact, yet the reasoning survived.
    const evidence = executor.harnessTranscript?.()
    expect(evidence?.status).toBe('captured')
    if (evidence?.status !== 'captured') return
    expect(evidence.artifact.files.map((file) => file.content).join('')).toContain(
      'I proved the corner case',
    )
  })

  // The two absences are different facts and an operator acts differently on each: a child that
  // never got a box has nothing to recover, a child that ran for twenty seconds does.
  it('separates a child that never started from one whose transcript went unread', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'refusing-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        throw new Error('budget pool refused unknown dollar cost under maxUsd')
      },
    }
    const spec: AgentSpec = {
      profile: { name: 'worker', harness: 'claude-code' } as AgentProfile,
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = providerAsExecutor(provider)(spec, ctx)

    await expect(
      collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/budget pool refused/u)

    // No environment was ever created (#1240), so this is an absence by construction and must
    // never be reported as a transcript that merely went unread.
    expect(executor.harnessTranscript?.()).toEqual({
      status: 'unavailable',
      reason: 'execution-never-started',
    })
  })

  // End to end, #1244: the drop reaches the journal's settled record as a pointer that resolves.
  it('journals a dropped child with a transcript pointer that resolves in the run blobs', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'dropping-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          exec: async () => ({
            stdout: '/root/.claude/projects/a/session.jsonl',
            stderr: '',
            exitCode: 0,
          }),
          read: async () => '{"role":"assistant","text":"the corner certificate holds"}',
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'working' } }
            throw new Error('sidecar start failed')
          },
        }) as AgentEnvironment
      },
    }
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('root', new Date(0).toISOString())
    const blobs = new InMemoryResultBlobStore()
    const scope = createScope({
      parentId: 'root',
      root: 'root',
      journal,
      blobs,
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 1_000 }, 0),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
    })
    const profile: AgentProfile = {
      name: 'dropper',
      harness: 'claude-code',
      model: { provider: 'fixture', default: 'fixture/model' },
    }
    expect(
      scope.spawn(
        Object.assign(
          { name: 'dropper', act: async () => 'unused' },
          {
            executorSpec: {
              profile,
              harness: null,
              executorFactory: createExecutor({ backend: 'provider', provider }),
            },
          },
        ),
        'task',
        { label: 'dropper', budget: { maxIterations: 1, maxTokens: 1_000 } },
      ).ok,
    ).toBe(true)

    const settled = await scope.next()
    expect(settled).not.toBeNull()
    if (settled === null) return
    expect(settled.kind).toBe('down')
    if (settled.kind !== 'down') return
    // No result artifact, no tool spans — and still the receipt is there and resolves.
    expect(settled.harnessTranscript?.status).toBe('available')
    if (settled.harnessTranscript?.status !== 'available') return
    const artifact = await harnessTranscriptArtifact(settled.harnessTranscript, blobs)
    expect(artifact?.files.map((file) => file.content).join('')).toContain(
      'the corner certificate holds',
    )
    // The durable record carries the same pointer, so replay and Lab read it without the process.
    const record = (await journal.loadTree('root'))?.find(
      (event) => event.kind === 'settled' && event.id === settled.handle.id,
    )
    expect(record).toMatchObject({
      status: 'down',
      harnessTranscript: {
        status: 'available',
        transcriptRef: settled.harnessTranscript.transcriptRef,
      },
    })
    // And replay hands the receipt back: a field the journal holds and replay drops would be the
    // #1214 bug one level down.
    const replayed = await replaySpawnTree(journal, blobs, 'root')
    expect(replayed.find((entry) => entry.handle.id === settled.handle.id)).toMatchObject({
      kind: 'down',
      harnessTranscript: {
        status: 'available',
        transcriptRef: settled.harnessTranscript.transcriptRef,
      },
    })
  })

  it('preserves a canonical provider billing receipt through provider execution', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'billed-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'llm_call',
              data: {
                tokensIn: 7,
                tokensOut: 11,
                costUsd: 0.03,
                costProvenance: 'billing-receipt',
              },
            }
            yield { type: 'done', data: { finalText: 'billed' } }
          },
        })
      },
    }
    const executor = providerAsExecutor(provider)(
      { profile: { name: 'billed-worker' }, harness: null },
      { signal: new AbortController().signal, seams: {} },
    )

    const usage = await collect(
      executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>,
    )

    expect(usage).toContainEqual({
      kind: 'cost',
      usd: 0.03,
      usdKnown: true,
      provenance: 'provider-receipt',
    })
    expect(executor.resultArtifact().spent).toMatchObject({ usd: 0.03, usdKnown: true })
  })

  it('credits a provider terminal usage total once when result and done repeat it', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'repeated-terminal',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          async *stream(): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'result',
              data: { finalText: 'checked' },
              usage: { inputTokens: 2791, outputTokens: 1238 },
            }
            yield { type: 'done', data: {}, usage: { inputTokens: 2791, outputTokens: 1238 } }
          },
        })
      },
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = providerAsExecutor(provider)(
      { profile: { name: 'worker' }, harness: null },
      ctx,
    )
    const events = await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)
    expect(events.filter((event) => event.kind === 'tokens')).toEqual([
      { kind: 'tokens', mode: 'cumulative', input: 2791, output: 1238, cacheBreakdownKnown: false },
    ])
    expect(executor.resultArtifact().spent).toMatchObject({ tokens: { input: 2791, output: 1238 } })
  })

  it('composes a profile-only supervisor spec through one steerable CLI-bridge-like Pi session', async () => {
    const firstTurnStreaming = deferred()
    const finishFirstTurn = deferred()
    const secondTurnStreaming = deferred()
    const secondTurnCancelled = deferred()
    const turns: AgentTurnInput[] = []
    let created: Parameters<AgentEnvironmentProvider['create']>[0] | undefined
    let cancellations = 0
    let destroyed = 0
    const session: AgentSession = {
      id: 'provider-session',
      async status() {
        return 'running'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {},
      async result() {
        return { text: '', success: true }
      },
      async prompt() {
        return { text: '', success: true }
      },
      async cancel() {
        cancellations += 1
        secondTurnCancelled.resolve()
        throw new Error('provider reported cancellation after stopping the turn')
      },
    }
    const provider: AgentEnvironmentProvider = {
      name: 'session-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          session(id) {
            if (id !== session.id && id !== turns[0]?.sessionId) {
              throw new Error(`unexpected session ${id}`)
            }
            return session
          },
          async *stream(input): AsyncIterable<AgentEnvironmentEvent> {
            turns.push(input)
            if (turns.length === 1) {
              yield {
                type: 'message.part.updated',
                data: {
                  part: {
                    type: 'tool',
                    tool: 'read',
                    callID: 'call-1',
                    state: {
                      status: 'completed',
                      input: { path: 'src/index.ts' },
                      output: 'source',
                    },
                  },
                },
              }
              firstTurnStreaming.resolve()
              await finishFirstTurn.promise
              yield {
                type: 'result',
                data: { finalText: 'first answer' },
                usage: {
                  inputTokens: 2,
                  outputTokens: 3,
                  reasoningTokens: 2,
                  cacheReadInputTokens: 11,
                  cost: 0.1,
                },
              }
              return
            }
            if (turns.length === 2) {
              secondTurnStreaming.resolve()
              await secondTurnCancelled.promise
              throw new Error('provider-specific interrupted turn')
            }
            yield {
              type: 'usage',
              data: { usageMode: 'delta' },
              usage: {
                inputTokens: 5,
                outputTokens: 7,
                reasoningTokens: 6,
                cacheCreationInputTokens: 2,
                cost: 0.2,
              },
            }
            yield { type: 'result', data: { finalText: 'changed direction' } }
          },
          async destroy() {
            destroyed += 1
          },
        })
      },
    }
    const profile = {
      name: 'full-worker',
      prompt: {
        systemPrompt: 'Lead the investigation.',
        instructions: ['Keep exact evidence.'],
      },
      model: {
        provider: 'zai',
        default: 'zai/glm-5.2',
        reasoningEffort: 'high',
      },
      harness: 'pi',
      permissions: { shell: 'allow' },
      tools: { shell: true, web: true },
      mcp: {
        papers: { transport: 'http', url: 'https://papers.example.test/mcp' },
      },
      subagents: { critic: { prompt: 'Find the strongest counterexample.' } },
      resources: {
        instructions: 'Use the attached protocol.',
        skills: [{ kind: 'inline', name: 'falsify', content: 'Try to disprove the claim.' }],
      },
      hooks: { afterTool: [{ command: './capture-result' }] },
      modes: { adversarial: { prompt: 'Try the opposite mechanism.' } },
      metadata: { lineage: 'materials-v1' },
      extensions: { pi: { autoApprove: true } },
    } as unknown as AgentProfile
    const factory = createExecutor({
      backend: 'provider',
      provider,
      defaults: {
        workspace: { cwd: { base: 'host', path: '/repo' } },
        providerOptions: { region: 'us-west', tenancy: 'team-a' },
      },
      steering: {
        maxTurns: 4,
        activityWindow: 8,
        turnTimeoutMs: 10_000,
      },
    })
    const spec = { profile } as AgentSpec
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    const running = collect(
      executor.execute('investigate', ctx.signal) as AsyncIterable<UsageEvent>,
    )
    await firstTurnStreaming.promise
    expect(executor.progress?.()).toMatchObject({
      turns: 0,
      pendingMessages: 0,
      recentActivity: [
        {
          kind: 'tool',
          label: 'read',
          status: 'ok',
          detail: 'src/index.ts',
        },
      ],
    })
    executor.deliver?.({ steer: 'Test the opposite mechanism.', interrupt: false })
    finishFirstTurn.resolve()
    await secondTurnStreaming.promise
    executor.deliver?.({ steer: 'Stop and change direction.', interrupt: true })
    const events = await running
    // Accounting and observed output ride the same channel; this assertion owns the accounting
    // half, and the live tool activity is asserted below.
    const usage = events.filter((event) => event.kind !== 'progress')

    expect(executor.runtime).toBe('session-provider')
    expect(created?.profile).toStrictEqual(profile)
    expect(created?.profile).not.toBe(profile)
    expect(Object.isFrozen(created?.profile)).toBe(true)
    expect(typeof created?.profile).toBe('object')
    if (typeof created?.profile !== 'object' || created.profile === null) {
      throw new Error('expected the exact AgentProfile snapshot')
    }
    expect(Object.isFrozen(created.profile.model)).toBe(true)
    expect(created).toMatchObject({
      backend: 'pi',
      workspace: { cwd: { base: 'host', path: '/repo' } },
      signal: ctx.signal,
      providerOptions: {
        region: 'us-west',
        tenancy: 'team-a',
        sandboxCreateOptions: { backend: { type: 'pi' } },
      },
    })
    expect(usage).toEqual([
      // Turn 1 claims 11 cache-read tokens against a 2-token prompt total. A class set that does
      // not fit inside the total it says it partitions buys no credit, so nothing is classified
      // and the split is declared unknown.
      { kind: 'tokens', input: 2, output: 3, cacheBreakdownKnown: false },
      { kind: 'cost', usd: 0.1, usdKnown: false, usdEstimated: 0.1, provenance: 'uncaptured' },
      { kind: 'iteration' },
      // Turn 3 reports a cache WRITE and no read. The measured write is carried; the rest of the
      // prompt stays unclassified, so the split is incomplete rather than completed with a zero.
      { kind: 'tokens', input: 5, output: 7, cacheWrite: 2, cacheBreakdownKnown: false },
      { kind: 'cost', usd: 0.2, usdKnown: false, usdEstimated: 0.2, provenance: 'uncaptured' },
      { kind: 'iteration' },
      // The settlement's own dollar channel: no turn priced anything further, so there is nothing
      // to name on the estimate channel and a zero here stays unknown rather than estimated.
      { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' },
    ])
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({ prompt: 'investigate' })
    expect(turns[1]?.prompt).toContain('Test the opposite mechanism.')
    expect(turns[2]?.prompt).toContain('Stop and change direction.')
    expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(1)
    expect(turns[0]?.sessionId).toBeTruthy()
    expect(cancellations).toBe(1)
    expect(destroyed).toBe(1)
    await expect(executor.traceSource?.()?.collect()).resolves.toMatchObject([
      { toolName: 'read', args: { path: 'src/index.ts' }, status: 'ok' },
    ])
    // The live projection publishes the call and its result while the turn streams, so a client
    // renders box activity without re-parsing the harness output.
    expect(events.filter((event) => event.kind === 'progress')).toEqual([
      {
        kind: 'progress',
        progress: {
          kind: 'tool_call',
          toolName: 'read',
          toolCallId: 'call-1',
          args: { path: 'src/index.ts' },
        },
      },
      {
        kind: 'progress',
        progress: {
          kind: 'tool_result',
          toolName: 'read',
          toolCallId: 'call-1',
          result: 'source',
        },
      },
    ])
    const artifact = executor.resultArtifact()
    expect(artifact).toMatchObject({
      out: {
        content: 'changed direction',
        turns: 2,
        toolCalls: [{ id: 'call-1', name: 'read', arguments: { path: 'src/index.ts' } }],
      },
      spent: {
        iterations: 2,
        tokens: { input: 7, output: 10 },
      },
    })
    expect(artifact.spent.usd).toBeCloseTo(0.3)
  })

  it('uses the exact profile harness while normalizing provider events', async () => {
    let created: Parameters<AgentEnvironmentProvider['create']>[0] | undefined
    const provider: AgentEnvironmentProvider = {
      name: 'native-default-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          session: (id) => ({
            id,
            status: async () => 'running',
            events: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
            result: async () => ({ text: '', success: true }),
            prompt: async () => ({ text: '', success: true }),
            cancel: async () => {},
          }),
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'vendor.tool.finished',
              data: { opaque: true },
              normalized: {
                type: 'message.part.updated',
                part: {
                  id: 'tool-part',
                  sessionID: 'session',
                  messageID: 'message',
                  type: 'tool',
                  tool: 'read',
                  callID: 'normalized-call',
                  state: {
                    status: 'completed',
                    input: { path: 'README.md' },
                    output: 'source',
                  },
                },
              },
            }
            yield {
              type: 'vendor.text.delta',
              data: { opaque: true },
              normalized: {
                type: 'message.part.updated',
                part: {
                  id: 'text-part',
                  sessionID: 'session',
                  messageID: 'message',
                  type: 'text',
                  text: 'provider default',
                },
                delta: 'provider default',
              },
            }
            yield {
              type: 'vendor.turn.finished',
              data: { opaque: true, usageMode: 'cumulative' },
              usage: { inputTokens: 2, outputTokens: 3, cost: 0 },
              normalized: { type: 'status', status: 'completed' },
            }
          },
        })
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      steering: {
        maxTurns: 1,
        activityWindow: 4,
        turnTimeoutMs: 10_000,
      },
    })
    const spec: AgentSpec = {
      profile: {
        name: 'normalized-worker',
        harness: 'pi',
        model: { provider: 'offline', default: 'offline-test-model' },
      },
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(created).toMatchObject({
      backend: 'pi',
      profile: spec.profile,
      providerOptions: { sandboxCreateOptions: { backend: { type: 'pi' } } },
    })
    expect(executor.progress?.()).toMatchObject({
      recentActivity: [
        {
          at: expect.any(Number),
          kind: 'tool',
          label: 'read',
          status: 'ok',
          detail: 'README.md',
        },
        {
          at: expect.any(Number),
          kind: 'turn',
          label: 'turn 0',
        },
      ],
    })
    await expect(executor.traceSource?.()?.collect()).resolves.toMatchObject([
      { toolName: 'read', args: { path: 'README.md' }, status: 'ok' },
    ])
    expect(executor.resultArtifact().out).toMatchObject({
      content: 'provider default',
      toolCalls: [{ id: 'normalized-call', name: 'read', arguments: { path: 'README.md' } }],
    })
  })

  it('streams a provider executor through streamAgentTurn with known materialization', async () => {
    // The issue's reproduction: `createExecutor({ backend: 'provider' })` used to reach
    // `streamAgentTurn` with no Runtime materialization, so an exact turn ended before
    // `provider.create` with `materialization.reason = "executor-did-not-report"`.
    let created = 0
    const provider: AgentEnvironmentProvider = {
      name: 'fixture',
      capabilities: () => fakeCapabilities(),
      async create() {
        created += 1
        return fakeEnvironment({
          id: 'env-42',
          provider: 'fixture',
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { part: { type: 'text' }, delta: 'hi' } }
            yield {
              type: 'done',
              data: { finalText: 'hi', tokenUsage: { inputTokens: 3, outputTokens: 1 } },
            }
          },
        })
      },
    }
    const profile: AgentProfile = {
      name: 'provider-exact-turn',
      harness: 'pi',
      model: { provider: 'fixture', default: 'fixture/model' },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory: createExecutor({ backend: 'provider', provider }), profile },
        { prompt: 'hello' },
      ),
    )

    expect(created).toBe(1)
    expect(turn.status).toBe('completed')
    expect(turn.finalText).toBe('hi')
    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    expect(final.metadata).toMatchObject({ tokenUsage: { input: 3, output: 1 }, usdKnown: false })
    expect(final.metadata?.tokensKnown).toBeUndefined()
    expect(final.metadata?.sandboxOutcome).toBeUndefined()
    expect(final.metadata?.materialization).toMatchObject({ status: 'known' })
    expect(
      (final.metadata?.executionBindings as Array<{ status?: string }> | undefined)?.[0],
    ).toMatchObject({ status: 'known' })
  })

  it.each([
    {
      label: 'no usage receipt',
      data: { finalText: 'unmetered' },
      tokens: { input: 0, output: 0 },
    },
    {
      label: 'an input-only usage receipt',
      data: { finalText: 'input only', usage: { inputTokens: 7 } },
      tokens: { input: 7, output: 0 },
    },
    {
      label: 'a cost-only usage receipt',
      data: { finalText: 'cost only', totalCostUsd: 0.03 },
      tokens: { input: 0, output: 0 },
    },
  ] satisfies Array<{
    label: string
    data: Record<string, unknown>
    tokens: { input: number; output: number }
  }>)('marks $label as incomplete token accounting', async ({ data, tokens }) => {
    const provider: AgentEnvironmentProvider = {
      name: 'incomplete-token-receipt',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'done', data }
          },
        })
      },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'executor',
          factory: createExecutor({ backend: 'provider', provider }),
          profile: {
            name: 'incomplete-token-receipt',
            harness: 'claude-code',
            model: { provider: 'fixture', default: 'fixture/model' },
          },
        },
        { prompt: 'complete the task' },
      ),
    )

    expect(turn.status).toBe('completed')
    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    expect(final.metadata).toMatchObject({
      tokenUsage: tokens,
      tokensKnown: false,
      usdKnown: false,
    })
  })

  it('keeps aggregate token accounting unknown after an incomplete receipt', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'mixed-token-receipts',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'usage', data: { usage: { inputTokens: 7 } } }
            yield {
              type: 'done',
              data: {
                finalText: 'partly metered',
                tokenUsage: { inputTokens: 3, outputTokens: 2 },
              },
            }
          },
        })
      },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'executor',
          factory: createExecutor({ backend: 'provider', provider }),
          profile: {
            name: 'mixed-token-receipts',
            harness: 'claude-code',
            model: { provider: 'fixture', default: 'fixture/model' },
          },
        },
        { prompt: 'complete the task' },
      ),
    )

    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    expect(final.metadata).toMatchObject({
      tokenUsage: { input: 7, output: 2 },
      tokensKnown: false,
    })
  })

  it('keeps token accounting known after a separate cost-only receipt', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'cost-then-complete-token-receipt',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'usage', data: { totalCostUsd: 0.03 } }
            yield {
              type: 'done',
              data: {
                finalText: 'fully metered tokens',
                tokenUsage: { inputTokens: 3, outputTokens: 2 },
              },
            }
          },
        })
      },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'executor',
          factory: createExecutor({ backend: 'provider', provider }),
          profile: {
            name: 'cost-then-complete-token-receipt',
            harness: 'claude-code',
            model: { provider: 'fixture', default: 'fixture/model' },
          },
        },
        { prompt: 'complete the task' },
      ),
    )

    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    expect(final.metadata).toMatchObject({ tokenUsage: { input: 3, output: 2 }, usdKnown: false })
    expect(final.metadata?.tokensKnown).toBeUndefined()
  })

  it('replays a retained provider failure without turning it into a completed worker', async () => {
    // This is the minimal terminal suffix retained from the failed Claude worker:
    // text -> completed -> failed -> error -> done. The earlier lifecycle frames do not affect
    // the terminal outcome, but `done` after `failed` did expose the false-success bug.
    const retainedFailureTail = [
      {
        type: 'message.part.updated',
        data: {
          part: { type: 'text' },
          delta: 'Failed to authenticate. API Error: 403 status code',
        },
        normalized: {
          type: 'message.part.updated',
          part: {
            id: 'failure-text',
            sessionID: 'failure-session',
            messageID: 'failure-message',
            type: 'text',
            text: 'Failed to authenticate. API Error: 403 status code',
          },
          delta: 'Failed to authenticate. API Error: 403 status code',
        },
      },
      {
        type: 'status',
        data: { status: 'completed' },
        normalized: { type: 'status', status: 'completed' },
      },
      {
        type: 'status',
        data: { status: 'failed', detail: 'Process exited with code 1' },
        normalized: { type: 'status', status: 'failed', detail: 'Process exited with code 1' },
      },
      {
        type: 'error',
        data: { error: 'claude-code execution failed: Process exited with code 1' },
      },
      { type: 'done', data: {} },
    ] satisfies AgentEnvironmentEvent[]
    const provider: AgentEnvironmentProvider = {
      name: 'retained-failure',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield* retainedFailureTail
          },
        })
      },
    }
    const profile: AgentProfile = {
      name: 'retained-provider-failure',
      harness: 'claude-code',
      model: { provider: 'fixture', default: 'fixture/model' },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory: createExecutor({ backend: 'provider', provider }), profile },
        { prompt: 'complete the task' },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.finalText).toBe('Failed to authenticate. API Error: 403 status code')
    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    expect(final).toMatchObject({
      status: 'failed',
      error: {
        kind: 'backend',
        message: 'claude-code execution failed: Process exited with code 1',
      },
      metadata: {
        tokenUsage: { input: 0, output: 0 },
        tokensKnown: false,
        usdKnown: false,
        sandboxOutcome: {
          success: false,
          status: 'failed',
          error: 'claude-code execution failed: Process exited with code 1',
        },
        result: {
          output: {
            content: 'Failed to authenticate. API Error: 403 status code',
            events: retainedFailureTail,
          },
          spent: {
            tokensKnown: false,
            usdKnown: false,
          },
        },
      },
    })
  })

  it('preserves reported usage and partial output when a provider then fails', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'partly-metered-failure',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'message.part.updated',
              data: { part: { type: 'text' }, delta: 'partial answer' },
              normalized: {
                type: 'message.part.updated',
                part: {
                  id: 'partial-text',
                  sessionID: 'partial-session',
                  messageID: 'partial-message',
                  type: 'text',
                  text: 'partial answer',
                },
                delta: 'partial answer',
              },
            }
            yield {
              type: 'usage',
              data: { usageMode: 'delta' },
              usage: { inputTokens: 7, outputTokens: 0 },
            }
            yield {
              type: 'usage',
              data: { usageMode: 'delta' },
              usage: { inputTokens: 0, outputTokens: 11, reasoningTokens: 3, cost: 0.03 },
            }
            yield {
              type: 'status',
              data: { status: 'failed', detail: 'provider stopped' },
              normalized: { type: 'status', status: 'failed', detail: 'provider stopped' },
            }
            yield { type: 'error', data: { error: 'provider stopped' } }
            yield { type: 'done', data: {} }
          },
        })
      },
    }
    const profile: AgentProfile = {
      name: 'partly-metered-provider-failure',
      harness: 'claude-code',
      model: { provider: 'fixture', default: 'fixture/model' },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory: createExecutor({ backend: 'provider', provider }), profile },
        { prompt: 'complete the task' },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.finalText).toBe('partial answer')
    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    expect(final).toMatchObject({
      status: 'failed',
      metadata: {
        tokenUsage: { input: 7, output: 11 },
        usdKnown: false,
        result: {
          output: { content: 'partial answer' },
          spent: {
            tokens: { input: 7, output: 11 },
            usd: 0.03,
            usdKnown: false,
          },
        },
      },
    })
    expect(final.metadata?.tokensKnown).toBeUndefined()
  })

  it.each([
    {
      label: 'a raw failed status',
      failure: { type: 'status', data: { status: 'failed', detail: 'raw provider failure' } },
      reason: 'raw provider failure',
    },
    {
      label: 'a normalized failed status',
      failure: {
        type: 'vendor.finished',
        data: {},
        normalized: { type: 'status', status: 'failed', detail: 'normalized provider failure' },
      },
      reason: 'normalized provider failure',
    },
    {
      label: 'a failed result status',
      failure: {
        type: 'result',
        data: { status: 'failed', error: 'result provider failure' },
      },
      reason: 'result provider failure',
    },
    {
      label: 'a failed done result',
      failure: {
        type: 'done',
        data: {
          success: false,
          outcome: { type: 'completed' },
          error: { message: 'terminal provider failure' },
        },
      },
      reason: 'terminal provider failure',
    },
  ] satisfies Array<{ label: string; failure: AgentEnvironmentEvent; reason: string }>)(
    'retains a failed terminal outcome from $label',
    async ({ failure, reason }) => {
      const provider: AgentEnvironmentProvider = {
        name: 'explicit-failure',
        capabilities: () => fakeCapabilities(),
        async create() {
          return fakeEnvironment({
            stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
              yield failure
              yield { type: 'done', data: {} }
            },
          })
        },
      }

      const turn = await collectAgentTurn(
        streamAgentTurn(
          {
            kind: 'executor',
            factory: createExecutor({ backend: 'provider', provider }),
            profile: {
              name: 'explicit-provider-failure',
              harness: 'claude-code',
              model: { provider: 'fixture', default: 'fixture/model' },
            },
          },
          { prompt: 'complete the task' },
        ),
      )

      expect(turn.status).toBe('failed')
      expect(turn.error).toMatchObject({ kind: 'backend', message: reason })
      expect(turn.sandboxOutcome).toMatchObject({ success: false, status: 'failed', error: reason })
    },
  )

  it('keeps a recoverable provider task failure separate from the completed turn', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'recoverable-task-failure',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'task.failed',
              data: {
                taskId: 'tool-subtask',
                backendId: 'tool-backend',
                error: 'the first tool attempt failed',
              },
            }
            yield {
              type: 'done',
              data: {
                finalText: 'recovered answer',
                tokenUsage: { inputTokens: 3, outputTokens: 2 },
              },
            }
          },
        })
      },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'executor',
          factory: createExecutor({ backend: 'provider', provider }),
          profile: {
            name: 'recoverable-task-failure',
            harness: 'claude-code',
            model: { provider: 'fixture', default: 'fixture/model' },
          },
        },
        { prompt: 'complete the task' },
      ),
    )

    expect(turn.status).toBe('completed')
    expect(turn.finalText).toBe('recovered answer')
    expect(turn.sandboxOutcome).toBeUndefined()
  })

  // The transport-error latch. The sandbox tracker settles `failed` on the first `error` frame
  // whatever the terminal frame says, and the runtime used to show it only its failure frames,
  // so a stream break the harness recovered from settled the whole child `down` with the
  // transient error as its reason and its banked artifact discarded (25 children on the
  // 2026-09-20 fleet corpus). The terminal frame decides: an explicit success supersedes an
  // `error` frame on either side of it; a failed status or failed terminal frame is the
  // provider's verdict and stays.
  it.each([
    {
      label: 'an error frame before the terminal success',
      events: [
        { type: 'error', data: { error: 'stream reset by peer', code: 'ECONNRESET' } },
        { type: 'done', data: { success: true, finalText: 'banked answer' } },
      ],
    },
    {
      label: 'an error frame after the terminal success',
      events: [
        { type: 'done', data: { success: true, finalText: 'banked answer' } },
        { type: 'error', data: { error: 'session closed while draining' } },
      ],
    },
    {
      label: 'an error frame before a completed result status',
      events: [
        { type: 'error', data: { error: 'tool backend unavailable' } },
        { type: 'result', data: { status: 'completed', finalText: 'banked answer' } },
        { type: 'done', data: {} },
      ],
    },
    {
      // The form `isTerminalEnvironmentEvent` reads as terminal: a status frame, raw or
      // normalized, with no `done` carrying `success` at all.
      label: 'an error frame before a normalized completed status',
      events: [
        { type: 'error', data: { error: 'stream reset by peer' } },
        {
          type: 'vendor.finished',
          data: { finalText: 'banked answer' },
          normalized: { type: 'status', status: 'completed' },
        },
      ],
    },
    {
      label: 'an error frame before a raw completed status',
      events: [
        { type: 'error', data: { error: 'stream reset by peer' } },
        { type: 'status', data: { status: 'completed', finalText: 'banked answer' } },
      ],
    },
  ] satisfies Array<{ label: string; events: AgentEnvironmentEvent[] }>)(
    'completes the turn when $label reports success',
    async ({ events }) => {
      const provider: AgentEnvironmentProvider = {
        name: 'recovered-transport-error',
        capabilities: () => fakeCapabilities(),
        async create() {
          return fakeEnvironment({
            stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
              yield* events
            },
          })
        },
      }

      const turn = await collectAgentTurn(
        streamAgentTurn(
          {
            kind: 'executor',
            factory: createExecutor({ backend: 'provider', provider }),
            profile: {
              name: 'recovered-transport-error',
              harness: 'claude-code',
              model: { provider: 'fixture', default: 'fixture/model' },
            },
          },
          { prompt: 'complete the task' },
        ),
      )

      expect(turn.status).toBe('completed')
      expect(turn.finalText).toBe('banked answer')
      expect(turn.sandboxOutcome).toBeUndefined()
    },
  )

  it.each([
    {
      label: 'an error frame followed by an empty done',
      events: [
        { type: 'error', data: { error: 'stream reset by peer' } },
        { type: 'done', data: {} },
      ],
      reason: 'stream reset by peer',
    },
    {
      label: 'an error frame followed by a failed terminal',
      events: [
        { type: 'error', data: { error: 'stream reset by peer' } },
        { type: 'done', data: { success: false, error: 'Agent execution failed' } },
      ],
      reason: 'stream reset by peer',
    },
    {
      label: 'a failed status followed by a successful done',
      events: [
        {
          type: 'status',
          data: { status: 'failed', detail: 'Execution exceeded its time limit' },
          normalized: {
            type: 'status',
            status: 'failed',
            detail: 'Execution exceeded its time limit',
          },
        },
        { type: 'done', data: { success: true } },
      ],
      reason: 'Execution exceeded its time limit',
    },
  ] satisfies Array<{ label: string; events: AgentEnvironmentEvent[]; reason: string }>)(
    'still fails the turn on $label',
    async ({ events, reason }) => {
      const provider: AgentEnvironmentProvider = {
        name: 'unrecovered-failure',
        capabilities: () => fakeCapabilities(),
        async create() {
          return fakeEnvironment({
            stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
              yield* events
            },
          })
        },
      }

      const turn = await collectAgentTurn(
        streamAgentTurn(
          {
            kind: 'executor',
            factory: createExecutor({ backend: 'provider', provider }),
            profile: {
              name: 'unrecovered-failure',
              harness: 'claude-code',
              model: { provider: 'fixture', default: 'fixture/model' },
            },
          },
          { prompt: 'complete the task' },
        ),
      )

      expect(turn.status).toBe('failed')
      expect(turn.sandboxOutcome).toMatchObject({ success: false, status: 'failed', error: reason })
    },
  )

  it.each([
    {
      label: 'a nested result failure',
      failure: {
        type: 'done',
        data: {
          result: {
            status: 'failed',
            error: { message: 'nested result failure', code: 'RESULT_FAILURE' },
          },
        },
      },
      reason: 'nested result failure',
      errorCode: 'RESULT_FAILURE',
    },
    {
      label: 'a nested outcome failure',
      failure: {
        type: 'done',
        data: {
          outcome: {
            status: 'failed',
            error: { message: 'nested outcome failure', errorCode: 'OUTCOME_FAILURE' },
          },
        },
      },
      reason: 'nested outcome failure',
      errorCode: 'OUTCOME_FAILURE',
    },
  ] satisfies Array<{
    label: string
    failure: AgentEnvironmentEvent
    reason: string
    errorCode: string
  }>)('preserves the code from $label', async ({ failure, reason, errorCode }) => {
    const provider: AgentEnvironmentProvider = {
      name: 'nested-provider-failure',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield failure
          },
        })
      },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'executor',
          factory: createExecutor({ backend: 'provider', provider }),
          profile: {
            name: 'nested-provider-failure',
            harness: 'claude-code',
            model: { provider: 'fixture', default: 'fixture/model' },
          },
        },
        { prompt: 'complete the task' },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.sandboxOutcome).toMatchObject({
      success: false,
      status: 'failed',
      error: reason,
      errorCode,
    })
  })

  it('publishes a provider-native child task through the executor turn', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'fixture-children',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          id: 'env-children',
          provider: 'fixture-children',
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'child-task',
              data: {},
              normalized: {
                type: 'child-task',
                childId: 'child-1',
                status: 'started',
                sourceEventId: 'evt-1',
                time: { started: 1, updated: 1 },
                runner: 'claude-code',
              },
            }
            yield { type: 'done', data: { finalText: 'delegated', tokenUsage: {} } }
          },
        })
      },
    }
    const profile: AgentProfile = {
      name: 'provider-children',
      harness: 'pi',
      model: { provider: 'fixture-children', default: 'fixture-children/model' },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory: createExecutor({ backend: 'provider', provider }), profile },
        { prompt: 'delegate' },
      ),
    )

    expect(turn.events.filter((event) => event.type === 'child-task')).toMatchObject([
      { childId: 'child-1', status: 'started', sourceEventId: 'evt-1', runner: 'claude-code' },
    ])
  })

  it('reports an unknown receipt when the provider fails before creating the environment', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'fixture-down',
      capabilities: () => fakeCapabilities(),
      async create() {
        throw new Error('provider unavailable')
      },
    }
    const profile: AgentProfile = {
      name: 'provider-exact-turn',
      harness: 'pi',
      model: { provider: 'fixture-down', default: 'fixture-down/model' },
    }

    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory: createExecutor({ backend: 'provider', provider }), profile },
        { prompt: 'hello' },
      ),
    )

    expect(turn.status).toBe('failed')
    expect(turn.error?.message).toContain('provider unavailable')
    const final = turn.events.at(-1)
    if (final?.type !== 'final') throw new Error('expected a terminal final event')
    // A planned declaration never becomes a receipt: the create that would have proved it failed.
    expect(final.metadata?.materialization).toMatchObject({
      status: 'unknown',
      reason: 'executor-failed-before-receipt',
    })
  })

  it('rejects a missing profile harness before probing or creating the provider', () => {
    let capabilityCalls = 0
    let createCalls = 0
    const provider: AgentEnvironmentProvider = {
      name: 'must-not-run',
      capabilities() {
        capabilityCalls += 1
        return fakeCapabilities()
      },
      async create() {
        createCalls += 1
        throw new Error('must not create')
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      steering: {
        maxTurns: 1,
        activityWindow: 4,
        turnTimeoutMs: 10_000,
      },
    })
    const spec: AgentSpec = {
      profile: {
        name: 'missing-harness',
        model: { provider: 'offline', default: 'offline-test-model' },
        metadata: { backendType: 'pi' },
      },
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }

    expect(() => factory(spec, ctx)).toThrow(/AgentProfile\.harness must be explicit/)
    expect({ capabilityCalls, createCalls }).toEqual({ capabilityCalls: 0, createCalls: 0 })
  })

  it.each([
    ['AgentSpec harness', { specHarness: 'codex' as BackendType }],
    ['provider default backend', { defaultBackend: 'codex' }],
  ])('rejects a conflicting %s before provider execution', (_label, conflict) => {
    let capabilityCalls = 0
    let createCalls = 0
    const provider: AgentEnvironmentProvider = {
      name: 'must-not-run-conflict',
      capabilities() {
        capabilityCalls += 1
        return fakeCapabilities()
      },
      async create() {
        createCalls += 1
        throw new Error('must not create')
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      ...('defaultBackend' in conflict ? { defaults: { backend: conflict.defaultBackend } } : {}),
      steering: {
        maxTurns: 1,
        activityWindow: 4,
        turnTimeoutMs: 10_000,
      },
    })
    const spec: AgentSpec = {
      profile: {
        name: 'pi-worker',
        harness: 'pi',
        model: { provider: 'offline', default: 'offline-test-model' },
      },
      harness: 'specHarness' in conflict ? conflict.specHarness : null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }

    expect(() => factory(spec, ctx)).toThrow(/conflicts with AgentProfile\.harness "pi"/)
    expect({ capabilityCalls, createCalls }).toEqual({ capabilityCalls: 0, createCalls: 0 })
  })

  it('plugs a provider into createExecutor as backend data', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'package-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'result', data: { finalText: 'from-package' } }
          },
        })
      },
    }
    const factory = createExecutor({ backend: 'provider', provider })
    const spec: AgentSpec = {
      profile: {
        name: 'worker',
        harness: 'cli-base',
        model: { provider: 'offline', default: 'offline-test-model' },
      },
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(executor.resultArtifact().out).toMatchObject({ content: 'from-package' })
  })

  it('refuses the runtime-selected model marker before provider.create', () => {
    let createdProfile: AgentProfile | string | undefined
    let taskProfile: AgentProfile | undefined
    const provider: AgentEnvironmentProvider = {
      name: 'runtime-model-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        createdProfile = input.profile
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'result', data: { finalText: 'provider-selected-model' } }
          },
        })
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      taskToTurn: (task, profile) => {
        taskProfile = profile
        return { prompt: String(task) }
      },
    })
    const profile: AgentProfile = {
      name: 'runtime-model-worker',
      harness: 'pi',
      model: {
        provider: 'tangle-router',
        default: ` ${HARNESS_NATIVE_MODEL} `,
        reasoningEffort: 'high',
      },
    }
    const spec: AgentSpec = { profile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    expect(() => factory(spec, ctx)).toThrow(/model\.default is runtime-selected/)
    expect(createdProfile).toBeUndefined()
    expect(taskProfile).toBeUndefined()
  })

  it('resolves a named provider through the runtime registry', async () => {
    let created: unknown
    const provider: AgentEnvironmentProvider = {
      name: 'named-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'result', data: { finalText: 'from-named-provider' } }
          },
        })
      },
    }
    const registry = createAgentEnvironmentProviderRegistry([provider])
    const factory = createExecutor({
      backend: 'provider',
      provider: 'named-provider',
      registry,
      defaults: {
        backend: 'codex',
        workspace: { cwd: { base: 'host', path: '/repo' } },
      },
    })
    const spec: AgentSpec = {
      profile: {
        name: 'worker',
        harness: 'codex',
        model: { provider: 'openai', default: 'offline-test-model' },
      },
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(created).toMatchObject({
      profile: spec.profile,
      backend: 'codex',
      workspace: { cwd: { base: 'host', path: '/repo' } },
    })
    expect(executor.resultArtifact().out).toMatchObject({ content: 'from-named-provider' })
    expect(registry.names()).toEqual(['named-provider'])
  })
})

describe('declared provider placements', () => {
  const placements: ProviderPlacement[] = (['opencode', 'codex'] as const).map((harness) => ({
    id: `${harness}-seat`,
    match: { harness, provider: 'fixture', model: 'fixture/model' },
    create: { backend: harness, secrets: [`${harness}-credential`] },
    promptOptions: { backend: { type: harness, model: { apiKeyEnv: `${harness}-credential` } } },
  }))
  const profiles: AgentProfile[] = placements.map(({ match }) => ({
    name: match.harness,
    harness: match.harness,
    model: { provider: 'fixture', default: 'fixture/model' },
  }))

  it('executes two differently placed children in one supervised tree with exact receipts', async () => {
    const creates: import('./environment-provider').CreateAgentEnvironmentInput[] = []
    const turns: AgentTurnInput[] = []
    const provider: AgentEnvironmentProvider = {
      name: 'fixture',
      capabilities: fakeCapabilities,
      async create(input) {
        creates.push(input)
        return fakeEnvironment({
          id: `env-${creates.length}`,
          async *stream(turn) {
            turns.push(turn)
            yield {
              type: 'done',
              data: { finalText: 'ANSWER=42', tokenUsage: { inputTokens: 1, outputTokens: 1 } },
            }
          },
        })
      },
    }
    const journal = new InMemorySpawnJournal()
    let step = 0
    await superviseWithTestBrain(
      {
        name: 'lead',
        tools: {
          agent_runtime_coordination_spawn_worker: true,
          agent_runtime_coordination_await_event: true,
        },
        harness: 'cli-base',
        model: { provider: 'fixture', default: 'fixture/model' },
      },
      'execute both profiles',
      {
        backend: { backend: 'provider', provider, placements },
        journal,
        runId: 'placements',
        budget: { maxIterations: 20, maxTokens: 10000 },
        perWorker: { maxIterations: 1, maxTokens: 100 },
        brain: async () => {
          const turn = step++
          if (turn < 2)
            return {
              content: 'spawn',
              toolCalls: [
                {
                  id: `s${turn}`,
                  name: 'spawn_worker',
                  arguments: JSON.stringify({
                    profile: profiles[turn],
                    task: 'emit answer',
                    label: `worker-${turn}`,
                  }),
                },
              ],
            }
          if (turn < 4)
            return {
              content: 'await',
              toolCalls: [{ id: `a${turn}`, name: 'await_event', arguments: '{}' }],
            }
          return { content: 'done', toolCalls: [] }
        },
      },
    )
    expect(creates).toHaveLength(2)
    expect(turns).toHaveLength(2)
    for (const [index, create] of creates.entries()) {
      const placement = placements.find((item) => item.create.backend === create.backend)!
      expect(create.secrets).toEqual(placement.create.secrets)
      expect(turns[index]?.providerOptions?.backend).toEqual(placement.promptOptions?.backend)
      expect(create.profile).toEqual(profiles.find((profile) => profile.harness === create.backend))
      expect(create.metadata?.runtimeProviderPlacement).toMatchObject({
        id: placement.id,
        digest: expect.stringMatching(/^sha256:/),
      })
    }
    const events = await journal.loadTree('placements')
    const materialized = events?.filter(
      (event) => event.kind === 'materialized' && event.id !== 'placements',
    )
    expect(materialized).toHaveLength(2)
    const serialized = JSON.stringify(materialized)
    for (const profile of profiles)
      expect(serialized).toContain(canonicalAgentProfileDigest(profile))
    for (const placement of placements)
      expect(JSON.stringify(events?.filter((event) => event.kind === 'execution-bound'))).toContain(
        placement.id,
      )
    expect(serialized).not.toContain('apiKeyEnv')
  })

  it('refuses unmatched, ambiguous, mismatched and mutable declarations before create', () => {
    let creates = 0
    const provider: AgentEnvironmentProvider = {
      name: 'fixture',
      capabilities: fakeCapabilities,
      async create() {
        creates++
        throw new Error('must not create')
      },
    }
    const profile = profiles[0]!
    const ctx = { signal: new AbortController().signal, seams: {} }
    const factory = createExecutor({ backend: 'provider', provider, placements })
    expect(() =>
      factory({ profile: { ...profile, harness: 'claude-code' }, harness: null }, ctx),
    ).toThrow(/found 0/)
    expect(() =>
      createExecutor({
        backend: 'provider',
        provider,
        placements: [placements[0]!, { ...placements[0]!, id: 'other' }],
      })({ profile, harness: null }, ctx),
    ).toThrow(/found 2/)
    expect(() =>
      createExecutor({
        backend: 'provider',
        provider,
        placements: [{ ...placements[0]!, create: { backend: 'codex' } }],
      })({ profile, harness: null }, ctx),
    ).toThrow(/must match/)
    const mutable = structuredClone(placements)
    const captured = providerAsExecutor(provider, { placements: mutable })
    mutable[0]!.create.backend = 'claude-code'
    expect(() => captured({ profile, harness: null }, ctx)).not.toThrow()
    expect(creates).toBe(0)
  })

  it('binds placement identity and public settings across recovery while retaining runtime attachments', () => {
    const common = {
      env: { RUNTIME_TOKEN: 'private-runtime-token' },
      runtimeAttachments: {
        mcp: {
          coordination: {
            transport: 'http' as const,
            url: 'https://runtime.example/mcp',
            headers: {
              Authorization: {
                kind: 'secret-ref' as const,
                key: 'RUNTIME_TOKEN',
                format: 'bearer' as const,
              },
            },
          },
        },
      },
    }
    const selected = selectProviderPlacement(profiles[0]!, { placements, defaults: common })
    expect(selected.options.defaults?.runtimeAttachments).toEqual(common.runtimeAttachments)
    expect(selected.options.defaults?.env).toEqual(common.env)
    const material = retainedCreateMaterial({ ...selected.options.defaults, profile: profiles[0]! })
    expect(material).toMatchObject({ placement: selected.identity })
    const changed = structuredClone(placements)
    changed[0]!.create.resources = { cpu: 4 }
    const other = selectProviderPlacement(profiles[0]!, { placements: changed })
    expect(other.identity?.digest).not.toBe(selected.identity?.digest)
    expect(JSON.stringify(material)).not.toContain('private-runtime-token')
    expect(() =>
      selectProviderPlacement(profiles[0]!, { placements, defaults: { secrets: ['other-seat'] } }),
    ).toThrow(/each placement/)
  })

  it('captures the exact profile before a caller or create hook can change its harness', async () => {
    const creates: import('./environment-provider').CreateAgentEnvironmentInput[] = []
    const provider: AgentEnvironmentProvider = {
      name: 'fixture',
      capabilities: fakeCapabilities,
      async create(input) {
        creates.push(input)
        return fakeEnvironment({
          async *stream() {
            yield {
              type: 'done',
              data: { finalText: 'ok', tokenUsage: { inputTokens: 1, outputTokens: 1 } },
            }
          },
        })
      },
    }
    const profile = structuredClone(profiles[0]!)
    const ctx = { signal: new AbortController().signal, seams: {} }
    const executor = providerAsExecutor(provider, { placements })({ profile, harness: null }, ctx)
    profile.harness = 'codex'
    await collect(executor.execute('run', ctx.signal) as AsyncIterable<UsageEvent>)
    expect(creates[0]).toMatchObject({
      backend: 'opencode',
      profile: { harness: 'opencode' },
      secrets: ['opencode-credential'],
    })
    expect(() =>
      providerAsExecutor(provider, {
        placements,
        profileForCreate: (input) => {
          input.harness = 'codex'
          return input
        },
      })({ profile: profiles[0]!, harness: null }, ctx),
    ).toThrow()
  })

  it('preserves placement and runtime credential env beside steering trace env', async () => {
    let created: import('./environment-provider').CreateAgentEnvironmentInput | undefined
    const provider: AgentEnvironmentProvider = {
      name: 'fixture',
      capabilities: fakeCapabilities,
      async create(input) {
        created = input
        return fakeEnvironment({ async *stream() {} })
      },
    }
    const placement = {
      ...placements[0]!,
      create: { ...placements[0]!.create, env: { SEAT_TOKEN: 'seat-secret' } },
    }
    const selected = selectProviderPlacement(profiles[0]!, {
      placements: [placement],
      defaults: { env: { RUNTIME_TOKEN: 'runtime-secret' } },
    })
    await providerAsSandboxClient(provider, selected.options).create({
      backend: { type: 'opencode', profile: profiles[0]! },
      env: { TRACE_ID: 'trace', PARENT_SPAN_ID: 'span' },
    })
    expect(created?.env).toEqual({
      SEAT_TOKEN: 'seat-secret',
      RUNTIME_TOKEN: 'runtime-secret',
      TRACE_ID: 'trace',
      PARENT_SPAN_ID: 'span',
    })
  })

  it('refuses mapped credential and profile substitutions before creating an environment', async () => {
    let creates = 0
    const provider: AgentEnvironmentProvider = {
      name: 'fixture',
      capabilities: fakeCapabilities,
      async create() {
        creates++
        throw new Error('must not create')
      },
    }
    const ctx = { signal: new AbortController().signal, seams: {} }
    const spec = { profile: profiles[0]!, harness: null }
    const executor = providerAsExecutor(provider, {
      placements,
      taskToTurn: (_task, _profile, turn) => ({
        ...turn,
        providerOptions: { backend: { type: 'codex' } },
      }),
    })(spec, ctx)
    await expect(
      collect(executor.execute('run', ctx.signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/cannot replace/)
    expect(() =>
      providerAsExecutor(provider, {
        placements,
        profileForCreate: (profile) => ({ ...profile, harness: 'codex' }),
      })(spec, ctx),
    ).toThrow(/cannot change/)
    expect(creates).toBe(0)
  })
})

/** A provider that reports tokens and never a dollar — the sandbox-rooted shape that used to
 *  settle `usd: 0` with no estimate no matter how much prompt it had processed. */
function unreceiptedProviderExecutor(model: string) {
  const provider: AgentEnvironmentProvider = {
    name: 'unreceipted-fixture',
    capabilities: fakeCapabilities,
    create: async () =>
      fakeEnvironment({
        async *stream() {
          yield { type: 'llm_call', data: { tokensIn: 200_000, tokensOut: 20_000 } }
          yield { type: 'done', data: { finalText: 'result' } }
        },
      }),
  }
  return providerAsExecutor(provider)(
    { profile: { name: 'worker', model: { default: model } }, harness: null },
    { signal: new AbortController().signal, seams: {} },
  )
}

function fakeEnvironment(
  overrides: Partial<AgentEnvironment> & Pick<AgentEnvironment, 'stream'>,
): AgentEnvironment {
  const { stream, ...rest } = overrides
  return {
    id: 'env-1',
    provider: 'fake-provider',
    status: async () => 'running',
    destroy: async () => {},
    ...rest,
    stream,
  }
}

async function settleProviderEvents(
  events: AgentEnvironmentEvent[],
  workerCount = 1,
  workerTokens = 1_000,
) {
  const provider: AgentEnvironmentProvider = {
    name: 'model-receipts',
    capabilities: fakeCapabilities,
    create: async () =>
      fakeEnvironment({
        stream: async function* () {
          yield* events
        },
      }),
  }
  const journal = new InMemorySpawnJournal()
  await journal.beginTree('root', new Date(0).toISOString())
  const pool = createBudgetPool(
    { maxIterations: 2 * workerCount, maxTokens: workerTokens * workerCount },
    0,
  )
  const scope = createScope({
    parentId: 'root',
    root: 'root',
    journal,
    blobs: new InMemoryResultBlobStore(),
    pool,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
  })
  const profile: AgentProfile = {
    name: 'model-receipts',
    harness: 'opencode',
    model: { provider: 'fixture', default: 'fixture/model' },
  }
  for (let worker = 0; worker < workerCount; worker++)
    expect(
      scope.spawn(
        Object.assign(
          { name: 'model-receipts', act: async () => 'unused' },
          {
            executorSpec: {
              profile,
              harness: null,
              executorFactory: createExecutor({ backend: 'provider', provider }),
            },
          },
        ),
        'task',
        { label: 'model-receipts', budget: { maxIterations: 1, maxTokens: workerTokens } },
      ).ok,
    ).toBe(true)
  const settled = await scope.next()
  for (let worker = 1; worker < workerCount; worker++) await scope.next()
  const terminals =
    (await journal.loadTree('root'))?.filter((event) => event.kind === 'settled') ?? []
  return { settled, terminal: terminals[0], terminals, budget: pool.readout() }
}

function fakeCapabilities() {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: { replace: true, append: true },
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: {
        files: true,
        instructions: true,
        tools: true,
        skills: true,
        agents: true,
        commands: true,
      },
      hooks: true,
      modes: true,
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: true,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
