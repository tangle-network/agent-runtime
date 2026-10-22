import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import { type HarnessTranscriptCapture, harnessTranscriptUnavailable } from '../harness-transcript'
import type { ProviderWorkspaceCaptureProvenance } from '../provider-workspace-retention'
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
import type {
  createProviderCaptureMirrors,
  createProviderNativeControl,
} from './provider-retention-lifecycle'

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
  workspaceSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  workspaceProvenance: ProviderWorkspaceCaptureProvenance | undefined
  workspaceCoverageComplete = false
  workspaceIncompleteReason: string | undefined
  workspacePublishedSnapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined
  workspaceCaptureFailure: unknown
  workspaceCapturePromise: Promise<AgentCandidateWorkspaceSnapshotEvidence> | undefined
  workspaceCleanupPromise: Promise<TeardownAnswer> | undefined
  retainedReleasePromise: Promise<ReadonlyArray<EnvironmentTeardownReceipt>> | undefined
  releaseReadTried = false
  releaseNativeTried = false
  workspaceOutcome: AgentRunOutcome | undefined
  workspacePreservationRequired = false
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
    this.workspaceSnapshot = undefined
    this.workspaceProvenance = undefined
    this.workspaceCoverageComplete = false
    this.workspaceIncompleteReason = undefined
    this.workspacePublishedSnapshot = undefined
    this.workspaceCaptureFailure = undefined
    this.workspaceCapturePromise = undefined
    this.workspaceCleanupPromise = undefined
    this.retainedReleasePromise = undefined
    this.workspaceOutcome = undefined
    this.workspacePreservationRequired = false
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
  readonly mirrors: ReturnType<typeof createProviderCaptureMirrors>
  readonly nativeControl: ReturnType<typeof createProviderNativeControl>
  readonly continuationTask: string
  readonly executor: () => Executor<unknown>
}
