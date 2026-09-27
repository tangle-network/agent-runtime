import { Lr as buildLoopSpanNodes } from "./supervisor-DtlPj9me.js";
import { m as ValidationError, t as AgentEvalError } from "./errors-DodWX-cb.js";
import { r as createStdioToolServer } from "./tool-server-Dqer2M4_.js";
import { n as delegate } from "./delegate-CZc7B-Tl.js";
import { _ as InMemoryFeedbackStore, c as DELEGATION_HISTORY_TOOL_NAME, f as DELEGATE_FEEDBACK_DESCRIPTION, h as createDelegateFeedbackHandler, i as createDelegationStatusHandler, l as createDelegationHistoryHandler, m as DELEGATE_FEEDBACK_TOOL_NAME, n as DELEGATION_STATUS_INPUT_SCHEMA, o as DELEGATION_HISTORY_DESCRIPTION, p as DELEGATE_FEEDBACK_INPUT_SCHEMA, r as DELEGATION_STATUS_TOOL_NAME, s as DELEGATION_HISTORY_INPUT_SCHEMA, t as DELEGATION_STATUS_DESCRIPTION } from "./delegation-status-CF4D0NZ_.js";
import { n as UI_LENSES } from "./substrate-B0TYNrXn.js";
import path, { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
//#region src/mcp/delegation-trace.ts
/**
*
* Compact loop-trace tee for the delegation journal.
*
* The OTEL exporter ({@link createPropagatingTraceEmitter}) is a no-op
* without `OTEL_EXPORTER_OTLP_ENDPOINT`, which leaves delegated work streams
* dark in practice. This module derives the same loop → round → branch span
* tree (via the shared {@link buildLoopSpanNodes} builder) into a small,
* JSON-safe shape persisted directly on the `DelegationRecord` — observable
* through `delegation_status` with no collector infrastructure. Both sinks
* coexist: the OTEL export path is unchanged.
*
* Payload discipline: a record's trace is hard-capped (spans + serialized
* bytes). Past the cap the OLDEST spans are dropped and the record carries a
* `traceTruncated: true` marker — truncation is never silent.
*
* @experimental
*/
/** Default cap on spans retained per delegation record. @experimental */
const DELEGATION_TRACE_MAX_SPANS = 512;
/** Default cap on the serialized trace payload per record, in bytes. @experimental */
const DELEGATION_TRACE_MAX_BYTES = 256 * 1024;
/**
* Derive the compact span tree for ONE loop run from its buffered
* `LoopTraceEvent` stream. Same reconstruction as the OTEL exporter
* ({@link buildLoopSpanNodes}); tolerates partial streams.
*
* @experimental
*/
function buildDelegationTraceSpans(events) {
	return buildLoopSpanNodes(events).map((node) => ({
		spanId: node.spanId,
		...node.parentSpanId !== void 0 ? { parentSpanId: node.parentSpanId } : {},
		name: node.name,
		kind: node.kind,
		startMs: node.startMs,
		endMs: node.endMs,
		...Object.keys(node.attrs).length > 0 ? { meta: node.attrs } : {}
	}));
}
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
function capDelegationTrace(spans, caps) {
	const maxSpans = caps?.maxSpans ?? 512;
	const maxBytes = caps?.maxBytes ?? 262144;
	let start = Math.max(0, spans.length - maxSpans);
	const sizes = spans.map((span) => JSON.stringify(span).length + 1);
	let total = 0;
	for (let i = start; i < sizes.length; i += 1) total += sizes[i];
	while (start < spans.length - 1 && total > maxBytes) {
		total -= sizes[start];
		start += 1;
	}
	return {
		trace: spans.slice(start),
		truncated: start > 0
	};
}
/** Build a `DelegationTraceCollector` that buffers loop-trace events and converts them to spans on settle. @experimental */
function createDelegationTraceCollector(onSpans) {
	const buffers = /* @__PURE__ */ new Map();
	const flush = (events) => {
		const spans = buildDelegationTraceSpans(events);
		if (spans.length > 0) onSpans(spans);
	};
	return {
		emitter: { emit(event) {
			const buf = buffers.get(event.runId);
			if (buf) buf.push(event);
			else buffers.set(event.runId, [event]);
			if (event.kind === "loop.ended") {
				const events = buffers.get(event.runId) ?? [event];
				buffers.delete(event.runId);
				flush(events);
			}
		} },
		settle() {
			for (const events of buffers.values()) flush(events);
			buffers.clear();
		}
	};
}
/**
* 16-hex-char span id for journal spans synthesized outside the shared loop
* builder (e.g. the queue's detached-resume segment).
*
* @experimental
*/
function generateDelegationSpanId() {
	const bytes = /* @__PURE__ */ new Uint8Array(8);
	if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
	else for (let i = 0; i < 8; i += 1) bytes[i] = Math.floor(Math.random() * 256);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Fan one `LoopTraceEvent` stream into several emitters — e.g. the
* process-wide OTEL exporter AND the per-delegation journal collector.
* `undefined` entries are skipped; returns `undefined` when nothing is left
* so callers keep the kernel's "no emitter, no events" fast path.
*
* @experimental
*/
function composeLoopTraceEmitters(...emitters) {
	const live = emitters.filter((e) => e !== void 0);
	if (live.length === 0) return void 0;
	if (live.length === 1) return live[0];
	return { emit(event) {
		const pending = [];
		for (const emitter of live) {
			const result = emitter.emit(event);
			if (result) pending.push(result);
		}
		if (pending.length > 0) return Promise.all(pending).then(() => void 0);
	} };
}
//#endregion
//#region src/mcp/delegation-store.ts
/**
*
* Persistence port for the MCP delegation queue.
*
* `DelegationTaskQueue` keeps its working set in memory (status/history
* reads stay synchronous) and journals every record mutation through a
* `DelegationStore`. `DelegationTaskQueue.restore({ store })` is the load
* path: it reads the full record set once at construction and rehydrates
* the queue from it. After that the store only sees writes.
*
* Records MUST be JSON-safe — `FileDelegationStore` round-trips them
* through `JSON.stringify`/`JSON.parse`, so a `Date`, `Map`, or function
* smuggled into `args`/`result` would corrupt the journal.
*
* @stable
*/
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
var DelegationStateCorruptError = class extends AgentEvalError {
	constructor(message, options) {
		super("validation", message, options);
	}
};
/**
* A delegation-store read or write failed (filesystem error, store
* called before `loadAll`, ...). Once the queue observes one, it stops
* accepting new submissions — accepting work it cannot journal would
* silently demote durable mode to in-memory mode.
*
* @stable
*/
var DelegationPersistenceError = class extends AgentEvalError {
	constructor(message, options) {
		super("config", message, options);
	}
};
/** In-memory `DelegationStore` — suitable for single-process use and tests. @stable */
var InMemoryDelegationStore = class {
	records = /* @__PURE__ */ new Map();
	async loadAll() {
		return [...this.records.values()].map(cloneRecord);
	}
	async upsert(record) {
		this.records.set(record.taskId, cloneRecord(record));
	}
	async lookupIdempotencyKey(key) {
		for (const record of this.records.values()) if (record.idempotencyKey === key) return record.taskId;
	}
	async remove(taskIds) {
		for (const taskId of taskIds) this.records.delete(taskId);
	}
};
const STATE_FORMAT_VERSION = 1;
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
var FileDelegationStore = class {
	filePath;
	recoverCorrupt;
	records = /* @__PURE__ */ new Map();
	loaded = false;
	writeTail = Promise.resolve();
	tmpSeq = 0;
	constructor(options) {
		this.filePath = options.filePath;
		this.recoverCorrupt = options.recoverCorrupt ?? false;
	}
	async loadAll() {
		let raw;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch (err) {
			if (err.code === "ENOENT") {
				this.loaded = true;
				return [];
			}
			throw new DelegationPersistenceError(`FileDelegationStore: failed to read ${this.filePath}: ${errorMessage(err)}`, { cause: err });
		}
		let state;
		try {
			state = parsePersistedState(raw);
		} catch (err) {
			if (!this.recoverCorrupt) throw new DelegationStateCorruptError(`FileDelegationStore: state file ${this.filePath} is corrupt (${errorMessage(err)}). Repair or archive the file, or opt into automatic recovery (recoverCorrupt / AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1) to archive it and start empty.`, { cause: err });
			const archivePath = `${this.filePath}.corrupt-${Date.now()}`;
			await rename(this.filePath, archivePath);
			this.loaded = true;
			return [];
		}
		this.records.clear();
		for (const record of state.records) this.records.set(record.taskId, record);
		this.loaded = true;
		return [...this.records.values()].map(cloneRecord);
	}
	async upsert(record) {
		this.assertLoaded("upsert");
		this.records.set(record.taskId, cloneRecord(record));
		await this.enqueueWrite();
	}
	async lookupIdempotencyKey(key) {
		this.assertLoaded("lookupIdempotencyKey");
		for (const record of this.records.values()) if (record.idempotencyKey === key) return record.taskId;
	}
	async remove(taskIds) {
		this.assertLoaded("remove");
		let changed = false;
		for (const taskId of taskIds) if (this.records.delete(taskId)) changed = true;
		if (changed) await this.enqueueWrite();
	}
	assertLoaded(op) {
		if (this.loaded) return;
		throw new DelegationPersistenceError(`FileDelegationStore: ${op} called before loadAll() — the on-disk state has not been read yet`);
	}
	enqueueWrite() {
		const write = this.writeTail.then(() => this.writeSnapshot());
		this.writeTail = write.catch(() => {});
		return write;
	}
	async writeSnapshot() {
		const state = {
			version: STATE_FORMAT_VERSION,
			records: [...this.records.values()]
		};
		const payload = `${JSON.stringify(state)}\n`;
		this.tmpSeq += 1;
		const tmpPath = `${this.filePath}.tmp-${process.pid}-${this.tmpSeq}`;
		try {
			await mkdir(dirname(this.filePath), { recursive: true });
			await writeFile(tmpPath, payload, "utf8");
			await rename(tmpPath, this.filePath);
		} catch (err) {
			throw new DelegationPersistenceError(`FileDelegationStore: failed to write ${this.filePath}: ${errorMessage(err)}`, { cause: err });
		}
	}
};
function parsePersistedState(raw) {
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("top-level value is not an object");
	const state = parsed;
	if (state.version !== STATE_FORMAT_VERSION) throw new Error(`unsupported state version ${JSON.stringify(state.version)}`);
	if (!Array.isArray(state.records)) throw new Error("`records` is not an array");
	for (const record of state.records) {
		if (record === null || typeof record !== "object") throw new Error("a record entry is not an object");
		const candidate = record;
		if (typeof candidate.taskId !== "string" || typeof candidate.status !== "string") throw new Error("a record entry is missing `taskId`/`status`");
	}
	return {
		version: STATE_FORMAT_VERSION,
		records: state.records
	};
}
function cloneRecord(record) {
	return structuredClone(record);
}
function errorMessage(err) {
	return err instanceof Error ? err.message : String(err);
}
//#endregion
//#region src/mcp/task-queue.ts
/**
*
* State machine for async MCP delegations:
*
*   pending → running → completed | failed
*           ↘ cancelled (from any non-terminal state via cancel())
*
* Each `submit` returns a `taskId` immediately and kicks the work off in the
* background. The work function receives an `AbortSignal` the queue fires
* when `cancel(taskId)` is called. The queue does NOT supervise runtime
* timeouts — the underlying `runAgentRounds` driver / sandbox imposes those.
*
* Idempotency: callers may supply an `idempotencyKey` (hash of the input).
* A duplicate `submit` with a known key returns the existing task instead of
* starting a new one. Mutated input → different key → different task.
*
* Durability: the working set lives in memory (reads stay synchronous) and
* every record mutation is journaled through a `DelegationStore`. The default
* `InMemoryDelegationStore` keeps today's semantics — a process restart drops
* all state. Construct via `DelegationTaskQueue.restore({ store })` with a
* `FileDelegationStore` to reload prior records on startup: terminal records
* stay queryable, in-flight records either re-attach through the
* `resumeDelegate` seam (when they carry a `detachedSessionRef`) or fail
* loud with a driver-restart error so `delegation_status` tells the truth.
*
* @stable
*/
/** In-process queue for async delegation tasks — submit, cancel, poll status, and read history. @stable */
var DelegationTaskQueue = class DelegationTaskQueue {
	records = /* @__PURE__ */ new Map();
	controllers = /* @__PURE__ */ new Map();
	byIdempotencyKey = /* @__PURE__ */ new Map();
	generateId;
	now;
	store;
	resumeDelegate;
	maxTerminalRecords;
	onPersistError;
	traceContext;
	persistTail = Promise.resolve();
	persistFailure;
	constructor(options = {}) {
		this.generateId = options.generateId ?? randomTaskId;
		this.now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
		this.store = options.store ?? new InMemoryDelegationStore();
		this.resumeDelegate = options.resumeDelegate;
		if (options.maxTerminalRecords !== void 0) {
			if (!Number.isInteger(options.maxTerminalRecords) || options.maxTerminalRecords < 1) throw new ValidationError(`DelegationTaskQueue: maxTerminalRecords must be a positive integer, got ${String(options.maxTerminalRecords)}`);
		}
		this.maxTerminalRecords = options.maxTerminalRecords ?? Number.POSITIVE_INFINITY;
		this.traceContext = options.traceContext;
		this.onPersistError = options.onPersistError ?? ((error) => {
			queueMicrotask(() => {
				throw error;
			});
		});
	}
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
	static async restore(options = {}) {
		const queue = new DelegationTaskQueue(options);
		const loaded = await queue.store.loadAll();
		await queue.rehydrate(loaded);
		return queue;
	}
	/**
	* Kick off a delegation in the background. Returns immediately. The
	* `taskId` is queryable via `status` once this method returns. Throws
	* the recorded `DelegationPersistenceError` once the store has failed —
	* the queue does not accept work it cannot journal.
	*/
	submit(input) {
		if (this.persistFailure) throw this.persistFailure;
		if (input.idempotencyKey) {
			const existing = this.byIdempotencyKey.get(input.idempotencyKey);
			if (existing && this.records.has(existing)) return {
				taskId: existing,
				reused: true
			};
		}
		const taskId = this.generateId();
		const controller = new AbortController();
		const record = {
			taskId,
			profile: input.profile,
			namespace: input.namespace,
			args: input.args,
			status: "pending",
			startedAt: this.now(),
			feedback: [],
			idempotencyKey: input.idempotencyKey,
			detachedSessionRef: input.detachedSessionRef,
			...this.traceContext !== void 0 ? {
				traceId: this.traceContext.traceId,
				...this.traceContext.parentSpanId !== void 0 ? { parentSpanId: this.traceContext.parentSpanId } : {}
			} : {}
		};
		this.records.set(taskId, record);
		this.controllers.set(taskId, controller);
		if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, taskId);
		this.persist(record);
		queueMicrotask(() => {
			this.execute(taskId, input, controller);
		});
		return {
			taskId,
			reused: false
		};
	}
	/**
	* Snapshot the current state of a delegation. Returns `undefined` for
	* unknown ids so callers can distinguish missing from terminal.
	* `includeTrace` attaches the journaled loop-trace span tree — off by
	* default so status polls stay light.
	*/
	status(taskId, opts) {
		const record = this.records.get(taskId);
		if (!record) return void 0;
		return toStatusResult(record, opts);
	}
	/**
	* Abort an in-flight delegation. Returns `false` if the task is unknown
	* or already terminal. The underlying `run` function MUST honor the
	* abort signal for the cancel to take effect; the queue marks the
	* record `cancelled` regardless so a misbehaving runner cannot pin the
	* UI on `running` forever.
	*/
	cancel(taskId) {
		const record = this.records.get(taskId);
		if (!record) return false;
		if (isTerminal(record.status)) return false;
		this.controllers.get(taskId)?.abort();
		record.status = "cancelled";
		record.completedAt = this.now();
		record.error = {
			message: "cancelled by caller",
			kind: "CancelledError"
		};
		this.persist(record);
		this.enforceRetention();
		return true;
	}
	/**
	* Append a feedback event to the matching delegation. Returns `false`
	* when `ref` does not name a known taskId — the caller should still
	* record the feedback through a different surface (artifact/outcome
	* kinds are not queue-bound).
	*/
	attachFeedback(taskId, snapshot) {
		const record = this.records.get(taskId);
		if (!record) return false;
		record.feedback.push(snapshot);
		this.persist(record);
		return true;
	}
	/**
	* Query the recorded delegations. Returns entries newest-first (by
	* `startedAt`), truncated to `limit`.
	*/
	history(args = {}) {
		const limit = clampLimit(args.limit);
		const since = args.since ? Date.parse(args.since) : Number.NEGATIVE_INFINITY;
		const out = [];
		for (const record of this.records.values()) {
			if (args.namespace && record.namespace !== args.namespace) continue;
			if (args.profile && record.profile !== args.profile) continue;
			if (Number.isFinite(since) && Date.parse(record.startedAt) < since) continue;
			out.push(toHistoryEntry(record));
		}
		out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		return out.slice(0, limit);
	}
	/**
	* Await every journal write issued so far. Rejects with the recorded
	* `DelegationPersistenceError` when any of them failed. Call before
	* handing the store's backing file to another process.
	*/
	async flush() {
		let tail;
		while (this.persistTail !== tail) {
			tail = this.persistTail;
			await tail;
		}
		if (this.persistFailure) throw this.persistFailure;
	}
	/** Test-only — number of in-flight (non-terminal) records. */
	inflightCount() {
		let n = 0;
		for (const record of this.records.values()) if (!isTerminal(record.status)) n += 1;
		return n;
	}
	async execute(taskId, input, controller) {
		const record = this.records.get(taskId);
		if (!record) return;
		record.status = "running";
		this.persist(record);
		const traceCollector = createDelegationTraceCollector((spans) => {
			if (isTerminal(currentStatus(record))) return;
			this.appendTrace(record, spans);
			this.persist(record);
		});
		try {
			const output = await input.run({
				signal: controller.signal,
				report: (progress) => {
					if (record.status === "running") {
						record.progress = progress;
						this.persist(record);
					}
				},
				traceEmitter: traceCollector.emitter,
				...record.detachedSessionRef !== void 0 ? { detachedSessionRef: record.detachedSessionRef } : {},
				updateDetachedSessionRef: (ref) => {
					if (typeof ref !== "string" || ref.length === 0) throw new ValidationError("DelegationTaskQueue: updateDetachedSessionRef requires a non-empty ref");
					if (isTerminal(currentStatus(record))) return;
					record.detachedSessionRef = ref;
					this.persist(record);
				}
			});
			traceCollector.settle();
			if (currentStatus(record) === "cancelled") return;
			record.status = "completed";
			record.completedAt = this.now();
			record.result = {
				profile: input.profile,
				output
			};
			this.persist(record);
			this.enforceRetention();
		} catch (err) {
			traceCollector.settle();
			if (currentStatus(record) === "cancelled") return;
			record.status = "failed";
			record.completedAt = this.now();
			record.error = errorToShape(err);
			this.persist(record);
			this.enforceRetention();
		} finally {
			this.controllers.delete(taskId);
		}
	}
	appendTrace(record, spans) {
		if (spans.length === 0) return;
		const { trace, truncated } = capDelegationTrace([...record.trace ?? [], ...spans]);
		record.trace = trace;
		if (truncated) record.traceTruncated = true;
	}
	async rehydrate(loaded) {
		const records = [...loaded].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
		for (const record of records) {
			this.records.set(record.taskId, record);
			if (record.idempotencyKey) this.byIdempotencyKey.set(record.idempotencyKey, record.taskId);
		}
		const restoreWrites = [];
		for (const record of this.records.values()) {
			if (isTerminal(record.status)) continue;
			if (record.detachedSessionRef && this.resumeDelegate) {
				record.status = "running";
				restoreWrites.push(this.persist(record));
				this.startResume(record, record.detachedSessionRef, this.resumeDelegate);
				continue;
			}
			record.status = "failed";
			record.completedAt = this.now();
			record.error = {
				message: record.detachedSessionRef ? `delegation driver restarted while the task was in flight; detached session "${record.detachedSessionRef}" needs a resumeDelegate to be resumed` : "delegation driver restarted while the task was in flight; the run was not detached and cannot be resumed",
				kind: "DriverRestartError"
			};
			restoreWrites.push(this.persist(record));
		}
		const retentionWrite = this.enforceRetention();
		if (retentionWrite) restoreWrites.push(retentionWrite);
		await Promise.all(restoreWrites);
		if (this.persistFailure) throw this.persistFailure;
	}
	startResume(record, detachedSessionRef, driver) {
		const controller = new AbortController();
		this.controllers.set(record.taskId, controller);
		this.driveResume(record, detachedSessionRef, driver, controller);
	}
	async driveResume(record, detachedSessionRef, driver, controller) {
		const intervalMs = driver.intervalMs ?? 5e3;
		const resumeStartMs = Date.parse(this.now());
		const ctx = {
			signal: controller.signal,
			report: (progress) => {
				if (currentStatus(record) !== "running") return;
				record.progress = progress;
				this.persist(record);
			}
		};
		try {
			while (!controller.signal.aborted && currentStatus(record) === "running") {
				const tick = await driver.tick({
					record: structuredClone(record),
					detachedSessionRef
				}, ctx);
				if (currentStatus(record) === "cancelled") return;
				if (tick.state === "completed") {
					this.appendResumeSpan(record, detachedSessionRef, resumeStartMs);
					record.status = "completed";
					record.completedAt = this.now();
					record.result = {
						profile: record.profile,
						output: tick.output
					};
					if (tick.costUsd !== void 0) record.costUsd = tick.costUsd;
					this.persist(record);
					this.enforceRetention();
					return;
				}
				if (tick.state === "failed") {
					this.appendResumeSpan(record, detachedSessionRef, resumeStartMs, tick.error.message);
					record.status = "failed";
					record.completedAt = this.now();
					record.error = tick.error;
					this.persist(record);
					this.enforceRetention();
					return;
				}
				await abortableDelay(intervalMs, controller.signal);
			}
		} catch (err) {
			if (currentStatus(record) === "cancelled") return;
			this.appendResumeSpan(record, detachedSessionRef, resumeStartMs, errorToShape(err).message);
			record.status = "failed";
			record.completedAt = this.now();
			record.error = errorToShape(err);
			this.persist(record);
			this.enforceRetention();
		} finally {
			this.controllers.delete(record.taskId);
		}
	}
	/**
	* Journal the resumed segment of a detached run as one compact span. The
	* resume driver re-attaches after a process restart, so the original
	* process's loop events are gone — this span records the post-restart
	* observation window (re-attach → terminal tick) under the
	* `'detached-resume'` driver tag, keeping restored delegations observable
	* in the journal alongside trace-carrying live runs.
	*/
	appendResumeSpan(record, detachedSessionRef, startMs, error) {
		this.appendTrace(record, [{
			spanId: generateDelegationSpanId(),
			name: "loop",
			kind: "loop",
			startMs,
			endMs: Date.parse(this.now()),
			meta: {
				"tangle.loop.driver": "detached-resume",
				"tangle.loop.detached_session_ref": detachedSessionRef,
				...error !== void 0 ? { "tangle.loop.error": error } : {}
			}
		}]);
	}
	persist(record) {
		if (this.persistFailure) return Promise.resolve();
		const snapshot = structuredClone(record);
		this.persistTail = this.persistTail.then(async () => {
			if (this.persistFailure) return;
			try {
				await this.store.upsert(snapshot);
			} catch (err) {
				this.failPersistence(err);
			}
		});
		return this.persistTail;
	}
	persistRemoval(taskIds) {
		if (this.persistFailure || taskIds.length === 0) return void 0;
		this.persistTail = this.persistTail.then(async () => {
			if (this.persistFailure) return;
			try {
				await this.store.remove(taskIds);
			} catch (err) {
				this.failPersistence(err);
			}
		});
		return this.persistTail;
	}
	failPersistence(cause) {
		if (this.persistFailure) return;
		const error = cause instanceof DelegationPersistenceError ? cause : new DelegationPersistenceError(`DelegationTaskQueue: store write failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
		this.persistFailure = error;
		this.onPersistError(error);
	}
	enforceRetention() {
		if (!Number.isFinite(this.maxTerminalRecords)) return void 0;
		const terminal = [];
		for (const record of this.records.values()) if (isTerminal(record.status)) terminal.push(record);
		const excess = terminal.length - this.maxTerminalRecords;
		if (excess <= 0) return void 0;
		terminal.sort((a, b) => (a.completedAt ?? a.startedAt).localeCompare(b.completedAt ?? b.startedAt));
		const evicted = terminal.slice(0, excess);
		for (const record of evicted) {
			this.records.delete(record.taskId);
			if (record.idempotencyKey && this.byIdempotencyKey.get(record.idempotencyKey) === record.taskId) this.byIdempotencyKey.delete(record.idempotencyKey);
		}
		return this.persistRemoval(evicted.map((record) => record.taskId));
	}
};
function isTerminal(status) {
	return status === "completed" || status === "failed" || status === "cancelled";
}
function currentStatus(record) {
	return record.status;
}
function clampLimit(raw) {
	if (!Number.isFinite(raw)) return 50;
	const n = Math.trunc(raw);
	if (n <= 0) return 50;
	return Math.min(n, 500);
}
function abortableDelay(ms, signal) {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
function toStatusResult(record, opts) {
	const out = {
		taskId: record.taskId,
		profile: record.profile,
		status: record.status,
		startedAt: record.startedAt
	};
	if (record.progress) out.progress = record.progress;
	if (record.result) out.result = record.result;
	if (record.error) out.error = record.error;
	if (record.costUsd !== void 0) out.costUsd = record.costUsd;
	if (record.completedAt) out.completedAt = record.completedAt;
	if (record.traceId !== void 0) out.traceId = record.traceId;
	if (record.parentSpanId !== void 0) out.parentSpanId = record.parentSpanId;
	if (opts?.includeTrace === true && record.trace && record.trace.length > 0) {
		out.trace = record.trace.map((span) => ({ ...span }));
		if (record.traceTruncated) out.traceTruncated = true;
	}
	return out;
}
function toHistoryEntry(record) {
	const entry = {
		taskId: record.taskId,
		profile: record.profile,
		args: record.args,
		status: record.status,
		startedAt: record.startedAt,
		hasTrace: record.trace !== void 0 && record.trace.length > 0
	};
	if (record.namespace) entry.namespace = record.namespace;
	if (record.completedAt) entry.completedAt = record.completedAt;
	if (record.costUsd !== void 0) entry.costUsd = record.costUsd;
	if (record.feedback.length > 0) entry.feedback = [...record.feedback];
	if (record.traceId !== void 0) entry.traceId = record.traceId;
	return entry;
}
function errorToShape(err) {
	if (err instanceof Error) return {
		message: err.message,
		kind: err.name || "Error"
	};
	return {
		message: String(err),
		kind: "NonError"
	};
}
function randomTaskId() {
	return `dlg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/**
* Best-effort stable hash for use as `idempotencyKey`. Not cryptographic;
* collisions only affect dedupe, never correctness.
*
* @stable
*/
function hashIdempotencyInput(value) {
	let str;
	try {
		str = JSON.stringify(canonicalize(value));
	} catch {
		str = String(value);
	}
	let h = 2166136261;
	for (let i = 0; i < str.length; i += 1) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}
function canonicalize(value) {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(canonicalize);
	const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a.localeCompare(b));
	const out = {};
	for (const [k, v] of entries) out[k] = canonicalize(v);
	return out;
}
//#endregion
//#region src/mcp/tools/delegate.ts
/** MCP tool name for the `delegate` generic-delegation tool. @stable */
const DELEGATE_TOOL_NAME = "delegate";
/** Human-readable description of the `delegate` MCP tool, injected into the tool manifest. @stable */
const DELEGATE_DESCRIPTION = [
	"Delegate an INTENT to a supervisor that AUTHORS and drives whatever worker the intent needs.",
	"",
	"Use when: you want a task done but do not want to specify HOW. State the outcome — \"fix the",
	"failing auth test\", \"research competitor pricing with citations\", \"refactor the parser for",
	"clarity\" — and the supervisor decomposes it, writes a tailored worker profile per sub-task, runs",
	"the workers over a conserved compute budget, and settles only when a deployable check passes.",
	"",
	"There is no fixed worker type: this ONE verb replaces separate code / research delegation. The",
	"supervisor picks the worker shape from your intent.",
	"",
	"Returns synchronously with the delivered result AND the real cost of the whole delegation",
	"(spentTotal: iterations, input/output tokens, usd, ms) — so you always know what it spent. A run",
	"that produced no delivered worker returns status \"no-winner\" with the reason; it never fabricates",
	"a success."
].join("\n");
/** JSON Schema for `delegate` tool arguments (`intent` + optional trace id). @stable */
const DELEGATE_INPUT_SCHEMA = {
	type: "object",
	properties: {
		intent: {
			type: "string",
			description: "What you want accomplished, as an outcome. The supervisor authors the worker."
		},
		runId: {
			type: "string",
			description: "Optional trace-correlation id for this delegation."
		}
	},
	required: ["intent"],
	additionalProperties: false
};
/** Parse and validate raw MCP tool input into typed `DelegateArgs`; throws `TypeError` on bad input. @stable */
function validateDelegateArgs(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegate: arguments must be an object");
	const value = raw;
	const unknown = Object.keys(value).filter((key) => key !== "intent" && key !== "runId");
	if (unknown.length > 0) throw new TypeError(`delegate: unknown arguments: ${unknown.join(", ")}`);
	const intent = value.intent;
	if (typeof intent !== "string" || intent.trim().length === 0) throw new TypeError("delegate: `intent` must be a non-empty string");
	const args = { intent: intent.trim() };
	if (value.runId !== void 0) {
		if (typeof value.runId !== "string") throw new TypeError("delegate: `runId` must be a string");
		args.runId = value.runId;
	}
	return args;
}
/** Project a `SupervisedResult` onto the tool's flat `DelegateResult`. Both variants carry the real
*  conserved `spentTotal`, so the agent always learns the cost — even on a no-winner, never a faked
*  output and never a fabricated zero spend. */
function toDelegateResult(result) {
	if (result.kind === "no-winner") {
		const rejection = result.error;
		const error = typeof rejection?.name === "string" && typeof rejection.message === "string" ? {
			name: rejection.name,
			message: rejection.message
		} : void 0;
		return {
			status: "no-winner",
			reason: result.reason,
			...error ? { error } : {},
			spentTotal: result.spentTotal
		};
	}
	return {
		status: "winner",
		out: result.out,
		outRef: result.outRef,
		spentTotal: result.spentTotal
	};
}
/**
* Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` /
* `backend` / `deliverable`); each call routes the agent's intent to `delegate()` and returns the
* delivered output with its conserved cost.
*/
function createDelegateHandler(options) {
	return async (raw) => {
		const args = validateDelegateArgs(raw);
		const opts = {
			backend: options.backend,
			router: options.router,
			supervisorProfile: options.supervisorProfile,
			...options.deliverable ? { deliverable: options.deliverable } : {},
			...options.allowedModels ? { allowedModels: options.allowedModels } : {},
			...args.runId ? { runId: args.runId } : {}
		};
		return toDelegateResult(await delegate(args.intent, opts));
	};
}
//#endregion
//#region src/mcp/tools/delegate-ui-audit.ts
/**
*
* `delegate_ui_audit` MCP tool — async kickoff for UI audit runs. Validates
* the input, computes an idempotency key over the canonical fields, hands
* the task to the queue, and returns a taskId. Identical inputs return
* the same taskId.
*
* The handler does not import the auditor profile directly — consumers
* inject a `UiAuditorDelegate` via `createMcpServer({ uiAuditorDelegate })`.
* The delegate is the seam where the consumer chooses the judge (vision
* model) and the `SandboxClient` (in-process Playwright vs fleet vs
* remote browser). agent-runtime ships the in-process client under
* `./profiles` so consumers who want the canonical setup can wire it
* with a few lines.
*
* @experimental
*/
/** MCP tool name for the `delegate_ui_audit` async kickoff tool. @experimental */
const DELEGATE_UI_AUDIT_TOOL_NAME = "delegate_ui_audit";
/** Human-readable description of the `delegate_ui_audit` MCP tool, injected into the tool manifest. @experimental */
const DELEGATE_UI_AUDIT_DESCRIPTION = [
	"Delegate a UI/UX audit to a vision-driven auditor that produces self-contained",
	"GitHub-issue-ready Markdown findings — one file per finding, with embedded",
	"screenshot evidence and a suggested fix.",
	"",
	"Use when: you want a thorough pass over a running web app for consistency,",
	"hierarchy, layout, ux-flow, duplication, accessibility, responsive, states,",
	"content, interaction, or perceived-performance issues. The auditor iterates",
	"lens-by-lens so each pass finds new classes of issues; the workspace registry",
	"deduplicates across iterations.",
	"",
	"Returns immediately with a taskId. Poll delegation_status to retrieve the",
	"workspace path + indexed findings (typically minutes per audited route).",
	"Identical inputs return the same taskId — safe to retry.",
	"",
	"Output layout under workspaceDir:",
	"  registry.json                       — finding index + capture sidecar",
	"  index.md                            — human-readable rollup",
	"  issues/NNN--<lens>--<slug>.md       — one self-contained GitHub-issue",
	"  screenshots/<route>--<viewport>.png — capture archive",
	"",
	"Multi-tenant isolation: every finding is scoped to `namespace` when set.",
	"Never pass another tenant's namespace."
].join("\n");
/** JSON Schema for `delegate_ui_audit` tool arguments (`workspaceDir`, `routes`, optional config). @experimental */
const DELEGATE_UI_AUDIT_INPUT_SCHEMA = {
	type: "object",
	properties: {
		workspaceDir: {
			type: "string",
			description: "Absolute path for the audit workspace."
		},
		routes: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: {
						type: "string",
						description: "Stable route name (used in screenshot filenames)."
					},
					url: {
						type: "string",
						description: "Fully-qualified URL."
					},
					viewports: {
						type: "array",
						items: {
							type: "object",
							properties: {
								width: {
									type: "integer",
									minimum: 1
								},
								height: {
									type: "integer",
									minimum: 1
								}
							},
							required: ["width", "height"],
							additionalProperties: false
						},
						description: "Viewports to capture at. Default [{1280, 800}]."
					},
					fullPage: { type: "boolean" },
					waitFor: {
						type: "string",
						description: "CSS selector to wait for before capturing."
					}
				},
				required: ["name", "url"],
				additionalProperties: false
			},
			minItems: 1
		},
		namespace: {
			type: "string",
			description: "Multi-tenant scope."
		},
		config: {
			type: "object",
			properties: {
				lenses: {
					type: "array",
					items: {
						type: "string",
						enum: [...UI_LENSES]
					},
					description: "Lenses to iterate. Default: every lens except \"other\"."
				},
				maxIterations: {
					type: "integer",
					minimum: 1
				},
				maxConcurrency: {
					type: "integer",
					minimum: 1
				},
				productContext: { type: "string" }
			},
			additionalProperties: false
		}
	},
	required: ["workspaceDir", "routes"],
	additionalProperties: false
};
const PER_LENS_PER_ROUTE_ESTIMATE_MS = 45e3;
/** Parse and validate raw MCP tool input into typed `DelegateUiAuditArgs`; throws `TypeError` on bad input. @experimental */
function validateDelegateUiAuditArgs(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegate_ui_audit: arguments must be an object");
	const value = raw;
	const workspaceDir = value.workspaceDir;
	if (typeof workspaceDir !== "string" || workspaceDir.trim().length === 0) throw new TypeError("delegate_ui_audit: `workspaceDir` must be a non-empty string");
	const trimmedWs = workspaceDir.trim();
	if (!path.isAbsolute(trimmedWs)) throw new TypeError(`delegate_ui_audit: \`workspaceDir\` must be an absolute path (got ${JSON.stringify(workspaceDir)})`);
	if (trimmedWs.split(path.sep).includes("..")) throw new TypeError(`delegate_ui_audit: \`workspaceDir\` must not contain '..' segments (got ${JSON.stringify(workspaceDir)})`);
	const routesRaw = value.routes;
	if (!Array.isArray(routesRaw) || routesRaw.length === 0) throw new TypeError("delegate_ui_audit: `routes` must be a non-empty array");
	const routes = routesRaw.map((r, i) => validateRoute(r, i));
	const args = {
		workspaceDir: workspaceDir.trim(),
		routes
	};
	if (value.namespace !== void 0) {
		if (typeof value.namespace !== "string" || value.namespace.trim().length === 0) throw new TypeError("delegate_ui_audit: `namespace` must be a non-empty string when set");
		args.namespace = value.namespace.trim();
	}
	if (value.config !== void 0) args.config = validateConfig(value.config);
	return args;
}
function validateRoute(raw, index) {
	if (raw === null || typeof raw !== "object") throw new TypeError(`delegate_ui_audit: routes[${index}] must be an object`);
	const v = raw;
	if (typeof v.name !== "string" || v.name.trim().length === 0) throw new TypeError(`delegate_ui_audit: routes[${index}].name must be a non-empty string`);
	const trimmedName = v.name.trim();
	if (/[./\\]/.test(trimmedName) || trimmedName.includes("\0")) throw new TypeError(`delegate_ui_audit: routes[${index}].name must not contain path separators, dots, or NUL (got ${JSON.stringify(v.name)})`);
	if (typeof v.url !== "string" || v.url.trim().length === 0) throw new TypeError(`delegate_ui_audit: routes[${index}].url must be a non-empty string`);
	let parsedUrl;
	try {
		parsedUrl = new URL(v.url);
	} catch {
		throw new TypeError(`delegate_ui_audit: routes[${index}].url is not a parseable URL (got ${JSON.stringify(v.url)})`);
	}
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new TypeError(`delegate_ui_audit: routes[${index}].url must use http or https (got ${parsedUrl.protocol})`);
	const out = {
		name: v.name.trim(),
		url: v.url.trim()
	};
	if (v.viewports !== void 0) {
		if (!Array.isArray(v.viewports) || v.viewports.length === 0) throw new TypeError(`delegate_ui_audit: routes[${index}].viewports must be a non-empty array when set`);
		out.viewports = v.viewports.map((vp, j) => validateViewport(vp, index, j));
	}
	if (v.fullPage !== void 0) {
		if (typeof v.fullPage !== "boolean") throw new TypeError(`delegate_ui_audit: routes[${index}].fullPage must be a boolean`);
		out.fullPage = v.fullPage;
	}
	if (v.waitFor !== void 0) {
		if (typeof v.waitFor !== "string" || v.waitFor.trim().length === 0) throw new TypeError(`delegate_ui_audit: routes[${index}].waitFor must be a non-empty string when set`);
		out.waitFor = v.waitFor.trim();
	}
	return out;
}
function validateViewport(raw, routeIndex, viewportIndex) {
	if (raw === null || typeof raw !== "object") throw new TypeError(`delegate_ui_audit: routes[${routeIndex}].viewports[${viewportIndex}] must be an object`);
	const v = raw;
	const w = Number(v.width);
	const h = Number(v.height);
	if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) throw new RangeError(`delegate_ui_audit: routes[${routeIndex}].viewports[${viewportIndex}] must have positive integer width/height`);
	return {
		width: w,
		height: h
	};
}
function validateConfig(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegate_ui_audit: `config` must be an object");
	const v = raw;
	const out = {};
	if (v.lenses !== void 0) {
		if (!Array.isArray(v.lenses) || v.lenses.length === 0) throw new TypeError("delegate_ui_audit: `config.lenses` must be a non-empty array when set");
		const knownSet = new Set(UI_LENSES);
		const lenses = [];
		for (let i = 0; i < v.lenses.length; i += 1) {
			const lens = v.lenses[i];
			if (typeof lens !== "string" || !knownSet.has(lens)) throw new TypeError(`delegate_ui_audit: config.lenses[${i}] must be one of ${UI_LENSES.join("|")}`);
			lenses.push(lens);
		}
		out.lenses = lenses;
	}
	if (v.maxIterations !== void 0) {
		const n = Number(v.maxIterations);
		if (!Number.isInteger(n) || n < 1) throw new RangeError("delegate_ui_audit: `config.maxIterations` must be a positive integer");
		out.maxIterations = n;
	}
	if (v.maxConcurrency !== void 0) {
		const n = Number(v.maxConcurrency);
		if (!Number.isInteger(n) || n < 1) throw new RangeError("delegate_ui_audit: `config.maxConcurrency` must be a positive integer");
		out.maxConcurrency = n;
	}
	if (v.productContext !== void 0) {
		if (typeof v.productContext !== "string") throw new TypeError("delegate_ui_audit: `config.productContext` must be a string");
		out.productContext = v.productContext;
	}
	return out;
}
/** Build the MCP tool handler that validates input, deduplicates via idempotency key, and enqueues a UI audit. @experimental */
function createDelegateUiAuditHandler(options) {
	const estimateDurationMs = options.estimateDurationMs ?? defaultEstimate;
	return async (raw) => {
		const args = validateDelegateUiAuditArgs(raw);
		const idempotencyKey = hashIdempotencyInput({
			profile: "ui-auditor",
			workspaceDir: args.workspaceDir,
			routes: args.routes,
			namespace: args.namespace,
			config: args.config
		});
		return {
			taskId: options.queue.submit({
				profile: "ui-auditor",
				args,
				namespace: args.namespace,
				idempotencyKey,
				run: async (ctx) => options.delegate(args, ctx)
			}).taskId,
			estimatedDurationMs: estimateDurationMs(args)
		};
	};
}
function defaultEstimate(args) {
	const lenses = args.config?.lenses?.length ?? UI_LENSES.length - 1;
	const routes = args.routes.length;
	return PER_LENS_PER_ROUTE_ESTIMATE_MS * lenses * routes;
}
//#endregion
//#region src/mcp/server.ts
/**
*
* Stdio JSON-RPC MCP server exposing the delegation tools to sandbox
* coding-harness agents (claude-code, codex, opencode, ...): the generic
* `delegate` verb plus the queue-bound `delegate_feedback`,
* `delegation_status`, and `delegation_history`. `delegate_ui_audit` is served
* when a `uiAuditorDelegate` is wired.
*
* The server is transport-bound but topology-free: tool execution is
* delegated to handler functions composed from a queue, a feedback
* store, and the wired run delegates. Consumers wire those at
* construction time. The `agent-runtime-mcp` bin serves the generic
* `delegate` verb over a real sandbox client when `MCP_ENABLE_DELEGATE=1`.
*
* Wire protocol: line-delimited JSON-RPC 2.0 over stdio. Each line is
* one request; each response is one line. `tools/list` and `tools/call`
* mirror the MCP 2024-11-05 spec. The production server does not depend on
* `@modelcontextprotocol/sdk`; integration tests validate this wire with the official client.
*
* @experimental
*/
const DEFAULT_SERVER_NAME = "agent-runtime-mcp";
const DEFAULT_SERVER_VERSION = "0.22.0";
/**
* Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents.
*
* @experimental
*/
function createMcpServer(options = {}) {
	const queue = options.queue ?? new DelegationTaskQueue(options.traceContext !== void 0 ? { traceContext: options.traceContext } : {});
	const feedbackStore = options.feedbackStore ?? new InMemoryFeedbackStore();
	const serverName = options.serverName ?? DEFAULT_SERVER_NAME;
	const serverVersion = options.serverVersion ?? DEFAULT_SERVER_VERSION;
	const tools = /* @__PURE__ */ new Map();
	if (options.delegateSupervisor) tools.set(DELEGATE_TOOL_NAME, {
		name: DELEGATE_TOOL_NAME,
		description: DELEGATE_DESCRIPTION,
		inputSchema: DELEGATE_INPUT_SCHEMA,
		handler: createDelegateHandler(options.delegateSupervisor)
	});
	if (options.uiAuditorDelegate) tools.set(DELEGATE_UI_AUDIT_TOOL_NAME, {
		name: DELEGATE_UI_AUDIT_TOOL_NAME,
		description: DELEGATE_UI_AUDIT_DESCRIPTION,
		inputSchema: DELEGATE_UI_AUDIT_INPUT_SCHEMA,
		handler: createDelegateUiAuditHandler({
			queue,
			delegate: options.uiAuditorDelegate
		})
	});
	tools.set(DELEGATE_FEEDBACK_TOOL_NAME, {
		name: DELEGATE_FEEDBACK_TOOL_NAME,
		description: DELEGATE_FEEDBACK_DESCRIPTION,
		inputSchema: DELEGATE_FEEDBACK_INPUT_SCHEMA,
		handler: createDelegateFeedbackHandler({
			queue,
			store: feedbackStore
		})
	});
	tools.set(DELEGATION_STATUS_TOOL_NAME, {
		name: DELEGATION_STATUS_TOOL_NAME,
		description: DELEGATION_STATUS_DESCRIPTION,
		inputSchema: DELEGATION_STATUS_INPUT_SCHEMA,
		handler: createDelegationStatusHandler({ queue })
	});
	tools.set(DELEGATION_HISTORY_TOOL_NAME, {
		name: DELEGATION_HISTORY_TOOL_NAME,
		description: DELEGATION_HISTORY_DESCRIPTION,
		inputSchema: DELEGATION_HISTORY_INPUT_SCHEMA,
		handler: createDelegationHistoryHandler({ queue })
	});
	for (const tool of options.extraTools ?? []) {
		if (tools.has(tool.name)) throw new ValidationError(`createMcpServer: extra tool "${tool.name}" shadows a built-in tool`);
		tools.set(tool.name, tool);
	}
	const stdio = createStdioToolServer({
		serverName,
		serverVersion,
		tools: [...tools.values()]
	});
	return {
		tools: stdio.tools,
		queue,
		feedbackStore,
		handle: stdio.handle,
		serve: stdio.serve,
		stop: stdio.stop
	};
}
/**
* In-process pair of `Readable` + `Writable` streams suitable for driving
* `server.serve(...)` from a test. Returns the agent-side stream (the
* client writes to it) and the server-side stream (the test reads from it).
*
* @experimental
*/
function createInProcessTransport() {
	const responses = [];
	const input = new Readable({ read() {} });
	return {
		transport: {
			input,
			output: new Writable({ write(chunk, _enc, cb) {
				const text = chunk.toString("utf8");
				for (const line of text.split("\n")) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					try {
						responses.push(JSON.parse(trimmed));
					} catch {}
				}
				cb();
			} })
		},
		clientWrite(line) {
			input.push(`${line}\n`);
		},
		clientClose() {
			input.push(null);
		},
		async readServer() {
			for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
			return [...responses];
		}
	};
}
//#endregion
export { composeLoopTraceEmitters as C, capDelegationTrace as S, FileDelegationStore as _, DELEGATE_UI_AUDIT_TOOL_NAME as a, DELEGATION_TRACE_MAX_SPANS as b, DELEGATE_DESCRIPTION as c, createDelegateHandler as d, validateDelegateArgs as f, DelegationStateCorruptError as g, DelegationPersistenceError as h, DELEGATE_UI_AUDIT_INPUT_SCHEMA as i, DELEGATE_INPUT_SCHEMA as l, hashIdempotencyInput as m, createMcpServer as n, createDelegateUiAuditHandler as o, DelegationTaskQueue as p, DELEGATE_UI_AUDIT_DESCRIPTION as r, validateDelegateUiAuditArgs as s, createInProcessTransport as t, DELEGATE_TOOL_NAME as u, InMemoryDelegationStore as v, createDelegationTraceCollector as w, buildDelegationTraceSpans as x, DELEGATION_TRACE_MAX_BYTES as y };

//# sourceMappingURL=server-Dyc1zvug.js.map