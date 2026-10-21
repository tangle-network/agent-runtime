import type { AgentProfile } from '@tangle-network/agent-interface'
import type { McpToolDescriptor } from '../../mcp/server'
import type { AnalystRegistry, AnalyzeOnSettleRoute } from '../../mcp/tools/coordination-analysts'
import type {
  GraphSubtasks,
  MakeWorkerAgent,
  PeerAuditAccess,
  SpawnPreflight,
  SuperviseProfileEntry,
} from '../../mcp/tools/coordination-contracts'
import type { CoordinationEvent, WorkerWatchOptions } from '../../mcp/tools/coordination-events'
import type { MapOnSettleRoute } from '../../mcp/tools/coordination-map-contracts'
import type { AuthorizeDownMessage, ContinuityMode } from '../../mcp/tools/coordination-messages'
import type { ChildQuestionInbox, EscalateQuestion } from '../../mcp/tools/coordination-questions'
import type { DecideGate, RouteFlow } from '../../mcp/tools/coordination-route-contracts'
import type { SpawnResourceReader } from '../../mcp/tools/spawn-resource-paths'
import type { HarnessTranscriptCapture } from '../harness-transcript'
import type { RouterTransportConfig } from '../router-http-transport'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import type { ContinuationPolicy } from './continuation'
import type { PriorCoordination } from './coordination-log'
import type { CoordinationTransportOptions } from './coordination-mcp'
import type { DriverAttemptRecord, DriverContinuationRecord } from './driver-attempt-evidence'
import type { DriverReentry, DriverRetryPolicy } from './driver-retry'
import type { BusRecord } from './event-bus'
import type { SupervisorFinalizer } from './finalizer'
import type { PeerMailLimits } from './peer-mail'
import type { ExecutorProgress } from './progress'
import type { ReentryContinuity } from './reentry'
import type { RunCancelRequest } from './run-cancellation'
import type { StopRule } from './stop-rules'
import type { SupervisorProfile } from './supervisor-agent-profile'
import type { TraceSource } from './trace-source'
import type { Budget, ExecutorResult, NodeExecutionIdentity, ResultBlobStore, Scope } from './types'
import type { ManagerWakePolicy } from './wake'

export type CoordinationBinding = CoordinationTransportOptions

/** Trusted run/node identity Runtime binds to one manager. Model-authored tool arguments cannot
 *  provide or replace any of these fields. */
export interface SupervisorNodeContext {
  readonly runId: string
  /** Stable across a durable restart; unique per in-memory invocation. */
  readonly runNamespace: string
  /** Concrete Scope node that owns this manager's coordination stream. */
  readonly nodeId: string
  /** Stable identity of this manager's coordination stream. */
  readonly ownerId: string
  /** Stable first-level peer manager owner, inherited by its managed descendants when peer audit is enabled. */
  readonly peerRootOwnerId?: string
  readonly depth: number
  readonly identity: NodeExecutionIdentity
  /** Assignment identity within the parent manager; absent only for the root. */
  readonly assignmentId?: string
  readonly profile: SupervisorProfile
  readonly task: unknown
}

/** Context known before `Agent.act`; Runtime adds the concrete node, profile, and task. */
export type SupervisorNodeContextSeed = Omit<SupervisorNodeContext, 'nodeId' | 'profile' | 'task'>

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
export interface CoordinationVerbs {
  spawnAgent(args: unknown): Promise<unknown>
  /** Wait in code until at least one of `{ workerIds }` has settled; returns `{ settled: ids }`.
   *  Takes nothing from the manager's inbox, so the manager still hears of each settlement. */
  awaitSettlement(args: unknown): Promise<unknown>
  steerAgent(args: unknown): Promise<unknown>
  observeAgent(args: unknown): Promise<unknown>
  listQuestions(args: unknown): Promise<unknown>
  answerQuestion(args: unknown): Promise<unknown>
  runAnalyst(args: unknown): Promise<unknown>
  /** This manager's OWN coordination journal, paged and redacted. A read, so a program may consult
   *  what it already did without spending a model turn on it. */
  readJournal(args: unknown): Promise<unknown>
  /** Define a new trace-analyst lens for this run. Composition, not lifecycle: a program may define
   *  a lens and run it over the children it just joined, inside one model turn. */
  defineAnalyst(args: unknown): Promise<unknown>
}

/** Trusted context for one product-tool invocation. The node identity remains the same detached,
 * immutable snapshot supplied to the resolver; `signal` and `verbs` are the live control
 * references Runtime adds. `signal` aborts when this manager's scope is cancelled by the caller,
 * RootHandle, deadline, breaker, or a recursive parent; `verbs` composes THIS manager's children
 * in code (see {@link CoordinationVerbs}). */
export interface SupervisorToolInvocationContext extends SupervisorNodeContext {
  readonly signal: AbortSignal
  readonly verbs: CoordinationVerbs
  /** The static face (name / description / inputSchema) of every coordination tool mounted on
   *  THIS manager — the same objects that define the tools, so a product surface rendered from
   *  them (code mode's `search`) can never drift from the grant. Late-bound like `verbs`: a call
   *  before the coordination tools exist throws instead of answering an empty grant. */
  readonly coordinationTools: () => ReadonlyArray<CoordinationToolFace>
}

/** One mounted coordination tool's static face; the handler is deliberately absent. */
export interface CoordinationToolFace {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: unknown
}

/** One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies
 *  the trusted invocation context as a separate argument and binds the result for either
 *  transport. Existing handlers remain compatible: the second argument only gains `signal`. */
export interface SupervisorToolDescriptor extends Omit<McpToolDescriptor, 'handler'> {
  readonly handler: (raw: unknown, context: SupervisorToolInvocationContext) => Promise<unknown>
}

/** Product policy for the tools one exact supervisor node may call. Resolved once per node. */
export type ResolveSupervisorTools = (
  context: SupervisorNodeContext,
) => ReadonlyArray<SupervisorToolDescriptor> | Promise<ReadonlyArray<SupervisorToolDescriptor>>

/** Context-aware observer used internally to bind product transactions to the actual live node. */
export type ObserveSupervisorNodeEvent = (
  context: SupervisorNodeContext,
  event: CoordinationEvent,
  record: BusRecord<CoordinationEvent>,
) => void | Promise<void>

/** How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate
 *  seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 *  `task` in its backend (remote sandbox or local CLI bridge) with `coordinationMcpUrl` mounted as an MCP server,
 *  so the harness calls spawn_worker / observe_agent / submit_result as native tools over the live scope. */
export interface DriveHarness {
  (args: {
    /** The exact provider-visible projection. Runtime-owned coordination tool declarations are
     *  removed only when their descriptors are actually mounted; send this profile to the provider. */
    readonly profile: SupervisorProfile
    /** The immutable canonical profile Runtime admitted. Use it only to bind receipts or audit
     *  authority; never send it to a provider, because it contains Runtime-owned declarations. */
    readonly authoredProfile: SupervisorProfile
    /** The profile the run registered, when `authoredProfile` is another segment of it (a resumed root moved to
     *  another model or harness). Materialization receipts are attributed to it, so a run's materialization chain
     *  keeps one authored profile across segments. Absent when the two are the same. */
    readonly registeredProfile?: SupervisorProfile
    /** The standing instruction assembled from the profile: its system prompt in either spelling,
     *  plus the `prompt.instructions` and `resources.instructions` lines. Absent when the profile
     *  names none — the harness's own default then applies. This, not `profile.systemPrompt`, is
     *  what the harness should run under. */
    readonly systemPrompt?: string
    readonly task: unknown
    readonly scope: Scope<unknown>
    readonly coordinationMcpUrl: string
    /** Runtime-only transport credentials; never append them to the authored profile or task. */
    readonly coordinationMcpHeaders?: Readonly<Record<string, string>>
    /** Parent-minted peer post office. Runtime attachment only, never part of the profile. */
    readonly peerMailUrl?: string
    /** Fires when the coordination server accepts a result or declares completion. */
    readonly stopSignal?: AbortSignal
    /** Data-only product tool surface mounted on the coordination MCP. Runtime-owned drivers include
     *  this in their materialization evidence without persisting executable handlers. */
    readonly coordinationTools: ReadonlyArray<Omit<McpToolDescriptor, 'handler'>>
    /** The manager's `continuation.session` on every drive, re-entered or not. `fresh`: each drive
     *  that carries `reentry` starts a new harness session, keeping the environment and its files;
     *  `compose` then always writes the full re-entry task. Absent or `native`: today's
     *  same-session continuation where the backend proves it. */
    readonly session?: 'native' | 'fresh'
    /** Present when this drive re-enters the run. `task` then carries the original objective and
     *  the coordinator's run state, which is right for any backend. A harness that can prove what
     *  the next turn continues composes the task from that proof instead, and reports it. */
    readonly reentry?: {
      /** Why Runtime is re-entering; a typed usage limit may advance an authored seat chain. */
      readonly reason: DriverReentry
      readonly compose: (continuity: ReentryContinuity) => string
      readonly onContinuity?: (continuity: ReentryContinuity) => void
      /** Bring a wake up to date immediately before `compose`, after any wait for the previous
       *  turn's workspace capture, so the turn names what settled during that wait. */
      readonly refresh?: () => Promise<void>
    }
    /** Call once per model event the harness streams: text, reasoning, or a tool call or result.
     *  On a run this process took over after a restart, the driver counts no drive toward its
     *  no-progress bound until the first call, so a harness that never calls it leaves that run
     *  bounded only by the continuation deadline, the run's deadline and its budget. */
    readonly onModelEvent?: () => void
  }): Promise<void>
  /** Optional live inbox for the manager session this adapter currently drives. Return `false`
   * when no executor inbox is active instead of claiming a message was delivered. */
  deliver?(message: unknown): boolean
  /** Optional readiness predicate for the live inbox. Root steers remain durable and unclaimed
   * until this returns `true`; it is checked only while the harness invocation is active. */
  deliverReady?(): boolean
  /** Optional live evidence from the harness execution currently being driven. */
  traceSource?(): TraceSource | undefined
  /** Optional live progress from the harness execution currently being driven. */
  progress?(): ExecutorProgress | undefined
  /** Terminal artifact from the newest successfully completed invocation. A child without a
   * completion check retains its output as unassessed evidence for its parent. */
  resultArtifact?(): ExecutorResult<unknown> | undefined
  /** Optional capture of the manager's own harness session from its newest attempt. */
  harnessTranscript?(): HarnessTranscriptCapture | undefined
  /** Resolves once {@link harnessTranscript} is final (`Executor.harnessTranscriptSettled`). */
  harnessTranscriptSettled?(): Promise<void>
  /** Close the last subscription segment at this logical manager's settlement. */
  closeSeatSegment?(reason: 'completed' | 'failed' | 'cancelled' | 'paused'): Promise<void>
}

/** Trusted manager identity available before its external harness starts. A product uses this to
 * return one independently steerable harness session per recursive manager. */
export type DriveHarnessOwnerContext = Omit<SupervisorNodeContext, 'nodeId'>

/** Resolve an external harness for one exact Runtime-owned manager identity. */
export type ResolveDriveHarness = (context: DriveHarnessOwnerContext) => DriveHarness

export interface SupervisorAgentDeps {
  /** Parent post office bound to this manager's worker identity. */
  readonly peerMailUrl?: string
  readonly blobs: ResultBlobStore
  /** Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Serve `run_graph` (both arms) — see `CoordinationToolsOptions.graphs`. */
  readonly graphs?: GraphSubtasks
  /** Product authorization for every down-leg continuation to a child. */
  readonly authorizeDownMessage?: AuthorizeDownMessage
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Keep an inference turn available when recursive admission holds budget for this manager. */
  readonly preserveOwnerTurns?: true
  /** Runtime-owned sink for provider identity observed by this manager's own turns. */
  readonly onProviderModel?: (model: string | undefined) => void
  /** Independent completion check for direct driver work (`submit_result`). */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Receives a result only after this manager's completion check accepted it. */
  readonly onAcceptedSubmission?: (result: unknown) => void
  /** Reports that a nested unchecked manager returned its own harness evidence, not a checked
   * finalizer result. Recursive settlement must preserve the absence of a quality verdict. */
  readonly onUnassessedOutput?: (result: unknown) => void
  /** Router substrate for a router-brained supervisor (`harness` omitted or `cli-base`). The
   *  profile's model wins. */
  readonly router?: RouterTransportConfig
  /** Required to run an external-harness supervisor: runs the harness as the driver. */
  readonly driveHarness?: DriveHarness
  /** How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
   *  `driver-failed` (#741). Retries reuse the same scope, coordination server, and live children;
   *  the bridge backend reattaches the harness session by its durable execution id. Omit = retry
   *  under the defaults; `{ enabled: false }` = the historical first-failure-ends-the-run behavior.
   *  The router arm is unaffected: its transport already retries. */
  readonly driverRetry?: DriverRetryPolicy
  /** The profile this manager was registered with, when it executes another segment of it (a resumed root moved
   *  to another model or harness, `SuperviseOptions.segment`). Its materialization stays attributed to the
   *  registered profile, as a seat's does to the profile that authored the seat; the executed profile is its
   *  effective profile. Omit = the executed profile is the registered one. */
  readonly registeredProfile?: AgentProfile
  /** Per-attempt record for the external driver — how an operator sees "failed after N attempts"
   *  instead of one backend's last words. */
  readonly onDriverAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  /** Called once when the external driver loop ends, returned or thrown, with what it did. */
  readonly onDriverLoopSettled?: (record: DriverContinuationRecord) => void
  /** How an EXTERNAL manager with `deliverable` is sent back when its turn ends with the check
   *  unmet: the deadline, `maxBarren`, and the note's profile and switches (`src/runtime/supervise/continuation.ts`).
   *  Required with `deliverable` on the external arm, refused without one, and refused for a
   *  router-brained supervisor, which runs its own turn loop in process. The harness owns its own
   *  turn loop, so it can end while the run has delivered nothing — 376 of 376 winning
   *  discovery-lab runs (2026-09-01) ended on the driver's own completion. A continuation reuses the
   *  retry path: same scope, same coordination server, same live children, same bounds. */
  readonly continuation?: ContinuationPolicy
  /** Where this manager's continuation files go (`<dir>/<n>/note.md`, `verdict.json`,
   *  `panel.jsonl`). Omit to keep them in memory, where `read_continuation` still serves them. */
  readonly continuationDir?: string
  /** The root manager's `root-stream.jsonl`; the question panel reads it as the director's trace. */
  readonly rootStreamPath?: string
  /** Trusted identity for this manager. Required with node-scoped tools or observation. */
  readonly nodeContext?: SupervisorNodeContextSeed
  /** Resolve product-owned tools for this exact manager. Static `extraTools` remain a router-only
   *  compatibility seam and deliberately receive no new recursive authority. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools
  /** Awaited product observation, enriched with this manager's actual live node context. */
  readonly observeNodeEvent?: ObserveSupervisorNodeEvent
  /** Replay resume-time settlements through `observeNodeEvent` before the manager starts. */
  readonly replaySettlements?: boolean
  /** WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
   *  only delegate when it needs parallelism. Pair with `executeExtraTool`. */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call; null/undefined falls through to the coordination dispatch. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  /** Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`. */
  readonly analysts?: AnalystRegistry
  /** Where an `ask_parent` question goes when it leaves this manager. Omit and `ask_parent` reports
   *  `no-parent` — there is no runtime path that routes a question to a parent by itself. */
  readonly escalateQuestion?: EscalateQuestion
  /** Receives this manager's intake for questions its child managers raise. */
  readonly onChildQuestionInbox?: (inbox: ChildQuestionInbox) => void
  /** Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
   *  (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Maps expanded when their source worker settles (both arms). Omit = none. */
  readonly mapOnSettle?: ReadonlyArray<MapOnSettleRoute>
  /** The flow this root manager runs (router arm only; see `RouteFlow`). Omit = none. */
  readonly routeFlow?: RouteFlow
  /** Answers the gates of `routeFlow` (`SuperviseOptions.decideGate`). */
  readonly decideGate?: DecideGate
  /** Trusted source refs for this manager’s existing observe_agent capability. */
  readonly sourceEvidenceRefs?: ReadonlyArray<string>
  readonly peerAudit?: PeerAuditAccess
  /** Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
   *  learns a worker is looping mid-run instead of at settle. Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default. */
  readonly stallAfterMs?: number
  /** How Runtime wakes this manager after it ends a turn with work open (both arms). Omit = the
   *  defaults in `./wake`. */
  readonly wake?: ManagerWakePolicy
  /** Default continuity per worker PROFILE NAME (both arms) — `'resume'` re-attaches spawns of
   *  that name to the node's latest settled worker; `spawn_worker`'s per-call `continuity`
   *  overrides. Omit = every spawn fresh (status quo). */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /** PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped learning BEFORE it
   *  exhausts a ceiling; it can never keep a run alive past one. Router arm: evaluated before each
   *  driver inference turn. External arm: evaluated on each worker settle, and a stop aborts
   *  `stopSignal` so the harness ends at its next turn boundary. Build it with `plateau` /
   *  `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
   *  caller's judgment. Omit = ceilings only. */
  readonly stopRule?: StopRule
  /** One-shot notification of WHY a `stopRule` ended the run (BOTH arms). */
  readonly onProgressStop?: (reason: string, request?: RunCancelRequest) => void
  /** Turn cap for the supervisor's own loop. Router arm: driver inference turns (see
   *  `DriverAgentOptions.maxTurns`). External arm: the cap belongs to the harness loop, so
   *  `supervise()` applies it in the drive seam it builds and this field is not read here. */
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY; a
   *  harness-brained supervisor is refused at construction rather than silently ignoring it) — it
   *  distills its coordination transcript to a compact progress note once it exceeds the threshold,
   *  instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`. */
  readonly compaction?: ToolLoopCompactionOptions
  /** Pass-through subscriber for every coordination bus event (both arms) — the seam a durable
   *  caller hooks its coordination log onto. */
  readonly onEvent?: (
    event: CoordinationEvent,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** Questions, findings, and authorized continuation receipts loaded from a prior process.
   *  Router arm: questions seed the ledger and all evidence enters the resume brief. External arm:
   *  questions seed the ledger; receipts remain durable evidence and are never auto-delivered. */
  readonly priorCoordination?: PriorCoordination
  /** Deferred owner-scoped replay for a recursive supervisor. Its stable owner is known while the
   * parent authorizes the child, but loading remains asynchronous; Runtime calls this before the
   * nested brain can publish or act on coordination state. */
  readonly loadPriorCoordination?: () => Promise<PriorCoordination>
  /** How the settled ledger becomes the run's output (both arms). Default `bestDelivered` — the
   *  exact keep-best every existing caller had. Always runs under the delivered-only invariant. */
  readonly finalizer?: SupervisorFinalizer
  /** Where the coordination MCP binds (external arm). Omit = an ephemeral loopback port, which is
   *  unreachable from an off-host harness. A non-loopback host fails closed — see
   *  `assertCoordinationBinding`. */
  readonly coordination?: CoordinationBinding
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
   *  pre-journal point that may ask the backend a question (does this bridge route the child's
   *  wire id; is it already at admission capacity). `supervise` derives one automatically for a
   *  bridge backend; see `CoordinationToolsOptions.preflightSpawn`. */
  readonly preflightSpawn?: SpawnPreflight
  /** Pre-journal profile resolution for `preflightSpawn`: the authored profile → the profile that
   *  will run, so the gate judges the canonical profile. See
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** Composition of each authored child profile before identity is fixed —
   *  `CoordinationToolsOptions.composeSpawnProfile`. */
  readonly composeSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** The run's validated profiles table — `CoordinationToolsOptions.profiles`. */
  readonly profiles?: ReadonlyMap<string, SuperviseProfileEntry>
  /** See `CoordinationToolsOptions.spawnResourceRoot`: the directory a spawn's inline resource
   *  `path` resolves under. Set only for a manager whose workspace this process can read. */
  readonly spawnResourceRoot?: string
  /** See `CoordinationToolsOptions.spawnResourceReader`: the manager's own environment as the
   *  source of a by-path resource, for a manager whose workspace is a sandbox this process
   *  cannot open. */
  readonly spawnResourceReader?: SpawnResourceReader
  /** OPT-IN peer mail (external arm): serve the sibling `send_mail` / `read_mail` post office
   *  beside the coordination MCP and mint each spawn a capability URL on
   *  `WorkerSpawnContext.peerMailUrl`. A router-brained supervisor is refused: it serves no
   *  listener, so there is no post office a worker could reach. */
  readonly peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
  /** Durable control directory. Both arms acknowledge worker requests; external managers observe
   *  them throughout the harness invocation. See `DriverAgentOptions.controlDir`. */
  readonly controlDir?: string
  /** Durable steer directory when it differs from the run-control directory. */
  readonly steerDir?: string
  /** Which cancel requests this manager's acknowledger owns: `'run'` (default; the tree root —
   *  its own direct-child node ids plus label/profile-name references) or `'subtree'` (a nested
   *  manager — exact direct-child node ids only). Exactly one manager owns any request, so two
   *  acknowledgers can never apply one operation. See `DriverAgentOptions.controlScope`. */
  readonly controlScope?: 'run' | 'subtree'
  /** Abort the whole run — the seam a run-scoped cancel request is applied through (both arms,
   *  `'run'` scope only). See `DriverAgentOptions.abortRun`. */
  readonly abortRun?: (reason: string, request?: RunCancelRequest) => void
}

/** Test-only dependency shape. It is exported only through the package's explicit `/testing`
 * entry; production supervisor surfaces cannot replace profile-derived model execution. */
export interface SupervisorAgentTestDeps extends SupervisorAgentDeps {
  readonly brain: ToolLoopChat
}
