import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type { AgentSession } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../durable/in-memory-spawn-stores'
import { priceTokens } from '../pricing/router-prices'
import { providerAsExecutor } from './environment-provider/provider-executor-admission'
import type { RetainedRunAdmission } from './retained-run-types'
import { createBudgetPool } from './supervise/budget'
import type { RetainedExecutorContext } from './supervise/retained-executor'
import { retainedExecutorSeamKey } from './supervise/retained-executor'
import { createExecutor, createExecutorRegistry } from './supervise/runtime'
import { createScope } from './supervise/scope'
import type { UsageEvent } from './supervise/types'

function testProfile(name: string): AgentProfile {
  return {
    name,
    harness: 'opencode',
    model: { provider: 'offline', default: 'offline-test-model' },
  }
}

function capabilities(): AgentEnvironmentCapabilities {
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

function pendingRetainedProvider(
  fixture: {
    readonly events?: AgentSession['events']
    readonly result?: () => Promise<{ text: string; success: boolean }>
    readonly status?: AgentSession['status']
    readonly onDispatch?: () => void
  } = {},
): AgentEnvironmentProvider {
  const providerName = 'retained-provider-workspace-retention-test'
  let destroyCount = 0
  let environment: AgentEnvironment | undefined
  const provider: AgentEnvironmentProvider = {
    name: providerName,
    capabilities: () => ({
      ...capabilities(),
      retainedControl: {
        exactRunIdentity: true,
        resultIdentity: true,
        eventIdentity: true,
        cancellationIdempotency: true,
      },
    }),
    async create() {
      environment = {
        id: 'retained-workspace-environment',
        provider: providerName,
        status: async () => 'running',
        async *stream() {
          yield* []
        },
        async dispatch(input) {
          fixture.onDispatch?.()
          const sessionId = input.sessionId ?? 'retained-workspace-session'
          const executionId = input.executionId ?? 'retained-workspace-execution'
          const controlRef: AgentExactRunControlRef = {
            runId: 'retained-workspace-run',
            provider: providerName,
            environmentId: 'retained-workspace-environment',
            sessionId,
            executionId,
            requestDigest: `sha256:${'1'.repeat(64)}`,
          }
          return { id: sessionId, provider: providerName, controlRef }
        },
        session(sessionId, options) {
          const controlRef = options?.controlRef
          if (!controlRef) throw new Error('retained test requires an exact control reference')
          return {
            id: sessionId,
            controlRef,
            status: fixture.status ?? (async () => 'running'),
            events:
              fixture.events ??
              async function* () {
                yield* []
              },
            result: async () => {
              if (fixture.result === undefined) throw new Error('retained result unavailable')
              const result = await fixture.result()
              return {
                ...result,
                sessionId: controlRef.sessionId,
                metadata: {
                  runId: controlRef.runId,
                  executionId: controlRef.executionId,
                  requestDigest: controlRef.requestDigest,
                },
              }
            },
            async cancel() {},
            async prompt() {
              return { text: '', success: true, sessionId: controlRef.sessionId }
            },
          }
        },
        async destroy() {
          destroyCount += 1
        },
      }
      return environment
    },
    async get(id) {
      return environment?.id === id ? environment : null
    },
  }
  return provider
}

/** Run real scheduler turns until `ready` holds; the fake clock stays where it is. */
async function untilObserved(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 2_000 && !ready(); turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  expect(ready()).toBe(true)
}

/** The `awaiting-result` rows an execution published. */
function awaitingRows(events: readonly UsageEvent[]): string[] {
  return events.flatMap((event) =>
    event.kind === 'progress' && event.progress.kind === 'awaiting-result'
      ? [event.progress.since]
      : [],
  )
}

describe('retained provider observation', () => {
  it('settles a retained turn from its exact result when the provider loses the terminal event', async () => {
    let dispatches = 0
    let results = 0
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield { type: 'message.part.updated', data: { delta: 'partial' } }
      },
      result: async () => ({ text: 'exact finished result', success: true }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'lost-terminal-root',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        results += 1
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('lost-terminal-root'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
    }
    expect(executor.resultArtifact().out).toMatchObject({ content: 'exact finished result' })
    expect(results).toBe(1)
    expect(dispatches).toBe(1)
    expect(admissions.map((entry) => entry.phase)).toEqual(['intent', 'environment', 'dispatched'])
  })

  it('reattaches after a restart and settles the original terminal-less turn from its exact result', async () => {
    let dispatches = 0
    let results = 0
    let resultReady = false
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield* []
      },
      result: async () =>
        resultReady
          ? { text: 'original result after restart', success: true }
          : await new Promise<{ text: string; success: boolean }>(() => {}),
    })
    const get = provider.get!.bind(provider)
    provider.get = async (id) => {
      const environment = await get(id)
      return environment === null ? null : { ...environment }
    }
    const retention: RetainedExecutorContext = {
      executionId: 'restarted-terminal-less-worker',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        results += 1
      },
    }
    const factory = providerAsExecutor(provider)
    const makeExecutor = () => {
      const controller = new AbortController()
      return {
        controller,
        executor: factory(
          { profile: testProfile('restarted-terminal-less-worker'), harness: null },
          { signal: controller.signal, seams: { [retainedExecutorSeamKey]: retention } },
        ),
      }
    }
    // The first process waits on the exact result until it stops; the wait itself never ends it.
    const first = makeExecutor()
    const firstEvents: UsageEvent[] = []
    const waiting = (async () => {
      for await (const event of first.executor.execute(
        'task',
        first.controller.signal,
      ) as AsyncIterable<UsageEvent>) {
        firstEvents.push(event)
      }
    })()
    await untilObserved(() => awaitingRows(firstEvents).length > 0)
    first.controller.abort('process restart')
    await expect(waiting).rejects.toBeDefined()
    expect(results).toBe(0)
    expect(await first.executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
    resultReady = true
    const resumed = makeExecutor()
    for await (const _event of resumed.executor.recover!(
      'task',
      resumed.controller.signal,
    ) as AsyncIterable<UsageEvent>) {
    }
    expect(resumed.executor.resultArtifact().out).toMatchObject({
      content: 'original result after restart',
    })
    expect(dispatches).toBe(1)
    expect(results).toBe(1)
  })

  it.each([
    { label: 'no frame', frames: [] },
    {
      label: 'a progress frame',
      frames: [{ type: 'message.part.updated', data: { delta: 'turn' } }],
    },
    {
      label: 'a terminal frame',
      frames: [{ id: 'done', type: 'done', data: { finalText: 'finished' } }],
    },
  ])(
    'wakes from an exact result while its subscription stays open after $label',
    async ({ frames }) => {
      const provider = pendingRetainedProvider({
        events: async function* () {
          yield* frames as AgentEnvironmentEvent[]
          await new Promise<void>(() => {})
        },
        result: async () => ({ text: 'finished', success: true }),
      })
      const retention: RetainedExecutorContext = {
        executionId: 'open-subscription',
        admissions: [],
        onAdmission: async () => {},
        onResult: async () => {},
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile: testProfile('open-subscription'), harness: null },
        { signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      // A quiet stream that still owes its terminal frame never holds the exact result.
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
      expect(executor.resultArtifact().out).toMatchObject({
        content: 'finished',
        events: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ eventStreamComplete: false }),
          }),
        ]),
      })
    },
  )

  it('reads a tail that keeps flowing after the exact result, then wakes on it', async () => {
    // test-canary-graph-tools-20261017a (2026-10-17): a turn's last frames and its exact result
    // came together on two connections, the result won, and the root's retained stream lost the
    // run_graph call those frames carried. A burst that straddles the result is read whole.
    const admissions: RetainedRunAdmission[] = []
    // Each tail frame lands a few scheduler turns after the one before: later than the one turn a
    // quiet stream gets, and well inside the flow window, without waiting on the clock.
    const pause = async () => {
      for (let turn = 0; turn < 3; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    const provider = pendingRetainedProvider({
      events: async function* () {
        yield { id: 'frame-0', type: 'message.part.updated', data: { delta: 'calling run_graph' } }
        for (let index = 1; index <= 5; index += 1) {
          await pause()
          yield { id: `frame-${index}`, type: 'message.part.updated', data: { delta: `${index}` } }
        }
        await pause()
        yield { id: 'done', type: 'done', data: { finalText: 'graph launched' } }
        await new Promise<void>(() => {})
      },
      result: async () => ({ text: 'graph launched', success: true }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'flowing-tail',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('flowing-tail'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    const completed = (async () => {
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
      return true
    })()
    expect(
      await Promise.race([
        completed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]),
    ).toBe(true)
    // The whole burst is read, its terminal frame included. The subscription that frame leaves
    // open still closes on the exact result and is recorded as incomplete, as the law for a
    // terminal frame that leaves its subscription open states.
    expect(executor.resultArtifact().out).toMatchObject({
      content: 'graph launched',
      events: expect.arrayContaining([
        expect.objectContaining({ id: 'frame-5' }),
        expect.objectContaining({ id: 'done' }),
      ]),
    })
  })

  it('drains ready retained evidence and terminal tails before accepting an exact result', async () => {
    let acceptedResults = 0
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      events: async function* () {
        for (let index = 0; index < 20; index += 1) {
          // Multiple async iterator layers must not turn ready evidence into lost observation.
          await Promise.resolve()
          await Promise.resolve()
          yield {
            id: `usage-${index}`,
            type: 'usage',
            data: { usageMode: 'delta' },
            usage: { inputTokens: 1, outputTokens: 1 },
          }
          if (index === 0) yield { id: 'done', type: 'done', data: { finalText: 'finished' } }
        }
      },
      result: async () => ({ text: 'finished', success: true }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'ready-retained-evidence',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        acceptedResults += 1
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('ready-retained-evidence'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
    }
    expect(executor.resultArtifact().spent.tokens).toMatchObject({ input: 20, output: 20 })
    expect(executor.resultArtifact().out).toMatchObject({ content: 'finished' })
    expect(JSON.stringify(executor.resultArtifact().out)).not.toContain('eventStreamComplete')
    expect(acceptedResults).toBe(1)
  })

  it.each([
    {
      label: 'without exact usage',
      usage: undefined,
      tokens: { input: 3, output: 2 },
      known: false,
    },
    {
      label: 'with exact tokens',
      usage: { inputTokens: 7, outputTokens: 5 },
      tokens: { input: 7, output: 5 },
      known: true,
    },
    {
      label: 'with exact tokens and cost',
      usage: { inputTokens: 7, outputTokens: 5, cost: 0.25 },
      tokens: { input: 7, output: 5 },
      known: true,
    },
    {
      label: 'with an exact cache read the stream never carried',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 6 },
      tokens: { input: 10, output: 5, cacheRead: 6 },
      known: true,
    },
  ])('preserves partial observed subtotals $label', async ({ usage, tokens, known }) => {
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      events: async function* () {
        yield {
          id: 'partial-receipt',
          type: 'usage',
          data: { usageMode: 'delta', costProvenance: 'provider-receipt' },
          usage: { inputTokens: 3, outputTokens: 2, cost: 0.25 },
        }
        await new Promise<void>(() => {})
      },
      result: async () => ({ text: 'finished', success: true, ...(usage ? { usage } : {}) }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'partial-observation-usage',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('partial-observation-usage'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
    }
    const artifact = executor.resultArtifact()
    expect(artifact.spent.tokens).toMatchObject(tokens)
    expect(artifact.spent.tokensKnown !== false).toBe(known)
    expect(artifact.spent.iterations).toBe(1)
    if (usage === undefined) {
      expect(artifact.spent.streamedTokens).toEqual({
        input: 3,
        output: 2,
        cacheBreakdownKnown: false,
      })
      expect(artifact.spent.unobservedTokens).toBeUndefined()
      expect(artifact.spent.iterationsKnown).toBeUndefined()
    } else {
      expect(artifact.spent.streamedTokens).toEqual({
        input: 3,
        output: 2,
        cacheBreakdownKnown: false,
      })
      expect(artifact.spent.unobservedTokens).toMatchObject({
        input: tokens.input - 3,
        output: tokens.output - 2,
        cacheBreakdownKnown: false,
      })
      expect(artifact.spent.iterationsKnown).toBe(false)
    }
    if (usage?.cacheReadInputTokens !== undefined) {
      expect(artifact.spent.unobservedTokens?.cacheRead).toBe(usage.cacheReadInputTokens)
    }
    expect(artifact.spent.usd).toBe(0.25)
    // Bare exact-result costs still do not become provider billing receipts.
    expect(artifact.spent.usdKnown).toBe(false)
    expect(artifact.out).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ eventStreamComplete: false }) }),
      ]),
    })
  })

  it.each(['foreign', 'changed-duplicate', 'refusal'] as const)(
    'preserves a buffered %s verdict after a terminal frame',
    async (tail) => {
      let acceptedResults = 0
      const admissions: RetainedRunAdmission[] = []
      const provider = pendingRetainedProvider({
        events: async function* () {
          yield { id: 'first', type: 'done', data: { finalText: 'apparently finished' } }
          for (let index = 0; index < 20; index += 1) {
            await Promise.resolve()
            yield { id: `progress-${index}`, type: 'message.part.updated', data: { delta: '.' } }
          }
          if (tail === 'foreign') {
            yield { id: 'tail', type: 'done', data: { executionId: 'another-execution' } }
          } else if (tail === 'changed-duplicate') {
            yield { id: 'first', type: 'done', data: { finalText: 'changed evidence' } }
          } else {
            yield { id: 'refused', type: 'status', data: { status: 'failed' } }
            yield {
              id: 'tail',
              type: 'error',
              data: { error: 'provider refused', errorCode: 'provider_quota_exhausted' },
            }
          }
        },
        result: async () => ({ text: 'apparently finished', success: true }),
      })
      const retention: RetainedExecutorContext = {
        executionId: `buffered-tail-${tail}`,
        admissions,
        onAdmission: async (admission) => {
          admissions.push(admission)
        },
        onResult: async () => {
          acceptedResults += 1
        },
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile: testProfile(`buffered-tail-${tail}`), harness: null },
        { signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      const run = async () => {
        for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
        }
      }
      if (tail === 'refusal') {
        await run()
        expect(executor.resultArtifact().out).toMatchObject({
          outcome: { success: false, errorCode: 'provider_quota_exhausted' },
        })
        expect(acceptedResults).toBe(1)
      } else {
        await expect(run()).rejects.toMatchObject({ pendingCause: 'provider-contract' })
        expect(acceptedResults).toBe(0)
        expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
      }
    },
  )

  it.each(['hanging', 'rejecting', 'foreign-hanging'] as const)(
    'does not let %s iterator cleanup block the exact verdict',
    async (cleanup) => {
      let cleanupCalls = 0
      let resultReads = 0
      let acceptedResults = 0
      const admissions: RetainedRunAdmission[] = []
      const provider = pendingRetainedProvider({
        events: () => ({
          [Symbol.asyncIterator]() {
            let reads = 0
            return {
              async next(): Promise<IteratorResult<AgentEnvironmentEvent>> {
                reads += 1
                if (reads === 1)
                  return {
                    done: false,
                    value: {
                      type: 'done',
                      data:
                        cleanup === 'foreign-hanging'
                          ? { executionId: 'another-execution' }
                          : { finalText: 'finished' },
                    },
                  }
                return { done: true, value: undefined }
              },
              async return(): Promise<IteratorResult<AgentEnvironmentEvent>> {
                cleanupCalls += 1
                if (cleanup === 'rejecting') throw new Error('subscription cleanup failed')
                return await new Promise<IteratorResult<AgentEnvironmentEvent>>(() => {})
              },
            }
          },
        }),
        result: async () => {
          resultReads += 1
          return { text: 'finished', success: true }
        },
      })
      const retention: RetainedExecutorContext = {
        executionId: `iterator-cleanup-${cleanup}`,
        admissions,
        onAdmission: async (admission) => {
          admissions.push(admission)
        },
        onResult: async () => {
          acceptedResults += 1
        },
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        { profile: testProfile(`iterator-cleanup-${cleanup}`), harness: null },
        { signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      const completed = (async () => {
        try {
          for await (const _event of executor.execute(
            'task',
            signal,
          ) as AsyncIterable<UsageEvent>) {
          }
          return { completed: true }
        } catch (error) {
          return { error }
        }
      })()
      const observed = await Promise.race([
        completed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ])
      if (cleanup === 'foreign-hanging') {
        expect(observed).toMatchObject({ error: { pendingCause: 'provider-contract' } })
        expect(acceptedResults).toBe(0)
        expect(resultReads).toBe(0)
      } else {
        expect(observed).toEqual({ completed: true })
        expect(acceptedResults).toBe(1)
        expect(resultReads).toBe(1)
      }
      expect(cleanupCalls).toBe(1)
    },
  )

  it('delivers a delayed retained child result through Scope after its stream loses the terminal event', async () => {
    let finish!: (result: { text: string; success: boolean }) => void
    const exactResult = new Promise<{ text: string; success: boolean }>((resolve) => {
      finish = resolve
    })
    let dispatches = 0
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield* []
      },
      result: async () => exactResult,
    })
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('retained-parent', new Date(0).toISOString())
    const scope = createScope({
      parentId: 'retained-parent',
      root: 'retained-parent',
      journal,
      blobs: new InMemoryResultBlobStore(),
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 100 }, 0),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
    })
    const agent = Object.assign(
      { name: 'delayed-retained-child', act: async () => 'unused' },
      {
        executorSpec: {
          profile: testProfile('delayed-retained-child'),
          harness: null,
          executorFactory: createExecutor({ backend: 'provider', provider }),
        },
      },
    )
    const spawned = scope.spawn(agent, 'write result', {
      label: 'delayed-retained-child',
      budget: { maxIterations: 1, maxTokens: 100 },
    })
    if (!spawned.ok) throw new Error(`child spawn refused: ${spawned.reason}`)
    const delivered = scope.next()
    finish({ text: 'child result after terminal loss', success: true })
    const settled = await delivered
    expect(settled?.kind).toBe('done')
    expect(dispatches).toBe(1)
    expect(scope.progress(spawned.handle.id)).toMatchObject({
      status: 'done',
      steerable: false,
    })
    expect(scope.send(spawned.handle.id, { steer: 'late correction' })).toBe(false)
    const terminals = (await journal.loadTree('retained-parent'))?.filter(
      (event) => event.kind === 'settled',
    )
    expect(terminals).toHaveLength(1)
  })

  it('keeps an admitted retained execution unresolved when its caller cancels observation', async () => {
    let dispatches = 0
    let acceptedResults = 0
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield { type: 'message.part.updated', data: { delta: 'in progress' } }
        await new Promise<void>(() => {})
      },
      result: async () => await new Promise<{ text: string; success: boolean }>(() => {}),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'cancelled-retained-worker',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        acceptedResults += 1
      },
    }
    const controller = new AbortController()
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('cancelled-retained-worker'), harness: null },
      { signal: controller.signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    const running = (async () => {
      for await (const _event of executor.execute(
        'task',
        controller.signal,
      ) as AsyncIterable<UsageEvent>) {
      }
    })()
    await vi.waitFor(() => expect(admissions.at(-1)?.phase).toBe('dispatched'))
    controller.abort('caller cancelled')
    await expect(running).rejects.toBeDefined()
    expect(dispatches).toBe(1)
    expect(acceptedResults).toBe(0)
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
  })

  it('deduplicates a replayed retained event before charging usage or delivering a result', async () => {
    let dispatches = 0
    let acceptedResults = 0
    let streams = 0
    const admissions: RetainedRunAdmission[] = []
    const usage: AgentEnvironmentEvent = {
      id: 'usage-1',
      type: 'usage',
      data: { usageMode: 'delta' },
      usage: { inputTokens: 3, outputTokens: 4 },
    }
    let finish!: (result: { text: string; success: boolean }) => void
    const exactResult = new Promise<{ text: string; success: boolean }>((resolve) => {
      finish = resolve
    })
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* (options) {
        streams += 1
        yield usage
        if (options?.since === undefined) throw new Error('live stream dropped')
        try {
          yield { id: 'done-2', type: 'done', data: { finalText: 'finished' } }
        } finally {
          finish({ text: 'finished', success: true })
        }
      },
      result: async () => exactResult,
    })
    const retention: RetainedExecutorContext = {
      executionId: 'duplicate-retained-worker',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        acceptedResults += 1
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('duplicate-retained-worker'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
    }
    expect(streams).toBe(2)
    expect(dispatches).toBe(1)
    expect(acceptedResults).toBe(1)
    expect(executor.resultArtifact().spent.tokens).toMatchObject({ input: 3, output: 4 })
  })

  it('leaves a subscription seat unpriced instead of catalog-pricing its tokens', async () => {
    const priced = priceTokens({ model: 'glm-5.2', inputTokens: 1000, outputTokens: 100 })
    expect(priced).toBeGreaterThan(0)
    const run = async (subscription: boolean) => {
      const provider = pendingRetainedProvider({
        events: async function* () {
          yield {
            id: 'usage-1',
            type: 'usage',
            data: { usageMode: 'delta' },
            usage: { inputTokens: 1000, outputTokens: 100 },
          }
          yield { id: 'done-1', type: 'done', data: { finalText: 'finished' } }
        },
        result: async () => ({ text: 'finished', success: true }),
      })
      const retention: RetainedExecutorContext = {
        executionId: subscription ? 'subscription-unpriced' : 'catalog-priced',
        admissions: [],
        onAdmission: async () => {},
        onResult: async () => {},
      }
      const signal = new AbortController().signal
      const executor = providerAsExecutor(provider)(
        {
          profile: {
            name: 'priced-seat',
            harness: 'opencode',
            model: {
              provider: 'zai',
              default: 'glm-5.2',
              ...(subscription ? { metadata: { credentialSource: 'subscription' as const } } : {}),
            },
          },
          harness: null,
        },
        { signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
      return executor.resultArtifact().spent
    }
    const seat = await run(true)
    expect(seat.usd).toBe(0)
    expect(seat.usdKnown).toBe(false)
    expect(seat.usdEstimated).toBeUndefined()
    const billed = await run(false)
    expect(billed.usdKnown).toBe(false)
    expect(billed.usdEstimated).toBe(priced)
    expect(billed.usd).toBe(priced)
  })
})
