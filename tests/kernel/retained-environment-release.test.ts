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
import { closesCursorSlot } from '../../src/durable/spawn-journal'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import {
  createFileRunContext,
  createInMemoryRunContext,
} from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  ExecutorFactory,
  Scope,
  SpawnEvent,
  SupervisorOpts,
} from '../../src/runtime/supervise/types'
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
            yield* session.events(eventOptions)
          },
          result: async () => {
            if (state.resultLost) throw new Error('provider result read lost')
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
    const result = await createSupervisor<unknown, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          const settled = await spawnAndAwait(
            scope,
            retainedWorker(providerAsExecutor(fleet.provider())),
          )
          expect(settled?.kind).toBe('down')
          // The retained execution was admitted and its result read lost: the environment is
          // alive at this point, exactly as the barrier used to leave it.
          expect(fleet.environments()).toHaveLength(1)
          return 'finished'
        },
      },
      'task',
      { ...context, runId: 'release', budget: { maxIterations: 2, maxTokens: 20 } },
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
    // The release is a resource fact, not a settlement: the node's cursor slot is still open and
    // its reconciled floor still stands in the settlement's place.
    expect(events.filter((event) => event.id === 'release:s0' && closesCursorSlot(event))).toEqual(
      [],
    )
    expect(events.some((event) => event.kind === 'reconciled' && event.id === 'release:s0')).toBe(
      true,
    )
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
    expect(
      resumedEvents.some(
        (event) =>
          event.kind === 'settled' && event.id === 'interrupt:s0' && event.status === 'done',
      ),
    ).toBe(true)
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
    const rootEvents = (await context.journal.loadTree('root')) ?? []
    expect(releaseReceipts(rootEvents)).toEqual([])
    expect(rootEvents.some((event) => event.kind === 'teardown-unconfirmed')).toBe(false)
  })
})
