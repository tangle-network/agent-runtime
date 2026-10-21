import type {
  AgentProfile,
  AgentProfileSecurityPolicy,
  ReasoningEffort,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import type { ProfileMaterializationContract } from '../../agent/profile-materialization'
import type { AnalystRegistry, AnalyzeOnSettleRoute } from '../../mcp/tools/coordination-analysts'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination-contracts'
import type { CoordinationEvent, WorkerWatchOptions } from '../../mcp/tools/coordination-events'
import type { MapOnSettleRoute, MapSpawnMarker } from '../../mcp/tools/coordination-map-contracts'
import type {
  AuthorizedDownMessage,
  ContinuityMode,
  DownMessageAuthorizationInput,
} from '../../mcp/tools/coordination-messages'
import type { EscalateQuestion } from '../../mcp/tools/coordination-questions'
import type {
  DecideGate,
  RouteFlow,
  RouteSpawnMarker,
} from '../../mcp/tools/coordination-route-contracts'
import type { RuntimeHooks } from '../../runtime-hooks'
import type { RouterTransportConfig } from '../router-http-transport'
import type { ToolLoopChat, ToolLoopCompactionOptions } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import type { ContinuationPolicy } from './continuation'
import type { DeadlineCheckIn } from './deadline'
import type { DriverAttemptRecord, DriverRetryPolicy } from './driver-retry'
import type { BusRecord } from './event-bus'
import type { SupervisorFinalizer } from './finalizer'
import type { SupervisorSpanOptions } from './otel-spans'
import type { PeerMailLimits } from './peer-mail'
import type { RunContext } from './run-context'
import type { ExecutorConfig } from './runtime'
import type { SelectSeat } from './seat-chain'
import type { PlateauOptions, StopRule } from './stop-rules'
import type { SuperviseRegistry } from './supervise-registry'
import type {
  CoordinationBinding,
  DriveHarness,
  ResolveDriveHarness,
  ResolveSupervisorTools,
  SupervisorNodeContext,
} from './supervisor-agent'
import type {
  AgentExecutionRef,
  Budget,
  ExecutorFactory,
  NodeExecutionIdentity,
  RecursiveReservationPolicy,
  ResultBlobStore,
  RootHandle,
  SpawnJournal,
} from './types'
import type { ManagerWakePolicy } from './wake'
import type { WorkerSpawnRetryAttempt, WorkerSpawnRetryPolicy } from './worker-retry'
import type { WorkerSlots } from './worker-slots'

export interface SuperviseOptions {
  /** Whole-run persistence and ownership. SQL contexts are acquired before replay and compute. */
  readonly runContext?: RunContext
  /** The conserved compute pool for the whole run. */
  readonly budget: Budget
  /** Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
   * attaches it before execution and detaches it after the join barrier. */
  readonly rootHandle?: RootHandle<unknown>
  /** Caller-owned cancellation for the complete recursive run. Aborting it cascades through the
   * root scope and every live child, including acquisition and backend execution. */
  readonly signal?: AbortSignal
  /** Trusted candidate and pursuit attribution for the root. The runtime derives profile/task
   * digests itself from the exact detached values it executes. */
  readonly execution?: AgentExecutionRef
  /** WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig
  /** Resolve an authored subscription stage to one eligible seat and a backend pinned to its
   * credential reference. The callback may report stage exhaustion with `resumeAt`; Runtime
   * advances the authored chain and never writes credentials into its record. */
  readonly selectSeat?: SelectSeat
  /** The independent completion check for backend-derived workers and direct supervisor
   *  submissions. Strongly recommended: without it the supervisor cannot submit its own work and
   *  backend-derived workers fall back to their own validity signal. A `string` names an entry in
   *  `registry.deliverables`. */
  readonly deliverable?: DeliverableSpec<unknown> | string
  /** Resolve the completion check for one exact authorized backend-derived child. The callback runs
   * after spawn authorization and receives a detached immutable context. It may return `undefined`
   * to use the run-wide `deliverable`, or `null` to omit this child's assignment check and continuation.
   * Null does not turn completion into acceptance or erase existing backend/descendant verdicts.
   * An unchecked child must declare compatible tools: disable inherited spawn rights and author its
   * coordination grants without `submit_result` or `read_continuation`. Explicit incompatible
   * grants remain refused; the authorized profile is never rewritten after this callback. */
  readonly resolveDeliverable?: (
    input: DeliverableResolutionInput,
  ) => DeliverableSpec<unknown> | null | undefined
  /** Name→value tables for the four code-valued options, so a recorded run configuration can name
   *  them instead of carrying closures. See {@link SuperviseRegistry}. */
  readonly registry?: SuperviseRegistry
  /** Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
   *  port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
   *  unless authentication is configured; provider managers also need a reachable public URL. */
  readonly coordination?: CoordinationBinding
  /** OPT-IN peer mail for the run's workers: sibling-to-sibling `send_mail` / `read_mail`, bounded
   *  and audited (`CoordinationToolsOptions.peerMail`). The runtime mints one capability URL per
   *  spawn, serves the mail listener beside the coordination MCP, and hands each worker its
   *  endpoint on {@link WorkerSpawnContext.peerMailUrl}.
   *
   *  On the backend-derived worker path the runtime also MOUNTS that endpoint, the way a driver
   *  receives its coordination MCP: out of band on the bridge's `runtime_attachments`, so the
   *  authored profile digest never moves, and inside the leaf factory, so `authorizeSpawn` has
   *  already decided the profile. A `bridge` worker therefore calls `send_mail` / `read_mail` as
   *  native tools. `provider` workers mount it through their runtime MCP attachment capability. `router` and `router-tools` workers run no MCP client, so the URL
   *  stays the caller's to use; every other backend refuses the spawn rather than mint a
   *  capability it can never reach. A caller-owned `makeWorkerAgent` owns its own mount.
   *
   *  Requires a harness-brained supervisor; a router-brained supervisor is refused rather than
   *  silently unmailed. */
  readonly peerMail?: boolean | { limits?: Partial<PeerMailLimits> }
  /** Let sibling root managers read each other's recorded evidence. No mutation or steering. Default false. */
  readonly peerAudit?: boolean
  /** False removes observe_agent/read_journal from the root and every authored descendant. Default true. */
  readonly traceTools?: boolean
  /** Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
   *  This is caller-owned execution: profile security, spawn authorization, and recursive-driver
   *  selection below apply only to the backend-derived worker path. `authorizeMessage` still
   *  governs continuations sent through Runtime's coordination tools. */
  readonly makeWorkerAgent?: MakeWorkerAgent
  /** Override ONLY how an authorized LEAF executes, keeping the whole backend-derived path —
   *  profile security, spawn authorization, recursive-driver selection, nested supervisors — in
   *  force. Unlike `makeWorkerAgent`, which replaces that path, this slots inside it: the kernel
   *  authorizes and classifies every spawn, and a child that is NOT a driver runs through this
   *  factory instead of `backend`. A child that IS a driver still becomes a nested supervisor, whose
   *  own leaves use this same factory. Composes with `authorizeSpawn`; `backend` is then optional.
   *  This is the seam an offline test or a pinning layer (an agent graph) should use. */
  readonly makeLeafAgent?: MakeWorkerAgent
  /** Reconstruct executors for interrupted children on resume, for a run that owns its worker
   *  factory (`makeWorkerAgent`/`makeLeafAgent`). Backend-derived recursive managers register one
   *  automatically; a caller-owned factory cannot be, so a leaf whose execution can RE-ATTACH
   *  across a process boundary (a sandbox session, a CLI bridge session — an executor that
   *  journals its admission through the retained seam) needs this for a resume to recover the
   *  in-flight child instead of refusing its key `in-doubt`. The factory receives the
   *  reconstructed spec and the child's journaled context, including its prior admissions. */
  readonly recoverExecutor?: ExecutorFactory<unknown>
  /** Run harness-brained supervisors here. Automatic execution supports a local `bridge`, or a
   * provider advertising runtime MCP attachments with authenticated `coordination.publicUrl`.
   *  Defaults to `backend`; separate it when managers and workers use different services. */
  readonly driverBackend?: ExecutorConfig
  /** Security policy applied to every manager-authored child profile before budget reservation.
   *  The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
   *  allowlist to grant remote MCP hosts or other author-controlled capabilities. */
  readonly profileSecurity?: AgentProfileSecurityPolicy
  /** Product authority over one complete manager-authored spawn. The callback sees the detached,
   *  immutable profile, task, budget, label, and key together, so approving a profile cannot
   *  authorize a different task. Return the exact allowed profile (which may be narrowed) plus
   *  trusted candidate/pursuit attribution, or throw to refuse the whole spawn before reservation. */
  readonly authorizeSpawn?: (input: {
    readonly profile: AgentProfile
    readonly parent: AgentProfile
    /** Trusted identity of the manager authorizing this exact child. */
    readonly parentIdentity: NodeExecutionIdentity
    /** Concrete manager node; never accepted from model-authored tool arguments. */
    readonly parentNodeId: string
    /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
    readonly assignmentId: string
    readonly task: unknown
    readonly budget: Budget
    readonly label: string
    readonly key?: string
    readonly depth: number
    /** Present (as the analyst id) only when the runtime's analyst-on-settle hook initiated this
     *  spawn — authored by the runtime, never accepted from a driver's tool arguments. A node-pinning
     *  authority reads it to admit the analyst node it would refuse as a driver-authored spawn. */
    readonly analyst?: string
    /** Present only when a map route started this spawn — authored by the runtime, never accepted
     *  from tool arguments. A node-pinning authority reads it to admit the map's item or join. */
    readonly map?: MapSpawnMarker
    /** Present only when a flow's entry or routes edge started this spawn — authored by the
     *  runtime, never accepted from tool arguments. A node-pinning authority reads it to admit the
     *  node the edge names. */
    readonly route?: RouteSpawnMarker
    /** The EFFECTIVE continuity of this spawn, resolved by the coordination layer. */
    readonly continuity?: ContinuityMode
  }) => AuthorizedSpawn
  /** Product authority over every continuation sent to a live child. When spawn authorization is
   * enabled, omitting this refuses steer/answer instructions instead of silently extending the
   * authorized task. The exact worker identity and detached bytes are recorded before delivery. */
  readonly authorizeMessage?: (
    input: DownMessageAuthorizationInput & {
      readonly parent: AgentProfile
      readonly depth: number
    },
  ) => AuthorizedDownMessage
  /** The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
   *  model wins. */
  readonly router?: RouterTransportConfig
  /** When `driverBackend` is absent, whether an external-harness ROOT may default to running on
   *  `backend` (where workers run). `true` (default) keeps the convenience every direct caller has.
   *  A layer that gives `backend` a narrower meaning — `runGraph`, where it places WORKER nodes only
   *  — sets `false`, so an external root without an explicit `driverBackend` is refused before any
   *  compute rather than silently driven from the worker placement. */
  readonly rootDriverFromBackend?: boolean
  /** Pre-journal profile resolution for the spawn pre-flight: the profile a driver authored →
   *  the profile that will run (`CoordinationToolsOptions.resolveSpawnProfile`). A pinning layer
   *  sets this alongside `authorizeSpawn` so the backend gate and the authorization see the same
   *  canonical profile. Identity-free and synchronous; throw to refuse. */
  readonly resolveSpawnProfile?: (profile: AgentProfile) => AgentProfile
  /** OPT-IN standing guidance from the profile knowledge base
   *  (`@tangle-network/agent-interface/profile-kb`). `'profile-kb'` composes harness guidance,
   *  then model guidance, then the profile's own text into the root profile and into every
   *  profile a manager spawns, before identity is fixed, so receipts bind the prompt that ran.
   *  Omit to run profiles exactly as authored: Runtime selects no standing guidance by itself. */
  readonly profileGuidance?: 'profile-kb'
  /** Whether a spawned profile that declares no Runtime coordination tool receives its manager's
   *  coordination grants (`spawn_worker`, `observe_agent`, and the rest, plus `submit_result` so it
   *  can still deliver work it does itself), so every child can lead children of its own. Default
   *  `true`. A child whose author wrote any coordination entry, true or false, keeps what was
   *  written (a `false` entry is dropped once it has kept the child a leaf). A child this run
   *  cannot drive as a manager (no driver for its harness, or no `router` for a harness-less one)
   *  stays a leaf, and so does every child of a run with no completion check (`deliverable` or
   *  `resolveDeliverable`), since a manager delivers its own work only through `submit_result`.
   *  `false` runs every authored profile exactly as written. Applies to backend-derived workers;
   *  a caller-owned `makeWorkerAgent` decides its own children. */
  readonly inheritSpawnRights?: boolean
  /** The graph registry directory (`graph-registry`) whose stored graphs a manager's `run_graph`
   *  may start by `graphDigest`. Omit and `run_graph` takes graphs as data only. */
  readonly graphRegistry?: string
  /** Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
   *  caller-owned override for a local bridge. */
  readonly driveHarness?: DriveHarness
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
  readonly driverRetry?: DriverRetryPolicy
  /** Per-attempt record for every external driver in the tree — what makes "failed after N
   *  attempts, last cause X" visible instead of one backend's last words. */
  readonly onDriverAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
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
  readonly workerRetry?: WorkerSpawnRetryPolicy
  /** Per-re-entry record for every retried worker spawn — what makes a saturated executor visible
   *  as waiting rather than as a worker that silently took longer. */
  readonly onWorkerRetry?: (attempt: WorkerSpawnRetryAttempt) => void
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
   * loop ends when the check passes, at this deadline, on the budget, after `maxBarren` turns in
   * a row without progress, or on cancellation. A turn that ends, a blocked tool, and a lost
   * stream are segment boundaries, never the end of the run. Runtime writes the note from the check's verdict (`src/runtime/supervise/continuation.ts`); the
   * profile owns its words, and `append` may add a section but never replace one.
   *
   * Required with `deliverable` (or `resolveDeliverable`) for an external manager, and applied to
   * every external manager with a completion check in the tree. Refused for a router-brained
   * manager, which runs its turn loop in process.
   */
  readonly continuation?: ContinuationPolicy
  /**
   * How long live children may keep running after the root driver returns or fails, before the join
   * barrier cascades the abort into them. `null` waits until children settle or the caller cancels.
   * An explicit run deadline always wins. Omit/`0` = immediate teardown.
   */
  readonly childSettleGraceMs?: number | null
  /**
   * How long settlement keeps retrying a child teardown the executor has not confirmed, with
   * exponential backoff, before naming the child in `teardownUnconfirmed` with the provider
   * environment ids a sweeper deletes. `0` makes one attempt only. Default: 300000 (5 minutes).
   * See `SupervisorOpts.teardownConfirmMs`.
   */
  readonly teardownConfirmMs?: number
  /**
   * What root settlement does with provider environments that settled children still hold for a
   * retained execution: `'release'` them with one `environment-teardown` receipt each and close
   * each released child's cursor slot with a terminal record marked `retainedExecution:
   * 'released'`, or `'keep'` them for a later call that resumes this run. Default: `'keep'` with
   * `runDir` (re-running the same `runDir` and `runId` resumes), `'release'` without it (nothing
   * can resume an in-memory run). See `SupervisorOpts.retainedAtSettlement`.
   */
  readonly retainedAtSettlement?: 'release' | 'keep'
  /** Resolve one custom external-harness session per trusted manager identity. Use this instead of
   * `driveHarness` when recursive managers must be independently steerable. */
  readonly resolveDriveHarness?: ResolveDriveHarness
  /** Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
   * AgentProfile axes that path really applies. Built-in bridge driving supplies its own
   * full-profile contract. */
  readonly driveHarnessMaterialization?: ProfileMaterializationContract
  /** Resolve product-owned tools from the exact trusted manager context. The same descriptors and
   * handlers are bound to router and external-harness managers; resolution happens once per node.
   * Each handler receives that manager scope's live cancellation signal in its trusted invocation
   * context, including recursive parent and root cascades, plus `context.verbs` — that manager's
   * own coordination verbs, callable in code so a product tool can COMPOSE its children (fan out,
   * chain, join, retry) in one tool call instead of one model turn per verb. Every verb crosses
   * the same authorizeSpawn / security / allowedModels gate, pool reservation, worker-slot
   * queue, journal, and bus the MCP verb crosses, at every depth and on both arms. */
  readonly resolveSupervisorTools?: ResolveSupervisorTools
  /**
   * Where an `ask_parent` question goes when it leaves a manager (see {@link EscalateQuestion}).
   *
   * Installed on EVERY manager of the run, at every depth, so a driver's escalation reaches the
   * product's own inbox — a UI, an operator queue, a human. Omit and every manager reports
   * `outcome: 'no-parent'` on `ask_parent`, which is the honest reading when nothing above it is
   * listening: the runtime routes no question to a parent by itself.
   */
  readonly escalateQuestion?: EscalateQuestion
  /** Awaited product transaction hook for every coordination record. `eventId` is stable across a
   * lost acknowledgement and durable restart; the record is not pull-visible until this commits. */
  readonly onCoordinationEvent?: (
    context: SupervisorNodeContext,
    eventId: Sha256Digest,
    record: BusRecord<CoordinationEvent>,
  ) => void | Promise<void>
  /** WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
   *  itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
   *  `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`). */
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
  /** The root's default slice for a child whose manager names no `budget`. Defaults to a quarter
   *  of the part of the pool children may reserve (the pool less any owner share). A nested
   *  manager always divides its own slice that way; `spawn_worker`'s `budget` overrides per spawn. */
  readonly perWorker?: Budget
  /** Opt-in owner share: every manager, the root included, keeps this fraction of its own slice
   *  free of its children's reservations, so its own turns keep budget. Default slices shrink to fit
   *  beside it. Default: off. */
  readonly reservationPolicy?: RecursiveReservationPolicy
  /** What a child's own time box (a `spawn_worker` `budget.deadlineMs`) does. Default: a check-in;
   *  the child is told to save its state and submit what it has, and is stopped only once it then
   *  makes no progress for 30 min. `false` stops it at the time box. The run's own deadline always
   *  stops every node. See `deadline.ts` `DeadlineCheckIn`. */
  readonly deadlineCheckIn?: DeadlineCheckIn
  /** How long a keyed worker whose turn ended over its budget keeps its environment for a
   *  `spawn_worker` of the same key with a larger budget to continue the same session (ms).
   *  Default 600,000; `0` keeps none. Released earlier by `cancel_worker` or the run's end. */
  readonly budgetStopHoldMs?: number
  /** Bound on concurrently WORKING agents across the whole recursive tree: a number, or one
   *  `createWorkerSlots` allocator that several runs in this process share. A spawn past it keeps
   *  its budget slice and waits in a queue (deepest first) instead of being refused, and a manager
   *  lends its slot to its first running child, so nested waits cannot deadlock. The root holds no
   *  slot. Omit/`<= 0` = no bound (the conserved pool stays the only bound). */
  readonly workerSlots?: number | WorkerSlots
  /** Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
   *  (the driver receives settled worker outputs, no analyst findings). A `string` names an entry in
   *  `registry.analysts`. */
  readonly analysts?: AnalystRegistry | string
  /** Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
   *  the driver receives in its next wake and composes its next steer from. The self-improving UP-leg,
   *  threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
   *  Omit/empty = status quo (no analyst feed). Requires `analysts`. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Maps the runtime expands when their source worker settles: fan-out over a list in the
   *  source's result, then one join. An AgentGraph's `maps` edges set it; see `MapOnSettleRoute`.
   *  Omit = none. */
  readonly mapOnSettle?: ReadonlyArray<MapOnSettleRoute>
  /** The flow the root manager runs: an AgentGraph with `entry` sets it, together with its
   *  runtime-owned root, which makes no model call. See `RouteFlow`. Omit = none. */
  readonly routeFlow?: RouteFlow
  /** Answers each gate visit of `routeFlow`; `runGraph` sets it from `RunGraphOptions.decideGate`,
   *  replaying a decision the run journal already holds. Omit = none. */
  readonly decideGate?: DecideGate
  /**
   * Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
   * moment one loops or error-storms — so the supervisor learns it mid-run (in its next wake)
   * instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
   * is the correction. Requires a backend whose executor exposes a trace source (the steerable
   * sandbox worker and the pi wrapper do); other runtimes are simply not watched.
   *
   * Omit = off (status quo — no online watching, no extra events).
   */
  readonly watchWorkers?: WorkerWatchOptions
  /** Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
   *  at observation time — nothing is killed or retried. Omit = the runtime default. */
  readonly stallAfterMs?: number
  /** How Runtime wakes a manager that ended its turn with work open: the heartbeat, the debounce
   *  that coalesces events into one wake, and the deadline warning. Omit = the defaults in
   *  `./wake` (15 min, 2 s, 15 min). */
  readonly wake?: ManagerWakePolicy
  /** Default continuity per worker PROFILE NAME: `'resume'` makes each spawn of that name after
   *  the first re-attach to the node's most recent SETTLED worker — a NEW live worker whose spawn
   *  context carries the prior worker's identity (`WorkerSpawnContext.resume`), which the executor
   *  seam re-attaches with. `spawn_worker`'s per-call `continuity` argument overrides in either
   *  direction; `runGraph` derives this from delegates-edge `continuity`. Omit = every spawn is
   *  `'fresh'` (status quo). See `CoordinationToolsOptions.continuityByProfile` for the
   *  refusal semantics (no-prior / while-live / with-key) and the process-local resume boundary. */
  readonly continuityByProfile?: Readonly<Record<string, ContinuityMode>>
  /** Worker output store. Defaults to in-memory. */
  readonly blobs?: ResultBlobStore
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
  readonly runDir?: string
  /** Advanced test seam: opt into resume-first when the durable stores are caller-supplied
   * (`journal` + `blobs` / `runContext`) instead of derived from `runDir`. The normal durable path
   * is `runDir` or a `runContext` (see `docs/durability.md`). Exactly what the file
   * context sets automatically: load the prior tree for `runId` before starting fresh, refuse a
   * reused id without it. Ignored when `runDir` is also set — the file context owns the flag. */
  readonly resume?: boolean
  /**
   * The segment this entry runs the root in. A run keeps one id for its whole life: a turn that
   * ends, a lost stream and a dead supervisor are boundaries between entries, and a resume may move
   * the root to another model, provider, reasoning effort or harness, or onto another stack, as a
   * new segment of the same run. `profile` stays the root profile the run recorded, so its identity,
   * coordination owner and settled children resume unchanged; the root executes that profile with
   * `model.provider`, `model.default`, `model.reasoningEffort` and `harness` replaced where given. `stack` names the
   * package versions the caller runs this entry under, its Runtime among them; Runtime records it
   * and never reads it. When the segment differs from the one the run last ran, the journal gains
   * one `root-segment` record with the time and `reason`. A different task, or any other profile
   * change, is still a resume identity mismatch: that is a new run. A fresh run records its first
   * segment and refuses a model or harness change: a new run takes them from its profile.
   *
   * A harness change starts a new native session: a session of one harness cannot continue in
   * another. The root re-enters with its objective and the run's state, in a workspace restored
   * from its latest checkpoint when the provider holds one.
   */
  readonly segment?: {
    readonly provider?: string
    readonly model?: string
    readonly reasoningEffort?: ReasoningEffort
    readonly harness?: AgentProfile['harness']
    readonly stack?: Readonly<Record<string, string>>
    readonly reason: string
  }
  /** Durable steer directory when it differs from the run-control directory. */
  readonly steerDir?: string
  /** Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
   *  with `blobs` — a journal whose result payloads live in a different store cannot replay. */
  readonly journal?: SpawnJournal
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
  readonly stopRule?: StopRule | { readonly plateau: PlateauOptions }
  /** One-shot notification of WHY a `stopRule` ended the run (BOTH arms) — so a caller records the
   *  reason instead of inferring an early stop from an unexhausted budget. */
  readonly onProgressStop?: (reason: string) => void
  /** Recursion ceiling for the tree (root = 0). The conserved pool is what bounds depth, since each
   *  level's slice comes out of the level above; this only stops a runaway recursion. Omit =
   *  `DEFAULT_MAX_DEPTH` (16). */
  readonly maxDepth?: number
  /** Turn cap for the supervisor's OWN loop (BOTH arms). Router arm: inference turns of the
   *  driver's tool loop. Harness arm: turns the harness reports, counted off its `iteration`
   *  stream — reaching the cap aborts the stop signal, so the harness ends at its next turn
   *  boundary rather than mid-request. `0` lifts the cap on both arms and leaves the conserved
   *  pool, the deadline, and abort as the bounds; a negative value is refused. Omit = the router
   *  arm's default cap, and no turn cap on the harness arm. */
  readonly maxTurns?: number
  /** Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY —
   *  a harness owns its own context window and its own compaction, so this is refused for a
   *  harness-brained supervisor rather than silently ignored): once its coordination transcript
   *  exceeds `thresholdTokens` it distills to a compact progress note and continues, instead of
   *  re-billing the whole transcript every turn (the cost that makes the LLM-brain front door lose
   *  to a dumb-Ralph respawn). The live `Scope` roster is the durable state across chapters.
   *  Default off. `distill` defaults to a brain self-summary + the settled-worker roster. */
  readonly compaction?: ToolLoopCompactionOptions
  readonly runId?: string
  readonly now?: () => number
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
  readonly allowedModels?: readonly string[]
  /** How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
   *  highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
   *  `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
   *  disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
   *  structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. A
   *  `string` names an entry in `registry.finalizers`. */
  readonly finalizer?: SupervisorFinalizer | string
  /** Lifecycle observers for the whole recursive tree (`Scope` re-seeds them into every nested
   *  scope). Composed with the `otel` recorder below when both are set. Omit = no observers, which
   *  is the behavior every existing caller has. */
  readonly hooks?: RuntimeHooks
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
  readonly otel?: Omit<SupervisorSpanOptions, 'runId' | 'now' | 'namespace'>
}

/** The product-authorized result for one complete spawn request. Attribution is never accepted
 * from the manager itself; it enters only through this trusted callback. */
export interface AuthorizedSpawn {
  readonly profile: AgentProfile
  readonly execution?: AgentExecutionRef
}

/** Exact trusted context after a manager-authored spawn has passed product authorization. */
export interface AuthorizedSpawnContext {
  readonly profile: AgentProfile
  readonly parent: AgentProfile
  readonly parentIdentity: NodeExecutionIdentity
  readonly execution: NodeExecutionIdentity
  readonly parentNodeId: string
  readonly assignmentId: string
  readonly task: unknown
  readonly budget: Budget
  readonly label: string
  readonly key?: string
  readonly depth: number
}

/** Exact trusted context for selecting one backend-derived leaf's completion check. */
export type DeliverableResolutionInput = AuthorizedSpawnContext

/** Test-only one-call shape, exported only through the package's explicit `/testing` entry. */
export interface SuperviseTestOptions extends SuperviseOptions {
  readonly brain: ToolLoopChat
}
