import { ValidationError } from '../../errors'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import { harnessTurnFailure } from './driver-execution-attempt'
import {
  committedTranscriptDigest,
  ManagerDriveSession,
  type ManagerSeatSelection,
  restoreAcceptedOwnerTurn,
  seatProviderProfile,
} from './manager-drive-session'
import {
  attestRuntimeOwnedScopeOwner,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import { type ReentryContinuity, UNPROVEN_CONTINUITY } from './reentry'
import {
  bindScopeRetainedOwnerEnvironmentId,
  bindScopeRetainedOwnerProvider,
  prepareScopeRetainedOwnerTask,
  reconcileScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerContext,
  scopeRetainedOwnerRestorePoint,
  scopeRetainedOwnerResult,
  scopeRetainedOwnerTurnEnded,
} from './retained-scope-owner'
import type { RootStreamSink } from './root-stream'
import type { ExecutorConfig } from './runtime'
import { executeDriverAttempt } from './supervise-driver-attempt'
import type { DriveHarness } from './supervisor-agent'
import type { Executor, ExecutorResult, Scope } from './types'

type DriveArgs = Parameters<DriveHarness>[0]

/** Run a harness-brained manager through the same executor factory as its children. The manager's
 * full profile is preserved, the live coordination server is added under one reserved alias, and
 * every streamed turn is charged to the manager's scope before it may continue. */
export function driveHarnessFromBackend(
  backend: ExecutorConfig,
  executionId: string,
  now: () => number = Date.now,
  maxTurns?: number,
  rootStream?: RootStreamSink,
  seatSelection?: ManagerSeatSelection,
): DriveHarness {
  // Same refusal the router arm makes in `driverAgent`: a negative cap would silently run zero
  // turns and finalize an empty no-winner.
  if (maxTurns !== undefined && maxTurns < 0) {
    throw new ValidationError(
      'driveHarnessFromBackend: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
    )
  }
  const turnCap = maxTurns ?? 0
  const manager = new ManagerDriveSession(backend, executionId)
  const { state } = manager
  const drive: DriveHarness = async (args) => {
    const { scope } = args
    const priorCommittedArtifact = state.managerArtifact
    state.managerArtifact = undefined
    manager.switchedProviderCheckpointAt = undefined
    await manager.selectSeat(args, seatSelection, executionId, now)
    const retainedOwner = await bindDriveRetainedOwner(manager, args)
    // What this drive continues decides what a re-entered driver must be told. Only a proven
    // same-session turn gets the unmet items alone; a replacement environment gets the objective
    // and the coordinator's run state.
    const driveTask =
      args.reentry === undefined
        ? args.task
        : await reentryDriveTask(
            manager,
            args,
            args.reentry,
            retainedOwner !== undefined,
            priorCommittedArtifact,
          )
    const originalTask = retainedOwner
      ? await prepareScopeRetainedOwnerTask(scope, driveTask, args.session ?? 'native')
      : driveTask
    const acceptedOwner = retainedOwner ? await scopeRetainedOwnerResult(scope) : undefined
    if (acceptedOwner) {
      await restoreAcceptedOwnerTurn(scope)
      // A committed turn that failed is replayed as the failure it was, not as a delivered turn.
      // Its evidence is restored above, so the retry loop's next attempt starts a new invocation
      // in the same environment instead of this resume ending on the failed result.
      const replayedFailure = harnessTurnFailure(manager.ownerRuntime, acceptedOwner)
      if (replayedFailure !== undefined) throw replayedFailure
      // The coordination journal still goes through the normal driver finalizer.
      state.managerArtifact = acceptedOwner
      return
    }
    await executeDriverAttempt({
      state,
      profile: args.profile,
      authoredProfile: args.authoredProfile,
      registeredProfile: args.registeredProfile,
      scope,
      coordinationMcpUrl: args.coordinationMcpUrl,
      coordinationMcpHeaders: args.coordinationMcpHeaders,
      peerMailUrl: args.peerMailUrl,
      stopSignal: args.stopSignal,
      coordinationTools: args.coordinationTools,
      session: args.session,
      reentry: args.reentry,
      onModelEvent: args.onModelEvent,
      retainedOwner,
      originalTask,
      activeSeat: manager.activeSeat,
      baseFactory: manager.baseFactory,
      executionId,
      now,
      turnCap,
      rootStream,
      keepTranscript: manager.keepTranscript,
      noteDriveProgress: manager.noteDriveProgress,
      drive,
    })
  }
  drive.resultArtifact = () => state.managerArtifact
  drive.deliver = (message): boolean => {
    const deliver = state.activeExecutor?.deliver
    if (!deliver) return false
    return deliver.call(state.activeExecutor, message) !== false
  }
  drive.deliverReady = (): boolean => state.activeExecutor !== undefined
  drive.traceSource = () => state.activeExecutor?.traceSource?.()
  drive.progress = () => manager.progress()
  // Only the provider backend has a transcript port. Any other backend leaves the method off, so
  // its managers keep settling as `executor-exposes-no-transcript`.
  if (state.boundBackend.backend === 'provider') {
    drive.harnessTranscript = () => manager.harnessTranscript()
    drive.harnessTranscriptSettled = () =>
      state.lastExecutor?.harnessTranscriptSettled?.() ?? Promise.resolve()
  }
  drive.closeSeatSegment = async (reason) => {
    await manager.closeSeatSegment(reason)
  }
  return attestRuntimeOwnedScopeOwner(drive, manager.ownerRuntime)
}

/** Bind a provider manager's retained owner to this drive, once the previous turn's capture ends. */
async function bindDriveRetainedOwner(
  manager: ManagerDriveSession,
  { scope, profile, authoredProfile }: DriveArgs,
): Promise<ReturnType<typeof scopeRetainedOwnerContext>> {
  const { state, activeSeat } = manager
  const retainedOwner =
    state.boundBackend.backend === 'provider' ? scopeRetainedOwnerContext(scope) : undefined
  if (retainedOwner && state.boundBackend.backend === 'provider') {
    bindScopeRetainedOwnerProvider(
      scope,
      resolveAgentEnvironmentProvider(state.boundBackend.provider, state.boundBackend.registry),
      state.boundBackend.workspaceRetention === undefined
        ? undefined
        : {
            port: state.boundBackend.workspaceRetention,
            profile: activeSeat ? seatProviderProfile(authoredProfile, activeSeat) : profile,
          },
    )
    // The manager's current box, for a spawn that names a resource by path. Read from the
    // active executor's receipt at spawn time, not captured: the environment does not exist
    // yet here, and a retry re-enters `drive` with a fresh executor.
    bindScopeRetainedOwnerEnvironmentId(scope, () => {
      if (state.activeExecutor === undefined) return undefined
      const execution = runtimeOwnedExecutorMaterialization(state.activeExecutor)?.execution
      return execution?.kind === 'environment' ? execution.id : undefined
    })
    // The workspace capture the previous turn handed over reads the environment this turn
    // would change, and its receipt belongs to that turn's invocation: it finishes first.
    await scopeRetainedOwnerTurnEnded(scope)
  }
  return retainedOwner
}

/** The task a re-entered drive runs, composed from what the backend proves it continues. */
async function reentryDriveTask(
  manager: ManagerDriveSession,
  { scope, session }: DriveArgs,
  reentry: NonNullable<DriveArgs['reentry']>,
  retainedOwner: boolean,
  priorCommittedArtifact: ExecutorResult<unknown> | undefined,
): Promise<unknown> {
  const { activeSeat, switchedProviderCheckpointAt } = manager
  // The first drive after a process restart proves nothing yet: a retained owner reconciles
  // its own invocation when it recovers, and probing the environment here first reconnected
  // to it a second time.
  const proven: ReentryContinuity =
    reentry.reason.reason === 'run-reentered'
      ? UNPROVEN_CONTINUITY
      : switchedProviderCheckpointAt === undefined
        ? await reentryContinuity(manager.state.boundBackend, scope, retainedOwner)
        : {
            session: 'new',
            environment: 'replaced',
            workspace: 'restored',
            checkpointAt: switchedProviderCheckpointAt,
          }
  if (
    activeSeat?.previous &&
    activeSeat.previous.seat !== activeSeat.seat &&
    activeSeat.previous.provider === activeSeat.stage.provider &&
    activeSeat.previous.harness === activeSeat.stage.harness &&
    (proven.session !== 'continued' || proven.environment !== 'same')
  ) {
    throw new ValidationError('same-provider seat continuation lost its native environment')
  }
  // A fresh re-entry keeps the environment the backend proves and starts a new session in it:
  // the bridge under a new session id below, a retained provider owner under a new session id
  // in its live environment (`prepareScopeRetainedOwnerTask`).
  const continuity: ReentryContinuity =
    session === 'fresh' && proven.session === 'continued' ? { ...proven, session: 'new' } : proven
  reentry.onContinuity?.(continuity)
  // After the capture wait above: a wake names what settled while the turn was held.
  await reentry.refresh?.()
  const composed = reentry.compose(continuity)
  if (
    !activeSeat?.previous ||
    (activeSeat.previous.provider === activeSeat.stage.provider &&
      activeSeat.previous.harness === activeSeat.stage.harness)
  ) {
    return composed
  }
  return [
    String(composed),
    '',
    '## Harness handoff',
    '',
    'This is the same logical agent in a different harness or provider. Read the restored workspace,',
    'especially its STATE, NEXT, and RESULT pages and knowledge pages, before acting.',
    'A prior tool call may have executed. Check its committed output or workspace effect',
    'before repeating it.',
    committedTranscriptDigest(priorCommittedArtifact),
  ].join('\n')
}

/**
 * What the next drive of a harness-brained manager continues, as far as its backend proves it.
 *
 * A bridge reattaches the harness session by its durable execution id. A retained provider owner
 * continues in the environment it last used while the provider still holds it, and a deliberate
 * later invocation there continues the same harness session. A provider without retained control
 * creates a new environment for every drive and releases the old one. Anything else is unproven.
 */
async function reentryContinuity(
  backend: ExecutorConfig,
  scope: Scope<unknown>,
  retainedOwner: boolean,
): Promise<ReentryContinuity> {
  if (backend.backend === 'bridge') {
    return { session: 'continued', environment: 'same', workspace: 'kept' }
  }
  if (backend.backend !== 'provider' || !retainedOwner) return UNPROVEN_CONTINUITY
  const provider = resolveAgentEnvironmentProvider(backend.provider, backend.registry)
  const capabilities = await provider.capabilities()
  if (capabilities.retainedControl === undefined) {
    return { session: 'new', environment: 'replaced', workspace: 'lost' }
  }
  const environment = await reconcileScopeRetainedOwnerEnvironment(scope)
  if (environment.state === 'live') {
    return {
      session: 'continued',
      environment: 'same',
      environmentId: environment.environmentId,
      workspace: 'kept',
    }
  }
  if (environment.state === 'lost') {
    // The replacement starts from the lost environment's latest checkpoint when there is one.
    const restorePoint = await scopeRetainedOwnerRestorePoint(scope)
    return {
      session: 'new',
      environment: 'replaced',
      previousEnvironmentId: environment.environmentId,
      ...(restorePoint === undefined
        ? { workspace: 'lost' as const }
        : { workspace: 'restored' as const, checkpointAt: restorePoint.takenAt }),
    }
  }
  return UNPROVEN_CONTINUITY
}

export interface DriverSessionState {
  boundBackend: ExecutorConfig
  activeExecutor: Executor<unknown> | undefined
  lastExecutor: Executor<unknown> | undefined
  managerArtifact: ExecutorResult<unknown> | undefined
  driveTurns: number
}
