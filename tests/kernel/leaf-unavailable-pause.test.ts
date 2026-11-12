import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSessionStatus,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ProviderExecutorOptions,
  providerAsExecutor,
} from '../../src/runtime/environment-provider/provider-executor-admission'
import { LEAF_CONTINUATION_TASK } from '../../src/runtime/environment-provider/provider-executor-lifecycle'
import {
  type BoundHarnessSession,
  captureBoundHarnessTranscript,
  type HarnessTranscriptEvidence,
  harnessTranscriptArtifact,
} from '../../src/runtime/harness-transcript'
import { readHarnessTranscriptSessions } from '../../src/runtime/harness-transcript-sessions'
import { BUDGET_CONTINUATION_TASK } from '../../src/runtime/supervise/retained-executor'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, ExecutorFactory, Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import { promptOptionsFromAgentTurnInput } from '../../src/runtime/turn-input'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from './test-agent-profile'

// The refusal that ended 15 of 23 down children of play anomaly-referee-v3d on 2026-09-24. Five
// of five children in one lead lane had run 3 to 9 minutes and spent 117k to 856k input tokens.
const ROUTER_QUOTA =
  'opencode execution failed: No provider served model "deepseek/deepseek-v4.1-flash" ' +
  '(provider_quota_exhausted). A provider is configured and was called. (exit code 1)'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

interface Dispatch {
  readonly environmentId: string
  readonly sessionId: string | undefined
  readonly prompt: string | undefined
  readonly profile: AgentProfile | undefined
  readonly turnId: string | undefined
  readonly executionId: string | undefined
}

/**
 * A retained provider whose Nth dispatch fails with `failure(N)` as the turn's outcome. A refused
 * turn reports no usage, the way a refusal before any model output does; a served turn reports
 * 3 input and 2 output tokens.
 */
async function leafFixture(options: {
  readonly failure: (dispatch: number) => string | undefined
  readonly failureCode?: string
  readonly profile?: AgentProfile
  readonly costMode?: 'known' | 'estimated'
  readonly executor?: Omit<ProviderExecutorOptions, 'destroyOnSettle'>
  readonly terminalStatus?: AgentSessionStatus
  /** Refused turns spend this much before their refusal. */
  readonly refusedUsage?: { readonly inputTokens: number; readonly outputTokens: number }
}) {
  const root = await mkdtemp(join(tmpdir(), 'leaf-unavailable-'))
  roots.push(root)
  const stateFile = join(root, 'provider.json')
  const runDir = join(root, 'run')
  const context = createFileRunContext(runDir)
  const dispatches: Dispatch[] = []
  const executors: ReturnType<ExecutorFactory<unknown>>[] = []
  const failedExecutions = new Map<string, string>()
  let creates = 0
  const provider = (): AgentEnvironmentProvider => {
    const base = durableRetainedProvider(stateFile)
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      dispatch: async (turn) => {
        dispatches.push({
          environmentId: environment.id,
          sessionId: turn.sessionId,
          prompt: turn.prompt,
          profile: promptOptionsFromAgentTurnInput(turn).backend?.profile,
          turnId: turn.turnId,
          executionId: turn.executionId,
        })
        const dispatched = await environment.dispatch!(turn)
        const failure = options.failure(dispatches.length)
        if (failure !== undefined)
          failedExecutions.set(dispatched.controlRef!.executionId!, failure)
        return dispatched
      },
      session: (id, sessionOptions) => {
        const session = environment.session!(id, sessionOptions)
        const failure = failedExecutions.get(sessionOptions?.controlRef?.executionId ?? '')
        return {
          ...session,
          ...(options.terminalStatus === undefined
            ? {}
            : { status: async () => options.terminalStatus! }),
          async *events(eventOptions): AsyncIterable<AgentEnvironmentEvent> {
            if (failure !== undefined && options.failureCode !== undefined) {
              yield {
                type: 'error',
                data: {
                  error: failure,
                  code: options.failureCode,
                  executionId: session.controlRef?.executionId,
                  sessionId: session.id,
                },
              }
            }
            if (options.costMode !== undefined) {
              yield {
                type: 'llm_call',
                data: {
                  usageMode: 'cumulative',
                  tokensIn: failure === undefined ? 3 : (options.refusedUsage?.inputTokens ?? 0),
                  tokensOut: failure === undefined ? 2 : (options.refusedUsage?.outputTokens ?? 0),
                  costUsd: failure === undefined ? 0.5 : 0.25,
                  costProvenance: options.costMode === 'known' ? 'billing-receipt' : 'uncaptured',
                  ...(options.costMode === 'estimated' ? { usdKnown: false } : {}),
                },
              }
            }
            yield* session.events!(eventOptions)
          },
          result: async () => ({
            ...(await session.result()),
            usage:
              failure === undefined
                ? { inputTokens: 3, outputTokens: 2 }
                : (options.refusedUsage ?? { inputTokens: 0, outputTokens: 0 }),
            ...(failure === undefined
              ? {}
              : {
                  success: false,
                  error: failure,
                }),
          }),
        }
      },
    })
    return {
      ...base,
      create: async (input) => {
        creates += 1
        return wrap(await base.create(input))
      },
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
  }
  const executorOptions: ProviderExecutorOptions = {
    destroyOnSettle: true,
    defaults: { workspace: { cwd: { base: 'host', path: root } } },
    unavailablePause: { unavailablePauseMs: 5, maxUnavailablePauseMs: 20 },
    ...options.executor,
  }
  const profile = options.profile ?? testAgentProfile('leaf')
  const recordingExecutorFactory = (): ExecutorFactory<unknown> => {
    const factory = createExecutor({
      backend: 'provider',
      provider: provider(),
      ...executorOptions,
    })
    return (spec, ctx) => {
      const executor = factory(spec, ctx)
      executors.push(executor)
      return executor
    }
  }
  const worker = (): Agent<unknown, unknown> =>
    Object.assign(
      { name: 'leaf', act: async () => 'unused' },
      {
        executorSpec: {
          profile,
          harness: profile.harness,
          executorFactory: recordingExecutorFactory(),
        },
      },
    )
  const run = (
    act: (scope: Scope<string>) => Promise<string>,
    recoverExecutor?: ExecutorFactory<unknown>,
    journal = context.journal,
    budgetStopHoldMs?: number,
  ) =>
    createSupervisor<string, string>().run(
      { name: 'root', act: (_task, scope) => act(scope) },
      'root-task',
      {
        ...context,
        runId: 'root',
        budget: { maxIterations: 10, maxTokens: 100 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
          taskDigest: canonicalCandidateDigest('root-task'),
        },
        journal,
        ...(recoverExecutor ? { recoverExecutor } : {}),
        ...(budgetStopHoldMs === undefined ? {} : { budgetStopHoldMs }),
      },
    )
  const leafEvents = async (): Promise<SpawnEvent[]> =>
    ((await context.journal.loadTree('root')) ?? []).filter((event) => event.id === 'root:s0')
  const liveEnvironments = async (): Promise<string[]> =>
    Object.keys(JSON.parse(await readFile(stateFile, 'utf8')).environments)
  return {
    context,
    provider,
    worker,
    executorOptions,
    run,
    dispatches,
    executors,
    creates: () => creates,
    leafEvents,
    liveEnvironments,
  }
}

type NativeCaptureRequest = Parameters<NonNullable<ProviderExecutorOptions['harnessTranscript']>>[0]

async function nativeCapture(request: NativeCaptureRequest) {
  if (!request.controlRef) throw new Error('missing exact provider control reference')
  const session: BoundHarnessSession = {
    nativeSessionId: `native-${request.controlRef.sessionId}`,
    children: [],
    integrity: { truncated: false, unparsedRecords: 0, gaps: [] },
  }
  const bytes = Buffer.from(JSON.stringify({ ...session, run: request.controlRef.runId }))
  return captureBoundHarnessTranscript({
    harness: request.harness,
    binding: {
      kind: 'provider',
      controlRef: request.controlRef,
      node: request.node,
      sessionId: request.controlRef.sessionId,
      nativeSessionId: session.nativeSessionId,
      profileDigest: request.profileDigest,
      runs: [{ runId: request.controlRef.runId, requestDigest: request.controlRef.requestDigest }],
    },
    nativeSessionId: session.nativeSessionId,
    files: [
      { path: 'native.jsonl', nativeSessionId: session.nativeSessionId, byteLength: bytes.length },
    ],
    read: async () => bytes,
    parse: (text) => JSON.parse(text) as BoundHarnessSession,
    signal: request.signal,
  })
}

describe('a leaf whose model provider refuses its turn for capacity', () => {
  it('retains a verified native receipt for every exact invocation before reusing or deleting its environment', async () => {
    const captures: NativeCaptureRequest[] = []
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch <= 2 ? 'Usage window exhausted' : undefined),
      failureCode: 'rate_limit_error',
      terminalStatus: 'completed',
      executor: {
        harnessTranscript: async (request) => {
          captures.push(request)
          return nativeCapture(request)
        },
      },
    })
    await fixture.run(async (scope) => {
      scope.spawn(
        fixture.worker(),
        { instruction: 'Return an answer', trigger: { key: 'case-1' } },
        {
          key: 'work',
          budget: { maxIterations: 1, maxTokens: 100 },
        },
      )
      expect((await scope.next())?.kind).toBe('done')
      return 'completed'
    })
    expect(captures).toHaveLength(3)
    expect(new Set(captures.map((capture) => capture.controlRef!.executionId)).size).toBe(3)
    const events = await fixture.leafEvents()
    const inputs = events.filter((event) => event.kind === 'execution-input')
    const outputs = events.filter((event) => event.kind === 'execution-result')
    const receipts = events.filter((event) => event.kind === 'execution-evidence')
    expect(inputs).toHaveLength(3)
    expect(outputs).toHaveLength(3)
    expect(receipts).toHaveLength(3)
    for (const [index, event] of receipts.entries()) {
      const wrapper = (await fixture.context.blobs.get(event.outRef)) as {
        node: NonNullable<NativeCaptureRequest['node']>
        taskRef: string
        outRef: string
        harnessTranscript: HarnessTranscriptEvidence
      }
      expect(wrapper).toMatchObject({
        kind: 'harness-transcript',
        schemaVersion: 1,
        node: captures[index]!.node,
        taskRef: inputs[index]!.taskRef,
        outRef: outputs[index]!.outRef,
        harnessTranscript: { status: 'available', coverageComplete: true },
      })
      expect(events.indexOf(event)).toBeLessThan(
        index + 1 === inputs.length ? events.length : events.indexOf(inputs[index + 1]!),
      )
      const artifact = await harnessTranscriptArtifact(
        wrapper.harnessTranscript,
        fixture.context.blobs,
      )
      expect(artifact?.binding).toMatchObject({
        kind: 'provider',
        controlRef: captures[index]!.controlRef,
      })
      const loaded = await readHarnessTranscriptSessions(
        wrapper.harnessTranscript,
        fixture.context.blobs,
        {
          node: wrapper.node,
          readSessions: async (value) =>
            value.files.map((file) => JSON.parse(file.content) as BoundHarnessSession),
        },
      )
      expect(loaded.succeeded).toBe(true)
    }
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it.each([
    'capture-failure',
    'foreign-binding',
    'unconfirmed-stop',
    'persistence-failure',
  ] as const)('preserves the native source and records the gap after %s', async (fault) => {
    let reads = 0
    const fixture = await leafFixture({
      failure: () => undefined,
      terminalStatus: fault === 'unconfirmed-stop' ? 'running' : 'completed',
      executor: {
        harnessTranscript: async (request) => {
          reads += 1
          if (fault === 'capture-failure') throw new Error('native export failed')
          return nativeCapture(
            fault === 'foreign-binding'
              ? { ...request, controlRef: { ...request.controlRef!, runId: 'another-run' } }
              : request,
          )
        },
      },
    })
    if (fault === 'persistence-failure') {
      const put = fixture.context.blobs.put.bind(fixture.context.blobs)
      fixture.context.blobs.put = async (ref, value) => {
        if (value && typeof value === 'object' && 'files' in value && 'binding' in value)
          throw new Error('native blob store unavailable')
        return put(ref, value)
      }
    }
    const running = fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 100 },
      })
      await scope.next()
      return 'completed'
    })
    if (fault === 'persistence-failure')
      await expect(running).rejects.toThrow(/durable state unavailable/)
    else await running
    if (fault === 'unconfirmed-stop') expect(reads).toBe(0)
    else expect(reads).toBeGreaterThan(0)
    expect(await fixture.liveEnvironments()).toHaveLength(1)
    // Storage failure closes the durable writer; no later receipt can be promised.
    if (fault === 'persistence-failure') return
    const wrappers = await Promise.all(
      (await fixture.leafEvents())
        .filter((event) => event.kind === 'execution-evidence')
        .map((event) => fixture.context.blobs.get(event.outRef)),
    )
    expect(wrappers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'harness-transcript',
          harnessTranscript: expect.objectContaining({ status: 'unavailable' }),
        }),
      ]),
    )
  })

  it('repairs one exact invocation on explicit retained release without running the agent again', async () => {
    let reads = 0
    const fixture = await leafFixture({
      failure: () => undefined,
      terminalStatus: 'completed',
      executor: {
        harnessTranscript: async (request) => {
          if (++reads === 1) throw new Error('temporary native export failure')
          return nativeCapture(request)
        },
      },
    })
    await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 100 },
      })
      await scope.next()
      return 'completed'
    })
    expect(fixture.dispatches).toHaveLength(1)
    expect(reads).toBe(1)
    expect(await fixture.liveEnvironments()).toHaveLength(1)
    const released = await fixture.executors[0]!.releaseRetained!(new AbortController().signal)
    expect(released).toEqual([expect.objectContaining({ destroyed: true })])
    expect(reads).toBe(2)
    expect(await fixture.liveEnvironments()).toEqual([])
    const receipts = (await Promise.all(
      (
        await fixture.leafEvents()
      )
        .filter((event) => event.kind === 'execution-evidence')
        .map((event) => fixture.context.blobs.get(event.outRef)),
    )) as Array<{
      node: { attemptId: string }
      taskRef: string
      outRef: string
      harnessTranscript: HarnessTranscriptEvidence
    }>
    expect(receipts.map((receipt) => receipt.harnessTranscript.status)).toEqual([
      'unavailable',
      'available',
    ])
    expect(new Set(receipts.map((receipt) => receipt.node.attemptId)).size).toBe(1)
    expect(new Set(receipts.map((receipt) => receipt.taskRef)).size).toBe(1)
    expect(new Set(receipts.map((receipt) => receipt.outRef)).size).toBe(1)
  })

  it('does not attribute the previous result to a failed continuation or its repaired capture', async () => {
    let reads = 0
    let validations = 0
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch === 1 ? 'Usage window exhausted' : undefined),
      failureCode: 'rate_limit_error',
      terminalStatus: 'completed',
      executor: {
        harnessTranscript: async (request) => {
          reads += 1
          if (reads === 2 || reads === 3) throw new Error('temporary native export failure')
          return nativeCapture(request)
        },
        validator: {
          async validate() {
            if (++validations === 2) throw new Error('validation transport failed')
            return { valid: true, score: 1 }
          },
        },
      },
    })
    await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 100 },
      })
      await scope.next()
      return 'completed'
    })
    await fixture.executors[0]!.releaseRetained!(new AbortController().signal)
    expect(fixture.dispatches).toHaveLength(2)
    const events = await fixture.leafEvents()
    const inputs = events.filter((event) => event.kind === 'execution-input')
    const receipts = (await Promise.all(
      events
        .filter((event) => event.kind === 'execution-evidence')
        .map((event) => fixture.context.blobs.get(event.outRef)),
    )) as Array<{ taskRef: string; outRef?: string; harnessTranscript: HarnessTranscriptEvidence }>
    const failed = receipts.filter((receipt) => receipt.taskRef === inputs[1]!.taskRef)
    expect(failed.map((receipt) => receipt.harnessTranscript.status)).toEqual([
      'unavailable',
      'available',
    ])
    expect(failed.every((receipt) => !Object.hasOwn(receipt, 'outRef'))).toBe(true)
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it('continues typed quota refusals with distinct native invocation identities in one session', async () => {
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch <= 2 ? 'Usage window exhausted' : undefined),
      failureCode: 'rate_limit_error',
      refusedUsage: { inputTokens: 4, outputTokens: 1 },
    })
    const runResult = await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 100 },
      })
      expect((await scope.next())?.kind).toBe('done')
      return 'completed'
    })
    expect(runResult.kind).toBe('winner')
    const events = await fixture.leafEvents()
    const inputs = events.filter((event) => event.kind === 'execution-input')
    expect(fixture.creates()).toBe(1)
    expect(fixture.dispatches).toHaveLength(3)
    expect(inputs).toHaveLength(3)
    expect(new Set(fixture.dispatches.map((dispatch) => dispatch.executionId)).size).toBe(3)
    expect(new Set(fixture.dispatches.map((dispatch) => dispatch.sessionId)).size).toBe(1)
    expect(inputs.every((event) => event.workspaceRetention !== true)).toBe(true)
    expect(events.filter((event) => event.kind === 'paused')).toMatchObject([
      { signal: 'rate_limit_error' },
      { signal: 'rate_limit_error' },
    ])
    expect(events.filter((event) => event.kind === 'settled')).toMatchObject([
      { status: 'done', spent: { iterations: 1, tokens: { input: 11, output: 4 } } },
    ])
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it('carries the exact subscription profile through typed quota re-entry and cold environment lookup', async () => {
    const profile: AgentProfile = {
      name: 'subscription-leaf',
      harness: 'claude-code',
      model: {
        provider: 'anthropic',
        default: 'claude-opus-5-5',
        reasoningEffort: 'high',
        metadata: { credentialSource: 'subscription' },
      },
      tools: {},
    }
    const fixture = await leafFixture({
      profile,
      failure: (count) => (count === 1 ? 'Subscription capacity refused' : undefined),
      failureCode: 'rate_limit_error',
    })
    const result = await fixture.run(async (scope) => {
      expect(
        scope.spawn(fixture.worker(), 'Retain the research context', {
          key: 'work',
          budget: { maxIterations: 1, maxTokens: 10 },
        }).ok,
      ).toBe(true)
      expect((await scope.next())?.kind).toBe('done')
      return 'completed'
    })
    expect(result.kind).toBe('winner')
    expect(fixture.creates()).toBe(1)
    expect(fixture.dispatches).toHaveLength(2)
    expect(fixture.dispatches.map((turn) => turn.profile)).toEqual([profile, profile])
    expect(new Set(fixture.dispatches.map((turn) => turn.sessionId)).size).toBe(1)
    expect(new Set(fixture.dispatches.map((turn) => turn.executionId)).size).toBe(2)
    expect(new Set(fixture.dispatches.map((turn) => turn.turnId)).size).toBe(2)
    expect((await fixture.leafEvents()).filter((event) => event.kind === 'paused')).toMatchObject([
      { signal: 'rate_limit_error' },
    ])
  })

  it('pauses, continues in the same environment and session, and completes', async () => {
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch <= 3 ? ROUTER_QUOTA : undefined),
    })
    const result = await fixture.run(async (scope) => {
      expect(
        scope.spawn(fixture.worker(), 'Find the anomaly.', {
          key: 'work',
          budget: { maxIterations: 1, maxTokens: 10 },
        }).ok,
      ).toBe(true)
      const settled = await scope.next()
      expect(settled?.kind).toBe('done')
      return settled?.kind === 'done' ? 'completed' : 'lost'
    })
    expect(result.kind).toBe('winner')

    // One box for the whole leaf: three refused turns and the one that served ran in it.
    expect(fixture.creates()).toBe(1)
    expect(fixture.dispatches).toHaveLength(4)
    expect(new Set(fixture.dispatches.map((dispatch) => dispatch.environmentId)).size).toBe(1)
    expect(new Set(fixture.dispatches.map((dispatch) => dispatch.sessionId)).size).toBe(1)
    expect(fixture.dispatches[0]?.prompt).toBe('Find the anomaly.')
    expect(fixture.dispatches.slice(1).map((dispatch) => dispatch.prompt)).toEqual([
      LEAF_CONTINUATION_TASK,
      LEAF_CONTINUATION_TASK,
      LEAF_CONTINUATION_TASK,
    ])
    // The continuation tells the leaf what to do, never what the provider did.
    expect(LEAF_CONTINUATION_TASK).not.toMatch(/quota|provider|rate|outage|refus/iu)

    const events = await fixture.leafEvents()
    // Each continuation is its own invocation: an input, its admissions, its result.
    expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(4)
    expect(events.filter((event) => event.kind === 'execution-result')).toHaveLength(4)
    const pauses = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'paused' }> => event.kind === 'paused',
    )
    // Refused turns that did no work double the pause: 5, 10, then the 20 ms ceiling.
    expect(pauses.map((pause) => [pause.attempt, pause.signal, pause.pauseMs])).toEqual([
      [1, 'provider_quota_exhausted', 5],
      [2, 'provider_quota_exhausted', 10],
      [3, 'provider_quota_exhausted', 20],
    ])
    expect(pauses.every((pause) => pause.madeProgress === false)).toBe(true)
    expect(pauses[0]?.cause).toContain('provider_quota_exhausted')
    // One iteration, and the served turn's tokens: a pause is infrastructure, not work.
    expect(events.filter((event) => event.kind === 'settled')).toMatchObject([
      { status: 'done', spent: { iterations: 1, tokens: { input: 3, output: 2 } } },
    ])
    // The box is released once, after the last invocation.
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it('keeps the spend of refused turns that worked, and restarts the pause after work', async () => {
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch <= 2 ? ROUTER_QUOTA : undefined),
      refusedUsage: { inputTokens: 4, outputTokens: 1 },
    })
    await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 100 },
      })
      expect((await scope.next())?.kind).toBe('done')
      return 'completed'
    })
    const events = await fixture.leafEvents()
    const pauses = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'paused' }> => event.kind === 'paused',
    )
    // Each refused turn spent tokens first, so each pause restarts at the first one.
    expect(pauses.map((pause) => [pause.pauseMs, pause.madeProgress])).toEqual([
      [5, true],
      [5, true],
    ])
    // Two refused turns of 4 + 1 and the served turn of 3 + 2, on one cumulative total.
    expect(events.filter((event) => event.kind === 'settled')).toMatchObject([
      { status: 'done', spent: { iterations: 1, tokens: { input: 11, output: 4 } } },
    ])
    // Each result carries the execution's spend so far, so a recovery reads the whole of it.
    const results = events.filter(
      (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
        event.kind === 'execution-result',
    )
    expect(results.map((event) => event.spent.tokens.input)).toEqual([4, 8, 11])
  })

  it('ends at cancellation during a pause and releases its native box', async () => {
    const fixture = await leafFixture({
      failure: () => ROUTER_QUOTA,
      executor: {
        unavailablePause: { unavailablePauseMs: 60_000 },
      },
    })
    await fixture.run(async (scope) => {
      const spawned = scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 10 },
      })
      expect(spawned.ok).toBe(true)
      if (!spawned.ok) return 'refused'
      // Wait until the leaf is in its first pause, then cancel it.
      for (let wait = 0; wait < 200; wait += 1) {
        if ((await fixture.leafEvents()).some((event) => event.kind === 'paused')) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      spawned.handle.abort('operator cancelled')
      const settled = await scope.next()
      expect(settled).toMatchObject({ kind: 'down' })
      if (settled?.kind === 'down') expect(settled.reason).toContain('provider_quota_exhausted')
      return 'inspected'
    })
    expect(fixture.dispatches).toHaveLength(1)
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it('ends on the refused turn when the pause is turned off', async () => {
    const fixture = await leafFixture({
      failure: () => ROUTER_QUOTA,
      executor: { unavailablePause: false },
    })
    await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 10 },
      })
      expect(await scope.next()).toMatchObject({ kind: 'down', infra: true })
      return 'inspected'
    })
    expect(fixture.dispatches).toHaveLength(1)
    const events = await fixture.leafEvents()
    expect(events.some((event) => event.kind === 'paused')).toBe(false)
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it('does not continue a failure that is not a capacity refusal', async () => {
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch === 1 ? 'the harness exited: tool crashed' : undefined),
    })
    await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 10 },
      })
      expect(await scope.next()).toMatchObject({ kind: 'down' })
      return 'inspected'
    })
    expect(fixture.dispatches).toHaveLength(1)
  })

  it.each(
    [1, 2].flatMap((refusals) =>
      (['known', 'estimated'] as const).map((costMode) => ({ refusals, costMode })),
    ),
  )(
    'recovers cumulative spend without another dispatch (refusals=$refusals, cost=$costMode)',
    async ({ refusals, costMode }) => {
      const fixture = await leafFixture({
        failure: (dispatch) => (dispatch <= refusals ? ROUTER_QUOTA : undefined),
        refusedUsage: { inputTokens: 4, outputTokens: 1 },
        costMode,
      })
      // The first process stops right after the continuation's dispatch was admitted.
      const journal = fixture.context.journal
      let stopped = false
      const stopping = {
        beginTree: journal.beginTree.bind(journal),
        loadTree: journal.loadTree.bind(journal),
        appendEvent: async (tree: string, event: SpawnEvent) => {
          await journal.appendEvent(tree, event)
          if (
            !stopped &&
            event.kind === 'execution-admitted' &&
            event.admission.phase === 'dispatched' &&
            event.admission.turnId.endsWith(`:input:${refusals}:turn:0`)
          ) {
            stopped = true
            throw new Error('process stopped')
          }
        },
      }
      await expect(
        fixture.run(
          async (scope) => {
            scope.spawn(fixture.worker(), 'task', {
              key: 'work',
              label: 'work',
              budget: { maxIterations: 1, maxTokens: 100 },
            })
            await scope.next()
            return 'first process'
          },
          undefined,
          stopping,
        ),
      ).rejects.toThrow('durable state unavailable')
      expect(stopped).toBe(true)
      expect(fixture.dispatches).toHaveLength(refusals + 1)

      const resumed = await fixture.run(
        async (scope) => {
          if (scope.view.inFlight > 0) {
            const settled = await scope.next()
            if (settled?.kind !== 'done') throw new Error('the continuation did not complete')
          }
          const replayed = scope.spawn(fixture.worker(), 'task', {
            key: 'work',
            label: 'work',
            budget: { maxIterations: 1, maxTokens: 100 },
          })
          if (!replayed.ok || replayed.prior?.state !== 'completed') {
            throw new Error('expected the recovered result')
          }
          return 'recovered'
        },
        providerAsExecutor(fixture.provider(), fixture.executorOptions),
      )
      expect(resumed.kind).toBe('winner')
      // The recovery reconnected to the admitted continuation rather than dispatching again.
      expect(fixture.dispatches).toHaveLength(refusals + 1)
      expect(fixture.creates()).toBe(1)
      const events = await fixture.leafEvents()
      expect(events.filter((event) => event.kind === 'settled')).toMatchObject([
        {
          status: 'done',
          spent: {
            iterations: 1,
            tokens: { input: 4 * refusals + 3, output: refusals + 2 },
            usd: 0.25 * refusals + 0.5,
            ...(costMode === 'estimated'
              ? { usdKnown: false, usdEstimated: 0.25 * refusals + 0.5 }
              : {}),
          },
        },
      ])
    },
  )
  it('keeps native custody when a continued dispatch reply is lost', async () => {
    const fixture = await leafFixture({
      failure: (dispatch) => {
        if (dispatch === 2) throw new Error('continued dispatch reply lost')
        return ROUTER_QUOTA
      },
    })
    await fixture.run(async (scope) => {
      scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 100 },
      })
      await scope.next()
      return 'inspected'
    })
    expect(fixture.dispatches).toHaveLength(2)
    expect(await fixture.liveEnvironments()).toHaveLength(1)
  })
})

describe('a keyed leaf whose turn ends over its budget', () => {
  const teardowns = async (fixture: Awaited<ReturnType<typeof leafFixture>>) =>
    ((await fixture.context.journal.loadTree('root')) ?? []).filter(
      (event): event is Extract<SpawnEvent, { kind: 'environment-teardown' }> =>
        event.kind === 'environment-teardown',
    )

  it('keeps its box, and a same-key re-spawn with a budget continues the session in it', async () => {
    const fixture = await leafFixture({ failure: () => undefined })
    const result = await fixture.run(async (scope) => {
      // A served turn meters 3 + 2 tokens, past a 1-token budget.
      scope.spawn(fixture.worker(), 'Find the anomaly.', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 1 },
      })
      const first = await scope.next()
      expect(first).toMatchObject({
        kind: 'done',
        budgetViolation: { overspent: [{ channel: 'tokens' }] },
      })
      expect(await fixture.liveEnvironments()).toHaveLength(1)
      // Without a budget the key still returns its committed result and runs nothing.
      const same = scope.spawn(fixture.worker(), 'Find the anomaly.', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 1 },
      })
      expect(same).toMatchObject({ ok: true, prior: { state: 'completed' } })
      const more = scope.spawn(fixture.worker(), 'Find the anomaly.', {
        key: 'work',
        budget: { maxIterations: 1, maxTokens: 2 },
        continueHeld: true,
      })
      expect(more).toMatchObject({ ok: true, prior: { state: 'continued', priorId: 'root:s0' } })
      if (!more.ok) return 'refused'
      expect(more.handle.id).not.toBe('root:s0')
      // Still over its (larger) budget, so the successor holds the box until the join barrier.
      expect(await scope.next()).toMatchObject({ kind: 'done', budgetViolation: {} })
      return 'completed'
    })
    expect(result.kind).toBe('winner')
    expect(fixture.creates()).toBe(1)
    expect(fixture.dispatches).toHaveLength(2)
    expect(new Set(fixture.dispatches.map((turn) => turn.environmentId)).size).toBe(1)
    expect(new Set(fixture.dispatches.map((turn) => turn.sessionId)).size).toBe(1)
    expect(fixture.dispatches.map((turn) => turn.prompt)).toEqual([
      'Find the anomaly.',
      BUDGET_CONTINUATION_TASK,
    ])
    const events = (await fixture.context.journal.loadTree('root')) ?? []
    const successor = events.find(
      (event): event is Extract<SpawnEvent, { kind: 'spawned' }> =>
        event.kind === 'spawned' && event.successorOf === 'root:s0',
    )
    expect(successor).toMatchObject({
      key: 'work',
      continues: { ofWorker: 'root:s0', environmentId: fixture.dispatches[0]?.environmentId },
    })
    // Destroyed exactly once, at the join barrier, by the node that held it last.
    expect(await teardowns(fixture)).toMatchObject([
      { id: successor?.id, destroyed: true, heldRelease: 'scope-join' },
    ])
    expect(await fixture.liveEnvironments()).toEqual([])
  })

  it('releases the box at its hold ceiling when the manager never decides', async () => {
    const fixture = await leafFixture({ failure: () => undefined })
    await fixture.run(
      async (scope) => {
        scope.spawn(fixture.worker(), 'task', {
          key: 'work',
          budget: { maxIterations: 1, maxTokens: 1 },
        })
        expect((await scope.next())?.kind).toBe('done')
        // The manager is gone: no re-spawn, no join, for longer than the ceiling.
        for (let wait = 0; wait < 200; wait += 1) {
          if ((await fixture.liveEnvironments()).length === 0) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(await fixture.liveEnvironments()).toEqual([])
        // Released: the key now returns its committed result even when asked to continue.
        expect(
          scope.spawn(fixture.worker(), 'task', {
            key: 'work',
            budget: { maxIterations: 1, maxTokens: 50 },
            continueHeld: true,
          }),
        ).toMatchObject({ ok: true, prior: { state: 'completed' } })
        return 'inspected'
      },
      undefined,
      undefined,
      30,
    )
    expect(await teardowns(fixture)).toMatchObject([
      { id: 'root:s0', destroyed: true, heldRelease: 'hold-ceiling' },
    ])
    expect(fixture.dispatches).toHaveLength(1)
  })
})
