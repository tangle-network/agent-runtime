import { dirname } from 'node:path'
import type { ManagerWake } from '../../mcp/tools/coordination-events'
import { errorMessage } from '../util'
import { CheckUnavailableError } from './completion-gate'
import {
  bestComposite,
  type ContinuationKeeper,
  checkVerdictOf,
  createContinuationKeeper,
} from './continuation'
import {
  type DriverAttemptRecord,
  type DriverContinuationRecord,
  summarizeDriverAttempts,
} from './driver-attempt-evidence'
import {
  type DriverProgressMark,
  type DriverReentry,
  type DriverStopPause,
  runDriverWithRetry,
} from './driver-retry'
import { harnessProcessDied } from './executor-outcome'
import { bestDelivered, runFinalizer, runTree } from './finalizer'
import type { InboxLease } from './inbox'
import { isLiveNodeStatus } from './node-status'
import { composeReentryTask, type ReentryContinuity, UNPROVEN_CONTINUITY } from './reentry'
import { owners } from './retained-owner-state'
import { abandonScopeRetainedOwnerInvocation } from './retained-scope-owner'
import { readRootStream } from './root-stream'
import { applyRunCancellation } from './run-cancellation'
import { bindScopeParkingDrain, isRunParked, sleepScopeWait } from './run-parking'
import { runTraceAnalysisStore } from './run-traces'
import {
  beginScopeOwnerAttempt,
  recordScopeOwnerBarrenPause,
  recordScopeOwnerDriverAttempt,
  recordScopeOwnerPause,
} from './scope'
import { authoredSeatStages } from './seat-chain'
import type { SupervisorAgentDeps } from './supervisor-agent-contracts'
import type { SupervisorProfile } from './supervisor-agent-profile'
import type { ExternalManagerConfig, ManagerSession } from './supervisor-manager-session'
import type { Scope } from './types'
import { composeWakeInput, deadlineWarningAt, refreshedWake } from './wake'

/** What the turn loop of one external-manager act starts from. */
export interface ManagerTurnInputs {
  readonly config: ExternalManagerConfig
  readonly session: ManagerSession
  readonly contractDeclared: boolean
  readonly finalize: () => Promise<unknown>
  readonly coordinationTools: ReturnType<ManagerSession['state']['slot']['descriptors']>
  readonly providerProfile: SupervisorProfile
  readonly controlPass?: () => Promise<void>
}

/** The turn loop's own record of what its drives did, read when the loop settles. */
interface ManagerTurnLoop extends ManagerTurnInputs {
  /** Spend since this reading: this driver's turns and any child's. `tokensLeft` only falls. */
  readonly baseTokensLeft: number
  readonly startedAt: number
  readonly describe: string | undefined
  readonly continuationSession:
    | NonNullable<SupervisorAgentDeps['continuation']>['session']
    | undefined
  readonly records: DriverAttemptRecord[]
  candidate: unknown
  deadlineWarned: boolean
  pendingWake:
    | { readonly attempt: number; readonly wake: ManagerWake; readonly at: number }
    | undefined
  environmentReplacements: number
  workspaceRestores: number
  modelEvents: number
  reported: boolean
}

/** The finalizer over this act's settled workers; the check it runs is recorded as a check read. */
export function managerFinalizer(
  deps: SupervisorAgentDeps,
  session: ManagerSession,
): () => Promise<unknown> {
  const { mcp, controls } = session
  const { scope } = session.state
  // The finalizer's check is a check read. The continuation note reports that verdict.
  const finalizerDeliverable =
    deps.deliverable === undefined
      ? undefined
      : {
          ...deps.deliverable,
          check: async (out: unknown) => {
            let verdict: ReturnType<typeof checkVerdictOf>
            try {
              verdict = checkVerdictOf(await deps.deliverable?.check(out))
            } catch (error) {
              controls.recordCheckRead({
                source: 'turn-end',
                unavailable: errorMessage(error),
              })
              throw error
            }
            controls.recordCheckRead({ source: 'turn-end', verdict })
            return verdict
          },
        }
  return () =>
    runFinalizer(deps.finalizer ?? bestDelivered, {
      settled: mcp.settled(),
      blobs: deps.blobs,
      tree: runTree(scope),
      budget: scope.budget,
      ...(finalizerDeliverable ? { deliverable: finalizerDeliverable } : {}),
    })
}

/** Drive until the retry loop ends. Return the checked candidate when the contract is met. */
export async function driveManagerTurns(inputs: ManagerTurnInputs): Promise<unknown> {
  const { config, session } = inputs
  const { deps, driveHarness } = config
  const { scope } = session.state
  // Spend is the burn rate, not the goal. An unmet check buys no attempt.
  const baseTokensLeft = scope.budget.tokensLeft
  const continuation = deps.continuation
  if (continuation !== undefined && deps.deliverable !== undefined) {
    session.state.keeper = createManagerKeeper(config, session, deps.deliverable, continuation)
  }
  const loop: ManagerTurnLoop = {
    ...inputs,
    baseTokensLeft,
    records: [],
    candidate: undefined,
    deadlineWarned: false,
    pendingWake: undefined,
    startedAt: Date.now(),
    environmentReplacements: 0,
    workspaceRestores: 0,
    describe: deps.deliverable?.describe,
    continuationSession: deps.continuation?.session,
    modelEvents: 0,
    reported: false,
  }
  const { mcp } = session
  bindScopeParkingDrain(
    scope,
    async () => {
      await mcp.drainResolved()
    },
    () =>
      !session.controls.hasOpenWork({ includeSettled: false }) &&
      session.state.nextTurnInbox.pendingAuthority() === 0,
  )
  const keeper = session.state.keeper
  // A taken-over run names the workers that were open and which of them this process re-places.
  const reenteredWorkers = scope.resume?.reentered
  const reentered =
    reenteredWorkers === undefined
      ? undefined
      : {
          first: { reason: 'run-reentered' as const, ...reenteredWorkers },
          modelEvents: () => loop.modelEvents,
        }
  let driverFailed = true
  let parked = false
  try {
    await runDriverWithRetry({
      ...(reentered === undefined ? {} : { reentered }),
      drive: async (attempt, reentry) => {
        let handedOff = false
        session.state.pausedOn = undefined
        try {
          // A route that timed out fails this drive as unavailable, so the loop pauses and re-enters.
          await session.reachable()
          await driveManagerTurn(loop, attempt, reentry)
        } catch (error) {
          handedOff = isRunParked(error, scope)
          throw error
        } finally {
          // Drain first. Do not apply a new control or await a worker. Parking sealed admission.
          if (!handedOff) await loop.controlPass?.()
        }
      },
      progress: () => readManagerProgress(loop),
      budget: () => scope.budget,
      signal: scope.signal,
      stopSignal: session.state.stopController.signal,
      sleep: (ms, signal) => sleepScopeWait(scope, ms, signal, 'paused-root'),
      ...rootStopPause(config, session),
      nested: (config.nodeContextSeed?.depth ?? 0) > 0,
      seatChain:
        config.driveHarness.seatChain === true && authoredSeatStages(config.profile) !== undefined,
      resolvePending: (failure, failures) =>
        abandonScopeRetainedOwnerInvocation(scope, failure, failures),
      wait: {
        open: () =>
          !mcp.submittedResult() &&
          !mcp.isStopped() &&
          session.state.progressStopReason === undefined &&
          // A steer an ended invocation never read is open work: one more turn folds it.
          (session.controls.hasOpenWork() || session.state.nextTurnInbox.pendingAuthority() > 0),
        wake: (nextAttempt) => wakeManager(loop, nextAttempt),
      },
      ...(deps.driverRetry ? { policy: deps.driverRetry } : {}),
      ...(continuation !== undefined && keeper !== undefined
        ? {
            continuation: {
              maxBarren: continuation.maxBarren,
              ...(config.continuationDeadlineMs === undefined
                ? {}
                : { deadlineMs: config.continuationDeadlineMs }),
              compose: (context) => (keeper as ContinuationKeeper).compose(context),
              // A close ended on purpose. Continuing would re-enter a harness told to stop.
              closed: () => mcp.isStopped() || session.state.progressStopReason !== undefined,
            },
          }
        : {}),
      onAttempt: (record) => recordManagerAttempt(loop, record),
      onBarrenPause: (pause) => recordScopeOwnerBarrenPause(loop.session.state.scope, pause),
    })
    driverFailed = false
  } catch (error) {
    parked = isRunParked(error, scope)
    throw error
  } finally {
    if (!parked) {
      await driveHarness.closeSeatSegment?.(
        scope.signal.aborted ? 'cancelled' : driverFailed ? 'failed' : 'completed',
      )
      if (!loop.reported) reportManagerLoop(loop)
    }
  }
  return loop.candidate
}

/** Root-only. A nested manager keeps its stops. One steer ends one pause and stays queued. */
function rootStopPause(
  config: ExternalManagerConfig,
  session: ManagerSession,
): { stopPause?: DriverStopPause } {
  if (config.deps.pauseRootStops !== true) return {}
  const { controls } = session
  const { nextTurnInbox } = session.state
  // Steers that already ended a pause: lead sequences, and the inbox count a drive then consumes.
  let answeredLead = new Set<number>()
  let answeredInbox = 0
  const unanswered = (): boolean =>
    controls.queuedLeadMessages().some((seq) => !answeredLead.has(seq)) ||
    nextTurnInbox.pendingAuthority() > answeredInbox
  return {
    stopPause: {
      steered: async (signal) => {
        answeredInbox = Math.min(answeredInbox, nextTurnInbox.pendingAuthority())
        if (!unanswered()) {
          const listening = new AbortController()
          const until = AbortSignal.any([signal, listening.signal])
          try {
            await Promise.race([
              controls.awaitLeadMessage(until),
              (async () => {
                while (!until.aborted && !unanswered()) {
                  await Promise.race([nextTurnInbox.nextDelivery(), abortedSignal(until)])
                }
              })(),
            ])
          } finally {
            listening.abort()
          }
        }
        // A pause the timer or a cancel ended was ended by no steer, so none is marked answered.
        if (signal.aborted || !unanswered()) return
        answeredLead = new Set(controls.queuedLeadMessages())
        answeredInbox = nextTurnInbox.pendingAuthority()
      },
    },
  }
}

function abortedSignal(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

function createManagerKeeper(
  config: ExternalManagerConfig,
  session: ManagerSession,
  deliverable: NonNullable<SupervisorAgentDeps['deliverable']>,
  continuation: NonNullable<SupervisorAgentDeps['continuation']>,
): ContinuationKeeper {
  const { deps, runtimeToolNames } = config
  const { mcp, controls } = session
  const { scope, task } = session.state
  return createContinuationKeeper({
    policy: continuation,
    task,
    ...(deliverable.describe === undefined ? {} : { owed: deliverable.describe }),
    ...(deliverable.feedback === undefined ? {} : { feedback: deliverable.feedback }),
    ...(deliverable.sealed === true ? { sealed: true } : {}),
    reads: () => controls.checkReads(),
    workers: () => {
      const labels = new Map(
        ((scope as Partial<Scope<unknown>>).view?.nodes ?? []).map((node) => [node.id, node.label]),
      )
      return mcp
        .settled()
        .map((worker) => ({ id: worker.id, label: labels.get(worker.id) ?? worker.id }))
    },
    ...(deps.continuationDir === undefined ? {} : { dir: deps.continuationDir }),
    traces: () => {
      const rootStreamPath = deps.rootStreamPath
      return runTraceAnalysisStore({
        ...(rootStreamPath === undefined
          ? {}
          : {
              root: {
                id: scope.view.root,
                read: () => readRootStream(dirname(rootStreamPath)),
              },
            }),
        workers: mcp.settled(),
        blobs: deps.blobs,
      })
    },
    canReadMore: runtimeToolNames.includes('read_continuation'),
    canSubmitResult: runtimeToolNames.includes('submit_result'),
  })
}

function readManagerProgress(loop: ManagerTurnLoop): DriverProgressMark {
  const { mcp, controls } = loop.session
  const { scope } = loop.session.state
  const settled = mcp.settled()
  // Child delivery is progress, but its check may cover only the child's assignment.
  const deliveredCount = settled.filter((w) => w.status === 'done' && w.valid === true).length
  const submitted = Boolean(mcp.submittedResult())
  const composite = bestComposite(controls.checkReads())
  return {
    poolTokensSpent:
      scope.budget.tokensCapped === false
        ? (scope.budget.committedTokens ?? 0)
        : loop.baseTokensLeft - scope.budget.tokensLeft,
    settledCount: settled.length,
    submitted,
    deliveredCount,
    contract: !loop.contractDeclared
      ? 'none'
      : submitted || loop.candidate !== undefined
        ? 'met'
        : 'unmet',
    ...(composite === undefined ? {} : { composite }),
  }
}

/** A check already read this turn stands. A check that could not run is not a verdict. */
async function readCheckAtTurnEnd(loop: ManagerTurnLoop, attempt: number): Promise<void> {
  const deliverable = loop.config.deps.deliverable
  const { controls } = loop.session
  if (deliverable === undefined) return
  const thisTurn = controls.checkReads().filter((read) => read.attempt === attempt)
  const last = thisTurn.at(-1)
  if (last === undefined && deliverable.checkState !== undefined) {
    try {
      const verdict = checkVerdictOf(await deliverable.checkState())
      controls.recordCheckRead({ source: 'turn-end', verdict })
      return
    } catch (error) {
      const message = errorMessage(error)
      controls.recordCheckRead({ source: 'turn-end', unavailable: message })
      throw new CheckUnavailableError(`the completion check could not run: ${message}`, {
        cause: error,
      })
    }
  }
  if (last?.unavailable !== undefined) {
    throw new CheckUnavailableError(`the completion check could not run: ${last.unavailable}`)
  }
}

function reportManagerLoop(loop: ManagerTurnLoop): void {
  loop.reported = true
  const { mcp, controls, state } = loop.session
  const stopped = state.stopController.signal.reason
  const stopReason =
    controls.stopReason() ??
    state.progressStopReason ??
    (typeof stopped === 'string' ? stopped : undefined)
  const closedBy: DriverContinuationRecord['closedBy'] = mcp.submittedResult()
    ? 'result-accepted'
    : mcp.isStopped()
      ? 'stop'
      : state.progressStopReason !== undefined
        ? 'stop-rule'
        : undefined
  const blocked = controls.blocked()
  loop.config.deps.onDriverLoopSettled?.({
    ...summarizeDriverAttempts(loop.records),
    environmentReplacements: loop.environmentReplacements,
    workspaceRestores: loop.workspaceRestores,
    ...(closedBy === undefined ? {} : { closedBy }),
    ...(blocked.length === 0 ? {} : { blocked }),
    ...(stopReason === undefined ? {} : { stopReason }),
    continuations: state.keeper?.entries() ?? [],
  })
}

/** One drive of the manager's harness: begin the attempt, invoke the harness, judge the turn. */
async function driveManagerTurn(
  loop: ManagerTurnLoop,
  attempt: number,
  reentry: DriverReentry | undefined,
): Promise<void> {
  const { deps, runtimeToolNames } = loop.config
  const { mcp, controls, state } = loop.session
  const { scope, task } = state
  const owner = owners.get(scope)
  if (owner)
    owner.replaceDeadExecution =
      reentry?.reason === 'driver-failure' && harnessProcessDied(reentry.failure)
  loop.candidate = undefined
  if (deps.controlDir !== undefined && deps.abortRun !== undefined) {
    applyRunCancellation(deps.controlDir, deps.abortRun, () => new Date().toISOString())
  }
  scope.signal.throwIfAborted()
  beginScopeOwnerAttempt(scope, attempt)
  controls.beginDriverAttempt(attempt)
  // A re-entry gets the original task unless the harness proves the same session.
  const turn: { current: DriverReentry | undefined } = { current: reentry }
  const held = loop.pendingWake?.attempt === attempt ? loop.pendingWake : undefined
  loop.pendingWake = undefined
  const refresh =
    held === undefined || turn.current?.reason !== 'wake'
      ? undefined
      : () => refreshWakeInput(loop, attempt, held, turn)
  // A fresh session composes the full re-entry task, whatever the harness claims.
  const session = loop.continuationSession
  const describe = loop.describe
  const compose =
    turn.current === undefined
      ? undefined
      : (continuity: ReentryContinuity) =>
          composeReentryTask({
            originalTask: task,
            tools: runtimeToolNames,
            ...(describe === undefined ? {} : { contract: describe }),
            reentry: turn.current!,
            continuity: session === 'fresh' ? { ...continuity, session: 'new' } : continuity,
            state: controls.reentryState(),
            attempt,
          })
  const carried = state.nextTurnInbox.take()
  const carriedText =
    carried.messages.length === 0 ? undefined : state.nextTurnInbox.fold(carried.messages)
  const withCarried = (input: unknown): string | unknown =>
    carriedText === undefined
      ? input
      : `${typeof input === 'string' ? input : (JSON.stringify(input) ?? String(input))}\n\n${carriedText}`
  // Composed inside the harness try, so a throw still releases the carried lease.
  await invokeManagerHarness(loop, attempt, carried, () => ({
    task: withCarried(compose === undefined ? task : compose(UNPROVEN_CONTINUITY)),
    ...(compose === undefined
      ? {}
      : {
          reentry: {
            reason: reentry!,
            compose: (continuity: ReentryContinuity) => withCarried(compose(continuity)) as string,
            ...(refresh === undefined ? {} : { refresh }),
            onContinuity: (continuity: ReentryContinuity) => {
              if (continuity.environment === 'replaced') loop.environmentReplacements += 1
              if (continuity.workspace === 'restored') loop.workspaceRestores += 1
            },
          },
        }),
  }))
  // Judge this parent before the retry loop reads progress. Open work is a wait, not a candidate.
  if (loop.contractDeclared && !mcp.submittedResult() && !controls.hasOpenWork()) {
    await mcp.drainResolved()
    loop.candidate = await loop.finalize()
    if (loop.candidate === undefined && !mcp.isStopped()) await readCheckAtTurnEnd(loop, attempt)
  }
}

/** No wait: publish what settled since the wake and take it for this turn. */
async function refreshWakeInput(
  loop: ManagerTurnLoop,
  attempt: number,
  held: NonNullable<ManagerTurnLoop['pendingWake']>,
  turn: { current: DriverReentry | undefined },
): Promise<void> {
  const { scope, stopController } = loop.session.state
  const signal = AbortSignal.any([scope.signal, stopController.signal])
  const later = await loop.session.controls.awaitWake({
    attempt,
    signal,
    heartbeatMs: 0,
    debounceMs: 0,
  })
  if (signal.aborted || turn.current?.reason !== 'wake') return
  turn.current = {
    ...turn.current,
    input: composeWakeInput(refreshedWake(held.wake, later, Date.now() - held.at), {
      tools: loop.config.runtimeToolNames,
      deadlineMs: scope.budget.deadlineMs,
      now: Date.now(),
    }),
  }
}

type HarnessTurnInput = Pick<
  Parameters<ExternalManagerConfig['driveHarness']>[0],
  'task' | 'reentry'
>

async function invokeManagerHarness(
  loop: ManagerTurnLoop,
  attempt: number,
  carried: InboxLease,
  input: () => HarnessTurnInput,
): Promise<void> {
  const { config, session } = loop
  const { driveHarness, deps } = config
  const { mcp, controls, state } = session
  const { scope } = state
  const continuationSession = loop.continuationSession
  state.harnessInvocationActive = true
  let completed = false
  try {
    if (driveHarness.withFileOutput) {
      if (!mcp.rotateManagerCredential)
        throw new Error('file output requires invocation-bound coordination credentials')
      await mcp.rotateManagerCredential()
    }
    await driveHarness({
      profile: loop.providerProfile,
      authoredProfile: config.profile,
      ...(config.registeredProfile === config.profile
        ? {}
        : { registeredProfile: config.registeredProfile }),
      ...(config.profilePrompt !== undefined ? { systemPrompt: config.profilePrompt } : {}),
      ...(continuationSession === undefined ? {} : { session: continuationSession }),
      ...input(),
      scope,
      coordinationMcpUrl: mcp.url,
      coordinationMcpHeaders: mcp.headers,
      coordinationCredentialExpiresAt: mcp.credentialExpiresAt,
      coordinationCredentialSigned: mcp.credentialSigned,
      coordinationBindCredential: mcp.bindCredential,
      ...(deps.peerMailUrl ? { peerMailUrl: deps.peerMailUrl } : {}),
      stopSignal: state.stopController.signal,
      coordinationTools: loop.coordinationTools,
      onModelEvent: () => {
        loop.modelEvents += 1
      },
    })
    completed = true
  } catch (error) {
    // Preserve an accepted result across a later backend shutdown failure.
    if (!mcp.submittedResult() && !mcp.isStopped()) throw error
    completed = true
  } finally {
    if (completed) {
      for (const message of carried.messages) {
        carried.commit(`${scope.view.root}#attempt-${attempt}`, message.id)
      }
    } else carried.release()
    state.harnessInvocationActive = false
    // Record the attempt before the retry decision reads the run.
    if (completed) await controls.endDriverAttempt('completed')
    else await controls.endDriverAttempt('failed').catch(() => undefined)
  }
}

async function wakeManager(
  loop: ManagerTurnLoop,
  nextAttempt: number,
): Promise<{ readonly input: string; readonly idleMs: number } | undefined> {
  const { config, session } = loop
  const { scope, stopController, nextTurnInbox } = session.state
  const deadlineMs = scope.budget.deadlineMs
  const warnAt = deadlineWarningAt(
    deadlineMs,
    config.wakePolicy,
    loop.deadlineWarned,
    loop.startedAt,
  )
  config.live.waitingOn = scope.view.nodes.filter(
    (node) => node.id !== scope.view.root && isLiveNodeStatus(node.status),
  ).length
  try {
    const wake = await session.controls.awaitWake({
      attempt: nextAttempt,
      quietWhileProgressing: true,
      signal: AbortSignal.any([scope.signal, stopController.signal]),
      heartbeatMs: config.wakePolicy.heartbeatMs,
      alsoWakeOn: nextTurnInbox.pending() > 0 ? Promise.resolve() : nextTurnInbox.nextDelivery(),
      debounceMs: config.wakePolicy.debounceMs,
      ...(warnAt === undefined ? {} : { deadlineAt: warnAt }),
    })
    if (wake === undefined || stopController.signal.aborted) return undefined
    if (wake.reason === 'deadline') loop.deadlineWarned = true
    loop.pendingWake = { attempt: nextAttempt, wake, at: Date.now() }
    return {
      input: composeWakeInput(wake, {
        tools: config.runtimeToolNames,
        deadlineMs,
        now: Date.now(),
      }),
      idleMs: wake.idleMs,
    }
  } finally {
    config.live.waitingOn = undefined
  }
}

async function recordManagerAttempt(
  loop: ManagerTurnLoop,
  record: DriverAttemptRecord,
): Promise<void> {
  const { scope } = loop.session.state
  loop.records.push(record)
  if (record.replacesStop !== undefined) loop.session.state.pausedOn = record.replacesStop
  // Report the ending record at once. A cancel must still say how the loop ended.
  if (record.stop !== undefined) reportManagerLoop(loop)
  await recordScopeOwnerDriverAttempt(scope, record)
  // The journal records an upstream pause and a stop-pause. The observer still sees each attempt.
  if (
    record.replacesStop !== undefined &&
    record.retryInMs !== undefined &&
    record.stopPauseStreak !== undefined &&
    record.resumeAt !== undefined
  ) {
    await recordScopeOwnerPause(scope, {
      attempt: record.attempt,
      signal: record.replacesStop,
      cause: record.error ?? record.replacesStop,
      attemptMs: record.durationMs,
      pauseMs: record.retryInMs,
      madeProgress: record.madeProgress,
      replacesStop: record.replacesStop,
      streak: record.stopPauseStreak,
      resumeAt: record.resumeAt,
    })
  } else if (record.classification === 'unavailable' && record.retryInMs !== undefined) {
    await recordScopeOwnerPause(scope, {
      attempt: record.attempt,
      signal: record.unavailableSignal ?? 'unavailable',
      cause: record.error ?? '',
      attemptMs: record.durationMs,
      pauseMs: record.retryInMs,
      madeProgress: record.madeProgress,
    })
  }
  await loop.config.deps.onDriverAttempt?.(record)
}
