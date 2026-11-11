import type { AgentExactRunControlRef } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/content-address'
import { describeRetainedNativeStops, stopRetainedNativeExecution } from '../retained-native-stop'
import { runAbortable } from './abortable'
import { errMessage } from './error-message'
import { cleanCheckpoints, settleCaptureForks } from './retained-owner-checkpoint-capture'
import {
  type CheckpointEvent,
  checkpointHandle,
  pendingCheckpoints,
  reconcileCheckpointRequests,
} from './retained-owner-checkpoint-requests'
import { ownerWorkspaceRetentionFailures } from './retained-owner-evidence'
import { type OwnerState, owners } from './retained-owner-state'
import { ownerDriveEnded, scopeRetainedOwnerTurnEnded } from './retained-owner-turn-lifecycle'
import type { NodeId, Scope, SpawnEvent, UnconfirmedTeardown } from './types'

/** @internal Whether another owner release could still destroy what the last one left. */
export function retainedOwnerReleaseRetriable(scope: Scope<unknown>): boolean {
  return owners.get(scope)?.releaseRetriable ?? false
}

/** One budget for every checkpoint lookup, delete and fork cleanup this release starts. Work cut short keeps its checkpoint and source. */
const RELEASE_CHECKPOINT_CAPTURES_MS = 15 * 60_000

/**
 * How long one release waits for an environment's destroy. A provider may seal a retained
 * workspace before it answers a delete, so the wait grows with the workspace: measured 2026-11-11
 * on the Tangle Sandbox, 2 to 4 s for 1 MB, 30 s for 300 MB and 72 s for 1 GB. A destroy that
 * outlasts the wait keeps running, and the next release joins it.
 */
const RELEASE_DESTROY_MS = 5 * 60_000

/**
 * Release the owner's environment once no turn of it will run again. A second call joins the one
 * in flight. The end-of-turn capture finishes before destroy. `capturesMs` bounds checkpoint work
 * and `destroyMs` each environment's destroy wait.
 */
export function releaseScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
  {
    capturesMs = RELEASE_CHECKPOINT_CAPTURES_MS,
    destroyMs = RELEASE_DESTROY_MS,
  }: { readonly capturesMs?: number; readonly destroyMs?: number } = {},
): Promise<readonly UnconfirmedTeardown[]> {
  const state = owners.get(scope)
  const provider = state?.provider
  if (state === undefined || provider === undefined) return Promise.resolve([])
  if (state.releasing !== undefined) return state.releasing
  const releasing = (async () => {
    await ownerDriveEnded(state)
    await scopeRetainedOwnerTurnEnded(scope)
    return await releaseOwnerEnvironment(state, provider, capturesMs, destroyMs)
  })()
  const tracked = releasing.finally(() => {
    if (state.releasing === tracked) delete state.releasing
  })
  state.releasing = tracked
  return tracked
}

async function releaseOwnerEnvironment(
  state: OwnerState,
  provider: AgentEnvironmentProvider,
  capturesMs: number,
  destroyMs: number,
): Promise<readonly UnconfirmedTeardown[]> {
  const { args } = state
  // No checkpoint may race the destroy below, and none is needed after it.
  state.checkpointsUnavailable ??= 'released'
  await state.checkpointing?.catch(() => undefined)
  // One budget bounds this release's checkpoint lookups and deletes.
  const capturesDeadline = Date.now() + capturesMs
  const events = [...((await args.journal.loadTree(args.rootId)) ?? [])]
  const captures = new AbortController()
  const capturesTimer = setTimeout(
    () =>
      captures.abort(
        new Error(
          `the release's ${capturesMs} ms for checkpoint cleanup ran out; checkpoint and source kept`,
        ),
      ),
    Math.max(0, capturesDeadline - Date.now()),
  )
  let requestFailures: Awaited<ReturnType<typeof reconcileCheckpointRequests>> = []
  const pendingSources = new Set<string>()
  const released = new Set(
    events.flatMap((event) =>
      event.kind === 'environment-teardown' &&
      event.id === args.nodeId &&
      event.provider === provider.name &&
      event.destroyed
        ? [event.environmentId]
        : [],
    ),
  )
  const environments = new Set(
    events.flatMap((event) =>
      event.id === args.nodeId &&
      event.kind === 'execution-admitted' &&
      event.admission.phase === 'environment'
        ? [event.admission.environmentId]
        : [],
    ),
  )
  const retentionFailures = await ownerWorkspaceRetentionFailures(events, args)
  const unconfirmed: string[] = []
  // Sources preserved for lack of a verified workspace receipt: evidence, never swept.
  const preserved: string[] = []
  let lastDetail: string | undefined
  let retriable = false
  const checkpointFailures: { readonly event: CheckpointEvent; readonly reason: string }[] = []
  try {
    requestFailures = await reconcileCheckpointRequests(state, events, captures.signal)
    for (const { event } of requestFailures) pendingSources.add(event.environmentId)
    const pending = pendingCheckpoints(events, state).filter(
      (event) => !retentionFailures.has(event.environmentId),
    )
    for (const sourceEnvironmentId of new Set(pending.map((event) => event.environmentId))) {
      const branching = await checkpointHandle(
        state,
        sourceEnvironmentId,
        AbortSignal.any([captures.signal, AbortSignal.timeout(30_000)]),
      )
      checkpointFailures.push(
        ...(await cleanCheckpoints(
          state,
          branching,
          pending.filter((event) => event.environmentId === sourceEnvironmentId),
          captures.signal,
        )),
      )
    }
  } finally {
    clearTimeout(capturesTimer)
  }
  const forksUnresolved = await settleCaptureForks(state, captures.signal)
  for (const { event } of checkpointFailures) pendingSources.add(event.environmentId)
  for (const environmentId of environments) {
    if (released.has(environmentId)) continue
    let destroyed = false
    let detail: string | undefined
    const retentionReason = retentionFailures.get(environmentId)
    const nativeHold = retentionReason?.startsWith('native session copy incomplete:') === true
    if (retentionReason !== undefined || pendingSources.has(environmentId)) {
      detail =
        !nativeHold && pendingSources.has(environmentId)
          ? 'checkpoint cleanup unresolved: source preserved for exact lookup and cleanup'
          : retentionReason
      preserved.push(environmentId)
      lastDetail = detail
    } else {
      try {
        await runAbortable(
          () => ownerEnvironmentDestroy(state, provider, environmentId),
          AbortSignal.timeout(destroyMs),
          () => new Error(`destroy still running after ${destroyMs} ms`),
        )
        destroyed = true
      } catch (error) {
        detail = `retained owner environment cleanup was not confirmed: ${errMessage(error).slice(0, 500)}`
        unconfirmed.push(environmentId)
        lastDetail = detail
        // A provider that cannot reconstruct or destroy the environment answers the same way every
        // time; only a destroy that failed or went unanswered is worth asking again.
        if (!(error instanceof PermanentReleaseRefusal)) retriable = true
      }
    }
    if (!destroyed) {
      // A kept environment keeps its files, never its running harness: the run has settled, so
      // nothing will observe or reconcile an owner turn still executing inside it.
      const runs = unsettledOwnerRuns(events, args.nodeId, environmentId)
      if (runs.length > 0) {
        const stops = await Promise.all(
          runs.map((controlRef) =>
            stopRetainedNativeExecution({
              provider,
              controlRef,
              signal: AbortSignal.timeout(30_000),
              now: args.now,
            }),
          ),
        )
        detail = `${detail}; ${describeRetainedNativeStops(stops)}`
        lastDetail = detail
      }
    }
    await args.journal.appendEvent(args.rootId, {
      kind: 'environment-teardown',
      id: args.nodeId,
      provider: provider.name,
      environmentId,
      destroyed,
      ...(detail === undefined ? {} : { detail }),
      seq: state.nextSequence(),
      at: new Date(args.now()).toISOString(),
    })
  }
  state.releaseRetriable = retriable
  const checkpointTeardowns: UnconfirmedTeardown[] = [
    ...checkpointFailures.map(
      ({ event, reason }): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner workspace checkpoint',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint cleanup unconfirmed: ${event.checkpoint.checkpointId} from ${event.environmentId} (${reason})`,
      }),
    ),
    ...requestFailures.map(
      ({ event, reason }): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner checkpoint request',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint request unresolved: ${event.request.idempotencyKey} from ${event.environmentId} (${reason})`,
      }),
    ),
    ...(forksUnresolved.length === 0
      ? []
      : [
          {
            id: args.nodeId,
            label: 'scope owner checkpoint capture fork',
            runtime: provider.name,
            status: 'done',
            detail: `checkpoint capture fork destruction unconfirmed: ${forksUnresolved.join(', ')}`,
          } satisfies UnconfirmedTeardown,
        ]),
  ]
  return unconfirmed.length > 0 || preserved.length > 0
    ? [
        {
          id: args.nodeId,
          label: 'scope owner',
          runtime: provider.name,
          status: 'done',
          ...(unconfirmed.length === 0
            ? {}
            : {
                environments: unconfirmed.map((environmentId) => ({
                  provider: provider.name,
                  environmentId,
                })),
              }),
          ...(preserved.length === 0
            ? {}
            : {
                kept: preserved.map((environmentId) => ({
                  provider: provider.name,
                  environmentId,
                  keptFor: 'evidence' as const,
                })),
              }),
          ...(lastDetail === undefined ? {} : { detail: lastDetail }),
        },
        ...checkpointTeardowns,
      ]
    : checkpointTeardowns
}

class PermanentReleaseRefusal extends Error {}

/**
 * The environment's one destroy, which every release of this owner joins until it succeeds. A
 * release's wait does not bound it: a later release waits on the same delete instead of
 * reconnecting to an environment the provider is already removing, which a native-capture provider
 * refuses while its sidecar deprovisions. A failed destroy is forgotten, so the next release asks
 * the provider again, and a provider that reports the environment absent confirms it.
 */
function ownerEnvironmentDestroy(
  state: OwnerState,
  provider: AgentEnvironmentProvider,
  environmentId: string,
): Promise<void> {
  const destroys = (state.destroys ??= new Map())
  const joined = destroys.get(environmentId)
  if (joined !== undefined) return joined
  const destroy = (async () => {
    if (!provider.get)
      throw new PermanentReleaseRefusal('provider cannot reconstruct the retained environment')
    const environment = await provider.get(environmentId)
    if (environment === null) return
    if (environment.id !== environmentId || environment.provider !== provider.name)
      throw new PermanentReleaseRefusal('provider returned another retained environment')
    if (!environment.destroy)
      throw new PermanentReleaseRefusal('provider cannot destroy the retained environment')
    await environment.destroy()
  })()
  destroys.set(environmentId, destroy)
  destroy.catch(() => {
    if (destroys.get(environmentId) === destroy) destroys.delete(environmentId)
  })
  return destroy
}

/**
 * The owner's dispatched executions in one environment whose turn committed no result. A turn
 * with a result has ended; one without may still be running even after a later turn started.
 */
function unsettledOwnerRuns(
  events: readonly SpawnEvent[],
  nodeId: NodeId,
  environmentId: string,
): AgentExactRunControlRef[] {
  const runs = new Map<string, AgentExactRunControlRef>()
  let turn: AgentExactRunControlRef[] = []
  const close = (): void => {
    for (const controlRef of turn) runs.set(contentAddress(controlRef), controlRef)
    turn = []
  }
  for (const event of events) {
    if (!('id' in event) || event.id !== nodeId) continue
    if (event.kind === 'execution-input') close()
    else if (event.kind === 'execution-result') turn = []
    else if (
      event.kind === 'execution-admitted' &&
      event.admission.phase === 'dispatched' &&
      event.admission.controlRef.environmentId === environmentId
    ) {
      turn.push(event.admission.controlRef)
    }
  }
  close()
  return [...runs.values()]
}
