import {
  type AgentWorkspaceBranching,
  type WorkspaceCheckpointRequest,
  workspaceCheckpointRequestDigest,
  workspaceCheckpointResultMatchesRequest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { runAbortable } from './abortable'
import { errorText } from './error-message'
import { cleanCheckpoints } from './retained-owner-checkpoint-capture'
import { pendingCheckpoints } from './retained-owner-checkpoint-requests'
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

/** Checkpoint after a coordination call once the last one is older than {@link WORKSPACE_CHECKPOINT_MIN_INTERVAL_MS}. It never delays the call, and a failure leaves the previous restore point. */
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
  const requestOne = () =>
    requestCheckpoint(scope, state, provider.name, environment, branching, source, signal)
  // A refusal, usually a plan's snapshot limit, gets one more try once a superseded checkpoint is
  // out of its way, so the restore point keeps moving.
  if (
    !(await requestOne()) &&
    (!(await deleteOldestCheckpoint(state, branching, environment.id, signal)) ||
      !(await requestOne()))
  )
    return
  const events = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = pendingCheckpoints(events, state).filter(
    (event) => event.environmentId === environment.id,
  )
  // Superseded deletes have their own bound and yield to the turn's workspace capture; one cut
  // short keeps its checkpoint, and the release deletes it.
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
      AbortSignal.any([scope.signal, rotation.signal]),
    )
  } finally {
    clearTimeout(timer)
    if (state.rotationCaptures === rotation) delete state.rotationCaptures
  }
}

/** Ask for one checkpoint and journal the answer. True when the journal holds the checkpoint. */
async function requestCheckpoint(
  scope: Scope<unknown>,
  state: OwnerState,
  providerName: string,
  environment: AgentEnvironment,
  branching: AgentWorkspaceBranching,
  source: WorkspaceCheckpointRequest['source'],
  signal: AbortSignal,
): Promise<boolean> {
  const { args } = state
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
    provider: providerName,
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
  if (result.status !== 'created' && result.status !== 'replayed') {
    await args.journal.appendEvent(args.rootId, {
      kind: 'workspace-checkpoint-refused',
      id: args.nodeId,
      provider: providerName,
      environmentId: environment.id,
      idempotencyKey: request.idempotencyKey,
      message: errorText('message' in result ? result.message : result.status),
      seq: state.nextSequence(),
      at,
    })
    return false
  }
  if (!workspaceCheckpointResultMatchesRequest(request, result)) return false
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(args.rootId, {
    kind: 'workspace-checkpoint',
    id: args.nodeId,
    provider: providerName,
    environmentId: environment.id,
    checkpoint: result.checkpoint,
    ...(marked ? { marker } : {}),
    seq: state.nextSequence(),
    at,
  })
  return true
}

/** Delete the oldest checkpoint past {@link WORKSPACE_CHECKPOINTS_KEPT}, so a snapshot limit cannot freeze the restore point. */
async function deleteOldestCheckpoint(
  state: OwnerState,
  branching: AgentWorkspaceBranching,
  environmentId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const events = (await state.args.journal.loadTree(state.args.rootId)) ?? []
  const oldest = pendingCheckpoints(events, state)
    .filter((event) => event.environmentId === environmentId)
    .slice(0, -WORKSPACE_CHECKPOINTS_KEPT)
    .slice(0, 1)
  if (oldest.length === 0) return false
  return (await cleanCheckpoints(state, branching, oldest, signal)).length === 0
}
