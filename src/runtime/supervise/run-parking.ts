import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ValidationError } from '../../errors'
import { sleep } from '../util'
import { writeAtomicDurableFile } from './durable-file'
import { isLiveNodeStatus } from './node-status'
import { owners, scopeOwnerLiabilities } from './retained-owner-state'
import { closeScopeAdmission } from './scope-capabilities'
import type { Scope, SpawnEvent, SpawnJournal } from './types'

/** Release a durable coordinator after it has only waited this long. The caller's keeper owns wakeup. */
export interface RunParkingPolicy {
  /** Milliseconds of idle waiting before returning RunParkedError. Runtime owns the default idle threshold. */
  readonly afterMs?: number
}

/** The durable handoff from a waiting coordinator to its existing keeper. */
export interface RunParkingRecord {
  readonly reason: 'seat-wait' | 'paused-root' | 'deadline'
  readonly since: string
  readonly wakeAt: string
}

/** The current parked root, read without loading its journal. */
export interface ParkedRun extends RunParkingRecord {
  readonly runId: string
}

/** Read the journal's bounded parking projection. Undefined means no current parking handoff. */
export async function readRunParking(runDir: string): Promise<ParkedRun | undefined> {
  let raw: string
  try {
    raw = await readFile(resolve(runDir, 'parking.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const record: unknown = JSON.parse(raw)
  if (record === null || typeof record !== 'object') throw new Error('invalid run parking record')
  const data = record as Record<string, unknown>
  if (data.status === 'resuming') return undefined
  if (
    data.status !== 'parked' ||
    typeof data.runId !== 'string' ||
    !['seat-wait', 'paused-root', 'deadline'].includes(String(data.reason)) ||
    typeof data.since !== 'string' ||
    !Number.isFinite(Date.parse(data.since)) ||
    typeof data.wakeAt !== 'string' ||
    !Number.isFinite(Date.parse(data.wakeAt))
  ) {
    throw new Error('invalid run parking record')
  }
  return Object.freeze({
    runId: data.runId,
    reason: data.reason as RunParkingRecord['reason'],
    since: data.since,
    wakeAt: data.wakeAt,
  })
}

/** A resumable wait, with no terminal result or failure. Catch it and let the coordinator exit. */
export class RunParkedError extends Error {
  constructor(
    readonly runId: string,
    readonly parking: RunParkingRecord,
  ) {
    super(`run '${runId}' parked (${parking.reason}) until ${parking.wakeAt}`)
    this.name = 'RunParkedError'
  }
}

const DEFAULT_PARK_AFTER_MS = 60_000
/** A seat reset nearer than this is slept through in place; requeueing costs more than it frees. */
const SEAT_PARK_MIN_MS = 5 * 60_000
interface ParkableWait {
  readonly scope: Scope<unknown>
  readonly wakeAt: number
  readonly floor: number
  readonly reason: RunParkingRecord['reason']
}
interface ParkingContext {
  readonly runDir: string | undefined
  readonly runId: string
  readonly journal: SpawnJournal
  readonly now: () => number
  readonly afterMs: number
  /** The run's root scope and its write seal, bound when the root execution starts. */
  root?: { readonly scope: Scope<unknown>; readonly seal: (error: Error) => void }
  /** Every scope sleeping in a wait that may hand the run off, by its node id. */
  readonly waits: Map<string, ParkableWait>
  /** Rejects once with the run's park, so the root execution and every wait hand off together. */
  readonly parked: Promise<never>
  readonly park: (error: RunParkedError) => void
  handingOff: boolean
}
const parkingContext = new AsyncLocalStorage<ParkingContext>()
const parkingDrains = new WeakMap<
  Scope<unknown>,
  {
    readonly drain: () => Promise<void>
    readonly idle: () => boolean
  }
>()

/** Drain committed child work through the existing manager ledger before testing idleness. */
export function bindScopeParkingDrain(
  scope: Scope<unknown>,
  drain: () => Promise<void>,
  idle: () => boolean,
): void {
  parkingDrains.set(scope, { drain, idle })
}

/** Validate at intake, before any execution or ownership acquisition. */
export function assertRunParking(policy: RunParkingPolicy | undefined, durable: boolean): void {
  if (policy === undefined) return
  if (!durable) throw new ValidationError('supervise: parking requires runDir or a SQL runContext')
  if (
    policy === null ||
    typeof policy !== 'object' ||
    (policy.afterMs !== undefined && (!Number.isFinite(policy.afterMs) || policy.afterMs < 0))
  ) {
    throw new ValidationError('supervise: parking.afterMs must be a nonnegative finite number')
  }
}

/** Whether this error is the current run's own park, which every scope of the run propagates. */
export function isRunParked(error: unknown, scope: Scope<unknown>): error is RunParkedError {
  return (
    error instanceof RunParkedError &&
    (error.runId === scope.view.root || error.runId === parkingContext.getStore()?.runId)
  )
}

/**
 * Scope the handoff to one execution, preserving the original wake time on an early re-entry.
 * The journal's `run-parked` event is the durable record; `parking.json` is its runDir projection.
 */
export async function withRunParking<T>(
  policy: RunParkingPolicy | undefined,
  runDir: string | undefined,
  runId: string,
  journal: SpawnJournal,
  now: () => number,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  // A run that did not opt in never joins an enclosing run's handoff.
  if (policy === undefined) return parkingContext.exit(run)
  const events = (await journal.loadTree(runId)) ?? []
  const previous = [...events]
    .reverse()
    .find(
      (event): event is Extract<SpawnEvent, { kind: 'run-parked' }> => event.kind === 'run-parked',
    )
  const transition = [...events]
    .reverse()
    .find(
      (event) =>
        event.id === runId &&
        (event.kind === 'run-parked' ||
          event.kind === 'root-reentered' ||
          event.kind === 'reopened'),
    )
  const current = transition?.kind === 'run-parked' ? transition : undefined
  if (current !== undefined && Date.parse(current.wakeAt) > now() && !signal?.aborted) {
    if (runDir !== undefined) await writeParkingProjection(runDir, runId, current)
    throw new RunParkedError(runId, parkingRecordOf(current))
  }
  if (previous !== undefined && runDir !== undefined)
    await writeParkingProjection(runDir, runId, previous, now())
  let park!: (error: RunParkedError) => void
  const parked = new Promise<never>((_, reject) => {
    park = reject
  })
  parked.catch(() => undefined)
  return parkingContext.run(
    {
      runDir,
      runId,
      journal,
      now,
      afterMs: policy.afterMs ?? DEFAULT_PARK_AFTER_MS,
      waits: new Map(),
      parked,
      park,
      handingOff: false,
    },
    run,
  )
}

/** Run the root execution so a park decided by any of the run's waits rejects it at once. */
export function raceRunParking<T>(
  runId: string,
  scope: Scope<unknown>,
  seal: (error: Error) => void,
  run: () => Promise<T>,
): Promise<T> {
  const context = parkingContext.getStore()
  if (context === undefined || context.runId !== runId) return run()
  context.root = { scope, seal }
  const running = run()
  // The parked execution is abandoned in place; its later rejection is not this run's outcome.
  running.catch(() => undefined)
  return Promise.race([running, context.parked])
}

/**
 * Sleep through the existing wait path. The run may hand off once every live node is waiting
 * here: the root on its own wait, any node on a seat reset at least SEAT_PARK_MIN_MS away. A run
 * with other active work keeps its normal wait. No timer survives the handoff, and no provider
 * work is cancelled or terminal settlement written for parking.
 */
export async function sleepScopeWait(
  scope: Scope<unknown>,
  ms: number,
  signal: AbortSignal,
  reason: RunParkingRecord['reason'],
): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  const context = parkingContext.getStore()
  const node = scope.view.root
  if (context === undefined || (node !== context.runId && reason !== 'seat-wait')) {
    return sleep(ms, signal, false)
  }
  const floor =
    reason === 'seat-wait' ? Math.max(context.afterMs, SEAT_PARK_MIN_MS) : context.afterMs
  const since = context.now()
  const deadline = Math.min(
    deadlineOf(scope),
    context.root ? deadlineOf(context.root.scope) : Number.POSITIVE_INFINITY,
  )
  const wakeAt = Math.min(since + ms, deadline)
  if (wakeAt - since <= floor) return sleep(ms, signal, false)
  context.waits.set(node, {
    scope,
    wakeAt,
    floor,
    reason: wakeAt === deadline && wakeAt < since + ms ? 'deadline' : reason,
  })
  try {
    let idleSince = runIdle(context) ? since : undefined
    for (;;) {
      const remaining = Math.max(0, wakeAt - context.now())
      if (remaining <= floor)
        return await Promise.race([sleep(remaining, signal, false), context.parked])
      const checkMs = context.afterMs || (idleSince === undefined ? DEFAULT_PARK_AFTER_MS : 0)
      // An unref'd timer: a park decided by another wait rejects here and leaves nothing holding.
      await Promise.race([sleep(Math.min(checkMs, remaining), signal, false), context.parked])
      if (signal.aborted) return
      for (const held of heldScopes(context)) await parkingDrains.get(held)?.drain()
      if (!runIdle(context)) {
        idleSince = undefined
        continue
      }
      if (idleSince === undefined) {
        idleSince = context.now()
        continue
      }
      if (context.now() - idleSince < context.afterMs) continue
      const events = (await context.journal.loadTree(context.runId)) ?? []
      if (signal.aborted) return
      // An uncertain retained invocation can still be computing. It is not an idle run.
      if ((await invocationUnresolved(context, events)) || !runIdle(context)) {
        idleSince = undefined
        continue
      }
      const at = context.now()
      const waits = [...context.waits.values()]
      if (waits.some((wait) => wait.wakeAt - at <= wait.floor)) continue
      await parkRun(context, waits, idleSince, events)
    }
  } finally {
    context.waits.delete(node)
  }
}

async function parkRun(
  context: ParkingContext,
  waits: readonly ParkableWait[],
  idleSince: number,
  events: readonly SpawnEvent[],
): Promise<never> {
  if (context.handingOff) return context.parked
  context.handingOff = true
  const root = context.root!
  const earliest = waits.reduce((first, wait) => (wait.wakeAt < first.wakeAt ? wait : first))
  const parking: RunParkingRecord = {
    reason: earliest.reason,
    since: new Date(idleSince).toISOString(),
    wakeAt: new Date(earliest.wakeAt).toISOString(),
  }
  // Seal synchronously before publishing: no concurrent MCP spawn may cross this handoff.
  for (const held of heldScopes(context)) closeScopeAdmission(held)
  await context.journal.appendEvent(context.runId, {
    kind: 'run-parked',
    id: context.runId,
    ...parking,
    seq: events.filter((event) => event.kind === 'run-parked').length,
    at: new Date(context.now()).toISOString(),
  })
  if (context.runDir !== undefined)
    await writeParkingProjection(context.runDir, context.runId, parking)
  const error = new RunParkedError(context.runId, parking)
  // Waiting nodes unwind through their own scopes; none of them may settle the parked run.
  if (waits.some((wait) => wait.scope !== root.scope)) root.seal(error)
  context.park(error)
  throw error
}

function heldScopes(context: ParkingContext): Scope<unknown>[] {
  const scopes = new Set([...context.waits.values()].map((wait) => wait.scope))
  if (context.root) scopes.add(context.root.scope)
  return [...scopes]
}

/** Every live node is in a parkable wait, and no scope holds open work or unconfirmed capacity. */
function runIdle(context: ParkingContext): boolean {
  const root = context.root
  if (root === undefined) return false
  if (
    heldScopes(context).some(
      (held) =>
        parkingDrains.get(held)?.idle() === false || held.workerCapacity.unconfirmed.length > 0,
    )
  )
    return false
  return !(root.scope.observeTree?.() ?? root.scope.view).nodes.some(
    (node) =>
      node.id !== context.runId && isLiveNodeStatus(node.status) && !context.waits.has(node.id),
  )
}

/** The owners' own receipts decide: an admitted invocation without its result may still compute. */
async function invocationUnresolved(context: ParkingContext, rootEvents: readonly SpawnEvent[]) {
  for (const held of heldScopes(context)) {
    const rootId = owners.get(held)?.args.rootId
    if (rootId === undefined) continue
    const events = rootId === context.runId ? rootEvents : await context.journal.loadTree(rootId)
    if (scopeOwnerLiabilities(held, events ?? []).invocationUnsettled) return true
  }
  return false
}

function deadlineOf(scope: Scope<unknown>): number {
  const deadline = scope.budget.deadlineMs
  return deadline > 0 ? deadline : Number.POSITIVE_INFINITY
}

async function writeParkingProjection(
  runDir: string,
  runId: string,
  parking: RunParkingRecord,
  resumedAt?: number,
): Promise<void> {
  await writeAtomicDurableFile(
    resolve(runDir, 'parking.json'),
    JSON.stringify({
      status: resumedAt === undefined ? 'parked' : 'resuming',
      runId,
      ...parkingRecordOf(parking),
      ...(resumedAt === undefined ? {} : { resumedAt: new Date(resumedAt).toISOString() }),
    }),
  )
}

function parkingRecordOf(record: RunParkingRecord): RunParkingRecord {
  return { reason: record.reason, since: record.since, wakeAt: record.wakeAt }
}
