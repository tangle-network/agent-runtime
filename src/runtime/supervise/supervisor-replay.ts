import { sha256DigestSchema } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import {
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import type {
  Budget,
  ExecutionBindingReceipt,
  NoWinnerError,
  ProfileMaterializationReceipt,
  ResumedKeyState,
  Settled,
  SpawnEvent,
  Spend,
  SupervisedResult,
  SupervisorOpts,
  TreeView,
} from './types'
import type { PendingWait } from './wait'

export interface ResumeFrom {
  readonly settled: ReadonlyArray<Settled<unknown>>
  readonly view: TreeView
  readonly maxSpawnOrdinal: number
  readonly maxCursorSeq: number
  readonly maxWaitOrdinal: number
  readonly waits: ReadonlyArray<PendingWait>
  readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>
  readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
}

export function keyedAssignments(
  events: SpawnEvent[],
  settled: ReadonlyArray<Settled<unknown>>,
): ReadonlyMap<string, ResumedKeyState<unknown>> {
  const byId = new Map(settled.map((s) => [s.handle.id, s]))
  const keys = new Map<string, ResumedKeyState<unknown>>()
  const spawns = events
    .filter((ev): ev is Extract<SpawnEvent, { kind: 'spawned' }> => ev.kind === 'spawned')
    .sort((a, b) => a.seq - b.seq)
  for (const ev of spawns) {
    if (ev.key === undefined) continue
    if (ev.identity === undefined) {
      throw new RuntimeRunStateError(
        `supervisor: keyed node '${ev.id}' has no durable execution identity`,
      )
    }
    const settledEvent = byId.get(ev.id)
    keys.set(
      ev.key,
      settledEvent === undefined
        ? { id: ev.id, label: ev.label, identity: ev.identity, state: 'in-doubt' }
        : {
            id: ev.id,
            label: ev.label,
            identity: ev.identity,
            state: settledEvent.kind === 'done' ? 'completed' : 'down',
            settled: settledEvent,
          },
    )
  }
  return keys
}

export type SpawnedEvent = Extract<SpawnEvent, { kind: 'spawned' }>

export function assertResumeContract(events: SpawnEvent[], opts: SupervisorOpts): SpawnedEvent {
  const roots = events.filter(
    (event): event is SpawnedEvent =>
      event.kind === 'spawned' && event.id === opts.runId && event.parent === undefined,
  )
  if (roots.length !== 1) {
    throw new RuntimeRunStateError(
      `supervisor: resumed run '${opts.runId}' must contain exactly one root identity event; found ${roots.length}`,
    )
  }
  const recorded = roots[0]!
  if (contentAddress(recorded.budget) !== contentAddress(opts.budget)) {
    throw new RuntimeRunStateError(
      `supervisor: resume budget mismatch for run '${opts.runId}'; use a new runId to change limits`,
    )
  }
  if (!sameOptionalIdentity(recorded.identity, opts.rootIdentity)) {
    throw new RuntimeRunStateError(
      `supervisor: resume identity mismatch for run '${opts.runId}'; task, profile, candidate, and correlation must match`,
    )
  }
  const receipts = events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
      event.kind === 'materialized' && event.id === opts.runId,
  )
  const expectedReceipt = rootMaterializationReceipt(opts)
  if (expectedReceipt === undefined) {
    if (receipts.length > 1) {
      throw new RuntimeRunStateError(
        `supervisor: resumed run '${opts.runId}' contains duplicate root materialization evidence`,
      )
    }
  } else if (
    receipts.length !== 1 ||
    contentAddress(receipts[0]?.receipt) !== contentAddress(expectedReceipt)
  ) {
    throw new RuntimeRunStateError(
      `supervisor: resume materialization mismatch for run '${opts.runId}'; backend, model, execution identity, and plan must match`,
    )
  }
  return recorded
}

export function rootMaterializationReceipt(
  opts: SupervisorOpts,
): ProfileMaterializationReceipt | undefined {
  const declaration = opts.rootMaterialization
  if (declaration === undefined) {
    return unknownMaterializationReceipt({
      ...(opts.rootIdentity?.profileDigest === undefined
        ? {}
        : { authoredProfileDigest: opts.rootIdentity.profileDigest }),
      runtime: 'inline',
      reason: 'root-agent-did-not-report',
    })
  }
  if (declaration.declaration === 'deferred') return undefined
  if (opts.rootIdentity?.profileDigest === undefined) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' cannot record known root materialization without an exact profileDigest`,
    )
  }
  try {
    return knownMaterializationReceipt({
      authoredProfileDigest: opts.rootIdentity.profileDigest,
      runtime: declaration.runtime,
      declaration: declaration.declaration,
    })
  } catch (error) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' has invalid root materialization evidence`,
      { cause: error },
    )
  }
}

export function rootExecutionBindingReceipt(
  opts: SupervisorOpts,
  materialization: ProfileMaterializationReceipt,
  attemptId: string,
): ExecutionBindingReceipt | undefined {
  const root = opts.rootMaterialization
  if (root?.declaration === 'deferred') return undefined
  if (root === undefined) {
    return unknownExecutionBindingReceipt(materialization, attemptId, 'root-agent-did-not-report')
  }
  try {
    return knownExecutionBindingReceipt(materialization, { attemptId, ...root.binding })
  } catch (error) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' has invalid root execution binding`,
      { cause: error },
    )
  }
}

function sameOptionalIdentity(
  recorded: SpawnedEvent['identity'],
  requested: SpawnedEvent['identity'],
): boolean {
  if (recorded === undefined || requested === undefined) return recorded === requested
  return contentAddress(recorded) === contentAddress(requested)
}

export function assertRootIdentity(opts: SupervisorOpts): void {
  const identity = opts.rootIdentity
  if (identity === undefined) {
    if (opts.resume !== true) return
    throw new RuntimeRunStateError(
      `supervisor: resumed run '${opts.runId}' requires an exact rootIdentity with profileDigest and taskDigest`,
    )
  }
  const unknownFields = Object.keys(identity).filter(
    (key) =>
      key !== 'profileDigest' &&
      key !== 'taskDigest' &&
      key !== 'candidateDigest' &&
      key !== 'correlation',
  )
  const correlation = identity.correlation
  const validCorrelation =
    correlation === undefined ||
    (typeof correlation === 'object' &&
      correlation !== null &&
      !Array.isArray(correlation) &&
      Object.entries(correlation).every(
        ([key, value]) => key.length > 0 && typeof value === 'string' && value.length > 0,
      ))
  if (
    unknownFields.length > 0 ||
    !sha256DigestSchema.safeParse(identity.profileDigest).success ||
    !sha256DigestSchema.safeParse(identity.taskDigest).success ||
    (identity.candidateDigest !== undefined &&
      !sha256DigestSchema.safeParse(identity.candidateDigest).success) ||
    !validCorrelation
  ) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' requires an exact rootIdentity with valid profileDigest, taskDigest, candidateDigest, and correlation`,
    )
  }
}

export function rootDeadline(root: SpawnedEvent): number {
  const startedAt = Date.parse(root.at)
  if (!Number.isFinite(startedAt)) {
    throw new RuntimeRunStateError(
      `supervisor: root event for '${root.id}' has an invalid timestamp '${root.at}'`,
    )
  }
  return startedAt + (root.budget.deadlineMs ?? 0)
}

export function uncertainSpawnBudgets(events: SpawnEvent[]): Budget[] {
  const terminal = new Set(
    events
      .filter(
        (event) => event.kind === 'settled' || event.kind === 'cancelled' || event.kind === 'woken',
      )
      .map((event) => event.id),
  )
  return events
    .filter(
      (event): event is SpawnedEvent =>
        event.kind === 'spawned' && event.parent !== undefined && !terminal.has(event.id),
    )
    .map((event) => event.budget)
}

export function maxSeqOf(events: SpawnEvent[], pred: (ev: SpawnEvent) => boolean): number {
  let max = -1
  for (const ev of events) if (pred(ev) && ev.seq > max) max = ev.seq
  return max
}

export const defaultMaxDepth = 4
export type NoWinnerReason = (SupervisedResult<unknown> & { kind: 'no-winner' })['reason']
export type LifecycleNoWinnerReason = Exclude<NoWinnerReason, 'driver-failed'>
export interface DriverRejection {
  readonly error: unknown
}

export function describeRejection(error: unknown): NoWinnerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack !== undefined ? { stack: error.stack } : {}),
    }
  }
  let message: string
  try {
    message = typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error))
  } catch {
    message = Object.prototype.toString.call(error)
  }
  return { name: 'NonError', message }
}
