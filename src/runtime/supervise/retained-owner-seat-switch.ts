import { ValidationError } from '../../errors'
import { runAbortable } from './abortable'
import { checkpointOwnerWorkspace } from './retained-owner-checkpoint-rotation'
import {
  ownerWorkspaceRetentionFailures,
  reconcileOwnerWorkspaceBeforeReuse,
} from './retained-owner-evidence'
import { type OwnerState, owners } from './retained-owner-state'
import { scopeRetainedOwnerTurnEnded } from './retained-owner-turn-lifecycle'
import type { Scope } from './types'

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
  if (!state?.acceptedRef || !state.acceptedConsumed) {
    throw new ValidationError('seat switch requires a committed owner turn')
  }
  const accepted = state.acceptedRef
  await scopeRetainedOwnerTurnEnded(scope)
  await reconcileOwnerWorkspaceBeforeReuse(state, scope.signal)
  await state.checkpointing
  await checkpointOwnerWorkspace(scope, state)
  const owned = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
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
  const checkpoint =
    sourceEnvironmentId !== undefined
      ? owned
          .slice(acceptedIndex + 1)
          .reverse()
          .find(
            (event) =>
              event.kind === 'workspace-checkpoint' && event.environmentId === sourceEnvironmentId,
          )
      : undefined
  if (checkpoint?.kind !== 'workspace-checkpoint') {
    throw new ValidationError(
      'seat switch requires a checkpoint of the committed source environment',
    )
  }
  if (mode === 'replace-environment') {
    // A seat may move from a verified checkpoint while the old source remains evidence.
    // Only a complete capture permits retirement; the continuation exception above does not.
    const incompleteRetainedSources = await ownerWorkspaceRetentionFailures(owned, state.args, true)
    if (!incompleteRetainedSources.has(checkpoint.environmentId)) {
      await retireSeatEnvironment(scope, state)
    }
    state.forceNewSession = true
  }
  return {
    checkpointAt: checkpoint.at,
    checkpointId: checkpoint.checkpoint.checkpointId,
    sourceEnvironmentId: checkpoint.environmentId,
  }
}

/** The next seat receives fresh create-time credentials. Release the stopped source only after
 * its checkpoint exists, then commit the teardown so recovery never tries its old session. */
async function retireSeatEnvironment(scope: Scope<unknown>, state: OwnerState): Promise<void> {
  const { provider, args } = state
  if (!provider?.get)
    throw new ValidationError('seat switch requires a provider with exact environment lookup')
  const owned = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const admitted = [...owned]
    .reverse()
    .find((event) => event.kind === 'execution-admitted' && event.admission.phase === 'environment')
  if (admitted?.kind !== 'execution-admitted' || admitted.admission.phase !== 'environment') {
    throw new ValidationError('seat switch has no committed source environment')
  }
  const environmentId = admitted.admission.environmentId
  if (
    owned.some(
      (event) =>
        event.kind === 'environment-teardown' &&
        event.destroyed &&
        event.environmentId === environmentId,
    )
  )
    return
  const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)])
  const environment = await runAbortable(
    () => provider.get!(environmentId),
    signal,
    'seat switch environment lookup timed out',
  )
  if (environment !== null) {
    if (
      environment.id !== environmentId ||
      environment.provider !== provider.name ||
      !environment.destroy
    ) {
      throw new ValidationError('seat switch cannot retire the exact source environment')
    }
    await runAbortable(
      () => environment.destroy!(),
      signal,
      'seat switch environment retirement timed out',
    )
  }
  await args.journal.appendEvent(args.rootId, {
    kind: 'environment-teardown',
    id: args.nodeId,
    provider: provider.name,
    environmentId,
    destroyed: true,
    detail: 'seat changed after a committed turn',
    seq: state.nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
}
