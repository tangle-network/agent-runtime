import { J as RootStreamReceipt, j as NodeId, lt as SupervisedResult, y as ExecutorProgressEvent } from "./types-D56jQad-.js";
import { $s as SettledPursuitVersion, Cc as ObserverRecordKind, Dc as FORK_PARENT_UNCERTAIN_NODES_KEY, Ec as verifyObserverRecords, Gs as PreparedPursuitVersion, Hs as NextPursuitVersion, Js as PursuitVersionStopReason, Ks as PursuitVersionParent, Oc as PursuitFork, Qs as RunPursuitVersion, Sc as ObserverRecord, Tc as observerRecordDigest, Us as NextPursuitVersionInput, Vs as JudgedPursuitVersion, Ws as PURSUIT_VERSIONS_FILE, Xs as PursuitVersionsRecord, Ys as PursuitVersions, Zs as REVIEW_DIR, _c as PursuitRunTotals, ac as SupervisePursuitOptions, bc as FileObserverJournal, cc as PursuitCostProvenance, dc as PursuitNodePlatform, ec as VersionJudge, fc as PursuitNodeProjection, gc as PursuitRunProjection, hc as PursuitProjection, ic as SupervisePursuitError, kc as RUN_FORK_CORRELATION_KEYS, lc as PursuitNodeCost, mc as PursuitNodeUsage, nc as assertPursuitVersions, oc as SupervisedPursuitResult, pc as PursuitNodeTiming, qs as PursuitVersionStop, rc as pursuitVersionRun, sc as supervisePursuit, tc as VersionVerdict, uc as PursuitNodePlacement, vc as PursuitStatus, wc as createFileObserverHooks, xc as ObserverJournal, yc as projectPursuit } from "./index-Dm8SHDGW.js";
//#region src/runtime/supervise/root-stream.d.ts
/** The root stream: one JSONL line per progress event the root's executor observed. */
declare const ROOT_STREAM_FILE = "root-stream.jsonl";
/** One line of `root-stream.jsonl`. */
type RootStreamRecord = {
  /** 1-based position in the file, continuing across drive attempts and across processes. */
  readonly seq: number;
  /** ISO instant the line was appended, from the run's own clock. */
  readonly at: string;
  /** The 1-based drive attempt of the root that produced it: a driver retry or re-prompt
   *  re-enters the harness and continues the same file with the next attempt number. */
  readonly attempt: number;
} & ({
  readonly event: ExecutorProgressEvent;
} | {
  /** The event could not be written as JSON; its kind and the reason stand in so the gap
   *  is recorded in the file itself instead of silently narrowing the stream. */
  readonly dropped: {
    readonly kind: ExecutorProgressEvent['kind'];
    readonly reason: string;
  };
});
/**
 * The receipt for the root stream a run directory holds, recomputed from the file's bytes, or
 * `undefined` when the directory holds none. This is what a run that never settled — a root that
 * died mid-turn — gets on its failure record, and it equals what `close()` returned for a run
 * that did.
 */
declare function readRootStreamReceipt(runDir: string): Promise<RootStreamReceipt | undefined>;
/** Every committed line of the root stream, in order, or `undefined` when there is no file. A
 *  torn final line from a process that died mid-write is not a record and is left out. */
declare function readRootStream(runDir: string): Promise<RootStreamRecord[] | undefined>;
//#endregion
//#region src/durable/chat-engine.d.ts
/**
 * `handleChatTurn` is a framework-neutral chat-turn HTTP orchestrator.
 * Owns the NDJSON `ChatStreamEvent` line protocol, the `session.run.*`
 * lifecycle vocabulary, and the persist / post-process / trace-flush
 * hook order. Returns a `ReadableStream` body the product hands to its
 * platform `Response`.
 *
 * Sandbox owns long-running execution, reconnect, and replay.
 * The producer this engine wraps already speaks that protocol; this
 * engine frames the events and orders product callbacks.
 *
 * Hooks (`ChatTurnHooks`):
 *   - `produce`: build the backend event stream
 *   - `persistAssistantMessage`: write the assistant turn to the product DB
 *   - `onTurnComplete?`: post-process proposals, citations, and similar work
 *   - `onEvent?`: send each event to another consumer
 *   - `transformFinalText?`: transform text before persistence
 *   - `traceFlush?`: let `waitUntil` keep the worker alive for export
 *
 * Framework neutrality: takes already-resolved values (`identity` tuple,
 * a `waitUntil`), never a `Request` or a `Context`. The product's thin
 * route adapter does auth + parse + access-control, then calls
 * `handleChatTurn(...)` and returns `result.body` as its platform `Response`.
 */
/** The NDJSON line protocol every product chat client already speaks. */
interface ChatStreamEvent {
  type: string;
  data?: Record<string, unknown>;
}
/** Identity of a chat turn. `tenantId` is the workspace id for workspace-
 *  scoped products and the user id for session-scoped products. */
interface ChatTurnIdentity {
  tenantId: string;
  /** Thread / session id. */
  sessionId: string;
  userId: string;
  /** Monotonic 0-based turn index within the session. */
  turnIndex: number;
}
/** The live side of a turn returned by the product's `produce` hook. */
interface ChatTurnProducer<TEvent extends ChatStreamEvent = ChatStreamEvent> {
  /** The turn's events. The engine emits completion after persistence. */
  stream: AsyncGenerator<TEvent, void, unknown>;
  /** The turn's final assistant text. Read once, after `stream` drains. */
  finalText(): string;
}
/** Product callbacks invoked while one chat turn runs. */
interface ChatTurnHooks {
  /** Build the backend stream. The engine forwards nonterminal events and
   *  reads `finalText()` once the stream drains. Reported errors fail the turn. */
  produce(): ChatTurnProducer;
  /** Persist the assistant message to the product's own store. Called
   *  once, after drain, with the assembled (transform-applied) text. */
  persistAssistantMessage(input: {
    identity: ChatTurnIdentity;
    finalText: string;
  }): Promise<void>;
  /** Optional post-processing for proposals, citations, or credit metering.
   *  Errors are logged without failing a turn that already streamed. */
  onTurnComplete?(input: {
    identity: ChatTurnIdentity;
    finalText: string;
  }): Promise<void>;
  /** Optional per-event side channel, such as a Durable Object broadcast.
   *  Runs for every emitted event, including the lifecycle envelope.
   *  Errors are logged without breaking the chat stream. */
  onEvent?(event: ChatStreamEvent): void | Promise<void>;
  /** Optional pre-persist transform of the final text (e.g. PII
   *  redaction). Affects only what is persisted; the live stream is
   *  never altered. */
  transformFinalText?(text: string): string | Promise<string>;
  /** Optional trace flush. Handed to `waitUntil` so the worker stays alive
   *  until export completes. */
  traceFlush?(): Promise<void>;
}
/** Inputs for one streamed product chat turn. */
interface RunChatTurnInput {
  identity: ChatTurnIdentity;
  hooks: ChatTurnHooks;
  /** Worker liveness hook. When omitted, trace flush is awaited inline
   *  before the stream closes. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Structured logger for swallowed hook errors. Defaults to
   *  `console.error` so failures surface without product wiring. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}
/** HTTP response values returned for one chat turn. */
interface ChatTurnResult {
  /** NDJSON body to return as the platform `Response` body. */
  body: ReadableStream<Uint8Array>;
  /** Content type for the response. */
  contentType: 'application/x-ndjson';
}
/**
 * Run one chat turn. Returns immediately with a `ReadableStream` body;
 * execution starts while the stream is constructed. Backend
 * failures surface as `error` + `session.run.failed` events.
 */
declare function handleChatTurn(input: RunChatTurnInput): ChatTurnResult;
//#endregion
//#region src/durable/execution-handle.d.ts
/**
 * Derive a stable execution id from the run identity.
 * The same `(projectId, sessionId, turnIndex)` tuple yields the same id.
 *
 * Use the result as both `PromptOptions.executionId` and
 * `PromptOptions.turnId` on the first dispatch.
 * The execution id addresses the server-side execution for reconnect and
 * replay; the turn id makes a repeated dispatch idempotent.
 * An execution id alone does not make a repeated POST idempotent.
 *
 * Format is readable, not hashed: operators grepping orchestrator logs
 * for `gtm-agent:thread-abc:3` find the run without translating an
 * opaque id. Components are URL-encoded so delimiters inside caller ids
 * cannot collapse distinct tuples. The final id is limited to the
 * orchestrator replay route's 256-byte maximum. Execution ids are not a
 * secrecy boundary.
 *
 * Wire integration:
 *   - Initial dispatch: pass the result as `executionId` and `turnId`.
 *   - Stream replay: pass it as `executionId` with `lastEventId`.
 *
 * @throws `TypeError` when either string id is blank.
 * @throws `RangeError` when `turnIndex` is invalid or the result exceeds 256 bytes.
 */
declare function deriveExecutionId(input: {
  projectId: string;
  sessionId: string;
  turnIndex: number;
}): string;
//#endregion
//#region src/durable/run-lock.d.ts
/** The lock file `supervisePursuit` holds inside a run directory for the life of one call. */
declare const RUN_DIRECTORY_LOCK_FILE = "supervise.lock";
/** What the lock file records about its holder. */
interface RunDirectoryLockHolder {
  readonly pid: number;
  /** ISO instant the holder took the lock. */
  readonly startedAt: string;
  readonly runId: string;
  /**
   * The OS's start token for `pid` when the host reports one (`readProcessStart`). A holder
   * without one is judged by pid liveness alone, which cannot detect a reused pid.
   */
  readonly processStart?: string;
}
/** A held lock. `release()` removes the file; it is safe to call more than once. */
interface RunDirectoryLock extends RunDirectoryLockHolder {
  readonly path: string;
  release(): Promise<void>;
}
/** The directory is held by a live process. `holder` is what that process recorded. */
declare class RunDirectoryLockedError extends Error {
  readonly path: string;
  readonly holder: RunDirectoryLockHolder;
  constructor(path: string, holder: RunDirectoryLockHolder);
}
/**
 * Take `runDir/supervise.lock`, or refuse.
 *
 * The file is published with its full content or not at all, so a contender never reads a
 * half-written holder. A lock whose holder is gone (its pid no longer exists, or the pid now
 * belongs to a process with a different start token) is stale and is removed under the mutation guard;
 * a pid this process may not signal (`EPERM`) is alive and refuses. An empty file names no
 * holder and is reclaimed. A file with unreadable content is left in place and refused:
 * reclaiming it could evict a live holder written by something other than this module.
 */
declare function acquireRunDirectoryLock(runDir: string, runId: string, now?: () => number): Promise<RunDirectoryLock>;
/** Read the holder a lock file names, or `undefined` when no lock file names one. */
declare function readRunDirectoryLock(runDir: string): Promise<RunDirectoryLockHolder | undefined>;
/** What {@link runDirectoryHolderIsLive} proved about a run directory's recorded holder. */
interface RunDirectoryHolderLiveness {
  /** True only while the process that took the lock is still the process that holds the pid. */
  readonly live: boolean;
  /** The holder the lock file names. Absent when no lock file names one, which reads as not live. */
  readonly holder?: RunDirectoryLockHolder;
}
/**
 * Whether a run directory is still held by the live process that took its lock.
 *
 * The same rule `acquireRunDirectoryLock` applies to decide whether a lock is stale, exposed so a
 * caller — a supervisor picking up an abandoned directory, an operator tool listing runs — asks
 * the question instead of hand-rolling `process.kill(pid, 0)`. A bare signal probe cannot tell a
 * live holder from an unrelated process that later took the same pid, which is the failure this
 * lock's start token exists to prevent.
 *
 * The answer is ADVISORY: it is read outside the mutation guard `acquireRunDirectoryLock` holds,
 * so a `false` can be stale by the time the caller acts on it and a concurrent acquire can take
 * the directory in between. Reporting and listing are what this is for. A caller that intends to
 * TAKE the directory calls `acquireRunDirectoryLock`, which evaluates the same rule under the
 * guard and refuses atomically.
 */
declare function runDirectoryHolderIsLive(runDir: string): Promise<RunDirectoryHolderLiveness>;
//#endregion
//#region src/durable/settle-record.d.ts
/** The settle record: the returned `SupervisedResult` as canonical JSON, written once. */
declare const SETTLE_RECORD_FILE = "result.json";
/** The failure record: the most recent throw, replaced by a later throw. */
declare const FAILURE_RECORD_FILE = "failure.json";
/** What `failure.json` records about the most recent throw. */
interface DurableFailureRecord {
  readonly runId: string;
  readonly pursuitId: string;
  /** ISO instant the throw was recorded. */
  readonly at: string;
  readonly error: {
    readonly name: string;
    readonly message: string;
  };
  /** The root's retained provider stream at the time of the throw, when the directory holds one:
   *  a root that died mid-turn keeps what it had streamed, and this names it. */
  readonly rootStream?: RootStreamReceipt;
}
/** The directory already holds a settle record, so the run it records must not be re-entered. */
declare class SettledRunDirectoryError extends Error {
  readonly path: string;
  /** The root of the recorded run, which is its `runId`. */
  readonly recordedRunId: string;
  constructor(path: string, recordedRunId: string, requestedRunId: string);
}
/**
 * The exact bytes `result.json` holds for a result: its JSON value serialized as RFC 8785
 * canonical JSON. Throws `UnrecordableSettleValueError` before any byte is written when the
 * result carries a value JSON would misstate.
 */
declare function settleRecordJson(result: unknown): string;
/**
 * Read the settle record a run directory holds, or `undefined` when it holds none. A file that
 * is present but is not a settle record is corruption and fails loud.
 */
declare function readSettleRecord(runDir: string): Promise<SupervisedResult<unknown> | undefined>;
/** Read the most recent failure record, or `undefined` when the directory holds none. */
declare function readFailureRecord(runDir: string): Promise<DurableFailureRecord | undefined>;
//#endregion
//#region src/durable/supervision-discovery.d.ts
interface DurableCoordinationStreamIdentity {
  readonly runId: string;
  /** Exact owner ids present in the side-log, sorted for deterministic display. */
  readonly ownerIds: readonly string[];
  /** Records written before owner-scoped coordination identities were introduced. */
  readonly unscopedRecords: number;
  readonly recordCount: number;
}
/**
 * Identities discoverable from one `supervise({ runDir })` directory without
 * already knowing the root node or coordination run id stored inside it.
 */
interface DurableSupervisionDiscovery {
  readonly runDir: string;
  readonly spawnJournalPath: string;
  readonly coordinationLogPath: string;
  readonly roots: readonly NodeId[];
  /** `at` from each top-level root's `begin` record, index-aligned with `roots`. */
  readonly rootsBegunAt: readonly (string | null)[];
  readonly coordinationStreams: readonly DurableCoordinationStreamIdentity[];
}
/**
 * Discover the stable identities recorded by Runtime's durable supervision
 * files. This is the developer-facing first step before calling
 * `FileSpawnJournal.loadTree(root)`, `loadSpawnForest(journal, root)`, or
 * `FileCoordinationLog.load(runId, ownerId)`.
 *
 * Missing files produce empty collections. A malformed committed JSONL record
 * still fails loud through the same parser used by the runtime; a torn final
 * append is ignored because it was never acknowledged as committed.
 */
declare function discoverDurableSupervisionRun(runDir: string): Promise<DurableSupervisionDiscovery>;
//#endregion
export { type ChatStreamEvent, type ChatTurnHooks, type ChatTurnIdentity, type ChatTurnProducer, type ChatTurnResult, type DurableCoordinationStreamIdentity, type DurableFailureRecord, type DurableSupervisionDiscovery, FAILURE_RECORD_FILE, FORK_PARENT_UNCERTAIN_NODES_KEY, FileObserverJournal, type JudgedPursuitVersion, type NextPursuitVersion, type NextPursuitVersionInput, type ObserverJournal, type ObserverRecord, type ObserverRecordKind, PURSUIT_VERSIONS_FILE, type PreparedPursuitVersion, type PursuitCostProvenance, type PursuitFork, type PursuitNodeCost, type PursuitNodePlacement, type PursuitNodePlatform, type PursuitNodeProjection, type PursuitNodeTiming, type PursuitNodeUsage, type PursuitProjection, type PursuitRunProjection, type PursuitRunTotals, type PursuitStatus, type PursuitVersionParent, type PursuitVersionStop, type PursuitVersionStopReason, type PursuitVersions, type PursuitVersionsRecord, REVIEW_DIR, ROOT_STREAM_FILE, RUN_DIRECTORY_LOCK_FILE, RUN_FORK_CORRELATION_KEYS, type RootStreamReceipt, type RootStreamRecord, type RunChatTurnInput, type RunDirectoryHolderLiveness, type RunDirectoryLock, type RunDirectoryLockHolder, RunDirectoryLockedError, type RunPursuitVersion, SETTLE_RECORD_FILE, type SettledPursuitVersion, SettledRunDirectoryError, SupervisePursuitError, type SupervisePursuitOptions, type SupervisedPursuitResult, type VersionJudge, type VersionVerdict, acquireRunDirectoryLock, assertPursuitVersions, createFileObserverHooks, deriveExecutionId, discoverDurableSupervisionRun, handleChatTurn, observerRecordDigest, projectPursuit, pursuitVersionRun, readFailureRecord, readRootStream, readRootStreamReceipt, readRunDirectoryLock, readSettleRecord, runDirectoryHolderIsLive, settleRecordJson, supervisePursuit, verifyObserverRecords };
//# sourceMappingURL=durable.d.ts.map