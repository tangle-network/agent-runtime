import {
  type AgentWorkspaceBranching,
  type Sha256Digest,
  workspaceCleanupAcknowledgementMatches,
  workspaceCleanupRequestDigest,
  workspaceForkRequestDigest,
  workspaceForkResultMatchesRequest,
} from '@tangle-network/agent-interface'
import { captureProviderCheckpointWorkspace } from '../provider-workspace-retention'
import { abortError, runAbortable } from './abortable'
import { errorText } from './error-message'
import { type CheckpointEvent, checkpointHandle } from './retained-owner-checkpoint-requests'
import type { OwnerState } from './retained-owner-state'
import type { SpawnEvent } from './types'
import { WORKSPACE_CHECKPOINT_FORK_TIMEOUT_MS } from './workspace-checkpoint'

type CheckpointCaptureEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-capture' }>

type ForkTeardownEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-fork-teardown' }>

/** A checkpoint kept without a delete because no capture holds its files. */
export interface CaptureRefusal {
  readonly event: CheckpointEvent
  readonly reason: string
  /** Whether a later capture needs the source: its handle is the only one that can fork it. */
  readonly needsSource: boolean
}

/** What cleaning a group of checkpoints left: deletes the provider did not confirm, and
 *  checkpoints kept because their files are in no capture. */
interface CheckpointCleanup {
  readonly unconfirmed: CheckpointEvent[]
  readonly refused: CaptureRefusal[]
}

/**
 * Delete checkpoints, each only after its files are captured into the run's content-addressed
 * store; a checkpoint no capture holds is kept, and the cleanup record says why. Only the
 * source-scoped handle can fork a checkpoint and attest its deletion, including after its source
 * is lost. `parent` cancels the captures (the owner's scope during rotation); each provider
 * operation also has its own bound.
 */
export async function cleanCheckpoints(
  state: OwnerState,
  branching: AgentWorkspaceBranching | undefined,
  checkpoints: readonly CheckpointEvent[],
  events: readonly SpawnEvent[],
  parent?: AbortSignal,
): Promise<CheckpointCleanup> {
  const unconfirmed: CheckpointEvent[] = []
  const refused: CaptureRefusal[] = []
  for (const event of checkpoints) {
    const captured = await captureBeforeCleanup(state, branching, event, events, parent)
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
    try {
      if (branching === undefined) throw new Error('source-scoped checkpoint handle unavailable')
      const signal = AbortSignal.timeout(30_000)
      const acknowledgement = await runAbortable(
        () => branching.deleteCheckpoint(request, { signal }),
        signal,
        'retained owner checkpoint cleanup timed out',
      )
      confirmed =
        workspaceCleanupAcknowledgementMatches(request, acknowledgement) &&
        (acknowledgement.status === 'deleted' || acknowledgement.status === 'already_absent')
    } catch {
      // The journal and settle result retain the unresolved resource below.
    }
    if (!confirmed) unconfirmed.push(event)
    await state.args.journal.appendEvent(state.args.rootId, {
      kind: 'workspace-checkpoint-cleanup',
      id: state.args.nodeId,
      provider: event.provider,
      environmentId: event.environmentId,
      checkpointId: event.checkpoint.checkpointId,
      confirmed,
      capturedDigest: captured.digest,
      seq: state.nextSequence(),
      at: new Date(state.args.now()).toISOString(),
    })
  }
  return { unconfirmed, refused }
}

/**
 * The digest of the tree that holds a checkpoint's files, capturing it first when no record says
 * one exists, or why it cannot be had. The files are read from a fork of the checkpoint: a box
 * created from the snapshot itself, so the capture is the checkpoint's state and not the live
 * workspace's, which has moved on. The fork request is journaled before it is made and the fork
 * destroyed once the capture is journaled, so neither a failure nor a crash leaves it running
 * unrecorded.
 */
async function captureBeforeCleanup(
  state: OwnerState,
  branching: AgentWorkspaceBranching | undefined,
  event: CheckpointEvent,
  events: readonly SpawnEvent[],
  parent?: AbortSignal,
): Promise<{ readonly digest: Sha256Digest } | CaptureRefusal> {
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
  const capture = state.checkpointCapture
  if (capture?.port.captureCheckpoint === undefined)
    return refuse('no checkpoint capture: the owner backend has no captureCheckpoint', false)
  const provider = state.provider
  if (provider?.get === undefined)
    return refuse('the provider cannot reconstruct a fork of the checkpoint', false)
  const get = provider.get.bind(provider)
  // A bound already spent (the release's, or the owner's cancellation) forks nothing more.
  if (parent?.aborted)
    return refuse(
      `capture failed: ${errorText(abortError(parent, 'capture stopped').message)}`,
      true,
    )
  if (branching === undefined) return refuse('source-scoped checkpoint handle unavailable', true)
  const material = { checkpoint: event.checkpoint, placement: { kind: 'sandbox' as const } }
  // One key per attempt: a fork an earlier attempt destroyed cannot be replayed into this one.
  const request = {
    ...material,
    idempotencyKey: `${event.checkpoint.idempotencyKey}:capture:${state.nextSequence()}`,
    requestDigest: workspaceForkRequestDigest(material),
  }
  let forkEnvironmentId: string | undefined
  let captureEnded = false
  try {
    const tree = await captureProviderCheckpointWorkspace(
      capture.port,
      async (captureSignal) => {
        const forkSignal = AbortSignal.any([
          captureSignal,
          ...(parent === undefined ? [] : [parent]),
          AbortSignal.timeout(WORKSPACE_CHECKPOINT_FORK_TIMEOUT_MS),
        ])
        await args.journal.appendEvent(args.rootId, {
          kind: 'workspace-checkpoint-fork-requested',
          id: args.nodeId,
          provider: event.provider,
          environmentId: event.environmentId,
          checkpointId,
          idempotencyKey: request.idempotencyKey,
          requestDigest: request.requestDigest,
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        })
        const result = await runAbortable(
          () =>
            branching.fork(request, { signal: forkSignal }).then(async (result) => {
              if (result.status === 'created' || result.status === 'replayed') {
                const forkId = result.environment.environmentId
                if (captureEnded)
                  await destroyCaptureFork(state, branching, {
                    provider: event.provider,
                    environmentId: event.environmentId,
                    checkpointId,
                    fork: { idempotencyKey: request.idempotencyKey, environmentId: forkId },
                  })
                else forkEnvironmentId = forkId
              }
              return result
            }),
          forkSignal,
          'checkpoint fork timed out',
        )
        if (
          (result.status !== 'created' && result.status !== 'replayed') ||
          !workspaceForkResultMatchesRequest(request, result)
        )
          throw new Error(
            `fork ${result.status}${'message' in result ? `: ${result.message}` : ''}`,
          )
        const forkId = result.environment.environmentId
        const environment = await runAbortable(
          () => get(forkId),
          forkSignal,
          'checkpoint fork lookup timed out',
        )
        if (
          environment === null ||
          environment.id !== forkId ||
          environment.provider !== provider.name
        )
          throw new Error(`fork ${forkId} could not be reconstructed`)
        parent?.throwIfAborted()
        await args.journal.appendEvent(args.rootId, {
          kind: 'workspace-checkpoint-fork-ready',
          id: args.nodeId,
          provider: event.provider,
          environmentId: event.environmentId,
          checkpointId,
          fork: { idempotencyKey: request.idempotencyKey, environmentId: forkId },
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        })
        return {
          environment,
          checkpoint: event.checkpoint,
          executionId: `${args.nodeId}:checkpoint:${checkpointId}`,
          profile: capture.profile,
        }
      },
      event.marker,
      parent,
    )
    const forkId = forkEnvironmentId
    if (forkId === undefined) throw new Error('checkpoint capture fork identity missing')
    await args.journal.appendEvent(args.rootId, {
      kind: 'workspace-checkpoint-capture',
      id: args.nodeId,
      provider: event.provider,
      environmentId: event.environmentId,
      checkpointId,
      fork: { idempotencyKey: request.idempotencyKey, environmentId: forkId },
      tree: {
        digest: tree.digest,
        manifest: tree.manifest,
        files: tree.files,
        bytes: tree.bytes,
        storedBytes: tree.storedBytes,
      },
      seq: state.nextSequence(),
      at: new Date(args.now()).toISOString(),
    })
    return { digest: tree.digest }
  } catch (error) {
    return refuse(
      `capture failed: ${errorText(error instanceof Error ? error.message : error)}`,
      true,
    )
  } finally {
    captureEnded = true
    if (forkEnvironmentId !== undefined)
      await destroyCaptureFork(state, branching, {
        provider: event.provider,
        environmentId: event.environmentId,
        checkpointId,
        fork: { idempotencyKey: request.idempotencyKey, environmentId: forkEnvironmentId },
      })
  }
}

/** Destroy a capture's fork and journal whether the provider confirmed it. */
async function destroyCaptureFork(
  state: OwnerState,
  branching: AgentWorkspaceBranching,
  target: Pick<ForkTeardownEvent, 'provider' | 'environmentId' | 'checkpointId' | 'fork'>,
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
    const signal = AbortSignal.timeout(30_000)
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

/**
 * Destroy every capture fork the journal does not show destroyed: one a crash left between its
 * request and its teardown, or whose teardown the provider did not confirm. Returns the forks
 * still not confirmed destroyed, by environment or, when none was ever named, by request key.
 */
export async function settleCaptureForks(state: OwnerState): Promise<string[]> {
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
    const signal = AbortSignal.timeout(30_000)
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
      !(await destroyCaptureFork(state, branching, {
        provider: request.provider,
        environmentId: request.environmentId,
        checkpointId: request.checkpointId,
        fork: { idempotencyKey: request.idempotencyKey, environmentId: forkEnvironmentId },
      }))
    )
      unresolved.push(forkEnvironmentId ?? request.idempotencyKey)
  }
  return unresolved
}
