import type {
  AgentCandidateWorkspaceSnapshotEvidence,
  AgentExactRunControlRef,
  AgentProfile,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { CreateSandboxOptions, PromptOptions } from '@tangle-network/sandbox'
import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import type { ProviderPlacement } from '../provider-placement'
import type {
  ProviderNativeCapturePhase,
  ProviderWorkspaceCaptureProvenance,
  ProviderWorkspaceCaptureReceipt,
  ProviderWorkspaceRetentionPort,
} from '../provider-workspace-retention'
import type { RetainedRunHandle } from '../retained-run-types'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type { createPushTraceSource } from '../supervise/trace-source'
import type { ExecutorNodeContext, ExecutorResult, Runtime, Spend } from '../supervise/types'
import type { UnavailablePausePolicy } from '../supervise/upstream-unavailable'
import type { Validator } from '../types'

/** Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.
 * @experimental */
export interface ProviderAsSandboxClientOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>
  requireTerminalEvent?: boolean
  /** Require declared live continuation plus concrete session controls. */
  requireSession?: boolean
  /** Verified workspace capture before every environment delete, including steerable sessions. */
  workspaceRetention?: ProviderWorkspaceRetentionPort
  /** Supervised identity assigned before the environment is created. */
  retentionIdentity?: { executionId: string; profile: AgentProfile; node?: ExecutorNodeContext }
  /** Called after verification and before deletion so the run result can retain the exact join. */
  onWorkspaceCaptured?: (receipt: ProviderWorkspaceCaptureReceipt) => void | Promise<void>
  /** Translate Sandbox-specific controls that have no neutral representation. Without this
   * callback, unsupported fields are refused before any environment is created. */
  mapCreateOptions?: (
    options: CreateSandboxOptions | undefined,
  ) => Partial<CreateAgentEnvironmentInput>
}

/**
 * What one provider-executed turn settles on: the visible answer plus the event archive the
 * environment streamed. It is the value a `ProviderExecutorOptions.validator` scores.
 *
 * The archive is the streamed sequence, in order, without superseded part updates. A harness
 * streams a text or reasoning part cumulatively: every `message.part.updated` frame restates the
 * part's whole text so far. When a later frame of the same part extends a frame's text, the
 * earlier frame is left out, so each such part is archived once, at its latest frame. Keeping
 * every frame retains frames times text length, and the settled archive is hashed and stored.
 * A frame that does not extend the part's text is kept, and every other event is kept verbatim.
 * Read a part's text from `part.text`; a retained frame's `delta` is only that frame's increment.
 *
 * @experimental
 */
export interface ProviderLeafOut {
  content: string
  events: AgentEnvironmentEvent[]
  /** Portable executable workspace evidence accepted before the source environment was deleted. */
  workspaceSnapshot?: AgentCandidateWorkspaceSnapshotEvidence
  /** Exact provider and supervisor identities bound to the retained bytes. */
  workspaceCapture?: ProviderWorkspaceCaptureReceipt
  /**
   * Why workspace retention produced no receipt for this settled turn. The source environment is
   * preserved as evidence and the turn's result stands.
   */
  workspaceCaptureFailure?: string
  /** How many streamed part updates the archive left out because a later frame superseded them. */
  supersededPartUpdates?: number
}

/**
 * Per-run Sandbox prompt options for the provider path — the same field, the same name, and the
 * same kernel-owned exclusions as `ExecCtx.promptOptions` on the sandbox path.
 *
 * The kernel owns `sessionId` and `signal`, so neither is declarable: a caller-chosen session id
 * would make every worker share one server session, and the abort channel belongs to the run.
 * `model` is excluded too, and for a different reason: this executor's materialization record
 * names the model from `AgentProfile`, so a turn-level override would make the record state a
 * model the provider did not run. Declare the instrument on `AgentProfile.model`.
 *
 * Everything else is the per-call configuration a portable profile cannot carry. `backend` is the
 * load-bearing one: `backend.model.authMode` plus `authFiles` is how a caller-owned subscription
 * seat reaches the harness inside the environment. Runtime lowers these onto the turn with the one
 * mapper it already uses in the other direction, so a sandbox-shaped provider reads them from
 * `AgentTurnInput.providerOptions.backend` exactly as it reads a sandbox box's prompt options.
 *
 * @experimental
 */
export type ProviderPromptOptions = Omit<PromptOptions, 'model' | 'sessionId' | 'signal'>

/** Options for running a provider as a supervise-mode executor.
 * @experimental */
export interface ProviderExecutorOptions {
  /** Select exactly one caller-declared placement from each child's unchanged profile. */
  placements?: readonly ProviderPlacement[]
  defaults?: Partial<CreateAgentEnvironmentInput>
  runtime?: Runtime
  destroyOnSettle?: boolean
  requireTerminalEvent?: boolean
  /**
   * Per-run prompt options merged UNDER every streamed turn: a mapped turn's own field wins, and
   * the runtime's abort signal is applied last. `providerOptions` merges one level, so a
   * `taskToTurn` that sets its own provider option cannot silently drop the session credential
   * declared here.
   */
  promptOptions?: ProviderPromptOptions
  /**
   * OPT-IN executable score for this worker, with the SAME contract the sandbox seam's validator
   * has: `validate` runs while the environment is still alive, so `ValidationCtx.box` can read
   * files and run commands in the environment it is scoring. Every other supervised hook fires
   * after teardown and can only read the artifact.
   * `ValidationCtx.node` identifies the supervised node, including its recursion depth, so a
   * shared validator can apply a root-only contract without applying it to nested managers.
   *
   * The verdict becomes the settled artifact's verdict. Absent, nothing changes and the leaf falls
   * back to its own settle verdict.
   */
  validator?: Validator<ProviderLeafOut>
  /** Capture and verify a portable executable workspace before Runtime destroys the environment. */
  workspaceRetention?: ProviderWorkspaceRetentionPort
  /** Transform only the profile sent to `provider.create`. The original profile
   * remains the input to `taskToTurn`, so execution-only normalization cannot
   * rewrite the caller's task mapping. */
  profileForCreate?: (profile: AgentProfile) => AgentProfile
  /** Map the task while retaining the kernel's canonical prompt mapping by default. */
  taskToTurn?: (
    task: unknown,
    specProfile: AgentProfile,
    defaultTurn: AgentTurnInput,
  ) => AgentTurnInput
  /**
   * How a supervised leaf waits out an upstream that cannot serve now.
   *
   * When the model provider refuses a leaf's turn for capacity (a quota, a rate limit, an
   * overload, or the router's own refused credential; see `upstreamUnavailableSignal`), the leaf
   * keeps its environment, pauses, and continues in the same environment and session with a
   * short instruction to pick up where it stopped. The pause starts at `unavailablePauseMs`
   * (15 s) and doubles to `maxUnavailablePauseMs` (5 min), the same rule a driver follows. Only
   * the leaf's deadline, cancellation and budget end it. Each pause is journaled as a `paused`
   * spawn event, and each continuation as the node's next `execution-input`.
   *
   * Applies to a retained execution under a Scope, the path a supervised leaf takes on a provider
   * that declares `retainedControl`. Workspace retention verifies each invocation separately;
   * failed capture or required incomplete coverage preserves the source and stops continuation.
   * `false` ends the execution on the refused turn.
   */
  unavailablePause?: UnavailablePausePolicy | false
}

/** What a leaf is told when it continues after a refused turn. The session carries its
 *  conversation and the environment its files, so the instruction names neither the provider nor
 *  the refusal: a director told the details of a provider failure spent its children probing the
 *  infrastructure (discovery-lab AGENTS.md, measured 2026-09-11). */
export const LEAF_CONTINUATION_TASK =
  'Your previous turn was interrupted before it finished. This is the same task in the same ' +
  'session: your conversation so far and the files in your workspace are where you left them. ' +
  'Continue from where you stopped. Do not start over.'
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
/** Runtime's own mark, beside the provider's frames, that a retained turn now waits on its exact
 *  result. The executor publishes it as an `awaiting-result` progress row; it is never a frame. */
export interface RetainedAwaitingResult {
  readonly awaitingResultSince: string
}

export type TeardownAnswer = { destroyed: boolean; detail?: string; permanent?: boolean }
