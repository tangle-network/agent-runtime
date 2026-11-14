import type { AgentExactRunControlRef } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/content-address'
import {
  describeRetainedNativeStops,
  NATIVE_STOP_UNCONFIRMED,
  stopRetainedNativeExecution,
} from '../retained-native-stop'
import { runAbortable } from './abortable'
import { causeChain, errMessage } from './error-message'
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

/** A release's wait for its destroys; a delete grows with the retained workspace it seals (Sandbox
 * 2026-11-11: 2-4 s at 1 MB, 30 s at 300 MB, 72 s at 1 GB). A later release joins the rest. A
 * settling run's whole teardown fits in one such wait, so a cancel settles in about this long. */
export const RELEASE_DESTROY_MS = 90_000

/**
 * Release the owner's environment once no turn of it will run again. A second call joins the one
 * in flight. The end-of-turn capture finishes before destroy. `capturesMs` bounds checkpoint work.
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
  // Every destroy starts at once under one deadline, never past the settling run's; receipts are
  // still journaled in order.
  const left = (state.releaseDeadlineAt ?? Number.POSITIVE_INFINITY) - Date.now()
  const waitMs = Math.max(0, Math.min(destroyMs, left))
  const destroyDeadline = AbortSignal.timeout(waitMs)
  const held = (state.held ??= new Map())
  const destroys = new Map(
    [...environments]
      .filter(
        (id) =>
          !released.has(id) &&
          !retentionFailures.has(id) &&
          !pendingSources.has(id) &&
          !held.has(id),
      )
      .map((id) => {
        const wait = runAbortable(
          () => ownerEnvironmentDestroy(state, provider, id),
          destroyDeadline,
          () => new Error(`destroy still running after ${waitMs} ms`),
        )
        wait.catch(() => undefined)
        return [id, wait] as const
      }),
  )
  for (const environmentId of environments) {
    if (released.has(environmentId)) continue
    let destroyed = false
    let detail: string | undefined
    const asked = destroys.get(environmentId)
    // Refused under a retention hold before this release.
    const heldBefore = asked === undefined ? held.get(environmentId) : undefined
    const retentionReason = retentionFailures.get(environmentId) ?? heldBefore
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
        await asked
        destroyed = true
      } catch (error) {
        // The destroy itself remembers a hold refusal, so one answered after this wait still
        // keeps the box from every later release.
        detail =
          held.get(environmentId) ??
          `retained owner environment cleanup was not confirmed: ${errMessage(error).slice(0, 500)}`
        lastDetail = detail
        if (held.has(environmentId)) preserved.push(environmentId)
        else {
          unconfirmed.push(environmentId)
          // A provider that cannot reconstruct or destroy the environment answers the same way
          // every time; only a destroy that failed or went unanswered is worth asking again.
          if (!(error instanceof PermanentReleaseRefusal)) retriable = true
        }
      }
    }
    // A delete still running ends the harness with the box; a stop would reconnect to it.
    if (!destroyed && !state.destroys?.has(environmentId)) {
      // A kept environment keeps its files, never its running harness: the run has settled, so
      // nothing will observe or reconcile an owner turn still executing inside it.
      const runs = unsettledOwnerRuns(events, args.nodeId, environmentId)
      // A held box was stopped by its provider's refusal, and a reconnect to stop its harness
      // would wake it; the receipt names the stop as not attempted, never as done.
      if (runs.length > 0 && held.has(environmentId)) {
        detail = `${detail}; ${runs
          .map(
            (run) =>
              `native execution ${run.executionId} stop not attempted: its provider holds the environment under a retention hold and a reconnect would wake it; ${NATIVE_STOP_UNCONFIRMED}`,
          )
          .join('; ')}`
        lastDetail = detail
      } else if (runs.length > 0) {
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
 * A provider that keeps an environment under a retention hold refuses its delete until the hold is
 * released: 409 `RETENTION_HOLD`, or a refusal whose message names the hold. The holder, not this
 * release, decides when the environment goes.
 */
function retentionHoldRefusal(error: unknown): boolean {
  return (
    causeChain(error).some((cause) => Reflect.get(cause, 'code') === 'RETENTION_HOLD') ||
    /\bunder retention hold\b/iu.test(errMessage(error))
  )
}

/** A destroy in flight this long is presumed lost, and the next release asks the provider again. */
const RELEASE_DESTROY_ABANDONED_MS = 15 * 60_000

/**
 * The environment's one destroy, joined by this process's later releases instead of a reconnect to
 * a box being removed, which a native-capture provider refuses while its sidecar deprovisions. A
 * failed or abandoned destroy is forgotten: the next release asks again, and absence confirms it.
 */
function ownerEnvironmentDestroy(
  state: OwnerState,
  provider: AgentEnvironmentProvider,
  environmentId: string,
): Promise<void> {
  const destroys = (state.destroys ??= new Map())
  const joined = destroys.get(environmentId)
  if (joined !== undefined && Date.now() - joined.since < RELEASE_DESTROY_ABANDONED_MS)
    return joined.destroy
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
  const entry = { destroy, since: Date.now() }
  destroys.set(environmentId, entry)
  destroy.catch((error) => {
    if (destroys.get(environmentId) === entry) destroys.delete(environmentId)
    // The provider keeps the box for its own retention: evidence, not a leak. Another ask only
    // reconnects to it, and a refused box is stopped, so the reconnect would wake it.
    if (retentionHoldRefusal(error))
      (state.held ??= new Map()).set(
        environmentId,
        `environment kept: its provider refuses deletion under a retention hold (${errMessage(error).slice(0, 500)})`,
      )
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
