import { $ as SpawnJournal, $i as Iteration, A as NodeExecutionIdentity, An as RetainedPendingCause, At as TraceContext, B as ResultBlobStore, Bn as ReconnectRetainedInteractiveRunOptions, Ca as Validator, Ci as RetainedRunEffect, Ei as RetainedRunHandle, Fa as AgentExecutionBackend, Gr as AgentEvalError$1, I as ProviderModelExecutionEvidence, J as RootStreamReceipt, Jn as HarnessTranscriptCapture, Kn as StartRetainedInteractiveRunOptions, L as RecursiveReservationPolicy, Ln as WorkerProgress, Lt as OtelExportConfig, M as NodeSnapshot, Mi as StartRetainedRunInEnvironmentOptions, Mr as ContinuationPolicy, Ni as StartRetainedRunOptions, P as ProfileMaterializationReceipt, Pi as BudgetPool, Pn as ExecutorProgress, Q as SpawnEvent, Qa as RuntimeSessionStore, Qi as ExecCtx, Ri as LeakedReservation, Rt as OtelExportStats, Sr as CheckRead, Tn as TraceSource, U as RetainedExecutionState, V as ResumedKeyState, Vn as RecoverRetainedInteractiveRunOptions, W as RootHandle, Wn as RetainedInteractiveRunHandle, X as Scope, Y as Runtime, Yi as AgentRunSpec, Yn as HarnessTranscriptEvidence, Z as Settled, Zi as Driver, _a as MountRecorder, aa as LoopLineageOptions, ai as WorkerSlots, at as SpendGap, b as ExecutorRegistry, ba as SandboxClient, bt as WorkerInteractiveUnavailableReason, ca as LoopResult, ct as SubtreeSummary, di as RecoverRetainedRunIntentOptions, et as SpawnOpts, fi as RecoverRetainedRunOptions, fr as DriverReentry, g as ExecutorFactory, ga as MountManifestEntry, ha as LoopWinner, i as Budget, ii as SlotPermit, j as NodeId, k as NoWinnerError, kn as RetainedChildRecovery, l as ExecutionBindingReceipt, lt as SupervisedResult, ma as LoopTraceEvent, mr as DriverRetryPolicy, mt as UnconfirmedTeardown, n as AgentExecutionRef, o as BudgetViolation, ot as SteerableRootHandle, pa as LoopTraceEmitter, pi as RecoverRetainedRunResult, pn as WaitProbeRegistry, pt as TreeView, r as AgentSpec, rr as DriverAttemptRecord, rt as Spend, s as DefaultVerdict, sr as DriverContinuationRecord, t as Agent, u as Executor, ui as ReconnectRetainedRunOptions, un as PendingWait, ut as Supervisor, va as OutputAdapter, w as FleetYield, wr as CheckVerdict, wt as WorkerTraceResolver, x as ExecutorResult, xa as SelectionReceipt, xt as WorkerTraceEvidence, yt as WorkerInteractiveSession, zt as OtelExporter } from "./types-D56jQad-.js";
import { n as AnalystRegistryLike } from "./types-zWfqDjeL.js";
import { l as RuntimeHooks, o as RuntimeHookEvent, r as RuntimeDecisionPoint } from "./runtime-hooks-Bj6wJHlH.js";
import { $n as PeerMailLimits, Bn as ToolSpec, D as Inbox, Gn as ToolLoopMessageRecord, Hn as ToolLoopChat, Kn as ToolLoopToolCall, Mt as AgentEnvironmentProviderRegistry, P as KeyProvider, Rn as runLocalHarness, Wn as ToolLoopCompactionOptions, Zn as PeerMailEvent, dr as JsonRpcMessage, f as ExecutorConfig, fr as JsonRpcResponse, gn as WorktreeHarnessResult, gr as Redactor, h as RouterToolsSeam, hr as McpTransport, ir as PeerMailbox, mn as WorktreeCheckRunner, mr as McpToolDescriptor$1, pn as InPlaceHarnessResult, xn as GitRunner, zn as RouterTransportConfig } from "./stream-agent-turn-Bk79CnTw.js";
import { _ as CoderTask, d as ResearchSource, o as UiLens, r as UiFinding } from "./substrate-CHQ5GYnU.js";
import { AGENT_PROFILE_MATERIALIZATION_AXES, AgentCandidateLineage, AgentCandidateWorkspaceManifestMaterial, AgentInteractiveSessionControlClaim, AgentInteractiveSessionRef, AgentProfile, AgentProfile as AgentProfile$2, AgentProfile as AgentProfile$3, AgentProfileDiff, AgentProfilePrompt, AgentProfileSecurityPolicy, CanonicalAgentProfileMaterializationAxis, Sha256Digest, profileMaterializationAxes as profileMaterializationAxes$1 } from "@tangle-network/agent-interface";
import { AgentProfile as AgentProfile$1, AnalystFinding, AnalystFinding as AnalystFinding$1, AnalystFinding as AnalystFinding$2, AnalystRunInputs, ChatClient, CustomTokenPricing, DetectorSignal, HarnessType as HarnessType$1, MaximumCharge, PairedPromotionDecision, ProposalFinding, RankTestMethod, RegistryRunOpts, RunRecord, StreamingDetector, ToolSpan, TraceAnalysisEngine, TraceAnalysisStore, buildTrajectory, computeFindingId as computeFindingId$1, makeFinding as makeFinding$1 } from "@tangle-network/agent-eval";
import { AgentRunOutcome } from "@tangle-network/sandbox/runtime";
import "@tangle-network/agent-profile-materialize";
import { BackendType, BranchOptions, CreateSandboxOptions, CreateSandboxOptions as CreateSandboxOptions$1, PromptOptions, SandboxEvent, SandboxEvent as SandboxEvent$1, SandboxInstance, SandboxInstance as SandboxInstance$1, SandboxResources } from "@tangle-network/sandbox";
import { AnalystRegistry, AnalystRunInputs as AnalystRunInputs$1, AnalystRunResult as AnalystRunResult$1, RegistryRunOpts as RegistryRunOpts$1 } from "@tangle-network/agent-eval/analyst";
import { DispatchFn, ExternalOptimizerModelCall, JudgeConfig, ProfileDispatchFn, RunProfileMatrixOptions, RunProfileMatrixResult, Scenario } from "@tangle-network/agent-eval/campaign";
import { SealedExperiment } from "@tangle-network/agent-eval/experiment";
import { stuckLoopView, toolWasteView } from "@tangle-network/agent-eval/pipelines";
import { AgentEnvironment, AgentEnvironmentCapabilities, AgentEnvironmentProvider, CreateAgentEnvironmentInput } from "@tangle-network/agent-interface/environment-provider";
//#region src/agent/profile-materialization.d.ts
type KnownAgentProfileMaterializationAxis = CanonicalAgentProfileMaterializationAxis;
/** AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions. */
type AgentProfileMaterializationAxis = KnownAgentProfileMaterializationAxis | `custom:${string}`;
/** Declares which AgentProfile axes a concrete run path really carries. */
interface ProfileMaterializationContract {
  /** Human-readable run path, e.g. `createSandboxAct` or `prompt-only-message`. */
  name: string;
  /** Profile axes this run path actually carries into execution. */
  axes: readonly AgentProfileMaterializationAxis[];
}
/** One changed AgentProfile axis that would be dropped by a run path. */
interface ProfileMaterializationIssue {
  contract: string;
  axis: AgentProfileMaterializationAxis;
  reason: 'unsupported-axis';
  supportedAxes: readonly AgentProfileMaterializationAxis[];
}
/** Input for declaring a run path's profile-axis support. */
interface DefineProfileMaterializationContractOptions {
  name: string;
  axes: readonly AgentProfileMaterializationAxis[];
}
/** Input for checking a candidate diff against a run path. */
interface ValidateProfileMaterializationOptions {
  contract: ProfileMaterializationContract;
  changedAxes: readonly AgentProfileMaterializationAxis[];
}
/** Input for throwing on dropped profile axes. */
interface AssertProfileMaterializationOptions extends ValidateProfileMaterializationOptions {
  /** Extra label included in the thrown error, usually the caller or run id. */
  context?: string;
}
/** Materialization contract for a run path that executes every canonical AgentProfile leaf. */
declare const fullProfileMaterialization: ProfileMaterializationContract;
/**
 * Materialization contract for an intentionally limited prompt-and-model execution path.
 * Identity, harness, and metadata are control fields consumed for naming, placement,
 * authorization, and durable attribution; they are carried without adding worker behavior.
 * Every behavioral axis other than prompt and model remains unsupported.
 */
declare const promptModelProfileMaterialization: ProfileMaterializationContract;
/**
 * Materialization contract for a local coding CLI in an isolated git worktree.
 * The shared workspace materializer carries native tools, permissions, MCP, hooks, subagents,
 * modes, and file-backed resources when the selected CLI supports their exact values.
 * `resourceFailOnError` is carried: it is the fail-closed policy the pre-worktree resource
 * RESOLUTION step (`resolveAgentProfileResources`) applies to remote profile resources. Runtime
 * placement concerns (hub connections and confidential execution), provider-native extensions,
 * and unused model hints are deliberately absent so they fail before a worktree or executor is
 * created rather than being mistaken for an effective candidate change.
 */
declare const worktreeCliProfileMaterialization: ProfileMaterializationContract;
/** Materialization contract for a raw process path that carries only control/identity fields. */
declare const controlProfileMaterialization: ProfileMaterializationContract;
/** Materialization contract for an injected inference function whose surrounding driver still
 * applies the profile prompt, name, placement, and metadata, but not model selection. */
declare const promptControlProfileMaterialization: ProfileMaterializationContract;
/**
 * Materialization contract for `createSandboxAct`.
 *
 * `createSandboxAct` hands the whole `AgentProfile` to the sandbox as `backend.profile`, so every
 * profile leaf crosses the boundary. `buildBackendOptions` resolves the runner only from
 * `profile.harness`; an explicit `sandboxOverrides.backend.type` may confirm that choice but cannot
 * replace it. A candidate declaring a harness the sandbox cannot run throws rather than running
 * elsewhere and reporting success.
 */
declare const sandboxActProfileMaterialization: ProfileMaterializationContract;
/** Materialization contract for a run path that only injects prompt text. */
declare const promptOnlyProfileMaterialization: ProfileMaterializationContract;
/**
 * Materialization contract for a run path that injects prompt text plus inline resources.
 *
 * `resourceFailOnError` is absent: it is a resolution POLICY the attaching path would have to
 * enforce, and inlining resource content does not carry it.
 */
declare const promptResourceProfileMaterialization: ProfileMaterializationContract;
/** Define the profile axes a concrete run path actually carries into execution. */
declare function defineProfileMaterializationContract(options: DefineProfileMaterializationContractOptions): ProfileMaterializationContract;
/** Return every changed profile axis that the selected run path would drop. */
declare function validateProfileMaterialization(options: ValidateProfileMaterializationOptions): readonly ProfileMaterializationIssue[];
/** Throw when a candidate changes axes the selected run path cannot carry. */
declare function assertProfileMaterialization(options: AssertProfileMaterializationOptions): void;
/** Format profile-axis drop issues into a concise operator-facing error. */
declare function renderProfileMaterializationIssues(issues: readonly ProfileMaterializationIssue[], context?: string): string;
//#endregion
//#region src/durable/content-address.d.ts
/** Stable content address shared by result and trace artifacts. */
declare function contentAddress(artifact: unknown): string;
//#endregion
//#region src/durable/spawn-journal.d.ts
/** One journal tree in a recursively loaded supervision forest. */
interface SpawnForestTree {
  readonly root: NodeId;
  /** Driver node that owns this tree; absent for the requested root tree. */
  readonly ownerNodeId?: NodeId;
  /** Journal tree containing `ownerNodeId`; absent for the requested root tree. */
  readonly parentTreeRoot?: NodeId;
  readonly events: ReadonlyArray<SpawnEvent>;
  readonly view: TreeView;
}
/** One event with the journal tree that establishes its cursor namespace. */
interface SpawnForestEvent {
  readonly treeRoot: NodeId;
  readonly event: SpawnEvent;
}
/** One flattened node with the journal tree that owns its records. */
interface SpawnForestNode extends NodeSnapshot {
  readonly treeRoot: NodeId;
}
/** A spawned worker with no terminal record in a cold snapshot. Resume treats the same state as
 * in-doubt and conservatively retains its reservation. Root nodes and armed waits are excluded. */
interface SpawnForestInDoubtNode {
  readonly treeRoot: NodeId;
  readonly nodeId: NodeId;
  readonly label: string;
  readonly runtime: Runtime;
}
/** A driver spawn whose owned journal tree was never begun before the process stopped. */
interface SpawnForestMissingTree {
  readonly parentTreeRoot: NodeId;
  readonly ownerNodeId: NodeId;
  readonly root: NodeId;
}
/** Complete cold-readable view of one recursive supervision run. */
interface SpawnForest {
  readonly root: NodeId;
  readonly trees: ReadonlyArray<SpawnForestTree>;
  readonly nodes: ReadonlyArray<SpawnForestNode>;
  readonly events: ReadonlyArray<SpawnForestEvent>;
  readonly inDoubt: ReadonlyArray<SpawnForestInDoubtNode>;
  readonly missingTrees: ReadonlyArray<SpawnForestMissingTree>;
}
/**
 * Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a
 * stable JSON encoding. Producers call this to derive the `outRef` they journal and
 * `put`; the FS/in-mem stores re-derive it on `put` to verify the supplied ref
 * matches (fail loud on a mismatch — a forged ref breaks the replay invariant).
 *
 * Stable encoding: object keys are sorted recursively so two structurally-equal
 * artifacts hash identically regardless of key insertion order.
 */
/**
 * In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied
 * `outRef` matches the artifact's hash so a stale/forged ref fails loud rather than
 * silently rehydrating the wrong payload. Idempotent on an identical re-put.
 *
 * @stable
 */
declare class InMemoryResultBlobStore implements ResultBlobStore {
  private readonly blobs;
  put(outRef: string, artifact: unknown): Promise<void>;
  get(outRef: string): Promise<unknown | undefined>;
}
/**
 * FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
 * filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
 * `put` fsyncs so a crash between writes never loses an acknowledged blob.
 *
 * @stable
 */
declare class FileResultBlobStore implements ResultBlobStore {
  private readonly dir;
  constructor(dir: string);
  put(outRef: string, artifact: unknown): Promise<void>;
  get(outRef: string): Promise<unknown | undefined>;
  private blobPath;
}
/**
 * In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces
 * the corruption guards a durable replay rests on:
 *  - an event before `beginTree` is a corrupted tree (fail loud),
 *  - a duplicate `seq` within a tree is a corrupted cursor (fail loud) — two
 *    settlements cannot share the cursor position replay orders by.
 *
 * @stable
 */
declare class InMemorySpawnJournal implements SpawnJournal {
  private readonly trees;
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>;
  beginTree(root: NodeId, at: string): Promise<void>;
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>;
}
/**
 * JSONL on disk. One line per record: the first record is `begin`, subsequent records
 * are `event` envelopes wrapping a `SpawnEvent`. `loadTree` replays the whole file,
 * filtering by `root`, and applies the same begin-precedes-events + unique-seq
 * corruption guards as the in-memory impl. Each append fsyncs so a crash between
 * writes never loses an acknowledged event.
 *
 * @stable
 */
declare class FileSpawnJournal implements SpawnJournal {
  private readonly path;
  private appendTail;
  private appendIndex;
  constructor(path: string);
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>;
  beginTree(root: NodeId, at: string): Promise<void>;
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>;
  private validationIndex;
  private fileStamp;
  private serializeAppend;
  private writeRecord;
}
/**
 * Load every journal tree owned by one recursive supervision run and flatten its nodes/events.
 *
 * Nested driver tree keys are a Runtime implementation detail; callers should use this reader
 * instead of deriving or scanning keys themselves. The reader follows only the explicit
 * `ownedTreeRoot` written after Runtime privately attested a recursive executor; the open runtime
 * string `driver` is never treated as ownership. Legacy records without `ownedTreeRoot` are
 * intentionally treated as leaves rather than guessing or scanning convention-derived keys.
 * This preserves each tree's independent cursor namespace on flattened events.
 * A driver whose subtree was never begun is reported in `missingTrees`; any spawned non-root node
 * without a terminal record is reported in `inDoubt`, matching resume's conservative lost-work
 * interpretation.
 *
 * This is a cold/quiescent reader, not a transaction across an actively mutating file. Every value
 * returned is a detached immutable snapshot, so later journal writes or caller mutation cannot
 * change the result already observed.
 */
declare function loadSpawnForest(journal: SpawnJournal, root: NodeId): Promise<SpawnForest>;
/**
 * Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled
 * child's `out` from the blob store by `outRef`, and return the `Settled[]` exactly
 * as `scope.next()` originally delivered them.
 *
 * Determinism (B2): the events are sorted by `seq` BEFORE any blob `get`, so the
 * replay order is the recorded cursor order regardless of how fast each rehydration
 * resolves. `at` (wall-clock) is never a replay input. Fail loud on a tree that was
 * never begun, a settled-done event missing its `outRef`, or a blob the store can't
 * rehydrate — a silent gap would let `act` branch on the wrong evidence.
 *
 * @stable
 */
declare function replaySpawnTree(journal: SpawnJournal, blobs: ResultBlobStore, root: NodeId): Promise<Settled<unknown>[]>;
/**
 * Materialize a recorded `TreeView` from a journaled event list for inspection. Folds
 * `spawned`/`settled`/`cancelled` into a per-node snapshot in `seq` order, then adds each
 * `metered` event's driver-inference spend onto its node in a separate additive pass so the view
 * matches the recorded cursor. It does not recover live executors or driver state after restart.
 */
declare function materializeTreeView(events: SpawnEvent[]): TreeView;
/**
 * The waits a journaled tree shows as ARMED but never woken — what a resumed run re-arms with the
 * ORIGINAL absolute deadline. Reading it from the journal (rather than from any live state) is
 * what makes "SIGKILL a waiting tree, a new process keeps waiting to the same instant" true.
 */
declare function pendingWaits(events: SpawnEvent[]): PendingWait[];
//#endregion
//#region src/durable/spawn-journal-sql.d.ts
/** The minimal statement seam; structurally the same shape `SqlConversationJournal` accepts. */
interface SqlStatements {
  /** Execute a write statement (INSERT/UPDATE/DELETE/DDL). */
  exec(sql: string, params?: readonly unknown[]): Promise<{
    rowsAffected: number;
  }>;
  /** Execute a read statement (SELECT). Returns rows as plain objects. */
  query<TRow = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<TRow[]>;
}
/** SQL-backed `SpawnJournal`. One row per event; insertion order is replay order. */
declare class SqlSpawnJournal implements SpawnJournal {
  private readonly db;
  private readonly table;
  private readonly cache;
  private appendTail;
  constructor(db: SqlStatements, table?: string);
  /** Create the journal's tables if absent. Idempotent. */
  migrate(): Promise<void>;
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>;
  beginTree(root: NodeId, at: string): Promise<void>;
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>;
  private validationIndex;
  private maxEventId;
  private migrated;
  private ensureMigrated;
  private serializeAppend;
}
/** SQL-backed `ResultBlobStore`. One content-addressed row per settled result. */
declare class SqlResultBlobStore implements ResultBlobStore {
  private readonly db;
  private readonly table;
  private migrated;
  constructor(db: SqlStatements, table?: string);
  migrate(): Promise<void>;
  put(outRef: string, artifact: unknown): Promise<void>;
  get(outRef: string): Promise<unknown | undefined>;
  private ensureMigrated;
}
//#endregion
//#region src/conversation/call-policy.d.ts
/**
 *
 * Per-call resilience policy for participant backends: deadline, retry with
 * backoff, and a circuit breaker. Each policy is applied *around* a single
 * turn's backend invocation, not across the whole conversation — the
 * conversation-level credit cap and `maxTurns` bound the broader run.
 *
 * Deadlines abort the underlying backend stream via `AbortSignal` linkage so
 * the OpenAI/SDK clients tear down their HTTP request cleanly instead of
 * leaking sockets. Retries replay the same logical turn (same `turnId`) so
 * any caching gateway can dedupe. Circuit breakers are *per participant*: A's
 * failures don't open B's breaker.
 *
 * @stable
 */
/** Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. */
type RetryableErrorPredicate = (err: unknown) => boolean;
/** Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. */
type RetryBackoff = number | ((attempt: number) => number);
/** Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. */
interface CircuitBreakerConfig {
  failuresToOpen: number;
  cooldownMs: number;
}
interface BackendCallPolicy {
  /** Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure. */
  perAttemptDeadlineMs?: number;
  /** Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0. */
  maxRetries?: number;
  /** Backoff between attempts. Default 250ms with jitter. */
  retryBackoffMs?: RetryBackoff;
  /** Custom retry classifier. Defaults to retrying transport failures and retryable HTTP statuses. */
  isRetryable?: RetryableErrorPredicate;
  /** Circuit breaker that opens after N consecutive failures per participant. */
  circuitBreaker?: CircuitBreakerConfig;
}
//#endregion
//#region src/conversation/headers.d.ts
/**
 * Header bag carried through `AgentBackendContext.propagatedHeaders` so
 * backends that opt in can merge them into their outbound HTTP requests.
 * Distinct from `buildForwardHeaders` so callers can attach extra
 * non-protocol headers (e.g. tracing) without colliding.
 */
type PropagatedHeaders = Readonly<Record<string, string>>;
//#endregion
//#region src/conversation/types.d.ts
/** @stable */
interface ConversationParticipant {
  /**
   * Stable name used as the speaker label in the transcript. Must be unique
   * within a `Conversation`.
   */
  name: string;
  /**
   * Backend that runs this participant's turn. Reuses the existing
   * `AgentExecutionBackend` contract from `runAgentTaskStream`, so an iterable,
   * sandbox, or profile-backed Runtime executor works through the same runner.
   */
  backend: AgentExecutionBackend;
  /**
   * Optional human label for traces / dashboards. Distinct from `name`, which
   * is the addressing key.
   */
  label?: string;
  /**
   * Optional per-participant override of the conversation's default
   * `callPolicy`. Use to tighten the deadline or raise the retry budget for
   * a participant known to be slow or flaky.
   */
  callPolicy?: BackendCallPolicy;
  /**
   * Who pays for THIS participant's outbound calls?
   *
   * - `'forward-user'` (default) — propagate the caller's
   *   `X-Tangle-Forwarded-Authorization` so the downstream gateway bills the
   *   original user. Right for pass-through agents that aggregate/route
   *   without taking economic risk.
   * - `'agent-owned'` — DO NOT forward the user's auth; the participant's
   *   backend uses its own credentials (typically a sk-tan-AGENT or x402
   *   wallet baked into the backend at construction). Downstream charges
   *   land on the agent, not the user. Right for resold-bundle agents that
   *   take margin between their inbound price and their sub-agent costs.
   * - `(state) => AuthSource` — per-turn / per-condition decision, e.g. base
   *   sub-services are agent-owned but premium add-ons forward the user.
   *
   * The agent's own credentials live on its caller-owned backend or
   * profile-bound Runtime executor; this field is purely about *whether to
   * also forward the user's identity downstream*.
   */
  authSource?: AuthSource;
}
/** @stable */
type AuthSource = 'forward-user' | 'agent-owned' | ((state: ConversationDriveState) => 'forward-user' | 'agent-owned');
/** @stable */
type TurnOrder = 'alternate' | 'round-robin' | ((state: ConversationDriveState) => number);
/** @stable */
interface ConversationDriveState {
  transcript: readonly ConversationTurn[];
  turnIndex: number;
  spentCreditsCents: number;
}
/** @stable */
interface HaltContext extends ConversationDriveState {
  lastTurn: ConversationTurn;
}
/** @stable */
interface HaltSignal {
  halted: true;
  reason: string;
}
/** @stable */
type HaltPredicate = (ctx: HaltContext) => boolean | HaltSignal | Promise<boolean | HaltSignal>;
/** @stable */
type HaltReason = {
  kind: 'max_turns';
  turns: number;
} | {
  kind: 'max_credits';
  spentCents: number;
  capCents: number;
} | {
  kind: 'predicate';
  reason: string;
} | {
  kind: 'abort';
} | {
  kind: 'participant_error';
  participant: string;
  message: string;
};
/** @stable */
interface ConversationPolicy {
  /** Hard cap on speaker-turns. Each call into a participant's backend counts as 1. */
  maxTurns: number;
  /**
   * Hard cap on aggregate credit spend across all participants, in cents.
   * Computed by summing `llm_call.costUsd` from every participant's stream.
   * Unset (`undefined`) means no credit ceiling — the run is bounded only by
   * `maxTurns` and `haltOn`.
   */
  maxCreditsCents?: number;
  /**
   * Speaker selection. Defaults to `'alternate'` for two-participant
   * conversations and `'round-robin'` for any other arity.
   */
  turnOrder?: TurnOrder;
  /**
   * Optional convergence / content-based halt. Called after every turn ends;
   * returning truthy stops the loop with `{ kind: 'predicate', ... }`.
   */
  haltOn?: HaltPredicate;
  /**
   * Default per-turn resilience policy applied to every participant call
   * (deadline, retries, circuit breaker). Individual participants may
   * override via `ConversationParticipant.callPolicy`.
   */
  defaultCallPolicy?: BackendCallPolicy;
}
/** @stable */
interface ConversationTurn {
  index: number;
  speaker: string;
  /**
   * Deterministic turn identifier — stable across retries of the same logical
   * turn so caching gateways and trace backends can dedupe. Shape:
   * `${runId}.t${index}.${speakerSlug}`.
   */
  turnId: string;
  /** Backend session used for this turn. Present on turns recorded by session-aware runners. */
  sessionId?: string;
  text: string;
  /**
   * Aggregated backend usage for this turn alone. Populated from any
   * `llm_call` stream events the backend emitted; `undefined` when the
   * backend reports no usage.
   */
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    latencyMs?: number;
    model?: string;
  };
  /**
   * Number of attempts that ran before this turn committed. `1` is the
   * common case; higher means the call policy retried after transient
   * failures.
   */
  attempts: number;
  startedAt: string;
  endedAt: string;
}
/** @stable */
interface Conversation {
  participants: readonly ConversationParticipant[];
  policy: ConversationPolicy;
}
/** @stable */
interface RunConversationOptions {
  /** First message kicking off the conversation. Routes to the first speaker. */
  seed: string;
  /**
   * Optional run identifier for cross-participant trace correlation. Auto-
   * generated when omitted. Reusing a runId against the same `journal`
   * resumes the prior run — the runner replays the persisted transcript and
   * continues from the first un-recorded turn.
   */
  runId?: string;
  /** Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`. */
  signal?: AbortSignal;
  /**
   * Event sink for per-turn micro-events. Distinct from the result transcript:
   * the sink fires for every text-delta, every turn-start/end, and the
   * conversation-start/end markers. Used to drive SSE / dashboard updates
   * without waiting for the conversation to finish.
   */
  onEvent?: (event: ConversationStreamEvent) => void | Promise<void>;
  /**
   * Optional durable transcript. When set, the runner persists every
   * committed turn before yielding `turn_end`. Reusing the same `runId`
   * against the same journal resumes from the last committed turn — so a
   * driver process crash mid-run loses zero acknowledged turns.
   */
  journal?: ConversationJournal;
  /**
   * Stores each participant's backend session. The runner keeps an in-memory
   * store for one invocation when omitted. Reuse a durable store with the same
   * `runId` and journal after a process restart. Backends implementing `resume`
   * continue their provider session; other backends receive the full transcript.
   */
  sessionStore?: RuntimeSessionStore;
  /**
   * Headers to forward verbatim to every participant backend call (gateway
   * propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
   * depth counter). Backends opt in by reading `propagatedHeaders` from
   * their `AgentBackendContext`; backends that ignore the field still work.
   */
  propagatedHeaders?: PropagatedHeaders;
  /**
   * Inbound depth at the point this driver was invoked. The runner
   * increments it on every outbound participant call; gateways refuse at
   * `DEFAULT_MAX_DEPTH`. Default 0 (origin caller).
   */
  inboundDepth?: number;
  /**
   * Parent turn id when this conversation is *inside* another turn (i.e. the
   * driver is itself a participant via `createConversationBackend`). The
   * runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
   * so trace stitching survives nested orchestration.
   */
  parentTurnId?: string;
}
/** @stable */
interface ConversationResult {
  runId: string;
  transcript: ConversationTurn[];
  turns: number;
  spentCreditsCents: number;
  halted: HaltReason;
  durationMs: number;
  startedAt: string;
  endedAt: string;
}
/** @stable */
type ConversationStreamEvent = {
  type: 'conversation_start';
  runId: string;
  participants: readonly string[];
  seed: string;
  timestamp: string;
} | {
  type: 'conversation_resumed';
  runId: string;
  participants: readonly string[];
  transcript: readonly ConversationTurn[];
  timestamp: string;
} | {
  type: 'turn_start';
  runId: string;
  index: number;
  speaker: string;
  turnId: string;
  attempt: number;
  timestamp: string;
} | {
  type: 'turn_text_delta';
  runId: string;
  index: number;
  speaker: string;
  turnId: string;
  text: string;
  timestamp?: string;
} | {
  type: 'turn_retry';
  runId: string;
  index: number;
  speaker: string;
  turnId: string;
  attempt: number;
  reason: string;
  timestamp: string;
} | {
  type: 'turn_end';
  runId: string;
  turn: ConversationTurn;
  timestamp: string;
} | {
  type: 'conversation_end';
  runId: string;
  result: ConversationResult;
  timestamp: string;
};
//#endregion
//#region src/conversation/journal.d.ts
interface ConversationJournalEntry {
  runId: string;
  startedAt: string;
  /** Set when the run reaches a terminal state. */
  halted?: HaltReason;
  endedAt?: string;
  turns: ConversationTurn[];
}
interface ConversationJournal {
  /**
   * Load any prior state for `runId`. Returns `undefined` for a fresh run.
   * Implementations MUST NOT mutate the returned object — the runner clones
   * before continuing — but the runtime treats absence and emptiness
   * identically, so a journal with zero turns is equivalent to "fresh."
   */
  loadRun(runId: string): Promise<ConversationJournalEntry | undefined>;
  /**
   * Initialise journal state for a fresh run. Called once per run, before any
   * `appendTurn`. Idempotent: calling with an existing runId is a no-op if
   * the entry already exists with the same `startedAt`.
   */
  beginRun(runId: string, startedAt: string): Promise<void>;
  /**
   * Append a committed turn. The runner only calls this AFTER the turn's
   * backend stream completed and the credit total has been updated, so an
   * appended turn is observed-committed and never speculative.
   */
  appendTurn(runId: string, turn: ConversationTurn): Promise<void>;
  /**
   * Record the run's terminal halt reason + end time. Once called, the run
   * is observed-final; subsequent `loadRun` returns the same halt.
   */
  recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void>;
}
/** In-memory `ConversationJournal` — suitable for testing and single-process runs. */
declare class InMemoryConversationJournal implements ConversationJournal {
  private readonly entries;
  loadRun(runId: string): Promise<ConversationJournalEntry | undefined>;
  beginRun(runId: string, startedAt: string): Promise<void>;
  appendTurn(runId: string, turn: ConversationTurn): Promise<void>;
  recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void>;
}
/**
 * JSONL on disk. One line per record; first line is the `begin`, subsequent
 * lines are `turn` records, terminal line is `halt`. Replays the whole file
 * on `loadRun` — cheap for the conversation sizes this is designed for
 * (thousands of turns, not millions). For huge runs, plug in a real DB
 * adapter; the interface is small.
 *
 * Reads and appends over the shared append-only spine (`durable/jsonl-file`): each
 * `appendTurn` / `recordHalt` finishes a short write and calls `fsync`, so a process
 * crash between writes never loses an acknowledged turn, and a crash DURING one leaves
 * an uncommitted final line that the next read skips and the next append truncates.
 */
declare class FileConversationJournal implements ConversationJournal {
  private readonly path;
  constructor(path: string);
  loadRun(runId: string): Promise<ConversationJournalEntry | undefined>;
  beginRun(runId: string, startedAt: string): Promise<void>;
  appendTurn(runId: string, turn: ConversationTurn): Promise<void>;
  recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void>;
  private appendRecord;
}
//#endregion
//#region src/conversation/journal-sql.d.ts
/**
 * Minimal SQL driver shape. Implementations forward to whichever client the
 * deployment already uses; agent-runtime takes no opinion on which.
 *
 * Parameter placeholders MUST be `?` (positional). All adapters listed in the
 * file header accept this convention.
 */
interface SqlAdapter {
  /** Execute a write statement (INSERT/UPDATE/DELETE/DDL). */
  exec(sql: string, params?: readonly unknown[]): Promise<{
    rowsAffected: number;
  }>;
  /** Execute a read statement (SELECT). Returns rows as plain objects. */
  query<TRow = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<TRow[]>;
}
/**
 * Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1
 * consumers don't have to write the wrapper themselves; the runtime never
 * imports `@cloudflare/workers-types` directly (peer-style typing).
 */
declare function d1ToSqlAdapter(db: D1DatabaseLike): SqlAdapter;
/**
 * Structural type matching the surface of `D1Database` we depend on, so the
 * SDK never imports `@cloudflare/workers-types`. Consumers pass their real
 * `D1Database` from `env.DB` and TS structural compatibility lines it up.
 */
interface D1DatabaseLike {
  prepare(sql: string): D1StmtLike;
}
interface D1StmtLike {
  bind(...params: unknown[]): D1StmtLike;
  run(): Promise<unknown>;
  all<TRow = unknown>(): Promise<{
    results?: TRow[];
  }>;
}
/**
 * SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
 * start/halt timestamps + halt reason) and turns (one row per committed turn,
 * payload is the ConversationTurn JSON). Replays the turns table on
 * `loadRun` and writes append-only per `appendTurn`.
 */
declare class SqlConversationJournal implements ConversationJournal {
  private readonly db;
  private readonly table;
  /**
   * @param db    SQL adapter (D1, postgres, sqlite, libSQL — all work)
   * @param table Table-name prefix; the journal creates `${table}_runs` and
   *              `${table}_turns`. Lets multiple journals share a database
   *              without colliding (e.g. one per product surface).
   */
  constructor(db: SqlAdapter, table?: string);
  /**
   * Create the journal's tables if absent. Idempotent. Call once at deploy
   * (or at app boot) — running on every request is harmless but adds latency.
   */
  migrate(): Promise<void>;
  loadRun(runId: string): Promise<ConversationJournalEntry | undefined>;
  beginRun(runId: string, startedAt: string): Promise<void>;
  appendTurn(runId: string, turn: ConversationTurn): Promise<void>;
  recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void>;
}
//#endregion
//#region src/durable/sql-run-store.d.ts
/** @internal The SQL run context owns the payload schema; this store owns publication. */
interface SqlRunStoreOptions {
  readonly tablePrefix?: string;
  readonly leaseMs?: number;
  readonly heartbeatMs?: number;
}
/** Refuses a competing or stale SQL run owner before it can publish new work. */
declare class SqlRunOwnershipError extends Error {
  constructor(message: string);
}
/** @internal An immutable ownership capability. Never rebound to a later generation. */
interface SqlRunLease<Payload> {
  readonly signal: AbortSignal;
  readonly records: readonly Payload[];
  append(payload: Payload): Promise<void>;
  release(): Promise<void>;
}
/**
 * Append-only immutable records, published by ONE compare-and-set of the run's head.
 *
 * SqlAdapter has no pinned-connection transaction API. INSERT ... SELECT owner is NOT a
 * fence on MVCC databases: its snapshot can outlive a takeover. Here both publication and
 * takeover UPDATE the SAME row. Unpublished records are harmless, unreachable staging.
 * Healthy appends write only their new payload and one fixed-size head, never the history.
 *
 * Liveness uses a persisted progress counter, not incomparable host clocks. A contender must
 * observe the SAME generation/counter for leaseMs before replacing it with a CAS. Every
 * heartbeat and publication advances that counter. The interval is stored per run so a
 * differently configured contender cannot shorten an existing owner's lease.
 * @internal
 */
declare function openSqlRunStore<Payload>(db: SqlAdapter, runId: string, options?: SqlRunStoreOptions): Promise<{
  readonly namespace: string;
  read(): Promise<readonly Payload[]>;
  acquire(signal?: AbortSignal): Promise<SqlRunLease<Payload>>;
}>;
//#endregion
//#region src/runtime/supervise/completion-gate.d.ts
/**
 * The deployable completion oracle passed to {@link gateOnDeliverable}: a `check` that
 * decides DELIVERED (settles `valid` ⟺ it passes) plus an optional `describe` of what the spawn
 * was supposed to produce. The check reads the child's output — never the model judging itself.
 *
 * The same check decides a manager's `submit_result`, runs when a manager's turn ends without an
 * accepted result, and supplies the verdict the continuation note reports (`./continuation.ts`).
 */
interface DeliverableSpec<Out = unknown> {
  /** The deployable check that decides DELIVERED. Return a `CheckVerdict` to report the items it
   *  read and one `FAIL <item> <where>: <reason>` line per failed item; `true` or a passing verdict
   *  delivers. Throw `CheckUnavailableError` (or anything) when the check could not run: that is
   *  never a verdict on the result. */
  check: (out: Out) => boolean | CheckVerdict | Promise<boolean | CheckVerdict>;
  /** What the spawn was supposed to produce — surfaced in traces/reports. */
  describe?: string;
  /** Judge the run's current state with no submitted result. Runtime calls it when a manager's
   *  turn ends and no result reached the check during that turn. Omit for a check that reads only
   *  the submitted value. */
  checkState?: () => boolean | CheckVerdict | Promise<boolean | CheckVerdict>;
  /** `verbatim` (the default) returns the check's FAIL lines to the manager; `pass-only` tells it
   *  only that the check failed and how many times it has read the check, for a check whose tests
   *  must stay hidden. */
  feedback?: 'verbatim' | 'pass-only';
  /** True when the score comes from sealed cases the manager never sees. Stated in the note. */
  sealed?: boolean;
}
/**
 * Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the
 * inner verdict. Handles both `execute` shapes (one-shot `Promise<ExecutorResult>` and
 * streaming `AsyncIterable<UsageEvent>` + `resultArtifact()`); the check runs once the inner
 * executor has produced its output. The inner `score` is preserved; only `valid` is gated.
 */
declare function gateOnDeliverable<Out>(inner: Executor<Out>, deliverable: DeliverableSpec<Out>): Executor<Out>;
interface ExecutorResultMapping<Out> {
  outRef: string;
  out: Out;
  verdict?: DefaultVerdict;
}
/**
 * Transform a Runtime executor's terminal artifact without losing its private
 * profile-materialization attestation or altering its measured spend. This is
 * the composition point for deterministic post-processing and grading; callers
 * must not rebuild an Executor around a model transport merely to change `out`.
 */
declare function mapExecutorResult<In, Out>(inner: Executor<In>, map: (result: ExecutorResult<In>, task: unknown) => ExecutorResultMapping<Out> | Promise<ExecutorResultMapping<Out>>): Executor<Out>;
//#endregion
//#region src/runtime/supervise/detector-monitor.d.ts
interface WatchTraceOptions {
  /** The detectors to run online. Defaults to a stuck-loop + error-streak panel. */
  readonly detectors?: ReadonlyArray<StreamingDetector>;
  /** Fired for each signal a detector raises — the seam that raises a `finding` on the bus. */
  readonly onSignal?: (signal: DetectorSignal, span: ToolSpan) => void | Promise<void>;
}
/** The default online panel for a tool-call pipe: a worker repeating the same call, or hammering
 *  consecutive errors. (No-progress needs a domain progress-probe, so it is opt-in, not default.)
 *
 *  Coverage note: `repeated-action` works for EVERY harness (it needs only tool name + args, which
 *  every adapter provides). `error-streak` needs per-call status — opencode carries it inline
 *  (`state.status`, VALIDATED live), but claude-code/codex tool-call parts do NOT (their errors live
 *  in separate result blocks not yet decoded), so error-streak is silent for those until result-block
 *  decoding is added + live-validated. It is in the panel because it is correct where status exists. */
declare function defaultToolDetectors(): StreamingDetector[];
/** Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an
 *  unsubscribe. A defensive `argHash` failure (circular args) never throws out of the side-channel. */
declare function watchTrace(source: TraceSource, opts?: WatchTraceOptions): () => void;
//#endregion
//#region src/runtime/supervise/event-bus.d.ts
/**
 *
 * The child→parent message bus: the ONE pipe carrying every message a worker, sub-driver, or
 * analyst sends up to the driver — settled outputs, questions, and trace-analyst findings. It
 * unifies channels that were ad-hoc before (the settled-worker cursor, the ask-parent question
 * channel, and analyst results) into a single typed primitive with two lanes:
 *
 *   - PASS-THROUGH (`subscribe`): every published event reaches subscribers immediately — the
 *     express lane for online steering and live observation (a UI, a hook, the parent's box).
 *   - STANDBY (`pull`): events also queue so the driver consumes them on its own cadence. The queue
 *     is PRIORITY-ordered: a higher-`priority` event (a blocking question) is bumped ahead of
 *     queued settles/findings so the driver sees it first; ties resolve FIFO by publish order.
 *
 * Observability is first-class (A++): every event is stamped with a monotonic `seq` and wall-clock
 * `at`, the full ordered `history()` is retained as current-process audit evidence, and `stats()`
 * exposes published/pulled counts by kind. Subscribers receive the stamped record, not a bare event.
 *
 * The interface is transport-agnostic on purpose. Same box → this in-process queue. Cross box →
 * the SAME publish/pull/subscribe surface backed by a durable mailbox on the parent's box (children
 * POST events with at-least-once retry; payloads are blob refs so the event stays small). Consumers
 * depend only on this interface, so distribution is a transport swap, never an architecture change.
 *
 * @experimental
 */
/** Every bus event is a discriminated union member keyed by `type`. */
interface BusEvent {
  readonly type: string;
}
/** A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 *  `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms). */
interface BusRecord<E extends BusEvent> {
  readonly seq: number;
  readonly at: number;
  readonly priority: number;
  readonly event: E;
}
interface PublishOptions {
  /** Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
   *  this so it bumps to the front of the driver's inbox. */
  readonly priority?: number;
  /** Whether the event enters the pull queue (default true). Set `false` for record-only events —
   *  the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
   *  `subscribe` observers, but the parent must never `pull` its own outbound message back. */
  readonly queue?: boolean;
}
interface BusStats {
  readonly published: number;
  readonly pulled: number;
  /** Count published per event `type`. */
  readonly byKind: Readonly<Record<string, number>>;
}
/** The child→parent coordination bus surface: publish, priority-ordered pull, pass-through subscribe, history, and stats.
 * @experimental In-process only — the durable cross-process mailbox this interface is designed
 * to admit is not implemented (docs/agent-managed-compute/README.md). */
interface EventBus<E extends BusEvent> {
  /** Stamp the event, await every subscriber in order, then make it pull-visible. A subscriber
   *  failure leaves the event invisible and retrying the SAME event object reuses the exact stamp.
   *  This lets an awaited product observer commit its record before a supervisor can consume it. */
  publish(event: E, opts?: PublishOptions): Promise<BusRecord<E>>;
  /** Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
   *  ties broken FIFO by `seq`; `undefined` when nothing matches. */
  pull(kinds?: ReadonlyArray<E['type']>): E | undefined;
  /** {@link EventBus.pull}, returning the stamped record, so a consumer can later acknowledge the
   *  exact event it received by `seq`. */
  pullRecord(kinds?: ReadonlyArray<E['type']>): BusRecord<E> | undefined;
  /** The queued, not-yet-pulled records in publish order (filtered by `kinds` when given), as a
   *  copy: reading it never changes what `pull` returns next. */
  queued(kinds?: ReadonlyArray<E['type']>): ReadonlyArray<BusRecord<E>>;
  /** Register a pass-through handler; it receives the stamped record of every event published after
   *  registration. Returns an unsubscribe fn. */
  subscribe(handler: (record: BusRecord<E>) => void | Promise<void>): () => void;
  /** Count of queued, not-yet-pulled events (filtered by `kinds` when given). */
  pending(kinds?: ReadonlyArray<E['type']>): number;
  /** The full ordered log of every event published in this process (audit evidence, not replay). */
  history(): ReadonlyArray<BusRecord<E>>;
  /** Throughput counters for observability dashboards. */
  stats(): BusStats;
}
/** Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane.
 * @experimental In-process queue; durability is a transport swap that does not exist yet. */
declare function createEventBus<E extends BusEvent>(now?: () => number): EventBus<E>;
//#endregion
//#region src/mcp/detached-coder.d.ts
/** @experimental The structured coder result the sandbox-session path decodes + gates. */
interface CoderOutput {
  /** Branch the agent wrote the patch on. */
  branch: string;
  /** Unified diff (`git diff <base>..HEAD`). */
  patch: string;
  testResult: {
    passed: boolean;
    output: string;
  };
  typecheckResult: {
    passed: boolean;
    output: string;
  };
  diffStats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  /** Optional reviewer commentary surfaced by the agent. */
  reviewerNotes?: string;
}
//#endregion
//#region src/mcp/delegation-store.d.ts
/** @stable */
interface DelegationStore {
  /**
   * Read every persisted record. Called once, by
   * `DelegationTaskQueue.restore`, before any write. A missing backing
   * file is an empty store; an unparseable one throws
   * `DelegationStateCorruptError`.
   */
  loadAll(): Promise<DelegationRecord[]>;
  /** Insert or replace the record keyed by `record.taskId`. */
  upsert(record: DelegationRecord): Promise<void>;
  /**
   * Resolve an idempotency key to the taskId that claimed it, if any.
   * The queue serves submit-time dedupe from its rehydrated in-memory
   * index; this read exists for consumers that share a store across
   * processes without holding the full record set.
   */
  lookupIdempotencyKey(key: string): Promise<string | undefined>;
  /** Delete the named records — the retention-cap eviction path. */
  remove(taskIds: readonly string[]): Promise<void>;
}
/**
 * The persisted delegation state exists but cannot be parsed into
 * records. Fail loud: silently starting empty over a corrupt journal
 * would erase delegation history and re-run idempotent work. Opt into
 * recovery explicitly via `FileDelegationStoreOptions.recoverCorrupt`
 * (the bin maps `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` onto it),
 * which archives the corrupt file and starts fresh.
 *
 * @stable
 */
declare class DelegationStateCorruptError extends AgentEvalError$1 {
  constructor(message: string, options?: {
    cause?: unknown;
  });
}
/**
 * A delegation-store read or write failed (filesystem error, store
 * called before `loadAll`, ...). Once the queue observes one, it stops
 * accepting new submissions — accepting work it cannot journal would
 * silently demote durable mode to in-memory mode.
 *
 * @stable
 */
declare class DelegationPersistenceError extends AgentEvalError$1 {
  constructor(message: string, options?: {
    cause?: unknown;
  });
}
/** In-memory `DelegationStore` — suitable for single-process use and tests. @stable */
declare class InMemoryDelegationStore implements DelegationStore {
  private readonly records;
  loadAll(): Promise<DelegationRecord[]>;
  upsert(record: DelegationRecord): Promise<void>;
  lookupIdempotencyKey(key: string): Promise<string | undefined>;
  remove(taskIds: readonly string[]): Promise<void>;
}
/** @stable */
interface FileDelegationStoreOptions {
  /** Absolute path of the JSON state file. Parent directories are created on first write. */
  filePath: string;
  /**
   * When the state file exists but cannot be parsed, archive it to
   * `<filePath>.corrupt-<timestamp>` and start empty instead of
   * throwing `DelegationStateCorruptError`. Default false.
   */
  recoverCorrupt?: boolean;
}
/**
 * JSON-file persistence for the delegation queue. Each write serializes
 * the full record set and lands it atomically (write to a sibling tmp
 * file, then `rename`), so readers never observe a torn file — a crash
 * mid-write leaves the previous snapshot intact. Writes are serialized
 * internally; concurrent `upsert`/`remove` calls cannot interleave.
 *
 * Built for the MCP server's scale (one stdio process, hundreds of
 * records): full-snapshot writes keep the format trivially inspectable
 * and corruption-detectable without a database dependency.
 *
 * @stable
 */
declare class FileDelegationStore implements DelegationStore {
  private readonly filePath;
  private readonly recoverCorrupt;
  private readonly records;
  private loaded;
  private writeTail;
  private tmpSeq;
  constructor(options: FileDelegationStoreOptions);
  loadAll(): Promise<DelegationRecord[]>;
  upsert(record: DelegationRecord): Promise<void>;
  lookupIdempotencyKey(key: string): Promise<string | undefined>;
  remove(taskIds: readonly string[]): Promise<void>;
  private assertLoaded;
  private enqueueWrite;
  private writeSnapshot;
}
//#endregion
//#region src/mcp/delegation-trace.d.ts
/**
 * One span of a delegation's compact trace. Flat (parent linkage by id), all
 * values JSON-safe scalars — `FileDelegationStore` round-trips records
 * through `JSON.stringify`. `meta` carries the span's attributes (GenAI
 * semconv keys + `tangle.loop.*` extensions) exactly as the OTEL sink emits
 * them, so a consumer can re-export journal traces losslessly.
 *
 * @experimental
 */
interface DelegationTraceSpan {
  spanId: string;
  /** Absent on the tree root. */
  parentSpanId?: string;
  /** `'loop'` | `'loop.round'` | `'loop.iteration'` (or a sink-specific name). */
  name: string;
  /** Topology level: loop root, plan round, or iteration branch. */
  kind: 'loop' | 'round' | 'branch';
  startMs: number;
  endMs: number;
  meta?: Record<string, string | number | boolean>;
}
/** Default cap on spans retained per delegation record. @experimental */
declare const DELEGATION_TRACE_MAX_SPANS = 512;
/** Default cap on the serialized trace payload per record, in bytes. @experimental */
declare const DELEGATION_TRACE_MAX_BYTES: number;
/** @experimental */
interface DelegationTraceCaps {
  /** Default {@link DELEGATION_TRACE_MAX_SPANS}. */
  maxSpans?: number;
  /** Default {@link DELEGATION_TRACE_MAX_BYTES}. Approximate — measured as the
   *  sum of per-span `JSON.stringify` lengths. */
  maxBytes?: number;
}
/** @experimental */
interface CappedDelegationTrace {
  trace: DelegationTraceSpan[];
  /** True when oldest spans were dropped to honor the caps. */
  truncated: boolean;
}
/**
 * Derive the compact span tree for ONE loop run from its buffered
 * `LoopTraceEvent` stream. Same reconstruction as the OTEL exporter
 * ({@link buildLoopSpanNodes}); tolerates partial streams.
 *
 * @experimental
 */
declare function buildDelegationTraceSpans(events: ReadonlyArray<LoopTraceEvent>): DelegationTraceSpan[];
/**
 * Enforce the trace caps over an ordered (oldest-first) span list. Drops the
 * OLDEST spans first and reports `truncated: true` when anything was dropped;
 * the newest span always survives, so a non-empty input never caps to empty.
 * Dropping a parent may orphan surviving children's `parentSpanId` references
 * — acceptable for the flat journal shape; consumers treat unresolved parents
 * as roots.
 *
 * @experimental
 */
declare function capDelegationTrace(spans: ReadonlyArray<DelegationTraceSpan>, caps?: DelegationTraceCaps): CappedDelegationTrace;
/**
 * Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId
 * (mirroring the OTEL emitter's buffering) and hands the derived compact
 * spans to `onSpans` when a run reaches `loop.ended`. `settle()` drains runs
 * that never ended — a hard-aborted loop still leaves its partial tree in the
 * journal, unlike the OTEL path which drops it.
 *
 * @experimental
 */
interface DelegationTraceCollector {
  emitter: LoopTraceEmitter;
  /** Flush buffered events of runs that never reached `loop.ended`. */
  settle(): void;
}
/** Build a `DelegationTraceCollector` that buffers loop-trace events and converts them to spans on settle. @experimental */
declare function createDelegationTraceCollector(onSpans: (spans: DelegationTraceSpan[]) => void): DelegationTraceCollector;
/**
 * Fan one `LoopTraceEvent` stream into several emitters — e.g. the
 * process-wide OTEL exporter AND the per-delegation journal collector.
 * `undefined` entries are skipped; returns `undefined` when nothing is left
 * so callers keep the kernel's "no emitter, no events" fast path.
 *
 * @experimental
 */
declare function composeLoopTraceEmitters(...emitters: ReadonlyArray<LoopTraceEmitter | undefined>): LoopTraceEmitter | undefined;
//#endregion
//#region src/mcp/types.d.ts
/**
 * Every delegation profile a queued record can carry. One owner: the tool schemas and validators
 * that filter on a profile read this list, so a profile added here cannot be one a tool refuses.
 * @experimental
 */
declare const delegationProfiles: readonly ["coder", "researcher", "ui-auditor"];
/** @experimental */
type DelegationProfile = (typeof delegationProfiles)[number];
/** @experimental */
type DelegationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
/**
 * Minimal `CoderTask` overrides exposed over the MCP wire. The full
 * `CoderTask` carries fields the kernel synthesizes from `goal` +
 * `repoRoot` — the agent only edits the few that materially gate
 * validator behavior.
 *
 * @experimental
 */
interface DelegateCodeConfig {
  testCmd?: string;
  typecheckCmd?: string;
  forbiddenPaths?: string[];
  maxDiffLines?: number;
}
/** @experimental */
interface DelegateCodeArgs {
  /** Natural-language description of what the coder must accomplish. */
  goal: string;
  /** Absolute path inside the sandbox where the repo lives. */
  repoRoot: string;
  /** Optional free-form context the agent surfaces in the prompt prelude. */
  contextHint?: string;
  /**
   * When > 1, dispatches `multiHarnessCoderFanout` across the delegate's configured exact profiles
   * and picks the highest-scoring passing patch. Default 1.
   */
  variants?: number;
  /** Validator + prompt overrides the agent knows for this repo. */
  config?: DelegateCodeConfig;
  /** Multi-tenant scope (customer-id, workspace-id). */
  namespace?: string;
}
/** @experimental */
interface DelegateCodeResult {
  taskId: string;
  /** Best-effort hint — coder loops can take minutes-to-hours. */
  estimatedDurationMs?: number;
}
/** @experimental */
interface DelegateResearchConfig {
  recencyWindow?: {
    since?: string;
    until?: string;
  };
  maxItems?: number;
  minConfidence?: number;
}
/** @experimental */
interface DelegateResearchArgs {
  question: string;
  namespace: string;
  scope?: string;
  sources?: ResearchSource[];
  variants?: number;
  config?: DelegateResearchConfig;
}
/** @experimental */
interface DelegateResearchResult {
  taskId: string;
  estimatedDurationMs?: number;
}
/** @experimental */
interface FeedbackRefersTo {
  kind: 'delegation' | 'artifact' | 'outcome';
  /** For `'delegation'`, this is the taskId. */
  ref: string;
}
/** @experimental */
interface FeedbackRating {
  /** [0, 1]. */
  score: number;
  label?: 'good' | 'bad' | 'neutral' | 'mixed';
  notes: string;
}
/** @experimental */
interface DelegateFeedbackArgs {
  refersTo: FeedbackRefersTo;
  rating: FeedbackRating;
  by: 'agent' | 'user' | 'downstream-judge';
  /** ISO timestamp; defaults to server clock when omitted. */
  capturedAt?: string;
  namespace?: string;
}
/** @experimental */
interface DelegateFeedbackResult {
  recorded: true;
  id: string;
}
/** @experimental */
interface DelegationStatusArgs {
  taskId: string;
  /**
   * Return the delegation's compact loop-trace span tree alongside the
   * status. Default false — status polls stay light; opt in when you need
   * the topology (which iterations ran, where they were placed, what each
   * cost) rather than just the state machine.
   */
  includeTrace?: boolean;
}
/** @experimental */
interface DelegationProgress {
  iteration: number;
  phase: string;
}
/** @experimental */
interface DelegationError {
  message: string;
  kind: string;
}
/**
 * Polymorphic `result` field: `CoderOutput` when the underlying profile
 * is `'coder'`, a structurally-typed research output when `'researcher'`.
 * The MCP wire carries it as JSON either way.
 *
 * @experimental
 */
type DelegationResultPayload = {
  profile: 'coder';
  output: CoderOutput;
} | {
  profile: 'researcher';
  output: ResearchOutputShape;
} | {
  profile: 'ui-auditor';
  output: UiAuditorDelegationOutput;
};
/**
 * Wire-shape of a completed UI-audit delegation. The `findings` array
 * contains every finding persisted to the workspace during the run,
 * already enriched with `id` and `createdAt` by the writer. `workspaceDir`
 * is the absolute path to the workspace; `indexFile` is the workspace-
 * relative path to the regenerated index.md.
 *
 * @experimental
 */
interface UiAuditorDelegationOutput {
  workspaceDir: string;
  indexFile: string;
  findings: UiFinding[];
  /** Total iterations the loop ran for this delegation. */
  iterations: number;
}
/** @experimental */
type UiAuditLensFilter = readonly UiLens[];
/** Optional per-route capture spec the agent surfaces over the wire. */
interface DelegateUiAuditRoute {
  /** Stable route name (used in screenshot filenames + finding metadata). */
  name: string;
  /** Fully-qualified URL. */
  url: string;
  /** Viewports to capture at. Defaults to `[{ width: 1280, height: 800 }]`. */
  viewports?: readonly {
    width: number;
    height: number;
  }[];
  /** Default false. Full-page captures for the broad lenses. */
  fullPage?: boolean;
  /** Selector to wait for before capture. */
  waitFor?: string;
}
/** @experimental */
interface DelegateUiAuditConfig {
  /**
   * Lenses to iterate. Default: every lens except `'other'`. Order is
   * preserved — the driver iterates lens-by-lens.
   */
  lenses?: UiAuditLensFilter;
  /** Maximum total iterations across all (lens × route) pairs. Default 33 (11 lenses × 3 routes). */
  maxIterations?: number;
  /** Maximum concurrent iterations within a single plan() round. Default 2. */
  maxConcurrency?: number;
  /** Free-form product context surfaced to the judge. */
  productContext?: string;
}
/** @experimental */
interface DelegateUiAuditArgs {
  /** Workspace root for the audit (absolute path). */
  workspaceDir: string;
  /** Routes to audit. Must be non-empty. */
  routes: readonly DelegateUiAuditRoute[];
  /** Multi-tenant scope. */
  namespace?: string;
  config?: DelegateUiAuditConfig;
}
/** @experimental */
interface DelegateUiAuditResult {
  taskId: string;
  estimatedDurationMs?: number;
}
/**
 * Provider-neutral research output carried over the MCP boundary. The MCP
 * layer accepts this structural shape instead of coupling its wire contract to
 * one research implementation.
 *
 * @experimental
 */
interface ResearchOutputShape {
  items: unknown[];
  citations: unknown[];
  proposedWrites: unknown[];
  gaps?: string[];
  notes?: string;
  [key: string]: unknown;
}
/** @experimental */
interface DelegationStatusResult {
  taskId: string;
  profile: DelegationProfile;
  status: DelegationStatus;
  progress?: DelegationProgress;
  result?: DelegationResultPayload;
  error?: DelegationError;
  costUsd?: number;
  startedAt: string;
  completedAt?: string;
  /** Compact loop-trace span tree; present only when `includeTrace: true` was passed and spans were recorded. */
  trace?: DelegationTraceSpan[];
  /** Present when oldest trace spans were dropped to honor the trace caps. */
  traceTruncated?: true;
  /** Inherited trace identity recorded at submit — join key into the caller's trace. */
  traceId?: string;
  /** Caller span that dispatched the delegation, when one was inherited. */
  parentSpanId?: string;
}
/** @experimental */
interface DelegationHistoryArgs {
  namespace?: string;
  profile?: DelegationProfile;
  /** ISO date — only delegations started at-or-after `since` are returned. */
  since?: string;
  /** Default 50. Hard cap 500. */
  limit?: number;
}
/** @experimental */
interface DelegationFeedbackSnapshot {
  id: string;
  score: number;
  label?: FeedbackRating['label'];
  by: DelegateFeedbackArgs['by'];
  notes: string;
  capturedAt: string;
}
/** @experimental */
interface DelegationHistoryEntry {
  taskId: string;
  profile: DelegationProfile;
  namespace?: string;
  args: DelegateCodeArgs | DelegateResearchArgs | DelegateUiAuditArgs;
  status: DelegationStatus;
  feedback?: DelegationFeedbackSnapshot[];
  costUsd?: number;
  startedAt: string;
  completedAt?: string;
  /**
   * True when the record carries a journaled loop trace. History stays
   * light by design — fetch the spans via
   * `delegation_status { taskId, includeTrace: true }`.
   */
  hasTrace: boolean;
  /** Inherited trace identity recorded at submit — join key into the caller's trace. */
  traceId?: string;
}
/** @experimental */
interface DelegationHistoryResult {
  delegations: DelegationHistoryEntry[];
}
//#endregion
//#region src/mcp/task-queue.d.ts
/** Arguments accepted by the durable delegation queue. @stable */
type DelegationArgs = DelegateCodeArgs | DelegateResearchArgs | DelegateUiAuditArgs;
/**
 * Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
 * persistent stores round-trip records through `JSON.stringify`.
 *
 * @stable
 */
interface DelegationRecord {
  taskId: string;
  profile: DelegationProfile;
  namespace?: string;
  args: DelegationArgs;
  status: DelegationStatus;
  progress?: DelegationProgress;
  result?: DelegationResultPayload;
  error?: DelegationError;
  costUsd?: number;
  startedAt: string;
  completedAt?: string;
  /** Sha-prefix hash of the canonical input — used for idempotency lookup. */
  idempotencyKey?: string;
  /**
   * Caller-generated deterministic id of a detached run (e.g. the sandbox
   * session id a single-tick driver resumes by). Presence is what makes a
   * restored in-flight record resumable via `resumeDelegate`; without it a
   * restart settles the record as failed.
   */
  detachedSessionRef?: string;
  /** Feedback events keyed by this delegation's taskId. */
  feedback: DelegationFeedbackSnapshot[];
  /**
   * Compact loop-trace span tree teed from the delegation's run, oldest
   * spans first. Appended when a delegated loop reaches `loop.ended` and
   * settled (partial buffers included) at the terminal transition. Capped
   * via `capDelegationTrace` — see `traceTruncated`.
   */
  trace?: DelegationTraceSpan[];
  /** Present when oldest trace spans were dropped to honor the trace caps. */
  traceTruncated?: true;
  /**
   * Inherited trace identity (the queue's `traceContext` at submit time —
   * typically `readTraceContextFromEnv()`), distinct from the span payload:
   * a journal consumer joins records into the parent trace by these ids
   * without parsing spans. Restored records keep their persisted identity.
   */
  traceId?: string;
  /** Caller span that dispatched the delegation, when one was inherited. */
  parentSpanId?: string;
}
/** @stable */
interface SubmitInput<Args extends DelegationArgs> {
  profile: DelegationProfile;
  args: Args;
  namespace?: string;
  idempotencyKey?: string;
  /**
   * Records the detached-run resume key on the new record. The submitted
   * `run` function still executes in-process exactly as without it — the
   * ref only matters after a restart, when `DelegationTaskQueue.restore`
   * hands it to the `resumeDelegate` seam instead of failing the record.
   */
  detachedSessionRef?: string;
  /**
   * Runs the underlying delegation. The queue passes a fresh `AbortSignal`
   * and a `report` channel for incremental progress updates. The function
   * MUST resolve with the typed `DelegationResultPayload['output']`; the
   * queue wraps it with the profile tag.
   */
  run: (ctx: DelegationRunContext) => Promise<DelegationResultPayload['output']>;
}
/** @stable Context handed to a `SubmitInput.run` function. */
interface DelegationRunContext {
  signal: AbortSignal;
  report(progress: DelegationProgress): void;
  /** The `detachedSessionRef` recorded at submit, when one was supplied. */
  detachedSessionRef?: string;
  /**
   * Replace the record's detached-run resume key — the detached dispatch path
   * calls this once the sandbox id is known so the persisted ref names a
   * resolvable box. Ignored after the record settles (a cancel racing the
   * rebind is legitimate; the ref no longer matters then). Throws on an empty
   * ref — erasing the resume key would silently make the record unresumable.
   */
  updateDetachedSessionRef(ref: string): void;
  /**
   * Per-delegation loop-trace sink, always provided by the queue. Events
   * emitted here are journaled onto the record as a compact span tree
   * (`record.trace`) when each loop run ends and at the delegation's
   * terminal transition. Delegates forward it into their `runAgentRounds` ctx,
   * composed with any process-wide OTEL emitter
   * (`composeLoopTraceEmitters`). Optional in the type so consumer-built
   * contexts stay source-compatible.
   */
  traceEmitter?: LoopTraceEmitter;
}
/** @stable */
interface SubmitOutput {
  taskId: string;
  /** True when a prior matching `idempotencyKey` returned an existing record. */
  reused: boolean;
}
/**
 * One observation of a detached run, mapped 1:1 from a single-tick driver
 * (e.g. the sandbox SDK's `driveTurn`, which reports
 * completed | running | failed per pass). `running` schedules another tick
 * after `intervalMs`; `completed` / `failed` settle the record.
 *
 * @stable
 */
type DelegationResumeTick = {
  state: 'running';
} | {
  state: 'completed';
  output: DelegationResultPayload['output'];
  costUsd?: number;
} | {
  state: 'failed';
  error: DelegationError;
};
/** @stable */
interface DelegationResumeContext {
  /** Fired by `cancel(taskId)`; the driver should stop the remote run when it can. */
  signal: AbortSignal;
  report(progress: DelegationProgress): void;
}
/**
 * Re-attaches restored in-flight records to their detached runs. The queue
 * calls `tick` repeatedly — it never awaits a whole run — so the driver can
 * be a thin wrapper over a one-pass primitive: resolve the run named by
 * `detachedSessionRef`, advance/poll it once, report where it stands. A
 * thrown error settles the record as failed; `failed` ticks are treated as
 * terminal and are not retried.
 *
 * @stable
 */
interface DelegationResumeDriver {
  tick(task: {
    record: DelegationRecord;
    detachedSessionRef: string;
  }, ctx: DelegationResumeContext): Promise<DelegationResumeTick>;
  /** Delay between `running` ticks, in milliseconds. Default 5000. */
  intervalMs?: number;
}
/** @stable */
interface DelegationTaskQueueOptions {
  /** ID generator override; default `randomTaskId`. */
  generateId?: () => string;
  /** Clock override; default `() => new Date().toISOString()`. */
  now?: () => string;
  /**
   * Journal for record mutations and the `restore()` load source. Default
   * `InMemoryDelegationStore` — observably identical to an unjournaled
   * queue. Pass a `FileDelegationStore` through
   * `DelegationTaskQueue.restore` for state that survives a restart;
   * constructing with `new` never loads prior state.
   */
  store?: DelegationStore;
  /** Resume seam for restored in-flight records that carry a `detachedSessionRef`. */
  resumeDelegate?: DelegationResumeDriver;
  /**
   * Maximum number of terminal (completed | failed | cancelled) records
   * retained; the oldest (by `completedAt`) are evicted from memory and
   * store once the cap is exceeded. Default unbounded.
   */
  maxTerminalRecords?: number;
  /**
   * Observes the first store failure. After it fires, the queue refuses
   * new submissions and `flush()` rejects with the same error. Default:
   * rethrow on a microtask — an unhandled crash — because silently
   * degrading durable mode to memory-only would lie to the caller.
   */
  onPersistError?: (error: DelegationPersistenceError) => void;
  /**
   * Inherited trace identity stamped on every submitted record
   * (`traceId` / `parentSpanId`). The bin passes
   * `readTraceContextFromEnv()` so journal consumers can join delegation
   * records into the caller's trace. Restored records keep the identity
   * they were persisted with.
   */
  traceContext?: TraceContext;
}
/** In-process queue for async delegation tasks — submit, cancel, poll status, and read history. @stable */
declare class DelegationTaskQueue {
  private readonly records;
  private readonly controllers;
  private readonly byIdempotencyKey;
  private readonly generateId;
  private readonly now;
  private readonly store;
  private readonly resumeDelegate?;
  private readonly maxTerminalRecords;
  private readonly onPersistError;
  private readonly traceContext;
  private persistTail;
  private persistFailure;
  constructor(options?: DelegationTaskQueueOptions);
  /**
   * Construct a queue from previously-persisted state. Loads every record
   * from `options.store`, rebuilds the idempotency index (so a re-submitted
   * identical task returns the prior taskId and its terminal state), then:
   *
   *   - terminal records stay queryable via `status()` / `history()`
   *   - in-flight records with a `detachedSessionRef` re-attach through
   *     `options.resumeDelegate` and report `running`
   *   - other in-flight records settle as failed — their driver died with
   *     the previous process and the result is unrecoverable
   *
   * The retention cap applies to the loaded set as well.
   */
  static restore(options?: DelegationTaskQueueOptions): Promise<DelegationTaskQueue>;
  /**
   * Kick off a delegation in the background. Returns immediately. The
   * `taskId` is queryable via `status` once this method returns. Throws
   * the recorded `DelegationPersistenceError` once the store has failed —
   * the queue does not accept work it cannot journal.
   */
  submit<Args extends DelegationArgs>(input: SubmitInput<Args>): SubmitOutput;
  /**
   * Snapshot the current state of a delegation. Returns `undefined` for
   * unknown ids so callers can distinguish missing from terminal.
   * `includeTrace` attaches the journaled loop-trace span tree — off by
   * default so status polls stay light.
   */
  status(taskId: string, opts?: {
    includeTrace?: boolean;
  }): DelegationStatusResult | undefined;
  /**
   * Abort an in-flight delegation. Returns `false` if the task is unknown
   * or already terminal. The underlying `run` function MUST honor the
   * abort signal for the cancel to take effect; the queue marks the
   * record `cancelled` regardless so a misbehaving runner cannot pin the
   * UI on `running` forever.
   */
  cancel(taskId: string): boolean;
  /**
   * Append a feedback event to the matching delegation. Returns `false`
   * when `ref` does not name a known taskId — the caller should still
   * record the feedback through a different surface (artifact/outcome
   * kinds are not queue-bound).
   */
  attachFeedback(taskId: string, snapshot: DelegationFeedbackSnapshot): boolean;
  /**
   * Query the recorded delegations. Returns entries newest-first (by
   * `startedAt`), truncated to `limit`.
   */
  history(args?: DelegationHistoryArgs): DelegationHistoryEntry[];
  /**
   * Await every journal write issued so far. Rejects with the recorded
   * `DelegationPersistenceError` when any of them failed. Call before
   * handing the store's backing file to another process.
   */
  flush(): Promise<void>;
  /** Test-only — number of in-flight (non-terminal) records. */
  inflightCount(): number;
  private execute;
  private appendTrace;
  private rehydrate;
  private startResume;
  private driveResume;
  /**
   * Journal the resumed segment of a detached run as one compact span. The
   * resume driver re-attaches after a process restart, so the original
   * process's loop events are gone — this span records the post-restart
   * observation window (re-attach → terminal tick) under the
   * `'detached-resume'` driver tag, keeping restored delegations observable
   * in the journal alongside trace-carrying live runs.
   */
  private appendResumeSpan;
  private persist;
  private persistRemoval;
  private failPersistence;
  private enforceRetention;
}
/**
 * Best-effort stable hash for use as `idempotencyKey`. Not cryptographic;
 * collisions only affect dedupe, never correctness.
 *
 * @stable
 */
declare function hashIdempotencyInput(value: unknown): string;
//#endregion
//#region src/mcp/detached-turn.d.ts
/**
 * Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6).
 * Discriminated on `state`; `failed` is terminal and deterministic per the
 * SDK contract — re-invoking with the same ids returns the same outcome.
 *
 * @experimental
 */
type DriveTurnTick = {
  state: 'completed';
  text: string;
  result: Record<string, unknown>;
} | {
  state: 'running';
  startedAt?: Date;
  elapsedMs?: number;
} | {
  state: 'failed';
  error: string;
};
/**
 * The box surface detached turns need. `SandboxInstance`
 * (`@tangle-network/sandbox` >= 0.6) satisfies it structurally; tests pass
 * in-memory fakes. `_sessionCancel` is the SDK's remote-cancellation surface —
 * optional here because older SDKs / fakes may not expose it; when present it
 * is invoked on abort so the remote run actually stops.
 *
 * @experimental
 */
interface DriveTurnCapableBox {
  driveTurn(message: string, opts: {
    sessionId: string;
    turnId?: string;
    wallCapMs?: number;
  }): Promise<DriveTurnTick>;
  _sessionCancel?(id: string): Promise<void>;
}
/**
 * Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between
 * submit and box acquisition — a record restored in that window is not
 * resumable (there is no box to resume on) and the resume driver fails it
 * loud rather than dispatching onto a guessed box.
 *
 * @experimental
 */
interface DetachedSessionRefParts {
  sessionId: string;
  sandboxId?: string;
}
/**
 * Encode ref parts into the JSON-safe string stored on the record:
 * `session=<id>` before the box exists, `sandbox=<id>;session=<id>` once
 * bound. Ids must not contain the `;`/`=` delimiters.
 *
 * @experimental
 */
declare function formatDetachedSessionRef(parts: DetachedSessionRefParts): string;
/** Parse a `detachedSessionRef` string back to parts; throws `ValidationError` on malformed input. @experimental */
declare function parseDetachedSessionRef(raw: string): DetachedSessionRefParts;
/** @experimental The terminal payload of a finished detached turn. */
interface DetachedTurn {
  /** Final assistant text. */
  text: string;
  /** The SDK's cached AgentExecutionResult-shape record for the turn. */
  result: Record<string, unknown>;
}
/**
 * Synthesize the terminal event array a detached turn settles through. Shaped
 * so the existing event-stream output adapters (coder, researcher) parse it:
 * `data.result` for adapters that read a structured terminal record, `data.text`
 * for adapters that scan assistant text for the fenced result block.
 *
 * @experimental
 */
declare function detachedTurnEvents(sessionId: string, turn: DetachedTurn): SandboxEvent[];
/** @experimental */
interface RunDetachedTurnOptions {
  /** Sandbox client used to acquire the box (the delegate's executor client). */
  client: SandboxClient;
  /** Profile + overrides for box acquisition — same spec the streaming path uses. */
  spec: AgentRunSpec<unknown>;
  /** The full turn prompt; consumed by `driveTurn`'s dispatch leg. */
  prompt: string;
  /** Deterministic resume key, minted at submit time (`parseDetachedSessionRef(ref).sessionId`). */
  sessionId: string;
  /**
   * Called once the box exists, with its sandbox id. Callers persist
   * `formatDetachedSessionRef({ sandboxId, sessionId })` onto the record here so
   * a restart can resolve the box again.
   */
  bindSandbox(sandboxId: string): void;
  signal: AbortSignal;
  report(progress: DelegationProgress): void;
  /** Delay between `running` ticks (ms). Default 5000. */
  tickIntervalMs?: number;
  /** Wall-clock cap forwarded to `driveTurn` — the SDK cancels and fails a session past it. */
  wallCapMs?: number;
  /**
   * Loop-trace sink. When set, the detached turn synthesizes a
   * single-iteration loop span tree (`runId` = `sessionId`, driver
   * `'detached-turn'`) so trace-context inheritance survives the detached
   * path — the same events the streaming `runAgentRounds` path would emit, minus
   * per-token telemetry: `driveTurn` yields one terminal payload, so token
   * and cost figures are structurally unavailable; zero observed subtotals are
   * marked incomplete under this driver tag.
   */
  traceEmitter?: LoopTraceEmitter;
  /** Physical placement stamped on the synthesized dispatch event. Default `'sibling'`. */
  placement?: 'sibling' | 'fleet';
}
/**
 * Dispatch one detached turn and advance it to a terminal state with
 * `driveTurn` ticks. The first tick dispatches (idempotent on `sessionId`);
 * subsequent ticks poll. On abort the remote session is cancelled via
 * `_sessionCancel` when the box exposes it. The box is torn down on every
 * in-process exit path (success, failure, abort) — only a process death skips
 * teardown, which is exactly the case the resume driver re-attaches to.
 *
 * @experimental
 */
declare function runDetachedTurn(options: RunDetachedTurnOptions): Promise<DetachedTurn>;
/** @experimental */
interface DetachedTurnResumeDriverOptions {
  /**
   * Resolve the live box owning a detached session. The bin wires this to the
   * sandbox client's `get(sandboxId)`; throw when the box no longer exists —
   * a thrown tick settles the record as failed, which is the truth.
   */
  resolveSandbox(sandboxId: string): Promise<DriveTurnCapableBox>;
  /**
   * Rebuild the turn prompt from the persisted record. Only consumed by
   * `driveTurn`'s dispatch leg — i.e. when the previous process died after
   * binding the box but before the session was dispatched. Must reproduce the
   * prompt the delegate would have sent.
   */
  buildMessage(record: DelegationRecord): string;
  /**
   * Map a completed turn onto the delegation's typed output payload (parse +
   * validate per profile). Throw when the resumed result does not pass the
   * profile's gate — the queue settles the record as failed with that error.
   */
  settleOutput(turn: DetachedTurn, record: DelegationRecord, ctx: {
    signal: AbortSignal;
  }): Promise<DelegationResultPayload['output']> | DelegationResultPayload['output'];
  /** Delay between `running` ticks (ms). Default 5000. */
  intervalMs?: number;
  /** Wall-clock cap forwarded to `driveTurn` on every tick. */
  wallCapMs?: number;
}
/**
 * Build the `driveTurn`-backed {@link DelegationResumeDriver}. Each `tick()`
 * is one settle/poll/dispatch pass:
 *
 *   - ref without a sandbox binding → `failed` (`DetachedSessionUnboundError`):
 *     the previous process died before a box existed; there is nothing to resume.
 *   - `driveTurn` `completed` → `settleOutput` → `completed` tick.
 *   - `running` → progress via `ctx.report`, `running` tick (queue re-ticks
 *     after `intervalMs`).
 *   - `failed` → `failed` tick (`DetachedTurnFailedError`) — terminal per the
 *     SDK's deterministic-failure contract.
 *
 * Abort: the queue stops ticking once `cancel()` flips the record, so remote
 * cancellation is hooked onto `ctx.signal` (once per task) and fires
 * `_sessionCancel` when the SDK surface exposes it. The driver never deletes
 * boxes — it cannot know whether `sandboxId` is a disposable sibling or a
 * fleet machine, and destroying a fleet machine would be unrecoverable.
 *
 * @experimental
 */
declare function createDetachedTurnResumeDriver(options: DetachedTurnResumeDriverOptions): DelegationResumeDriver;
//#endregion
//#region src/mcp/executor.d.ts
/** @experimental */
interface DelegationExecutor {
  /** Sandbox client the kernel calls. Returned with `describePlacement` set. */
  readonly client: SandboxClient;
  /** Best-effort one-liner used in stderr boot logs and diagnostics. */
  describe(): string;
  /**
   * Where delegated work physically runs. `sibling` and `fleet` placements are
   * session-backed (boxes expose `driveTurn`, so detached dispatch + resume
   * apply); `in-process` spawns local harness CLIs with no sandbox session to
   * detach. Optional so consumer-implemented executors stay source-compatible;
   * absent means "unknown" and detached dispatch is not enabled for it.
   */
  readonly placement?: 'sibling' | 'fleet' | 'in-process';
}
/** @experimental */
interface SiblingSandboxExecutorOptions {
  client: SandboxClient;
}
/**
 * Wrap a raw sandbox SDK client so the kernel emits
 * `loop.iteration.dispatch` events with `{ placement: 'sibling', sandboxId }`.
 *
 * The returned client `.create()` delegates to the underlying client; the
 * only added behavior is a `describePlacement` tag the kernel reads.
 *
 * @experimental
 */
declare function createSiblingSandboxExecutor(options: SiblingSandboxExecutorOptions): DelegationExecutor;
/**
 * Minimal `SandboxFleet` surface the fleet executor calls. Declared
 * structurally so tests can pass an in-memory stub without instantiating the
 * sandbox SDK.
 *
 * @experimental
 */
interface FleetHandle {
  readonly fleetId: string;
  /** Machine ids in dispatch-eligible order. The executor round-robins. */
  readonly ids: ReadonlyArray<string>;
  /** Resolve a machine id to its `SandboxInstance` — that machine is mounted
   * on the fleet's shared workspace, so any diff the worker writes lands on
   * every other fleet machine's filesystem too. */
  sandbox(machineId: string): Promise<SandboxInstance>;
}
/** @experimental */
interface FleetWorkspaceExecutorOptions {
  fleet: FleetHandle;
  /**
   * Override the machine-selection policy. Default = round-robin across
   * `fleet.ids`, skipping the optional `excludeMachineIds` set (typically the
   * coordinator machine the MCP server is running on).
   */
  selectMachine?: (call: {
    callIndex: number;
    ids: ReadonlyArray<string>;
  }) => string;
  /**
   * Machine ids to skip during default round-robin. Set to the caller's own
   * machineId so workers don't compete with the orchestrator on the same VM.
   */
  excludeMachineIds?: ReadonlyArray<string>;
}
/**
 * Build an executor that resolves each delegated iteration to an existing
 * machine in `fleet`. The fleet's shared-workspace policy means the worker
 * machine sees the caller's filesystem — diffs land in-place with no
 * cross-sandbox copy step.
 *
 * @experimental
 */
declare function createFleetWorkspaceExecutor(options: FleetWorkspaceExecutorOptions): DelegationExecutor;
//#endregion
//#region src/mcp/delegates.d.ts
/** @experimental */
interface DelegateRunCtx {
  signal: AbortSignal;
  report(progress: DelegationProgress): void;
  /**
   * Detached-run resume key recorded on the queue record at submit time
   * (`formatDetachedSessionRef`). Present only when the submit path requested
   * detached dispatch — its presence is what routes a session-backed delegate
   * onto the `driveTurn` tick path instead of holding a stream.
   */
  detachedSessionRef?: string;
  /** Rebind the record's resume key (e.g. once the sandbox id is known). */
  updateDetachedSessionRef?(ref: string): void;
  /**
   * Per-delegation trace sink supplied by the queue — loop events emitted
   * here land on the delegation record as a compact span tree. Delegates
   * compose it with their configured OTEL emitter so both sinks observe
   * the same stream.
   */
  traceEmitter?: LoopTraceEmitter;
}
/** @experimental The coder delegate closure — given the coder args + run context, drives the
 *  sandbox-session coder path to a validated `CoderOutput`. `detachedSessionDelegate` is the
 *  built-in implementation; the queue invokes one of these per coder delegation. */
type CoderDelegate = (args: DelegateCodeArgs, ctx: DelegateRunCtx) => Promise<CoderOutput>;
/**
 * UI-auditor delegate — fully consumer-injected. agent-runtime ships no
 * default factory because execution belongs to a caller-supplied exact
 * agent profile and Runtime executor.
 *
 * @experimental
 */
type UiAuditorDelegate = (args: DelegateUiAuditArgs, ctx: DelegateRunCtx) => Promise<UiAuditorDelegationOutput>;
/** @experimental Structured review verdict over a coder candidate. */
interface CoderReview {
  /** Gate: only approved candidates are eligible to win. */
  approved: boolean;
  /** Readiness 0..1, used by the `highest-readiness` winner-selection strategy. */
  readiness: number;
  /** The reviewer's own words. Selection reads `approved` and `readiness`; anything a reviewer
   *  wants a caller to READ belongs here, because nothing else on this type is surfaced. */
  notes?: string;
}
/**
 *
 * Optional adversarial reviewer over a coder candidate that already passed
 * mechanical validation (tests/typecheck/forbidden/diff/no-op/secrets). Folded
 * from the ai-trading-blueprint delegation MCP: a candidate is only eligible to
 * win if the reviewer approves it. The reviewer is the consumer's seam — an LLM
 * judge, a `pnpm review` command, anything returning a `CoderReview`.
 *
 * @experimental
 */
type CoderReviewer = (output: CoderOutput, task: CoderTask, ctx: {
  signal: AbortSignal;
}) => Promise<CoderReview> | CoderReview;
/**
 * @experimental Winner-selection strategy among validated (+ reviewed) candidates on the
 * sandbox-session path. The base strategies (`highest-score` / `smallest-diff` /
 * `first-approved`) delegate to the shared `selectValidWinner`; `highest-readiness` is the
 * reviewer-only strategy this path keeps that the generic selector does not express. Default
 * `highest-score`.
 */
type DetachedWinnerSelection = 'highest-score' | 'smallest-diff' | 'highest-readiness' | 'first-approved';
/** @experimental */
interface DetachedSessionDelegateOptions {
  /**
   * Execution placement. Pass a {@link DelegationExecutor} (sibling or fleet)
   * to control where worker iterations land. `sandboxClient` is a
   * convenience shorthand that wraps the client in a sibling executor — pass
   * one or the other, not both.
   */
  executor?: DelegationExecutor;
  /**
   * Convenience shorthand for sibling placement. Equivalent to
   * `executor: createSiblingSandboxExecutor({ client: sandboxClient })`.
   */
  sandboxClient?: SandboxClient;
  /**
   * The worker's exact authored `AgentProfile` (§1.5: the system authors profiles). It is the sole
   * harness/provider/model/prompt authority for the single-coder path and the default identity for
   * repeated fanout shots.
   */
  workerProfile: AgentProfile;
  /** Optional exact identities for heterogeneous fanout. Omit to repeat `workerProfile`. */
  fanoutProfiles?: ReadonlyArray<AgentProfile>;
  /** Hard cap on the kernel's per-batch concurrency. Default 4. */
  maxConcurrency?: number;
  /**
   * Optional adversarial reviewer. When set, a candidate must pass mechanical
   * validation AND `reviewer.approved` to be eligible to win — empty/secret/
   * test-failing patches are already gone; this catches the "compiles + passes
   * but wrong/unsafe" class the deterministic validator can't see.
   */
  reviewer?: CoderReviewer;
  /** Winner-selection strategy among eligible candidates. Default `highest-score`. */
  winnerSelection?: DetachedWinnerSelection;
  /**
   * Loop trace emitter forwarded into every delegated `runAgentRounds`. Wire
   * `createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
   * does) so delegated build-loops export their topology spans to the OTLP /
   * Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
   * are a cheap no-op when it isn't. Configurable by construction.
   *
   * Detached single-variant turns (taken when `ctx.detachedSessionRef` is set)
   * bypass `runAgentRounds`; `runDetachedTurn` synthesizes a single-iteration loop
   * event stream for them so this emitter observes detached work too.
   */
  traceEmitter?: LoopTraceEmitter;
  /** Tick cadence (ms) for the detached single-variant path. Default 5000. */
  detachedTickIntervalMs?: number;
  /** Wall-clock cap (ms) forwarded to `driveTurn` for detached turns. */
  detachedWallCapMs?: number;
}
/**
 * Build the sandbox-session coder delegate. It drives `runAgentRounds` against the project's
 * sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
 * topology.
 *
 * This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
 * `SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
 * (driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
 * the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.
 *
 * For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
 * per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate runs
 * held-stream by default and only its OPTIONAL cross-restart resume (the `driveTurn` tick) is opt-in
 * behind `MCP_ENABLE_DETACHED_RESUME`.
 *
 * @experimental
 */
declare function detachedSessionDelegate(options: DetachedSessionDelegateOptions): CoderDelegate;
/**
 * Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for
 * the delegate's live dispatch AND the resume driver's settle/message
 * rebuilding, so a resumed record reproduces exactly the task the original
 * process dispatched.
 *
 * @experimental
 */
declare function coderTaskFromArgs(args: DelegateCodeArgs): CoderTask;
/** @experimental */
interface SettleDetachedCoderTurnOptions {
  task: CoderTask;
  /** Session id of the detached turn — used as the synthesized event id. */
  sessionId: string;
  signal: AbortSignal;
  /** Same gate as the streaming path: an unapproved candidate cannot win. */
  reviewer?: CoderReviewer;
}
/**
 * Settle a completed detached coder turn through the same gate the streaming
 * path applies: parse the terminal payload with the coder output adapter,
 * run the mechanical validator (tests/typecheck/forbidden/diff/no-op/secrets),
 * then the optional reviewer. Throws when nothing survives — a resumed or
 * detached run must not return an unvalidated patch.
 *
 * SCOPE NOTE (detached/resume): the detached `driveTurn`-tick + cross-restart resume path is
 * bound to the `runAgentRounds` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
 * journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
 * advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
 * `createDetachedTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.
 *
 * @experimental
 */
declare function settleDetachedCoderTurn(turn: DetachedTurn, options: SettleDetachedCoderTurnOptions): Promise<CoderOutput>;
//#endregion
//#region src/mcp/feedback-store.d.ts
/** @stable */
interface FeedbackEvent {
  id: string;
  refersTo: DelegateFeedbackArgs['refersTo'];
  rating: DelegateFeedbackArgs['rating'];
  by: DelegateFeedbackArgs['by'];
  capturedAt: string;
  namespace?: string;
}
/** @stable */
interface FeedbackStore {
  /** Append a new event. Never dedupes — every rating is its own event. */
  put(event: FeedbackEvent): Promise<void>;
  /**
   * List events filtered by `namespace`. When `namespace` is omitted, list
   * across all namespaces. Returns events in insertion order.
   */
  list(filter?: {
    namespace?: string;
    refersToRef?: string;
  }): Promise<FeedbackEvent[]>;
}
/** In-memory `FeedbackStore` — suitable for single-process use and tests. @stable */
declare class InMemoryFeedbackStore implements FeedbackStore {
  private readonly events;
  put(event: FeedbackEvent): Promise<void>;
  list(filter?: {
    namespace?: string;
    refersToRef?: string;
  }): Promise<FeedbackEvent[]>;
}
/**
 * Project a `FeedbackEvent` down to the snapshot shape carried on
 * `delegation_history` entries.
 *
 * @stable
 */
declare function eventToSnapshot(event: FeedbackEvent): DelegationFeedbackSnapshot;
//#endregion
//#region src/mcp/tools/delegate.d.ts
/** MCP tool name for the `delegate` generic-delegation tool. @stable */
declare const DELEGATE_TOOL_NAME = "delegate";
/** Human-readable description of the `delegate` MCP tool, injected into the tool manifest. @stable */
declare const DELEGATE_DESCRIPTION: string;
/** JSON Schema for `delegate` tool arguments (`intent` + optional trace id). @stable */
declare const DELEGATE_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: {
    readonly intent: {
      readonly type: "string";
      readonly description: "What you want accomplished, as an outcome. The supervisor authors the worker.";
    };
    readonly runId: {
      readonly type: "string";
      readonly description: "Optional trace-correlation id for this delegation.";
    };
  };
  readonly required: readonly ["intent"];
  readonly additionalProperties: false;
};
/** Parsed `delegate` tool arguments. */
interface DelegateArgs {
  intent: string;
  runId?: string;
}
/** Parse and validate raw MCP tool input into typed `DelegateArgs`; throws `TypeError` on bad input. @stable */
declare function validateDelegateArgs(raw: unknown): DelegateArgs;
/** The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 *  the no-winner reason) PLUS the conserved spend of the whole delegation. */
type DelegateResult = {
  status: 'winner';
  out: unknown;
  outRef: string;
  spentTotal: Spend;
} | {
  status: 'no-winner';
  reason: string;
  error?: DelegateError;
  spentTotal: Spend;
};
/** What killed a delegation, projected for the calling agent: the rejection's name and message.
 *  `reason` is a four-word code (`driver-failed`), and a code alone is not diagnosable — the
 *  supervisor attaches the rejection to the result precisely so a caller can read it. */
interface DelegateError {
  name: string;
  message: string;
}
/** @stable */
interface DelegateHandlerOptions {
  /** The supervisor brain's router substrate (REQUIRED — the default supervisor is router-brained). */
  router: RouterTransportConfig;
  /** Exact executable supervisor identity selected by the trusted composition root. */
  supervisorProfile: AgentProfile;
  /** WHERE the authored workers run. Required for `supervise()` to spawn anything. */
  backend: ExecutorConfig;
  /** The completion oracle the authored workers settle against (settled ⟺ delivered). */
  deliverable?: DeliverableSpec;
  /** Restrict the run to this subset of models. */
  allowedModels?: readonly string[];
}
/**
 * Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` /
 * `backend` / `deliverable`); each call routes the agent's intent to `delegate()` and returns the
 * delivered output with its conserved cost.
 */
declare function createDelegateHandler(options: DelegateHandlerOptions): (raw: unknown) => Promise<DelegateResult>;
//#endregion
//#region src/mcp/server.d.ts
/** @experimental */
interface McpServerOptions {
  /**
   * Required to enable `delegate` — the ONE generic delegation verb. Inject the supervisor
   * substrate: its brain `router`, the worker `backend`, and the completion `deliverable`. The
   * supervisor AUTHORS its own worker from the agent's intent, so there is no worker profile to
   * wire here.
   */
  delegateSupervisor?: DelegateHandlerOptions;
  /**
   * Required to enable delegate_ui_audit. Wire one that executes an exact
   * agent profile through Runtime and returns the provider-neutral UI audit result.
   */
  uiAuditorDelegate?: UiAuditorDelegate;
  /** Override the default in-memory feedback store. */
  feedbackStore?: FeedbackStore;
  /** Override the default in-memory task queue. */
  queue?: DelegationTaskQueue;
  /**
   * Extra tools to serve alongside the delegation tools, for example
   * `createCoordinationTools(...).tools`. Registered after the built-ins; a
   * duplicate name throws so delegation tools cannot be shadowed silently.
   */
  extraTools?: McpToolDescriptor$1[];
  /**
   * Inherited trace identity (`readTraceContextFromEnv()`) stamped on every
   * record the DEFAULT queue creates. Ignored when `queue` is supplied —
   * pass `traceContext` to that queue's constructor instead.
   */
  traceContext?: TraceContext;
  /** Server display name surfaced via `initialize`. Default `'agent-runtime-mcp'`. */
  serverName?: string;
  /** Server version surfaced via `initialize`. Default = the package version baked at build time. */
  serverVersion?: string;
}
/** @experimental */
interface McpServer {
  /** Tools currently registered (depend on which delegates were wired). */
  readonly tools: ReadonlyMap<string, McpToolDescriptor$1>;
  /** The underlying queue — exposed so tests can introspect it. */
  readonly queue: DelegationTaskQueue;
  /** The feedback store — exposed for the same reason. */
  readonly feedbackStore: FeedbackStore;
  /** Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications). */
  handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null>;
  /** Drive the server on a stdio-shaped transport until `stop()` is called. */
  serve(transport?: McpTransport): Promise<void>;
  /** Stop a `serve` call. Subsequent requests are rejected. */
  stop(): void;
}
/**
 * Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents.
 *
 * @experimental
 */
declare function createMcpServer(options?: McpServerOptions): McpServer;
/**
 * In-process pair of `Readable` + `Writable` streams suitable for driving
 * `server.serve(...)` from a test. Returns the agent-side stream (the
 * client writes to it) and the server-side stream (the test reads from it).
 *
 * @experimental
 */
declare function createInProcessTransport(): {
  transport: McpTransport;
  clientWrite(line: string): void;
  clientClose(): void;
  readServer(): Promise<JsonRpcResponse[]>;
};
//#endregion
//#region src/mcp/tools/spawn-resource-paths.d.ts
/**
 * Inline resources a manager hands a child by PATH instead of by content.
 *
 * The canonical profile schema knows two resource kinds, `inline` (a content string) and `github`.
 * A manager that wants a child to receive a data file therefore had one way to do it: emit the
 * bytes inside its own `spawn` tool call. That is a transcription by a language model, and it does
 * not survive size. Measured 2026-09-12 (discovery-lab `mech-interp-foundations-glm2-b-20260912b`):
 * a 29,144-character base64 payload on the manager's disk reached three children as 15,928
 * characters with 11 substitutions, and a fourth child received the literal placeholder the
 * manager meant to replace. Seven blind-check attempts across two runs delivered no data.
 *
 * `{ kind: 'inline', name, path }` lets the coordination server be the transport: it reads the
 * file from the manager's workspace, fills `content`, and the profile that reaches the schema,
 * the journal, and the provider is an ordinary inline resource. Nothing downstream changes; the
 * model's output stops carrying the bytes.
 *
 * Where the bytes come from is a {@link SpawnResourceReader}, and there are two:
 *  - a HOST DIRECTORY, for a manager whose driver runs on this host (a loopback bridge with a
 *    `cwd`), read through the descriptor-identity checks below;
 *  - the manager's OWN EXECUTION ENVIRONMENT, for a manager inside a provider sandbox, read
 *    through the environment's `read()`. The coordination server cannot see a sandbox filesystem,
 *    but the provider that created the sandbox can, and it is already in hand.
 *
 * The second reader exists because the first one's absence was not a refusal a manager could
 * work around. Measured 2026-09-17 (discovery-lab `mech-interp-foundations-sandbox-a-20260917h`):
 * a sandbox-rooted director, refused by path, fell back to emitting its files as content and got
 * 5 characters wrong in 24,008, destroying 3 of 7 files including its instrument and both
 * drivers. At that rate 20 KB of mounts all arrive intact about 2% of the time, and gzip makes it
 * worse by turning one wrong character into total loss. Four consecutive runs in that lane lost
 * their research children to this. There is no encoding that fixes a transcription channel; the
 * only fix is a channel with no model in it.
 *
 * Fail-closed rules, each with the reason a manager needs to fix its call:
 *  - no reader available → refused (neither a host directory nor an environment with `read`)
 *  - absolute path or `..` escape → refused by both readers; a symlink that resolves outside the
 *    root → refused by the host reader (the environment reader delegates containment to the
 *    provider, which serves only the sandbox's own workspace)
 *  - not a regular file → refused
 *  - over {@link SPAWN_RESOURCE_PATH_MAX_BYTES} → refused naming the bound
 *  - bytes that are not valid UTF-8 → refused; `content` is a string, so binary data is encoded
 *    (base64) by the manager first, exactly as it would be for a content resource
 */
declare const SPAWN_RESOURCE_PATH_MAX_BYTES: number;
/** One successful read: the bytes as a string plus the identity the journal records. */
interface SpawnResourceBytes {
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
}
type SpawnResourceRead = ({
  readonly ok: true;
} & SpawnResourceBytes) | {
  readonly ok: false;
  readonly reason: string;
};
/**
 * Where a by-path resource's bytes come from. `describe` names the source in a refusal so a
 * manager reading "path X does not exist under the workspace root" and "path X: sandbox read
 * failed" can tell which filesystem was consulted.
 */
interface SpawnResourceReader {
  readonly describe: string;
  read(path: string): Promise<SpawnResourceRead>;
}
/** The host-directory reader: a manager whose workspace is a directory this process can open. */
declare function hostDirectoryReader(root: string): SpawnResourceReader;
/**
 * The environment reader: a manager running inside a provider environment whose `read()` serves
 * its own workspace. The provider owns containment — it will not serve a path outside the box —
 * but the relative-path and `..` rules are enforced here too, so the refusal names the rule the
 * manager broke rather than whatever the provider says about an escape it declined.
 *
 * `read()` returns a string, so an environment cannot hand back bytes that are not UTF-8; the
 * provider has already decoded. The size bound is checked on what arrives.
 */
declare function environmentReader(environment: {
  readonly id: string;
  read(path: string): Promise<string>;
}): SpawnResourceReader;
interface ResolvedSpawnResourcePath {
  /** The `resources` location, e.g. `files[0].resource` or `skills[2]`. */
  readonly at: string;
  /** The path as the manager wrote it. */
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}
type ResolveSpawnResourcePathsResult = {
  readonly ok: true;
  readonly profile: unknown;
  readonly resolved: readonly ResolvedSpawnResourcePath[];
} | {
  readonly ok: false;
  readonly at: string;
  readonly reason: string;
};
/**
 * Replace every `{ kind: 'inline', name, path }` under `profile.resources` with the inline
 * resource its bytes make. Returns the profile unchanged (same reference) when nothing names a
 * path, so callers pay nothing on the common case.
 *
 * `source` is a host directory (a string, kept for the existing call sites), a
 * {@link SpawnResourceReader}, or `undefined` when the manager has neither — in which case a path
 * is refused with the reason and what to do instead.
 */
declare function resolveSpawnResourcePaths(profile: unknown, source: string | SpawnResourceReader | undefined): Promise<ResolveSpawnResourcePathsResult>;
//#endregion
//#region src/mcp/tools/coordination.d.ts
/** A worker the driver has drained via `await_event`. */
interface SettledWorker {
  readonly id: string;
  readonly status: 'done' | 'down';
  /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
  readonly assignmentId?: string;
  /** Exact profile/task/candidate identity authorized for this node. */
  readonly identity?: NodeExecutionIdentity;
  /** Stable effective execution plan, or an explicit unknown receipt. */
  readonly materialization?: ProfileMaterializationReceipt;
  /** Backend bindings for each attempt, in durable oldest-first order. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>;
  /** Conserved spend. Missing means unavailable; unknown accounting remains explicitly unknown. */
  readonly spent?: Spend;
  readonly score?: number;
  readonly valid?: boolean;
  readonly outRef?: string;
  readonly reason?: string;
  /** Present when the worker's measured spend exceeded its reservation. The pool already charged
   *  the true spend; a `done` worker's output is still its result. */
  readonly budgetViolation?: BudgetViolation;
  /** Structured tool-call evidence, never the worker's final prose. */
  readonly trace: WorkerTraceEvidence;
  /** True when projected from a prior process of the same durable run. */
  readonly resumed?: boolean;
  /** Epoch ms from the durable terminal record — the resolution a progress-based stop rule needs
   *  to answer "how long since anything landed?" without inventing a timestamp at read time. */
  readonly settledAt?: number;
  /** Present when this worker led workers of its own: its team's counts and its own direct
   *  children's results, each readable in full through `observe_agent({ outRef })`. */
  readonly subtree?: SubtreeSummary;
}
type QuestionLevel = 'worker' | 'driver' | 'loop';
type QuestionUrgency = 'continue-without' | 'blocks-step' | 'blocks-run';
interface QuestionOption {
  readonly label: string;
  readonly tradeoff: string;
}
interface Question {
  readonly id: string;
  readonly from: string;
  readonly level: QuestionLevel;
  readonly question: string;
  readonly reason: string;
  readonly urgency: QuestionUrgency;
  readonly options?: ReadonlyArray<QuestionOption>;
}
/** Where a question this driver cannot answer goes next. `answer_question` accepts these and
 *  nothing else, so the decision type states them and nothing else. */
declare const questionEscalationTargets: readonly ["parent", "user"];
type QuestionEscalationTarget = (typeof questionEscalationTargets)[number];
type QuestionDecision = {
  readonly kind: 'answer';
  readonly answer: string;
  readonly by: string;
} | {
  readonly kind: 'defer';
  readonly reason: string;
} | {
  readonly kind: 'escalate';
  readonly to: QuestionEscalationTarget;
  readonly reason: string;
};
interface QuestionRecord extends Question {
  readonly status: 'open' | 'answered' | 'deferred' | 'escalated';
  readonly decision?: QuestionDecision;
  readonly openedAt: number;
}
type QuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed';
/**
 * What one analyst lens may return.
 *
 * Two shapes, because two real producers exist and neither can be dropped. An eval-registry lens
 * returns validated `AnalystFinding`s — the schema every upstream consumer already reads. An
 * authored lens like `failuresAnalyst` returns a written brief for the driver and has no findings
 * to validate against. The union names both, so the boundary can no longer silently accept an
 * unvalidated shape (#630) while the authored lens keeps working.
 */
type AnalystLensOutput = ReadonlyArray<AnalystFinding> | {
  readonly summary: string;
};
/** One lens on the menu `list_analysts` shows and `run_analyst` resolves. */
interface AnalystKind {
  readonly id: string;
  readonly description: string;
  readonly area: string;
}
/**
 * The trace-tool sets a DEFINED analyst may ask for — the exact group names agent-eval's
 * `buildTraceToolsForGroup` accepts, restated here so the `define_analyst` JSON Schema can
 * enumerate them for the model that writes one. Named, not free-form, because the group is the
 * lens's cost ceiling: `all` grants seven trace tools, `discovery` grants three and no deep reads.
 * A name eval does not know throws at registration, which is where the two lists are held together.
 */
declare const analystToolGroupNames: readonly ["all", "discovery", "discoveryAndRead", "discoveryAndSearch", "targeted", "singleTrace"];
type AnalystToolGroupName = (typeof analystToolGroupNames)[number];
/** Bounds on the recursive investigation a defined analyst may run. Each field is optional and is
 *  clamped to {@link ANALYST_DEFINITION_BOUNDS}; omitted fields take the engine's own default. */
interface AuthoredAnalystLimits {
  readonly maxIterations?: number;
  readonly maxLlmCalls?: number;
  readonly maxToolCalls?: number;
  readonly maxOutputChars?: number;
}
/**
 * A trace analyst a MANAGER authored at run time: the research question, the policy for answering
 * it, the trace tools it may use, and the model seat it asks for. Data only.
 *
 * DATA, NEVER CODE, is the whole safety argument. `TraceAnalystDefinition` (agent-eval) also
 * carries `prepareContext` and `postProcess` FUNCTIONS; those are host-authored and are deliberately
 * absent here, because accepting a function from a tool argument would mean executing model-written
 * code inside the coordination handler — the one thing every other verb in this file refuses. What a
 * manager can author is exactly what a prompt can say.
 *
 * The model seat is PROPOSED, not granted: {@link AnalystRegistry.register} resolves `model` to an
 * engine and may refuse it, the same way `preflightSpawn` refuses a worker's model route.
 */
interface AuthoredAnalystDefinition {
  /** Stable lens id. Lowercase, digits and hyphens; it becomes the `kind` passed to `run_analyst`
   *  and the `analyst_id` on every finding, so it is the attribution key. */
  readonly id: string;
  /** One line naming what this lens looks for — what `list_analysts` shows the next manager. */
  readonly description: string;
  /** The finding area this lens reports under (e.g. `coordination`, `tool-use`, `cost`). */
  readonly area: string;
  /** The research question, in the manager's own words. */
  readonly question: string;
  /** How to answer it: evidence rules, what counts as a finding, what to refuse to infer. */
  readonly instructions: string;
  readonly toolGroup: AnalystToolGroupName;
  /** The model seat the lens should run on. Omit to take the run's default analyst engine. */
  readonly model?: string;
  readonly limits?: AuthoredAnalystLimits;
  /** Minimum distinct evidence citations per finding. Default 1. */
  readonly minimumEvidenceCitations?: number;
}
/** Every bound `define_analyst` enforces before a definition reaches a registry.
 *
 *  MOTIVE, stated as numbers, because a fence whose motive cannot be stated is over-engineering:
 *  a defined lens spends real model calls from the run's own account on every settle it is routed
 *  over, and its `instructions` are re-sent on every one of them. So the two fields that multiply
 *  — `instructions` bytes and `maxLlmCalls` — are the ones with hard ceilings, and the ceilings are
 *  twice agent-eval's own defaults (`maxIterations` 12, `maxLlmCalls` 8, `maxToolCalls` 48,
 *  `maxOutputChars` 10_000): enough headroom for a deeper question than the shipped lenses ask,
 *  not enough for one definition to become the dominant cost of a run. */
declare const ANALYST_DEFINITION_BOUNDS: Readonly<{
  idPattern: RegExp;
  maxDescriptionChars: 300;
  maxAreaChars: 64;
  maxQuestionChars: 1000;
  maxInstructionsChars: 20000;
  maxModelChars: 128;
  maxIterations: 24;
  maxLlmCalls: 16;
  maxToolCalls: 96;
  maxOutputChars: 20000;
  maxEvidenceCitations: 10;
  /** Lenses ONE manager may define, counting those it defined in a PRIOR process of a durable run.
   *  This bounds MENU GROWTH, not spend: a definition costs nothing until `run_analyst` is called,
   *  so the failure it stops is a manager that keeps re-authoring a lens instead of running one —
   *  each definition adds a line every later `list_analysts` re-reads. Eight is more than the five
   *  calibrated lenses agent-eval ships. Per-run analyst SPEND is bounded by the conserved pool the
   *  engine draws from, not here. */
  maxDefinitionsPerManager: 8;
}>;
/** What the coordination layer records when a definition is admitted: the exact accepted bytes, the
 *  kind the registry returned, and a digest over the definition so a finding can be traced back to
 *  the words that produced it. */
interface DefinedAnalystRecord {
  readonly definition: AuthoredAnalystDefinition;
  readonly kind: AnalystKind;
  /** Canonical digest of `definition` — the reproducibility key. */
  readonly digest: string;
  readonly definedAt: number;
}
interface AnalystRegistry$1 {
  readonly kinds: ReadonlyArray<AnalystKind>;
  readonly run: (kindId: string, trace: TraceAnalysisStore) => Promise<AnalystLensOutput>;
  /**
   * OPT-IN: admit a MANAGER-AUTHORED lens while the run is in flight, so a driver can change the
   * questions asked of its own children's traces instead of picking from a menu fixed before the
   * run started. Present = `define_analyst` is mounted; absent = the menu is fixed (the status quo).
   *
   * The coordination layer validates and bounds the definition first (see
   * {@link ANALYST_DEFINITION_BOUNDS}) and refuses a duplicate id, so an implementation receives
   * only well-formed, in-bounds definitions. It returns the {@link AnalystKind} the lens is now
   * reachable as; `run_analyst` must resolve that id immediately afterwards. THROWING is the
   * refusal channel — an unavailable model seat, a policy that forbids authored lenses — and the
   * message reaches the manager as the tool result's `reason`, so it can re-author.
   */
  readonly register?: (definition: AuthoredAnalystDefinition) => Promise<AnalystKind> | AnalystKind;
}
/** A trace-analyst result re-entered as a message on the bus (the `finding` event kind). */
interface AnalystFindingEvent {
  readonly fromWorker: string;
  readonly analyst: string;
  /** The analyst's result. ABSENT when the analyst returned `undefined` (no findings); any other
   *  value is canonicalized to finite RFC 8785 JSON at publish (`canonicalFindingEvent`), so
   *  digesting subscribers (the coordination-event id) never throw on analyst-shaped data. */
  readonly findings?: unknown;
}
/** Producer-side cleanliness for the `finding` event. The findings payload is arbitrary analyst
 *  output, the digest a subscriber computes (RFC 8785) throws on ANY `undefined` value — nested
 *  included — and a throwing subscriber leaves the event invisible to EVERY subscriber. The
 *  producer, not the digest, owns keeping the event canonical: an `undefined` payload is stripped
 *  to key-absence, everything else is JSON round-tripped (nested `undefined` object values drop,
 *  `undefined` array slots become `null`), and a payload JSON cannot represent at all (cycle,
 *  BigInt, bare function) becomes a record OF that fact — degraded findings beat a vanished
 *  event. */
declare function canonicalFindingEvent(finding: AnalystFindingEvent): AnalystFindingEvent;
/**
 * One analyst-on-settle ROUTE: which lens runs (`kind`), over WHICH settled workers (`over`),
 * delivered to WHOM (`to`), wrapped in WHAT standing instruction (`directive`). The generalized
 * form of the bare-string entry — a string `k` is exactly `{ kind: k }`: every settle feeds the
 * lens and the findings go to the driver via the bus. This is the analyzes-edge of an agent
 * graph expressed at the coordination layer; the finding is ALWAYS also published on the bus
 * (the audit trail), routing adds delivery, never replaces the record.
 */
interface AnalyzeOnSettleRoute {
  /** The analyst id: a lens id resolved against the `analysts` registry, or — when `agent` is
   *  present — the AGENT analyst's stable identity carried on its finding/steer events (it need
   *  not exist in any registry). */
  readonly kind: string;
  /**
   * Make this analyst a tool-equipped AGENT instead of a registry lens: on each matching settle
   * the runtime spawns this profile as a WORKER through the SAME spawn machinery a driver spawn
   * uses (`Scope.spawn` + the run's `makeWorkerAgent` seam) — so its spend reserves from the
   * conserved pool, its node is journaled and traced like any worker, and a node-pinning seam
   * sees the spawn context marker (`WorkerSpawnContext.analyst`). Its task is `directive` plus
   * the settled worker's tool-trace evidence; its settle OUTPUT is the findings, published as a
   * `finding` event (same canonicalization) and delivered per `to` exactly like registry-analyst
   * findings. A settle that failed publishes `{ analystRunFailed }`; a spawn the pool or fences
   * refuse publishes `{ analystSpawnRefused }` — observable, never a silent drop. An agent
   * analyst's settlement never enters the settled-worker ledger, never feeds the finalizer, and
   * never re-fires the analyst-on-settle hook (no analyst-on-analyst cascade by construction).
   */
  readonly agent?: AgentProfile;
  /** Deliver the findings to this live worker, named by its PROFILE NAME (the stable node
   *  identity a graph pins) or its spawn label. Omit = the driver (bus only). Delivery goes
   *  through the same authorization + steer machinery a driver-authored steer uses and is
   *  recorded as a `steer` event carrying `analyst`, so a routed delivery is observable and a
   *  failed one (`delivered: false`) is a recorded outcome, never a silent drop. */
  readonly to?: string;
  /** Standing instruction wrapped around the findings on a routed delivery — what the recipient
   *  should DO with the analysis. For an AGENT analyst (`agent` set) it is instead the analysis
   *  directive handed to the agent as its task; the routed delivery then carries the bare
   *  findings, because the directive was already consumed upstream. Omit = the bare findings
   *  JSON (and, for an agent analyst, a task of evidence only). */
  readonly directive?: string;
  /** Restrict which settled workers feed this lens, by profile name or spawn label. Omit =
   *  every settled `done` worker. */
  readonly over?: ReadonlyArray<string>;
}
/** One rejected field of an authored analyst definition: which field, and what is wrong with it. */
interface AnalystDefinitionIssue {
  readonly path: string;
  readonly message: string;
}
/**
 * Validate and BOUND one `define_analyst` argument.
 *
 * Every reason is collected, never short-circuited: a manager re-authoring from a partial list of
 * complaints spends a turn per complaint. Numeric limits are CLAMPED rather than rejected — asking
 * for 200 tool calls is a mis-estimate, not a malformed definition, and the accepted value is
 * returned so the manager reads the ceiling it actually got.
 */
declare function parseAuthoredAnalystDefinition(raw: unknown): {
  definition: AuthoredAnalystDefinition;
} | {
  issues: ReadonlyArray<AnalystDefinitionIssue>;
};
/** Normalize the two spellings of an analyst-on-settle entry to the route form. */
declare function normalizeAnalyzeOnSettle(entry: string | AnalyzeOnSettleRoute): AnalyzeOnSettleRoute;
/**
 * Why one parent→child delivery did not land, in the words the MANAGER needs.
 *
 * `DownMessageDeliveryOutcome` is the machine code; this is the sentence beside it. A code alone
 * left the manager to guess whether to retry, spawn, or give up — `already-settled` and
 * `scope-stopped` look alike and need opposite moves. Every refusal a coordination verb returns
 * carries a sentence like these, because the manager cannot see the state that produced it.
 */
declare const downMessageRefusalReasons: Readonly<Record<DownMessageDeliveryOutcome, string>>;
/** The result of handing a question this manager cannot answer to whatever is above it. */
type QuestionEscalationOutcome = {
  readonly delivered: true;
  readonly to: string;
} | {
  readonly delivered: false;
  readonly reason: string;
};
/**
 * Where a question leaves this manager when `ask_parent` is called.
 *
 * Absent means NO INBOX IS CONFIGURED above this manager: `ask_parent` then answers `no-parent`
 * instead of appearing to succeed. That distinction is the whole point of the seam — a manager that
 * escalates a blocking question and reads a bare receipt BLOCKS on an answer nothing is routing to
 * it, and a fail-closed stop policy then refuses to let it finish.
 *
 * `no-parent` is not "the question vanished". It is still published on the bus and journaled, so an
 * external answerer watching the run — the coordination MCP's own `answer_question`, an operator
 * console, a product observer on `onCoordinationEvent` — can still decide it. What `no-parent` says
 * is that the RUNTIME will carry it nowhere by itself, so the manager must not sit and wait.
 *
 * An implementation returns `{ delivered: true, to }` naming who holds the question now, or
 * `{ delivered: false, reason }`. A THROW is also a refusal: its message becomes the reason, so a
 * broken parent channel reads as an undelivered escalation, never as a delivered one.
 */
type EscalateQuestion = (question: QuestionRecord) => Promise<QuestionEscalationOutcome> | QuestionEscalationOutcome;
/** The operator-facing artifact written for every `ask_parent`: which question left, whether
 *  anything received it, and — when nothing did — that the manager itself is now the last decider.
 *  Journaled record-only, so the run's durable coordination log holds every question that was
 *  raised and went unheard. */
interface QuestionEscalationRecord {
  readonly questionId: string;
  readonly from: string;
  readonly urgency: QuestionUrgency;
  readonly delivered: boolean;
  /** Who holds the question now. Absent when nothing received it. */
  readonly to?: string;
  /** Why it was not delivered. Absent on a delivered escalation. */
  readonly reason?: string;
  readonly at: number;
}
/** How a spawn CONTINUES a node's prior work: `'fresh'` starts a brand-new session (the default,
 *  and the only pre-continuity behavior); `'resume'` re-attaches to the node's most recent
 *  SETTLED worker — a NEW live worker is spawned whose spawn context carries the prior worker's
 *  identity ({@link WorkerResumeContext}), and the executor seam owns the actual session
 *  re-attachment. */
type ContinuityMode = 'fresh' | 'resume';
/** The resume lineage a `'resume'` spawn hands the executor seam
 *  ({@link WorkerSpawnContext.resume}). The kernel owns identity, ordering, ledger truth, and
 *  spend continuity (the resumed worker reserves from the same conserved pool); the seam owns the
 *  re-attachment itself — e.g. mapping `ofWorker` to a backend session id. */
interface WorkerResumeContext {
  /** The prior SETTLED worker whose session the new worker continues. */
  readonly ofWorker: string;
  /** 1-based position of the NEW worker in the node's continuity chain: a node spawned once and
   *  resumed once hands the resumed worker `sequence: 2`. */
  readonly sequence: number;
}
/** The exact result of one parent→child delivery attempt. */
type DownMessageDeliveryOutcome = 'delivered' | 'unknown-worker' | 'already-settled' | 'runtime-has-no-inbox' | 'scope-stopped' | 'runtime-error';
/** A durable marker written after authorization and immediately before Runtime calls `Scope.send`.
 * If a process dies with this marker but no matching outcome, delivery is unknown and is never
 * replayed automatically. */
interface DownMessageDeliveryAttempt {
  readonly receiptId: string;
  readonly kind: 'steer' | 'answer';
  readonly toWorker: string;
  readonly instructionDigest: string;
  readonly interrupt: boolean;
  readonly questionId?: string;
}
/** A parent→child delivery result (the down-leg): recorded for observability, never pulled back by
 * the parent. `receiptId` and `instructionDigest` link it to the pre-delivery authorization receipt
 * and attempt marker. */
interface DownMessageEvent {
  readonly receiptId: string;
  readonly toWorker: string;
  readonly instruction: string;
  readonly instructionDigest: string;
  readonly delivered: boolean;
  readonly outcome: DownMessageDeliveryOutcome;
  readonly error?: string;
}
/** Durable authorization receipt written before a continuation reaches a worker. */
interface ContinuationInstruction {
  readonly receiptId: string;
  readonly kind: 'steer' | 'answer';
  readonly toWorker: string;
  readonly instruction: string;
  readonly instructionDigest: string;
  readonly workerIdentity?: NodeExecutionIdentity;
  readonly interrupt: boolean;
  readonly questionId?: string;
}
/** Detached continuation bytes and exact worker identity presented to product authorization before
 * Runtime records or delivers a steer/answer. */
interface DownMessageAuthorizationInput {
  readonly kind: 'steer' | 'answer';
  readonly workerId: string;
  readonly workerIdentity: NodeExecutionIdentity;
  readonly instruction: string;
  readonly interrupt: boolean;
  readonly questionId?: string;
}
/** Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed
 * bytes; throwing refuses delivery. */
interface AuthorizedDownMessage {
  readonly instruction: string;
}
/** Product decision over an exact continuation before it is durably recorded or delivered. */
type AuthorizeDownMessage = (input: DownMessageAuthorizationInput) => AuthorizedDownMessage;
/** Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 *  the driver to `pull`. An `instruction` is the pre-delivery authorization receipt and is retained
 *  as evidence. DOWN (parent→child): steer / answer — record-only (history + subscribers), routed
 *  to the child inbox. SIDEWAYS (child→sibling): mail — also record-only, and deliberately NOT
 *  queued, so peer traffic audits through the parent without flooding the inbox it pulls from.
 *  Receipts are never auto-delivered on restart. New kinds are additive. */
type CoordinationEvent = {
  readonly type: 'question';
  readonly question: QuestionRecord;
} | {
  readonly type: 'settled';
  readonly worker: SettledWorker;
} | {
  readonly type: 'finding';
  readonly finding: AnalystFindingEvent;
} |
/** A direct manager result that passed its injected completion check. Record-only: the caller
 *  already received the tool response, and a restarted manager restores this exact accepted
 *  result instead of running the check or its harness again. */
{
  readonly type: 'submission';
  readonly result: unknown;
} | {
  readonly type: 'steer';
  readonly down: DownMessageEvent;
  /** Present when this steer DELIVERED an analyst's routed findings (an analyzes-edge
   *  traversal), naming the lens — absent on an ordinary driver-authored steer. */
  readonly analyst?: string;
} | {
  readonly type: 'answer';
  readonly down: DownMessageEvent;
  readonly questionId: string;
} | {
  readonly type: 'instruction';
  readonly instruction: ContinuationInstruction;
} | {
  readonly type: 'delivery-attempt';
  readonly attempt: DownMessageDeliveryAttempt;
} | {
  readonly type: 'mail';
  readonly mail: PeerMailEvent;
} |
/** A question left this manager through `ask_parent`, and what became of it. Record-only: the
 *  asker already holds the outcome, and an escalation is evidence for the operator, not an item
 *  in the inbox the manager pulls from. */
{
  readonly type: 'escalation';
  readonly escalation: QuestionEscalationRecord;
} |
/** A manager DEFINED a trace analyst (`define_analyst`). Record-only: the manager already has the
 *  result in its tool return, so queueing it would put its own action in its own inbox. It is the
 *  run artifact that makes an invented lens reproducible — the exact bytes, their digest, and the
 *  owner the durable log stamps beside them. */
{
  readonly type: 'analyst-defined';
  readonly analyst: DefinedAnalystRecord;
} |
/** The manager processed events `await_event` delivered to it. Record-only, and separate from
 *  delivery on purpose: an event delivered to a turn that then FAILED stays unacknowledged, and
 *  the manager's next re-entry names it again instead of losing it with the dead turn. */
{
  readonly type: 'acknowledgement';
  readonly acknowledgement: EventAcknowledgement;
};
/** One acknowledgement record: which delivered events are now processed, and on whose word. */
interface EventAcknowledgement {
  /** Bus `seq` of each acknowledged event, in this process's sequence space. */
  readonly seqs: ReadonlyArray<number>;
  /** `manager`: the manager named them in `await_event`'s `acknowledge`. `turn-completed`: the
   *  driver turn that received them ended normally. `result-accepted`: a submission passed the
   *  completion check after they were delivered. */
  readonly by: 'manager' | 'turn-completed' | 'result-accepted';
  /** The 1-based driver attempt that received them, when the manager has driver attempts. */
  readonly attempt?: number;
}
/** What a manager's coordinator knows about its run, read when the manager is entered again.
 *  Every field comes from the coordinator's own records, never from the manager's environment. */
interface ManagerReentryState {
  /** Rows in this manager's journal (`read_journal`) right now. */
  readonly journalRows: number;
  /** The highest `nextRow` a `read_journal` call has returned, 0 when the manager never read it. */
  readonly journalReadTo: number;
  /** Workers still running. */
  readonly live: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly status: string;
  }>;
  /** Workers that settled, with whether their settlement reached the manager through `await_event`. */
  readonly settled: ReadonlyArray<{
    readonly id: string;
    readonly status: 'done' | 'down';
    readonly valid?: boolean;
    readonly delivered: boolean;
  }>;
  /** Events queued for `await_event` and not yet delivered, including settlements the coordinator
   *  holds but has not queued yet. */
  readonly waiting: ReadonlyArray<{
    readonly type: string;
    readonly worker?: string;
  }>;
  /** Events delivered to a turn that did not complete, and not acknowledged since. */
  readonly unacknowledged: ReadonlyArray<{
    readonly seq: number;
    readonly type: string;
    readonly worker?: string;
    readonly attempt?: number;
  }>;
  /** The last refused `submit_result`, with the refusal the manager was given. */
  readonly lastRejection?: {
    readonly at: number;
    readonly reason: string;
  };
}
/** Immutable task, allocation, identity attribution, and semantic key supplied while a manager's
 * complete worker profile is prepared for one spawn. */
interface WorkerSpawnContext {
  /** Stable assignment identity within this manager. A semantic key wins; otherwise Runtime mints
   * the manager's deterministic pre-factory spawn ordinal so identical unkeyed siblings stay
   * isolated and can recover by issuing the same assignments in the same order. */
  readonly assignmentId: string;
  /** Trusted concrete manager node authorizing this spawn. Never accepted from model arguments. */
  readonly parentNodeId: string;
  /** The exact allocation this node receives after the tool's optional override is merged. */
  readonly budget: Budget;
  /** Detached, deeply immutable task bytes from this spawn request. */
  readonly task: unknown;
  /** Exact trace label selected for this spawn. */
  readonly label: string;
  /** Semantic restart key, when the manager supplied one. */
  readonly key?: string;
  /** Trusted candidate/campaign attribution attached by product authorization. */
  readonly execution?: AgentExecutionRef;
  /** Present (as the analyst id) ONLY when this spawn is an analyst-AGENT run initiated by the
   *  runtime's analyst-on-settle hook ({@link AnalyzeOnSettleRoute.agent}) — authored by the
   *  runtime, never accepted from a driver's tool arguments. A node-pinning `makeWorkerAgent`
   *  reads it to admit the analyst node it would refuse as a driver-authored spawn. */
  readonly analyst?: string;
  /** The EFFECTIVE continuity mode of this spawn — the spawn tool's per-call argument when given,
   *  else the profile name's declared default ({@link CoordinationToolsOptions.continuityByProfile}),
   *  else `'fresh'`. Absent only from producers that predate continuity — read absence as
   *  `'fresh'`. */
  readonly continuity?: ContinuityMode;
  /** Present iff `continuity === 'resume'`: the lineage the executor seam re-attaches with. */
  readonly resume?: WorkerResumeContext;
  /** The settled worker this spawn replaces, when the manager named one (`spawn_worker`'s
   *  `successorOf`). Runtime admits only a settled worker of the same manager and journals the
   *  relation on the new node, so the run record shows who took over whose work. A seam may read
   *  it to hand the successor its predecessor's workspace or retained output; Runtime mounts
   *  nothing on its behalf. Independent of `resume`, which re-attaches the same node's session. */
  readonly successorOf?: string;
  /**
   * The PEER MAIL capability endpoint minted for this exact spawn, when the run enabled peer mail
   * ({@link CoordinationToolsOptions.peerMail}). It serves `send_mail` / `read_mail` and nothing
   * else, and it speaks as this worker: the sender is bound to the capability, never passed as an
   * argument.
   *
   * It arrives HERE, out of band, rather than being merged into the worker's `AgentProfile.mcp`,
   * for the same reason the driver's coordination URL does: the URL carries fresh random bytes per
   * process, so writing it into the profile would change the canonical profile digest every run and
   * a keyed re-spawn would then fail its identity check against the journal.
   *
   * The backend-derived worker path mounts it for you (`workerFromBackend`): a bridge worker gets
   * it as a Runtime-owned MCP attachment beside its authored profile. A caller-owned
   * `makeWorkerAgent` mounts it the way `coordinationMcpUrl` is mounted on a driver.
   */
  readonly peerMailUrl?: string;
}
type MakeWorkerAgent = (profile: AgentProfile, context?: WorkerSpawnContext) => Agent<unknown, unknown>;
/**
 * One entry of a run's profiles table (`SuperviseRegistry.profiles`): the exact profile a manager
 * may spawn by name, and, for a promoted entry, the verdict that promoted it.
 *
 * An entry without `promotion` is exploratory. An entry with it cites Eval's paired decision from
 * a sealed play. `supervise` refuses the run unless the seal verifies, a treatment arm of that play
 * names this profile's canonical digest, and the decision promoted. `PairedPromotionDecision`
 * carries no experiment digest, so Runtime cannot prove the decision came from that play's rows;
 * the caller that pairs them owns that claim.
 */
interface SuperviseProfileEntry {
  readonly profile: AgentProfile;
  readonly promotion?: {
    readonly experiment: SealedExperiment;
    readonly decision: PairedPromotionDecision;
  };
}
interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>;
  readonly blobs: ResultBlobStore;
  readonly makeWorkerAgent: MakeWorkerAgent;
  readonly perWorker: Budget;
  /** Called once when this manager declares completion through `stop` or an accepted submission. */
  readonly onStop?: (reason: string | undefined) => void;
  /**
   * The same independent completion check used for workers. When present, the driver receives a
   * `submit_result` tool and may finish work itself instead of being forced to delegate it. The
   * first passing submission is retained; a false or throwing check fails closed. A manager with a
   * check is not served `stop`: it ends through `submit_result` or `report_blocked`.
   */
  readonly deliverable?: DeliverableSpec<unknown>;
  /** Serve `read_continuation`: the full continuation files the note refers to. Supplied by the
   *  manager's continuation policy; the director's box cannot read the driver's run directory. */
  readonly readContinuation?: (continuation: number | undefined) => unknown;
  readonly analysts?: AnalystRegistry$1;
  /** Event-first for source compatibility; the second argument is its exact bus ordering stamp. */
  readonly onEvent?: (event: CoordinationEvent, record: BusRecord<CoordinationEvent>) => void | Promise<void>;
  /** Re-publish resumed settlements through the awaited observer before the driver starts. This is
   *  the crash-window recovery path for product transactions; off preserves low-level legacy reads. */
  readonly replaySettlements?: boolean;
  /** Authorize each continuation against the exact worker identity. The returned instruction is
   * detached, recorded durably through `onEvent`, and only then delivered. */
  readonly authorizeDownMessage?: AuthorizeDownMessage;
  readonly questionPolicy?: QuestionPolicy;
  /** Analyst lenses run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle hook).
   *  A bare string names a lens whose findings go to THE DRIVER: published as a `finding` event on
   *  the bus — pass-through to subscribers and queued for `await_event`. An
   *  {@link AnalyzeOnSettleRoute} generalizes the DESTINATION: findings can be delivered to a
   *  named live WORKER (wrapped in the route's directive, through the same authorized steer
   *  machinery a driver steer uses) instead of being hardwired to the spawning driver, and `over`
   *  restricts which settled workers feed the lens. A route carrying `agent` generalizes the
   *  ANALYST itself: a tool-equipped agent spawned as a worker whose settle output is the
   *  findings (see {@link AnalyzeOnSettleRoute.agent}). Omit/empty = no auto-analysis (default;
   *  the driver can still run lenses on demand via `run_analyst`). Lens routes require
   *  `analysts`; agent routes do not. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>;
  /** Max wall-clock ms a single `await_event` call may block waiting on a live worker to settle
   *  before it returns a non-error `{ pending: true, live }` snapshot and lets the caller re-poll.
   *  The underlying `scope.next()` blocks for the WHOLE (multi-minute) worker run; over a remote MCP
   *  transport that block outlives the client's per-request timeout, so an unbounded await surfaces
   *  to the supervisor as a hard tool ERROR on every call — the exact failure that leaves it flying
   *  blind. Bounding the wait converts that error into a re-pollable liveness signal. The background
   *  drain keeps running, so a settlement that lands after the bound is published to the bus and
   *  pulled by the next call — nothing is lost. Omit = {@link DEFAULT_AWAIT_EVENT_TIMEOUT_MS}; `<= 0`
   *  restores the prior UNBOUNDED block (only safe for in-process drivers with no transport timeout). */
  readonly awaitTimeoutMs?: number;
  /**
   * OPT-IN: run the ONLINE detector panel over each spawned worker's live tool trace and raise a
   * `finding` on the bus the moment a detector fires — so the driver learns "this worker is
   * looping" mid-run, from `await_event`, instead of at settle.
   *
   * This closes the `watchTrace` → `raiseFinding` wire whose own docstring already described it
   * ("the seam an ONLINE detector uses to tell the driver 'this worker is looping/erroring' the
   * moment it happens") but which nothing connected. Workers whose executor exposes no
   * `traceSource` are simply not watched; nothing fails.
   *
   * Omit = no online watching (the settle-time analysts are unaffected).
   */
  readonly watchWorkers?: WorkerWatchOptions;
  /**
   * How long a worker may go without metered activity before `observe_agent` reports it as
   * `stalled`. A derived read at observation time, never a background watchdog — nothing is
   * killed or retried. Omit = the runtime default.
   */
  readonly stallAfterMs?: number;
  /**
   * Questions carried over from a prior process of the SAME run (a durable coordination log a
   * resuming caller replays). Seeded into the question ledger verbatim — `list_questions` shows
   * them, the stop policy counts the still-blocking ones, and `answer_question` can decide them.
   * Omit/empty = fresh ledger (every run that is not a resume).
   */
  readonly priorQuestions?: ReadonlyArray<QuestionRecord>;
  /**
   * Default continuity per PROFILE NAME (the stable node identity a graph pins). A name mapping
   * to `'resume'` makes its spawns re-attach to the node's most recent settled worker whenever
   * one exists — the node's FIRST spawn is effectively `'fresh'`, and a spawn while a prior
   * worker of the node is still LIVE fails closed (`resume-while-live`; steer is the live-worker
   * channel). The spawn tool's per-call `continuity` argument overrides the declared default in
   * either direction. Omit = every spawn is `'fresh'` (status quo). Resume lineage is
   * PROCESS-LOCAL (the same boundary as the analyst-run marker): workers settled by a prior
   * process of a durable run are not resume targets.
   */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>;
  /**
   * OPT-IN: give this manager's workers a bounded SIBLING channel (`../../runtime/supervise/
   * peer-mail`). Each spawn is minted a capability endpoint handed out on
   * {@link WorkerSpawnContext.peerMailUrl}; every attempt, delivered or refused, publishes a
   * `mail` event so the parent audits a channel it no longer relays. Omit = no peer channel and no
   * capability is minted (the status quo: a worker is reachable only by its parent).
   */
  readonly peerMail?: {
    readonly limits?: Partial<PeerMailLimits>;
  };
  /**
   * OPT-IN async gate run on every spawn BEFORE an assignment is minted, budget is reserved, or
   * `Scope.spawn` is called — the one pre-journal point where a network question may be asked.
   *
   * `Scope.spawn` and `MakeWorkerAgent` are synchronous, so a check that needs the backend's
   * answer (does this bridge route the child's wire id; is it already at admission capacity)
   * cannot live there. Returning a {@link SpawnRefusal} refuses the spawn as a tool result: no
   * assignment, no reservation, no journal entry, no worker — and the refusal is counted on
   * {@link CoordinationTools.stats} so a gate that never refuses is visible as such.
   *
   * Returning `undefined` admits the spawn. A THROW is not a refusal: it propagates, because a
   * pre-flight that fails open would hand back exactly the silent admission it exists to stop.
   */
  readonly preflightSpawn?: SpawnPreflight;
  /**
   * OPT-IN pre-journal PROFILE resolution: maps the profile a driver authored to the profile that
   * will actually run, before `preflightSpawn` asks the backend about it. A layer that pins
   * profiles by name (an agent graph) installs this so the gate judges the canonical profile —
   * its real model, tools and harness — never the `{ name }` stub the driver wrote. Synchronous,
   * throw-on-refusal, identity-free: it sees only the profile, never the assignment or budget,
   * because both are minted AFTER the pre-journal point. Omit = the authored profile is used.
   */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /**
   * OPT-IN composition of the profile a manager authored, applied right after it parses and before
   * continuity, pre-flight, authorization, or the journal see it. The composed profile is the
   * child's profile: its identity, its receipt, and what runs. Pure and synchronous; its output is
   * re-validated against the canonical schema. `supervise({ profileGuidance: 'profile-kb' })`
   * installs `withProfileKb` here so each child carries its harness and model guidance.
   */
  readonly composeSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /**
   * The run's profiles table, validated and frozen by `supervise` (`SuperviseRegistry.profiles`).
   * When it holds an entry, `spawn_worker` also takes `profile` as one of its names and lists the
   * names in its schema. The named profile replaces the authored one before composition,
   * continuity, pre-flight, authorization, or the journal see it. An authored profile whose `name`
   * is a table name is refused, so one name never means two profiles. Omit or empty = the tool is
   * unchanged.
   */
  readonly profiles?: ReadonlyMap<string, SuperviseProfileEntry>;
  /**
   * Directory the coordination server may read on the manager's behalf when a spawn names an
   * inline resource by path (`{ kind: 'inline', name, path }` under `profile.resources`). The
   * server substitutes the file's bytes as `content` BEFORE the canonical schema sees the
   * profile, so the model's own output never carries them. Omit = a resource by path is refused
   * with the reason; see `spawn-resource-paths.ts` for the measurement that motivates it.
   */
  readonly spawnResourceRoot?: string;
  /**
   * Where a by-path resource's bytes come from when the manager's workspace is NOT a directory
   * this process can open: a manager inside a provider sandbox, whose files only the provider can
   * serve. Built with `environmentReader(environment)` from the manager's own `AgentEnvironment`.
   * Takes precedence over `spawnResourceRoot` when both are set, because a sandbox manager's files
   * are on its box, not on this host. Omit and `spawnResourceRoot` applies as before.
   */
  readonly spawnResourceReader?: SpawnResourceReader;
  /**
   * OPT-IN parent channel for `ask_parent`. See {@link EscalateQuestion}.
   *
   * Omit and this manager is treated as the TOP of its question chain: `ask_parent` still raises and
   * journals the question, and answers `escalated: false, outcome: 'no-parent'` so the manager knows
   * it must decide the question itself rather than wait.
   */
  readonly escalateQuestion?: EscalateQuestion;
  /**
   * Escalations this manager made in a PRIOR process of the same durable run
   * (`PriorCoordination.escalations`). Seeded verbatim, so after a restart `stop` still knows which
   * blocking questions reached no parent and still names the way out. Without it the record is
   * journaled, reloaded, and then forgotten by the only reader that acts on it.
   */
  readonly priorEscalations?: ReadonlyArray<QuestionEscalationRecord>;
  /**
   * Domain scrub COMPOSED IN FRONT OF the built-in one for every event `read_journal` returns.
   *
   * The journal quotes model-authored instruction text and worker output, either of which may carry
   * a credential the run was given, so the built-in scrub is not something a domain hook may switch
   * off by accident: `resolveRedactor` runs the custom redactor first and `defaultRedactor`
   * over its result — the same rule the rest of the runtime applies to trace values. Omit for the
   * default alone; pass `false` to opt out deliberately. A redactor that throws is a refusal for
   * that one row (it returns a `redaction-failed` marker), never a reason to return the raw event.
   */
  readonly redactJournal?: Redactor | false;
  /**
   * The served tools `report_blocked` may probe, by bare name: the coordination verbs plus the
   * node tools bound to this manager. The transport that serves both supplies it; without it the
   * probe reaches the coordination verbs only.
   */
  readonly resolveProbeTool?: (name: string) => McpToolDescriptor$1 | undefined;
  /**
   * Rows written by PRIOR processes of this durable run (`PriorCoordination.records`), prepended to
   * the live bus so `read_journal` answers for the whole run rather than the current process.
   *
   * Without it a resumed manager reads a nearly empty journal and concludes it tried nothing —
   * which is the exact failure the verb exists to prevent. The rows are marked `prior: true` and
   * are never re-published on the bus: they are evidence, not events to react to.
   */
  readonly priorJournal?: ReadonlyArray<BusRecord<CoordinationEvent>>;
  /** Hard cap on lenses THIS manager may define through `define_analyst`. Omit =
   *  `ANALYST_DEFINITION_BOUNDS.maxDefinitionsPerManager`; `<= 0` = no cap. Reached, the verb
   *  refuses with `error: 'max-defined-analysts'` and names the cap, so a manager that has been
   *  defining instead of investigating reads why. */
  readonly maxDefinedAnalysts?: number;
  /**
   * Lenses this manager DEFINED in a prior process of the same durable run
   * (`PriorCoordination.analystDefinitions`). Seeded verbatim: they are on the menu again, they
   * count against {@link CoordinationToolsOptions.maxDefinedAnalysts}, and re-defining one is a
   * `duplicate-analyst` refusal rather than a silent second registration. Re-registering them with
   * the analyst registry is the owner's decision, because the registry may have changed between
   * processes; this option only restores what the manager is allowed to believe it already wrote.
   */
  readonly priorAnalystDefinitions?: ReadonlyArray<DefinedAnalystRecord>;
}
/** Why a pre-flight refused a spawn. Each cause is a distinct, separately countable decision. */
type SpawnRefusalCause = 'model-route' | 'bridge-full' | 'unmountable-tool';
/** A pre-flight's refusal: the cause it decided on, and the operator-facing evidence for it. */
interface SpawnRefusal {
  readonly cause: SpawnRefusalCause;
  /** Names the exact thing that failed — the unrouted wire id, the admission numbers, the tool. */
  readonly detail: string;
}
/** What a pre-flight sees: the authored child profile and the spawn it is being asked to admit. */
interface SpawnPreflightContext {
  readonly label: string;
  readonly key?: string;
  readonly task: unknown;
}
/** The gate `CoordinationToolsOptions.preflightSpawn` installs. */
type SpawnPreflight = (profile: AgentProfile, context: SpawnPreflightContext) => Promise<SpawnRefusal | undefined>;
/** Bus throughput plus the pre-flight's own refusal ledger. */
interface CoordinationStats extends BusStats {
  /** One counter per refusal cause, present only when a pre-flight is installed. */
  readonly preflight?: Readonly<Record<SpawnRefusalCause, number>>;
}
/** Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). */
interface WorkerWatchOptions {
  /** Detector panel; omit for the default stuck-loop + error-streak pair. */
  readonly detectors?: WatchTraceOptions['detectors'];
  /** Raise at most this many findings per worker, so one pathological worker cannot flood the
   *  driver's inbox with the same signal every span. Default 3; `<= 0` = unlimited. */
  readonly maxFindingsPerWorker?: number;
}
/** Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote
 *  MCP client request timeout so the call returns a `pending` liveness snapshot instead of erroring;
 *  the supervisor re-polls until the worker settles. */
declare const DEFAULT_AWAIT_EVENT_TIMEOUT_MS = 15000;
/**
 * The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool
 * descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
 * over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
 * `raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
 * choice, steerable counterpart to the one-shot own-sandbox delegation MCP.
 */
interface CoordinationTools {
  readonly tools: McpToolDescriptor$1[];
  /** Commit any resume-time event replay before a supervisor can reason or an MCP can listen. */
  ready(): Promise<void>;
  isStopped(): boolean;
  stopReason(): string | undefined;
  /** The first result whose injected independent check passed, if the driver submitted one. */
  submittedResult(): {
    readonly result: unknown;
  } | undefined;
  settled(): ReadonlyArray<SettledWorker>;
  questions(): ReadonlyArray<QuestionRecord>;
  /** Every `ask_parent` escalation and what became of it, in raise order. An undelivered one is a
   *  question this run raised and nothing answered — the operator's read of a run that went quiet. */
  escalations(): ReadonlyArray<QuestionEscalationRecord>;
  /** Every lens this manager defined at run time, in definition order — the same records published
   *  as `analyst-defined` events. Empty when the registry admits no authored lens. */
  definedAnalysts(): ReadonlyArray<DefinedAnalystRecord>;
  /** The full ordered log of every bus event — UP (settled / question / finding), authorized
   *  instruction receipts, and DOWN delivery outcomes (steer / answer). Each record carries seq,
   *  timestamp, and priority. A receipt is evidence and is never auto-delivered on restart. */
  history(): ReadonlyArray<BusRecord<CoordinationEvent>>;
  /** Bus throughput counters (published / pulled / by-kind) for live dashboards, plus one
   *  counter per {@link SpawnRefusalCause} the pre-flight refused. `preflight` is present
   *  whenever `preflightSpawn` is installed, with every cause at 0 until one fires — a gate that
   *  never refuses has to be readable as such. */
  stats(): CoordinationStats;
  /** The run's peer-mail post office, present only when `peerMail` was enabled. The transport
   *  layer stands the capability endpoint up over it; the parent reads `history()` for the audit
   *  trail and calls `stopThread` to end a peer exchange. */
  readonly peerMail?: PeerMailbox;
  /** Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
   *  (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
   *  moment it happens, instead of only at settle. Queued for `await_event` + pass-through. */
  raiseFinding(finding: AnalystFindingEvent): Promise<void>;
  /** Authorize, durably record, and attempt one external steer through the same down-leg used by
   * `steer_agent`. The returned outcome is exact and is never inferred from queue admission. */
  steerWorker(workerId: string, instruction: string, options?: {
    readonly interrupt?: boolean;
  }): Promise<DownMessageEvent>;
  /**
   * Abort ONE live worker this manager spawned, through the worker's own per-child abort chain
   * (the scope cascades that abort into the worker's subtree and no sibling). `ref` resolves
   * workerId-first, then profile name, then spawn label, against LIVE workers only. Returns the
   * resolved identity, or `undefined` when no live worker matches — an already-settled or unknown
   * reference is never reported as aborted. The runtime cancel acknowledger is the intended
   * caller; the durable contract around it lives in `supervise/run-layout`.
   */
  abortWorker(ref: string, reason?: string): {
    readonly id: string;
    readonly label: string;
  } | undefined;
  /**
   * Post-loop drain: pull every ALREADY-settled, unpulled child into the ledger (publishing each
   * as a `settled` bus event for the audit trail) WITHOUT awaiting live children. The driver
   * calls this once its brain loop ends, so a delivered child the brain never awaited still
   * reaches `finalizeBestDelivered` — a gate-verified delivery must never be lost to the
   * driver's pull discipline. Analyst-on-settle hooks do NOT fire here (the driver has stopped;
   * nobody is left to read a finding, and analysts spend real compute). Returns the count.
   */
  drainResolved(): Promise<number>;
  /** Mark the start of one driver attempt, so deliveries are attributed to the turn that got them. */
  beginDriverAttempt(attempt: number): void;
  /** Mark the end of the current driver attempt. A completed turn acknowledges what it received;
   *  a failed one leaves its deliveries unacknowledged for the next re-entry to name. */
  endDriverAttempt(outcome: 'completed' | 'failed'): Promise<void>;
  /** The run state a re-entered manager is told, read from this coordinator's own records. */
  reentryState(): ManagerReentryState;
  /** Every time this manager's completion check ran, oldest first: each `submit_result`, and each
   *  turn end the manager recorded through {@link CoordinationTools.recordCheckRead}. */
  checkReads(): ReadonlyArray<CheckRead>;
  /** Record a check read that happened outside `submit_result`, such as a turn end. */
  recordCheckRead(read: {
    readonly source: CheckRead['source'];
    readonly verdict?: CheckVerdict;
    readonly unavailable?: string;
  }): CheckRead;
  /** The failed probe that ended the run through `report_blocked`, when one did. */
  blocked(): {
    readonly tool: string;
    readonly reported: string;
    readonly probed: string;
  } | undefined;
}
/** Build the driver's MCP tools over a live scope. */
declare function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools;
//#endregion
//#region src/runtime/waterfall.d.ts
interface WaterfallSpan {
  id: string;
  /** The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name. */
  label: string;
  runId: string;
  parentId?: string;
  startMs: number;
  endMs?: number;
  status: 'running' | 'done' | 'down';
  usd: number;
  tokens: {
    input: number;
    output: number;
  };
  score?: number;
}
interface WaterfallReport {
  spans: WaterfallSpan[];
  /** Wall-clock of the observed window (first spawn → last settle). */
  totalMs: number;
  totalUsd: number;
  totalTokens: {
    input: number;
    output: number;
  };
  /** Rollup by label prefix (the part before ':') — shots vs analysts vs anything else. */
  byKind: Record<string, {
    count: number;
    ms: number;
    usd: number;
    tokens: {
      input: number;
      output: number;
    };
  }>;
}
interface WaterfallCollector {
  /** Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks. */
  hooks: RuntimeHooks;
  report(): WaterfallReport;
  /** The text waterfall — one row per span, bars scaled to the observed window. */
  render(opts?: {
    width?: number;
    maxRows?: number;
  }): string;
  reset(): void;
}
/** Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline. */
declare function createWaterfallCollector(): WaterfallCollector;
//#endregion
//#region src/runtime/anytime.d.ts
interface AnytimeTaskCurve {
  taskId: string;
  strategy: string;
  /** Best-so-far after each settled shot: elapsed ms from the task's first spawn,
   *  cumulative usd, and the running max score. */
  points: Array<{
    elapsedMs: number;
    cumUsd: number;
    best: number;
  }>;
  /** Per satisficing target (keyed by the target value as a string): the first point
   *  where best ≥ target, or null when never reached within budget. */
  hits: Record<string, {
    ms: number;
    shots: number;
    usd: number;
  } | null>;
}
interface AnytimeStrategySummary {
  strategy: string;
  /** The satisficing target this row summarizes. */
  target: number;
  tasks: number;
  reachedTarget: number;
  /** Median time-to-target over the tasks that reached it (null when none did). */
  medianTttMs: number | null;
  medianShotsToTarget: number | null;
  /** COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed. */
  ertMs: number | null;
  /** Same construction over dollars: Σ all spend / #successes. */
  erUsd: number | null;
  /** Mean best-so-far score by shot index (the anytime curve, averaged over tasks). */
  curveByShot: number[];
  /** Area under the per-shot anytime curve, normalized to [0,1]. */
  auc: number;
}
interface AnytimeReport {
  targets: number[];
  perTask: AnytimeTaskCurve[];
  /** One summary per (strategy, target) pair — the COCO-style multi-target view. */
  perStrategy: AnytimeStrategySummary[];
}
/**
 * The best-so-far fold — the ONE definition of "how good was the run after k results", shared by
 * the post-run anytime report below and by the LIVE progress-based stop rules
 * (`supervise/stop-rules.ts`). Given the observed objective per settled result in order, it returns
 * the running maximum. A result with no objective (`undefined` — it failed, or it was never
 * scored) carries the previous best forward rather than resetting it.
 *
 * It is extracted rather than duplicated on purpose: a stop rule that decides a run has plateaued
 * must agree, number for number, with the report that later says whether stopping was right.
 */
declare function bestSoFar(values: ReadonlyArray<number | undefined>): number[];
/** Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher =
 *  the run climbed earlier. Shared with the stop rules so "improving" means one thing. */
declare function areaUnderCurve(curve: ReadonlyArray<number>): number;
/**
 * How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value
 * `window` steps back — i.e. the length of the current PLATEAU, in settles. `0` means the most
 * recent settle improved the best by more than `minDelta`.
 *
 * The plateau math the live stop rules read. Defined here, beside the report that measures whether
 * the plateau was real, so there is exactly one notion of "not improving".
 */
declare function plateauLength(curve: ReadonlyArray<number>, minDelta: number): number;
/** Derive anytime metrics from waterfall spans. `targets` are the satisficing score
 *  bars (default [1] = fully resolved; COCO-style multi-target: [0.5, 0.8, 1]);
 *  `targetFor` overrides the bar per task (task-specific satisfaction) — when set, the
 *  per-task bar replaces every entry of `targets` for that task. */
declare function anytimeReport(spans: WaterfallSpan[], opts?: {
  targets?: number[];
  targetFor?: (taskId: string) => number;
}): AnytimeReport;
/** One row per (strategy, satisficing target): the shareable time-to-satisfactory table. */
declare function renderAnytimeTable(report: AnytimeReport): string;
//#endregion
//#region src/runtime/audit-intent.d.ts
interface AuditIntentInput {
  /** The declared intent: the task text / acceptance criteria the agent was given. */
  declaredIntent: string;
  /** The trajectory so far — tool calls + results + assistant turns (any event shapes). */
  trace: ReadonlyArray<unknown>;
  /** The principal's actual intent when it differs from the literal task (the contract). */
  userIntent?: string;
  /** The loop-level purpose (meta-intent): what the WHOLE run is for — lets the auditor
   *  flag locally-sensible work that serves the wrong larger objective. */
  metaIntent?: string;
  runId?: string;
}
interface AuditIntentOptions {
  /** Exact auditor identity. */
  profile: AgentProfile;
  /** Execution substrate. All behavior comes from the profile. */
  executor: ExecutorConfig;
  /** Cap trace lines fed to the auditor. Default 80. */
  maxTraceLines?: number;
  signal?: AbortSignal;
}
interface IntentAudit {
  /** What the agent's actions reveal it is actually optimizing — one sentence. */
  revealedIntent: string;
  verdict: 'aligned' | 'drifting' | 'diverged';
  /** Trajectory-grounded evidence for the verdict (specific calls/patterns). */
  evidence: string;
  /** The single recommended intervention. */
  recommendation: 'continue' | 'steer' | 'abort';
  /** When recommendation is 'steer': the corrective instruction to inject. */
  steer?: string;
  confidence: number;
}
/** Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories. */
declare const defaultAuditorInstruction: string;
/** The route-rigor analyst: compare declared vs revealed vs user intent over a trajectory and return aligned / drifting / diverged with evidence and one recommended intervention. */
declare function auditIntent(input: AuditIntentInput, opts: AuditIntentOptions): Promise<IntentAudit>;
//#endregion
//#region src/runtime/benchmark-report.d.ts
/** Pull the headline score in [0,1] from a record. Default: the held-out split, else the search split,
 *  else a `composite`/`passed`/`score` entry in the raw bag. Override to score a domain differently. */
type ScoreOf = (record: RunRecord) => number | undefined;
/** The profile (matrix row) a record belongs to — default `harness·model` from the record's profile cell,
 *  falling back to the model. This is the leaderboard's unit of comparison. */
type ProfileKeyOf = (record: RunRecord) => string;
/** The axis (matrix column) a record contributes to — default the scenario group. */
type GroupOf = (record: RunRecord) => string;
/** Decompose ONE record into per-axis scores (e.g. judge dimensions). When set, it REPLACES the
 *  scenario-group axes: the column set is the union of returned keys. */
type AxisScoresOf = (record: RunRecord) => Record<string, number>;
interface LeaderboardOptions {
  readonly title?: string;
  readonly scoreOf?: ScoreOf;
  readonly profileKeyOf?: ProfileKeyOf;
  readonly groupOf?: GroupOf;
  readonly axisScoresOf?: AxisScoresOf;
  /** Display label for a profile key (default: the key itself). */
  readonly labelOf?: (profileKey: string) => string;
  /** Commit SHA / dataset / dates surfaced in the provenance block. */
  readonly meta?: Record<string, string>;
  /** Compute per-row confidence intervals (bootstrap on score, Wilson on pass rate). Needs a
   *  `scenarioId` on every record (reps are collapsed per scenario for the honest n). Default off. */
  readonly stats?: boolean;
  /** A score ≥ this counts as a "pass" for the pass-rate proportion + its Wilson CI. Default 0.999
   *  (fully solved). Lower it (e.g. 0.6) for a partial-credit domain. */
  readonly passThreshold?: number;
}
/** A 95%-by-default confidence interval. */
interface Interval {
  readonly lower: number;
  readonly upper: number;
}
/** One leaderboard row — a harness×model profile, every measured column. */
interface LeaderboardRow {
  readonly profileKey: string;
  readonly label: string;
  readonly model: string;
  readonly n: number;
  readonly meanScore: number;
  /** Fraction of records scoring ≥ `passThreshold` (default 0.999) — the binary pass rate. */
  readonly solveRate: number;
  /** axis → mean score for this profile (blank in render when the profile never ran that axis). */
  readonly perAxis: Record<string, number>;
  /** Exact total when every run captured cost; otherwise `null`. */
  readonly costUsd: number | null;
  /** Sum of captured cost only. This is a lower bound when `uncapturedCostRuns > 0`. */
  readonly capturedCostUsd: number;
  /** Runs whose cost was unavailable, never treated as free. */
  readonly uncapturedCostRuns: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyP50Ms: number;
  readonly latencyP90Ms: number;
  /** Bootstrap CI on the mean score — present only when `opts.stats` is set. Computed over
   *  per-scenario means (reps collapsed first), so identical reps can't fake a narrow interval. */
  readonly scoreCi?: Interval;
  /** Wilson CI on the pass rate — present only when `opts.stats` is set. */
  readonly passCi?: Interval;
}
interface Leaderboard {
  readonly title: string;
  /** Column order — scenario groups (default) or dimension keys (`axisScoresOf`). */
  readonly axes: readonly string[];
  /** Rows ranked by `meanScore` desc (ties → lower cost, then label). */
  readonly profiles: readonly LeaderboardRow[];
  readonly meta: Record<string, string>;
  /** Provenance counts — the denominators every honest report leads with. */
  readonly provenance: {
    readonly records: number;
    readonly profiles: number;
    readonly axes: number;
    readonly models: readonly string[];
    /** Exact total when every record captured cost; otherwise `null`. */
    readonly totalCostUsd: number | null;
    /** Sum of captured cost only. */
    readonly capturedCostUsd: number;
    /** Records whose cost was unavailable. */
    readonly uncapturedCostRecords: number;
  };
}
/** Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. */
declare function leaderboard(records: readonly RunRecord[], opts?: LeaderboardOptions): Leaderboard;
/** One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict. */
interface PairwiseVerdict {
  readonly a: string;
  readonly b: string;
  /** Paired unit count (shared scenarios). The significance is suppressed below `minPairs`. */
  readonly pairs: number;
  /** Median paired delta (b − a) and its bootstrap CI. */
  readonly delta: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** Non-zero paired differences used by the signed-rank test. */
  readonly nonZeroPairs: number;
  /** How the signed-rank p-value was computed. */
  readonly testMethod: RankTestMethod;
  /** Smallest p-value attainable by this paired design. */
  readonly pFloor: number;
  /** Raw two-sided signed-rank p-value. */
  readonly p: number;
  /** Benjamini-Hochberg adjusted q-value across every profile pair. */
  readonly q: number;
  /** BH-significant and above the `minPairs` observation floor. */
  readonly significant: boolean;
}
interface PairwiseOptions {
  readonly scoreOf?: ScoreOf;
  readonly profileKeyOf?: ProfileKeyOf;
  readonly labelOf?: (profileKey: string) => string;
  /** False-discovery rate for the Benjamini–Hochberg correction. Default 0.05. */
  readonly fdr?: number;
  /** Below this many shared scenarios a paired test can't defensibly separate two profiles, so the
   *  `significant` tag is suppressed regardless of p (small-n mirage protection). Default 12. */
  readonly minPairs?: number;
}
/** Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real
 *  paired-test p-value, BH-corrected across all pairs. This is the honest "did A beat B" table the
 *  leaderboard's point ranking cannot answer. Reuses the agent-eval statistics substrate. */
declare function pairwiseSignificance(records: readonly RunRecord[], opts?: PairwiseOptions): PairwiseVerdict[];
/** Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis
 *  matrix → cost/latency/token columns. Every axis is shown — a curated subset is a reporting failure. */
declare function renderLeaderboardMarkdown(report: Leaderboard): string;
/** Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected
 *  verdict. Feed it `pairwiseSignificance(records)`. This is the "did A really beat B" evidence the point
 *  ranking cannot give. */
declare function renderPairwiseMarkdown(verdicts: readonly PairwiseVerdict[], title?: string): string;
/** Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps,
 *  embeddable anywhere (README, HTML page, hosted leaderboard). */
declare function renderLeaderboardSvg(report: Leaderboard): string;
/** Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown
 *  matrix as a table. Single file, no assets, opens in any browser. */
declare function renderLeaderboardHtml(report: Leaderboard): string;
//#endregion
//#region src/runtime/completion.d.ts
/** Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric,
 *  never the judge's own verdict. Mirrors the steer-firewall's provenance discipline. */
interface CompletionEvidence {
  kind: 'artifact' | 'metric';
  uri: string;
}
/** The "is it done?" verdict an analyst returns to the parent. */
interface CompletionVerdict {
  done: boolean;
  /** How verifiable the claim is — sets whether the driver trusts it or validates it. */
  determinism: 'deterministic' | 'probabilistic';
  /** Why the analyst believes it is (or isn't) done — what the driver validates. */
  reasons?: string;
  /** 0..1, for probabilistic verdicts; the driver's validation threshold reads this. */
  confidence?: number;
  evidence?: ReadonlyArray<CompletionEvidence>;
}
/** Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so
 *  ONE analyst node can back both channels (findings for steer, a verdict for stop). */
interface CompletionAnalyst<Task, Output> {
  assess(input: {
    task: Task;
    history: ReadonlyArray<Iteration<Task, Output>>;
  }): CompletionVerdict | Promise<CompletionVerdict>;
}
/** When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 *  probabilistic → validate by confidence threshold (the driver's check). */
interface CompletionPolicy {
  /** Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8. */
  minConfidence?: number;
}
/** Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`. */
declare function completionAuthorizes(v: CompletionVerdict, policy?: CompletionPolicy): boolean;
/**
 * A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the
 * seed (no Math.random — reproducible + attributable to the node); the agent is instructed to
 * emit it VERBATIM when it judges itself done. Unguessable enough that content never trips it.
 */
declare function stopSentinel(seed: string): string;
/**
 * Completion for a sandbox-agent node: done iff the latest output carries the node's stop
 * sentinel. PROBABILISTIC (the agent's own self-judgment) — the driver validates it.
 */
declare function sentinelCompletion<Task>(sentinel: string, opts?: {
  confidence?: number;
}): CompletionAnalyst<Task, string>;
/**
 * Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check
 * passes. Ground truth — the driver ends directly, no validation. The check reads the output
 * (a verifier), never the judge verdict — selector ≠ judge stays intact.
 */
declare function deterministicCompletion<Task, Output>(check: (output: Output, history: ReadonlyArray<Iteration<Task, Output>>) => {
  passed: boolean;
  reasons?: string;
}): CompletionAnalyst<Task, Output>;
//#endregion
//#region src/runtime/supervise/run-layout.d.ts
/** One atomically admitted down-leg request for an exact worker id. @stable */
interface WorkerSteerRequest {
  readonly schemaVersion: 1;
  /** Caller-minted stable idempotency key for this operation. */
  readonly operationId: string;
  /** Digest of operation id, worker id, message, source, and interrupt mode. */
  readonly requestDigest: Sha256Digest;
  /** ISO timestamp of durable admission. */
  readonly at: string;
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string;
  /** Exact supervised node id, including the run id for its root manager. */
  readonly worker: string;
  readonly message: string;
  readonly interrupt: boolean;
}
/** Runtime acknowledgement for one exact steer operation. @stable */
interface WorkerSteerAcknowledgement {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly requestDigest: Sha256Digest;
  readonly worker: string;
  readonly effect: 'unknown' | 'delivered' | 'not_live' | 'unsupported' | 'refused';
  readonly requestedAt: string;
  readonly observedAt: string;
  readonly detail: string;
}
/** Caller input for one retry-safe steer operation. @stable */
interface WriteWorkerSteerOptions {
  readonly operationId: string;
  readonly message: string;
  readonly source?: string;
  readonly interrupt?: boolean;
}
/** One durable worker-scoped cancel request appended to the run's cancellation inbox. */
interface WorkerCancelRequest {
  /** Caller-minted stable operation identifier — the idempotency key of the whole operation. */
  readonly operationId: string;
  /** ISO timestamp of the append. */
  readonly at: string;
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string;
  /** The worker the request targets: a workerId (node id — routed to the owning manager at any
   *  depth), or a profile name or spawn label (resolved by the root manager against its direct
   *  children only). */
  readonly worker: string;
  readonly reason?: string;
}
/**
 * The durable acknowledgement state for one worker-scoped cancel operation, keyed by
 * `operationId`. The runtime acknowledger is the ONLY writer; `cancelWorker` only reads it.
 *
 * `effect` reuses the retained-run vocabulary ({@link RetainedRunEffect}) so the runtime has one
 * spelling of the four cancellation states:
 *  - `'unknown'`          — not yet resolved by the runtime (also what `cancelWorker` returns for
 *                           a request no acknowledger has answered), or — terminally, with the
 *                           run-over detail — an abort was issued but the run ended before the
 *                           termination could be observed. Never a success.
 *  - `'cancel_requested'` — the runtime issued the worker's abort; termination not yet proven.
 *  - `'cancelled'`        — the worker reached a terminal `down` state on the settle path.
 *  - `'not_live'`         — the worker was not live to cancel (already settled, it settled
 *                           `done` despite the abort, or the run ended before the request was
 *                           ever applied). Never a success of THIS operation.
 *
 * Expiry is run end: the owning manager's final pass closes every still-open request it owns
 * (`not_live` never applied, `unknown` issued-but-unproven), so a pending request cannot outlive
 * its run and abort a future spawn that happens to reuse a label.
 */
interface WorkerCancellation {
  readonly operationId: string;
  /** The worker reference exactly as requested. */
  readonly worker: string;
  readonly effect: RetainedRunEffect;
  /** ISO timestamp of the original request. */
  readonly requestedAt: string;
  /** ISO timestamp of the runtime's most recent observation of this operation. */
  readonly observedAt: string;
  /** The node id the acknowledger resolved `worker` to, once resolved. */
  readonly workerId?: string;
  /** The caller's reason, carried verbatim from the request. */
  readonly reason?: string;
  /** The runtime's explanation of how it arrived at `effect`. */
  readonly detail?: string;
  /**
   * Every node id this operation PROVED terminated: the requested worker plus each descendant of
   * its subtree observed to reach a terminal `down`/`cancelled` journal record at or after the
   * abort was ISSUED — the acknowledger's own `observedAt` on the `cancel_requested` record
   * (runtime clock), never the client's `requestedAt` (a cancelled lead cascades to its subtree
   * by design — the scope signal chain — so the acknowledgement names the set, not one id).
   * Proven at acknowledgement time; post-abort causation is approximate: a descendant that died
   * of its own cause after the abort is indistinguishable from the cascade and may be included,
   * a late teardown journal joins the set on a later pass while the manager still runs, and one
   * still absent at run end is absent from the set. Grows monotonically; empty until termination
   * is proven.
   */
  readonly terminated: ReadonlyArray<string>;
}
/** One durable run-scoped cancel request: cancel the WHOLE run, not one worker. */
interface RunCancelRequest {
  /** Caller-minted stable operation identifier — the idempotency key of the whole operation. */
  readonly operationId: string;
  /** ISO timestamp of the write. */
  readonly at: string;
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string;
  /** Requested observation target, measured by the acknowledgement's deadlineExceeded field.
   * The observer always cascades eagerly. This does not guarantee scheduler latency or cleanup. */
  readonly deadlineMs?: number;
  /** Stable operator/requester identity for audit trails. */
  readonly operator?: string;
  readonly reason?: string;
}
/**
 * The durable acknowledgement state for the run-scoped cancel operation, keyed by `operationId`.
 * The runtime is the ONLY writer; {@link cancelRun} only reads it.
 *
 * `effect` is the same {@link RetainedRunEffect} vocabulary the worker-scoped and retained-run
 * paths use, so the runtime has one spelling of the four cancellation states:
 *  - `'unknown'`          — no runtime has answered yet. Never a success.
 *  - `'cancel_requested'` — the root manager issued the run's cascading abort; the run's terminal
 *                           state is not yet observed.
 *  - `'cancelled'`        — the run reached its terminal cancelled state with confirmed teardown.
 *  - `'not_live'`         — the run was not live to cancel: it settled on its own despite the
 *                           request, or it ended before the request was applied.
 */
interface RunCancellation {
  /** Runtime path that issued the cascade. */
  readonly path?: 'observer' | 'turn-boundary' | 'fallback';
  /** Runtime clock elapsed between request timestamp and cascade application. */
  readonly appliedAfterMs?: number;
  /** Whether application exceeded the requested deadlineMs; absent when no target was requested. */
  readonly deadlineExceeded?: boolean;
  readonly operationId: string;
  readonly effect: RetainedRunEffect;
  /** ISO timestamp of the original request. */
  readonly requestedAt: string;
  /** ISO timestamp of the runtime's most recent observation of this operation. */
  readonly observedAt: string;
  /** The caller's reason, carried verbatim from the request. */
  readonly reason?: string;
  /** The caller's operator identity, carried verbatim from the request. */
  readonly operator?: string;
  /** The runtime's explanation of how it arrived at `effect`. */
  readonly detail?: string;
}
/** The root every supervisor run of one workspace lives under. */
declare function supervisorRunsRoot(rootDir: string): string;
/** The run directory every artifact of one supervisor run lives under. */
declare function supervisorRunDir(rootDir: string, id: string): string;
/**
 * Where a pre-rename writer put the same run (`<root>/.loops/supervisor/<id>`). Readers that must
 * see historical runs check {@link supervisorRunDir} first and fall back to this; nothing writes
 * here anymore.
 */
declare function legacySupervisorRunDir(rootDir: string, id: string): string;
/**
 * The pre-rename runs root (`<root>/.loops/supervisor`). Only readers that ENUMERATE historical
 * runs need this — the per-id form is {@link legacySupervisorRunDir}. Nothing writes here.
 */
declare function legacySupervisorRunsRoot(rootDir: string): string;
/** A worker label reduced to a safe filename stem. Empty labels get a stable fallback. */
declare function safeWorkerFile(label: string): string;
/** The directory holding every per-worker file of one run (inboxes and control-event logs). */
declare function supervisorWorkersDir(eventDir: string): string;
/** The durable inbox file for one worker of one run. */
declare function workerInboxFile(rootDir: string, supervisorId: string, worker: string): string;
/** Same, addressed from an already-known run directory (the reader's usual entry point). */
declare function workerInboxFileFromEventDir(eventDir: string, worker: string): string;
/**
 * The best-effort control-event log for one worker (`workers/<label>.ndjson`) — delivery
 * bookkeeping for steers, plus whatever lifecycle events a writer chooses to append. Distinct from
 * the inbox: the inbox is the durable down-leg queue, this is the record of what happened to it.
 */
declare function workerControlLogFile(eventDir: string, worker: string): string;
/** Directory containing atomically admitted steer requests and runtime acknowledgements. */
declare function workerSteersDir(eventDir: string): string;
/** Directory containing one canonical request file per steer operation. */
declare function workerSteerRequestsDir(eventDir: string): string;
/** Directory containing one runtime acknowledgement per steer operation. */
declare function workerSteerAcknowledgementsDir(eventDir: string): string;
/** Canonical request file for one caller-owned steer operation id. */
declare function workerSteerRequestFile(eventDir: string, operationId: string): string;
/** Runtime acknowledgement file for one caller-owned steer operation id. */
declare function workerSteerAcknowledgementFile(eventDir: string, operationId: string): string;
/**
 * Admit one steer exactly once under a caller-owned operation id.
 *
 * Pass `supervisorId` as `worker` to address the root. Router roots consume requests between
 * turns; native roots use their existing accepting inbox during execution, or acknowledge
 * `unsupported` when none is available. Delivery does not prove model consumption.
 * This filesystem API requires trusted write access to the run directory; it adds no MCP grant.
 *
 * The per-operation request file is linked into place atomically after its bytes reach disk. A
 * same-body retry returns the winner's request. A changed-body retry fails loud. The NDJSON inbox
 * and control log are readable projections written only by the admission winner.
 * @stable
 */
declare function writeWorkerSteer(rootDir: string, supervisorId: string, worker: string, options: WriteWorkerSteerOptions): {
  worker: string;
  file: string;
  request: WorkerSteerRequest;
  acknowledgement?: WorkerSteerAcknowledgement;
  replayed: boolean;
};
/** Read every atomically admitted request for one exact worker id, in admission order. @stable */
declare function readWorkerSteerRequests(eventDir: string, worker?: string): WorkerSteerRequest[];
/** Read one runtime steer acknowledgement, or `undefined` while no manager has answered. @stable */
declare function readWorkerSteerAcknowledgement(eventDir: string, operationId: string): WorkerSteerAcknowledgement | undefined;
/** The directory holding every cancellation artifact of one run (request inbox + acknowledgements). */
declare function workerCancellationsDir(eventDir: string): string;
/**
 * The durable cancel-request inbox of one run — one NDJSON line per {@link WorkerCancelRequest}.
 * It stays append-only so independent operations retain admission order and readers can skip a
 * partial trailing line. `appendDurableFile` uses O_APPEND, one write, file fsync, and directory
 * fsync; single-record acknowledgements use atomic replacement instead.
 */
declare function workerCancelRequestsFile(eventDir: string): string;
/**
 * The acknowledgement file for one cancel operation. The filename is a sanitized stem of the
 * `operationId`; the record inside carries the exact id, and readers verify it so two distinct
 * ids that sanitize to one stem fail loud instead of answering for each other.
 */
declare function workerCancellationFile(eventDir: string, operationId: string): string;
/** Read every valid cancel request in the run's cancellation inbox. Corrupt lines are skipped. */
declare function readWorkerCancelRequests(eventDir: string): WorkerCancelRequest[];
/**
 * Read the acknowledgement for one cancel operation. `undefined` when the runtime has not
 * answered. A record whose stored `operationId` differs from the requested one is a filename
 * collision between two sanitized ids — fail loud rather than return another operation's answer.
 */
declare function readWorkerCancellation(eventDir: string, operationId: string): WorkerCancellation | undefined;
/**
 * Request the cancellation of ONE worker, idempotently, and return the operation's current
 * durable state.
 *
 * The write half of the acknowledged-cancellation contract (`writeWorkerSteer` is the steer
 * analog): append the request to the run's cancellation inbox, where the OWNING manager's
 * acknowledger (its turn loop — the root for label/profile references, the parent manager for an
 * exact node id at any depth) applies it — aborting exactly that worker's subtree and recording
 * what it proved. This function never applies the cancellation itself; writing a
 * request file is not an acknowledgement.
 *
 * Idempotency is a lookup: when an acknowledgement for `operationId` already exists, it is
 * returned AS-IS and nothing is appended — repeating one operation can never apply twice. A
 * retry that changes the worker, source, or reason fails closed. A request the runtime has not
 * answered yet returns `effect: 'unknown'` (never a success); call again with the same
 * `operationId` — or `readWorkerCancellation` — to read the acknowledged result after a
 * reconnect.
 */
declare function cancelWorker(eventDir: string, worker: string, operationId: string, options?: {
  readonly reason?: string;
  readonly source?: string;
}): WorkerCancellation;
/** The run-scoped cancel request file of one run — one {@link RunCancelRequest}. */
declare function runCancelRequestFile(eventDir: string): string;
/** The run-scoped acknowledgement file of one run — one {@link RunCancellation}. */
declare function runCancellationFile(eventDir: string): string;
/** Read the run-scoped cancel request, or `undefined` when none was written. */
declare function readRunCancelRequest(eventDir: string): RunCancelRequest | undefined;
/**
 * Read the acknowledgement for the run-scoped cancel operation. `undefined` when the runtime has
 * not answered. A record holding a DIFFERENT `operationId` belongs to another operation on the
 * same run — fail loud rather than answer for it.
 */
declare function readRunCancellation(eventDir: string, operationId: string): RunCancellation | undefined;
/**
 * Request the cancellation of the WHOLE run, idempotently, and return the operation's current
 * durable state.
 *
 * The run-scoped twin of {@link cancelWorker}: write the request into the run's cancellation
 * directory, where the run's own root manager applies it — aborting the root through the one
 * cascade controller the run already has, so every live worker comes down with it. This function
 * never applies the cancellation itself; writing a request file is not an acknowledgement.
 *
 * Idempotency is a lookup: when an acknowledgement for `operationId` already exists it is returned
 * AS-IS and nothing is written. A retry that changes the source, reason, deadline, or operator
 * fails closed. A request the runtime has not answered yet returns `effect: 'unknown'` (never a
 * success); call again with the same `operationId` — or {@link readRunCancellation} — to read the
 * acknowledged result after a reconnect.
 *
 * A run carries ONE run-scoped operation: a second request under a different `operationId` throws
 * rather than silently replacing the pending one, because both would claim the same single abort.
 */
declare function cancelRun(eventDir: string, operationId: string, options?: {
  readonly reason?: string;
  readonly source?: string;
  readonly deadlineMs?: number;
  readonly operator?: string;
}): RunCancellation;
//#endregion
//#region src/runtime/supervise/coordination-log.d.ts
/** Stable identity of the supervisor that owns one coordination stream. High-level supervision
 * derives it from the exact root/child execution identity plus its parent assignment. */
type CoordinationOwnerId = string;
/** Durable delivery evidence retained in commit order. An attempt without a later event carrying
 * the same `receiptId` has an unknown outcome after a crash and is never replayed. */
type CoordinationDeliveryEvidence = Extract<CoordinationEvent, {
  readonly type: 'delivery-attempt' | 'steer' | 'answer';
}>;
/** Coordination evidence loaded from prior processes of one durable supervised run. */
interface PriorCoordination {
  /** The owner filter used for this replay. Omitted only for the compatibility all-owner read. */
  readonly ownerId?: CoordinationOwnerId;
  /** Every question the prior process raised, with answer-status folded in, raise order. */
  readonly questions: ReadonlyArray<QuestionRecord>;
  /** Every analyst finding the prior process published, publish order. */
  readonly findings: ReadonlyArray<AnalystFindingEvent>;
  /** Every `ask_parent` escalation the prior process made, raise order. An undelivered one names a
   * question the run raised that nothing above it received — retained so a resuming operator sees
   * it, never auto-redelivered. */
  readonly escalations: ReadonlyArray<QuestionEscalationRecord>;
  /** Every lens the prior process DEFINED at run time, definition order. The exact authored bytes
   * and their digest, so an invented lens can be re-registered and any finding it produced can be
   * traced to the words that produced it. Re-registration is the owner's decision, never automatic:
   * the registry may have changed between processes. */
  readonly analystDefinitions: ReadonlyArray<DefinedAnalystRecord>;
  /** Every authorized continuation, in commit order. These are evidence, never replayed to a new
   * worker automatically. */
  readonly continuations: ReadonlyArray<ContinuationInstruction>;
  /** Delivery intent and result records in commit order, linked to receipts by `receiptId`. */
  readonly deliveryEvidence: ReadonlyArray<CoordinationDeliveryEvidence>;
  /** Every peer-mail attempt the prior process made, delivered and refused alike, in commit order.
   * Evidence of what siblings told each other; never replayed into a new worker's inbox. */
  readonly mail: ReadonlyArray<PeerMailEvent>;
  /** Exact source-bus stamps in durable append order. Bus `seq` restarts with each process; append
   * order remains the cross-process replay order. */
  readonly records: ReadonlyArray<BusRecord<CoordinationEvent>>;
}
/** The durable coordination side-log seam. `append` records one bus event (kinds it does not
 *  persist are ignored); `load` replays a run's prior records folded into `PriorCoordination`. */
interface CoordinationLog {
  append(runId: string, record: BusRecord<CoordinationEvent>, ownerId?: CoordinationOwnerId): Promise<void>;
  load(runId: string, ownerId?: CoordinationOwnerId): Promise<PriorCoordination>;
}
/** FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. */
declare class FileCoordinationLog implements CoordinationLog {
  private readonly path;
  private appendTail;
  constructor(path: string);
  append(runId: string, record: BusRecord<CoordinationEvent>, ownerId?: CoordinationOwnerId): Promise<void>;
  private appendRecord;
  load(runId: string, ownerId?: CoordinationOwnerId): Promise<PriorCoordination>;
}
//#endregion
//#region src/runtime/supervise/coordination-http.d.ts
interface CoordinationHttpAudit {
  readonly runId: string;
  readonly actorId: string;
  readonly outcome: 'rejected' | 'accepted' | 'completed' | 'completed-after-deadline';
  readonly status: number;
  readonly action?: string;
}
/** Transport limits apply before parsing or executing a coordination action. */
interface CoordinationHttpOptions {
  readonly maxRequestBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly maxConcurrentRequests?: number;
  readonly requestsPerMinute?: number;
  /** Browser origins are refused unless explicitly listed. */
  readonly allowedOrigins?: ReadonlyArray<string>;
  /** Audit fields exclude credentials, request bodies, and arbitrary error strings. */
  readonly onAudit?: (event: CoordinationHttpAudit) => Promise<void> | void;
}
//#endregion
//#region src/runtime/supervise/coordination-mcp.d.ts
interface CoordinationMcpHandle {
  /** The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`. */
  readonly url: string;
  readonly port: number;
  /** Runtime-only credentials. Never put these headers in canonical profiles or journals. */
  readonly headers: Readonly<Record<string, string>>;
  readonly credentialExpiresAt: number | undefined;
  /** Revoke this listener’s current token and mint another. Remove a signing key to revoke across restarts. */
  rotateCredential(): void;
  /** The coordination tools' settled-worker ledger (for the driver's finalize). */
  settled(): ReadonlyArray<SettledWorker>;
  /** The first driver-authored result whose injected independent check passed. */
  submittedResult: CoordinationTools['submittedResult'];
  /** Post-loop drain of already-settled, unpulled children into the ledger — call before reading
   *  `settled()` for a finalize, so a delivered child the harness never awaited is not lost. */
  drainResolved: CoordinationTools['drainResolved'];
  isStopped(): boolean;
  /** The full ordered bus-event log for current-process observability and audit evidence. */
  history: CoordinationTools['history'];
  /** Bus throughput counters for live dashboards. */
  stats: CoordinationTools['stats'];
  /** Raise a `finding` on the bus from an online detector watching a worker's live pipe. */
  raiseFinding: CoordinationTools['raiseFinding'];
  /** Every peer-mail attempt in order, delivered and refused alike. Empty when peer mail is off. */
  mailHistory(): ReadonlyArray<PeerMailEvent>;
  /** End one peer exchange: every further mail on the thread is refused `thread-stopped`. Returns
   *  false when peer mail is off or the thread was already stopped. */
  stopMailThread(threadId: string): boolean;
  close(): Promise<void>;
}
interface CoordinationAuthentication {
  /** Explicit finite lifetime. Omission binds the credential to the live scope and its deadline. */
  readonly ttlMs?: number;
  /** Caller-owned secret keys. Keep prior keys to verify unexpired credentials after restart. */
  readonly signingKeys?: {
    readonly activeKeyId: string;
    readonly keys: Readonly<Record<string, string>>;
  };
}
interface CoordinationPublicAddress {
  readonly host: string;
  readonly port: number;
  readonly runId: string;
  readonly actorId: string;
  /** Listener lifetime: aborts on close, failed setup, manager cancellation, or deadline. */
  readonly signal: AbortSignal;
}
interface CoordinationTransportOptions extends CoordinationHttpOptions {
  readonly host?: string;
  readonly port?: number;
  /** Required for remote binds. Each server mints a distinct run/actor credential. */
  readonly authentication?: true | CoordinationAuthentication;
  /** Caller-owned reachable endpoint or mapping, awaited before dispatch. Runtime creates no tunnel. */
  readonly publicUrl?: string | ((address: CoordinationPublicAddress) => string | Promise<string>);
}
/** Stand up the existing coordination tools with bounded HTTP access over one live scope. */
declare function serveCoordinationMcp(opts: CoordinationTransportOptions & {
  /** Trusted audit identity; defaults to the live scope node. */
  identity?: {
    runId: string;
    actorId: string;
  };
  scope: Scope<unknown>;
  blobs: ResultBlobStore;
  makeWorkerAgent: MakeWorkerAgent;
  authorizeDownMessage?: AuthorizeDownMessage;
  perWorker: Budget;
  /** Independent completion check exposed to the driver as `submit_result`. The check runs
   *  inside that call, so the call is served single-flight and fenced like `nodeTools`: a check
   *  still running at the fence returns a pending result, and an identical resubmission joins
   *  that check and returns its verdict. */
  deliverable?: DeliverableSpec<unknown>;
  /** Serve `read_continuation` from the manager's continuation records. */
  readContinuation?: (continuation: number | undefined) => unknown;
  /** Called once when the external manager accepts a result or declares completion. */
  onStop?: (reason: string | undefined) => void;
  /** Max wall-clock ms a single `await_event` may block before returning a re-pollable
   *  `{ pending, live }` snapshot instead of erroring on the client's request timeout. Omit =
   *  the `coordinationResponseFenceMs` derived from the request timeout; `<= 0` = prior unbounded
   *  block (in-process only). */
  awaitTimeoutMs?: number;
  /** Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle. */
  analysts?: AnalystRegistry$1;
  /** Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus. */
  analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>;
  /** Run the ONLINE detector panel over each worker's live tool trace (raises `finding` events). */
  watchWorkers?: WorkerWatchOptions;
  /** Idle time after which `observe_agent` reports a worker as stalled. */
  stallAfterMs?: number;
  /** Default continuity per worker profile name — `'resume'` re-attaches spawns of that name to
   *  the node's latest settled worker; the tool's per-call `continuity` overrides. */
  continuityByProfile?: Readonly<Record<string, ContinuityMode>>;
  /** Pass-through subscriber for every bus event, including pre-delivery instruction receipts and
   * steer/answer delivery outcomes. */
  onEvent?: (event: CoordinationEvent, record: BusRecord<CoordinationEvent>) => void | Promise<void>;
  /** Re-publish resume-time settlements through the awaited observer before this server listens. */
  replaySettlements?: boolean;
  questionPolicy?: QuestionPolicy;
  /** Where an `ask_parent` question goes when it leaves this manager. Omit = `no-parent`. */
  escalateQuestion?: EscalateQuestion;
  /** Escalations replayed from a prior process — seeds what `stop` knows went unheard. */
  priorEscalations?: ReadonlyArray<QuestionEscalationRecord>;
  /** Questions replayed from a prior process of this run — seeds the question ledger. */
  priorQuestions?: ReadonlyArray<QuestionRecord>;
  /** Every coordination record from prior processes of this run — what `read_journal` reads before
   *  this process's own rows, so a resumed manager sees what it already did. */
  priorJournal?: ReadonlyArray<BusRecord<CoordinationEvent>>;
  /** Lenses this manager defined in a prior process — seeds the menu and the definition cap. */
  priorAnalystDefinitions?: ReadonlyArray<DefinedAnalystRecord>;
  /** Product-selected tools already bound to this exact supervisor node. They share this server
   *  with the coordination verbs, so the existing MCP duplicate-name guard applies before listen.
   *  Each is served single-flight and fenced (`./single-flight-tools`): an identical call joins
   *  the unreturned run, and a call still running at the fence returns a pending result. */
  nodeTools?: ReadonlyArray<McpToolDescriptor$1>;
  /** Exact bare tool names to expose from the coordination and node-tool set. Runtime never
   *  grants an implicit complete tool set. An unknown name fails before the listener opens. */
  toolNames: ReadonlyArray<string>;
  /**
   * OPT-IN peer mail: let this manager's workers message each other directly, bounded and audited
   * (`runtime/supervise/peer-mail`). Each spawn receives a capability URL on
   * `WorkerSpawnContext.peerMailUrl`.
   *
   * It is a SEPARATE listener on its own port, not another tool on this server, and that is the
   * whole point: this server grants spawn_worker / steer_agent / stop to its manager, so a
   * worker handed its URL could send a REAL `[SUPERVISOR]` instruction to a sibling and the peer
   * channel's authority marking would mean nothing. The mail listener serves `send_mail` and
   * `read_mail` and no other verb, on a per-worker secret path bound to that worker's identity.
   *
   * The residual, stated plainly: the boundary is between AGENTS, not between processes. A worker
   * that can read another worker's environment or process memory still holds that worker's
   * capability. Loopback plus an unguessable path is what this layer can honestly enforce.
   */
  peerMail?: boolean | {
    limits?: Partial<PeerMailLimits>;
  };
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
   *  pre-journal point that may ask the backend a question. See
   *  `CoordinationToolsOptions.preflightSpawn`. */
  preflightSpawn?: SpawnPreflight;
  /** Pre-journal profile resolution for `preflightSpawn`; see
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** Composition of each authored child profile before identity is fixed —
   *  `CoordinationToolsOptions.composeSpawnProfile`. */
  composeSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** The run's validated profiles table — `CoordinationToolsOptions.profiles`. */
  profiles?: ReadonlyMap<string, SuperviseProfileEntry>;
  /** See `CoordinationToolsOptions.spawnResourceRoot`. */
  spawnResourceRoot?: string;
  /** See `CoordinationToolsOptions.spawnResourceReader`. */
  spawnResourceReader?: SpawnResourceReader;
  /** Called with this server's exact MCP tool descriptors once they exist and BEFORE the listener
   *  opens — the seam a caller uses to give an already-bound node tool a way to call the same
   *  verbs in code (`SupervisorToolInvocationContext.verbs`). */
  onCoordinationTools?: (tools: ReadonlyArray<McpToolDescriptor$1>) => void;
}): Promise<CoordinationMcpHandle>;
//#endregion
//#region src/runtime/supervise/finalizer.d.ts
/** One settled worker as the finalizer sees it — the ledger row (structural fields only). */
interface FinalizerSettled {
  readonly id: string;
  readonly status: 'done' | 'down';
  readonly score?: number;
  readonly valid?: boolean;
  readonly outRef?: string;
  readonly reason?: string;
}
/** One DELIVERED child, materialized: settled `done`, oracle-passed, output rehydrated. `out` is
 *  `undefined` only when the child settled without an `outRef` (no artifact to rehydrate). */
interface DeliveredOutput {
  readonly id: string;
  readonly score?: number;
  readonly outRef?: string;
  readonly out?: unknown;
}
/** What a finalizer gets to decide with. `delivered` is the ONLY output material; `allSettled`
 *  and `tree` are metadata (record a disagreement, count the downs); `blobs` re-reads delivered
 *  artifacts only; `budget` is the conserved-pool readout at finalize time. */
interface FinalizeContext {
  readonly delivered: ReadonlyArray<DeliveredOutput>;
  readonly allSettled: ReadonlyArray<FinalizerSettled>;
  readonly tree: TreeView;
  readonly blobs: Pick<ResultBlobStore, 'get'>;
  readonly budget: Scope<unknown>['budget'];
}
/** The finalization seam: ledger in, output (or `undefined` = nothing deliverable) out. */
type SupervisorFinalizer = (ctx: FinalizeContext) => Promise<unknown | undefined> | unknown | undefined;
/** The single argmax both the default finalizer and `finalizeBestDelivered` share: highest
 *  score wins, missing scores count 0, ties keep the earliest ledger entry. */
declare function pickBestDelivered<T extends {
  readonly score?: number;
}>(delivered: ReadonlyArray<T>): T | undefined;
/** Keep-best under the completion oracle — the DEFAULT finalizer and the exact behavior every
 *  existing caller had: the highest-scoring delivered child's output, `undefined` when nothing
 *  delivered (or the best delivered child carries no artifact). */
declare const bestDelivered: SupervisorFinalizer;
/**
 * Every verified distinct output, highest score first — the shape for competing hypotheses, a
 * Pareto front, or a recorded evaluator split (three judges 2:1 → both outputs survive, with
 * provenance, instead of the minority report being erased). Distinct by `outRef` (content
 * address), so identical outputs collapse to one entry. `undefined` when nothing delivered —
 * an empty collection is a no-winner, not a winner wrapping `[]`.
 */
declare const collectDelivered: SupervisorFinalizer;
/**
 * Run a finalizer over a settled-worker ledger under the delivered-only invariant: filter the
 * ledger to structurally delivered children, materialize their outputs, and hand the finalizer a
 * blob reader that throws on any ref outside that set. This is the one call site both driver arms
 * (the in-process tool-loop and the MCP-mounted harness) finalize through. When a parent declares
 * a deliverable, its candidate must also pass that check: children may have narrower assignments.
 * The default selects the highest-scoring child that passes the parent's check; custom finalizers
 * assemble their candidate before the check. A rejection leaves the parent incomplete; a thrown
 * oracle surfaces a validation error. Neither changes child validity.
 */
declare function runFinalizer(finalizer: SupervisorFinalizer, args: {
  readonly settled: ReadonlyArray<FinalizerSettled>;
  readonly blobs: ResultBlobStore;
  readonly tree: TreeView;
  readonly budget: Scope<unknown>['budget'];
  readonly deliverable?: DeliverableSpec;
}): Promise<unknown | undefined>;
//#endregion
//#region src/runtime/supervise/reentry.d.ts
/** What the next drive continues, as the drive harness can prove it before the turn starts. */
interface ReentryContinuity {
  /** `continued`: the next turn is sent into the harness session that received the last one.
   *  `new`: a new harness session, which knows only what its task says. */
  readonly session: 'continued' | 'new';
  /** Whether the next drive runs in the environment the previous drive used. `replaced` names a
   *  previous environment the provider no longer holds. */
  readonly environment: 'same' | 'replaced' | 'unknown';
  readonly environmentId?: string;
  readonly previousEnvironmentId?: string;
  /** What the next environment holds of the previous one's files. `restored`: the files as of
   *  the checkpoint taken at `checkpointAt`; anything written after it is gone. */
  readonly workspace: 'kept' | 'restored' | 'lost' | 'unknown';
  readonly checkpointAt?: string;
}
/** Continuity when nothing is proven: compose the full state. */
declare const UNPROVEN_CONTINUITY: ReentryContinuity;
interface ReentryTaskInput {
  /** The run's original task, exactly as the first drive received it. */
  readonly originalTask: unknown;
  /** What the completion check requires, when the caller described it. */
  readonly contract?: string;
  readonly reentry: DriverReentry;
  readonly continuity: ReentryContinuity;
  readonly state: ManagerReentryState;
  /** 1-based driver attempt this task starts. */
  readonly attempt: number;
}
/** Compose the task for one re-entered drive. */
declare function composeReentryTask(input: ReentryTaskInput): string;
//#endregion
//#region src/runtime/supervise/stop-rules.d.ts
/** One settled unit of work, reduced to what a stop rule reads. `objective` is the run's own
 *  quality signal (a verdict score, a test pass-rate, a judge rating); `undefined` = this
 *  settlement produced no measurable objective (it failed, or nothing scored it). */
interface ProgressSample {
  readonly id: string;
  /** Epoch ms the settlement was observed. */
  readonly at: number;
  readonly objective?: number;
  /** True when the settlement passed its deliverable check — a scored-but-undelivered result is
   *  not progress. */
  readonly delivered: boolean;
}
/** The read-model a `StopRule` decides from — the run's progress, not its budget. */
interface ProgressView {
  readonly now: number;
  /** Settlements observed so far, in the order they landed. */
  readonly settles: number;
  /** Of those, how many passed their deliverable check. */
  readonly delivered: number;
  /** Best-so-far objective after each settlement (`anytime.bestSoFar`). */
  readonly curve: ReadonlyArray<number>;
  /** The current best objective; `0` when nothing has scored. */
  readonly best: number;
  /** Mean of the best-so-far curve — how EARLY the run climbed (`anytime.areaUnderCurve`). */
  readonly auc: number;
  /** Epoch ms of the most recent settlement; `0` when none has landed. */
  readonly lastSettleAt: number;
  /** Epoch ms of the most recent improvement in best-so-far; `0` when none. */
  readonly lastImprovementAt: number;
  /** Settlements since the last improvement — `0` right after one improves. */
  readonly settlesSinceImprovement: number;
  /** Live read of every non-terminal worker (the `Scope.progress` feed). Empty when the caller
   *  supplied no scope. */
  readonly workers: ReadonlyArray<WorkerProgress>;
  /** Nodes running or acquiring. */
  readonly inFlight: number;
  /** Armed wait-state nodes — deliberately separate from `inFlight`: a tree whose only remaining
   *  nodes are waits is NOT stalled, it is waiting on the world. */
  readonly waiting: number;
}
/** A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say
 *  why in the result, and an unexplained early stop is indistinguishable from a bug. */
type StopDecision = {
  readonly stop: false;
} | {
  readonly stop: true;
  readonly reason: string;
};
/** Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on
 *  the driver's hot path, once per turn. */
type StopRule = (view: ProgressView) => StopDecision;
/** Accumulates settlements and materializes a `ProgressView`. Idempotent by settlement id, so a
 *  caller may re-push its whole roster every turn (the driver does exactly that) without
 *  double-counting or moving a recorded timestamp. */
interface ProgressTracker {
  /** Record a settlement. A second call with the same `id` is ignored. Returns true when it was
   *  new. */
  record(sample: ProgressSample): boolean;
  /** Materialize the view. Pass the live `Scope` to include the worker feed and tree shape. */
  view(scope?: Scope<unknown>, opts?: {
    readonly stallAfterMs?: number;
  }): ProgressView;
  /** Evaluate a rule against the current view. */
  evaluate(rule: StopRule, scope?: Scope<unknown>, opts?: {
    readonly stallAfterMs?: number;
  }): StopDecision;
  /** The samples recorded so far, in order. */
  samples(): ReadonlyArray<ProgressSample>;
}
interface ProgressTrackerOptions {
  /** Clock for `view().now`. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Treat a settlement that did NOT pass its deliverable check as having no objective. Default
   *  true — "scored 0.9 but never delivered" is not progress, and counting it as progress is the
   *  exact way a plateau rule gets talked out of firing. */
  readonly requireDelivered?: boolean;
  /** How much the best-so-far must rise for a settlement to count as an IMPROVEMENT. Default 0
   *  (any strict rise counts). Raise it to ignore score noise. */
  readonly minImprovement?: number;
}
/** Build the settled-work ledger a `StopRule` decides from: record each settlement (idempotent by
 *  id) and materialize a `ProgressView` combining the best-so-far curve with the live worker feed. */
declare function createProgressTracker(opts?: ProgressTrackerOptions): ProgressTracker;
/** Build a `ProgressSample` from a scope settlement. The objective is the verdict score and
 *  `delivered` is the verdict's `valid` — the SAME single delivery signal `finalizeBestDelivered`
 *  and `defaultSelectWinner` use, so "progress" and "winner" cannot disagree. */
declare function sampleFromSettled(settled: Settled<unknown>, at: number): ProgressSample;
interface NoProgressForOptions {
  /** Stop when this many ms have passed since the last SETTLEMENT. Omit to not bound on time. */
  readonly ms?: number;
  /** Stop when this many settlements have landed with no improvement in best-so-far. Omit to not
   *  bound on settles. */
  readonly settles?: number;
  /** Never stop before this many settlements have landed — the warm-up that stops a rule from
   *  firing on an empty run. Default 1. */
  readonly minSettles?: number;
}
/**
 * "Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no
 * IMPROVEMENT over the last `settles` settlements.
 *
 * A tree whose only remaining nodes are armed WAITS is exempt from the time bound: a run waiting
 * on CI is not a run that stopped making progress, and killing it there would defeat mechanic C.
 */
declare function noProgressFor(opts: NoProgressForOptions): StopRule;
interface PlateauOptions {
  /** How many trailing settlements to judge. The rule fires when the whole window failed to lift
   *  the best-so-far by more than `minDelta`. */
  readonly window: number;
  /** The rise that counts as an improvement — the domain's noise floor. `0` means any strict rise
   *  counts. */
  readonly minDelta: number;
  /** Never fire before this many settlements. Defaults to `window` (so the first decision is made
   *  on a full window, not on a partial one). */
  readonly minSettles?: number;
}
/**
 * "The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than
 * `minDelta` across the last `window` settlements.
 *
 * Built on `anytime.plateauLength` — the same plateau math the post-run anytime report uses, so a
 * rule that stops a run and a report that grades the decision cannot disagree about whether the
 * run was flat.
 */
declare function plateau(opts: PlateauOptions): StopRule;
interface AllWorkersStalledOptions {
  /** Require at least this many live workers before the rule can fire — one stalled worker in a
   *  one-worker tree is a weaker signal than a whole fleet going quiet. Default 1. */
  readonly minWorkers?: number;
  /** Idle time that counts as stalled, passed through to the live progress read. Omit = the
   *  runtime default (`DEFAULT_STALL_AFTER_MS`). */
  readonly stallAfterMs?: number;
}
/**
 * "Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for
 * longer than the stall threshold — and none of the tree is merely waiting.
 *
 * `stalled` is a derived read at observation time, never a background watchdog; this rule only
 * reads it. A tree with armed waits never fires: waiting is not stalling.
 */
declare function allWorkersStalled(opts?: AllWorkersStalledOptions): StopRule;
/** Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end). */
declare function anyOf(...rules: ReadonlyArray<StopRule>): StopRule;
/** Stop only when EVERY rule stops — for a conservative gate that needs corroboration. */
declare function allOf(...rules: ReadonlyArray<StopRule>): StopRule;
//#endregion
//#region src/runtime/supervise/supervisor-agent.d.ts
/** A supervisor is an exact canonical AgentProfile; no looser model/prompt shape exists. */
type SupervisorProfile = AgentProfile;
/** The exact profile fields consumed by supervisor materialization. */
interface ResolvedSupervisorProfile {
  readonly name: string;
  readonly harness: string | null;
  readonly modelId: string;
  readonly systemPrompt?: string;
}
/**
 * Reduce one canonical executable profile to the scalars the two brain arms consume.
 */
declare function resolveSupervisorProfile(profile: SupervisorProfile): ResolvedSupervisorProfile;
/** Listener, authenticated remote endpoint, and bounded request policy for one manager. */
type CoordinationBinding = CoordinationTransportOptions;
/** Validate a manager's coordination authentication and request limits before execution. */
declare function assertCoordinationBinding(binding: CoordinationBinding | undefined): void;
/** Trusted run/node identity Runtime binds to one manager. Model-authored tool arguments cannot
 *  provide or replace any of these fields. */
interface SupervisorNodeContext {
  readonly runId: string;
  /** Stable across a durable restart; unique per in-memory invocation. */
  readonly runNamespace: string;
  /** Concrete Scope node that owns this manager's coordination stream. */
  readonly nodeId: string;
  /** Stable identity of this manager's coordination stream. */
  readonly ownerId: string;
  readonly depth: number;
  readonly identity: NodeExecutionIdentity;
  /** Assignment identity within the parent manager; absent only for the root. */
  readonly assignmentId?: string;
  readonly profile: SupervisorProfile;
  readonly task: unknown;
}
/** Context known before `Agent.act`; Runtime adds the concrete node, profile, and task. */
type SupervisorNodeContextSeed = Omit<SupervisorNodeContext, 'nodeId' | 'profile' | 'task'>;
/**
 * The coordination verbs THIS manager serves, callable in code from a product tool handler.
 *
 * Each verb dispatches by name to the live coordination descriptor's own handler, so a spawn made
 * here crosses the identical path the MCP verb crosses: `makeWorkerAgent` → `authorizeSpawn` /
 * security / `allowedModels`, the conserved pool reservation, the worker-slot queue, the journal, and
 * the event bus. There is no second spawn path and no way to bypass a gate by calling in code.
 *
 * The set is deliberately the COORDINATION surface only. `submit_result`, `stop`, and `ask_parent`
 * are the manager's own lifecycle verbs — a product tool that could settle the run or answer as
 * the manager would be a second brain, not a composition surface.
 *
 * Arguments and results are the same JSON shapes the MCP tools take and return.
 */
interface CoordinationVerbs {
  spawnAgent(args: unknown): Promise<unknown>;
  awaitEvent(args: unknown): Promise<unknown>;
  steerAgent(args: unknown): Promise<unknown>;
  observeAgent(args: unknown): Promise<unknown>;
  listQuestions(args: unknown): Promise<unknown>;
  answerQuestion(args: unknown): Promise<unknown>;
  runAnalyst(args: unknown): Promise<unknown>;
  /** This manager's OWN coordination journal, paged and redacted. A read, so a program may consult
   *  what it already did without spending a model turn on it. */
  readJournal(args: unknown): Promise<unknown>;
  /** Define a new trace-analyst lens for this run. Composition, not lifecycle: a program may define
   *  a lens and run it over the children it just joined, inside one model turn. */
  defineAnalyst(args: unknown): Promise<unknown>;
}
/** Trusted context for one product-tool invocation. The node identity remains the same detached,
 * immutable snapshot supplied to the resolver; `signal` and `verbs` are the live control
 * references Runtime adds. `signal` aborts when this manager's scope is cancelled by the caller,
 * RootHandle, deadline, breaker, or a recursive parent; `verbs` composes THIS manager's children
 * in code (see {@link CoordinationVerbs}). */
interface SupervisorToolInvocationContext extends SupervisorNodeContext {
  readonly signal: AbortSignal;
  readonly verbs: CoordinationVerbs;
  /** The static face (name / description / inputSchema) of every coordination tool mounted on
   *  THIS manager — the same objects that define the tools, so a product surface rendered from
   *  them (code mode's `search`) can never drift from the grant. Late-bound like `verbs`: a call
   *  before the coordination tools exist throws instead of answering an empty grant. */
  readonly coordinationTools: () => ReadonlyArray<CoordinationToolFace>;
}
/** One mounted coordination tool's static face; the handler is deliberately absent. */
interface CoordinationToolFace {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}
/** One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies
 *  the trusted invocation context as a separate argument and binds the result for either
 *  transport. Existing handlers remain compatible: the second argument only gains `signal`. */
interface SupervisorToolDescriptor extends Omit<McpToolDescriptor$1, 'handler'> {
  readonly handler: (raw: unknown, context: SupervisorToolInvocationContext) => Promise<unknown>;
}
/** Product policy for the tools one exact supervisor node may call. Resolved once per node. */
type ResolveSupervisorTools = (context: SupervisorNodeContext) => ReadonlyArray<SupervisorToolDescriptor> | Promise<ReadonlyArray<SupervisorToolDescriptor>>;
/** Context-aware observer used internally to bind product transactions to the actual live node. */
type ObserveSupervisorNodeEvent = (context: SupervisorNodeContext, event: CoordinationEvent, record: BusRecord<CoordinationEvent>) => void | Promise<void>;
/** How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate
 *  seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 *  `task` in its backend (remote sandbox or local CLI bridge) with `coordinationMcpUrl` mounted as an MCP server,
 *  so the harness calls spawn_worker / await_event / stop as native tools over the live scope. */
interface DriveHarness {
  (args: {
    /** The exact provider-visible projection. Runtime-owned coordination tool declarations are
     *  removed only when their descriptors are actually mounted; send this profile to the provider. */
    readonly profile: SupervisorProfile;
    /** The immutable canonical profile Runtime admitted. Use it only to bind receipts or audit
     *  authority; never send it to a provider, because it contains Runtime-owned declarations. */
    readonly authoredProfile: SupervisorProfile;
    /** The standing instruction assembled from the profile: its system prompt in either spelling,
     *  plus the `prompt.instructions` and `resources.instructions` lines. Absent when the profile
     *  names none — the harness's own default then applies. This, not `profile.systemPrompt`, is
     *  what the harness should run under. */
    readonly systemPrompt?: string;
    readonly task: unknown;
    readonly scope: Scope<unknown>;
    readonly coordinationMcpUrl: string;
    /** Runtime-only transport credentials; never append them to the authored profile or task. */
    readonly coordinationMcpHeaders?: Readonly<Record<string, string>>;
    /** Fires when the coordination server accepts a result or declares completion. */
    readonly stopSignal?: AbortSignal;
    /** Data-only product tool surface mounted on the coordination MCP. Runtime-owned drivers include
     *  this in their materialization evidence without persisting executable handlers. */
    readonly coordinationTools: ReadonlyArray<Omit<McpToolDescriptor$1, 'handler'>>;
    /** Present when this drive re-enters the run. `task` then carries the original objective and
     *  the coordinator's run state, which is right for any backend. A harness that can prove what
     *  the next turn continues composes the task from that proof instead, and reports it. */
    readonly reentry?: {
      readonly compose: (continuity: ReentryContinuity) => string;
      readonly onContinuity?: (continuity: ReentryContinuity) => void;
    };
  }): Promise<void>;
  /** Optional live inbox for the manager session this adapter currently drives. Return `false`
   * when no executor inbox is active instead of claiming a message was delivered. */
  deliver?(message: unknown): boolean;
  /** Optional readiness predicate for the live inbox. Root steers remain durable and unclaimed
   * until this returns `true`; it is checked only while the harness invocation is active. */
  deliverReady?(): boolean;
  /** Optional live evidence from the harness execution currently being driven. */
  traceSource?(): TraceSource | undefined;
  /** Optional live progress from the harness execution currently being driven. */
  progress?(): ExecutorProgress | undefined;
  /** Optional capture of the manager's own harness session from its newest attempt. */
  harnessTranscript?(): HarnessTranscriptCapture | undefined;
}
/** Trusted manager identity available before its external harness starts. A product uses this to
 * return one independently steerable harness session per recursive manager. */
type DriveHarnessOwnerContext = Omit<SupervisorNodeContext, 'nodeId'>;
/** Resolve an external harness for one exact Runtime-owned manager identity. */
type ResolveDriveHarness = (context: DriveHarnessOwnerContext) => DriveHarness;
interface SupervisorAgentDeps {
  readonly blobs: ResultBlobStore;
  /** Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms). */
  readonly makeWorkerAgent: MakeWorkerAgent;
  /** Product authorization for every down-leg continuation to a child. */
  readonly authorizeDownMessage?: AuthorizeDownMessage;
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget;
  /** Keep an inference turn available when recursive admission holds budget for this manager. */
  readonly preserveOwnerTurns?: true;
  /** Runtime-owned sink for provider identity observed by this manager's own turns. */
  readonly onProviderModel?: (model: string | undefined) => void;
  /** Independent completion check for direct driver work (`submit_result`). */
  readonly deliverable?: DeliverableSpec<unknown>;
  /** Receives a result only after this manager's completion check accepted it. */
  readonly onAcceptedSubmission?: (result: unknown) => void;
  /** Router substrate for a router-brained supervisor (`harness` omitted or `cli-base`). The
   *  profile's model wins. */
  readonly router?: RouterTransportConfig;
  /** Required to run an external-harness supervisor: runs the harness as the driver. */
  readonly driveHarness?: DriveHarness;
  /** How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
   *  `driver-failed` (#741). Retries reuse the same scope, coordination server, and live children;
   *  the bridge backend reattaches the harness session by its durable execution id. Omit = retry
   *  under the defaults; `{ enabled: false }` = the historical first-failure-ends-the-run behavior.
   *  The router arm is unaffected: its transport already retries. */
  readonly driverRetry?: DriverRetryPolicy;
  /** Per-attempt record for the external driver — how an operator sees "failed after N attempts"
   *  instead of one backend's last words. */
  readonly onDriverAttempt?: (record: DriverAttemptRecord) => void | Promise<void>;
  /** Called once when the external driver loop ends, returned or thrown, with what it did. */
  readonly onDriverLoopSettled?: (record: DriverContinuationRecord) => void;
  /** How an EXTERNAL manager with `deliverable` is sent back when its turn ends with the check
   *  unmet: the deadline, `maxBarren`, and the note's profile and switches (`./continuation.ts`).
   *  Required with `deliverable` on the external arm, refused without one, and refused for a
   *  router-brained supervisor, which runs its own turn loop in process. The harness owns its own
   *  turn loop, so it can end while the run has delivered nothing — 376 of 376 winning
   *  discovery-lab runs (2026-09-01) ended on the driver's own completion. A continuation reuses the
   *  retry path: same scope, same coordination server, same live children, same bounds. */
  readonly continuation?: ContinuationPolicy;
  /** Where this manager's continuation files go (`<dir>/<n>/note.md`, `verdict.json`,
   *  `panel.jsonl`). Omit to keep them in memory, where `read_continuation` still serves them. */
  readonly continuationDir?: string;
  /** The root manager's `root-stream.jsonl`; the question panel reads it as the director's trace. */
  readonly rootStreamPath?: string;
  /** Trusted identity for this manager. Required with node-scoped tools or observation. */
  readonly nodeContext?: SupervisorNodeContextSeed;
  /** Resolve product-owned tools for this exact manager. Static `extraTools` remain a router-only
   *  compatibility seam and deliberately receive no new recursive authority. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools;
  /** Awaited product observation, enriched with this manager's actual live node context. */
  readonly observeNodeEvent?: ObserveSupervisorNodeEvent;
  /** Replay resume-time settlements through `observeNodeEvent` before the manager starts. */
  readonly replaySettlements?: boolean;
  /** WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
   *  only delegate when it needs parallelism. Pair with `executeExtraTool`. */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  }>;
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (name: string, args: Record<string, unknown>) => Promise<string | null | undefined>;
  /** Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`. */
  readonly analysts?: AnalystRegistry$1;
  /** Where an `ask_parent` question goes when it leaves this manager. Omit and `ask_parent` reports
   *  `no-parent` — there is no runtime path that routes a question to a parent by itself. */
  readonly escalateQuestion?: EscalateQuestion;
  /** Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
   *  (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>;
  /** Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
   *  learns a worker is looping mid-run instead of at settle. Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions;
  /** Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default. */
  readonly stallAfterMs?: number;
  /** Router-driver arm only: max ms one `await_event` blocks before returning `{ pending }`. The
   *  harness arm keeps the fence derived from its MCP request timeout. Omit = runtime default. */
  readonly awaitTimeoutMs?: number;
  /** Default continuity per worker PROFILE NAME (both arms) — `'resume'` re-attaches spawns of
   *  that name to the node's latest settled worker; `spawn_worker`'s per-call `continuity`
   *  overrides. Omit = every spawn fresh (status quo). */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>;
  /** PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped learning BEFORE it
   *  exhausts a ceiling; it can never keep a run alive past one. Router arm: evaluated before each
   *  driver inference turn. External arm: evaluated on each worker settle, and a stop aborts
   *  `stopSignal` so the harness ends at its next turn boundary. Build it with `plateau` /
   *  `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
   *  caller's judgment. Omit = ceilings only. */
  readonly stopRule?: StopRule;
  /** One-shot notification of WHY a `stopRule` ended the run (BOTH arms). */
  readonly onProgressStop?: (reason: string, request?: RunCancelRequest) => void;
  /** Turn cap for the supervisor's own loop. Router arm: driver inference turns (see
   *  `DriverAgentOptions.maxTurns`). External arm: the cap belongs to the harness loop, so
   *  `supervise()` applies it in the drive seam it builds and this field is not read here. */
  readonly maxTurns?: number;
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY; a
   *  harness-brained supervisor is refused at construction rather than silently ignoring it) — it
   *  distills its coordination transcript to a compact progress note once it exceeds the threshold,
   *  instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`. */
  readonly compaction?: ToolLoopCompactionOptions;
  /** Pass-through subscriber for every coordination bus event (both arms) — the seam a durable
   *  caller hooks its coordination log onto. */
  readonly onEvent?: (event: CoordinationEvent, record: BusRecord<CoordinationEvent>) => void | Promise<void>;
  /** Questions, findings, and authorized continuation receipts loaded from a prior process.
   *  Router arm: questions seed the ledger and all evidence enters the resume brief. External arm:
   *  questions seed the ledger; receipts remain durable evidence and are never auto-delivered. */
  readonly priorCoordination?: PriorCoordination;
  /** Deferred owner-scoped replay for a recursive supervisor. Its stable owner is known while the
   * parent authorizes the child, but loading remains asynchronous; Runtime calls this before the
   * nested brain can publish or act on coordination state. */
  readonly loadPriorCoordination?: () => Promise<PriorCoordination>;
  /** How the settled ledger becomes the run's output (both arms). Default `bestDelivered` — the
   *  exact keep-best every existing caller had. Always runs under the delivered-only invariant. */
  readonly finalizer?: SupervisorFinalizer;
  /** Where the coordination MCP binds (external arm). Omit = an ephemeral loopback port, which is
   *  unreachable from an off-host harness. A non-loopback host fails closed — see
   *  {@link assertCoordinationBinding}. */
  readonly coordination?: CoordinationBinding;
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
   *  pre-journal point that may ask the backend a question (does this bridge route the child's
   *  wire id; is it already at admission capacity). `supervise` derives one automatically for a
   *  bridge backend; see `CoordinationToolsOptions.preflightSpawn`. */
  readonly preflightSpawn?: SpawnPreflight;
  /** Pre-journal profile resolution for `preflightSpawn`: the authored profile → the profile that
   *  will run, so the gate judges the canonical profile. See
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** Composition of each authored child profile before identity is fixed —
   *  `CoordinationToolsOptions.composeSpawnProfile`. */
  readonly composeSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** The run's validated profiles table — `CoordinationToolsOptions.profiles`. */
  readonly profiles?: ReadonlyMap<string, SuperviseProfileEntry>;
  /** See `CoordinationToolsOptions.spawnResourceRoot`: the directory a spawn's inline resource
   *  `path` resolves under. Set only for a manager whose workspace this process can read. */
  readonly spawnResourceRoot?: string;
  /** See `CoordinationToolsOptions.spawnResourceReader`: the manager's own environment as the
   *  source of a by-path resource, for a manager whose workspace is a sandbox this process
   *  cannot open. */
  readonly spawnResourceReader?: SpawnResourceReader;
  /** OPT-IN peer mail (external arm): serve the sibling `send_mail` / `read_mail` post office
   *  beside the coordination MCP and mint each spawn a capability URL on
   *  `WorkerSpawnContext.peerMailUrl`. A router-brained supervisor is refused: it serves no
   *  listener, so there is no post office a worker could reach. */
  readonly peerMail?: boolean | {
    limits?: Partial<PeerMailLimits>;
  };
  /** Durable control directory. Both arms acknowledge worker requests; external managers observe
   *  them throughout the harness invocation. See `DriverAgentOptions.controlDir`. */
  readonly controlDir?: string;
  /** Durable steer directory when it differs from the run-control directory. */
  readonly steerDir?: string;
  /** Which cancel requests this manager's acknowledger owns: `'run'` (default; the tree root —
   *  its own direct-child node ids plus label/profile-name references) or `'subtree'` (a nested
   *  manager — exact direct-child node ids only). Exactly one manager owns any request, so two
   *  acknowledgers can never apply one operation. See `DriverAgentOptions.controlScope`. */
  readonly controlScope?: 'run' | 'subtree';
  /** Abort the whole run — the seam a run-scoped cancel request is applied through (both arms,
   *  `'run'` scope only). See `DriverAgentOptions.abortRun`. */
  readonly abortRun?: (reason: string, request?: RunCancelRequest) => void;
}
/** Test-only dependency shape. It is exported only through the package's explicit `/testing`
 * entry; production supervisor surfaces cannot replace profile-derived model execution. */
interface SupervisorAgentTestDeps extends SupervisorAgentDeps {
  readonly brain: ToolLoopChat;
}
/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness`
 * (backend-as-data), the same resolution rule as every worker. */
declare function supervisorAgent(profile: SupervisorProfile, deps: SupervisorAgentDeps): Agent<unknown, unknown>;
/** Scripted-brain construction for deterministic tests. Not exported from Runtime's main entry. */
declare function supervisorAgentWithTestBrain(profile: SupervisorProfile, deps: SupervisorAgentTestDeps): Agent<unknown, unknown>;
//#endregion
//#region src/runtime/supervise/otel-spans.d.ts
/** OTLP span attribute values. Exported because `SupervisorSpanOptions.attributes` is public and
 *  a consumer cannot name the type it is asked to supply otherwise. */
type SupervisorSpanAttributes = Record<string, string | number | boolean>;
type Attrs = SupervisorSpanAttributes;
interface SupervisorSpanOptions {
  /**
   * The supervised run id (`SupervisorOpts.runId`). Roots the trace, identifies the root span, and
   * is the parent lookup key for every depth-0 spawn (a root scope's `parentId` IS the run id).
   */
  readonly runId: string;
  /**
   * Bring your own exporter. It is FLUSHED but never shut down by `finish()` — a caller that owns
   * the exporter owns its lifecycle. Takes precedence over `exportConfig`.
   */
  readonly exporter?: OtelExporter;
  /**
   * Otherwise build one with {@link createOtelExporter}. With no `endpoint` here it reads
   * `OTEL_EXPORTER_OTLP_ENDPOINT`, and with neither it resolves to `undefined` — which makes
   * {@link createSupervisorSpanRecorder} return `undefined` and the run emit nothing.
   */
  readonly exportConfig?: OtelExportConfig;
  /**
   * Trace id (32 hex chars). Pass the caller's own to JOIN an outer trace. Default: derived
   * deterministically from `runId`, so a resumed run lands in the SAME trace as the process that
   * started it.
   */
  readonly traceId?: string;
  /** Parent span id (16 hex chars) to hang the run's root span under — an inherited delegation span. */
  readonly parentSpanId?: string;
  /** `agent.name` on the root span. Default `'supervisor'`. */
  readonly agentName?: string;
  /** Extra attributes stamped on every span this recorder emits (subject, workspace, campaign, …). */
  readonly attributes?: Attrs;
  /** Injectable clock; used only for the root span's start/end. Default `Date.now`. */
  readonly now?: () => number;
}
/** How the supervised run ended, as `finish()` records it on the root span. */
interface SupervisorSpanOutcome {
  readonly result?: SupervisedResult<unknown>;
  /** A rejection out of the run itself (the supervisor never resolved). */
  readonly error?: unknown;
}
interface SupervisorSpanRecorder {
  /** Attach to `SupervisorOpts.hooks` (compose with a caller's own via `composeRuntimeHooks`). */
  readonly hooks: RuntimeHooks;
  /** The trace every span of this run belongs to. */
  readonly traceId: string;
  /** The run's root span id — pass it to a child process to join this trace. */
  readonly rootSpanId: string;
  /**
   * The trace context a worker spawned BY node `spawningNodeId` should inherit, so its own spans
   * join THIS trace under the span of the node that spawned it. Thread it to a run as
   * `SupervisorOpts.workerTrace` (`supervise()` does this whenever it builds a recorder) and the
   * `Scope` seeds it onto every child's `ExecutorContext`; a backend with an environment channel
   * stamps it with `workerTraceEnv`. An unknown node — one whose span was never opened — resolves
   * to the run's root span rather than to nothing, so a worker is never filed outside its own run.
   */
  readonly workerTrace: WorkerTraceResolver;
  /**
   * Close the root span (and any node that never settled, marked as such), export, and flush. Safe
   * to call twice; never throws — a telemetry failure is not a run failure.
   */
  finish(outcome?: SupervisorSpanOutcome): Promise<void>;
  /** What this run's exporter has delivered and lost so far. Also surfaced once, as a
   *  `console.warn`, on `finish()` when the closing flush dropped spans. */
  stats(): OtelExportStats;
}
/**
 * Build the span recorder for one supervised run, or `undefined` when no exporter resolves — the
 * off-by-default path. A run that passes no `exporter` and no `exportConfig` never reaches this
 * function at all; one that passes an `exportConfig` with no endpoint (and no env endpoint) gets
 * `undefined` here, so "configured but unreachable" also costs nothing.
 */
declare function createSupervisorSpanRecorder(opts: SupervisorSpanOptions): SupervisorSpanRecorder | undefined;
//#endregion
//#region src/runtime/supervise/run-context.d.ts
/** Options for a supervised run context. */
interface InMemoryRunContextOptions {
  /**
   * Wrap the executor registry with `withDriverExecutor` so a child constructed by `driverChild`
   * resolves to the recursive driver-executor (agents driving agents
   * over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
   * leaf workers. Default `false`.
   */
  readonly withDriver?: boolean;
}
/**
 * The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
 * The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.
 */
interface InMemoryRunContext {
  /** SQL contexts bind all stores and ownership to this durable run identity. */
  readonly runId?: string;
  readonly namespace?: string;
  readonly durability?: 'sql';
  /** Present only on an unacquired context. An acquired context cannot reacquire itself. */
  readonly acquire?: (signal?: AbortSignal) => Promise<RunContextLease>;
  readonly journal: SpawnJournal;
  readonly blobs: ResultBlobStore;
  readonly executors: ExecutorRegistry;
  /**
   * Present (and `true`) only on a DURABLE context (`createFileRunContext`), so spreading the
   * context into `SupervisorOpts` also opts the run into resume-first. An in-memory context
   * leaves it undefined: there is never a prior tree to resume, and the default stays fresh-run.
   */
  readonly resume?: boolean;
  /**
   * Present only on a DURABLE context: the coordination side-log stores questions, analyst
   * findings, answer decisions, and authorized continuation receipts that the spawn journal does
   * not own. `supervise({ runDir })` appends them as they publish and loads them on resume.
   * Continuation receipts are evidence and are never auto-delivered to a replacement worker.
   * In-memory contexts have none: nothing outlives the process.
   */
  readonly coordinationLog?: CoordinationLog;
}
/** The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the
 *  historical name for the same shape. */
type RunContext = InMemoryRunContext;
/** An immutable capability for one run ownership generation. */
interface RunContextLease {
  readonly context: RunContext;
  readonly signal: AbortSignal;
  release(): Promise<void>;
}
/** Hold a run context's ownership (when it has any) across the whole run, releasing after. */
declare function withRunContext<T>(context: RunContext, signal: AbortSignal | undefined, run: (context: RunContext, signal: AbortSignal | undefined) => Promise<T>): Promise<T>;
/**
 * Build a fresh in-memory run context. Every call returns NEW stores (no shared global
 * state between runs), so two runs never cross-contaminate their journals/blobs.
 */
declare function createInMemoryRunContext(opts?: InMemoryRunContextOptions): InMemoryRunContext;
/**
 * Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced
 * per append/write) under `dir`, and the context carries `resume: true` so spreading it into
 * `SupervisorOpts` makes the supervisor `loadTree`-first. A run that dies mid-flight therefore
 * resumes when it is re-run with the SAME `runId` and the SAME `dir`: the committed children come
 * back on `Scope.resume` (rehydrated by `replaySpawnTree`) instead of being re-executed.
 *
 * Layout: `${dir}/spawn-journal.jsonl` (one JSONL record per event), `${dir}/blobs/` (one
 * content-addressed JSON file per settled result), and `${dir}/coordination-log.jsonl`
 * (questions, findings, answer decisions, and authorized continuation receipts retained as
 * evidence). The directory is created on first write.
 *
 * Opt-in by construction — `createInMemoryRunContext()` is unchanged and stays the default, so no
 * existing consumer writes to disk or resumes unless it asks for this.
 */
declare function createFileRunContext(dir: string, opts?: InMemoryRunContextOptions): RunContext;
//#endregion
//#region src/runtime/supervise/worker-retry.d.ts
/** One re-entry, reported before it waits. */
interface WorkerSpawnRetryAttempt {
  /** 1-based: the attempt that just failed. */
  readonly attempt: number;
  /** How long this seam waits before re-entering `execute`. */
  readonly waitMs: number;
  /** The refused profile's name, when it declares one. */
  readonly worker?: string;
  readonly error: string;
}
/**
 * How hard a pre-spawn worker refusal is re-entered. Absent from `supervise` means NO retry — the
 * historical behaviour, and the conservative default: a worker failure already has a typed
 * settlement the driver can respond to, so adding silent latency to every run is not the runtime's
 * call to make.
 */
interface WorkerSpawnRetryPolicy {
  /** `false` disables the seam while leaving the option in a recorded run configuration. */
  readonly enabled?: boolean;
  /** Total wall-clock ms this seam may spend waiting for a slot, backoff included. Default 900000
   *  — the span measured between saturation and the next free slot on a four-way host executor. */
  readonly maxTotalMs?: number;
  /** Wait before the first re-entry, doubling per attempt. Default 5000. */
  readonly initialBackoffMs?: number;
  /** Ceiling on the doubling. Default 60000. */
  readonly maxBackoffMs?: number;
  /**
   * Extra PRE-SPAWN signatures a consumer's own admission layer emits, added to the built-in set.
   *
   * This widens which messages qualify, and it can only be used safely for a refusal the consumer
   * knows is emitted before any provider call. The second proof — that the attempt yielded no
   * execution event — still applies to every added signature, so a mistake here cannot cause a
   * double-spend on a stream that had already started.
   */
  readonly additionalPreSpawnSignatures?: ReadonlyArray<RegExp>;
}
interface WorkerSpawnRetryHooks {
  readonly onRetry?: (attempt: WorkerSpawnRetryAttempt) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
/** A policy with every bound decided — what {@link retryPreSpawnRefusals} acts on. Produced by
 *  {@link resolveWorkerSpawnRetry}, never written by hand, so one reading of the defaults serves
 *  the `supervise` option and a caller-owned seam alike. */
interface ResolvedWorkerSpawnRetry {
  readonly maxTotalMs: number;
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly signatures: ReadonlyArray<RegExp>;
}
/**
 * True when `error` is a backend refusal issued before anything ran.
 *
 * This answers "did this fail BEFORE any provider call", which is a strictly narrower question
 * than "is this an infrastructure hiccup". The broader question admits `ECONNRESET` and a bare
 * `fetch failed`, both of which can arrive after a metered call, and answering the broad question
 * where the narrow one is required is what makes a retry double-spend.
 */
declare function isPreSpawnExecutorFailure(error: unknown, additionalSignatures?: ReadonlyArray<RegExp>): boolean;
/** Read the policy, refusing a number a run cannot act on rather than silently clamping it. */
declare function resolveWorkerSpawnRetry(policy: WorkerSpawnRetryPolicy | undefined): ResolvedWorkerSpawnRetry | undefined;
/**
 * Wrap a worker seam so a leaf whose spawn is refused before it runs is re-entered instead of
 * settling dead.
 *
 * The wrapper composes the agent's `executorFactory`, which is where a leaf executor is built with
 * the real child signal and node context, and it never replaces the executor object the factory
 * returned: the retry lives in one `execute` wrapper that carries the inner executor's attestation
 * forward and delegates every other surface to it.
 */
declare function withWorkerSpawnRetry(make: MakeWorkerAgent, policy: WorkerSpawnRetryPolicy | undefined, hooks?: WorkerSpawnRetryHooks): MakeWorkerAgent;
/**
 * Re-enter `execute` on one executor while a pre-spawn refusal keeps proving nothing ran.
 *
 * Exported so an owner of `makeLeafAgent` — which builds its own executors — gets the same seam
 * without reimplementing the two proofs.
 */
declare function retryPreSpawnRefusals<Out>(inner: Executor<Out>, policy: ResolvedWorkerSpawnRetry, hooks?: WorkerSpawnRetryHooks & {
  worker?: string;
}): Executor<Out>;
//#endregion
//#region src/runtime/supervise/supervise.d.ts
/**
 * Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 * deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 * deliver"). The ONE place a backend becomes a spawnable worker.
 *
 * `seams` exists because this path builds the leaf executor EAGERLY and hands it back as a BYO
 * `executorSpec.executor`. The registry resolves a BYO executor without ever consulting the
 * per-child `ExecutorContext` the `Scope` seeds, so anything the scope would have supplied is
 * invisible here and has to be passed in. It is a FUNCTION because it is resolved once per worker
 * construction, so a caller may hand back something the run only learns later — which is exactly how
 * `supervise()` gives a traced run's workers their trace context without ordering the span recorder
 * ahead of the worker seam.
 *
 * Continuity: the `bridge` backend honors `continuity: 'resume'` by session re-attachment. A
 * bridge session id IS the harness conversation key (cli-bridge maps it to the CLI's own resume —
 * opencode `-s <id>`, claude `--resume`), so this seam records the session id each supervised
 * spawn was bound to, keyed by the worker id the Scope assigned, and a resume spawn binds the
 * prior worker's recorded session id instead of deriving a fresh one. The record is process-local
 * by construction, which matches the kernel's resume boundary (a prior process's workers are not
 * resume targets). Every other backend keeps failing loud: their executors have no re-attachable
 * session, and accepting the spawn would ledger `continuity: 'resume'` over a brand-new session —
 * a stamp asserting something that never happened.
 */
declare function workerFromBackend(backend: ExecutorConfig, deliverable?: DeliverableSpec<unknown>, seams?: () => Readonly<Record<string, unknown>>): MakeWorkerAgent;
/** Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and
 * ambient connection grants therefore fail closed by default, in addition to local MCP and hooks. */
declare const DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY: AgentProfileSecurityPolicy;
/** A name→value table, in this package's resolver-port shape (the same one `WaitProbeRegistry`
 *  uses): construction stays the caller's, lookup stays lazy, and a table backed by a file, a
 *  plugin loader, or a plain object all satisfy one interface. */
interface SuperviseRegistryTable<T> {
  resolve(name: string): T | undefined;
  /** The names the table holds. The four code-valued tables may omit it, because a caller names
   *  their entries from data it already has. The profiles table must list them, because a
   *  director can choose only from a menu it can read. */
  names?(): readonly string[];
}
/**
 * The name→value tables that make the four CODE-valued options expressible as run DATA, and the
 * profiles a director may spawn by name.
 *
 * `deliverable` / `finalizer` / `analysts` / `probes` are functions and registries, so a recorded
 * run configuration (a JSON row, a campaign spec, a resumed run's options) cannot carry them — and
 * a run with no `deliverable` cannot return a `winner` at all outside the sandbox backend, because
 * the finalizer keeps only children whose oracle passed and nothing else writes that verdict. A
 * caller that owns the code registers it here once and names it from data thereafter.
 *
 * `profiles` is the profiles table: named AgentProfiles that every manager in the tree may spawn
 * with `spawn_worker({ profile: '<name>' })` instead of retyping them. The table is read once, when
 * `supervise` is called: each entry is validated like a root profile and frozen, so every spawn by
 * a name starts from the same bytes. Unless `profileGuidance` or `authorizeSpawn` rewrites the
 * profile, the journal records the entry's digest for the child. Omit the table, or list no names,
 * and nothing about the run changes: `spawn_worker` keeps its object-only `profile`.
 */
interface SuperviseRegistry {
  readonly deliverables?: SuperviseRegistryTable<DeliverableSpec<unknown>>;
  readonly finalizers?: SuperviseRegistryTable<SupervisorFinalizer>;
  readonly analysts?: SuperviseRegistryTable<AnalystRegistry$1>;
  readonly probes?: SuperviseRegistryTable<WaitProbeRegistry>;
  readonly profiles?: SuperviseRegistryTable<SuperviseProfileEntry> & {
    names(): readonly string[];
  };
}
interface SuperviseOptions {
  /** Whole-run persistence and ownership. SQL contexts are acquired before replay and compute. */
  readonly runContext?: RunContext;
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget;
  /** Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
   * attaches it before execution and detaches it after the join barrier. */
  readonly rootHandle?: RootHandle<unknown>;
  /** Caller-owned cancellation for the complete recursive run. Aborting it cascades through the
   * root scope and every live child, including acquisition and backend execution. */
  readonly signal?: AbortSignal;
  /** Trusted candidate and pursuit attribution for the root. The runtime derives profile/task
   * digests itself from the exact detached values it executes. */
  readonly execution?: AgentExecutionRef;
  /** WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig;
  /** The independent completion check for backend-derived workers and direct supervisor
   *  submissions. Strongly recommended: without it the supervisor cannot submit its own work and
   *  backend-derived workers fall back to their own validity signal. A `string` names an entry in
   *  `registry.deliverables`. */
  readonly deliverable?: DeliverableSpec<unknown> | string;
  /** Resolve the completion check for one exact authorized backend-derived child. The callback runs
   * after spawn authorization and receives a detached immutable context. It may return `undefined`
   * to use the run-wide `deliverable`; a managed child receives its selected check for direct work. */
  readonly resolveDeliverable?: (input: DeliverableResolutionInput) => DeliverableSpec<unknown> | undefined;
  /** Name→value tables for the four code-valued options, so a recorded run configuration can name
   *  them instead of carrying closures. See {@link SuperviseRegistry}. */
  readonly registry?: SuperviseRegistry;
  /** Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
   *  port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
   *  unless authentication is configured; provider managers also need a reachable public URL. */
  readonly coordination?: CoordinationBinding;
  /** OPT-IN peer mail for the run's workers: sibling-to-sibling `send_mail` / `read_mail`, bounded
   *  and audited (`CoordinationToolsOptions.peerMail`). The runtime mints one capability URL per
   *  spawn, serves the mail listener beside the coordination MCP, and hands each worker its
   *  endpoint on {@link WorkerSpawnContext.peerMailUrl}.
   *
   *  On the backend-derived worker path the runtime also MOUNTS that endpoint, the way a driver
   *  receives its coordination MCP: out of band on the bridge's `runtime_attachments`, so the
   *  authored profile digest never moves, and inside the leaf factory, so `authorizeSpawn` has
   *  already decided the profile. A `bridge` worker therefore calls `send_mail` / `read_mail` as
   *  native tools. `router`, `router-tools` and `provider` workers run no MCP client, so the URL
   *  stays the caller's to use; every other backend refuses the spawn rather than mint a
   *  capability it can never reach. A caller-owned `makeWorkerAgent` owns its own mount.
   *
   *  Requires a harness-brained supervisor; a router-brained supervisor is refused rather than
   *  silently unmailed. */
  readonly peerMail?: boolean | {
    limits?: Partial<PeerMailLimits>;
  };
  /** Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
   *  This is caller-owned execution: profile security, spawn authorization, and recursive-driver
   *  selection below apply only to the backend-derived worker path. `authorizeMessage` still
   *  governs continuations sent through Runtime's coordination tools. */
  readonly makeWorkerAgent?: MakeWorkerAgent;
  /** Override ONLY how an authorized LEAF executes, keeping the whole backend-derived path —
   *  profile security, spawn authorization, recursive-driver selection, nested supervisors — in
   *  force. Unlike `makeWorkerAgent`, which replaces that path, this slots inside it: the kernel
   *  authorizes and classifies every spawn, and a child that is NOT a driver runs through this
   *  factory instead of `backend`. A child that IS a driver still becomes a nested supervisor, whose
   *  own leaves use this same factory. Composes with `authorizeSpawn`; `backend` is then optional.
   *  This is the seam an offline test or a pinning layer (an agent graph) should use. */
  readonly makeLeafAgent?: MakeWorkerAgent;
  /** Reconstruct executors for interrupted children on resume, for a run that owns its worker
   *  factory (`makeWorkerAgent`/`makeLeafAgent`). Backend-derived recursive managers register one
   *  automatically; a caller-owned factory cannot be, so a leaf whose execution can RE-ATTACH
   *  across a process boundary (a sandbox session, a CLI bridge session — an executor that
   *  journals its admission through the retained seam) needs this for a resume to recover the
   *  in-flight child instead of refusing its key `in-doubt`. The factory receives the
   *  reconstructed spec and the child's journaled context, including its prior admissions. */
  readonly recoverExecutor?: ExecutorFactory<unknown>;
  /** Run harness-brained supervisors here. Automatic execution supports a local `bridge`, or a
   * provider advertising runtime MCP attachments with authenticated `coordination.publicUrl`.
   *  Defaults to `backend`; separate it when managers and workers use different services. */
  readonly driverBackend?: ExecutorConfig;
  /** Security policy applied to every manager-authored child profile before budget reservation.
   *  The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
   *  allowlist to grant remote MCP hosts or other author-controlled capabilities. */
  readonly profileSecurity?: AgentProfileSecurityPolicy;
  /** Product authority over one complete manager-authored spawn. The callback sees the detached,
   *  immutable profile, task, budget, label, and key together, so approving a profile cannot
   *  authorize a different task. Return the exact allowed profile (which may be narrowed) plus
   *  trusted candidate/pursuit attribution, or throw to refuse the whole spawn before reservation. */
  readonly authorizeSpawn?: (input: {
    readonly profile: AgentProfile;
    readonly parent: AgentProfile;
    /** Trusted identity of the manager authorizing this exact child. */
    readonly parentIdentity: NodeExecutionIdentity;
    /** Concrete manager node; never accepted from model-authored tool arguments. */
    readonly parentNodeId: string;
    /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
    readonly assignmentId: string;
    readonly task: unknown;
    readonly budget: Budget;
    readonly label: string;
    readonly key?: string;
    readonly depth: number;
    /** Present (as the analyst id) only when the runtime's analyst-on-settle hook initiated this
     *  spawn — authored by the runtime, never accepted from a driver's tool arguments. A node-pinning
     *  authority reads it to admit the analyst node it would refuse as a driver-authored spawn. */
    readonly analyst?: string;
    /** The EFFECTIVE continuity of this spawn, resolved by the coordination layer. */
    readonly continuity?: ContinuityMode;
  }) => AuthorizedSpawn;
  /** Product authority over every continuation sent to a live child. When spawn authorization is
   * enabled, omitting this refuses steer/answer instructions instead of silently extending the
   * authorized task. The exact worker identity and detached bytes are recorded before delivery. */
  readonly authorizeMessage?: (input: DownMessageAuthorizationInput & {
    readonly parent: AgentProfile;
    readonly depth: number;
  }) => AuthorizedDownMessage;
  /** The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
   *  model wins. */
  readonly router?: RouterTransportConfig;
  /** When `driverBackend` is absent, whether an external-harness ROOT may default to running on
   *  `backend` (where workers run). `true` (default) keeps the convenience every direct caller has.
   *  A layer that gives `backend` a narrower meaning — `runGraph`, where it places WORKER nodes only
   *  — sets `false`, so an external root without an explicit `driverBackend` is refused before any
   *  compute rather than silently driven from the worker placement. */
  readonly rootDriverFromBackend?: boolean;
  /** Pre-journal profile resolution for the spawn pre-flight: the profile a driver authored →
   *  the profile that will run (`CoordinationToolsOptions.resolveSpawnProfile`). A pinning layer
   *  sets this alongside `authorizeSpawn` so the backend gate and the authorization see the same
   *  canonical profile. Identity-free and synchronous; throw to refuse. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** OPT-IN standing guidance from the profile knowledge base
   *  (`@tangle-network/agent-interface/profile-kb`). `'profile-kb'` composes harness guidance,
   *  then model guidance, then the profile's own text into the root profile and into every
   *  profile a manager spawns, before identity is fixed, so receipts bind the prompt that ran.
   *  Omit to run profiles exactly as authored: Runtime selects no standing guidance by itself. */
  readonly profileGuidance?: 'profile-kb';
  /** Whether a spawned profile that declares no Runtime coordination tool receives its manager's
   *  coordination grants (`spawn_worker`, `await_event`, and the rest, plus `submit_result` so it
   *  can still deliver work it does itself), so every child can lead children of its own. Default
   *  `true`. A child whose author wrote any coordination entry, true or false, keeps what was
   *  written (a `false` entry is dropped once it has kept the child a leaf). A child this run
   *  cannot drive as a manager (no driver for its harness, or no `router` for a harness-less one)
   *  stays a leaf, and so does every child of a run with no completion check (`deliverable` or
   *  `resolveDeliverable`), since a manager delivers its own work only through `submit_result`.
   *  `false` runs every authored profile exactly as written. Applies to backend-derived workers;
   *  a caller-owned `makeWorkerAgent` decides its own children. */
  readonly inheritSpawnRights?: boolean;
  /** Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
   *  caller-owned override for a local bridge. */
  readonly driveHarness?: DriveHarness;
  /**
   * How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
   * `driver-failed`. A harness process SIGKILLed at a bridge timeout, a stream cut mid-turn, or an
   * upstream 5xx used to end a run of arbitrary length while its budget and deadline sat almost
   * untouched (#741). A retry re-enters the driver over the SAME scope, coordination server, and
   * live children; the bridge backend reattaches the harness session by its durable execution id.
   *
   * Runtime's own refusals (a validation guard, an exhausted budget, an abort, a client-side
   * transport status) are never retried — they were decisions. Retries stop at the budget, the
   * deadline, an abort, or a run of attempts that changed nothing at all.
   *
   * Omit = retry under the defaults. `{ enabled: false }` = the historical behavior where the first
   * driver failure ends the run. Applies to the root manager and every recursive manager under it.
   */
  readonly driverRetry?: DriverRetryPolicy;
  /** Per-attempt record for every external driver in the tree — what makes "failed after N
   *  attempts, last cause X" visible instead of one backend's last words. */
  readonly onDriverAttempt?: (record: DriverAttemptRecord) => void | Promise<void>;
  /**
   * How a BACKEND-DERIVED WORKER whose spawn was refused before it ran is re-entered, instead of
   * settling dead with a slot free seconds later.
   *
   * `driverRetry` guards the root only. A worker that dies is typed into a `down` settlement,
   * which is the right shape when the worker RAN — and the wrong shape for
   * `host-executor: acquire timeout after 60000ms (in_flight=4/4, queued=1)`, a queue refusal the
   * bridge emits before any harness child exists. Measured 2026-08-22 on discovery-lab cells
   * oscnp s2/s3: ten live agents on one bridge that admits four, and every worker refused at the
   * 60 s acquire deadline was lost for the whole run.
   *
   * Fail-closed on two proofs that the attempt did no work: the error carries a pre-spawn
   * signature, AND the attempt yielded no execution event. An attempt that streamed anything may
   * have metered usage, so a blind re-run would double-spend and stays fatal.
   *
   * Omit = no retry, the historical behaviour. Applies to backend-derived leaves, including those
   * a `makeLeafAgent` builds; a caller-owned `makeWorkerAgent` composes
   * {@link withWorkerSpawnRetry} itself.
   */
  readonly workerRetry?: WorkerSpawnRetryPolicy;
  /** Per-re-entry record for every retried worker spawn — what makes a saturated executor visible
   *  as waiting rather than as a worker that silently took longer. */
  readonly onWorkerRetry?: (attempt: WorkerSpawnRetryAttempt) => void;
  /**
   * How an EXTERNAL-harness manager with a completion check is sent back when its turn ends with
   * the check unmet: the deadline, `maxBarren`, and the continuation note's profile and switches.
   *
   * A harness owns its own turn loop, so it decides when it is finished — and it can decide that
   * while the run has produced nothing. Measured on discovery-lab (2026-09-01, n = 1,422 settled
   * runs): 376 of 376 winning runs ended on the driver's own completion, and the completion gate
   * could only LABEL an undelivered result `valid:false`, never send the driver back for it. By
   * 2026-09-24, 650 recorded inputs had chosen seven different re-prompt counts, and the note the
   * director heard held no line of the check's verdict.
   *
   * A continuation is the retry path, not a second loop: same scope, same coordination server,
   * same live children, and the same budget, deadline, and abort bounds. There is no count: the
   * loop ends when the check passes, when `report_blocked` shows a tool really failed, at this
   * deadline, on the budget, after `maxBarren` turns in a row without progress, or on
   * cancellation. Runtime writes the note from the check's verdict (`./continuation.ts`); the
   * profile owns its words, and `append` may add a section but never replace one.
   *
   * Required with `deliverable` (or `resolveDeliverable`) for an external manager, and applied to
   * every external manager with a completion check in the tree. Refused for a router-brained
   * manager, which runs its turn loop in process.
   */
  readonly continuation?: ContinuationPolicy;
  /**
   * How long live children may keep running after the root driver returns or fails, before the join
   * barrier cascades the abort into them. `null` waits until children settle or the caller cancels.
   * An explicit run deadline always wins. Omit/`0` = immediate teardown.
   */
  readonly childSettleGraceMs?: number | null;
  /**
   * How long settlement keeps retrying a child teardown the executor has not confirmed, with
   * exponential backoff, before naming the child in `teardownUnconfirmed` with the provider
   * environment ids a sweeper deletes. `0` makes one attempt only. Default: 300000 (5 minutes).
   * See `SupervisorOpts.teardownConfirmMs`.
   */
  readonly teardownConfirmMs?: number;
  /**
   * What root settlement does with provider environments that settled children still hold for a
   * retained execution: `'release'` them with one `environment-teardown` receipt each and close
   * each released child's cursor slot with a terminal record marked `retainedExecution:
   * 'released'`, or `'keep'` them for a later call that resumes this run. Default: `'keep'` with
   * `runDir` (re-running the same `runDir` and `runId` resumes), `'release'` without it (nothing
   * can resume an in-memory run). See `SupervisorOpts.retainedAtSettlement`.
   */
  readonly retainedAtSettlement?: 'release' | 'keep';
  /** Resolve one custom external-harness session per trusted manager identity. Use this instead of
   * `driveHarness` when recursive managers must be independently steerable. */
  readonly resolveDriveHarness?: ResolveDriveHarness;
  /** Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
   * AgentProfile axes that path really applies. Built-in bridge driving supplies its own
   * full-profile contract. */
  readonly driveHarnessMaterialization?: ProfileMaterializationContract;
  /** Resolve product-owned tools from the exact trusted manager context. The same descriptors and
   * handlers are bound to router and external-harness managers; resolution happens once per node.
   * Each handler receives that manager scope's live cancellation signal in its trusted invocation
   * context, including recursive parent and root cascades, plus `context.verbs` — that manager's
   * own coordination verbs, callable in code so a product tool can COMPOSE its children (fan out,
   * chain, join, retry) in one tool call instead of one model turn per verb. Every verb crosses
   * the same authorizeSpawn / security / allowedModels gate, pool reservation, worker-slot
   * queue, journal, and bus the MCP verb crosses, at every depth and on both arms. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools;
  /**
   * Where an `ask_parent` question goes when it leaves a manager (see {@link EscalateQuestion}).
   *
   * Installed on EVERY manager of the run, at every depth, so a driver's escalation reaches the
   * product's own inbox — a UI, an operator queue, a human. Omit and every manager reports
   * `outcome: 'no-parent'` on `ask_parent`, which is the honest reading when nothing above it is
   * listening: the runtime routes no question to a parent by itself.
   */
  readonly escalateQuestion?: EscalateQuestion;
  /** Awaited product transaction hook for every coordination record. `eventId` is stable across a
   * lost acknowledgement and durable restart; the record is not pull-visible until this commits. */
  readonly onCoordinationEvent?: (context: SupervisorNodeContext, eventId: Sha256Digest, record: BusRecord<CoordinationEvent>) => void | Promise<void>;
  /** WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
   *  itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
   *  `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  }>;
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (name: string, args: Record<string, unknown>) => Promise<string | null | undefined>;
  /** The root's default slice for a child whose manager names no `budget`. Defaults to a quarter
   *  of the part of the pool children may reserve (the pool less any owner share). A nested
   *  manager always divides its own slice that way; `spawn_worker`'s `budget` overrides per spawn. */
  readonly perWorker?: Budget;
  /** Opt-in owner share: every manager, the root included, keeps this fraction of its own slice
   *  free of its children's reservations, so its own turns keep budget. Default slices shrink to fit
   *  beside it. Default: off. */
  readonly reservationPolicy?: RecursiveReservationPolicy;
  /** Bound on concurrently WORKING agents across the whole recursive tree: a number, or one
   *  `createWorkerSlots` allocator that several runs in this process share. A spawn past it keeps
   *  its budget slice and waits in a queue (deepest first) instead of being refused, and a manager
   *  lends its slot to its first running child, so nested waits cannot deadlock. The root holds no
   *  slot. Omit/`<= 0` = no bound (the conserved pool stays the only bound). */
  readonly workerSlots?: number | WorkerSlots;
  /** Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
   *  (the driver receives settled worker outputs, no analyst findings). A `string` names an entry in
   *  `registry.analysts`. */
  readonly analysts?: AnalystRegistry$1 | string;
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>;
  /**
   * Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
   * moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
   * instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
   * is the correction. Requires a backend whose executor exposes a trace source (the steerable
   * sandbox worker and the pi wrapper do); other runtimes are simply not watched.
   *
   * Omit = off (status quo — no online watching, no extra events).
   */
  readonly watchWorkers?: WorkerWatchOptions;
  /** Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
   *  at observation time — nothing is killed or retried. Omit = the runtime default. */
  readonly stallAfterMs?: number;
  /** Max wall-clock ms one `await_event` of an in-process Router driver blocks before it returns a
   *  re-pollable `{ pending, live }` snapshot. Each return costs the driver a turn, so a run whose
   *  workers take hours needs either a large `maxTurns` or a longer wait. A harness-driven
   *  supervisor keeps the fence derived from its MCP request timeout. Omit = the runtime default. */
  readonly awaitTimeoutMs?: number;
  /** Default continuity per worker PROFILE NAME: `'resume'` makes each spawn of that name after
   *  the first re-attach to the node's most recent SETTLED worker — a NEW live worker whose spawn
   *  context carries the prior worker's identity (`WorkerSpawnContext.resume`), which the executor
   *  seam re-attaches with. `spawn_worker`'s per-call `continuity` argument overrides in either
   *  direction; `runGraph` derives this from delegates-edge `continuity`. Omit = every spawn is
   *  `'fresh'` (status quo). See `CoordinationToolsOptions.continuityByProfile` for the
   *  refusal semantics (no-prior / while-live / with-key) and the process-local resume boundary. */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>;
  /** Worker output store. Defaults to in-memory. */
  readonly blobs?: ResultBlobStore;
  /**
   * Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
   * this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
   * tree first. Re-running with the same `runDir` AND the same `runId` resumes only when the exact
   * root profile/task identity and declared budget match. The original absolute deadline and prior
   * measured spend are restored before new admission. The built-in driver is resume-aware: children
   * that already settled, including their exact execution identities, are replayed onto
   * `Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
   * (`spawn_worker`'s `key`) resolve to their committed results instead of re-running, pending
   * waits re-arm on their original deadlines, and the coordination log loads prior questions,
   * findings, and instruction receipts. The router arm receives all three in its resume brief; the
   * external arm seeds prior questions while findings and receipts remain in the durable log.
   * Instruction receipts are evidence and are never delivered automatically to a replacement
   * worker. The final result spans both processes' work. Unset = in-memory, fresh every call.
   *
   * The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
   * the built-in executors cannot re-attach to a dead process's executions. Each such keyed
   * assignment resumes as `in-doubt`, its full declared reservation stays charged, and its
   * token/dollar telemetry remains unknown. Runtime refuses a replacement under that key until the
   * exact prior execution is recovered, so restart cannot duplicate work or slide the deadline.
   *
   * `runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
   * resumable run per directory but collides across concurrent runs sharing one `runDir`.
   */
  readonly runDir?: string;
  /** Opt into resume-first explicitly when the durable stores are caller-supplied (`journal` +
   * `blobs`, e.g. `createSqlRunContext`) instead of derived from `runDir`. Exactly what the file
   * context sets automatically: load the prior tree for `runId` before starting fresh, refuse a
   * reused id without it. Ignored when `runDir` is also set — the file context owns the flag. */
  readonly resume?: boolean;
  /** Durable steer directory when it differs from the run-control directory. */
  readonly steerDir?: string;
  /** Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
   *  with `blobs` — a journal whose result payloads live in a different store cannot replay. */
  readonly journal?: SpawnJournal;
  /** Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
   *  wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
   *  refused `unknown-probe` and `timer` waits still work. A `string` names an entry in
   *  `registry.probes`. */
  readonly probes?: WaitProbeRegistry | string;
  /**
   * PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped LEARNING before it
   * exhausts a ceiling — the answer to "a run should end because it is done or stuck, not because
   * it ran out". It composes with the budget guards and can never override one.
   *
   * The evaluation boundary differs by arm because the loop does: a router-brained supervisor is
   * evaluated before each of its own inference turns; a harness-brained supervisor is evaluated on
   * each worker settle, and a stop aborts its stop signal so the harness ends at its next turn
   * boundary. Both arms fold the same settled ledger through the same evaluator.
   *
   * Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
   * `noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
   * thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
   * only (unchanged behavior).
   *
   * A record may declare the plateau rule as data, `{ plateau: { window, minDelta } }`, so no
   * product module builds it.
   */
  readonly stopRule?: StopRule | {
    readonly plateau: PlateauOptions;
  };
  /** One-shot notification of WHY a `stopRule` ended the run (BOTH arms) — so a caller records the
   *  reason instead of inferring an early stop from an unexhausted budget. */
  readonly onProgressStop?: (reason: string) => void;
  /** Recursion ceiling for the tree (root = 0). The conserved pool is what bounds depth, since each
   *  level's slice comes out of the level above; this only stops a runaway recursion. Omit =
   *  `DEFAULT_MAX_DEPTH` (16). */
  readonly maxDepth?: number;
  /** Turn cap for the supervisor's OWN loop (BOTH arms). Router arm: inference turns of the
   *  driver's tool loop. Harness arm: turns the harness reports, counted off its `iteration`
   *  stream — reaching the cap aborts the stop signal, so the harness ends at its next turn
   *  boundary rather than mid-request. `0` lifts the cap on both arms and leaves the conserved
   *  pool, the deadline, and abort as the bounds; a negative value is refused. Omit = the router
   *  arm's default cap, and no turn cap on the harness arm. */
  readonly maxTurns?: number;
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY —
   *  a harness owns its own context window and its own compaction, so this is refused for a
   *  harness-brained supervisor rather than silently ignored): once its coordination transcript
   *  exceeds `thresholdTokens` it distills to a compact progress note and continues, instead of
   *  re-billing the whole transcript every turn (the cost that makes the LLM-brain front door lose
   *  to a dumb-Ralph respawn). The live `Scope` roster is the durable state across chapters.
   *  Default off. `distill` defaults to a brain self-summary + the settled-worker roster. */
  readonly compaction?: ToolLoopCompactionOptions;
  readonly runId?: string;
  readonly now?: () => number;
  /** Restrict the run to this subset of models. When set, every configured model — the
   *  supervisor router model, the profile's model, and the backend's model — must be a member,
   *  or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.
   *
   *  This is a MODEL-ID filter, not a route filter. The compared values are the bare ids a profile
   *  declares — `model.default`, `model.small`, `subagents[].model`, `modes[].model`. The composed
   *  wire id (`harness/provider/model`) is never built here and never compared, so an entry written
   *  in qualified form matches nothing, and a child that names an allowed id is admitted whatever
   *  harness and provider its own profile declares. Pin the route with `authorizeSpawn`: it reads
   *  the authored child profile and may refuse the spawn before any reservation. */
  readonly allowedModels?: readonly string[];
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
   *  `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
   *  disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
   *  structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. A
   *  `string` names an entry in `registry.finalizers`. */
  readonly finalizer?: SupervisorFinalizer | string;
  /** Lifecycle observers for the whole recursive tree (`Scope` re-seeds them into every nested
   *  scope). Composed with the `otel` recorder below when both are set. Omit = no observers, which
   *  is the behavior every existing caller has. */
  readonly hooks?: RuntimeHooks;
  /**
   * OPT-IN OTLP tracing: emit one span per supervised node (opened at spawn, closed at settle,
   * parented to its parent node's span) plus an `LLM` child span per metered driver turn, so the
   * tree is readable by any trace viewer instead of only by a journal parser. See `otel-spans.ts`.
   *
   * Omit and the run emits nothing, allocates no recorder, and installs no hook — telemetry is
   * never a default. Present with no reachable endpoint (no `exportConfig.endpoint` and no
   * `OTEL_EXPORTER_OTLP_ENDPOINT`) is also a no-op. The spawn journal is untouched either way:
   * spans are telemetry, never the replay/resume record.
   */
  readonly otel?: Omit<SupervisorSpanOptions, 'runId' | 'now'>;
}
/** The product-authorized result for one complete spawn request. Attribution is never accepted
 * from the manager itself; it enters only through this trusted callback. */
interface AuthorizedSpawn {
  readonly profile: AgentProfile;
  readonly execution?: AgentExecutionRef;
}
/** Exact trusted context after a manager-authored spawn has passed product authorization. */
interface AuthorizedSpawnContext {
  readonly profile: AgentProfile;
  readonly parent: AgentProfile;
  readonly parentIdentity: NodeExecutionIdentity;
  readonly execution: NodeExecutionIdentity;
  readonly parentNodeId: string;
  readonly assignmentId: string;
  readonly task: unknown;
  readonly budget: Budget;
  readonly label: string;
  readonly key?: string;
  readonly depth: number;
}
/** Exact trusted context for selecting one backend-derived leaf's completion check. */
type DeliverableResolutionInput = AuthorizedSpawnContext;
/** Test-only one-call shape, exported only through the package's explicit `/testing` entry. */
interface SuperviseTestOptions extends SuperviseOptions {
  readonly brain: ToolLoopChat;
}
/** One-call supervisor: build + run a supervisor from its exact profile. @stable */
declare function supervise(profile: SupervisorProfile, task: unknown, opts: SuperviseOptions): Promise<{
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "no-winner";
  tree: TreeView;
  downCount: number;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  error?: never;
  reason: "all-children-down" | "no-children-spawned" | "no-result-selected" | "budget-exhausted" | "aborted";
} | {
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "no-winner";
  tree: TreeView;
  downCount: number;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  error?: never;
  reason: "cancelled";
  source: string;
  cancellationReason: string;
  operationId?: string;
} | {
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "no-winner";
  reason: "driver-failed";
  tree: TreeView;
  downCount: number;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  error: NoWinnerError;
} | {
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "winner";
  out: unknown;
  outRef: string;
  verdict?: import("@tangle-network/agent-eval").DefaultVerdict;
  tree: TreeView;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  spentBreakdown?: {
    driverInference: Spend;
    childWork: Spend;
  };
}>;
/** Deterministic scripted-brain path for tests. Not exported from Runtime's main entry. */
declare function superviseWithTestBrain(profile: SupervisorProfile, task: unknown, opts: SuperviseTestOptions): Promise<{
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "no-winner";
  tree: TreeView;
  downCount: number;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  error?: never;
  reason: "all-children-down" | "no-children-spawned" | "no-result-selected" | "budget-exhausted" | "aborted";
} | {
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "no-winner";
  tree: TreeView;
  downCount: number;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  error?: never;
  reason: "cancelled";
  source: string;
  cancellationReason: string;
  operationId?: string;
} | {
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "no-winner";
  reason: "driver-failed";
  tree: TreeView;
  downCount: number;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  error: NoWinnerError;
} | {
  continuation?: DriverContinuationRecord;
  rootHarnessTranscript?: HarnessTranscriptEvidence;
  rootStream?: RootStreamReceipt;
  rootProviderModel: ProviderModelExecutionEvidence;
  kind: "winner";
  out: unknown;
  outRef: string;
  verdict?: import("@tangle-network/agent-eval").DefaultVerdict;
  tree: TreeView;
  spentTotal: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  spendGaps?: ReadonlyArray<SpendGap>;
  fleetYield: FleetYield;
  spentBreakdown?: {
    driverInference: Spend;
    childWork: Spend;
  };
}>;
//#endregion
//#region src/durable/run-fork.d.ts
/**
 * Start a run as a version of a settled run: the parent's recorded root inputs plus one change.
 *
 * The call's `profile`, `task` and `budget` must be the parent's, byte for byte, as its sealed
 * journal records them. Runtime applies `change` to that profile and runs the result in a new
 * run directory. The parent directory is read and never written.
 */
interface PursuitFork {
  /** The settled parent's run directory. */
  readonly runDir: string;
  /** The sha256 of the parent's `result.json` bytes: the sealed point the fork starts from. */
  readonly settleDigest: Sha256Digest;
  /** The one change, applied to the parent's root profile. Its `id` is recorded. */
  readonly change: AgentProfileDiff;
  /**
   * Fork a parent whose journal holds a node without a terminal record, an unbegun owned tree, an
   * unconfirmed teardown, or work in flight. Such a node may still act, and a fork never replays
   * the parent's children, so it can only duplicate work outside the fork's tree. The root then
   * records those node ids as `forkParentUncertainNodes`. Omit it to refuse such a parent.
   */
  readonly acceptUncertain?: boolean;
}
/**
 * The `execution.correlation` keys a fork records on its root. Runtime writes them; a caller that
 * supplies one is refused. `lineageRootRunId` is the first run of the chain of parents, so the
 * spend of every version of one lineage groups under one id.
 */
declare const RUN_FORK_CORRELATION_KEYS: readonly ["forkParentRunId", "forkParentSettleDigest", "forkProfileDiffId", "lineageRootRunId"];
/** The correlation key an accepted uncertain parent adds: its uncertain node ids, comma-joined. */
declare const FORK_PARENT_UNCERTAIN_NODES_KEY = "forkParentUncertainNodes";
//#endregion
//#region src/durable/observer-journal.d.ts
type ObserverRecordKind = 'event' | 'decision';
/**
 * One immutable record in the observer plane. `sequence` is journal order, not
 * execution order; causal/runtime order remains available on the underlying event.
 * `previousDigest` + `digest` make deletion, reordering, or mutation detectable.
 */
interface ObserverRecord {
  readonly schemaVersion: 1;
  readonly pursuitId: string;
  readonly sequence: number;
  readonly kind: ObserverRecordKind;
  readonly observedAt: number;
  readonly previousDigest?: string;
  readonly event?: RuntimeHookEvent;
  readonly decision?: RuntimeDecisionPoint;
  readonly digest: string;
}
interface ObserverJournal {
  appendEvent(event: RuntimeHookEvent): Promise<ObserverRecord>;
  appendDecision(point: RuntimeDecisionPoint): Promise<ObserverRecord>;
  read(): Promise<readonly ObserverRecord[]>;
  hooks(): RuntimeHooks;
}
/**
 * Durable, append-only third-person history for one concrete Runtime execution.
 * It consumes Runtime's existing hook stream and does not participate in execution
 * decisions. A broken observer therefore cannot change what an agent is allowed to do.
 *
 * The write discipline deliberately matches `FileSpawnJournal`: serialized appends,
 * torn-tail recovery, short-write handling, and fsync before acknowledgement. One
 * execution owns one journal file; higher-level pursuit aggregation joins isolated
 * journals by `pursuitId` instead of making independent processes share a write head.
 */
declare class FileObserverJournal implements ObserverJournal {
  readonly path: string;
  readonly pursuitId: string;
  private tail;
  private initialized;
  private sequence;
  private previousDigest;
  private appendFailure;
  constructor(path: string, pursuitId: string);
  hooks(): RuntimeHooks;
  appendEvent(event: RuntimeHookEvent): Promise<ObserverRecord>;
  appendDecision(point: RuntimeDecisionPoint): Promise<ObserverRecord>;
  read(): Promise<readonly ObserverRecord[]>;
  private enqueue;
  private initialize;
  private readExistingUnsafe;
  private writeRecord;
  private assertComplete;
}
/** Verify identity, monotonic sequence, payload shape, and the complete digest chain. */
declare function verifyObserverRecords(records: readonly ObserverRecord[], pursuitId?: string): readonly ObserverRecord[];
/** Compute the canonical SHA-256 digest for an unsigned observer record. */
declare function observerRecordDigest(record: Omit<ObserverRecord, 'digest'>): string;
/** Build the canonical durable observer hook in one call. */
declare function createFileObserverHooks(path: string, pursuitId: string): {
  readonly journal: FileObserverJournal;
  readonly hooks: RuntimeHooks;
};
//#endregion
//#region src/durable/observer-projection.d.ts
/**
 * One settled projection status, shared by runs and nodes. `down` is the journal's own word for a
 * failure (a settlement is journaled as `kind: 'down'`, cancellation included), so a consumer can
 * join run rows to node rows on `status` and read one failure population instead of two.
 */
type PursuitStatus = 'running' | 'done' | 'down';
/**
 * Where a node's dollar figure came from. `reported` = a provider billed all of it; `estimated` =
 * a model catalog priced all of it; `partial` = a provider billed part and a catalog priced the
 * rest; `unknown` = nothing priced it, so `usd` is a floor and never the cost.
 */
type PursuitCostProvenance = 'reported' | 'estimated' | 'partial' | 'unknown';
/**
 * One node's token usage by class. Cache and reasoning classes are absent when the provider did
 * not report them — absence is not zero. `tokensKnown` is `false` when work happened whose token
 * count no provider reported, which makes `input`/`output` a floor.
 */
interface PursuitNodeUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly reasoning?: number;
  readonly tokensKnown: boolean;
}
/**
 * One node's PLATFORM consumption — box wall time, the resource a subscription seat really pays.
 *
 * Kept apart from `PursuitNodeCost` because the two answer different questions and fail
 * independently: a seat run reports a truthful `$0` and real minutes, a caller-account run
 * reports real dollars and may report no minutes at all. Collapsing them into one "spend known"
 * figure hides which one is missing.
 *
 * Absent on a node that ran no box. `boxMinutes` absent WITH the block present says a box ran and
 * nothing measured it — a missing measurement is never a zero.
 */
interface PursuitNodePlatform {
  readonly boxMinutes?: number;
  /** `false` when a box ran whose time could not be closed, so `boxMinutes` is a floor. */
  readonly boxMinutesKnown: boolean;
  /** `observed` = the platform billed the minutes; `estimated` = Runtime derived them from the box
   *  lifetime it watched; `uncaptured` = a box ran and nothing measured it. */
  readonly provenance: 'observed' | 'estimated' | 'uncaptured';
}
/** One node's dollar cost with the provenance that decides whether it may be compared or summed. */
interface PursuitNodeCost {
  readonly usd: number;
  readonly usdKnown: boolean;
  /** The part of `usd` a model catalog priced because no provider receipt covered it. */
  readonly usdEstimated?: number;
  readonly provenance: PursuitCostProvenance;
}
/**
 * One node's clock. `wallMs` is `settledAt - startedAt` and is deliberately distinct from the
 * executor-reported `spent.ms` sums, which under-report and overlap across parallel children.
 * `firstTokenAt` stays absent unless a provider reports that instant; it is never inferred from
 * `firstOutputAt`, which is when the node first reported usage for a turn.
 */
interface PursuitNodeTiming {
  readonly startedAt: number;
  readonly firstOutputAt?: number;
  readonly firstTokenAt?: number;
  readonly settledAt?: number;
  readonly wallMs?: number;
}
/** Where and how a node's execution was placed, read off its execution-binding receipt. */
type PursuitNodePlacement = Readonly<Record<string, string | number | boolean | null>>;
/**
 * One run's spend counted once, and each node's own share of it. `inclusive` and the entries of
 * `exclusiveByNode` are the two views a client needs to show a tree without double counting.
 */
interface PursuitRunTotals {
  /**
   * The whole run counted once. A node's settled `spent` already contains the child work its own
   * nested tree reported, so summing only the run's top-level nodes plus every node's own
   * inference counts each model call exactly once.
   */
  readonly inclusive: Spend;
  /**
   * Each node's own share: its reported spend and own inference minus what its direct children
   * reported. Keyed by node id, plus the run root when the root itself metered inference. The
   * entries sum to `inclusive` by construction.
   */
  readonly exclusiveByNode: Readonly<Record<string, Spend>>;
}
/**
 * One attempt at one concrete Runtime run: the stretch of `agent.run` lifecycle from a `before`
 * to the `after` or `error` that settles it. A run whose first attempt threw and whose corrected
 * attempt settled is two rows, so `error` names only the attempt that failed.
 *
 * A `before` observed while an attempt is still open does not open another: it is a process
 * that resumed the run after the previous process died without a terminal record, and the row
 * counts it in `resumeCount`. The alternative, a row per process start, would leave the killed
 * process's row `running` for the rest of history.
 */
interface PursuitRunProjection {
  readonly runId: string;
  /** Zero-based position of this attempt among the run's attempts, in journal order. */
  readonly attemptIndex: number;
  /** How many times a process resumed this attempt after a predecessor died mid-run. */
  readonly resumeCount: number;
  readonly status: PursuitStatus;
  readonly settledAt?: number;
  readonly error?: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly eventCount: number;
  readonly decisionCount: number;
  readonly targets: Readonly<Record<string, number>>;
  readonly decisions: Readonly<Record<string, number>>;
  readonly totals: PursuitRunTotals;
  /** The nodes whose accounting is incomplete. Present exactly when non-empty. */
  readonly spendGaps?: ReadonlyArray<SpendGap>;
}
interface PursuitNodeProjection {
  readonly id: string;
  readonly parentId?: string;
  /** Node ids are scoped to this concrete Runtime tree; `(runId,id)` is identity. */
  readonly runId: string;
  readonly label?: string;
  /** The runner that executed this node — the executor's own name, not a harness guess. */
  readonly runtime?: string;
  readonly depth?: number;
  readonly assignmentId?: string;
  /** The settled sibling this node replaced, as its manager's spawn named it. Absent on a node
   *  that replaced nothing. */
  readonly successorOf?: string;
  readonly identity?: unknown;
  readonly budget?: unknown;
  readonly status: PursuitStatus;
  readonly settledAt?: number;
  /** The child work this node reported at settlement. Absent until a terminal record lands. */
  readonly spent?: Spend;
  /** This node's OWN inference, re-homed from its nested tree. Absent when it drove no turns. */
  readonly ownInference?: Spend;
  /** Absent until a spend record lands; the run's `spendGaps` then names the node. */
  readonly usage?: PursuitNodeUsage;
  /** Absent until a spend record lands; the run's `spendGaps` then names the node. */
  readonly cost?: PursuitNodeCost;
  /** What the node consumed on the PLATFORM. Absent on a node that ran no box. */
  readonly platform?: PursuitNodePlatform;
  readonly timing?: PursuitNodeTiming;
  /** The kernel-minted attempt this node's execution binding is keyed on. */
  readonly attemptId?: string;
  /** The runner-native execution the node bound to: a request, session, run, process, or tree. */
  readonly execution?: {
    readonly kind: string;
    readonly id: string;
  };
  /** The model the materialization receipt names, when the runner reported one. */
  readonly model?: string;
  /** The concrete backend the profile materialized onto. */
  readonly backend?: string;
  readonly placement?: PursuitNodePlacement;
  /** Model-call identifiers this node's own turns reported, in order, deduplicated. */
  readonly modelCalls?: ReadonlyArray<string>;
  readonly materialization?: ProfileMaterializationReceipt;
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>;
  /** What the provider itself reported serving, and why it is unknown when it is. */
  readonly providerModel?: ProviderModelExecutionEvidence;
  /** Content-addressed pointer to this node's persisted tool trace, or why there is none. */
  readonly trace?: WorkerTraceEvidence;
  readonly outRef?: string;
  readonly score?: number;
  readonly valid?: boolean;
  readonly reason?: string;
  readonly infra?: boolean;
  /** Recorded by Runtime on the `agent.child` payload: `'pending'` at a retained child's
   *  settlement, `'released'` when root settlement destroyed its environment without recovery,
   *  `'release-unconfirmed'` when a final settlement closed its slot without confirming that.
   *  The status stays `down` — the split is a sibling fact, not a fourth status. A second
   *  `agent.child` for one node is already how a live-recovered child flips down→done, so the
   *  fold overwrites in observed order; that event's `settledAt` is the original settlement, so
   *  `settledAt` and `timing` do not move. */
  readonly retainedExecution?: RetainedExecutionState;
  /** Why a retained child has no accepted result; see `RetainedPendingCause`. */
  readonly retainedPendingCause?: RetainedPendingCause;
  /** When a final settlement closed a retained node's slot; absent while it is `'pending'`. */
  readonly releasedAt?: number;
  /** Each channel on which the settled spend exceeded the node's reservation. The status is the
   *  node's own outcome: a `done` node that overspent still delivered its output. */
  readonly budgetViolation?: BudgetViolation;
  readonly wait?: unknown;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly eventCount: number;
  readonly turnCount: number;
}
interface PursuitProjection {
  readonly pursuitId: string;
  /** Number of records in this concrete execution journal. */
  readonly sequence: number;
  /** Digest-chain tip for this concrete execution journal. */
  readonly chainTip: string;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly runs: readonly PursuitRunProjection[];
  readonly nodes: readonly PursuitNodeProjection[];
  readonly eventCount: number;
  readonly decisionCount: number;
}
/**
 * Fold one append-only execution journal into a deterministic operator projection.
 *
 * This is intentionally a READ model, not another state machine: it does not own
 * execution, cannot steer agents, and can be rebuilt from the journal at any time.
 * Projection verifies the complete hash chain first, so an operator view can never
 * silently render a mutated or reordered observer history as trustworthy state.
 *
 * Topology comes only from Runtime's canonical `agent.spawn` facts. Terminal node
 * state comes only from `agent.child`; concrete run state comes only from the root
 * `agent.run` lifecycle emitted by `supervisePursuit`, one row per attempt. Node identity is
 * scoped to the concrete Runtime run so independent trees may both contain `root:s0` without
 * aliasing, and a node belongs to the attempt that spawned it.
 *
 * Usage, cost and timing are reported at the class the runtime measured them at. A missing
 * class stays ABSENT and the run names the node in `spendGaps`; nothing here converts an
 * unmeasured channel into a zero, because a fabricated zero is indistinguishable from free work.
 */
declare function projectPursuit(records: readonly ObserverRecord[]): PursuitProjection;
//#endregion
//#region src/durable/supervise-pursuit.d.ts
interface SupervisePursuitOptions extends SuperviseOptions {
  /** Stable objective identity spanning concrete Runtime runs. */
  readonly pursuitId: string;
  /**
   * One concrete Runtime execution owns one durable directory and observer journal.
   * A pursuit spanning several runs reuses `pursuitId` across distinct `runDir`s;
   * Intelligence joins those isolated projections without a shared write head.
   */
  readonly runDir: string;
  /**
   * Always `'release'`. The settle record refuses re-entry, so no later call resumes a settled
   * pursuit and nothing else would release the provider environments its retained children hold.
   * `'keep'` is refused rather than ignored.
   */
  readonly retainedAtSettlement?: 'release';
  /**
   * Run this pursuit as a version of a settled run: `profile`, `task` and `budget` must equal the
   * parent's recorded root, and Runtime executes the parent's profile with `fork.change` applied.
   * The root's `execution.correlation` records the parent, its sealed digest, the change and the
   * lineage (`RUN_FORK_CORRELATION_KEYS`). The fork's `runDir` must lie outside the parent's, and
   * the parent's outside it. The parent's directory is never written, and a refused fork, such as
   * one whose parent has an uncertain node, writes nothing.
   */
  readonly fork?: PursuitFork;
  /**
   * Continue this pursuit across versions. The first version runs at `runDir` as usual, or is
   * read back when that directory already settled. After each version settles, `versions.judge`
   * scores it from outside its tree; unless `versions.stop` ends the chain, the next version forks
   * from the best version so far with the change `versions.next` returns, at `<runDir>.v<n>` with
   * run id `<runId>.v<n>`. `<runDir>.versions/versions.jsonl` records every version, its parent,
   * its change, its verdict and its dollars, and the stop. A call on a chain that stopped reads
   * that record back; a call on a chain that did not resumes it without re-running or re-judging a
   * settled version. The call returns the best version's result with the chain's record.
   */
  readonly versions?: PursuitVersions;
}
interface SupervisedPursuitResult<Result> {
  readonly result: Result;
  readonly pursuit: PursuitProjection;
  readonly observerPath: string;
  /** `runDir/result.json`: `result` as canonical JSON, written once at settle. */
  readonly settlePath: string;
  /** The version chain's record, when the call set `versions`. */
  readonly versions?: PursuitVersionsRecord;
}
/** A failed Runtime execution whose complete third-person projection was retained. */
declare class SupervisePursuitError extends Error {
  readonly pursuit: PursuitProjection;
  readonly observerPath: string;
  /** `runDir/failure.json`: the record of this throw. */
  readonly failurePath: string;
  constructor(cause: unknown, pursuit: PursuitProjection, observerPath: string, failurePath: string);
}
/**
 * One-call durable pursuit execution over the canonical `supervise()` kernel.
 *
 * This is an adapter, not a second executor: it composes a durable third-person
 * observer into Runtime's existing recursive hook stream and then rebuilds the
 * operator projection after the same `supervise()` call settles. Agents never
 * receive the observer path or projection and their behavior does not depend on it.
 *
 * Every concrete execution writes only inside its own `runDir`. Cross-run pursuit
 * aggregation is therefore lock-free at the observer layer: reuse `pursuitId` across
 * run directories and let Intelligence join the independently verified projections.
 *
 * The directory's terminal state is recorded beside `observer.jsonl`: `result.json` holds the
 * returned result once the run settles and `failure.json` the most recent throw. A directory
 * whose `result.json` exists refuses re-entry before any compute; a failure record alone does
 * not, because a caller can correct its input and drive the same run again. For the life of the
 * call the directory is held by `supervise.lock`, so a second process on the same directory
 * refuses and names the holder instead of sharing one journal.
 * An abandoned `supervise.lock.guard` requires removal after confirming no lock mutation is active.
 */
declare function supervisePursuit(profile: SupervisorProfile, task: unknown, opts: SupervisePursuitOptions): Promise<SupervisedPursuitResult<Awaited<ReturnType<typeof supervise>>>>;
//#endregion
//#region src/durable/pursuit-versions.d.ts
/**
 * Continue a pursuit across versions: after each version settles, an outside judge scores it, and
 * the next version forks from the best version so far with one change, until the stop rule ends
 * the chain. Each version is one `supervisePursuit` run in its own directory; the fork records its
 * parent, the parent's seal, the change and the lineage root on the version's root.
 */
interface PursuitVersions {
  /** Scores each settled version from outside its tree: the run's declared check
   *  (`declaredCheckJudge`), or any judge with a digest. */
  readonly judge: VersionJudge;
  /** The change the next version applies to the best version's profile. `'review-of-best'` mounts
   *  the best version's verdict under `inputs/review/`, replaces any earlier review, and gives the
   *  next version's continuation note the best version's per-item verdict as its bar. */
  readonly next: NextPursuitVersion | 'review-of-best';
  /** When the chain stops. Every cap is required: a chain without one is refused. */
  readonly stop: PursuitVersionStop;
  /**
   * Where a later version executes. Omit it to run each version in this process through
   * `supervisePursuit({ fork })`, the same placement as the first. A caller that places versions
   * elsewhere executes exactly `version.profile` on `version.task` under `version.budget`, with
   * `version.execution` as the root's attribution, and returns once `version.runDir` holds the
   * version's settle record and observer journal. It is called again for the same version after
   * a restart, so it must attach to a version it already started rather than start a second one.
   */
  readonly run?: RunPursuitVersion;
  /**
   * A version's dollars as the caller measured them, such as the provider's charge to the keys the
   * version used. Omit it to use the version's settled `spentTotal.usd`, which is an estimate
   * when `usdKnown` is false. `null` means unknown, and stops the chain.
   */
  readonly usd?: (version: SettledPursuitVersion, signal: AbortSignal) => Promise<number | null>;
}
/** The chain's stop rule. The chain never starts a version once any cap is reached. */
interface PursuitVersionStop {
  /** Stop after this many consecutive versions that did not improve on the best score. */
  readonly patience: number;
  /** At most this many versions, the first included. */
  readonly maxVersions: number;
  /**
   * The chain's total dollars, the first version included, summed from each version's settled
   * `spentTotal.usd`. The chain checks it between versions; a version's own budget, or the
   * caller's spend watcher, bounds that version in flight. A version whose dollars are not a
   * number stops the chain, since the chain can no longer prove it is under the cap.
   */
  readonly maxUsd: number;
  /** The chain's wall clock, from its first version's start. A running version is aborted at it. */
  readonly deadlineMs: number;
  /** A version improves when its score exceeds the best by more than this. Default 0. */
  readonly minImprovement?: number;
}
/** An outside judge. Runtime calls it after a version's settle record exists, never inside the
 *  version's tree, and gives it no handle into that tree. Place it where you like, such as its own
 *  sandbox through `runIsolatedCheck({ box })`. */
interface VersionJudge {
  /** The sha256 of the judge's code and configuration. Every verdict must carry it, and a chain
   *  whose ledger was judged under another digest is refused. */
  readonly digest: Sha256Digest;
  judge(version: SettledPursuitVersion, signal: AbortSignal): Promise<VersionVerdict>;
}
interface VersionVerdict {
  /** Higher is better. `null` when the judge could not score the version, which never counts as
   *  an improvement. */
  readonly score: number | null;
  /** Must equal `VersionJudge.digest`. */
  readonly judgeDigest: Sha256Digest;
  /** What the judge measured, retained verbatim in the ledger. JSON values only. */
  readonly detail?: unknown;
  /** The check's per-item verdict, when the judge is a check: what `'review-of-best'` mounts and
   *  what the next version's bar compares against. */
  readonly check?: CheckVerdict;
}
/** A settled version, as the judge and `next` read it. */
interface SettledPursuitVersion {
  /** 1 for the first version. */
  readonly version: number;
  readonly runId: string;
  readonly runDir: string;
  /** The sha256 of the version's `result.json` bytes. */
  readonly settleDigest: Sha256Digest;
  readonly result: SupervisedResult<unknown>;
  /** The profile the version executed: the first version's, or its parent's plus its change. */
  readonly profile: AgentProfile;
  readonly parent?: PursuitVersionParent;
  readonly change?: AgentProfileDiff;
}
interface PursuitVersionParent {
  readonly version: number;
  readonly runId: string;
  readonly settleDigest: Sha256Digest;
}
interface JudgedPursuitVersion extends SettledPursuitVersion {
  readonly verdict: VersionVerdict;
  /** Whether its score beat every earlier version's by more than `minImprovement`. */
  readonly improved: boolean;
  /** The version's dollars: `versions.usd`'s measurement, or its settled `spentTotal.usd`;
   *  `null` when that is not a number. */
  readonly usd: number | null;
  /** False when the figure is Runtime's estimate or unknown. */
  readonly usdKnown: boolean;
  /** Who measured `usd`: the caller's `versions.usd`, or Runtime's settled `spentTotal`. */
  readonly usdSource: 'caller' | 'runtime';
  /** Where the version came from: its parent run and its change. Absent for a first version that
   *  is not a fork. */
  readonly lineage?: AgentCandidateLineage;
}
interface NextPursuitVersionInput {
  /** The version the next one forks from: the highest score, the earliest on a tie. */
  readonly best: JudgedPursuitVersion;
  readonly last: JudgedPursuitVersion;
  readonly versions: readonly JudgedPursuitVersion[];
}
/** Build the one change the next version applies to `best.profile`. Its `id` must be non-empty. */
type NextPursuitVersion = (input: NextPursuitVersionInput, signal: AbortSignal) => AgentProfileDiff | Promise<AgentProfileDiff>;
/** One version, ready to execute. */
interface PreparedPursuitVersion {
  readonly version: number;
  readonly runId: string;
  readonly runDir: string;
  readonly pursuitId: string;
  /** The profile to execute, the change already applied. */
  readonly profile: AgentProfile;
  readonly task: unknown;
  readonly budget: Budget;
  /** The root's attribution, with the fork's parent, seal, change and lineage root. */
  readonly execution: AgentExecutionRef;
  /** The fork Runtime verified, for a placement that runs `supervisePursuit({ fork })` itself
   *  with the parent's profile, `parentProfile`. */
  readonly fork: PursuitFork;
  readonly parentProfile: AgentProfile;
}
type RunPursuitVersion = (version: PreparedPursuitVersion, signal: AbortSignal) => Promise<void>;
type PursuitVersionStopReason = 'no-improvement' | 'max-versions' | 'max-usd' | 'spend-unknown' | 'deadline' | 'aborted';
/** The chain's record, returned beside the best version's result and kept in `versions.jsonl`. */
interface PursuitVersionsRecord {
  /** `<runDir>.versions`, beside the first version's directory. */
  readonly lineageDir: string;
  readonly judgeDigest: Sha256Digest;
  readonly stop: PursuitVersionStop;
  /** ISO instant the first version started. */
  readonly startedAt: string;
  readonly versions: readonly JudgedPursuitVersion[];
  /** The best version's number. */
  readonly best: number;
  /** Sum of the versions' `usd`; a floor when any version's dollars are unknown. */
  readonly spentUsd: number;
  readonly stopped: {
    readonly reason: PursuitVersionStopReason;
    readonly at: string;
  };
}
/** The ledger file inside the lineage directory. */
declare const PURSUIT_VERSIONS_FILE = "versions.jsonl";
/** The `<runDir>.v<n>` directory and `<runId>.v<n>` id of version `n`, beside the first. */
declare function pursuitVersionRun(runDir: string, runId: string, version: number): {
  runDir: string;
  runId: string;
};
/**
 * Validate a `versions` option before any compute. The same check runs inside `supervisePursuit`;
 * a caller that records the option as data can run it at preflight.
 */
declare function assertPursuitVersions(versions: unknown): asserts versions is PursuitVersions;
/** Where `'review-of-best'` mounts a review: `inputs/review/version-<n>.md`. One review lives in
 *  a profile at a time. */
declare const REVIEW_DIR = "inputs/review/";
//#endregion
//#region src/runtime/isolated-checker.d.ts
interface IsolatedCheckOptions {
  /** Trusted workspace boundary containing the untrusted tree. */
  workspaceRoot: string;
  tree: string;
  /** Executable and arguments, without host shell interpretation. */
  command: readonly [string, ...string[]];
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** Run the check in its own Sandbox box instead of Linux Bubblewrap on this host. */
  box?: IsolatedCheckBox;
  /** Environment the command receives beside PATH, HOME and LANG: a declared check's named
   *  secrets and its own settings. Nothing else of this process's environment reaches it. */
  env?: Readonly<Record<string, string>>;
}
/**
 * A fresh Sandbox box for one check, owned by an account the judged run holds no key to.
 *
 * Any key of a Sandbox account can read, write, and execute in every box of that account.
 * A check box on the run's own account is therefore reachable by the run it judges.
 * The check refuses before it creates a box when its account is one of `builderAccounts`.
 */
interface IsolatedCheckBox {
  /**
   * Client authenticated with the check's own key: a `Sandbox` from SDK 0.46 or later.
   * Written as its two methods because the Runtime peer range admits SDKs without `createIsolated`.
   */
  client: {
    getIdentity(): Promise<{
      customerId: string;
    }>;
    createIsolated(options: Omit<CreateSandboxOptions, 'ownerContext'>, requestOptions?: {
      signal?: AbortSignal;
    }): Promise<SandboxInstance>;
  };
  /** `customerId` from `Sandbox.getIdentity()` for every Sandbox key the judged run holds. */
  builderAccounts: readonly [string, ...string[]];
  /** Sandbox environment or image that holds the check's toolchain. */
  environment: string;
  resources?: SandboxResources;
  /** Domains the check may reach, such as a knowledge store or a git host. Empty or absent: the
   *  box's egress is blocked. Otherwise strict: these domains only, with no implicit list. */
  egress?: readonly string[];
  /**
   * The check runs containers. Sandbox starts a box's rootless container daemon only with its
   * managed agent runtime, so this box is created with `agent: true`; it still receives no owner
   * secret, which its create receipt must confirm. It is not `ephemeral`, so its home is a disk
   * sized by `resources.diskGB` instead of a small in-memory home that image layers overflow.
   */
  containers?: boolean;
}
/** The box a check ran in and the exact bytes it received. */
interface IsolatedCheckBoxEvidence {
  sandboxId: string;
  /** `customerId` of the check's key. */
  account: string;
  /** Every file the box received; each sha256 is also the digest the box computed on receipt. */
  input: AgentCandidateWorkspaceManifestMaterial;
  /** Canonical digest of `input`. */
  inputDigest: Sha256Digest;
}
type IsolatedCheckResult = {
  succeeded: true;
  value: {
    stdout: string;
    stderr: string;
  };
  box?: IsolatedCheckBoxEvidence;
} | {
  succeeded: false;
  reason: 'refused' | 'failed' | 'timeout' | 'cancelled' | 'output-limit' | 'cleanup-failed';
  diagnostic: string;
  /** Bounded command evidence, when a process was launched. */
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  /** Cleanup failures never replace the primary command failure. */
  cleanupDiagnostic?: string;
  /** Present once a check box received its complete input. */
  box?: IsolatedCheckBoxEvidence;
};
/**
 * Run an untrusted check in Linux Bubblewrap, or in its own Sandbox box when `box` is set.
 * Never falls back to host execution.
 *
 * Bubblewrap requires /usr/bin/bwrap and permission to create Linux namespaces.
 * Only trusted system toolchains, private proc/dev/tmp, and the writable copy are mounted.
 * The canonical input path remains the working directory; copy writes are discarded.
 * Limits bound command time and captured output, not copy size or memory consumption.
 * Callers must keep the input and trusted toolchains stable while preparing the check.
 *
 * A box check creates one fresh box with no owner secrets and blocked egress (or strict egress to
 * the placement's named domains), delivers the tree's regular files verified by sha256, runs the
 * command there with only the environment `env` names, and deletes the box.
 */
declare function runIsolatedCheck(options: IsolatedCheckOptions): Promise<IsolatedCheckResult>;
//#endregion
//#region src/runtime/declared-check.d.ts
/** A check program as a record declares it. */
interface DeclaredCheck {
  /** The evaluator program's files. A directory whose canonical digest differs is refused. */
  readonly program: {
    readonly dir: string;
    readonly digest: Sha256Digest;
  };
  /** Executable and arguments, run in the program's directory. */
  readonly command: readonly [string, ...string[]];
  /** The box environment or image that holds the program's toolchain. */
  readonly environment: string;
  /** Domains the program may reach. Absent or empty: egress is blocked. */
  readonly egress?: readonly string[];
  /** Names of this process's environment variables the program receives. A missing one refuses. */
  readonly secrets?: readonly string[];
  /** The pass threshold on the score's `composite`. */
  readonly pass: number;
  /** `pass-only` keeps the FAIL lines from the director, for a check whose tests stay hidden. */
  readonly feedback: 'verbatim' | 'pass-only';
  /** Cases the director never sees. They score a run and a version, never an in-run read. */
  readonly sealed?: {
    readonly dir: string;
    readonly digest: Sha256Digest;
  };
  /** What the run owes, for the director's tools and the note. */
  readonly describe?: string;
  /** Bound on one read. Default 15 minutes. */
  readonly timeoutMs?: number;
  /** The check box's size. With `containers`, `diskGB` sizes the disk that holds the images. */
  readonly resources?: SandboxResources;
  /**
   * The program runs containers, as a benchmark's own verifier does. The check box then runs a
   * rootless container daemon, whose socket is `/run/user/<uid>/docker.sock` once it starts, and its
   * home is on a disk rather than in memory. Absent: neither, and the box starts faster.
   */
  readonly containers?: boolean;
}
/** Where a declared check's boxes are created: a client on the check account, and every account
 *  the judged run holds a key to, so the check refuses a box the run could reach. */
interface DeclaredCheckPlacement {
  readonly client: IsolatedCheckBox['client'];
  readonly builderAccounts: IsolatedCheckBox['builderAccounts'];
  /** The environment the secrets are read from. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}
/**
 * Write the run's state into `into`, an empty directory Runtime created and removes after the read.
 * The host decides what the state is and reads it from the run's live environment, for example
 * the declared output files of a task's container. A capture that throws gives no verdict: the read
 * is {@link CheckUnavailableError}, never a failure blamed on the run.
 */
type DeclaredCheckStateCapture = (into: string) => Promise<void>;
/** Refuse a malformed declaration before any compute. */
declare function assertDeclaredCheck(check: DeclaredCheck, context: string): void;
/** The canonical digest of a directory's files: the digest a record names a program by. */
declare function checkProgramDigest(dir: string): Promise<Sha256Digest>;
/** The digest a version judge records: the program, the sealed cases, and how they are run. */
declare function declaredCheckDigest(check: DeclaredCheck): Sha256Digest;
/**
 * Read the check once. `result` is the submitted result, absent for a read of the run's state.
 * `state` is a local directory of the run's state; the box receives a copy of its files at
 * `_input/state/`. `set: 'sealed'` adds the sealed cases. Throws {@link CheckUnavailableError} when
 * the program could not run or printed no score.
 */
declare function readDeclaredCheck(check: DeclaredCheck, placement: DeclaredCheckPlacement, read: {
  readonly result?: unknown;
  readonly state?: string;
  readonly set: 'development' | 'sealed';
  readonly signal?: AbortSignal;
}): Promise<CheckVerdict>;
/**
 * The declared check as a manager's completion check: every in-run read uses development cases.
 * With `state`, each read first captures the run's state and the check reads it beside the
 * submitted result, on `submit_result` and at a turn end alike.
 */
declare function declaredCheckDeliverable(check: DeclaredCheck, placement: DeclaredCheckPlacement, options?: {
  readonly state?: DeclaredCheckStateCapture;
}): DeliverableSpec<unknown>;
/**
 * The declared check as a version chain's judge: it scores a settled version on its sealed cases
 * when the record has them, and on its development cases otherwise. The per-item verdict rides in
 * the ledger, so the next version's review names each item. A read that could not run scores
 * `null`, which never counts as an improvement.
 */
declare function declaredCheckJudge(check: DeclaredCheck, placement: DeclaredCheckPlacement): VersionJudge;
//#endregion
//#region src/runtime/define-leaderboard.d.ts
/** Structured per-case verdict a `score` function may return (a bare number is
 *  shorthand for `{ composite }`). `composite` is the [0,1] leaderboard score;
 *  `dimensions` are recorded as extra judge dimensions. */
interface LeaderboardScore {
  composite: number;
  dimensions?: Record<string, number>;
  notes?: string;
}
/** The campaign scenario a case is wrapped into: the case rides along so
 *  judges and hooks can reach the full domain payload, not just its id. */
interface LeaderboardScenario<TCase> extends Scenario {
  case: TCase;
}
/** One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>`
 *  and surfaced to every hook via `ctx.args`. */
interface LeaderboardFlagSpec {
  default?: string;
  description: string;
}
/** Resolved run configuration handed to `setup` / `teardown` / `export`. */
interface LeaderboardRunContext {
  name: string;
  /** Execution backend name (`--backend`), a key of `backends`. */
  backend: string;
  runDir: string;
  exportDir: string;
  /** Every parsed flag (standard + `spec.flags`), by name without `--`. */
  args: Record<string, string | undefined>;
  harnesses: readonly HarnessType$1[];
  /** Snapshot-stamped model ids (`name@snapshot`) — the eval identity models. */
  models: readonly string[];
  caseIds: readonly string[];
  shots: number;
  reps: number;
}
/** Structurally `BenchTask` (bench registry shape) — declared locally so this
 *  module adds no dependency on a benchmark package. */
interface LeaderboardBenchTask {
  id: string;
  prompt: string;
  split?: string;
  metadata?: Record<string, unknown>;
}
/** Structurally `BenchScore` (bench registry shape). */
interface LeaderboardBenchScore {
  resolved: boolean;
  score: number;
  detail?: string;
}
/** Structurally `BenchmarkAdapter` (bench registry shape): `name`,
 *  `preflight()`, `loadTasks()`, deterministic `judge()`, `goldArtifact()`.
 *  Generic over the artifact channel; the `string` default IS the registry
 *  shape, so a default-artifact adapter registers unchanged. */
interface LeaderboardBenchmarkAdapter<TArtifact = string> {
  readonly name: string;
  preflight(): Promise<void>;
  loadTasks(opts?: {
    limit?: number;
    split?: string;
    ids?: string[];
  }): Promise<LeaderboardBenchTask[]>;
  judge(task: LeaderboardBenchTask, artifact: TArtifact): Promise<LeaderboardBenchScore>;
  goldArtifact(task: LeaderboardBenchTask): Promise<string | undefined>;
}
/** Per-shot outcome context passed as `onCellEvents`'s third argument — how a
 *  thrown shot (which never reaches `parseOutput`) stays visible through the
 *  facade instead of surfacing only as an empty zero-token cell. */
interface LeaderboardIterationInfo {
  /** 0-based shot index within the cell. */
  index: number;
  /** The shot's thrown error message, when the shot failed before scoring. */
  error?: string;
  /** The shot's validator verdict, when the shot reached scoring. */
  verdict?: {
    score?: number;
  };
}
/**
 * The declarative leaderboard spec. `TArtifact` is the artifact channel the
 * dispatch produces and the judges score — `string` (the default) is the plain
 * agent-response-text path; a structured artifact type flows natively once the
 * spec supplies `parseOutput` (or a LEVEL-2 `dispatch`) producing it.
 */
interface LeaderboardSpec<TCase, TArtifact = string> {
  /** Leaderboard name — the scenario `kind`, default profile name, and report title. */
  name: string;
  /** The case corpus. Every case needs a stable string id (see `caseId`). */
  cases: TCase[];
  /** Stable id extractor. Default: the case's own `id` property (fail-loud
   *  when absent or not a string). */
  caseId?: (c: TCase) => string;
  /** The per-case task prompt. May be async (e.g. built by shelling out to a
   *  reference implementation); resolved ONCE per case before dispatch. */
  prompt: (c: TCase) => string | Promise<string>;
  /** The domain grader: agent output artifact → score. Used BOTH as the
   *  per-shot validator (a shot with `composite > 0` stops the naive retry
   *  loop) and, wrapped as a campaign judge, as the recorded leaderboard score. */
  score: (output: TArtifact, c: TCase) => number | LeaderboardScore;
  /** Harness × model axes for `expandProfileAxes`. Defaults: the canonical
   *  `CODING_HARNESSES` × the base profile's `model.default`. `--harnesses` /
   *  `--models` override per run. */
  axis?: {
    harnesses?: readonly HarnessType$1[];
    models?: readonly string[];
  };
  /** Exact base profile the axes expand over (prompt/tools/skills held fixed).
   *  Its provider remains authoritative while each axis cell replaces the
   *  harness and concrete model. */
  baseProfile: AgentProfile$1;
  /**
   * Execution-backend registry: `--backend <name>` picks the factory that
   * yields the `SandboxClient` every cell runs on. Merged over the defaults:
   *   - `sandbox` — throws with guidance (a product must supply its real
   *     Sandbox-backed client; the facade has no credentials).
   *   - `cli-bridge` — `resolveSandboxClient({ backend: 'bridge' })` reading
   *     `CLI_BRIDGE_URL` + `BRIDGE_BEARER`/`CLI_BRIDGE_BEARER`; the per-cell
   *     harness/model ride in via `sandboxOverrides.backend`.
   */
  backends?: Record<string, (() => SandboxClient) | undefined>;
  /** Extra `--flag value` CLI args `run()` parses and surfaces via `ctx.args`. */
  flags?: Record<string, LeaderboardFlagSpec>;
  /** Runs once before the matrix (fetch fixtures, warm caches). */
  setup?: (ctx: LeaderboardRunContext) => Promise<void> | void;
  /** Runs once after the matrix, even on failure (reap boxes, close handles). */
  teardown?: (ctx: LeaderboardRunContext) => Promise<void> | void;
  /** Per-cell event tap: the raw sandbox events of EVERY shot, with the case —
   *  the seam for domain metric capture (search counts, citations) without a
   *  substrate change. Fires once per shot after the cell's loop settles, in
   *  shot order, including thrown shots (whose events may be partial or empty);
   *  the third argument carries the shot's index + error/verdict outcome. */
  onCellEvents?: (events: readonly SandboxEvent[], c: TCase, iteration?: LeaderboardIterationInfo) => void;
  /** Output decode override: raw events → the scored artifact. Default: the
   *  sandbox SDK's `collectAgentResponseText` (final answer text; empty string
   *  when the stream carried none — which then scores 0). The default only
   *  produces `string`, so a spec with a structured `TArtifact` MUST supply
   *  this (or a LEVEL-2 `dispatch`). */
  parseOutput?: (events: readonly SandboxEvent[], c: TCase) => TArtifact;
  /**
   * Resolve the model the backend actually served from a shot's raw events.
   * When this returns a value the default dispatch records it on the paid-call
   * receipt. It cannot complete an inexact planning profile: every expanded
   * cell must already declare a concrete model before backend work starts.
   */
  resolveModel?: (events: readonly SandboxEvent[]) => string | undefined;
  /** Result export. Default: write `matrix-result.json` under the run dir and
   *  print (+ write) the ranked leaderboard markdown under the export dir. */
  export?: (result: RunProfileMatrixResult<TArtifact, LeaderboardScenario<TCase>>, ctx: LeaderboardRunContext) => Promise<void> | void;
  /** LEVEL 2 — full dispatch replacement (in-process products bring their own).
   *  The default is `loopDispatch` + the naive retry driver over the resolved backend. */
  dispatch?: ProfileDispatchFn<LeaderboardScenario<TCase>, TArtifact>;
  /** LEVEL 2 — full judge replacement. Default: `score` wrapped as one judge. */
  judges?: JudgeConfig<TArtifact, LeaderboardScenario<TCase>>[];
  /** Naive-retry shot cap per cell (`--shots`). Default 1. */
  shots?: number;
  /** Replicates per cell (`--reps`). Default 1. */
  reps?: number;
  /** Provider- or executor-enforced maximum for one cell dispatch. Required
   * before execution when `matrix.costCeiling` is configured. */
  maximumCharge?: MaximumCharge | ((profile: AgentProfile$1, scenario: LeaderboardScenario<TCase>) => MaximumCharge | undefined);
  /** Passthrough overrides spread onto the final `runProfileMatrix` call
   *  (e.g. `maxConcurrency`, `costCeiling`, `integrity`, `storage`) — spread
   *  LAST, so anything the facade wired can be overridden. */
  matrix?: Partial<RunProfileMatrixOptions<LeaderboardScenario<TCase>, TArtifact>>;
}
interface DefinedLeaderboard<TCase, TArtifact = string> {
  /**
   * Parse flags, run the matrix, export, and return the raw result.
   *
   * Standard flags: `--backend <name>` (default `sandbox`), `--harnesses a,b`,
   * `--models m1,m2`, `--cases id1,id2`, `--shots N`, `--reps N`,
   * `--model-snapshot <tag>`, `--run-dir <path>`, `--export-dir <path>`,
   * plus every `spec.flags` entry. `argv` defaults to `process.argv.slice(2)`.
   *
   * The default run dir is FRESH per invocation (timestamp+pid under the OS
   * tmpdir). `runProfileMatrix` caches cells by run dir, and a stable default
   * would silently reuse a prior FAILED zero-token cell and skip dispatch —
   * only an explicit `--run-dir` opts into that resume behavior.
   */
  run(argv?: string[]): Promise<RunProfileMatrixResult<TArtifact, LeaderboardScenario<TCase>>>;
  /** The same domain surface in the structural `BenchmarkAdapter` shape. */
  toBenchmarkAdapter(): LeaderboardBenchmarkAdapter<TArtifact>;
}
/**
 * Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable
 * harness×model leaderboard — `run()` executes the matrix, `toBenchmarkAdapter()`
 * exposes the same domain as a structural `BenchmarkAdapter`.
 */
declare function defineLeaderboard<TCase, TArtifact = string>(spec: LeaderboardSpec<TCase, TArtifact>): DefinedLeaderboard<TCase, TArtifact>;
//#endregion
//#region src/runtime/personify/types.d.ts
/**
 * The terminal contract Drew wants: a loop returns a FINISHED deliverable, or the concrete
 * list of blockers that stopped it — never a half-done best-effort coercion. A `blocked`
 * outcome with an empty `blockers` list is a contract violation (a shape that can't finish
 * MUST name why); impls fail loud on it rather than emitting a vacuous block.
 *
 * `Outcome` is the `Out` type a personified `Agent`/`Supervisor` is parameterized by, so the
 * keystone's typed `SupervisedResult<Outcome<D>>` carries it end to end with no coercion.
 */
type Outcome<D> = {
  kind: 'done';
  deliverable: D;
} | {
  kind: 'blocked';
  blockers: string[];
};
/**
 * The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the
 * root spec (the executor mapping for the root agent the shape builds) with the CONTENT a
 * shape consumes — the goal framing (`directive`) and who the loop is acting as (`context`).
 *
 * The framework never reads `directive`/`context` semantically; it threads them to the shape
 * verbatim through `ShapeContext`. This is the rule the mandate names: the FRAMEWORK is
 * structure, the PERSONA carries model/prompt/tools/directive. No model name, prompt, or
 * persona string is ever hardcoded in a shape or the engine.
 *
 * `D` is the deliverable type this persona's loops produce; it flows into `Outcome<D>`.
 */
interface Persona<D = unknown> {
  /** Stable persona name — used as the trace/journal label root, never as content. */
  readonly name: string;
  /**
   * The root agent's executor mapping (profile + harness + optional BYO executor). The
   * shape's root `Agent` carries THIS as its `executorSpec`; child specs the shape spawns
   * are derived from / resolved against the same persona registry (see `ShapeContext`).
   */
  readonly root: AgentSpec;
  /** The goal framing handed to the shape — the "what to achieve", not "how". */
  readonly directive: string;
  /** Who the loop is acting as — the opaque persona context blob the shape may inject into
   *  child tasks. Opaque to the framework; only the persona's profiles/prompts interpret it. */
  readonly context: PersonaContext;
  /**
   * The executor seams (router endpoint+key, sandbox client, cli bin) the built-in runtimes
   * read off `ExecutorContext.seams`, OR a fully pre-configured registry. The supervisor
   * threads an EMPTY seam bag to the root scope, so a persona that uses built-in metered
   * runtimes MUST supply a registry whose factories close over their seams (or BYO executors
   * on each `AgentSpec`). Carried here so `runPersonified` can build `SupervisorOpts.executors`.
   */
  readonly executors: PersonaExecutors;
  /**
   * Forward-compatible extension bag — a later world-model / memory / tool-budget field is an
   * additive key here, never a breaking change to the `Persona` shape. Opaque to the engine.
   */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** Phantom: binds the persona to its deliverable type so `runPersonified` infers `D` from
   *  the persona and the chosen shape must agree. Type-only — never present at runtime. */
  readonly __deliverable?: D;
}
/** The persona context blob — who the loop is acting as. Open by intent: a persona names its
 *  own role/audience/constraints; the framework treats it as opaque content. */
interface PersonaContext {
  /** The role the loop embodies ("senior staff engineer", "equity research analyst", …). */
  readonly role: string;
  /** Optional freeform framing the persona's prompts/profiles consume. */
  readonly notes?: string;
  /** Open content bag — persona-specific fields a shape's child tasks may carry. */
  readonly [key: string]: unknown;
}
/**
 * How a persona supplies executor resolution. Either a pre-built registry (factories already
 * closed over their seams) OR the raw seam bag the engine uses to construct a registry +
 * thread the seams onto each spawn. Exactly one is required — fail loud if neither is set.
 */
interface PersonaExecutors {
  /** A registry whose factories already capture their seams. Highest precedence. */
  readonly registry?: ExecutorRegistry;
  /** Raw seams to thread onto built-in runtimes (`router`/`sandbox`/`cli` keys). */
  readonly seams?: Readonly<Record<string, unknown>>;
}
/** The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default
 *  the executors-supplied invariant check and freeze the record. */
interface DefinePersonaInput<D = unknown> {
  readonly name: string;
  readonly root: AgentSpec;
  readonly directive: string;
  readonly context: PersonaContext;
  readonly executors: PersonaExecutors;
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** Phantom: pins the input's deliverable type so `definePersona<D>` returns a `Persona<D>`
   *  the caller's shape must agree with. Type-only — never supplied at a call site. */
  readonly __deliverable?: D;
}
/** Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a
 *  registry nor seams = an unresolvable persona). Pure — no I/O, no engine. */
type DefinePersona = <D = unknown>(input: DefinePersonaInput<D>) => Persona<D>;
/**
 * Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool.
 * The root budget lives on `SupervisorOpts.budget`; the shape only needs the per-child
 * sizing hints + the fanout width it is allowed to open. All ceilings — the pool reserves
 * against them and fails closed, so an over-eager shape can never overspend.
 */
interface ShapeBudget {
  /** Per-child spawn budget the shape reserves for each leaf/sub-loop it opens. */
  readonly perChild: Budget;
  /** Max children a fanout step may open in one round (the shape's structural width). */
  readonly fanout: number;
}
/**
 * The construction context a `LoopShape` factory receives. Carries the persona's resolved
 * executor seams + the budget knobs, plus the ONE helper a shape needs to spawn a child
 * through the keystone: `spawnChild` resolves an `AgentSpec` (or a persona-derived child
 * profile) into an `Agent` the shape hands to `scope.spawn`. The shape never touches the
 * registry directly — it asks the context, keeping resolution single-sourced.
 */
interface ShapeContext<D = unknown> {
  readonly persona: Persona<D>;
  readonly budget: ShapeBudget;
  /**
   * Wrap an `AgentSpec` into a leaf `Agent` carrying it as `executorSpec`, so the shape can
   * `scope.spawn(spawnChild(spec), task, opts)`. `name` labels the child for traces. The
   * returned agent's `act` is never invoked by the keystone (it is spawned, not run) — the
   * spec drives the resolved `Executor`; `act` exists only to satisfy the `Agent` shape.
   */
  spawnChild(name: string, spec: AgentSpec): Agent<unknown, Outcome<D>>;
  /** Derive a child `AgentSpec` from the persona's root spec with an overridden profile —
   *  the seam a shape uses to give a worker a narrower role/prompt than the root persona. */
  childSpec(profile: AgentProfile, harness?: BackendType | null): AgentSpec;
  /** The scope analyst (selector≠judge firewall) the combinator steers from. Absent ⇒ the
   *  dormant default (empty findings → gates read deliverables/state only). */
  readonly analyst?: ScopeAnalyst<D>;
}
/**
 * A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it
 * returns the root `Agent<Task, Outcome<D>>` whose `act` decomposes the task, fans out
 * children through `scope.spawn`, verifies/selects across their settlements (selector≠judge:
 * via `settledToIteration` + `defaultSelectWinner`, never re-ranking behind the driver), and
 * synthesizes the terminal `Outcome<D>`. The shape is STRUCTURE; the persona is CONTENT.
 */
type LoopShape<Task, D> = (ctx: ShapeContext<D>) => Agent<Task, Outcome<D>>;
/**
 * The open shape registry — the extension point that makes a new loop-shape ONE file + one
 * `registerShape` call with zero edits elsewhere. `resolve` returns a typed outcome (inspect
 * `succeeded` before `value`); `register` fails loud on a duplicate name.
 */
interface ShapeRegistry {
  register<Task, D>(name: string, factory: LoopShape<Task, D>): void;
  resolve<Task, D>(name: string): {
    succeeded: true;
    value: LoopShape<Task, D>;
  } | {
    succeeded: false;
    error: string;
  };
  /** The registered shape names — for diagnostics + a fail-loud "unknown shape" message. */
  names(): string[];
}
/**
 * The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then
 * runs it through a fresh `createSupervisor` over the persona's executors + the supplied
 * budget/journal/blobs. Returns the keystone's typed `SupervisedResult<Outcome<D>>` — a
 * `winner` carries the synthesized `Outcome<D>`; a `no-winner` is never coerced into one.
 *
 * `shape` is either a resolved `LoopShape` or a registered shape NAME (resolved through the
 * default registry). The journal/blobs default to in-memory impls in the engine when omitted
 * (durable FS impls are passed explicitly for a persisted run).
 */
interface RunPersonifiedOptions<Task, D> {
  readonly persona: Persona<D>;
  /** A resolved shape factory OR a registered shape name. */
  readonly shape: LoopShape<Task, D> | string;
  readonly task: Task;
  readonly budget: Budget;
  /** Per-child sizing + fanout width handed to the shape. Defaults derive from `budget`. */
  readonly shapeBudget?: Partial<ShapeBudget>;
  /** Trace/journal root key. Defaults to the persona name + a run discriminator in the engine. */
  readonly runId?: string;
  readonly journal?: SpawnJournal;
  readonly blobs?: ResultBlobStore;
  /** Runtime recursion-depth ceiling, paired with the conserved pool. */
  readonly maxDepth?: number;
  /** OTP intensity breaker bounds, forwarded to the supervisor verbatim. */
  readonly maxRestarts?: number;
  readonly withinMs?: number;
  /** Forwarded to `SupervisorOpts.teardownConfirmMs`: how long settlement keeps retrying a child
   *  teardown the executor has not confirmed. `0` makes one attempt only. Default: 300000. */
  readonly teardownConfirmMs?: number;
  /** Forwarded to `SupervisorOpts.workerSlots`: the tree-wide bound on simultaneously working
   *  agents; spawns past it queue. Omit to bound concurrency by the budget alone. */
  readonly workerSlots?: number | WorkerSlots;
  /**
   * Forwarded to `SupervisorOpts.resume`: replay the journaled tree for `runId` before beginning
   * fresh work (keyed spawns that already settled `done` return their committed result and spend
   * nothing). Needs a journal + blob store that outlive the process and the same `rootIdentity`
   * the first run recorded. Omit it and a second run under an existing `runId` is refused.
   */
  readonly resume?: boolean;
  /**
   * Forwarded to `SupervisorOpts.rootIdentity`: the exact root profile/task digests the journal
   * records for this run. A resumable run must pass the SAME identity on the first run and on
   * the resume — the supervisor refuses a resume without one, and refuses one that differs from
   * the recorded root.
   */
  readonly rootIdentity?: NodeExecutionIdentity;
  /** A live root handle to attach (view/signal/abort) before the run starts. */
  readonly handle?: RootHandle<Outcome<D>>;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  /** Optional scope analyst threaded into the shape's ShapeContext so loopUntil/widen steer
   *  on trace-derived findings instead of the dormant empty default. */
  readonly analyst?: ScopeAnalyst<D>;
  /**
   * Lifecycle stream sink, forwarded to `SupervisorOpts.hooks` so the root `Scope`'s
   * `agent.spawn`/`agent.child` events flow to an observer (e.g. the Intelligence SDK's
   * trace export). Absent ⇒ no stream (the run is silent, as today).
   */
  readonly hooks?: RuntimeHooks;
}
/** The composed run signature. */
type RunPersonified = <Task, D>(options: RunPersonifiedOptions<Task, D>) => Promise<SupervisedResult<Outcome<D>>>;
//#endregion
//#region src/runtime/personify/wave-types.d.ts
/**
 * A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act`
 * runs the combinator's structure over the `Scope` (spawn children, drain `next()`, select via
 * the single-sourced `settledToIteration`+`defaultSelectWinner`, synthesize an `Outcome<D>`).
 * Aliased — NOT a new type — so a combinator stays a first-class shape the persona layer's
 * `runPersonified`/`ShapeRegistry` resolve with zero new machinery. The SHAPE is content-free;
 * the persona carries the domain.
 */
type CombinatorShape<Task, D> = LoopShape<Task, D>;
/**
 * `pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next
 * stage's task (via `feed`). The first `blocked` stage short-circuits the whole pipeline (its
 * blockers ARE the pipeline's blockers — never coerced past a failed stage). The terminal
 * stage's `done` deliverable is the pipeline's deliverable. Spawns one child per stage in order;
 * a stage that the conserved pool cannot admit is a concrete blocker.
 *
 * No domain: "code build test" is `pipeline([plan, implement, integrate])` under a coder persona,
 * not a named shape. A stage names only its label + how to derive its task from the prior output.
 */
interface PipelineStage<Task, StepIn, StepOut> {
  /** Trace/journal label for this stage's spawned child. */
  readonly label: string;
  /** Derive this stage's task from the prior stage's deliverable (or the root task for stage 0).
   *  Pure projection — the framework never interprets the result; the resolved leaf does. */
  feed(prior: StepIn, ctx: ShapeContext<unknown>, rootTask: Task): unknown;
  /** Read this stage's settled child output into the typed `StepOut` the next stage feeds on.
   *  Fail loud (return a `blocked`) when the child produced nothing usable for the next stage. */
  collect(settled: Settled<Outcome<StepOut>>): Outcome<StepOut>;
}
/** `pipeline(stages)` — build the sequential combinator from an ordered stage list. The first
 *  stage's `StepIn` is the root `Task`; the last stage's `StepOut` is the deliverable `D`. */
type Pipeline = <Task, D>(stages: ReadonlyArray<PipelineStage<Task, unknown, unknown>>) => CombinatorShape<Task, D>;
/**
 * `fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by
 * the conserved pool's fail-closed admission), drained via `scope.next()`, then optionally a
 * single SYNTHESIS child over the gathered results. Without `synthesize`, the combinator returns
 * the best-valid child via the single-sourced selector (selector≠judge). A round that admitted
 * zero children, or whose synthesis child could not be admitted, is a concrete blocker.
 *
 * No domain: a "research sweep over angles" is `fanout(angles, { synthesize: cite })` under a
 * research persona; a "fanout-vote" is `fanout(copies)` with the default selector. The item list
 * + the synthesis posture are the SHAPE's args; the prompt that turns an item into work is the
 * persona's.
 */
interface FanoutOptions<Item, D> {
  /** One child task per item: `item` + the index discriminator. The persona's directive/context
   *  is threaded in by the combinator; this only supplies the per-item discriminator. */
  itemTask(item: Item, index: number, ctx: ShapeContext<D>): unknown;
  /** Per-item child label (defaults to `item:<index>` in the impl). */
  label?(item: Item, index: number): string;
  /**
   * Optional per-item `AgentSpec` override. When set, each item's child is spawned against the
   * returned spec instead of `persona.root` — the seam a heterogeneous fanout uses to give each
   * item a DISTINCT executor (e.g. N authored harness profiles, each on its own worktree-CLI
   * leaf). Absent ⇒ every item runs against the persona's root spec (the homogeneous default).
   */
  itemSpec?(item: Item, index: number, ctx: ShapeContext<D>): AgentSpec;
  /**
   * Optional synthesis over the gathered child results: when present, the combinator spawns ONE
   * synthesis child whose task is built from the drained settlements, and its `done` output is
   * the deliverable. When absent, the deliverable is the best-valid child via `defaultSelectWinner`.
   * The synthesis child is a SEPARATE keystone agent (not a re-rank behind the driver).
   */
  synthesize?: FanoutSynthesis<D>;
  /**
   * Winner-selection strategy among the gathered `done` children when there is no `synthesize`.
   * Receives the SAME `Iteration[]` the default selector reads (each child's output is its
   * `Outcome<D>`), so a strategy is a thin re-sort (smallest-diff, highest-readiness, first-valid
   * …) over the candidates — NEVER a re-rank behind a judge. Default = `defaultSelectWinner`
   * semantics (best-valid-score, ties→earliest). Mutually exclusive with `synthesize` (a
   * synthesis child IS the selection); supplying both is a config error.
   */
  selectWinner?: FanoutWinnerSelector<D>;
  /**
   * Cap on how many item children run AT ONCE. When set, the fanout dispatches through
   * `rollingDispatch`: it fills `width` slots and admits the next item the moment one settles,
   * instead of opening every item in a single round. Same items, same selection, same conserved
   * pool — only the simultaneity changes.
   *
   * Unset (the default) keeps the single-round batch behavior every existing caller has. Set it
   * when the items outnumber the live capacity a host can actually afford, so the pool is not
   * spent opening children that then queue behind a real fence.
   */
  width?: number;
}
/** A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the
 *  child's `Outcome<D>`), returning the chosen iteration or `undefined` when none qualifies. */
type FanoutWinnerSelector<D> = (iterations: Iteration<unknown, Outcome<D>>[]) => {
  readonly output?: Outcome<D> | undefined;
} | undefined;
/** Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid
 *  score, the smallest delivered artifact (via a `sizeOf` extractor), or the earliest valid. */
type WinnerStrategy = 'highest-score' | 'smallest-artifact' | 'first-valid';
/** How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child
 *  settlements into the synthesis child's task; `collect` reads its settled output into the
 *  deliverable `Outcome<D>`. */
interface FanoutSynthesis<D> {
  synthesisTask(gathered: ReadonlyArray<Settled<Outcome<D>>>, ctx: ShapeContext<D>): unknown;
  collect(settled: Settled<Outcome<D>>): Outcome<D>;
}
/** `fanout(items, opts)` — build the fanout combinator over a static item list. */
type Fanout = <Task, Item, D>(items: ReadonlyArray<Item>, opts: FanoutOptions<Item, D>) => CombinatorShape<Task, D>;
/**
 * `loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step`
 * child per round, ask `until` whether the accumulated state satisfies the goal, and stop when it
 * does OR when the pool can no longer admit a step (budget IS the loop bound — no unbounded
 * while). The deployable, non-oracle stop: `until` is the satisfiability gate, read from trace
 * findings + accumulated deliverables, never a fresh raw verdict the loop minted to stop itself.
 *
 * No domain: "refine until tests pass" is `loopUntil` with a coder persona + a `step` that edits
 * and an `until` that reads the test-finding; the combinator owns only the round/stop wiring.
 */
interface LoopUntilSpec<Task, State, D> {
  /** Build the next step child's task from the root task + the state accumulated so far. */
  step(rootTask: Task, state: LoopUntilState<State>, ctx: ShapeContext<D>): unknown;
  /** Fold one settled step into the accumulated state (the loop's running deliverable candidate). */
  fold(prior: LoopUntilState<State>, settled: Settled<Outcome<D>>): LoopUntilState<State>;
  /**
   * The satisfiability gate: given the accumulated state + the round's trace findings, has the
   * goal been reached? Returns the terminal deliverable when satisfied, or `null` to keep going.
   * Reads `findings` (trace-derived), NOT a raw verdict score — the deployable-stop discipline.
   */
  until(state: LoopUntilState<State>, findings: ReadonlyArray<AnalystFinding$2>): Outcome<D> | null;
  /** Per-round step label (defaults to `step:<round>` in the impl). */
  label?(round: number): string;
}
/** The accumulated state `loopUntil` threads across rounds — the running candidate + the round
 *  index, so `step`/`fold`/`until` are pure functions of it (replay-safe, no wall-clock). */
interface LoopUntilState<State> {
  readonly round: number;
  readonly value: State;
}
/** `loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state. */
type LoopUntil = <Task, State, D>(seed: State, spec: LoopUntilSpec<Task, State, D>) => CombinatorShape<Task, D>;
/**
 * `panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its
 * limit). The combinator spawns the M judge children over the same input artifact, drains their
 * settlements, and MERGES their findings into a panel verdict via `merge` — a pure WRITE-ONLY
 * fold (a judge's output is never fed back to steer another judge, and the merge never re-ranks
 * the children behind the driver). The merged verdict gates the deliverable.
 *
 * No domain: a "code review panel" and an "essay rubric panel" are the same `panel` shape under
 * different personas; the rubric lives in each judge persona's profile, not the combinator.
 */
interface PanelSpec<Artifact, D> {
  /** The M judge child specs: each is a persona-derived child (a narrower judge profile). The
   *  combinator spawns one child per entry over the SAME `artifact` and never lets one judge's
   *  output reach another's task (write-only). */
  readonly judges: ReadonlyArray<PanelJudge>;
  /** Build one judge child's task from the shared artifact under review + the judge descriptor. */
  judgeTask(artifact: Artifact, judge: PanelJudge, ctx: ShapeContext<D>): unknown;
  /**
   * Write-only merge: fold the M settled judge verdicts into the panel's terminal `Outcome<D>`.
   * Pure over the drained settlements — it MUST NOT spawn, re-judge, or feed one verdict into
   * another. A panel that reached no quorum is a concrete blocker (fail loud, never a vacuous done).
   */
  merge(verdicts: ReadonlyArray<PanelVerdict>, artifact: Artifact): Outcome<D>;
}
/** One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in
 *  the judge's profile; this carries only the label + the optional weight the merge may read. */
interface PanelJudge {
  readonly label: string;
  /** Optional merge weight (a write-only hint the `merge` fold may use; default-equal in the impl). */
  readonly weight?: number;
}
/** One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no
 *  verdict (excluded from the merge `n`, like an infra-errored cell). */
interface PanelVerdict {
  readonly judge: PanelJudge;
  readonly verdict?: DefaultVerdict;
  /** The judge child's raw output — what it was asked to assess, for a merge that quotes it. */
  readonly output?: unknown;
  /** True when the judge child went `down` (no usable verdict — kept out of the merge denominator). */
  readonly down: boolean;
}
/** `panel(spec)` — build the M-judge write-only-merge combinator. */
type Panel = <Task, Artifact, D>(spec: PanelSpec<Artifact, D>) => CombinatorShape<Task, D>;
/**
 * `verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a
 * candidate, then a SEPARATE VERIFIER child's verdict GATES shippability. A `valid` verifier
 * verdict ships the implement deliverable; any other outcome (implement down, verifier down,
 * invalid verdict) becomes a concrete blocker carrying the failure verbatim — never a coerced
 * "done". The verifier is a distinct keystone agent (selector≠judge: the implement child does
 * not grade itself).
 *
 * No domain: "write code then run the test gate" and "draft then fact-check" are the same `verify`
 * shape under different personas; the gate rubric is the verifier persona's, not the combinator's.
 */
interface VerifySpec<Task, Candidate, D> {
  /** Build the implement child's task from the root task. */
  implement(rootTask: Task, ctx: ShapeContext<D>): unknown;
  /** Build the verifier child's task from the implement child's settled candidate. */
  verifier(candidate: Settled<Outcome<Candidate>>, ctx: ShapeContext<D>): unknown;
  /** Project the gated (verifier-`valid`) candidate into the terminal deliverable. */
  collect(candidate: Settled<Outcome<Candidate>>, verdict: DefaultVerdict): Outcome<D>;
  /** Implement / verifier child labels (default `implement` / `verify` in the impl). */
  readonly implementLabel?: string;
  readonly verifierLabel?: string;
}
/** `verify(spec)` — build the 2-node implement→verifier-gate combinator. */
type Verify = <Task, Candidate, D>(spec: VerifySpec<Task, Candidate, D>) => CombinatorShape<Task, D>;
/**
 * `widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout
 * combinators above, the widener REACTS to each `scope.next()`: as each child settles it consults
 * the `WidenGate` and, when a lineage is `promising`, widens by AT MOST ONE child toward it under
 * the remaining conserved pool. Defaults to FLAT (the gate never widens) so a gate run stays
 * non-widening and the R2 selector≠judge collision is dormant. `promising` is derived from the
 * round's analyst FINDINGS (via `ScopeAnalyst`, §2), NOT a child's raw `verdict` — the firewall.
 *
 * This is the progressive-widening (MCTS-PW) combinator: the one shape whose breadth is decided
 * at runtime from the diagnosis, not fixed at spawn. It is the mechanism the diverse-strategy-vs-
 * blind GATE is run with — kept FLAT by default until that gate returns positive (don't build
 * mechanism ahead of the gate).
 */
interface WidenSpec<Seed, D> {
  /** The initial children to spawn before any widening — the seed lineages the gate widens from.
   *  One child task per seed; bounded by the conserved pool's fail-closed admission. */
  readonly seeds: ReadonlyArray<Seed>;
  seedTask(seed: Seed, index: number, ctx: ShapeContext<D>): unknown;
  /**
   * The progressive-widening gate. Consulted on EVERY settled child with the round's
   * trace-derived `findings`; returns a widen decision (spawn one more toward a lineage) or a
   * stop. DEFAULTS to flat via `flatWidenGate` — never widens, so the firewall stays dormant.
   */
  readonly gate: ScopeWidenGate<D>;
  /** Build the widened child's task from the lineage the gate chose to extend. */
  widenTask(toward: WidenLineage<D>, ctx: ShapeContext<D>): unknown;
  /** Synthesize the terminal deliverable from every settled lineage (selector≠judge: the
   *  single-sourced selector over the gathered children, never a re-judge). */
  synthesize(gathered: ReadonlyArray<Settled<Outcome<D>>>, ctx: ShapeContext<D>): Outcome<D>;
}
/**
 * The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read
 * trace FINDINGS instead of a raw verdict). `decide` is consulted per settled child; it MUST
 * derive `promising` from `findings`, never from `settled.verdict`, unless `judgeExempt` is
 * explicitly argued (the documented off-by-default escape hatch). Flat default never widens.
 */
interface ScopeWidenGate<D> {
  decide(settled: Settled<Outcome<D>>, findings: ReadonlyArray<AnalystFinding$2>, budget: Scope<Outcome<D>>['budget']): WidenDecision<D>;
  /** When true, `decide` may read `settled.verdict` directly — collides with the steer firewall,
   *  so it must be argued per cell, never defaulted on (mirrors the keystone `WidenGate`). */
  readonly judgeExempt?: boolean;
}
/** A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate`
 *  always returns `{ kind: 'stop' }`. */
type WidenDecision<D> = {
  kind: 'widen';
  toward: WidenLineage<D>;
} | {
  kind: 'stop';
  rationale?: string;
};
/** A lineage the gate may widen toward — the settled child that looked promising + the findings
 *  that justified it (the trace-derived provenance the firewall requires). */
interface WidenLineage<D> {
  readonly settled: Extract<Settled<Outcome<D>>, {
    kind: 'done';
  }>;
  readonly findings: ReadonlyArray<AnalystFinding$2>;
}
/** `widen(spec)` — build the streaming progressive-widening combinator. */
type Widen = <Task, Seed, D>(spec: WidenSpec<Seed, D>) => CombinatorShape<Task, D>;
/** The flat default `ScopeWidenGate` factory contract — never widens, keeping the R2 firewall
 *  conflict dormant. Exported so a gate run can pass it explicitly and a test can assert the
 *  default is flat. */
type FlatWidenGate = <D>() => ScopeWidenGate<D>;
/**
 * The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook
 * (dynamic.ts) onto the reactive `Scope`. The old driver wired the analyst at round
 * boundaries (`plan` ran the analyst over `history` BEFORE the planner); the reactive `Scope` has
 * no rounds, so this carries the wire across: a combinator's `act` asks the `ScopeAnalyst` to turn
 * the settled children SO FAR into `AnalystFinding[]`, and steers from THOSE findings.
 *
 * The firewall is preserved (selector≠judge): `analyze` runs the trace-derived analyst and the
 * impl asserts `assertTraceDerivedFindings` semantics — a finding citing judge/verdict/score
 * `metric` evidence aborts the round. The steer decision reads `findings`, NEVER the children's
 * raw `verdict`. Fail loud — a throwing or non-array analyst aborts (no silent empty findings).
 */
interface ScopeAnalyst<D> {
  /**
   * Turn the children settled so far into trace-derived findings. `settledSoFar` is the cursor-
   * ordered settlement list a combinator has drained (the reactive analogue of the old driver's
   * `history`). The impl runs the analyst, then enforces the trace-derived firewall before
   * returning — a judge-derived finding is rejected, not filtered.
   */
  analyze(input: ScopeAnalyzeInput<D>): Promise<ReadonlyArray<AnalystFinding$2>>;
}
/** Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far. */
interface ScopeAnalyzeInput<D> {
  /** Opaque root-task framing (whatever the combinator was invoked with). */
  readonly task: unknown;
  /** The children this combinator has drained off `scope.next()`, in cursor order. */
  readonly settledSoFar: ReadonlyArray<Settled<Outcome<D>>>;
  /** This combinator's scope id (the trace-correlation root for the analyst). */
  readonly nodeId: NodeId;
}
/**
 * How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a
 * reactive combinator reads. `loopUntil.until`, `widen` gate, and any future steer all funnel
 * through a `SteerContext` so the firewall is enforced in one place: `findings` is trace-derived
 * (the analyst already asserted it), and a combinator MUST NOT reach back to `settled.verdict`
 * for the steer decision. `lastValidScore` is provided for OBSERVABILITY only (rendering/traces),
 * explicitly NOT for steering — reading it to steer is the coupling the architecture forbids.
 */
interface SteerContext<D> {
  readonly findings: ReadonlyArray<AnalystFinding$2>;
  readonly settledSoFar: ReadonlyArray<Settled<Outcome<D>>>;
  /** Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
   *  off this re-introduces selector=judge. Marked so a reviewer catches a misuse. */
  readonly lastValidScore?: number;
}
/**
 * The firewall assertion contract, re-stated for the reactive seam (PORT of
 * `assertTraceDerivedFindings`). A PROVENANCE check, not a content check: span/event/artifact/
 * finding refs and empty-evidence findings pass; only a `metric` ref whose uri is a
 * judge/verdict/score scheme is rejected. Fail loud — a tainted finding aborts. The impl lives in
 * `analyst.ts`; this type pins its signature so callers depend on the contract, not the impl.
 */
type AssertTraceDerivedFindings = (findings: ReadonlyArray<AnalystFinding$2>) => void;
/**
 * One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from
 * a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
 * FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
 * not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
 * relevant, high-confidence subset.
 */
interface CorpusRecord {
  readonly schemaVersion: '1.0.0';
  /** Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups. */
  readonly id: string;
  /** The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace. */
  readonly runId: NodeId;
  readonly producedAt: string;
  /** Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`). */
  readonly area: string;
  /** The accreted fact — the instruction-shaped statement the next run reads back. */
  readonly claim: string;
  /** Optional supporting detail the renderer may include under the claim. */
  readonly rationale?: string;
  /** Free-form tags for `query` filtering (domain, persona, surface). */
  readonly tags: ReadonlyArray<string>;
  /** 0..1 — the producing run's confidence in this fact (the render threshold reads it). */
  readonly confidence: number;
  /** Optional provenance back into the run that learned it (a finding id / outRef / span). */
  readonly evidence?: ReadonlyArray<{
    readonly kind: string;
    readonly uri: string;
  }>;
}
/** A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain. */
interface CorpusFilter {
  readonly area?: string;
  /** Match records carrying ALL of these tags. */
  readonly tags?: ReadonlyArray<string>;
  /** Minimum confidence a record must clear to be returned (the render gate). */
  readonly minConfidence?: number;
  /** Only records from this run (rare — usually a cross-run read). */
  readonly runId?: NodeId;
  /** Cap the result count (most-confident first in the impl). */
  readonly limit?: number;
}
/**
 * The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal`
 * (per-run decisions, replay) and `ResultBlobStore` (per-run payloads): `Corpus` holds accreted
 * FACTS across runs that the next run reads back. `InMemoryCorpus` + `FileCorpus` (JSONL) impls
 * live in `corpus.ts` and MAY share a storage spine with the JSONL journal, but the INTERFACE is
 * separate so a consumer never confuses a replay record with a learned fact.
 *
 * Fail-loud, typed-outcome boundary: `append` is idempotent on an identical record (same `id` +
 * `claim`); a conflicting re-append under the same `id` is a typed error, never a silent overwrite.
 */
interface Corpus {
  /** Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
   *  inspect `succeeded` before treating it as durable (no silent write-through on conflict). */
  append(record: CorpusRecord): Promise<{
    succeeded: true;
  } | {
    succeeded: false;
    error: string;
  }>;
  /** Query accreted facts by filter — most-confident first. Returns the matching records (an
   *  empty array when none match is a valid result, NOT an error). */
  query(filter: CorpusFilter): Promise<ReadonlyArray<CorpusRecord>>;
}
/**
 * Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel
 * READ side. Reads the corpus through `filter`, renders the matching facts into instruction lines,
 * and returns a NEW profile with them merged into `prompt.instructions` (the append-line seam) so
 * the next run's persona reads the accreted world-model. Pure projection over the queried records;
 * never mutates the input profile (returns a fresh one). The impl lives in `corpus.ts`.
 *
 * `resources.instructions` is `string | AgentProfileResourceRef`; `prompt.instructions` is
 * `string[]`. The render targets `prompt.instructions` (additive lines) by default; a caller that
 * wants the single-blob `resources.instructions` form passes `target: 'resources'`.
 */
interface RenderCorpusToInstructionsOptions {
  readonly corpus: Corpus;
  readonly filter: CorpusFilter;
  /** The profile to project the facts into. The result is a fresh profile — the input is unchanged. */
  readonly profile: AgentProfile$3;
  /** Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
   *  the single-blob `resources.instructions` string. */
  readonly target?: 'prompt' | 'resources';
  /** Optional cap on rendered lines (most-confident first), independent of the query `limit`. */
  readonly maxLines?: number;
}
/** `renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the
 *  durable corpus); returns a fresh `AgentProfile` with the accreted facts merged in. */
type RenderCorpusToInstructions = (opts: RenderCorpusToInstructionsOptions) => Promise<AgentProfile$3>;
/**
 * One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
 * spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
 * `Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
 * shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.
 */
interface TrajectoryNode {
  readonly id: NodeId;
  readonly parent?: NodeId;
  readonly children: ReadonlyArray<NodeId>;
  readonly label: string;
  readonly runtime: string;
  /** Terminal status the journal recorded for this node. `'waiting'` is a wait-state node that was
   *  armed and never woken — the journal's record of a run that died mid-wait. */
  readonly status: 'done' | 'failed' | 'cancelled' | 'pending' | 'waiting';
  /** This node's OWN conserved spend (from its `settled` event). */
  readonly ownSpend: Spend;
  /** This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
   *  "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis). */
  readonly rolledUpSpend: Spend;
  /** The node's verdict, when its settlement carried one (observability — NOT a steer input). */
  readonly verdict?: DefaultVerdict;
  /** The rehydrated output artifact, when `withOutputs` was requested + the blob resolved. */
  readonly output?: unknown;
  readonly outRef?: string;
}
/** The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 *  per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read. */
interface TrajectoryReport {
  readonly root: NodeId;
  /** Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges). */
  readonly nodes: ReadonlyArray<TrajectoryNode>;
  /** The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms). */
  readonly total: Spend;
  /** Count of nodes by terminal status — a quick "how did the tree end" readout. */
  readonly statusCounts: Readonly<Record<TrajectoryNode['status'], number>>;
}
/**
 * `trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
 * per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
 * the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
 * a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
 * impl lives in `trajectory.ts`.
 */
interface TrajectoryReportOptions {
  /** Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report). */
  readonly withOutputs?: boolean;
}
/** `trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs). */
type TrajectoryReportFn = (journal: SpawnJournal, blobs: ResultBlobStore, root: NodeId, options?: TrajectoryReportOptions) => Promise<TrajectoryReport>;
/**
 * One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
 * run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
 * already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
 * (not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
 * internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
 * iteration count.
 */
interface EqualKArm {
  readonly label: string;
  readonly report: TrajectoryReport;
}
/**
 * The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
 * CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
 * arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
 * NOT comparable at equal compute — a confound to report, not a result to publish.
 */
interface EqualKVerdict {
  readonly withinTolerance: boolean;
  /** Per-arm conserved cost (the basis: tokens total + usd). */
  readonly arms: ReadonlyArray<{
    readonly label: string;
    readonly tokens: number;
    readonly usd: number;
    readonly iterations: number;
  }>;
  /** The realized spread on each channel (max − min across arms), for the report. */
  readonly spread: {
    readonly tokens: number;
    readonly usd: number;
  };
  /** The fractional tolerance the check used (spread / median ≤ tolerance per channel). */
  readonly tolerance: number;
}
/**
 * `equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
 * (tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
 * construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
 * pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
 * impl lives in `trajectory.ts`. Pure over the reports — no I/O.
 */
interface EqualKOnCostOptions {
  /** Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
   *  the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim. */
  readonly tolerance?: number;
}
/** `equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost. */
type EqualKOnCost = (arms: ReadonlyArray<EqualKArm>, options?: EqualKOnCostOptions) => EqualKVerdict;
//#endregion
//#region src/runtime/observe.d.ts
interface ObserveInput {
  /** What the worker was asked to do. */
  task: string;
  /** What it produced (its final answer / artifact summary). */
  output: string;
  /** The worker's trace — any event array (sandbox events, tool-call records). */
  trace: ReadonlyArray<unknown>;
  /** Caller-owned execution evidence, separate from task/output and final grading.
   * The default analyst requires JSON-serializable data; custom analysis receives the original value. */
  context?: unknown;
  /** Terminal status only (passed/failed/unknown) — NOT a judge score; the
   *  observer never reads the verdict, it reads behavior. */
  outcome?: 'passed' | 'failed' | 'unknown';
  /** Provenance back to the run. */
  runId?: string;
  /** Caller-owned references to the retained evidence supplied in this input. */
  evidenceRefs?: ReadonlyArray<ProposalFinding['evidence_refs'][number]>;
}
/** @inline */
interface ObserveCommonOptions {
  /** When set, learned facts are appended (idempotent) for the next run to read. */
  corpus?: Corpus;
  /** Tags written onto learned facts + used by the next run's corpus query. */
  tags?: ReadonlyArray<string>;
  signal?: AbortSignal;
  /** Cap the trace lines fed to the observer (keeps the call cheap). Default 80. */
  maxTraceLines?: number;
  /** Maximum output characters delivered to the default observer. Default 1200. */
  maxOutputChars?: number;
  /** Maximum serialized context characters before a truncation marker. Default 12000; zero omits context.
   * Applies only to the default analyst. Custom analysis receives the complete input. */
  maxContextChars?: number;
  /** Evidence origin for the default observer. Defaults to production for existing callers. */
  proposalOrigin?: ProposalFinding['proposal_origin'];
}
/** A caller-selected analysis retains the same findings, usage, and corpus contract. */
type ObservationAnalysis = (input: ObserveInput, context: {
  signal?: AbortSignal;
}) => Promise<Pick<Observation, 'findings' | 'report' | 'usage'>>;
type ObserveOptions = ObserveCommonOptions & ({
  analysis: ObservationAnalysis;
  profile?: AgentProfile;
  executor?: ExecutorConfig;
} | {
  analysis?: undefined;
  profile: AgentProfile;
  executor: ExecutorConfig;
});
/** The default observer instruction — exported so an optimizer can seed its population. */
declare const defaultAnalystInstruction: string;
interface Observation {
  findings: ProposalFinding[];
  /** Facts persisted to the corpus (empty when no corpus was supplied). */
  learned: CorpusRecord[];
  /** Operator-facing markdown: what the observer noticed + what to change. */
  report: string;
  /** Measured model usage for this analysis turn. */
  usage: {
    input: number;
    output: number;
    known: boolean;
  };
}
/** Analysis can fail after paid work; its measured subtotal must remain recoverable. */
declare class ObservationError extends Error {
  readonly usage: Observation['usage'];
  constructor(message: string, usage: Observation['usage'], options?: ErrorOptions);
}
/** Analyze through the selected implementation, then retain its validated findings in the corpus. */
declare function observe(input: ObserveInput, opts: ObserveOptions): Promise<Observation>;
/** Operator-facing report, split by who should act. The agent block is the
 *  steer; the operator block is the advice. */
declare function renderReport(findings: ReadonlyArray<AnalystFinding>): string;
//#endregion
//#region src/runtime/harvest-corpus.d.ts
type HarvestCorpusOptions = ObserveOptions & {
  /** The completed runs to analyze — map your store's rows to `ObserveInput`. */
  runs: AsyncIterable<ObserveInput> | Iterable<ObserveInput>;
  /** The durable corpus the facts accrete into. */
  corpus: Corpus;
  /** Tags written onto learned facts (the product/domain key the read side queries by). */
  tags?: ReadonlyArray<string>;
  /** Runs analyzed in parallel. Default 4. */
  concurrency?: number;
  /** Hard cap on runs consumed from the stream (a cost guard for unbounded stores). */
  maxRuns?: number;
  signal?: AbortSignal;
};
interface HarvestFailure {
  runId: string;
  error: string;
}
interface HarvestReport {
  runsObserved: number;
  /** Total findings the analyst produced (including ones already known). */
  findings: number;
  /** NEW facts actually appended (idempotent dedup excludes re-learned ones). */
  learned: number;
  /** Per-run analysis failures — reported, never silently dropped. */
  failures: HarvestFailure[];
  /** Measured analyst tokens; a failed or unmetered analysis leaves the subtotal incomplete. */
  usage: Observation['usage'];
}
/** The completed batch evidence remains available even when every analysis failed. */
declare class HarvestError extends Error {
  readonly report: HarvestReport;
  constructor(report: HarvestReport);
}
/** Batch the selected observation implementation over completed runs and retain its findings. */
declare function harvestCorpus(opts: HarvestCorpusOptions): Promise<HarvestReport>;
//#endregion
//#region src/runtime/in-process-sandbox-client.d.ts
/** Context handed to each `onPrompt` call. */
interface InProcessPromptCtx {
  /** 0-based round index — increments per `streamPrompt` on the same box.
   *  Fresh boxes start at 0. */
  round: number;
  /** Absolute path of this box's workspace, when a `workdir` was configured.
   *  Write the deliverable / fixtures here; `fs.read`/`fs.write`/`exec` operate
   *  over it. `undefined` for pure event-only boxes. */
  workdir?: string;
  /** Cooperative cancellation channel for this turn. */
  signal: AbortSignal;
  /** The verbatim per-call options the caller passed to the box verb (minus
   *  `signal`, surfaced above) — lets an offline test assert an options
   *  passthrough (`model`, `sessionId`, …) actually arrived. */
  options?: Record<string, unknown>;
}
/**
 * The user callback: given a prompt and its round, produce the box's event
 * stream for that turn. Return a plain `SandboxEvent[]` (the common case) or an
 * async iterable for streaming. The callback may also write files into
 * `ctx.workdir` (read back via `fs.read` or graded by `exec`).
 */
type InProcessOnPrompt = (prompt: string, ctx: InProcessPromptCtx) => SandboxEvent[] | AsyncIterable<SandboxEvent> | Promise<SandboxEvent[]>;
/** @experimental */
interface InProcessSandboxClientOptions {
  /** The per-turn behavior — see {@link InProcessOnPrompt}. */
  onPrompt: InProcessOnPrompt;
  /**
   * Opt in to a REAL filesystem-backed box. When set, each `create()` mints a
   * fresh temp directory (prefixed `<workdir>-`) and the box exposes
   * `fs.read`/`fs.write` and `exec` over it; `delete()` removes the dir. Omit
   * for a pure event-only box (no `fs`/`exec` members), which is all a driver
   * or fanout loop needs.
   */
  workdir?: string;
  /**
   * Override the box `id`. A string is used verbatim; a function receives the
   * 0-based create-sequence and returns the id (e.g. machine-keyed placement
   * demos). Default `in-process-<seq>`. The id is the value `describePlacement`
   * tags, so set it when a demo's output reads on a meaningful sandbox id.
   */
  id?: string | ((seq: number) => string);
}
/**
 * Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for
 * `runAgentRounds` / `openSandboxRun`. Returns a PROPERLY-TYPED `SandboxClient`: the
 * lone `SandboxInstance` cast (object literal → `declare class`) lives inside
 * this function, so call sites stay cast-free.
 *
 * There is no box, so a per-prompt `backend` override is refused rather than dropped. A per-turn
 * `model` IS delivered, because `onPrompt` receives the verbatim options and is free to honor it.
 * Other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
 *
 * @experimental
 */
declare function inProcessSandboxClient(options: InProcessSandboxClientOptions): SandboxClient;
//#endregion
//#region src/runtime/inline-sandbox-client.d.ts
/**
 * Adapt an `ExecutorFactory` into a `SandboxClient` for `runAgentRounds`. The factory is
 * instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
 * run once on the prompt, emit the terminal result event, tear down.
 *
 * There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
 * other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
 */
declare function inlineSandboxClient(factory: ExecutorFactory<unknown>, defaults?: {
  profile?: AgentProfile;
}): SandboxClient;
//#endregion
//#region src/runtime/local-sandbox-client.d.ts
interface LocalSandboxClientOptions {
  /** Router endpoint/auth. The exact per-create profile owns model and loop behavior. */
  router: {
    baseUrl: string;
    key: string;
  };
  /** Fallback profile when `create(options)` carries none on `backend.profile`. */
  profile?: AgentProfile;
  /** Resolves profile-declared MCP secret names at child-process spawn time. */
  keys?: KeyProvider;
  /** Explicit trust decision for the exact `profile` bytes supplied here.
   * Omit to refuse local processes. A permissive policy never transfers to a
   * different per-create profile and provides no host isolation. */
  profileSecurityPolicy?: AgentProfileSecurityPolicy;
}
/** A same-host `SandboxClient` adapter with no process isolation. Local MCP is
 * refused unless the caller explicitly supplies a policy that allows it.
 *
 * There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
 * other per-prompt options (`timeoutMs`, `context`) are accepted and ignored. */
declare function localSandboxClient(opts: LocalSandboxClientOptions): SandboxClient;
//#endregion
//#region src/runtime/run-loop.d.ts
/** @stable */
interface RunAgentRoundsOptions<Task, Output, Decision> {
  driver: Driver<Task, Output, Decision>;
  /**
   * Single agent spec — every iteration uses this profile. Mutually
   * exclusive with `agentRuns`.
   */
  agentRun?: AgentRunSpec<Task>;
  /**
   * Multiple specs for heterogeneous fanout. The kernel round-robins
   * through them when the driver plans N tasks. Mutually exclusive with
   * `agentRun`.
   */
  agentRuns?: AgentRunSpec<Task>[];
  output: OutputAdapter<Output>;
  validator?: Validator<Output>;
  task: Task;
  ctx: ExecCtx;
  /** Default 10. Hard cap on total iterations across all `plan()` rounds. */
  maxIterations?: number;
  /** Default 4. In-flight worker cap within a single `plan()` batch. */
  maxConcurrency?: number;
  /**
   * Pre-allocated id for trace correlation. Default = `loop-${random}`.
   * Surfaces as `runId` on every emitted `LoopTraceEvent`.
   */
  runId?: string;
  /**
   * Clock override; default `Date.now`. Deterministic tests pass a
   * monotonic counter to stabilize iteration timing fields.
   */
  now?: () => number;
  /**
   * Override the default winner selector (highest-valid-score, ties broken
   * by earliest iteration).
   */
  selectWinner?: (iterations: Iteration<Task, Output>[]) => LoopWinner<Task, Output> | undefined;
  /**
   * Same-sandbox driver mode — a kernel→caller out-channel, not a value handed
   * in. When set, the kernel keeps each finished worker box alive across the
   * `plan()` boundary and hands it here, so a same-sandbox planner
   * (one that reuses the worker's box) can stream its move INTO the
   * worker's live box — steering from the worker's real filesystem and state,
   * not just a history summary. The kernel owns teardown: every box kept alive
   * this way is destroyed at loop end (and the callback is invoked with
   * `undefined` then as a teardown sentinel). Without it, worker boxes are torn
   * down per-iteration (default) and a same-sandbox planner has nothing to
   * reuse. Intended for single-worker (refine) loops: under fanout every box is
   * still kept for teardown, but only the last-finishing box is handed here, so
   * a planner sees an arbitrary branch's filesystem — pair it with refine.
   */
  onWorkerBox?: (box: SandboxInstance | undefined) => void;
  /**
   * Opt-in box-lineage controls. Default OFF — unset means every iteration
   * acquires a fresh box, streams once, and tears it down (today's behavior,
   * byte-identical). With `sessionContinuity` on, a refine round continues the
   * parent iteration's session on its live box; with `forkFanout` on, a fanout
   * round branches the parent's live box so the branches share a context prefix.
   * The lineage owns every box it starts or
   * forks and tears them all down at loop end — so these paths are mutually
   * exclusive with `onWorkerBox`, which claims the same box-ownership channel.
   * @experimental
   */
  lineage?: LoopLineageOptions;
}
/**
 * The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks
 * out to N sandboxes (bounded concurrency), parses + validates each output, and folds
 * the round's results through `driver.decide` — fanout → validate → vote/select →
 * refine, repeated until the driver says stop. One call spans many agent sessions.
 *
 * Not to be confused with `runToolLoop` / `streamToolLoop` (`/tool-loop`): those
 * run ONE chat turn against ONE model, dispatching the tool calls that turn emits and
 * folding the results back in until the model stops calling tools. No sandboxes, no
 * rounds, no winner selection.
 *
 * @stable
 */
declare function runAgentRounds<Task, Output, Decision>(options: RunAgentRoundsOptions<Task, Output, Decision>): Promise<LoopResult<Task, Output, Decision>>;
/**
 * The kernel's winner argmax — best-valid-score, ties broken by earliest index,
 * falling back to the best-scoring non-errored output when none is valid. Exported
 * so the `runProgram` tree executor selects across merged sub-loop iterations with
 * the SAME semantics the kernel uses at a single loop's finalize (one selector, not
 * a forked copy).
 */
declare function defaultSelectWinner<Task, Output>(iterations: Iteration<Task, Output>[]): LoopWinner<Task, Output> | undefined;
/**
 * Decision values the kernel treats as terminal. Every other value returned by
 * `decide` continues the loop. Type a driver's `decide` return as
 * `'your-word' | TerminalDecision` so caller vocabulary and kernel keywords
 * stay visibly distinct.
 *
 * @stable
 */
declare const TERMINAL_DECISIONS: readonly ["stop", "pick-winner", "fail", "done"];
/** One of the kernel's terminal decision values. @stable */
type TerminalDecision = (typeof TERMINAL_DECISIONS)[number];
/** True when the kernel stops the loop for this decision value. @stable */
declare function isTerminalDecision(decision: unknown): decision is TerminalDecision;
//#endregion
//#region src/runtime/loop-dispatch.d.ts
/** runAgentRounds options minus the `ctx` (loopDispatch builds the ctx). */
type LoopOptionsForDispatch<Task, Output, Decision> = Omit<RunAgentRoundsOptions<Task, Output, Decision>, 'ctx'>;
interface LoopDispatchOptions<Task, Output, Decision, TScenario extends Scenario, TArtifact> {
  /** Sandbox client used for every cell's `runAgentRounds`. Supplied once. */
  sandboxClient: SandboxClient;
  /**
   * Per-prompt sandbox SDK options for every cell, forwarded verbatim into EVERY `streamPrompt`
   * of every iteration the dispatch runs. The kernel owns `sessionId` and `signal`: both are
   * removed from the supplied value and applied last. A value that is present but is not an
   * object is a `ValidationError`, raised before any box is created.
   *
   * Typical use: `backend.model` credentials (`authMode` / `authFiles`) so every cell runs on a
   * caller-supplied subscription credential, `timeoutMs`, and `context`.
   */
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>;
  /** Build the per-cell runAgentRounds options from the scenario (+ profile, when
   *  used with `runProfileMatrix`). */
  toLoopOptions: (scenario: TScenario, profile: AgentProfile$1) => LoopOptionsForDispatch<Task, Output, Decision>;
  /** Map the finished loop to the artifact the judges score. Default:
   *  `result.winner?.output`. A loop with no winner yields `undefined` (judges
   *  skip the cell) — but the loop's token usage is STILL reported, so the
   *  integrity guard sees real activity. */
  toArtifact?: (result: LoopResult<Task, Output, Decision>) => TArtifact;
  /** Forward `loop.*` trace events into the campaign's scoped trace so loop
   *  spans correlate with the cell. Default true. */
  forwardTrace?: boolean;
  /** Cost-meter source label for the loop's spend. Default `'loop'`. */
  costSource?: string;
  /** Provider- or executor-enforced maximum for this whole cell dispatch.
   * Required by agent-eval before execution when the campaign is cost-capped. */
  maximumCharge?: MaximumCharge | ((scenario: TScenario, profile: AgentProfile$1) => MaximumCharge | undefined);
  /** Resolve the model actually served from the completed loop. */
  resolveCostModel?: (result: LoopResult<Task, Output, Decision>, scenario: TScenario, profile: AgentProfile$1) => string | undefined;
}
/** `supervise` options minus Eval-owned cancellation. */
type SuperviseOptionsForDispatch = Omit<SuperviseOptions, 'signal'>;
/**
 * Adapt a recursive Runtime `supervise()` tree to one Agent Eval profile-matrix cell.
 *
 * The adapter starts Eval's paid-call record before the tree starts. Runtime remains the sole
 * owner of recursive execution, budgets, and the journal; Eval remains the sole owner of the
 * paid-call admission and resulting receipt.
 */
interface SuperviseDispatchOptions<TScenario extends Scenario, TArtifact> {
  /** Build the task passed to the root supervisor for this profile/scenario cell. */
  toTask: (scenario: TScenario, profile: AgentProfile$1) => unknown;
  /** Build the Runtime-owned recursive-run options for this profile/scenario cell. */
  toSuperviseOptions: (scenario: TScenario, profile: AgentProfile$1) => SuperviseOptionsForDispatch;
  /** Map the terminal tree result to the artifact judges score. Default: winner output. */
  toArtifact?: (result: SupervisedResult<unknown>) => TArtifact;
  /** Cost-meter source label. Default `'supervise'`. */
  costSource?: string;
  /** Provider- or executor-enforced maximum for the complete supervised tree. */
  maximumCharge?: MaximumCharge | ((scenario: TScenario, profile: AgentProfile$1) => MaximumCharge | undefined);
}
/** Run one recursive supervised tree inside Eval's pre-execution paid-call lifecycle. */
declare function superviseDispatch<TScenario extends Scenario, TArtifact>(opts: SuperviseDispatchOptions<TScenario, TArtifact>): ProfileDispatchFn<TScenario, TArtifact>;
/** Options for adapting plain agent-eval campaign scenarios into Runtime cells. */
interface LoopCampaignDispatchOptions<Task, Output, Decision, TScenario extends Scenario, TArtifact> {
  /** Sandbox client used for every campaign cell's `runAgentRounds`. */
  sandboxClient: SandboxClient;
  /**
   * Per-prompt sandbox SDK options for every cell, forwarded verbatim into EVERY `streamPrompt`
   * of every iteration the dispatch runs. The kernel owns `sessionId` and `signal`: both are
   * removed from the supplied value and applied last. A value that is present but is not an
   * object is a `ValidationError`, raised before any box is created.
   */
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>;
  /** Build the per-cell runAgentRounds options from the campaign scenario. */
  toLoopOptions: (scenario: TScenario) => LoopOptionsForDispatch<Task, Output, Decision>;
  /** Map the finished loop to the artifact the campaign judges score. */
  toArtifact?: (result: LoopResult<Task, Output, Decision>) => TArtifact;
  /** Forward `loop.*` trace events into the campaign's scoped trace. Default true. */
  forwardTrace?: boolean;
  /** Cost-meter source label for the loop's spend. Default `'loop'`. */
  costSource?: string;
  /** Provider- or executor-enforced maximum for this whole cell dispatch. */
  maximumCharge?: MaximumCharge | ((scenario: TScenario) => MaximumCharge | undefined);
  /** Resolve the model actually served from the completed loop. */
  resolveCostModel?: (result: LoopResult<Task, Output, Decision>, scenario: TScenario) => string | undefined;
}
/**
 * Adapter for plain `runCampaign` scenarios. This is the Runtime-side pair for
 * agent-eval fixture scenarios: load fixtures in `agent-eval/campaign`, build
 * the Runtime cell here, and keep paid-call admission, receipts, and traces
 * automatic.
 */
declare function loopCampaignDispatch<Task, Output, Decision, TScenario extends Scenario, TArtifact>(opts: LoopCampaignDispatchOptions<Task, Output, Decision, TScenario, TArtifact>): DispatchFn<TScenario, TArtifact>;
/**
 * Adapter for `runProfileMatrix` (profile is an axis). Returns a
 * `ProfileDispatchFn` that runs `runAgentRounds` per (profile, scenario) cell
 * inside Eval's paid-call lifecycle.
 */
declare function loopDispatch<Task, Output, Decision, TScenario extends Scenario, TArtifact>(opts: LoopDispatchOptions<Task, Output, Decision, TScenario, TArtifact>): ProfileDispatchFn<TScenario, TArtifact>;
//#endregion
//#region src/runtime/strategy.d.ts
interface AgenticTask {
  readonly id: string;
  readonly userPrompt: string;
  /** Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it. */
  readonly meta?: Record<string, unknown>;
}
interface ArtifactHandle {
  readonly id: string;
  readonly surface: string;
  /** Opaque per-artifact context the surface stashes (EOPS: the seeded gym server + db id). */
  readonly ctx?: unknown;
}
interface AgenticTool {
  readonly type: 'function';
  readonly function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}
interface SurfaceScore {
  passes: number;
  total: number;
  /** Checks excluded as malformed (data defect, not the agent). `total === 0` ⇒ unscoreable. */
  errored: number;
}
/** A stateful, checkable environment an agent operates over with tools. Open behind one interface. */
interface AgenticSurface {
  readonly name: string;
  open(task: AgenticTask): Promise<ArtifactHandle>;
  tools(task: AgenticTask, handle: ArtifactHandle): Promise<AgenticTool[]>;
  call(handle: ArtifactHandle, name: string, args: Record<string, unknown>): Promise<string>;
  score(task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore>;
  close(handle: ArtifactHandle): Promise<void>;
}
interface AgenticOptions {
  routerBaseUrl: string;
  routerKey: string;
  /** Exact worker identity. Model and standing instructions are read only from this profile. */
  workerProfile: AgentProfile;
  /** Optional completion transport (see `RouterConfig.complete`): when set, BOTH legs of an
   *  offline run use it instead of `fetch`-ing the router — the worker's tool loop (threaded into
   *  its `routerToolLoop` cfg) AND the analyst's critic (its `ChatClient` is bound to this same
   *  transport). One injected responder serves both, as a localhost mock endpoint would. Absent ⇒
   *  the live router fetch path (the default). */
  complete?: (body: Record<string, unknown>) => Promise<unknown>;
  /** Exact critic identity. Omitted means the exact worker profile also runs the critic. */
  analystProfile?: AgentProfile;
  /** Across-run learning: when set, the analyst's observe() pass appends trace-derived
   *  facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
   *  because unconditional priming can pollute context on some domains. */
  corpus?: Corpus;
  /** Tags written onto learned facts (and used by the caller's priming query). */
  corpusTags?: string[];
  /** In-context learning: when set, query `corpus` before each depth shot and inject
   *  the top trace-derived facts as guidance for the active run. No corpus means no read-back. */
  corpusReadback?: CorpusReadbackOptions;
}
interface CorpusReadbackOptions {
  /** Minimum confidence for a fact to be injected. Default 0.7. */
  minConfidence?: number;
  /** Extra tags a fact must carry, in addition to `corpusTags`. */
  tags?: ReadonlyArray<string>;
  /** Max facts injected per shot. Default 3. */
  maxFacts?: number;
  /** Default false: only facts tagged `audience:agent` are injected into the worker. */
  includeOperatorFacts?: boolean;
}
/** One provider-neutral conversation record carried between strategy shots. */
type StrategyMessage = Record<string, unknown>;
/** Measured result of one strategy shot. */
interface StrategyShotResult {
  messages: StrategyMessage[];
  score: number;
  passes: number;
  total: number;
  completions: number;
  toolErrors: number;
}
interface AgenticRunResult {
  /** The strategy name (built-in 'depth'/'breadth' or a custom strategy's name). */
  mode: string;
  score: number;
  resolved: boolean;
  completions: number;
  /** DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout. */
  progression: number[];
  shots: number;
  /** Observed billed subtotal. `usdKnown:false` means it is incomplete, never a measured zero. */
  usd: number;
  usdKnown: boolean;
  ms: number;
  tokens: {
    input: number;
    output: number;
  };
  tokensKnown: boolean;
}
/** DEPTH: one persistent artifact, carried across analyst-steered shots. */
declare function depthStrategy(surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, cfg: {
  maxShots: number;
}): Agent<unknown, Outcome<unknown>>;
/** BREADTH: K independent rollouts (each own artifact), verifier picks the best. */
declare function breadthStrategy(_surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, cfg: {
  width: number;
}): Agent<unknown, Outcome<unknown>>;
/**
 * A Strategy is HOW you spend the compute budget to beat the Environment's check — it
 * builds the driver `Agent` the Supervisor runs. This is the OPEN extension point: a dev
 * authors their own by implementing `driver()` to return an Agent whose `act()` spawns
 * shots/analysts via `scope.spawn` / `scope.next` / `scope.send`. The two built-ins are
 * the reference implementations to copy:
 *   sample — K INDEPENDENT attempts, keep the best-verifying (best-of-N / resample).
 *   refine — attempt → observe() reads the trace → steer the next → repeat (iterate).
 * (A multi-agent "team" is just a Strategy whose driver spawns several different agents.)
 */
declare const strategyResult: unique symbol;
interface Strategy<Result extends StrategyResult = StrategyResult> {
  readonly name: string;
  /** @internal Associates a strategy with its typed result without adding a runtime field. */
  readonly [strategyResult]?: Result;
  driver(surface: AgenticSurface, task: AgenticTask, opts: AgenticOptions, budget: number): Agent<unknown, Outcome<unknown>>;
}
/** Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample). */
declare const sample: Strategy;
/** Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage). */
declare const refine: Strategy;
interface ShotSpec {
  /** present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart). */
  handle?: ArtifactHandle;
  messages?: StrategyMessage[];
  steer?: string;
  /** Exact profile for this shot. Omitted means `AgenticOptions.workerProfile`. */
  profile?: AgentProfile;
  /** Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
   *  the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all. */
  tools?: string[];
}
interface StrategyResult {
  score: number;
  resolved: boolean;
  completions: number;
  progression: number[];
  shots: number;
}
/** Artifact lifecycle a strategy may manage itself — open/close ONLY. Raw `call`/`score`
 *  are withheld: scores reach the body solely through `shot()`'s StrategyShotResult (the
 *  harness-verified channel), so a body cannot peek the check or fabricate around it. */
interface StrategyArtifacts {
  readonly name: string;
  open(task: AgenticTask): Promise<ArtifactHandle>;
  close(handle: ArtifactHandle): Promise<void>;
}
/** What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. */
interface StrategyCtx {
  /** Open/close artifacts the body manages itself (e.g. one persistent handle for depth). */
  readonly surface: StrategyArtifacts;
  readonly task: AgenticTask;
  readonly opts: AgenticOptions;
  readonly budget: number;
  readonly scope: Scope<Outcome<unknown>>;
  /** Run ONE worker shot; its harness-scored result, or null if it went down. */
  shot(spec?: ShotSpec): Promise<StrategyShotResult | null>;
  /** The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down. */
  critique(messages: StrategyMessage[]): Promise<string | null>;
  /** The RAW analyst channel: the firewalled critic answers `instruction` over the
   *  trajectory verbatim — no findings extraction, so verdict-shaped formats
   *  (CONTINUE/STOP decisions, calibrated predictions) survive. Same firewall:
   *  trajectory in, never scores. Null when the analyst went down. */
  consult(messages: StrategyMessage[], instruction: string): Promise<string | null>;
  /** The tools THIS artifact's task actually offers (names + descriptions only — never
   *  the implementations). Tool sets vary per task on heterogeneous domains; a strategy
   *  that restricts shots MUST select from this list, never from hardcoded names. */
  listTools(handle: ArtifactHandle): Promise<Array<{
    name: string;
    description?: string;
  }>>;
}
/** Author a Strategy from the composable steps — the open, compact way. */
declare function defineStrategy<Result extends StrategyResult>(name: string, run: (ctx: StrategyCtx) => Promise<Result>): Strategy<Result>;
/** A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 *  fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 *  — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 *  checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 *  optimizations" path: a new technique, compact, with zero Supervisor ceremony. */
declare const adaptiveRefine: Strategy<{
  score: number;
  resolved: boolean;
  completions: number;
  progression: number[];
  shots: number;
}>;
/** The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 *  then refine the best-verifying line with the remaining budget. Sample's basin escape +
 *  refine's accumulation — the third built-in, authored from the public steps. */
declare const sampleThenRefine: Strategy<{
  score: number;
  resolved: boolean;
  completions: number;
  progression: number[];
  shots: number;
}>;
interface RunAgenticOptions<Result extends StrategyResult = StrategyResult> extends AgenticOptions {
  surface: AgenticSurface;
  task: AgenticTask;
  /** Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
   *  The seam online watchdogs/route-auditors subscribe to. */
  hooks?: RuntimeHooks;
  /** A Strategy (the open way) — author/pass your own. Overrides `mode` when present. */
  strategy?: Strategy<Result>;
  /** Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'. */
  mode?: 'depth' | 'breadth';
  /** budget: refine→max shots; sample→rollout width. */
  budget: number;
  rootBudget?: Budget;
  /** Forwarded to `SupervisorOpts.teardownConfirmMs`: how long settlement keeps retrying a child
   *  teardown the executor has not confirmed. `0` makes one attempt only. Default: 300000. */
  teardownConfirmMs?: number;
}
/** Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope. */
declare function runAgentic<Result extends StrategyResult = StrategyResult>(opts: RunAgenticOptions<Result>): Promise<AgenticRunResult & Result>;
//#endregion
//#region src/runtime/run-benchmark.d.ts
/** A checkable task domain — implement these 5 hooks and the suite does the rest. The
 *  same seam as `AgenticSurface`; `Environment` is the RL/gym-standard name for it. */
type Environment = AgenticSurface;
interface BenchmarkConfig {
  /** The task domain (5 hooks). */
  environment: Environment;
  /** The tasks to score across. */
  tasks: AgenticTask[];
  /** The worker: model + router + (optional) the critic's instruction (the steerer knob). */
  worker: AgenticOptions;
  /** Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
   *  Default: [sample, refine]. */
  strategies?: Strategy[];
  /** Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3. */
  budget?: number;
  /** Tasks scored in parallel. Default 3. */
  concurrency?: number;
  /** Progress hook — fires as each task settles (the live-monitoring seam: append to a
   *  progress file, render a tree, stream to a dashboard). `done` counts settled tasks. */
  onTask?: (row: BenchmarkTaskRow, done: number, total: number) => void;
  /** Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
   *  here live (the watchdog/route-auditor seam, passed through to `runAgentic`). */
  hooks?: RuntimeHooks;
  /**
   * Model availability check before tasks start.
   *
   * By default, live router workers send one one-token request per unique worker and analyst
   * model. Injected `worker.complete` transports skip the check. Pass `false` to disable it or a
   * callback to check each unique model through a custom transport.
   */
  modelPreflight?: false | ((model: string, worker: Readonly<AgenticOptions>, signal: AbortSignal) => Promise<void>);
  /** Maximum time for each model availability check. Default 30 seconds. */
  modelPreflightTimeoutMs?: number;
}
interface BenchmarkLift {
  /** Mean of paired deltas (refine − sample). */
  mean: number;
  low: number;
  high: number;
  n: number;
}
/** One strategy's outcome on one task — the per-task cell an optimizer consumes. */
interface BenchmarkCell {
  score: number;
  resolved: boolean;
  /** The progress curve (refine: score per shot; sample: best-so-far per rollout). */
  progression: number[];
  usd: number;
  usdKnown: boolean;
  ms: number;
  tokens: {
    input: number;
    output: number;
  };
  tokensKnown: boolean;
}
interface BenchmarkTaskRow {
  taskId: string;
  /** Per-strategy cells; absent when the task errored before completing all strategies. */
  cells?: Record<string, BenchmarkCell>;
  /** Per-strategy failures on this task: the strategy competed, threw, and scored an
   *  honest zero — it loses, it does not poison the row. The message is kept so a later
   *  generation's author can see WHY a candidate died. */
  errors?: Record<string, string>;
  /** Why the task was excluded (infra/setup failure) — never silently dropped. */
  error?: string;
}
interface BenchmarkStrategySummary {
  /** Mean verifier score (0..1). */
  score: number;
  /** Fraction of tasks fully resolved. */
  resolved: number;
  /** Mean cost vector per task. */
  usd: number;
  /** Fraction of task cells whose billed-dollar total was complete. */
  usdKnownRate: number;
  ms: number;
}
/** Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines. */
interface BenchmarkReport {
  n: number;
  excluded: number;
  /** Per-strategy means (keyed by strategy.name). */
  perStrategy: Record<string, BenchmarkStrategySummary>;
  /** The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
   *  strategy-author, an operator) consumes. Includes errored tasks with the reason. */
  perTask: BenchmarkTaskRow[];
  /** The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
   *  a strategy that ties on score at half the cost WINS and a scalar would hide it. */
  pareto: string[];
  /** The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample. */
  refineVsSample?: BenchmarkLift;
}
/** Run the requested strategies over the tasks, scored by the Environment's own check.
 *  Resilient: a task whose rollouts fail (transient infra) is excluded from the stats but
 *  reported in `perTask` with the error — never silently dropped. */
declare function runBenchmark(cfg: BenchmarkConfig): Promise<BenchmarkReport>;
/** Pretty-print a report — the "free optimization" verdict, with the cost vector. */
declare function printBenchmarkReport(report: BenchmarkReport): void;
//#endregion
//#region src/runtime/mcp-environment.d.ts
/** Where a handle's MCP server lives; headers carry per-artifact scoping. */
interface McpEndpoint {
  url: string;
  headers?: Record<string, string>;
}
interface McpEnvironmentOptions {
  name: string;
  /** Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it. */
  open(task: AgenticTask): Promise<{
    handle: ArtifactHandle;
    endpoint: McpEndpoint;
  }>;
  /** The deployable check over the artifact's current state. */
  score(task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore>;
  /** Teardown (delete the seeded artifact). Optional — omit for stateless servers. */
  close?(handle: ArtifactHandle): Promise<void>;
  /** Restrict/order the server's tools per task (e.g. the task's selected_tools). Default: all. */
  selectTools?(task: AgenticTask, all: AgenticTool[]): AgenticTool[];
  /** Cap on a tool result's text fed back to the worker. Default 1500 chars. */
  maxResultChars?: number;
}
/** Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema.
 *  Shared with the same-host stdio client (`materializeLocalMcp`) — one coercion
 *  rule for every MCP tool a worker sees, regardless of transport. */
declare function sanitizeMcpToolSchema(s: unknown): Record<string, unknown>;
/** Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks. */
declare function createMcpEnvironment(opts: McpEnvironmentOptions): Environment;
//#endregion
//#region src/runtime/observation-registry.d.ts
/** Adapt any Eval analyst registry, including recursive engines, to observation and harvesting. */
declare function observationFromRegistry(registry: Pick<AnalystRegistry, 'run'>, options: {
  inputs: AnalystRunInputs$1 | ((input: ObserveInput) => AnalystRunInputs$1 | Promise<AnalystRunInputs$1>);
  /** The caller identifies the evidence admitted for this investigation. */
  proposalOrigin: ProposalFinding['proposal_origin'];
  runOptions?: RegistryRunOpts$1;
  /** Retain the complete registry result, including unsuccessful analysts, in caller-owned storage. */
  record?: (result: AnalystRunResult$1, input: ObserveInput) => void | Promise<void>;
}): ObservationAnalysis;
//#endregion
//#region src/runtime/personify/analyst.d.ts
/** Reject analyst findings derived from evaluation scores instead of execution traces. */
declare const assertTraceDerivedFindings: AssertTraceDerivedFindings;
/**
 * The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far.
 * The combinator supplies the analyst's task projection (how to frame the drained settlements as
 * the analyst's input) — the analyst's `act` reads the trace and returns its raw findings; the
 * firewall is enforced afterwards by `createScopeAnalyst`, not by the analyst itself.
 */
interface CreateScopeAnalystOptions<D> {
  /** The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
   *  (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
   *  the RAW findings; this module asserts the firewall on them before returning. */
  readonly analyst: Agent<unknown, ReadonlyArray<AnalystFinding>>;
  /** Build the analyst agent's task from the analyze input (the root-task framing + the children
   *  drained so far). Pure projection — the analyst interprets it, this never reads it. */
  buildTask(input: ScopeAnalyzeInput<D>): unknown;
  /** The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
   *  closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings. */
  readonly budget: Budget;
  /** Trace/journal label for the spawned analyst child. Default `'analyst'`. */
  readonly label?: string;
}
/**
 * Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is
 * metered by the conserved pool), drains its single settlement, and enforces the trace-derived
 * firewall before returning. The `scope` is the SAME scope the combinator is draining its children
 * from — the analyst is spawned as a sibling and its result is read off `scope.next()` in cursor
 * order, replay-safe like any other child.
 *
 * Fail loud (no silent empty findings):
 *  - the pool refuses the analyst spawn → `AnalystError` (the steer would otherwise run on nothing)
 *  - the analyst settles `down` → `AnalystError` (a broken capture path, not a verdict)
 *  - the analyst returns a non-array → `PlannerError`
 *  - any finding cites judge-derived metric evidence → `PlannerError` via the firewall
 */
declare function createScopeAnalyst<D>(scope: Scope<Outcome<D>>, options: CreateScopeAnalystOptions<D>): ScopeAnalyst<D>;
/**
 * Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
 * `runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
 * settlements — so the CALLER owns the projection from the combinator's drained children to the
 * registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
 * bridge; it only runs the projected inputs and firewalls the merged findings.
 */
interface RegistryAnalyzeProjection {
  readonly runId: string;
  readonly inputs: AnalystRunInputs;
  /** Optional `run` opts (e.g. `priorFindings`, `chainFindings`) forwarded verbatim to the registry. */
  readonly opts?: Parameters<AnalystRegistryLike['run']>[2];
}
/**
 * A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges
 * N analyst KINDS into one `AnalystRunResult.findings`; `analyze` runs it over the caller-projected
 * `{ runId, inputs }` and pipes the merged findings through the SAME `assertTraceDerivedFindings`
 * firewall `createScopeAnalyst` uses (single-sourced selector≠judge). Distinct from `panel()`
 * (judges-vs-one-artifact) — this is analysts-over-a-trace, the diagnosis side of the wire.
 *
 * Fail loud: a registry that throws propagates; a judge-derived finding aborts via the firewall.
 * The projection is the caller's (`buildInputs`) — if the scope settlements do not cleanly map to
 * the registry's `AnalystRunInputs`, that is a caller-side contract gap, surfaced there, not papered
 * over with a fabricated input here.
 */
declare function registryScopeAnalyst<D>(registry: AnalystRegistryLike, buildInputs: (input: ScopeAnalyzeInput<D>) => RegistryAnalyzeProjection): ScopeAnalyst<D>;
/**
 * Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any
 * future steer). One place enforces the firewall: `findings` is asserted trace-derived before it is
 * surfaced, and `lastValidScore` is provided for OBSERVABILITY only — a combinator that steers off
 * it re-introduces selector = judge, the coupling the architecture forbids.
 *
 * `findings` is re-asserted here even when it came from `createScopeAnalyst` (which already asserted
 * it): the assertion is cheap and idempotent, and a `SteerContext` may be built from findings that
 * arrived by another path (a caller-supplied diagnosis). Belt-and-suspenders on the one coupling
 * that must never leak.
 */
declare function buildSteerContext<D>(findings: ReadonlyArray<AnalystFinding>, settledSoFar: ReadonlyArray<Settled<Outcome<D>>>): SteerContext<D>;
//#endregion
//#region src/runtime/personify/combinators.d.ts
/**
 * The single content-free valid-only winner selector. Among the gated-VALID children only
 * (`verdict.valid === true`), pick by `strategy` — best score / smallest delivered artifact /
 * earliest — ties broken by earliest index; returns `undefined` when NONE is valid (an ungated
 * output can never win — the deliverable gate is the point). `sizeOf` (for `'smallest-artifact'`)
 * reads the child's settled deliverable — the raw value a leaf settles, or the unwrapped `Outcome<D>`
 * a delegate path produces; a domain passes e.g. patch diff-lines. This is the de-duplicated home of
 * the selection logic previously copied per role.
 */
declare function selectValidWinner<D>(opts?: {
  strategy?: WinnerStrategy;
  sizeOf?: (deliverable: D) => number;
}): FanoutWinnerSelector<D>;
/**
 * `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the
 * next stage's task. The first stage that ends `blocked` (a child that went down, a child the
 * pool would not admit, or a stage whose `collect` chose to block) short-circuits — its blockers
 * ARE the pipeline's blockers, never coerced past a failed stage. The terminal stage's `done`
 * deliverable is the pipeline's deliverable.
 *
 * @stable
 */
declare function pipeline<Task, D>(stages: ReadonlyArray<PipelineStage<Task, unknown, unknown>>): CombinatorShape<Task, D>;
/**
 * `fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved
 * pool's fail-closed admission), drain via `scope.next()`, then either synthesize over the
 * gathered settlements (one SEPARATE synthesis child) or return the best-valid child via the
 * single-sourced selector. A round that admitted zero children, or whose synthesis child could
 * not be admitted, is a concrete blocker.
 *
 * `opts.width` swaps the single round for `rollingDispatch`: at most `width` items live at once,
 * refilled the instant one settles. Selection, blockers, and the conserved pool are unchanged —
 * the refill behavior lives in the existing combinator rather than in a rival primitive.
 *
 * @stable
 */
declare function fanout<Task, Item, D>(items: ReadonlyArray<Item>, opts: FanoutOptions<Item, D>): CombinatorShape<Task, D>;
/**
 * `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into
 * the running state; `until` (reading the round's trace findings, NOT a fresh raw verdict) is
 * the deployable stop. The conserved pool IS the loop bound: once `spawn` fails closed the loop
 * stops. A loop that exhausted the pool without `until` ever satisfying is a concrete blocker.
 *
 * When `ctx.analyst` is set, each round runs it over the children settled so far and steers
 * `until` on the resulting trace-derived findings (the analyst spawns into THIS scope, so its
 * compute is conserved-pooled — equal-k holds by construction). Absent an analyst the findings
 * argument is the empty array — never a fabricated finding (fail-loud honesty over a silent default).
 *
 * @stable
 */
declare function loopUntil<Task, State, D>(seed: State, spec: LoopUntilSpec<Task, State, D>): CombinatorShape<Task, D>;
/**
 * `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements,
 * and fold them into a panel verdict via the pure WRITE-ONLY `merge` (a judge's output never
 * reaches another judge's task; the merge never spawns or re-ranks). A `down` judge carries no
 * verdict and is excluded from the merge denominator. A panel that admitted no judge is a
 * concrete blocker before `merge` is consulted.
 *
 * @stable
 */
declare function panel<Task, Artifact, D>(spec: PanelSpec<Artifact, D>): CombinatorShape<Task, D>;
/**
 * `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades
 * it; only a `valid` verifier verdict ships. Any other outcome (implement down, verifier down,
 * verifier verdict absent or not `valid`) is a concrete blocker carrying the failure verbatim —
 * never a coerced "done". The implement child does not grade itself.
 *
 * @stable
 */
declare function verify<Task, Candidate, D>(spec: VerifySpec<Task, Candidate, D>): CombinatorShape<Task, D>;
/**
 * `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS
 * to each `scope.next()`: on every settled child it consults `spec.gate.decide` and, when the gate
 * returns `widen`, spawns AT MOST ONE more child toward the chosen lineage under the remaining
 * conserved pool. `promising` is derived from the round's trace findings (the analyst seam),
 * never a child's raw `verdict` — and the default gate (`flatWidenGate`) never widens, so the R2
 * firewall stays dormant. Terminal selection is `spec.synthesize` over every settled lineage.
 *
 * When `ctx.analyst` is set, `decide` is consulted with that round's trace-derived findings;
 * absent an analyst the findings argument is the empty array a flat gate ignores. The analyst
 * spawns into THIS scope (conserved-pooled, so equal-k holds). Streaming caveat: a wired analyst
 * drains its own child off the SHARED cursor by id-match, so on a NON-flat gate (which spawns
 * widen children that are live concurrently) the analyst can consume a sibling's settlement before
 * the widen loop sees it. The shipped default (`flatWidenGate`) never widens, so no widen child is
 * ever live when the analyst runs and the wire is exact; a non-flat gate must drive the analyst on
 * a scope whose siblings are quiesced, or read findings without the shared-cursor drain.
 *
 * @stable
 */
declare function widen<Task, Seed, D>(spec: WidenSpec<Seed, D>): CombinatorShape<Task, D>;
/**
 * The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision
 * dormant. A gate run passes this explicitly; a test asserts the default is flat.
 */
declare function flatWidenGate<D>(): ScopeWidenGate<D>;
//#endregion
//#region src/runtime/personify/corpus.d.ts
/**
 * In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an
 * identical re-append, and returns a typed `{ succeeded: false }` on a conflicting re-append under
 * the same `id` (never overwrites). `query` routes through the single-sourced `applyFilter`.
 */
declare class InMemoryCorpus implements Corpus {
  private readonly byId;
  append(record: CorpusRecord): Promise<{
    succeeded: true;
  } | {
    succeeded: false;
    error: string;
  }>;
  query(filter: CorpusFilter): Promise<ReadonlyArray<CorpusRecord>>;
}
/**
 * JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole
 * file, validating every line (a malformed line fails loud — a corrupted corpus must never read
 * back silently) and folding by `id`: a later identical line dedups, a later conflicting line
 * under the same `id` is a corruption (fail loud). `append` first replays to enforce the same
 * idempotence/conflict contract as the in-mem impl, then fsyncs the new line so a crash between
 * writes never loses an acknowledged fact. Reads and appends over the shared append-only
 * spine (`durable/jsonl-file`) — the same one the spawn journal uses — but the interface stays
 * separate (a learned fact is not a replay record).
 */
declare class FileCorpus implements Corpus {
  private readonly path;
  constructor(path: string);
  append(record: CorpusRecord): Promise<{
    succeeded: true;
  } | {
    succeeded: false;
    error: string;
  }>;
  query(filter: CorpusFilter): Promise<ReadonlyArray<CorpusRecord>>;
  private load;
  private appendLine;
}
/**
 * The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts
 * (most-confident first, capped by `maxLines`) into instruction lines, and returns a FRESH
 * `AgentProfile` with them merged in — never mutates the input profile. Default `target: 'prompt'`
 * appends the lines to `prompt.instructions[]` (the additive append-line seam); `target:
 * 'resources'` folds them into the single-blob `resources.instructions` string (preserving any
 * existing blob, but failing loud on a non-string existing blob — a `resources.instructions` that
 * was already an `AgentProfileResourceRef` cannot be string-appended without dropping it).
 *
 * An empty query result returns a fresh COPY of the profile with no instruction change (a valid
 * "nothing learned yet" read, not an error).
 */
declare function renderCorpusToInstructions(opts: RenderCorpusToInstructionsOptions): Promise<AgentProfile>;
//#endregion
//#region src/runtime/personify/persona.d.ts
/**
 * Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with
 * neither a pre-built registry nor a seam bag cannot resolve its built-in runtimes, so it is
 * unrunnable — refuse it at definition time, not at the first spawn. Pure; no I/O.
 *
 * @stable
 */
declare function definePersona<D = unknown>(input: DefinePersonaInput<D>): Persona<D>;
/**
 * Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape
 * (a factory verbatim, or a registered name through `builtinShapes`), applies it to a
 * `ShapeContext`, and runs the resulting root `Agent` to a typed `SupervisedResult<Outcome>`.
 * Fail loud on an unknown shape name or an unresolvable persona registry — never a silent
 * default-shape fallback.
 *
 * @stable
 */
declare function runPersonified<Task, D>(options: RunPersonifiedOptions<Task, D>): Promise<SupervisedResult<Outcome<D>>>;
//#endregion
//#region src/runtime/personify/registry.d.ts
/**
 * Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
 * caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.
 */
declare function createShapeRegistry(): ShapeRegistry;
/** The default registry `runPersonified` resolves a shape name against. Empty by construction —
 *  a caller registers its own composed shapes; the engine ships no domain shape. */
declare const builtinShapes: ShapeRegistry;
/** Register a composed shape on the default `builtinShapes` registry — the one-call extension
 *  point a caller invokes so its shape is resolvable by name with zero edits to the engine. */
declare function registerShape<Task, D>(name: string, factory: LoopShape<Task, D>): void;
//#endregion
//#region src/runtime/personify/trajectory.d.ts
/**
 * Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the
 * journal for structure + spend and, when `withOutputs`, the blob store for each `done`
 * node's artifact. Fail loud on a tree that was never journaled, a settle/cancel for an
 * un-spawned node (a corrupted log), or — under `withOutputs` — a `done` node whose blob the
 * store cannot rehydrate (a silent gap would mis-cost or mis-evidence the tree).
 */
declare function trajectoryReport(journal: SpawnJournal, blobs: ResultBlobStore, root: NodeId, options?: TrajectoryReportOptions): Promise<TrajectoryReport>;
/**
 * Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration
 * count. Compares each arm's root-rolled-up `total` on the two conserved channels: an arm is
 * within-tolerance when the per-channel spread (max − min across arms) over the median is
 * `≤ tolerance`. Pure over the reports — no I/O. Fails loud on an empty arm list (nothing to
 * compare) so a vacuous "equal" is never returned.
 *
 * The token channel uses `chargedTokens`, the same unit the conserved pool spends, so the cross-run
 * check and the within-run pool cannot disagree about what an arm cost. Charging the rolled-up
 * prompt total instead would rate an arm by how often it re-read a cached prefix: two arms given
 * identical work would read as unequal compute whenever their cache hit rates differed.
 */
declare function equalKOnCost(arms: ReadonlyArray<EqualKArm>, options?: EqualKOnCostOptions): EqualKVerdict;
//#endregion
//#region src/runtime/supervise/model-policy.d.ts
/**
 * Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a
 * member of `allowed`. No-op when `allowed` is unset (the unrestricted default) or when
 * `model` is undefined (nothing was configured to check).
 */
declare function assertModelAllowed(model: string | undefined, allowed: readonly string[] | undefined): void;
/** Check every canonical model-bearing field in a complete profile, including the models a
 * backend may select for cheap work, named subagents, or modes.
 *
 * Every compared value is a bare model id. The composed `harness/provider/model` wire id
 * (`profileBridgeWireModel`) is neither built nor compared here, so this admits any route that
 * declares an allowed id, and a qualified entry in `allowed` matches nothing. Route pinning
 * belongs to `SuperviseOptions.authorizeSpawn`. */
declare function assertProfileModelsAllowed(profile: AgentProfile, allowed: readonly string[] | undefined): void;
//#endregion
//#region src/runtime/profile-chat-client.d.ts
/** Profile-exact adapter for packages that consume agent-eval's ChatClient contract.
 * Every call still enters Runtime through createExecutor -> streamAgentTurn, and every
 * behavioral field is checked against the exact AgentProfile before any transport runs. */
declare function profileChatClient(args: {
  profile: AgentProfile;
  executor: ExecutorConfig;
  context: string;
}): ChatClient;
/** Profile-exact adapter for agent-eval's external optimizer callback.
 * Eval validates and freezes the provider-neutral request; Runtime owns the exact
 * AgentProfile, execution route, retries, usage, and finite execution evidence. */
declare function profileOptimizerModelCall(args: {
  profile: AgentProfile;
  executor: ExecutorConfig;
  context: string;
  pricing?: CustomTokenPricing;
}): ExternalOptimizerModelCall;
//#endregion
//#region src/runtime/promotion-gate.d.ts
interface PromotionGateOptions {
  /** The HOLDOUT report — must carry per-task cells for both strategy names. */
  report: BenchmarkReport;
  /** The incumbent champion's strategy name. */
  incumbent: string;
  /** The challenger's strategy name. */
  candidate: string;
  /** 'superiority' (default): the candidate must score significantly BETTER.
   *  'non-inferiority': the candidate must prove its score is not worse than the
   *  incumbent by more than `scoreTolerance` AND its cost savings are significant —
   *  the gate for "same quality, cheaper" claims. */
  mode?: 'superiority' | 'non-inferiority';
  /** non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05. */
  scoreTolerance?: number;
  /** The CI lower bound on the paired lift must EXCEED this (score scale). Default 0. */
  deltaThreshold?: number;
  /** Minimum paired tasks before significance can be claimed. Default 6 — below that
   *  the bootstrap CI is too wide to separate a real lift from the per-task noise. */
  minPairedTasks?: number;
  /** Bootstrap statistic over the paired deltas. Default 'mean'. */
  statistic?: 'mean' | 'median';
  /** Fixed by the substrate by default — the same report always yields the same verdict. */
  seed?: number;
  resamples?: number;
}
interface PromotionVerdict {
  promoted: boolean;
  reason: 'identical-champion' | 'few-tasks' | 'no-margin' | 'significant' | 'non-inferior-and-cheaper' | 'non-inferiority-unproven' | 'not-cheaper' | 'cost-unknown';
  mode: 'superiority' | 'non-inferiority';
  /** Paired tasks that carried both strategies' cells. */
  n: number;
  /** Paired (candidate − incumbent) lift across the holdout tasks. `low` and `high`
   *  are the bounds that carried the decision; `mean` and `median` are diagnostics. */
  lift: {
    mean: number;
    median: number;
    low: number;
    high: number;
  };
  /** non-inferiority mode: paired (incumbent − candidate) cost savings per task (usd).
   *  Positive means the candidate is cheaper; `low` and `high` carried the decision. */
  costSavings?: {
    mean: number;
    median: number;
    low: number;
    high: number;
  };
  /** non-inferiority mode: the tasks whose dollars were not measured on at least one arm.
   *  Present only with `reason: 'cost-unknown'`; naming them is what makes the refusal
   *  actionable instead of a bare no. */
  costUnknownTasks?: string[];
  /** Paired (candidate − incumbent) wall-clock per task (ms) — negative = the candidate
   *  is FASTER. Informational in every mode (never gates); the latency answer to "what
   *  does this win actually cost the user?". */
  latency?: {
    mean: number;
    median: number;
    low: number;
    high: number;
  };
}
/** Statistical promotion decision over a holdout benchmark using the outcome-appropriate interval selected by `heldoutSignificance`. */
declare function promotionGate(opts: PromotionGateOptions): PromotionVerdict;
//#endregion
//#region src/runtime/resolve-sandbox-client.d.ts
interface ResolveSandboxClientOptions {
  /** The execution transport for the driven loop. */
  backend: 'sandbox' | 'bridge' | 'router' | 'local';
  /** `sandbox` backend: the caller's real Sandbox-backed client. Required for that backend. */
  sandboxClient?: SandboxClient;
  /** `bridge` backend: local cli-bridge transport. The per-create profile owns the model. */
  bridge?: {
    /** cli-bridge base URL. Defaults to `http://127.0.0.1:3355`. */
    url?: string;
    bearer: string;
    /** Per-turn deadline (ms). */
    timeoutMs?: number;
  };
  /** `router` backend: endpoint/auth only; the per-create profile owns behavior. */
  router?: {
    baseUrl: string;
    key: string;
  };
  /** `local` backend: same-host pseudo-box — the router brain drives a tool loop
   *  with the profile's stdio MCP servers spawned as local children. */
  local?: LocalSandboxClientOptions;
}
/**
 * Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core
 * that `resolveBenchClient` builds on — reuse this instead of hand-rolling the
 * `createExecutor`/`inlineSandboxClient` branch in each product.
 */
declare function resolveSandboxClient(opts: ResolveSandboxClientOptions): SandboxClient;
//#endregion
//#region src/runtime/retained-interactive.d.ts
/**
 * Start one retry-safe native coding-agent TUI without dispatching a headless turn.
 * The intent admission is durable before provider.create; the environment and
 * process admissions follow only after their exact provider coordinates exist.
 * @stable
 */
declare function startRetainedInteractiveRun(options: StartRetainedInteractiveRunOptions): Promise<RetainedInteractiveRunHandle>;
/** Retry one exact start after its provider response may have been lost. @stable */
declare function recoverRetainedInteractiveRun(options: RecoverRetainedInteractiveRunOptions): Promise<RetainedInteractiveRunHandle | null>;
/** Rebuild controls for one exact provider-owned coding-agent process. @stable */
declare function reconnectRetainedInteractiveRun(options: ReconnectRetainedInteractiveRunOptions): Promise<RetainedInteractiveRunHandle | null>;
//#endregion
//#region src/runtime/retained-interactive-control.d.ts
/** Input for acquiring write authority over one exact interactive process. @stable */
interface ClaimRetainedInteractiveControlOptions {
  readonly handle: RetainedInteractiveRunHandle;
  readonly holderId: string;
  /** Last known provider generation. Zero discovers the current generation safely. */
  readonly expectedGeneration?: number;
  readonly signal?: AbortSignal;
}
/**
 * Acquire provider-issued write authority without reading authority from status.
 *
 * A new coordinator starts at generation zero. If another claim already exists,
 * the provider returns its public generation and this helper retries one new
 * compare-and-swap operation. Every generation has a deterministic operation
 * identifier, so retrying after an ambiguous response cannot create two claims.
 * @stable
 */
declare function claimRetainedInteractiveControl(options: ClaimRetainedInteractiveControlOptions): Promise<AgentInteractiveSessionControlClaim>;
//#endregion
//#region src/runtime/retained-run-start.d.ts
/**
 * Dispatch one detached, replayable run and return only after exact durable
 * coordinates are confirmed by the provider and persisted by the caller.
 *
 * The required `onAdmission` hook first records a digest-only intent before
 * creation, then records recovery coordinates and the verified exact control
 * reference. The returned promise resolves only after the dispatched admission
 * is durable, so a crash cannot lose a successful start's exact reference.
 *
 * @stable
 */
declare function startRetainedRun(options: StartRetainedRunOptions): Promise<RetainedRunHandle>;
/**
 * Dispatch a fresh retained session inside an existing provider environment.
 *
 * This operation reuses only the environment. It does not append to a prior
 * harness chat and does not claim native conversation continuity. The caller
 * must use `RetainedRunHandle.continueNative` for a verified same-chat turn.
 *
 * @stable
 */
declare function startRetainedRunInEnvironment(options: StartRetainedRunInEnvironmentOptions): Promise<RetainedRunHandle>;
/**
 * Rebuild the exact run named by a persisted pre-create intent or pre-dispatch
 * admission coordinates, or report why the provider cannot prove it.
 *
 * An intent recovery replays the exact original start material through
 * `startRetainedRun`; a changed replay is rejected before provider creation.
 *
 * `not_found`: the provider no longer holds the environment, so nothing
 * remains to destroy. `recovered`: the provider self-identified the session
 * with a strict exact reference matching the recorded coordinates.
 * `unverifiable`: the environment exists but the provider cannot
 * self-identify the session — no session accessor, an accessor that throws,
 * a lazy accessor with no stored reference, or a loose reference. That
 * outcome is never destroy-safe: keep the environment, retry
 * `reconnectRetainedRun` with a dispatched admission record, or inspect the
 * environment with provider-native tools. A session that self-identifies
 * with different coordinates throws: something live is not the recorded run.
 *
 * @stable
 */
declare function recoverRetainedRun(options: RecoverRetainedRunIntentOptions): Promise<RecoverRetainedRunResult>;
declare function recoverRetainedRun(options: RecoverRetainedRunOptions): Promise<RecoverRetainedRunResult>;
/** Rebuild a retained-run client without retaining any object from the starter. @stable */
declare function reconnectRetainedRun(options: ReconnectRetainedRunOptions): Promise<RetainedRunHandle | null>;
//#endregion
//#region src/runtime/sandbox-acquire.d.ts
/** @experimental */
interface AcquireOptions {
  /**
   * Total budget for the sandbox to reach `running`, covering on-demand node
   * cold-start. Default 600_000ms — matches the orchestrator's pending-host
   * registration window so we never give up before the platform itself would.
   */
  readyTimeoutMs?: number;
  /** Poll interval while waiting for `running` / for the named sandbox to appear. */
  pollIntervalMs?: number;
  /** Cancellation (user abort). Distinct from create-call timeouts. */
  signal?: AbortSignal;
  /** Stamp a name so a timed-out create is recoverable by lookup. Auto-generated if absent. */
  name?: string;
  /** Clock override for deterministic tests. */
  now?: () => number;
  /** Sleep override for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}
/**
 * Cold-start-resilient sandbox acquisition: create by name, observe readiness from the sandbox's own status (not the create call), and re-attach after gateway timeouts.
 *
 * @experimental
 */
declare function acquireSandbox(client: SandboxClient, options: CreateSandboxOptions, acquire?: AcquireOptions): Promise<SandboxInstance>;
//#endregion
//#region src/runtime/sandbox-capabilities.d.ts
/**
 * What the loop kernel is allowed to know about a sandbox backend: a single
 * capability bit, never the backend's identity. `canFork` gates the legacy
 * checkpoint+fork fanout path; current live branching is detected on the box.
 *
 * @experimental
 */
interface SandboxCapabilities {
  /**
   * True only when `client.criuStatus()` returned `{ available: true }`.
   * Current live `branch(count)` boxes do not need this bit. When both paths
   * are absent, a fork-enabled fanout degrades to independent fresh boxes.
   */
  canFork: boolean;
}
/**
 * Probe (and memoize per client) what the loop may rely on. A client without a
 * `criuStatus` method, or whose probe rejects, yields `canFork = false` — a
 * failed probe must never claim a capability the platform may not have. The
 * promise is cached so concurrent fanout branches share one round-trip.
 *
 * @experimental
 */
declare function probeSandboxCapabilities(client: SandboxClient): Promise<SandboxCapabilities>;
/**
 * Narrowed view of the optional CRIU probe. The loop-side `SandboxClient`
 * does not require `criuStatus`; this widens it optionally so the probe can be
 * read without importing sandbox-backend specifics. @experimental
 */
interface CriuCapableClient {
  criuStatus?: () => Promise<{
    available: boolean;
    criuVersion?: string;
    reason?: string;
  }>;
}
//#endregion
//#region src/runtime/sandbox-lineage.d.ts
/**
 * A live box plus the session that threads its iterations together. Handed back
 * by `start`/`fork`, passed into `continue`/`fork` to descend from. Opaque to
 * the kernel beyond `box` (for placement/teardown) and `sessionId` (trace).
 *
 * @experimental
 */
interface SandboxLineageHandle {
  /** The owned, running sandbox this handle drives. */
  box: SandboxInstance;
  /**
   * Stable session id threaded through this box's `streamPrompt` calls. Minted
   * by the lineage on `start`; reused on `continue` so the server continues the
   * same conversation. A forked handle starts a fresh session on its new box —
   * the shared context comes from the live branch or legacy checkpoint, not a
   * shared session id.
   */
  sessionId: string;
}
/**
 * Owns box + session handles for one loop run and offers the three
 * capability-gated lifecycle moves. Construct via `createSandboxLineage`.
 *
 * @experimental
 */
interface SandboxLineage {
  /**
   * Acquire a fresh box and begin a new session on it. Returns the handle and
   * the live `streamPrompt` iterable for the first turn (caller drains it).
   */
  start(spec: AgentRunSpec<unknown>, prompt: string, signal: AbortSignal, promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>): Promise<{
    handle: SandboxLineageHandle;
    events: AsyncIterable<SandboxEvent>;
  }>;
  /**
   * Continue an existing handle's session with one more turn on the SAME box.
   * The prior context is server-side; `prompt` is only the new turn. Asserts the
   * session is still known to the sandbox first (fail-loud) so a platform that
   * silently dropped the client-minted session id surfaces as an error instead
   * of a contextless turn the caller mistakes for a real continuation.
   */
  continue(handle: SandboxLineageHandle, prompt: string, signal: AbortSignal, promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>): Promise<AsyncIterable<SandboxEvent>>;
  /**
   * Branch `count` children from `parent`. When the platform exposes live
   * branching, each child inherits the parent's running state — and therefore
   * the parent's IMAGE and PROFILE: under a real fork `specs[i]` does NOT
   * re-select a per-branch
   * profile (the SDK forks the running box, it can't swap the image). `specs[i]`
   * picks the per-branch profile ONLY on the degraded fresh-box path (no branch
   * or legacy fork support).
   * A heterogeneous-profile fanout therefore homogenizes to the parent's profile
   * when fork is available — pass a single shared spec for forked fanouts, or
   * use `random@k` (no fork) when branches must differ. Each child's first turn
   * streams `prompts[i]`. Child-box creation is bounded by `maxConcurrency`.
   * An implementation MUST forward `promptOptions` into every branch's first
   * prompt: the compiler accepts an implementation that ignores the argument, and
   * a branch that drops it runs without the caller's session credential.
   */
  fork(parent: SandboxLineageHandle, prompts: string[], specs: AgentRunSpec<unknown>[], signal: AbortSignal, promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>): Promise<{
    handle: SandboxLineageHandle;
    events: AsyncIterable<SandboxEvent>;
  }[]>;
  /**
   * Destroy every owned box whose handle is NOT in `keep`, freeing it before
   * loop end. The kernel calls this after a round when it can prove no future
   * round will descend from the pruned boxes (deterministic, monotonic branch
   * selection); boxes still reachable as a future branch source are retained.
   * Best-effort, bounded, parallel — a failed delete never throws.
   */
  prune(keep: Iterable<SandboxLineageHandle>): Promise<void>;
  /** Destroy every box this lineage owns. Best-effort, bounded, parallel. */
  teardown(): Promise<void>;
}
/**
 * Build a lineage bound to one client + its probed capabilities. The
 * capabilities are passed in (not re-probed) so the kernel probes once per run
 * and the lineage stays a pure function of "what this platform can do".
 *
 * @experimental
 */
declare function createSandboxLineage(client: SandboxClient, capabilities: SandboxCapabilities, options?: {
  maxConcurrency?: number;
  streaming?: 'sse' | 'poll';
  /** Run provenance recorder forwarded to every `prepareBox` the lineage runs
   *  (fresh start, continue, and fork branches). Absent ⇒ mounts go unrecorded
   *  (a no-op recorder stands in so the ctx shape is always satisfied). */
  recordMount?: MountRecorder;
}): SandboxLineage;
/**
 * Loop-side widening of the box's optional checkpoint method. The
 * `SandboxClient`/`SandboxInstance` surface the kernel relies on does not
 * require checkpointing; this reads it optionally so the lineage can probe-gate
 * without importing sandbox-backend specifics. @experimental
 */
interface CheckpointCapableBox {
  checkpoint?: (options?: {
    leaveRunning?: boolean;
    tags?: string[];
  }) => Promise<{
    checkpointId: string;
  }>;
}
/** Loop-side view of the current Sandbox SDK's live branch method. @experimental */
interface BranchCapableBox {
  branch?: (count: number, options?: BranchOptions) => Promise<SandboxInstance[]>;
}
/** Loop-side widening of the legacy checkpoint fork method. @experimental */
interface ForkCapableBox {
  fork?: (checkpointId: string, options?: {
    name?: string;
  }) => Promise<SandboxInstance>;
}
/**
 * Loop-side widening of the box's optional session accessor. The real
 * `SandboxInstance` exposes `session(id).status()`; the loop reads it optionally
 * so `continue` can assert session liveness without requiring it of the test
 * fakes. `status()` resolves `null` when the id is unknown to the sandbox.
 * @experimental
 */
interface SessionCapableBox {
  session?: (id: string) => {
    status: () => Promise<unknown | null>;
  };
}
//#endregion
//#region src/runtime/sandbox-run.d.ts
/**
 * How a typed deliverable `Out` is materialized from a finished turn.
 * - `events`   — pure parse over the event array (identical to `OutputAdapter`).
 * - `artifact` — read a file off the box AFTER the turn drains, then map it (+ the
 *                events). For diffs/codebases/documents that don't fit the chat
 *                stream. `path` relative ⇒ workspace root; absolute ⇒ container FS.
 *
 * @experimental
 */
type Deliverable<Out> = {
  kind: 'events';
  fromEvents: (events: SandboxEvent[]) => Out;
} | {
  kind: 'artifact';
  path: string;
  fromArtifact: (raw: string, events: SandboxEvent[]) => Out;
};
/**
 * One finished turn over the artifact. A failed FS read is surfaced in `readError`
 * (never masked as an empty deliverable) so a caller distinguishes "agent produced
 * nothing" from a transport/FS fault.
 *
 * @experimental
 */
interface TurnResult<Out> {
  out: Out;
  events: SandboxEvent[];
  /** Outcome settled by the public Sandbox tracker after the stream drained. */
  outcome: AgentRunOutcome;
  readError?: string;
}
/**
 * Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained
 * BEFORE the abort fired (and any in-progress `readError`) so an aborted run is
 * DIAGNOSABLE — the caller can tell never-started (`events: []`) from looped
 * (many events, no terminal `result`) from produced-nothing-then-cancelled.
 *
 * `name === 'AbortError'`, so existing `err.name === 'AbortError'` callers (the
 * loop kernel, scope, supervise runtime) keep matching it unchanged.
 *
 * @experimental
 */
declare class SandboxRunAbortError extends Error {
  readonly name = "AbortError";
  /** Events drained from the stream before the abort interrupted the turn. */
  readonly events: SandboxEvent[];
  /** The last artifact read error, if the abort fired during the retry loop. */
  readonly readError?: string;
  constructor(events: SandboxEvent[], readError?: string);
}
/** @experimental A live run over ONE persistent artifact (box + session). Close it
 *  when done — `close()` tears the box down. */
interface SandboxRun<Out> {
  readonly box: SandboxInstance;
  readonly sessionId: string;
  /** First turn over the fresh box (mints the session). Throws if already started. */
  start(prompt: string): Promise<TurnResult<Out>>;
  /** Continue THE SAME session over THE SAME artifact — a resumed turn/rollout. */
  resume(prompt: string): Promise<TurnResult<Out>>;
  close(): Promise<void>;
}
/** Prompt options forwarded to every sandbox prompt turn in this run. The
 * runtime owns `sessionId` and `signal` so callers cannot accidentally break
 * resume or cancellation semantics while still setting backend-level prompt
 * controls such as `timeoutMs`.
 *
 * @experimental
 */
type OpenSandboxRunPromptOptions = Omit<PromptOptions, 'signal' | 'sessionId'>;
/** Context available after the box/session exists and before the first prompt is
 * drained. Intended for benchmark-owned workspace setup such as cloning a repo
 * into a fixed path. */
interface OpenSandboxRunBeforeStartContext {
  readonly box: SandboxInstance;
  readonly sessionId: string;
  readonly signal: AbortSignal;
}
/** @experimental */
interface OpenSandboxRunOptions {
  /** Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness. */
  agentRun: AgentRunSpec<string>;
  signal: AbortSignal;
  /** Optional execution-scoped observers. Hook failures never fail the run. */
  hooks?: RuntimeHooks;
  /** Stable run id for trace joins. Defaults to a short runtime-minted id. */
  runId?: string;
  /** Optional benchmark/scenario id carried into emitted hook events. */
  scenarioId?: string;
  /** Per-prompt sandbox SDK options forwarded to both `start()` and `resume()`.
   *  The runtime still owns the session id and abort signal for each turn. */
  promptOptions?: OpenSandboxRunPromptOptions;
  /** Optional pre-start workspace setup. Runs after `lineage.start()` creates the
   * box/session and before the first prompt stream is consumed. A thrown error
   * fails the turn before the agent spends tokens. */
  beforeStart?: (ctx: OpenSandboxRunBeforeStartContext) => Promise<void> | void;
  /** Receives a defensive copy of every streamed event. Observer work is
   * non-blocking; synchronous throws and rejected promises never fail the run. */
  onSandboxEvent?: (event: SandboxEvent, meta: {
    turnIndex: number;
    turnKind: 'start' | 'resume';
    agentRunName: string;
  }) => void | PromiseLike<void>;
  /** Test seam for deterministic hook timestamps. Defaults to `Date.now`. */
  now?: () => number;
  /** Bounds box-creation bursts inside lineage fanout. Default from lineage. */
  maxConcurrency?: number;
  /** Base backoff (ms) for retrying a transient artifact `fs.read` failure; the i-th
   *  retry waits `readRetryDelayMs * i`. Default 1000. Set 0 to disable the wait (tests). */
  readRetryDelayMs?: number;
}
/**
 * Open a sandbox run. Harness-agnostic: the harness lives in
 * `options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
 * kimi-code all flow through this one entrypoint with identical env/auth wiring.
 *
 * @experimental
 */
declare function openSandboxRun<Out>(client: SandboxClient, options: OpenSandboxRunOptions, deliverable: Deliverable<Out>): Promise<SandboxRun<Out>>;
//#endregion
//#region src/runtime/stdio-mcp-client.d.ts
interface StdioMcpServerSpec {
  /** Command that starts the MCP server (stdio transport). */
  command: string;
  args?: string[];
  /** Working directory the server starts in (a built candidate's worktree, typically). */
  cwd?: string;
  /** Declared public env for the server process. Only a minimal non-sensitive
   * subset of the parent env is inherited. */
  env?: Record<string, string>;
  /** Sensitive env for the server process. These values override `env` and are
   * redacted from child-supplied errors, tool metadata, and tool results. */
  protectedEnv?: Record<string, string>;
  /** Handshake AND per-request timeout (ms). Default 30s. */
  timeoutMs?: number;
}
/** A missing start binary / spawn fault: a SETUP bug, never a failed candidate.
 *  Graders (the serve verifier) must rethrow this instead of scoring it. */
declare class McpSpawnFault extends Error {}
interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}
interface StdioMcpConnection {
  /** The tools the server exposed at connect time (`tools/list`). */
  readonly tools: readonly McpToolDescriptor[];
  /** `tools/call` → the result's text content. A JSON-RPC error / `isError`
   *  result becomes an `ERROR: …` string (the agent's outcome); a dead
   *  transport or timeout throws (an infra fault). */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  /** Kill the server child. Idempotent. */
  close(): Promise<void>;
}
/** Spawn a trusted host command, complete the stdio MCP handshake, and return
 * the live connection. This low-level function provides no process isolation. */
declare function connectStdioMcp(spec: StdioMcpServerSpec): Promise<StdioMcpConnection>;
interface MaterializeLocalMcpOptions {
  /** Handshake / per-request timeout per server (ms). Default 30s. */
  timeoutMs?: number;
  /** Cap on a tool result's text fed back to the worker. Default 2000 chars. */
  maxResultChars?: number;
  /** Resolves a server's DECLARED secrets at spawn time — env entries of kind
   *  `secret-ref` (interface ≥0.40) and the legacy `metadata.secretEnv` map
   *  (env var name → provider key name). The resolved values reach ONLY the
   *  child process env — never the profile, the logs, or an error message.
   *  Fail-closed: a server declaring secrets without a provider (or with a
   *  missing key) throws instead of booting keyless. */
  keys?: KeyProvider;
  /** Required trust decision for profiles that declare local MCP processes.
   * Omit to refuse all profile-controlled host execution. Passing
   * `allowLocalMcp: true` is only safe for an author-controlled profile: the
   * process receives this Runtime's filesystem and network privileges. */
  profileSecurityPolicy?: AgentProfileSecurityPolicy;
}
/** The live same-host materialization of a profile's `mcp` surface. */
interface LocalMcpMaterialization {
  /** Worker-facing tool specs: namespaced `<server>__<tool>`, provider-safe schemas. */
  tools: AgenticTool[];
  /** Whether `name` is one of this materialization's namespaced tools. */
  owns(name: string): boolean;
  /** Route a namespaced call to its server's live stdio child. */
  call(name: string, args: Record<string, unknown>): Promise<string>;
  /** Kill every spawned server. Idempotent. */
  close(): Promise<void>;
}
/**
 * Spawn every explicitly trusted stdio server in `profile.mcp` as a same-host
 * child and expose its tools under `<server>__<tool>` names. The default policy
 * refuses local processes. A profile with no MCP surface returns zero tools.
 */
declare function materializeLocalMcp(profile: AgentProfile, opts?: MaterializeLocalMcpOptions): Promise<LocalMcpMaterialization>;
//#endregion
//#region src/runtime/strategy-author.d.ts
/** The compressed consumable a skill carries: everything an author needs to emit a loop. */
declare const strategyAuthorContract = "\nYou author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to\nspend a compute budget to beat a task's deployable check. You compose exactly two steps:\n\n  shot(spec?: { handle?, messages?, steer?, profile?, tools? }): Promise<ShotResult | null>\n    Runs ONE worker attempt (a bounded tool loop) over an artifact.\n    - omit handle  => the shot opens its OWN fresh artifact and closes it after (a sample).\n    - pass handle  => the shot CONTINUES that artifact (state accumulates across shots).\n    - messages     => the carried conversation (pass the previous ShotResult.messages to continue).\n    - steer        => a corrective instruction injected before the shot.\n    - profile      => a complete AgentProfile — give THIS shot its own instructions,\n      model, skills, tools, hooks, and subagents. Include name, harness, and\n      model: { provider, default }; put standing instructions in prompt.systemPrompt.\n      For example: { ...opts.workerProfile, name: 'researcher',\n        prompt: { ...opts.workerProfile.prompt,\n          systemPrompt: 'Inspect the evidence before proposing a change.' } }.\n      Choose an available model from the current execution setup. Omit profile to use\n      the worker's exact profile. Every shot spends from the same conserved budget.\n    - tools        => string[] — restrict THIS shot to a subset of the task's tools by\n      name (focus an explore shot on read-only tools, an execute shot on write tools).\n      Restriction-only; unknown names make the shot fail. ALWAYS select from\n      await listTools(handle) — never hardcode. Omitted => the shot sees every tool.\n    ShotResult = { messages, score (0..1 on the task's check), passes, total, completions, toolErrors }\n    Returns null if the attempt failed infra-wise.\n\n  critique(messages): Promise<string | null>\n    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective\n    instruction (or null when it judges the work complete). Costs ~1 completion.\n\n  consult(messages, instruction): Promise<string | null>\n    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the\n    trajectory verbatim (no reformatting) — use it when you need a specific reply format\n    (a decision, a prediction). Costs ~1 completion.\n\n  surface.open(task) / surface.close(handle)\n    Open a persistent artifact you manage yourself (remember to close in a finally).\n    close is idempotent — closing an already-closed handle is a safe no-op.\n\n  listTools(handle): Promise<Array<{ name, description? }>>\n    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a\n    shot with `tools`, you MUST pick names from await listTools(handle); hardcoding\n    names from an example kills your shots on every task whose tools differ.\n\nRules:\n- ALWAYS await every shot/critique/surface call — a floating promise that rejects\n  crashes the whole benchmark run.\n- Stay within ~budget total shots; every shot/critique spends from a conserved pool.\n- For a FRESH attempt OMIT `messages` entirely (never pass `[]` — an empty array is a\n  fresh conversation too, but be explicit). To CONTINUE, pass the previous\n  ShotResult.messages unchanged.\n- Return { score, resolved, completions, progression, shots } — score = the BEST checkpoint\n  you reached (keep-best, never final-state), progression = score after each shot.\n- The module must be EXACTLY this shape (no other imports, no commentary outside code):\n\nimport { defineStrategy } from '@tangle-network/agent-runtime/kernel'\nexport default defineStrategy('your-strategy-name', async ({ surface, task, opts, budget, shot, critique, listTools }) => {\n  // your composition (listTools comes from the destructured context — it is NOT a global)\n})\n";
interface AuthorStrategyOptions {
  /** Exact author identity. Runtime binds it to every authoring turn. */
  profile: AgentProfile;
  /** Execution substrate for the author. Behavioral settings are forbidden here. */
  executor: ExecutorConfig;
  /** An exact fallback author tried once when the primary call fails or returns no code
   *  block (thinking models time out at the edge on long authoring prompts, or return
   *  empty content without `maxTokens`). Opt-in — absent means the primary's failure
   *  propagates. */
  fallbackProfile?: AgentProfile;
  /** The contract text shown to the author. Default `strategyAuthorContract`. The
   *  meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
   *  variant on the same frozen holdout as any strategy. */
  contract?: string;
  /** The environment the losses came from (orientation only — never the verifiers). */
  environmentName: string;
  /** The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient. */
  lossesJson: string;
  /** The budget the strategy must respect (shots/width). */
  budget: number;
  /** Where the authored module file is written (created if missing). */
  outDir: string;
  signal?: AbortSignal;
}
/** Standing behavior callers put in the strategy-author AgentProfile. */
declare const strategyAuthorSystemPrompt: string;
/** Static CONTRACT lint over an authored strategy module — the module-boundary
 *  enforcement of the harness's two measurement invariants:
 *    - author blindness: the only import allowed is the kernel surface. A body that could
 *      reach the filesystem, network, or process could read or mutate verifier/artifact
 *      state outside the brokered shots, and the harness-verified score would stop
 *      meaning "what the shots achieved".
 *    - conserved dose: no out-of-band compute (fetch/require/eval) — every unit a
 *      strategy spends is metered by the Supervisor's pool, which is what makes
 *      equal-budget comparisons between strategies valid.
 *  A lint, not a sandbox: its job is keeping the benchmark numbers interpretable. */
declare function assertStrategyContract(code: string): void;
interface AuthoredStrategy {
  strategy: Strategy;
  file: string;
  code: string;
}
/** Author + load a strategy from losses. Throws when the author emits no loadable module;
 *  with `fallbackModel` set, the named fallback gets one attempt first. */
declare function authorStrategy(opts: AuthorStrategyOptions): Promise<AuthoredStrategy>;
//#endregion
//#region src/runtime/strategy-evolution.d.ts
interface EvolutionAuthor {
  /** Exact author identity. */
  profile: AgentProfile;
  /** Execution substrate. All behavior comes from the profile. */
  executor: ExecutorConfig;
  /** Optional exact fallback identity. */
  fallbackProfile?: AgentProfile;
}
type ChampionPolicy = 'score' | 'costAware';
interface StrategyEvolutionConfig {
  environment: Environment;
  /** Task supply by DISJOINT slice: `(offset, n)` must return n tasks unique to that
   *  offset range. Train draws [0, trainN); the holdout draws [trainN + holdoutOffset,
   *  …) — tasks the search never touched. */
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>;
  trainN: number;
  holdoutN: number;
  /** Extra offset past the train slice for the holdout draw (rotate across runs). */
  holdoutOffset?: number;
  worker: AgenticOptions;
  /**
   * Model availability check before the first benchmark phase.
   *
   * A successful check is reused for the remaining phases in this evolution run.
   * See `BenchmarkConfig.modelPreflight`.
   */
  modelPreflight?: BenchmarkConfig['modelPreflight'];
  /** Maximum time for each model availability check. Default 30 seconds. */
  modelPreflightTimeoutMs?: BenchmarkConfig['modelPreflightTimeoutMs'];
  author: EvolutionAuthor;
  /** Rollouts (sample) / shots (refine) per strategy per task. Default 3. */
  budget?: number;
  concurrency?: number;
  /** Author→tournament rounds after gen0. Default 2. */
  generations?: number;
  /** Authored candidates per generation. Default 2. */
  populationSize?: number;
  /** The gen0 field. Default [sample, refine, sampleThenRefine]. */
  baselines?: Strategy[];
  /** What "better" means for PROMOTION. 'score' (default): the candidate must beat the
   *  incumbent's score (superiority gate). 'cost': the candidate must prove score
   *  NON-INFERIORITY (not worse by more than `scoreTolerance`) plus significant cost
   *  savings — the "same quality, cheaper" objective. The author is told the objective
   *  and sees per-task spend either way. */
  objective?: 'score' | 'cost';
  /** Cost objective: the score CI lower bound must clear −scoreTolerance. Default 0.05. */
  scoreTolerance?: number;
  /** Search-side champion selection. Default 'costAware'. */
  champion?: ChampionPolicy;
  /** Score band treated as a tie under 'costAware'. Default 0.01. */
  championEpsilon?: number;
  /** Where authored modules are written. */
  outDir: string;
  /** Promotion-gate evidence floor (paired holdout tasks). */
  minPairedTasks?: number;
  /** BAND-AWARE scoring — concentrate the measurement where lift is possible.
   *  Holdout: draw `holdoutPoolN` candidate tasks and run `baselines[0]` once at the run
   *  budget as an INDEPENDENT reference screen; keep tasks scoring ≤ `maxRefScore`
   *  (headroom exists) and take the first `holdoutN`. Band membership is decided before
   *  either finalist touches a task and both finalists then face the SAME tasks — the
   *  estimand becomes "paired lift on headroom tasks", pre-registered by this config.
   *  Train: champion selection ignores zero-spread tasks (every field strategy scored
   *  identically — zero selection information, pure noise dilution). */
  band?: {
    holdoutPoolN: number;
    /** Keep holdout tasks where the reference scores ≤ this. Default 0.99 — drop only
     *  tasks the reference already solves fully (no headroom, a candidate can only tie). */
    maxRefScore?: number;
  };
  /** What the author learns from a tournament. 'exact' (default) = scores + progressions
   *  per task; 'binary' = pass/fail only — the leakage-bounded channel (one bit per cell
   *  per generation reaches the author from the evaluation data). */
  lossesDetail?: 'exact' | 'binary';
  /** Reproducer certification (arXiv:2606.11045): when the final champion is AUTHORED,
   *  compress it to a short natural-language summary, have a fresh author re-implement
   *  from the summary alone (no losses, no code), and score the reproduction on the same
   *  holdout. A reproduction gap is an overfitting signal (their detector: 100%
   *  sensitivity / 91% specificity in the ML-agent setting) — recorded on the report,
   *  never gate-blocking in v1. */
  reproducerCheck?: {
    /** Word budget for the strategy summary. Default 64. */
    summaryMaxWords?: number;
    /** Reproduction counts as faithful when reproducedScore ≥ championScore − tolerance.
     *  Default 0.05. */
    tolerance?: number;
  };
  /** Endurance: write the run state after every completed phase; with `resume`, a
   *  restart skips completed phases (authored modules re-imported from their files).
   *  Worst case after a mid-run death is re-paying ONE phase, never the run. */
  checkpoint?: {
    path: string;
    resume?: boolean;
    /** Digest of execution dependencies: environment, baseline code, transports, callbacks,
     * and external state such as a corpus. Update it when any dependency changes.
     * Runtime hashes profiles, settings, JSON task payloads, and authored bytes separately;
     * it cannot infer callback behavior or external state. */
    executionRef: Sha256Digest;
  };
  /** Called before each benchmark phase (gen0, gen1…, band-screen, holdout, reproduce).
   *  The seam for environment recycling — no artifacts span phases, so a runner may
   *  recreate a wedge-prone environment container here. */
  onPhase?: (phase: string) => Promise<void>;
  onTask?: (phase: string, row: BenchmarkTaskRow, done: number, total: number) => void;
  hooks?: RuntimeHooks;
}
interface ChampionPick {
  name: string;
  score: number;
  usd: number;
}
interface EvolutionCandidate {
  name: string;
  file?: string;
  /** Digest of the exact authored module evaluated in this generation. */
  sourceSha256?: Sha256Digest;
  gzipBits?: number;
  codeChars?: number;
  /** Present when this author attempt failed (recorded, never silent). */
  error?: string;
}
interface EvolutionGeneration {
  generation: number;
  candidates: EvolutionCandidate[];
  report: BenchmarkReport;
  champion: ChampionPick;
}
interface EvolutionArchiveNode {
  name: string;
  source: 'baseline' | 'authored';
  generation: number;
  /** The champion whose tournament losses this candidate was authored from. */
  parent?: string;
  gzipBits?: number;
  file?: string;
  /** Latest measured tournament result — 0 until the node's first tournament settles
   *  (an authored node is created before its generation's benchmark runs). */
  score: number;
  usd: number;
}
interface ReproductionCheck {
  /** The compressed strategy description the reproducer implemented from. */
  summary: string;
  reproducedName: string;
  file?: string;
  championHoldoutScore: number;
  reproducedHoldoutScore: number;
  /** champion − reproduced (positive = the reproduction fell short). */
  gap: number;
  /** reproducedScore ≥ championScore − tolerance. A failed reproduction is an
   *  overfitting signal: the champion's win did not fit through the summary. */
  reproducible: boolean;
  /** Infra failure during reproduction (distinct from a semantic reproduction failure). */
  error?: string;
}
interface EvolutionBandInfo {
  /** Tasks screened by the reference on the holdout pool. */
  screened: number;
  /** Tasks kept (reference score ≤ maxRefScore) before truncating to holdoutN. */
  inBand: number;
  /** Reference scores per screened task (the screening record). */
  refScores: Array<{
    taskId: string;
    score: number;
  }>;
}
interface EvolutionReport {
  gen0: BenchmarkReport;
  gen0Champion: ChampionPick;
  generations: EvolutionGeneration[];
  archive: EvolutionArchiveNode[];
  finalChampion: ChampionPick;
  holdout: BenchmarkReport;
  verdict: PromotionVerdict;
  /** Present when band screening ran — the verdict's estimand is then "paired lift on
   *  headroom tasks" (band membership fixed by the reference screen, pre-registered). */
  band?: EvolutionBandInfo;
  /** Present when reproducerCheck ran (final champion was authored). */
  reproduction?: ReproductionCheck;
  /** SEARCH TELEMETRY, not evidence: each entry is that generation's own train-slice
   *  re-measurement, so cross-generation deltas mix true drift with run-to-run variance
   *  (entries are unpaired across generations). The only evidence-grade comparison in
   *  this report is `verdict` — both finalists measured fresh, paired, on the holdout. */
  trajectory: Array<{
    generation: number;
    champion: string;
    score: number;
    usd: number;
  }>;
}
/** Strategy means recomputed over the DISCRIMINATING tasks only — tasks where the field
 *  strategies did not all score identically. Zero-spread tasks (everyone 1.0, everyone
 *  0.0, everyone tied) carry no selection information; averaging over them dilutes real
 *  differences toward zero. Search-side denoising only — the gate never uses this. */
declare function discriminatingMeans(report: BenchmarkReport, fieldOrder: string[]): Record<string, {
  score: number;
  usd: number;
}> | null;
/** The champion pick over a means table. 'score' takes the best mean score (ties →
 *  field order). 'costAware' treats scores within `epsilon` of the best as tied and
 *  takes the cheapest — the (score, $) Pareto rule collapsed to one pick. */
declare function pickChampion(means: Record<string, {
  score: number;
  usd: number;
}>, fieldOrder: string[], policy: ChampionPolicy, epsilon: number): ChampionPick;
/** Search-side champion selection over a tournament report. */
declare function selectChampion(report: BenchmarkReport, fieldOrder: string[], policy: ChampionPolicy, epsilon: number): ChampionPick;
/** Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice. */
declare function runStrategyEvolution(cfg: StrategyEvolutionConfig): Promise<EvolutionReport>;
//#endregion
//#region src/runtime/structural-rollout.d.ts
/** Provider-neutral conversation records read by structural candidate extraction. */
type StructuralRolloutMessage = Record<string, unknown>;
/** The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/
 *  TESTGEN/DIVERSE/TEMPERATURE). Defaults are the measured sweet spot: repair value
 *  concentrates at low k (~+12pp at k=1, +1–3pp at k=5), so `k=5, repairRounds=2` is the
 *  full recipe and `k=1, repairRounds=2` the low-compute preset. */
interface StructuralRolloutPolicy {
  /** Independent samples per task (selection breadth). */
  k: number;
  /** Repair shots after selection, each steered by the checks' failure output. */
  repairRounds: number;
  /** Model-authored visible checks requested per task; 0 disables authoring. */
  testgen: number;
  /** Per-slot strategy-lens prefixes on the k samples (attacks the all-k-fail bucket).
   *  Measured as a paired null (+0.6pp) — kept as an optional knob, off by default. */
  diverse?: boolean;
}
/** The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks. */
declare const defaultStructuralRolloutPolicy: StructuralRolloutPolicy;
/** One task-visible executable check (e.g. a single-line Python assert). */
interface VisibleCheck {
  code: string;
  /** 'official' = shown in the task itself (docstring example, shown assert);
   *  'authored' = the model's own guess. Official outranks authored in selection. */
  kind: 'official' | 'authored';
}
/** What a CheckSource composes with. `consult` is the strategy family's raw analyst
 *  channel (metered by the conserved pool, offline-injectable via `opts.complete`) —
 *  check authoring goes through it rather than a bespoke model client. */
interface CheckSourceCtx {
  /** Authored-check budget for this task (`policy.testgen`). */
  count: number;
  /** The symbol authored checks must reference; undefined ⇒ authoring is skipped
   *  (no guesses beats guesses pinned to nothing). */
  entrySymbol?: string;
  /** One metered LLM call: instruction in, reply text out, null when the channel went
   *  down. The task's visible prompt is included by the channel itself. */
  consult(instruction: string): Promise<string | null>;
}
/** Produces the task's visible checks. MUST derive them from agent-visible information
 *  only, before any candidate exists — the strategy freezes the returned set for every
 *  sample and repair round of the task. */
interface CheckSource {
  generate(task: AgenticTask, ctx: CheckSourceCtx): Promise<VisibleCheck[]>;
}
/** The proven authored-assert filter (lifted from the rigs' generateTests): keep only
 *  single-line, paren-balanced asserts that reference the entry symbol — malformed lines
 *  are dropped here rather than poisoning every candidate's score identically. */
declare function filterAuthoredAsserts(reply: string, entrySymbol: string, count: number): string[];
/** Default authored-check source: one metered LLM call per task, before sampling,
 *  filtered through `filterAuthoredAsserts`. Returns [] (no signal, never a fabricated
 *  check) when the budget is 0, no entry symbol resolves, or the channel went down. */
declare function modelAuthoredChecks(overrides?: {
  count?: number;
}): CheckSource;
/** Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads
 *  `task.meta[key]` as a string array; anything else means no official checks. */
declare function officialChecksFromMeta(key?: string): CheckSource;
/** Concatenate check sources (official first by convention — ordering does not affect
 *  scoring, which reads each check's `kind`). */
declare function composeCheckSources(...sources: CheckSource[]): CheckSource;
/** The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface
 *  provides it, else the LAST `def name(` in the visible prompt (a code-completion stub
 *  lists helpers first, the entry stub last). Undefined ⇒ authoring is skipped. */
declare function resolveEntrySymbol(task: AgenticTask): string | undefined;
/** How one candidate fared against the frozen visible checks, split by check kind. */
interface CheckOutcome {
  passedOfficial: number;
  totalOfficial: number;
  passedAuthored: number;
  totalAuthored: number;
  /** The checks' failure report — the ONLY feedback the repair loop may see. */
  failureOutput: string;
  /** True when the candidate crashed before any check could run — ranks below a
   *  candidate that ran and failed everything. */
  crashed?: boolean;
}
/** Minimal exec channel the default runner needs. `SandboxInstance` (and therefore
 *  `ValidationCtx.box`) satisfies it structurally. */
interface CheckExecChannel {
  exec(command: string, options?: {
    timeoutMs?: number;
  }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}
interface CheckRunContext {
  task: AgenticTask;
  /** Live exec channel for this run (`ValidationCtx.box` / a sandbox instance). */
  box?: CheckExecChannel;
  signal?: AbortSignal;
}
/** Executes the frozen checks against one candidate. Implementations MUST fail loud
 *  (throw) when they cannot execute — a silent zero poisons selection. */
interface CheckRunner {
  run(candidate: string, checks: VisibleCheck[], ctx: CheckRunContext): Promise<CheckOutcome>;
}
/** Default CheckRunner backend: pipes the check program into `python3` over the sandbox
 *  exec channel (`ctx.box`, or one bound at construction). Never shells out to docker
 *  itself — the jail is the sandbox's concern. No channel ⇒ throws; it must never
 *  silently score 0. Empty check sets short-circuit to a no-signal outcome (nothing to
 *  execute, so no channel is required). */
declare function sandboxCheckRunner(options?: {
  box?: CheckExecChannel;
  python?: string;
  timeoutMs?: number;
}): CheckRunner;
/** The selection order: crash < ran; then official pass-fraction; authored guesses only
 *  break ties. Returns > 0 when `a` outranks `b`. Strictly lexicographic — on MBPP,
 *  letting 6 noisy guesses outvote the one official check flipped selection negative. */
declare function compareCheckOutcomes(a: CheckOutcome, b: CheckOutcome): number;
/** Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1,
 *  else official fraction + 0.001 × authored fraction. Selection itself uses the exact
 *  lexicographic comparator, never this scalar. */
declare function visibleCheckScore(o: CheckOutcome): number;
/** Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero
 *  visible coverage every candidate ties at no-signal and index 0 is the blind pick). */
declare function selectBestIndex(outcomes: ReadonlyArray<CheckOutcome>): number;
/** The repair keep-best guard: a challenger displaces the incumbent only when it is
 *  strictly better in the selection order AND passes at least as many official checks.
 *  The raw-count clause is deliberate belt-and-braces over the comparator (a custom
 *  runner can report shifted totals): repair must NEVER replace a candidate that passes
 *  more official checks with one that passes fewer. */
declare function canDisplace(challenger: CheckOutcome, incumbent: CheckOutcome): boolean;
/** The candidate a shot produced, read from its conversation: the LAST `submit_answer`
 *  tool-call argument (verifier environments submit the artifact explicitly), else the
 *  latest assistant reply's fenced code block — preferring a block containing a `def`,
 *  because repair replies echo the failure report in a bare fence BEFORE the fixed code
 *  (the rigs' extractRepairCode lesson) — else the latest non-empty assistant text. */
declare function defaultExtractCandidate(messages: ReadonlyArray<StructuralRolloutMessage>): string;
type RepairStop = 'already-passing' | 'no-signal' | 'repaired-pass' | 'rounds-exhausted' | 'no-candidates';
/** The body's deliverable — a `StrategyResult` plus selection provenance. The extra
 *  fields ride through `defineStrategy`'s deliverable spread onto `AgenticRunResult`
 *  (score/resolved stay harness-verified, exactly as for every authored strategy). */
interface StructuralRolloutResult extends StrategyResult {
  /** Exact selected candidate text passed to the visible checks, or null when no shot ran. */
  artifact: string | null;
  /** One receipt per scored candidate (k samples, then repairs), `SelectionReceipt`
   *  shaped like the kernel's (`types.ts`), selector 'driver'. */
  selection: SelectionReceipt[];
  repairStop: RepairStop;
  officialChecks: number;
  authoredChecks: number;
}
interface StructuralRolloutConfig {
  /** Knobs; missing fields take the measured defaults (k=5, repairRounds=2, testgen=6). */
  policy?: Partial<StructuralRolloutPolicy>;
  /** Where the visible checks come from. Default: official checks from
   *  `task.meta.visibleChecks` composed with `modelAuthoredChecks()`. */
  checkSource?: CheckSource;
  /** How candidates are measured. Default `sandboxCheckRunner()` — it needs an exec
   *  channel (bind one to the runner, or pass `box` here) and fails loud without one. */
  checkRunner?: CheckRunner;
  /** Exec channel threaded into every check run of this strategy (a sandbox instance /
   *  `ValidationCtx.box`). The strategy seam itself carries no sandbox, so the caller
   *  who owns one supplies it here or binds it into the runner. */
  box?: CheckExecChannel;
  /** Candidate extraction from a shot's conversation. Default `defaultExtractCandidate`. */
  extractCandidate?: (messages: ReadonlyArray<StructuralRolloutMessage>) => string;
}
/**
 * Build the structuralRollout `Strategy`: k shots → score each by the frozen visible
 * checks (official above authored, crash lowest) → argmax with first-index tie-break →
 * up to `repairRounds` repair shots steered by the failure output, keep-best under the
 * official-check guard. Authored via `defineStrategy`, so the deliverable score stays
 * harness-verified and every shot is metered by the conserved pool.
 *
 * Budget note: `runAgentic`'s `budget` sizes the pool — pass at least
 * `k + repairRounds + 1` so the samples, repairs, and the check-author consult all admit.
 */
declare function structuralRollout(config?: StructuralRolloutConfig): Strategy<StructuralRolloutResult>;
//#endregion
//#region src/runtime/supervise/authoring.d.ts
/** What the supervisor AUTHORS per sub-task: one complete canonical profile whose name and
 *  task-specific system prompt are present. Every other `AgentProfile` axis is preserved exactly. */
type AuthoredProfile = AgentProfile & {
  readonly name: string;
  readonly prompt: AgentProfilePrompt & {
    readonly systemPrompt: string;
  };
};
/** Narrow an untyped `spawn_worker` profile argument to an `AuthoredProfile`, or null if the
 *  supervisor failed to author one (empty/placeholder profile — a skill violation worth catching). */
declare function asAuthoredProfile(raw: unknown): AuthoredProfile | null;
/** The supervisor skill: an explicit profile-authoring instruction, never an implicit Runtime
 * policy. Editing this text changes how a profile designs the descendants it spawns. */
declare function supervisorInstructions(opts?: {
  goal?: string;
}): string;
/** Thresholds below which a system prompt is treated as a thin stub. Tunable per call. */
interface ProfileRichnessThresholds {
  /** A prompt shorter than this many characters is thin (default 600). */
  readonly minSystemPromptChars: number;
  /** A prompt with fewer than this many non-blank lines is thin (default 6). */
  readonly minSystemPromptLines: number;
}
/** Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. */
declare const defaultProfileRichnessThresholds: ProfileRichnessThresholds;
/** Per-field verdict on one authored profile — the raw material the bench renders + scores. */
interface ProfileRichness {
  readonly name: string;
  /** The resolved system prompt (canonical `prompt.systemPrompt`, the sandbox `prompt.system`
   *  convention, or a bare-string prompt — whichever the author used). */
  readonly systemPrompt: string;
  readonly systemPromptChars: number;
  readonly systemPromptLines: number;
  readonly sentenceCount: number;
  readonly hasDescription: boolean;
  readonly hasTools: boolean;
  readonly hasSkills: boolean;
  readonly hasMcp: boolean;
  readonly hasSubagents: boolean;
  /** 0..1 — fraction of richness signals present (prompt-depth + the four levers). */
  readonly richness: number;
  /** True when the supervisor authored a stub instead of a real profile. */
  readonly thin: boolean;
  /** The specific reasons it is thin (empty when rich) — used in the finding's action. */
  readonly reasons: string[];
}
/** OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task
 *  context (`needsMcp`) lets a domain say "this work needs a data/tool MCP" so a missing MCP counts. */
declare function assessAuthoredProfile(profile: AgentProfile, opts?: {
  needsMcp?: boolean;
  thresholds?: Partial<ProfileRichnessThresholds>;
}): ProfileRichness;
/** Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`).
 *  Severity scales with thinness; the recommended action names the MISSING lever so the supervisor can
 *  re-author. `subject` = the worker name so per-worker findings diff cleanly across re-authors. */
declare function profileRichnessFinding(richness: ProfileRichness, opts?: {
  analystId?: string;
  runId?: string;
}): AnalystFinding;
//#endregion
//#region src/runtime/supervise/chat-transport-executor.d.ts
/** Buffered OpenAI-compatible completion port used only for offline execution. */
type ChatCompletionsTransport = NonNullable<RouterToolsSeam['complete']>;
/** Conversation history keyed by the settled Runtime worker id. */
interface ChatSessionStore {
  load(workerId: string): ReadonlyArray<Readonly<Record<string, unknown>>> | undefined;
  save(workerId: string, messages: ReadonlyArray<Readonly<Record<string, unknown>>>): void;
}
/** In-memory, process-local conversation store with detached reads and writes. */
declare function createChatSessionStore(): ChatSessionStore;
/** One profile-authorized function tool and its host implementation. */
interface ChatTransportTool {
  readonly spec: ToolSpec;
  readonly execute: (args: Record<string, unknown>, task: unknown) => Promise<string>;
}
/**
 * Transport and session data for one exact profile-driven conversation.
 * Behavioral controls belong only in `profile.model.metadata`.
 */
interface ChatTransportExecutorOptions {
  readonly profile: AgentProfile;
  readonly url?: string;
  readonly bearer?: string;
  readonly tools?: ReadonlyArray<ChatTransportTool>;
  readonly complete?: ChatCompletionsTransport;
  readonly sessions?: ChatSessionStore;
  readonly sessionKey?: string;
  readonly resume?: WorkerResumeContext;
}
/**
 * Build one exact profile-driven chat executor through `createExecutor`.
 * Prefer `chatWorkerSeam` for supervised work because it supplies trusted node identity.
 */
declare function chatTransportExecutor(opts: ChatTransportExecutorOptions): Executor<string>;
/** Transport/session configuration shared by every spawned exact profile. */
interface ChatWorkerSeamOptions {
  readonly url?: string;
  readonly bearer?: string;
  readonly tools?: ReadonlyArray<ChatTransportTool>;
  readonly complete?: ChatCompletionsTransport;
  readonly sessions?: ChatSessionStore;
  readonly deliverable?: DeliverableSpec<unknown>;
}
/** Session-owning worker factory for graph continuity. */
declare function chatWorkerSeam(opts: ChatWorkerSeamOptions): MakeWorkerAgent;
//#endregion
//#region src/runtime/supervise/code-mode.d.ts
/** Where model-written code runs. THE isolation boundary — see the module doc: this runtime ships
 *  no default, so a caller chooses trusted-in-process or a real jail deliberately. */
interface CodeModeRunner {
  run(args: {
    readonly code: string;
    /** The granted operations, already cancellation-gated and result-detached by the caller. The
     *  runner exposes these to the program as `api.<name>` and adds nothing else reachable. */
    readonly bindings: Readonly<Record<string, (args: unknown) => Promise<unknown>>>;
    /** Aborts when the manager cancels or a caller-authored deadline passes. */
    readonly signal: AbortSignal;
  }): Promise<{
    readonly result: unknown;
    readonly logs: ReadonlyArray<string>;
  }>;
}
/**
 * An in-process runner for TRUSTED model output ONLY. NOT a security boundary.
 *
 * It runs the program in a `node:vm` context whose globals are the bindings (`api`) and a
 * capturing `console`, with code generation disabled and inherited properties stripped. Those are
 * capability discipline, not containment: `node:vm` shares the host realm, and a host function's
 * `.constructor` is the host `Function`, so code that WANTS out can get out
 * (`api.<binding>.constructor('return process')()`). Use this for your own eval harness, offline
 * tests, or a model you trust; for untrusted output supply a jailed `CodeModeRunner` instead.
 */
declare function unsafeInProcessRunner(): CodeModeRunner;
interface CodeModeOptions {
  /** Optional caller-authored deadline for one `execute` call. Omit it to run until the manager
   *  cancels. A declared deadline aborts the runner and refuses later `api` calls. */
  readonly timeoutMs?: number | null;
}
/**
 * Put a supervisor in code mode: its product tool surface becomes exactly `search` and `execute`.
 *
 * `runner` is REQUIRED and has no default — this runtime ships no isolate, so the execution
 * boundary is the caller's explicit choice (see the module doc). Use {@link unsafeInProcessRunner}
 * for trusted output; a jailed runner for untrusted models.
 *
 * Pass the result as `SuperviseOptions.resolveSupervisorTools` (which `runGraph` forwards to its
 * root supervisor). The graph engine's `supervisorKind` does not accept it yet, so a graph
 * supervisor node cannot be put in code mode through node config today.
 */
declare function codeModeSupervisorTools(runner: CodeModeRunner, options?: CodeModeOptions): ResolveSupervisorTools;
//#endregion
//#region src/runtime/supervise/router-transcript.d.ts
/** What the brain returned for one turn, as the recorder keeps it. */
interface RouterTranscriptReply {
  readonly content?: string | null;
  readonly toolCalls?: ReadonlyArray<ToolLoopToolCall>;
}
interface RouterTranscript {
  /** Keep every message the loop added that is not yet kept. */
  observe(messages: ReadonlyArray<ToolLoopMessageRecord>): void;
  /** Keep the model's reply for this turn, and return what this turn added, for the turn event. */
  reply(reply: RouterTranscriptReply): ReadonlyArray<ToolLoopMessageRecord>;
  /** The whole conversation so far as a harness transcript. */
  capture(): HarnessTranscriptCapture;
}
//#endregion
//#region src/runtime/supervise/coordination-driver.d.ts
interface DriverAgentOptions {
  readonly name: string;
  /** The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
   *  (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
   *  production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape. */
  readonly brain: ToolLoopChat;
  /** Profile-declared model for a production Router brain. When set, every turn must report this
   * exact provider-observed model before its output is accepted. Omitted by scripted test brains. */
  readonly expectedModel?: string;
  /** Runtime-owned observation sink for the provider identity of each settled driver turn. */
  readonly onProviderModel?: (model: string | undefined) => void;
  /** Shared blob store — `observe_agent` reads settled outputs through it. */
  readonly blobs: ResultBlobStore;
  /** Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam). */
  readonly makeWorkerAgent: MakeWorkerAgent;
  readonly authorizeDownMessage?: AuthorizeDownMessage;
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget;
  /** Allow the manager's own metered turn after child admission reaches its protected share. */
  readonly preserveOwnerTurns?: true;
  /** Independent completion check for work the driver performs itself. When present, the driver
   *  receives `submit_result`; the first passing submission ends the loop and becomes the output. */
  readonly deliverable?: DeliverableSpec<unknown>;
  /** Receives a result only after this manager's completion check accepted it. */
  readonly onAcceptedSubmission?: (result: unknown) => void;
  /** The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
   *  Unset → no analyst feed (status quo: the driver gets settled outputs, no findings). */
  readonly analysts?: AnalystRegistry$1;
  /** Where an `ask_parent` question goes when it leaves this manager. Omit = `no-parent`. */
  readonly escalateQuestion?: EscalateQuestion;
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
   *  `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
   *  loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>;
  /** Run the ONLINE detector panel over each worker's LIVE tool trace and raise a `finding` the
   *  moment it loops/error-storms — mid-run evidence to steer on, not a settle-time post-mortem.
   *  Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions;
  /** Idle time after which `observe_agent` reports a worker as stalled (a derived read; nothing is
   *  killed). Omit = the runtime default. */
  readonly stallAfterMs?: number;
  /** Max wall-clock ms one `await_event` blocks before it returns a re-pollable `{ pending, live }`
   *  snapshot. Every return is one driver turn, so a driver whose workers run for hours spends a
   *  turn per interval. This driver runs in process with no transport timeout; a larger value
   *  trades liveness reads for fewer turns. Omit = `DEFAULT_AWAIT_EVENT_TIMEOUT_MS`. */
  readonly awaitTimeoutMs?: number;
  /** Default continuity per worker PROFILE NAME — `'resume'` makes spawns of that name re-attach
   *  to the node's latest settled worker (see
   *  `CoordinationToolsOptions.continuityByProfile`); `spawn_worker`'s per-call `continuity`
   *  argument overrides. Omit = every spawn fresh (status quo). */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>;
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget. See
   *  `CoordinationToolsOptions.preflightSpawn`. */
  readonly preflightSpawn?: SpawnPreflight;
  /** Pre-journal profile resolution for `preflightSpawn`; see
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** Composition of each authored child profile before identity is fixed —
   *  `CoordinationToolsOptions.composeSpawnProfile`. */
  readonly composeSpawnProfile?: (profile: AgentProfile) => AgentProfile;
  /** The run's validated profiles table — `CoordinationToolsOptions.profiles`. */
  readonly profiles?: ReadonlyMap<string, SuperviseProfileEntry>;
  /** See `CoordinationToolsOptions.spawnResourceRoot`. */
  readonly spawnResourceRoot?: string;
  /** See `CoordinationToolsOptions.spawnResourceReader`. */
  readonly spawnResourceReader?: SpawnResourceReader;
  /** The driver's stance — a string, or built from the task (the worker-driver prompt /
   *  the generator). INJECTED so the prompt is a pluggable, optimizable role. */
  readonly systemPrompt: string | ((task: unknown) => string);
  /** Product-selected tools already bound to this exact supervisor node. The same descriptors are
   *  served over MCP for external supervisors; this arm projects them into router ToolSpecs. */
  readonly nodeTools?: ReadonlyArray<McpToolDescriptor$1>;
  /** Exact bare names to expose from the coordination, node-tool, and direct-work-tool set.
   *  Runtime never grants an implicit complete tool set. */
  readonly toolNames: ReadonlyArray<string>;
  /** WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
   *  not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
   *  Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
   *  `executeExtraTool`. Unset → coordination-only (the prior behavior). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly parameters: Record<string, unknown>;
  }>;
  /** Runs an `extraTools` call. Returns a string result, or null/undefined to signal "not handled"
   *  so the call falls through to the coordination dispatch. Required iff `extraTools` is set. */
  readonly executeExtraTool?: (name: string, args: Record<string, unknown>) => Promise<string | null | undefined>;
  /** Max driver turns before the loop force-finalizes on the best settled child. Default: no
   *  turn-count cap. The loop is bounded by the conserved budget pool (every driver turn is metered
   *  into it), an absolute deadline, the driver's own stop, and abort, all checked before each
   *  turn. Without a deadline, a manager stops once it has overdrawn its pool by the pool's size
   *  again, and a brain that reports no usage keeps a 16-turn bound unless a dollar cap applies. A manager awaits one settlement per turn, so the old default of 16 ended any manager
   *  with more than about 14 workers and tore its unfinished workers down: measured 2026-09-25 on
   *  a 1 + 20 + 400 tree, 124 of 420 agents settled `down` at 16 and none at 0. */
  readonly maxTurns?: number;
  /** Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
   *  deterministic in tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * PROGRESS-derived stop (mechanic D). Today a run ends on a ceiling — iterations, tokens,
   * dollars, deadline, turn cap — which answers "may it continue?" and never "is it still getting
   * anywhere?". A stop rule reads the run's own progress (best-so-far over settled work, time
   * since the last settle, the live worker feed) and ends a run that has stopped learning BEFORE
   * it exhausts a budget.
   *
   * Composes with, and can never override, the hard guards: `poolStarved` / `deadlinePassed` /
   * abort / the driver's own stop are evaluated first, so a rule can only ADD a stop.
   *
   * THRESHOLDS are the caller's judgment, not this module's — build the rule with
   * `plateau({window, minDelta})` / `noProgressFor({...})` / `allWorkersStalled({...})` from
   * `supervise/stop-rules`. Omit ⇒ ceilings only (unchanged behavior).
   */
  readonly stopRule?: StopRule;
  /** Called once with the rule's reason when a `stopRule` ends the run — so a caller can record
   *  WHY a run stopped early instead of inferring it from an unexhausted budget. */
  readonly onProgressStop?: (reason: string, request?: RunCancelRequest) => void;
  /** Give the driver brain a chapter-lifecycle on its OWN context window. The LLM-brain front doors
   *  lose to a dumb-Ralph respawn because the brain re-bills its whole coordination transcript every
   *  turn — the same context overflow a single steered agent suffers, one level up. With this set,
   *  once the brain's running conversation exceeds `thresholdTokens` it distills the accumulated
   *  history to a compact progress note and continues fresh: the supervisor analog of respawning
   *  against external tracking state, except the live `Scope` roster IS the durable state. Default
   *  off (no behavior change). `distill` defaults to a self-summary authored by the brain combined
   *  with the factual settled-worker roster; override to supply your own. */
  readonly compaction?: ToolLoopCompactionOptions;
  /** Pass-through subscriber for every coordination bus event: settled/question/finding,
   *  pre-delivery instruction receipts, and steer/answer delivery outcomes. A durable caller uses
   *  this to append the coordination log. Omit = no observer. */
  readonly onEvent?: (event: CoordinationEvent, record: BusRecord<CoordinationEvent>) => void | Promise<void>;
  /** Re-publish resume-time settlements through the awaited observer before the first brain turn. */
  readonly replaySettlements?: boolean;
  /** Questions, findings, and authorized continuation receipts loaded from a prior process.
   *  Questions seed the ledger (`list_questions`, blocking-stop policy); all three feed the resume
   *  brief. Continuation receipts are evidence only and are never auto-delivered. Omit = fresh. */
  readonly priorCoordination?: PriorCoordination;
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact keep-best every existing caller had). Runs under
   *  the delivered-only invariant (`runFinalizer`): whatever the finalizer, an undelivered or
   *  invalid child's output stays unreachable. */
  readonly finalizer?: SupervisorFinalizer;
  /** The recorder of this agent's conversation. A wrapper that builds a new driver for each `act`
   *  passes one recorder to all of them, so the agent keeps one transcript across attempts.
   *  @internal Runtime's own wiring between `supervisorAgent` and its router arm. */
  transcript?: RouterTranscript;
  /** Optional shared manager inbox used by a wrapper that must accept messages before async node
   * setup finishes. Ordinary callers omit it and the driver owns a fresh inbox. */
  readonly inbox?: Inbox;
  /**
   * The durable run directory (`SuperviseOptions.runDir` / the `run-layout` event dir) this driver
   * ACKNOWLEDGES worker-scoped cancel requests from. Each turn the driver reads the layout's
   * cancellation inbox once, applies any request naming one of ITS OWN workers through that
   * worker's existing per-child abort (cascading to the worker's subtree and no sibling), and
   * writes the durable {@link WorkerCancellation} acknowledgement: `cancel_requested` when the
   * abort is issued, `cancelled` only when the worker reaches a terminal `down` on the settle
   * path, `not_live` when the worker is already gone — a missing worker never reads as success.
   * Which requests this driver OWNS is set by {@link controlScope}. Omit = no acknowledger
   * (in-memory runs keep in-process control via handles).
   */
  readonly controlDir?: string;
  /** Durable steer directory when it differs from the run-control directory. */
  readonly steerDir?: string;
  /**
   * Which cancel requests this driver's acknowledger owns when `controlDir` is set.
   *
   * `'run'` (the default, and the tree root's role): exact node ids of its OWN direct children,
   * plus every label/profile-name reference. `'subtree'` (a nested manager): exact direct-child
   * node ids ONLY — never labels or profile names, which can match workers under more than one
   * manager. Ownership makes each operation appliable by exactly ONE manager, so two acknowledgers
   * sharing one `controlDir` can never abort two workers for one operation or race on the
   * acknowledgement file. At the end of `act`, the owner writes an expiry record for each owned
   * request still open: `not_live` for one never applied, `unknown` for an abort whose settle the
   * run ended too soon to observe — so a reader can tell run-over from in-progress.
   */
  /** Called with this driver's coordination tool descriptors once they exist and before the brain
   *  loop starts — the seam a node tool uses to call the same verbs in code
   *  (`SupervisorToolInvocationContext.verbs`). */
  readonly onCoordinationTools?: (tools: ReadonlyArray<McpToolDescriptor$1>) => void;
  readonly controlScope?: 'run' | 'subtree';
  /**
   * Abort the WHOLE run — the seam a run-scoped cancel request (`cancelRun`) is applied through.
   * Wired by `supervise()` to the run's ONE cascade controller (the attached root control), so a
   * run cancel takes the same path a caller's `RootHandle.abort` takes; there is no second
   * controller and no poller. Read only by the `'run'`-scoped manager with a `controlDir`; omit
   * and a run-scoped request stays unanswered.
   */
  readonly abortRun?: (reason: string, request?: RunCancelRequest) => void;
}
/**
 * Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
 * `driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.
 */
declare function driverAgent(opts: DriverAgentOptions): Agent<unknown, unknown>;
/** Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's
 *  output (settled `done` AND `valid` — its deliverable check passed). Returns undefined when no
 *  child delivered — an honest "the driver produced nothing", never a high-scoring result that
 *  ran without passing its check (Foreman's 0/18 lesson). `valid` is the single delivery signal,
 *  matching `defaultSelectWinner`'s valid-first rule; the oracle just doesn't fall back to an
 *  unchecked best-effort. The same argmax as the `bestDelivered` finalizer (`pickBestDelivered`);
 *  this direct form serves callers that hold a bare ledger + blob store. */
declare function finalizeBestDelivered(settled: ReadonlyArray<{
  status: string;
  score?: number;
  valid?: boolean;
  outRef?: string;
}>, blobs: ResultBlobStore): Promise<unknown>;
//#endregion
//#region src/runtime/supervise/delegate.d.ts
/** The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`.
 *  A modest token ceiling + a small iteration ceiling — generous enough for a few-worker decompose,
 *  bounded enough that an unsupervised intent cannot run away. Callers override via `opts.budget`. */
declare const defaultDelegateBudget: Budget;
/** Inputs to {@link delegate}. The intent is the first positional arg; everything here is optional
 *  with explicit execution identity, so the common call names one exact supervisor profile. */
interface DelegateOptions<Out = unknown> {
  /** The completion oracle (settled ⟺ delivered) the authored workers settle against. Strongly
   *  recommended — without it the supervisor trusts a worker's self-report. For a code intent,
   *  `patchDelivered()` is the canonical example; for a free-form answer, a content check. */
  readonly deliverable?: DeliverableSpec<Out>;
  /** WHERE the authored workers run — the worker-execution backend (`router-tools` / `sandbox` /
   *  `cli-worktree` / …). The supervisor authors the worker PROFILE; this is the substrate it runs
   *  on. Provide this OR `makeWorkerAgent`-style wiring through `supervise()` is unavailable. */
  readonly backend?: ExecutorConfig;
  /** The conserved compute pool for the whole delegation. Defaults to {@link defaultDelegateBudget}. */
  readonly budget?: Budget;
  /** Exact executable authoring supervisor. Model, prompt, harness, and provider live here. */
  readonly supervisorProfile: SupervisorProfile;
  /** Router endpoint/auth for a `cli-base` supervisor; contains no behavioral settings. */
  readonly router: RouterTransportConfig;
  /** Restrict the run to this subset of models (forwarded to `supervise()`). */
  readonly allowedModels?: readonly string[];
  readonly runId?: string;
}
/**
 * Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged.
 *
 * The supervisor authors + spawns whatever worker the intent needs over the conserved-budget pool;
 * `result.spentTotal` reports what the whole delegation actually cost. A `winner` result carries the
 * authored worker's delivered output; a `no-winner` result names why (never a fabricated success).
 */
declare function delegate<Out = unknown>(intent: string, opts: DelegateOptions<Out>): Promise<SupervisedResult<Out>>;
//#endregion
//#region src/runtime/supervise/dispatch.d.ts
/** One unit of queued work: the agent to run, its task, and the spawn options (budget + label).
 *  `nextUnit` mints these lazily so a queue can be generated, re-ordered, or grown while the
 *  dispatcher runs. */
interface DispatchUnit<Out> {
  readonly agent: Agent<unknown, Out>;
  readonly task: unknown;
  readonly opts: SpawnOpts;
}
/** Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end);
 *  `not-admitted` = the conserved pool or the depth ceiling refused a spawn; `stopped` = the
 *  caller's `shouldStop` returned true; `aborted` = the scope's signal fired. */
type DispatchStopReason = 'drained' | 'not-admitted' | 'stopped' | 'aborted';
interface RollingDispatchOptions<Out> {
  /**
   * How many children to hold in flight. Must be a positive integer. This is a SIMULTANEITY fence
   * only — the conserved pool still bounds total work, and a `width` larger than the pool can
   * afford simply hits `not-admitted` sooner.
   */
  readonly width: number;
  /**
   * Produce the next unit of work, or `undefined` when the queue is dry. Called only when a slot
   * is free, so a caller may compute the next unit from what has already settled (the point of a
   * refilling dispatcher: the queue is allowed to react). Never called after a stop.
   */
  nextUnit(): DispatchUnit<Out> | undefined | Promise<DispatchUnit<Out> | undefined>;
  /**
   * Called once per settlement, in cursor order, BEFORE the freed slot is refilled — so an
   * `onSettled` that appends to the caller's queue is visible to the very next `nextUnit`.
   */
  onSettled?(settled: Settled<Out>): void | Promise<void>;
  /**
   * Consulted before each admission. `true` stops admitting; the already-live children are still
   * drained to completion (no orphan, no lost settlement). Use it for a progress/plateau rule.
   */
  shouldStop?(): boolean;
}
interface DispatchReport<Out> {
  /** Every settlement, in the order `scope.next()` yielded them. */
  readonly settled: ReadonlyArray<Settled<Out>>;
  /** How many children this dispatcher admitted. */
  readonly admitted: number;
  /** Admission rejections, in order — `label: reason`. Non-empty ⇒ the pool or depth fenced. */
  readonly rejected: ReadonlyArray<string>;
  readonly stopReason: DispatchStopReason;
  /** The highest simultaneous live count actually reached — the number to compare against
   *  `width` when asking "did the slots really stay full?" */
  readonly peakLive: number;
}
/**
 * Run the refilling dispatch loop over `scope` until the queue is dry (or a stop fires) and every
 * admitted child has settled. Returns the settlements in cursor order plus the admission ledger.
 *
 * The loop is: fill free slots from `nextUnit` → `await scope.next()` → deliver the settlement →
 * refill → repeat. Because the refill happens immediately after each settlement rather than after
 * a whole round, a slow child never idles the other slots.
 */
declare function rollingDispatch<Out>(scope: Scope<Out>, opts: RollingDispatchOptions<Out>): Promise<DispatchReport<Out>>;
/**
 * Free worker slots under a simultaneity cap: `cap - live`, floored at 0, or `null` when there is
 * no cap (the conserved pool is then the only fence and "free slots" is not a finite number).
 * The one place the answer is computed, so the driver-facing tool payload and a dispatcher agree.
 */
declare function freeSlots(liveCount: number, cap: number | undefined): number | null;
/** Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where
 *  the queue is known up front and only the refill behavior is wanted. */
declare function queueOf<Out>(units: ReadonlyArray<{
  agent: Agent<unknown, Out>;
  task: unknown;
  label: string;
}>, budget: Budget): () => DispatchUnit<Out> | undefined;
//#endregion
//#region src/runtime/supervise/prompt-registry.d.ts
/**
 *
 * The kernel prompt registry — versioned prompt text as DATA, addressed by `PromptHandle`.
 *
 * A role expressed as a builder FUNCTION is a role that can never improve: the only optimizable
 * surface it leaves is whatever thin string a caller happens to inject, while the real doctrine
 * sits hardcoded in TypeScript. This registry is the inverse: every standing instruction is a
 * versioned entry (`<surface>` + `v<n>`), so a graph edge, a supervisor front door, or an
 * optimizer names a handle and the TEXT is swappable, sweepable, and diffable without a code
 * change. Graph edges (`runGraph`) carry handles, never inline prose.
 *
 * A profile or graph may opt into one of these versioned texts. Runtime does not select a standing
 * supervisor policy when the profile omits one.
 *
 * @experimental
 */
/** A versioned reference into a prompt registry: `surface` names the role/edge the text serves,
 *  `version` pins the exact text. The string form is `<surface>/v<n>` (e.g. `delegates/worker-brief/v1`). */
interface PromptHandle {
  readonly surface: string;
  readonly version: number;
}
/** One registry entry: the handle plus the text it pins. */
interface RegisteredPrompt {
  readonly surface: string;
  readonly version: number;
  readonly text: string;
  /** What the surface is FOR — shown by `list()`, never sent to a model. */
  readonly description?: string;
}
/** Versioned prompt store. `resolve` fails loud on an unknown handle: a directive that silently
 *  resolved to nothing is the unobservable-edge failure this whole design exists to end. */
interface PromptRegistry {
  resolve(handle: PromptHandle): RegisteredPrompt;
  /** Register a new entry; a duplicate (surface, version) fails loud — versions are immutable. */
  register(entry: RegisteredPrompt): void;
  list(): ReadonlyArray<RegisteredPrompt>;
}
/**
 * Parse `'<surface>/v<n>'` into a {@link PromptHandle}. The shorthand for authoring a graph edge:
 * `directive: promptHandle('delegates/worker-brief/v1')`.
 */
declare function promptHandle(ref: string): PromptHandle;
/** The string form of a handle: `<surface>/v<n>`. */
declare function formatPromptHandle(handle: PromptHandle): string;
/** Create a registry, optionally seeded. Entries are copied; the registry never aliases caller state. */
declare function createPromptRegistry(seed?: ReadonlyArray<RegisteredPrompt>): PromptRegistry;
/**
 * Default DELEGATES-edge directive: the standing instruction a worker receives with every
 * traversal of a delegates edge that names this surface.
 */
declare const delegatesWorkerBriefPrompt: RegisteredPrompt;
/**
 * Default ANALYZES-edge directive: what the RECEIVING node should do with an analyst's findings.
 * Wrapped around the findings payload on every traversal of an analyzes edge naming this surface.
 */
declare const analyzesFindingsReportPrompt: RegisteredPrompt;
/**
 * Default NAIVE steering continuation — the no-signal control re-expressed as data: the same
 * fixed continuation every round, reading nothing from any verdict.
 */
declare const naiveContinuationPrompt: RegisteredPrompt;
/**
 * Default DUMB steering continuations — the pass/fail-only control re-expressed as data: two
 * fixed texts keyed on the verdict's boolean and nothing else.
 */
declare const dumbContinuationFailPrompt: RegisteredPrompt;
/** The pass branch of the dumb steering control — see {@link dumbContinuationFailPrompt}. */
declare const dumbContinuationPassPrompt: RegisteredPrompt;
/** The kernel's seeded registry: every surface the runtime's own builders derive from. A caller
 *  may register additional surfaces/versions on the returned registry. */
declare function kernelPromptRegistry(): PromptRegistry;
//#endregion
//#region src/runtime/supervise/graph.d.ts
/** A graph node: an id and a canonical `AgentProfile`. The profile is the ONLY way a node is
 *  described — its `prompt.systemPrompt` is the standing role (the 0.117 canonical resolution;
 *  never a legacy top-level-only reduction), its tools/mcp/resources are its capabilities. */
interface GraphNode {
  readonly id: NodeId;
  readonly profile: AgentProfile;
}
type GraphEdge =
/** Work flows down. The delegation directive is DATA → versionable, sweepable, optimizable.
 *  Each spawn of `to` by `from` — and each mid-run steer from `from` to a live `to` worker —
 *  is one traversal. */
{
  readonly kind: 'delegates';
  readonly from: NodeId;
  readonly to: NodeId;
  readonly directive: PromptHandle;
  /** Cyclic-graph backstop: traversals beyond this REFUSE (fail loud). Default
   *  {@link defaultEdgeTraversalCap}. */
  readonly maxTraversals?: number;
  /** Default continuity for this edge's SPAWN traversals. `'resume'` makes every spawn after
   *  the node's first re-attach to its most recent SETTLED worker: a NEW live worker whose
   *  spawn context carries `resume: { ofWorker, sequence }` for the executor seam, spending
   *  from the same conserved pool — the node's first spawn is effectively `'fresh'`, and a
   *  spawn while a prior worker is still live refuses loudly (steer is the live channel).
   *  The driver's per-call `spawn_worker` `continuity` argument overrides either way. Omit =
   *  `'fresh'` (today's behavior, byte-identical). Caps count resumes exactly like fresh
   *  spawns. */
  readonly continuity?: ContinuityMode;
} |
/** Findings flow anywhere: an analyst over N nodes' settled traces, delivered to ONE node.
 *  With a LENS analyst the directive wraps the findings for the recipient; with a NODE analyst
 *  the directive is the analyst agent's task and the findings are its settle output. */
{
  readonly kind: 'analyzes';
  /** The analyst REFERENCE, in one of two forms: a lens id resolved against
   *  `RunGraphOptions.analysts` (environment), or the id of a graph NODE with no delegates
   *  edge pointing at it — then each matching settle spawns that node's pinned profile as a
   *  tool-equipped analyst WORKER (same spawn machinery, conserved budget, trace join) whose
   *  task is this edge's directive plus the settled worker's trace evidence and whose settle
   *  output is the findings. An id that is both a node and a registry lens is refused. */
  readonly analyst: string;
  readonly over: ReadonlyArray<NodeId>;
  readonly to: NodeId;
  readonly directive: PromptHandle;
  /** Observability cap: traversals beyond this are LEDGERED as exhausted (`unpropagated`).
   *  Only delegates caps refuse traversal — they are what close the spawn cycle. */
  readonly maxTraversals?: number;
};
interface AgentGraph {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
  /** Termination is mandatory, not optional: the independent completion oracle. */
  readonly deliverable: DeliverableSpec<unknown>;
  /** One conserved pool across the whole graph — cycles without conservation never terminate. */
  readonly budget: Budget;
}
type EdgeDeliveryOutcome = 'delivered' | 'stripped' | 'empty' | 'unpropagated';
/** How one ledgered hop CONTINUED: a spawn traversal stamps its effective spawn mode
 *  (`'fresh'` | `'resume'`), and every mid-run delivery into an already-live recipient — a
 *  driver steer leg and every analyzes delivery (routed steer or driver-destined finding) —
 *  stamps `'steer'`. Zero ambiguity: every row carries exactly one of the three. */
type TraversalContinuity = ContinuityMode | 'steer';
/** One recorded edge traversal — the in-memory row; the journal twin is the `edge` SpawnEvent. */
interface EdgeTraversal {
  /** Stable edge id: `delegates:<from>-><to>` or `analyzes:<analyst>:<over…>-><to>`. */
  readonly edge: string;
  readonly kind: 'delegates' | 'analyzes';
  readonly from: string;
  readonly to: string;
  /** The resolved directive reference (`<surface>/v<n>`). */
  readonly directive: string;
  /** 1-based per-edge ordinal. */
  readonly traversal: number;
  readonly outcome: EdgeDeliveryOutcome;
  /** How this hop continued — see {@link TraversalContinuity}. */
  readonly continuity: TraversalContinuity;
  /** Bytes of directive + payload that actually crossed the edge. */
  readonly bytes: number;
  readonly reason?: string;
  /** The concrete worker node id, once known. */
  readonly workerId?: string;
}
/** Default per-edge traversal cap — the cyclic-graph backstop when an edge names none. */
declare const defaultEdgeTraversalCap = 32;
/** A delegates edge exhausted its traversal cap and the run produced no winner: the cap, not the
 *  task, ended it. Carries the full evidence so failing loud loses nothing. */
declare class GraphEdgeCapError extends Error {
  readonly exhaustedEdges: ReadonlyArray<string>;
  readonly ledger: ReadonlyArray<EdgeTraversal>;
  readonly result: SupervisedResult<unknown>;
  constructor(exhaustedEdges: ReadonlyArray<string>, ledger: ReadonlyArray<EdgeTraversal>, result: SupervisedResult<unknown>);
}
/**
 * Forwarded to the root `supervise()` VERBATIM. Everything not owned, transformed, or refused
 * above belongs here — the default is "a graph honors it", not "someone remembered to add it".
 */
declare const GRAPH_FORWARDED_SUPERVISE_OPTIONS: readonly ["backend", "profileGuidance", "escalateQuestion", "rootHandle", "signal", "execution", "resolveDeliverable", "coordination", "peerMail", "driverBackend", "profileSecurity", "authorizeSpawn", "router", "driveHarness", "driverRetry", "onDriverAttempt", "workerRetry", "onWorkerRetry", "continuation", "childSettleGraceMs", "teardownConfirmMs", "retainedAtSettlement", "resolveDriveHarness", "driveHarnessMaterialization", "resolveSupervisorTools", "extraTools", "executeExtraTool", "recoverExecutor", "perWorker", "reservationPolicy", "workerSlots", "watchWorkers", "stallAfterMs", "awaitTimeoutMs", "runDir", "resume", "runContext", "steerDir", "probes", "stopRule", "onProgressStop", "maxDepth", "maxTurns", "compaction", "now", "allowedModels", "finalizer", "otel"];
/** `backend` and `driverBackend` keep graph-specific documentation below.
 *
 * Do not inherit and redeclare them through an indexed access type.
 * TypeScript 7 correctly treats `SuperviseOptions['backend']` as including `undefined`, which makes
 * that redeclaration wider than the exact optional property inherited from `SuperviseOptions`.
 */
type GraphInheritedSuperviseOption = Exclude<(typeof GRAPH_FORWARDED_SUPERVISE_OPTIONS)[number], 'backend' | 'driverBackend'>;
/**
 * Options for one `runGraph` run.
 *
 * Extends every forwarded `SuperviseOptions` key, so a graph honors what a `supervise()` run
 * honors WITHOUT anyone restating it here. Only the graph-specific members and the ones whose
 * graph semantics differ are declared below; everything else inherits its type AND its
 * documentation from `SuperviseOptions`, which is the one owner of both.
 */
interface RunGraphOptions extends Pick<SuperviseOptions, GraphInheritedSuperviseOption> {
  /** WHERE worker nodes run — the executor backend. Provide this OR `makeLeafAgent`. Forwarded to
   *  `supervise()`, which derives every authorized leaf from it. A node that declares
   *  `agent_runtime_coordination_spawn_worker` becomes a nested supervisor instead, whose own
   *  leaves are derived the same way. */
  readonly backend?: Exclude<SuperviseOptions['backend'], undefined>;
  /** WHERE the ROOT node's harness brain runs — forwarded to `supervise()` verbatim (see
   *  `SuperviseOptions.driverBackend`). Needed when the root node's profile declares an external
   *  harness (`codex`, `claude-code`, `opencode`): that root is driven by the harness, not by the
   *  router brain, and automatic execution supports a local `bridge`. Unlike `supervise()`, this
   *  does NOT default to `backend`: a graph's `backend` places WORKER nodes, so the root driver
   *  is selected only by this field. Omit = no harness driver, which is correct for a root whose
   *  `profile.harness` is omitted or `cli-base` (that root runs on the router brain). */
  readonly driverBackend?: Exclude<SuperviseOptions['driverBackend'], undefined>;
  /** Leaf-execution override (offline tests / advanced). `runGraph` still owns node pinning,
   *  directive delivery, and the edge ledger AROUND this seam — only the leaf `act` is yours.
   *  Slots INSIDE the kernel's authorized path (`SuperviseOptions.makeLeafAgent`), so a node that
   *  declares the spawn tool still becomes a nested supervisor even under an offline leaf. */
  readonly makeLeafAgent?: MakeWorkerAgent;
  /** The ROOT driver's inference seam — a caller-owned `ToolLoopChat` that makes every root
   *  model call. Use it when the root's decisions must be caller-owned orchestration (a
   *  deterministic conversation driver, a persona loop with its own LLM calls) rather than a
   *  router-derived model call. The graph machinery around the seam is unchanged: node pinning,
   *  directive delivery, the edge ledger, and the journal twin all run the same shipped path,
   *  and the root profile keeps prompt control (`prompt-control-execution` materialization —
   *  `systemPrompt`/`instructions` still apply). What moves to the caller with the brain:
   *  model selection and provider-identity validation (`expectedModel` cannot be enforced on a
   *  call the runtime did not place) and per-turn usage reporting (a brain that reports no
   *  usage meters nothing into the pool). Omit = the router brain derived from the root
   *  profile — the unchanged default. Mutually exclusive with `driverBackend`, and refused
   *  when the root profile declares an external harness (that root is driven BY the harness). */
  readonly brain?: ToolLoopChat;
  /** Caller-side runtime hooks (telemetry, policy, product extensions). Composed AFTER the
   *  graph's own spawn-binding hook on the SAME event stream — the graph never swallows the
   *  seam supervise() exposes. */
  readonly hooks?: RuntimeHooks;
  /** The analyst lens registry `analyzes` edges resolve against. ENVIRONMENT — needed only for
   *  lens analysts; an analyzes edge naming a graph NODE as its analyst needs no registry. */
  readonly analysts?: AnalystRegistry$1;
  /** Directive registry. Default: the seeded kernel registry (`kernelPromptRegistry()`).
   *
   *  NOT `SuperviseOptions.registry`, which is the `SuperviseRegistry` name→value table for
   *  code-valued options. The two share a name and nothing else, and this one wins here — see
   *  `GRAPH_REFUSED_SUPERVISE_OPTIONS`. */
  readonly registry?: PromptRegistry;
  /** The run journal the edge ledger and every spawn/settle ride. Default: in-memory. */
  readonly journal?: SpawnJournal;
  readonly blobs?: ResultBlobStore;
  readonly runId?: string;
  /** Product authority over every steer/answer instruction (the filter seam). `runGraph` observes
   *  what it CHANGES: a narrowed instruction ledgers its steer traversal as `stripped`. */
  readonly authorizeMessage?: SuperviseOptions['authorizeMessage'];
}
interface GraphResult<Out = unknown> {
  readonly result: SupervisedResult<Out>;
  /** Every edge traversal, in occurrence order — the observable-edge contract. */
  readonly ledger: ReadonlyArray<EdgeTraversal>;
  /** Edge ids whose traversal cap was hit — analyzes exhaustion included (observable here, never
   *  a refusal). A DELEGATES cap paired with a `no-winner` result THROWS
   *  ({@link GraphEdgeCapError}) instead of returning: only delegates caps refuse spawns, so only
   *  they can have ended the run. A LIFECYCLE no-winner (`aborted` / `budget-exhausted`) returns
   *  normally even with an exhausted delegates cap — the abort or the pool, not the cap, ended
   *  that run, and the exhaustion stays observable here. */
  readonly exhaustedEdges: ReadonlyArray<string>;
  readonly runId: string;
}
/** `RunGraphOptions` with the brain REQUIRED — the shape the `/testing` entry's
 *  `runGraphWithTestBrain` keeps accepting now that `brain` is a production option. */
interface RunGraphTestOptions extends RunGraphOptions {
  readonly brain: ToolLoopChat;
}
/**
 * Execute an {@link AgentGraph}. The root node becomes the supervisor (`supervise()` — the
 * execution core), each worker node is spawnable BY NODE ID (`spawn_worker` with
 * `profile: { name: '<node id>' }`; the node's canonical profile is pinned by the graph), each
 * delegates directive is appended to the worker profile's `prompt.instructions` per traversal,
 * and each analyzes edge becomes an analyst-on-settle route with a real DESTINATION. Every
 * traversal is ledgered and journaled.
 */
declare function runGraph(graph: AgentGraph, opts: RunGraphOptions): Promise<GraphResult>;
/** Alias for graph tests written before `RunGraphOptions.brain` was production. The production
 *  entry accepts the same shape; this wrapper only keeps the `/testing` import path working. */
declare function runGraphWithTestBrain(graph: AgentGraph, opts: RunGraphTestOptions): Promise<GraphResult>;
//#endregion
//#region src/runtime/supervise/in-place-cli-executor.d.ts
/** @experimental */
interface InPlaceCliExecutorOptions {
  /** Absolute path to the EXISTING directory the harness edits. The caller owns its lifecycle:
   *  this leaf never creates it, never cleans it, and never removes it at teardown. */
  workspacePath: string;
  /**
   * The supervisor-authored prompt/model plus materializable structural resources.
   * `model.default` selects the one-shot model. Routing-only model hints, placement concerns,
   * provider extensions, and `resources.failOnError` fail before execution because this path
   * cannot honor them. Harness-specific values the materializer cannot preserve also fail closed.
   */
  profile: AgentProfile;
  /** Default instruction for direct `execute(undefined, signal)` calls. An execution-time task
   *  is authoritative. Omit when the caller always supplies the task to `execute`. */
  taskPrompt?: string;
  /** Optional wall-clock cap per harness subprocess (ms). Omit it for no timer. */
  harnessTimeoutMs?: number;
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness;
  /** @internal Kernel-minted attempt identity threaded by the built-in registry. */
  executionAttemptId?: string;
}
/**
 * Build an in-place CLI leaf `Executor`. Per-spawn, but NOT per-workspace: repeated spawns against
 * the same `workspacePath` run in the same directory on purpose, each seeing what the last one
 * wrote.
 *
 * Fail-loud: an empty `workspacePath`, an incomplete/unsupported profile, a separate harness
 * override, or an explicitly empty `taskPrompt` throws at construction. A `workspacePath` that is
 * not an existing directory throws before the harness launches. `resultArtifact()` before
 * `execute()` resolves throws.
 *
 * @experimental
 */
declare function createInPlaceCliExecutor(options: InPlaceCliExecutorOptions): Executor<InPlaceHarnessResult>;
//#endregion
//#region src/runtime/supervise/interactive-admission.d.ts
/** The credential-free record written for one interactive admission phase. */
type WorkerInteractiveAdmission = {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly recordedAt: string;
  readonly phase: 'interactive_intent';
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly interactiveIdempotencyKey: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly runId: string;
  readonly requestedProfileDigest: `sha256:${string}`;
  readonly requestDigest: `sha256:${string}`;
} | {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly recordedAt: string;
  readonly phase: 'interactive_environment';
  readonly provider: string;
  readonly environmentId: string;
  readonly idempotencyKey: string;
  readonly interactiveIdempotencyKey: string;
  readonly requestDigest: `sha256:${string}`;
} | {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly recordedAt: string;
  readonly phase: 'interactive_started';
  readonly idempotencyKey: string;
  readonly interactiveIdempotencyKey: string;
  readonly ref: AgentInteractiveSessionRef;
  readonly refDigest: `sha256:${string}`;
};
/** Return the exact credential-free admission file for one worker and phase. */
declare function workerInteractiveAdmissionFile(eventDir: string, workerId: string, phase: WorkerInteractiveAdmission['phase']): string;
/** Read all durable admissions for one worker, oldest phase first. */
declare function readWorkerInteractiveAdmissions(eventDir: string, workerId: string): ReadonlyArray<WorkerInteractiveAdmission>;
//#endregion
//#region src/runtime/supervise/interactive-worker.d.ts
/** Environment fields supplied to every interactive worker after Runtime adds the exact profile. */
type InteractiveWorkerEnvironment = Omit<CreateAgentEnvironmentInput, 'profile' | 'idempotencyKey' | 'signal'>;
/** Native interactive worker output. Provider usage is intentionally not fabricated. */
interface InteractiveWorkerResult {
  readonly provider: string;
  readonly environmentId: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly state: 'exited' | 'unknown';
  readonly ref: AgentInteractiveSessionRef;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly exitSignal?: string;
}
/** Configuration shared by every worker produced by `workerFromInteractiveProvider`. */
interface InteractiveWorkerOptions {
  /** Provider create fields. Runtime supplies `profile`, the two idempotency keys, and `signal`. */
  readonly environment?: InteractiveWorkerEnvironment;
  /** Stable environment identity override. Defaults to a digest of the exact worker assignment. */
  readonly environmentIdempotencyKey?: (input: InteractiveWorkerKeyInput) => string;
  /** Stable interactive-session identity override. Defaults to a digest of assignment and task. */
  readonly interactiveIdempotencyKey?: (input: InteractiveWorkerKeyInput) => string;
  /** Provider holder id used only while the worker sends a steer or stop command. */
  readonly holderId?: string | ((input: InteractiveWorkerKeyInput) => string);
  /** Initial prompt override. The exact worker task is the default prompt. */
  readonly initialPrompt?: string | ((task: unknown, input: InteractiveWorkerKeyInput) => string);
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
  /** Runtime tag written into tree snapshots. Defaults to the provider name. */
  readonly runtime?: Runtime;
  /** Poll delay used while waiting for the provider's native process to exit. */
  readonly pollIntervalMs?: number;
  /** Destroy the provider environment after the process is terminal. Defaults to true. */
  readonly destroyEnvironmentOnTeardown?: boolean;
}
/** Stable input available to key and holder functions. */
interface InteractiveWorkerKeyInput {
  readonly provider: string;
  readonly profile: AgentProfile;
  readonly context?: WorkerSpawnContext;
  readonly task?: unknown;
  readonly nodeId?: string;
}
/**
 * Build a `MakeWorkerAgent` that starts one exact provider-owned native TUI per worker.
 *
 * A Scope supplies the durable admission hook and kernel-minted node attempt. The returned worker
 * exposes `interactiveReady`, so Scope writes the exact provider reference before the worker can be
 * attached by a different process. `attachWorker` then reconnects that same reference through the
 * provider's public `get`/interactive contract.
 */
declare function workerFromInteractiveProvider(provider: AgentEnvironmentProvider, options?: InteractiveWorkerOptions): MakeWorkerAgent;
//#endregion
//#region src/runtime/supervise/patch-checks.d.ts
/** @experimental The per-task constraints the mechanical gate enforces. */
interface CoderCheckConstraints {
  /** Default 400. Hard cap; gate fails when exceeded. */
  maxDiffLines?: number;
  /** Literal path prefixes the patch must not touch. */
  forbiddenPaths?: string[];
}
//#endregion
//#region src/runtime/supervise/worktree-cli-executor.d.ts
/** Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured
 *  diff + the harness's run record + the derived checks). */
type WorktreePatchArtifact = WorktreeHarnessResult;
/** @experimental */
interface WorktreeCliExecutorOptions {
  /** Absolute path to the git checkout the worktree is cut from. */
  repoRoot: string;
  /**
   * The supervisor-authored prompt/model plus materializable structural resources.
   * `model.default` selects the one-shot model. Routing-only model hints, placement concerns,
   * provider extensions, and `resources.failOnError` fail before execution because this path
   * cannot honor them. Harness-specific values the materializer cannot preserve also fail closed.
   */
  profile: AgentProfile;
  /** Default instruction for direct `execute(undefined, signal)` calls. An execution-time task
   *  is authoritative. Omit when the caller always supplies the task to `execute`. */
  taskPrompt?: string;
  /** Unique id for the worktree path + branch. Defaults to a fresh UUID. */
  runId?: string;
  /** Override the base ref the worktree is cut from (default `HEAD`). */
  baseRef?: string;
  /** Optional wall-clock cap per harness subprocess (ms). Omit it for no timer. */
  harnessTimeoutMs?: number;
  /** Run Codex with an ephemeral session, isolated config/instructions, network disabled, and
   *  JSONL usage capture. Requires `profile.harness: 'codex'`; metered by default. */
  codexReproducible?: boolean;
  /** Absolute host paths denied to reproducible Codex (for benchmark answer copies, credentials,
   *  or other task-specific ambient state). */
  codexReadDeniedPaths?: ReadonlyArray<string>;
  /**
   * Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
   * Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).
   */
  testCmd?: string;
  /** Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`). */
  typecheckCmd?: string;
  /** Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min. */
  checkTimeoutMs?: number;
  /** Cap on each check's captured output. Default 16k. */
  checkOutputCap?: number;
  /** Test seam — inject a git runner so unit tests drive the worktree helpers without git. */
  runGit?: GitRunner;
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness;
  /** Test seam — inject the verification-command runner so unit tests script test/typecheck
   *  outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree. */
  runCommand?: WorktreeCheckRunner;
  /**
   * Exclude this leaf's spend from accounting. Defaults to `true` for ordinary CLI runs and
   * `false` for `codexReproducible`, which captures real token usage. A metered custom runner must
   * likewise return `LocalHarnessResult.usage`.
   */
  budgetExempt?: boolean;
  /** @internal Kernel-minted attempt identity threaded by the built-in registry. */
  executionAttemptId?: string;
}
/**
 * Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a
 * fanout of N profiles = N parallel worktrees that never clobber each other.
 *
 * Fail-loud: an empty `repoRoot`, an incomplete/unsupported profile, a separate harness override,
 * or an explicitly empty `taskPrompt` throws at construction. Calling `execute(undefined, signal)`
 * without a configured prompt throws before a worktree is created. `resultArtifact()` before
 * `execute()` resolves throws.
 *
 * @experimental
 */
declare function createWorktreeCliExecutor(options: WorktreeCliExecutorOptions): Executor<WorktreePatchArtifact>;
//#endregion
//#region src/runtime/supervise/patch-deliverable.d.ts
/** @experimental */
interface PatchDeliverableOptions extends CoderCheckConstraints {
  /**
   * Which verification signals the gate REQUIRES to be present-and-passing. A required signal
   * that the artifact never derived (the command was not configured on the executor) fails the
   * gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
   * that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.
   */
  require?: ReadonlyArray<'tests' | 'typecheck'>;
}
/**
 * Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical
 * gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals and returns
 * whether the patch is DELIVERED (the `valid` conjunction).
 *
 * @experimental
 */
declare function patchDelivered(options?: PatchDeliverableOptions): DeliverableSpec<WorktreePatchArtifact>;
//#endregion
//#region src/runtime/supervise/provision-supervisor.d.ts
/** Caller-supplied provider or Sandbox SDK connection for one supervisor run. */
interface ProvisionSupervisorConnection {
  /** A fully constructed provider. This is the preferred programmatic seam and is testable. */
  readonly provider?: AgentEnvironmentProvider;
  /** A Sandbox SDK-compatible client. Runtime adapts it to the public provider contract. */
  readonly client?: SandboxClient;
  /** Alias for `client`, accepted so callers can pass their existing connection object. */
  readonly sandboxClient?: SandboxClient;
  /** Sandbox API endpoint used only when Runtime constructs the SDK client. */
  readonly endpoint?: string;
  /** Transient Sandbox API key used only when Runtime constructs the SDK client. */
  readonly apiKey?: string;
  /** Connection kind is descriptive only and does not select a hidden implementation. */
  readonly kind?: string;
}
/** Input to the public Runtime supervisor provisioner. */
interface ProvisionSupervisorRequest {
  readonly invocationId: string;
  /** Caller-owned task assigned to the first interactive worker. */
  readonly task: string;
  /** Canonical profile assigned to the first interactive worker. */
  readonly profile: AgentProfile;
  /** Generic provider create fields forwarded to the interactive worker. */
  readonly workerEnvironment?: InteractiveWorkerEnvironment;
  /** Root directory for Runtime-owned `.agent/supervisor` state. */
  readonly workspaceDir?: string;
  /** Maximum wall-clock time for the complete supervisor lifecycle, including cleanup. Omit for no lifecycle deadline. */
  readonly timeoutMs?: number;
  /** Poll cadence for lifecycle/control readiness. */
  readonly pollMs?: number;
  /** Explicit provider, client, or endpoint and API key for one provider connection. */
  readonly connection: ProvisionSupervisorConnection;
}
/** Exact owner-scoped cleanup receipt returned after Runtime releases the run resources. */
interface SupervisorCleanupReceipt {
  readonly status: 'completed';
  readonly rootDir: string;
  readonly supervisorId: string;
  readonly workerId: string;
  readonly supervisorStatus: string;
  readonly workerStatus: 'running' | 'done' | 'down' | 'cancelled';
  readonly resourcesReleased: true;
  readonly remainingResources: readonly [];
}
/** Handles for one Runtime-owned supervisor and its first interactive worker. */
interface ProvisionedSupervisor {
  readonly rootDir: string;
  readonly supervisorId: string;
  readonly workerId: string;
  /** Provider source for `attachWorker`; omitted only when resolution did not produce one. */
  readonly providers?: AgentEnvironmentProvider;
  /** Capability-derived terminal takeover requirement. */
  readonly terminalTakeover: 'required' | 'unsupported' | 'unspecified';
  cleanup(): Promise<SupervisorCleanupReceipt>;
}
/**
 * Provision one real provider-backed worker and keep its owning manager alive for controls.
 *
 * The root manager does not use a model. It runs the same coordination tools used by a driver in a
 * small deterministic loop, so durable steer and cancel requests are acknowledged by the owning
 * Runtime turn loop and never by a test-only shortcut. The caller owns profile, task, and provider
 * connection selection; Runtime does not infer them from process environment variables.
 */
declare function provisionSupervisor(request: ProvisionSupervisorRequest): Promise<ProvisionedSupervisor>;
//#endregion
//#region src/runtime/supervise/run-context-sql.d.ts
interface SqlRunContext {
  readonly journal: SpawnJournal;
  readonly blobs: ResultBlobStore;
  readonly executors: ExecutorRegistry;
  /** Always `true` — a SQL context is durable by construction, so runs resume-first. */
  readonly resume: true;
}
/** Build a durable run context over one SQL statement seam. Tables are created on first use. */
declare function createSqlRunContext(db: SqlStatements): SqlRunContext;
//#endregion
//#region src/runtime/supervise/scope.d.ts
/** Construction args for `createScope`. The supervisor threads the shared pool, journal,
 *  blob store, and executor registry through; `depth`/`maxDepth` pair the runtime
 *  recursion ceiling with the conserved pool (R3). */
interface ScopeArgs {
  /** This scope's owning node id — children get `${parentId}:s${seq}` ids. */
  readonly parentId: NodeId;
  /** Journal/blob root key the supervisor `beginTree`'d. */
  readonly root: NodeId;
  /** The reservation pool for this scope: the root total or one nested allocated partition. */
  readonly pool: BudgetPool;
  /** Append-only spawn journal; this scope writes `spawned` + `settled` records. */
  readonly journal: SpawnJournal;
  /** Content-addressed result store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore;
  /** The open executor resolver (BYO → router/inline → registered harness factory). */
  readonly executors: ExecutorRegistry;
  /** Predicate resolver for `poll` wait-states. Absent ⇒ `wait` refuses a `poll` with
   *  `unknown-probe`; `timer` waits never touch it. */
  readonly probes?: WaitProbeRegistry;
  /** Injected sleeper for wait-states — a test drives a week-long timer in microseconds. */
  readonly waitSleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Per-spawn executor-construction seams (sandbox client, router config, cli bin). */
  readonly seams: Readonly<Record<string, unknown>>;
  /** This scope's recursion depth (root = 0). */
  readonly depth: number;
  /** Runtime recursion-depth ceiling — a spawn past it fails closed `depth-exceeded`. */
  readonly maxDepth?: number;
  /** The allocator that bounds concurrently working agents across this scope, every nested scope,
   *  and every other tree that shares it. Absent means no bound: only the budget limits concurrency. */
  readonly workerSlots?: WorkerSlots;
  /** @internal The slot this scope's own manager holds in its parent scope. A nested scope's first
   *  running child works on it while the manager waits. Absent on a root scope. */
  readonly slotOwner?: SlotPermit;
  /** Optional policy that keeps part of each manager's budget for its own inference. */
  readonly reservationPolicy?: RecursiveReservationPolicy;
  /** The budget from which this scope's owner-share floor is derived. */
  readonly ownerBudget?: Budget;
  /** Abort signal for this scope; an abort cascades into every live child's executor. */
  readonly signal: AbortSignal;
  /** Injected clock — keeps the journal `at` timestamp deterministic in tests. */
  readonly now?: () => number;
  /** Lifecycle stream sink. `spawn` emits `agent.spawn`, `next` emits `agent.child` — the
   *  SAME stream `runAgentRounds`/`tool-loop` feed, so the recursive tree is ONE observable stream
   *  (the topology viewer reads it). Undefined ⇒ the journal stays the only record. */
  readonly hooks?: RuntimeHooks;
  /**
   * Trace context to hand down to each spawned worker (`SupervisorOpts.workerTrace`). Called with
   * THIS scope's own `parentId` — the node doing the spawning — and the resolved context is seeded
   * onto each child's `ExecutorContext` under `workerTraceSeamKey`. Absent (the untraced default)
   * ⇒ no seam is seeded and no worker environment is touched.
   */
  readonly workerTrace?: WorkerTraceResolver;
  /**
   * Present when this run RECORDS spans but the worker backend has NO channel to carry the trace
   * context (`WORKER_TRACE_PROPAGATION[backend] === false` — cli-worktree has no env
   * channel; router / router-tools / provider have no worker process). Each spawn then journals a
   * `trace-unpropagated` event naming the severed hop, so a child whose trace shows up as a
   * disconnected root is a recorded fact rather than a silent stranger. Absent ⇒ either the run
   * is untraced or the backend propagates; nothing is journaled.
   */
  readonly workerTraceUnpropagated?: {
    readonly backend: string;
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted';
  };
  /** Durable run directory that receives exact worker interactive bindings. */
  readonly interactiveBindingDir?: string;
  /** @internal Trusted root-adapter publication channel. It is never exposed as a Scope method. */
  readonly ownerMaterialization?: {
    readonly runtime: NodeSnapshot['runtime'];
    readonly authoredProfile?: unknown;
    readonly attemptId: string;
    readonly prior?: ProfileMaterializationReceipt;
    readonly journalRoot?: NodeId;
    readonly nodeId?: NodeId;
    readonly requiredKnown?: boolean;
    readonly onReceipt?: (materialization: ProfileMaterializationReceipt, binding: ExecutionBindingReceipt) => void;
  };
  /**
   * Resume seam — set ONLY by the supervisor when `SupervisorOpts.resume` is on AND a non-empty
   * journal tree exists for this root. It carries the replayed committed work (so `scope.resume`
   * exposes it to a resume-aware `act`) and the recorded ordinal/cursor maxima the new counters
   * continue past, so a freshly-spawned child never reuses a journaled `seq`. Absent ⇒ fresh run.
   */
  readonly resumeFrom?: {
    /** @internal Executor adoption plans validated by the supervisor's recovery preparation. */
    readonly recoveries?: readonly RetainedChildRecovery[];
    readonly events?: readonly SpawnEvent[];
    readonly settled: ReadonlyArray<Settled<unknown>>;
    readonly view: TreeView;
    /** Highest `spawned` ordinal already journaled; new spawns start at `+1`. */
    readonly maxSpawnOrdinal: number;
    /** Highest cursor `seq` already journaled; new settlements start at `+1`. */
    readonly maxCursorSeq: number;
    /** Highest `waiting` ordinal already journaled; new waits start at `+1`. */
    readonly maxWaitOrdinal: number;
    /** Waits journaled as armed but never woken — re-armed (same node id, same absolute deadline)
     *  when `wait` is called again with the SAME label. */
    readonly waits: ReadonlyArray<PendingWait>;
    /** Keyed assignments from the prior journal — what a keyed re-spawn resolves against. */
    readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>;
    /** Prior committed spend summed off the journal (settled child work + metered inference). */
    readonly priorSpend: {
      readonly childWork: Spend;
      readonly driverInference: Spend;
    };
  };
}
/** How many of a manager's direct children its summary lists; the counts always cover all. */
declare const SUBTREE_RESULT_LIMIT = 8;
/** Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. */
declare function createScope<Out>(args: ScopeArgs): Scope<Out>;
/**
 * The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's
 * `Iteration` shape so `defaultSelectWinner` stays single-sourced — the supervisor selects
 * across settled children with the SAME argmax the loop kernel uses, not a forked copy.
 *
 * `index` is the cursor `seq` (the recorded, replay-stable order); `output`/`verdict`/
 * `tokenUsage`/`costUsd` are read straight off the settlement (already rehydrated from the
 * `outRef` blob by `next()`). Events are empty — a settled child is an opaque leaf result,
 * not a sandbox event stream — and the timing/cost fields project its conserved `Spend`.
 * Fail loud on a `down` settlement: only a `done` child is an iteration.
 */
declare function settledToIteration<Out>(settled: Settled<Out>): Iteration<unknown, Out>;
//#endregion
//#region src/runtime/supervise/sql-run-context.d.ts
interface SqlRunContextOptions extends SqlRunStoreOptions, InMemoryRunContextOptions {}
/** SQL stores are read-only outside an acquired ownership capability. runGraph acquires it. */
/** A `RunContext` bound to one fenced SQL ownership generation; read-only until acquired. */
interface FencedSqlRunContext extends RunContext {
  readonly durability: 'sql';
  readonly runId: string;
  acquire(signal?: AbortSignal): Promise<RunContextLease>;
}
/**
 * A cross-machine run context on the existing autocommit SqlAdapter. Reuse the same database,
 * tablePrefix and runId on every host; no runDir or shared filesystem is required.
 *
 * Each ownership generation gets fresh store capabilities. The public context can inspect SQL
 * at any time, but cannot write without acquire(). runGraph/supervise acquire and release it.
 * Retained provider execution supplies external admission/result idempotency; SQL does not turn
 * an arbitrary unkeyed network effect into an exactly-once operation.
 * @experimental
 */
declare function createFencedSqlRunContext(db: SqlAdapter, runId: string, options?: SqlRunContextOptions): Promise<FencedSqlRunContext>;
//#endregion
//#region src/runtime/supervise/supervisor.d.ts
/** The default recursion-depth ceiling. The conserved pool is what bounds a tree's depth: every
 *  level draws its slice from the level above, so a tree ends when its slices run out. This
 *  ceiling only stops a runaway recursion that keeps spawning tiny slices, so it sits well above
 *  any depth a budget can usefully pay for. */
declare const DEFAULT_MAX_DEPTH = 16;
/** Create a supervisor that owns one recursive agent execution tree. */
declare function createSupervisor<Task, Out>(): Supervisor<Task, Out>;
/**
 * Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a
 * chat/pi-viz client attaches to (Q2): `view()` reads the live tree, `signal()` delivers
 * an out-of-band message, `abort()` cascades. Before `run` binds it (and after `run`
 * unbinds it) the handle is fail-loud: a client that talks to a handle that is not
 * driving a live run gets a typed error, never a silent no-op.
 */
declare function createRootHandle<Out>(): SteerableRootHandle<Out>;
//#endregion
//#region src/runtime/supervise/trace-evidence.d.ts
/** Schema version for content-addressed worker tool-trace artifacts. */
declare const WORKER_TOOL_TRACE_SCHEMA_VERSION: 1;
/** Bytes stored under `WorkerTraceEvidence.traceRef`. */
interface WorkerToolTraceArtifact {
  readonly schemaVersion: typeof WORKER_TOOL_TRACE_SCHEMA_VERSION;
  readonly spans: ReadonlyArray<ToolSpan>;
}
/** Collect and persist one executor's structured tool trace without changing its task outcome. */
declare function captureWorkerTraceEvidence(readSource: (() => TraceSource | undefined) | undefined, blobs: ResultBlobStore, executed: boolean): Promise<WorkerTraceEvidence>;
/** Rehydrate exact persisted spans through agent-eval's one bounded trace-analysis adapter. */
declare function workerTraceAnalysisStore(evidence: WorkerTraceEvidence, blobs: Pick<ResultBlobStore, 'get'>): Promise<TraceAnalysisStore>;
/** Validate a stored trace artifact before an analyst or replay trusts it. */
declare function parseWorkerToolTraceArtifact(value: unknown, traceRef?: string): WorkerToolTraceArtifact;
//#endregion
//#region src/runtime/supervise/trajectory-recorder.d.ts
interface TrajectoryAnalysis {
  /** Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
   *  duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations. */
  readonly trajectory: Awaited<ReturnType<typeof buildTrajectory>>;
  /** Full-run repeated-call view (total occurrences + window) — allows one intervening call so it
   * catches a loop the online consecutive detector interleaves past. */
  readonly stuckLoop: Awaited<ReturnType<typeof stuckLoopView>>;
  /** Wasted-vs-total tool-call ratio for the run. */
  readonly toolWaste: Awaited<ReturnType<typeof toolWasteView>>;
}
/** Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. */
declare function analyzeTrace(source: TraceSource, runId?: string): Promise<TrajectoryAnalysis>;
//#endregion
//#region src/runtime/workspace.d.ts
/** Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`. */
type Shell = (args: ReadonlyArray<string>, cwd?: string) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
}>;
type WorkspaceCommit = {
  readonly ok: true;
  readonly rev: string;
} | {
  readonly ok: false;
  readonly conflict: string;
};
interface Workspace {
  readonly ref: string;
  materialize(dir: string): Promise<void>;
  commit(dir: string, message: string): Promise<WorkspaceCommit>;
  head(): Promise<string>;
}
/** Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). */
declare function localShell(): Shell;
interface GitWorkspaceOptions {
  readonly ref: string;
  readonly shell?: Shell;
  readonly branch?: string;
  readonly noHooks?: boolean;
}
/** A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. */
declare function gitWorkspace(opts: GitWorkspaceOptions): Workspace;
/** A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote).
 *  Same port, same `Shell` — a drop-in for `gitWorkspace`. jj suits agent loops:
 *  no staging area, and a first-class operation log (native resume/undo). Live use
 *  requires `jj` on the `Shell`'s host. */
declare function jjWorkspace(opts: GitWorkspaceOptions): Workspace;
interface WorkspaceRun<T> {
  readonly valid: boolean;
  readonly value: T;
  /** Present when a commit was attempted (valid, or `commitOnInvalid`). */
  readonly commit?: WorkspaceCommit;
}
/**
 * Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back
 * so the next worker (or the supervisor) builds on it. This is the seam that turns isolated
 * per-worker cwds into one compounding artifact — `body` gets a real materialized dir, its
 * delivery is committed to the shared ref iff it's valid (a conflict is returned, never thrown).
 * The clone is removed after; durable state lives only in the ref.
 */
declare function runInWorkspace<T>(ws: Workspace, body: (cwd: string) => Promise<{
  valid: boolean;
  value: T;
  message?: string;
}>, opts?: {
  tmpPrefix?: string;
  commitOnInvalid?: boolean;
}): Promise<WorkspaceRun<T>>;
//#endregion
//#region src/runtime/supervise/untracked-clone.d.ts
interface UntrackedCopyStats {
  /** Files + symlinks that landed in the clone. */
  copied: number;
  /** Total regular-file bytes enumerated (pre-copy, so the size warning fires first). */
  bytes: number;
}
interface CopyOptions {
  warnBytes?: number;
  log?: (message: string) => void;
}
/**
 * Copy every untracked file of `sourceDir`'s working tree — including git-ignored
 * build outputs (`git ls-files --others` with NO exclude flags lists both) — into
 * `cloneDir`, then shield the copied paths from the clone's `git add -A` via
 * `.git/info/exclude`. Nested git repos (listed as bare `dir/` entries), any path
 * containing a `.git` segment, and loop-infra dirs are skipped.
 */
declare function copyUntrackedIntoClone(sourceDir: string, cloneDir: string, opts?: CopyOptions): UntrackedCopyStats;
/**
 * Wrap a `Workspace` so every `materialize` (the per-worker `git clone` inside
 * `runInWorkspace`) is followed by the untracked-artifact copy above — the clone
 * the worker starts in matches the source WORKING TREE, not just its history.
 * `commit`/`head` pass through untouched, so delivery semantics are unchanged.
 */
declare function withUntrackedArtifacts(ws: Workspace, sourceDir: string, log?: (message: string) => void): Workspace;
//#endregion
//#region src/runtime/supervise/worker-evidence.d.ts
/**
 * Evidence-rich worker settlement.
 *
 * The supervisor BRAIN decides respawn/steer/stop from what a settled worker
 * shows it. A bare `finished passed=false patchBytes=6138` starves that
 * decision: the brain cannot quote the failing assertion, so its next worker
 * goal is authored blind. This module composes the bounded evidence block a
 * settling worker appends to its event stream and — on failure — returns as
 * its output artifact, so `observe_agent` hands the brain the failing verify
 * tail, a diff summary, and the worker's final note instead of counters.
 */
/** Hard cap on one worker's evidence block so the brain's context cannot blow up. */
declare const EVIDENCE_MAX_CHARS = 3000;
/** Tail of the verify output — the failing assertion lives at the END of a test log. */
declare const VERIFY_TAIL_CHARS = 1200;
/** Cap on the worker's closing note inside the evidence block. */
declare const NOTE_MAX_CHARS = 300;
interface WorkerEvidenceInput {
  readonly passed: boolean;
  readonly testPassed: boolean;
  readonly typecheckPassed: boolean;
  /** Combined stdout+stderr of the verify/test command (already backend-capped). */
  readonly testOutput: string;
  readonly typecheckOutput: string;
  readonly patch: string;
  /** The worker's own closing commentary, when the backend surfaces one. */
  readonly reviewerNotes?: string;
}
/**
 * Compose the settle evidence block. Section order is priority order under the
 * hard cap: the verify tail (what failed) survives before the diff head (what
 * was tried) and the worker note — a truncated diff is recoverable from the
 * persisted patch file, a truncated failing assertion is not recoverable at all.
 */
declare function composeWorkerEvidence(input: WorkerEvidenceInput): string;
/**
 * What a settled worker exposes as its output artifact (the blob the brain's
 * `observe_agent` reads). A passing worker's output is its patch — the
 * deliverable. A failing worker's output is its evidence block. A passing
 * worker with NO edits — the post-delivery read-only reviewer: the workspace
 * already holds a delivered fix, so the gate stays green under an empty diff —
 * would otherwise settle with an EMPTY output and its review would be lost, so
 * it exposes its evidence block instead (the worker note carries the review).
 */
declare function settledWorkerOut(input: {
  readonly passed: boolean;
  readonly patch: string;
  readonly evidence: string;
}): string;
/**
 * The worker's closing commentary off a local harness run: the TAIL of its
 * stdout (falling back to stderr), bounded to the note cap so a reviewer's
 * final verdict line — written last — survives into the evidence block
 * (`composeWorkerEvidence` keeps the note's FIRST `NOTE_MAX_CHARS` chars).
 */
declare function closingWorkerNote(stdout: string, stderr: string): string | undefined;
//#endregion
//#region src/runtime/supervise/worker-interactive.d.ts
/** Durable exact-process binding or capability decision for one supervised worker. @stable */
type WorkerInteractiveBinding = {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly label: string;
  readonly journalRoot: string;
  readonly recordedAt: string;
  readonly status: 'available';
  readonly ref: AgentInteractiveSessionRef;
  readonly refDigest: `sha256:${string}`;
} | {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly label: string;
  readonly journalRoot: string;
  readonly recordedAt: string;
  readonly status: 'unavailable';
  readonly reason: WorkerInteractiveUnavailableReason;
};
/** Provider lookup accepted by {@link attachWorker}. @stable */
type WorkerInteractiveProviderSource = AgentEnvironmentProvider | AgentEnvironmentProviderRegistry;
/** Options for reconstructing one worker's exact retained interactive process. @stable */
interface AttachWorkerOptions {
  readonly providers: WorkerInteractiveProviderSource;
  readonly signal?: AbortSignal;
}
/** Directory containing exact per-worker interactive binding records. @stable */
declare function workerInteractiveBindingsDir(eventDir: string): string;
/** Exact durable binding file for one worker id. @stable */
declare function workerInteractiveBindingFile(eventDir: string, workerId: string): string;
/** Read and validate one exact durable worker binding. @stable */
declare function readWorkerInteractiveBinding(eventDir: string, workerId: string): WorkerInteractiveBinding | undefined;
/**
 * Reconstruct the exact provider-owned interactive process bound to one supervised worker.
 * Unknown, headless, unsupported, settled, stale, and unregistered-provider cases fail closed.
 * @stable
 */
declare function attachWorker(eventDir: string, workerId: string, options: AttachWorkerOptions): Promise<WorkerInteractiveSession>;
//#endregion
//#region src/runtime/supervise/worktree-fanout.d.ts
/** @experimental One authored profile in a worktree fanout. Its exact `harness` field chooses the
 * local CLI; the supervisor authors the complete profile per sub-task. */
interface AuthoredHarness {
  /** A short label for the worktree branch + trace node. */
  name: string;
  /** The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5). */
  profile: AgentProfile;
  /** Require measured usage from this leaf. Budgeted supervision refuses the default unmetered
   *  local-CLI mode; set false only when the selected runner actually returns token usage. */
  budgetExempt?: WorktreeCliExecutorOptions['budgetExempt'];
  /** Run Codex through its measured, isolated JSONL path. This implies `budgetExempt: false`. */
  codexReproducible?: WorktreeCliExecutorOptions['codexReproducible'];
  /** Host paths denied to a reproducible Codex leaf. */
  codexReadDeniedPaths?: WorktreeCliExecutorOptions['codexReadDeniedPaths'];
  /** Per-harness model/runId/baseRef overrides flow through the profile + these. */
  runId?: string;
  baseRef?: string;
}
/** @experimental */
interface WorktreeFanoutOptions extends PatchDeliverableOptions {
  /** Absolute path to the git checkout each worktree is cut from. */
  repoRoot: string;
  /** The per-task instruction handed to every harness (composed under each profile's systemPrompt). */
  taskPrompt: string;
  /** The authored harness profiles — one fanout item (and one worktree-CLI leaf) each. */
  harnesses: ReadonlyArray<AuthoredHarness>;
  /**
   * The completion check each leaf is gated on. Defaults to `patchDelivered(opts)` (the mechanical
   * no-op/secret/forbidden/diff-size + required test/typecheck gate). Pass any
   * `DeliverableSpec<WorktreePatchArtifact>` to customize "is it delivered" as DATA.
   */
  deliverable?: DeliverableSpec<WorktreePatchArtifact>;
  /** Shell command run in each worktree to derive the tests-PASS signal. */
  testCmd?: string;
  /** Shell command run in each worktree to derive the typecheck-PASS signal. */
  typecheckCmd?: string;
  /** Wall-clock cap per harness subprocess (ms). */
  harnessTimeoutMs?: number;
  /** Winner-selection strategy. Default `highest-score`. */
  winnerStrategy?: WinnerStrategy;
  /** Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
   *  whole fanout runs offline). Production callers leave these unset. */
  runGit?: WorktreeCliExecutorOptions['runGit'];
  runHarness?: WorktreeCliExecutorOptions['runHarness'];
  runCommand?: WorktreeCliExecutorOptions['runCommand'];
}
/**
 * Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })`
 * — equal-k holds by construction (the conserved budget pool bounds the N leaves), and selection is
 * the shared valid-only `selectValidWinner` (never a judge).
 *
 * @experimental
 */
declare function worktreeFanout<Task>(options: WorktreeFanoutOptions): CombinatorShape<Task, WorktreePatchArtifact>;
//#endregion
//#region src/runtime/supervise-surface.d.ts
/** What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is
 *  the surface check's pass/fail (settled ⟺ resolved); `score` is the partial-credit fraction; `failing`
 *  carries the tests this worker left red (so the analyst can target them). */
interface SurfaceWorkerOut {
  readonly resolved: boolean;
  readonly score: number;
  readonly shots: number;
  readonly summary: string;
  readonly failing?: readonly string[];
}
/**
 * Adapt an `agent-eval` `AnalystRegistry` into the lens shape `supervise({ analysts })` takes.
 *
 * The two registries were never structurally compatible: eval's class exposes `list()` and
 * `run(runId, inputs, opts)` and returns an `AnalystRunResult`, while `supervise` wants `kinds`
 * and `run(kindId, trace)`. So `'kinds' in buildDefaultAnalystRegistry()` is `false` and the five
 * calibrated lenses in `DEFAULT_TRACE_ANALYST_KINDS` were unreachable from any supervised run —
 * every consumer hand-rolled a lens instead (#630).
 *
 * The adapter lives HERE, not in eval, for one reason: eval must never import runtime, and runtime
 * already owns both shapes — it consumes `AnalystFinding` / `AnalystRunResult` from eval for its
 * analyst loop and defines the supervise lens itself. Writing it in eval would mean eval declaring
 * a duck-typed copy of a type this package already exports.
 *
 * `kinds` is the DEFINITION list, not `registry.list()`, because `Analyst` carries no `area` while
 * `TraceAnalystDefinition` does — `list()` cannot supply the field the lens shape requires. Every
 * id must be registered: an unknown kind throws at adapt time rather than returning nothing at run
 * time, when the driver would read the silence as "no findings".
 */
declare function analystsFromRegistry(registry: AnalystRegistryLike, kinds?: ReadonlyArray<{
  id: string;
  description: string;
  area: string;
}>, opts?: {
  runOpts?: RegistryRunOpts;
  authoring?: AnalystAuthoring;
}): AnalystRegistry$1;
/**
 * What `analystsFromRegistry` needs before a manager may define its own lens.
 *
 * Only the ENGINE is asked for, because everything else about a defined lens is already in the
 * manager's own words. The engine is the model seat plus the recursive investigation loop, and it
 * cannot come from a tool argument: an `AgentProfile` names a model the run's own model policy has
 * already fenced, but an analyst engine is host-constructed with host credentials.
 */
interface AnalystAuthoring {
  /**
   * Resolve the investigation engine for the seat a definition asked for. `undefined` means the
   * definition named no seat and wants the run's default engine. THROW to refuse a seat this run
   * cannot serve — the message is what the manager reads and re-authors from.
   */
  readonly resolveEngine: (model: string | undefined) => TraceAnalysisEngine;
  /** Forwarded to `createTraceAnalyst`; omit for its default. */
  readonly settlementTimeoutMs?: number;
}
/** The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
 *  the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
 *  cases. Swap `analysts` to change what the driver improves from — that's the one knob. */
declare function failuresAnalyst(): AnalystRegistry$1;
/** How a worker runs the surface task (its router substrate + per-attempt bounds). */
interface SurfaceWorkerConfig {
  readonly routerBaseUrl: string;
  readonly routerKey: string;
  /** Exact worker behavior, tools, and model. */
  readonly profile: AgentProfile;
  readonly analystProfile?: AgentProfile;
  readonly innerTurns?: number;
  /** Refine-shot budget for ONE worker attempt (max steered shots). Default 1. */
  readonly budget?: number;
}
interface SuperviseSurfaceOptions {
  /** The graded surface workers solve (open/tools/call/score/close). */
  readonly surface: AgenticSurface;
  /** Where/how each worker runs the surface task. */
  readonly worker: SurfaceWorkerConfig;
  /** The conserved compute pool for the whole supervised run. Default: sized off the worker's inner-loop
   *  bounds for a handful of worker spawns — raise it to let the driver try more. */
  readonly budget?: Budget;
  /** The driver brain's Router endpoint/auth. Model and behavior remain owned by `profile`. */
  readonly router?: RouterTransportConfig;
  /** The self-improvement lens fed to the driver on each settled worker. Default `failuresAnalyst()`
   *  (target the still-failing tests). Pass a custom registry to change it, or `null` to turn the
   *  within-run self-improvement OFF (the driver sees raw settled outputs). */
  readonly analysts?: AnalystRegistry$1 | null;
  /** The strategy each worker runs over the surface. Default `refine` (iterate-with-feedback). */
  readonly strategy?: Strategy;
  /** Max workers working at once; later spawns queue. Default 1 (serial — required when workers share
   *  a persistent artifact, so they continue each other instead of racing the file). */
  readonly workerSlots?: number;
}
/** The deployable outcome of a supervised surface run. */
interface SuperviseSurfaceResult {
  readonly resolved: boolean;
  readonly score: number;
  readonly usd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly ms: number;
  /** Total conserved-pool iterations = the driver + worker LLM rounds the run actually spent. */
  readonly completions: number;
}
/** Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and
 *  report the deployable outcome + the full conserved spend. This is `supervise()` configured for surfaces
 *  — there is no other entrypoint to learn. */
declare function superviseSurface(profile: SupervisorProfile, task: AgenticTask, opts: SuperviseSurfaceOptions): Promise<SuperviseSurfaceResult>;
//#endregion
//#region src/runtime/surface-diff.d.ts
/** Outcome of reading one surface back at settle. `missing: true` means the path no longer exists
 *  (a deletion — a valid, reportable outcome); any other failure carries its diagnostic. */
type SurfaceReadOutcome = {
  succeeded: true;
  value: Uint8Array;
} | {
  succeeded: false;
  missing: boolean;
  error: string;
};
/** The read seam: fetch the current bytes at a mounted path. Implemented by a sandbox box's
 *  `fs.read`, a local worktree read ({@link fsSurfaceReader}), or a test double. */
type SurfaceReader = (path: string) => Promise<SurfaceReadOutcome>;
/**
 * One watched surface whose settled state differs from what was mounted (or from absence).
 *
 * - `modified` — the surface exists with different bytes (`settledSha256`/`settledBytes` present).
 * - `removed` — the surface no longer exists at its mounted path.
 * - `created` — a watched path that was never mounted now exists (`settledSha256`/`settledBytes`
 *   present, no `mountedSha256`) — the shape a harness's new memory/skill file takes.
 * - `unreadable` — the read seam failed for a reason other than absence; `error` carries the
 *   diagnostic. Reported rather than dropped so a permissions or transport failure cannot
 *   masquerade as "nothing changed".
 */
interface SurfaceDiff {
  /** The mounted/watched path, exactly as recorded. */
  path: string;
  status: 'modified' | 'removed' | 'created' | 'unreadable';
  /** Hex SHA-256 of the bytes that were mounted (from the manifest). Absent for `created`. */
  mountedSha256?: string;
  /** Free-form origin: the manifest entry's `source`, or the watch entry's `source`. */
  source: string;
  /** Hex SHA-256 of the settled bytes. Present for `modified` and `created`. */
  settledSha256?: string;
  /** Size of the settled bytes. Present for `modified` and `created`. */
  settledBytes?: number;
  /** The read seam's diagnostic. Present only for `unreadable`. */
  error?: string;
}
/** A path to check at settle that was NOT necessarily mounted — where a harness is known to write
 *  self-authored surfaces (a memory dir's files, a refinement log). A watched path that was also
 *  mounted compares against its mount; one that wasn't reports `created` if it now exists.
 *  `created` is an inference from the mount manifest, not a proof of authorship: a file the box
 *  IMAGE shipped at a never-mounted path also reports `created`. Watch paths known absent at run
 *  start (or enumerate the tree at start AND settle and watch the difference) to make the label
 *  mean what it says. */
interface WatchedSurface {
  path: string;
  /** Origin label carried onto the diff (default `'watched'`). */
  source?: string;
}
/** Inputs to {@link harvestSurfaceDiffs}: the run's mount manifest, the read seam, and optional
 *  watch paths for surfaces the agent may have created. */
interface HarvestSurfaceDiffsOptions {
  /** The run's mount manifest (`RunProvenance.mounts`). Entries sharing a path are collapsed to the
   *  LAST entry — the bytes the agent actually saw at start. */
  mounts: readonly MountManifestEntry[];
  /** How to read a mounted path's current bytes. */
  read: SurfaceReader;
  /** Additional paths to check that may not have been mounted (see {@link WatchedSurface}). The
   *  caller enumerates them (it knows the harness's state layout — e.g. via the box's file tree);
   *  the harvest stays layout-agnostic. */
  watch?: readonly WatchedSurface[];
}
/**
 * Re-read every mounted (and watched) surface and report the ones whose settled state differs from
 * the manifest — modified, removed, or created. Unchanged surfaces and still-absent watched paths
 * produce no entry; reads run concurrently; output preserves record order, mounts before
 * watch-only paths. Mounts and watches sharing a path key are each collapsed to the LAST entry,
 * and a watched path that was also mounted compares against its mount (never reports `created`).
 *
 * The harvest takes no `AbortSignal`: it is pure fan-out over the read seam and waits on nothing
 * itself, so every cancellable moment belongs to the reader. Pass a signal to the reader instead
 * ({@link BoxSurfaceReaderOptions.signal}, or close over one in a custom {@link SurfaceReader}) —
 * that cuts the backoff waits, and the harvest still returns the diffs it did establish rather
 * than discarding settle-time evidence on a late cancellation.
 */
declare function harvestSurfaceDiffs(options: HarvestSurfaceDiffsOptions): Promise<SurfaceDiff[]>;
/** The minimal box surface the box-backed reader needs — structurally typed so the real
 *  `@tangle-network/sandbox` box and a test double both satisfy it, no SDK import. */
interface SurfaceReadBox {
  fs: {
    read(path: string): Promise<string>;
  };
}
/** Retry and cancellation controls for {@link boxSurfaceReader}. */
interface BoxSurfaceReaderOptions {
  /** Read attempts per path before settling on a failed outcome. The data plane can transiently
   *  404 a just-written file (the same blip `openSandboxRun`'s deliverable read retries for), and a
   *  first-attempt 404 taken at face value turns a fresh self-edit into a false `removed`/dropped
   *  `created`. Default 3. */
  attempts?: number;
  /** Linear backoff base between attempts (delay = base × attempt). Default 250. */
  retryDelayMs?: number;
  /** Cuts the retry waits short when the run is abandoned. The reader still returns a typed
   *  outcome — the harvest reports what it managed to read rather than rejecting. */
  signal?: AbortSignal;
}
/**
 * A {@link SurfaceReader} over a sandbox box's filesystem — the same `box.fs.read` seam
 * `openSandboxRun` reads deliverables through, with the same transient-404 posture (bounded
 * retry). The box wire returns UTF-8 TEXT (the SDK's binary path is `download()`), which profile
 * surfaces are; hashes are computed over the UTF-8 encoding, and content the wire had to
 * lossy-decode (a U+FFFD replacement character) is reported `unreadable` rather than hashed as
 * mojibake. The SDK's not-found error is detected structurally (`err.name === 'NotFoundError'`)
 * and maps to `missing: true` — unless its `resourceType` names something other than a file/path
 * (the BOX or session being gone), which is a transport failure, not an absent surface.
 */
declare function boxSurfaceReader(box: SurfaceReadBox, options?: BoxSurfaceReaderOptions): SurfaceReader;
/**
 * A {@link SurfaceReader} over the local filesystem, for worktree/local workers. Every path —
 * relative or absolute — must resolve INSIDE `root`: a path that escapes it (`../`, an absolute
 * path elsewhere) fails as a contained non-missing outcome rather than reading outside the
 * worktree, so a persisted or mistyped manifest path cannot turn the harvest into an
 * existence/hash oracle over the host filesystem. Containment is checked twice — once on the
 * lexical path, then again on the symlink-resolved path, because `readFile` follows a link and a
 * link planted inside the root would otherwise read host bytes through a contained-looking name.
 * Absence maps to `missing: true`; every other failure carries the error message.
 */
declare function fsSurfaceReader(root: string): SurfaceReader;
//#endregion
//#region src/runtime/verifier-environment.d.ts
interface VerifierEnvironmentOptions {
  name: string;
  /** The deployable check over a submitted answer. Graded via passes/total. */
  check(task: AgenticTask, answer: string): Promise<SurfaceScore> | SurfaceScore;
  /** Extra domain tools (read-only helpers: calculator, retrieval, style lookup). */
  extraTools?: AgenticTool[];
  /** Executes the extra tools. Required when `extraTools` is set. */
  callExtra?(task: AgenticTask, name: string, args: Record<string, unknown>): Promise<string> | string;
}
/** Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it. */
declare function createVerifierEnvironment(opts: VerifierEnvironmentOptions): Environment;
//#endregion
export { WorkspaceRun as $, localSandboxClient as $a, createFileRunContext as $c, DEFAULT_AWAIT_EVENT_TIMEOUT_MS as $d, DelegateHandlerOptions as $f, ProfileMaterializationIssue as $h, registryScopeAnalyst as $i, pickBestDelivered as $l, SqlRunStoreOptions as $m, RepairStop as $n, Widen as $o, DelegateResearchResult as $p, openSandboxRun as $r, SettledPursuitVersion as $s, defaultEdgeTraversalCap as $t, deterministicCompletion as $u, worktreeFanout as A, adaptiveRefine as Aa, AuthorizedSpawn as Ac, renderAnytimeTable as Ad, createCoordinationTools as Af, SqlStatements as Ah, equalKOnCost as Ai, ProgressSample as Al, createDelegationTraceCollector as Am, unsafeInProcessRunner as An, FanoutWinnerSelector as Ao, createDetachedTurnResumeDriver as Ap, runStrategyEvolution as Ar, assertDeclaredCheck as As, WorktreeCliExecutorOptions as At, runCancelRequestFile as Au, VERIFY_TAIL_CHARS as B, LoopOptionsForDispatch as Ba, workerFromBackend as Bc, AnalystRegistry$1 as Bd, SpawnResourceReader as Bf, SpawnForestTree as Bh, fanout as Bi, noProgressFor as Bl, BusStats as Bm, ProfileRichness as Bn, PipelineStage as Bo, DelegationRunContext as Bp, McpSpawnFault as Br, runIsolatedCheck as Bs, workerInteractiveAdmissionFile as Bt, workerInboxFile as Bu, SurfaceWorkerConfig as C, Strategy as Ca, ObserverRecordKind as Cc, AnytimeReport as Cd, SpawnRefusalCause as Cf, TurnOrder as Ch, PromotionGateOptions as Ci, assertCoordinationBinding as Cl, DELEGATION_TRACE_MAX_SPANS as Cm, delegate as Cn, EqualKArm as Co, createSiblingSandboxExecutor as Cp, EvolutionCandidate as Cr, LeaderboardScenario as Cs, ProvisionSupervisorConnection as Ct, legacySupervisorRunsRoot as Cu, superviseSurface as D, StrategyResult as Da, FORK_PARENT_UNCERTAIN_NODES_KEY as Dc, areaUnderCurve as Dd, WorkerWatchOptions as Df, RetryableErrorPredicate as Dh, profileOptimizerModelCall as Di, AllWorkersStalledOptions as Dl, buildDelegationTraceSpans as Dm, CodeModeOptions as Dn, Fanout as Do, DriveTurnCapableBox as Dp, StrategyEvolutionConfig as Dr, DeclaredCheck as Ds, provisionSupervisor as Dt, readWorkerCancellation as Du, failuresAnalyst as E, StrategyMessage as Ea, verifyObserverRecords as Ec, anytimeReport as Ed, WorkerSpawnContext as Ef, RetryBackoff as Eh, profileChatClient as Ei, supervisorAgentWithTestBrain as El, DelegationTraceSpan as Em, finalizeBestDelivered as En, EqualKVerdict as Eo, DetachedTurnResumeDriverOptions as Ep, ReproductionCheck as Er, defineLeaderboard as Es, SupervisorCleanupReceipt as Et, readWorkerCancelRequests as Eu, readWorkerInteractiveBinding as F, runAgentic as Fa, SuperviseRegistry as Fc, ANALYST_DEFINITION_BOUNDS as Fd, ResolveSpawnResourcePathsResult as Ff, SpawnForest as Fh, definePersona as Fi, StopRule as Fl, FileDelegationStoreOptions as Fm, ChatWorkerSeamOptions as Fn, Panel as Fo, DelegationArgs as Fp, authorStrategy as Fr, readDeclaredCheck as Fs, InteractiveWorkerOptions as Ft, supervisorWorkersDir as Fu, CopyOptions as G, superviseDispatch as Ga, isPreSpawnExecutorFailure as Gc, AuthorizeDownMessage as Gd, McpServerOptions as Gf, contentAddress as Gh, selectValidWinner as Gi, UNPROVEN_CONTINUITY as Gl, defaultToolDetectors as Gm, profileRichnessFinding as Gn, ScopeWidenGate as Go, hashIdempotencyInput as Gp, materializeLocalMcp as Gr, PreparedPursuitVersion as Gs, EdgeTraversal as Gt, workerSteerRequestsDir as Gu, closingWorkerNote as H, SuperviseOptionsForDispatch as Ha, WorkerSpawnRetryAttempt as Hc, AnalyzeOnSettleRoute as Hd, hostDirectoryReader as Hf, materializeTreeView as Hh, loopUntil as Hi, sampleFromSettled as Hl, PublishOptions as Hm, asAuthoredProfile as Hn, RenderCorpusToInstructionsOptions as Ho, DelegationTaskQueueOptions as Hp, StdioMcpConnection as Hr, NextPursuitVersion as Hs, createInPlaceCliExecutor as Ht, workerSteerAcknowledgementFile as Hu, workerInteractiveBindingFile as I, sample as Ia, SuperviseRegistryTable as Ic, AnalystDefinitionIssue as Id, ResolvedSpawnResourcePath as If, SpawnForestEvent as Ih, runPersonified as Ii, allOf as Il, InMemoryDelegationStore as Im, chatTransportExecutor as In, PanelJudge as Io, DelegationRecord as Ip, strategyAuthorContract as Ir, IsolatedCheckBox as Is, InteractiveWorkerResult as It, workerCancelRequestsFile as Iu, withUntrackedArtifacts as J, TerminalDecision as Ja, withWorkerSpawnRetry as Jc, ContinuityMode as Jd, DELEGATE_DESCRIPTION as Jf, AssertProfileMaterializationOptions as Jh, CreateScopeAnalystOptions as Ji, FinalizeContext as Jl, ExecutorResultMapping as Jm, CheckOutcome as Jn, TrajectoryReport as Jo, DelegateCodeResult as Jp, OpenSandboxRunOptions as Jr, PursuitVersionStopReason as Js, GraphNode as Jt, CompletionAnalyst as Ju, UntrackedCopyStats as K, RunAgentRoundsOptions as Ka, resolveWorkerSpawnRetry as Kc, AuthorizedDownMessage as Kd, createInProcessTransport as Kf, AGENT_PROFILE_MATERIALIZATION_AXES as Kh, verify as Ki, composeReentryTask as Kl, watchTrace as Km, supervisorInstructions as Kn, SteerContext as Ko, DelegateCodeArgs as Kp, Deliverable as Kr, PursuitVersionParent as Ks, GraphEdge as Kt, workerSteersDir as Ku, workerInteractiveBindingsDir as L, sampleThenRefine as La, SuperviseTestOptions as Lc, AnalystFindingEvent as Ld, SPAWN_RESOURCE_PATH_MAX_BYTES as Lf, SpawnForestInDoubtNode as Lh, FileCorpus as Li, allWorkersStalled as Ll, CoderOutput as Lm, chatWorkerSeam as Ln, PanelSpec as Lo, DelegationResumeContext as Lp, strategyAuthorSystemPrompt as Lr, IsolatedCheckBoxEvidence as Ls, workerFromInteractiveProvider as Lt, workerCancellationFile as Lu, WorkerInteractiveBinding as M, defineStrategy as Ma, DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY as Mc, WaterfallReport as Md, normalizeAnalyzeOnSettle as Mf, FileSpawnJournal as Mh, builtinShapes as Mi, ProgressTrackerOptions as Ml, DelegationStateCorruptError as Mm, ChatSessionStore as Mn, LoopUntil as Mo, formatDetachedSessionRef as Mp, AuthorStrategyOptions as Mr, declaredCheckDeliverable as Ms, createWorktreeCliExecutor as Mt, safeWorkerFile as Mu, WorkerInteractiveProviderSource as N, depthStrategy as Na, DeliverableResolutionInput as Nc, WaterfallSpan as Nd, parseAuthoredAnalystDefinition as Nf, InMemoryResultBlobStore as Nh, createShapeRegistry as Ni, ProgressView as Nl, DelegationStore as Nm, ChatTransportExecutorOptions as Nn, LoopUntilSpec as No, parseDetachedSessionRef as Np, AuthoredStrategy as Nr, declaredCheckDigest as Ns, InteractiveWorkerEnvironment as Nt, supervisorRunDir as Nu, AuthoredHarness as O, StrategyShotResult as Oa, PursuitFork as Oc, bestSoFar as Od, analystToolGroupNames as Of, SqlResultBlobStore as Oh, assertModelAllowed as Oi, NoProgressForOptions as Ol, capDelegationTrace as Om, CodeModeRunner as On, FanoutOptions as Oo, DriveTurnTick as Op, discriminatingMeans as Or, DeclaredCheckPlacement as Os, PatchDeliverableOptions as Ot, readWorkerSteerAcknowledgement as Ou, attachWorker as P, refine as Pa, SuperviseOptions as Pc, createWaterfallCollector as Pd, questionEscalationTargets as Pf, InMemorySpawnJournal as Ph, registerShape as Pi, StopDecision as Pl, FileDelegationStore as Pm, ChatTransportTool as Pn, LoopUntilState as Po, runDetachedTurn as Pp, assertStrategyContract as Pr, declaredCheckJudge as Ps, InteractiveWorkerKeyInput as Pt, supervisorRunsRoot as Pu, WorkspaceCommit as Q, LocalSandboxClientOptions as Qa, RunContextLease as Qc, CoordinationToolsOptions as Qd, DelegateError as Qf, ProfileMaterializationContract as Qh, createScopeAnalyst as Qi, collectDelivered as Ql, SqlRunOwnershipError as Qm, CheckSourceCtx as Qn, VerifySpec as Qo, DelegateResearchConfig as Qp, TurnResult as Qr, RunPursuitVersion as Qs, TraversalContinuity as Qt, completionAuthorizes as Qu, EVIDENCE_MAX_CHARS as R, LoopCampaignDispatchOptions as Ra, supervise as Rc, AnalystKind as Rd, SpawnResourceBytes as Rf, SpawnForestMissingTree as Rh, InMemoryCorpus as Ri, anyOf as Rl, BusEvent as Rm, createChatSessionStore as Rn, PanelVerdict as Ro, DelegationResumeDriver as Rp, LocalMcpMaterialization as Rr, IsolatedCheckOptions as Rs, WorkerInteractiveAdmission as Rt, workerCancellationsDir as Ru, SuperviseSurfaceResult as S, ShotSpec as Sa, ObserverRecord as Sc, defaultAuditorInstruction as Sd, SpawnRefusal as Sf, RunConversationOptions as Sh, resolveSandboxClient as Si, SupervisorToolInvocationContext as Sl, DELEGATION_TRACE_MAX_BYTES as Sm, defaultDelegateBudget as Sn, CorpusRecord as So, createFleetWorkspaceExecutor as Sp, EvolutionBandInfo as Sr, LeaderboardRunContext as Ss, createSqlRunContext as St, legacySupervisorRunDir as Su, analystsFromRegistry as T, StrategyCtx as Ta, observerRecordDigest as Tc, AnytimeTaskCurve as Td, WorkerResumeContext as Tf, CircuitBreakerConfig as Th, promotionGate as Ti, supervisorAgent as Tl, DelegationTraceCollector as Tm, driverAgent as Tn, EqualKOnCostOptions as To, DetachedTurn as Tp, EvolutionReport as Tr, LeaderboardSpec as Ts, ProvisionedSupervisor as Tt, readRunCancellation as Tu, composeWorkerEvidence as U, loopCampaignDispatch as Ua, WorkerSpawnRetryHooks as Uc, AuthoredAnalystDefinition as Ud, resolveSpawnResourcePaths as Uf, pendingWaits as Uh, panel as Ui, ReentryContinuity as Ul, createEventBus as Um, assessAuthoredProfile as Un, ScopeAnalyst as Uo, SubmitInput as Up, StdioMcpServerSpec as Ur, NextPursuitVersionInput as Us, AgentGraph as Ut, workerSteerAcknowledgementsDir as Uu, WorkerEvidenceInput as V, SuperviseDispatchOptions as Va, ResolvedWorkerSpawnRetry as Vc, AnalystToolGroupName as Vd, environmentReader as Vf, loadSpawnForest as Vh, flatWidenGate as Vi, plateau as Vl, EventBus as Vm, ProfileRichnessThresholds as Vn, RenderCorpusToInstructions as Vo, DelegationTaskQueue as Vp, McpToolDescriptor as Vr, JudgedPursuitVersion as Vs, InPlaceCliExecutorOptions as Vt, workerInboxFileFromEventDir as Vu, settledWorkerOut as W, loopDispatch as Wa, WorkerSpawnRetryPolicy as Wc, AuthoredAnalystLimits as Wd, McpServer as Wf, replaySpawnTree as Wh, pipeline as Wi, ReentryTaskInput as Wl, WatchTraceOptions as Wm, defaultProfileRichnessThresholds as Wn, ScopeAnalyzeInput as Wo, SubmitOutput as Wp, connectStdioMcp as Wr, PURSUIT_VERSIONS_FILE as Ws, EdgeDeliveryOutcome as Wt, workerSteerRequestFile as Wu, Shell as X, isTerminalDecision as Xa, InMemoryRunContextOptions as Xc, CoordinationStats as Xd, DELEGATE_TOOL_NAME as Xf, DefineProfileMaterializationContractOptions as Xh, assertTraceDerivedFindings as Xi, SupervisorFinalizer as Xl, mapExecutorResult as Xm, CheckRunner as Xn, TrajectoryReportOptions as Xo, DelegateFeedbackResult as Xp, SandboxRun as Xr, PursuitVersionsRecord as Xs, RunGraphOptions as Xt, CompletionPolicy as Xu, GitWorkspaceOptions as Y, defaultSelectWinner as Ya, InMemoryRunContext as Yc, CoordinationEvent as Yd, DELEGATE_INPUT_SCHEMA as Yf, CanonicalAgentProfileMaterializationAxis as Yh, RegistryAnalyzeProjection as Yi, FinalizerSettled as Yl, gateOnDeliverable as Ym, CheckRunContext as Yn, TrajectoryReportFn as Yo, DelegateFeedbackArgs as Yp, OpenSandboxRunPromptOptions as Yr, PursuitVersions as Ys, GraphResult as Yt, CompletionEvidence as Yu, Workspace as Z, runAgentRounds as Za, RunContext as Zc, CoordinationTools as Zd, DelegateArgs as Zf, KnownAgentProfileMaterializationAxis as Zh, buildSteerContext as Zi, bestDelivered as Zl, SqlRunLease as Zm, CheckSource as Zn, Verify as Zo, DelegateResearchArgs as Zp, SandboxRunAbortError as Zr, REVIEW_DIR as Zs, RunGraphTestOptions as Zt, CompletionVerdict as Zu, boxSurfaceReader as _, AgenticTask as _a, PursuitRunTotals as _c, renderPairwiseMarkdown as _d, QuestionRecord as _f, ConversationTurn as _h, claimRetainedInteractiveControl as _i, SupervisorAgentTestDeps as _l, ResearchOutputShape as _m, RollingDispatchOptions as _n, renderReport as _o, settleDetachedCoderTurn as _p, visibleCheckScore as _r, LeaderboardBenchScore as _s, SUBTREE_RESULT_LIMIT as _t, WorkerSteerAcknowledgement as _u, SandboxInstance$1 as a, BenchmarkCell as aa, SupervisePursuitOptions as ac, Leaderboard as ad, EscalateQuestion as af, profileMaterializationAxes$1 as ag, d1ToSqlAdapter as ah, SessionCapableBox as ai, SupervisorSpanRecorder as al, DelegationFeedbackSnapshot as am, analyzesFindingsReportPrompt as an, HarvestCorpusOptions as ao, InMemoryFeedbackStore as ap, canDisplace as ar, DefinePersonaInput as as, analyzeTrace as at, serveCoordinationMcp as au, AnalystAuthoring as b, CorpusReadbackOptions as ba, FileObserverJournal as bc, IntentAudit as bd, SpawnPreflight as bf, HaltReason as bh, startRetainedInteractiveRun as bi, SupervisorProfile as bl, delegationProfiles as bm, rollingDispatch as bn, Corpus as bo, FleetWorkspaceExecutorOptions as bp, EvolutionArchiveNode as br, LeaderboardFlagSpec as bs, settledToIteration as bt, cancelRun as bu, VerifierEnvironmentOptions as c, BenchmarkReport as ca, PursuitCostProvenance as cc, PairwiseOptions as cd, ManagerReentryState as cf, promptOnlyProfileMaterialization as cg, FileConversationJournal as ch, SandboxCapabilities as ci, CoordinationToolFace as cl, DelegationHistoryResult as cm, dumbContinuationFailPrompt as cn, HarvestReport as co, CoderReview as cp, defaultExtractCandidate as cr, Persona as cs, captureWorkerTraceEvidence as ct, CoordinationDeliveryEvidence as cu, HarvestSurfaceDiffsOptions as d, Environment as da, PursuitNodePlatform as dc, ScoreOf as dd, QuestionEscalationOutcome as df, sandboxActProfileMaterialization as dg, Conversation as dh, acquireSandbox as di, DriveHarnessOwnerContext as dl, DelegationResultPayload as dm, kernelPromptRegistry as dn, ObservationAnalysis as do, DetachedSessionDelegateOptions as dp, modelAuthoredChecks as dr, RunPersonified as ds, DEFAULT_MAX_DEPTH as dt, FileCoordinationLog as du, observationFromRegistry as ea, VersionJudge as ec, sentinelCompletion as ed, DefinedAnalystRecord as ef, ValidateProfileMaterializationOptions as eg, openSqlRunStore as eh, BranchCapableBox as ei, createInMemoryRunContext as el, DelegateUiAuditArgs as em, runGraph as en, inlineSandboxClient as eo, DelegateResult as ep, StructuralRolloutConfig as er, WidenDecision as es, gitWorkspace as et, runFinalizer as eu, SurfaceDiff as f, printBenchmarkReport as fa, PursuitNodeProjection as fc, leaderboard as fd, QuestionEscalationRecord as ff, validateProfileMaterialization as fg, ConversationDriveState as fh, reconnectRetainedRun as fi, ObserveSupervisorNodeEvent as fl, DelegationStatus as fm, naiveContinuationPrompt as fn, ObservationError as fo, DetachedWinnerSelection as fp, officialChecksFromMeta as fr, RunPersonifiedOptions as fs, createRootHandle as ft, PriorCoordination as fu, WatchedSurface as g, AgenticSurface as ga, PursuitRunProjection as gc, renderLeaderboardSvg as gd, QuestionPolicy as gf, ConversationStreamEvent as gh, ClaimRetainedInteractiveControlOptions as gi, SupervisorAgentDeps as gl, FeedbackRefersTo as gm, DispatchUnit as gn, observe as go, detachedSessionDelegate as gp, structuralRollout as gr, DefinedLeaderboard as gs, createFencedSqlRunContext as gt, WorkerCancellation as gu, SurfaceReader as h, AgenticRunResult as ha, PursuitProjection as hc, renderLeaderboardMarkdown as hd, QuestionOption as hf, ConversationResult as hh, startRetainedRunInEnvironment as hi, ResolvedSupervisorProfile as hl, FeedbackRating as hm, DispatchStopReason as hn, defaultAnalystInstruction as ho, coderTaskFromArgs as hp, selectBestIndex as hr, ShapeRegistry as hs, SqlRunContextOptions as ht, WorkerCancelRequest as hu, SandboxEvent$1 as i, sanitizeMcpToolSchema as ia, SupervisePursuitError as ic, Interval as id, DownMessageEvent as if, fullProfileMaterialization as ig, SqlConversationJournal as ih, SandboxLineageHandle as ii, SupervisorSpanOutcome as il, DelegationError as im, RegisteredPrompt as in, inProcessSandboxClient as io, FeedbackStore as ip, VisibleCheck as ir, DefinePersona as is, TrajectoryAnalysis as it, CoordinationTransportOptions as iu, AttachWorkerOptions as j, breadthStrategy as ja, AuthorizedSpawnContext as jc, WaterfallCollector as jd, downMessageRefusalReasons as jf, FileResultBlobStore as jh, trajectoryReport as ji, ProgressTracker as jl, DelegationPersistenceError as jm, ChatCompletionsTransport as jn, FlatWidenGate as jo, detachedTurnEvents as jp, selectChampion as jr, checkProgramDigest as js, WorktreePatchArtifact as jt, runCancellationFile as ju, WorktreeFanoutOptions as k, SurfaceScore as ka, RUN_FORK_CORRELATION_KEYS as kc, plateauLength as kd, canonicalFindingEvent as kf, SqlSpawnJournal as kh, assertProfileModelsAllowed as ki, PlateauOptions as kl, composeLoopTraceEmitters as km, codeModeSupervisorTools as kn, FanoutSynthesis as ko, RunDetachedTurnOptions as kp, pickChampion as kr, DeclaredCheckStateCapture as ks, patchDelivered as kt, readWorkerSteerRequests as ku, createVerifierEnvironment as l, BenchmarkStrategySummary as la, PursuitNodeCost as lc, PairwiseVerdict as ld, Question as lf, promptResourceProfileMaterialization as lg, InMemoryConversationJournal as lh, probeSandboxCapabilities as li, CoordinationVerbs as ll, DelegationProfile as lm, dumbContinuationPassPrompt as ln, harvestCorpus as lo, CoderReviewer as lp, defaultStructuralRolloutPolicy as lr, PersonaContext as ls, parseWorkerToolTraceArtifact as lt, CoordinationLog as lu, SurfaceReadOutcome as m, AgenticOptions as ma, PursuitNodeUsage as mc, renderLeaderboardHtml as md, QuestionLevel as mf, ConversationPolicy as mh, startRetainedRun as mi, ResolveSupervisorTools as ml, DelegationStatusResult as mm, DispatchReport as mn, ObserveOptions as mo, UiAuditorDelegate as mp, sandboxCheckRunner as mr, ShapeContext as ms, FencedSqlRunContext as mt, RunCancellation as mu, AnalystFinding$1 as n, McpEnvironmentOptions as na, assertPursuitVersions as nc, AxisScoresOf as nd, DownMessageDeliveryAttempt as nf, controlProfileMaterialization as ng, D1StmtLike as nh, ForkCapableBox as ni, SupervisorSpanAttributes as nl, DelegateUiAuditResult as nm, PromptHandle as nn, InProcessPromptCtx as no, validateDelegateArgs as np, StructuralRolloutPolicy as nr, WidenSpec as ns, localShell as nt, CoordinationMcpHandle as nu, computeFindingId$1 as o, BenchmarkConfig as oa, SupervisedPursuitResult as oc, LeaderboardOptions as od, EventAcknowledgement as of, promptControlProfileMaterialization as og, ConversationJournal as oh, createSandboxLineage as oi, createSupervisorSpanRecorder as ol, DelegationHistoryArgs as om, createPromptRegistry as on, HarvestError as oo, eventToSnapshot as op, compareCheckOutcomes as or, LoopShape as os, WORKER_TOOL_TRACE_SCHEMA_VERSION as ot, CoordinationHttpAudit as ou, SurfaceReadBox as p, runBenchmark as pa, PursuitNodeTiming as pc, pairwiseSignificance as pd, QuestionEscalationTarget as pf, worktreeCliProfileMaterialization as pg, ConversationParticipant as ph, recoverRetainedRun as pi, ResolveDriveHarness as pl, DelegationStatusArgs as pm, promptHandle as pn, ObserveInput as po, SettleDetachedCoderTurnOptions as pp, resolveEntrySymbol as pr, ShapeBudget as ps, createSupervisor as pt, RunCancelRequest as pu, copyUntrackedIntoClone as q, TERMINAL_DECISIONS as qa, retryPreSpawnRefusals as qc, ContinuationInstruction as qd, createMcpServer as qf, AgentProfileMaterializationAxis as qh, widen as qi, DeliveredOutput as ql, DeliverableSpec as qm, CheckExecChannel as qn, TrajectoryNode as qo, DelegateCodeConfig as qp, OpenSandboxRunBeforeStartContext as qr, PursuitVersionStop as qs, GraphEdgeCapError as qt, writeWorkerSteer as qu, CreateSandboxOptions$1 as r, createMcpEnvironment as ra, pursuitVersionRun as rc, GroupOf as rd, DownMessageDeliveryOutcome as rf, defineProfileMaterializationContract as rg, SqlAdapter as rh, SandboxLineage as ri, SupervisorSpanOptions as rl, DelegateUiAuditRoute as rm, PromptRegistry as rn, InProcessSandboxClientOptions as ro, FeedbackEvent as rp, StructuralRolloutResult as rr, WinnerStrategy as rs, runInWorkspace as rt, CoordinationPublicAddress as ru, makeFinding$1 as s, BenchmarkLift as sa, supervisePursuit as sc, LeaderboardRow as sd, MakeWorkerAgent as sf, promptModelProfileMaterialization as sg, ConversationJournalEntry as sh, CriuCapableClient as si, CoordinationBinding as sl, DelegationHistoryEntry as sm, delegatesWorkerBriefPrompt as sn, HarvestFailure as so, CoderDelegate as sp, composeCheckSources as sr, Outcome as ss, WorkerToolTraceArtifact as st, CoordinationHttpOptions as su, AgentProfile$2 as t, McpEndpoint as ta, VersionVerdict as tc, stopSentinel as td, DownMessageAuthorizationInput as tf, assertProfileMaterialization as tg, D1DatabaseLike as th, CheckpointCapableBox as ti, withRunContext as tl, DelegateUiAuditConfig as tm, runGraphWithTestBrain as tn, InProcessOnPrompt as to, createDelegateHandler as tp, StructuralRolloutMessage as tr, WidenLineage as ts, jjWorkspace as tt, CoordinationAuthentication as tu, BoxSurfaceReaderOptions as u, BenchmarkTaskRow as ua, PursuitNodePlacement as uc, ProfileKeyOf as ud, QuestionDecision as uf, renderProfileMaterializationIssues as ug, AuthSource as uh, AcquireOptions as ui, DriveHarness as ul, DelegationProgress as um, formatPromptHandle as un, Observation as uo, DelegateRunCtx as up, filterAuthoredAsserts as ur, PersonaExecutors as us, workerTraceAnalysisStore as ut, CoordinationOwnerId as uu, fsSurfaceReader as v, AgenticTool as va, PursuitStatus as vc, AuditIntentInput as vd, QuestionUrgency as vf, HaltContext as vh, reconnectRetainedInteractiveRun as vi, SupervisorNodeContext as vl, UiAuditLensFilter as vm, freeSlots as vn, AssertTraceDerivedFindings as vo, DelegationExecutor as vp, ChampionPick as vr, LeaderboardBenchTask as vs, ScopeArgs as vt, WorkerSteerRequest as vu, SurfaceWorkerOut as w, StrategyArtifacts as wa, createFileObserverHooks as wc, AnytimeStrategySummary as wd, SuperviseProfileEntry as wf, BackendCallPolicy as wh, PromotionVerdict as wi, resolveSupervisorProfile as wl, DelegationTraceCaps as wm, DriverAgentOptions as wn, EqualKOnCost as wo, DetachedSessionRefParts as wp, EvolutionGeneration as wr, LeaderboardScore as ws, ProvisionSupervisorRequest as wt, readRunCancelRequest as wu, SuperviseSurfaceOptions as x, RunAgenticOptions as xa, ObserverJournal as xc, auditIntent as xd, SpawnPreflightContext as xf, HaltSignal as xh, ResolveSandboxClientOptions as xi, SupervisorToolDescriptor as xl, CappedDelegationTrace as xm, DelegateOptions as xn, CorpusFilter as xo, SiblingSandboxExecutorOptions as xp, EvolutionAuthor as xr, LeaderboardIterationInfo as xs, SqlRunContext as xt, cancelWorker as xu, harvestSurfaceDiffs as y, ArtifactHandle as ya, projectPursuit as yc, AuditIntentOptions as yd, SettledWorker as yf, HaltPredicate as yh, recoverRetainedInteractiveRun as yi, SupervisorNodeContextSeed as yl, UiAuditorDelegationOutput as ym, queueOf as yn, CombinatorShape as yo, FleetHandle as yp, ChampionPolicy as yr, LeaderboardBenchmarkAdapter as ys, createScope as yt, WriteWorkerSteerOptions as yu, NOTE_MAX_CHARS as z, LoopDispatchOptions as za, superviseWithTestBrain as zc, AnalystLensOutput as zd, SpawnResourceRead as zf, SpawnForestNode as zh, renderCorpusToInstructions as zi, createProgressTracker as zl, BusRecord as zm, AuthoredProfile as zn, Pipeline as zo, DelegationResumeTick as zp, MaterializeLocalMcpOptions as zr, IsolatedCheckResult as zs, readWorkerInteractiveAdmissions as zt, workerControlLogFile as zu };
//# sourceMappingURL=index-Dm8SHDGW.d.ts.map