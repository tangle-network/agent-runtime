import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../../errors'
import { ENVIRONMENT_LOOKUP_TIMEOUT_MS } from '../retained-interactive-lifecycle'
import type { RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { runAbortable } from './abortable'
import type { CheckpointEvent } from './retained-owner-checkpoint-requests'
import { unusableEnvironmentIds } from './retained-owner-evidence'
import { owners } from './retained-owner-state'
import type { Scope, SpawnEvent } from './types'

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

/** The verified checkpoint the next new environment starts from, if any. */
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
  | { readonly state: 'none' }
  | { readonly state: 'live'; readonly environmentId: string; readonly inFlight: boolean }
  | { readonly state: 'lost'; readonly environmentId: string }
  /** The provider could not say. Nothing is concluded and nothing is journaled. */
  | { readonly state: 'unknown'; readonly environmentId: string }

/** Observe exact environment loss before replacing its invocation; preserve uncertain work. */
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
      AbortSignal.any([scope.signal, AbortSignal.timeout(ENVIRONMENT_LOOKUP_TIMEOUT_MS)]),
      'retained owner environment check timed out',
    )
    if (environment !== null) {
      const found = environment
      if (found.id !== environmentId || found.provider !== provider.name)
        return { state: 'unknown', environmentId }
      const status = await runAbortable(
        () => found.status(),
        AbortSignal.any([scope.signal, AbortSignal.timeout(ENVIRONMENT_LOOKUP_TIMEOUT_MS)]),
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

/** A fresh unsigned listener rekeys only after exact prior execution is terminal. */
export async function assertRetainedOwnerCoordinationRekey(scope: Scope<unknown>): Promise<void> {
  const state = owners.get(scope)
  const admission = state?.admissions.find((record) => record.phase === 'environment')
  if (!state || admission?.phase !== 'environment') return
  const { environmentId: id, sessionId, provider: name } = admission
  const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(ENVIRONMENT_LOOKUP_TIMEOUT_MS)])
  await runAbortable(
    async () => {
      const environment = await state.provider?.get?.(id, { signal })
      if (environment === null) return
      if (!environment || environment.id !== id || environment.provider !== name)
        throw new ValidationError('retained coordination ownership cannot be established')
      const dispatched = state.admissions.find((record) => record.phase === 'dispatched')
      if (dispatched?.phase !== 'dispatched')
        throw new ValidationError('retained coordination lacks exact dispatch authority')
      const session = environment.session?.(sessionId, {
        signal,
        controlRef: dispatched.controlRef,
      })
      const status = await session?.status({ signal })
      if (status !== 'completed' && status !== 'failed' && status !== 'cancelled')
        throw new ValidationError('active retained coordination needs a durable signer')
    },
    signal,
    'retained coordination reconciliation timed out',
  )
}
