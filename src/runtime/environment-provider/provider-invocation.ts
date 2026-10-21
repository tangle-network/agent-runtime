import {
  type AgentCandidateWorkspaceSnapshotEvidence,
  type AgentExactRunControlRef,
  type AgentProfile,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import type {
  ProviderNativeCapturePhase,
  ProviderWorkspaceCaptureProvenance,
} from '../provider-workspace-retention'
import type { RetainedRunHandle } from '../retained-run-types'
import type { TeardownAnswer } from '../supervise/deadline'
import { concreteProfileModel } from '../supervise/model-policy'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import { detachedSnapshot } from '../supervise/snapshot'
import type { createPushTraceSource } from '../supervise/trace-source'
import type { ExecutorNodeContext, ExecutorResult, Spend, UsageEvent } from '../supervise/types'
import { providerExecutionSource } from './provider-execution-source'
import type { ProviderExecutorOptions } from './provider-executor-admission'
import {
  providerTurnDefaults,
  providerTurnWithDefaults,
  taskToTurnInput,
} from './provider-turn-input'
import { ProviderTurnObserver } from './provider-turn-observer'
import { ProviderTurnSettlement } from './provider-turn-settlement'
import { ProviderUsageAccount } from './provider-usage-account'
import { ValidationError } from './provider-validation-error'

/** The turn this invocation sends: the task's turn under the provider's defaults and placement rules. */
function invocationTurn(args: StreamProviderExecutorArgs) {
  const linked = args.signal
  // READINESS IS THE PROVIDER'S CONTRACT. `create` resolves with an environment that can take a
  // turn, so this streams straight into it and adds no wait of its own. The sandbox seam's
  // `acquireSandbox` exists because a raw `SandboxClient.create` returns before the box is ready;
  // wrapping a second readiness poll around a provider that already honors the contract would hide
  // a provider that does not, and a provider that does not is an upstream defect to report.
  const defaultTurn = taskToTurnInput(args.task, linked)
  const turn = providerTurnWithDefaults(
    providerTurnDefaults(args.options.promptOptions, `providerAsExecutor(${args.provider.name})`),
    args.options.taskToTurn?.(args.task, args.profile, defaultTurn) ?? defaultTurn,
    linked,
  )
  if (args.options.defaults?.metadata?.runtimeProviderPlacement === undefined) return turn
  if (turn.model !== undefined && turn.model !== concreteProfileModel(args.profile)) {
    throw new ValidationError('provider placement: taskToTurn cannot replace the profile model')
  }
  const declared = providerTurnDefaults(args.options.promptOptions, 'provider placement')
  if (
    canonicalCandidateDigest(turn.providerOptions ?? {}) !==
    canonicalCandidateDigest(declared?.providerOptions ?? {})
  ) {
    throw new ValidationError(
      'provider placement: taskToTurn cannot replace declared provider options',
    )
  }
  const { signal: _signal, ...material } = turn
  return { ...detachedSnapshot(material, 'provider placement turn'), signal: linked }
}

export async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncGenerator<UsageEvent, ProviderInvocationEnd, undefined> {
  const started = Date.now()
  const turn = invocationTurn(args)
  args.onProviderSessionId(turn.sessionId ?? null)
  const source = await providerExecutionSource(args, turn, args.signal)
  const environment = source.environment
  args.onEnvironment(environment)
  args.startNativeMirror(environment)
  const usage = new ProviderUsageAccount(args, turn.model)
  const observer = new ProviderTurnObserver(args, usage, source.retained)
  const settlement = new ProviderTurnSettlement(
    args,
    environment,
    source.retained,
    turn.sessionId ?? null,
    observer,
    usage,
    started,
  )
  try {
    yield* observer.consume(source.events)
    yield* settlement.settle()
  } catch (error) {
    yield* settlement.fail(error)
  } finally {
    await settlement.release()
  }
  return settlement.end()
}

export interface StreamProviderExecutorArgs {
  provider: AgentEnvironmentProvider
  profile: AgentProfile
  /** The exact profile handed to `provider.create` — the authored profile unless the caller
   *  installed a `profileForCreate` overlay. */
  createProfile: AgentProfile
  task: unknown
  signal: AbortSignal
  node?: ExecutorNodeContext
  options: ProviderExecutorOptions
  retention?: RetainedExecutorContext
  executionId: string
  trace: ReturnType<typeof createPushTraceSource>
  recovering: boolean
  /** The spend of this execution's earlier invocations. This invocation's cumulative token
   *  events and its settled spend continue from it, because the conserved pool reads one
   *  execution's totals and refuses a cumulative total that decreases. Absent for a first
   *  invocation. */
  carried?: Spend
  /** When the execution's first invocation started: a continued execution settles its whole
   *  duration, pauses included. */
  executionStartedAt: number
  /** Whether a refusal for capacity may end this invocation with its environment kept, for the
   *  caller to continue (`ProviderExecutorOptions.unavailablePause`). Only a retained source
   *  continues, because only it journals each invocation. */
  mayContinue: boolean
  /** Whether the manager this turn serves has stopped: an accepted result, `stop`, a stop rule. */
  managerStopped: () => boolean
  onRetained: (handle: RetainedRunHandle) => void
  onPending: (pending: boolean) => void
  onEnvironment: (environment: AgentEnvironment) => void
  onArtifact: (artifact: ExecutorResult<unknown>) => void
  onProviderSessionId: (id: string | null) => void
  onUnsettledFailure: () => void
  onPublishedSnapshot: (snapshot: AgentCandidateWorkspaceSnapshotEvidence | undefined) => void
  captureWorkspace: (
    environment: AgentEnvironment,
    outcome: AgentRunOutcome | undefined,
  ) => Promise<AgentCandidateWorkspaceSnapshotEvidence | undefined>
  /** Start copying the harness session to durable artifacts on an interval. */
  startNativeMirror: (environment: AgentEnvironment) => void
  /** Count one provider event, so the native mirror can skip a copy of an unchanged session. */
  noteProviderEvent: () => void
  /** Stop the harness of a turn its deadline or a cancellation ended, before its final copy.
   *  Bounded; never throws. */
  stopEndedHarness: (signal: AbortSignal) => Promise<void>
  /** Stop the interval and copy once more, on every way the turn ends. Never throws. */
  finishNativeMirror: (
    environment: AgentEnvironment,
    phase: ProviderNativeCapturePhase,
  ) => Promise<void>
  workspaceControlRef: () => AgentExactRunControlRef | undefined
  workspaceProvenance: () => ProviderWorkspaceCaptureProvenance | undefined
  workspaceCoverage: () => { complete: boolean; incompleteReason?: string }
  destroyEnvironment: (signal?: AbortSignal) => Promise<TeardownAnswer>
  /** The harness transcript read out of the live environment, reported on the settled path AND
   *  on the drop path. One channel for both, so a reader never has to know which path ran. */
  onHarnessTranscript: (capture: HarnessTranscriptCapture) => void
  /** The transcript is final for this turn: an aborted turn's harness stopped and its session's
   *  final copy is taken. */
  onTranscriptSettled: () => void
  /** The settled turn's environment is kept for a keyed continuation (`holdOnSettle`). */
  onHeld: () => void
}

export interface ProviderInvocationEnd {
  /** The upstream refused the turn for capacity, and the environment was kept to continue in. */
  readonly unavailable?: { readonly signal: string; readonly cause: string }
  /** The execution's spend so far, this invocation included. */
  readonly spent?: Spend
  /** Whether this invocation itself spent anything before it ended. */
  readonly madeProgress: boolean
  readonly durationMs: number
}
