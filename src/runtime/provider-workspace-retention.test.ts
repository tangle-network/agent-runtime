import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type {
  AgentSession,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it, vi } from 'vitest'
import {
  type AgentCandidateOutputArtifactPort,
  type AgentCandidateWorkspaceTree,
  captureAgentCandidateWorkspaceFiles,
  captureAgentCandidateWorkspaceTreeToArtifacts,
  verifyAgentCandidateWorkspaceTree,
} from '../candidate-execution'
import { sha256Bytes } from '../candidate-execution/digest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../durable/spawn-journal'
import {
  type ProviderLeafOut,
  type ProviderWorkspaceRetentionContext,
  providerAsExecutor,
  providerAsSandboxClient,
} from './environment-provider'
import {
  captureProviderWorkspaceSnapshot,
  type ProviderWorkspaceCaptureReceipt,
  type ProviderWorkspaceRetentionPort,
} from './provider-workspace-retention'
import type { RetainedRunAdmission } from './retained-run-types'
import { runAgentRounds } from './run-loop'
import { captureBeforeDestroy } from './sandbox-evidence-retention'
import { createBudgetPool } from './supervise/budget'
import type { RetainedExecutorContext } from './supervise/retained-executor'
import { retainedExecutorSeamKey } from './supervise/retained-executor'
import { createExecutor, createExecutorRegistry } from './supervise/runtime'
import { createScope } from './supervise/scope'
import type { UsageEvent } from './supervise/types'

type MemoryArtifacts = AgentCandidateOutputArtifactPort & {
  readonly bytes: Map<string, Uint8Array>
}

function testProfile(name: string): AgentProfile {
  return {
    name,
    harness: 'opencode',
    model: { provider: 'offline', default: 'offline-test-model' },
  }
}

function artifactStore(): MemoryArtifacts {
  const bytes = new Map<string, Uint8Array>()
  return {
    bytes,
    async put({ bytes: input, signal }) {
      signal?.throwIfAborted()
      const digest = sha256Bytes(input)
      bytes.set(digest.slice(7), Uint8Array.from(input))
      return {
        locator: { kind: 's3', bucket: 'provider-retention-tests', key: digest.slice(7) },
        sha256: digest,
        byteLength: input.byteLength,
      }
    },
    async read(reference) {
      const stored = bytes.get(reference.sha256.slice(7))
      if (stored === undefined) throw new Error(`missing artifact ${reference.sha256}`)
      return Uint8Array.from(stored)
    },
  }
}

async function snapshot(
  artifacts: AgentCandidateOutputArtifactPort,
  executionId: string,
): Promise<AgentCandidateWorkspaceSnapshotEvidence> {
  const captured = await captureAgentCandidateWorkspaceFiles(
    [
      {
        path: 'helper.mjs',
        mode: 0o644,
        bytes: Uint8Array.from(Buffer.from('portable workspace\n')),
      },
    ],
    { artifactPersistence: { executionId, outputArtifacts: artifacts } },
  )
  return captured.snapshot
}

async function nativeSnapshot(
  artifacts: AgentCandidateOutputArtifactPort,
  context: ProviderWorkspaceRetentionContext,
) {
  const bytes = Buffer.from('portable workspace\n')
  return {
    snapshot: await snapshot(artifacts, context.executionId),
    provenance: {
      status: 'reported' as const,
      environmentId: context.environment.id,
      executionId: context.executionId,
      ...(context.controlRef === undefined ? {} : { controlRef: context.controlRef }),
      workspace: {
        scannedFiles: 1,
        scannedDirectories: 0,
        reportedFiles: 1,
        reportedDirectories: 0,
        complete: true,
      },
      missing: [],
      sessions: [
        {
          id: context.providerSessionId ?? 'session',
          executionId: context.executionId,
          backendType: 'opencode',
          transportEvents: 'complete' as const,
          eventCount: 1,
          messageCount: 1,
          nativeStore: {
            scope: 'session' as const,
            roots: [{ scope: 'session-home' as const, path: '/native-home' }],
            inventory: {
              scannedFiles: 1,
              reportedFiles: 1,
              scannedDirectories: 0,
              reportedDirectories: 0,
              scannedSymlinks: 0,
              reportedSymlinks: 0,
              skippedEntries: 0,
            },
            complete: true,
            excludedPaths: [],
            entries: [
              {
                sourceId: 'native-execution',
                rootScope: 'session-home' as const,
                path: 'any/transcript.jsonl',
                kind: 'file' as const,
                mode: 0o600,
                sizeBytes: bytes.length,
                sha256: sha256Bytes(bytes),
                linkTarget: null,
              },
            ],
          },
        },
      ],
    },
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

function providerFor(
  stream: (input: AgentTurnInput) => AsyncIterable<AgentEnvironmentEvent>,
  options: {
    readonly id?: string
    readonly create?: () => void
    readonly destroy?: () => Promise<void>
  } = {},
): { provider: AgentEnvironmentProvider; environment: AgentEnvironment; destroyed: () => number } {
  let destroyCount = 0
  const environment: AgentEnvironment = {
    id: options.id ?? 'retention-environment',
    provider: 'provider-workspace-retention-test',
    status: async () => 'running',
    stream,
    async destroy() {
      destroyCount += 1
      await options.destroy?.()
    },
  }
  const provider: AgentEnvironmentProvider = {
    name: environment.provider,
    capabilities,
    async create() {
      options.create?.()
      return environment
    },
  }
  return { provider, environment, destroyed: () => destroyCount }
}

function pendingRetainedProvider(
  fixture: {
    readonly events?: AgentSession['events']
    readonly result?: () => Promise<{ text: string; success: boolean }>
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
            status: async () => 'running',
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

function doneStream(text = 'done') {
  return async function* (): AsyncIterable<AgentEnvironmentEvent> {
    yield { type: 'done', data: { finalText: text } }
  }
}

describe('provider workspace retention', () => {
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

  it('reports lost terminal evidence within the retained bound without replaying the dispatch', async () => {
    let dispatches = 0
    let results = 0
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield* []
      },
      result: async () => await new Promise<{ text: string; success: boolean }>(() => {}),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'lost-terminal-worker',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        results += 1
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, { retainedResultWaitMs: 20 })(
      { profile: testProfile('lost-terminal-worker'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    await expect(async () => {
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
    }).rejects.toMatchObject({ pendingCause: 'terminal-event-lost' })
    expect(dispatches).toBe(1)
    expect(results).toBe(0)
    expect(admissions.at(-1)?.phase).toBe('dispatched')
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
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
    const factory = providerAsExecutor(provider, { retainedResultWaitMs: 20 })
    const makeExecutor = () => {
      const signal = new AbortController().signal
      return {
        signal,
        executor: factory(
          { profile: testProfile('restarted-terminal-less-worker'), harness: null },
          { signal, seams: { [retainedExecutorSeamKey]: retention } },
        ),
      }
    }
    const first = makeExecutor()
    await expect(async () => {
      for await (const _event of first.executor.execute(
        'task',
        first.signal,
      ) as AsyncIterable<UsageEvent>) {
      }
    }).rejects.toMatchObject({ pendingCause: 'terminal-event-lost' })
    expect(await first.executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
    resultReady = true
    const resumed = makeExecutor()
    for await (const _event of resumed.executor.recover!(
      'task',
      resumed.signal,
    ) as AsyncIterable<UsageEvent>) {
    }
    expect(resumed.executor.resultArtifact().out).toMatchObject({
      content: 'original result after restart',
    })
    expect(dispatches).toBe(1)
    expect(results).toBe(1)
  })

  it('reconciles a completed retained execution without waiting for its quiet event stream', async () => {
    let dispatches = 0
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield { type: 'message.part.updated', data: { delta: 'turn output' } }
        await new Promise<void>(() => {})
      },
      result: async () => ({ text: 'settled exact turn', success: true }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'quiet-retained-root',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, { retainedObservationIdleMs: 2_000 })(
      { profile: testProfile('quiet-retained-root'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    const completed = (async () => {
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
      return true
    })()
    // The exact result wakes the turn at once: a quiet stream that still owes its terminal frame
    // never holds it.
    expect(
      await Promise.race([
        completed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]),
    ).toBe(true)
    expect(executor.resultArtifact().out).toMatchObject({ content: 'settled exact turn' })
    expect(dispatches).toBe(1)
  })

  it('reads a tail that keeps flowing after the exact result, then wakes on it', async () => {
    // test-canary-graph-tools-20261017a (2026-10-17): a turn's last frames and its exact result
    // came together on two connections, the result won, and the root's retained stream lost the
    // run_graph call those frames carried. A burst that straddles the result is read whole.
    const admissions: RetainedRunAdmission[] = []
    const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 20))
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
    const executor = providerAsExecutor(provider, { retainedObservationIdleMs: 2_000 })(
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
    expect(executor.resultArtifact().out).toMatchObject({
      content: 'graph launched',
      events: expect.arrayContaining([expect.objectContaining({ id: 'frame-5' })]),
    })
    expect(JSON.stringify(executor.resultArtifact().out)).not.toContain('eventStreamComplete')
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

  it('wakes from an exact result after a terminal frame leaves its subscription open', async () => {
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      events: async function* () {
        yield { id: 'done', type: 'done', data: { finalText: 'finished' } }
        await new Promise<void>(() => {})
      },
      result: async () => ({ text: 'finished', success: true }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'terminal-open-subscription',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, { retainedObservationIdleMs: 2_000 })(
      { profile: testProfile('terminal-open-subscription'), harness: null },
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
    expect(executor.resultArtifact().out).toMatchObject({
      content: 'finished',
      events: expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ eventStreamComplete: false }) }),
      ]),
    })
  })

  it('wakes from an exact result without any event frame', async () => {
    const admissions: RetainedRunAdmission[] = []
    const provider = pendingRetainedProvider({
      events: async function* () {
        await new Promise<void>(() => {})
      },
      result: async () => ({ text: 'finished', success: true }),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'no-frame-open-subscription',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, { retainedObservationIdleMs: 2_000 })(
      { profile: testProfile('no-frame-open-subscription'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    const completed = (async () => {
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
      return true
    })()
    // The exact result wakes the turn at once: a quiet stream that still owes its terminal frame
    // never holds it.
    expect(
      await Promise.race([
        completed,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
      ]),
    ).toBe(true)
    expect(executor.resultArtifact().out).toMatchObject({
      content: 'finished',
      events: expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ eventStreamComplete: false }) }),
      ]),
    })
  })

  it.each(['ready', 'next-turn'] as const)(
    'bounds observation of a %s exact result without accepting an unseen tail',
    async (readiness) => {
      let observedFrames = 0
      let resultReads = 0
      let acceptedResults = 0
      const admissions: RetainedRunAdmission[] = []
      const provider = pendingRetainedProvider({
        events: async function* () {
          // A finite guard makes a starvation regression fail instead of wedging the runner.
          while (observedFrames < 4096) {
            observedFrames += 1
            yield {
              id: `progress-${observedFrames}`,
              type: 'message.part.updated',
              data: { delta: '.' },
            }
          }
          throw new Error('continuously ready observation exceeded the test guard')
        },
        result: async () => {
          resultReads += 1
          if (readiness === 'next-turn') await new Promise<void>((resolve) => setImmediate(resolve))
          return { text: 'completed independently', success: true }
        },
      })
      const retention: RetainedExecutorContext = {
        executionId: `continuous-ready-${readiness}`,
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
        { profile: testProfile(`continuous-ready-${readiness}`), harness: null },
        { signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      await expect(async () => {
        for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
        }
      }).rejects.toMatchObject({ pendingCause: 'unobservable' })
      expect(observedFrames).toBeLessThan(4096)
      expect(resultReads).toBe(1)
      expect(acceptedResults).toBe(0)
      expect(admissions.map((entry) => entry.phase)).toEqual([
        'intent',
        'environment',
        'dispatched',
      ])
      expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
    },
  )

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

  it.each(['foreign', 'refusal', 'duplicate'] as const)(
    'does not accept success with an unobserved %s tail beyond the work budget',
    async (tail) => {
      let acceptedResults = 0
      let tailReached = false
      let dispatches = 0
      const admissions: RetainedRunAdmission[] = []
      const provider = pendingRetainedProvider({
        onDispatch: () => {
          dispatches += 1
        },
        events: async function* () {
          for (let index = 0; index < 4096; index += 1) {
            yield {
              id: tail === 'duplicate' ? 'same-event' : `progress-${index}`,
              type: 'message.part.updated',
              data: { delta: '.' },
            }
          }
          tailReached = true
          yield tail === 'foreign'
            ? { id: 'tail', type: 'done', data: { executionId: 'another-execution' } }
            : {
                id: 'tail',
                type: 'error',
                data: { error: 'provider refused', errorCode: 'provider_quota_exhausted' },
              }
        },
        result: async () => ({ text: 'apparently finished', success: true }),
      })
      const retention: RetainedExecutorContext = {
        executionId: `unobserved-tail-${tail}`,
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
        { profile: testProfile(`unobserved-tail-${tail}`), harness: null },
        { signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      await expect(async () => {
        for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
        }
      }).rejects.toMatchObject({ pendingCause: 'unobservable' })
      expect(tailReached).toBe(false)
      expect(acceptedResults).toBe(0)
      expect(dispatches).toBe(1)
      expect(admissions.at(-1)?.phase).toBe('dispatched')
      expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
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
    const executor = providerAsExecutor(provider, { retainedObservationIdleMs: 1_000 })(
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

  it('does not let an endless duplicate replay extend the retained observation bound', async () => {
    let dispatches = 0
    const admissions: RetainedRunAdmission[] = []
    const repeated: AgentEnvironmentEvent = {
      id: 'one-frame',
      type: 'message.part.updated',
      data: { delta: 'still the same frame' },
    }
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
      events: async function* () {
        yield repeated
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          yield repeated
        }
      },
      result: async () => await new Promise<{ text: string; success: boolean }>(() => {}),
    })
    const retention: RetainedExecutorContext = {
      executionId: 'endless-duplicate-worker',
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {
        throw new Error('an unresolved result cannot settle')
      },
    }
    const signal = new AbortController().signal
    const executor = providerAsExecutor(provider, {
      retainedObservationIdleMs: 20,
      retainedResultWaitMs: 20,
    })(
      { profile: testProfile('endless-duplicate-worker'), harness: null },
      { signal, seams: { [retainedExecutorSeamKey]: retention } },
    )
    await expect(async () => {
      for await (const _event of executor.execute('task', signal) as AsyncIterable<UsageEvent>) {
      }
    }).rejects.toMatchObject({ pendingCause: 'terminal-event-lost' })
    expect(dispatches).toBe(1)
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
  })

  it('retains the admitted native reference across pre-harness failure and cold executor recovery', async () => {
    const artifacts = artifactStore()
    let dispatches = 0
    const provider = pendingRetainedProvider({
      onDispatch: () => {
        dispatches += 1
      },
    })
    const get = provider.get!.bind(provider)
    provider.get = async (id) => {
      const environment = await get(id)
      // Reconnection returns a fresh handle, without the original object's local session cache.
      return environment === null ? null : { ...environment }
    }
    const admissions: RetainedRunAdmission[] = []
    const evidence: ProviderLeafOut[] = []
    const contexts: ProviderWorkspaceRetentionContext[] = []
    const retention: RetainedExecutorContext = {
      executionId: 'frontier:input:1',
      preserveEnvironment: true,
      admissions,
      async onAdmission(admission) {
        admissions.push(admission)
      },
      async onResult() {
        throw new Error('an unresolved native result must not settle')
      },
      async onEvidence(out) {
        evidence.push(out as ProviderLeafOut)
      },
    }
    const factory = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        requireCompleteProvenance: true,
        artifacts,
        async capture(context) {
          contexts.push(context)
          const controlRef = context.controlRef!
          expect(context.executionId).toBe('frontier:input:1')
          expect(controlRef.executionId).toMatch(/^retained-execution-/)
          expect(controlRef.sessionId).toMatch(/^retained-session-/)
          expect(context.providerSessionId).toBe(controlRef.sessionId)
          expect(context.nativeSessionId).toBeNull()
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported' as const,
              environmentId: context.environment.id,
              executionId: context.executionId,
              controlRef,
              workspace: {
                scannedFiles: 1,
                scannedDirectories: 0,
                reportedFiles: 1,
                reportedDirectories: 0,
                complete: true,
              },
              sessions: [
                {
                  id: controlRef.sessionId,
                  executionId: context.executionId,
                  executionIds: [controlRef.executionId],
                  eventCountsByExecutionId: { [controlRef.executionId]: 0 },
                  backendType: 'opencode',
                  transportEvents: 'unavailable',
                  eventCount: 0,
                  messageCount: 0,
                  nativeSessionId: null,
                  nativeReason: 'harness-never-started',
                },
              ],
              attempts: [],
              missing: ['harness-never-started'],
            },
          }
        },
      },
    })
    for (const recovering of [false, true]) {
      const executor = factory(
        { profile: testProfile('pre-harness-capture'), harness: null },
        { signal: new AbortController().signal, seams: { [retainedExecutorSeamKey]: retention } },
      )
      const execute = recovering
        ? executor.recover!.bind(executor)
        : executor.execute.bind(executor)
      await expect(async () => {
        for await (const _event of execute(
          'task',
          new AbortController().signal,
        ) as AsyncIterable<UsageEvent>) {
        }
      }).rejects.toThrow(/retained result unavailable|requires reconciliation/)
      expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
    }
    const admission = admissions.find((entry) => entry.phase === 'dispatched')!
    if (admission.phase !== 'dispatched') throw new Error('expected admitted execution')
    expect(contexts).toHaveLength(2)
    expect(dispatches).toBe(1)
    expect(evidence).toHaveLength(2)
    for (const out of evidence) {
      expect(out.workspaceCapture).toMatchObject({
        executionId: 'frontier:input:1',
        controlRef: admission.controlRef,
        providerSessionId: admission.controlRef.sessionId,
        nativeSessionId: null,
        coverageComplete: false,
        provenance: { executionId: 'frontier:input:1', controlRef: admission.controlRef },
      })
      expect(out.workspaceCapture!.incompleteReason).toContain('harness-never-started')
      expect(out.workspaceCapture!.incompleteReason).not.toContain(
        'admitted control reference missing',
      )
    }
    expect(contexts[0]!.environment).not.toBe(contexts[1]!.environment)
    expect(contexts[0]!.controlRef).toEqual(contexts[1]!.controlRef)
  })

  it.each(['execution', 'request', 'session', 'environment'] as const)(
    'refuses capture provenance that changes the admitted %s',
    async (changed) => {
      const artifacts = artifactStore()
      const { environment } = providerFor(doneStream())
      const controlRef: AgentExactRunControlRef = {
        runId: 'run-1',
        provider: environment.provider,
        environmentId: environment.id,
        sessionId: 'retained-session-1',
        executionId: 'retained-execution-1',
        requestDigest: `sha256:${'a'.repeat(64)}`,
      }
      const wrong: AgentExactRunControlRef = {
        ...controlRef,
        ...{
          execution: { executionId: 'other-execution' },
          request: { requestDigest: `sha256:${'b'.repeat(64)}` as const },
          session: { sessionId: 'other-session' },
          environment: { environmentId: 'other-box' },
        }[changed],
      }
      await expect(
        captureProviderWorkspaceSnapshot(
          {
            timeoutMs: 5_000,
            artifacts,
            async capture(context) {
              return {
                snapshot: await snapshot(artifacts, context.executionId),
                provenance: {
                  status: 'reported',
                  environmentId: environment.id,
                  executionId: context.executionId,
                  controlRef: wrong,
                  missing: [],
                },
              }
            },
          },
          {
            environment,
            executionId: 'frontier:input:1',
            controlRef,
            providerSessionId: controlRef.sessionId,
            profile: testProfile('wrong-native-ref'),
          },
        ),
      ).rejects.toThrow('another admitted execution')
    },
  )

  it('keeps native execution coverage incomplete when an exact reference is omitted from capture', async () => {
    const artifacts = artifactStore()
    const { environment } = providerFor(doneStream())
    const controlRef: AgentExactRunControlRef = {
      runId: 'run-1',
      provider: environment.provider,
      environmentId: environment.id,
      sessionId: 'retained-session-1',
      executionId: 'retained-execution-1',
      requestDigest: `sha256:${'a'.repeat(64)}`,
    }
    const result = await captureProviderWorkspaceSnapshot(
      {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported',
              environmentId: environment.id,
              executionId: context.executionId,
              sessions: [],
              missing: [],
            },
          }
        },
      },
      {
        environment,
        executionId: 'frontier:input:1',
        controlRef,
        providerSessionId: controlRef.sessionId,
        profile: testProfile('missing-native-ref'),
      },
    )
    expect(result.coverageComplete).toBe(false)
    expect(result.incompleteReason).toContain('Exact admitted control reference missing')
    expect(result.incompleteReason).toContain('Exact admitted provider execution missing')
  })

  it.each(['sse', 'poll'] as const)(
    'captures a runAgentRounds box through the %s execution path',
    async (streaming) => {
      const artifacts = artifactStore()
      const order: string[] = []
      let recordedSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
      let polledSessionId: string | undefined
      const box = {
        id: 'loop-box',
        status: 'running',
        async *streamPrompt(_prompt: string, options: { sessionId: string; executionId: string }) {
          yield {
            type: 'result',
            data: {
              finalText: 'done',
              runtimeSessionId: options.sessionId,
              executionId: options.executionId,
            },
          }
          yield {
            type: 'done',
            data: {
              outcome: { type: 'completed' },
              runtimeSessionId: options.sessionId,
              executionId: options.executionId,
            },
          }
        },
        async dispatchPrompt(_prompt: string, options: { sessionId: string; executionId: string }) {
          polledSessionId = options.sessionId
          expect(options.executionId).toBeTruthy()
          return { sessionId: options.sessionId }
        },
        session(id: string) {
          return {
            async result() {
              expect(id).toBe(polledSessionId)
              return { response: 'done', success: true, status: 'success' }
            },
          }
        },
        async delete() {
          order.push('delete')
        },
      } as unknown as SandboxInstance
      await runAgentRounds({
        driver: {
          async plan(_task: string, history: readonly unknown[]) {
            return history.length ? [] : ['task']
          },
          decide: () => 'done' as const,
        },
        agentRun: { profile: testProfile('loop-retention'), taskToPrompt: (task: string) => task },
        output: { parse: () => 'done' },
        task: 'task',
        runId: 'loop-1',
        maxIterations: 1,
        lineage: { streaming },
        ctx: {
          sandboxClient: {
            async create() {
              return box
            },
          },
        },
        evidenceRetention: {
          timeoutMs: 5_000,
          artifacts,
          async capture(context) {
            order.push('capture')
            expect(context.sandboxSessionIds).toHaveLength(1)
            const sessionId = context.sandboxSessionIds[0]!
            if (streaming === 'poll') expect(sessionId).toBe(polledSessionId)
            const executionId = context.sessionExecutionIds[sessionId]?.[0]
            expect(executionId).toBeTruthy()
            return {
              snapshot: await snapshot(artifacts, context.executionId),
              provenance: {
                status: 'reported' as const,
                environmentId: 'loop-box',
                executionId: 'loop-1',
                workspace: {
                  scannedFiles: 1,
                  scannedDirectories: 0,
                  reportedFiles: 1,
                  reportedDirectories: 0,
                  complete: true,
                },
                sessions: [
                  {
                    id: sessionId,
                    executionId: 'loop-1',
                    executionIds: [executionId!],
                    eventCountsByExecutionId: { [executionId!]: 2 },
                    backendType: 'opencode',
                    transportEvents: 'complete',
                    eventCount: 2,
                    messageCount: 1,
                    nativeSessionId: null,
                    sidecarImageDigest: `sha256:${'a'.repeat(64)}`,
                    sidecarBundleRevision: 'b'.repeat(40),
                    nativeStore: {
                      scope: 'session' as const,
                      roots: [{ scope: 'session-home' as const, path: '/home/agent' }],
                      inventory: {
                        scannedFiles: 1,
                        reportedFiles: 1,
                        scannedDirectories: 0,
                        reportedDirectories: 0,
                        scannedSymlinks: 0,
                        reportedSymlinks: 0,
                        skippedEntries: 0,
                      },
                      complete: true,
                      entries: [],
                      excludedPaths: [],
                    },
                    processStreams: {
                      complete: true,
                      streamCount: 1,
                      stdinBytes: 0,
                      stdoutBytes: 1,
                      stderrBytes: 0,
                      protocolBytes: 0,
                    },
                    nativeEvents: { complete: true, count: 1 },
                  },
                ],
                missing: [],
              },
            }
          },
          async record(receipt) {
            recordedSnapshot = receipt.snapshot
            order.push('record')
          },
        },
      })
      expect(order).toEqual(['capture', 'record', 'delete'])
      expect(recordedSnapshot).toBeDefined()
      const archive = recordedSnapshot!.archive
      if (!('locator' in archive)) throw new Error('retained archive lacks durable locator')
      const reopenedArchive = await artifacts.read(archive)
      expect(reopenedArchive.byteLength).toBeGreaterThan(0)
    },
  )
  it('records a verified raw Sandbox receipt before deleting its box', async () => {
    const artifacts = artifactStore()
    const order: string[] = []
    const box = {
      id: 'raw-box',
      async delete() {
        order.push('delete')
      },
    } as unknown as SandboxInstance
    const profile = testProfile('raw-box')
    const context = {
      box,
      executionId: 'run-1',
      profile,
      sandboxSessionIds: ['sandbox-1'],
      sessionExecutionIds: { 'sandbox-1': ['execution-1'] },
    }
    const receipt = await captureBeforeDestroy(
      {
        timeoutMs: 5_000,
        artifacts,
        async capture() {
          order.push('capture')
          return {
            snapshot: await snapshot(artifacts, 'run-1'),
            provenance: {
              status: 'reported' as const,
              environmentId: 'raw-box',
              executionId: 'run-1',
              workspace: {
                scannedFiles: 1,
                scannedDirectories: 0,
                reportedFiles: 1,
                reportedDirectories: 0,
                complete: true,
              },
              sessions: [
                {
                  id: 'sandbox-1',
                  executionId: 'run-1',
                  executionIds: ['execution-1'],
                  eventCountsByExecutionId: { 'execution-1': 1 },
                  backendType: 'opencode',
                  transportEvents: 'complete',
                  eventCount: 1,
                  messageCount: 1,
                  nativeSessionId: null,
                  sidecarImageDigest: `sha256:${'a'.repeat(64)}`,
                  sidecarBundleRevision: 'b'.repeat(40),
                  nativeStore: {
                    scope: 'session' as const,
                    roots: [{ scope: 'session-home' as const, path: '/home/agent' }],
                    inventory: {
                      scannedFiles: 1,
                      reportedFiles: 1,
                      scannedDirectories: 0,
                      reportedDirectories: 0,
                      scannedSymlinks: 0,
                      reportedSymlinks: 0,
                      skippedEntries: 0,
                    },
                    complete: true,
                    entries: [],
                    excludedPaths: [],
                  },
                  processStreams: {
                    complete: true,
                    streamCount: 1,
                    stdinBytes: 0,
                    stdoutBytes: 1,
                    stderrBytes: 0,
                    protocolBytes: 0,
                  },
                  nativeEvents: { complete: true, count: 1 },
                },
              ],
              missing: [],
            },
          }
        },
        async record() {
          order.push('record')
        },
      },
      context,
      async () => {
        await box.delete()
      },
    )
    expect(order).toEqual(['capture', 'record', 'delete'])
    expect(receipt).toMatchObject({
      boxId: 'raw-box',
      coverageComplete: true,
      sessionExecutionIds: { 'sandbox-1': ['execution-1'] },
    })
  })
  it('keeps a box when a dispatched execution is absent from the retained raw evidence', async () => {
    const artifacts = artifactStore()
    const order: string[] = []
    const box = {
      id: 'held-box',
      async delete() {
        order.push('delete')
      },
    } as unknown as SandboxInstance
    await expect(
      captureBeforeDestroy(
        {
          timeoutMs: 5_000,
          artifacts,
          async capture() {
            return {
              snapshot: await snapshot(artifacts, 'held-run'),
              provenance: {
                status: 'reported' as const,
                environmentId: 'held-box',
                executionId: 'held-run',
                workspace: {
                  scannedFiles: 0,
                  scannedDirectories: 0,
                  reportedFiles: 0,
                  reportedDirectories: 0,
                  complete: true,
                },
                sessions: [],
                missing: [],
              },
            }
          },
          async record(receipt) {
            expect(receipt.coverageComplete).toBe(false)
            expect(receipt.incompleteReason).toContain('session-1')
            order.push('record')
          },
        },
        {
          box,
          executionId: 'held-run',
          profile: testProfile('held-box'),
          sandboxSessionIds: ['session-1'],
          sessionExecutionIds: { 'session-1': ['execution-1'] },
        },
        async () => {
          await box.delete()
        },
      ),
    ).rejects.toThrow('session-1')
    expect(order).toEqual(['record'])
  })

  it.each([
    ['complete', true, 'native-1'],
    ['missing-attempts', false, null],
    ['identity-conflict', false, null],
    ['wrong-execution', false, null],
    ['missing-process', false, null],
  ] as const)(
    'reconciles %s attempt evidence before deleting the source',
    async (variant, expectedComplete, expectedNativeSessionId) => {
      const artifacts = artifactStore()
      const { provider, destroyed } = providerFor(doneStream())
      const executor = providerAsExecutor(provider, {
        workspaceRetention: {
          timeoutMs: 5_000,
          requireCompleteProvenance: true,
          artifacts,
          async capture(context) {
            return {
              snapshot: await snapshot(artifacts, context.executionId),
              provenance: {
                status: 'reported' as const,
                environmentId: context.environment.id,
                executionId: context.executionId,
                workspace: {
                  scannedFiles: 1,
                  scannedDirectories: 0,
                  reportedFiles: 1,
                  reportedDirectories: 0,
                  complete: true,
                },
                sessions: [
                  {
                    id: 'sandbox-session-1',
                    executionId: context.executionId,
                    executionIds: ['sidecar-execution-1'],
                    eventCountsByExecutionId: { 'sidecar-execution-1': 1 },
                    backendType: 'opencode',
                    transportEvents: 'complete',
                    eventCount: 1,
                    messageCount: 1,
                    nativeSessionId: variant === 'identity-conflict' ? 'other-native' : null,
                    sidecarImageDigest: `sha256:${'a'.repeat(64)}`,
                    sidecarBundleRevision: 'b'.repeat(40),
                    nativeStore: {
                      scope: 'session' as const,
                      roots: [{ scope: 'session-home' as const, path: '/home/agent' }],
                      inventory: {
                        scannedFiles: 1,
                        reportedFiles: 1,
                        scannedDirectories: 0,
                        reportedDirectories: 0,
                        scannedSymlinks: 0,
                        reportedSymlinks: 0,
                        skippedEntries: 0,
                      },
                      complete: true,
                      entries: [],
                      excludedPaths: [],
                    },
                    processStreams: {
                      complete: true,
                      streamCount: 1,
                      stdinBytes: 0,
                      stdoutBytes: 2,
                      stderrBytes: 0,
                      protocolBytes: 0,
                    },
                    nativeEvents: { complete: true, count: 1 },
                  },
                ],
                ...(variant === 'missing-attempts'
                  ? {}
                  : {
                      attempts: [
                        {
                          executionId:
                            variant === 'wrong-execution'
                              ? 'wrong-sidecar-execution'
                              : 'sidecar-execution-1',
                          ordinal: 1,
                          providerSessionId: 'provider-session-1',
                          nativeSessionIds: ['native-1'],
                          processIds: variant === 'missing-process' ? [] : ['process-1'],
                          outcome: 'succeeded' as const,
                          missingReasons: [],
                        },
                      ],
                    }),
                missing: [],
              },
            }
          },
        },
      })(
        { profile: testProfile('raw-evidence'), harness: null },
        { signal: new AbortController().signal, seams: {} },
      )
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        /* drain */
      }
      const capture = (executor.resultArtifact().out as ProviderLeafOut).workspaceCapture
      expect(capture).toMatchObject({
        coverageComplete: expectedComplete,
        nativeSessionId: expectedNativeSessionId,
      })
      if (variant === 'complete') {
        expect(capture).toMatchObject({
          providerSessionId: null,
          provenance: {
            attempts: [
              {
                executionId: 'sidecar-execution-1',
                ordinal: 1,
                nativeSessionIds: ['native-1'],
              },
            ],
          },
        })
      } else {
        expect(capture?.incompleteReason).toBeTruthy()
      }
      expect(destroyed()).toBe(expectedComplete ? 1 : 0)
    },
  )
  it('keeps the source when complete native coverage is required but unavailable', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(doneStream())
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        requireCompleteProvenance: true,
        artifacts,
        async capture(context) {
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported' as const,
              environmentId: context.environment.id,
              workspace: {
                scannedFiles: 1,
                scannedDirectories: 0,
                reportedFiles: 1,
                reportedDirectories: 0,
                complete: true,
              },
              sessions: [
                {
                  id: 'session-1',
                  executionId: context.executionId,
                  transportEvents: 'complete',
                  eventCount: 1,
                  messageCount: 1,
                  nativeRollout: 'unavailable',
                },
              ],
              missing: ['Native rollout unavailable'],
            },
          }
        },
      },
    })(
      { profile: testProfile('strict-retention'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      /* drain */
    }
    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceCapture).toMatchObject({
      coverageComplete: false,
      incompleteReason: expect.stringContaining('Native rollout unavailable'),
      snapshot: out.workspaceSnapshot,
    })
    expect((executor.resultArtifact() as { teardown?: unknown }).teardown).toMatchObject({
      failed: true,
      error: expect.stringContaining('Native rollout unavailable'),
    })
    expect(destroyed()).toBe(0)
  })
  it.each([false, true])(
    'publishes one verified partial archive across teardown retries; first publication rejected=$rejectFirstPublication',
    async (rejectFirstPublication) => {
      const artifacts = artifactStore()
      const profile = testProfile('steerable-strict-retention')
      const { provider, destroyed } = providerFor(doneStream())
      const receipts: ProviderWorkspaceCaptureReceipt[] = []
      let captureCalls = 0
      const box = await providerAsSandboxClient(provider, {
        retentionIdentity: { executionId: 'node-strict', profile },
        onWorkspaceCaptured: (receipt) => {
          receipts.push(receipt)
          if (rejectFirstPublication && receipts.length === 1)
            throw new Error('publication unavailable')
        },
        workspaceRetention: {
          timeoutMs: 5_000,
          requireCompleteProvenance: true,
          artifacts,
          async capture(context) {
            captureCalls++
            return {
              snapshot: await snapshot(artifacts, context.executionId),
              provenance: {
                status: 'reported' as const,
                environmentId: context.environment.id,
                missing: ['Native rollout unavailable'],
              },
            }
          },
        },
      }).create({ backend: { type: 'opencode', profile } })
      if (rejectFirstPublication) {
        await expect(box.delete()).rejects.toThrow('publication unavailable')
      }
      await Promise.all(
        Array.from({ length: 3 }, () =>
          expect(box.delete()).rejects.toThrow('Native rollout unavailable'),
        ),
      )
      expect(captureCalls).toBe(1)
      expect(receipts).toHaveLength(rejectFirstPublication ? 2 : 1)
      expect(receipts[0]).toBe(receipts.at(-1))
      expect(destroyed()).toBe(0)
      expect([receipts[0]]).toMatchObject([
        {
          executionId: 'node-strict',
          environmentId: 'retention-environment',
          coverageComplete: false,
          incompleteReason: expect.stringContaining('Native rollout unavailable'),
        },
      ])
      expect(receipts[0]?.snapshot.archive).toBeDefined()
    },
  )
  it('preserves a steerable source until its workspace is verified', async () => {
    const artifacts = artifactStore()
    const profile = testProfile('steerable-retention')
    const { provider, destroyed } = providerFor(doneStream())
    let accepted = false
    const receipts: unknown[] = []
    const box = await providerAsSandboxClient(provider, {
      retentionIdentity: { executionId: 'node-1', profile },
      onWorkspaceCaptured: (receipt) => {
        receipts.push(receipt)
      },
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          expect(context.executionId).toBe('node-1')
          expect(context.environment.id).toBe('retention-environment')
          expect(context.nativeSessionId).toBeNull()
          if (!accepted) throw new Error('archive unavailable')
          return snapshot(artifacts, context.executionId)
        },
      },
    }).create({ backend: { type: 'opencode', profile } })
    await expect(box.delete()).rejects.toThrow('archive unavailable')
    expect(destroyed()).toBe(0)
    accepted = true
    // A failed capture is not silently retried by the same box's cleanup path.
    await expect(box.delete()).rejects.toThrow('archive unavailable')
    expect(destroyed()).toBe(0)
    const retry = await providerAsSandboxClient(provider, {
      retentionIdentity: { executionId: 'node-1-retry', profile },
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    }).create({ backend: { type: 'opencode', profile } })
    await retry.delete()
    expect(destroyed()).toBe(1)
    expect(receipts).toEqual([])
  })
  it('captures and verifies a normal stream before destroying its source', async () => {
    const artifacts = artifactStore()
    const profile = testProfile('retention-normal')
    const { provider, environment, destroyed } = providerFor(doneStream())
    let seen: ProviderWorkspaceRetentionContext | undefined
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          seen = context
          return {
            snapshot: await snapshot(artifacts, context.executionId),
            provenance: {
              status: 'reported' as const,
              provider: context.environment.provider,
              environmentId: context.environment.id,
              missing: ['Native harness rollout unavailable'],
            },
          }
        },
      },
    })({ profile, harness: null }, { signal: new AbortController().signal, seams: {} })

    const events = executor.execute('task', new AbortController().signal)
    for await (const _event of events as AsyncIterable<UsageEvent>) {
      // Drain the provider lifecycle.
    }

    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceSnapshot).toBeDefined()
    expect(out.workspaceCapture).toMatchObject({
      executionId: seen?.executionId,
      environmentId: environment.id,
      providerSessionId: null,
      nativeSessionId: null,
      snapshot: out.workspaceSnapshot,
      provenance: { status: 'reported', missing: ['Native harness rollout unavailable'] },
    })
    expect(seen?.environment).toBe(environment)
    expect(seen?.executionId).toBeTruthy()
    expect(seen?.profile).toBe(profile)
    expect(seen?.signal.aborted).toBe(false)
    expect(destroyed()).toBe(1)
  })

  it('copies the native session while a turn runs and once more when an abort closes its stream', async () => {
    const artifacts = artifactStore()
    const { provider } = providerFor(async function* () {
      yield {
        type: 'usage',
        data: { usageMode: 'delta' },
        usage: { inputTokens: 5, outputTokens: 7 },
      }
      // The turn never ends on its own: the deadline closes the stream at this yield.
      await new Promise<never>(() => {})
    })
    const phases: string[] = []
    let workspaceCaptures = 0
    // The default turn mapping names no session: a one-shot turn's copy is attributed by its
    // execution id, which the provider records as the stream starts.
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture() {
          workspaceCaptures += 1
          throw new Error('Tangle workspace exceeds evidence byte limit')
        },
        nativeIntervalMs: 5,
        async captureNative(context) {
          phases.push(context.phase ?? 'none')
          const captured = await nativeSnapshot(artifacts, context)
          return {
            ...captured,
            provenance: { ...captured.provenance, workspaceScope: 'none' as const },
          }
        },
      },
    })(
      { profile: testProfile('native-mirror'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const iterator = (
      executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>
    )[Symbol.asyncIterator]()
    await iterator.next()
    for (let waited = 0; !phases.includes('running') && waited < 2_000; waited += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(phases).toContain('running')
    // `return()` runs the generator's `finally` and skips its `catch`: the path that kept no
    // session before. The workspace here is over its byte bound, so its capture at teardown
    // fails too, and the native copy is the only record of the session.
    await iterator.return?.(undefined)
    expect(workspaceCaptures).toBe(1)
    expect(phases.at(-1)).toBe('interrupted')
    const transcript = executor.harnessTranscript?.()
    expect(transcript).toMatchObject({ status: 'retained' })
    if (transcript?.status !== 'retained') throw new Error('expected a retained native transcript')
    expect(transcript.descriptor.source.executionId).toBeTruthy()
    expect(transcript.descriptor.files.map((file) => file.attribution.nativePath)).toEqual([
      'any/transcript.jsonl',
    ])
  })

  it('retains a running workspace before a failed final capture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-live-workspace-'))
    try {
      await writeFile(join(directory, 'proof.txt'), 'written before teardown\n')
      const base = artifactStore()
      const artifacts: AgentCandidateOutputArtifactPort = {
        ...base,
        async putStream(input) {
          const chunks: Uint8Array[] = []
          for await (const chunk of input.chunks) chunks.push(chunk)
          return base.put({ ...input, bytes: Buffer.concat(chunks) })
        },
        async *readStream(ref) {
          yield await base.read(ref)
        },
        async locate(ref) {
          return base.bytes.has(ref.sha256.slice(7))
            ? {
                ...ref,
                locator: {
                  kind: 's3' as const,
                  bucket: 'provider-retention-tests',
                  key: ref.sha256.slice(7),
                },
              }
            : undefined
        },
      }
      const { provider } = providerFor(async function* () {
        yield {
          type: 'usage',
          data: { usageMode: 'delta' },
          usage: { inputTokens: 1, outputTokens: 1 },
        }
        await new Promise<never>(() => {})
      })
      let captured: AgentCandidateWorkspaceTree | undefined
      const executor = providerAsExecutor(provider, {
        workspaceRetention: {
          timeoutMs: 5_000,
          artifacts,
          capture: async () => {
            throw new Error('final capture unavailable')
          },
          liveIntervalMs: 5,
          async captureLive(context) {
            captured = await captureAgentCandidateWorkspaceTreeToArtifacts(directory, {
              artifactPersistence: {
                executionId: context.executionId,
                outputArtifacts: artifacts,
                signal: context.signal,
              },
            })
            return captured
          },
        },
      })(
        { profile: testProfile('live-workspace'), harness: null },
        { signal: new AbortController().signal, seams: {} },
      )
      const iterator = (
        executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>
      )[Symbol.asyncIterator]()
      await iterator.next()
      for (let waited = 0; captured === undefined && waited < 2_000; waited += 5)
        await new Promise((resolve) => setTimeout(resolve, 5))
      expect(captured).toBeDefined()
      await iterator.return?.(undefined)
      const material = await verifyAgentCandidateWorkspaceTree(captured!, artifacts)
      expect(material.files.map((file) => file.path)).toEqual(['proof.txt'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('stops live workspace captures when a turn closed by its consumer keeps its environment', async () => {
    // Discovery run terraform-dc-model-20261010h-c1 (Runtime 0.314.0): a budget stop closed five
    // directors' turns in environments kept for recovery, and their live captures ran on against
    // stopped boxes until the settled supervisor was killed, up to 18 hours later.
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(async function* () {
      yield {
        type: 'usage',
        data: { usageMode: 'delta' },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
      await new Promise<never>(() => {})
    })
    let liveCaptures = 0
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
        liveIntervalMs: 5,
        async captureLive() {
          liveCaptures += 1
          throw new Error('Sandbox is not running (status: stopped)')
        },
      },
    })(
      { profile: testProfile('live-workspace-kept'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const iterator = (
      executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>
    )[Symbol.asyncIterator]()
    await iterator.next()
    for (let waited = 0; liveCaptures === 0 && waited < 2_000; waited += 5)
      await new Promise((resolve) => setTimeout(resolve, 5))
    expect(liveCaptures).toBeGreaterThan(0)
    await iterator.return?.(undefined)
    expect(destroyed()).toBe(0)
    const atEnd = liveCaptures
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(liveCaptures).toBe(atEnd)
    await executor.teardown('brutalKill')
  })

  it('stops the live workspace capture in flight when its turn ends', async () => {
    // A copy in flight holds a capture slot and a timer that keeps the process alive, for up to
    // its own bound (15 minutes on terraform-dc-model-20261010h-c1, whose live copies of stopped
    // boxes timed out at 900000ms, one after another).
    const artifacts = artifactStore()
    const { provider } = providerFor(async function* () {
      yield {
        type: 'usage',
        data: { usageMode: 'delta' },
        usage: { inputTokens: 1, outputTokens: 1 },
      }
      await new Promise<never>(() => {})
    })
    let started = 0
    let stopped = 0
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 3_600_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
        liveIntervalMs: 5,
        liveTimeoutMs: 900_000,
        captureLive(context) {
          started += 1
          return new Promise<never>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                stopped += 1
                reject(context.signal.reason)
              },
              { once: true },
            )
          })
        },
      },
    })(
      { profile: testProfile('live-workspace-in-flight'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const iterator = (
      executor.execute('task', new AbortController().signal) as AsyncIterable<UsageEvent>
    )[Symbol.asyncIterator]()
    await iterator.next()
    for (let waited = 0; started === 0 && waited < 2_000; waited += 5)
      await new Promise((resolve) => setTimeout(resolve, 5))
    expect([started, stopped]).toEqual([1, 0])
    await iterator.return?.(undefined)
    await vi.waitFor(() => expect(stopped).toBe(1), { timeout: 1_000 })
    expect(started).toBe(1)
    await executor.teardown('brutalKill')
  })

  it('refuses executor reuse while a retained source environment is still live', async () => {
    const artifacts = artifactStore()
    let creates = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      create: () => {
        creates += 1
      },
    })
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-live-reuse'), harness: null },
      {
        signal: new AbortController().signal,
        seams: {},
      },
    )
    for await (const _event of executor.execute(
      'first',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Leave the source live with destroyOnSettle=false.
    }
    expect(creates).toBe(1)

    await expect(async () => {
      for await (const _event of executor.execute(
        'second',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The reuse guard runs before provider.create.
      }
    }).rejects.toThrow(/still live/)
    expect(creates).toBe(1)
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: true })
    expect(destroyed()).toBe(1)

    await expect(async () => {
      for await (const _event of executor.execute(
        'third',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // A new run needs a new executor and materialization receipt.
      }
    }).rejects.toThrow(/already materialized/)
    expect(creates).toBe(1)
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(destroyed()).toBe(1)
  })

  it('refuses a second provider run before creating an untracked environment', async () => {
    let creates = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      create: () => {
        creates += 1
      },
    })
    const executor = providerAsExecutor(provider)(
      { profile: testProfile('cleanup-generation'), harness: null },
      {
        signal: new AbortController().signal,
        seams: {},
      },
    )

    for await (const _event of executor.execute(
      'first',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // The first stream destroys the shared environment.
    }
    await expect(async () => {
      for await (const _event of executor.execute(
        'second',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // A second create would have no pending materialization acknowledgement.
      }
    }).rejects.toThrow(/already materialized/)
    expect(creates).toBe(1)
    expect(destroyed()).toBe(1)
  })

  it('keeps a failed stream source alive because no settled artifact can carry its snapshot', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(async function* () {
      yield* []
      throw new Error('stream failed')
    })
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-failed'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )

    await expect(async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The stream fails before it yields a terminal event.
      }
    }).rejects.toThrow('stream failed')
    expect(destroyed()).toBe(0)
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    expect(destroyed()).toBe(0)
  })

  it('keeps a cancelled stream source alive and records a cancelled capture outcome', async () => {
    const artifacts = artifactStore()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const { provider, destroyed } = providerFor(async function* (input) {
      started()
      await new Promise<never>((_resolve, reject) => {
        if (input.signal?.aborted) {
          reject(new Error('stream cancelled'))
          return
        }
        input.signal?.addEventListener('abort', () => reject(new Error('stream cancelled')), {
          once: true,
        })
      })
    })
    let outcome: unknown
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => {
          outcome = context.outcome
          return snapshot(artifacts, context.executionId)
        },
      },
    })(
      { profile: testProfile('retention-cancelled'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const signal = new AbortController()
    const running = (async () => {
      for await (const _event of executor.execute(
        'task',
        signal.signal,
      ) as AsyncIterable<UsageEvent>) {
        // Wait for cancellation.
      }
    })()
    await startedPromise
    await executor.cancel?.({ operationId: 'cancel-retention' })
    await expect(running).rejects.toThrow()
    expect(outcome).toMatchObject({ success: false, errorCode: 'cancelled' })
    expect(destroyed()).toBe(0)
  })

  it('does not delete during a cancellation and teardown race', async () => {
    const artifacts = artifactStore()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    let finish!: () => void
    const finishPromise = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { provider, destroyed } = providerFor(async function* () {
      started()
      // Deliberately ignore cancellation until teardown has returned.
      await finishPromise
      yield* []
      throw new Error('race cancelled')
    })
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-race'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    const running = (async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The source waits for the cancellation signal.
      }
    })()
    await startedPromise
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    expect(destroyed()).toBe(0)
    finish()
    await expect(running).rejects.toThrow('race cancelled')
    expect(destroyed()).toBe(0)
  })

  it.each(['corrupt', 'missing'] as const)(
    'preserves the source when the %s archive cannot be read',
    async (kind) => {
      const artifacts = artifactStore()
      const stored = await snapshot(artifacts, `persist-${kind}`)
      if (!('locator' in stored.archive))
        throw new Error('test snapshot must use a durable archive')
      const key = stored.archive.sha256.slice(7)
      if (kind === 'corrupt') artifacts.bytes.set(key, Uint8Array.from(Buffer.from('corrupt')))
      else artifacts.bytes.delete(key)
      const { provider, destroyed } = providerFor(doneStream())
      const executor = providerAsExecutor(provider, {
        workspaceRetention: {
          timeoutMs: 5_000,
          artifacts,
          capture: async () => stored,
        },
      })(
        { profile: testProfile(`retention-${kind}`), harness: null },
        { signal: new AbortController().signal, seams: {} },
      )

      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // Verification fails before source destruction; the settled turn stands.
      }
      const out = executor.resultArtifact().out as ProviderLeafOut
      expect(out.workspaceCaptureFailure).toMatch(/artifact|archive|digest|length/)
      expect(out).not.toHaveProperty('workspaceSnapshot')
      expect(destroyed()).toBe(0)
      await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    },
  )

  it('settles the turn with a failed capture and never lets a late capture authorize destruction', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(doneStream())
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 10,
        artifacts,
        async capture(context) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return await snapshot(artifacts, context.executionId)
        },
      },
    })(
      { profile: testProfile('retention-timeout'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )

    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // The capture barrier times out after the stream has settled.
    }
    // A capture deadline is evidence about the workspace, never the settled turn's outcome.
    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceCaptureFailure).toBe(
      'provider workspace retention timed out after 10ms; source environment preserved',
    )
    expect(out).not.toHaveProperty('workspaceSnapshot')
    expect(executor.heldEnvironments?.()).toMatchObject([{ keptFor: 'evidence' }])
    expect(destroyed()).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(destroyed()).toBe(0)
  })

  it('coalesces duplicate teardown calls after one verified capture', async () => {
    const artifacts = artifactStore()
    let releaseDestroy!: () => void
    const destroyGate = new Promise<void>((resolve) => {
      releaseDestroy = resolve
    })
    const { provider, destroyed } = providerFor(doneStream(), {
      destroy: async () => await destroyGate,
    })
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => snapshot(artifacts, context.executionId),
      },
    })(
      { profile: testProfile('retention-duplicate-teardown'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep the source alive until the explicit teardown calls below.
    }

    const first = executor.teardown('brutalKill')
    const second = executor.teardown('brutalKill')
    await Promise.resolve()
    expect(destroyed()).toBe(1)
    releaseDestroy()
    await expect(Promise.all([first, second])).resolves.toEqual([
      { destroyed: true },
      { destroyed: true },
    ])
  })

  it('retries an ordinary teardown after a transient destroy failure', async () => {
    let attempts = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      destroy: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('transient destroy failure')
      },
    })
    const executor = providerAsExecutor(provider, { destroyOnSettle: false })(
      { profile: testProfile('retention-retry'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep cleanup explicit so both attempts are observable.
    }

    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(destroyed()).toBe(2)
  })

  it('preserves the source when recapture finds changed live bytes after a failed destroy', async () => {
    const artifacts = artifactStore()
    let captures = 0
    let destroys = 0
    const { provider, destroyed } = providerFor(doneStream(), {
      destroy: async () => {
        destroys += 1
        if (destroys === 1) throw new Error('transient destroy failure')
      },
    })
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          captures += 1
          return (
            await captureAgentCandidateWorkspaceFiles(
              [
                {
                  path: 'revision.txt',
                  mode: 0o644,
                  bytes: Uint8Array.from(Buffer.from(`revision-${captures}`)),
                },
              ],
              {
                artifactPersistence: {
                  executionId: context.executionId,
                  outputArtifacts: artifacts,
                },
              },
            )
          ).snapshot
        },
      },
    })(
      { profile: testProfile('retention-recapture'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep cleanup explicit.
    }

    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    expect(captures).toBe(2)
    expect(destroyed()).toBe(1)
  })

  it('preserves the settled failure outcome across a transient destroy retry', async () => {
    const artifacts = artifactStore()
    const outcomes: Array<ProviderWorkspaceRetentionContext['outcome']> = []
    let destroys = 0
    const { provider, destroyed } = providerFor(
      async function* () {
        yield {
          type: 'result',
          data: { finalText: 'failed', success: false, error: 'provider reported failure' },
        }
      },
      {
        destroy: async () => {
          destroys += 1
          if (destroys === 1) throw new Error('transient destroy failure')
        },
      },
    )
    const executor = providerAsExecutor(provider, {
      destroyOnSettle: false,
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          outcomes.push(context.outcome)
          return await snapshot(artifacts, context.executionId)
        },
      },
    })(
      { profile: testProfile('retention-failure-outcome-retry'), harness: null },
      {
        signal: new AbortController().signal,
        seams: {},
      },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Keep cleanup explicit so both capture generations are observable.
    }

    await expect(executor.teardown('brutalKill')).resolves.toMatchObject({ destroyed: false })
    await expect(executor.teardown('brutalKill')).resolves.toEqual({ destroyed: true })
    expect(outcomes).toHaveLength(2)
    expect(outcomes[0]).toMatchObject({ success: false, error: 'provider reported failure' })
    expect(outcomes[1]).toEqual(outcomes[0])
    expect(destroyed()).toBe(2)
  })

  it.each([true, false])(
    'projects retained native transcripts after success=%s without scanning HOME',
    async (success) => {
      const artifacts = artifactStore()
      const { provider, environment, destroyed } = providerFor(async function* () {
        yield {
          type: 'result',
          data: { finalText: 'output', success, ...(success ? {} : { error: 'research failed' }) },
        }
      })
      const read = vi.fn(async () => {
        throw new Error('legacy HOME read forbidden')
      })
      const exec = vi.fn(async () => {
        throw new Error('legacy HOME exec forbidden')
      })
      Object.assign(environment, { read, exec })
      const executor = providerAsExecutor(provider, {
        workspaceRetention: {
          timeoutMs: 5_000,
          artifacts,
          capture: (context) => nativeSnapshot(artifacts, context),
        },
      })(
        { profile: testProfile('native-retention'), harness: null },
        { signal: new AbortController().signal, seams: {} },
      )
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
      }
      expect(executor.harnessTranscript?.()).toMatchObject({ status: 'retained', fileCount: 1 })
      const out = executor.resultArtifact().out as ProviderLeafOut
      expect(out.workspaceSnapshot).toBeDefined()
      expect(out.workspaceCapture?.executionId).toBeDefined()
      expect(destroyed()).toBe(1)
      expect(read).not.toHaveBeenCalled()
      expect(exec).not.toHaveBeenCalled()
    },
  )

  it('keeps verified retention and the successful outcome when transcript projection rejects duplicate identities', async () => {
    const artifacts = artifactStore()
    const { provider, destroyed } = providerFor(doneStream())
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          const result = await nativeSnapshot(artifacts, context)
          const session = result.provenance.sessions[0]!
          session.nativeStore.entries.push(session.nativeStore.entries[0]!)
          return result
        },
      },
    })(
      { profile: testProfile('native-projection-failure'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
    }
    expect(executor.harnessTranscript?.()).toMatchObject({
      status: 'unavailable',
      reason: 'retained-projection-failed',
    })
    const out = executor.resultArtifact().out as ProviderLeafOut
    expect(out.workspaceSnapshot).toBeDefined()
    expect(out.workspaceCapture?.snapshot).toEqual(out.workspaceSnapshot)
    expect(out.content).toBe('done')
    expect(destroyed()).toBe(1)
  })

  it('keeps a retained failed execution alive through teardown and release', async () => {
    const artifacts = artifactStore()
    const provider = pendingRetainedProvider()
    const admissions: RetainedRunAdmission[] = []
    const retained: RetainedExecutorContext = {
      executionId: 'retained-workspace-execution',
      preserveEnvironment: true,
      admissions,
      onAdmission: async (admission) => {
        admissions.push(admission)
      },
      onResult: async () => {},
    }
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        capture: (context) => nativeSnapshot(artifacts, context),
      },
    })(
      { profile: testProfile('retention-retained-release'), harness: null },
      {
        signal: new AbortController().signal,
        seams: { [retainedExecutorSeamKey]: retained },
      },
    )

    await expect(async () => {
      for await (const _event of executor.execute(
        'task',
        new AbortController().signal,
      ) as AsyncIterable<UsageEvent>) {
        // The fixture omits a terminal event, so the retained execution remains pending.
      }
    }).rejects.toThrow(/retained result unavailable|requires reconciliation/)
    const receipts = await executor.releaseRetained?.(new AbortController().signal)
    expect(executor.harnessTranscript?.()).toMatchObject({ status: 'retained', fileCount: 1 })
    expect(receipts).toHaveLength(1)
    expect(receipts?.[0]).toMatchObject({ destroyed: false })
    expect(await executor.teardown('brutalKill')).toMatchObject({ destroyed: false })
  })

  it('detaches a mutable callback snapshot before verification and publication', async () => {
    const artifacts = artifactStore()
    const { provider } = providerFor(doneStream())
    let callbackSnapshot!: AgentCandidateWorkspaceSnapshotEvidence
    const executor = providerAsExecutor(provider, {
      workspaceRetention: {
        timeoutMs: 5_000,
        artifacts,
        async capture(context) {
          callbackSnapshot = structuredClone(
            await snapshot(artifacts, context.executionId),
          ) as AgentCandidateWorkspaceSnapshotEvidence
          return callbackSnapshot
        },
      },
    })(
      { profile: testProfile('retention-detached'), harness: null },
      { signal: new AbortController().signal, seams: {} },
    )
    for await (const _event of executor.execute(
      'task',
      new AbortController().signal,
    ) as AsyncIterable<UsageEvent>) {
      // Drain the normal stream.
    }
    const published = (executor.resultArtifact().out as ProviderLeafOut).workspaceSnapshot
    if (!published) throw new Error('expected published workspace snapshot')
    expect(published).not.toBe(callbackSnapshot)
    expect(Object.isFrozen(published)).toBe(true)
    ;(callbackSnapshot as { digest: string }).digest = `sha256:${'0'.repeat(64)}`
    expect(published.digest).not.toBe(callbackSnapshot.digest)
  })
})

it('verifies provider retention through the artifact stream when the port supports it', async () => {
  const stored = artifactStore()
  const captured = await snapshot(stored, 'execution-1')
  let reads = 0
  const artifacts: AgentCandidateOutputArtifactPort = {
    ...stored,
    async read() {
      throw new Error('buffered retention read is forbidden')
    },
    async *readStream(ref) {
      reads += 1
      yield await stored.read(ref)
    },
  }
  const { environment } = providerFor(doneStream())
  const result = await captureProviderWorkspaceSnapshot(
    {
      timeoutMs: 5_000,
      artifacts,
      capture: async () => captured,
    },
    {
      environment,
      executionId: 'execution-1',
      profile: testProfile('streamed-retention'),
    },
  )
  expect(result.snapshot).toEqual(captured)
  expect(reads).toBe(2)
})

describe('provider capture admission', () => {
  function gate() {
    let open!: () => void
    const ready = new Promise<void>((resolve) => {
      open = resolve
    })
    return { ready, open }
  }

  async function fixture() {
    const artifacts = artifactStore()
    const captured = await snapshot(artifacts, 'admission-fixture')
    const { environment } = providerFor(doneStream())
    const capture = (port: ProviderWorkspaceRetentionPort, executionId: string) =>
      captureProviderWorkspaceSnapshot(port, {
        environment: { ...environment, id: `box-${executionId}` },
        executionId,
        profile: testProfile(`profile-${executionId}`),
      })
    return { artifacts, captured, capture }
  }

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses invalid capture bound %s before invoking the provider',
    async (maxConcurrentCaptures) => {
      const f = await fixture()
      const capture = vi.fn(async () => f.captured)
      await expect(
        f.capture(
          {
            timeoutMs: 5_000,
            maxConcurrentCaptures,
            artifacts: f.artifacts,
            capture,
          },
          'invalid',
        ),
      ).rejects.toThrow('maxConcurrentCaptures must be a positive safe integer')
      expect(capture).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, 2])(
    'bounds separate environments sharing one port, bound=%s',
    async (bound) => {
      const f = await fixture()
      const blocked = gate()
      const entered: string[] = []
      let active = 0
      let peak = 0
      const port: ProviderWorkspaceRetentionPort = {
        timeoutMs: 5_000,
        ...(bound === undefined ? {} : { maxConcurrentCaptures: bound }),
        artifacts: f.artifacts,
        async capture({ executionId }) {
          entered.push(executionId)
          peak = Math.max(peak, ++active)
          try {
            await blocked.ready
            return f.captured
          } finally {
            active--
          }
        },
      }
      const captures = Array.from({ length: 6 }, (_, index) => f.capture(port, String(index)))
      await vi.waitFor(() => expect(entered).toHaveLength(bound ?? 6))
      expect(entered).toEqual(Array.from({ length: bound ?? 6 }, (_, index) => String(index)))
      blocked.open()
      await Promise.all(captures)
      expect(entered).toEqual(['0', '1', '2', '3', '4', '5'])
      expect(peak).toBe(bound ?? 6)
    },
  )

  it('keeps distinct retention objects independent', async () => {
    const f = await fixture()
    const blocked = gate()
    let entered = 0
    const port: ProviderWorkspaceRetentionPort = {
      timeoutMs: 5_000,
      maxConcurrentCaptures: 1,
      artifacts: f.artifacts,
      async capture() {
        entered++
        await blocked.ready
        return f.captured
      },
    }
    const first = f.capture(port, 'first')
    const second = f.capture({ ...port }, 'second')
    await vi.waitFor(() => expect(entered).toBe(2))
    blocked.open()
    await Promise.all([first, second])
  })

  it('holds the slot through streamed artifact verification after the callback returns', async () => {
    const f = await fixture()
    const reading = gate()
    const verified = gate()
    let entered = 0
    const port: ProviderWorkspaceRetentionPort = {
      timeoutMs: 5_000,
      maxConcurrentCaptures: 1,
      artifacts: {
        ...f.artifacts,
        async *readStream(ref) {
          reading.open()
          await verified.ready
          yield await f.artifacts.read(ref)
        },
      },
      async capture() {
        entered++
        return f.captured
      },
    }
    const first = f.capture(port, 'first')
    await reading.ready
    const second = f.capture(port, 'second')
    await Promise.resolve()
    expect(entered).toBe(1)
    verified.open()
    await Promise.all([first, second])
    expect(entered).toBe(2)
  })

  it.each(['capture', 'verification'] as const)(
    'releases admission after %s failure',
    async (failure) => {
      const f = await fixture()
      let captures = 0
      let reads = 0
      const port: ProviderWorkspaceRetentionPort = {
        timeoutMs: 5_000,
        maxConcurrentCaptures: 1,
        artifacts: {
          ...f.artifacts,
          async read(ref) {
            if (failure === 'verification' && reads++ === 0) throw new Error('read failed')
            return f.artifacts.read(ref)
          },
        },
        async capture() {
          if (captures++ === 0 && failure === 'capture') throw new Error('capture failed')
          return f.captured
        },
      }
      const first = f.capture(port, 'first')
      const second = f.capture(port, 'second')
      await expect(first).rejects.toThrow(failure === 'capture' ? 'capture failed' : 'read failed')
      await expect(second).resolves.toMatchObject({ snapshot: f.captured })
      expect(captures).toBe(2)
    },
  )

  it('withdraws timed-out waiters while charging late I/O until its actual settlement', async () => {
    const f = await fixture()
    const blocked = gate()
    const entered: string[] = []
    const port: ProviderWorkspaceRetentionPort = {
      timeoutMs: 100,
      maxConcurrentCaptures: 1,
      artifacts: f.artifacts,
      async capture({ executionId }) {
        entered.push(executionId)
        if (executionId === 'first') await blocked.ready
        return f.captured
      },
    }
    vi.useFakeTimers()
    try {
      const first = f.capture(port, 'first').catch((error: unknown) => error)
      const withdrawn = f.capture(port, 'withdrawn').catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(100)
      expect(await first).toMatchObject({ message: expect.stringContaining('timed out') })
      expect(await withdrawn).toMatchObject({ message: expect.stringContaining('timed out') })
      const next = f.capture(port, 'next')
      await vi.advanceTimersByTimeAsync(0)
      expect(entered).toEqual(['first'])
      blocked.open()
      await expect(next).resolves.toMatchObject({ snapshot: f.captured })
      expect(entered).toEqual(['first', 'next'])
    } finally {
      blocked.open()
      vi.useRealTimers()
    }
  })
})
