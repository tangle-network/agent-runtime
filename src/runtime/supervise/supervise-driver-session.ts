import { ValidationError } from '../../errors'
import { resolveAgentEnvironmentProvider } from '../environment-provider'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { sleep as runtimeSleep } from '../util'
import { HarnessTurnFailedError } from './driver-retry'
import { executorFailure } from './executor-outcome'
import {
  attestRuntimeOwnedScopeOwner,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import { createActivityLog } from './progress'
import { type ReentryContinuity, UNPROVEN_CONTINUITY } from './reentry'
import {
  bindScopeRetainedOwnerEnvironmentId,
  bindScopeRetainedOwnerProvider,
  consumeScopeRetainedOwnerResult,
  prepareScopeRetainedOwnerSeatSwitch,
  prepareScopeRetainedOwnerTask,
  reconcileScopeRetainedOwnerEnvironment,
  scopeRetainedOwnerContext,
  scopeRetainedOwnerJournalRoot,
  scopeRetainedOwnerRestorePoint,
  scopeRetainedOwnerResult,
  scopeRetainedOwnerTurnEnded,
} from './retained-scope-owner'
import type { RootStreamSink } from './root-stream'
import {
  bindReusableExecutorExecutionId,
  captureReusableExecutorConfig,
  createExecutor,
  type ExecutorConfig,
} from './runtime'
import { restoreScopeOwnerAcceptedExecution } from './scope'
import {
  type ActiveSeat,
  authoredSeatStages,
  SeatChain,
  SeatChainExhaustedError,
  type SeatSegment,
  type SelectSeat,
  seatExecutionProfile,
} from './seat-chain'
import { executeDriverAttempt } from './supervise-driver-attempt'
import { managerExecutorConfig } from './supervise-profile-admission'
import { type DriveHarness, providerVisibleProfile } from './supervisor-agent'
import type { Executor, ExecutorProgressEvent, ExecutorResult, Scope, SpawnJournal } from './types'

/** Run a harness-brained manager through the same executor factory as its children. The manager's
 * full profile is preserved, the live coordination server is added under one reserved alias, and
 * every streamed turn is charged to the manager's scope before it may continue. */
export function driveHarnessFromBackend(
  backend: ExecutorConfig,
  executionId: string,
  now: () => number = Date.now,
  maxTurns?: number,
  rootStream?: RootStreamSink,
  seatSelection?: {
    readonly select: SelectSeat
    readonly journal: SpawnJournal
    readonly rootId: string
    readonly onSegment: (
      nodeId: string,
      segment: SeatSegment,
      phase: 'started' | 'ended',
    ) => Promise<void>
    readonly onPause: (
      nodeId: string,
      resumeAt: string,
      phase: 'paused' | 'resumed',
    ) => Promise<void>
  },
): DriveHarness {
  // Same refusal the router arm makes in `driverAgent`: a negative cap would silently run zero
  // turns and finalize an empty no-winner.
  if (maxTurns !== undefined && maxTurns < 0) {
    throw new ValidationError(
      'driveHarnessFromBackend: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)',
    )
  }
  const turnCap = maxTurns ?? 0
  const capturedBackend = managerExecutorConfig(
    captureReusableExecutorConfig(backend, 'driveHarnessFromBackend'),
  )
  const state: DriverSessionState = {
    boundBackend: bindReusableExecutorExecutionId(capturedBackend, executionId),
    activeExecutor: undefined,
    lastExecutor: undefined,
    managerArtifact: undefined,
    driveTurns: 0,
  }
  let baseFactory = createExecutor(state.boundBackend)
  let ownerRuntime =
    state.boundBackend.backend === 'provider'
      ? (state.boundBackend.runtime ??
        resolveAgentEnvironmentProvider(state.boundBackend.provider, state.boundBackend.registry)
          .name)
      : 'cli'
  // What this manager's harness has been doing, from the progress events its drives stream. An
  // executor that keeps no activity log of its own (a provider) otherwise reads as idle to the
  // lead that observes it: measured 2026-10-05, a director mid-turn read `turns: 0`, `idleMs`
  // 463967, `stalled: true`.
  const driveActivity = createActivityLog()
  const noteDriveProgress = (event: ExecutorProgressEvent): void => {
    const at = Date.now()
    if (event.kind === 'tool_call') {
      driveActivity.push({ at, kind: 'tool', label: event.toolName })
    } else if (event.kind === 'tool_result') {
      driveActivity.push({ at, kind: 'tool', label: event.toolName, status: 'ok' })
    } else if (event.kind === 'text_delta' || event.kind === 'reasoning_delta') {
      const last = driveActivity.last()
      // One note per stretch of model output, refreshed every 30 s, so deltas cannot flood the ring.
      if (last === undefined || last.kind !== 'turn' || at - last.at > 30_000) {
        driveActivity.push({ at, kind: 'turn', label: 'model output' })
      }
    }
  }
  // The manager's own harness session, as the attempts before the newest one captured it.
  let managerTranscript: HarnessTranscriptCapture | undefined
  // The newest attempt's executor. It keeps capturing after its attempt returns: a retained
  // owner's final session copy and workspace capture run as end-of-turn work after the turn
  // commits, so its transcript is read when a receipt is taken, never copied when the attempt
  // ends. Copying it there recorded the `capture-did-not-run` placeholder for roots whose session
  // was stored minutes later: 7 of 8 such nodes on Runtime 0.319.8 and later (#1360).
  // The newest capture wins; a capture never gives way to an attempt that captured nothing.
  const keepTranscript = (capture: HarnessTranscriptCapture | undefined): void => {
    if (
      capture !== undefined &&
      (capture.status !== 'unavailable' ||
        managerTranscript?.status === 'unavailable' ||
        managerTranscript === undefined)
    ) {
      managerTranscript = capture
    }
  }
  const committedTranscriptDigest = (artifact: ExecutorResult<unknown> | undefined): string => {
    if (artifact === undefined)
      return 'Prior committed transcript: no bounded turn content was captured.'
    const out = artifact.out
    if (out === null || typeof out !== 'object') {
      return `Prior committed transcript ref: ${artifact.outRef}; no structured turn content was captured.`
    }
    const record = out as { content?: unknown; events?: unknown }
    const events = Array.isArray(record.events) ? record.events : []
    const kinds = events.slice(-16).flatMap((event) => {
      if (event === null || typeof event !== 'object') return []
      const kind = (event as { type?: unknown }).type
      return typeof kind === 'string' ? [kind.slice(0, 80)] : []
    })
    const content = typeof record.content === 'string' ? record.content.slice(-4_000) : ''
    return [
      `Prior committed transcript ref: ${artifact.outRef}; ${events.length} events captured.`,
      ...(kinds.length > 0 ? [`Recent event kinds: ${kinds.join(', ')}.`] : []),
      ...(content ? [`Last captured answer excerpt: ${content}`] : []),
    ].join('\n')
  }
  let seatChain: SeatChain | undefined
  let activeSeat: ActiveSeat | undefined
  let switchedProviderCheckpointAt: string | undefined
  const drive: DriveHarness = async ({
    profile,
    authoredProfile,
    registeredProfile,
    task,
    scope,
    coordinationMcpUrl,
    coordinationMcpHeaders,
    peerMailUrl,
    stopSignal,
    coordinationTools,
    reentry,
    session,
    onModelEvent,
  }) => {
    const priorCommittedArtifact = state.managerArtifact
    state.managerArtifact = undefined
    switchedProviderCheckpointAt = undefined
    const stages = authoredSeatStages(authoredProfile)
    if (stages !== undefined) {
      if (!seatSelection) {
        throw new ValidationError('AgentProfile.seats requires SuperviseOptions.selectSeat')
      }
      if (activeSeat === undefined) {
        // A coordinator crash after a provider committed a failed turn must restore that exact
        // outcome before selecting a replacement. No new seat may start while the old call is
        // still in doubt, and the next retry carries the typed usage-limit reason.
        const accepted = await scopeRetainedOwnerResult(scope)
        const reported = accepted === undefined ? undefined : executorFailure(accepted)
        if (reported !== undefined) {
          await restoreScopeOwnerAcceptedExecution(scope)
          consumeScopeRetainedOwnerResult(scope)
          state.managerArtifact = accepted
          throw new HarnessTurnFailedError(ownerRuntime, reported)
        }
      }
      const seatJournalRoot = scopeRetainedOwnerJournalRoot(scope) ?? seatSelection.rootId
      seatChain ??= new SeatChain(
        authoredProfile,
        scope.view.root,
        seatJournalRoot,
        seatSelection.journal,
        seatSelection.select,
        now,
        (segment, phase) => seatSelection.onSegment(scope.view.root, segment, phase),
        async (selection, previous) => {
          if (previous && previous.seat !== selection.seat) {
            const sameEnvironment =
              previous.provider === selection.stage.provider &&
              previous.harness === selection.stage.harness
            const checkpoint = await prepareScopeRetainedOwnerSeatSwitch(
              scope,
              sameEnvironment ? 'same-environment' : 'replace-environment',
            )
            if (!sameEnvironment) switchedProviderCheckpointAt = checkpoint.checkpointAt
          }
        },
      )
      const usageLimit =
        reentry?.reason.reason === 'upstream-unavailable' &&
        reentry.reason.signal === 'subscription-usage-limit'
      if (activeSeat === undefined || usageLimit) {
        let afterRecheck = false
        for (;;) {
          try {
            activeSeat = await seatChain.next(usageLimit && !afterRecheck, afterRecheck)
            if (afterRecheck) await seatSelection.onPause(scope.view.root, '', 'resumed')
            break
          } catch (error) {
            if (!(error instanceof SeatChainExhaustedError)) throw error
            await seatSelection.journal.appendEvent(seatJournalRoot, {
              kind: 'seat-paused',
              id: scope.view.root,
              resumeAt: error.resumeAt,
              seq: Date.parse(error.resumeAt),
              at: new Date(now()).toISOString(),
            })
            await seatSelection.onPause(scope.view.root, error.resumeAt, 'paused')
            const waitMs = Math.max(1_000, Date.parse(error.resumeAt) - now())
            await runtimeSleep(waitMs, scope.signal, false)
            afterRecheck = true
          }
        }
        state.boundBackend = bindReusableExecutorExecutionId(
          managerExecutorConfig(
            captureReusableExecutorConfig(
              {
                ...activeSeat.backend,
                // Let the supervisor see a terminal typed usage limit. The provider executor's
                // default unavailable loop would otherwise retry this seat inside one invocation.
                unavailablePause: false,
              },
              'selectSeat',
            ),
          ),
          `${executionId}:segment:${activeSeat.segmentIndex}`,
        )
        baseFactory = createExecutor(state.boundBackend)
        ownerRuntime =
          state.boundBackend.backend === 'provider'
            ? (state.boundBackend.runtime ??
              resolveAgentEnvironmentProvider(
                state.boundBackend.provider,
                state.boundBackend.registry,
              ).name)
            : 'cli'
      }
    }
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
              profile: activeSeat
                ? providerVisibleProfile(seatExecutionProfile(authoredProfile, activeSeat.stage))
                : profile,
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
    // What this drive continues decides what a re-entered driver must be told. Only a proven
    // same-session turn gets the unmet items alone; a replacement environment gets the objective
    // and the coordinator's run state.
    let driveTask = task
    if (reentry !== undefined) {
      // The first drive after a process restart proves nothing yet: a retained owner reconciles
      // its own invocation when it recovers, and probing the environment here first reconnected
      // to it a second time.
      const proven: ReentryContinuity =
        reentry.reason.reason === 'run-reentered'
          ? UNPROVEN_CONTINUITY
          : switchedProviderCheckpointAt === undefined
            ? await reentryContinuity(state.boundBackend, scope, retainedOwner !== undefined)
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
        session === 'fresh' && proven.session === 'continued'
          ? { ...proven, session: 'new' }
          : proven
      reentry.onContinuity?.(continuity)
      // After the capture wait above: a wake names what settled while the turn was held.
      await reentry.refresh?.()
      driveTask = reentry.compose(continuity)
      if (
        activeSeat?.previous &&
        (activeSeat.previous.provider !== activeSeat.stage.provider ||
          activeSeat.previous.harness !== activeSeat.stage.harness)
      ) {
        driveTask = [
          String(driveTask),
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
    }
    const originalTask = retainedOwner
      ? await prepareScopeRetainedOwnerTask(scope, driveTask, session ?? 'native')
      : driveTask
    const acceptedOwner = retainedOwner ? await scopeRetainedOwnerResult(scope) : undefined
    if (acceptedOwner) {
      await restoreScopeOwnerAcceptedExecution(scope)
      consumeScopeRetainedOwnerResult(scope)
      // A committed turn that failed is replayed as the failure it was, not as a delivered turn.
      // Its evidence is restored above, so the retry loop's next attempt starts a new invocation
      // in the same environment instead of this resume ending on the failed result.
      const replayedFailure = executorFailure(acceptedOwner)
      if (replayedFailure !== undefined) {
        throw new HarnessTurnFailedError(ownerRuntime, replayedFailure)
      }
      // The coordination journal still goes through the normal driver finalizer.
      state.managerArtifact = acceptedOwner
      return
    }
    await executeDriverAttempt({
      state,
      profile,
      authoredProfile,
      registeredProfile,
      scope,
      coordinationMcpUrl,
      coordinationMcpHeaders,
      peerMailUrl,
      stopSignal,
      coordinationTools,
      session,
      reentry,
      onModelEvent,
      retainedOwner,
      originalTask,
      activeSeat,
      baseFactory,
      executionId,
      now,
      turnCap,
      rootStream,
      keepTranscript,
      noteDriveProgress,
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
  drive.progress = () => {
    const fromExecutor = state.activeExecutor?.progress?.()
    const own = driveActivity.read()
    const recentActivity = [...(fromExecutor?.recentActivity ?? []), ...own]
      .sort((a, b) => a.at - b.at)
      .slice(-12)
    return {
      ...fromExecutor,
      turns: Math.max(fromExecutor?.turns ?? 0, state.driveTurns),
      ...(recentActivity.length > 0 ? { recentActivity } : {}),
    }
  }
  // Only the provider backend has a transcript port. Any other backend leaves the method off, so
  // its managers keep settling as `executor-exposes-no-transcript`.
  if (state.boundBackend.backend === 'provider') {
    // The same rule as `keepTranscript`, with the newest attempt read live: its capture wins, an
    // earlier capture outranks its absence, and its absence names the newest reason.
    drive.harnessTranscript = () => {
      const latest = state.lastExecutor?.harnessTranscript?.()
      if (latest === undefined) return managerTranscript
      if (latest.status !== 'unavailable') return latest
      return managerTranscript !== undefined && managerTranscript.status !== 'unavailable'
        ? managerTranscript
        : latest
    }
    drive.harnessTranscriptSettled = () =>
      state.lastExecutor?.harnessTranscriptSettled?.() ?? Promise.resolve()
  }
  drive.closeSeatSegment = async (reason) => {
    await seatChain?.close(reason)
  }
  return attestRuntimeOwnedScopeOwner(drive, ownerRuntime)
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
