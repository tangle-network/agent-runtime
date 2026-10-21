import type { PairedPromotionDecision } from '@tangle-network/agent-eval'
import type { SealedExperiment } from '@tangle-network/agent-eval/experiment'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { Redactor } from '../../redact'
import type {
  AgentExecutionRef,
  Budget,
  BudgetViolation,
  ExecutionBindingReceipt,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  ResultBlobStore,
  Scope,
  SpawnModelSubstitution,
  Spend,
  SubtreeSummary,
  Agent as SuperviseAgent,
  WorkerTraceEvidence,
} from '../../runtime'
import type { RuntimeFailureCause } from '../../runtime/failure-cause'
import type { DeliverableSpec } from '../../runtime/supervise/completion-gate'
import type { CheckRead, CheckVerdict } from '../../runtime/supervise/continuation'
import type { BusRecord, BusStats } from '../../runtime/supervise/event-bus'
import type { PeerMailbox, PeerMailLimits } from '../../runtime/supervise/peer-mail'
import type { McpToolDescriptor } from '../server'
import type {
  AnalystFindingEvent,
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  DefinedAnalystRecord,
} from './coordination-analysts'
import type {
  AwaitWakeInput,
  CoordinationEvent,
  ManagerReentryState,
  ManagerWake,
  WorkerWatchOptions,
} from './coordination-events'
import type { MapOnSettleRoute, MapSpawnMarker } from './coordination-map-contracts'
import type {
  AuthorizeDownMessage,
  ContinuityMode,
  DownMessageEvent,
  WorkerResumeContext,
} from './coordination-messages'
import type {
  ChildQuestionInbox,
  EscalateQuestion,
  QuestionEscalationRecord,
  QuestionPolicy,
  QuestionRecord,
} from './coordination-questions'
import type { DecideGate, RouteFlow, RouteSpawnMarker } from './coordination-route-contracts'
import type { SpawnResourceReader } from './spawn-resource-paths'

/** A worker whose settlement reached the manager's inbox. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
  readonly assignmentId?: string
  /** Exact profile/task/candidate identity authorized for this node. */
  readonly identity?: NodeExecutionIdentity
  /** The model this worker ran when authorization replaced the one its manager authored. */
  readonly modelSubstitution?: SpawnModelSubstitution
  readonly modelWarning?: string
  /** Stable effective execution plan, or an explicit unknown receipt. */
  readonly materialization?: ProfileMaterializationReceipt
  /** Backend bindings for each attempt, in durable oldest-first order. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>
  /** Conserved spend. Missing means unavailable; unknown accounting remains explicitly unknown. */
  readonly spent?: Spend
  readonly score?: number
  readonly valid?: boolean
  readonly outRef?: string
  readonly reason?: string
  /** Why a `down` worker failed, as values: branch on `code` and `owner`, never on `reason`. */
  readonly failure?: RuntimeFailureCause
  /** Present when the worker's measured spend exceeded its reservation. The pool already charged
   *  the true spend; a `done` worker's output is still its result. */
  readonly budgetViolation?: BudgetViolation
  /** The same overspend for a reader: `tokens 235,857 of 42,000; deadline 3,857 s of 2,400 s`. A
   *  `done` worker with it was stopped by its budget at a turn boundary, not finished with its
   *  task. */
  readonly budgetStop?: string
  /** With `budgetStop` on a keyed worker: how to continue its session or release it. */
  readonly budgetStopNext?: string
  /** Structured tool-call evidence, never the worker's final prose. */
  readonly trace: WorkerTraceEvidence
  /** True when projected from a prior process of the same durable run. */
  readonly resumed?: boolean
  /** Epoch ms from the durable terminal record — the resolution a progress-based stop rule needs
   *  to answer "how long since anything landed?" without inventing a timestamp at read time. */
  readonly settledAt?: number
  /** Present when this worker led workers of its own: its team's counts and its own direct
   *  children's results, each readable in full through `observe_agent({ outRef })`. */
  readonly subtree?: SubtreeSummary
}

/** Immutable task, allocation, identity attribution, and semantic key supplied while a manager's
 * complete worker profile is prepared for one spawn. */
export interface WorkerSpawnContext {
  /** Stable assignment identity within this manager. A semantic key wins; otherwise Runtime mints
   * the manager's deterministic pre-factory spawn ordinal so identical unkeyed siblings stay
   * isolated and can recover by issuing the same assignments in the same order. */
  readonly assignmentId: string
  /** Trusted concrete manager node authorizing this spawn. Never accepted from model arguments. */
  readonly parentNodeId: string
  /** The exact allocation this node receives after the tool's optional override is merged. */
  readonly budget: Budget
  /** Detached, deeply immutable task bytes from this spawn request. */
  readonly task: unknown
  /** Exact trace label selected for this spawn. */
  readonly label: string
  /** Semantic restart key, when the manager supplied one. */
  readonly key?: string
  /** Trusted candidate/campaign attribution attached by product authorization. */
  readonly execution?: AgentExecutionRef
  /** Present (as the analyst id) ONLY when this spawn is an analyst-AGENT run initiated by the
   *  runtime's analyst-on-settle hook ({@link AnalyzeOnSettleRoute.agent}) — authored by the
   *  runtime, never accepted from a driver's tool arguments. A node-pinning `makeWorkerAgent`
   *  reads it to admit the analyst node it would refuse as a driver-authored spawn. */
  readonly analyst?: string
  /** Runtime-authorized immutable evidence for this analyst assignment. Only these refs extend
   * its existing observe_agent capability; callers never supply them through tool arguments. */
  readonly sourceEvidenceRefs?: ReadonlyArray<string>
  /** The EFFECTIVE continuity mode of this spawn — the spawn tool's per-call argument when given,
   *  else the profile name's declared default ({@link CoordinationToolsOptions.continuityByProfile}),
   *  else `'fresh'`. Absent only from producers that predate continuity — read absence as
   *  `'fresh'`. */
  readonly continuity?: ContinuityMode
  /** Present iff `continuity === 'resume'`: the lineage the executor seam re-attaches with. */
  readonly resume?: WorkerResumeContext
  /** The settled worker this spawn replaces, when the manager named one (`spawn_worker`'s
   *  `successorOf`). Runtime admits only a settled worker of the same manager and journals the
   *  relation on the new node, so the run record shows who took over whose work. A seam may read
   *  it to hand the successor its predecessor's workspace or retained output; Runtime mounts
   *  nothing on its behalf. Independent of `resume`, which re-attaches the same node's session. */
  readonly successorOf?: string
  /** Present only when a map route started this spawn ({@link MapOnSettleRoute}) — authored by
   *  the runtime, never accepted from tool arguments. A node-pinning seam reads it to admit the
   *  map's item or join node, which no driver may spawn. */
  readonly map?: MapSpawnMarker
  /** Present only when a flow's entry or routes edge started this spawn ({@link RouteFlow}) —
   *  authored by the runtime, never accepted from tool arguments. A node-pinning seam reads it to
   *  admit the node the edge names, which no driver may spawn. */
  readonly route?: RouteSpawnMarker
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
  readonly peerMailUrl?: string
}

export type MakeWorkerAgent = (
  profile: AgentProfile,
  context?: WorkerSpawnContext,
) => SuperviseAgent<unknown, unknown>

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
export interface SuperviseProfileEntry {
  readonly profile: AgentProfile
  readonly promotion?: {
    readonly experiment: SealedExperiment
    readonly decision: PairedPromotionDecision
  }
}

/** Run-owned read routing between sibling managers. It grants no mutation tools. */
export interface PeerAuditAccess {
  register(nodeId: string, tools: ReadonlyArray<McpToolDescriptor>): void
  read(
    peerId: string,
    tool: 'observe_agent' | 'read_journal',
    args: Record<string, unknown>,
  ): Promise<unknown>
}

/** A graph a manager asked `run_graph` to run, validated and composed by the run that owns the
 *  worker path, or the reason it was refused. */
export type GraphSubtaskPreparation =
  | {
      readonly ok: true
      /** The exact profile the spawn runs: the root node's pinned profile with the graph brief. */
      readonly profile: AgentProfile
      readonly root: string
      readonly nodes: ReadonlyArray<string>
    }
  | { readonly ok: false; readonly reason: string }

/** How a run starts an agent graph as ONE subtask of a manager (`run_graph`). `supervise()`
 *  supplies it when it owns the worker path: the graph's root node then runs as a nested manager
 *  under the graph's node pinning, inside the caller's reservation. */
export interface GraphSubtasks {
  /** Validate a graph a manager wrote, or load a stored one by digest, and compose the exact root
   *  profile the spawn runs. Never throws: a refusal carries its reason. */
  readonly prepare: (input: {
    readonly graph?: unknown
    readonly graphDigest?: string
  }) => Promise<GraphSubtaskPreparation>
}

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly peerAudit?: PeerAuditAccess
  readonly blobs: ResultBlobStore
  /** Trusted immutable source refs this manager may read using its granted observe_agent tool. */
  readonly sourceEvidenceRefs?: ReadonlyArray<string>
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly perWorker: Budget
  /** Serve `run_graph`, which starts an agent graph as one subtask under this manager's conserved
   *  pool. Present only when the run's worker path pins graph nodes; absent, the verb is not
   *  mounted and a profile that grants it is refused at construction. */
  readonly graphs?: GraphSubtasks
  /** Called once when this manager declares completion through `stop` or an accepted submission. */
  readonly onStop?: (reason: string | undefined) => void
  /**
   * The same independent completion check used for workers. When present, the driver receives a
   * `submit_result` tool and may finish work itself instead of being forced to delegate it. The
   * first passing submission is retained; a false or throwing check fails closed. A manager with a
   * check is not served `stop`: it ends through `submit_result`, or when a bound ends the run.
   */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Serve `read_continuation`: the full continuation files the note refers to. Supplied by the
   *  manager's continuation policy; the director's box cannot read the driver's run directory. */
  readonly readContinuation?: (continuation: number | undefined) => unknown
  readonly analysts?: AnalystRegistry
  /** Event-first for source compatibility; the second argument is its exact bus ordering stamp. */
  readonly onEvent?: (
    event: CoordinationEvent,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** Re-publish resumed settlements through the awaited observer before the driver starts. This is
   *  the crash-window recovery path for product transactions; off preserves low-level legacy reads. */
  readonly replaySettlements?: boolean
  /** Authorize each continuation against the exact worker identity. The returned instruction is
   * detached, recorded durably through `onEvent`, and only then delivered. */
  readonly authorizeDownMessage?: AuthorizeDownMessage
  readonly questionPolicy?: QuestionPolicy
  /** Analyst lenses run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle hook).
   *  A bare string names a lens whose findings go to THE DRIVER: published as a `finding` event on
   *  the bus — pass-through to subscribers and queued for the driver's next wake. An
   *  {@link AnalyzeOnSettleRoute} generalizes the DESTINATION: findings can be delivered to a
   *  named live WORKER (wrapped in the route's directive, through the same authorized steer
   *  machinery a driver steer uses) instead of being hardwired to the spawning driver, and `over`
   *  restricts which settled workers feed the lens. A route carrying `agent` generalizes the
   *  ANALYST itself: a tool-equipped agent spawned as a worker whose settle output is the
   *  findings (see {@link AnalyzeOnSettleRoute.agent}). Omit/empty = no auto-analysis (default;
   *  the driver can still run lenses on demand via `run_analyst`). Lens routes require
   *  `analysts`; agent routes do not. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Maps expanded by the runtime when their source settles (see {@link MapOnSettleRoute}). Omit =
   *  none. */
  readonly mapOnSettle?: ReadonlyArray<MapOnSettleRoute>
  /** The flow this manager runs (see {@link RouteFlow}): Runtime spawns its entries when the
   *  coordination opens and routes every settle of a flow node. Set only by `runGraph` for a graph
   *  with `entry`, whose manager makes no decision of its own. Omit = none. */
  readonly routeFlow?: RouteFlow
  /** Answers each visit to a gate of `routeFlow`. The route step awaits it, bounded by the run's
   *  deadline and abort signal. Set by `runGraph` from `RunGraphOptions.decideGate`. */
  readonly decideGate?: DecideGate
  /**
   * OPT-IN: run the ONLINE detector panel over each spawned worker's live tool trace and raise a
   * `finding` on the bus the moment a detector fires — so the driver learns "this worker is
   * looping" mid-run, in its next wake, instead of at settle.
   *
   * This closes the `watchTrace` → `raiseFinding` wire whose own docstring already described it
   * ("the seam an ONLINE detector uses to tell the driver 'this worker is looping/erroring' the
   * moment it happens") but which nothing connected. Workers whose executor exposes no
   * `traceSource` are simply not watched; nothing fails.
   *
   * Omit = no online watching (the settle-time analysts are unaffected).
   */
  readonly watchWorkers?: WorkerWatchOptions
  /**
   * How long a worker may go without metered activity before `observe_agent` reports it as
   * `stalled`. A derived read at observation time, never a background watchdog — nothing is
   * killed or retried. Omit = the runtime default.
   */
  readonly stallAfterMs?: number
  /**
   * Questions carried over from a prior process of the SAME run (a durable coordination log a
   * resuming caller replays). Seeded into the question ledger verbatim — `list_questions` shows
   * them, the stop policy counts the still-blocking ones, and `answer_question` can decide them.
   * Omit/empty = fresh ledger (every run that is not a resume).
   */
  readonly priorQuestions?: ReadonlyArray<QuestionRecord>
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
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /**
   * OPT-IN: give this manager's workers a bounded SIBLING channel (`../../runtime/supervise/
   * peer-mail`). Each spawn is minted a capability endpoint handed out on
   * {@link WorkerSpawnContext.peerMailUrl}; every attempt, delivered or refused, publishes a
   * `mail` event so the parent audits a channel it no longer relays. Omit = no peer channel and no
   * capability is minted (the status quo: a worker is reachable only by its parent).
   */
  readonly peerMail?: { readonly limits?: Partial<PeerMailLimits> }
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
  readonly preflightSpawn?: SpawnPreflight
  /**
   * OPT-IN pre-journal PROFILE resolution: maps the profile a driver authored to the profile that
   * will actually run, before `preflightSpawn` asks the backend about it. A layer that pins
   * profiles by name (an agent graph) installs this so the gate judges the canonical profile —
   * its real model, tools and harness — never the `{ name }` stub the driver wrote. Synchronous,
   * throw-on-refusal, identity-free: it sees only the profile, never the assignment or budget,
   * because both are minted AFTER the pre-journal point. Omit = the authored profile is used.
   */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /**
   * OPT-IN composition of the profile a manager authored, applied right after it parses and before
   * continuity, pre-flight, authorization, or the journal see it. The composed profile is the
   * child's profile: its identity, its receipt, and what runs. Pure and synchronous; its output is
   * re-validated against the canonical schema. `supervise({ profileGuidance: 'profile-kb' })`
   * installs `withProfileKb` here so each child carries its harness and model guidance.
   */
  readonly composeSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /**
   * The run's profiles table, validated and frozen by `supervise` (`SuperviseRegistry.profiles`).
   * When it holds an entry, `spawn_worker` also takes `profile` as one of its names and lists the
   * names in its schema. The named profile replaces the authored one before composition,
   * continuity, pre-flight, authorization, or the journal see it. An authored profile whose `name`
   * is a table name is refused, so one name never means two profiles. Omit or empty = the tool is
   * unchanged.
   */
  readonly profiles?: ReadonlyMap<string, SuperviseProfileEntry>
  /**
   * Directory the coordination server may read on the manager's behalf when a spawn names an
   * inline resource by path (`{ kind: 'inline', name, path }` under `profile.resources`). The
   * server substitutes the file's bytes as `content` BEFORE the canonical schema sees the
   * profile, so the model's own output never carries them. Omit = a resource by path is refused
   * with the reason; see `spawn-resource-paths.ts` for the measurement that motivates it.
   */
  readonly spawnResourceRoot?: string
  /**
   * Where a by-path resource's bytes come from when the manager's workspace is NOT a directory
   * this process can open: a manager inside a provider sandbox, whose files only the provider can
   * serve. Built with `environmentReader(environment)` from the manager's own `AgentEnvironment`.
   * Takes precedence over `spawnResourceRoot` when both are set, because a sandbox manager's files
   * are on its box, not on this host. Omit and `spawnResourceRoot` applies as before.
   */
  readonly spawnResourceReader?: SpawnResourceReader
  /**
   * OPT-IN parent channel for `ask_parent`. See {@link EscalateQuestion}.
   *
   * Omit and this manager is treated as the TOP of its question chain: `ask_parent` still raises and
   * journals the question, and answers `escalated: false, outcome: 'no-parent'` so the manager knows
   * it must decide the question itself rather than wait.
   */
  readonly escalateQuestion?: EscalateQuestion
  /** Receives this manager's {@link ChildQuestionInbox} once its tools exist, so Runtime can route
   *  a child manager's `ask_parent` here. */
  readonly onChildQuestionInbox?: (inbox: ChildQuestionInbox) => void
  /**
   * Escalations this manager made in a PRIOR process of the same durable run
   * (`PriorCoordination.escalations`). Seeded verbatim, so after a restart `stop` still knows which
   * blocking questions reached no parent and still names the way out. Without it the record is
   * journaled, reloaded, and then forgotten by the only reader that acts on it.
   */
  readonly priorEscalations?: ReadonlyArray<QuestionEscalationRecord>
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
  readonly redactJournal?: Redactor | false
  /**
   * The served tools `report_blocked` may probe, by bare name: the coordination verbs plus the
   * node tools bound to this manager. The transport that serves both supplies it; without it the
   * probe reaches the coordination verbs only.
   */
  readonly resolveProbeTool?: (name: string) => McpToolDescriptor | undefined
  /**
   * Rows written by PRIOR processes of this durable run (`PriorCoordination.records`), prepended to
   * the live bus so `read_journal` answers for the whole run rather than the current process.
   *
   * Without it a resumed manager reads a nearly empty journal and concludes it tried nothing —
   * which is the exact failure the verb exists to prevent. The rows are marked `prior: true` and
   * are never re-published on the bus: they are evidence, not events to react to.
   */
  readonly priorJournal?: ReadonlyArray<BusRecord<CoordinationEvent>>
  /** Hard cap on lenses THIS manager may define through `define_analyst`. Omit =
   *  `ANALYST_DEFINITION_BOUNDS.maxDefinitionsPerManager`; `<= 0` = no cap. Reached, the verb
   *  refuses with `error: 'max-defined-analysts'` and names the cap, so a manager that has been
   *  defining instead of investigating reads why. */
  readonly maxDefinedAnalysts?: number
  /**
   * Lenses this manager DEFINED in a prior process of the same durable run
   * (`PriorCoordination.analystDefinitions`). Seeded verbatim: they are on the menu again, they
   * count against {@link CoordinationToolsOptions.maxDefinedAnalysts}, and re-defining one is a
   * `duplicate-analyst` refusal rather than a silent second registration. Re-registering them with
   * the analyst registry is the owner's decision, because the registry may have changed between
   * processes; this option only restores what the manager is allowed to believe it already wrote.
   */
  readonly priorAnalystDefinitions?: ReadonlyArray<DefinedAnalystRecord>
}

/** Why a pre-flight refused a spawn. Each cause is a distinct, separately countable decision. */
export type SpawnRefusalCause =
  | 'model-route'
  | 'bridge-full'
  | 'unmountable-tool'
  | 'unprovisionable-profile'

/** A pre-flight's refusal: the cause it decided on, and the operator-facing evidence for it. */
export interface SpawnRefusal {
  readonly cause: SpawnRefusalCause
  /** Names the exact thing that failed — the unrouted wire id, the admission numbers, the tool. */
  readonly detail: string
}

/** What a pre-flight sees: the authored child profile and the spawn it is being asked to admit. */
export interface SpawnPreflightContext {
  readonly label: string
  readonly key?: string
  readonly task: unknown
}

/** The gate `CoordinationToolsOptions.preflightSpawn` installs. */
export type SpawnPreflight = (
  profile: AgentProfile,
  context: SpawnPreflightContext,
) => Promise<SpawnRefusal | undefined>

/** Bus throughput plus the pre-flight's own refusal ledger. */
export interface CoordinationStats extends BusStats {
  /** One counter per refusal cause, present only when a pre-flight is installed. */
  readonly preflight?: Readonly<Record<SpawnRefusalCause, number>>
}

/**
 * The supervisor-side toolbox returned by {@link createCoordinationTools}: the MCP tool
 * descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
 * over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
 * `raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
 * choice, steerable counterpart to the one-shot own-sandbox delegation MCP.
 */
export interface CoordinationTools {
  readonly tools: McpToolDescriptor[]
  /** Commit any resume-time event replay before a supervisor can reason or an MCP can listen. */
  ready(): Promise<void>
  isStopped(): boolean
  stopReason(): string | undefined
  /** The first result whose injected independent check passed, if the driver submitted one. */
  submittedResult(): { readonly result: unknown } | undefined
  settled(): ReadonlyArray<SettledWorker>
  questions(): ReadonlyArray<QuestionRecord>
  /** Every `ask_parent` escalation and what became of it, in raise order. An undelivered one is a
   *  question this run raised and nothing answered — the operator's read of a run that went quiet. */
  escalations(): ReadonlyArray<QuestionEscalationRecord>
  /** Every lens this manager defined at run time, in definition order — the same records published
   *  as `analyst-defined` events. Empty when the registry admits no authored lens. */
  definedAnalysts(): ReadonlyArray<DefinedAnalystRecord>
  /** The full ordered log of every bus event — UP (settled / question / finding), authorized
   *  instruction receipts, and DOWN delivery outcomes (steer / answer). Each record carries seq,
   *  timestamp, and priority. A receipt is evidence and is never auto-delivered on restart. */
  history(): ReadonlyArray<BusRecord<CoordinationEvent>>
  /** Bus throughput counters (published / pulled / by-kind) for live dashboards, plus one
   *  counter per {@link SpawnRefusalCause} the pre-flight refused. `preflight` is present
   *  whenever `preflightSpawn` is installed, with every cause at 0 until one fires — a gate that
   *  never refuses has to be readable as such. */
  stats(): CoordinationStats
  /** The run's peer-mail post office, present only when `peerMail` was enabled. The transport
   *  layer stands the capability endpoint up over it; the parent reads `history()` for the audit
   *  trail and calls `stopThread` to end a peer exchange. */
  readonly peerMail?: PeerMailbox
  /** Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
   *  (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
   *  moment it happens, instead of only at settle. Queued for the next wake + pass-through. */
  raiseFinding(finding: AnalystFindingEvent): Promise<void>
  /** Authorize, durably record, and attempt one external steer through the same down-leg used by
   * `steer_agent`. The returned outcome is exact and is never inferred from queue admission. */
  steerWorker(
    workerId: string,
    instruction: string,
    options?: { readonly interrupt?: boolean },
  ): Promise<DownMessageEvent>
  /**
   * Abort ONE live worker this manager spawned, through the worker's own per-child abort chain
   * (the scope cascades that abort into the worker's subtree and no sibling). `ref` resolves
   * workerId-first, then profile name, then spawn label, against LIVE workers only. Returns the
   * resolved identity, or `undefined` when no live worker matches — an already-settled or unknown
   * reference is never reported as aborted. The runtime cancel acknowledger is the intended
   * caller; the durable contract around it lives in `supervise/run-layout`.
   */
  abortWorker(
    ref: string,
    reason?: string,
  ): { readonly id: string; readonly label: string } | undefined
  /**
   * Post-loop drain: pull every ALREADY-settled, unpulled child into the ledger (publishing each
   * as a `settled` bus event for the audit trail) WITHOUT awaiting live children. The driver
   * calls this once its brain loop ends, so a delivered child the brain never awaited still
   * reaches `finalizeBestDelivered` — a gate-verified delivery must never be lost to the
   * driver's pull discipline. Analyst-on-settle hooks do NOT fire here (the driver has stopped;
   * nobody is left to read a finding, and analysts spend real compute). Returns the count.
   */
  drainResolved(): Promise<number>
  /** Await opted-in manager-end analyst agents inside the original scope and resource limits.
   * Their findings remain evidence and never replace the manager's output or enter its ledger. */
  finishAnalysis(input: {
    status: 'done' | 'down'
    output?: unknown
    reason?: string
  }): Promise<void>
  /** Mark the start of one driver attempt, so deliveries are attributed to the turn that got them. */
  beginDriverAttempt(attempt: number): void
  /** Mark the end of the current driver attempt. A completed turn acknowledges what it received;
   *  a failed one leaves its deliveries unacknowledged for the next re-entry to name. */
  endDriverAttempt(outcome: 'completed' | 'failed'): Promise<void>
  /** True while this manager has work it must hear back about: a worker running, a result or
   *  question not yet delivered, or a tool call still running past its response fence. A turn
   *  that ends with open work is a wait, not a completion. */
  hasOpenWork(): boolean
  /** Wait, with no model turn, until something reaches this manager's inbox, the heartbeat
   *  elapses, or the deadline warning comes due; then deliver everything that arrived. Undefined
   *  when no work is open or the signal aborted. */
  awaitWake(input: AwaitWakeInput): Promise<ManagerWake | undefined>
  /** Wait in code, with no model turn, until at least one of `workerIds` has settled into this
   *  manager's ledger; returns the ids that have. Nothing is taken from the inbox: the manager
   *  still receives each settlement in its own wake. Empty when none of them is live or settled. */
  awaitSettlement(
    workerIds: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<string>>
  /** Queue a steer or answer from this manager's lead for its next wake. False when the message
   *  is neither. The publish is in-process; a durable subscriber records it. */
  receiveLeadMessage(message: unknown): boolean
  /** Register a tool call that outlived its response fence; returns the receipt its caller is
   *  given. The call is open work until {@link CoordinationTools.settleToolReceipt}. */
  openToolReceipt(tool: string): string
  /** Publish the outcome of a receipted tool call to the inbox, where the next wake delivers it. */
  settleToolReceipt(
    receipt: string,
    outcome:
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: unknown },
  ): Promise<void>
  /** The run state a re-entered manager is told, read from this coordinator's own records. */
  reentryState(): ManagerReentryState
  /** Every time this manager's completion check ran, oldest first: each `submit_result`, and each
   *  turn end the manager recorded through {@link CoordinationTools.recordCheckRead}. */
  checkReads(): ReadonlyArray<CheckRead>
  /** Record a check read that happened outside `submit_result`, such as a turn end. */
  recordCheckRead(read: {
    readonly source: CheckRead['source']
    readonly verdict?: CheckVerdict
    readonly unavailable?: string
  }): CheckRead
  /** Every `report_blocked` whose probe failed too, in report order. A blocked tool is evidence,
   *  not a terminal condition: the run goes on, and the no-progress bound ends it when it cannot. */
  blocked(): ReadonlyArray<BlockedToolReport>
}

/** One `report_blocked` whose probe failed too.
 *  It names the tool, the error the manager saw, and the error the coordinator's own call returned. */
export interface BlockedToolReport {
  readonly tool: string
  readonly reported: string
  readonly probed: string
  readonly at: string
}

export type ResolvedContinuity =
  | { readonly continuity: 'fresh' }
  | { readonly continuity: 'resume'; readonly resume: WorkerResumeContext }
  | { readonly error: string; readonly hint: string }

/** One spawn whose exact profile is decided. `spawn_worker` and `run_graph` both admit through
 *  {@link admitSpawn}, so a graph subtask takes the same pre-flight, budget reservation, key
 *  semantics and response as any worker. */
export interface SpawnAdmission {
  readonly profile: AgentProfile
  readonly args: Record<string, unknown>
  readonly task: unknown
  readonly key: string | undefined
  readonly continuity: Exclude<ResolvedContinuity, { readonly error: string }>
  readonly successorOf: string | undefined
  /** The profile the pre-flight judges: a pinning layer's canonical profile. Read only when a
   *  pre-flight is configured. */
  readonly preflightProfile: () => AgentProfile
  /** The receipt for every resource the server read by path. */
  readonly resourcesFromPath: ReadonlyArray<unknown>
  readonly defaultLabel: string
  /** Fields a started spawn adds to its response. */
  readonly accepted?: Readonly<Record<string, unknown>>
  /** Set when a map route, never a tool call, started this spawn. */
  readonly map?: MapSpawnMarker
  /** Set when a flow's entry or routes edge, never a tool call, started this spawn. */
  readonly route?: RouteSpawnMarker
}
