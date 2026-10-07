/**
 * Invariant property test for a retained owner's pending executions.
 *
 * A retained owner is a manager whose turns run as retained provider executions: each turn is an
 * `execution-input`, admitted in phases (intent, environment, dispatched) before its result is
 * committed. Discovery run terraform-dc-tokens-20261006d died on one of these: its root's next
 * turn was refused by the subscription credential owner before dispatch, every re-entry repeated
 * the same reconciliation and met the same refusal, and after 20 attempts the barren bound settled
 * the run `driver-failed` with the execution still "requiring reconciliation".
 *
 * This test drives the production pieces (the retained provider executor, the owner's journal
 * bookkeeping, the driver retry loop, and the journal's own integrity checks) through seeded
 * random sequences of dispatch faults, process crashes at durable boundaries, resumes from the
 * journal, and reconciliation. Every sequence must hold two invariants:
 *
 * 1. Liveness: the run never dies on a pending execution that can be resolved. A capacity refusal
 *    before dispatch is waited out however long it lasts, a lost reply is reconciled by replaying
 *    the admitted intent, a crash is resumed, and an execution the provider can no longer resolve
 *    is abandoned with its outcome recorded.
 * 2. Safety: no accepted effect is duplicated. Every invocation commits at most one result, no
 *    provider execution is accepted twice, an abandoned invocation never commits a result, and
 *    every execution the provider ran is either accepted or recorded as abandoned.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentProfile,
  AgentRunCancellationAcknowledgement,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/spawn-journal'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import {
  type DriverAttemptRecord,
  type DriverBudgetReadout,
  runDriverWithRetry,
} from '../../src/runtime/supervise/driver-retry'
import { retainedExecutorSeamKey } from '../../src/runtime/supervise/retained-executor'
import {
  abandonScopeRetainedOwnerInvocation,
  bindScopeRetainedOwnerProvider,
  consumeScopeRetainedOwnerResult,
  prepareScopeRetainedOwnerTask,
  registerScopeRetainedOwner,
  scopeRetainedOwnerContext,
  scopeRetainedOwnerResult,
} from '../../src/runtime/supervise/retained-scope-owner'
import type { Scope, SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const ROOT = 'root'
const OWNER = 'owner'
const TURNS = 3
/** Seeded sequences per run; set RETAINED_PENDING_SEQUENCES for a deeper local search. */
const SEQUENCES = Number(process.env.RETAINED_PENDING_SEQUENCES ?? 300)
/** Each crash costs one process; a sequence draws at most this many crashes. */
const MAX_CRASHES = 3
/** Faults other than crashes a sequence may draw, so every sequence can finish. */
const MAX_FAULTS = 6
/** Longer than the transient outage window below, as the 2026-10-07 refusal outlasted 15 min. */
const MAX_CAPACITY_STREAK = 120
const at = '2026-10-07T19:07:34.211Z'

const profile: AgentProfile = {
  name: 'pending-owner',
  harness: 'opencode',
  model: { provider: 'fixture', default: 'fixture/model' },
}
const budget: DriverBudgetReadout = {
  tokensLeft: 1_000_000,
  tokensKnown: true,
  cacheBreakdownKnown: true,
  usdLeft: 0,
  usdCapped: false,
  usdKnown: true,
  iterationsLeft: 1_000_000,
  deadlineMs: 0,
  reservedTokens: 0,
}

class ProcessCrash extends Error {
  constructor(where: string) {
    super(`process crashed ${where}`)
    this.name = 'ProcessCrash'
  }
}

/** agent-provider-tangle's `TangleCredentialCapacityError`, by structure: the credential command
 *  refused a fresh dispatch before the dispatch request existed, so it carries no HTTP status. */
function capacityRefusal(): Error {
  return Object.assign(new Error('Subscription account capacity is unavailable'), {
    name: 'TangleCredentialCapacityError',
    code: 'provider_quota_exhausted',
    reason: 'exhausted',
  })
}

/** The dispatch reached the provider and its reply was lost: status in doubt. */
function lostReply(): Error {
  return Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
}

/** The provider no longer resolves an execution it admitted. */
function unresolvable(): Error {
  return Object.assign(new Error('retained run not found'), { name: 'SandboxError', status: 404 })
}

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

type DispatchFault =
  | 'capacity'
  | 'lost-reply'
  | 'crash-before-send'
  | 'crash-after-send'
  | 'unresolvable'

interface World {
  readonly seed: number
  readonly random: () => number
  readonly journal: SpawnJournal
  readonly blobs: InMemoryResultBlobStore
  readonly provider: AgentEnvironmentProvider
  /** Provider-side executions, by execution id: each one ran once, however often it was sent. */
  readonly executions: Set<string>
  /** Executions whose result the provider can never return. */
  readonly unresolvable: Set<string>
  /** Executions the provider stopped on request. */
  readonly stopped: Set<string>
  readonly log: string[]
  /** A fleet whose children keep settling while the owner's check is unmet. */
  readonly live: boolean
  settled: number
  /** Lost replies since the last dispatch that was answered. */
  lostReplies: number
  clock: number
  crashes: number
  faults: number
  capacityStreak: number
  process?: AbortController
}

function crash(world: World, where: string): never {
  world.crashes += 1
  world.log.push(`crash ${where}`)
  const error = new ProcessCrash(where)
  world.process?.abort(error)
  throw error
}

function drawDispatchFault(world: World): DispatchFault | undefined {
  if (world.capacityStreak > 0) {
    world.capacityStreak -= 1
    return 'capacity'
  }
  const roll = world.random()
  if (world.crashes < MAX_CRASHES) {
    if (roll < 0.05) return 'crash-before-send'
    if (roll < 0.1) return 'crash-after-send'
  }
  if (world.faults >= MAX_FAULTS) return undefined
  if (roll < 0.25) {
    world.faults += 1
    // The streak includes this refusal.
    world.capacityStreak = Math.floor(world.random() * MAX_CAPACITY_STREAK)
    return 'capacity'
  }
  // A transport that keeps losing replies is an outage, which the driver's barren bound ends by
  // design while the fleet moves; two in a row is the most this model draws.
  if (roll < 0.33 && world.lostReplies < 2) {
    world.faults += 1
    return 'lost-reply'
  }
  if (roll < 0.41) {
    world.faults += 1
    return 'unresolvable'
  }
  return undefined
}

/** The durable test provider with faults injected where the real ones arise. */
function faultyProvider(world: () => World, stateFile: string): AgentEnvironmentProvider {
  const base = durableRetainedProvider(stateFile)
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    async dispatch(input) {
      const w = world()
      const fault = drawDispatchFault(w)
      if (fault !== undefined) w.log.push(`dispatch ${input.executionId ?? '?'}: ${fault}`)
      // agent-provider-tangle binds the subscription credential before it sends the dispatch.
      if (fault === 'capacity') throw capacityRefusal()
      if (fault === 'crash-before-send') crash(w, 'before dispatch was sent')
      const session = await environment.dispatch!(input)
      const executionId = session.controlRef?.executionId ?? input.executionId ?? ''
      w.executions.add(executionId)
      if (fault === 'unresolvable') w.unresolvable.add(executionId)
      if (fault === 'crash-after-send') crash(w, 'after dispatch was sent')
      if (fault === 'lost-reply') {
        w.lostReplies += 1
        throw lostReply()
      }
      w.lostReplies = 0
      return session
    },
    session(id, options) {
      const session = environment.session!(id, options)
      const executionId = options?.controlRef?.executionId
      return {
        ...session,
        async result() {
          if (executionId !== undefined && world().unresolvable.has(executionId))
            throw unresolvable()
          return session.result()
        },
        // Per-execution cancellation, as Sandbox stops one run without ending its session.
        async cancelRun(request): Promise<AgentRunCancellationAcknowledgement> {
          world().stopped.add(request.run.executionId)
          return {
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            run: request.run,
            status: 'accepted',
            effect: 'cancelled',
          }
        },
      }
    },
  })
  return {
    ...base,
    async create(input) {
      return wrap(await base.create(input))
    },
    async get(id) {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
}

/** Kinds after whose durable append a process may crash: every retained boundary. */
const crashBoundaries: ReadonlySet<SpawnEvent['kind']> = new Set([
  'execution-input',
  'execution-admitted',
  'execution-result',
  'execution-abandoned',
])

function crashingJournal(world: () => World, inner: SpawnJournal): SpawnJournal {
  return {
    loadTree: (root) => inner.loadTree(root),
    beginTree: (root, begunAt) => inner.beginTree(root, begunAt),
    async appendEvent(root, event) {
      await inner.appendEvent(root, event)
      const w = world()
      if (crashBoundaries.has(event.kind) && w.crashes < MAX_CRASHES && w.random() < 0.04)
        crash(w, `after its ${event.kind} was durable`)
    },
  }
}

/** One coordinator process: registers the owner from the journal and drives turns until done. */
async function runProcess(world: World): Promise<'completed' | 'crashed'> {
  const controller = new AbortController()
  world.process = controller
  const signal = controller.signal
  // The owner bookkeeping reads only the scope's identity and its cancellation signal.
  const scope = { signal } as unknown as Scope<unknown>
  registerScopeRetainedOwner(scope, {
    rootId: ROOT,
    nodeId: OWNER,
    journal: world.journal,
    blobs: world.blobs,
    priorEvents: (await world.journal.loadTree(ROOT)) ?? [],
    now: () => world.clock,
  })
  bindScopeRetainedOwnerProvider(scope, world.provider)
  const context = scopeRetainedOwnerContext(scope)
  if (context === undefined) throw new Error('owner was not registered')
  const results = async () =>
    ((await world.journal.loadTree(ROOT)) ?? []).filter(
      (event) => event.id === OWNER && event.kind === 'execution-result',
    ).length
  const records: DriverAttemptRecord[] = []
  try {
    await runDriverWithRetry({
      // The same composition supervise's drive harness uses for a retained provider owner.
      drive: async () => {
        // Every drive takes a second of the run's clock, and a live fleet's children settle.
        world.clock += 1_000
        if (world.live && world.random() < 0.6) world.settled += 1
        const task = await prepareScopeRetainedOwnerTask(scope, `turn ${(await results()) + 1}`)
        if ((await scopeRetainedOwnerResult(scope)) !== undefined) {
          consumeScopeRetainedOwnerResult(scope)
          return
        }
        const executor = providerAsExecutor(world.provider, { destroyOnSettle: false })(
          { profile, harness: 'opencode' },
          { signal, seams: { [retainedExecutorSeamKey]: context } },
        )
        const run =
          context.admissions.length > 0 && executor.recover
            ? executor.recover(task, signal)
            : executor.execute(task, signal)
        for await (const _event of run) {
          // Consume the production provider executor through its result or failure.
        }
      },
      // supervise's progress mark. A live fleet settles children while its check stays unmet, as
      // run d's did: settlements are not progress then, but nothing is idle, so no outage window
      // shelters a failure streak.
      progress: () => ({
        poolTokensSpent: 0,
        settledCount: world.settled,
        submitted: false,
        contract: world.live ? 'unmet' : 'none',
      }),
      budget: () => budget,
      signal,
      resolvePending: (failure, failures) =>
        abandonScopeRetainedOwnerInvocation(scope, failure, failures),
      // Strict bounds: three barren failures end a run once a one-minute outage window passes.
      policy: {
        transientOutageMs: 60_000,
        initialBackoffMs: 1_000,
        maxBackoffMs: 1_000,
        unavailablePauseMs: 1_000,
        maxUnavailablePauseMs: 1_000,
      },
      wait: {
        open: () => true,
        async wake() {
          return (await results()) < TURNS ? { input: 'wake', idleMs: 0 } : undefined
        },
      },
      now: () => world.clock,
      sleep: async (ms) => {
        world.clock += ms
      },
      random: () => 0,
      onAttempt: (record) => {
        records.push(record)
      },
    })
    return 'completed'
  } catch (error) {
    if (signal.aborted && signal.reason instanceof ProcessCrash) return 'crashed'
    const last = records.at(-1)
    throw new Error(
      `seed ${world.seed}: the run died after ${records.length} attempt(s) ` +
        `(last ${last?.classification ?? '?'}: ${last?.error ?? '?'})\n${world.log.join('\n')}`,
      { cause: error },
    )
  }
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function runSequence(seed: number): Promise<World> {
  const root = await mkdtemp(join(tmpdir(), 'retained-pending-invariants-'))
  roots.push(root)
  let world!: World
  const journal = crashingJournal(() => world, new InMemorySpawnJournal())
  world = {
    seed,
    random: mulberry32(seed),
    journal,
    blobs: new InMemoryResultBlobStore(),
    provider: faultyProvider(() => world, join(root, 'provider.json')),
    executions: new Set(),
    unresolvable: new Set(),
    stopped: new Set(),
    log: [],
    live: seed % 2 === 0,
    settled: 0,
    lostReplies: 0,
    clock: Date.parse(at),
    crashes: 0,
    faults: 0,
    capacityStreak: 0,
  }
  await journal.beginTree(ROOT, at)
  await journal.appendEvent(ROOT, {
    kind: 'spawned',
    id: OWNER,
    parent: ROOT,
    label: OWNER,
    runtime: 'cli',
    budget: { maxIterations: 1_000, maxTokens: 1_000_000 },
    seq: 0,
    at,
  })
  for (let process = 0; ; process += 1) {
    if (process > MAX_CRASHES) throw new Error(`seed ${seed}: more processes than crashes`)
    if ((await runProcess(world)) === 'completed') return world
  }
}

/** Split an owner's events into invocations, one per `execution-input`. */
function invocations(events: readonly SpawnEvent[]) {
  const split: Array<{ readonly seq: number; readonly events: SpawnEvent[] }> = []
  for (const event of events) {
    if (event.kind === 'execution-input') split.push({ seq: event.seq, events: [] })
    split.at(-1)?.events.push(event)
  }
  return split.map(({ seq, events: own }) => {
    const intent = own.flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'intent'
        ? [event.admission]
        : [],
    )[0]
    return {
      seq,
      executionId: intent?.phase === 'intent' ? intent.executionId : undefined,
      results: own.filter((event) => event.kind === 'execution-result').length,
      abandoned: own.flatMap((event) => (event.kind === 'execution-abandoned' ? [event] : [])),
    }
  })
}

describe('retained owner pending executions: invariants over dispatch, crash, resume and reconcile', () => {
  it(`holds liveness and no duplicated accepted effect across ${SEQUENCES} seeded sequences`, async () => {
    const totals = { crashes: 0, capacity: 0, abandoned: 0, lostReplies: 0 }
    for (let seed = 1; seed <= SEQUENCES; seed += 1) {
      const world = await runSequence(seed)
      const owned = ((await world.journal.loadTree(ROOT)) ?? []).filter(
        (event) => event.id === OWNER,
      )
      const invoked = invocations(owned)
      const accepted = new Set<string>()
      const abandoned = new Set<string>()
      for (const [index, invocation] of invoked.entries()) {
        const context = `seed ${seed} input ${invocation.seq}\n${world.log.join('\n')}`
        // At most one committed result per invocation, and none for an abandoned one.
        expect(invocation.results, context).toBeLessThanOrEqual(1)
        expect(invocation.results === 1 && invocation.abandoned.length > 0, context).toBe(false)
        expect(invocation.abandoned.length, context).toBeLessThanOrEqual(1)
        // Every invocation but the last was closed before the next began.
        if (index < invoked.length - 1)
          expect(invocation.results + invocation.abandoned.length, context).toBe(1)
        if (invocation.executionId === undefined) continue
        if (invocation.results === 1) {
          // No provider execution is accepted twice.
          expect(accepted.has(invocation.executionId), context).toBe(false)
          accepted.add(invocation.executionId)
        }
        for (const event of invocation.abandoned) {
          // Only an execution the provider could not resolve is ever abandoned, and it was
          // stopped, never left running uncertain, because this provider can stop it.
          expect(world.unresolvable.has(invocation.executionId), context).toBe(true)
          expect(event, context).toMatchObject({
            pendingCause: 'unobservable',
            outcome: 'stopped',
            stop: { executionId: invocation.executionId, effect: 'cancelled' },
          })
          // Resolved on the second identical failure, or on the first that would end the run.
          expect(event.failures, context).toBeGreaterThanOrEqual(1)
          expect(event.failures, context).toBeLessThanOrEqual(2)
          abandoned.add(invocation.executionId)
        }
      }
      const context = `seed ${seed}\n${world.log.join('\n')}`
      // The run delivered exactly its turns: no turn lost, and no accepted effect duplicated.
      expect(accepted.size, context).toBe(TURNS)
      expect(
        invoked.reduce((sum, invocation) => sum + invocation.results, 0),
        context,
      ).toBe(TURNS)
      // Every execution the provider ran is accounted for: accepted once, or abandoned on record.
      for (const executionId of world.executions)
        expect(accepted.has(executionId) || abandoned.has(executionId), context).toBe(true)
      for (const executionId of accepted)
        expect(world.unresolvable.has(executionId) || world.stopped.has(executionId), context).toBe(
          false,
        )
      totals.crashes += world.crashes
      totals.abandoned += abandoned.size
      totals.capacity += world.log.filter((line) => line.endsWith(': capacity')).length
      totals.lostReplies += world.log.filter((line) => line.endsWith(': lost-reply')).length
    }
    // The seeds exercise every path the invariants are about.
    expect(totals.crashes).toBeGreaterThan(5)
    expect(totals.abandoned).toBeGreaterThan(3)
    expect(totals.capacity).toBeGreaterThan(MAX_CAPACITY_STREAK)
    expect(totals.lostReplies).toBeGreaterThan(3)
  }, 120_000)

  it('refuses every later admission or result of an abandoned invocation', async () => {
    const journal = new InMemorySpawnJournal()
    await journal.beginTree(ROOT, at)
    await journal.appendEvent(ROOT, {
      kind: 'spawned',
      id: OWNER,
      parent: ROOT,
      label: OWNER,
      runtime: 'cli',
      budget: { maxIterations: 1, maxTokens: 10 },
      seq: 0,
      at,
    })
    const input = (seq: number): SpawnEvent => ({
      kind: 'execution-input',
      id: OWNER,
      taskRef: contentAddress(`task ${seq}`),
      seq,
      at,
    })
    const abandon = (inputSeq: number): SpawnEvent => ({
      kind: 'execution-abandoned',
      id: OWNER,
      inputSeq,
      pendingCause: 'unobservable',
      failures: 2,
      detail: 'retained provider execution requires reconciliation before replacement',
      outcome: 'uncertain',
      seq: inputSeq + 1,
      at,
    })
    await journal.appendEvent(ROOT, input(1))
    await expect(journal.appendEvent(ROOT, input(2))).rejects.toThrow('unfinished invocation')
    await expect(journal.appendEvent(ROOT, abandon(7))).rejects.toThrow('not its latest')
    await journal.appendEvent(ROOT, abandon(1))
    await expect(journal.appendEvent(ROOT, abandon(1))).rejects.toThrow('twice')
    await expect(
      journal.appendEvent(ROOT, {
        kind: 'execution-result',
        id: OWNER,
        outRef: contentAddress('late'),
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
        seq: 3,
        at,
      }),
    ).rejects.toThrow('follows its abandonment')
    await expect(
      journal.appendEvent(ROOT, {
        kind: 'execution-admitted',
        id: OWNER,
        admission: {
          phase: 'intent',
          provider: 'provider',
          idempotencyKey: 'key',
          turnId: 'turn',
          sessionId: 'session',
          executionId: 'execution',
          runId: 'run',
          requestedProfileDigest: `sha256:${'a'.repeat(64)}`,
          requestDigest: `sha256:${'b'.repeat(64)}`,
        },
        seq: 3,
        at,
      }),
    ).rejects.toThrow('follows its abandonment')
    // The replacement is admitted, and nothing of the abandoned invocation follows it.
    await journal.appendEvent(ROOT, input(4))
    expect((await journal.loadTree(ROOT))?.map((event) => event.kind)).toEqual([
      'spawned',
      'execution-input',
      'execution-abandoned',
      'execution-input',
    ])
  })
})
