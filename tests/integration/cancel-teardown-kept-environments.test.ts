/**
 * Cancelling a finished multi-manager run must settle in about one release wait, not one per tree
 * level. Measured 2026-11-13 on a 28-box run: cancel-to-result took 22 minutes. Its provider held
 * most manager boxes for retention, refused each delete with an HTTP error naming the hold, and
 * stopped each refused box. The run asked again at every level of the tree and on every retry
 * pass. Each reconnect woke a stopped box and waited for it to run. The three levels (retained
 * children, nested managers, the root's own box) released one after another, each with a
 * five-minute wait. The held boxes were also reported as leaks for a sweeper to delete, not as
 * evidence the provider keeps.
 */

import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { RunCancellationReason } from '../../src/runtime/supervise/abortable'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import {
  bindScopeRetainedOwnerProvider,
  scopeRetainedOwnerContext,
} from '../../src/runtime/supervise/retained-owner-state'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Scope, SpawnEvent, SupervisorOpts } from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const PROVIDER = 'held-box-provider'
const ROOT_BOX = 'root-box'

/** How each fixture box answers a delete. */
type Box =
  /** A retention hold refuses it with HTTP 500 and a message naming the hold; the box stops. */
  | 'held'
  /** A retention hold refuses it with 409 `RETENTION_HOLD`; the box stops. */
  | 'held-coded'
  /** Deleted once the root's own delete has started, refused while it has not (3 s). */
  | 'after-root'
  /** Deleted at once. */
  | 'deletes'
  /** Never answered. */
  | 'hangs'

class ProviderRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

function boxProvider(boxes: Readonly<Record<string, Box>>) {
  const gets = new Map<string, number>()
  const destroys = new Map<string, number>()
  const wakes = new Map<string, number>()
  const stopped = new Set<string>()
  const removed = new Set<string>()
  let rootDeleting = (): void => {}
  const rootDeleteStarted = new Promise<void>((resolve) => {
    rootDeleting = resolve
  })
  const count = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1)
  const environment = (id: string): AgentEnvironment => ({
    id,
    provider: PROVIDER,
    status: async () => 'running',
    async *stream() {},
    async destroy() {
      count(destroys, id)
      if (id === ROOT_BOX) rootDeleting()
      const box = boxes[id]
      if (box === 'held') {
        stopped.add(id)
        throw new ProviderRefusal(`Project ${id} is under retention hold ${id}@1700000000000`, 500)
      }
      if (box === 'held-coded') {
        stopped.add(id)
        throw new ProviderRefusal('A retention hold refuses this delete', 409, 'RETENTION_HOLD')
      }
      if (box === 'hangs') return await new Promise<void>(() => {})
      if (box === 'after-root') {
        let timer: ReturnType<typeof setTimeout> | undefined
        const started = await Promise.race([
          rootDeleteStarted.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 3_000)
          }),
        ])
        clearTimeout(timer)
        if (!started) throw new ProviderRefusal('delete refused: the workspace is sealing', 503)
      }
      removed.add(id)
    },
  })
  const provider: AgentEnvironmentProvider = {
    name: PROVIDER,
    capabilities: async () => ({}),
    create: async () => {
      throw new Error('a release never creates an environment')
    },
    async get(id) {
      count(gets, id)
      if (removed.has(id) || boxes[id] === undefined) return null
      // A reconnect to a box a refused delete stopped resumes it and waits for it to run.
      if (stopped.has(id)) count(wakes, id)
      return environment(id)
    },
  }
  return { provider, gets, destroys, wakes }
}

async function admitBox(
  scope: Scope<unknown>,
  provider: AgentEnvironmentProvider,
  box: string,
): Promise<void> {
  bindScopeRetainedOwnerProvider(scope, provider)
  await scopeRetainedOwnerContext(scope)!.onAdmission({
    phase: 'environment',
    provider: provider.name,
    environmentId: box,
    idempotencyKey: `${box}:key`,
    turnId: `${box}:turn`,
    sessionId: `${box}:session`,
    executionId: `${box}:execution`,
  })
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

/**
 * A root that owns its own box and runs three managers, each with one box: two finish and are
 * released at their settlement, one is still working when the run is cancelled. The root waits
 * for both finished managers' boxes to be asked to delete, then for the cancel.
 */
async function cancelFinishedRun(
  boxes: Readonly<Record<string, Box>>,
  managers: { readonly finished: readonly [string, string]; readonly working: string },
  opts: Partial<SupervisorOpts> = {},
) {
  const fixture = boxProvider(boxes)
  const context = createInMemoryRunContext({ withDriver: true })
  const controller = new AbortController()
  let finishedAsked = (): void => {}
  const asked = new Promise<void>((resolve) => {
    finishedAsked = resolve
  })
  const manager = (box: string, working: boolean) =>
    driverChild(
      testAgentProfile(`${box}-manager`),
      {
        name: `${box}-manager`,
        async act(_task, scope) {
          await admitBox(scope, fixture.provider, box)
          if (working) await aborted(scope.signal)
          return box
        },
      },
      context.journal,
    )
  let cancelledAt = 0
  const run = createSupervisor<unknown, unknown>().run(
    {
      name: 'root',
      async act(_task, scope) {
        await admitBox(scope, fixture.provider, ROOT_BOX)
        for (const [box, working] of [
          [managers.finished[0], false],
          [managers.finished[1], false],
          [managers.working, true],
        ] as const) {
          const spawned = scope.spawn(manager(box, working), 'work', {
            key: box,
            budget: { maxTokens: 100, maxIterations: 5 },
          })
          if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
        }
        await scope.next()
        await scope.next()
        const poll = setInterval(() => {
          if (managers.finished.every((box) => fixture.destroys.has(box))) finishedAsked()
        }, 5)
        await asked
        clearInterval(poll)
        cancelledAt = Date.now()
        controller.abort(new RunCancellationReason('operator', 'stop the finished run'))
        return await aborted(scope.signal)
      },
    },
    'task',
    {
      ...context,
      runId: 'cancel-teardown',
      budget: { maxTokens: 1000, maxIterations: 50 },
      workerSlots: 4,
      signal: controller.signal,
      ...opts,
    },
  )
  const result = await run
  const elapsedMs = Date.now() - cancelledAt
  const events = (await context.journal.loadTree('cancel-teardown')) ?? []
  return { ...fixture, result, elapsedMs, events }
}

const unconfirmedRows = (events: readonly SpawnEvent[]) =>
  events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'teardown-unconfirmed' }> =>
      event.kind === 'teardown-unconfirmed',
  )

it('keeps a held box after one refused delete, reports it kept, and releases levels together', async () => {
  const run = await cancelFinishedRun(
    {
      'held-box': 'held',
      'held-coded-box': 'held-coded',
      'working-box': 'after-root',
      [ROOT_BOX]: 'deletes',
    },
    { finished: ['held-box', 'held-coded-box'], working: 'working-box' },
    { teardownConfirmMs: 5_000 },
  )
  expect(run.result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
  // A held box is asked once and never reconnected to again; the working manager's box is deleted
  // on its first ask because the root's own release runs beside it.
  expect(Object.fromEntries(run.destroys)).toEqual({
    'held-box': 1,
    'held-coded-box': 1,
    'working-box': 1,
    [ROOT_BOX]: 1,
  })
  expect(Object.fromEntries(run.wakes)).toEqual({})
  const unconfirmed = run.result.teardownUnconfirmed ?? []
  // Nothing is left for a sweeper to delete; the held boxes are named as evidence the provider keeps.
  expect(unconfirmed.flatMap((node) => node.environments ?? [])).toEqual([])
  const kept = [
    { provider: PROVIDER, environmentId: 'held-box', keptFor: 'evidence' },
    { provider: PROVIDER, environmentId: 'held-coded-box', keptFor: 'evidence' },
  ]
  expect(unconfirmed.flatMap((node) => node.kept ?? [])).toEqual(expect.arrayContaining(kept))
  expect(unconfirmedRows(run.events).flatMap((row) => row.kept ?? [])).toEqual(
    expect.arrayContaining(kept),
  )
  expect(unconfirmedRows(run.events).flatMap((row) => row.environments ?? [])).toEqual([])
  expect(run.elapsedMs).toBeLessThan(4_000)
}, 60_000)

it('settles a cancel whose deletes never answer within one release wait', async () => {
  const run = await cancelFinishedRun(
    {
      'held-box': 'held',
      'slow-box': 'hangs',
      'working-box': 'hangs',
      [ROOT_BOX]: 'hangs',
    },
    { finished: ['held-box', 'slow-box'], working: 'working-box' },
  )
  // One release wait (90 s), not one per level and retry pass.
  expect(run.elapsedMs).toBeLessThan(100_000)
  // A delete that never answered is asked once and named for a sweeper; it is not evidence.
  expect(Object.fromEntries(run.destroys)).toEqual({
    'held-box': 1,
    'slow-box': 1,
    'working-box': 1,
    [ROOT_BOX]: 1,
  })
  const unconfirmed = run.result.teardownUnconfirmed ?? []
  expect(
    unconfirmed
      .flatMap((node) => node.environments ?? [])
      .map((ref) => ref.environmentId)
      .sort(),
  ).toEqual([ROOT_BOX, 'slow-box', 'working-box'])
  expect(unconfirmed.flatMap((node) => node.kept ?? [])).toEqual([
    { provider: PROVIDER, environmentId: 'held-box', keptFor: 'evidence' },
  ])
}, 150_000)
