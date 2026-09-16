/**
 * A retained-pending child keeps its provider environment through the join barrier so that a
 * resumed process can reconcile the paid execution inside it. Measured 2026-09-11 on the Tangle
 * Sandbox fleet: 18 of 23 running sandboxes belonged to four Discovery Lab runs that had settled
 * `no-winner/all-children-down` 19 to 37 hours earlier. Each child's journal ended in a
 * `teardown-unconfirmed` record with no `settled` record, and later runs were refused with
 * `No available hosts with capacity`. Those runs were final (their settle record refuses
 * re-entry), so nothing could ever recover the environments, and nothing released them either.
 *
 * Whether a later process resumes a run is the caller's knowledge, so the rule these tests hold is
 * keyed on `retainedAtSettlement`. A run that will not be resumed — an in-memory run, or one whose
 * caller declares the settlement final — releases every retained environment at root settlement
 * and journals one receipt per environment, naming the provider's id. A durable run keeps them by
 * default, so an interrupted run is still recovered by its resume. A release the provider refuses
 * is receipted as a typed failure, and the node stays named as unconfirmed.
 *
 * A released environment can never be recovered, so the release also CLOSES the node's cursor
 * slot: the settlement the driver received at the reconcile is written as the terminal record,
 * marked `retainedExecution: 'released'`, under the seq the driver saw. Measured 2026-09-15: 0 of
 * 35 reconciled children on one pursuit ever settled, and 185 of 223 lost sandbox children across
 * 385 runs stopped at `reconciled` — read as `never-settled` and charged the ceiling although the
 * pool had committed the floor. A refused release writes nothing, because the environment may
 * still exist.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileObserverJournal } from '../../src/durable/observer-journal'
import { projectPursuit } from '../../src/durable/observer-projection'
import {
  closesCursorSlot,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { sumSpendFromEvents } from '../../src/runtime/supervise/recover-executors'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'
import {
  createFileRunContext,
  createInMemoryRunContext,
} from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  Executor,
  ExecutorFactory,
  NodeId,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  SupervisorOpts,
} from '../../src/runtime/supervise/types'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from './test-agent-profile'

/**
 * The durable test provider, with the one seam a retained failure needs: the provider admits and
 * dispatches the execution durably, then the result read is lost — the shape of every child in
 * the measured runs — until the test says the result is deliverable again.
 */
function retainedProvider(directory: string) {
  const stateFile = join(directory, 'provider.json')
  const state = {
    resultLost: true,
    /** What the lost read throws: a plain Error is exhibit 4's shape, unobservable by design. */
    resultError: () => new Error('provider result read lost'),
    foreignEvent: false,
    observe: undefined as ((signal: AbortSignal | undefined) => Promise<void>) | undefined,
    destroyFailure: undefined as Error | undefined,
    destroys: 0,
  }
  const provider = (): AgentEnvironmentProvider => {
    const base = durableRetainedProvider(stateFile)
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      session: (id, options) => {
        const session = environment.session!(id, options)
        return {
          ...session,
          async *events(eventOptions) {
            if (state.observe) await state.observe(eventOptions?.signal)
            if (state.foreignEvent) {
              // An event bound to another run: the runtime's own identity check must refuse it
              // as a contract violation, not as an unobservable execution (#1204).
              yield { type: 'message.part.updated', data: { delta: 'x', runId: 'another-run' } }
            }
            yield* session.events(eventOptions)
          },
          result: async () => {
            if (state.resultLost) throw state.resultError()
            return {
              ...(await session.result()),
              usage: { inputTokens: 3, outputTokens: 2 },
            }
          },
        }
      },
      destroy: async () => {
        state.destroys += 1
        if (state.destroyFailure) throw state.destroyFailure
        await environment.destroy!()
      },
    })
    return {
      ...base,
      create: async (input) => wrap(await base.create(input)),
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
  }
  /** The environment ids the provider still holds — the fleet listing, in miniature. */
  const environments = (): string[] =>
    existsSync(stateFile)
      ? Object.keys(
          (JSON.parse(readFileSync(stateFile, 'utf8')) as { environments: object }).environments,
        )
      : []
  return { state, provider, environments }
}

function retainedWorker(factory: ExecutorFactory<unknown>): Agent<unknown, unknown> {
  return Object.assign(
    { name: 'retained-child', act: async () => 'unused' },
    {
      executorSpec: {
        profile: testAgentProfile('retained-child'),
        harness: null,
        executorFactory: factory,
      },
    },
  )
}

async function spawnAndAwait(scope: Scope<unknown>, worker: Agent<unknown, unknown>) {
  expect(
    scope.spawn(worker, 'child task', { key: 'child', budget: { maxIterations: 1, maxTokens: 10 } })
      .ok,
  ).toBe(true)
  return await scope.next()
}

const releaseReceipts = (events: ReadonlyArray<SpawnEvent>) =>
  events.flatMap((event) => (event.kind === 'environment-teardown' ? [event] : []))

/** The records that close a node's cursor slot — exactly one for a released node, none while open. */
const terminalRecords = (events: ReadonlyArray<SpawnEvent>, id: string) =>
  events.filter((event) => event.id === id && closesCursorSlot(event))

const childPayloads = (hookEvents: ReadonlyArray<RuntimeHookEvent>, childId: string) =>
  hookEvents.flatMap((event) =>
    event.target === 'agent.child' &&
    (event.payload as { childId?: string } | undefined)?.childId === childId
      ? [{ stepIndex: event.stepIndex, payload: event.payload as Record<string, unknown> }]
      : [],
  )

const admittedEnvironmentId = (events: ReadonlyArray<SpawnEvent>, id: string) =>
  events.flatMap((event) =>
    event.kind === 'execution-admitted' &&
    event.id === id &&
    event.admission.phase === 'environment'
      ? [event.admission.environmentId]
      : [],
  )[0]

describe('retained environments at root settlement', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'retained-release-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('releases a retained-pending child environment when a run that cannot resume settles', async () => {
    const fleet = retainedProvider(directory)
    const context = createInMemoryRunContext()
    const hookEvents: RuntimeHookEvent[] = []
    let live: Settled<unknown> | undefined
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          const settled = await spawnAndAwait(
            scope,
            retainedWorker(providerAsExecutor(fleet.provider())),
          )
          expect(settled?.kind).toBe('down')
          live = settled
          // The retained execution was admitted and its result read lost: the environment is
          // alive at this point, exactly as the barrier used to leave it.
          expect(fleet.environments()).toHaveLength(1)
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'release',
        budget: { maxIterations: 2, maxTokens: 20 },
        hooks: {
          onEvent: (event) => {
            hookEvents.push(event)
          },
        },
      },
    )
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    // The provider no longer holds the environment, and the run no longer names a leak.
    expect(fleet.environments()).toEqual([])
    expect(result.teardownUnconfirmed).toBeUndefined()

    const events = (await context.journal.loadTree('release')) ?? []
    const environmentId = admittedEnvironmentId(events, 'release:s0')
    expect(environmentId).toMatch(/^environment-runtime:release:s0$/)
    // One receipt per environment, carrying the provider's own id — the id a fleet listing shows.
    expect(releaseReceipts(events)).toEqual([
      {
        kind: 'environment-teardown',
        id: 'release:s0',
        provider: 'durable-test',
        environmentId,
        destroyed: true,
        seq: 0,
        at: expect.any(String),
      },
    ])
    expect(events.some((event) => event.kind === 'teardown-unconfirmed')).toBe(false)

    // The driver's settlement said the slot was open and recoverable, and it carried the
    // transcript receipt the failure path read out of the live box.
    expect(live?.kind).toBe('down')
    if (live?.kind !== 'down') return
    expect(live.retainedExecution).toBe('pending')
    // A lost read on a plain Error is exhibit 4 of #1204: the execution may have run and nothing
    // local can say, so the refusal keeps its name — as a VALUE, not only in the reason text.
    expect(live.retainedPendingCause).toBe('unobservable')
    expect(live.harnessTranscript).toBeDefined()
    expect(live.reason).toContain('reconciliation')
    // The release closed the slot: exactly one terminal record, the settlement the driver
    // received verbatim (reason, infra, trace, transcript) under the seq it saw, marked as
    // released, carrying the reconciled floor and never the reservation ceiling. The
    // reconciled floor still exists beneath it, superseded.
    const terminal = terminalRecords(events, 'release:s0')
    expect(terminal).toEqual([
      {
        kind: 'settled',
        status: 'down',
        id: 'release:s0',
        retainedExecution: 'released',
        retainedPendingCause: 'unobservable',
        infra: true,
        reason: live.reason,
        spent: expect.objectContaining({ tokensKnown: false, usdKnown: false }),
        ...(live.providerModel === undefined ? {} : { providerModel: live.providerModel }),
        trace: live.trace,
        harnessTranscript: live.harnessTranscript,
        seq: 0,
        at: new Date(live.settledAt!).toISOString(),
      },
    ])
    expect(events.indexOf(terminal[0]!)).toBeGreaterThan(
      events.indexOf(releaseReceipts(events)[0]!),
    )
    expect(events.some((event) => event.kind === 'reconciled' && event.id === 'release:s0')).toBe(
      true,
    )
    // Every reader now agrees: the gap is a floor, not a ceiling; the total is still not a
    // measurement; the yield counts the node as down and released.
    expect(result.spendGaps).toEqual([
      expect.objectContaining({
        id: 'release:s0',
        kind: 'unreported',
        channels: expect.arrayContaining(['tokens', 'usd']),
      }),
    ])
    expect(result.spentTotal.tokensKnown).toBe(false)
    expect(result.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 1,
      cancelled: 0,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })
    expect(result.tree.nodes.find((node) => node.id === 'release:s0')).toMatchObject({
      status: 'failed',
      retainedExecution: 'released',
      retainedPendingCause: 'unobservable',
    })
    expect(await replaySpawnTree(context.journal, context.blobs, 'release')).toMatchObject([
      {
        kind: 'down',
        retainedExecution: 'released',
        retainedPendingCause: 'unobservable',
        settledAt: live.settledAt,
        seq: 0,
        harnessTranscript: live.harnessTranscript,
      },
    ])
    expect(
      materializeTreeView(events).nodes.find((node) => node.id === 'release:s0'),
    ).toMatchObject({ retainedExecution: 'released', retainedPendingCause: 'unobservable' })
    // Two `agent.child` events for one node: the settlement (pending, with the driver's metering
    // if any) and the release (released, no metering, the release instant beside the settlement).
    const payloads = childPayloads(hookEvents, 'release:s0')
    expect(payloads.map((entry) => entry.stepIndex)).toEqual([0, 0])
    expect(payloads.map((entry) => entry.payload)).toMatchObject([
      {
        status: 'down',
        retainedExecution: 'pending',
        retainedPendingCause: 'unobservable',
        settledAt: live.settledAt,
      },
      {
        status: 'down',
        retainedExecution: 'released',
        retainedPendingCause: 'unobservable',
        releasedAt: expect.any(Number),
        settledAt: live.settledAt,
      },
    ])
    expect(payloads[1]?.payload).not.toHaveProperty('metered')
  })

  it('names an event bound to another run a provider contract violation, on the live stream', async () => {
    const fleet = retainedProvider(directory)
    fleet.state.foreignEvent = true
    const context = createInMemoryRunContext()
    let live: Settled<unknown> | undefined
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          live = await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        },
      },
      'task',
      { ...context, runId: 'foreign', budget: { maxIterations: 4, maxTokens: 4000 } },
    )
    expect(result.kind).toBe('winner')
    expect(live?.kind).toBe('down')
    if (live?.kind !== 'down') return
    expect(live.retainedExecution).toBe('pending')
    expect(live.retainedPendingCause).toBe('provider-contract')
    expect(live.reason).toMatch(/provider contract violation; nothing to reconcile/u)
    expect(live.reason).toContain('provider returned an event for another retained run')
    const events = (await context.journal.loadTree('foreign')) ?? []
    expect(terminalRecords(events, 'foreign:s0')).toMatchObject([
      { retainedExecution: 'released', retainedPendingCause: 'provider-contract' },
    ])
  })

  it('names a lost transport as such on every surface, never as the safety refusal', async () => {
    // Exhibit 2 of #1204: the gateway answered the result read with an HTML 502. The Sandbox
    // SDK throws ServerError{status: 502}; the runtime wraps the failed read; the classifier
    // looks through the wrapper. Nothing needs reconciling; the transport failed.
    const fleet = retainedProvider(directory)
    fleet.state.resultError = () =>
      Object.assign(new Error('<!DOCTYPE html> tangle.tools | 502: Bad gateway'), {
        name: 'ServerError',
        code: 'SERVER_ERROR',
        status: 502,
      })
    const context = createInMemoryRunContext()
    const hookEvents: RuntimeHookEvent[] = []
    let live: Settled<unknown> | undefined
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          live = await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'contract',
        budget: { maxIterations: 4, maxTokens: 4000 },
        retainedAtSettlement: 'release',
        hooks: { onEvent: (event) => void hookEvents.push(event) },
      },
    )
    expect(result.kind).toBe('winner')
    expect(live?.kind).toBe('down')
    if (live?.kind !== 'down') return
    expect(live.retainedExecution).toBe('pending')
    expect(live.retainedPendingCause).toBe('transport')
    expect(live.reason).toMatch(/lost its transport; status in doubt/u)
    expect(live.reason).not.toMatch(/requires reconciliation/u)
    const events = (await context.journal.loadTree('contract')) ?? []
    expect(events.find((event) => event.kind === 'reconciled')).toMatchObject({
      retainedPendingCause: 'transport',
    })
    expect(terminalRecords(events, 'contract:s0')).toMatchObject([
      { retainedExecution: 'released', retainedPendingCause: 'transport' },
    ])
    expect(result.tree.nodes.find((node) => node.id === 'contract:s0')).toMatchObject({
      retainedPendingCause: 'transport',
    })
    expect(await replaySpawnTree(context.journal, context.blobs, 'contract')).toMatchObject([
      { retainedExecution: 'released', retainedPendingCause: 'transport' },
    ])
    expect(childPayloads(hookEvents, 'contract:s0').map((entry) => entry.payload)).toMatchObject([
      { retainedExecution: 'pending', retainedPendingCause: 'transport' },
      { retainedExecution: 'released', retainedPendingCause: 'transport' },
    ])
    // The released bucket counts it the same either way: the cause says what to do, not whether
    // the fleet lost the child.
    expect(result.fleetYield.releasedUnrecovered).toBe(1)
  })

  it('does not trip an armed intensity breaker with the released record', async () => {
    // The released record is the driver's earlier down re-stated after the join barrier. Counting
    // it would abort a run that has already settled and reclassify a delivered winner.
    const fleet = retainedProvider(directory)
    const context = createInMemoryRunContext()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'breaker',
        budget: { maxIterations: 2, maxTokens: 20 },
        maxRestarts: 0,
        withinMs: 60_000,
      },
    )
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    const events = (await context.journal.loadTree('breaker')) ?? []
    expect(terminalRecords(events, 'breaker:s0')).toMatchObject([
      { kind: 'settled', status: 'down', retainedExecution: 'released' },
    ])
    expect(result.fleetYield.releasedUnrecovered).toBe(1)
  })

  it('carries the overspend the pool committed onto the released record', async () => {
    // The retained reconcile returned a violation the pool committed (free tokens went negative).
    // The open-slot surfaces withhold it because the floor is not the execution's final spend —
    // but when the run releases the node, the floor IS its final charge, and a terminal record
    // that said 'within reservation' would disagree with the ledger.
    let released = false
    const executor: Executor<unknown> = {
      runtime: 'router',
      execute(): AsyncIterable<{ kind: 'tokens'; input: number; output: number }> {
        return (async function* () {
          yield { kind: 'tokens' as const, input: 900_000, output: 0 }
          throw new RetainedExecutionPendingError(new Error('provider still running'))
        })()
      },
      teardown: async () =>
        released ? { destroyed: true } : { destroyed: false, detail: 'retained' },
      releaseRetained: async () => {
        released = true
        return [{ provider: 'test', environmentId: 'environment-1', destroyed: true }]
      },
      resultArtifact: () => {
        throw new Error('retained executor has no result')
      },
    }
    const overspending: Agent<unknown, unknown> = Object.assign(
      { name: 'overspending', act: async () => 'unused' },
      { executorSpec: { profile: testAgentProfile('overspending'), harness: null, executor } },
    )
    const context = createInMemoryRunContext()
    let live: Settled<unknown> | undefined
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          expect(
            scope.spawn(overspending, 'task', {
              label: 'overspending',
              budget: { maxIterations: 4, maxTokens: 800_000 },
            }).ok,
          ).toBe(true)
          live = await scope.next()
          // Withheld while the slot is open, exactly as before.
          expect(live).toMatchObject({ kind: 'down', retainedExecution: 'pending' })
          expect(live).not.toHaveProperty('budgetViolation')
          expect(scope.view.nodes[0]).not.toHaveProperty('budgetViolation')
          return 'finished'
        },
      },
      'task',
      { ...context, runId: 'overspent', budget: { maxIterations: 100, maxTokens: 2_000_000 } },
    )
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    const violation = { overspent: [{ channel: 'tokens', reserved: 800_000, spent: 900_000 }] }
    const events = (await context.journal.loadTree('overspent')) ?? []
    expect(terminalRecords(events, 'overspent:s0')).toMatchObject([
      {
        kind: 'settled',
        status: 'down',
        retainedExecution: 'released',
        spent: { tokens: { input: 900_000, output: 0 }, tokensKnown: false },
        budgetViolation: violation,
      },
    ])
    expect(result.tree.nodes.find((node) => node.id === 'overspent:s0')).toMatchObject({
      retainedExecution: 'released',
      budgetViolation: violation,
    })
    expect(await replaySpawnTree(context.journal, context.blobs, 'overspent')).toMatchObject([
      { kind: 'down', retainedExecution: 'released', budgetViolation: violation },
    ])
  })

  it('writes nothing when the executor cannot confirm teardown after a destroyed receipt', async () => {
    // A refused release in its second form: the provider destroyed the environment, but the
    // executor's own teardown probe fails afterwards. The slot stays open — the run cannot prove
    // the environment is gone from the executor's side — and nothing terminal is written.
    const fleet = retainedProvider(directory)
    const context = createInMemoryRunContext()
    const factory = providerAsExecutor(fleet.provider())
    const probeFailsAfterRelease: ExecutorFactory<unknown> = (spec, ctx) => {
      const executor = factory(spec, ctx)
      let releasedOnce = false
      return {
        ...executor,
        teardown: async (grace) => {
          if (releasedOnce) throw new Error('teardown probe failed after release')
          return executor.teardown(grace)
        },
        releaseRetained: async (signal) => {
          const receipts = await executor.releaseRetained!(signal)
          releasedOnce = true
          return receipts
        },
      }
    }
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAndAwait(scope, retainedWorker(probeFailsAfterRelease))
          return 'finished'
        },
      },
      'task',
      { ...context, runId: 'unconfirmed', budget: { maxIterations: 2, maxTokens: 20 } },
    )
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    expect(fleet.environments()).toEqual([])
    expect(result.teardownUnconfirmed?.map((node) => node.id)).toEqual(['unconfirmed:s0'])
    const events = (await context.journal.loadTree('unconfirmed')) ?? []
    expect(releaseReceipts(events)).toMatchObject([{ id: 'unconfirmed:s0', destroyed: true }])
    expect(terminalRecords(events, 'unconfirmed:s0')).toEqual([])
    expect(result.tree.nodes.find((node) => node.id === 'unconfirmed:s0')).toMatchObject({
      retainedExecution: 'pending',
    })
    expect(result.spendGaps).toEqual([expect.objectContaining({ kind: 'never-settled' })])
    expect(result.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 0,
      cancelled: 0,
      neverSettled: 1,
      releasedUnrecovered: 0,
    })
  })

  it('closes the slot on an aborted run that declares release, so a later resume recovers nothing', async () => {
    // The sweep has no abort guard: under an explicit `'release'` a cancelled run still releases
    // and closes the slot. A resume that then arrives finds the node terminal and never attempts
    // recovery against an environment that no longer exists.
    const fleet = retainedProvider(directory)
    const runDirectory = join(directory, 'run')
    const common = {
      runId: 'abort-release',
      budget: { maxIterations: 2, maxTokens: 20 },
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ name: 'root' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
    } satisfies Partial<SupervisorOpts>
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(_task, scope) {
        if (scope.resume === undefined) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        }
        expect(scope.view.inFlight).toBe(0)
        return 'resumed'
      },
    }
    const abort = new AbortController()
    fleet.state.observe = async (signal) => {
      abort.abort(new Error('operator stopped the run'))
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('observation aborted'))
        if (signal === undefined || signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
      })
    }
    const aborted = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...createFileRunContext(runDirectory),
      ...common,
      signal: abort.signal,
      retainedAtSettlement: 'release',
    })
    expect(aborted.kind).toBe('no-winner')
    expect(fleet.environments()).toEqual([])
    expect(fleet.state.destroys).toBe(1)
    const abortedEvents =
      (await createFileRunContext(runDirectory).journal.loadTree('abort-release')) ?? []
    expect(releaseReceipts(abortedEvents)).toMatchObject([
      { id: 'abort-release:s0', destroyed: true },
    ])
    // The caller's abort is a cancellation, so the child settled `cancelled` — and the released
    // record keeps that kind and its source, exactly as the driver's settlement had them.
    expect(terminalRecords(abortedEvents, 'abort-release:s0')).toMatchObject([
      { kind: 'cancelled', source: 'signal', retainedExecution: 'released' },
    ])
    expect(aborted.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 0,
      cancelled: 1,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })

    fleet.state.observe = undefined
    fleet.state.resultLost = false
    const restarted = createFileRunContext(runDirectory)
    const resumed = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...restarted,
      ...common,
      resume: true,
      recoverExecutor: providerAsExecutor(fleet.provider()),
    })
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    if (resumed.kind !== 'winner') return
    expect(resumed.out).toBe('resumed')
    expect(fleet.state.destroys).toBe(1)
    expect(
      await replaySpawnTree(restarted.journal, restarted.blobs, 'abort-release'),
    ).toMatchObject([{ kind: 'down', retainedExecution: 'released' }])
    expect(resumed.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 0,
      cancelled: 1,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })
  })

  it('keeps the environment of a durable run its caller interrupts, and the resume recovers it', async () => {
    const fleet = retainedProvider(directory)
    const runDirectory = join(directory, 'run')
    const common = {
      runId: 'interrupt',
      budget: { maxIterations: 2, maxTokens: 20 },
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ name: 'root' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
    } satisfies Partial<SupervisorOpts>
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(_task, scope) {
        if (scope.resume === undefined) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        }
        // The resumed process adopts the retained child before the root acts.
        expect(scope.view.inFlight).toBe(1)
        const settled = await scope.next()
        return settled?.kind === 'done' ? 'recovered' : 'lost'
      },
    }

    // The operator stops the run while the child is observing its retained execution.
    const abort = new AbortController()
    fleet.state.observe = async (signal) => {
      abort.abort(new Error('operator stopped the run'))
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('observation aborted'))
        if (signal === undefined || signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
      })
    }
    const interrupted = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...createFileRunContext(runDirectory),
      ...common,
      signal: abort.signal,
    })
    expect(interrupted.kind).toBe('no-winner')
    if (interrupted.kind !== 'no-winner') return
    expect(interrupted.reason).toBe('cancelled')
    // Nothing was released: the run is durable (`resume: true`), so the default policy keeps the
    // environment for the resume below, and the barrier names the node as unconfirmed.
    expect(fleet.environments()).toHaveLength(1)
    expect(interrupted.teardownUnconfirmed?.map((node) => node.id)).toEqual(['interrupt:s0'])
    const interruptedEvents =
      (await createFileRunContext(runDirectory).journal.loadTree('interrupt')) ?? []
    expect(releaseReceipts(interruptedEvents)).toEqual([])
    expect(interruptedEvents.some((event) => event.kind === 'teardown-unconfirmed')).toBe(true)
    // `resume: true` defaults to `keep`, so the sweep never runs: the slot is still open, and
    // the yield names the node never-settled, not released.
    expect(terminalRecords(interruptedEvents, 'interrupt:s0')).toEqual([])
    expect(interrupted.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 0,
      cancelled: 0,
      neverSettled: 1,
      releasedUnrecovered: 0,
    })

    // A later process resumes the run and the provider delivers the retained result.
    fleet.state.observe = undefined
    fleet.state.resultLost = false
    const restarted = createFileRunContext(runDirectory)
    const resumed = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...restarted,
      ...common,
      resume: true,
      recoverExecutor: providerAsExecutor(fleet.provider()),
    })
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    if (resumed.kind !== 'winner') return
    expect(resumed.out).toBe('recovered')
    // The recovered execution settled on the ordinary path, which destroys its environment
    // itself; the settlement sweep found nothing left to release.
    expect(fleet.environments()).toEqual([])
    expect(resumed.teardownUnconfirmed).toBeUndefined()
    const resumedEvents = (await restarted.journal.loadTree('interrupt')) ?? []
    expect(releaseReceipts(resumedEvents)).toEqual([])
    const recovered = resumedEvents.find(
      (event) => event.kind === 'settled' && event.id === 'interrupt:s0' && event.status === 'done',
    )
    expect(recovered).toBeDefined()
    // A recovered settlement is an ordinary one: no marker, and the yield counts it as done.
    expect(recovered).not.toHaveProperty('retainedExecution')
    expect(resumed.fleetYield).toEqual({
      spawned: 1,
      done: 1,
      down: 0,
      cancelled: 0,
      neverSettled: 0,
      releasedUnrecovered: 0,
    })
  })

  it('releases on a durable run whose caller declares the settlement final', async () => {
    // The kernel half of `supervisePursuit`: a durable run directory whose settle record refuses
    // re-entry, so the caller declares the settlement final and the default `keep` does not apply.
    const fleet = retainedProvider(directory)
    const context = createFileRunContext(join(directory, 'run'))
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        },
      },
      'task',
      {
        ...context,
        runId: 'final',
        budget: { maxIterations: 2, maxTokens: 20 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root' }),
          taskDigest: canonicalCandidateDigest('task'),
        },
        retainedAtSettlement: 'release',
      },
    )
    expect(context.resume).toBe(true)
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    expect(fleet.environments()).toEqual([])
    expect(result.teardownUnconfirmed).toBeUndefined()
    const events = (await context.journal.loadTree('final')) ?? []
    expect(releaseReceipts(events)).toMatchObject([
      {
        id: 'final:s0',
        environmentId: admittedEnvironmentId(events, 'final:s0'),
        destroyed: true,
      },
    ])
    expect(terminalRecords(events, 'final:s0')).toMatchObject([
      { kind: 'settled', status: 'down', retainedExecution: 'released', seq: 0 },
    ])
    expect(result.fleetYield.releasedUnrecovered).toBe(1)
    expect(result.fleetYield.neverSettled).toBe(0)
  })

  it('receipts a release the provider refuses as a typed failure and keeps naming the node', async () => {
    const fleet = retainedProvider(directory)
    fleet.state.destroyFailure = new Error('409 Conflict: environment is still stopping')
    const context = createInMemoryRunContext()
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        },
      },
      'task',
      { ...context, runId: 'refused', budget: { maxIterations: 2, maxTokens: 20 } },
    )
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    // The attempt was made once, refused, and the environment is still held.
    expect(fleet.state.destroys).toBe(1)
    expect(fleet.environments()).toHaveLength(1)
    expect(result.teardownUnconfirmed?.map((node) => node.id)).toEqual(['refused:s0'])

    const events = (await context.journal.loadTree('refused')) ?? []
    expect(releaseReceipts(events)).toMatchObject([
      {
        id: 'refused:s0',
        provider: 'durable-test',
        environmentId: admittedEnvironmentId(events, 'refused:s0'),
        destroyed: false,
        detail: expect.stringContaining('409 Conflict: environment is still stopping'),
      },
    ])
    // Both records name the leak: the receipt says which environment and why, the barrier's
    // record says which node.
    expect(
      events.some((event) => event.kind === 'teardown-unconfirmed' && event.id === 'refused:s0'),
    ).toBe(true)
    // The environment still exists, so the slot honestly stays open: no terminal record, the
    // reconciled floor stands, the gap is a ceiling, and the node is still pending.
    expect(terminalRecords(events, 'refused:s0')).toEqual([])
    expect(events.some((event) => event.kind === 'reconciled' && event.id === 'refused:s0')).toBe(
      true,
    )
    expect(result.spendGaps).toEqual([
      expect.objectContaining({ id: 'refused:s0', kind: 'never-settled' }),
    ])
    expect(result.tree.nodes.find((node) => node.id === 'refused:s0')).toMatchObject({
      status: 'failed',
      retainedExecution: 'pending',
    })
    expect(result.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 0,
      cancelled: 0,
      neverSettled: 1,
      releasedUnrecovered: 0,
    })
  })

  it("reaches a nested manager's retained children and receipts them in the nested tree", async () => {
    const fleet = retainedProvider(directory)
    const context = createInMemoryRunContext({ withDriver: true })
    const manager = driverChild(
      testAgentProfile('manager'),
      {
        name: 'manager',
        async act(_task, scope) {
          const settled = await spawnAndAwait(
            scope,
            retainedWorker(providerAsExecutor(fleet.provider())),
          )
          expect(settled?.kind).toBe('down')
          return 'finalized manager'
        },
      },
      context.journal,
    )
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          expect(
            scope.spawn(manager, 'manage', { budget: { maxIterations: 2, maxTokens: 20 } }).ok,
          ).toBe(true)
          const settled = await scope.next()
          // A manager whose nested cleanup is unconfirmed settles `down` on its own teardown: the
          // grandchild's environment is still alive, and the manager is named for it.
          expect(settled?.kind).toBe('down')
          if (settled?.kind === 'down') expect(settled.reason).toContain('root:s0:s0')
          expect(scope.workerCapacity.unconfirmed.map((node) => node.id)).toEqual(['root:s0'])
          expect(fleet.environments()).toHaveLength(1)
          return 'finished'
        },
      },
      'task',
      { ...context, runId: 'root', budget: { maxIterations: 4, maxTokens: 100 } },
    )
    expect(result.kind, JSON.stringify(result)).toBe('winner')
    expect(fleet.environments()).toEqual([])
    // The manager's own teardown now answers destroyed, so the root names no leak at all.
    expect(result.teardownUnconfirmed).toBeUndefined()
    const nested = (await context.journal.loadTree('root/root:s0')) ?? []
    expect(releaseReceipts(nested)).toMatchObject([
      {
        id: 'root:s0:s0',
        provider: 'durable-test',
        environmentId: admittedEnvironmentId(nested, 'root:s0:s0'),
        destroyed: true,
      },
    ])
    // The grandchild's terminal record lands in the nested tree after its receipt; the manager
    // settled normally and keeps its one unmarked record in the root tree.
    const nestedTerminal = terminalRecords(nested, 'root:s0:s0')
    expect(nestedTerminal).toMatchObject([
      { kind: 'settled', status: 'down', retainedExecution: 'released' },
    ])
    expect(nested.indexOf(nestedTerminal[0]!)).toBeGreaterThan(
      nested.indexOf(releaseReceipts(nested)[0]!),
    )
    const rootEvents = (await context.journal.loadTree('root')) ?? []
    expect(releaseReceipts(rootEvents)).toEqual([])
    expect(rootEvents.some((event) => event.kind === 'teardown-unconfirmed')).toBe(false)
    const managerTerminal = terminalRecords(rootEvents, 'root:s0')
    expect(managerTerminal).toHaveLength(1)
    expect(managerTerminal[0]).not.toHaveProperty('retainedExecution')
    // Forest scope: the manager and its grandchild both count, the grandchild as released.
    expect(result.fleetYield).toEqual({
      spawned: 2,
      done: 0,
      down: 2,
      cancelled: 0,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })
  })
})

/**
 * The process dies between the last `destroyed: true` receipt and the released record: the
 * journal ends with the receipt, the slot is open, the environment is gone. Everything the release
 * sweep would have written is captured so the heal can be compared byte-for-byte against it.
 * Every other journal call forwards to the real file journal with its own `this`, so the stamp
 * check and the receipt's acknowledgement are untouched.
 */
function crashBeforeReleasedRecord(journal: SpawnJournal) {
  const dropped: SpawnEvent[] = []
  const proxied = new Proxy(journal, {
    get(target, property, receiver) {
      if (property !== 'appendEvent') return Reflect.get(target, property, receiver)
      return (root: NodeId, event: SpawnEvent) => {
        if (
          (event.kind === 'settled' || event.kind === 'cancelled') &&
          event.retainedExecution === 'released'
        ) {
          dropped.push(event)
          throw new Error('process died before the released record')
        }
        return target.appendEvent(root, event)
      }
    },
  })
  return { journal: proxied, dropped }
}

/** An ordinary leaf that completes at once, for a settlement after the healed one. */
function completingWorker(): Agent<unknown, unknown> {
  const spent = { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 }
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(): AsyncIterable<{ kind: 'tokens'; input: number; output: number }> {
      return (async function* () {
        yield { kind: 'tokens' as const, input: 1, output: 1 }
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => ({ out: 'ok', outRef: canonicalCandidateDigest('ok'), spent }),
  }
  return Object.assign(
    { name: 'plain', act: async () => 'unused' },
    { executorSpec: { profile: testAgentProfile('plain'), harness: null, executor } },
  )
}

const reconciledRecords = (events: ReadonlyArray<SpawnEvent>, id: string) =>
  events.flatMap((event) => (event.kind === 'reconciled' && event.id === id ? [event] : []))

/** A deterministic clock so two runs of the same shape journal the same instants. */
const fixedClock = () => {
  let tick = Date.parse('2026-09-15T12:00:00.000Z')
  return () => (tick += 1000)
}

/** Two runs of one shape differ only in the attempt ids the root's own binding mints, and a
 *  replayed handle carries a method; compare the recorded data with the ids pinned. */
const recorded = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value).replace(/"attemptId":"[^"]+"/g, '"attemptId":"<attempt>"'),
  ) as unknown

describe('a crash between the receipt and the released record heals on the next resume', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'retained-heal-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const common = (runId: string) =>
    ({
      runId,
      budget: { maxIterations: 4, maxTokens: 40 },
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ name: 'root' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
      retainedAtSettlement: 'release',
    }) satisfies Partial<SupervisorOpts>

  it('writes the sweep’s own record at the driver’s seq, treats nothing as interrupted, and reports the floor', async () => {
    const fleet = retainedProvider(directory)
    const runDirectory = join(directory, 'run')
    const observerPath = join(directory, 'observer.jsonl')
    const crashed = crashBeforeReleasedRecord(createFileRunContext(runDirectory).journal)
    await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        },
      },
      'task',
      {
        ...createFileRunContext(runDirectory),
        journal: crashed.journal,
        ...common('heal'),
        hooks: new FileObserverJournal(observerPath, 'pursuit:heal').hooks(),
      },
    )
    // The window exactly: the environment is destroyed, the receipt is the last record, the slot
    // is open, and the reconciled record carries the settlement and the cursor seq beside the floor.
    expect(fleet.state.destroys).toBe(1)
    expect(fleet.environments()).toEqual([])
    expect(crashed.dropped).toHaveLength(1)
    const before = (await createFileRunContext(runDirectory).journal.loadTree('heal')) ?? []
    const receipt = releaseReceipts(before)[0]!
    expect(receipt).toMatchObject({ id: 'heal:s0', destroyed: true })
    expect(before.at(-1)).toBe(receipt)
    expect(terminalRecords(before, 'heal:s0')).toEqual([])
    const reconciled = reconciledRecords(before, 'heal:s0')[0]!
    expect(reconciled).toMatchObject({
      settledSeq: 0,
      infra: true,
      reason: expect.stringContaining('reconciliation'),
      trace: expect.anything(),
      harnessTranscript: expect.anything(),
    })
    expect(reconciled).not.toHaveProperty('cancellation')

    fleet.state.resultLost = false
    const restarted = createFileRunContext(runDirectory)
    const hookEvents: RuntimeHookEvent[] = []
    const observer = new FileObserverJournal(observerPath, 'pursuit:heal').hooks()
    let secondChild: Settled<unknown> | undefined
    let actError: unknown
    const resumed = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          try {
            expect(scope.resume).toBeDefined()
            // Healed before the root acts: nothing in flight, the node already down and released.
            expect(scope.view.inFlight).toBe(0)
            expect(scope.resume?.settled).toMatchObject([
              { kind: 'down', retainedExecution: 'released', seq: 0 },
            ])
            // The resumed cursor starts past the healed seq, so a new settlement never collides.
            const plain = scope.spawn(completingWorker(), 'plain task', {
              budget: { maxIterations: 1, maxTokens: 10 },
            })
            expect(plain, JSON.stringify(plain)).toMatchObject({ ok: true })
            secondChild = (await scope.next()) ?? undefined
          } catch (error) {
            actError = error
            throw error
          }
          return 'resumed'
        },
      },
      'task',
      {
        ...restarted,
        ...common('heal'),
        resume: true,
        recoverExecutor: providerAsExecutor(fleet.provider()),
        hooks: {
          onEvent: (event, context) => {
            hookEvents.push(event)
            return observer.onEvent?.(event, context)
          },
        },
      },
    )
    expect(actError).toBeUndefined()
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    if (resumed.kind !== 'winner') return
    expect(resumed.out).toBe('resumed')
    expect(secondChild).toMatchObject({ kind: 'done', seq: 1 })
    // No recovery was attempted against the destroyed environment.
    expect(fleet.state.destroys).toBe(1)
    expect(fleet.environments()).toEqual([])

    const events = (await restarted.journal.loadTree('heal')) ?? []
    const terminal = terminalRecords(events, 'heal:s0')
    expect(terminal).toEqual([crashed.dropped[0]])
    expect(events.indexOf(terminal[0]!)).toBeGreaterThan(events.indexOf(receipt))
    expect(terminal[0]).toMatchObject({
      kind: 'settled',
      status: 'down',
      retainedExecution: 'released',
      seq: 0,
      at: reconciled.at,
      spent: reconciled.spent,
      harnessTranscript: reconciled.harnessTranscript,
    })
    expect(await replaySpawnTree(restarted.journal, restarted.blobs, 'heal')).toMatchObject([
      {
        kind: 'down',
        retainedExecution: 'released',
        seq: 0,
        harnessTranscript: reconciled.harnessTranscript,
      },
      { kind: 'done', seq: 1 },
    ])
    // Every reader agrees: down and released, an unreported floor rather than a never-settled
    // ceiling, and the same child work the pool committed at the reconcile.
    expect(resumed.fleetYield).toEqual({
      spawned: 2,
      done: 1,
      down: 1,
      cancelled: 0,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })
    expect(resumed.spendGaps).toEqual([
      expect.objectContaining({ id: 'heal:s0', kind: 'unreported' }),
    ])
    expect(resumed.spentTotal.tokensKnown).toBe(false)
    const retainedOnly = (list: ReadonlyArray<SpawnEvent>) =>
      list.filter(
        (event) =>
          event.id === 'heal:s0' || (event.kind === 'spawned' && event.parent === undefined),
      )
    expect(sumSpendFromEvents(retainedOnly(events)).childWork).toEqual(
      sumSpendFromEvents(retainedOnly(before)).childWork,
    )
    // The sweep's `agent.child` on the resumed stream, and the projection that reads it.
    const released = childPayloads(hookEvents, 'heal:s0')
    expect(released).toHaveLength(1)
    expect(released[0]).toMatchObject({
      stepIndex: 0,
      payload: {
        status: 'down',
        retainedExecution: 'released',
        settledAt: Date.parse(reconciled.at),
        releasedAt: Date.parse(receipt.at),
        spent: reconciled.spent,
      },
    })
    expect(released[0]?.payload).not.toHaveProperty('metered')
    expect(hookEvents.find((event) => event.id === 'heal:s0:released')?.runId).toBe('heal')
    const projection = projectPursuit(
      await new FileObserverJournal(observerPath, 'pursuit:heal').read(),
    )
    expect(projection.nodes.find((node) => node.id === 'heal:s0')).toMatchObject({
      status: 'down',
      retainedExecution: 'released',
      releasedAt: Date.parse(receipt.at),
      spent: expect.objectContaining({ tokens: reconciled.spent.tokens }),
    })
    expect(projection.runs[0]?.spendGaps).toEqual([
      expect.objectContaining({ id: 'heal:s0', kind: 'unreported' }),
    ])
  })

  it('replays as the run the sweep completed, and a second resume writes nothing more', async () => {
    const fleet = retainedProvider(directory)
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(_task, scope) {
        if (scope.resume !== undefined) return 'resumed'
        await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
        return 'finished'
      },
    }
    // The control: the same run, uncrashed, on the same clock.
    const controlDirectory = join(directory, 'control')
    const control = createFileRunContext(controlDirectory)
    const controlRun = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...control,
      ...common('same'),
      now: fixedClock(),
    })
    expect(controlRun.kind, JSON.stringify(controlRun)).toBe('winner')
    const controlEvents = (await control.journal.loadTree('same')) ?? []
    expect(terminalRecords(controlEvents, 'same:s0')).toMatchObject([
      { retainedExecution: 'released' },
    ])

    const runDirectory = join(directory, 'run')
    const crashed = crashBeforeReleasedRecord(createFileRunContext(runDirectory).journal)
    await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...createFileRunContext(runDirectory),
      journal: crashed.journal,
      ...common('same'),
      now: fixedClock(),
    })
    const crashedEvents = (await createFileRunContext(runDirectory).journal.loadTree('same')) ?? []
    expect(terminalRecords(crashedEvents, 'same:s0')).toEqual([])
    expect(recorded(crashedEvents)).toEqual(recorded(controlEvents.slice(0, -1)))

    const restarted = createFileRunContext(runDirectory)
    const resumed = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...restarted,
      ...common('same'),
      resume: true,
      recoverExecutor: providerAsExecutor(fleet.provider()),
    })
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    const healedEvents = (await restarted.journal.loadTree('same')) ?? []
    // The resumed process adds only its own root binding; every child record is the control's.
    const childRecords = (list: ReadonlyArray<SpawnEvent>) =>
      list.filter((event) => !(event.kind === 'execution-bound' && event.id === 'same'))
    expect(recorded(childRecords(healedEvents))).toEqual(recorded(childRecords(controlEvents)))
    expect(recorded(await replaySpawnTree(restarted.journal, restarted.blobs, 'same'))).toEqual(
      recorded(await replaySpawnTree(control.journal, control.blobs, 'same')),
    )
    const childNodes = (list: ReadonlyArray<SpawnEvent>) =>
      materializeTreeView(list).nodes.filter((node) => node.parent !== undefined)
    expect(recorded(childNodes(healedEvents))).toEqual(recorded(childNodes(controlEvents)))
    expect(resumed.fleetYield).toEqual(controlRun.fleetYield)

    const again = createFileRunContext(runDirectory)
    const hookEvents: RuntimeHookEvent[] = []
    const second = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...again,
      ...common('same'),
      resume: true,
      recoverExecutor: providerAsExecutor(fleet.provider()),
      hooks: {
        onEvent: (event) => {
          hookEvents.push(event)
        },
      },
    })
    expect(second.kind, JSON.stringify(second)).toBe('winner')
    expect(childRecords((await again.journal.loadTree('same')) ?? [])).toEqual(
      childRecords(healedEvents),
    )
    expect(childPayloads(hookEvents, 'same:s0')).toEqual([])
    expect(fleet.state.destroys).toBe(2)
  })

  it('keeps the cancelled kind and its source on a healed cancelled child', async () => {
    const fleet = retainedProvider(directory)
    const runDirectory = join(directory, 'run')
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(_task, scope) {
        if (scope.resume === undefined) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        }
        expect(scope.view.inFlight).toBe(0)
        return 'resumed'
      },
    }
    const abort = new AbortController()
    fleet.state.observe = async (signal) => {
      abort.abort(new Error('operator stopped the run'))
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new Error('observation aborted'))
        if (signal === undefined || signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
      })
    }
    const crashed = crashBeforeReleasedRecord(createFileRunContext(runDirectory).journal)
    await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...createFileRunContext(runDirectory),
      journal: crashed.journal,
      ...common('abort-heal'),
      signal: abort.signal,
    })
    expect(fleet.state.destroys).toBe(1)
    const before = (await createFileRunContext(runDirectory).journal.loadTree('abort-heal')) ?? []
    expect(terminalRecords(before, 'abort-heal:s0')).toEqual([])
    expect(reconciledRecords(before, 'abort-heal:s0')[0]).toMatchObject({
      settledSeq: 0,
      cancellation: { source: 'signal' },
    })
    expect(crashed.dropped).toMatchObject([{ kind: 'cancelled', source: 'signal' }])

    fleet.state.observe = undefined
    fleet.state.resultLost = false
    const restarted = createFileRunContext(runDirectory)
    const resumed = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...restarted,
      ...common('abort-heal'),
      resume: true,
      recoverExecutor: providerAsExecutor(fleet.provider()),
    })
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    expect(fleet.state.destroys).toBe(1)
    const events = (await restarted.journal.loadTree('abort-heal')) ?? []
    expect(terminalRecords(events, 'abort-heal:s0')).toEqual(crashed.dropped)
    expect(terminalRecords(events, 'abort-heal:s0')).toMatchObject([
      { kind: 'cancelled', source: 'signal', retainedExecution: 'released', seq: 0 },
    ])
    expect(resumed.fleetYield).toEqual({
      spawned: 1,
      done: 0,
      down: 0,
      cancelled: 1,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })
  })

  it('leaves a refused release open: the node is still interrupted and the resume recovers it', async () => {
    const fleet = retainedProvider(directory)
    fleet.state.destroyFailure = new Error('409 Conflict: environment is still stopping')
    const runDirectory = join(directory, 'run')
    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(_task, scope) {
        if (scope.resume === undefined) {
          await spawnAndAwait(scope, retainedWorker(providerAsExecutor(fleet.provider())))
          return 'finished'
        }
        // Still interrupted: the resumed process adopts the retained child before the root acts.
        expect(scope.view.inFlight).toBe(1)
        const settled = await scope.next()
        return settled?.kind === 'done' ? 'recovered' : 'lost'
      },
    }
    const first = createFileRunContext(runDirectory)
    const refused = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...first,
      ...common('refused-heal'),
    })
    expect(refused.kind, JSON.stringify(refused)).toBe('winner')
    expect(fleet.environments()).toHaveLength(1)
    const before = (await first.journal.loadTree('refused-heal')) ?? []
    expect(releaseReceipts(before)).toMatchObject([{ id: 'refused-heal:s0', destroyed: false }])
    expect(reconciledRecords(before, 'refused-heal:s0')[0]).toMatchObject({ settledSeq: 0 })
    expect(terminalRecords(before, 'refused-heal:s0')).toEqual([])

    fleet.state.destroyFailure = undefined
    fleet.state.resultLost = false
    const restarted = createFileRunContext(runDirectory)
    const resumed = await createSupervisor<unknown, unknown>().run(root, 'task', {
      ...restarted,
      ...common('refused-heal'),
      resume: true,
      recoverExecutor: providerAsExecutor(fleet.provider()),
    })
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    if (resumed.kind !== 'winner') return
    expect(resumed.out).toBe('recovered')
    const events = (await restarted.journal.loadTree('refused-heal')) ?? []
    const terminal = terminalRecords(events, 'refused-heal:s0')
    expect(terminal).toMatchObject([{ kind: 'settled', status: 'done' }])
    expect(terminal[0]).not.toHaveProperty('retainedExecution')
    expect(resumed.fleetYield).toEqual({
      spawned: 1,
      done: 1,
      down: 0,
      cancelled: 0,
      neverSettled: 0,
      releasedUnrecovered: 0,
    })
  })

  it("heals a nested manager's grandchild in its own tree from the root resume", async () => {
    const fleet = retainedProvider(directory)
    const runDirectory = join(directory, 'run')
    const crashed = crashBeforeReleasedRecord(
      createFileRunContext(runDirectory, { withDriver: true }).journal,
    )
    const managerFor = (journal: SpawnJournal) =>
      driverChild(
        testAgentProfile('manager'),
        {
          name: 'manager',
          async act(_task, scope) {
            const settled = await spawnAndAwait(
              scope,
              retainedWorker(providerAsExecutor(fleet.provider())),
            )
            expect(settled?.kind).toBe('down')
            return 'finalized manager'
          },
        },
        journal,
      )
    const rootFor = (manager: Agent<unknown, unknown>): Agent<unknown, unknown> => ({
      name: 'root',
      async act(_task, scope) {
        if (scope.resume !== undefined) {
          expect(scope.view.inFlight).toBe(0)
          return 'resumed'
        }
        expect(
          scope.spawn(manager, 'manage', { budget: { maxIterations: 2, maxTokens: 20 } }).ok,
        ).toBe(true)
        expect((await scope.next())?.kind).toBe('down')
        return 'finished'
      },
    })
    await createSupervisor<unknown, unknown>().run(rootFor(managerFor(crashed.journal)), 'task', {
      ...createFileRunContext(runDirectory, { withDriver: true }),
      journal: crashed.journal,
      ...common('root'),
      budget: { maxIterations: 4, maxTokens: 100 },
    })
    expect(fleet.environments()).toEqual([])
    expect(crashed.dropped).toHaveLength(1)
    const firstContext = createFileRunContext(runDirectory, { withDriver: true })
    const nestedBefore = (await firstContext.journal.loadTree('root/root:s0')) ?? []
    expect(releaseReceipts(nestedBefore)).toMatchObject([{ id: 'root:s0:s0', destroyed: true }])
    expect(terminalRecords(nestedBefore, 'root:s0:s0')).toEqual([])
    // The manager settled on the ordinary path in the root tree: nothing there to restore.
    const rootBefore = (await firstContext.journal.loadTree('root')) ?? []
    expect(terminalRecords(rootBefore, 'root:s0')).toHaveLength(1)

    fleet.state.resultLost = false
    const restarted = createFileRunContext(runDirectory, { withDriver: true })
    const hookEvents: RuntimeHookEvent[] = []
    const resumed = await createSupervisor<unknown, unknown>().run(
      rootFor(managerFor(restarted.journal)),
      'task',
      {
        ...restarted,
        ...common('root'),
        budget: { maxIterations: 4, maxTokens: 100 },
        resume: true,
        recoverExecutor: providerAsExecutor(fleet.provider()),
        hooks: {
          onEvent: (event) => {
            hookEvents.push(event)
          },
        },
      },
    )
    expect(resumed.kind, JSON.stringify(resumed)).toBe('winner')
    expect(fleet.state.destroys).toBe(1)
    const nested = (await restarted.journal.loadTree('root/root:s0')) ?? []
    const nestedTerminal = terminalRecords(nested, 'root:s0:s0')
    expect(nestedTerminal).toEqual(crashed.dropped)
    expect(nested.indexOf(nestedTerminal[0]!)).toBeGreaterThan(
      nested.indexOf(releaseReceipts(nested)[0]!),
    )
    // The root tree gains only the resumed root's own binding: no receipt, no second record.
    const rootAfter = (await restarted.journal.loadTree('root')) ?? []
    expect(rootAfter.filter(closesCursorSlot)).toEqual(rootBefore.filter(closesCursorSlot))
    expect(releaseReceipts(rootAfter)).toEqual([])
    expect(hookEvents.find((event) => event.id === 'root:s0:s0:released')).toMatchObject({
      runId: 'root/root:s0',
      parentId: 'root:s0',
      target: 'agent.child',
    })
    expect(resumed.fleetYield).toEqual({
      spawned: 2,
      done: 0,
      down: 2,
      cancelled: 0,
      neverSettled: 0,
      releasedUnrecovered: 1,
    })
  })
})
