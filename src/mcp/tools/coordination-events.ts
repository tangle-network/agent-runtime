import type { WatchTraceOptions } from '../../runtime/supervise/detector-monitor'
import type { BusRecord } from '../../runtime/supervise/event-bus'
import type { PeerMailEvent } from '../../runtime/supervise/peer-mail'
import type {
  AnalystAssignmentRecord,
  AnalystFindingEvent,
  DefinedAnalystRecord,
} from './coordination-analysts'
import type { SettledWorker } from './coordination-contracts'
import type { MapTraversalEvent } from './coordination-map-contracts'
import type {
  ContinuationInstruction,
  DownMessageDeliveryAttempt,
  DownMessageEvent,
} from './coordination-messages'
import type { QuestionEscalationRecord, QuestionRecord } from './coordination-questions'
import type { RouteFlowEvent } from './coordination-route-contracts'

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
  /** A direct manager result that passed its injected completion check. Record-only: the caller
   *  already received the tool response, and a restarted manager restores this exact accepted
   *  result instead of running the check or its harness again. */
  | { readonly type: 'submission'; readonly result: unknown }
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
  /** A question left this manager through `ask_parent`, and what became of it. Record-only: the
   *  asker already holds the outcome, and an escalation is evidence for the operator, not an item
   *  in the inbox the manager pulls from. */
  | { readonly type: 'escalation'; readonly escalation: QuestionEscalationRecord }
  /** A manager DEFINED a trace analyst (`define_analyst`). Record-only: the manager already has the
   *  result in its tool return, so queueing it would put its own action in its own inbox. It is the
   *  run artifact that makes an invented lens reproducible — the exact bytes, their digest, and the
   *  owner the durable log stamps beside them. */
  | { readonly type: 'analyst-defined'; readonly analyst: DefinedAnalystRecord }
  /** Persisted before a native analyst can spend; restored by assignment id after restart. */
  | { readonly type: 'analyst-assignment'; readonly assignment: AnalystAssignmentRecord }
  /** The manager processed events a wake delivered to it. Record-only, and separate from
   *  delivery on purpose: an event delivered to a turn that then FAILED stays unacknowledged, and
   *  the manager's next re-entry names it again instead of losing it with the dead turn. */
  | { readonly type: 'acknowledgement'; readonly acknowledgement: EventAcknowledgement }
  /** A tool call that outlived its response fence settled. Queued: the manager's next wake
   *  carries it, so the caller never re-calls to collect it. */
  | { readonly type: 'tool-outcome'; readonly outcome: ToolOutcomeEvent }
  /** This manager's lead (its parent manager, or the operator for a root) sent it a steer or an
   *  answer. Queued: a manager's harness has no live inbox between turns, so the message is the
   *  input of its next wake instead of a refused delivery. */
  | { readonly type: 'lead-message'; readonly message: LeadMessage }
  /** One step of a map route. Record-only, except an expansion that was refused and a join that
   *  could not run: those are queued, because no settlement will wake the manager for them. */
  | { readonly type: 'map'; readonly map: MapTraversalEvent }
  /** One flow step (see {@link RouteFlowEvent}). Record-only: the settle that caused it already
   *  woke the manager, and a flow manager makes no decision of its own. */
  | { readonly type: 'route'; readonly route: RouteFlowEvent }

/** One acknowledgement record: which delivered events are now processed, and on whose word. */
export interface EventAcknowledgement {
  /** Bus `seq` of each acknowledged event, in this process's sequence space. Empty for the
   *  recipient's receipt on a steer or answer, which `messageId` names instead. */
  readonly seqs: ReadonlyArray<number>
  /** `manager`: legacy rows from a manager that named them. `turn-completed`: the
   *  driver turn that received them ended normally. `result-accepted`: a submission passed the
   *  completion check after they were delivered. `consumed`: the recipient's provider accepted a
   *  model input carrying the steer or answer `messageId`. `failed`: the recipient stopped without
   *  reading it, for `reason`. */
  readonly by: 'manager' | 'turn-completed' | 'result-accepted' | 'consumed' | 'failed'
  /** The 1-based driver attempt that received them, when the manager has driver attempts. */
  readonly attempt?: number
  /** `consumed` / `failed`: the `receiptId` of the steer or answer this row answers. */
  readonly messageId?: string
  /** `consumed`: the recipient attempt whose accepted input carried the message. */
  readonly attemptId?: string
  /** `failed`: why the recipient never read the message. */
  readonly reason?: string
}

/** What a manager's coordinator knows about its run, read when the manager is entered again.
 *  Every field comes from the coordinator's own records, never from the manager's environment. */
export interface ManagerReentryState {
  /** Rows in this manager's journal (`read_journal`) right now. */
  readonly journalRows: number
  /** The highest `nextRow` a `read_journal` call has returned, 0 when the manager never read it. */
  readonly journalReadTo: number
  /** Workers still running. */
  readonly live: ReadonlyArray<{
    readonly id: string
    readonly label: string
    readonly status: string
  }>
  /** Workers that settled, with whether their settlement reached the manager in a wake. */
  readonly settled: ReadonlyArray<{
    readonly id: string
    readonly status: 'done' | 'down'
    readonly valid?: boolean
    readonly delivered: boolean
  }>
  /** Events queued for the next wake and not yet delivered, including settlements the coordinator
   *  holds but has not queued yet. */
  readonly waiting: ReadonlyArray<{ readonly type: string; readonly worker?: string }>
  /** Events delivered to a turn that did not complete, and not acknowledged since. */
  readonly unacknowledged: ReadonlyArray<{
    readonly seq: number
    readonly type: string
    readonly worker?: string
    readonly attempt?: number
    /** The event as its wake showed it. A turn that failed may never have read it: a steer named
     *  only by its sequence number reaches no prompt. */
    readonly event: Record<string, unknown>
  }>
  /** The last refused `submit_result`, with the refusal the manager was given. */
  readonly lastRejection?: { readonly at: number; readonly reason: string }
}

/** Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`). */
export interface WorkerWatchOptions {
  /** Detector panel; omit for the default stuck-loop + error-streak pair. */
  readonly detectors?: WatchTraceOptions['detectors']
  /** Raise at most this many findings per worker, so one pathological worker cannot flood the
   *  driver's inbox with the same signal every span. Default 3; `<= 0` = unlimited. */
  readonly maxFindingsPerWorker?: number
}

/** What a manager waits for, from `awaitWake`. */
export interface AwaitWakeInput {
  /** The driver attempt the wake will start: its deliveries are acknowledged when that turn
   *  completes, and named again on re-entry when it fails. Omit for the current attempt. */
  readonly attempt?: number
  readonly signal: AbortSignal
  /** Wake with no event after this long, so a waiting manager can reconsider. */
  readonly heartbeatMs: number
  /** The wake starts a model turn: a heartbeat that finds every live worker progressing is
   *  re-armed instead of returned. A caller that uses the heartbeat as a poll bound omits it. */
  readonly quietWhileProgressing?: boolean
  /** After the first event, wait this long for more and deliver them together. */
  readonly debounceMs: number
  /** Epoch ms of a deadline warning: wake once then, with or without an event. */
  readonly deadlineAt?: number
  /** Something outside the bus that also ends the wait, such as a delivery to the manager's own
   *  inbox. */
  readonly alsoWakeOn?: Promise<unknown>
}

/** One wake of a manager that ended its turn with work open. */
export interface ManagerWake {
  /** `events`: something reached the inbox. `heartbeat`: the heartbeat elapsed with nothing new.
   *  `deadline`: the deadline warning came due. */
  readonly reason: 'events' | 'heartbeat' | 'deadline'
  /** Everything that reached the inbox since the last turn, in bus order. */
  readonly events: ReadonlyArray<Record<string, unknown> & { readonly eventSeq: number }>
  /** Workers still running. */
  readonly live: ReadonlyArray<Record<string, unknown>>
  /** How many more workers can start now; `null` when uncapped. */
  readonly freeSlots: number | null
  /** How long the manager waited, with no model turn, before this wake. */
  readonly idleMs: number
  /** Heartbeats that elapsed with every live worker still progressing, and woke no turn. */
  readonly quietHeartbeats?: number
}

/** A steer or an answer this manager received from its lead. */
export interface LeadMessage {
  /** The sender's message id, when it named one; its receipt is answered under this id. */
  readonly messageId?: string
  readonly kind: 'steer' | 'answer'
  readonly text: string
  readonly questionId?: string
  /** The lead asked for the message to interrupt; it is delivered at the next wake either way. */
  readonly interrupt: boolean
}

/** A tool call that outlived its response fence, and its outcome once it settled. */
export interface ToolOutcomeEvent {
  /** The receipt the caller was given when the fence elapsed. */
  readonly receipt: string
  readonly tool: string
  readonly ok: boolean
  /** The tool's result, when it succeeded. */
  readonly value?: unknown
  /** The tool's error message, when it failed. */
  readonly error?: string
  readonly elapsedMs: number
}

// ── The manager's own journal, read back ────────────────────────────────────────
//
// `history()` is the ordered log of every coordination event this manager published — its spawns,
// its settles, the questions it raised and decided, the steers it authorized, the findings its
// analysts returned. It was reachable only from the HOST process, so a manager could observe every
// child and never re-read its own record; a driver that had already tried an approach had no way to
// see that it had. `read_journal` is that log made agent-readable, under three fences.
//
// BOUNDED. A long run's history is far larger than any context window, so the read is paged by an
// explicit cursor and capped by both a record count and a byte budget. A single oversize record is
// replaced by a marker rather than dropped, so the cursor always advances past it.
//
// REDACTED. The log carries model-authored instruction text and worker output that may quote a
// credential. Every returned event is passed through a redactor before it leaves; the default is
// the runtime's own {@link Redactor}.
//
// SUBTREE-SCOPED BY CONSTRUCTION, not by a check. Each manager node builds its OWN toolbox over its
// OWN bus, so `history()` holds that manager's events and no other's. The tool takes no node,
// worker, run or owner argument, so there is no name a child could pass to reach its parent's log.

/** Default and maximum bounds for one {@link CoordinationTools} journal read. The defaults are
 *  sized for a driver turn (a page a model can read and still have room to act on); the maxima
 *  bound what a single tool result may cost even when the caller asks for everything. */
export const JOURNAL_READ_BOUNDS = Object.freeze({
  defaultLimit: 50,
  maxLimit: 500,
  defaultMaxBytes: 16_384,
  maxMaxBytes: 262_144,
})

/** Every `CoordinationEvent` kind `read_journal` can return — the tool advertises this list in its
 *  JSON Schema AND filters on it, so the schema cannot promise a kind the filter drops. */
export const journalEventKinds = [
  'question',
  'settled',
  'finding',
  'submission',
  'steer',
  'answer',
  'instruction',
  'delivery-attempt',
  'mail',
  'escalation',
  'analyst-defined',
  'analyst-assignment',
  'acknowledgement',
  'tool-outcome',
  'lead-message',
  'map',
  'route',
] as const satisfies ReadonlyArray<CoordinationEvent['type']>

export type JournalEventKind = (typeof journalEventKinds)[number]

/** `satisfies` above proves every listed name IS an event kind; this proves the list is COMPLETE.
 *  Without it a new `CoordinationEvent` member compiles fine while `read_journal` returns it when
 *  `kinds` is omitted and refuses it as unknown when `kinds` names it — a filter that hides a row
 *  the unfiltered read shows. Adding a member without adding it here is now a compile error. */
export type JournalKindsAreExhaustive = CoordinationEvent['type'] extends JournalEventKind
  ? true
  : ['a CoordinationEvent kind is missing from journalEventKinds', CoordinationEvent['type']]

/** The assertion itself. Exported so it cannot be pruned as unused, and typed so an uncovered kind
 *  fails to compile HERE, naming the missing member, rather than at some later call site. */
export const journalKindsAreExhaustive: JournalKindsAreExhaustive = true

/** One journal row: its position, the bus stamp, and the REDACTED event.
 *
 *  `row` is the CURSOR, not `seq`. A bus `seq` restarts at 0 in every process of a durable run, so
 *  a seq cursor silently re-reads after a restart; `row` counts from the first record of the run,
 *  across processes. `seq` stays on the row as the in-process ordering stamp the audit trail uses.
 *
 *  `event` is a bare `{ type }` with `oversize` set when the record alone exceeded the read's byte
 *  budget — the row still carries its position, so a caller paging by `nextRow` advances past it. */
export interface JournalEntry {
  readonly row: number
  readonly seq: number
  readonly at: number
  readonly priority: number
  /** True for a row written by a PRIOR process of this durable run, replayed from the coordination
   *  log rather than from the live bus. */
  readonly prior?: true
  readonly event: unknown
  /** Present only on a record too large for the byte budget: what was skipped, and how big it is. */
  readonly oversize?: { readonly type: string; readonly bytes: number }
}

/** What `read_journal` returns: the page, the cursor to resume from, and the exact bounds that
 *  produced it. `remaining` counts matching records this page did not reach, so a caller knows
 *  whether to page again without guessing. */
export interface JournalPage {
  readonly entries: ReadonlyArray<JournalEntry>
  /** Pass as the next call's `sinceRow`. Equals `sinceRow` when the page is empty. */
  readonly nextRow: number
  readonly remaining: number
  /** True when a bound applied — the row limit, the byte budget, or a row elided as oversize. False
   *  ONLY when this page carried every remaining matching row in full. */
  readonly truncated: boolean
  readonly bounds: {
    readonly sinceRow: number
    readonly limit: number
    readonly maxBytes: number
    /** Bytes the returned rows occupy, measured on the ASSEMBLED rows (stamp included), which is
     *  what the caller receives. It stays within `maxBytes` in every case but one: a page whose
     *  FIRST row is oversize emits the marker anyway, because returning nothing would leave the
     *  cursor unable to advance past that record forever. */
    readonly usedBytes: number
  }
  /** How many rows of this journal were written by PRIOR processes of the run. 0 for a fresh run. */
  readonly priorRows: number
}

/** The reserved coordination verb names — the complete set `createCoordinationTools` can emit
 *  (the analyst pair is conditional but still reserved). A driver's extra WORK tools must not
 *  collide with any of these, or it could no longer coordinate; callers validate eagerly against
 *  this set so the conflict fails loud at construction, not buried in a swallowed `act()` throw.
 *
 *  Every name here must also stay clear of the tools a coding harness publishes NATIVELY
 *  (`harnessNativeToolNames`, `mcp/harness-native-tools`). A harness prefixes an MCP tool with its
 *  server name, so the two never collide on the wire — but a driver reads a BARE word out of a
 *  prompt, and a bare word that the harness also publishes resolves to the harness's own tool.
 *  The spawn verb is `spawn_worker` for that reason: the runtime's vocabulary for the spawned
 *  thing is a worker (`workerId`, `workerSlots`, the per-worker budget), and no known harness
 *  publishes that name. `tests/kernel/harness-native-tools.test.ts` holds the set clear. */
export const coordinationVerbNames = [
  'spawn_worker',
  'cancel_worker',
  'observe_agent',
  'steer_agent',
  'list_questions',
  'answer_question',
  'ask_parent',
  'submit_result',
  'stop',
  'report_blocked',
  'read_continuation',
  'read_journal',
  'list_analysts',
  'run_analyst',
  'define_analyst',
  'run_graph',
] as const

/**
 * The `CoordinationEvent` kinds that wake a waiting manager. The queue carries the UP-leg only:
 * `steer` / `answer` / `instruction` / `delivery-attempt` are recorded `queue: false` (history and
 * subscribers, never delivered back), and `mail` is delivered to its addressee's inbox. A
 * `question` on this bus is the manager's own `ask_parent`, already escalated: it never wakes the
 * asker, whose answer arrives as a `lead-message`.
 */
export const wakeEventKinds = [
  'settled',
  'finding',
  'tool-outcome',
  'lead-message',
  'map',
] as const satisfies ReadonlyArray<CoordinationEvent['type']>

export interface Delivery {
  readonly record: BusRecord<CoordinationEvent>
  readonly attempt: number | undefined
  acknowledged: boolean
}
