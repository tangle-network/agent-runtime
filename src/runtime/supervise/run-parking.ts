import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ValidationError } from '../../errors'
import { sleep } from '../util'
import { writeAtomicDurableFile } from './durable-file'
import { isLiveNodeStatus } from './node-status'
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
interface ParkingContext {
  readonly runDir: string
  readonly runId: string
  readonly journal: SpawnJournal
  readonly now: () => number
  readonly afterMs: number
}
const parkingContext = new AsyncLocalStorage<ParkingContext>()
const parkingDrains = new WeakMap<
  Scope<unknown>,
  {
    readonly drain: () => Promise<void>
    readonly idle: () => boolean
  }
>()

/** Drain committed child work through the existing manager ledger before testing root idleness. */
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
  if (!durable) throw new ValidationError('supervise: parking requires runDir')
  if (
    policy === null ||
    typeof policy !== 'object' ||
    (policy.afterMs !== undefined && (!Number.isFinite(policy.afterMs) || policy.afterMs < 0))
  ) {
    throw new ValidationError('supervise: parking.afterMs must be a nonnegative finite number')
  }
}

/** Scope the handoff to one execution, preserving the original wake time on an early re-entry. */
export async function withRunParking<T>(
  policy: RunParkingPolicy | undefined,
  runDir: string | undefined,
  runId: string,
  journal: SpawnJournal,
  now: () => number,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (policy === undefined || runDir === undefined) return run()
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
    await writeParkingProjection(runDir, runId, current)
    throw new RunParkedError(runId, parkingRecordOf(current))
  }
  if (previous !== undefined) {
    await writeAtomicDurableFile(
      resolve(runDir, 'parking.json'),
      JSON.stringify({
        status: 'resuming',
        runId,
        ...parkingRecordOf(previous),
        resumedAt: new Date(now()).toISOString(),
      }),
    )
  }
  return parkingContext.run(
    { runDir, runId, journal, now, afterMs: policy.afterMs ?? DEFAULT_PARK_AFTER_MS },
    run,
  )
}

/**
 * Sleep through the existing wait path. A root with no live descendants may hand off after its
 * idle threshold; children and roots with active work keep their normal wait. No timer survives
 * the handoff, and no provider work is cancelled or terminal settlement written for parking.
 */
export async function sleepScopeWait(
  scope: Scope<unknown>,
  ms: number,
  signal: AbortSignal,
  reason: RunParkingRecord['reason'],
): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  const context = parkingContext.getStore()
  const onlyRootWait = () =>
    context !== undefined &&
    scope.view.root === context.runId &&
    parkingDrains.get(scope)?.idle() !== false &&
    scope.workerCapacity.unconfirmed.length === 0 &&
    !(scope.observeTree?.() ?? scope.view).nodes.some(
      (node) => node.id !== context.runId && isLiveNodeStatus(node.status),
    )
  if (context === undefined || scope.view.root !== context.runId || ms <= context.afterMs) {
    return sleep(ms, signal, false)
  }
  const since = context.now()
  const deadline = scope.budget.deadlineMs
  const wakeAt = Math.min(since + ms, deadline > 0 ? deadline : Number.POSITIVE_INFINITY)
  if (wakeAt - since <= context.afterMs) return sleep(ms, signal, false)
  let idleSince = onlyRootWait() ? since : undefined
  for (;;) {
    const remaining = Math.max(0, wakeAt - context.now())
    if (remaining <= context.afterMs) return sleep(remaining, signal, false)
    const checkMs = context.afterMs || (idleSince === undefined ? DEFAULT_PARK_AFTER_MS : 0)
    await sleep(Math.min(checkMs, remaining), signal, false)
    if (signal.aborted) return
    await parkingDrains.get(scope)?.drain()
    if (!onlyRootWait()) {
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
    const ownerEvents = events.filter((event) => event.id === context.runId)
    const input = [...ownerEvents].reverse().find((event) => event.kind === 'execution-input')
    const invocation = input === undefined ? [] : ownerEvents.slice(ownerEvents.indexOf(input))
    const unresolved =
      invocation.some((event) => event.kind === 'execution-admitted') &&
      !invocation.some(
        (event) =>
          event.kind === 'execution-result' ||
          (event.kind === 'execution-abandoned' && event.outcome === 'stopped'),
      )
    // An uncertain retained invocation can still be computing. It is not an idle root.
    if (unresolved || !onlyRootWait()) {
      idleSince = undefined
      continue
    }
    const parking: RunParkingRecord = {
      reason: deadline > 0 && wakeAt === deadline ? 'deadline' : reason,
      since: new Date(idleSince).toISOString(),
      wakeAt: new Date(wakeAt).toISOString(),
    }
    // Seal synchronously before publishing: no concurrent MCP spawn may cross this handoff.
    closeScopeAdmission(scope)
    await context.journal.appendEvent(context.runId, {
      kind: 'run-parked',
      id: context.runId,
      ...parking,
      seq: events.filter((event) => event.kind === 'run-parked').length,
      at: new Date(context.now()).toISOString(),
    })
    await writeParkingProjection(context.runDir, context.runId, parking)
    throw new RunParkedError(context.runId, parking)
  }
}

async function writeParkingProjection(
  runDir: string,
  runId: string,
  parking: RunParkingRecord,
): Promise<void> {
  await writeAtomicDurableFile(
    resolve(runDir, 'parking.json'),
    JSON.stringify({
      status: 'parked',
      runId,
      ...parkingRecordOf(parking),
    }),
  )
}

function parkingRecordOf(record: RunParkingRecord): RunParkingRecord {
  return { reason: record.reason, since: record.since, wakeAt: record.wakeAt }
}
