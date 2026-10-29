import type { AgentCandidateWorkspaceSnapshotEvidence } from '@tangle-network/agent-interface'
import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { captureHarnessTranscript } from '../harness-transcript'
import type { SandboxOutcomeCarrier } from '../sandbox-outcome'
import { errorText } from '../supervise/error-message'
import { contentRef } from '../supervise/executor-outcome'
import { RetainedExecutionPendingError } from '../supervise/retained-executor'
import type { ExecutorResult, UsageEvent } from '../supervise/types'
import { unavailableSignalOfFailure } from '../supervise/upstream-unavailable'
import { destroyExecutorEnvironment } from './provider-environment-teardown'
import {
  failureStatusCode,
  jsonResultFromEvents,
  resultFromEvents,
} from './provider-event-projection'
import type { ProviderLeafOut } from './provider-executor-admission'
import type { ProviderInvocationEnd, StreamProviderExecutorArgs } from './provider-invocation'
import { providerWorkspaceCaptureReceipt } from './provider-retention-lifecycle'
import { environmentAsSandboxInstance } from './provider-sandbox-adapter'
import type { ProviderTurnObserver } from './provider-turn-observer'
import type { ProviderUsageAccount } from './provider-usage-account'
import { ValidationError } from './provider-validation-error'

/** What the settled turn left behind and what the teardown must still decide about. */
export class ProviderTurnSettlement {
  /** The artifact this turn settled with. Its presence separates "the work finished and the
   *  resource would not release" from "the work never finished". */
  private settled: ExecutorResult<unknown> | undefined
  /** The body's own failure, held so a throwing teardown `finally` cannot mask it. */
  private failure: unknown
  private failed = false
  /** Set when the turn was refused for capacity and the caller will continue in this environment. */
  private unavailable: ProviderInvocationEnd['unavailable']
  /** Whether the final session copy was taken before the workspace capture was handed to the owner. */
  private finalCopyTaken = false
  // A deadline or cancellation stops the harness once, before any session capture reads it.
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
   * for it: the owner awaits it before the environment's next turn and before destroying the
   * environment, and journals its receipt. Only a port that copies the session on its own queue
   * hands it over; without one the capture is the only record of the session.
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
    settled: boolean,
  ): void {
    const { args, environment } = this
    this.finalCopyTaken = true
    args.retention?.onEndOfTurnWork?.(
      (async () => {
        // The final native copy runs beside the workspace capture, which replaces it as the
        // transcript when it settles; the retained owner waits for both. Run in sequence on canary
        // test-acceptance-canary-20261019o (Runtime 0.332.2), the copy took 17.8 s and the capture
        // started 59-66 s after the result. A failed copy leaves the capture as the retention boundary.
        const copy = settled
          ? args.scope.mirrors.finishNativeMirror(environment, 'settled').catch(() => undefined)
          : Promise.resolve()
        let snapshot: Awaited<ReturnType<typeof args.captureWorkspace>>
        try {
          snapshot = await args.captureWorkspace(environment, captureOutcome)
        } finally {
          await copy
        }
        if (settled) args.onPublishedSnapshot(snapshot)
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
    this.harnessStop ??= this.args.scope.nativeControl.stopEndedHarness(signal)
    return this.harnessStop
  }

  /** Retention captures once and exposes that archive through the transcript port; otherwise read live. */
  private async readLiveTranscript(): Promise<void> {
    const { args } = this
    if (args.options.workspaceRetention !== undefined) return
    args.scope.state.harnessTranscript = await captureHarnessTranscript(
      this.environment as Parameters<typeof captureHarnessTranscript>[0],
      args.profile.harness,
      args.signal,
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
    const executionSpent = usage.spend(this.started)
    // Scored HERE, before teardown: a validator that reads a file or runs a command needs the
    // environment alive. Every other supervised hook fires after teardown.
    const verdict = await args.options.validator?.validate(result, {
      iteration: 0,
      ...(args.node === undefined ? {} : { node: args.node }),
      box: environmentAsSandboxInstance(this.environment, {
        profile: args.profile,
        requireTerminalEvent: args.options.requireTerminalEvent ?? true,
      }),
      signal: args.signal,
    })
    // A retained owner with a native copy commits its turn before the slow workspace capture, so a
    // queued or failed capture cannot hide a completed result: Discovery's contract canary left two
    // finished Sandbox executions unjournaled for over 18 minutes behind capture.
    const deferCapture = this.ownerTakesCapture()
    /**
     * A capture that fails or exceeds its deadline after settlement is a fact about the evidence,
     * never the turn's outcome. On Runtime 0.295.4 a capture past its 1,200,000 ms
     * deadline behind a two-slot queue shared by 34 workers threw an AbortError, the driver
     * classified it terminal, and two research roots ended with 13 and 0 children settled. With no
     * receipt the source stays preserved and the owner reads a retention failure; the turn is not re-run.
     */
    let retainedWorkspace: AgentCandidateWorkspaceSnapshotEvidence | undefined
    let workspaceCaptureFailure: string | undefined
    if (!deferCapture) {
      try {
        retainedWorkspace = await args.captureWorkspace(this.environment, outcome)
      } catch (error) {
        workspaceCaptureFailure = `${errorText(error instanceof Error ? error.message : error)}; source environment preserved`
      }
      args.onPublishedSnapshot(retainedWorkspace)
    }
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
    const jsonOutput = args.options.outputFormat === 'json'
    if (jsonOutput) await args.retention?.onEvidence?.(settledResult)
    const output =
      jsonOutput && outcome?.status !== 'failed'
        ? jsonResultFromEvents(result.events)
        : { out: settledResult }
    const statusCode = failureStatusCode(outcome)
    const nativeFailure =
      outcome?.status === 'failed'
        ? {
            success: false,
            ...(outcome.error ? { error: outcome.error } : {}),
            ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
            ...(statusCode === undefined ? {} : { statusCode }),
          }
        : undefined
    const settled: ExecutorResult<unknown> = {
      ...(jsonOutput ? { outputFormat: 'json' } : {}),
      ...(nativeFailure ? { outcome: nativeFailure } : {}),
      ...output,
      outRef: contentRef(`provider:${args.provider.name}`, output.out),
      ...(verdict ? { verdict } : {}),
      spent: executionSpent,
    }
    this.settled = settled
    if (args.mayContinue && this.retained && nativeFailure) {
      const signal = unavailableSignalOfFailure({
        ...nativeFailure,
        error: nativeFailure.error ?? '',
      })
      if (signal !== undefined)
        this.unavailable = { signal, cause: errorText(nativeFailure.error ?? '') }
    }
    if (this.retained) await args.retention?.onResult(settled)
    else if (retainedWorkspace !== undefined && !jsonOutput)
      await args.retention?.onEvidence?.(settledResult)
    args.scope.state.pending = false
    args.scope.state.artifact = settled
    if (deferCapture) {
      // The session copy is taken first on the native queue, which never waits behind workspace
      // captures; the capture then reads an ended session. The owner holds both.
      this.handCaptureToOwner(settledResult, outcome, true)
    }
  }

  /** Record the turn's failure, then capture what evidence its environment still holds. */
  async *fail(error: unknown): AsyncGenerator<UsageEvent> {
    const { args, environment } = this
    // A limit or transport stop may omit the terminal aggregate: credit completed native receipts.
    yield* this.usage.settleTurn()
    this.failure = this.retained ? new RetainedExecutionPendingError(error) : error
    this.failed = true
    // A failed stream has no ProviderLeafOut to retrieve: keep the live source even when capture
    // succeeds, so its executable state remains the receipt boundary.
    if (args.options.workspaceRetention !== undefined) {
      args.scope.state.workspacePreservationRequired = true
    }
    const failureOutcome =
      this.observer.failures.finish() ??
      ({
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        ...(args.signal.aborted ? { errorCode: 'cancelled' } : {}),
      } satisfies AgentRunOutcome)
    await this.stopEndedHarness()
    // The scope settles an aborted node at once and reads the transcript held then, so the stopped
    // harness's final session copy is taken before the minutes-long workspace capture (the
    // 2026-10-04 trace proof settled a deadline node with `native_snapshot_live`).
    if (args.signal.aborted) await args.scope.mirrors.finishNativeMirror(environment, 'failed')
    args.scope.state.settleTranscript()
    if (this.ownerTakesCapture()) {
      // The owner takes this failed turn's capture over too, so the drive ends now and the
      // owner's release reads the capture's receipt before it decides what to destroy.
      if (!args.signal.aborted) await args.scope.mirrors.finishNativeMirror(environment, 'failed')
      this.handCaptureToOwner(
        {
          ...resultFromEvents(this.observer.archive.events(), this.observer.text),
          outcome: failureOutcome,
        },
        failureOutcome,
        false,
      )
    } else {
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
        // Keep the stream failure beside capture's cause; a shared persistence error must not be
        // replaced or made to refer to itself when capture was the original failure.
        if (!(captureError instanceof Error) || captureError === error) {
          this.failure = captureError
        } else if (captureError.cause === undefined) {
          this.failure = Object.assign(captureError, { cause: this.failure })
        } else {
          this.failure = new AggregateError([captureError, this.failure], captureError.message, {
            cause: captureError,
          })
        }
      }
    }
    await this.readLiveTranscript()
  }

  /** Runs on every way the turn ends: the last session copy, then the environment's fate. */
  async release(): Promise<void> {
    const { args } = this
    await this.stopEndedHarness()
    // Before teardown: the final copy reads the live environment, and is the only capture that
    // runs when an abort or deadline closed the stream.
    if (!this.finalCopyTaken) {
      await args.scope.mirrors.finishNativeMirror(
        this.environment,
        this.failed ? 'failed' : this.settled !== undefined ? 'settled' : 'interrupted',
      )
    }
    // A keyed turn that ended over budget keeps its environment for a re-spawn with more budget.
    const held =
      this.retained &&
      this.settled !== undefined &&
      !this.failed &&
      this.unavailable === undefined &&
      args.retention?.preserveEnvironment !== true &&
      args.retention?.holdOnSettle?.(this.settled.spent) === true
    if (held) args.scope.state.holdingForContinuation = true
    if (
      (!this.retained || (this.settled !== undefined && !this.failed)) &&
      !(this.retained && args.retention?.preserveEnvironment) &&
      // A refused turn keeps its environment: the executor continues in it.
      !(this.unavailable !== undefined && !this.failed) &&
      !held &&
      (args.options.destroyOnSettle ?? true)
    ) {
      const cleanup = await destroyExecutorEnvironment(this.args.scope)
      if (cleanup.destroyed) return
      const error = new Error(cleanup.detail ?? 'provider environment teardown was not confirmed')
      // ONCE THE TURN HAS SETTLED, TEARDOWN CANNOT CHANGE THE OUTCOME: a second DELETE answered 409,
      // the rejection escaped this `finally`, and a completed run was reported as a failure. The
      // resource fact is recorded beside the result; the result stands.
      if (this.settled !== undefined) {
        this.args.scope.state.artifact = {
          ...this.settled,
          teardown: { failed: true, error: error.message, at: new Date().toISOString() },
        }
      } else if (!this.failed) {
        // Nothing settled and the body did not fail: the teardown failure IS the outcome, so a
        // create-then-leak path still fails loudly.
        this.failure = error
        this.failed = true
      } else if (this.failure instanceof Error) {
        // The body already failed: its error stays the cause; the teardown failure rides as `cause`.
        Object.assign(this.failure, { cause: this.failure.cause ?? error })
      }
    }
  }
}
