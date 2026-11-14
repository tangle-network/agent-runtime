import type { AgentExactRunControlRef, AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { type HarnessTranscriptCapture, harnessTranscriptUnavailable } from '../harness-transcript'
import type { RetainedRunHandle } from '../retained-run-types'
import { RunCancellationReason } from '../supervise/abortable'
import type { TeardownAnswer } from '../supervise/deadline'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type { createPushTraceSource } from '../supervise/trace-source'
import type {
  EnvironmentTeardownReceipt,
  Executor,
  ExecutorContext,
  ExecutorNodeContext,
  ExecutorResult,
} from '../supervise/types'
import type { ProviderExecutorOptions } from './provider-executor-admission'
import type { providerMaterialization } from './provider-materialization'
import type { createProviderNativeControl } from './provider-retention-lifecycle'

/** Everything one provider executor knows about its environment, capture generation and release. */
export class ProviderExecutorState {
  environment: AgentEnvironment | undefined
  artifact: ExecutorResult<unknown> | undefined
  retained: RetainedRunHandle | undefined
  pending = false
  /**
   * The child's harness transcript, read out of the live environment. It is held HERE, not only in
   * the settled result, because the children an operator most wants to read never produce one: a
   * throwing stream has no artifact to carry it (#1244). The scope pulls it after `execute`
   * resolves OR throws, as it pulls `metered()`.
   *
   * Seeded, never undefined, so two absences stay apart: a child killed at admission keeps the
   * seed, while one whose box was created and dropped reports `capture-did-not-run` (#1240).
   */
  harnessTranscript: HarnessTranscriptCapture =
    harnessTranscriptUnavailable('execution-never-started')
  /** Set once the stream destroyed the environment: a later `teardown` would issue a SECOND
   *  delete, which the provider answered 409 to. */
  destroyed = false
  /** Set when the settled turn kept its environment for a keyed continuation; cleared when the
   *  environment is released or handed to the successor node. */
  holdingForContinuation = false
  workspaceEnvironmentId: string | undefined
  workspaceCleanupPromise: Promise<TeardownAnswer> | undefined
  retainedReleasePromise: Promise<ReadonlyArray<EnvironmentTeardownReceipt>> | undefined
  releaseReadTried = false
  workspacePreservationRequired = false
  /** Configured native capture did not retain complete evidence; native stop cannot clear it. */
  transcriptPreservationRequired = false
  /** A capture existed but its durable writer failed. A later read alone cannot repay this debt. */
  transcriptPersistenceFailed = false
  /** Any open workspace or transcript custody debt keeps the source environment. */
  get sourcePreservationRequired(): boolean {
    return (
      this.workspacePreservationRequired ||
      this.transcriptPreservationRequired ||
      this.transcriptPersistenceFailed
    )
  }
  /** Exact current invocation input for a capture recovered during retained release. */
  transcriptTask: unknown
  /** This invocation's result, independent of the prior result kept across a continuation. */
  transcriptResult: ExecutorResult<unknown> | undefined
  workspaceRunActive = false
  providerSessionId: string | null = null
  workspaceControlRef: AgentExactRunControlRef | undefined
  /** Whether the provider confirmed this execution's harness stopped. */
  harnessStopped = false
  /** Settles when `harnessTranscript` is final for the running invocation
   *  (`Executor.harnessTranscriptSettled`); settled between invocations. */
  transcriptSettled: Promise<void> = Promise.resolve()
  settleTranscript: () => void = () => {}
  /** The latest invocation's combined abort signal, which keeps the reason it was aborted with. */
  runSignal: AbortSignal | undefined

  constructor(
    private readonly callerSignal: AbortSignal | undefined,
    public workspaceExecutionId: string,
  ) {}

  cancelledExplicitly(): boolean {
    return (
      this.callerSignal?.reason instanceof RunCancellationReason ||
      this.runSignal?.reason instanceof RunCancellationReason
    )
  }

  /** Forget the capture generation: the next one owns its own snapshot, receipts and verdicts. */
  clearWorkspaceCapture(): void {
    this.workspaceCleanupPromise = undefined
    this.retainedReleasePromise = undefined
    this.workspacePreservationRequired = false
    this.transcriptPreservationRequired = false
    this.transcriptPersistenceFailed = false
    this.destroyed = false
  }

  resetWorkspace(next: AgentEnvironment, invocationId = this.workspaceExecutionId): void {
    if (this.workspaceEnvironmentId === next.id && this.workspaceExecutionId === invocationId)
      return
    this.workspaceEnvironmentId = next.id
    this.workspaceExecutionId = invocationId
    this.clearWorkspaceCapture()
  }
}

/** The state of one executor beside the collaborators its invocation, capture and release share. */
export interface ProviderExecutorScope {
  readonly provider: AgentEnvironmentProvider
  readonly profile: AgentProfile
  readonly createProfile: AgentProfile
  readonly options: ProviderExecutorOptions
  readonly ctx: ExecutorContext
  readonly retention: RetainedExecutorContext | undefined
  readonly node: ExecutorNodeContext | undefined
  readonly executionId: string
  readonly state: ProviderExecutorState
  readonly controller: AbortController
  readonly trace: ReturnType<typeof createPushTraceSource>
  readonly materialization: ReturnType<typeof providerMaterialization>
  readonly nativeControl: ReturnType<typeof createProviderNativeControl>
  readonly continuationTask: string
  readonly executor: () => Executor<unknown>
}
