import {
  type AgentWorkspaceBranching,
  workspaceCheckpointResultMatchesRequest,
} from '@tangle-network/agent-interface'
import { runAbortable } from './abortable'
import { errorText } from './error-message'
import type { OwnerState } from './retained-owner-state'
import type { SpawnEvent } from './types'
import { WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS } from './workspace-checkpoint'

export type CheckpointEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint' }>

type CheckpointRequestEvent = Extract<SpawnEvent, { kind: 'workspace-checkpoint-requested' }>

/** Reconstruct authority for this source only; a replacement cannot own its snapshots. */
export async function checkpointHandle(
  state: OwnerState,
  sourceEnvironmentId: string,
  signal: AbortSignal,
): Promise<AgentWorkspaceBranching | undefined> {
  const cached = state.checkpointHandles?.get(sourceEnvironmentId)
  if (cached !== undefined) return cached
  const provider = state.provider
  if (provider === undefined) return undefined
  try {
    const branching = await runAbortable(
      async () => {
        if (provider.workspaceBranching) {
          return (
            (await provider.workspaceBranching.forEnvironment(sourceEnvironmentId, { signal })) ??
            undefined
          )
        }
        const source = await provider.get?.(sourceEnvironmentId)
        return source?.id === sourceEnvironmentId && source.provider === provider.name
          ? source.workspaceBranching
          : undefined
      },
      signal,
      'retained owner checkpoint handle lookup timed out',
    )
    if (branching !== undefined) {
      state.checkpointHandles ??= new Map()
      state.checkpointHandles.set(sourceEnvironmentId, branching)
    }
    return branching
  } catch {
    return undefined
  }
}

/** A checkpoint request whose outcome a lookup could not establish, and what the lookup said. */
interface UnresolvedCheckpointRequest {
  readonly event: CheckpointRequestEvent
  readonly reason: string
}

/**
 * An aborted observation cannot prove that the provider never created a snapshot, so a request
 * whose lookup does not find it keeps its source alive for a later lookup, with one exception: a
 * provider that answers `not_found` for a request older than {@link WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS}
 * never created it. No operation that request started can still be in flight, and keeping the
 * source then holds a sandbox for nothing: on Discovery Lab runs terraform-economics-20261005e and
 * f, each root was kept after its run settled over requests made hours earlier.
 */
export async function reconcileCheckpointRequests(
  state: OwnerState,
  events: SpawnEvent[],
): Promise<UnresolvedCheckpointRequest[]> {
  const operationKey = (operation: { idempotencyKey: string; requestDigest: string }): string =>
    JSON.stringify([operation.idempotencyKey, operation.requestDigest])
  const resolved = new Set(
    events.flatMap((event) =>
      event.kind === 'workspace-checkpoint' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name
        ? [operationKey(event.checkpoint)]
        : [],
    ),
  )
  const pending = events.filter(
    (event): event is CheckpointRequestEvent =>
      event.kind === 'workspace-checkpoint-requested' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name &&
      !resolved.has(operationKey(event.request)),
  )
  const unconfirmed: UnresolvedCheckpointRequest[] = []
  for (const event of pending) {
    const signal = AbortSignal.timeout(30_000)
    try {
      const branching = await checkpointHandle(state, event.environmentId, signal)
      if (branching === undefined) throw new Error('source-scoped checkpoint handle unavailable')
      const result = await runAbortable(
        () =>
          branching.lookupCheckpoint(
            {
              idempotencyKey: event.request.idempotencyKey,
              requestDigest: event.request.requestDigest,
            },
            { signal },
          ),
        signal,
        'retained owner checkpoint lookup timed out',
      )
      if (result.status === 'not_found') {
        const requestedAt = Date.parse(event.at)
        if (
          Number.isFinite(requestedAt) &&
          state.args.now() - requestedAt >= WORKSPACE_CHECKPOINT_ABSENT_AFTER_MS
        )
          continue
        unconfirmed.push({ event, reason: 'lookup not_found while the request may be in flight' })
        continue
      }
      if (result.status !== 'found') {
        unconfirmed.push({
          event,
          reason: `lookup ${result.status}${'message' in result && result.message ? `: ${result.message}` : ''}`,
        })
        continue
      }
      if (!workspaceCheckpointResultMatchesRequest(event.request, result)) {
        unconfirmed.push({ event, reason: 'lookup found a checkpoint for another request' })
        continue
      }
      const recovered: CheckpointEvent = {
        kind: 'workspace-checkpoint',
        id: event.id,
        provider: event.provider,
        environmentId: event.environmentId,
        checkpoint: result.checkpoint,
        ...(event.marker === undefined ? {} : { marker: event.marker }),
        seq: state.nextSequence(),
        at: event.at,
      }
      await state.args.journal.appendEvent(state.args.rootId, recovered)
      events.push(recovered)
    } catch (error) {
      unconfirmed.push({
        event,
        reason: `lookup failed: ${errorText(error instanceof Error ? error.message : error)}`,
      })
    }
  }
  return unconfirmed
}

export function pendingCheckpoints(
  events: readonly SpawnEvent[],
  state: OwnerState,
): CheckpointEvent[] {
  const confirmed = new Set(
    events.flatMap((event) =>
      event.kind === 'workspace-checkpoint-cleanup' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name &&
      event.confirmed
        ? [JSON.stringify([event.environmentId, event.checkpointId])]
        : [],
    ),
  )
  return events.filter(
    (event): event is CheckpointEvent =>
      event.kind === 'workspace-checkpoint' &&
      event.id === state.args.nodeId &&
      event.provider === state.provider?.name &&
      !confirmed.has(JSON.stringify([event.environmentId, event.checkpoint.checkpointId])),
  )
}
