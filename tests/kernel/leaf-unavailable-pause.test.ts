import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEAF_CONTINUATION_TASK,
  type ProviderExecutorOptions,
  providerAsExecutor,
} from '../../src/runtime/environment-provider'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, ExecutorFactory, Scope, SpawnEvent } from '../../src/runtime/supervise/types'
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
}

/**
 * A retained provider whose Nth dispatch fails with `failure(N)` as the turn's outcome. A refused
 * turn reports no usage, the way a refusal before any model output does; a served turn reports
 * 3 input and 2 output tokens.
 */
async function leafFixture(options: {
  readonly failure: (dispatch: number) => string | undefined
  readonly executor?: Omit<ProviderExecutorOptions, 'destroyOnSettle'>
  /** Refused turns spend this much before their refusal. */
  readonly refusedUsage?: { readonly inputTokens: number; readonly outputTokens: number }
}) {
  const root = await mkdtemp(join(tmpdir(), 'leaf-unavailable-'))
  roots.push(root)
  const stateFile = join(root, 'provider.json')
  const runDir = join(root, 'run')
  const context = createFileRunContext(runDir)
  const dispatches: Dispatch[] = []
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
          async *events(eventOptions): AsyncIterable<AgentEnvironmentEvent> {
            yield* session.events!(eventOptions)
          },
          result: async () => ({
            ...(await session.result()),
            usage:
              failure === undefined
                ? { inputTokens: 3, outputTokens: 2 }
                : (options.refusedUsage ?? { inputTokens: 0, outputTokens: 0 }),
            ...(failure === undefined ? {} : { success: false, error: failure }),
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
    unavailablePause: { unavailablePauseMs: 5, maxUnavailablePauseMs: 20 },
    ...options.executor,
  }
  const profile = testAgentProfile('leaf')
  const worker = (): Agent<unknown, unknown> =>
    Object.assign(
      { name: 'leaf', act: async () => 'unused' },
      {
        executorSpec: {
          profile,
          harness: profile.harness,
          executorFactory: providerAsExecutor(provider(), executorOptions),
        },
      },
    )
  const run = (
    act: (scope: Scope<string>) => Promise<string>,
    recoverExecutor?: ExecutorFactory<unknown>,
    journal = context.journal,
  ) =>
    createSupervisor<string, string>().run(
      { name: 'root', act: (_task, scope) => act(scope) },
      'root-task',
      {
        ...createFileRunContext(runDir),
        runId: 'root',
        budget: { maxIterations: 10, maxTokens: 100 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
          taskDigest: canonicalCandidateDigest('root-task'),
        },
        journal,
        ...(recoverExecutor ? { recoverExecutor } : {}),
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
    creates: () => creates,
    leafEvents,
    liveEnvironments,
  }
}

describe('a leaf whose model provider refuses its turn for capacity', () => {
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

  it('ends at cancellation during a pause, settling the refused turn and releasing its box', async () => {
    const fixture = await leafFixture({
      failure: () => ROUTER_QUOTA,
      executor: { unavailablePause: { unavailablePauseMs: 60_000 } },
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

  it('recovers a continuation after the process stops, in the same box, without another dispatch', async () => {
    const fixture = await leafFixture({
      failure: (dispatch) => (dispatch === 1 ? ROUTER_QUOTA : undefined),
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
          event.admission.turnId.includes(':input:')
        ) {
          stopped = true
          throw new Error('process stopped')
        }
      },
    }
    await fixture.run(
      async (scope) => {
        scope.spawn(fixture.worker(), 'task', {
          key: 'work',
          label: 'work',
          budget: { maxIterations: 1, maxTokens: 10 },
        })
        await scope.next()
        return 'first process'
      },
      undefined,
      stopping,
    )
    expect(stopped).toBe(true)
    expect(fixture.dispatches).toHaveLength(2)

    const resumed = await fixture.run(
      async (scope) => {
        if (scope.view.inFlight > 0) {
          const settled = await scope.next()
          if (settled?.kind !== 'done') throw new Error('the continuation did not complete')
        }
        const replayed = scope.spawn(fixture.worker(), 'task', {
          key: 'work',
          label: 'work',
          budget: { maxIterations: 1, maxTokens: 10 },
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
    expect(fixture.dispatches).toHaveLength(2)
    expect(fixture.creates()).toBe(1)
    const events = await fixture.leafEvents()
    expect(events.filter((event) => event.kind === 'settled')).toMatchObject([{ status: 'done' }])
  })
})
