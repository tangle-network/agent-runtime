import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { captureHarnessTranscript } from '../harness-transcript'
import { retainedSessionReplaced } from '../retained-run-binding'
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
  // A deadline or cancellation stops the harness once, before any session capture reads it.
  private harnessStop: Promise<void> | undefined

  constructor(
    private readonly args: StreamProviderExecutorArgs,
    private readonly environment: AgentEnvironment,
    private readonly retained: boolean,
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

  private stopEndedHarness(): Promise<void> {
    const { signal } = this.args
    if (this.settled !== undefined || !signal.aborted) return Promise.resolve()
    this.harnessStop ??= this.args.scope.nativeControl.stopEndedHarness(signal)
    return this.harnessStop
  }

  /** Read the provider transcript while its environment is still available. */
  private async readLiveTranscript(): Promise<void> {
    const { args } = this
    args.scope.state.harnessTranscript = await captureHarnessTranscript(
      this.environment as Parameters<typeof captureHarnessTranscript>[0],
      args.profile.harness,
      args.signal,
    )
  }

  /** Commit the consumed turn, validator verdict and measured spend. */
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
    const settledResult = result
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
            ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
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
        this.unavailable = {
          signal,
          cause: errorText(nativeFailure.error ?? ''),
          ...(nativeFailure.failure ? { failure: nativeFailure.failure } : {}),
        }
    }
    if (this.retained) await args.retention?.onResult(settled)
    args.scope.state.pending = false
    args.scope.state.artifact = settled
  }

  /** Record the turn's failure, then capture what evidence its environment still holds. */
  async *fail(error: unknown): AsyncGenerator<UsageEvent> {
    const { args } = this
    // A limit or transport stop may omit the terminal aggregate: credit completed native receipts.
    yield* this.usage.settleTurn()
    this.failure =
      this.retained && !retainedSessionReplaced(error)
        ? new RetainedExecutionPendingError(error)
        : error
    this.failed = true
    await this.stopEndedHarness()
    args.scope.state.settleTranscript()
    await this.readLiveTranscript()
  }

  /** Stop the harness when required, then settle its environment's custody. */
  async release(): Promise<void> {
    const { args } = this
    await this.stopEndedHarness()
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
