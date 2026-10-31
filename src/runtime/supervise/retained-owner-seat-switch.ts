import { ValidationError } from '../../errors'
import { runAbortable } from './abortable'
import { checkpointOwnerWorkspace } from './retained-owner-checkpoint-rotation'
import {
  ownerWorkspaceRetentionFailures,
  reconcileOwnerWorkspaceBeforeReuse,
} from './retained-owner-evidence'
import { type OwnerState, owners } from './retained-owner-state'
import { scopeRetainedOwnerTurnEnded } from './retained-owner-turn-lifecycle'
import type { Scope, SpawnEvent } from './types'

/** A committed turn is the seat boundary. Keep its native home for a same-harness provider
 * continuation; only a provider/harness change needs a new environment. */
export async function prepareScopeRetainedOwnerSeatSwitch(
  scope: Scope<unknown>,
  mode: 'same-environment' | 'replace-environment',
): Promise<{
  readonly checkpointAt: string
  readonly checkpointId: string
  readonly sourceEnvironmentId: string
}> {
  const state = owners.get(scope)
  if (!state?.acceptedRef || !state.acceptedConsumed)
    throw new ValidationError('seat switch requires a committed owner turn')
  const accepted = state.acceptedRef
  const owned = await checkpointOwner(scope, state)
  const acceptedIndex = owned.findIndex(
    (event) =>
      event.kind === 'execution-result' &&
      event.seq === accepted.seq &&
      event.outRef === accepted.outRef,
  )
  if (acceptedIndex < 0)
    throw new ValidationError('seat switch has no committed result in its journal')
  const source = owned
    .slice(0, acceptedIndex)
    .reverse()
    .find((event) => event.kind === 'execution-admitted' && event.admission.phase === 'environment')
  const sourceEnvironmentId =
    source?.kind === 'execution-admitted' && source.admission.phase === 'environment'
      ? source.admission.environmentId
      : undefined
  const checkpoint = owned
    .slice(acceptedIndex + 1)
    .reverse()
    .find(
      (event) =>
        event.kind === 'workspace-checkpoint' && event.environmentId === sourceEnvironmentId,
    )
  if (checkpoint?.kind !== 'workspace-checkpoint')
    throw new ValidationError('seat switch requires a checkpoint of its committed source')
  if (mode === 'replace-environment') {
    // A seat may move from a verified checkpoint while the old source remains evidence.
    await retireCheckpointed(scope, state, owned, checkpoint, 'seat changed')
    state.forceNewSession = true
  }
  return {
    checkpointAt: checkpoint.at,
    checkpointId: checkpoint.checkpoint.checkpointId,
    sourceEnvironmentId: checkpoint.environmentId,
  }
}

/** An exhausted seat chain pauses its manager until `resumeAt` with no turn to run: on
 * magnetar-rust-sandbox-20261031b (Runtime 3.0.5) a resume paused four managers until 11-04 with
 * their 16 GiB boxes running. Retire a box its latest checkpoint holds; the next drive restores. */
export async function releaseScopeRetainedOwnerForSeatPause(
  scope: Scope<unknown>,
  resumeAt: string,
): Promise<void> {
  const state = owners.get(scope)
  if (state?.provider === undefined) return
  const owned = await checkpointOwner(scope, state)
  const at = owned.map((event) => event.kind).lastIndexOf('workspace-checkpoint')
  const checkpoint = owned[at]
  const later = owned.slice(at + 1).some((event) => event.kind.startsWith('execution-'))
  if (checkpoint?.kind === 'workspace-checkpoint' && !later)
    await retireCheckpointed(scope, state, owned, checkpoint, `seat paused until ${resumeAt}`)
}

async function checkpointOwner(scope: Scope<unknown>, state: OwnerState): Promise<SpawnEvent[]> {
  await scopeRetainedOwnerTurnEnded(scope)
  await reconcileOwnerWorkspaceBeforeReuse(state, scope.signal)
  await state.checkpointing
  await checkpointOwnerWorkspace(scope, state)
  return ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
}

/** Retire a checkpointed environment whose capture is complete, and commit the teardown so
 * recovery never tries its old session; the next one receives fresh create-time credentials. */
async function retireCheckpointed(
  scope: Scope<unknown>,
  { provider, args, nextSequence }: OwnerState,
  owned: readonly SpawnEvent[],
  { environmentId }: { readonly environmentId: string },
  detail: string,
): Promise<void> {
  if ((await ownerWorkspaceRetentionFailures(owned, args, true)).has(environmentId)) return
  if (!provider?.get)
    throw new ValidationError('seat change requires a provider with exact environment lookup')
  const unusable = (event: SpawnEvent) =>
    event.kind === 'environment-teardown' &&
    event.destroyed &&
    event.environmentId === environmentId
  if (owned.some(unusable)) return
  const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)])
  const environment = await runAbortable(
    () => provider.get!(environmentId),
    signal,
    'seat change environment lookup timed out',
  )
  if (environment !== null) {
    if (
      environment.id !== environmentId ||
      environment.provider !== provider.name ||
      !environment.destroy
    ) {
      throw new ValidationError('seat change cannot retire the exact source environment')
    }
    await runAbortable(() => environment.destroy!(), signal, 'seat change retirement timed out')
  }
  await args.journal.appendEvent(args.rootId, {
    kind: 'environment-teardown',
    id: args.nodeId,
    provider: provider.name,
    environmentId,
    destroyed: true,
    detail,
    seq: nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
}
