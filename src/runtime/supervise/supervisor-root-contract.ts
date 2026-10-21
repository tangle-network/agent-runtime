import { sha256DigestSchema } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { RuntimeRunStateError } from '../../errors'
import {
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import type { ScopeResumeState } from './recover-executors'
import { reenteredWorkers } from './scope'
import type {
  ExecutionBindingReceipt,
  ProfileMaterializationReceipt,
  RootSegmentEntry,
  SpawnEvent,
  SupervisorOpts,
} from './types'

export type SpawnedEvent = Extract<SpawnEvent, { kind: 'spawned' }>

/** A resumed process may continue only the exact root contract first recorded for this run id. */
export function assertResumeContract(events: SpawnEvent[], opts: SupervisorOpts): SpawnedEvent {
  const roots = events.filter(
    (event): event is SpawnedEvent => event.kind === 'spawned' && event.parent === undefined,
  )
  if (roots.length !== 1 || roots[0]?.id !== opts.runId) {
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
  const expectedAdmission = opts.reservationPolicy ? { policy: opts.reservationPolicy } : undefined
  if (
    contentAddress(recorded.recursiveAdmission ?? null) !==
    contentAddress(expectedAdmission ?? null)
  ) {
    throw new RuntimeRunStateError(
      `supervisor: resume reservation policy mismatch for run '${opts.runId}'; use a new runId`,
    )
  }
  if (!sameOptionalIdentity(recorded.identity, opts.rootIdentity)) {
    throw new RuntimeRunStateError(
      `supervisor: resume identity mismatch for run '${opts.runId}'; ${describeIdentityMismatch(recorded.identity, opts.rootIdentity)}`,
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

/** Mint root evidence at the trusted composition boundary. A generic in-process Agent root has no
 * executor declaration and remains explicitly unknown rather than inheriting fabricated details. */
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
    return knownExecutionBindingReceipt(materialization, {
      attemptId,
      ...root.binding,
    })
  } catch (error) {
    throw new RuntimeRunStateError(
      `supervisor: run '${opts.runId}' has invalid root execution binding`,
      { cause: error },
    )
  }
}

/** Whether a segment changes what the recorded profile runs, apart from the caller's stack. */
export function changesRootProfile(entry: RootSegmentEntry): boolean {
  const { stack: _stack, ...current } = entry.current
  return contentAddress(current) !== contentAddress(entry.registered)
}

/**
 * Append one `root-segment` record when the root enters a segment that differs from the one it
 * last ran. The last record's `to` is what it last ran; a resumed run with no record last ran its
 * recorded profile, and a fresh run ran nothing. Every later entry on the same segment appends
 * nothing, so a resume after a dead supervisor or a lost stream is a boundary, not a segment.
 */
export async function recordRootSegment(
  opts: SupervisorOpts,
  events: readonly SpawnEvent[],
  at: string,
  fresh: boolean,
): Promise<void> {
  const entry = opts.rootSegment
  if (entry === undefined) return
  const records = events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'root-segment' }> =>
      event.kind === 'root-segment' && event.id === opts.runId,
  )
  const last = records.at(-1)?.to ?? (fresh ? undefined : entry.registered)
  if (last !== undefined && contentAddress(last) === contentAddress(entry.current)) return
  await opts.journal.appendEvent(opts.runId, {
    kind: 'root-segment',
    id: opts.runId,
    ...(last === undefined ? {} : { from: last }),
    to: entry.current,
    reason: entry.reason,
    seq: records.length,
    at,
  })
}

/**
 * Append one `root-reentered` record: this process is supervising a run an earlier process drove.
 * Measured 2026-10-19 on magnetar-rust-20261019f: after a host reboot the re-entered root ran two
 * barren continuations and the run settled `no-result-selected`, with three workers still open in
 * the journal and no record that a restart had happened.
 */
export async function recordRootReentered(
  opts: SupervisorOpts,
  resumeFrom: ScopeResumeState,
  at: string,
): Promise<void> {
  await opts.journal.appendEvent(opts.runId, {
    kind: 'root-reentered',
    id: opts.runId,
    ...reenteredWorkers(resumeFrom, opts.runId),
    seq: resumeFrom.events.filter((event) => event.kind === 'root-reentered').length,
    at,
  })
}

function sameOptionalIdentity(
  recorded: SpawnedEvent['identity'],
  requested: SpawnedEvent['identity'],
): boolean {
  if (recorded === undefined || requested === undefined) return recorded === requested
  return contentAddress(recorded) === contentAddress(requested)
}

/**
 * Name the identity fields that actually differ, with both values.
 *
 * The identity is compared as one content address, so a mismatch is a single boolean and the
 * message could only list every field that MIGHT have caused it. A caller then has to diff four
 * digests by hand to learn which one moved, and the common cause — a task file regenerated with
 * one character different — is indistinguishable from a genuinely different profile.
 *
 * Digests are truncated because the prefix identifies them and the full 64 characters push the
 * real content off the end of a terminal line.
 */
function describeIdentityMismatch(
  recorded: SpawnedEvent['identity'],
  requested: SpawnedEvent['identity'],
): string {
  if (recorded === undefined)
    return 'the recorded root carried no identity but this resume supplies one'
  if (requested === undefined)
    return 'the recorded root carried an identity but this resume supplies none'
  const short = (value: unknown): string => {
    if (value === undefined) return '(absent)'
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > 20 ? `${text.slice(0, 20)}…` : text
  }
  const differing = (['profileDigest', 'taskDigest', 'candidateDigest', 'correlation'] as const)
    .filter((field) => contentAddress(recorded[field]) !== contentAddress(requested[field]))
    .map(
      (field) =>
        `${field} recorded ${short(recorded[field])} but resumed with ${short(requested[field])}`,
    )
  // A differing content address with no differing field means the shape itself changed (an extra
  // key, a different key order the address is sensitive to). Say that rather than nothing.
  if (differing.length === 0)
    return 'the identity objects differ in shape while every known field matches'
  return `${differing.join('; ')} — a different task or root profile is a new run; a resume may change the root's model, reasoning effort and harness as a new segment of this run (segment)`
}

/** Validate caller-supplied root identity before any journal access. Fresh runs may omit identity,
 * but once supplied it is trusted durable evidence and therefore must be complete and canonical;
 * resumed runs always require it so the prior root can be matched exactly. */
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

/** The instant the run's root was journaled — the anchor for both the absolute deadline and the
 *  terminal wall-clock `ms`, so a resumed run measures from its ORIGINAL start, not this
 *  process's. */
export function rootStartedAtMs(root: SpawnedEvent): number {
  const startedAt = Date.parse(root.at)
  if (!Number.isFinite(startedAt)) {
    throw new RuntimeRunStateError(
      `supervisor: root event for '${root.id}' has an invalid timestamp '${root.at}'`,
    )
  }
  return startedAt
}
