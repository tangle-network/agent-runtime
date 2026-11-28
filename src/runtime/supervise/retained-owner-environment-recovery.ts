import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from '../../errors'
import { ENVIRONMENT_LOOKUP_TIMEOUT_MS } from '../retained-interactive-lifecycle'
import type { RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { runAbortable } from './abortable'
import { errMessage } from './error-message'
import type { CheckpointEvent } from './retained-owner-checkpoint-requests'
import { unusableEnvironmentIds } from './retained-owner-evidence'
import { owners } from './retained-owner-state'
import type { Scope, SpawnEvent } from './types'

export function restoreBefore(
  owned: readonly SpawnEvent[],
  inputIndex: number,
): CheckpointEvent | undefined {
  const unusable = unusableEnvironmentIds(owned)
  // Rotation deletes superseded checkpoints; restore from the newest one still held.
  const deleted = new Set(
    owned.flatMap((event) =>
      event.kind === 'workspace-checkpoint-cleanup' && event.confirmed ? [event.checkpointId] : [],
    ),
  )
  return owned
    .slice(0, inputIndex < 0 ? owned.length : inputIndex)
    .filter(
      (event): event is CheckpointEvent =>
        event.kind === 'workspace-checkpoint' &&
        unusable.has(event.environmentId) &&
        !deleted.has(event.checkpoint.checkpointId),
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

/**
 * Observe exact environment loss before replacing its invocation; preserve uncertain work.
 *
 * An environment whose release Runtime already receipted unconfirmed (`environment-teardown`,
 * `destroyed: false`) is continued only while the provider confirms it running: a reopened run
 * continued in such a box and the Sandbox refused every attempt (real-work-benchmark-20261127a:
 * HTTP 501 "Native seat continuation requires the running retained environment";
 * claim-cycle-count-gcd-20261117a: HTTP 503 "Exact resume admission cleanup remains
 * unconfirmed" 58 times in 31 minutes). `mustRun` asks the same of any environment, for a seat
 * change that would checkpoint it. Such an environment is retired, never retried: the next
 * invocation starts in a new one, restored from the newest checkpoint, without the conversation.
 */
export async function reconcileScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
  mustRun = false,
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
  const released = owned.some(
    (event) =>
      event.kind === 'environment-teardown' &&
      event.environmentId === environmentId &&
      !event.destroyed,
  )
  if (!provider.get) return { state: 'unknown', environmentId }
  let environment: Awaited<ReturnType<NonNullable<AgentEnvironmentProvider['get']>>>
  let terminalStatus: 'failed' | 'expired' | undefined
  let status: string | undefined
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
      status = await runAbortable(
        () => found.status(),
        AbortSignal.any([scope.signal, AbortSignal.timeout(ENVIRONMENT_LOOKUP_TIMEOUT_MS)]),
        'retained owner environment status timed out',
      )
      if (status === 'failed' || status === 'expired') terminalStatus = status
    }
  } catch (error) {
    scope.signal.throwIfAborted()
    // A provider that cannot answer for a box whose release began has not confirmed it running.
    if (!released) return { state: 'unknown', environmentId }
    return retireOwnerEnvironment(
      scope,
      environmentId,
      `the provider could not confirm it running: ${errMessage(error).slice(0, 300)}`,
    )
  }
  if (environment !== null && terminalStatus === undefined) {
    if (status !== 'running' && (released || mustRun))
      return retireOwnerEnvironment(scope, environmentId, `the provider reports it ${status}`)
    return { state: 'live', environmentId, inFlight: continued.inFlight }
  }
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

/** Journal that Runtime will not continue in `environmentId`; its destroy is still owed. */
async function retireOwnerEnvironment(
  scope: Scope<unknown>,
  environmentId: string,
  why: string,
): Promise<RetainedOwnerEnvironmentState> {
  const { provider, args, nextSequence } = owners.get(scope)!
  scope.signal.throwIfAborted()
  await args.journal.appendEvent(args.rootId, {
    kind: 'environment-teardown',
    id: args.nodeId,
    provider: provider!.name,
    environmentId,
    destroyed: false,
    retired: true,
    detail: `retired, not running: ${why}. The next invocation starts in a new environment and a new harness session, so the conversation context is not carried`,
    seq: nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
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
