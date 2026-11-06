import {
  type AgentWorkspaceBranching,
  workspaceCleanupAcknowledgementMatches,
  workspaceCleanupRequestDigest,
} from '@tangle-network/agent-interface'
import { deadlineSignal, runAbortable } from './abortable'
import { errMessage } from './error-message'
import { type CheckpointEvent, checkpointHandle } from './retained-owner-checkpoint-requests'
import type { OwnerState } from './retained-owner-state'
import type { SpawnEvent } from './types'

type CheckpointCaptureEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-capture' }>

type ForkTeardownEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-fork-teardown' }>

/** A checkpoint kept without a delete because no capture holds its files. */
export interface CaptureRefusal {
  readonly event: CheckpointEvent
  readonly reason: string
  /** Whether a later capture needs the source: its handle is the only one that can fork it. */
  readonly needsSource: boolean
}

/** Deletes the provider did not confirm, and checkpoints kept because no capture holds their files. */
export interface CheckpointCleanup {
  readonly unconfirmed: ReadonlyArray<{ readonly event: CheckpointEvent; readonly reason: string }>
  readonly refused: CaptureRefusal[]
}

/** Delete captured checkpoints. An aborted parent starts no further provider call. */
export async function cleanCheckpoints(
  state: OwnerState,
  branching: AgentWorkspaceBranching | undefined,
  checkpoints: readonly CheckpointEvent[],
  events: readonly SpawnEvent[],
  parent?: AbortSignal,
  uncapturable = false,
): Promise<CheckpointCleanup> {
  const unconfirmed: Array<{ readonly event: CheckpointEvent; readonly reason: string }> = []
  const refused: CaptureRefusal[] = []
  for (const event of checkpoints) {
    const captured = captureBeforeCleanup(state, event, events, uncapturable)
    if ('reason' in captured) {
      state.captureRefused ??= new Set()
      state.captureRefused.add(event.checkpoint.checkpointId)
      refused.push(captured)
      await state.args.journal.appendEvent(state.args.rootId, {
        kind: 'workspace-checkpoint-cleanup',
        id: state.args.nodeId,
        provider: event.provider,
        environmentId: event.environmentId,
        checkpointId: event.checkpoint.checkpointId,
        confirmed: false,
        refused: captured.reason.slice(0, 1_000),
        seq: state.nextSequence(),
        at: new Date(state.args.now()).toISOString(),
      })
      continue
    }
    state.captureRefused?.delete(event.checkpoint.checkpointId)
    const material = {
      kind: 'checkpoint' as const,
      targetId: event.checkpoint.checkpointId,
      provider: event.checkpoint.provider,
    }
    const request = {
      ...material,
      operationId: `${event.checkpoint.idempotencyKey}:delete`,
      requestDigest: workspaceCleanupRequestDigest(material),
    }
    let confirmed = false
    let reason: string | undefined
    const signal = deadlineSignal(parent, 30_000)
    try {
      if (parent?.aborted) reason = 'cancelled before checkpoint cleanup'
      else if (branching === undefined)
        throw new Error('source-scoped checkpoint handle unavailable')
      else {
        const acknowledgement = await runAbortable(
          () => branching.deleteCheckpoint(request, { signal }),
          signal,
          'retained owner checkpoint cleanup timed out',
        )
        confirmed =
          workspaceCleanupAcknowledgementMatches(request, acknowledgement) &&
          (acknowledgement.status === 'deleted' || acknowledgement.status === 'already_absent')
        if (!confirmed) reason = `provider acknowledged '${acknowledgement.status}'`
      }
    } catch (error) {
      // The journal and settle result retain the unresolved resource, with its reason (#1594).
      reason = errMessage(error).slice(0, 1_000)
    }
    if (!confirmed) unconfirmed.push({ event, reason: reason ?? 'delete was not confirmed' })
    await state.args.journal.appendEvent(state.args.rootId, {
      kind: 'workspace-checkpoint-cleanup',
      id: state.args.nodeId,
      provider: event.provider,
      environmentId: event.environmentId,
      checkpointId: event.checkpoint.checkpointId,
      confirmed,
      ...(reason === undefined ? {} : { refused: reason.slice(0, 1_000) }),
      ...(captured.digest === undefined ? {} : { capturedDigest: captured.digest }),
      seq: state.nextSequence(),
      at: new Date(state.args.now()).toISOString(),
    })
  }
  return { unconfirmed, refused }
}

/** Read the persisted checkpoint capture, or preserve an uncaptured checkpoint. */
function captureBeforeCleanup(
  state: OwnerState,
  event: CheckpointEvent,
  events: readonly SpawnEvent[],
  uncapturable = false,
): { readonly digest?: import('@tangle-network/agent-interface').Sha256Digest } | CaptureRefusal {
  const { args } = state
  const checkpointId = event.checkpoint.checkpointId
  const recorded = events.find(
    (prior): prior is CheckpointCaptureEvent =>
      prior.kind === 'workspace-checkpoint-capture' &&
      prior.id === args.nodeId &&
      prior.provider === event.provider &&
      prior.environmentId === event.environmentId &&
      prior.checkpointId === checkpointId,
  )
  if (recorded !== undefined) return { digest: recorded.tree.digest }
  const refuse = (reason: string, needsSource: boolean): CaptureRefusal => ({
    event,
    reason,
    needsSource,
  })
  return uncapturable
    ? {}
    : refuse(
        'client checkpoint capture writers are retired; no persisted capture holds this checkpoint',
        false,
      )
}

/** Destroy a capture's fork and journal whether the provider confirmed it. */
async function destroyCaptureFork(
  state: OwnerState,
  branching: AgentWorkspaceBranching,
  target: Pick<ForkTeardownEvent, 'provider' | 'environmentId' | 'checkpointId' | 'fork'>,
  parent?: AbortSignal,
): Promise<boolean> {
  const material = {
    kind: 'fork' as const,
    targetId: target.fork.environmentId,
    provider: target.provider,
  }
  const request = {
    ...material,
    operationId: `${target.fork.idempotencyKey}:destroy`,
    requestDigest: workspaceCleanupRequestDigest(material),
  }
  let destroyed = false
  try {
    const signal = deadlineSignal(parent, 30_000)
    const acknowledgement = await runAbortable(
      () => branching.destroyFork(request, { signal }),
      signal,
      'checkpoint capture fork cleanup timed out',
    )
    destroyed =
      workspaceCleanupAcknowledgementMatches(request, acknowledgement) &&
      (acknowledgement.status === 'deleted' || acknowledgement.status === 'already_absent')
  } catch {
    // Journaled unconfirmed below; the release asks again.
  }
  await state.args.journal.appendEvent(state.args.rootId, {
    kind: 'workspace-checkpoint-fork-teardown',
    id: state.args.nodeId,
    ...target,
    destroyed,
    seq: state.nextSequence(),
    at: new Date(state.args.now()).toISOString(),
  })
  return destroyed
}

/** Destroy capture forks the journal does not show destroyed. An aborted parent starts no further fork call. Returns forks still unconfirmed. */
export async function settleCaptureForks(
  state: OwnerState,
  parent?: AbortSignal,
): Promise<string[]> {
  const { args } = state
  const providerName = state.provider?.name
  const events = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const named = (key: string): string | undefined => {
    for (const event of events) {
      if (
        (event.kind === 'workspace-checkpoint-capture' ||
          event.kind === 'workspace-checkpoint-fork-teardown') &&
        event.fork.idempotencyKey === key
      )
        return event.fork.environmentId
    }
    return undefined
  }
  const destroyed = new Set(
    events.flatMap((event) =>
      event.kind === 'workspace-checkpoint-fork-teardown' && event.destroyed
        ? [event.fork.idempotencyKey]
        : [],
    ),
  )
  const unresolved: string[] = []
  for (const request of events) {
    if (request.kind !== 'workspace-checkpoint-fork-requested' || request.provider !== providerName)
      continue
    if (destroyed.has(request.idempotencyKey)) continue
    if (parent?.aborted) {
      unresolved.push(named(request.idempotencyKey) ?? request.idempotencyKey)
      continue
    }
    const signal = deadlineSignal(parent, 30_000)
    const branching = await checkpointHandle(state, request.environmentId, signal)
    let forkEnvironmentId = named(request.idempotencyKey)
    if (forkEnvironmentId === undefined && branching !== undefined) {
      try {
        const found = await runAbortable(
          () =>
            branching.lookupFork(
              { idempotencyKey: request.idempotencyKey, requestDigest: request.requestDigest },
              { signal },
            ),
          signal,
          'checkpoint capture fork lookup timed out',
        )
        // No fork was ever created for this request: nothing to destroy.
        if (found.status === 'not_found') continue
        if (found.status === 'found') forkEnvironmentId = found.environment.environmentId
      } catch {
        // Unresolved below.
      }
    }
    if (
      forkEnvironmentId === undefined ||
      branching === undefined ||
      !(await destroyCaptureFork(
        state,
        branching,
        {
          provider: request.provider,
          environmentId: request.environmentId,
          checkpointId: request.checkpointId,
          fork: { idempotencyKey: request.idempotencyKey, environmentId: forkEnvironmentId },
        },
        parent,
      ))
    )
      unresolved.push(forkEnvironmentId ?? request.idempotencyKey)
  }
  return unresolved
}
