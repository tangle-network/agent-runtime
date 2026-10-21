import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import type { RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { runAbortable } from './abortable'
import type { CheckpointEvent } from './retained-owner-checkpoint-requests'
import { unusableEnvironmentIds } from './retained-owner-evidence'
import { owners } from './retained-owner-state'
import type { Scope, SpawnEvent } from './types'

/**
 * The checkpoint a new environment of this owner starts from: the latest one journaled before
 * the invocation's input, taken from an environment the provider has since lost. Only such an
 * environment needs one; a live environment is continued, never copied.
 */
export function restoreBefore(
  owned: readonly SpawnEvent[],
  inputIndex: number,
): CheckpointEvent | undefined {
  const unusable = unusableEnvironmentIds(owned)
  return owned
    .slice(0, inputIndex < 0 ? owned.length : inputIndex)
    .filter(
      (event): event is CheckpointEvent =>
        event.kind === 'workspace-checkpoint' && unusable.has(event.environmentId),
    )
    .at(-1)
}

export async function restoreCapable(
  provider: AgentEnvironmentProvider | undefined,
): Promise<boolean> {
  if (provider === undefined) return false
  try {
    return (await provider.capabilities()).create?.workspaceCheckpoint === true
  } catch {
    return false
  }
}

/**
 * What the owner's next new environment will hold of the lost one, read before the drive so the
 * re-entered director is told: the checkpoint's time, or undefined when there is nothing to
 * restore.
 */
export async function scopeRetainedOwnerRestorePoint(scope: Scope<unknown>): Promise<
  | {
      readonly checkpointId: string
      readonly takenAt: string
      readonly sourceEnvironmentId: string
    }
  | undefined
> {
  const state = owners.get(scope)
  if (state === undefined || !(await restoreCapable(state.provider))) return undefined
  const owned = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const latest = restoreBefore(owned, -1)
  return latest === undefined
    ? undefined
    : {
        checkpointId: latest.checkpoint.checkpointId,
        takenAt: latest.at,
        sourceEnvironmentId: latest.checkpoint.source.environmentId,
      }
}

/** The environment the owner's next invocation would continue in, when there is one: the latest
 *  environment admission of this owner, which is either the current invocation's own (recovered
 *  in place) or the one a deliberate later invocation reuses after an accepted result. `inFlight`
 *  says whether the latest invocation has no result yet. */
export function continuedEnvironment(
  owned: readonly SpawnEvent[],
): { readonly admission: RetainedRunEnvironmentAdmission; readonly inFlight: boolean } | undefined {
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput === undefined) return undefined
  const attempt = owned.slice(owned.indexOf(latestInput))
  const admission = [...owned]
    .reverse()
    .flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'environment'
        ? [event.admission]
        : [],
    )[0]
  if (admission === undefined) return undefined
  return { admission, inFlight: !attempt.some((event) => event.kind === 'execution-result') }
}

/** What the owner's next invocation continues, read before it starts. */
type RetainedOwnerEnvironmentState =
  /** No environment was admitted yet, or the owner is not a retained provider owner. */
  | { readonly state: 'none' }
  /** The provider still holds the environment the next invocation continues in. */
  | { readonly state: 'live'; readonly environmentId: string; readonly inFlight: boolean }
  /** The provider no longer holds it; the next invocation starts in a new environment. */
  | { readonly state: 'lost'; readonly environmentId: string }
  /** The provider could not say. Nothing is concluded and nothing is journaled. */
  | { readonly state: 'unknown'; readonly environmentId: string }

/**
 * Confirm, before a new drive, that the environment the owner would continue in still exists.
 *
 * A retained invocation whose environment is gone can never be recovered: the retained path asked
 * the provider to reconnect, the provider answered `Sandbox not found`, and every later attempt
 * repeated that refusal until the barren streak ended the run. Measured on the real opencode path
 * (autopsy-a-before-20260924a, agent-runtime 5c22fbb2): the root sandbox was deleted 17 s after it
 * dispatched a child, four attempts in 64 s each refused "retained provider execution requires
 * reconciliation before replacement", and the run settled `driver-failed` while the child it had
 * commissioned settled `done` two minutes later, unread.
 *
 * The reconciliation refusal protects against paying twice for an execution that may still run.
 * An environment the provider no longer holds or reports terminal runs nothing. Runtime records
 * the provider's exact observation before the next prepare starts a new invocation. A terminal
 * record still requires cleanup at settlement; it is not a teardown receipt.
 */
export async function reconcileScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
): Promise<RetainedOwnerEnvironmentState> {
  const state = owners.get(scope)
  if (!state?.provider) return { state: 'none' }
  const { provider, args } = state
  const owned = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const continued = continuedEnvironment(owned)
  if (continued === undefined) return { state: 'none' }
  const environmentId = continued.admission.environmentId
  if (unusableEnvironmentIds(owned).has(environmentId)) return { state: 'lost', environmentId }
  if (!provider.get) return { state: 'unknown', environmentId }
  let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
  let terminalStatus: 'failed' | 'expired' | undefined
  try {
    environment = await runAbortable(
      () => provider.get!(environmentId),
      AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)]),
      'retained owner environment check timed out',
    )
    if (environment !== null) {
      const found = environment
      if (found.id !== environmentId || found.provider !== provider.name)
        return { state: 'unknown', environmentId }
      const status = await runAbortable(
        () => found.status(),
        AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)]),
        'retained owner environment status timed out',
      )
      if (status === 'failed' || status === 'expired') terminalStatus = status
    }
  } catch {
    return { state: 'unknown', environmentId }
  }
  if (environment !== null && terminalStatus === undefined)
    return { state: 'live', environmentId, inFlight: continued.inFlight }
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(
    args.rootId,
    terminalStatus === undefined
      ? {
          kind: 'environment-teardown',
          id: args.nodeId,
          provider: provider.name,
          environmentId,
          destroyed: true,
          detail:
            'lost: the provider no longer holds this environment, so the next invocation starts in a new one',
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        }
      : {
          kind: 'environment-terminal',
          id: args.nodeId,
          provider: provider.name,
          environmentId,
          status: terminalStatus,
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        },
  )
  return { state: 'lost', environmentId }
}
