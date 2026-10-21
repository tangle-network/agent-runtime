import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import { sleep as runtimeSleep } from '../util'
import { harnessTurnFailure } from './driver-execution-attempt'
import { createActivityLog, type ExecutorProgress } from './progress'
import {
  consumeScopeRetainedOwnerResult,
  prepareScopeRetainedOwnerSeatSwitch,
  scopeRetainedOwnerJournalRoot,
  scopeRetainedOwnerResult,
} from './retained-scope-owner'
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
import type { DriverSessionState } from './supervise-driver-session'
import { managerExecutorConfig } from './supervise-profile-admission'
import { type DriveHarness, providerVisibleProfile } from './supervisor-agent'
import type {
  ExecutorFactory,
  ExecutorProgressEvent,
  ExecutorResult,
  Scope,
  SpawnJournal,
} from './types'

/** How a harness-brained manager with authored seats picks, journals, and pauses its seat. */
export interface ManagerSeatSelection {
  readonly select: SelectSeat
  readonly journal: SpawnJournal
  readonly rootId: string
  readonly onSegment: (
    nodeId: string,
    segment: SeatSegment,
    phase: 'started' | 'ended',
  ) => Promise<void>
  readonly onPause: (nodeId: string, resumeAt: string, phase: 'paused' | 'resumed') => Promise<void>
}

type DriveArgs = Parameters<DriveHarness>[0]

/** The profile the provider sees for `profile`, run on `seat` when one is active. */
export function seatProviderProfile(
  profile: AgentProfile,
  seat: ActiveSeat | undefined,
): AgentProfile {
  return providerVisibleProfile(seat ? seatExecutionProfile(profile, seat.stage) : profile)
}

/** Restore a committed owner turn's evidence and consume it, so no later drive replays it. */
export async function restoreAcceptedOwnerTurn(scope: Scope<unknown>): Promise<void> {
  await restoreScopeOwnerAcceptedExecution(scope)
  consumeScopeRetainedOwnerResult(scope)
}

/** What a harness handoff tells the next harness about the turn the previous one committed. */
export function committedTranscriptDigest(artifact: ExecutorResult<unknown> | undefined): string {
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

/**
 * One harness-brained manager across its drives: the backend it is bound to, the seat it runs on,
 * what its harness has been doing, and the newest capture of its own session.
 */
export class ManagerDriveSession {
  readonly state: DriverSessionState
  baseFactory!: ExecutorFactory<unknown>
  ownerRuntime!: string
  activeSeat: ActiveSeat | undefined
  /** Set by a seat switch that replaced the environment, for the drive that follows it. */
  switchedProviderCheckpointAt: string | undefined
  private seatChain: SeatChain | undefined
  // What the harness has been doing, from streamed progress events: an executor with no activity
  // log of its own (a provider) otherwise reads idle (a director mid-turn read `turns: 0`,
  // `stalled: true` on 2026-10-05).
  private readonly driveActivity = createActivityLog()
  // The manager's own harness session, as the attempts before the newest one captured it.
  private managerTranscript: HarnessTranscriptCapture | undefined

  constructor(backend: ExecutorConfig, executionId: string) {
    const capturedBackend = managerExecutorConfig(
      captureReusableExecutorConfig(backend, 'driveHarnessFromBackend'),
    )
    this.state = {
      boundBackend: bindReusableExecutorExecutionId(capturedBackend, executionId),
      activeExecutor: undefined,
      lastExecutor: undefined,
      managerArtifact: undefined,
      driveTurns: 0,
    }
    this.bind(this.state.boundBackend)
  }

  /** Bind the manager to `backend`: its executor factory and the runtime its receipts name. */
  private bind(backend: ExecutorConfig): void {
    this.state.boundBackend = backend
    this.baseFactory = createExecutor(backend)
    this.ownerRuntime =
      backend.backend === 'provider'
        ? (backend.runtime ??
          resolveAgentEnvironmentProvider(backend.provider, backend.registry).name)
        : 'cli'
  }

  readonly noteDriveProgress = (event: ExecutorProgressEvent): void => {
    const at = Date.now()
    const { driveActivity } = this
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

  // The newest attempt's executor keeps capturing after its attempt returns (a retained owner's
  // session copy and workspace capture run after the turn commits), so its transcript is read when
  // a receipt is taken, never copied at attempt end: that recorded the `capture-did-not-run`
  // placeholder for 7 of 8 such nodes on Runtime 0.319.8+ (#1360). The newest capture wins; a
  // capture never gives way to an attempt that captured nothing.
  readonly keepTranscript = (capture: HarnessTranscriptCapture | undefined): void => {
    const kept = this.managerTranscript
    if (
      capture !== undefined &&
      (capture.status !== 'unavailable' || kept?.status === 'unavailable' || kept === undefined)
    ) {
      this.managerTranscript = capture
    }
  }

  /** The same rule as `keepTranscript`, with the newest attempt read live: its capture wins, an
   *  earlier capture outranks its absence, and its absence names the newest reason. */
  harnessTranscript(): HarnessTranscriptCapture | undefined {
    const latest = this.state.lastExecutor?.harnessTranscript?.()
    const kept = this.managerTranscript
    if (latest === undefined) return kept
    if (latest.status !== 'unavailable') return latest
    return kept !== undefined && kept.status !== 'unavailable' ? kept : latest
  }

  progress(): ExecutorProgress {
    const fromExecutor = this.state.activeExecutor?.progress?.()
    const own = this.driveActivity.read()
    const recentActivity = [...(fromExecutor?.recentActivity ?? []), ...own]
      .sort((a, b) => a.at - b.at)
      .slice(-12)
    return {
      ...fromExecutor,
      turns: Math.max(fromExecutor?.turns ?? 0, this.state.driveTurns),
      ...(recentActivity.length > 0 ? { recentActivity } : {}),
    }
  }

  async closeSeatSegment(reason: 'completed' | 'failed' | 'cancelled' | 'paused'): Promise<void> {
    await this.seatChain?.close(reason)
  }

  /**
   * Put a manager with authored seats on its seat for this drive: the first one, or the next one
   * after a typed usage limit, binding the manager to that seat's backend.
   */
  async selectSeat(
    { authoredProfile, scope, reentry }: DriveArgs,
    seatSelection: ManagerSeatSelection | undefined,
    executionId: string,
    now: () => number,
  ): Promise<void> {
    if (authoredSeatStages(authoredProfile) === undefined) return
    if (!seatSelection) {
      throw new ValidationError('AgentProfile.seats requires SuperviseOptions.selectSeat')
    }
    if (this.activeSeat === undefined) {
      // After a coordinator crash following a committed failed turn, restore that outcome before
      // selecting a replacement; no new seat starts while the old call is in doubt.
      const accepted = await scopeRetainedOwnerResult(scope)
      const failure =
        accepted === undefined ? undefined : harnessTurnFailure(this.ownerRuntime, accepted)
      if (failure !== undefined) {
        await restoreAcceptedOwnerTurn(scope)
        this.state.managerArtifact = accepted
        throw failure
      }
    }
    const seatJournalRoot = scopeRetainedOwnerJournalRoot(scope) ?? seatSelection.rootId
    this.seatChain ??= new SeatChain(
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
          if (!sameEnvironment) this.switchedProviderCheckpointAt = checkpoint.checkpointAt
        }
      },
    )
    const usageLimit =
      reentry?.reason.reason === 'upstream-unavailable' &&
      reentry.reason.signal === 'subscription-usage-limit'
    if (this.activeSeat !== undefined && !usageLimit) return
    const activeSeat = await this.nextSeat(
      this.seatChain,
      scope,
      seatSelection,
      seatJournalRoot,
      usageLimit,
      now,
    )
    this.activeSeat = activeSeat
    this.bind(
      bindReusableExecutorExecutionId(
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
      ),
    )
  }

  /** The next seat the chain grants, waiting out every pause the chain is exhausted until. */
  private async nextSeat(
    seatChain: SeatChain,
    scope: Scope<unknown>,
    seatSelection: ManagerSeatSelection,
    seatJournalRoot: string,
    usageLimit: boolean,
    now: () => number,
  ): Promise<ActiveSeat> {
    let afterRecheck = false
    for (;;) {
      try {
        const seat = await seatChain.next(usageLimit && !afterRecheck, afterRecheck)
        this.activeSeat = seat
        if (afterRecheck) await seatSelection.onPause(scope.view.root, '', 'resumed')
        return seat
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
  }
}
