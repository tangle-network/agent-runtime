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
import { type DriverProgressMark, type DriverReentry, runDriverWithRetry } from './driver-retry'
import { bestDelivered, runFinalizer, runTree } from './finalizer'
import type { InboxLease } from './inbox'
import { isLiveNodeStatus } from './node-status'
import { composeReentryTask, type ReentryContinuity, UNPROVEN_CONTINUITY } from './reentry'
import { abandonScopeRetainedOwnerInvocation } from './retained-scope-owner'
import { readRootStream } from './root-stream'
import { applyRunCancellation } from './run-cancellation'
import { runTraceAnalysisStore } from './run-traces'
import {
  beginScopeOwnerAttempt,
  recordScopeOwnerDriverAttempt,
  recordScopeOwnerPause,
} from './scope'
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
}

/** The turn loop's own record of what its drives did, read when the loop settles. */
interface ManagerTurnLoop extends ManagerTurnInputs {
  /** `tokensLeft` only falls, so the difference from this first reading is everything this run has
   *  spent from the shared pool — the driver's own turns and any child's. */
  readonly baseTokensLeft: number
  readonly startedAt: number
  readonly describe: string | undefined
  readonly continuationSession:
    | NonNullable<SupervisorAgentDeps['continuation']>['session']
    | undefined
  readonly records: DriverAttemptRecord[]
  candidate: unknown
  deadlineWarned: boolean
  /** The wake a re-entered drive was given, kept so `refresh` can bring it up to date. */
  pendingWake:
    | { readonly attempt: number; readonly wake: ManagerWake; readonly at: number }
    | undefined
  environmentReplacements: number
  workspaceRestores: number
  modelEvents: number
}

/** The finalizer over this act's settled workers; the check it runs is recorded as a check read. */
export function managerFinalizer(
  deps: SupervisorAgentDeps,
  session: ManagerSession,
): () => Promise<unknown> {
  const { mcp, controls } = session
  const { scope } = session.state
  // The finalizer's check of the best delivered child is a check read like any other: the
  // continuation note reports what the check said about the candidate the run would return.
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

/**
 * Drive the manager's harness until its retry loop ends, and report the loop. Returns the checked
 * candidate a turn that ended with the contract declared and no work open selected.
 */
export async function driveManagerTurns(inputs: ManagerTurnInputs): Promise<unknown> {
  const { config, session } = inputs
  const { deps, driveHarness } = config
  const { scope } = session.state
  // The retry's progress mark. Spend and settlements are the BURN rate, not the goal, so they are
  // reported beside the contract's verdict and the retry policy reads them together: with a
  // declared check unmet, spend and settlements alone do not buy another attempt.
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
  }
  const { mcp } = session
  const keeper = session.state.keeper
  // A run this process took over after the process driving it stopped: its first drive names the
  // workers that were open, and which of them this process re-places.
  const reenteredWorkers = scope.resume?.reentered
  const reentered =
    reenteredWorkers === undefined
      ? undefined
      : {
          first: { reason: 'run-reentered' as const, ...reenteredWorkers },
          modelEvents: () => loop.modelEvents,
        }
  let driverFailed = true
  try {
    await runDriverWithRetry({
      ...(reentered === undefined ? {} : { reentered }),
      drive: (attempt, reentry) => driveManagerTurn(loop, attempt, reentry),
      progress: () => readManagerProgress(loop),
      budget: () => scope.budget,
      signal: scope.signal,
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
      ...(continuation !== undefined && keeper !== undefined && config.continuationDeadlineMs
        ? {
            continuation: {
              maxBarren: continuation.maxBarren,
              deadlineMs: config.continuationDeadlineMs,
              compose: (context) => (keeper as ContinuationKeeper).compose(context),
              // A run the coordination server closed ended on purpose — the manager's own
              // `stop` (served only without a check), or a progress stop rule that aborted
              // the stop signal. A continuation would re-enter a harness told to stop.
              closed: () => mcp.isStopped() || session.state.progressStopReason !== undefined,
            },
          }
        : {}),
      onAttempt: (record) => recordManagerAttempt(loop, record),
    })
    driverFailed = false
  } finally {
    await driveHarness.closeSeatSegment?.(
      scope.signal.aborted ? 'cancelled' : driverFailed ? 'failed' : 'completed',
    )
    reportManagerLoop(loop)
  }
  return loop.candidate
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
    poolTokensSpent: loop.baseTokensLeft - scope.budget.tokensLeft,
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

/**
 * The check runs when a turn ends without an accepted result. A read already taken in this turn
 * stands (the manager just heard it); otherwise a check that judges state reads the run now. A
 * check that could not run is not a verdict: the loop pauses.
 */
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
  const { mcp, controls, state } = loop.session
  const stopReason = controls.stopReason() ?? state.progressStopReason
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
  loop.candidate = undefined
  if (deps.controlDir !== undefined && deps.abortRun !== undefined) {
    applyRunCancellation(deps.controlDir, deps.abortRun, () => new Date().toISOString())
  }
  scope.signal.throwIfAborted()
  // Every drive after the first is a new execution attempt of the root.
  beginScopeOwnerAttempt(scope, attempt)
  controls.beginDriverAttempt(attempt)
  // A re-entered drive receives the original objective and the coordinator's run state unless
  // the harness proves the turn continues the same session. The unmet items alone are the whole
  // turn only then: a replacement sandbox knows nothing else.
  const turn: { current: DriverReentry | undefined } = { current: reentry }
  const held = loop.pendingWake?.attempt === attempt ? loop.pendingWake : undefined
  loop.pendingWake = undefined
  const refresh =
    held === undefined || turn.current?.reason !== 'wake'
      ? undefined
      : () => refreshWakeInput(loop, attempt, held, turn)
  // A fresh session holds no earlier turn, so whatever a harness claims about the session, the
  // task it composes is the full re-entry task.
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
  await invokeManagerHarness(loop, attempt, carried, {
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
  })
  // Decide this parent's completion before the retry loop reads progress. Cache the checked
  // candidate so neither the finalizer nor its oracle runs twice on return. A turn that ended
  // with work open is a wait: the manager decides when it is done.
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
  input: HarnessTurnInput,
): Promise<void> {
  const { config, session } = loop
  const { driveHarness, deps } = config
  const { mcp, controls, state } = session
  const { scope } = state
  const continuationSession = loop.continuationSession
  state.harnessInvocationActive = true
  let completed = false
  try {
    await driveHarness({
      profile: loop.providerProfile,
      authoredProfile: config.profile,
      ...(config.registeredProfile === config.profile
        ? {}
        : { registeredProfile: config.registeredProfile }),
      ...(config.profilePrompt !== undefined ? { systemPrompt: config.profilePrompt } : {}),
      ...(continuationSession === undefined ? {} : { session: continuationSession }),
      ...input,
      scope,
      coordinationMcpUrl: mcp.url,
      coordinationMcpHeaders: mcp.headers,
      ...(deps.peerMailUrl ? { peerMailUrl: deps.peerMailUrl } : {}),
      stopSignal: state.stopController.signal,
      coordinationTools: loop.coordinationTools,
      onModelEvent: () => {
        loop.modelEvents += 1
      },
    })
    completed = true
  } catch (error) {
    // Once the injected check has accepted a result, a later backend shutdown/timeout cannot
    // erase that completed work — and there is nothing left to retry FOR. Without an accepted
    // submission the backend error propagates into the retry decision.
    if (!mcp.submittedResult() && !mcp.isStopped()) throw error
    completed = true
  } finally {
    // A completed invocation read what it carried; a failed one hands it to the next.
    if (completed) {
      for (const message of carried.messages) {
        carried.commit(`${scope.view.root}#attempt-${attempt}`, message.id)
      }
    } else carried.release()
    state.harnessInvocationActive = false
    // A completed turn processed what it received; a failed one leaves it for the next
    // re-entry to name. Recorded before the retry decision reads the run.
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
      // A stop (accepted result, stop rule, the manager's own stop) ends the wait too.
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
  await recordScopeOwnerDriverAttempt(scope, record)
  // A pause on an unavailable upstream is infrastructure time, so the run's own journal records
  // it; the caller's observer still sees every attempt.
  if (record.classification === 'unavailable' && record.retryInMs !== undefined) {
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
