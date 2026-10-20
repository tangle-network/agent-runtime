import {
  workspaceCheckpointRequestDigest,
  workspaceCheckpointResultMatchesRequest,
} from '@tangle-network/agent-interface'
import { runAbortable } from './abortable'
import { cleanCheckpoints } from './retained-owner-checkpoint-capture'
import { type CheckpointEvent, pendingCheckpoints } from './retained-owner-checkpoint-requests'
import { type OwnerState, owners } from './retained-owner-state'
import type { Scope, WorkspaceCheckpointMarker } from './types'
import {
  WORKSPACE_CHECKPOINT_MARKER_PATH,
  WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS,
  WORKSPACE_CHECKPOINT_ROTATION_CAPTURES_MS,
  WORKSPACE_CHECKPOINT_TIMEOUT_MS,
  WORKSPACE_CHECKPOINTS_KEPT,
  writeWorkspaceMarker,
} from './workspace-checkpoint'

/**
 * Note that the owner's manager made a coordination call, and checkpoint its workspace when the
 * last checkpoint is older than {@link WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS}.
 *
 * A coordination call is where a manager commits work: it spawns, waits for, reads, or submits.
 * The checkpoint runs in the background and never delays the call. A failed checkpoint leaves the
 * previous one as the restore point; a provider or environment that cannot checkpoint stops the
 * attempts for this owner.
 */
export function noteScopeRetainedOwnerCoordination(scope: Scope<unknown>): void {
  const state = owners.get(scope)
  if (state?.provider === undefined || state.checkpointsUnavailable !== undefined) return
  // No rotation starts while a turn's handed-over capture is still running.
  if (state.checkpointing !== undefined || state.turnEnd !== undefined || scope.signal.aborted)
    return
  const now = state.args.now()
  if (
    state.lastCheckpointAt !== undefined &&
    now - state.lastCheckpointAt < WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS
  )
    return
  state.lastCheckpointAt = now
  state.checkpointing = checkpointOwnerWorkspace(scope, state)
    .catch(() => undefined)
    .finally(() => {
      delete state.checkpointing
    })
}

/** @internal The checkpoint in progress for this owner, for a test or a release to wait on. */
export function scopeRetainedOwnerCheckpointing(scope: Scope<unknown>): Promise<void> | undefined {
  return owners.get(scope)?.checkpointing
}

export async function checkpointOwnerWorkspace(
  scope: Scope<unknown>,
  state: OwnerState,
): Promise<void> {
  const { provider, args } = state
  if (provider === undefined) return
  if (!provider.get) {
    state.checkpointsUnavailable = `provider ${provider.name} cannot reconstruct an environment`
    return
  }
  // A checkpoint no create can restore is storage for nothing.
  if ((await provider.capabilities()).create?.workspaceCheckpoint !== true) {
    state.checkpointsUnavailable = `provider ${provider.name} cannot create an environment from a checkpoint`
    return
  }
  const dispatched = [...state.admissions]
    .reverse()
    .find((admission) => admission.phase === 'dispatched')
  if (dispatched?.phase !== 'dispatched') return
  const source = dispatched.controlRef
  const signal = AbortSignal.any([
    scope.signal,
    AbortSignal.timeout(WORKSPACE_CHECKPOINT_TIMEOUT_MS),
  ])
  const get = provider.get.bind(provider)
  const environment = await runAbortable(
    () => get(source.environmentId),
    signal,
    'retained owner checkpoint timed out',
  )
  if (
    environment === null ||
    environment.id !== source.environmentId ||
    environment.provider !== provider.name
  )
    return
  const branching = environment.workspaceBranching
  if (branching === undefined) {
    state.checkpointsUnavailable = `environment ${environment.id} offers no durable checkpoint`
    return
  }
  const seq = state.nextSequence()
  const at = new Date(args.now()).toISOString()
  const name = `owner-checkpoint-${seq}`
  const marker: WorkspaceCheckpointMarker = {
    path: WORKSPACE_CHECKPOINT_MARKER_PATH,
    content: `${JSON.stringify({ node: args.nodeId, checkpoint: name, at })}\n`,
  }
  const marked = await writeWorkspaceMarker(environment, marker, signal)
  const material = { source, name }
  const request = {
    ...material,
    idempotencyKey: `${args.nodeId}:workspace-checkpoint:${seq}`,
    requestDigest: workspaceCheckpointRequestDigest(material),
  }
  state.checkpointHandles ??= new Map()
  state.checkpointHandles.set(environment.id, branching)
  await args.journal.appendEvent(args.rootId, {
    kind: 'workspace-checkpoint-requested',
    id: args.nodeId,
    provider: provider.name,
    environmentId: environment.id,
    request,
    ...(marked ? { marker } : {}),
    seq,
    at,
  })
  const result = await runAbortable(
    () => branching.checkpoint(request, { signal }),
    signal,
    'retained owner checkpoint timed out',
  )
  if (result.status !== 'created' && result.status !== 'replayed') return
  if (!workspaceCheckpointResultMatchesRequest(request, result)) return
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(args.rootId, {
    kind: 'workspace-checkpoint',
    id: args.nodeId,
    provider: provider.name,
    environmentId: environment.id,
    checkpoint: result.checkpoint,
    ...(marked ? { marker } : {}),
    seq: state.nextSequence(),
    at,
  })
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = pendingCheckpoints(events, state).filter(
    (event): event is CheckpointEvent =>
      event.environmentId === environment.id &&
      state.captureRefused?.has(event.checkpoint.checkpointId) !== true,
  )
  // The capture forks a box and reads its whole workspace, so it is bounded by its own budget and
  // the turn's workspace capture, never by this checkpoint's bound. A capture cut short keeps its
  // checkpoint, and the release captures it again.
  const rotation = new AbortController()
  state.rotationCaptures = rotation
  const timer = setTimeout(
    () =>
      rotation.abort(
        new Error(
          `the rotation's ${WORKSPACE_CHECKPOINT_ROTATION_CAPTURES_MS} ms for checkpoint captures ran out; checkpoint kept`,
        ),
      ),
    WORKSPACE_CHECKPOINT_ROTATION_CAPTURES_MS,
  )
  try {
    await cleanCheckpoints(
      state,
      branching,
      owned.slice(0, -WORKSPACE_CHECKPOINTS_KEPT),
      events,
      AbortSignal.any([scope.signal, rotation.signal]),
    )
  } finally {
    clearTimeout(timer)
    if (state.rotationCaptures === rotation) delete state.rotationCaptures
  }
}

/**
 * The owner's workspace-capture journal writers. A turn's capture starting cuts short the
 * checkpoint rotation's captures: on Discovery canary test-acceptance-canary-20261019j (Runtime
 * 0.327.0) a rotation capture of an older checkpoint started 4 s before the root's final capture,
 * on the same evidence store, and the final capture spent 26.6 of its 32.6 minutes storing its
 * archive until the root's budget deadline aborted the rotation.
 */
