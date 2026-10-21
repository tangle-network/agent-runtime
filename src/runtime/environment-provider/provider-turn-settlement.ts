import type { AgentCandidateWorkspaceSnapshotEvidence } from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { captureHarnessTranscript } from '../harness-transcript'
import type { SandboxOutcomeCarrier } from '../sandbox-outcome'
import { errorText } from '../supervise/error-message'
import { contentRef } from '../supervise/executor-outcome'
import { RetainedExecutionPendingError } from '../supervise/retained-executor'
import type { ExecutorResult, Spend, UsageEvent } from '../supervise/types'
import { unavailableSignalOfFailure } from '../supervise/upstream-unavailable'
import { failureStatusCode, resultFromEvents } from './provider-event-projection'
import type { ProviderLeafOut } from './provider-executor-admission'
import type { ProviderInvocationEnd, StreamProviderExecutorArgs } from './provider-invocation'
import { providerWorkspaceCaptureReceipt } from './provider-retention-lifecycle'
import { environmentAsSandboxInstance } from './provider-sandbox-adapter'
import type { ProviderTurnObserver } from './provider-turn-observer'
import type { ProviderUsageAccount } from './provider-usage-account'
import { ValidationError } from './provider-validation-error'

/** What the settled turn left behind and what the teardown must still decide about. */
export class ProviderTurnSettlement {
  /** The artifact this turn settled with, once it exists. Its presence is what separates "the work
   *  finished and the resource would not release" from "the work never finished". */
  private settled: ExecutorResult<unknown> | undefined
  /** The body's own failure, held so the teardown cannot REPLACE it. A `finally` that throws
   *  discards the in-flight exception, so a teardown error would otherwise mask the real cause of
   *  a turn that failed for its own reasons. */
  private failure: unknown
  private failed = false
  /** Set when the turn was refused for capacity and the caller will continue in this environment. */
  private unavailable: ProviderInvocationEnd['unavailable']
  /** Whether the turn's final session copy was already taken: a turn whose workspace capture the
   *  owner took over copies its session before it hands the capture over. */
  private finalCopyTaken = false
  // A deadline or a cancellation stops the harness once, before any capture of its session, so
  // the failure capture and the final copy read a session that has stopped changing.
  private harnessStop: Promise<void> | undefined

  constructor(
    private readonly args: StreamProviderExecutorArgs,
    private readonly environment: AgentEnvironment,
    private readonly retained: boolean,
    private readonly sessionId: string | null,
    private readonly observer: ProviderTurnObserver,
    private readonly usage: ProviderUsageAccount,
    private readonly started: number,
  ) {}

  /** Rethrow the turn's failure, or report how the invocation ended. */
  end(): ProviderInvocationEnd {
    if (this.failed) throw this.failure
    return {
      ...(this.unavailable === undefined ? {} : { unavailable: this.unavailable }),
      ...(this.settled === undefined ? {} : { spent: this.settled.spent }),
      madeProgress: this.usage.madeProgress,
      durationMs: Date.now() - this.started,
    }
  }

  /**
   * Whether this turn's owner takes its workspace capture over, so the turn ends without waiting
   * for it. The owner's environment outlives its turns; the owner awaits the capture before the
   * environment's next turn and before it destroys the environment, and the capture's receipt is
   * journaled as evidence of this invocation. Only a port that copies the session on its own
   * queue hands the capture over: without one, the workspace capture is the only record of the
   * session the node settles with.
   */
  private ownerTakesCapture(): boolean {
    const { args } = this
    return (
      args.options.workspaceRetention?.captureNative !== undefined &&
      args.createProfile.harness !== undefined &&
      this.retained &&
      args.retention?.preserveEnvironment === true &&
      args.retention.onEndOfTurnWork !== undefined
    )
  }

  private captureReceipt(snapshot: AgentCandidateWorkspaceSnapshotEvidence) {
    return providerWorkspaceCaptureReceipt(this.args, this.environment, snapshot, this.sessionId)
  }

  /** Hand the workspace capture to the owner. Its receipt reaches the journal as evidence of this
   *  invocation; a capture that fails leaves none, and the owner's release then keeps the source. */
  private handCaptureToOwner(
    reported: object,
    captureOutcome: AgentRunOutcome | undefined,
    publish: boolean,
    beforeCapture?: () => Promise<void>,
  ): void {
    const { args, environment } = this
    args.retention?.onEndOfTurnWork?.(
      (async () => {
        // The final native copy runs beside the workspace capture, which holds the session too and
        // replaces the copy as the transcript when it settles. Neither holds the completed turn
        // open; the retained owner waits for this work before reuse or release. On canary
        // test-acceptance-canary-20261019o (Runtime 0.332.2) the copy ran first, for 17.8 s, and the
        // workspace capture started 59-66 s after the turn's result. A native copy is best-effort
        // evidence: its failure leaves the workspace capture as the owner's retention boundary.
        const finalCopy = (async () => {
          try {
            await beforeCapture?.()
          } catch {
            // The workspace receipt remains the owner's retention boundary.
          }
        })()
        let snapshot: Awaited<ReturnType<typeof args.captureWorkspace>>
        try {
          snapshot = await args.captureWorkspace(environment, captureOutcome)
        } finally {
          await finalCopy
        }
        if (publish) args.onPublishedSnapshot(snapshot)
        if (snapshot === undefined) return
        await args.retention?.onEvidence?.({
          ...reported,
          workspaceSnapshot: snapshot,
          workspaceCapture: this.captureReceipt(snapshot),
        })
      })().catch(() => undefined),
    )
  }

  private stopEndedHarness(): Promise<void> {
    const { signal } = this.args
    if (this.settled !== undefined || !signal.aborted) return Promise.resolve()
    this.harnessStop ??= this.args.stopEndedHarness(signal)
    return this.harnessStop
  }

  /**
   * Retention captures once and exposes that verified archive through the transcript port.
   * Environments without retention keep the existing bounded live-read path.
   */
  private async readLiveTranscript(): Promise<void> {
    const { args } = this
    if (args.options.workspaceRetention !== undefined) return
    args.onHarnessTranscript(
      await captureHarnessTranscript(
        this.environment as Parameters<typeof captureHarnessTranscript>[0],
        args.profile.harness,
        args.signal,
      ),
    )
  }

  /** Settle the turn whose events were all read: spend, validator verdict, capture and journal. */
  async *settle(): AsyncGenerator<UsageEvent> {
    const { args, usage } = this
    yield* usage.settleTurn()
    yield* usage.settleUnpricedWork()
    if ((args.options.requireTerminalEvent ?? true) && !this.observer.terminal) {
      throw new ValidationError(
        `providerAsExecutor(${args.provider.name}): stream ended without a terminal result/done/status event`,
      )
    }
    // Continuations share one iteration; recovery restores it from the prior committed spend.
    if (args.carried === undefined) yield { kind: 'iteration' }
    await this.readLiveTranscript()
    const outcome = this.observer.failures.finish()
    const result: ProviderLeafOut & SandboxOutcomeCarrier = {
      ...resultFromEvents(this.observer.archive.events(), this.observer.text),
      ...(this.observer.archive.superseded > 0
        ? { supersededPartUpdates: this.observer.archive.superseded }
        : {}),
      ...(outcome ? { outcome } : {}),
    }
    const { executionSpent } = usage.spend(this.started)
    // Scored HERE, before the teardown destroys the environment: a validator that reads a file or
    // runs a command needs the environment it is scoring to still exist. Every other supervised
    // hook fires after teardown and can only read the artifact.
    const verdict = await args.options.validator?.validate(result, {
      iteration: 0,
      ...(args.node === undefined ? {} : { node: args.node }),
      box: environmentAsSandboxInstance(this.environment, {
        profile: args.profile,
        requireTerminalEvent: args.options.requireTerminalEvent ?? true,
      }),
      signal: args.signal,
    })
    // Every retained owner with a native copy commits its turn before the slow workspace capture.
    // The owner waits for that capture before its next turn or environment release, so a queued or
    // failed capture cannot hide a completed provider result from the caller. Discovery's contract
    // canary had both exact Sandbox executions complete while their results stayed unjournaled for
    // over 18 minutes behind capture (2026-10-14).
    const deferCapture = this.ownerTakesCapture()
    const { retainedWorkspace, workspaceCaptureFailure } = deferCapture
      ? {}
      : await this.captureSettledWorkspace(outcome)
    const settledResult: ProviderLeafOut & SandboxOutcomeCarrier = {
      ...result,
      ...(workspaceCaptureFailure === undefined ? {} : { workspaceCaptureFailure }),
      ...(retainedWorkspace === undefined
        ? {}
        : {
            workspaceSnapshot: retainedWorkspace,
            workspaceCapture: this.captureReceipt(retainedWorkspace),
          }),
    }
    const settled = this.settledArtifact(result, settledResult, verdict, executionSpent)
    this.settled = settled
    this.unavailable = this.refusalOf(result)
    if (this.retained) await args.retention?.onResult(settled)
    else if (retainedWorkspace !== undefined) await args.retention?.onEvidence?.(settledResult)
    args.onPending(false)
    args.onArtifact(settled)
    if (deferCapture) {
      // The session copy this turn settles with is taken first, on the native queue, which never
      // waits behind workspace captures; the workspace capture then reads a session that ended.
      // Both copies belong to the owner so neither delays delivery of this result to the caller.
      this.finalCopyTaken = true
      this.handCaptureToOwner(settledResult, outcome, true, () =>
        args.finishNativeMirror(this.environment, 'settled'),
      )
    }
  }

  /**
   * The turn has settled, so a capture that fails or exceeds its deadline is a fact about the
   * evidence, never the turn's outcome. Measured 2026-10-03 on Runtime 0.295.4: one capture that
   * waited past its 1,200,000 ms deadline behind a two-slot queue shared by 34 workers threw an
   * AbortError, the driver classified it terminal, and two research roots ended with 13 and 0 of
   * their children settled. The source stays preserved because no receipt exists, the retained
   * owner reads the receipt-less result as a retention failure, and the turn is not re-run.
   */
  private async captureSettledWorkspace(outcome: AgentRunOutcome | undefined): Promise<{
    retainedWorkspace?: AgentCandidateWorkspaceSnapshotEvidence
    workspaceCaptureFailure?: string
  }> {
    let retainedWorkspace: AgentCandidateWorkspaceSnapshotEvidence | undefined
    let workspaceCaptureFailure: string | undefined
    try {
      retainedWorkspace = await this.args.captureWorkspace(this.environment, outcome)
    } catch (error) {
      workspaceCaptureFailure = `${errorText(error instanceof Error ? error.message : error)}; source environment preserved`
    }
    this.args.onPublishedSnapshot(retainedWorkspace)
    return { retainedWorkspace, workspaceCaptureFailure }
  }

  private settledArtifact(
    result: ProviderLeafOut & SandboxOutcomeCarrier,
    settledResult: ProviderLeafOut & SandboxOutcomeCarrier,
    verdict: ExecutorResult<unknown>['verdict'],
    spent: Spend,
  ): ExecutorResult<unknown> {
    return {
      ...(result.outcome?.status === 'failed'
        ? {
            outcome: {
              success: false,
              ...(result.outcome.error ? { error: result.outcome.error } : {}),
              // The code, not the text, is what a retry policy may branch on.
              ...(result.outcome.errorCode ? { errorCode: result.outcome.errorCode } : {}),
              ...(failureStatusCode(result.outcome) === undefined
                ? {}
                : { statusCode: failureStatusCode(result.outcome) }),
            },
          }
        : {}),
      outRef: contentRef(`provider:${this.args.provider.name}`, settledResult),
      out: settledResult,
      ...(verdict ? { verdict } : {}),
      spent,
    }
  }

  /** A retained turn the upstream refused for capacity ends with its environment kept. */
  private refusalOf(result: ProviderLeafOut & SandboxOutcomeCarrier) {
    if (!this.args.mayContinue || !this.retained || result.outcome?.status !== 'failed') {
      return undefined
    }
    const signal = unavailableSignalOfFailure({
      error: result.outcome.error ?? '',
      ...(result.outcome.errorCode ? { errorCode: result.outcome.errorCode } : {}),
      ...(failureStatusCode(result.outcome) === undefined
        ? {}
        : { statusCode: failureStatusCode(result.outcome) }),
    })
    return signal === undefined
      ? undefined
      : { signal, cause: errorText(result.outcome.error ?? '') }
  }

  /** Record the turn's failure, then capture what evidence its environment still holds. */
  async *fail(error: unknown): AsyncGenerator<UsageEvent> {
    const { args, environment } = this
    // A limit or transport stop may omit the terminal aggregate. Credit completed native
    // response receipts before the failed attempt is journaled, without replaying the turn.
    yield* this.usage.settleTurn()
    this.failure = this.retained ? new RetainedExecutionPendingError(error) : error
    this.failed = true
    // A failed or cancelled stream has no ProviderLeafOut for the caller to retrieve. Keep the
    // live source even when capture succeeds, so its executable state remains the receipt boundary.
    if (args.options.workspaceRetention !== undefined) args.onUnsettledFailure()
    const failureOutcome =
      this.observer.failures.finish() ??
      ({
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        ...(args.signal.aborted ? { errorCode: 'cancelled' } : {}),
      } satisfies AgentRunOutcome)
    await this.stopEndedHarness()
    // The scope settles an aborted node as soon as the abort reaches it and reads the transcript
    // this executor holds then. The stopped harness's final session copy is taken here, before the
    // capture of the whole workspace, which can run for minutes; the 2026-10-04 trace proof
    // settled a deadline node with its last running copy, `native_snapshot_live`.
    if (args.signal.aborted) await args.finishNativeMirror(environment, 'failed')
    args.onTranscriptSettled()
    if (this.ownerTakesCapture()) {
      // The owner takes this failed turn's capture over too, so the drive ends now and the
      // owner's release reads the capture's receipt before it decides what to destroy.
      if (!args.signal.aborted) await args.finishNativeMirror(environment, 'failed')
      this.finalCopyTaken = true
      this.handCaptureToOwner(
        {
          ...resultFromEvents(this.observer.archive.events(), this.observer.text),
          outcome: failureOutcome,
        },
        failureOutcome,
        false,
      )
    } else {
      await this.captureFailedTurn(error, failureOutcome)
    }
    await this.readLiveTranscript()
  }

  private async captureFailedTurn(error: unknown, failureOutcome: AgentRunOutcome): Promise<void> {
    const { args } = this
    try {
      const retainedWorkspace = await args.captureWorkspace(this.environment, failureOutcome)
      if (retainedWorkspace !== undefined && args.retention?.onEvidence !== undefined) {
        await args.retention.onEvidence({
          ...resultFromEvents(this.observer.archive.events(), this.observer.text),
          outcome: failureOutcome,
          workspaceSnapshot: retainedWorkspace,
          workspaceCapture: this.captureReceipt(retainedWorkspace),
        })
      }
    } catch (captureError) {
      // Preserve the stream failure alongside capture's own cause. A persistence error can
      // be shared with the supervisor, so never replace its cause or make it refer to itself
      // when capture was also the original failure.
      if (captureError instanceof Error && captureError !== error) {
        this.failure =
          captureError.cause === undefined
            ? Object.assign(captureError, { cause: this.failure })
            : new AggregateError([captureError, this.failure], captureError.message, {
                cause: captureError,
              })
      } else {
        this.failure = captureError
      }
    }
  }

  /** Runs on every way the turn ends: the last session copy, then the environment's fate. */
  async release(): Promise<void> {
    const { args } = this
    await this.stopEndedHarness()
    // Before any teardown: the final copy reads the session from the live environment. This is
    // the only capture that runs when the stream was closed by an abort or a deadline.
    if (!this.finalCopyTaken) {
      await args.finishNativeMirror(
        this.environment,
        this.failed ? 'failed' : this.settled !== undefined ? 'settled' : 'interrupted',
      )
    }
    // A keyed turn that ended over its budget keeps its environment, so a re-spawn of its key
    // with more budget runs the next turn in this same environment and harness session.
    const held =
      this.retained &&
      this.settled !== undefined &&
      !this.failed &&
      this.unavailable === undefined &&
      args.retention?.preserveEnvironment !== true &&
      args.retention?.holdOnSettle?.(this.settled.spent) === true
    if (held) args.onHeld()
    if (
      (!this.retained || (this.settled !== undefined && !this.failed)) &&
      !(this.retained && args.retention?.preserveEnvironment) &&
      // A refused turn keeps its environment: the executor continues in it.
      !(this.unavailable !== undefined && !this.failed) &&
      !held &&
      (args.options.destroyOnSettle ?? true)
    ) {
      await this.destroyEnvironment()
    }
  }

  private async destroyEnvironment(): Promise<void> {
    const cleanup = await this.args.destroyEnvironment()
    if (cleanup.destroyed) return
    const error = new Error(cleanup.detail ?? 'provider environment teardown was not confirmed')
    // ONCE THE TURN HAS SETTLED, TEARDOWN CANNOT CHANGE THE OUTCOME. Measured: a second DELETE
    // answered 409, the rejection escaped this `finally`, and a run whose turn had completed
    // (`spent.iterations: 1`, artifact produced) was reported as a failure. The resource fact is
    // recorded beside the result; the result stands.
    //
    // Before the turn settles there is no outcome to protect, so the failure IS the outcome and
    // is rethrown — a create-then-fail-then-leak path must still fail loudly.
    if (this.settled !== undefined) {
      this.args.onArtifact({
        ...this.settled,
        teardown: { failed: true, error: error.message, at: new Date().toISOString() },
      })
    } else if (!this.failed) {
      // Nothing settled and the body did not fail on its own: the teardown failure IS the
      // outcome, so a create-then-leak path still fails loudly.
      this.failure = error
      this.failed = true
    } else {
      // The body already failed. ITS error is the cause a reader needs; the teardown failure
      // rides along as `cause` rather than displacing it.
      this.failure =
        this.failure instanceof Error
          ? Object.assign(this.failure, { cause: this.failure.cause ?? error })
          : this.failure
    }
  }
}
