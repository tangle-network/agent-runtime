import { $i as detachedSnapshot, Ai as readCommittedJsonLines, Di as isNoEntError, E as failedItems, Kt as loadSpawnForest, Oa as zeroSpend, Oi as parseCommittedJsonLines, Pi as authoredProfileDigest, ga as cloneSpend, ji as writeAllBytes, jr as contentAddress, ki as prepareJsonlAppend, ma as addSpend, zt as FileSpawnJournal } from "./supervisor-DtlPj9me.js";
import { f as RuntimeRunStateError, m as ValidationError } from "./errors-DodWX-cb.js";
import { a as withPursuitContext, t as composeRuntimeHooks } from "./runtime-hooks-tXpAarhW.js";
import { a as writeAtomicDurableFile, r as publishExclusiveDurableFile } from "./durable-file-DWQA4ooo.js";
import { i as applyExactAgentProfileDiff } from "./profile-D3eXNBQV.js";
import { _ as readRootStream, g as ROOT_STREAM_FILE, i as superviseRootProfile, r as supervise, v as readRootStreamReceipt } from "./supervise-DBQdrp7H.js";
import { h as supervisorRunDir } from "./run-layout-vwd4SwX_.js";
import { canonicalCandidateDigest, canonicalCandidateJson, sha256Bytes } from "@tangle-network/agent-interface";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { mkdir, open, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as setTimeout$1 } from "node:timers/promises";
//#region src/durable/chat-engine.ts
const encoder = new TextEncoder();
function encodeLine(event) {
	return encoder.encode(`${JSON.stringify(event)}\n`);
}
function defaultLog(message, meta) {
	if (meta) console.error(message, meta);
	else console.error(message);
}
/**
* Preserve the useful part of a thrown HTTP Response at the stream boundary.
*
* Product routes commonly throw a typed Response for an upstream failure. A
* Response is not an Error, so String(response) produces the unusable
* "[object Response]" and hides the status that decides the next action.
* Read a clone so the caller's response body remains available to its owner.
*/
async function thrownErrorMessage(error) {
	if (!(error instanceof Response)) return error instanceof Error ? error.message : String(error);
	const prefix = `HTTP ${error.status}`;
	try {
		const text = await error.clone().text();
		if (!text.trim()) return prefix;
		try {
			const body = JSON.parse(text);
			const nested = typeof body.error === "object" && body.error !== null ? body.error.message : body.error;
			const message = typeof nested === "string" ? nested : typeof body.message === "string" ? body.message : void 0;
			if (message) return `${prefix}: ${message.slice(0, 500)}`;
		} catch {}
	} catch {}
	return prefix;
}
/**
* Run one chat turn. Returns immediately with a `ReadableStream` body;
* execution starts while the stream is constructed. Backend
* failures surface as `error` + `session.run.failed` events.
*/
function handleChatTurn(input) {
	const log = input.log ?? defaultLog;
	const { identity, hooks } = input;
	return {
		body: new ReadableStream({ start: async (controller) => {
			const emit = async (event) => {
				controller.enqueue(encodeLine(event));
				if (hooks.onEvent) try {
					await hooks.onEvent(event);
				} catch (err) {
					log("[chat-engine] onEvent hook threw", { error: err instanceof Error ? err.message : String(err) });
				}
			};
			try {
				await emit({
					type: "session.run.started",
					data: {
						sessionId: identity.sessionId,
						tenantId: identity.tenantId,
						turnIndex: identity.turnIndex
					}
				});
				const producer = hooks.produce();
				let failureData;
				for await (const event of producer.stream) {
					if (event.type === "session.run.failed") {
						if (!failureData) await emit({
							type: "error",
							data: event.data
						});
						failureData = {
							...failureData,
							...event.data
						};
						continue;
					}
					if (event.type === "error") failureData = {
						...failureData,
						...event.data
					};
					if (event.type === "session.run.completed") continue;
					await emit(event);
				}
				const rawFinal = producer.finalText();
				const finalText = hooks.transformFinalText ? await hooks.transformFinalText(rawFinal) : rawFinal;
				await hooks.persistAssistantMessage({
					identity,
					finalText
				});
				if (hooks.onTurnComplete) try {
					await hooks.onTurnComplete({
						identity,
						finalText
					});
				} catch (err) {
					log("[chat-engine] onTurnComplete threw", { error: err instanceof Error ? err.message : String(err) });
				}
				await emit({
					type: failureData ? "session.run.failed" : "session.run.completed",
					data: {
						...failureData,
						sessionId: identity.sessionId
					}
				});
			} catch (err) {
				const message = await thrownErrorMessage(err);
				log("[chat-engine] turn failed", { error: message });
				await emit({
					type: "error",
					data: { message }
				});
				await emit({
					type: "session.run.failed",
					data: {
						sessionId: identity.sessionId,
						message
					}
				});
			} finally {
				if (hooks.traceFlush) {
					const flush = hooks.traceFlush().catch((err) => log("[chat-engine] traceFlush threw", { error: err instanceof Error ? err.message : String(err) }));
					if (input.waitUntil) input.waitUntil(flush);
					else await flush;
				}
				controller.close();
			}
		} }),
		contentType: "application/x-ndjson"
	};
}
//#endregion
//#region src/durable/execution-handle.ts
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
function deriveExecutionId(input) {
	if (input.projectId.trim().length === 0) throw new TypeError("projectId must be a non-empty string");
	if (input.sessionId.trim().length === 0) throw new TypeError("sessionId must be a non-empty string");
	if (!Number.isSafeInteger(input.turnIndex) || input.turnIndex < 0) throw new RangeError("turnIndex must be a non-negative safe integer");
	const executionId = [
		encodeURIComponent(input.projectId),
		encodeURIComponent(input.sessionId),
		String(input.turnIndex)
	].join(":");
	if (executionId.length > 256) throw new RangeError("derived execution id must not exceed 256 bytes");
	return executionId;
}
//#endregion
//#region src/durable/observer-journal.ts
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
var FileObserverJournal = class {
	path;
	pursuitId;
	tail = Promise.resolve();
	initialized = false;
	sequence = 0;
	previousDigest;
	appendFailure;
	constructor(path, pursuitId) {
		const stableId = pursuitId.trim();
		if (stableId.length === 0) throw new TypeError("FileObserverJournal: pursuitId must be non-empty");
		this.path = resolve(path);
		this.pursuitId = stableId;
	}
	hooks() {
		return withPursuitContext(this.pursuitId, {
			onEvent: (event) => this.appendEvent(event).then(() => void 0),
			onDecisionPoint: (point) => this.appendDecision(point).then(() => void 0)
		});
	}
	appendEvent(event) {
		return this.enqueue("event", event);
	}
	appendDecision(point) {
		return this.enqueue("decision", point);
	}
	async read() {
		await this.tail;
		this.assertComplete();
		const records = [];
		const verify = observerVerifier(this.pursuitId);
		for await (const record of this.readExistingUnsafe()) {
			verify(record);
			records.push(record);
		}
		return Object.freeze(records);
	}
	enqueue(kind, value) {
		if (value.pursuitId !== this.pursuitId) return Promise.reject(/* @__PURE__ */ new Error(`FileObserverJournal: ${kind} pursuitId ${String(value.pursuitId)} does not match ${this.pursuitId}`));
		let snapshot;
		try {
			snapshot = detachedSnapshot(value, "observer record");
		} catch (error) {
			return Promise.reject(error);
		}
		let result;
		const operation = this.tail.then(async () => {
			this.assertComplete();
			try {
				await this.initialize();
			} catch (error) {
				this.appendFailure ??= toError(error);
				throw error;
			}
			const unsigned = {
				schemaVersion: 1,
				pursuitId: this.pursuitId,
				sequence: this.sequence + 1,
				kind,
				observedAt: Date.now(),
				...this.previousDigest ? { previousDigest: this.previousDigest } : {},
				...kind === "event" ? { event: snapshot } : { decision: snapshot }
			};
			const record = Object.freeze({
				...unsigned,
				digest: observerRecordDigest(unsigned)
			});
			try {
				await this.writeRecord(record);
			} catch (error) {
				this.appendFailure ??= toError(error);
				throw error;
			}
			this.sequence = record.sequence;
			this.previousDigest = record.digest;
			result = record;
		});
		this.tail = operation.then(() => void 0, () => void 0);
		return operation.then(() => {
			if (!result) throw new Error("FileObserverJournal: append completed without a record");
			return result;
		});
	}
	async initialize() {
		if (this.initialized) return;
		const verify = observerVerifier(this.pursuitId);
		let tail;
		for await (const record of this.readExistingUnsafe()) {
			verify(record);
			tail = record;
		}
		this.sequence = tail?.sequence ?? 0;
		this.previousDigest = tail?.digest;
		this.initialized = true;
	}
	readExistingUnsafe() {
		return readCommittedJsonLines(this.path, { allowMissing: true });
	}
	async writeRecord(record) {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		await fs.mkdir(path.dirname(this.path), { recursive: true });
		const needsSeparator = await prepareJsonlAppend(this.path);
		const handle = await fs.open(this.path, "a");
		try {
			await writeAllBytes(handle, `${needsSeparator ? "\n" : ""}${JSON.stringify(record)}\n`);
			await handle.sync();
		} finally {
			await handle.close();
		}
	}
	assertComplete() {
		if (!this.appendFailure) return;
		throw new Error("FileObserverJournal: a prior durable append failed; observer completeness is unknown", { cause: this.appendFailure });
	}
};
/** Verify identity, monotonic sequence, payload shape, and the complete digest chain. */
function verifyObserverRecords(records, pursuitId) {
	const verify = observerVerifier(pursuitId);
	for (const record of records) verify(record);
	return Object.freeze([...records]);
}
/** The same full chain validation is used for replay, startup and in-memory evidence. */
function observerVerifier(pursuitId) {
	let previousDigest;
	let expectedSequence = 1;
	return (record) => {
		if (record.schemaVersion !== 1) throw new Error("observer journal: unsupported schemaVersion");
		if (pursuitId !== void 0 && record.pursuitId !== pursuitId) throw new Error(`observer journal: pursuit identity mismatch at sequence ${record.sequence}`);
		if (record.sequence !== expectedSequence) throw new Error(`observer journal: non-contiguous sequence ${record.sequence}; expected ${expectedSequence}`);
		if (record.previousDigest !== previousDigest) throw new Error(`observer journal: digest-chain break at sequence ${record.sequence}`);
		if (record.kind === "event" === (record.event === void 0)) throw new Error(`observer journal: invalid event payload at sequence ${record.sequence}`);
		if (record.kind === "decision" === (record.decision === void 0)) throw new Error(`observer journal: invalid decision payload at sequence ${record.sequence}`);
		if (record.event !== void 0 && record.event.pursuitId !== record.pursuitId) throw new Error(`observer journal: nested event pursuit mismatch at sequence ${record.sequence}`);
		if (record.decision !== void 0 && record.decision.pursuitId !== record.pursuitId) throw new Error(`observer journal: nested decision pursuit mismatch at sequence ${record.sequence}`);
		const { digest, ...unsigned } = record;
		if (digest !== observerRecordDigest(unsigned)) throw new Error(`observer journal: digest mismatch at sequence ${record.sequence}`);
		previousDigest = digest;
		expectedSequence += 1;
	};
}
/** Compute the canonical SHA-256 digest for an unsigned observer record. */
function observerRecordDigest(record) {
	return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}
/** Build the canonical durable observer hook in one call. */
function createFileObserverHooks(path, pursuitId) {
	const journal = new FileObserverJournal(path, pursuitId);
	return {
		journal,
		hooks: journal.hooks()
	};
}
function toError(error) {
	return error instanceof Error ? error : new Error(String(error));
}
//#endregion
//#region src/durable/observer-projection.ts
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
function projectPursuit(records) {
	if (records.length === 0) throw new TypeError("projectPursuit: at least one observer record is required");
	const pursuitId = records[0].pursuitId;
	const verified = verifyObserverRecords(records, pursuitId);
	const attempts = /* @__PURE__ */ new Map();
	const nodes = /* @__PURE__ */ new Map();
	let eventCount = 0;
	let decisionCount = 0;
	for (const record of verified) {
		const observed = record.event ?? record.decision;
		if (!observed) throw new Error(`projectPursuit: record ${record.sequence} has no observation`);
		const run = currentAttempt(attempts, observed.runId, record);
		run.lastSequence = record.sequence;
		run.lastObservedAt = record.observedAt;
		if (record.event) {
			eventCount += 1;
			run.eventCount += 1;
			increment(run.targets, record.event.target);
			projectRunActivity(run, record);
			projectSpawnNode(nodes, record, run.attemptIndex);
			projectNodeActivity(nodes, record);
			projectTurn(run, nodes, record);
		} else if (record.decision) {
			decisionCount += 1;
			run.decisionCount += 1;
			increment(run.decisions, record.decision.kind);
		}
	}
	const byAttempt = /* @__PURE__ */ new Map();
	for (const node of nodes.values()) {
		const key = attemptKey(node.runId, node.attemptIndex);
		const list = byAttempt.get(key);
		if (list) list.push(node);
		else byAttempt.set(key, [node]);
	}
	const first = verified[0];
	const last = verified.at(-1);
	return Object.freeze({
		pursuitId,
		sequence: last.sequence,
		chainTip: last.digest,
		firstObservedAt: first.observedAt,
		lastObservedAt: last.observedAt,
		runs: Object.freeze([...attempts.values()].flat().sort((a, b) => a.firstSequence - b.firstSequence || a.runId.localeCompare(b.runId)).map((run) => freezeRun(run, byAttempt.get(attemptKey(run.runId, run.attemptIndex)) ?? []))),
		nodes: Object.freeze([...nodes.values()].sort((a, b) => a.firstSequence - b.firstSequence || a.runId.localeCompare(b.runId) || a.id.localeCompare(b.id)).map(freezeNode)),
		eventCount,
		decisionCount
	});
}
function attemptKey(runId, attemptIndex) {
	return `${runId}\u0000${attemptIndex}`;
}
/**
* The attempt a record belongs to. An `agent.run` `before` opens a new attempt when the run has
* none or its latest attempt already settled; on an open attempt it is a resume. Every other
* record joins the latest attempt, and a journal that never emitted `before` gets attempt 0.
*/
function currentAttempt(attempts, runId, record) {
	const list = attempts.get(runId) ?? [];
	if (list.length === 0) attempts.set(runId, list);
	const latest = list.at(-1);
	const isStart = record.event?.target === "agent.run" && record.event.phase === "before";
	if (latest !== void 0 && (!isStart || latest.status === "running")) {
		if (isStart) {
			if (latest.started) latest.resumeCount += 1;
			latest.started = true;
		}
		return latest;
	}
	const created = {
		runId,
		attemptIndex: list.length,
		resumeCount: 0,
		started: isStart,
		status: "running",
		firstSequence: record.sequence,
		lastSequence: record.sequence,
		firstObservedAt: record.observedAt,
		lastObservedAt: record.observedAt,
		eventCount: 0,
		decisionCount: 0,
		targets: {},
		decisions: {}
	};
	list.push(created);
	return created;
}
function projectRunActivity(run, record) {
	const event = record.event;
	if (event?.target !== "agent.run") return;
	const payload = objectRecord(event.payload);
	const status = stringField(payload, "status");
	if (event.phase === "after" || status === "done") {
		run.status = "done";
		run.settledAt = record.observedAt;
		return;
	}
	if (event.phase !== "error" && status !== "failed") return;
	run.status = "down";
	run.settledAt = record.observedAt;
	const error = stringField(payload, "error");
	if (error) run.error = error;
}
function nodeKey(runId, nodeId) {
	return `${runId}\u0000${nodeId}`;
}
function projectSpawnNode(nodes, record, attemptIndex) {
	const event = record.event;
	if (event?.target !== "agent.spawn") return;
	const payload = objectRecord(event.payload);
	const childId = stringField(payload, "childId");
	if (!childId) return;
	const key = nodeKey(event.runId, childId);
	const existing = nodes.get(key);
	if (existing) {
		existing.lastSequence = record.sequence;
		existing.lastObservedAt = record.observedAt;
		existing.eventCount += 1;
		return;
	}
	const label = stringField(payload, "label");
	const runtime = stringField(payload, "runtime");
	const depth = numberField(payload, "depth");
	const assignmentId = stringField(payload, "assignmentId");
	const successorOf = stringField(payload, "successorOf");
	const attemptId = stringField(payload, "attemptId");
	const startedAt = numberField(payload, "startedAt");
	nodes.set(key, {
		id: childId,
		...event.parentId ? { parentId: event.parentId } : {},
		runId: event.runId,
		attemptIndex,
		...label ? { label } : {},
		...runtime ? { runtime } : {},
		...depth !== void 0 ? { depth } : {},
		...assignmentId ? { assignmentId } : {},
		...successorOf ? { successorOf } : {},
		...attemptId ? { attemptId } : {},
		startedAt: startedAt ?? record.observedAt,
		...payload && Object.hasOwn(payload, "identity") ? { identity: payload.identity } : {},
		...payload && Object.hasOwn(payload, "budget") ? { budget: payload.budget } : {},
		status: "running",
		modelCalls: [],
		firstSequence: record.sequence,
		lastSequence: record.sequence,
		firstObservedAt: record.observedAt,
		lastObservedAt: record.observedAt,
		eventCount: 1,
		turnCount: 0
	});
}
function projectNodeActivity(nodes, record) {
	const event = record.event;
	if (event === void 0) return;
	if (event.target === "agent.spawn") return;
	const payload = objectRecord(event.payload);
	const nodeId = stringField(payload, "childId") ?? stringField(payload, "nodeId") ?? stringField(payload, "workerId");
	if (!nodeId) return;
	const node = nodes.get(nodeKey(event.runId, nodeId));
	if (!node) return;
	node.lastSequence = record.sequence;
	node.lastObservedAt = record.observedAt;
	node.eventCount += 1;
	if (event.target !== "agent.child") return;
	const status = stringField(payload, "status");
	if (status !== "done" && status !== "down") return;
	node.status = status;
	node.settledAt = numberField(payload, "settledAt") ?? record.observedAt;
	const startedAt = numberField(payload, "startedAt");
	if (startedAt !== void 0) node.startedAt = startedAt;
	if (payload && Object.hasOwn(payload, "spent")) node.spent = spendField(payload, "spent");
	const metered = spendField(payload, "metered");
	if (metered) node.ownInference = node.ownInference ? addSpend(node.ownInference, metered) : metered;
	const runtime = stringField(payload, "runtime");
	if (runtime) node.runtime = runtime;
	const outRef = stringField(payload, "outRef");
	if (outRef) node.outRef = outRef;
	const score = numberField(payload, "score");
	if (score !== void 0) node.score = score;
	const valid = booleanField(payload, "valid");
	if (valid !== void 0) node.valid = valid;
	const reason = stringField(payload, "reason");
	if (reason) node.reason = reason;
	const infra = booleanField(payload, "infra");
	if (infra !== void 0) node.infra = infra;
	const retained = stringField(payload, "retainedExecution");
	if (retained === "pending" || retained === "released" || retained === "release-unconfirmed") node.retainedExecution = retained;
	const cause = stringField(payload, "retainedPendingCause");
	if (cause === "unobservable" || cause === "provider-contract" || cause === "request-rejected" || cause === "transport" || cause === "nested-recovery") node.retainedPendingCause = cause;
	const releasedAt = numberField(payload, "releasedAt");
	if (releasedAt !== void 0) node.releasedAt = releasedAt;
	const budgetViolation = budgetViolationField(payload);
	if (budgetViolation) node.budgetViolation = budgetViolation;
	if (payload && Object.hasOwn(payload, "wait")) node.wait = payload.wait;
	attachSettlementEvidence(node, payload);
}
/**
* Read the receipts a settlement carries. Each is taken as reported: an `unknown` receipt keeps
* its `status` and `reason` so a client can show WHY a model or backend is missing instead of
* showing nothing, and a receipt that never landed leaves every derived field absent.
*/
function attachSettlementEvidence(node, payload) {
	const providerModel = payload?.providerModel;
	if (providerModel && typeof providerModel === "object") node.providerModel = providerModel;
	const trace = payload?.trace;
	if (trace && typeof trace === "object") node.trace = trace;
	const bindings = payload?.executionBindings;
	if (Array.isArray(bindings) && bindings.length > 0) {
		node.executionBindings = bindings;
		const known = bindings.find((binding) => objectRecord(binding)?.status === "known");
		if (known) {
			node.placement = known.descriptor;
			node.attemptId ??= known.attemptId;
		}
	}
	const receipt = payload?.materialization;
	if (!receipt || typeof receipt !== "object") return;
	node.materialization = receipt;
	if (receipt.status !== "known") return;
	node.backend = receipt.backend;
	if (receipt.model.status === "known") node.model = receipt.model.id;
	node.execution = {
		kind: receipt.execution.kind,
		id: receipt.execution.id
	};
}
/**
* Fold one metered turn onto whoever drove it. `agent.turn` names its subject in `parentId` — the
* node making the call — not in the payload, because the caller IS the subject. A turn the run
* root drove belongs to no spawned node and lands on the run instead, so the run's totals stay
* complete without inventing a node for the root.
*/
function projectTurn(run, nodes, record) {
	const event = record.event;
	if (event?.target !== "agent.turn") return;
	const payload = objectRecord(event.payload);
	const spend = spendField(payload, "spend");
	const subject = event.parentId;
	if (subject === void 0) return;
	const node = nodes.get(nodeKey(event.runId, subject));
	if (!node) {
		if (!spend) return;
		run.rootInference = run.rootInference ? addSpend(run.rootInference, spend) : spend;
		return;
	}
	node.turnCount += 1;
	node.lastSequence = record.sequence;
	node.lastObservedAt = record.observedAt;
	if (spend) {
		node.ownInference = node.ownInference ? addSpend(node.ownInference, spend) : spend;
		node.firstOutputAt ??= record.observedAt;
	}
	const reasoning = numberField(payload, "reasoningTokens");
	if (reasoning !== void 0) node.reasoningTokens = (node.reasoningTokens ?? 0) + reasoning;
	const firstTokenAt = numberField(payload, "firstTokenAt");
	if (firstTokenAt !== void 0) node.firstTokenAt ??= firstTokenAt;
	const model = stringField(payload, "model");
	if (model) node.model ??= model;
	const callId = stringField(payload, "callId");
	if (callId && !node.modelCalls.includes(callId)) node.modelCalls.push(callId);
}
/**
* A node's whole reported cost: the child work its settlement reported plus the inference it drove
* itself. `undefined` when neither landed — the run's `spendGaps` then names the node, so an
* unaccounted node is visible instead of reading as free.
*/
function nodeTotal(node) {
	if (node.spent && node.ownInference) return addSpend(node.spent, node.ownInference);
	if (node.spent) return cloneSpend(node.spent);
	if (node.ownInference) return cloneSpend(node.ownInference);
}
/**
* The run counted once, and each node's own share of it.
*
* A settled node's `spent` already contains the child work its nested tree reported, so summing
* every node would count a driver's descendants twice. Inclusive therefore sums only the run's
* TOP-LEVEL nodes — those whose parent is not another node of this run — plus the root's own
* turns. Exclusive subtracts each node's direct children from its own total, which telescopes:
* the exclusive entries sum back to `inclusive` exactly.
*/
function runTotals(run, nodes) {
	const present = new Set(nodes.map((node) => node.id));
	const children = /* @__PURE__ */ new Map();
	for (const node of nodes) {
		if (node.parentId === void 0 || !present.has(node.parentId)) continue;
		const list = children.get(node.parentId);
		if (list) list.push(node);
		else children.set(node.parentId, [node]);
	}
	const exclusiveByNode = {};
	let inclusive = run.rootInference ? cloneSpend(run.rootInference) : zeroSpend();
	if (run.rootInference) exclusiveByNode[run.runId] = cloneSpend(run.rootInference);
	for (const node of nodes) {
		const total = nodeTotal(node);
		if (total === void 0) continue;
		if (node.parentId === void 0 || !present.has(node.parentId)) inclusive = addSpend(inclusive, total);
		let exclusive = total;
		for (const child of children.get(node.id) ?? []) {
			const childTotal = nodeTotal(child);
			if (childTotal !== void 0) exclusive = subtractSpend(exclusive, childTotal);
		}
		exclusiveByNode[node.id] = exclusive;
	}
	return Object.freeze({
		inclusive: Object.freeze(inclusive),
		exclusiveByNode: Object.freeze(exclusiveByNode)
	});
}
/**
* Remove a child's reported total from its parent's. Per channel, never below zero: a parent whose
* executor reported less than its children did is a reporting gap, and a negative exclusive share
* would be a fabricated number rather than a measurement.
*/
function subtractSpend(a, b) {
	const tokens = { ...a.tokens };
	tokens.input = Math.max(0, tokens.input - b.tokens.input);
	tokens.output = Math.max(0, tokens.output - b.tokens.output);
	if (a.tokens.cacheRead !== void 0) tokens.cacheRead = Math.max(0, a.tokens.cacheRead - (b.tokens.cacheRead ?? 0));
	if (a.tokens.cacheWrite !== void 0) tokens.cacheWrite = Math.max(0, a.tokens.cacheWrite - (b.tokens.cacheWrite ?? 0));
	if (a.tokens.freshInput !== void 0) tokens.freshInput = Math.max(0, a.tokens.freshInput - (b.tokens.freshInput ?? 0));
	return {
		iterations: Math.max(0, a.iterations - b.iterations),
		tokens,
		...a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {},
		usd: Math.max(0, a.usd - b.usd),
		...a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {},
		...a.usdEstimated !== void 0 ? { usdEstimated: Math.max(0, a.usdEstimated - (b.usdEstimated ?? 0)) } : {},
		ms: Math.max(0, a.ms - b.ms)
	};
}
/** The nodes of one run whose accounting is incomplete, in the vocabulary the supervisor already
*  uses: `never-settled` = no terminal record, so every channel is unaccounted; `unreported` = a
*  record landed with a channel the provider did not report, so that channel is a floor. */
function runSpendGaps(nodes) {
	const gaps = [];
	for (const node of nodes) {
		const label = node.label;
		if (node.status === "running") {
			gaps.push({
				id: node.id,
				...label !== void 0 ? { label } : {},
				kind: "never-settled",
				channels: ["tokens", "usd"]
			});
			continue;
		}
		const total = nodeTotal(node);
		const channels = [];
		if (total === void 0 || total.tokensKnown === false) channels.push("tokens");
		if (total === void 0 || total.usdKnown === false) channels.push("usd");
		if (channels.length === 0) continue;
		gaps.push({
			id: node.id,
			...label !== void 0 ? { label } : {},
			kind: "unreported",
			channels
		});
	}
	return gaps;
}
function usageOf(total, reasoning) {
	return {
		input: total.tokens.input,
		output: total.tokens.output,
		...total.tokens.cacheRead !== void 0 ? { cacheRead: total.tokens.cacheRead } : {},
		...total.tokens.cacheWrite !== void 0 ? { cacheWrite: total.tokens.cacheWrite } : {},
		...reasoning !== void 0 ? { reasoning } : {},
		tokensKnown: total.tokensKnown !== false && total.tokens.tokensKnown !== false
	};
}
function costOf(total) {
	const usdKnown = total.usdKnown !== false;
	const estimated = total.usdEstimated;
	const provenance = usdKnown ? estimated === void 0 || estimated === 0 ? "reported" : "partial" : estimated === void 0 ? "unknown" : estimated >= total.usd ? "estimated" : "partial";
	return {
		usd: total.usd,
		usdKnown,
		...estimated !== void 0 ? { usdEstimated: estimated } : {},
		provenance
	};
}
/** The platform block, or nothing at all when the node's spend names no box channel. */
function platformOf(total) {
	if (total.boxMinutesProvenance === void 0) return void 0;
	return {
		...total.boxMinutes !== void 0 ? { boxMinutes: total.boxMinutes } : {},
		boxMinutesKnown: total.boxMinutesKnown === true,
		provenance: total.boxMinutesProvenance
	};
}
function timingOf(node) {
	if (node.startedAt === void 0) return void 0;
	return {
		startedAt: node.startedAt,
		...node.firstOutputAt !== void 0 ? { firstOutputAt: node.firstOutputAt } : {},
		...node.firstTokenAt !== void 0 ? { firstTokenAt: node.firstTokenAt } : {},
		...node.settledAt !== void 0 ? { settledAt: node.settledAt } : {},
		...node.settledAt !== void 0 ? { wallMs: Math.max(0, node.settledAt - node.startedAt) } : {}
	};
}
function freezeRun(run, nodes) {
	const gaps = runSpendGaps(nodes);
	const { rootInference: _rootInference, started: _started, ...rest } = run;
	return Object.freeze({
		...rest,
		targets: Object.freeze({ ...run.targets }),
		decisions: Object.freeze({ ...run.decisions }),
		totals: runTotals(run, nodes),
		...gaps.length > 0 ? { spendGaps: Object.freeze(gaps) } : {}
	});
}
function freezeNode(node) {
	const { modelCalls, reasoningTokens, startedAt: _startedAt, attemptIndex: _attemptIndex, ...rest } = node;
	const total = nodeTotal(node);
	const timing = timingOf(node);
	return Object.freeze({
		...rest,
		...modelCalls.length > 0 ? { modelCalls: Object.freeze([...modelCalls]) } : {},
		...total !== void 0 ? {
			usage: usageOf(total, reasoningTokens),
			cost: costOf(total)
		} : {},
		...total !== void 0 && platformOf(total) !== void 0 ? { platform: platformOf(total) } : {},
		...timing !== void 0 ? { timing } : {}
	});
}
function increment(target, key) {
	target[key] = (target[key] ?? 0) + 1;
}
function objectRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Read a journaled `Spend` without trusting the wire: a record missing the conserved channels is
*  not a zero-cost turn, it is an unparseable one, and it must not enter a total. */
function spendField(value, key) {
	const field = objectRecord(value?.[key]);
	if (!field) return void 0;
	const tokens = objectRecord(field.tokens);
	if (typeof field.usd !== "number" || !Number.isFinite(field.usd)) return void 0;
	if (!tokens || typeof tokens.input !== "number" || typeof tokens.output !== "number") return;
	return cloneSpend(field);
}
/** Read a journaled overspend without trusting the wire: one malformed channel drops the record,
*  so an unparseable entry is never reported as an overspend of some size. */
function budgetViolationField(value) {
	const overspent = objectRecord(value?.budgetViolation)?.overspent;
	if (!Array.isArray(overspent) || overspent.length === 0) return void 0;
	const entries = [];
	for (const raw of overspent) {
		const entry = objectRecord(raw);
		const channel = stringField(entry, "channel");
		const reserved = numberField(entry, "reserved");
		const spent = numberField(entry, "spent");
		if (channel === void 0 || reserved === void 0 || spent === void 0) return void 0;
		entries.push({
			channel,
			reserved,
			spent
		});
	}
	return { overspent: entries };
}
function stringField(value, key) {
	const field = value?.[key];
	return typeof field === "string" && field.length > 0 ? field : void 0;
}
function numberField(value, key) {
	const field = value?.[key];
	return typeof field === "number" && Number.isFinite(field) ? field : void 0;
}
function booleanField(value, key) {
	const field = value?.[key];
	return typeof field === "boolean" ? field : void 0;
}
//#endregion
//#region src/durable/settle-record.ts
/** The settle record: the returned `SupervisedResult` as canonical JSON, written once. */
const SETTLE_RECORD_FILE = "result.json";
/** The failure record: the most recent throw, replaced by a later throw. */
const FAILURE_RECORD_FILE = "failure.json";
/** The directory already holds a settle record, so the run it records must not be re-entered. */
var SettledRunDirectoryError = class extends Error {
	path;
	/** The root of the recorded run, which is its `runId`. */
	recordedRunId;
	constructor(path, recordedRunId, requestedRunId) {
		super(recordedRunId === requestedRunId ? `supervisePursuit: ${path} records that run '${recordedRunId}' already settled; a settled run is not re-entered` : `supervisePursuit: ${path} records that run '${recordedRunId}' already settled in this directory; a directory holds one settle record, so run '${requestedRunId}' needs its own runDir`);
		this.name = "SettledRunDirectoryError";
		this.path = path;
		this.recordedRunId = recordedRunId;
	}
};
/** A result member whose JSON form would misstate it. */
var UnrecordableSettleValueError = class extends TypeError {
	path;
	constructor(path, kind) {
		super(`supervisePursuit: result${path} is a ${kind}, which JSON cannot record faithfully; a settle record holds plain data only`);
		this.name = "UnrecordableSettleValueError";
		this.path = path;
	}
};
const PLAIN_PROTOTYPES = /* @__PURE__ */ new Set([
	Object.prototype,
	Array.prototype,
	null
]);
/**
* The JSON value of a result, or a throw naming the first member JSON would misstate. An
* `undefined` member and a function are dropped, exactly as any JSON consumer drops them; a Map,
* a Set, a Date, a typed array, or a class instance would be rewritten to `{}` or a string and
* so is refused.
*/
function jsonValue(result) {
	const seen = [];
	const visit = (value, path) => {
		if (value === null || typeof value !== "object") return;
		if (value instanceof Map) throw new UnrecordableSettleValueError(path, "Map");
		if (value instanceof Set) throw new UnrecordableSettleValueError(path, "Set");
		if (value instanceof Date) throw new UnrecordableSettleValueError(path, "Date");
		if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw new UnrecordableSettleValueError(path, "binary buffer");
		if (!PLAIN_PROTOTYPES.has(Object.getPrototypeOf(value))) throw new UnrecordableSettleValueError(path, "class instance");
		if (seen.includes(value)) throw new UnrecordableSettleValueError(path, "cycle");
		seen.push(value);
		if (Array.isArray(value)) for (const [index, item] of value.entries()) visit(item, `${path}[${index}]`);
		else for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
		seen.pop();
	};
	visit(result, "");
	return JSON.parse(JSON.stringify(result));
}
/**
* The exact bytes `result.json` holds for a result: its JSON value serialized as RFC 8785
* canonical JSON. Throws `UnrecordableSettleValueError` before any byte is written when the
* result carries a value JSON would misstate.
*/
function settleRecordJson(result) {
	return canonicalCandidateJson(jsonValue(result));
}
/** Publish `runDir/result.json` once. Throws when a record is already there. */
async function writeSettleRecord(runDir, result) {
	const path = resolve(runDir, SETTLE_RECORD_FILE);
	if (!publishExclusiveDurableFile(path, settleRecordJson(result))) throw new Error(`supervisePursuit: ${path} already exists; a settle record is written once`);
	return path;
}
/** Replace `runDir/failure.json` with the most recent throw. */
async function writeFailureRecord(runDir, record) {
	const path = resolve(runDir, FAILURE_RECORD_FILE);
	writeAtomicDurableFile(path, `${JSON.stringify(record, null, 2)}\n`);
	return path;
}
/**
* Read the settle record a run directory holds, or `undefined` when it holds none. A file that
* is present but is not a settle record is corruption and fails loud.
*/
async function readSettleRecord(runDir) {
	const path = resolve(runDir, SETTLE_RECORD_FILE);
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isNoEntError(error)) return void 0;
		throw error;
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (cause) {
		throw new Error(`supervisePursuit: ${path} is not valid JSON`, { cause });
	}
	const record = parsed;
	if (typeof record !== "object" || record === null || typeof record.kind !== "string" || typeof record.tree !== "object" || record.tree === null || typeof record.tree.root !== "string") throw new Error(`supervisePursuit: ${path} is not a settle record (no kind or tree.root)`);
	return parsed;
}
/** Read the most recent failure record, or `undefined` when the directory holds none. */
async function readFailureRecord(runDir) {
	const path = resolve(runDir, FAILURE_RECORD_FILE);
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isNoEntError(error)) return void 0;
		throw error;
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (cause) {
		throw new Error(`supervisePursuit: ${path} is not valid JSON`, { cause });
	}
	const record = parsed;
	if (typeof record !== "object" || record === null || typeof record.runId !== "string" || typeof record.pursuitId !== "string" || typeof record.at !== "string" || typeof record.error?.name !== "string" || typeof record.error.message !== "string" || record.rootStream !== void 0 && (typeof record.rootStream.ref !== "string" || typeof record.rootStream.events !== "number")) throw new Error(`supervisePursuit: ${path} is not a failure record`);
	return parsed;
}
//#endregion
//#region src/durable/run-fork.ts
/**
* The `execution.correlation` keys a fork records on its root. Runtime writes them; a caller that
* supplies one is refused. `lineageRootRunId` is the first run of the chain of parents, so the
* spend of every version of one lineage groups under one id.
*/
const RUN_FORK_CORRELATION_KEYS = Object.freeze([
	"forkParentRunId",
	"forkParentSettleDigest",
	"forkProfileDiffId",
	"lineageRootRunId"
]);
/** The correlation key an accepted uncertain parent adds: its uncertain node ids, comma-joined. */
const FORK_PARENT_UNCERTAIN_NODES_KEY = "forkParentUncertainNodes";
/**
* Verify the parent and derive the fork's profile and attribution. It reads only the parent, so
* a refused fork spends nothing and writes nothing.
*/
async function prepareRunFork(profile, task, opts, fork) {
	const change = fork.change;
	if (typeof change?.id !== "string" || change.id.trim().length === 0) throw new ValidationError("supervisePursuit fork: change.id must be a non-empty string");
	const parentDir = await realDirectory(fork.runDir, "fork.runDir");
	const forkDir = await realDirectory(opts.runDir, "runDir", true);
	if (contains(parentDir, forkDir) || contains(forkDir, parentDir)) throw new ValidationError(`supervisePursuit fork: runDir ${forkDir} overlaps the parent's runDir ${parentDir}; a fork needs its own directory outside the parent's`);
	let bytes;
	try {
		bytes = await readFile(resolve(parentDir, SETTLE_RECORD_FILE));
	} catch (error) {
		if (!isNoEntError(error)) throw error;
		throw new RuntimeRunStateError(`supervisePursuit fork: ${parentDir} holds no ${SETTLE_RECORD_FILE}; only a settled run is forked`);
	}
	const observed = sha256Bytes(bytes);
	if (observed !== fork.settleDigest) throw new RuntimeRunStateError(`supervisePursuit fork: ${SETTLE_RECORD_FILE} hashes to ${observed}, not the requested ${fork.settleDigest}`);
	const settled = await readSettleRecord(parentDir);
	if (settled === void 0) throw new RuntimeRunStateError(`supervisePursuit fork: ${parentDir} lost its settle record`);
	const parentRunId = settled.tree.root;
	if ((opts.runId ?? "supervise") === parentRunId) throw new ValidationError(`supervisePursuit fork: runId '${parentRunId}' is the parent's; a fork needs its own runId`);
	const forest = await loadSpawnForest(new FileSpawnJournal(resolve(parentDir, "spawn-journal.jsonl")), parentRunId);
	const uncertain = [
		...forest.inDoubt.map((node) => `${node.nodeId} (no terminal record)`),
		...forest.missingTrees.map((tree) => `${tree.ownerNodeId} (tree ${tree.root} never begun)`),
		...(settled.teardownUnconfirmed ?? []).map((node) => `${node.id} (teardown unconfirmed)`)
	];
	if (settled.tree.inFlight > 0 && uncertain.length === 0) uncertain.push(`${settled.tree.inFlight} in flight`);
	if (uncertain.length > 0 && fork.acceptUncertain !== true) throw new RuntimeRunStateError(`supervisePursuit fork: run '${parentRunId}' has uncertain nodes: ${uncertain.join(", ")}; set fork.acceptUncertain to fork it anyway`);
	const root = forest.trees[0]?.events.find((event) => event.kind === "spawned" && event.parent === void 0);
	const recorded = root?.identity;
	if (recorded?.profileDigest === void 0 || recorded.taskDigest === void 0) throw new RuntimeRunStateError(`supervisePursuit fork: run '${parentRunId}' records no root profile and task digest`);
	const mismatches = [
		authoredProfileDigest(superviseRootProfile(profile, opts.profileGuidance)) !== recorded.profileDigest ? `profile is not the parent's ${recorded.profileDigest}` : void 0,
		digestOrUndefined(task) !== recorded.taskDigest ? `task is not the parent's ${recorded.taskDigest}` : void 0,
		contentAddress(root?.budget) !== contentAddress(opts.budget) ? "budget is not the parent's" : void 0
	].filter((mismatch) => mismatch !== void 0);
	if (mismatches.length > 0) throw new ValidationError(`supervisePursuit fork: ${mismatches.join("; ")}`);
	const forked = applyExactAgentProfileDiff(profile, change, "supervisePursuit fork");
	if (authoredProfileDigest(superviseRootProfile(forked, opts.profileGuidance)) === recorded.profileDigest) throw new ValidationError(`supervisePursuit fork: change '${change.id}' leaves the parent's profile unchanged`);
	const supplied = opts.execution?.correlation ?? {};
	const owned = [...RUN_FORK_CORRELATION_KEYS, FORK_PARENT_UNCERTAIN_NODES_KEY].filter((key) => Object.hasOwn(supplied, key));
	if (owned.length > 0) throw new ValidationError(`supervisePursuit fork: execution.correlation cannot set ${owned.join(", ")}; Runtime records them`);
	return Object.freeze({
		profile: forked,
		execution: Object.freeze({
			...opts.execution,
			correlation: Object.freeze({
				...supplied,
				forkParentRunId: parentRunId,
				forkParentSettleDigest: fork.settleDigest,
				forkProfileDiffId: change.id,
				lineageRootRunId: recorded.correlation?.lineageRootRunId ?? parentRunId,
				...uncertain.length === 0 ? {} : { [FORK_PARENT_UNCERTAIN_NODES_KEY]: uncertain.join(", ") }
			})
		})
	});
}
function digestOrUndefined(value) {
	try {
		return canonicalCandidateDigest(value);
	} catch {
		return;
	}
}
/**
* Resolve a directory through symlinks. The fork's own directory may not exist yet; it resolves
* through its nearest existing ancestor, so a symlinked ancestor cannot hide an overlap.
*/
async function realDirectory(path, name, mayBeAbsent = false) {
	if (typeof path !== "string" || path.trim().length === 0) throw new ValidationError(`supervisePursuit fork: ${name} must be a non-empty string`);
	const absolute = resolve(path.trim());
	try {
		return await realpath(absolute);
	} catch (error) {
		const ancestor = dirname(absolute);
		if (!mayBeAbsent || !isNoEntError(error) || ancestor === absolute) throw error;
		return join(await realDirectory(ancestor, name, true), basename(absolute));
	}
}
/** Whether `inner` is `outer` or lies beneath it. */
function contains(outer, inner) {
	const path = relative(outer, inner);
	return path === "" || !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}
//#endregion
//#region src/durable/run-lock.ts
/** The lock file `supervisePursuit` holds inside a run directory for the life of one call. */
const RUN_DIRECTORY_LOCK_FILE = "supervise.lock";
/** The directory is held by a live process. `holder` is what that process recorded. */
var RunDirectoryLockedError = class extends Error {
	path;
	holder;
	constructor(path, holder) {
		super(`supervisePursuit: ${path} is held by pid ${holder.pid} (run '${holder.runId}', since ${holder.startedAt}); one process drives a run directory at a time`);
		this.name = "RunDirectoryLockedError";
		this.path = path;
		this.holder = holder;
	}
};
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
async function acquireRunDirectoryLock(runDir, runId, now = Date.now) {
	const dir = resolve(runDir);
	const path = resolve(dir, RUN_DIRECTORY_LOCK_FILE);
	await mkdir(dir, { recursive: true });
	const processStart = await readProcessStart(process.pid);
	const holder = Object.freeze({
		pid: process.pid,
		startedAt: new Date(now()).toISOString(),
		runId,
		...processStart === void 0 ? {} : { processStart }
	});
	return withMutationGuard(path, async () => {
		const existing = await readLockFile(path);
		if (existing.state === "holder" && await holderIsLive(existing.holder)) throw new RunDirectoryLockedError(path, existing.holder);
		if (existing.state !== "missing") await removeIfPresent(path);
		if (!publishExclusiveDurableFile(path, `${JSON.stringify(holder)}\n`)) throw new Error(`supervisePursuit: could not take ${path}`);
		let released = false;
		return Object.freeze({
			...holder,
			path,
			release: async () => {
				if (released) return;
				await releaseHolder(path, holder);
				released = true;
			}
		});
	});
}
/** Read the holder a lock file names, or `undefined` when no lock file names one. */
async function readRunDirectoryLock(runDir) {
	const existing = await readLockFile(resolve(runDir, RUN_DIRECTORY_LOCK_FILE));
	return existing.state === "holder" ? existing.holder : void 0;
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
async function runDirectoryHolderIsLive(runDir) {
	const existing = await readLockFile(resolve(runDir, RUN_DIRECTORY_LOCK_FILE));
	if (existing.state !== "holder") return { live: false };
	return {
		live: await holderIsLive(existing.holder),
		holder: existing.holder
	};
}
const execFileAsync = promisify(execFile);
/**
* The OS's start token for a live pid: on Linux the `starttime` field of `/proc/<pid>/stat`
* (clock ticks since boot), elsewhere the `ps` `lstart` column. The same process reports the
* same token for its whole life and a later holder of the pid reports a different one.
* `undefined` when the host cannot report one: the pid is gone, there is no `/proc` and no
* `ps`, or the platform is Windows.
*/
async function readProcessStart(pid) {
	if (!Number.isInteger(pid) || pid <= 0 || process.platform === "win32") return void 0;
	if (process.platform === "linux") {
		let stat;
		try {
			stat = await readFile(`/proc/${pid}/stat`, "utf8");
		} catch {
			return;
		}
		const startTime = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/u)[19];
		return startTime !== void 0 && /^\d+$/u.test(startTime) ? startTime : void 0;
	}
	try {
		const { stdout } = await execFileAsync("ps", [
			"-o",
			"lstart=",
			"-p",
			String(pid)
		]);
		const token = stdout.trim();
		return token.length === 0 ? void 0 : token;
	} catch {
		return;
	}
}
async function readLockFile(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isNoEntError(error)) return { state: "missing" };
		throw error;
	}
	if (text.trim().length === 0) return { state: "empty" };
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (cause) {
		throw new Error(`supervisePursuit: ${path} is not a readable lock file; remove it by hand`, { cause });
	}
	const record = parsed;
	if (typeof record !== "object" || record === null || typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0 || typeof record.startedAt !== "string" || typeof record.runId !== "string" || record.processStart !== void 0 && typeof record.processStart !== "string") throw new Error(`supervisePursuit: ${path} is not a readable lock file; remove it by hand`);
	const { pid, startedAt, runId, processStart } = record;
	return {
		state: "holder",
		holder: Object.freeze({
			pid,
			startedAt,
			runId,
			...processStart === void 0 ? {} : { processStart }
		})
	};
}
async function holderIsLive(holder) {
	if (!processExists(holder.pid)) return false;
	if (holder.processStart === void 0) return true;
	const current = await readProcessStart(holder.pid);
	return current === void 0 || current === holder.processStart;
}
function processExists(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
/** Remove the lock only while it still names this holder; a reclaimed lock belongs to its new owner. */
async function releaseHolder(path, holder) {
	await withMutationGuard(path, async () => {
		const existing = await readLockFile(path);
		if (existing.state !== "holder") return;
		if (existing.holder.pid !== holder.pid || existing.holder.startedAt !== holder.startedAt || existing.holder.runId !== holder.runId || existing.holder.processStart !== holder.processStart) return;
		await removeIfPresent(path);
	}, true);
}
/** Serialize stale reclamation and release; an abandoned guard requires operator recovery. */
async function withMutationGuard(path, mutate, waitForRelease = false) {
	const guard = `${path}.guard`;
	const deadline = performance.now() + (waitForRelease ? 1e3 : 0);
	for (;;) try {
		await mkdir(guard);
		break;
	} catch (cause) {
		if (waitForRelease && cause.code === "EEXIST" && performance.now() < deadline) {
			await setTimeout$1(10);
			continue;
		}
		throw new Error(`supervisePursuit: cannot mutate ${path}; inspect ${guard} and remove it only after confirming no lock mutation is active`, { cause });
	}
	try {
		return await mutate();
	} finally {
		await rmdir(guard);
	}
}
async function removeIfPresent(path) {
	try {
		await unlink(path);
	} catch (error) {
		if (!isNoEntError(error)) throw error;
	}
}
//#endregion
//#region src/durable/pursuit-versions.ts
/** The longest delay Node's setTimeout honors. */
const MAX_TIMER_MS = 2147483647;
/** The ledger file inside the lineage directory. */
const PURSUIT_VERSIONS_FILE = "versions.jsonl";
/** The `<runDir>.v<n>` directory and `<runId>.v<n>` id of version `n`, beside the first. */
function pursuitVersionRun(runDir, runId, version) {
	return version === 1 ? {
		runDir,
		runId
	} : {
		runDir: `${runDir}.v${version}`,
		runId: `${runId}.v${version}`
	};
}
/**
* Validate a `versions` option before any compute. The same check runs inside `supervisePursuit`;
* a caller that records the option as data can run it at preflight.
*/
function assertPursuitVersions(versions) {
	const fail = (message) => {
		throw new ValidationError(`supervisePursuit versions: ${message}`);
	};
	if (typeof versions !== "object" || versions === null) fail("must be an object");
	const { judge, next, stop, run } = versions;
	if (typeof judge !== "object" || judge === null || typeof judge.judge !== "function") fail("judge must be a VersionJudge, such as declaredCheckJudge(check)");
	else if (!isSha256(judge.digest)) fail("judge.digest must be a sha256 digest (sha256:<64 hex>)");
	if (next !== "review-of-best" && typeof next !== "function") fail("next must be a function or 'review-of-best'");
	if (run !== void 0 && typeof run !== "function") fail("run must be a function when set");
	const { usd } = versions;
	if (usd !== void 0 && typeof usd !== "function") fail("usd must be a function when set");
	if (typeof stop !== "object" || stop === null) fail("stop must be an object");
	const rule = stop;
	const known = /* @__PURE__ */ new Set([
		"patience",
		"maxVersions",
		"maxUsd",
		"deadlineMs",
		"minImprovement"
	]);
	const unknown = Object.keys(rule).filter((key) => !known.has(key));
	if (unknown.length > 0) fail(`stop has unknown fields: ${unknown.join(", ")}`);
	for (const key of ["patience", "maxVersions"]) if (!Number.isInteger(rule[key]) || rule[key] < 1) fail(`stop.${key} must be an integer of at least 1`);
	for (const key of ["maxUsd", "deadlineMs"]) if (typeof rule[key] !== "number" || !Number.isFinite(rule[key]) || rule[key] <= 0) fail(`stop.${key} must be a finite number above 0`);
	if (rule.minImprovement !== void 0 && (typeof rule.minImprovement !== "number" || !Number.isFinite(rule.minImprovement) || rule.minImprovement < 0)) fail("stop.minImprovement must be a finite number of at least 0");
}
/** Run a version chain. `supervisePursuit` calls this when `versions` is set. */
async function runPursuitVersions(profile, task, opts, runOne) {
	const { versions, ...rest } = opts;
	assertPursuitVersions(versions);
	for (const key of [
		"journal",
		"blobs",
		"rootHandle",
		"steerDir"
	]) if (rest[key] !== void 0) throw new ValidationError(`supervisePursuit versions: ${key} names one run, and a version chain has one per version; omit it`);
	const judge = versions.judge;
	if (versions.next === "review-of-best" && rest.continuation?.profile.review === void 0) throw new ValidationError("supervisePursuit versions: next 'review-of-best' needs continuation.profile.review, the words the next version reads about its review");
	const next = versions.next === "review-of-best" ? reviewOfBest(rest.runId ?? "supervise", rest.continuation?.profile.review ?? "") : versions.next;
	const stop = versions.stop;
	const minImprovement = stop.minImprovement ?? 0;
	const now = rest.now ?? Date.now;
	const pursuitId = rest.pursuitId.trim();
	const runDir = resolve(rest.runDir.trim());
	const runId = rest.runId ?? "supervise";
	const { fork: firstFork, signal: callerSignal, ...base } = rest;
	const lineageDir = `${runDir}.versions`;
	const ledgerPath = resolve(lineageDir, PURSUIT_VERSIONS_FILE);
	const firstProfile = firstFork === void 0 ? profile : applyExactAgentProfileDiff(profile, firstFork.change, "supervisePursuit versions");
	await mkdir(lineageDir, { recursive: true });
	const lock = await acquireRunDirectoryLock(lineageDir, `${runId}:versions`, now);
	try {
		const ledger = await readLedger(ledgerPath);
		let chain = ledger.find((line) => line.kind === "chain");
		if (chain === void 0) {
			const elapsed = (await readSettleRecord(runDir))?.spentTotal?.ms;
			const startedAt = new Date(now() - (typeof elapsed === "number" && Number.isFinite(elapsed) ? elapsed : 0)).toISOString();
			chain = {
				kind: "chain",
				pursuitId,
				runId,
				runDir,
				judgeDigest: judge.digest,
				stop: canonicalStop(stop),
				startedAt
			};
			await appendLedger(ledgerPath, chain);
		} else {
			const mismatch = [
				chain.pursuitId !== pursuitId ? `pursuitId '${chain.pursuitId}'` : void 0,
				chain.runId !== runId ? `runId '${chain.runId}'` : void 0,
				chain.runDir !== runDir ? `runDir '${chain.runDir}'` : void 0,
				chain.judgeDigest !== judge.digest ? `judge digest ${chain.judgeDigest}` : void 0,
				contentAddress(chain.stop) !== contentAddress(canonicalStop(stop)) ? "another stop rule" : void 0
			].filter((item) => item !== void 0);
			if (mismatch.length > 0) throw new ValidationError(`supervisePursuit versions: ${ledgerPath} records a chain with ${mismatch.join(", ")}; a chain keeps its identity, judge and stop rule`);
		}
		const startedAtMs = Date.parse(chain.startedAt);
		const deadline = new AbortController();
		let timer;
		const arm = () => {
			const remaining = startedAtMs + stop.deadlineMs - now();
			if (remaining <= 0) {
				deadline.abort(/* @__PURE__ */ new Error("the version chain reached its deadline"));
				return;
			}
			timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
			timer.unref?.();
		};
		arm();
		const signal = callerSignal === void 0 ? deadline.signal : AbortSignal.any([callerSignal, deadline.signal]);
		try {
			const judged = [];
			const profiles = /* @__PURE__ */ new Map([[1, firstProfile]]);
			let pending = {
				version: 1,
				runId,
				runDir
			};
			let stopped;
			for (const line of ledger) if (line.kind === "start") {
				const parentProfile = profiles.get(line.parent.version);
				if (parentProfile === void 0) throw new RuntimeRunStateError(`supervisePursuit versions: ${ledgerPath} starts version ${line.version} from unknown version ${line.parent.version}`);
				profiles.set(line.version, applyExactAgentProfileDiff(parentProfile, line.change, "supervisePursuit versions"));
				pending = {
					version: line.version,
					runId: line.runId,
					runDir: line.runDir,
					parent: line.parent,
					change: line.change
				};
			} else if (line.kind === "judged") {
				if (line.version !== judged.length + 1 || line.version !== pending?.version) throw new RuntimeRunStateError(`supervisePursuit versions: ${ledgerPath} judges version ${line.version} out of order`);
				if (line.verdict.judgeDigest !== judge.digest) throw new ValidationError(`supervisePursuit versions: version ${line.version} was judged under ${line.verdict.judgeDigest}, not ${judge.digest}`);
				const settled = await readSettled(pending, profiles);
				if (settled.settleDigest !== line.settleDigest) throw new RuntimeRunStateError(`supervisePursuit versions: version ${line.version}'s result.json changed after it was judged`);
				judged.push(Object.freeze({
					...settled,
					verdict: line.verdict,
					improved: line.improved,
					usd: line.usd,
					usdKnown: line.usdKnown,
					usdSource: line.usdSource,
					...line.lineage === void 0 ? {} : { lineage: line.lineage }
				}));
				pending = void 0;
			} else if (line.kind === "stopped") stopped = line;
			while (stopped === void 0) {
				if (pending !== void 0) {
					const spec = pending;
					const settled = await settle(spec);
					const verdict = await judgeVersion(settled);
					const bestScore = bestOf(judged)?.verdict.score;
					const improved = isFiniteNumber(verdict.score) && (!isFiniteNumber(bestScore) || verdict.score > bestScore + minImprovement);
					const spent = settled.result.spentTotal;
					const measured = versions.usd === void 0 ? void 0 : await versions.usd(settled, signal);
					const usdSource = measured === void 0 ? "runtime" : "caller";
					const usd = measured === void 0 ? isFiniteNumber(spent?.usd) ? spent.usd : null : isFiniteNumber(measured) ? measured : null;
					const usdKnown = usd !== null && (measured !== void 0 || spent?.usdKnown !== false);
					const lineage = versionLineage(spec, firstFork);
					await appendLedger(ledgerPath, {
						kind: "judged",
						version: spec.version,
						runId: spec.runId,
						runDir: spec.runDir,
						settleDigest: settled.settleDigest,
						...spec.parent === void 0 ? {} : { parent: spec.parent },
						...spec.change?.id === void 0 ? {} : { changeId: spec.change.id },
						verdict,
						improved,
						usd,
						usdKnown,
						usdSource,
						...lineage === void 0 ? {} : { lineage }
					});
					judged.push(Object.freeze({
						...settled,
						verdict,
						improved,
						usd,
						usdKnown,
						usdSource,
						...lineage === void 0 ? {} : { lineage }
					}));
					pending = void 0;
				}
				const reason = stopReason(judged);
				if (reason !== void 0) {
					stopped = {
						kind: "stopped",
						reason,
						at: new Date(now()).toISOString(),
						best: (bestOf(judged) ?? judged[0]).version,
						spentUsd: spentOf(judged)
					};
					await appendLedger(ledgerPath, stopped);
					break;
				}
				const best = bestOf(judged) ?? judged[0];
				const last = judged[judged.length - 1];
				const change = await next({
					best,
					last,
					versions: Object.freeze([...judged])
				}, signal);
				if (typeof change?.id !== "string" || change.id.trim().length === 0) throw new ValidationError("supervisePursuit versions: next must return a change with an id");
				const version = judged.length + 1;
				const spec = {
					version,
					...pursuitVersionRun(runDir, runId, version),
					parent: {
						version: best.version,
						runId: best.runId,
						settleDigest: best.settleDigest
					},
					change
				};
				profiles.set(version, applyExactAgentProfileDiff(best.profile, change, "supervisePursuit versions"));
				await appendLedger(ledgerPath, {
					kind: "start",
					version,
					runId: spec.runId,
					runDir: spec.runDir,
					parent: spec.parent,
					change
				});
				pending = spec;
			}
			const bestVersion = judged.find((item) => item.version === stopped.best) ?? judged[0];
			const record = Object.freeze({
				lineageDir,
				judgeDigest: judge.digest,
				stop: canonicalStop(stop),
				startedAt: chain.startedAt,
				versions: Object.freeze([...judged]),
				best: bestVersion.version,
				spentUsd: stopped.spentUsd,
				stopped: Object.freeze({
					reason: stopped.reason,
					at: stopped.at
				})
			});
			const observerPath = resolve(bestVersion.runDir, "observer.jsonl");
			return Object.freeze({
				result: bestVersion.result,
				pursuit: projectPursuit(await new FileObserverJournal(observerPath, pursuitId).read()),
				observerPath,
				settlePath: resolve(bestVersion.runDir, SETTLE_RECORD_FILE),
				versions: record
			});
			/** Run the version unless its directory already settled, then read it back. */
			async function settle(spec) {
				if (await readSettleRecord(spec.runDir) === void 0) {
					if (signal.aborted) throw new RuntimeRunStateError(`supervisePursuit versions: version ${spec.version} was not started: ${abortMessage(signal)}`);
					if (spec.parent === void 0 || spec.change === void 0) await runOne(profile, task, {
						...base,
						...firstFork === void 0 ? {} : { fork: firstFork },
						signal
					});
					else {
						const parent = judged.find((item) => item.version === spec.parent.version);
						if (parent === void 0) throw new RuntimeRunStateError(`supervisePursuit versions: version ${spec.version}'s parent ${spec.parent.version} is not judged`);
						const fork = {
							runDir: parent.runDir,
							settleDigest: parent.settleDigest,
							change: spec.change,
							acceptUncertain: true
						};
						const bar = base.continuation !== void 0 && parent.verdict.check !== void 0 ? { continuation: {
							...base.continuation,
							best: {
								label: `v${parent.version}`,
								verdict: parent.verdict.check
							}
						} } : {};
						const options = {
							...base,
							...bar,
							runId: spec.runId,
							runDir: spec.runDir,
							fork,
							signal
						};
						if (versions.run === void 0) await runOne(parent.profile, task, options);
						else {
							const prepared = await prepareRunFork(parent.profile, task, options, fork);
							await versions.run(Object.freeze({
								version: spec.version,
								runId: spec.runId,
								runDir: spec.runDir,
								pursuitId,
								profile: prepared.profile,
								task,
								budget: base.budget,
								execution: prepared.execution,
								fork,
								parentProfile: parent.profile
							}), signal);
						}
					}
				}
				const settled = await readSettled(spec, profiles);
				if (settled === void 0) throw new RuntimeRunStateError(`supervisePursuit versions: version ${spec.version} returned without a settle record in ${spec.runDir}`);
				return settled;
			}
			async function judgeVersion(settled) {
				const verdict = await judge.judge(settled, signal);
				if (typeof verdict !== "object" || verdict === null) throw new ValidationError("supervisePursuit versions: the judge returned no verdict");
				if (verdict.judgeDigest !== judge.digest) throw new ValidationError(`supervisePursuit versions: the verdict for version ${settled.version} carries ${String(verdict.judgeDigest)}, not the pinned judge ${judge.digest}`);
				if (verdict.score !== null && !isFiniteNumber(verdict.score)) throw new ValidationError("supervisePursuit versions: a verdict score must be a finite number or null");
				return JSON.parse(JSON.stringify(verdict));
			}
			function stopReason(done) {
				if (callerSignal?.aborted) return "aborted";
				if (done.length >= stop.maxVersions) return "max-versions";
				let stale = 0;
				for (let index = done.length - 1; index >= 0 && !done[index].improved; index -= 1) stale += 1;
				if (stale >= stop.patience) return "no-improvement";
				if (done.some((item) => item.usd === null)) return "spend-unknown";
				if (spentOf(done) >= stop.maxUsd) return "max-usd";
				if (deadline.signal.aborted || now() - startedAtMs >= stop.deadlineMs) return "deadline";
			}
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	} finally {
		await lock.release();
	}
}
async function readSettled(spec, profiles) {
	let bytes;
	try {
		bytes = await readFile(resolve(spec.runDir, SETTLE_RECORD_FILE));
	} catch (error) {
		if (!isNoEntError(error)) throw error;
		throw new RuntimeRunStateError(`supervisePursuit versions: version ${spec.version} has no settle record in ${spec.runDir}`);
	}
	const result = await readSettleRecord(spec.runDir);
	const profile = profiles.get(spec.version);
	if (profile === void 0) throw new RuntimeRunStateError(`supervisePursuit versions: version ${spec.version} has no recorded profile`);
	return Object.freeze({
		version: spec.version,
		runId: spec.runId,
		runDir: spec.runDir,
		settleDigest: sha256Bytes(bytes),
		result,
		profile,
		...spec.parent === void 0 ? {} : { parent: spec.parent },
		...spec.change === void 0 ? {} : { change: spec.change }
	});
}
function versionLineage(spec, firstFork) {
	if (spec.parent !== void 0 && spec.change !== void 0) return {
		source: lineageSource(spec.change),
		runIds: [spec.parent.runId],
		profileDiffIds: [spec.change.id]
	};
	if (firstFork !== void 0) return {
		source: lineageSource(firstFork.change),
		profileDiffIds: [firstFork.change.id]
	};
}
/** The change's author, in the lineage's words. A trace-derived change is a compound of runs. */
function lineageSource(change) {
	const kind = change.source?.kind;
	return kind === "human" || kind === "optimizer" || kind === "frontier-author" ? kind : "compound";
}
function bestOf(done) {
	let best;
	for (const item of done) {
		if (!isFiniteNumber(item.verdict.score)) continue;
		if (best === void 0 || item.verdict.score > best.verdict.score) best = item;
	}
	return best;
}
function spentOf(done) {
	return done.reduce((sum, item) => sum + (item.usd ?? 0), 0);
}
function canonicalStop(stop) {
	return {
		patience: stop.patience,
		maxVersions: stop.maxVersions,
		maxUsd: stop.maxUsd,
		deadlineMs: stop.deadlineMs,
		...stop.minImprovement === void 0 ? {} : { minImprovement: stop.minImprovement }
	};
}
/** Where `'review-of-best'` mounts a review: `inputs/review/version-<n>.md`. One review lives in
*  a profile at a time. */
const REVIEW_DIR = "inputs/review/";
/**
* `'review-of-best'`: fork from the best version with its check's verdict mounted under
* {@link REVIEW_DIR} and the profile's review words as one instruction. The previous review's
* mount and instruction are removed, so a profile carries one review. This is what the Lab's
* `continue-best` changes did in Lab code, now written once from the check's own verdict.
*/
function reviewOfBest(runId, words) {
	return ({ best, versions }) => {
		const n = versions.length + 1;
		const verdict = best.verdict.check;
		const path = `${REVIEW_DIR}version-${best.version}.md`;
		const instruction = words.replaceAll("{version}", String(best.version)).replaceAll("{path}", path).replaceAll("{score}", best.verdict.score === null ? "none" : String(best.verdict.score)).trim();
		const page = reviewPage(best.version, best.verdict.score, verdict);
		const earlierInstructions = best.change?.set?.prompt?.instructions ?? [];
		const earlierMounts = (best.profile.resources?.files ?? []).map((file) => file.path).filter((mounted) => mounted.startsWith("inputs/review/") && mounted !== path);
		return {
			kind: "agent-profile-diff",
			id: `${runId}-v${n}-review-of-v${best.version}`,
			title: `Version ${n}: review of version ${best.version}`,
			source: {
				kind: "optimizer",
				notes: [`review-of-best: version ${best.version}`, `judge ${best.verdict.judgeDigest}`]
			},
			set: {
				prompt: { instructions: [instruction] },
				resources: { files: [{
					path,
					resource: {
						kind: "inline",
						name: path,
						content: page
					}
				}] }
			},
			...earlierInstructions.length > 0 || earlierMounts.length > 0 ? { remove: {
				...earlierInstructions.length > 0 ? { prompt: { instructions: [...earlierInstructions] } } : {},
				...earlierMounts.length > 0 ? { resources: { files: earlierMounts } } : {}
			} } : {}
		};
	};
}
/** The review page: facts only, in the check's own lines. */
function reviewPage(version, score, verdict) {
	if (verdict === void 0) return [
		`# Version ${version}`,
		"",
		`Score: ${score ?? "none"}. The judge reported no per-item verdict.`,
		""
	].join("\n");
	const failing = failedItems(verdict);
	return [
		`# Version ${version}`,
		"",
		`Score: ${score ?? "none"}.${verdict.threshold === void 0 ? "" : ` The check passes at ${verdict.threshold}.`}`,
		"",
		"## Items",
		"",
		...Object.entries(verdict.items ?? {}).map(([item, value]) => `- ${item}: ${value >= 1 ? "passes" : `fails (${value})`}`),
		"",
		...failing.length === 0 ? [] : [
			"## Failures",
			"",
			...verdict.failures ?? [],
			""
		],
		...verdict.review === void 0 ? [] : [
			"## The check's review",
			"",
			verdict.review,
			""
		]
	].join("\n");
}
async function readLedger(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isNoEntError(error)) return [];
		throw error;
	}
	return parseCommittedJsonLines(text, path);
}
async function appendLedger(path, line) {
	const endsWithRecord = await prepareJsonlAppend(path);
	const handle = await open(path, "a");
	try {
		await writeAllBytes(handle, `${endsWithRecord ? "\n" : ""}${JSON.stringify(line)}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}
}
function isSha256(value) {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}
function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}
function abortMessage(signal) {
	const reason = signal.reason;
	return reason instanceof Error ? reason.message : String(reason ?? "aborted");
}
//#endregion
//#region src/durable/supervise-pursuit.ts
/** A failed Runtime execution whose complete third-person projection was retained. */
var SupervisePursuitError = class extends Error {
	pursuit;
	observerPath;
	/** `runDir/failure.json`: the record of this throw. */
	failurePath;
	constructor(cause, pursuit, observerPath, failurePath) {
		super(`supervisePursuit: ${errorMessage(cause)}`, { cause });
		this.name = "SupervisePursuitError";
		this.pursuit = pursuit;
		this.observerPath = observerPath;
		this.failurePath = failurePath;
	}
};
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
async function supervisePursuit(profile, task, opts) {
	const pursuitId = opts.pursuitId.trim();
	if (pursuitId.length === 0) throw new TypeError("supervisePursuit: pursuitId must be non-empty");
	const runDir = opts.runDir.trim();
	if (runDir.length === 0) throw new TypeError("supervisePursuit: runDir must be non-empty");
	if (opts.retainedAtSettlement === "keep") throw new TypeError("supervisePursuit: retainedAtSettlement 'keep' cannot hold, because a settled pursuit is never re-entered");
	if (opts.versions !== void 0) return runPursuitVersions(profile, task, opts, supervisePursuit);
	const observerPath = resolve(runDir, "observer.jsonl");
	const settlePath = resolve(runDir, SETTLE_RECORD_FILE);
	const failurePath = resolve(runDir, FAILURE_RECORD_FILE);
	const { pursuitId: _pursuitId, hooks, fork, versions: _versions, ...superviseOptions } = opts;
	const runId = superviseOptions.runId ?? "supervise";
	const now = superviseOptions.now ?? Date.now;
	const forked = fork === void 0 ? void 0 : await prepareRunFork(profile, task, superviseOptions, fork);
	const lock = await acquireRunDirectoryLock(runDir, runId, now);
	try {
		const settled = await readSettleRecord(runDir);
		if (settled !== void 0) throw new SettledRunDirectoryError(settlePath, settled.tree.root, runId);
		const observer = createFileObserverHooks(observerPath, pursuitId);
		await observer.journal.appendEvent(rootEvent(pursuitId, runId, "before", now()));
		let result;
		try {
			result = await supervise(forked?.profile ?? profile, task, {
				...superviseOptions,
				...forked === void 0 ? {} : { execution: forked.execution },
				steerDir: superviseOptions.steerDir ?? supervisorRunDir(runDir, runId),
				retainedAtSettlement: "release",
				hooks: withPursuitContext(pursuitId, composeRuntimeHooks(observer.hooks, hooks))
			});
		} catch (error) {
			let pursuit;
			let observerError;
			try {
				await observer.journal.appendEvent(rootEvent(pursuitId, runId, "error", now(), {
					status: "failed",
					error: errorMessage(error)
				}));
				pursuit = projectPursuit(await observer.journal.read());
			} catch (failure) {
				observerError = failure;
			}
			if (observerError !== void 0 || pursuit === void 0) throw new Error("supervisePursuit: Runtime failed and durable observer completeness could not be proven", { cause: new AggregateError(observerError === void 0 ? [error] : [error, observerError]) });
			try {
				const rootStream = await readRootStreamReceipt(runDir);
				await writeFailureRecord(runDir, {
					runId,
					pursuitId,
					at: new Date(now()).toISOString(),
					error: {
						name: errorName(error),
						message: errorMessage(error)
					},
					...rootStream === void 0 ? {} : { rootStream }
				});
			} catch (recordError) {
				throw new Error(`supervisePursuit: Runtime failed and the failure record ${failurePath} could not be written`, { cause: new AggregateError([error, recordError]) });
			}
			throw new SupervisePursuitError(error, pursuit, observerPath, failurePath);
		}
		try {
			await writeSettleRecord(runDir, result);
		} catch (cause) {
			throw new Error(`supervisePursuit: Runtime settled but the settle record ${settlePath} could not be written`, { cause });
		}
		await observer.journal.appendEvent(rootEvent(pursuitId, runId, "after", now(), { status: "done" }));
		return Object.freeze({
			result,
			pursuit: projectPursuit(await observer.journal.read()),
			observerPath,
			settlePath
		});
	} finally {
		await lock.release();
	}
}
function rootEvent(pursuitId, runId, phase, timestamp, payload) {
	return Object.freeze({
		id: `${runId}:pursuit:${phase}:${timestamp}`,
		pursuitId,
		runId,
		target: "agent.run",
		phase,
		timestamp,
		...payload ? { payload: Object.freeze({ ...payload }) } : {}
	});
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function errorName(error) {
	return error instanceof Error ? error.name : "NonError";
}
//#endregion
//#region src/durable/supervision-discovery.ts
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
async function discoverDurableSupervisionRun(runDir) {
	if (typeof runDir !== "string" || runDir.trim().length === 0) throw new TypeError("discoverDurableSupervisionRun: runDir must be a non-empty string");
	const canonicalRunDir = resolve(runDir);
	const spawnJournalPath = `${canonicalRunDir}/spawn-journal.jsonl`;
	const coordinationLogPath = `${canonicalRunDir}/coordination-log.jsonl`;
	const allRoots = /* @__PURE__ */ new Set();
	const nestedRoots = /* @__PURE__ */ new Set();
	const rootsBegunAt = /* @__PURE__ */ new Map();
	for await (const record of readCommittedJsonLines(spawnJournalPath, { allowMissing: true })) {
		if (record.kind === "begin") {
			if (typeof record.root !== "string" || record.root.length === 0) throw new Error(`${spawnJournalPath}: begin record has no non-empty string root identity`);
			allRoots.add(record.root);
			rootsBegunAt.set(record.root, typeof record.at === "string" ? record.at : null);
			continue;
		}
		if (record.kind !== "event") continue;
		const event = record.event;
		if (!isRecord(event) || event.kind !== "spawned") continue;
		if (!Object.hasOwn(event, "ownedTreeRoot")) continue;
		if (typeof event.ownedTreeRoot !== "string" || event.ownedTreeRoot.length === 0) throw new Error(`${spawnJournalPath}: spawned event ownedTreeRoot must be a non-empty string when present`);
		nestedRoots.add(event.ownedTreeRoot);
	}
	const streams = /* @__PURE__ */ new Map();
	for await (const record of readCommittedJsonLines(coordinationLogPath, { allowMissing: true })) {
		if (typeof record.runId !== "string" || record.runId.length === 0) throw new Error(`${coordinationLogPath}: record has no non-empty string runId identity`);
		const stream = streams.get(record.runId) ?? {
			owners: /* @__PURE__ */ new Set(),
			unscopedRecords: 0,
			recordCount: 0
		};
		stream.recordCount += 1;
		if (record.ownerId === void 0) stream.unscopedRecords += 1;
		else if (typeof record.ownerId === "string" && record.ownerId.length > 0) stream.owners.add(record.ownerId);
		else throw new Error(`${coordinationLogPath}: ownerId must be a non-empty string when present`);
		streams.set(record.runId, stream);
	}
	const coordinationStreams = [...streams.entries()].sort(([left], [right]) => compareText(left, right)).map(([runId, stream]) => Object.freeze({
		runId,
		ownerIds: Object.freeze([...stream.owners].sort(compareText)),
		unscopedRecords: stream.unscopedRecords,
		recordCount: stream.recordCount
	}));
	const roots = [...allRoots].filter((root) => !nestedRoots.has(root)).sort(compareText);
	return Object.freeze({
		runDir: canonicalRunDir,
		spawnJournalPath,
		coordinationLogPath,
		roots: Object.freeze(roots),
		rootsBegunAt: Object.freeze(roots.map((root) => rootsBegunAt.get(root) ?? null)),
		coordinationStreams: Object.freeze(coordinationStreams)
	});
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
//#endregion
export { FAILURE_RECORD_FILE, FORK_PARENT_UNCERTAIN_NODES_KEY, FileObserverJournal, PURSUIT_VERSIONS_FILE, REVIEW_DIR, ROOT_STREAM_FILE, RUN_DIRECTORY_LOCK_FILE, RUN_FORK_CORRELATION_KEYS, RunDirectoryLockedError, SETTLE_RECORD_FILE, SettledRunDirectoryError, SupervisePursuitError, acquireRunDirectoryLock, assertPursuitVersions, createFileObserverHooks, deriveExecutionId, discoverDurableSupervisionRun, handleChatTurn, observerRecordDigest, projectPursuit, pursuitVersionRun, readFailureRecord, readRootStream, readRootStreamReceipt, readRunDirectoryLock, readSettleRecord, runDirectoryHolderIsLive, settleRecordJson, supervisePursuit, verifyObserverRecords };

//# sourceMappingURL=durable.js.map