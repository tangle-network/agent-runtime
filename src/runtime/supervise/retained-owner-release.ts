import type { AgentExactRunControlRef } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { contentAddress } from '../../durable/content-address'
import { describeRetainedNativeStops, stopRetainedNativeExecution } from '../retained-native-stop'
import { runAbortable } from './abortable'
import {
  type CaptureRefusal,
  cleanCheckpoints,
  settleCaptureForks,
} from './retained-owner-checkpoint-capture'
import {
  type CheckpointEvent,
  checkpointHandle,
  pendingCheckpoints,
  reconcileCheckpointRequests,
} from './retained-owner-checkpoint-requests'
import {
  ownerWorkspaceRetentionFailures,
  recaptureOwnerSources,
  stopOwnerEvidenceRetry,
} from './retained-owner-evidence'
import { type OwnerState, owners } from './retained-owner-state'
import { ownerDriveEnded, scopeRetainedOwnerTurnEnded } from './retained-owner-turn-lifecycle'
import type { NodeId, Scope, SpawnEvent, UnconfirmedTeardown } from './types'

/** @internal Whether another owner release could still destroy what the last one left. */
export function retainedOwnerReleaseRetriable(scope: Scope<unknown>): boolean {
  return owners.get(scope)?.releaseRetriable ?? false
}

/**
 * How long one release spends capturing the owner's pending checkpoints, all of them together. A
 * capture it cuts short keeps its checkpoint and the source, as a failed capture does, and the
 * release goes on to settle. Each capture is otherwise bounded only by its port, and one at a
 * time: on Discovery run terraform-dc-model-20261010h-c1 (Runtime 0.314.0) a director's release
 * waited 00:19:18Z to 01:19:38Z for one capture to reach the port's 60-minute bound, and the run
 * settled 98 minutes after its deadline. The release captures that finished there took 67 seconds
 * and 7 and 34 minutes, beside live captures of abandoned directors on the same slots.
 */
const RELEASE_CHECKPOINT_CAPTURES_MS = 15 * 60_000

/**
 * Release the owner's environment once no turn of it will run again: at the run's final
 * settlement for the root, and when a nested manager's own scope has finished. A second call while
 * one is in flight joins it. The release first waits for the end-of-turn capture of the owner's
 * last turn, so the capture always precedes the destroy. `capturesMs` bounds the checkpoint
 * captures it runs ({@link RELEASE_CHECKPOINT_CAPTURES_MS}).
 */
export function releaseScopeRetainedOwnerEnvironment(
  scope: Scope<unknown>,
  { capturesMs = RELEASE_CHECKPOINT_CAPTURES_MS }: { readonly capturesMs?: number } = {},
): Promise<readonly UnconfirmedTeardown[]> {
  const state = owners.get(scope)
  const provider = state?.provider
  if (state === undefined || provider === undefined) return Promise.resolve([])
  if (state.releasing !== undefined) return state.releasing
  const releasing = (async () => {
    await ownerDriveEnded(state)
    await scopeRetainedOwnerTurnEnded(scope)
    return await releaseOwnerEnvironment(state, provider, capturesMs)
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
): Promise<readonly UnconfirmedTeardown[]> {
  const { args } = state
  // No checkpoint may race the destroy below, and none is needed after it.
  state.checkpointsUnavailable ??= 'released'
  await state.checkpointing?.catch(() => undefined)
  // One budget bounds every capture this release runs: the evidence it retries, then checkpoints.
  const capturesDeadline = Date.now() + capturesMs
  await stopOwnerEvidenceRetry(state)
  await recaptureOwnerSources(state, AbortSignal.timeout(capturesMs))
  const events = [...((await args.journal.loadTree(args.rootId)) ?? [])]
  const requestFailures = await reconcileCheckpointRequests(state, events)
  const pendingSources = new Set(requestFailures.map(({ event }) => event.environmentId))
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
  const retentionConfigured =
    state.workspaceRetention ||
    events.some(
      (event) =>
        event.kind === 'execution-input' &&
        event.id === args.nodeId &&
        event.workspaceRetention === true,
    )
  const retentionFailures = retentionConfigured
    ? await ownerWorkspaceRetentionFailures(events, args)
    : new Set<string>()
  const unconfirmed: string[] = []
  // Sources preserved for lack of a verified workspace receipt: evidence, never swept.
  const preserved: string[] = []
  let lastDetail: string | undefined
  let retriable = false
  const checkpointFailures: CheckpointEvent[] = []
  const checkpointsKept: CaptureRefusal[] = []
  // Sources kept because a checkpoint of theirs is in no capture, and only they can fork it.
  const uncapturedSources = new Set<string>()
  const pending = pendingCheckpoints(events, state).filter(
    (event) => !retentionFailures.has(event.environmentId),
  )
  const captures = new AbortController()
  const capturesTimer = setTimeout(
    () =>
      captures.abort(
        new Error(
          `the release's ${capturesMs} ms for checkpoint captures ran out; checkpoint and source kept`,
        ),
      ),
    Math.max(0, capturesDeadline - Date.now()),
  )
  try {
    for (const sourceEnvironmentId of new Set(pending.map((event) => event.environmentId))) {
      const branching = await checkpointHandle(
        state,
        sourceEnvironmentId,
        AbortSignal.any([captures.signal, AbortSignal.timeout(30_000)]),
      )
      const cleaned = await cleanCheckpoints(
        state,
        branching,
        pending.filter((event) => event.environmentId === sourceEnvironmentId),
        events,
        captures.signal,
      )
      checkpointFailures.push(...cleaned.unconfirmed)
      checkpointsKept.push(...cleaned.refused)
      for (const refusal of cleaned.refused)
        if (refusal.needsSource) uncapturedSources.add(sourceEnvironmentId)
    }
  } finally {
    clearTimeout(capturesTimer)
  }
  const forksUnresolved = await settleCaptureForks(state)
  for (const event of checkpointFailures) pendingSources.add(event.environmentId)
  for (const environmentId of environments) {
    if (released.has(environmentId)) continue
    let destroyed = false
    let detail: string | undefined
    if (
      retentionFailures.has(environmentId) ||
      pendingSources.has(environmentId) ||
      uncapturedSources.has(environmentId)
    ) {
      detail = pendingSources.has(environmentId)
        ? 'checkpoint cleanup unresolved: source preserved for exact lookup and cleanup'
        : uncapturedSources.has(environmentId)
          ? 'checkpoint kept uncaptured: source preserved so its checkpoint can still be forked and captured'
          : 'provider workspace retention: source preserved because the owner execution has no verified workspace receipt'
      preserved.push(environmentId)
      lastDetail = detail
    } else {
      // A provider that cannot reconstruct or destroy the environment answers the same way every
      // time; only a destroy that failed or went unanswered is worth asking again.
      let permanent = false
      try {
        await runAbortable(
          async () => {
            if (!provider.get) {
              permanent = true
              throw new Error('provider cannot reconstruct the retained environment')
            }
            const environment = await provider.get(environmentId)
            if (environment === null) return
            if (environment.id !== environmentId || environment.provider !== provider.name) {
              permanent = true
              throw new Error('provider returned another retained environment')
            }
            if (!environment.destroy) {
              permanent = true
              throw new Error('provider cannot destroy the retained environment')
            }
            await environment.destroy()
          },
          AbortSignal.timeout(30_000),
          'retained owner cleanup timed out',
        )
        destroyed = true
      } catch {
        detail = 'retained owner environment cleanup was not confirmed'
        unconfirmed.push(environmentId)
        lastDetail = detail
        if (!permanent) retriable = true
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
      (event): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner workspace checkpoint',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint cleanup unconfirmed: ${event.checkpoint.checkpointId} from ${event.environmentId}`,
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
    ...checkpointsKept.map(
      ({ event, reason }): UnconfirmedTeardown => ({
        id: args.nodeId,
        label: 'scope owner workspace checkpoint',
        runtime: provider.name,
        status: 'done',
        detail: `checkpoint kept uncaptured: ${event.checkpoint.checkpointId} from ${event.environmentId} (${reason})`,
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
