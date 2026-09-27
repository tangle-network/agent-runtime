import { a as writeAtomicDurableFile, n as assertNoSymlinkDescendant, r as publishExclusiveDurableFile, t as appendDurableFile } from "./durable-file-DWQA4ooo.js";
import { canonicalCandidateDigest } from "@tangle-network/agent-interface";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
//#region src/runtime/supervise/run-layout.ts
/**
* The on-disk supervisor-run layout: `<root>/.agent/supervisor/<id>`.
*
* This is the durable, cross-process face of a supervisor run — the counterpart to the in-process
* `Inbox` seam in `./inbox`. A run persists its state under one directory so that any OTHER process
* can find it after the fact: `@tangle-network/traces` reads exactly this layout via
* `traces analyze --supervisor-run-dir`, a restarted host can rehydrate a run it no longer holds
* handles to, and a human can steer a live worker by appending one NDJSON line. Until now the
* layout was defined only in the unpublished `loops` repo (`src/supervisor-control.ts`) — a
* published reader depending on an unpublished writer's convention — so the contract is promoted
* here, names preserved.
*
* `.agent` is the one dot-dir for ALL agent-owned state (skills already write
* `.agent/hypotheses/`, `.agent/skill-runs.jsonl`); supervisor runs live beside them rather than
* under a product-branded dir. Runs written by older writers used `.loops/supervisor/<id>` —
* readers that must see those keep a legacy fallback; this writer never creates `.loops` again.
*
* Layout, relative to `supervisorRunDir(root, id)`:
*
*   steers/requests/<hash>.json    one exact, caller-idempotent {@link WorkerSteerRequest}
*   steers/acks/<hash>.json        runtime acknowledgement for that steer operation
*   workers/<id>.inbox.ndjson      best-effort readable projection of admitted steer requests
*   workers/<label>.ndjson         best-effort per-worker control-event log (delivery bookkeeping)
*   cancellations/requests.ndjson  worker-scoped cancel requests (durable inbox); each line is a
*                                  {@link WorkerCancelRequest}
*   cancellations/<opId>.json      the acknowledgement for one cancel operation — a
*                                  {@link WorkerCancellation} written ONLY by the runtime
*                                  acknowledger in the OWNING manager's turn loop: exact node
*                                  ids route to the manager that parents them (any depth);
*                                  label/profile-name references to the root manager alone
*   cancellations/run.request.json the run-scoped cancel request — one {@link RunCancelRequest},
*                                  the whole RUN rather than one worker
*   cancellations/run.json         the acknowledgement for the run-scoped request — a
*                                  {@link RunCancellation} written ONLY by the runtime (the root
*                                  manager issues the abort; the `supervise()` settle path records
*                                  what the run actually did)
*
* Reads are tolerant by contract: a partial trailing line (a writer mid-append) or a corrupt line
* never poisons the rest of the file — later valid lines still matter. Duplicate operation ids
* collapse to the first admitted request, while a payload conflict fails closed.
*
* Promoted from `loops/src/supervisor-control.ts`. Steer admission now requires the exact worker id
* and a caller-owned operation id. One atomic request file is the durable inbox; the NDJSON file is
* a readable projection only and never controls idempotency.
*
* @experimental
*/
/** The root every supervisor run of one workspace lives under. */
function supervisorRunsRoot(rootDir) {
	return join(resolve(rootDir), ".agent", "supervisor");
}
/** The run directory every artifact of one supervisor run lives under. */
function supervisorRunDir(rootDir, id) {
	return join(supervisorRunsRoot(rootDir), id);
}
/**
* Where a pre-rename writer put the same run (`<root>/.loops/supervisor/<id>`). Readers that must
* see historical runs check {@link supervisorRunDir} first and fall back to this; nothing writes
* here anymore.
*/
function legacySupervisorRunDir(rootDir, id) {
	return join(legacySupervisorRunsRoot(rootDir), id);
}
/**
* The pre-rename runs root (`<root>/.loops/supervisor`). Only readers that ENUMERATE historical
* runs need this — the per-id form is {@link legacySupervisorRunDir}. Nothing writes here.
*/
function legacySupervisorRunsRoot(rootDir) {
	return join(resolve(rootDir), ".loops", "supervisor");
}
/** A worker label reduced to a safe filename stem. Empty labels get a stable fallback. */
function safeWorkerFile(label) {
	const safe = label.replace(/[^A-Za-z0-9._-]/g, "_");
	return safe.length > 0 ? safe : "worker";
}
/** The directory holding every per-worker file of one run (inboxes and control-event logs). */
function supervisorWorkersDir(eventDir) {
	return join(eventDir, "workers");
}
/** The durable inbox file for one worker of one run. */
function workerInboxFile(rootDir, supervisorId, worker) {
	return workerInboxFileFromEventDir(supervisorRunDir(rootDir, supervisorId), worker);
}
/** Same, addressed from an already-known run directory (the reader's usual entry point). */
function workerInboxFileFromEventDir(eventDir, worker) {
	return join(supervisorWorkersDir(eventDir), `${safeWorkerFile(worker)}.inbox.ndjson`);
}
/**
* The best-effort control-event log for one worker (`workers/<label>.ndjson`) — delivery
* bookkeeping for steers, plus whatever lifecycle events a writer chooses to append. Distinct from
* the inbox: the inbox is the durable down-leg queue, this is the record of what happened to it.
*/
function workerControlLogFile(eventDir, worker) {
	return join(supervisorWorkersDir(eventDir), `${safeWorkerFile(worker)}.ndjson`);
}
/** Directory containing atomically admitted steer requests and runtime acknowledgements. */
function workerSteersDir(eventDir) {
	return join(eventDir, "steers");
}
/** Directory containing one canonical request file per steer operation. */
function workerSteerRequestsDir(eventDir) {
	return join(workerSteersDir(eventDir), "requests");
}
/** Directory containing one runtime acknowledgement per steer operation. */
function workerSteerAcknowledgementsDir(eventDir) {
	return join(workerSteersDir(eventDir), "acks");
}
/** Canonical request file for one caller-owned steer operation id. */
function workerSteerRequestFile(eventDir, operationId) {
	return join(workerSteerRequestsDir(eventDir), `${operationFileHash(operationId)}.json`);
}
/** Runtime acknowledgement file for one caller-owned steer operation id. */
function workerSteerAcknowledgementFile(eventDir, operationId) {
	return join(workerSteerAcknowledgementsDir(eventDir), `${operationFileHash(operationId)}.json`);
}
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
function writeWorkerSteer(rootDir, supervisorId, worker, options) {
	const workerId = worker.trim();
	if (!workerId) throw new Error("writeWorkerSteer: worker id is empty");
	const operationId = options.operationId.trim();
	if (!operationId) throw new Error("writeWorkerSteer: operationId is empty");
	const trimmed = options.message.trim();
	if (!trimmed) throw new Error("steer message is empty");
	const source = options.source?.trim() || "human";
	const interrupt = options.interrupt === true;
	const dir = supervisorRunDir(rootDir, supervisorId);
	const requestDigest = workerSteerRequestDigest({
		operationId,
		worker: workerId,
		message: trimmed,
		source,
		interrupt
	});
	const request = {
		schemaVersion: 1,
		operationId,
		requestDigest,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		worker: workerId,
		message: trimmed,
		interrupt
	};
	const file = workerSteerRequestFile(dir, operationId);
	assertNoSymlinkDescendant(dir, file, "steer request");
	mkdirSync(workerSteerRequestsDir(dir), { recursive: true });
	assertNoSymlinkDescendant(dir, file, "steer request");
	const admitted = admitSteerRequest(file, request);
	if (admitted.replayed) return {
		worker: admitted.request.worker,
		file,
		request: admitted.request,
		...readWorkerSteerAcknowledgement(dir, operationId) === void 0 ? {} : { acknowledgement: readWorkerSteerAcknowledgement(dir, operationId) },
		replayed: true
	};
	mkdirSync(supervisorWorkersDir(dir), { recursive: true });
	const projection = workerInboxFile(rootDir, supervisorId, workerId);
	try {
		appendFileSync(projection, `${JSON.stringify(request)}\n`, "utf8");
	} catch {}
	appendWorkerControlEvent(dir, workerId, {
		kind: "message",
		direction: "down",
		source,
		operationId,
		requestDigest,
		message: trimmed,
		interrupt,
		queued: true,
		delivered: false
	});
	return {
		worker: workerId,
		file,
		request,
		replayed: false
	};
}
/** Read every atomically admitted request for one exact worker id, in admission order. @stable */
function readWorkerSteerRequests(eventDir, worker) {
	const workerId = worker?.trim();
	if (worker !== void 0 && !workerId) return [];
	let names;
	assertNoSymlinkDescendant(eventDir, workerSteerRequestsDir(eventDir), "steer request");
	try {
		names = readdirSync(workerSteerRequestsDir(eventDir));
	} catch {
		return [];
	}
	const out = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		try {
			const file = join(workerSteerRequestsDir(eventDir), name);
			assertNoSymlinkDescendant(eventDir, file, "steer request");
			const parsed = parseWorkerSteerRequest(JSON.parse(readFileSync(file, "utf8")));
			if (name !== `${operationFileHash(parsed.operationId)}.json`) continue;
			if (workerId === void 0 || parsed.worker === workerId) out.push(parsed);
		} catch {}
	}
	return out.sort((left, right) => left.at === right.at ? left.operationId.localeCompare(right.operationId) : left.at.localeCompare(right.at));
}
/** Read one runtime steer acknowledgement, or `undefined` while no manager has answered. @stable */
function readWorkerSteerAcknowledgement(eventDir, operationId) {
	const id = operationId.trim();
	if (!id) throw new Error("readWorkerSteerAcknowledgement: operationId is empty");
	const file = workerSteerAcknowledgementFile(eventDir, id);
	assertNoSymlinkDescendant(eventDir, file, "steer acknowledgement");
	if (!existsSync(file)) return void 0;
	const record = parseWorkerSteerAcknowledgement(JSON.parse(readFileSync(file, "utf8")));
	if (record.operationId !== id) throw new Error(`steer acknowledgement '${file}' belongs to another operation`);
	return record;
}
/**
* Claim one steer for delivery with an atomic no-clobber acknowledgement.
* Returns `true` only to the process that created the pre-delivery record.
* @internal
*/
function claimWorkerSteerDelivery(eventDir, record) {
	const exact = parseWorkerSteerAcknowledgement(record);
	if (exact.effect !== "unknown") throw new Error("steer delivery claim must use effect unknown");
	const request = readWorkerSteerRequest(eventDir, exact.operationId);
	if (request === void 0 || request.requestDigest !== exact.requestDigest) throw new Error("steer delivery claim does not match an admitted request");
	const dir = workerSteerAcknowledgementsDir(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "steer acknowledgement");
	mkdirSync(dir, { recursive: true });
	assertNoSymlinkDescendant(eventDir, dir, "steer acknowledgement");
	if (publishExclusiveDurableFile(workerSteerAcknowledgementFile(eventDir, exact.operationId), `${JSON.stringify(exact, null, 2)}\n`)) return true;
	const winner = readWorkerSteerAcknowledgement(eventDir, exact.operationId);
	if (winner === void 0 || winner.operationId !== exact.operationId || winner.requestDigest !== exact.requestDigest) throw new Error("steer delivery claim conflicts with another operation");
	return false;
}
/** Atomically replace the runtime acknowledgement for one steer operation. @internal */
function writeWorkerSteerAcknowledgement(eventDir, record) {
	const exact = parseWorkerSteerAcknowledgement(record);
	const request = readWorkerSteerRequest(eventDir, exact.operationId);
	if (request === void 0 || request.requestDigest !== exact.requestDigest) throw new Error("steer acknowledgement does not match an admitted request");
	const dir = workerSteerAcknowledgementsDir(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "steer acknowledgement");
	mkdirSync(dir, { recursive: true });
	assertNoSymlinkDescendant(eventDir, dir, "steer acknowledgement");
	const file = workerSteerAcknowledgementFile(eventDir, exact.operationId);
	const prior = readWorkerSteerAcknowledgement(eventDir, exact.operationId);
	if (prior !== void 0 && prior.effect !== "unknown" && canonicalCandidateDigest(prior) !== canonicalCandidateDigest(exact)) throw new Error(`steer operation '${exact.operationId}' already has a terminal acknowledgement`);
	writeAtomicDurableFile(file, `${JSON.stringify(exact, null, 2)}\n`);
}
/** The directory holding every cancellation artifact of one run (request inbox + acknowledgements). */
function workerCancellationsDir(eventDir) {
	return join(eventDir, "cancellations");
}
/**
* The durable cancel-request inbox of one run — one NDJSON line per {@link WorkerCancelRequest}.
* It stays append-only so independent operations retain admission order and readers can skip a
* partial trailing line. `appendDurableFile` uses O_APPEND, one write, file fsync, and directory
* fsync; single-record acknowledgements use atomic replacement instead.
*/
function workerCancelRequestsFile(eventDir) {
	return join(workerCancellationsDir(eventDir), "requests.ndjson");
}
/**
* The acknowledgement file for one cancel operation. The filename is a sanitized stem of the
* `operationId`; the record inside carries the exact id, and readers verify it so two distinct
* ids that sanitize to one stem fail loud instead of answering for each other.
*/
function workerCancellationFile(eventDir, operationId) {
	return join(workerCancellationsDir(eventDir), `${safeOperationFile(operationId)}.json`);
}
function safeOperationFile(operationId) {
	const safe = operationId.replace(/[^A-Za-z0-9._-]/g, "_");
	if (safe.length === 0) throw new Error("cancel operationId is empty");
	return safe;
}
/** Read every valid cancel request in the run's cancellation inbox. Corrupt lines are skipped. */
function readWorkerCancelRequests(eventDir) {
	const dir = workerCancellationsDir(eventDir);
	const file = workerCancelRequestsFile(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "cancel request");
	assertNoSymlinkDescendant(eventDir, file, "cancel request");
	if (!existsSync(file)) return [];
	const out = [];
	const byOperationId = /* @__PURE__ */ new Map();
	let raw = "";
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return out;
	}
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (!isWorkerCancelRequest(parsed)) continue;
		const prior = byOperationId.get(parsed.operationId);
		if (prior !== void 0) assertSameWorkerCancelRequest(prior, parsed);
		else {
			byOperationId.set(parsed.operationId, parsed);
			out.push(parsed);
		}
	}
	return out;
}
/**
* Read the acknowledgement for one cancel operation. `undefined` when the runtime has not
* answered. A record whose stored `operationId` differs from the requested one is a filename
* collision between two sanitized ids — fail loud rather than return another operation's answer.
*/
function readWorkerCancellation(eventDir, operationId) {
	const dir = workerCancellationsDir(eventDir);
	const file = workerCancellationFile(eventDir, operationId);
	assertNoSymlinkDescendant(eventDir, dir, "cancel acknowledgement");
	assertNoSymlinkDescendant(eventDir, file, "cancel acknowledgement");
	if (!existsSync(file)) return void 0;
	const parsed = JSON.parse(readFileSync(file, "utf8"));
	if (parsed.operationId !== operationId) throw new Error(`cancel acknowledgement collision: '${file}' holds operation '${parsed.operationId}', not '${operationId}' — use operation ids that stay distinct after filename sanitization`);
	return parsed;
}
/**
* Durably write one acknowledgement record. The shared writer fsyncs the file and containing
* directory, so a concurrent reader sees the prior complete record or the new complete record.
*
* @internal The runtime acknowledger is the only intended writer; clients read via
* {@link readWorkerCancellation} or {@link cancelWorker}.
*/
function writeWorkerCancellation(eventDir, record) {
	const dir = workerCancellationsDir(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "cancel acknowledgement");
	mkdirSync(dir, { recursive: true });
	assertNoSymlinkDescendant(eventDir, dir, "cancel acknowledgement");
	const file = workerCancellationFile(eventDir, record.operationId);
	assertNoSymlinkDescendant(eventDir, file, "cancel acknowledgement");
	writeAtomicDurableFile(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 384 });
}
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
function cancelWorker(eventDir, worker, operationId, options = {}) {
	const ref = worker.trim();
	if (!ref) throw new Error("cancelWorker: worker reference is empty");
	const opId = operationId.trim();
	if (!opId) throw new Error("cancelWorker: operationId is empty");
	const pending = readWorkerCancelRequests(eventDir).find((r) => r.operationId === opId);
	const candidate = {
		operationId: opId,
		worker: ref,
		source: options.source ?? "human",
		...options.reason === void 0 ? {} : { reason: options.reason }
	};
	if (pending !== void 0) assertSameWorkerCancelRequest(pending, candidate);
	const acknowledged = readWorkerCancellation(eventDir, opId);
	if (acknowledged !== void 0) {
		if (pending === void 0 && options.source !== void 0) throw new Error(`cancelWorker: operation '${opId}' cannot verify source without its admitted request`);
		assertWorkerCancellationMatchesCandidate(acknowledged, candidate);
		return acknowledged;
	}
	const source = options.source ?? "human";
	const request = pending ?? {
		operationId: opId,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		worker: ref,
		...options.reason === void 0 ? {} : { reason: options.reason }
	};
	if (!pending) {
		const dir = workerCancellationsDir(eventDir);
		assertNoSymlinkDescendant(eventDir, dir, "cancel request");
		mkdirSync(dir, { recursive: true });
		assertNoSymlinkDescendant(eventDir, dir, "cancel request");
		const file = workerCancelRequestsFile(eventDir);
		assertNoSymlinkDescendant(eventDir, file, "cancel request");
		appendDurableFile(file, `${JSON.stringify(request)}\n`, { mode: 384 });
		appendWorkerControlEvent(eventDir, ref, {
			kind: "cancel-request",
			operationId: opId,
			source,
			queued: true,
			...options.reason === void 0 ? {} : { reason: options.reason }
		});
	}
	return {
		operationId: opId,
		worker: request.worker,
		effect: "unknown",
		requestedAt: request.at,
		observedAt: request.at,
		...request.reason === void 0 ? {} : { reason: request.reason },
		detail: "request queued; no runtime acknowledger has answered yet",
		terminated: []
	};
}
/** The run-scoped cancel request file of one run — one {@link RunCancelRequest}. */
function runCancelRequestFile(eventDir) {
	return join(workerCancellationsDir(eventDir), "run.request.json");
}
/** The run-scoped acknowledgement file of one run — one {@link RunCancellation}. */
function runCancellationFile(eventDir) {
	return join(workerCancellationsDir(eventDir), "run.json");
}
/** Read the run-scoped cancel request, or `undefined` when none was written. */
function readRunCancelRequest(eventDir) {
	const dir = workerCancellationsDir(eventDir);
	const file = runCancelRequestFile(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "run cancel request");
	assertNoSymlinkDescendant(eventDir, file, "run cancel request");
	if (!existsSync(file)) return void 0;
	const parsed = JSON.parse(readFileSync(file, "utf8"));
	if (!isRunCancelRequest(parsed)) throw new Error(`run cancel request '${file}' is not a complete RunCancelRequest`);
	return parsed;
}
/**
* Read the acknowledgement for the run-scoped cancel operation. `undefined` when the runtime has
* not answered. A record holding a DIFFERENT `operationId` belongs to another operation on the
* same run — fail loud rather than answer for it.
*/
function readRunCancellation(eventDir, operationId) {
	const dir = workerCancellationsDir(eventDir);
	const file = runCancellationFile(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "run cancel acknowledgement");
	assertNoSymlinkDescendant(eventDir, file, "run cancel acknowledgement");
	if (!existsSync(file)) return void 0;
	const parsed = JSON.parse(readFileSync(file, "utf8"));
	if (parsed.operationId !== operationId) throw new Error(`run cancel acknowledgement '${file}' holds operation '${parsed.operationId}', not '${operationId}' — one run carries one run-scoped cancel operation`);
	return parsed;
}
/**
* Durably write the run-scoped acknowledgement. The shared writer fsyncs the file and containing
* directory, so a concurrent reader sees the prior complete record or the new complete record.
*
* @internal The runtime is the only intended writer; clients read via {@link readRunCancellation}
* or {@link cancelRun}.
*/
function writeRunCancellation(eventDir, record) {
	const dir = workerCancellationsDir(eventDir);
	assertNoSymlinkDescendant(eventDir, dir, "run cancel acknowledgement");
	mkdirSync(dir, { recursive: true });
	assertNoSymlinkDescendant(eventDir, dir, "run cancel acknowledgement");
	const file = runCancellationFile(eventDir);
	assertNoSymlinkDescendant(eventDir, file, "run cancel acknowledgement");
	writeAtomicDurableFile(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 384 });
}
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
function cancelRun(eventDir, operationId, options = {}) {
	if (options.deadlineMs !== void 0 && (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 0)) throw new Error("cancelRun: deadlineMs must be a finite nonnegative number");
	const opId = operationId.trim();
	if (!opId) throw new Error("cancelRun: operationId is empty");
	const pending = readRunCancelRequest(eventDir);
	if (pending !== void 0 && pending.operationId !== opId) throw new Error(`cancelRun: run cancel '${pending.operationId}' is already pending for this run; read it with readRunCancellation instead of issuing '${opId}'`);
	const candidate = {
		operationId: opId,
		source: options.source ?? "human",
		...options.reason === void 0 ? {} : { reason: options.reason },
		...options.deadlineMs === void 0 ? {} : { deadlineMs: options.deadlineMs },
		...options.operator === void 0 ? {} : { operator: options.operator }
	};
	if (pending !== void 0) assertSameRunCancelRequest(pending, candidate);
	const acknowledged = readRunCancellation(eventDir, opId);
	if (acknowledged !== void 0) {
		if (pending === void 0 && options.source !== void 0) throw new Error(`cancelRun: operation '${opId}' cannot verify source without its admitted request`);
		assertRunCancellationMatchesCandidate(acknowledged, candidate);
		return acknowledged;
	}
	const source = options.source ?? "human";
	const request = pending ?? {
		operationId: opId,
		at: (/* @__PURE__ */ new Date()).toISOString(),
		source,
		...options.reason === void 0 ? {} : { reason: options.reason },
		...options.deadlineMs === void 0 ? {} : { deadlineMs: options.deadlineMs },
		...options.operator === void 0 ? {} : { operator: options.operator }
	};
	if (pending === void 0) {
		const dir = workerCancellationsDir(eventDir);
		assertNoSymlinkDescendant(eventDir, dir, "run cancel request");
		mkdirSync(dir, { recursive: true });
		assertNoSymlinkDescendant(eventDir, dir, "run cancel request");
		const file = runCancelRequestFile(eventDir);
		assertNoSymlinkDescendant(eventDir, file, "run cancel request");
		writeAtomicDurableFile(file, `${JSON.stringify(request, null, 2)}\n`, { mode: 384 });
		appendWorkerControlEvent(eventDir, "run", {
			kind: "run-cancel-request",
			operationId: opId,
			source,
			queued: true,
			...options.reason === void 0 ? {} : { reason: options.reason },
			...options.deadlineMs === void 0 ? {} : { deadlineMs: options.deadlineMs },
			...options.operator === void 0 ? {} : { operator: options.operator }
		});
	}
	return {
		operationId: opId,
		effect: "unknown",
		requestedAt: request.at,
		observedAt: request.at,
		...request.reason === void 0 ? {} : { reason: request.reason },
		...request.operator === void 0 ? {} : { operator: request.operator },
		detail: "request queued; no runtime acknowledger has answered yet"
	};
}
function assertSameWorkerCancelRequest(existing, candidate) {
	if (existing.operationId !== candidate.operationId) throw new Error(`cancelWorker: operation '${candidate.operationId}' has an id collision`);
	if (existing.worker !== candidate.worker) throw new Error(`cancelWorker: operation '${candidate.operationId}' conflicts with its admitted request (worker '${existing.worker}' != '${candidate.worker}')`);
	if (existing.source !== candidate.source) throw new Error(`cancelWorker: operation '${candidate.operationId}' conflicts with its admitted request (source '${existing.source}' != '${candidate.source}')`);
	if (existing.reason !== candidate.reason) throw new Error(`cancelWorker: operation '${candidate.operationId}' conflicts with its admitted request (reason differs)`);
}
function assertWorkerCancellationMatchesCandidate(existing, candidate) {
	if (existing.worker !== candidate.worker) throw new Error(`cancelWorker: operation '${candidate.operationId}' conflicts with its acknowledgement (worker '${existing.worker}' != '${candidate.worker}')`);
	if (existing.reason !== candidate.reason) throw new Error(`cancelWorker: operation '${candidate.operationId}' conflicts with its acknowledgement (reason differs)`);
}
function assertSameRunCancelRequest(existing, candidate) {
	if (existing.operationId !== candidate.operationId) throw new Error(`cancelRun: operation '${candidate.operationId}' has an id collision`);
	if (existing.source !== candidate.source) throw new Error(`cancelRun: operation '${candidate.operationId}' conflicts with its admitted request (source '${existing.source}' != '${candidate.source}')`);
	if (existing.deadlineMs !== candidate.deadlineMs) throw new Error(`cancelRun: operation '${candidate.operationId}' conflicts with its admitted request (deadlineMs differs)`);
	if (existing.reason !== candidate.reason) throw new Error(`cancelRun: operation '${candidate.operationId}' conflicts with its admitted request (reason differs)`);
	if (existing.operator !== candidate.operator) throw new Error(`cancelRun: operation '${candidate.operationId}' conflicts with its admitted request (operator '${existing.operator}' != '${candidate.operator}')`);
}
function assertRunCancellationMatchesCandidate(existing, candidate) {
	if (existing.reason !== candidate.reason) throw new Error(`cancelRun: operation '${candidate.operationId}' conflicts with its acknowledgement (reason differs)`);
	if (existing.operator !== void 0 && existing.operator !== candidate.operator) throw new Error(`cancelRun: operation '${candidate.operationId}' conflicts with its acknowledgement (operator '${existing.operator}' != '${candidate.operator}')`);
}
function isRunCancelRequest(value) {
	return typeof value.operationId === "string" && value.operationId.length > 0 && typeof value.at === "string" && typeof value.source === "string" && (value.deadlineMs === void 0 || Number.isFinite(value.deadlineMs) && value.deadlineMs >= 0) && (value.reason === void 0 || typeof value.reason === "string") && (value.operator === void 0 || typeof value.operator === "string");
}
function isWorkerCancelRequest(value) {
	return typeof value.operationId === "string" && value.operationId.length > 0 && typeof value.at === "string" && typeof value.source === "string" && typeof value.worker === "string" && value.worker.length > 0 && (value.reason === void 0 || typeof value.reason === "string");
}
function appendWorkerControlEvent(eventDir, label, event) {
	try {
		mkdirSync(supervisorWorkersDir(eventDir), { recursive: true });
		appendFileSync(workerControlLogFile(eventDir, label), `${JSON.stringify({
			at: (/* @__PURE__ */ new Date()).toISOString(),
			label,
			...event
		})}\n`, "utf8");
	} catch {}
}
function workerSteerRequestDigest(value) {
	return canonicalCandidateDigest({
		kind: "worker-steer-request.v1",
		...value
	});
}
function operationFileHash(operationId) {
	const id = operationId.trim();
	if (!id) throw new Error("steer operationId is empty");
	return createHash("sha256").update(id).digest("hex");
}
function admitSteerRequest(file, request) {
	const existing = readWorkerSteerRequestFile(file);
	if (existing !== void 0) {
		assertSameSteerRequest(existing, request);
		return {
			request: existing,
			replayed: true
		};
	}
	if (publishExclusiveDurableFile(file, `${JSON.stringify(request, null, 2)}\n`)) return {
		request,
		replayed: false
	};
	const winner = readWorkerSteerRequestFile(file);
	if (winner === void 0) throw new Error("steer request publication lost its winner");
	assertSameSteerRequest(winner, request);
	return {
		request: winner,
		replayed: true
	};
}
function readWorkerSteerRequest(eventDir, operationId) {
	const file = workerSteerRequestFile(eventDir, operationId);
	assertNoSymlinkDescendant(eventDir, file, "steer request");
	const request = readWorkerSteerRequestFile(file);
	if (request !== void 0 && request.operationId !== operationId) throw new Error("steer request file belongs to another operation");
	return request;
}
function readWorkerSteerRequestFile(file) {
	if (!existsSync(file)) return void 0;
	return parseWorkerSteerRequest(JSON.parse(readFileSync(file, "utf8")));
}
function parseWorkerSteerRequest(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("steer request is malformed");
	const request = value;
	if (request.schemaVersion !== 1 || typeof request.operationId !== "string" || request.operationId.length === 0 || typeof request.requestDigest !== "string" || typeof request.at !== "string" || typeof request.source !== "string" || request.source.length === 0 || typeof request.worker !== "string" || request.worker.length === 0 || typeof request.message !== "string" || request.message.trim().length === 0 || typeof request.interrupt !== "boolean") throw new Error("steer request is malformed");
	const exact = request;
	const expected = workerSteerRequestDigest({
		operationId: exact.operationId,
		worker: exact.worker,
		message: exact.message,
		source: exact.source,
		interrupt: exact.interrupt
	});
	if (exact.requestDigest !== expected) throw new Error("steer request digest does not match");
	return exact;
}
function parseWorkerSteerAcknowledgement(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("steer acknowledgement is malformed");
	const record = value;
	if (record.schemaVersion !== 1 || typeof record.operationId !== "string" || record.operationId.length === 0 || typeof record.requestDigest !== "string" || typeof record.worker !== "string" || record.worker.length === 0 || record.effect !== "unknown" && record.effect !== "delivered" && record.effect !== "not_live" && record.effect !== "unsupported" && record.effect !== "refused" || typeof record.requestedAt !== "string" || typeof record.observedAt !== "string" || typeof record.detail !== "string") throw new Error("steer acknowledgement is malformed");
	return record;
}
function assertSameSteerRequest(existing, candidate) {
	if (existing.operationId !== candidate.operationId) throw new Error("steer operation file collision");
	if (existing.requestDigest !== candidate.requestDigest) throw new Error(`writeWorkerSteer: operation '${candidate.operationId}' conflicts with its admitted request`);
}
//#endregion
export { writeWorkerCancellation as A, workerInboxFileFromEventDir as C, workerSteerRequestsDir as D, workerSteerRequestFile as E, writeWorkerSteerAcknowledgement as M, workerSteersDir as O, workerInboxFile as S, workerSteerAcknowledgementsDir as T, supervisorWorkersDir as _, legacySupervisorRunsRoot as a, workerCancellationsDir as b, readWorkerCancelRequests as c, readWorkerSteerRequests as d, runCancelRequestFile as f, supervisorRunsRoot as g, supervisorRunDir as h, legacySupervisorRunDir as i, writeWorkerSteer as j, writeRunCancellation as k, readWorkerCancellation as l, safeWorkerFile as m, cancelWorker as n, readRunCancelRequest as o, runCancellationFile as p, claimWorkerSteerDelivery as r, readRunCancellation as s, cancelRun as t, readWorkerSteerAcknowledgement as u, workerCancelRequestsFile as v, workerSteerAcknowledgementFile as w, workerControlLogFile as x, workerCancellationFile as y };

//# sourceMappingURL=run-layout-vwd4SwX_.js.map