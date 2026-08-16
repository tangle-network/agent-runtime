/**
 *
 * MCP binding for a live `Scope`. A sandbox driver gets the same small verbs
 * the in-process driver has: spawn, observe, await, steer, ask/answer, analyze,
 * and stop. Settled outputs remain Scope artifacts; product code can project
 * them into any UI/report envelope it needs.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import type { TraceAnalysisStore } from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentExecutionRef,
  Budget,
  ExecutionBindingReceipt,
  Handle,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  ResultBlobStore,
  Scope,
  Settled,
  Spend,
  Agent as SuperviseAgent,
  WorkerTraceEvidence,
} from '../../runtime'
import { assertValidBudget } from '../../runtime/supervise/budget'
import type { DeliverableSpec } from '../../runtime/supervise/completion-gate'
import { type WatchTraceOptions, watchTrace } from '../../runtime/supervise/detector-monitor'
import { freeSlots } from '../../runtime/supervise/dispatch'
import { type BusRecord, type BusStats, createEventBus } from '../../runtime/supervise/event-bus'
import {
  createPeerMailbox,
  type PeerMailbox,
  type PeerMailEvent,
  type PeerMailLimits,
} from '../../runtime/supervise/peer-mail'
import type { WorkerProgress } from '../../runtime/supervise/progress'
import {
  parseWorkerToolTraceArtifact,
  workerTraceAnalysisStore,
} from '../../runtime/supervise/trace-evidence'
import type { McpToolDescriptor } from '../server'

/** A worker the driver has drained via `await_event`. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  /** Stable manager-scoped assignment, including deterministic unkeyed siblings. */
  readonly assignmentId?: string
  /** Exact profile/task/candidate identity authorized for this node. */
  readonly identity?: NodeExecutionIdentity
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
  /** Structured tool-call evidence, never the worker's final prose. */
  readonly trace: WorkerTraceEvidence
  /** True when projected from a prior process of the same durable run. */
  readonly resumed?: boolean
  /** Epoch ms from the durable terminal record — the resolution a progress-based stop rule needs
   *  to answer "how long since anything landed?" without inventing a timestamp at read time. */
  readonly settledAt?: number
}

export type QuestionLevel = 'worker' | 'driver' | 'loop'
export type QuestionUrgency = 'continue-without' | 'blocks-step' | 'blocks-run'

export interface QuestionOption {
  readonly label: string
  readonly tradeoff: string
}

export interface Question {
  readonly id: string
  readonly from: string
  readonly level: QuestionLevel
  readonly question: string
  readonly reason: string
  readonly urgency: QuestionUrgency
  readonly options?: ReadonlyArray<QuestionOption>
}

export type QuestionDecision =
  | { readonly kind: 'answer'; readonly answer: string; readonly by: string }
  | { readonly kind: 'defer'; readonly reason: string }
  | { readonly kind: 'escalate'; readonly to: 'parent' | 'user' | string; readonly reason: string }

export interface QuestionRecord extends Question {
  readonly status: 'open' | 'answered' | 'deferred' | 'escalated'
  readonly decision?: QuestionDecision
  readonly openedAt: number
}

type QuestionInput = Omit<Question, 'id'> & { readonly id?: string }
export type QuestionPolicy = 'auto' | 'mustDecide' | 'bubble' | 'failClosed'

export interface AnalystRegistry {
  readonly kinds: ReadonlyArray<{ id: string; description: string; area: string }>
  readonly run: (kindId: string, trace: TraceAnalysisStore) => Promise<unknown>
}

/** A trace-analyst result re-entered as a message on the bus (the `finding` event kind). */
export interface AnalystFindingEvent {
  readonly fromWorker: string
  readonly analyst: string
  /** The analyst's result. ABSENT when the analyst returned `undefined` (no findings); any other
   *  value is canonicalized to finite RFC 8785 JSON at publish (`canonicalFindingEvent`), so
   *  digesting subscribers (the coordination-event id) never throw on analyst-shaped data. */
  readonly findings?: unknown
}

/** Producer-side cleanliness for the `finding` event. The findings payload is arbitrary analyst
 *  output, the digest a subscriber computes (RFC 8785) throws on ANY `undefined` value — nested
 *  included — and a throwing subscriber leaves the event invisible to EVERY subscriber. The
 *  producer, not the digest, owns keeping the event canonical: an `undefined` payload is stripped
 *  to key-absence, everything else is JSON round-tripped (nested `undefined` object values drop,
 *  `undefined` array slots become `null`), and a payload JSON cannot represent at all (cycle,
 *  BigInt, bare function) becomes a record OF that fact — degraded findings beat a vanished
 *  event. */
export function canonicalFindingEvent(finding: AnalystFindingEvent): AnalystFindingEvent {
  if (finding.findings === undefined) {
    const { findings: _absent, ...present } = finding
    return present
  }
  try {
    // JSON.stringify returns undefined (not a string) for a bare function/symbol payload;
    // JSON.parse then throws, landing in the same non-canonical fallback as cycles and BigInt.
    return { ...finding, findings: JSON.parse(JSON.stringify(finding.findings)) as unknown }
  } catch (error) {
    return {
      ...finding,
      findings: { nonCanonicalFindings: error instanceof Error ? error.message : String(error) },
    }
  }
}

/**
 * One analyst-on-settle ROUTE: which lens runs (`kind`), over WHICH settled workers (`over`),
 * delivered to WHOM (`to`), wrapped in WHAT standing instruction (`directive`). The generalized
 * form of the bare-string entry — a string `k` is exactly `{ kind: k }`: every settle feeds the
 * lens and the findings go to the driver via the bus. This is the analyzes-edge of an agent
 * graph expressed at the coordination layer; the finding is ALWAYS also published on the bus
 * (the audit trail), routing adds delivery, never replaces the record.
 */
export interface AnalyzeOnSettleRoute {
  /** The analyst id: a lens id resolved against the `analysts` registry, or — when `agent` is
   *  present — the AGENT analyst's stable identity carried on its finding/steer events (it need
   *  not exist in any registry). */
  readonly kind: string
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
  readonly agent?: AgentProfile
  /** Deliver the findings to this live worker, named by its PROFILE NAME (the stable node
   *  identity a graph pins) or its spawn label. Omit = the driver (bus only). Delivery goes
   *  through the same authorization + steer machinery a driver-authored steer uses and is
   *  recorded as a `steer` event carrying `analyst`, so a routed delivery is observable and a
   *  failed one (`delivered: false`) is a recorded outcome, never a silent drop. */
  readonly to?: string
  /** Standing instruction wrapped around the findings on a routed delivery — what the recipient
   *  should DO with the analysis. For an AGENT analyst (`agent` set) it is instead the analysis
   *  directive handed to the agent as its task; the routed delivery then carries the bare
   *  findings, because the directive was already consumed upstream. Omit = the bare findings
   *  JSON (and, for an agent analyst, a task of evidence only). */
  readonly directive?: string
  /** Restrict which settled workers feed this lens, by profile name or spawn label. Omit =
   *  every settled `done` worker. */
  readonly over?: ReadonlyArray<string>
}

/** Normalize the two spellings of an analyst-on-settle entry to the route form. */
export function normalizeAnalyzeOnSettle(
  entry: string | AnalyzeOnSettleRoute,
): AnalyzeOnSettleRoute {
  return typeof entry === 'string' ? { kind: entry } : entry
}

/** How a spawn CONTINUES a node's prior work: `'fresh'` starts a brand-new session (the default,
 *  and the only pre-continuity behavior); `'resume'` re-attaches to the node's most recent
 *  SETTLED worker — a NEW live worker is spawned whose spawn context carries the prior worker's
 *  identity ({@link WorkerResumeContext}), and the executor seam owns the actual session
 *  re-attachment. */
export type ContinuityMode = 'fresh' | 'resume'

/** The resume lineage a `'resume'` spawn hands the executor seam
 *  ({@link WorkerSpawnContext.resume}). The kernel owns identity, ordering, ledger truth, and
 *  spend continuity (the resumed worker reserves from the same conserved pool); the seam owns the
 *  re-attachment itself — e.g. mapping `ofWorker` to a backend session id. */
export interface WorkerResumeContext {
  /** The prior SETTLED worker whose session the new worker continues. */
  readonly ofWorker: string
  /** 1-based position of the NEW worker in the node's continuity chain: a node spawned once and
   *  resumed once hands the resumed worker `sequence: 2`. */
  readonly sequence: number
}

/** The exact result of one parent→child delivery attempt. */
export type DownMessageDeliveryOutcome =
  | 'delivered'
  | 'unknown-worker'
  | 'already-settled'
  | 'runtime-has-no-inbox'
  | 'scope-stopped'
  | 'runtime-error'

/** A durable marker written after authorization and immediately before Runtime calls `Scope.send`.
 * If a process dies with this marker but no matching outcome, delivery is unknown and is never
 * replayed automatically. */
export interface DownMessageDeliveryAttempt {
  readonly receiptId: string
  readonly kind: 'steer' | 'answer'
  readonly toWorker: string
  readonly instructionDigest: string
  readonly interrupt: boolean
  readonly questionId?: string
}

/** A parent→child delivery result (the down-leg): recorded for observability, never pulled back by
 * the parent. `receiptId` and `instructionDigest` link it to the pre-delivery authorization receipt
 * and attempt marker. */
export interface DownMessageEvent {
  readonly receiptId: string
  readonly toWorker: string
  readonly instruction: string
  readonly instructionDigest: string
  readonly delivered: boolean
  readonly outcome: DownMessageDeliveryOutcome
  readonly error?: string
}

/** Durable authorization receipt written before a continuation reaches a worker. */
export interface ContinuationInstruction {
  readonly receiptId: string
  readonly kind: 'steer' | 'answer'
  readonly toWorker: string
  readonly instruction: string
  readonly instructionDigest: string
  readonly workerIdentity?: NodeExecutionIdentity
  readonly interrupt: boolean
  readonly questionId?: string
}

/** Detached continuation bytes and exact worker identity presented to product authorization before
 * Runtime records or delivers a steer/answer. */
export interface DownMessageAuthorizationInput {
  readonly kind: 'steer' | 'answer'
  readonly workerId: string
  readonly workerIdentity: NodeExecutionIdentity
  readonly instruction: string
  readonly interrupt: boolean
  readonly questionId?: string
}

/** Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed
 * bytes; throwing refuses delivery. */
export interface AuthorizedDownMessage {
  readonly instruction: string
}

/** Product decision over an exact continuation before it is durably recorded or delivered. */
export type AuthorizeDownMessage = (input: DownMessageAuthorizationInput) => AuthorizedDownMessage

/** Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 *  the driver to `pull`. An `instruction` is the pre-delivery authorization receipt and is retained
 *  as evidence. DOWN (parent→child): steer / answer — record-only (history + subscribers), routed
 *  to the child inbox. SIDEWAYS (child→sibling): mail — also record-only, and deliberately NOT
 *  queued, so peer traffic audits through the parent without flooding the inbox it pulls from.
 *  Receipts are never auto-delivered on restart. New kinds are additive. */
export type CoordinationEvent =
  | { readonly type: 'question'; readonly question: QuestionRecord }
  | { readonly type: 'settled'; readonly worker: SettledWorker }
  | { readonly type: 'finding'; readonly finding: AnalystFindingEvent }
  | {
      readonly type: 'steer'
      readonly down: DownMessageEvent
      /** Present when this steer DELIVERED an analyst's routed findings (an analyzes-edge
       *  traversal), naming the lens — absent on an ordinary driver-authored steer. */
      readonly analyst?: string
    }
  | { readonly type: 'answer'; readonly down: DownMessageEvent; readonly questionId: string }
  | { readonly type: 'instruction'; readonly instruction: ContinuationInstruction }
  | { readonly type: 'delivery-attempt'; readonly attempt: DownMessageDeliveryAttempt }
  | { readonly type: 'mail'; readonly mail: PeerMailEvent }

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
  /** The EFFECTIVE continuity mode of this spawn — the spawn tool's per-call argument when given,
   *  else the profile name's declared default ({@link CoordinationToolsOptions.continuityByProfile}),
   *  else `'fresh'`. Absent only from producers that predate continuity — read absence as
   *  `'fresh'`. */
  readonly continuity?: ContinuityMode
  /** Present iff `continuity === 'resume'`: the lineage the executor seam re-attaches with. */
  readonly resume?: WorkerResumeContext
  /**
   * The PEER MAIL capability endpoint minted for this exact spawn, when the run enabled peer mail
   * ({@link CoordinationToolsOptions.peerMail}). It serves `send_mail` / `read_mail` and nothing
   * else, and it speaks as this worker: the sender is bound to the capability, never passed as an
   * argument. Mount it on the worker the way `coordinationMcpUrl` is mounted on a driver.
   *
   * It arrives HERE, out of band, rather than being merged into the worker's `AgentProfile.mcp`,
   * for the same reason the driver's coordination URL does: the URL carries fresh random bytes per
   * process, so writing it into the profile would change the canonical profile digest every run and
   * a keyed re-spawn would then fail its identity check against the journal.
   */
  readonly peerMailUrl?: string
}

export type MakeWorkerAgent = (
  profile: AgentProfile,
  context?: WorkerSpawnContext,
) => SuperviseAgent<unknown, unknown>

export interface CoordinationToolsOptions {
  readonly scope: Scope<unknown>
  readonly blobs: ResultBlobStore
  readonly makeWorkerAgent: MakeWorkerAgent
  readonly perWorker: Budget
  /** Called once when this manager declares completion through `stop` or an accepted submission. */
  readonly onStop?: (reason: string | undefined) => void
  /**
   * The same independent completion check used for workers. When present, the driver receives a
   * `submit_result` tool and may finish work itself instead of being forced to delegate it. The
   * first passing submission is retained; a false or throwing check fails closed.
   */
  readonly deliverable?: DeliverableSpec<unknown>
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
   *  the bus — pass-through to subscribers and queued for `await_event`. An
   *  {@link AnalyzeOnSettleRoute} generalizes the DESTINATION: findings can be delivered to a
   *  named live WORKER (wrapped in the route's directive, through the same authorized steer
   *  machinery a driver steer uses) instead of being hardwired to the spawning driver, and `over`
   *  restricts which settled workers feed the lens. A route carrying `agent` generalizes the
   *  ANALYST itself: a tool-equipped agent spawned as a worker whose settle output is the
   *  findings (see {@link AnalyzeOnSettleRoute.agent}). Omit/empty = no auto-analysis (default;
   *  the driver can still run lenses on demand via `run_analyst`). Lens routes require
   *  `analysts`; agent routes do not. */
  readonly analyzeOnSettle?: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Hard cap on how many workers may be LIVE (spawned but not yet settled) at once. `spawn_agent`
   *  counts the scope's non-terminal nodes and fails closed (`error: 'max-live-workers'`) BEFORE
   *  reserving from the pool when the cap is already met — a concurrency fence on top of the
   *  conserved-budget fence (the pool bounds total work; this bounds simultaneous work, e.g. live
   *  sandboxes/boxes). A tree-wide limit owned by `Scope` takes precedence when present; this field
   *  is the local form for a caller-owned scope. Omit or `<= 0` = no local cap. */
  readonly maxLiveWorkers?: number
  /** Max wall-clock ms a single `await_event` call may block waiting on a live worker to settle
   *  before it returns a non-error `{ pending: true, live }` snapshot and lets the caller re-poll.
   *  The underlying `scope.next()` blocks for the WHOLE (multi-minute) worker run; over a remote MCP
   *  transport that block outlives the client's per-request timeout, so an unbounded await surfaces
   *  to the supervisor as a hard tool ERROR on every call — the exact failure that leaves it flying
   *  blind. Bounding the wait converts that error into a re-pollable liveness signal. The background
   *  drain keeps running, so a settlement that lands after the bound is published to the bus and
   *  pulled by the next call — nothing is lost. Omit = {@link DEFAULT_AWAIT_EVENT_TIMEOUT_MS}; `<= 0`
   *  restores the prior UNBOUNDED block (only safe for in-process drivers with no transport timeout). */
  readonly awaitTimeoutMs?: number
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
}

/** Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). */
export interface WorkerWatchOptions {
  /** Detector panel; omit for the default stuck-loop + error-streak pair. */
  readonly detectors?: WatchTraceOptions['detectors']
  /** Raise at most this many findings per worker, so one pathological worker cannot flood the
   *  driver's inbox with the same signal every span. Default 3; `<= 0` = unlimited. */
  readonly maxFindingsPerWorker?: number
}

/** Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote
 *  MCP client request timeout so the call returns a `pending` liveness snapshot instead of erroring;
 *  the supervisor re-polls until the worker settles. */
export const DEFAULT_AWAIT_EVENT_TIMEOUT_MS = 15_000

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
  /** The full ordered log of every bus event — UP (settled / question / finding), authorized
   *  instruction receipts, and DOWN delivery outcomes (steer / answer). Each record carries seq,
   *  timestamp, and priority. A receipt is evidence and is never auto-delivered on restart. */
  history(): ReadonlyArray<BusRecord<CoordinationEvent>>
  /** Bus throughput counters (published / pulled / by-kind) for live dashboards. */
  stats(): BusStats
  /** The run's peer-mail post office, present only when `peerMail` was enabled. The transport
   *  layer stands the capability endpoint up over it; the parent reads `history()` for the audit
   *  trail and calls `stopThread` to end a peer exchange. */
  readonly peerMail?: PeerMailbox
  /** Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
   *  (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
   *  moment it happens, instead of only at settle. Queued for `await_event` + pass-through. */
  raiseFinding(finding: AnalystFindingEvent): Promise<void>
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
}

/** The reserved coordination verb names — the complete set `createCoordinationTools` can emit
 *  (the analyst pair is conditional but still reserved). A driver's extra WORK tools must not
 *  collide with any of these, or it could no longer coordinate; callers validate eagerly against
 *  this set so the conflict fails loud at construction, not buried in a swallowed `act()` throw. */
export const coordinationVerbNames = [
  'spawn_agent',
  'observe_agent',
  'steer_agent',
  'await_event',
  'list_questions',
  'answer_question',
  'ask_parent',
  'submit_result',
  'stop',
  'list_analysts',
  'run_analyst',
] as const

const idArg = { type: 'string', description: 'The workerId returned by spawn_agent.' } as const

/**
 * Strip zod's object-KEY CODEC artifact from a derived JSON Schema, at every depth.
 *
 * `z.record(z.string(), …)` converts to `propertyNames: { type: 'string', pattern:
 * '^u(?:[0-9a-f]{4})*$' }` — a marker of the lossy key round-trip, not a constraint anything
 * enforces: `agentProfileSchema.safeParse({ name: 'r', tools: { bash: true, Read: false } })`
 * succeeds with those plain keys. Published verbatim it reads to a model as "every key must be a
 * run of hex quads", and the model either emits hex-encoded garbage keys or drops the field —
 * on `tools`, `permissions`, `metadata`, `mcp`, `mcp.*.env`, and `model.metadata`, which is most
 * of what a parent actually configures.
 *
 * Every `propertyNames` in the canonical profile schema is this artifact (25 of 25 at Interface
 * 0.40), and the canonical schema constrains no key by pattern, so dropping the keyword outright
 * loses nothing real and cannot be defeated by zod changing the encoding's exact regex.
 *
 * Rebuilds rather than mutates: the canonical conversion output must stay untouched for callers
 * that compare against it.
 */
const stripKeyCodecArtifacts = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(stripKeyCodecArtifacts)
  if (!node || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([key]) => key !== 'propertyNames')
      .map(([key, value]) => [key, stripKeyCodecArtifacts(value)]),
  )
}

/** One field of the published child-profile shape: the canonical field it mirrors, the one-line
 *  description a model can act on (what it is, what a child typically sets), and — for the two
 *  fields whose canonical sub-tree dwarfs the rest of the tool surface — the BRIEF schema published
 *  in place of that sub-tree. */
interface PublishedProfileField {
  readonly name: string
  readonly description: string
  readonly brief?: Record<string, unknown>
}

/** The canonical profile fields a spawning parent actually sets on a child, in the order a reader
 *  needs them, each with the description published alongside it. Everything else stays legal to
 *  pass — see {@link deriveSpawnProfileArg}.
 *
 *  Why these eleven, with the measured numbers (serialized JSON bytes, Interface 0.40). The
 *  canonical `properties` map is 10629 bytes, against 2424 bytes for every argument of every other
 *  coordination tool COMBINED — publishing it whole makes one parameter four times the rest of the
 *  surface a driver re-reads each turn. Of the seven omitted fields (tags, connections, subagents,
 *  hooks, modes, confidential, extensions) none is something a parent hands a worker; `permissions`
 *  (321 bytes) IS, so it is published — a child that must not touch the network or the filesystem
 *  is fenced there and nowhere else. `mcp` (2663 bytes) and `resources` (3122 bytes) are the two a
 *  parent is least likely to author inline and were together 85% of the published cost, so they
 *  carry a brief shape plus a description naming the full form instead of the canonical sub-tree. */
const spawnProfileFields: readonly PublishedProfileField[] = [
  {
    name: 'name',
    description:
      'Short identifier for this child, e.g. "researcher" or "patch-writer". A child normally ' +
      'sets it to its role; it shows up in traces and worker labels.',
  },
  {
    name: 'description',
    description:
      'One line saying what this child is for. Read by humans and by a parent listing its workers.',
  },
  {
    name: 'version',
    description:
      'Optional version string for this profile, so two revisions of the same role are ' +
      'distinguishable in evidence. A child usually omits it.',
  },
  {
    name: 'harness',
    description:
      'Which coding backend runs the child. Omit to inherit the run default; set it only when ' +
      'this child needs a specific backend (e.g. a long refactor on "claude-code").',
  },
  {
    name: 'model',
    description:
      'Model routing: `default` model id, optional `small` for cheap sub-calls, `provider`, and ' +
      '`reasoningEffort`. A child typically sets `default` and `reasoningEffort` — raise effort ' +
      'for a hard reasoning task, lower it for bulk mechanical work.',
  },
  {
    name: 'prompt',
    description:
      "The child's standing instructions: `systemPrompt` (who it is and how it works) and " +
      '`instructions` (durable rules). This is the role; the separate `task` argument carries ' +
      'what to do right now. A child with no systemPrompt has no role — always set one.',
  },
  {
    name: 'tools',
    description:
      'Per-tool on/off map keyed by tool name, e.g. `{ "bash": true, "webfetch": false }`. Omit ' +
      "to inherit the backend's default tool set; set it to narrow a child to the tools its task " +
      'needs. Keys are plain tool names.',
  },
  {
    name: 'permissions',
    description:
      'Per-tool permission decisions: each tool name maps to "allow", "deny", or "ask", or to a ' +
      'nested map of finer-grained rules. This is where a parent fences a child it does not fully ' +
      'trust — a read-only child denies write and network tools here, not in `tools`.',
  },
  {
    name: 'mcp',
    description:
      'MCP tool servers to mount for the child, keyed by server name. Brief form: each value is ' +
      'either `{ transport: "stdio", command, args?, env?, cwd? }` or ' +
      '`{ transport: "sse" | "http", url, headers? }`. A child normally sets this only when it ' +
      'needs a tool server the task requires; the canonical AgentProfile schema carries the full ' +
      'form (secret-ref values for env/headers, per-server metadata) and governs validation.',
    brief: { type: 'object', additionalProperties: { type: 'object' } },
  },
  {
    name: 'resources',
    description:
      'Files, tools, skills, and agents materialized into the child workspace before it starts. ' +
      'Brief form: `{ files?, tools?, skills?, agents? }`, each an array whose entries are ' +
      '`{ kind: "inline", name, content }` or `{ kind: "github", repository?, path, ref? }` ' +
      '(`files` entries wrap that as `{ path, resource, executable? }`). A child typically gets ' +
      '`files` for seed inputs and `skills` for a procedure it must follow; the canonical ' +
      'AgentProfile schema carries the full form and governs validation.',
    brief: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'object' } },
        tools: { type: 'array', items: { type: 'object' } },
        skills: { type: 'array', items: { type: 'object' } },
        agents: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'metadata',
    description:
      'Free-form key/value bag carried with the profile (plain string keys). Use it for run ' +
      'bookkeeping a reader will want later; it does not change how the child executes.',
  },
]

/**
 * Build the published shape of `spawn_agent`'s `profile` argument from the canonical
 * `agentProfileSchema` conversion's `properties` map, so it cannot drift from the profile the
 * runtime materializes.
 *
 * DEGRADES, never throws. A canonical field that is absent — renamed or removed upstream — is
 * simply omitted from the published shape, and a canonical schema that is no longer an object
 * publishes no properties at all. This function is reached from a statically-imported module, so a
 * throw here bricks `import '@tangle-network/agent-runtime/kernel'` for every consumer over an
 * upstream rename that costs them, at worst, one advisory field. The drift itself is still caught
 * loudly — as a test assertion in `tests/kernel/coordination.test.ts`, in CI, where it is our
 * problem rather than at a consumer's import, where it is theirs.
 *
 * Permissive on purpose: `additionalProperties: true` with no `required` list, so every canonical
 * field this shape omits stays legal to pass. This tool layer performs no profile validation.
 *
 * @internal exported for the drift and degradation tests; not part of the package's public API.
 */
export function deriveSpawnProfileArg(
  canonicalProperties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const published: Array<[string, unknown]> = []
  for (const field of spawnProfileFields) {
    const canonical = canonicalProperties?.[field.name]
    if (canonical === undefined) continue
    const shape = field.brief ?? (stripKeyCodecArtifacts(canonical) as Record<string, unknown>)
    published.push([field.name, { ...shape, description: field.description }])
  }
  return {
    type: 'object',
    description:
      'The child agent profile to run — this is the shape the DEFAULT worker seam accepts; a run ' +
      'wired with a custom makeWorkerAgent may accept a different one. The properties below are ' +
      'derived from the canonical AgentProfile schema and reduced to what a spawning parent sets ' +
      '(`mcp` and `resources` in a brief form); every other canonical field — tags, connections, ' +
      'subagents, hooks, modes, confidential, extensions — may still be passed. This tool does ' +
      'not validate the profile: the canonical AgentProfile schema governs validation downstream.',
    properties: Object.fromEntries(published),
    additionalProperties: true,
  }
}

/** The canonical field names this module publishes, in published order — the drift test's input.
 *
 * @internal */
export const spawnProfileFieldNames: readonly string[] = spawnProfileFields.map((f) => f.name)

let spawnProfileArgCache: Record<string, unknown> | undefined

/** The published `profile` shape, computed on FIRST tool-definition access and memoized — not at
 *  module load. The conversion walks the whole canonical profile tree, and the strip walk rebuilds
 *  it: 3.5ms on the first `createCoordinationTools`, 0.017ms on every later one (measured, Interface
 *  0.40, node 24). `src/runtime/index.ts` imports this module statically, so paying that at import
 *  taxes every consumer of the kernel entrypoint — including the ones that never build a
 *  coordination toolbox. The memo keeps it at once per process for the ones that do.
 *
 *  Conversion choices. `io: 'input'` is the CALLER's view — pre-default, pre-transform — which is
 *  what a spawning parent may pass, not what the runtime ends up holding. `unrepresentable: 'any'`
 *  keeps the conversion total: the canonical schema contains transforms with no JSON Schema form,
 *  and zod's default is to throw on them, which would leave the tool with no published shape. */
function spawnProfileArg(): Record<string, unknown> {
  if (!spawnProfileArgCache) {
    const canonical = agentProfileSchema.toJSONSchema({
      io: 'input',
      target: 'draft-07',
      unrepresentable: 'any',
    })
    // Deep-frozen because ONE memoized object is handed to every coordination toolbox in the
    // process: an unfrozen shared schema lets one consumer's mutation corrupt every later one.
    spawnProfileArgCache = deepFreeze(deriveSpawnProfileArg(canonical.properties))
  }
  return spawnProfileArgCache
}

/** Build the driver's MCP tools over a live scope. */
export function createCoordinationTools(opts: CoordinationToolsOptions): CoordinationTools {
  const deliverable = opts.deliverable
  let stopped = false
  let reason: string | undefined
  let stopNotified = false
  let submitted: { readonly result: unknown } | undefined
  let questionSeq = 0
  const ledger: SettledWorker[] = []
  const questions: QuestionRecord[] = [...(opts.priorQuestions ?? [])]
  const questionPolicy = opts.questionPolicy ?? 'auto'

  const notifyStop = (): void => {
    if (stopNotified) return
    stopNotified = true
    opts.onStop?.(reason)
  }

  // Keyed-assignment bookkeeping for the live-worker fence. `completedKeys` is every key this run
  // can already answer from committed work — seeded from the prior journal on a resume, extended as
  // keyed workers deliver in THIS process. A spawn under such a key starts nothing and occupies no
  // slot, so the fence must not hold it back. `keyByWorker` is what lets a settlement find its key.
  const completedKeys = new Set<string>()
  const keyByWorker = new Map<string, string>()
  // Worker id → the AUTHORED profile name it was spawned from. The stable identity an
  // `AnalyzeOnSettleRoute` names (`to`/`over`): labels are the driver's free-text choice, while
  // the profile name is what a graph pins a node by. Recorded at spawn, dropped never (a settled
  // source can still be matched by `over` after it is gone).
  const profileNameByWorker = new Map<string, string>()
  // Worker id → the live child Handle from its spawn. `Handle.abort` is the ONLY per-child abort
  // (its controller cascades to that child's subtree and no sibling), and the scope does not
  // re-expose it, so `abortWorker` must keep the handle from the spawn that minted it. Entries
  // are never deleted (liveness is re-checked against the view at abort time); the map is
  // bounded by the run's spawn count, like `profileNameByWorker`.
  const liveHandles = new Map<string, Handle<unknown>>()
  // `Scope` advances its node/cursor ordinals on resume, but assignment identity belongs to this
  // manager. Seed it independently from durable evidence so a restarted manager never calls new
  // work `ordinal:0` when a prior process already used that assignment. Use the maximum rather
  // than the number of rows: journals can contain gaps, keyed assignments, and legacy/custom ids.
  let unkeyedAssignmentOrdinal = nextUnkeyedAssignmentOrdinal(opts.scope)
  for (const [key, prior] of opts.scope.resume?.keys ?? []) {
    if (prior.state === 'completed') completedKeys.add(key)
  }

  const nodeForWorker = (id: string) =>
    opts.scope.view.nodes.find((node) => node.id === id) ??
    opts.scope.resume?.view.nodes.find((node) => node.id === id)

  const projectSettled = (settled: Settled<unknown>, resumed = false): SettledWorker => {
    const node = nodeForWorker(settled.handle.id)
    const assignmentId = settled.handle.assignmentId ?? node?.assignmentId
    const identity = settled.handle.identity ?? node?.identity
    const materialization = settled.handle.materialization ?? node?.materialization
    const executionBindings = settled.handle.executionBindings ?? node?.executionBindings
    const settledAt = settled.settledAt ?? node?.settledAt
    const trace =
      settled.trace ??
      node?.trace ??
      ({
        status: 'unavailable',
        reason: 'legacy-settlement-without-trace-evidence',
      } as const)
    const common = {
      id: settled.handle.id,
      ...(assignmentId === undefined ? {} : { assignmentId }),
      ...(identity === undefined ? {} : { identity }),
      ...(materialization === undefined ? {} : { materialization }),
      ...(executionBindings === undefined ? {} : { executionBindings }),
      ...(settledAt === undefined ? {} : { settledAt }),
      trace,
      ...(resumed ? { resumed: true as const } : {}),
    }
    return deepFreezeDetached<SettledWorker>(
      settled.kind === 'done'
        ? {
            ...common,
            status: 'done',
            spent: settled.spent,
            ...(settled.verdict?.score === undefined ? {} : { score: settled.verdict.score }),
            ...(settled.verdict?.valid === undefined ? {} : { valid: settled.verdict.valid }),
            outRef: settled.outRef,
          }
        : {
            ...common,
            status: 'down',
            ...(node?.spent === undefined ? {} : { spent: node.spent }),
            reason: settled.reason,
          },
    )
  }

  // A resumed scope's replayed settlements enter the ledger AT CONSTRUCTION, so `settled()` — and
  // therefore the finalize that reads it — spans processes exactly as the journal does.
  const resumedWorkers: SettledWorker[] = []
  for (const s of opts.scope.resume?.settled ?? []) {
    const worker = projectSettled(s, true)
    resumedWorkers.push(worker)
    ledger.push(worker)
  }

  // The one child→parent pipe. Keep the event-first callback and also pass its exact stamp, so a
  // durable subscriber retains causal sequence, original timestamp, and priority.
  const bus = createEventBus<CoordinationEvent>()
  if (opts.onEvent) {
    const cb = opts.onEvent
    bus.subscribe((rec) => cb(rec.event, rec))
  }
  // A settlement can be durable in the spawn journal while the process dies before the product
  // observer acknowledges it. Opted-in high-level callers replay those events at least once. Keep
  // each frozen event object across an in-process retry so EventBus reuses its exact BusRecord.
  const resumeEvents = opts.replaySettlements
    ? resumedWorkers.map((worker) =>
        deepFreezeDetached<CoordinationEvent>({ type: 'settled', worker }),
      )
    : []
  let resumeEventIndex = 0
  let readyInFlight: Promise<void> | undefined
  const ready = (): Promise<void> => {
    if (resumeEventIndex >= resumeEvents.length) return Promise.resolve()
    if (readyInFlight) return readyInFlight
    readyInFlight = (async () => {
      while (resumeEventIndex < resumeEvents.length) {
        const event = resumeEvents[resumeEventIndex]
        if (!event) break
        await bus.publish(event)
        resumeEventIndex += 1
      }
    })().finally(() => {
      readyInFlight = undefined
    })
    return readyInFlight
  }

  // Urgency → bus priority: a blocking question is bumped ahead of queued settles/findings so the
  // driver sees it FIRST when it drains the inbox (and pass-through already delivered it the instant
  // it was raised). Non-blocking messages share priority 0 and resolve FIFO.
  const urgencyPriority = (u: QuestionUrgency): number =>
    u === 'blocks-run' ? 20 : u === 'blocks-step' ? 10 : 0

  const str = (v: unknown, field: string): string => {
    if (typeof v !== 'string' || v.length === 0)
      throw new Error(`coordination tools: "${field}" must be a non-empty string`)
    return v
  }
  const obj = (raw: unknown): Record<string, unknown> => {
    if (!raw || typeof raw !== 'object')
      throw new Error('coordination tools: arguments must be an object')
    return raw as Record<string, unknown>
  }
  // Parse a per-spawn `budget` override and merge it over the per-worker default (per field).
  // Fails loud on a non-object or a non-finite numeric field — a malformed budget must never
  // silently fall back to the default and run a sub-task on a ceiling nobody chose.
  const mergeBudget = (base: Budget, raw: unknown): Budget => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('coordination tools: "budget" must be an object')
    const o = raw as Record<string, unknown>
    const field = (name: keyof Budget): number | undefined => {
      const v = o[name]
      if (v === undefined) return undefined
      if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error(`coordination tools: "budget.${name}" must be a finite number`)
      return v
    }
    const maxIterations = field('maxIterations')
    const maxTokens = field('maxTokens')
    const maxUsd = field('maxUsd')
    const deadlineMs = field('deadlineMs')
    const merged: Budget = {
      maxIterations: maxIterations ?? base.maxIterations,
      maxTokens: maxTokens ?? base.maxTokens,
      ...((maxUsd ?? base.maxUsd) === undefined ? {} : { maxUsd: maxUsd ?? base.maxUsd }),
      ...((deadlineMs ?? base.deadlineMs) === undefined
        ? {}
        : { deadlineMs: deadlineMs ?? base.deadlineMs }),
    }
    assertValidBudget(merged, 'coordination tools: budget')
    return merged
  }
  const level = (v: unknown): Question['level'] => {
    if (v === 'worker' || v === 'driver' || v === 'loop') return v
    throw new Error('coordination tools: "level" must be worker, driver, or loop')
  }
  const urgency = (v: unknown): Question['urgency'] => {
    if (v === 'continue-without' || v === 'blocks-step' || v === 'blocks-run') return v
    throw new Error(
      'coordination tools: "urgency" must be continue-without, blocks-step, or blocks-run',
    )
  }

  const commitSettled = (s: Settled<unknown>, w: SettledWorker): void => {
    // A keyed assignment that just delivered is complete for the rest of this run, so a later
    // spawn under the same key resolves for free instead of being held behind the live-worker
    // fence (it starts no worker, so it occupies no slot).
    const settledKey = keyByWorker.get(s.handle.id)
    if (settledKey !== undefined && s.kind === 'done') completedKeys.add(settledKey)
    ledger.push(w)
    // A settled worker's trace source is finished; drop the online subscription with it.
    unwatchWorker(w.id)
  }

  // `Scope.next()` is once-only, while an awaited observer may commit and lose its acknowledgement.
  // Retain the exact event until publication succeeds so the next await retries rather than losing
  // the settlement between the spawn journal and the product transaction. `analystRun` marks a
  // settlement that IS an analyst-agent's findings (see `analystRuns`), whose event is a `finding`.
  let pendingSettlement:
    | {
        readonly settled: Settled<unknown>
        readonly worker: SettledWorker
        readonly event: CoordinationEvent
        readonly analyze: boolean
        readonly analystRun?: AnalystRunInFlight
      }
    | undefined

  // Analyst-AGENT runs in flight (`AnalyzeOnSettleRoute.agent`): worker id → the route that
  // spawned it + the settled source worker whose evidence it analyzes. A member's settlement is a
  // FINDING, not a worker settle: it never enters the settled ledger, never feeds the finalizer,
  // and never re-fires the analyst-on-settle hook — so an analyst cannot cascade onto itself.
  interface AnalystRunInFlight {
    readonly route: AnalyzeOnSettleRoute
    readonly sourceWorker: string
  }
  // PROCESS-LOCAL by design: a durable-run RESUME does not repopulate this map, so an
  // analyst spawn from a PRIOR process settles as an ordinary worker on resume (it re-enters
  // the settled ledger instead of being intercepted as a finding). Journal-level marking of
  // analyst assignments is the fix; until then resume + analyst-node graphs do not compose.
  const analystRuns = new Map<string, AnalystRunInFlight>()
  let analystRunOrdinal = 0

  /** The `finding` event an analyst-agent settlement becomes: its settle OUTPUT is the findings
   *  (a failed run publishes the failure as findings — degraded beats vanished). */
  const analystRunFinding = (
    run: AnalystRunInFlight,
    settled: Settled<unknown>,
  ): CoordinationEvent =>
    deepFreezeDetached<CoordinationEvent>({
      type: 'finding',
      finding: canonicalFindingEvent({
        fromWorker: run.sourceWorker,
        analyst: run.route.kind,
        findings: settled.kind === 'done' ? settled.out : { analystRunFailed: settled.reason },
      }),
    })

  /**
   * Spawn one analyst-AGENT run over a settled worker's evidence, through the SAME spawn
   * machinery a driver spawn uses (`scope.spawn` + `makeWorkerAgent`): the analyst's spend
   * reserves from the conserved pool, its node is journaled/traced like any worker, and a
   * node-pinning seam sees `context.analyst`. Its task is the route directive plus the settled
   * worker's persisted tool-trace spans. A refused spawn publishes a finding RECORDING the
   * refusal — observable, never silent — and must never take down the settlement path.
   */
  const spawnAnalystRun = async (
    route: AnalyzeOnSettleRoute,
    worker: SettledWorker,
  ): Promise<void> => {
    let spansText = ''
    let spanCount = 0
    if (worker.trace.status === 'available') {
      try {
        const raw = await opts.blobs.get(worker.trace.traceRef)
        const artifact = parseWorkerToolTraceArtifact(raw, worker.trace.traceRef)
        spanCount = artifact.spans.length
        spansText = safeJsonText(artifact.spans)
      } catch {
        spansText = '' // degraded evidence is stated below, never a thrown settle path
      }
    }
    const task = [
      ...(route.directive === undefined || route.directive.length === 0 ? [] : [route.directive]),
      `Evidence — settled worker '${worker.id}' tool trace (${spanCount} spans):`,
      spansText.length === 0 ? '(no tool spans available)' : spansText,
    ].join('\n\n')
    const assignmentId = `analyst:${route.kind}:o${analystRunOrdinal++}`
    const label = `analyst:${route.kind}`
    const context: WorkerSpawnContext = Object.freeze({
      assignmentId,
      parentNodeId: opts.scope.view.root,
      budget: opts.perWorker,
      task,
      label,
      analyst: route.kind,
      // An analyst run is always a brand-new session over settled evidence — never a resume.
      continuity: 'fresh' as const,
    })
    let refusal: string | undefined
    let spawnedId: string | undefined
    try {
      const res = opts.scope.spawn(
        () => opts.makeWorkerAgent(route.agent as AgentProfile, context),
        task,
        { budget: opts.perWorker, label, assignmentId },
      )
      if (res.ok) spawnedId = res.handle.id
      else refusal = String(res.reason)
    } catch (cause) {
      refusal = cause instanceof Error ? cause.message : String(cause)
    }
    if (spawnedId === undefined) {
      await bus.publish({
        type: 'finding',
        finding: canonicalFindingEvent({
          fromWorker: worker.id,
          analyst: route.kind,
          findings: { analystSpawnRefused: refusal ?? 'unknown' },
        }),
      })
      return
    }
    analystRuns.set(spawnedId, { route, sourceWorker: worker.id })
    watchWorker(spawnedId)
  }

  // The names an analyst route may know a worker by: its authored profile name (the stable node
  // identity) and its spawn label (the driver's free-text choice).
  const workerRouteNames = (workerId: string): Set<string> => {
    const names = new Set<string>()
    const profileName = profileNameByWorker.get(workerId)
    if (profileName !== undefined) names.add(profileName)
    const label = nodeForWorker(workerId)?.label
    if (label !== undefined) names.add(label)
    return names
  }

  /** The LIVE worker a route destination names, by profile name first, label second. */
  const liveWorkerIdNamed = (destination: string): string | undefined => {
    const live = opts.scope.view.nodes.filter((node) => isLive(node.status))
    return (
      live.find((node) => profileNameByWorker.get(node.id) === destination)?.id ??
      live.find((node) => node.label === destination)?.id
    )
  }

  // ── Continuity: how a spawn continues a node's prior work ──
  // Node identity is the PROFILE NAME only (never the label): resume re-attaches to a specific
  // prior session, and the label is the driver's free-text choice. All three reads are
  // process-local by construction — `profileNameByWorker` records only this process's spawns —
  // which is the documented resume boundary (a prior process's workers are not resume targets).
  const liveWorkerForNode = (name: string): string | undefined =>
    opts.scope.view.nodes.find(
      (node) => isLive(node.status) && profileNameByWorker.get(node.id) === name,
    )?.id
  const latestSettledWorkerForNode = (name: string): string | undefined => {
    for (let i = ledger.length - 1; i >= 0; i -= 1) {
      const worker = ledger[i] as SettledWorker
      if (profileNameByWorker.get(worker.id) === name) return worker.id
    }
    return undefined
  }
  const nodeSpawnCount = (name: string): number => {
    let count = 0
    for (const profileName of profileNameByWorker.values()) if (profileName === name) count += 1
    return count
  }
  const parseContinuity = (v: unknown): ContinuityMode | undefined => {
    if (v === undefined) return undefined
    if (v === 'fresh' || v === 'resume') return v
    throw new Error('coordination tools: "continuity" must be "fresh" or "resume"')
  }
  type ResolvedContinuity =
    | { readonly continuity: 'fresh' }
    | { readonly continuity: 'resume'; readonly resume: WorkerResumeContext }
    | { readonly error: string; readonly hint: string }
  /**
   * Resolve the EFFECTIVE continuity of one spawn: the per-call request wins, else the profile
   * name's declared default, else `'fresh'`. Every refusal is loud and actionable:
   *   - an EXPLICIT `'resume'` with no settled prior worker refuses (`resume-no-prior`) — the
   *     DECLARED default degrades to `'fresh'` instead, so a resume edge's first traversal is
   *     simply the first spawn;
   *   - resume while a prior worker of the node is still LIVE refuses (`resume-while-live`) —
   *     that is what steer is for, and the error says so;
   *   - resume under a semantic `key` refuses (`resume-with-key`) — a key makes an assignment
   *     run-once, resume explicitly runs the node again.
   */
  const resolveContinuity = (
    requested: ContinuityMode | undefined,
    profileName: string | undefined,
    key: string | undefined,
  ): ResolvedContinuity => {
    const declared =
      profileName === undefined ? 'fresh' : (opts.continuityByProfile?.[profileName] ?? 'fresh')
    const wantsResume = requested === 'resume' || (requested === undefined && declared === 'resume')
    if (!wantsResume) return { continuity: 'fresh' }
    if (profileName === undefined || profileName.length === 0) {
      return {
        error: 'resume-unnamed-profile',
        hint:
          'Resume targets a node by profile.name — the stable node identity — and this profile ' +
          'has none. Name the profile, or spawn fresh.',
      }
    }
    if (key !== undefined) {
      return {
        error: 'resume-with-key',
        hint:
          'A semantic key makes an assignment run-once (a completed key returns its committed ' +
          'result instead of running again); resume explicitly runs the node AGAIN. Drop the ' +
          'key to resume, or keep the key and spawn fresh.',
      }
    }
    const live = liveWorkerForNode(profileName)
    if (live !== undefined) {
      return {
        error: 'resume-while-live',
        hint:
          `Worker '${live}' on node '${profileName}' is still LIVE — resume re-attaches to a ` +
          'SETTLED session. To redirect the live worker, use steer_agent (that is the ' +
          "live-worker channel); to run a parallel sibling instead, pass continuity: 'fresh'.",
      }
    }
    const prior = latestSettledWorkerForNode(profileName)
    if (prior === undefined) {
      // The DECLARED default asked for resume-when-possible; with nothing to resume this is the
      // node's effective first spawn. Only an explicit per-call demand fails loud here.
      if (requested === undefined) return { continuity: 'fresh' }
      return {
        error: 'resume-no-prior',
        hint:
          `Node '${profileName}' has no settled prior worker in this process to resume — ` +
          'resume continues a FINISHED session. Spawn the node fresh first (omit continuity or ' +
          "pass 'fresh').",
      }
    }
    return {
      continuity: 'resume',
      resume: { ofWorker: prior, sequence: nodeSpawnCount(profileName) + 1 },
    }
  }

  /**
   * Deliver one routed analyst finding to its destination worker through the SAME authorized
   * steer machinery a driver steer uses, so the delivery is recorded (`steer` event carrying
   * `analyst`) and its outcome is a fact. No live destination ⇒ a record-only failed steer —
   * observable, never a silent drop. A throw here must not kill the settle path: failures are
   * recorded on the bus (a `steer` with `delivered: false`) before being swallowed, with ONE
   * narrow exception — a bus that refuses the `delivery-attempt` record itself leaves only the
   * `instruction` receipt (an attempt with no outcome = explicitly unknown, per
   * recordDeliveryAttempt's own contract).
   */
  const deliverRoutedFinding = async (
    route: AnalyzeOnSettleRoute,
    findings: unknown,
  ): Promise<void> => {
    const destination = route.to as string
    const text =
      route.directive === undefined || route.directive.length === 0
        ? safeJsonText(findings)
        : `${route.directive}\n\n${safeJsonText(findings)}`
    const targetId = liveWorkerIdNamed(destination)
    if (targetId === undefined) {
      await bus.publish(
        {
          type: 'steer',
          down: deepFreezeDetached({
            receiptId: randomUUID(),
            toWorker: destination,
            instruction: text,
            instructionDigest: canonicalCandidateDigest(text),
            delivered: false,
            outcome: 'unknown-worker' as const,
          }),
          analyst: route.kind,
        },
        { queue: false },
      )
      return
    }
    let instruction: ContinuationInstruction
    try {
      instruction = authorizeInstruction('steer', targetId, text, false)
      await recordInstruction(instruction)
    } catch (cause) {
      // NOTHING reached the bus for this failure (an authorization refusal, a target without
      // durable identity, a durable subscriber rejecting the instruction record) — record the
      // failed delivery now, in the same `steer` shape a failed attempt publishes, so a routed
      // finding is observable on EVERY failure path, never a silent drop.
      try {
        await sendDown(
          'steer',
          deepFreezeDetached({
            receiptId: randomUUID(),
            toWorker: targetId,
            instruction: text,
            instructionDigest: canonicalCandidateDigest(text),
            delivered: false,
            outcome: 'runtime-error' as const,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
          route.kind,
        )
      } catch {
        // The bus itself refused the failure record — there is nothing left to record ON, and a
        // routed finding must never take down the settlement path.
      }
      return
    }
    try {
      await attemptDelivery(
        instruction,
        { steer: instruction.instruction, interrupt: false },
        {
          analyst: route.kind,
        },
      )
    } catch {
      // `attemptDelivery` publishes the failed `steer` (delivered:false + outcome) BEFORE
      // rethrowing, so the failure is already on the bus — except when the bus refused the
      // `delivery-attempt` record itself, where only the `instruction` receipt lands (see the
      // docstring). A routed finding must never take down the settlement path.
    }
  }

  const flushPendingSettlement = async (): Promise<boolean> => {
    const pending = pendingSettlement
    if (!pending) return false
    await bus.publish(pending.event)
    // An analyst-AGENT settlement IS its finding (just published): it never enters the settled
    // ledger or the finalizer, and it re-fires no analyst hook. Its routed delivery goes through
    // the exact machinery a registry-analyst finding uses — with no wrap directive, because the
    // route's directive was already consumed as the analyst's task.
    if (pending.analystRun) {
      analystRuns.delete(pending.worker.id)
      unwatchWorker(pending.worker.id)
      pendingSettlement = undefined
      const { route } = pending.analystRun
      if (route.to !== undefined && pending.event.type === 'finding') {
        await deliverRoutedFinding(
          { kind: route.kind, to: route.to },
          pending.event.finding.findings,
        )
      }
      return true
    }
    commitSettled(pending.settled, pending.worker)
    pendingSettlement = undefined
    if (
      pending.analyze &&
      pending.worker.status === 'done' &&
      pending.worker.trace.status === 'available' &&
      opts.analyzeOnSettle?.length
    ) {
      const routes = opts.analyzeOnSettle.map(normalizeAnalyzeOnSettle)
      const sourceNames = workerRouteNames(pending.worker.id)
      const applicable = routes.filter(
        (route) => route.over === undefined || route.over.some((name) => sourceNames.has(name)),
      )
      // Registry lenses run in-process over the trace store; agent analysts spawn as workers.
      const lensRoutes = applicable.filter((route) => route.agent === undefined)
      const agentRoutes = applicable.filter((route) => route.agent !== undefined)
      if (lensRoutes.length > 0 && opts.analysts) {
        const trace = await workerTraceAnalysisStore(pending.worker.trace, opts.blobs)
        for (const route of lensRoutes) {
          const findings = await opts.analysts.run(route.kind, trace)
          // The finding ALWAYS lands on the bus — the audit trail and the driver's pullable copy —
          // whether or not the route also delivers it to a named worker.
          await bus.publish({
            type: 'finding',
            finding: canonicalFindingEvent({
              fromWorker: pending.worker.id,
              analyst: route.kind,
              findings,
            }),
          })
          if (route.to !== undefined) await deliverRoutedFinding(route, findings)
        }
      }
      for (const route of agentRoutes) await spawnAnalystRun(route, pending.worker)
    }
    return true
  }

  // Producer: drain exactly one settlement from the scope cursor onto the bus (a `settled` event),
  // then fire the analyst-on-settle hook — auto-run each configured lens over the worker's trace and
  // publish its result as a `finding`. Returns false when the cursor is idle (no live workers). The
  // cursor is a once-per-child source, so a settlement is produced at most once.
  const drainSettlement = async (): Promise<boolean> => {
    if (!pendingSettlement) {
      const settled = await opts.scope.next()
      if (!settled) return false
      const worker = projectSettled(settled)
      const run = analystRuns.get(settled.handle.id)
      pendingSettlement = run
        ? {
            settled,
            worker,
            event: analystRunFinding(run, settled),
            analyze: false,
            analystRun: run,
          }
        : {
            settled,
            worker,
            event: deepFreezeDetached<CoordinationEvent>({ type: 'settled', worker }),
            analyze: true,
          }
    }
    return flushPendingSettlement()
  }

  // Post-loop drain: every ALREADY-settled, unpulled child enters the ledger + audit trail. No
  // analyst-on-settle here — the driver has stopped, so a finding has no reader and an analyst
  // spawn would spend real compute for nothing. An analyst-agent run ALREADY in flight is not a
  // new spawn: its settlement still becomes its finding (the audit trail must not lose paid-for
  // findings), though a routed delivery will usually record `delivered:false` this late.
  const drainResolved = async (): Promise<number> => {
    let drained = 0
    for (;;) {
      if (!pendingSettlement) {
        const settled = await opts.scope.nextResolved()
        if (!settled) return drained
        const worker = projectSettled(settled)
        const run = analystRuns.get(settled.handle.id)
        pendingSettlement = run
          ? {
              settled,
              worker,
              event: analystRunFinding(run, settled),
              analyze: false,
              analystRun: run,
            }
          : {
              settled,
              worker,
              event: deepFreezeDetached<CoordinationEvent>({ type: 'settled', worker }),
              analyze: false,
            }
      }
      await flushPendingSettlement()
      drained += 1
    }
  }

  // The down-leg: record a parent→child message on the bus for the audit trail (history +
  // subscribers) WITHOUT enqueuing it — the parent must never pull its own outbound message back.
  // Overloaded so the `answer` kind REQUIRES a questionId (no silent `?? ''` fallback to mask a bug).
  function sendDown(type: 'steer', down: DownMessageEvent, analyst?: string): Promise<void>
  function sendDown(type: 'answer', down: DownMessageEvent, questionId: string): Promise<void>
  async function sendDown(
    type: 'steer' | 'answer',
    down: DownMessageEvent,
    questionIdOrAnalyst?: string,
  ): Promise<void> {
    await bus.publish(
      type === 'answer'
        ? { type, down, questionId: str(questionIdOrAnalyst, 'questionId') }
        : questionIdOrAnalyst !== undefined
          ? { type, down, analyst: questionIdOrAnalyst }
          : { type, down },
      { queue: false },
    )
  }

  const authorizeInstruction = (
    kind: 'steer' | 'answer',
    workerId: string,
    instruction: string,
    interrupt: boolean,
    questionId?: string,
  ): ContinuationInstruction => {
    const workerIdentity = opts.scope.view.nodes.find((node) => node.id === workerId)?.identity
    let authorizedInstruction = instruction
    if (opts.authorizeDownMessage) {
      if (workerIdentity === undefined) {
        throw new Error(
          `coordination tools: cannot authorize ${kind} for worker ${JSON.stringify(workerId)} without durable identity`,
        )
      }
      const decision = deepFreezeDetached(
        opts.authorizeDownMessage(
          deepFreezeDetached({
            kind,
            workerId,
            workerIdentity,
            instruction,
            interrupt,
            ...(questionId !== undefined ? { questionId } : {}),
          }),
        ),
      )
      if (
        typeof decision !== 'object' ||
        decision === null ||
        Array.isArray(decision) ||
        typeof decision.instruction !== 'string' ||
        decision.instruction.length === 0
      ) {
        throw new Error('coordination tools: authorizeDownMessage must return an instruction')
      }
      authorizedInstruction = decision.instruction
    }
    return deepFreezeDetached({
      receiptId: randomUUID(),
      kind,
      toWorker: workerId,
      instruction: authorizedInstruction,
      instructionDigest: canonicalCandidateDigest(authorizedInstruction),
      ...(workerIdentity !== undefined ? { workerIdentity } : {}),
      interrupt,
      ...(questionId !== undefined ? { questionId } : {}),
    })
  }

  /** Publish before `scope.send`: an awaited durable subscriber therefore commits the exact bytes
   * before the worker can observe them. */
  const recordInstruction = async (instruction: ContinuationInstruction): Promise<void> => {
    await bus.publish({ type: 'instruction', instruction }, { queue: false })
  }

  /** Commit delivery intent after the authorization receipt and before `Scope.send`. An attempt with
   * no matching outcome after a crash is explicitly unknown and must never be replayed. */
  const recordDeliveryAttempt = async (
    instruction: ContinuationInstruction,
  ): Promise<DownMessageDeliveryAttempt> => {
    const attempt = deepFreezeDetached({
      receiptId: instruction.receiptId,
      kind: instruction.kind,
      toWorker: instruction.toWorker,
      instructionDigest: instruction.instructionDigest,
      interrupt: instruction.interrupt,
      ...(instruction.questionId !== undefined ? { questionId: instruction.questionId } : {}),
    })
    await bus.publish({ type: 'delivery-attempt', attempt }, { queue: false })
    return attempt
  }

  const deliveryOutcome = (workerId: string, delivered: boolean): DownMessageDeliveryOutcome => {
    if (delivered) return 'delivered'
    if (opts.scope.signal.aborted) return 'scope-stopped'
    const node = opts.scope.view.nodes.find((candidate) => candidate.id === workerId)
    if (!node) return 'unknown-worker'
    if (!isLive(node.status)) return 'already-settled'
    return 'runtime-has-no-inbox'
  }

  const attemptDelivery = async (
    instruction: ContinuationInstruction,
    message: unknown,
    origin?: { readonly analyst?: string },
  ): Promise<DownMessageEvent> => {
    await recordDeliveryAttempt(instruction)
    let delivered = false
    let outcome: DownMessageDeliveryOutcome
    let error: string | undefined
    try {
      delivered = opts.scope.send(instruction.toWorker, message)
      outcome = deliveryOutcome(instruction.toWorker, delivered)
    } catch (cause) {
      outcome = 'runtime-error'
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const down = deepFreezeDetached({
      receiptId: instruction.receiptId,
      toWorker: instruction.toWorker,
      instruction: instruction.instruction,
      instructionDigest: instruction.instructionDigest,
      delivered,
      outcome,
      ...(error !== undefined ? { error } : {}),
    })
    if (instruction.kind === 'answer') {
      await sendDown('answer', down, str(instruction.questionId, 'questionId'))
    } else {
      await sendDown('steer', down, origin?.analyst)
    }
    if (error !== undefined) throw new Error(`coordination tools: delivery failed: ${error}`)
    return down
  }

  // Consumer projection: the wire shape the driver sees for a pulled bus event.
  const projectEvent = (ev: CoordinationEvent): Record<string, unknown> => {
    if (ev.type === 'settled') {
      const { id, status, ...evidence } = ev.worker
      return { type: 'settled', settled: id, status, ...evidence }
    }
    if (ev.type === 'question') return { type: 'question', question: ev.question }
    if (ev.type === 'finding') return { type: 'finding', ...ev.finding }
    if (ev.type === 'answer') return { type: 'answer', ...ev.down, questionId: ev.questionId }
    if (ev.type === 'instruction') return { type: 'instruction', ...ev.instruction }
    if (ev.type === 'delivery-attempt') return { type: 'delivery-attempt', ...ev.attempt }
    // Peer mail is sideways and record-only, so the driver never pulls it either. Projected
    // explicitly rather than through the `down` fallback below: a member with no `down` property
    // spread through that fallback would yield a bare `{ type }` and drop the whole payload.
    if (ev.type === 'mail') return { type: 'mail', ...ev.mail }
    // Down-leg `steer` is record-only (never queued), so the driver never pulls it; project
    // defensively for completeness.
    return { type: ev.type, ...ev.down }
  }

  // The sibling channel, when this run enabled it. Publishing is record-only (`queue: false`) for
  // the same reason a steer is: the parent audits and can stop a thread, but peer traffic must not
  // enter the queue the driver pulls from — a busy channel would otherwise starve `await_event` of
  // the settlements and questions it exists to deliver.
  const peerMail: PeerMailbox | undefined = opts.peerMail
    ? createPeerMailbox({
        scope: opts.scope,
        publish: (mail) =>
          bus.publish({ type: 'mail', mail }, { queue: false }).then(() => undefined),
        ...(opts.peerMail.limits ? { limits: opts.peerMail.limits } : {}),
      })
    : undefined

  const nextQuestionId = (from: string): string => {
    for (;;) {
      const id = `${from}:q${questionSeq++}`
      if (!questions.some((question) => question.id === id)) return id
    }
  }
  const normalizeQuestion = (q: QuestionInput, fallbackFrom: string): Question => {
    const from = str(q.from ?? fallbackFrom, 'from')
    return {
      id: typeof q.id === 'string' && q.id.length > 0 ? q.id : nextQuestionId(from),
      from,
      level: level(q.level),
      question: str(q.question, 'question'),
      reason: str(q.reason, 'reason'),
      ...(q.options ? { options: q.options } : {}),
      urgency: urgency(q.urgency),
    }
  }
  const addQuestion = (
    raw: QuestionInput,
    fallbackFrom: string,
    decision?: QuestionDecision,
  ): { question: QuestionRecord; added: boolean } => {
    const q = normalizeQuestion(raw, fallbackFrom)
    const existing = questions.find((x) => x.id === q.id)
    if (existing) return { question: existing, added: false }
    const effectiveDecision =
      decision ??
      (questionPolicy === 'bubble'
        ? ({
            kind: 'escalate',
            to: 'parent',
            reason: 'question policy bubbled to parent',
          } as const)
        : undefined)
    const status: QuestionRecord['status'] =
      effectiveDecision?.kind === 'answer'
        ? 'answered'
        : effectiveDecision?.kind === 'defer'
          ? 'deferred'
          : effectiveDecision?.kind === 'escalate'
            ? 'escalated'
            : 'open'
    const record: QuestionRecord = {
      ...q,
      status,
      openedAt: Date.now(),
      ...(effectiveDecision ? { decision: effectiveDecision } : {}),
    }
    questions.push(record)
    return { question: record, added: true }
  }
  const emitNewQuestion = async (record: {
    question: QuestionRecord
    added: boolean
  }): Promise<QuestionRecord> => {
    if (record.added)
      await bus.publish(
        { type: 'question', question: record.question },
        { priority: urgencyPriority(record.question.urgency) },
      )
    return record.question
  }
  const decideQuestion = (questionId: string, decision: QuestionDecision): QuestionRecord => {
    const idx = questions.findIndex((q) => q.id === questionId)
    if (idx < 0) throw new Error(`unknown questionId ${JSON.stringify(questionId)}`)
    const prior = questions[idx] as QuestionRecord
    const status: QuestionRecord['status'] =
      decision.kind === 'answer' ? 'answered' : decision.kind === 'defer' ? 'deferred' : 'escalated'
    const next: QuestionRecord = { ...prior, status, decision }
    questions[idx] = next
    return next
  }
  const blockingQuestionsForStop = (): QuestionRecord[] => {
    if (questionPolicy === 'auto' || questionPolicy === 'bubble') return []
    return questions.filter((q) => {
      const blocking = q.urgency === 'blocks-step' || q.urgency === 'blocks-run'
      if (!blocking) return false
      if (questionPolicy === 'mustDecide') return q.status === 'open'
      return q.status !== 'answered' && q.status !== 'deferred'
    })
  }

  // A supervised tree exposes one shared capacity reading; a caller-owned legacy scope falls back
  // to this toolbox's direct-child count. The shared reading is what prevents each nested manager
  // from multiplying the same cap independently.
  const maxLiveWorkers = opts.maxLiveWorkers
  const isLive = (status: string): boolean =>
    status !== 'done' && status !== 'failed' && status !== 'cancelled'
  const localLiveWorkerCount = (): number =>
    opts.scope.view.nodes.filter((n) => isLive(n.status)).length
  const sharedWorkerCapacity = (): Scope<unknown>['workerCapacity'] | undefined => {
    const scope = opts.scope as Partial<Scope<unknown>>
    return scope.workerCapacity
  }
  const usesTreeWideLimit = (): boolean => {
    const capacity = sharedWorkerCapacity()
    return capacity !== undefined && capacity.freeSlots !== null
  }
  const liveWorkerCount = (): number =>
    usesTreeWideLimit()
      ? (sharedWorkerCapacity()?.live ?? localLiveWorkerCount())
      : localLiveWorkerCount()

  // A snapshot of every still-in-flight worker — the liveness signal a bounded `await_event`
  // returns when its wait elapses, so the supervisor can tell "worker still running, keep waiting"
  // apart from "nothing is happening" (the distinction it lost when the unbounded await erred out).
  const projectNodeEvidence = (
    node: Scope<unknown>['view']['nodes'][number],
    resumed = false,
  ): Record<string, unknown> => ({
    id: node.id,
    status: node.status,
    ...(node.assignmentId === undefined ? {} : { assignmentId: node.assignmentId }),
    ...(node.identity === undefined ? {} : { identity: node.identity }),
    ...(node.materialization === undefined ? {} : { materialization: node.materialization }),
    ...(node.executionBindings === undefined ? {} : { executionBindings: node.executionBindings }),
    spent: node.spent,
    ...(node.settledAt === undefined ? {} : { settledAt: node.settledAt }),
    ...(node.outRef === undefined ? {} : { outRef: node.outRef }),
    ...(node.trace === undefined ? {} : { trace: node.trace }),
    ...(resumed ? { resumed: true } : {}),
  })

  const liveSnapshot = (): Array<Record<string, unknown>> =>
    opts.scope.view.nodes.filter((n) => isLive(n.status)).map((n) => projectNodeEvidence(n))

  // How many workers the driver could open RIGHT NOW without hitting the simultaneity fence, or
  // `null` when no cap is set (the conserved pool is then the only fence, so there is no finite
  // slot count). Without this the brain could see WHO is running but never that capacity was idle,
  // so filling N slots meant emitting N blind tool calls with no feedback telling it to — the
  // mechanical reason a 5-worker run peaked at 2 live workers. Policy (whether to fill) stays with
  // the driver; this is only the reading.
  const freeWorkerSlots = (): number | null =>
    usesTreeWideLimit()
      ? (sharedWorkerCapacity()?.freeSlots ?? null)
      : freeSlots(localLiveWorkerCount(), maxLiveWorkers)

  // The LIVE read of one worker. Guarded because `createCoordinationTools` is bound to a `Scope`
  // it did not construct — an older or hand-rolled scope may not implement `progress` at all, and
  // an observation must degrade to "no progress available", never throw at the driver.
  const readProgress = (id: string): WorkerProgress | undefined => {
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.progress !== 'function') return undefined
    try {
      return scope.progress(
        id,
        opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {},
      )
    } catch {
      return undefined
    }
  }

  // ONLINE detection: subscribe the streaming detector panel to a freshly-spawned worker's live
  // tool trace, and turn each signal into a `finding` the driver pulls from `await_event`. The
  // unsubscribe fires on the worker's settle (its trace source is dead from then on) and the
  // per-worker cap stops one looping worker from flooding the bus.
  const watchers = new Map<string, () => void>()
  const watchWorker = (id: string): void => {
    const watch = opts.watchWorkers
    if (!watch) return
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.traceSource !== 'function') return
    let source: ReturnType<NonNullable<Scope<unknown>['traceSource']>>
    try {
      source = scope.traceSource(id)
    } catch {
      return
    }
    if (!source) return
    const cap = watch.maxFindingsPerWorker ?? 3
    let raised = 0
    const unsub = watchTrace(source, {
      ...(watch.detectors ? { detectors: watch.detectors } : {}),
      onSignal: async (signal, span) => {
        if (cap > 0 && raised >= cap) return
        raised += 1
        await bus.publish({
          type: 'finding',
          // canonicalFindingEvent: `span.toolName` is optional — an undefined value anywhere in
          // the payload would throw in the digesting subscriber and vanish the event.
          finding: canonicalFindingEvent({
            fromWorker: id,
            analyst: `online:${signal.detector}`,
            findings: {
              detector: signal.detector,
              severity: signal.severity,
              reason: signal.reason,
              streak: signal.streak,
              ...(signal.failureClass ? { failureClass: signal.failureClass } : {}),
              toolName: span.toolName,
              at: span.endedAt,
              progress: readProgress(id),
            },
          }),
        })
      },
    })
    watchers.set(id, unsub)
  }
  const unwatchWorker = (id: string): void => {
    const unsub = watchers.get(id)
    if (!unsub) return
    watchers.delete(id)
    try {
      unsub()
    } catch {
      // an unsubscribe that throws must never break the settle path
    }
  }

  // The blocking `scope.next()` (via `drainSettlement`) waits on a LIVE worker for its whole run.
  // Keep at most ONE such drain in flight and let every concurrent `await_event` race THAT single
  // promise against a timeout — so a bounded call never starts a second unbounded block, and the
  // one drain still delivers the settlement (exactly-once via the scope cursor) whenever it lands.
  const awaitTimeoutMs = opts.awaitTimeoutMs ?? DEFAULT_AWAIT_EVENT_TIMEOUT_MS
  let inFlightDrain: Promise<boolean> | null = null
  const ensureDrain = (): Promise<boolean> => {
    if (!inFlightDrain)
      inFlightDrain = drainSettlement().finally(() => {
        inFlightDrain = null
      })
    return inFlightDrain
  }
  // Resolve `{ drained }` if the drain wins, or `undefined` if the bound elapses first. A `<= 0`
  // bound restores the prior unbounded block (no timer): the caller opted out of the fence.
  const raceDrainWithTimeout = async (
    drain: Promise<boolean>,
  ): Promise<{ drained: boolean } | undefined> => {
    if (awaitTimeoutMs <= 0) return { drained: await drain }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), awaitTimeoutMs)
      // Never let this fence-timer alone keep the process alive (e.g. at teardown).
      if (typeof timer?.unref === 'function') timer.unref()
    })
    try {
      return await Promise.race([drain.then((drained) => ({ drained })), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const tools: McpToolDescriptor[] = [
    {
      name: 'spawn_agent',
      description:
        'Start a worker the driver will drive. `profile` is the worker or another driver; ' +
        '`task` is what it should do. Reserves budget from the conserved pool and fails closed. ' +
        'Pass an optional `budget` (per-field) to give a hard sub-task more than the default — it ' +
        'merges over the per-worker default; the conserved pool is still the hard fence. When a ' +
        'max-live-workers cap is set it also fails closed (`error: "max-live-workers"`) while that ' +
        'many workers are still in flight — settle or steer one before spawning another. ' +
        'Pass a `key` naming the assignment to make it run-once ACROSS restarts: a key that ' +
        'already completed returns the finished result (`resumed: "completed"` — no work re-runs, ' +
        'nothing is spent), a key whose prior attempt failed or was lost with a dead process ' +
        'spawns fresh and says so (`resumed: "retried" | "lost"`), and a key still running is ' +
        'refused (`error: "duplicate-key"`). ' +
        'Returns `freeSlots`: how many MORE workers you can start right now (`null` = uncapped). ' +
        'While `freeSlots > 0` there is idle capacity — call this again to fill it rather than ' +
        'waiting; parallel workers finish the run sooner than one at a time.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: spawnProfileArg(),
          task: { description: 'The task the worker should perform.' },
          label: { type: 'string', description: 'Optional trace label.' },
          key: {
            type: 'string',
            description:
              'Optional semantic name for this assignment (e.g. "summarize-ch3"). The same key ' +
              'never runs twice: completed keys return their committed result, even after a ' +
              'coordinator restart.',
          },
          continuity: {
            type: 'string',
            enum: ['fresh', 'resume'],
            description:
              'How this spawn continues the node\'s prior work. "fresh" (the default) starts a ' +
              'brand-new session. "resume" re-attaches to the node\'s most recent SETTLED ' +
              'worker: a NEW live worker is spawned whose session continues where that worker ' +
              'stopped (the backend receives the prior workerId and the resume sequence). ' +
              'Resume fails closed when the node has no settled prior worker ' +
              '(`error: "resume-no-prior"` — spawn it fresh first), while a prior worker of the ' +
              'node is still live (`error: "resume-while-live"` — steer_agent is the ' +
              'live-worker channel), and under a `key` (`error: "resume-with-key"` — keys are ' +
              "run-once, resume runs again). Omit to use the run's declared default for this " +
              'profile name.',
          },
          budget: {
            type: 'object',
            description:
              'Optional per-spawn budget that merges over the per-worker default (per field). ' +
              'Only set the ceilings this sub-task needs raised; the conserved pool still fences.',
            properties: {
              maxIterations: { type: 'number', minimum: 0 },
              maxTokens: { type: 'number', minimum: 0 },
              maxUsd: { type: 'number', minimum: 0 },
              deadlineMs: { type: 'number', minimum: 0 },
            },
          },
        },
        required: ['profile', 'task'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const key = a.key === undefined ? undefined : str(a.key, 'key')
        // A key already proven complete — by the resumed journal or by a delivery earlier in this
        // run — resolves to committed work and starts no live worker, so the concurrency fence
        // does not apply to it.
        const keyCompleted = key !== undefined && completedKeys.has(key)
        // Concurrency fence FIRST — fail closed before reserving budget, so a rejected spawn never
        // touches the pool. The conserved pool bounds TOTAL work; this bounds SIMULTANEOUS work.
        if (
          !keyCompleted &&
          !usesTreeWideLimit() &&
          maxLiveWorkers !== undefined &&
          maxLiveWorkers > 0 &&
          liveWorkerCount() >= maxLiveWorkers
        )
          return Promise.resolve({
            error: 'max-live-workers' as const,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        const parsedProfile = agentProfileSchema.safeParse(a.profile)
        if (!parsedProfile.success) {
          return Promise.resolve({
            error: 'invalid-profile' as const,
            issues: parsedProfile.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          })
        }
        const profile = deepFreezeDetached(parsedProfile.data)
        // Continuity resolves BEFORE any assignment is minted or budget reserved, so a refused
        // resume touches nothing — same fail-closed discipline as the fences above.
        const continuity = resolveContinuity(parseContinuity(a.continuity), profile.name, key)
        if ('error' in continuity) {
          return Promise.resolve({
            error: continuity.error,
            hint: continuity.hint,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        }
        const task = deepFreezeDetached(a.task)
        const label = typeof a.label === 'string' ? a.label : 'worker'
        const budget = Object.freeze(
          a.budget === undefined ? opts.perWorker : mergeBudget(opts.perWorker, a.budget),
        )
        const assignmentId =
          key !== undefined ? `key:${key}` : `ordinal:${unkeyedAssignmentOrdinal++}`
        // Minted BEFORE the worker exists, because the agent factory runs inside `scope.spawn` and
        // the node id is not known until after it. The capability is bound to the concrete worker
        // below, and sends nothing until then.
        const peerMailUrl = peerMail?.mintCapability(assignmentId)
        const context: WorkerSpawnContext = Object.freeze({
          assignmentId,
          parentNodeId: opts.scope.view.root,
          budget,
          task,
          label,
          ...(key !== undefined ? { key } : {}),
          continuity: continuity.continuity,
          ...(continuity.continuity === 'resume' ? { resume: continuity.resume } : {}),
          ...(peerMailUrl !== undefined ? { peerMailUrl } : {}),
        })
        const res = opts.scope.spawn(() => opts.makeWorkerAgent(profile, context), task, {
          budget,
          label,
          assignmentId,
          ...(key !== undefined ? { key } : {}),
        })
        // A keyed spawn that resolved to committed work: NOTHING ran — return the finished result
        // (it is already in the settled ledger, seeded from the resumed scope or recorded when the
        // cursor yielded it), so the driver folds it in without an await_event round-trip.
        if (res.ok && res.prior?.state === 'completed') {
          const s = res.prior.settled
          if (key !== undefined) completedKeys.add(key)
          const { id, status, resumed: _resumed, ...evidence } = projectSettled(s)
          return Promise.resolve({
            workerId: id,
            resumed: 'completed' as const,
            status,
            ...evidence,
            live: liveWorkerCount(),
            freeSlots: freeWorkerSlots(),
          })
        }
        if (res.ok) {
          watchWorker(res.handle.id)
          liveHandles.set(res.handle.id, res.handle)
          // The capability becomes a sender only now, when there is a concrete worker to speak as.
          peerMail?.bindCapability(assignmentId, res.handle.id)
          // Bind the new worker to its key so its settlement can mark the key complete.
          if (key !== undefined) keyByWorker.set(res.handle.id, key)
          if (typeof profile.name === 'string' && profile.name.length > 0) {
            profileNameByWorker.set(res.handle.id, profile.name)
          }
        }
        // A `completed` key returned above, so any prior still attached here is a real re-run:
        // `retried` (the prior attempt failed) or `lost` (it died in flight with its process).
        const priorHistory =
          res.ok && res.prior !== undefined && res.prior.state !== 'completed'
            ? {
                resumed: res.prior.state,
                priorWorkerId: res.prior.priorId,
                ...(res.prior.state === 'retried' ? { priorReason: res.prior.reason } : {}),
              }
            : {}
        // Report the REMAINING capacity alongside the spawn, so one tool call tells the driver
        // both "it started" and "you can still open N more" — the feedback that lets it fill
        // slots instead of opening one worker per turn. `null` = uncapped. A fresh spawn under a
        // key with a failed/lost prior attempt carries that history (`resumed`/`priorWorkerId`),
        // so a re-run is always explicit, never a silent duplicate.
        return Promise.resolve(
          res.ok
            ? {
                workerId: res.handle.id,
                assignmentId: res.handle.assignmentId ?? assignmentId,
                ...(res.handle.identity === undefined ? {} : { identity: res.handle.identity }),
                ...(res.handle.materialization === undefined
                  ? {}
                  : { materialization: res.handle.materialization }),
                ...(res.handle.executionBindings === undefined
                  ? {}
                  : { executionBindings: res.handle.executionBindings }),
                // The EFFECTIVE continuity of this spawn, with the resume lineage when it
                // re-attached — so the driver's transcript states how the node continued.
                continuity: continuity.continuity,
                ...(continuity.continuity === 'resume' ? { resume: continuity.resume } : {}),
                live: liveWorkerCount(),
                freeSlots: freeWorkerSlots(),
                ...priorHistory,
              }
            : {
                error: res.reason,
                // A refusal a driver can ACT on. `usd-unbudgeted` is the one rejection that no
                // retry can clear, so it says so: without this, a driver reads "budget" and walks
                // its request down until it gives up.
                ...(res.reason === 'usd-unbudgeted'
                  ? {
                      hint:
                        "This run's root budget declares no maxUsd, so a child budget naming maxUsd " +
                        'can never be admitted — at any amount. Retrying with a smaller maxUsd will ' +
                        'fail identically. Spawn with a budget that omits maxUsd, or ask the caller ' +
                        'to give the run a root maxUsd.',
                    }
                  : {}),
                live: liveWorkerCount(),
                freeSlots: freeWorkerSlots(),
              },
        )
      },
    },
    {
      name: 'observe_agent',
      description:
        'Inspect a worker WHILE IT RUNS, not only after it finishes: status, spend so far, and ' +
        '`progress` — how long since it last did anything (`idleMs`), whether that counts as ' +
        'stalled, how many turns it has taken, the last tools/files it touched ' +
        '(`recentActivity`), what its executor CHANGED about the profile you gave it ' +
        '(`derived` — an MCP config it materialized, an extension it had to add), whether a ' +
        'steer can even reach it (`steerable`), and how many ' +
        'steers it has not yet read (`pendingMessages`). Returns the settled output artifact ' +
        'once it exists. Use this BEFORE steer_agent: a steer is only worth sending when the ' +
        'progress says the worker is on the wrong path or has stopped making any.',
      inputSchema: { type: 'object', properties: { workerId: idArg }, required: ['workerId'] },
      handler: async (raw) => {
        const id = str(obj(raw).workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) {
          // A worker from a PRIOR process of this run: not in the live nursery, but its committed
          // record is on the resumed view — observable like any settled worker, marked `resumed`.
          const resumed = opts.scope.resume?.view.nodes.find((n) => n.id === id)
          if (!resumed) return { error: `unknown workerId ${JSON.stringify(id)}` }
          const output = resumed.outRef ? await opts.blobs.get(resumed.outRef) : undefined
          return {
            ...projectNodeEvidence(resumed, true),
            outRef: resumed.outRef ?? null,
            output: output ?? null,
            progress: null,
          }
        }
        const output = node.outRef ? await opts.blobs.get(node.outRef) : undefined
        const progress = readProgress(id)
        return {
          ...projectNodeEvidence(node),
          outRef: node.outRef ?? null,
          output: output ?? null,
          progress: progress ?? null,
        }
      },
    },
    {
      name: 'steer_agent',
      description:
        'Send a message DOWN to a still-LIVE worker (parent→child): a new instruction, a course ' +
        'correction, or a continuation. The worker drains it at its next step boundary — and before ' +
        'it may settle, so it cannot finish while a message it never read is pending. A worker that ' +
        'already settled is gone (returns delivered:false) — spawn a fresh one instead.',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          instruction: { type: 'string', description: 'What the worker should do next.' },
          interrupt: {
            type: 'boolean',
            description:
              'true = forceful: abort the worker’s in-flight inference so it re-plans on the NEXT ' +
              'turn (a tool already mid-execution finishes first; only the owned tool-loop honors this). ' +
              'false/omitted = queued: it flushes at the next step boundary (and before it may settle).',
          },
        },
        required: ['workerId', 'instruction'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const workerId = str(a.workerId, 'workerId')
        const instruction = str(a.instruction, 'instruction')
        const interrupt = a.interrupt === true
        const authorized = authorizeInstruction('steer', workerId, instruction, interrupt)
        await recordInstruction(authorized)
        const delivery = await attemptDelivery(authorized, {
          steer: authorized.instruction,
          interrupt,
        })
        if (delivery.delivered) {
          return { delivered: true, progress: readProgress(workerId) ?? null }
        }
        return {
          delivered: false,
          reason: delivery.outcome,
          progress: readProgress(workerId) ?? null,
        }
      },
    },
    {
      name: 'await_event',
      description:
        'Wait for and pull the next message a worker, sub-driver, or analyst sent up — the unified ' +
        "inbox. An event is one of: a settled worker output ('settled'), a question needing your " +
        "answer ('question', from ask_parent / the worker's ask-user), or a trace-analyst finding " +
        "('finding', from analyze-on-settle). Pass kinds:['settled'] for just the next finished " +
        'worker; omit `kinds` to also receive questions and findings. Returns { idle: true } when ' +
        'nothing is queued and no workers are live. If a worker is still running when the wait ' +
        'elapses, returns { pending: true, live: [...] } (the workers still in flight) instead of ' +
        'blocking indefinitely — call await_event again to keep waiting; the settlement is not lost. ' +
        'Every reply carries `freeSlots`: how many more workers you can start right now (`null` = ' +
        'uncapped). A settled worker frees its slot, so `freeSlots > 0` means capacity is sitting ' +
        'idle — spawn into it before waiting again.',
      inputSchema: {
        type: 'object',
        properties: {
          kinds: {
            type: 'array',
            items: { type: 'string', enum: ['settled', 'question', 'finding'] },
            description: 'Restrict to these event kinds (any if omitted).',
          },
        },
      },
      handler: async (raw) => {
        const k = obj(raw).kinds
        const kinds = Array.isArray(k)
          ? (k.filter((x) => x === 'settled' || x === 'question' || x === 'finding') as Array<
              CoordinationEvent['type']
            >)
          : undefined
        // Already-queued async messages (findings, questions) first — a fast, non-blocking pull.
        let ev = bus.pull(kinds)
        // Every return from this verb carries `freeSlots` — a settlement is exactly the moment
        // capacity frees up, so the answer travels with the event that freed it.
        if (ev) return { ...projectEvent(ev), freeSlots: freeWorkerSlots() }
        // Else drive the cursor to produce the next settlement — but BOUND the block. `scope.next()`
        // waits on a live worker for its entire (multi-minute) run; unbounded, that outlives a remote
        // MCP client's request timeout and surfaces as a hard tool error, leaving the supervisor with
        // no working "wait for the worker" primitive. Race the single in-flight drain against the
        // fence: if it settles in time, re-pull and return the event (or idle when the cursor is dry);
        // if the fence wins, return a non-error liveness snapshot the supervisor can re-poll on.
        const raced = await raceDrainWithTimeout(ensureDrain())
        if (raced === undefined)
          return { pending: true, live: liveSnapshot(), freeSlots: freeWorkerSlots() }
        ev = bus.pull(kinds)
        if (!ev) return { idle: !raced.drained, freeSlots: freeWorkerSlots() }
        return { ...projectEvent(ev), freeSlots: freeWorkerSlots() }
      },
    },
    {
      name: 'list_questions',
      description:
        'List questions raised by workers, drivers, or analysts. Blocking stop behavior follows questionPolicy.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ questions }),
    },
    {
      name: 'answer_question',
      description: 'Record an answer, deferral, or escalation for a loop question.',
      inputSchema: {
        type: 'object',
        properties: {
          questionId: { type: 'string' },
          answer: { type: 'string' },
          by: { type: 'string', description: 'Node id or "user".' },
          deferReason: { type: 'string' },
          escalateTo: { type: 'string', enum: ['parent', 'user'] },
          escalateReason: { type: 'string' },
        },
        required: ['questionId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const questionId = str(a.questionId, 'questionId')
        if (typeof a.answer === 'string' && a.answer.length > 0) {
          const answer = a.answer
          const pendingQuestion = questions.find((question) => question.id === questionId)
          if (pendingQuestion === undefined) {
            throw new Error(`unknown questionId ${JSON.stringify(questionId)}`)
          }
          // Route the answer DOWN to the worker that asked, unparking it, and record the down-leg.
          // A blocking question parked the worker, so deliver forcefully — it should resume on the
          // answer immediately, not wait for its next step boundary.
          const interrupt =
            pendingQuestion.urgency === 'blocks-run' || pendingQuestion.urgency === 'blocks-step'
          const authorized = authorizeInstruction(
            'answer',
            pendingQuestion.from,
            answer,
            interrupt,
            questionId,
          )
          await recordInstruction(authorized)
          const delivery = await attemptDelivery(authorized, {
            answer: authorized.instruction,
            questionId,
            interrupt,
          })
          // Authorization is evidence of allowed bytes, not proof the blocked worker received them.
          // Resolve the question only after the durable delivery outcome says the live inbox accepted
          // the answer. A refusal stays open both in this process and after replay.
          const question = delivery.delivered
            ? decideQuestion(questionId, {
                kind: 'answer',
                answer: authorized.instruction,
                by: typeof a.by === 'string' && a.by.length > 0 ? a.by : 'user',
              })
            : pendingQuestion
          // Surface `delivered` like steer_agent — the caller must see whether the answer actually
          // reached a live worker (false when it already settled or has no inbox).
          return {
            question,
            delivered: delivery.delivered,
            ...(delivery.delivered ? {} : { reason: delivery.outcome }),
          }
        }
        if (typeof a.deferReason === 'string' && a.deferReason.length > 0) {
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'defer',
              reason: a.deferReason,
            }),
          })
        }
        if (a.escalateTo === 'parent' || a.escalateTo === 'user') {
          const escalateReason =
            typeof a.escalateReason === 'string' && a.escalateReason.length > 0
              ? a.escalateReason
              : 'driver escalated'
          return Promise.resolve({
            question: decideQuestion(questionId, {
              kind: 'escalate',
              to: a.escalateTo,
              reason: escalateReason,
            }),
          })
        }
        throw new Error('answer_question: provide answer, deferReason, or escalateTo')
      },
    },
    {
      name: 'ask_parent',
      description: 'Raise a question to the parent driver/Pi/user when this driver cannot decide.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          level: { type: 'string', enum: ['worker', 'driver', 'loop'] },
          question: { type: 'string' },
          reason: { type: 'string' },
          urgency: { type: 'string', enum: ['continue-without', 'blocks-step', 'blocks-run'] },
        },
        required: ['from', 'level', 'question', 'reason', 'urgency'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const from = str(a.from, 'from')
        const q = await emitNewQuestion(
          addQuestion(
            {
              from,
              level: level(a.level),
              question: str(a.question, 'question'),
              reason: str(a.reason, 'reason'),
              urgency: urgency(a.urgency),
            },
            from,
            { kind: 'escalate', to: 'parent', reason: 'asked parent' },
          ),
        )
        return { question: q }
      },
    },
    ...(deliverable
      ? [
          {
            name: 'submit_result',
            description: [
              'Submit the complete result to the injected independent check.',
              'The first passing result is retained; stop work when accepted.',
              ...(deliverable.describe ? [`Expected result: ${deliverable.describe}`] : []),
            ].join(' '),
            inputSchema: {
              type: 'object',
              properties: {
                result: {
                  description: 'The complete result in the form requested by the task.',
                },
              },
              required: ['result'],
              additionalProperties: false,
            },
            handler: async (raw: unknown) => {
              if (submitted) {
                return {
                  accepted: true,
                  retained: 'earlier-passing-result',
                  stop: true,
                }
              }
              const a = obj(raw)
              if (!Object.hasOwn(a, 'result')) {
                throw new Error('submit_result: "result" is required')
              }

              // Copy once at intake so the value checked below is the exact value retained after
              // acceptance, even when this handler is called directly rather than through JSON-RPC.
              const result = structuredClone(a.result)
              let accepted = false
              try {
                accepted = (await deliverable.check(result)) === true
              } catch {
                accepted = false
              }
              if (!accepted) return { accepted: false, stop: false }
              // Two remote callers may submit concurrently. Whichever passing check completes
              // first owns the retained result; a later completion must never overwrite it.
              if (submitted) {
                return {
                  accepted: true,
                  retained: 'earlier-passing-result',
                  stop: true,
                }
              }

              submitted = Object.freeze({ result })
              stopped = true
              reason = 'result-accepted'
              notifyStop()
              return { accepted: true, retained: 'this-result', stop: true }
            },
          } satisfies McpToolDescriptor,
        ]
      : []),
    {
      name: 'stop',
      description: 'Declare the run complete.',
      inputSchema: {
        type: 'object',
        properties: { reason: { type: 'string', description: 'Why you are stopping.' } },
      },
      handler: (raw) => {
        const blocking = blockingQuestionsForStop()
        if (blocking.length) {
          return Promise.resolve({
            stopped: false,
            error: 'unresolved-blocking-questions',
            questions: blocking,
          })
        }
        stopped = true
        const r = obj(raw).reason
        reason = typeof r === 'string' ? r : undefined
        notifyStop()
        return Promise.resolve({ stopped: true })
      },
    },
  ]

  if (opts.analysts) {
    tools.push({
      name: 'list_analysts',
      description: 'List trace-analyst lenses available to run over a settled worker.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ analysts: opts.analysts?.kinds }),
    })
    tools.push({
      name: 'run_analyst',
      description: 'Apply an analyst lens to a settled worker trace.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'The analyst kind id.' },
          workerId: idArg,
        },
        required: ['kind', 'workerId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const id = str(a.workerId, 'workerId')
        const node = nodeForWorker(id)
        if (!node) return { error: `unknown workerId ${JSON.stringify(id)}` }
        if (isLive(node.status)) {
          return { error: `worker ${JSON.stringify(id)} has not settled — no trace to analyze yet` }
        }
        const trace =
          ledger.find((worker) => worker.id === id)?.trace ??
          node.trace ??
          ({
            status: 'unavailable',
            reason: 'legacy-settlement-without-trace-evidence',
          } as const)
        let store: TraceAnalysisStore
        try {
          store = await workerTraceAnalysisStore(trace, opts.blobs)
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            trace,
          }
        }
        return { findings: await opts.analysts?.run(str(a.kind, 'kind'), store) }
      },
    })
  }

  // Per-child abort by stable reference. Resolution order matches the steer destination rule
  // (profile name before label) with the exact workerId first; only LIVE workers resolve, so an
  // already-settled or unknown reference returns `undefined` instead of a false "aborted".
  const abortWorker = (
    ref: string,
    reason?: string,
  ): { readonly id: string; readonly label: string } | undefined => {
    const live = opts.scope.view.nodes.filter((node) => isLive(node.status))
    const target =
      live.find((node) => node.id === ref) ??
      live.find((node) => profileNameByWorker.get(node.id) === ref) ??
      live.find((node) => node.label === ref)
    if (target === undefined) return undefined
    const handle = liveHandles.get(target.id)
    if (handle === undefined) return undefined
    handle.abort(reason)
    return { id: target.id, label: target.label }
  }

  return {
    tools,
    ready,
    history: () => bus.history(),
    raiseFinding: (finding) =>
      bus
        .publish({ type: 'finding', finding: canonicalFindingEvent(finding) })
        .then(() => undefined),
    stats: () => bus.stats(),
    isStopped: () => stopped,
    stopReason: () => reason,
    submittedResult: () => submitted,
    settled: () => ledger,
    questions: () => questions,
    drainResolved,
    abortWorker,
    ...(peerMail ? { peerMail } : {}),
  }
}

function nextUnkeyedAssignmentOrdinal(scope: Scope<unknown>): number {
  let next = 0
  const views = [scope.resume?.view, scope.view]
  for (const view of views) {
    if (view === undefined) continue
    for (const node of view.nodes) {
      const match = /^ordinal:(\d+)$/.exec(node.assignmentId ?? '')
      if (match === null) continue
      const ordinal = Number(match[1])
      if (!Number.isSafeInteger(ordinal)) {
        throw new Error(
          `coordination: durable assignment id '${node.assignmentId}' exceeds the safe ordinal range`,
        )
      }
      next = Math.max(next, ordinal + 1)
    }
  }
  if (!Number.isSafeInteger(next)) {
    throw new Error('coordination: durable assignment ordinal space is exhausted')
  }
  return next
}

function deepFreezeDetached<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

/** Stringify a findings payload for a routed delivery; never throws (a cyclic payload degrades to
 *  its String form rather than killing the settle path). */
function safeJsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen)
  return Object.freeze(value)
}
