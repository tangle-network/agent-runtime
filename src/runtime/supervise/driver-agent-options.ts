import type { AgentProfile } from '@tangle-network/agent-interface'
import type { McpToolDescriptor } from '../../mcp/server'
import type { AnalystRegistry, AnalyzeOnSettleRoute } from '../../mcp/tools/coordination-analysts'
import type {
  CoordinationTools,
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
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import type { PriorCoordination } from './coordination-log'
import type { BusRecord } from './event-bus'
import type { SupervisorFinalizer } from './finalizer'
import type { Inbox } from './inbox'
import type { RouterTranscript } from './router-transcript'
import type { StopRule } from './stop-rules'
import type { Budget, ResultBlobStore } from './types'
import type { ManagerWakePolicy } from './wake'

export interface DriverAgentOptions {
  readonly name: string
  /** The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
   *  (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
   *  production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape. */
  readonly brain: ToolLoopChat
  /** Profile-declared model for a production Router brain. When set, every turn must report this
   * exact provider-observed model before its output is accepted. Omitted by scripted test brains. */
  readonly expectedModel?: string
  /** Runtime-owned observation sink for the provider identity of each settled driver turn. */
  readonly onProviderModel?: (model: string | undefined) => void
  /** Shared blob store — `observe_agent` reads settled outputs through it. */
  readonly blobs: ResultBlobStore
  /** Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Serve `run_graph` — see `CoordinationToolsOptions.graphs`. */
  readonly graphs?: GraphSubtasks
  readonly authorizeDownMessage?: AuthorizeDownMessage
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker: Budget
  /** Allow the manager's own metered turn after child admission reaches its protected share. */
  readonly preserveOwnerTurns?: true
  /** Independent completion check for work the driver performs itself. When present, the driver
   *  receives `submit_result`; the first passing submission ends the loop and becomes the output. */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Receives a result only after this manager's completion check accepted it. */
  readonly onAcceptedSubmission?: (result: unknown) => void
  /** The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
   *  Unset → no analyst feed (status quo: the driver gets settled outputs, no findings). */
  readonly analysts?: AnalystRegistry
  /** Where an `ask_parent` question goes when it leaves this manager. Omit = `no-parent`. */
  readonly escalateQuestion?: EscalateQuestion
  /** Receives this manager's intake for questions its child managers raise. */
  readonly onChildQuestionInbox?: (inbox: ChildQuestionInbox) => void
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
   *  `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
   *  loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Maps expanded when their source worker settles (`CoordinationToolsOptions.mapOnSettle`). */
  readonly mapOnSettle?: ReadonlyArray<MapOnSettleRoute>
  /** The flow this manager runs (`CoordinationToolsOptions.routeFlow`). Requires the runtime flow
   *  brain, which makes no model call. */
  readonly routeFlow?: RouteFlow
  /** Answers the gates of `routeFlow` (`CoordinationToolsOptions.decideGate`). */
  readonly decideGate?: DecideGate
  /** Trusted source refs for this manager’s existing observe_agent capability. */
  readonly sourceEvidenceRefs?: ReadonlyArray<string>
  readonly peerAudit?: PeerAuditAccess
  /** Run the ONLINE detector panel over each worker's LIVE tool trace and raise a `finding` the
   *  moment it loops/error-storms — mid-run evidence to steer on, not a settle-time post-mortem.
   *  Omit = no online watching. */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a worker as stalled (a derived read; nothing is
   *  killed). Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** How Runtime wakes this driver after a turn that ends with work open. Omit = the defaults in
   *  `./wake`. */
  readonly wake?: ManagerWakePolicy
  /** Default continuity per worker PROFILE NAME — `'resume'` makes spawns of that name re-attach
   *  to the node's latest settled worker (see
   *  `CoordinationToolsOptions.continuityByProfile`); `spawn_worker`'s per-call `continuity`
   *  argument overrides. Omit = every spawn fresh (status quo). */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /** OPT-IN async gate run before every spawn mints an assignment or reserves budget. See
   *  `CoordinationToolsOptions.preflightSpawn`. */
  readonly preflightSpawn?: SpawnPreflight
  /** Pre-journal profile resolution for `preflightSpawn`; see
   *  `CoordinationToolsOptions.resolveSpawnProfile`. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** Composition of each authored child profile before identity is fixed —
   *  `CoordinationToolsOptions.composeSpawnProfile`. */
  readonly composeSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** The run's validated profiles table — `CoordinationToolsOptions.profiles`. */
  readonly profiles?: ReadonlyMap<string, SuperviseProfileEntry>
  /** See `CoordinationToolsOptions.spawnResourceRoot`. */
  readonly spawnResourceRoot?: string
  /** See `CoordinationToolsOptions.spawnResourceReader`. */
  readonly spawnResourceReader?: SpawnResourceReader
  /** The driver's stance — a string, or built from the task (the worker-driver prompt /
   *  the generator). INJECTED so the prompt is a pluggable, optimizable role. */
  readonly systemPrompt: string | ((task: unknown) => string)
  /** Product-selected tools already bound to this exact supervisor node. The same descriptors are
   *  served over MCP for external supervisors; this arm projects them into router ToolSpecs. */
  readonly nodeTools?: ReadonlyArray<McpToolDescriptor>
  /** Exact bare names to expose from the coordination, node-tool, and direct-work-tool set.
   *  Runtime never grants an implicit complete tool set. */
  readonly toolNames: ReadonlyArray<string>
  /** WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
   *  not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
   *  Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
   *  `executeExtraTool`. Unset → coordination-only (the prior behavior). */
  readonly extraTools?: ReadonlyArray<{
    readonly name: string
    readonly description?: string
    readonly parameters: Record<string, unknown>
  }>
  /** Runs an `extraTools` call. Returns a string result, or null/undefined to signal "not handled"
   *  so the call falls through to the coordination dispatch. Required iff `extraTools` is set. */
  readonly executeExtraTool?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string | null | undefined>
  /** Max driver turns before the loop force-finalizes on the best settled child. Default: no
   *  turn-count cap. The loop is bounded by the conserved budget pool (every driver turn is metered
   *  into it), an absolute deadline, the driver's own stop, and abort, all checked before each
   *  turn. Without a deadline, a manager stops once it has overdrawn its pool by the pool's size
   *  again, and a brain that reports no usage keeps a 16-turn bound unless a dollar cap applies. A manager awaits one settlement per turn, so the old default of 16 ended any manager
   *  with more than about 14 workers and tore its unfinished workers down: measured 2026-09-25 on
   *  a 1 + 20 + 400 tree, 124 of 420 agents settled `down` at 16 and none at 0. */
  readonly maxTurns?: number
  /** Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
   *  deterministic in tests. Defaults to `Date.now`. */
  readonly now?: () => number
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
  readonly stopRule?: StopRule
  /** Called once with the rule's reason when a `stopRule` ends the run — so a caller can record
   *  WHY a run stopped early instead of inferring it from an unexhausted budget. */
  readonly onProgressStop?: (
    reason: string,
    request?: import('./run-layout').RunCancelRequest,
  ) => void
  /** Give the driver brain a chapter-lifecycle on its OWN context window. The LLM-brain front doors
   *  lose to a dumb-Ralph respawn because the brain re-bills its whole coordination transcript every
   *  turn — the same context overflow a single steered agent suffers, one level up. With this set,
   *  once the brain's running conversation exceeds `thresholdTokens` it distills the accumulated
   *  history to a compact progress note and continues fresh: the supervisor analog of respawning
   *  against external tracking state, except the live `Scope` roster IS the durable state. Default
   *  off (no behavior change). `distill` defaults to a self-summary authored by the brain combined
   *  with the factual settled-worker roster; override to supply your own. */
  readonly compaction?: ToolLoopCompactionOptions
  /** Pass-through subscriber for every coordination bus event: settled/question/finding,
   *  pre-delivery instruction receipts, and steer/answer delivery outcomes. A durable caller uses
   *  this to append the coordination log. Omit = no observer. */
  readonly onEvent?: (
    event: CoordinationEvent,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** Re-publish resume-time settlements through the awaited observer before the first brain turn. */
  readonly replaySettlements?: boolean
  /** Questions, findings, and authorized continuation receipts loaded from a prior process.
   *  Questions seed the ledger (`list_questions`, blocking-stop policy); all three feed the resume
   *  brief. Continuation receipts are evidence only and are never auto-delivered. Omit = fresh. */
  readonly priorCoordination?: PriorCoordination
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact keep-best every existing caller had). Runs under
   *  the delivered-only invariant (`runFinalizer`): whatever the finalizer, an undelivered or
   *  invalid child's output stays unreachable. */
  readonly finalizer?: SupervisorFinalizer
  /** The recorder of this agent's conversation. A wrapper that builds a new driver for each `act`
   *  passes one recorder to all of them, so the agent keeps one transcript across attempts.
   *  @internal Runtime's own wiring between `supervisorAgent` and its router arm. */
  transcript?: RouterTranscript
  /** Optional shared manager inbox used by a wrapper that must accept messages before async node
   * setup finishes. Ordinary callers omit it and the driver owns a fresh inbox. */
  readonly inbox?: Inbox
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
  readonly controlDir?: string
  /** Durable steer directory when it differs from the run-control directory. */
  readonly steerDir?: string
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
  readonly onCoordinationTools?: (
    tools: ReadonlyArray<McpToolDescriptor>,
    coordination: Pick<CoordinationTools, 'awaitSettlement'>,
  ) => void
  readonly controlScope?: 'run' | 'subtree'
  /**
   * Abort the WHOLE run — the seam a run-scoped cancel request (`cancelRun`) is applied through.
   * Wired by `supervise()` to the run's ONE cascade controller (the attached root control), so a
   * run cancel takes the same path a caller's `RootHandle.abort` takes; there is no second
   * controller and no poller. Read only by the `'run'`-scoped manager with a `controlDir`; omit
   * and a run-scoped request stays unanswered.
   */
  readonly abortRun?: (reason: string, request?: import('./run-layout').RunCancelRequest) => void
}
