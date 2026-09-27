import { $t as parseWorkerToolTraceArtifact, Ai as readCommittedJsonLines, Bi as providerAttemptEvidence, Bt as InMemoryResultBlobStore, Cn as createPeerMailbox, Dn as isLiveNodeStatus, E as failedItems, Ea as unmeteredSpend, Er as resolveRedactor, It as createRouterTranscript, M as withDriverExecutor, On as isTerminalNodeStatus, Qi as detachedFrozen, Rt as FileResultBlobStore, Vt as InMemorySpawnJournal, Yn as runBrainLoop, _ as CheckUnavailableError, ba as promptCacheTokenClasses, c as runTree, en as workerTraceAnalysisStore, fr as errMessage, ft as resolveSpawnResourcePaths, ha as chargedTokens, i as bestDelivered, ja as withBudgetResources, ji as writeAllBytes, jt as createExecutorRegistry, ka as addResourceSpend, ki as prepareJsonlAppend, o as pickBestDelivered, ot as scopeRetainedOwnerResourceReader, rn as assertValidBudget, s as runFinalizer, vn as createInbox, x as checkVerdictOf, z as meterRuntimeOwnedProviderAttempt, zt as FileSpawnJournal } from "./supervisor-DtlPj9me.js";
import { f as RuntimeRunStateError, m as ValidationError } from "./errors-DodWX-cb.js";
import { A as writeWorkerCancellation, M as writeWorkerSteerAcknowledgement, b as workerCancellationsDir, c as readWorkerCancelRequests, d as readWorkerSteerRequests, k as writeRunCancellation, l as readWorkerCancellation, o as readRunCancelRequest, r as claimWorkerSteerDelivery, s as readRunCancellation, u as readWorkerSteerAcknowledgement } from "./run-layout-vwd4SwX_.js";
import { agentProfileSchema, canonicalCandidateDigest } from "@tangle-network/agent-interface";
import { argHash, errorStreakDetector, observeAll, repeatedActionDetector } from "@tangle-network/agent-eval";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
//#region src/runtime/supervise/detector-monitor.ts
/**
*
* The ONLINE analyst: watch a `TraceSource` and fold each tool span through agent-eval's published
* streaming detector kernel (`repeatedActionDetector`/`errorStreakDetector` — the SAME kernel the
* control loop folds), firing `onSignal` the moment a worker loops or error-storms. Substrate-
* agnostic: it consumes spans from any source (owned router/bridge loop OR a sandbox box session),
* never the raw tool seam. Detection logic + the failure taxonomy live in agent-eval; not reimplemented.
*
* @experimental
*/
/** The default online panel for a tool-call pipe: a worker repeating the same call, or hammering
*  consecutive errors. (No-progress needs a domain progress-probe, so it is opt-in, not default.)
*
*  Coverage note: `repeated-action` works for EVERY harness (it needs only tool name + args, which
*  every adapter provides). `error-streak` needs per-call status — opencode carries it inline
*  (`state.status`, VALIDATED live), but claude-code/codex tool-call parts do NOT (their errors live
*  in separate result blocks not yet decoded), so error-streak is silent for those until result-block
*  decoding is added + live-validated. It is in the panel because it is correct where status exists. */
function defaultToolDetectors() {
	return [repeatedActionDetector({ maxRepeated: 3 }), errorStreakDetector({ maxErrors: 3 })];
}
/** Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an
*  unsubscribe. A defensive `argHash` failure (circular args) never throws out of the side-channel. */
function watchTrace(source, opts = {}) {
	const detectors = opts.detectors ?? defaultToolDetectors();
	return source.onSpan((span) => {
		let fingerprint;
		try {
			fingerprint = `${span.toolName}|${argHash(span.args)}`;
		} catch {
			fingerprint = `${span.toolName}|<unhashable>`;
		}
		const signals = observeAll(detectors, {
			actionFingerprint: fingerprint,
			...span.status ? { status: span.status } : {},
			label: span.toolName
		});
		for (const s of signals) opts.onSignal?.(s, span);
	});
}
//#endregion
//#region src/runtime/supervise/event-bus.ts
/** Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane.
* @experimental In-process queue; durability is a transport swap that does not exist yet. */
function createEventBus(now = Date.now) {
	const queue = [];
	const log = [];
	const subscribers = [];
	const byKind = {};
	const staged = /* @__PURE__ */ new WeakMap();
	let seq = 0;
	let published = 0;
	let pulled = 0;
	const matches = (r, kinds) => !kinds || kinds.includes(r.event.type);
	const bestIndex = (kinds) => {
		let best = -1;
		let bestPriority = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < queue.length; i++) {
			const r = queue[i];
			if (!r || !matches(r, kinds)) continue;
			if (r.priority > bestPriority) {
				best = i;
				bestPriority = r.priority;
			}
		}
		return best;
	};
	const pullRecord = (kinds) => {
		const i = bestIndex(kinds);
		if (i < 0) return void 0;
		pulled++;
		return queue.splice(i, 1)[0];
	};
	return {
		async publish(event, opts) {
			const record = staged.get(event) ?? {
				seq: seq++,
				at: now(),
				priority: opts?.priority ?? 0,
				event
			};
			staged.set(event, record);
			for (const handler of subscribers) await handler(record);
			staged.delete(event);
			if (opts?.queue !== false) queue.push(record);
			log.push(record);
			published += 1;
			byKind[event.type] = (byKind[event.type] ?? 0) + 1;
			return record;
		},
		pull(kinds) {
			return pullRecord(kinds)?.event;
		},
		pullRecord,
		queued(kinds) {
			return queue.filter((r) => matches(r, kinds));
		},
		subscribe(handler) {
			subscribers.push(handler);
			return () => {
				const i = subscribers.indexOf(handler);
				if (i >= 0) subscribers.splice(i, 1);
			};
		},
		pending(kinds) {
			return kinds ? queue.filter((r) => matches(r, kinds)).length : queue.length;
		},
		history() {
			return log;
		},
		stats() {
			return {
				published,
				pulled,
				byKind: { ...byKind }
			};
		}
	};
}
//#endregion
//#region src/mcp/tools/worker-output.ts
const WORKER_OUTPUT_PAGE_CHARS = 16384;
function workerOutputReadOptions(raw) {
	const offset = raw.outputOffset ?? 0;
	const limit = raw.outputLimit ?? 16384;
	const path = raw.outputPath === void 0 ? [] : raw.outputPath;
	if (!Array.isArray(path) || !path.every((part) => typeof part === "string")) throw new Error("observe_agent outputPath must be an array of field names");
	if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("observe_agent outputOffset must be a nonnegative safe integer");
	if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 16384) throw new Error(`observe_agent outputLimit must be an integer from 1 to ${WORKER_OUTPUT_PAGE_CHARS}`);
	return {
		offset,
		limit,
		path
	};
}
function samePath(left, right) {
	return left.length === right.length && left.every((field, index) => field === right[index]);
}
function selectWorkerOutput(output, path) {
	let selected = output;
	for (const field of path) {
		if (selected === null || typeof selected !== "object" || !Object.hasOwn(selected, field)) throw new Error("observe_agent outputPath does not identify a retained field");
		selected = selected[field];
	}
	return selected;
}
async function encodeWorkerOutput(blobs, outRef, path) {
	const retained = await blobs.get(outRef);
	if (retained === void 0) return { kind: "missing" };
	const output = selectWorkerOutput(retained, path);
	const text = JSON.stringify(output);
	if (text === void 0) throw new Error("observe_agent result blob is not JSON-serializable");
	return text.length > 16384 ? {
		kind: "page",
		text
	} : {
		kind: "small",
		output,
		text
	};
}
function readEncodedWorkerOutput(encoded, { offset, limit }) {
	if (encoded.kind === "missing") return {
		output: null,
		outputUnavailable: "result-blob-missing"
	};
	const { text } = encoded;
	if (offset > text.length) throw new Error("observe_agent outputOffset exceeds the retained output");
	if (encoded.kind === "small" && offset === 0 && text.length <= limit) return { output: encoded.output };
	const end = Math.min(offset + limit, text.length);
	return {
		output: null,
		outputPage: {
			format: "json",
			text: text.slice(offset, end),
			offset,
			nextOffset: end < text.length ? end : null,
			totalChars: text.length
		}
	};
}
/**
* Create a manager-scoped reader for immutable retained artifacts.
*
* At most one selected `outRef` + path is retained. Concurrent reads for that selection share the
* blob read and JSON encoding; missing blobs and rejected selections are evicted after all readers
* leave so a transient failure cannot poison later observations.
*/
function createWorkerOutputReader(blobs) {
	let cached;
	return async (outRef, options) => {
		if (outRef === void 0) return { output: null };
		let entry = cached;
		if (entry === void 0 || entry.outRef !== outRef || !samePath(entry.path, options.path)) {
			const path = [...options.path];
			entry = {
				outRef,
				path,
				result: encodeWorkerOutput(blobs, outRef, path),
				activeReads: 0,
				releaseWhenIdle: false
			};
			cached = entry;
		}
		entry.activeReads += 1;
		try {
			const encoded = await entry.result;
			const reply = readEncodedWorkerOutput(encoded, options);
			if (encoded.kind === "missing") entry.releaseWhenIdle = true;
			else {
				const page = reply.outputPage;
				if (page === void 0 || page.nextOffset === null) entry.releaseWhenIdle = true;
			}
			return reply;
		} catch (error) {
			entry.releaseWhenIdle = true;
			throw error;
		} finally {
			entry.activeReads -= 1;
			if (entry.releaseWhenIdle && entry.activeReads === 0 && cached === entry) cached = void 0;
		}
	};
}
//#endregion
//#region src/mcp/tools/coordination.ts
/**
*
* MCP binding for a live `Scope`. A sandbox driver gets the same small verbs
* the in-process driver has: spawn, observe, await, steer, ask/answer, analyze,
* and stop. Settled outputs remain Scope artifacts; product code can project
* them into any UI/report envelope it needs.
*
* @experimental
*/
/** Where a question this driver cannot answer goes next. `answer_question` accepts these and
*  nothing else, so the decision type states them and nothing else. */
const questionEscalationTargets = ["parent", "user"];
const isQuestionEscalationTarget = (value) => questionEscalationTargets.includes(value);
/**
* The trace-tool sets a DEFINED analyst may ask for — the exact group names agent-eval's
* `buildTraceToolsForGroup` accepts, restated here so the `define_analyst` JSON Schema can
* enumerate them for the model that writes one. Named, not free-form, because the group is the
* lens's cost ceiling: `all` grants seven trace tools, `discovery` grants three and no deep reads.
* A name eval does not know throws at registration, which is where the two lists are held together.
*/
const analystToolGroupNames = [
	"all",
	"discovery",
	"discoveryAndRead",
	"discoveryAndSearch",
	"targeted",
	"singleTrace"
];
/** Every bound `define_analyst` enforces before a definition reaches a registry.
*
*  MOTIVE, stated as numbers, because a fence whose motive cannot be stated is over-engineering:
*  a defined lens spends real model calls from the run's own account on every settle it is routed
*  over, and its `instructions` are re-sent on every one of them. So the two fields that multiply
*  — `instructions` bytes and `maxLlmCalls` — are the ones with hard ceilings, and the ceilings are
*  twice agent-eval's own defaults (`maxIterations` 12, `maxLlmCalls` 8, `maxToolCalls` 48,
*  `maxOutputChars` 10_000): enough headroom for a deeper question than the shipped lenses ask,
*  not enough for one definition to become the dominant cost of a run. */
const ANALYST_DEFINITION_BOUNDS = Object.freeze({
	idPattern: /^[a-z0-9][a-z0-9-]{1,63}$/,
	maxDescriptionChars: 300,
	maxAreaChars: 64,
	maxQuestionChars: 1e3,
	maxInstructionsChars: 2e4,
	maxModelChars: 128,
	maxIterations: 24,
	maxLlmCalls: 16,
	maxToolCalls: 96,
	maxOutputChars: 2e4,
	maxEvidenceCitations: 10,
	/** Lenses ONE manager may define, counting those it defined in a PRIOR process of a durable run.
	*  This bounds MENU GROWTH, not spend: a definition costs nothing until `run_analyst` is called,
	*  so the failure it stops is a manager that keeps re-authoring a lens instead of running one —
	*  each definition adds a line every later `list_analysts` re-reads. Eight is more than the five
	*  calibrated lenses agent-eval ships. Per-run analyst SPEND is bounded by the conserved pool the
	*  engine draws from, not here. */
	maxDefinitionsPerManager: 8
});
/** Producer-side cleanliness for the `finding` event. The findings payload is arbitrary analyst
*  output, the digest a subscriber computes (RFC 8785) throws on ANY `undefined` value — nested
*  included — and a throwing subscriber leaves the event invisible to EVERY subscriber. The
*  producer, not the digest, owns keeping the event canonical: an `undefined` payload is stripped
*  to key-absence, everything else is JSON round-tripped (nested `undefined` object values drop,
*  `undefined` array slots become `null`), and a payload JSON cannot represent at all (cycle,
*  BigInt, bare function) becomes a record OF that fact — degraded findings beat a vanished
*  event. */
function canonicalFindingEvent(finding) {
	if (finding.findings === void 0) {
		const { findings: _absent, ...present } = finding;
		return present;
	}
	try {
		return {
			...finding,
			findings: JSON.parse(JSON.stringify(finding.findings))
		};
	} catch (error) {
		return {
			...finding,
			findings: { nonCanonicalFindings: error instanceof Error ? error.message : String(error) }
		};
	}
}
/**
* Validate and BOUND one `define_analyst` argument.
*
* Every reason is collected, never short-circuited: a manager re-authoring from a partial list of
* complaints spends a turn per complaint. Numeric limits are CLAMPED rather than rejected — asking
* for 200 tool calls is a mis-estimate, not a malformed definition, and the accepted value is
* returned so the manager reads the ceiling it actually got.
*/
function parseAuthoredAnalystDefinition(raw) {
	const issues = [];
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { issues: [{
		path: "definition",
		message: "must be an object"
	}] };
	const o = raw;
	const bounds = ANALYST_DEFINITION_BOUNDS;
	const text = (field, max) => {
		const value = o[field];
		if (typeof value !== "string" || value.trim().length === 0) {
			issues.push({
				path: field,
				message: "is required and must be a non-empty string"
			});
			return "";
		}
		const trimmed = value.trim();
		if (trimmed.length > max) {
			issues.push({
				path: field,
				message: `must be at most ${max} characters (received ${trimmed.length})`
			});
			return "";
		}
		return trimmed;
	};
	const id = text("id", 64);
	if (id.length > 0 && !bounds.idPattern.test(id)) issues.push({
		path: "id",
		message: "must be 2-64 characters of lowercase letters, digits and hyphens, starting with a letter or digit"
	});
	const description = text("description", bounds.maxDescriptionChars);
	const area = text("area", bounds.maxAreaChars);
	const question = text("question", bounds.maxQuestionChars);
	const instructions = text("instructions", bounds.maxInstructionsChars);
	const toolGroup = o.toolGroup;
	if (!analystToolGroupNames.includes(toolGroup)) issues.push({
		path: "toolGroup",
		message: `must be one of ${analystToolGroupNames.join(", ")}`
	});
	let model;
	if (o.model !== void 0) if (typeof o.model !== "string" || o.model.trim().length === 0) issues.push({
		path: "model",
		message: "must be a non-empty string when present"
	});
	else if (o.model.length > bounds.maxModelChars) issues.push({
		path: "model",
		message: `must be at most ${bounds.maxModelChars} characters`
	});
	else model = o.model.trim();
	const clampedLimit = (field, max, source) => {
		const value = source[field];
		if (value === void 0) return void 0;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
			issues.push({
				path: `limits.${field}`,
				message: "must be a positive integer"
			});
			return;
		}
		return Math.min(value, max);
	};
	let limits;
	if (o.limits !== void 0) if (!o.limits || typeof o.limits !== "object" || Array.isArray(o.limits)) issues.push({
		path: "limits",
		message: "must be an object"
	});
	else {
		const source = o.limits;
		const knownLimits = /* @__PURE__ */ new Set([
			"maxIterations",
			"maxLlmCalls",
			"maxToolCalls",
			"maxOutputChars"
		]);
		for (const key of Object.keys(source)) if (!knownLimits.has(key)) issues.push({
			path: `limits.${key}`,
			message: `is not an investigation limit (accepted: ${[...knownLimits].join(", ")})`
		});
		const maxIterations = clampedLimit("maxIterations", bounds.maxIterations, source);
		const maxLlmCalls = clampedLimit("maxLlmCalls", bounds.maxLlmCalls, source);
		const maxToolCalls = clampedLimit("maxToolCalls", bounds.maxToolCalls, source);
		const maxOutputChars = clampedLimit("maxOutputChars", bounds.maxOutputChars, source);
		const present = {
			...maxIterations === void 0 ? {} : { maxIterations },
			...maxLlmCalls === void 0 ? {} : { maxLlmCalls },
			...maxToolCalls === void 0 ? {} : { maxToolCalls },
			...maxOutputChars === void 0 ? {} : { maxOutputChars }
		};
		if (Object.keys(present).length > 0) limits = present;
	}
	let minimumEvidenceCitations;
	if (o.minimumEvidenceCitations !== void 0) {
		const value = o.minimumEvidenceCitations;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 1) issues.push({
			path: "minimumEvidenceCitations",
			message: "must be a positive integer"
		});
		else minimumEvidenceCitations = Math.min(value, bounds.maxEvidenceCitations);
	}
	const known = /* @__PURE__ */ new Set([
		"id",
		"description",
		"area",
		"question",
		"instructions",
		"toolGroup",
		"model",
		"limits",
		"minimumEvidenceCitations"
	]);
	for (const key of Object.keys(o)) if (!known.has(key)) issues.push({
		path: key,
		message: `is not part of an authored analyst definition (accepted: ${[...known].join(", ")})`
	});
	if (issues.length > 0) return { issues };
	return { definition: Object.freeze({
		id,
		description,
		area,
		question,
		instructions,
		toolGroup,
		...model === void 0 ? {} : { model },
		...limits === void 0 ? {} : { limits: Object.freeze(limits) },
		...minimumEvidenceCitations === void 0 ? {} : { minimumEvidenceCitations }
	}) };
}
/** Normalize the two spellings of an analyst-on-settle entry to the route form. */
function normalizeAnalyzeOnSettle(entry) {
	return typeof entry === "string" ? { kind: entry } : entry;
}
/**
* Why one parent→child delivery did not land, in the words the MANAGER needs.
*
* `DownMessageDeliveryOutcome` is the machine code; this is the sentence beside it. A code alone
* left the manager to guess whether to retry, spawn, or give up — `already-settled` and
* `scope-stopped` look alike and need opposite moves. Every refusal a coordination verb returns
* carries a sentence like these, because the manager cannot see the state that produced it.
*/
const downMessageRefusalReasons = Object.freeze({
	delivered: "the message reached the worker",
	"unknown-worker": "no worker of this manager has that id — check observe_agent for the live ids",
	"already-settled": "that worker already settled, so nothing can reach it — spawn a fresh worker for the follow-up work",
	"runtime-has-no-inbox": "that worker runs on an executor with no inbox, so it can never receive a message — re-spawn it on a steerable executor if it must be corrected mid-run",
	"scope-stopped": "this manager’s scope has stopped, so no further message may be sent from it",
	"runtime-error": "the executor threw while accepting the message; the worker may or may not have received it"
});
/** Every cause at zero — a pre-flight publishes its whole ledger from the first read. */
function emptyPreflightCounts() {
	return {
		"model-route": 0,
		"bridge-full": 0,
		"unmountable-tool": 0
	};
}
/** Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote
*  MCP client request timeout so the call returns a `pending` liveness snapshot instead of erroring;
*  the supervisor re-polls until the worker settles. */
const DEFAULT_AWAIT_EVENT_TIMEOUT_MS = 15e3;
/** Default and maximum bounds for one {@link CoordinationTools} journal read. The defaults are
*  sized for a driver turn (a page a model can read and still have room to act on); the maxima
*  bound what a single tool result may cost even when the caller asks for everything. */
const JOURNAL_READ_BOUNDS = Object.freeze({
	defaultLimit: 50,
	maxLimit: 500,
	defaultMaxBytes: 16384,
	maxMaxBytes: 262144
});
/** Every `CoordinationEvent` kind `read_journal` can return — the tool advertises this list in its
*  JSON Schema AND filters on it, so the schema cannot promise a kind the filter drops. */
const journalEventKinds = [
	"question",
	"settled",
	"finding",
	"submission",
	"steer",
	"answer",
	"instruction",
	"delivery-attempt",
	"mail",
	"escalation",
	"analyst-defined",
	"acknowledgement"
];
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
const coordinationVerbNames = [
	"spawn_worker",
	"cancel_worker",
	"observe_agent",
	"steer_agent",
	"await_event",
	"list_questions",
	"answer_question",
	"ask_parent",
	"submit_result",
	"stop",
	"report_blocked",
	"read_continuation",
	"read_journal",
	"list_analysts",
	"run_analyst",
	"define_analyst"
];
/**
* The `CoordinationEvent` kinds a driver may name in `await_event`. The pull queue carries the
* UP-leg only: `steer` / `answer` / `instruction` / `delivery-attempt` are recorded `queue: false`
* (history and subscribers, never pulled back), and `mail` is delivered to its addressee's inbox.
*
* Declared once because the tool advertises this list in its JSON Schema AND filters on it at
* dispatch. Written twice, the two drift and the schema promises a kind the filter drops — a
* driver then blocks on a queue that already holds its event.
*/
const awaitableEventKinds = [
	"settled",
	"question",
	"finding"
];
function isAwaitableEventKind(value) {
	return awaitableEventKinds.includes(value);
}
const idArg = {
	type: "string",
	description: "The workerId returned by spawn_worker."
};
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
const stripKeyCodecArtifacts = (node) => {
	if (Array.isArray(node)) return node.map(stripKeyCodecArtifacts);
	if (!node || typeof node !== "object") return node;
	return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "propertyNames").map(([key, value]) => [key, stripKeyCodecArtifacts(value)]));
};
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
const spawnProfileFields = [
	{
		name: "name",
		description: "Short identifier for this child, e.g. \"researcher\" or \"patch-writer\". A child normally sets it to its role; it shows up in traces and worker labels."
	},
	{
		name: "description",
		description: "One line saying what this child is for. Read by humans and by a parent listing its workers."
	},
	{
		name: "version",
		description: "Optional version string for this profile, so two revisions of the same role are distinguishable in evidence. A child usually omits it."
	},
	{
		name: "harness",
		description: "Which coding backend runs the child. Omit to inherit the run default; set it only when this child needs a specific backend (e.g. a long refactor on \"claude-code\")."
	},
	{
		name: "model",
		description: "Model routing: `default` model id, optional `small` for cheap sub-calls, `provider`, and `reasoningEffort`. A child typically sets `default` and `reasoningEffort` — raise effort for a hard reasoning task, lower it for bulk mechanical work."
	},
	{
		name: "prompt",
		description: "The child's standing instructions: `systemPrompt` (who it is and how it works) and `instructions` (durable rules). This is the role; the separate `task` argument carries what to do right now. A child with no systemPrompt has no role — always set one."
	},
	{
		name: "tools",
		description: "Per-tool on/off map keyed by tool name, e.g. `{ \"bash\": true, \"webfetch\": false }`. Omit to inherit the backend's default tool set; set it to narrow a child to the tools its task needs. Keys are plain tool names."
	},
	{
		name: "permissions",
		description: "Per-tool permission decisions: each tool name maps to \"allow\", \"deny\", or \"ask\", or to a nested map of finer-grained rules. This is where a parent fences a child it does not fully trust — a read-only child denies write and network tools here, not in `tools`."
	},
	{
		name: "mcp",
		description: "MCP tool servers to mount for the child, keyed by server name. Brief form: each value is either `{ transport: \"stdio\", command, args?, env?, cwd? }` or `{ transport: \"sse\" | \"http\", url, headers? }`. A child normally sets this only when it needs a tool server the task requires; the canonical AgentProfile schema carries the full form (secret-ref values for env/headers, per-server metadata) and governs validation.",
		brief: {
			type: "object",
			additionalProperties: { type: "object" }
		}
	},
	{
		name: "resources",
		description: "Files, tools, skills, and agents materialized into the child workspace before it starts. Brief form: `{ files?, tools?, skills?, agents? }`, each an array whose entries are `{ kind: \"inline\", name, content }`, `{ kind: \"inline\", name, path }`, or `{ kind: \"github\", repository?, path, ref? }` (`files` entries wrap that as `{ path, resource, executable? }`). An inline `path` is relative to YOUR workspace and is read by the runtime, so use it for any file over a few hundred bytes: content you retype in this call arrives truncated and altered, a path arrives byte-exact and the result reports its sha256. A child typically gets `files` for seed inputs and `skills` for a procedure it must follow; the canonical AgentProfile schema carries the full form and governs validation.",
		brief: {
			type: "object",
			properties: {
				files: {
					type: "array",
					items: { type: "object" }
				},
				tools: {
					type: "array",
					items: { type: "object" }
				},
				skills: {
					type: "array",
					items: { type: "object" }
				},
				agents: {
					type: "array",
					items: { type: "object" }
				}
			},
			additionalProperties: true
		}
	},
	{
		name: "metadata",
		description: "Free-form key/value bag carried with the profile (plain string keys). Use it for run bookkeeping a reader will want later; it does not change how the child executes."
	}
];
/**
* Build the published shape of `spawn_worker`'s `profile` argument from the canonical
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
function deriveSpawnProfileArg(canonicalProperties) {
	const published = [];
	for (const field of spawnProfileFields) {
		const canonical = canonicalProperties?.[field.name];
		if (canonical === void 0) continue;
		const shape = field.brief ?? stripKeyCodecArtifacts(canonical);
		published.push([field.name, {
			...shape,
			description: field.description
		}]);
	}
	return {
		type: "object",
		description: "The child agent profile to run — this is the shape the DEFAULT worker seam accepts; a run wired with a custom makeWorkerAgent may accept a different one. The properties below are derived from the canonical AgentProfile schema and reduced to what a spawning parent sets (`mcp` and `resources` in a brief form); every other canonical field — tags, connections, subagents, hooks, modes, confidential, extensions — may still be passed. This tool does not validate the profile: the canonical AgentProfile schema governs validation downstream.",
		properties: Object.fromEntries(published),
		additionalProperties: true
	};
}
spawnProfileFields.map((f) => f.name);
let spawnProfileArgCache;
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
function spawnProfileArg() {
	if (!spawnProfileArgCache) spawnProfileArgCache = detachedFrozen(deriveSpawnProfileArg(agentProfileSchema.toJSONSchema({
		io: "input",
		target: "draft-07",
		unrepresentable: "any"
	}).properties));
	return spawnProfileArgCache;
}
/** `spawn_worker`'s `profile` argument when the run has a profiles table: one of the table's names,
*  listed with each entry's description and whether a sealed verdict promoted it, or a profile the
*  manager authors. Without a table the argument is the authored shape alone, byte for byte. */
function spawnProfileArgWithTable(profiles) {
	const menu = [...profiles].map(([name, entry]) => {
		return `- '${name}'${typeof entry.profile.description === "string" && entry.profile.description.length > 0 ? ` — ${entry.profile.description}` : ""} (${entry.promotion ? `promoted by sealed play ${JSON.stringify(entry.promotion.experiment.spec.id)}` : "exploratory"})`;
	});
	return { anyOf: [{
		type: "string",
		enum: [...profiles.keys()],
		description: `The name of a profile in this run's profiles table. The runtime runs that exact profile, so do not retype it; other profile fields cannot be added to a name. Promoted entries beat their control in a sealed comparison; exploratory ones have no verdict yet.\n${menu.join("\n")}`
	}, spawnProfileArg()] };
}
/** Why `spawn_worker` cannot use this `profile` argument against the profiles table, or
*  `undefined` when it can. A name must be in the table. An authored profile must not take a table
*  name: continuity and every per-name record key on `profile.name`, so one name must mean one
*  profile. Without a table nothing is refused here, and the canonical schema answers as before. */
function profileTableRefusal(table, profile) {
	if (table === void 0) return void 0;
	if (typeof profile === "string") {
		if (table.has(profile)) return void 0;
		return `profile ${JSON.stringify(profile)} is not in this run's profiles table, which holds ${[...table.keys()].map((name) => JSON.stringify(name)).join(", ")}`;
	}
	const name = typeof profile === "object" && profile !== null ? profile.name : void 0;
	if (typeof name !== "string" || !table.has(name)) return void 0;
	return `profile.name ${JSON.stringify(name)} is a profiles-table entry: pass profile: ${JSON.stringify(name)} to run that exact profile, or give the profile you wrote another name`;
}
const BUDGET_FIELD = {
	tokens: "maxTokens",
	iterations: "maxIterations",
	usd: "maxUsd"
};
function budgetField(channel) {
	return channel.startsWith("resource:") ? `resources.${channel.slice(9)}.limit` : BUDGET_FIELD[channel];
}
/** One clause per short channel. Iterations can be requested at exactly `free`: a driver's own
*  turns charge none. Tokens and dollars cannot: the driver's next turn is metered from the same
*  pool before its retry reaches admission, so the clause says to leave room. */
function shortfallClause(shortfall) {
	const { channel, requested, free } = shortfall;
	const field = budgetField(channel);
	if (shortfall.closedByUnknownSpend === true) return `${channel} is closed: work with unmeasured ${channel} usage ran under the run's enforced limit, so this run admits no further spawn at any budget`;
	const asked = `this spawn asked for budget.${field} ${requested}`;
	const held = shortfall.held ?? 0;
	const most = free + held;
	if (most === 0) return `${channel} has nothing free and none held by your running workers (${asked})`;
	const room = held > 0 ? `${free} free now and ${held} held by your running workers, which a spawn waits for` : `${free} free${channel === "iterations" || channel.startsWith("resource:") ? "" : " right now"}`;
	if (channel === "iterations" || channel.startsWith("resource:")) return `${channel} has ${room} (${asked}); budget.${field} at most ${most} fits`;
	return `${channel} has ${room} (${asked}); your own turns draw ${channel} from this same pool before a retry is admitted, so ask for well under ${most}`;
}
/**
* The reason text `spawn_worker` returns for a refused spawn. Every rejection kind names its own
* cause: a live-worker cap, a depth limit, or a key collision is not an empty budget, and telling a
* driver "no allocation left" for those sends it after the wrong fix. A `budget-exhausted` refusal
* names every channel that did not fit and the amounts, so the driver can size its next request.
*/
function spawnRefusalReason(reason, shortfalls, pinned) {
	switch (reason) {
		case "usd-unbudgeted": return pinned.usdUnbudgeted;
		case "in-doubt": return pinned.inDoubt;
		case "scope-settled": return pinned.scopeSettled;
		case "scope-aborted": return "this run stopped admitting work (it was cancelled, passed its deadline, or too many children went down); no further worker can start";
		case "depth-exceeded": return "this spawn would exceed the run's maxDepth; a worker at the deepest level cannot start children of its own";
		case "duplicate-key": return "a worker under this key is still live; wait for it to settle, or use a different key for different work";
		case "key-conflict": return "this key is already recorded for a different profile or task in this run's journal; use a new key for different work";
		case "invalid-identity": return "a keyed spawn needs a complete execution identity to journal, and this profile and task did not produce one; spawn again without a key";
		case "budget-exhausted":
			if (shortfalls === void 0 || shortfalls.length === 0) return "the conserved pool refused this spawn (budget-exhausted): the run's remaining budget cannot cover this worker's budget";
			if (shortfalls.some((shortfall) => shortfall.closedByUnknownSpend === true)) return `the run pool refused this spawn: ${shortfallClause(shortfalls.find((shortfall) => shortfall.closedByUnknownSpend === true))}; the caller must re-run with a measurable or larger root budget`;
			return `the run pool refused this spawn: ${shortfalls.map(shortfallClause).join("; ")}; or ask the caller for a larger root budget`;
	}
}
/** Build the driver's MCP tools over a live scope. */
function createCoordinationTools(opts) {
	return createCoordinationToolsForManager(opts);
}
/** Internal manager binding; its lifetime fences delivery without cancelling the worker scope. */
function createCoordinationToolsForManager(opts, lifetime) {
	const deliverable = opts.deliverable;
	const profileTable = opts.profiles !== void 0 && opts.profiles.size > 0 ? opts.profiles : void 0;
	const readWorkerOutput = createWorkerOutputReader(opts.blobs);
	const priorSubmission = deliverable === void 0 ? void 0 : opts.priorJournal?.find((record) => record.event.type === "submission");
	let stopped = priorSubmission !== void 0;
	let reason = priorSubmission === void 0 ? void 0 : "result-accepted";
	let stopNotified = false;
	let submitted = priorSubmission === void 0 ? void 0 : detachedFrozen({ result: priorSubmission.event.result });
	let submissionInFlight;
	let blockedEvidence;
	let questionSeq = 0;
	const ledger = [];
	const questions = [...opts.priorQuestions ?? []];
	const questionPolicy = opts.questionPolicy ?? "auto";
	const notifyStop = () => {
		if (stopNotified) return;
		stopNotified = true;
		opts.onStop?.(reason);
	};
	const profileNameByWorker = /* @__PURE__ */ new Map();
	const liveHandles = /* @__PURE__ */ new Map();
	let unkeyedAssignmentOrdinal = nextUnkeyedAssignmentOrdinal(opts.scope);
	const preflightCounts = emptyPreflightCounts();
	const nodeForWorker = (id) => opts.scope.view.nodes.find((node) => node.id === id) ?? opts.scope.resume?.view.nodes.find((node) => node.id === id);
	const descendantOutRefs = /* @__PURE__ */ new Set();
	const projectSettled = (settled, resumed = false) => {
		const node = nodeForWorker(settled.handle.id);
		const assignmentId = settled.handle.assignmentId ?? node?.assignmentId;
		const identity = settled.handle.identity ?? node?.identity;
		const materialization = settled.handle.materialization ?? node?.materialization;
		const executionBindings = settled.handle.executionBindings ?? node?.executionBindings;
		const settledAt = settled.settledAt ?? node?.settledAt;
		const trace = settled.trace ?? node?.trace ?? {
			status: "unavailable",
			reason: "legacy-settlement-without-trace-evidence"
		};
		const common = {
			id: settled.handle.id,
			...assignmentId === void 0 ? {} : { assignmentId },
			...identity === void 0 ? {} : { identity },
			...materialization === void 0 ? {} : { materialization },
			...executionBindings === void 0 ? {} : { executionBindings },
			...settledAt === void 0 ? {} : { settledAt },
			...settled.budgetViolation === void 0 ? {} : { budgetViolation: settled.budgetViolation },
			trace,
			...settled.subtree === void 0 ? {} : { subtree: settled.subtree },
			...resumed ? { resumed: true } : {}
		};
		for (const result of settled.subtree?.results ?? []) if (result.outRef !== void 0) descendantOutRefs.add(result.outRef);
		return detachedFrozen(settled.kind === "done" ? {
			...common,
			status: "done",
			spent: settled.spent,
			...settled.verdict?.score === void 0 ? {} : { score: settled.verdict.score },
			...settled.verdict?.valid === void 0 ? {} : { valid: settled.verdict.valid },
			outRef: settled.outRef
		} : {
			...common,
			status: "down",
			...settled.outRef === void 0 ? {} : { outRef: settled.outRef },
			...node?.spent === void 0 ? {} : { spent: node.spent },
			reason: settled.reason
		});
	};
	const resumedWorkers = [];
	for (const s of opts.scope.resume?.settled ?? []) {
		const worker = projectSettled(s, true);
		resumedWorkers.push(worker);
		ledger.push(worker);
	}
	const bus = createEventBus();
	if (opts.onEvent) {
		const cb = opts.onEvent;
		bus.subscribe((rec) => cb(rec.event, rec));
	}
	const resumeEvents = opts.replaySettlements ? resumedWorkers.map((worker) => detachedFrozen({
		type: "settled",
		worker
	})) : [];
	let resumeEventIndex = 0;
	let readyInFlight;
	const ready = () => {
		if (resumeEventIndex >= resumeEvents.length) return Promise.resolve();
		if (readyInFlight) return readyInFlight;
		readyInFlight = (async () => {
			while (resumeEventIndex < resumeEvents.length) {
				const event = resumeEvents[resumeEventIndex];
				if (!event) break;
				await bus.publish(event);
				resumeEventIndex += 1;
			}
		})().finally(() => {
			readyInFlight = void 0;
		});
		return readyInFlight;
	};
	const deliveries = [];
	let driverAttempt;
	let journalReadTo = 0;
	let lastRejection;
	const checkReads = [];
	const recordCheckRead = (read) => {
		const entry = detachedFrozen({
			read: checkReads.length + 1,
			attempt: driverAttempt ?? 1,
			at: Date.now(),
			source: read.source,
			...read.verdict === void 0 ? {} : { verdict: read.verdict },
			...read.unavailable === void 0 ? {} : { unavailable: read.unavailable }
		});
		checkReads.push(entry);
		return entry;
	};
	const flushedAnalystRuns = /* @__PURE__ */ new Set();
	const eventWorker = (event) => event.type === "settled" ? event.worker.id : event.type === "finding" ? event.finding.fromWorker : event.type === "question" ? event.question.from : void 0;
	const acknowledge = async (targets, by) => {
		const fresh = targets.filter((delivery) => !delivery.acknowledged);
		if (fresh.length === 0) return [];
		const seqs = fresh.map((delivery) => delivery.record.seq);
		await bus.publish({
			type: "acknowledgement",
			acknowledgement: detachedFrozen({
				seqs,
				by,
				...driverAttempt === void 0 ? {} : { attempt: driverAttempt }
			})
		}, { queue: false });
		for (const delivery of fresh) delivery.acknowledged = true;
		return seqs;
	};
	const urgencyPriority = (u) => u === "blocks-run" ? 20 : u === "blocks-step" ? 10 : 0;
	const str = (v, field) => {
		if (typeof v !== "string" || v.length === 0) throw new Error(`coordination tools: "${field}" must be a non-empty string`);
		return v;
	};
	const obj = (raw) => {
		if (!raw || typeof raw !== "object") throw new Error("coordination tools: arguments must be an object");
		return raw;
	};
	const mergeBudget = (base, raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("coordination tools: \"budget\" must be an object");
		const o = raw;
		const field = (name) => {
			const v = o[name];
			if (v === void 0) return void 0;
			if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`coordination tools: "budget.${name}" must be a finite number`);
			return v;
		};
		const maxIterations = field("maxIterations");
		const maxTokens = field("maxTokens");
		const maxUsd = field("maxUsd");
		const deadlineMs = field("deadlineMs");
		const rawResources = o.resources;
		if (rawResources !== void 0 && (!rawResources || typeof rawResources !== "object" || Array.isArray(rawResources))) throw new Error("coordination tools: \"budget.resources\" must be a resource map");
		const resources = rawResources === void 0 ? base.resources : {
			...base.resources,
			...rawResources
		};
		const merged = {
			...resources === void 0 ? {} : { resources },
			maxIterations: maxIterations ?? base.maxIterations,
			maxTokens: maxTokens ?? base.maxTokens,
			...(maxUsd ?? base.maxUsd) === void 0 ? {} : { maxUsd: maxUsd ?? base.maxUsd },
			...(deadlineMs ?? base.deadlineMs) === void 0 ? {} : { deadlineMs: deadlineMs ?? base.deadlineMs }
		};
		assertValidBudget(merged, "coordination tools: budget");
		return merged;
	};
	const level = (v) => {
		if (v === "worker" || v === "driver" || v === "loop") return v;
		throw new Error("coordination tools: \"level\" must be worker, driver, or loop");
	};
	const urgency = (v) => {
		if (v === "continue-without" || v === "blocks-step" || v === "blocks-run") return v;
		throw new Error("coordination tools: \"urgency\" must be continue-without, blocks-step, or blocks-run");
	};
	const commitSettled = (w) => {
		ledger.push(w);
		unwatchWorker(w.id);
	};
	let pendingSettlement;
	const analystRuns = /* @__PURE__ */ new Map();
	let analystRunOrdinal = 0;
	/** The `finding` event an analyst-agent settlement becomes: its settle OUTPUT is the findings
	*  (a failed run publishes the failure as findings — degraded beats vanished). */
	const analystRunFinding = (run, settled) => detachedFrozen({
		type: "finding",
		finding: canonicalFindingEvent({
			fromWorker: run.sourceWorker,
			analyst: run.route.kind,
			findings: settled.kind === "done" ? settled.out : { analystRunFailed: settled.reason }
		})
	});
	/**
	* Spawn one analyst-AGENT run over a settled worker's evidence, through the SAME spawn
	* machinery a driver spawn uses (`scope.spawn` + `makeWorkerAgent`): the analyst's spend
	* reserves from the conserved pool, its node is journaled/traced like any worker, and a
	* node-pinning seam sees `context.analyst`. Its task is the route directive plus the settled
	* worker's persisted tool-trace spans. A refused spawn publishes a finding RECORDING the
	* refusal — observable, never silent — and must never take down the settlement path.
	*/
	const spawnAnalystRun = async (route, worker) => {
		let spansText = "";
		let spanCount = 0;
		if (worker.trace.status === "available") try {
			const artifact = parseWorkerToolTraceArtifact(await opts.blobs.get(worker.trace.traceRef), worker.trace.traceRef);
			spanCount = artifact.spans.length;
			spansText = safeJsonText(artifact.spans);
		} catch {
			spansText = "";
		}
		const task = [
			...route.directive === void 0 || route.directive.length === 0 ? [] : [route.directive],
			`Evidence — settled worker '${worker.id}' tool trace (${spanCount} spans):`,
			spansText.length === 0 ? "(no tool spans available)" : spansText
		].join("\n\n");
		const assignmentId = `analyst:${route.kind}:o${analystRunOrdinal++}`;
		const label = `analyst:${route.kind}`;
		const context = Object.freeze({
			assignmentId,
			parentNodeId: opts.scope.view.root,
			budget: opts.perWorker,
			task,
			label,
			analyst: route.kind,
			continuity: "fresh"
		});
		let refusal;
		let spawnedId;
		try {
			const res = opts.scope.spawn(() => opts.makeWorkerAgent(route.agent, context), task, {
				budget: opts.perWorker,
				label,
				assignmentId
			});
			if (res.ok) spawnedId = res.handle.id;
			else refusal = String(res.reason);
		} catch (cause) {
			refusal = cause instanceof Error ? cause.message : String(cause);
		}
		if (spawnedId === void 0) {
			await bus.publish({
				type: "finding",
				finding: canonicalFindingEvent({
					fromWorker: worker.id,
					analyst: route.kind,
					findings: { analystSpawnRefused: refusal ?? "unknown" }
				})
			});
			return;
		}
		analystRuns.set(spawnedId, {
			route,
			sourceWorker: worker.id
		});
		watchWorker(spawnedId);
	};
	const workerRouteNames = (workerId) => {
		const names = /* @__PURE__ */ new Set();
		const profileName = profileNameByWorker.get(workerId);
		if (profileName !== void 0) names.add(profileName);
		const label = nodeForWorker(workerId)?.label;
		if (label !== void 0) names.add(label);
		return names;
	};
	/** The LIVE worker a route destination names, by profile name first, label second. */
	const liveWorkerIdNamed = (destination) => {
		const live = opts.scope.view.nodes.filter((node) => isLiveNodeStatus(node.status));
		return live.find((node) => profileNameByWorker.get(node.id) === destination)?.id ?? live.find((node) => node.label === destination)?.id;
	};
	const liveWorkerForNode = (name) => opts.scope.view.nodes.find((node) => isLiveNodeStatus(node.status) && profileNameByWorker.get(node.id) === name)?.id;
	const latestSettledWorkerForNode = (name) => {
		for (let i = ledger.length - 1; i >= 0; i -= 1) {
			const worker = ledger[i];
			if (profileNameByWorker.get(worker.id) === name) return worker.id;
		}
	};
	const nodeSpawnCount = (name) => {
		let count = 0;
		for (const profileName of profileNameByWorker.values()) if (profileName === name) count += 1;
		return count;
	};
	const parseContinuity = (v) => {
		if (v === void 0) return void 0;
		if (v === "fresh" || v === "resume") return v;
		throw new Error("coordination tools: \"continuity\" must be \"fresh\" or \"resume\"");
	};
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
	const resolveContinuity = (requested, profileName, key) => {
		const declared = profileName === void 0 ? "fresh" : opts.continuityByProfile?.[profileName] ?? "fresh";
		if (!(requested === "resume" || requested === void 0 && declared === "resume")) return { continuity: "fresh" };
		if (profileName === void 0 || profileName.length === 0) return {
			error: "resume-unnamed-profile",
			hint: "Resume targets a node by profile.name — the stable node identity — and this profile has none. Name the profile, or spawn fresh."
		};
		if (key !== void 0) return {
			error: "resume-with-key",
			hint: "A semantic key makes an assignment run-once (a completed key returns its committed result instead of running again); resume explicitly runs the node AGAIN. Drop the key to resume, or keep the key and spawn fresh."
		};
		const live = liveWorkerForNode(profileName);
		if (live !== void 0) return {
			error: "resume-while-live",
			hint: `Worker '${live}' on node '${profileName}' is still LIVE — resume re-attaches to a SETTLED session. To redirect the live worker, use steer_agent (that is the live-worker channel); to run a parallel sibling instead, pass continuity: 'fresh'.`
		};
		const prior = latestSettledWorkerForNode(profileName);
		if (prior === void 0) {
			if (requested === void 0) return { continuity: "fresh" };
			return {
				error: "resume-no-prior",
				hint: `Node '${profileName}' has no settled prior worker in this process to resume — resume continues a FINISHED session. Spawn the node fresh first (omit continuity or pass 'fresh').`
			};
		}
		return {
			continuity: "resume",
			resume: {
				ofWorker: prior,
				sequence: nodeSpawnCount(profileName) + 1
			}
		};
	};
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
	const deliverRoutedFinding = async (route, findings) => {
		const destination = route.to;
		const text = route.directive === void 0 || route.directive.length === 0 ? safeJsonText(findings) : `${route.directive}\n\n${safeJsonText(findings)}`;
		const targetId = liveWorkerIdNamed(destination);
		if (targetId === void 0) {
			await bus.publish({
				type: "steer",
				down: detachedFrozen({
					receiptId: randomUUID(),
					toWorker: destination,
					instruction: text,
					instructionDigest: canonicalCandidateDigest(text),
					delivered: false,
					outcome: "unknown-worker"
				}),
				analyst: route.kind
			}, { queue: false });
			return;
		}
		let instruction;
		try {
			instruction = authorizeInstruction("steer", targetId, text, false);
			await recordInstruction(instruction);
		} catch (cause) {
			try {
				await sendDown("steer", detachedFrozen({
					receiptId: randomUUID(),
					toWorker: targetId,
					instruction: text,
					instructionDigest: canonicalCandidateDigest(text),
					delivered: false,
					outcome: "runtime-error",
					error: cause instanceof Error ? cause.message : String(cause)
				}), route.kind);
			} catch {}
			return;
		}
		try {
			await attemptDelivery(instruction, {
				steer: instruction.instruction,
				interrupt: false
			}, { analyst: route.kind });
		} catch {}
	};
	const flushPendingSettlement = async () => {
		const pending = pendingSettlement;
		if (!pending) return false;
		await bus.publish(pending.event);
		if (pending.analystRun) {
			analystRuns.delete(pending.worker.id);
			flushedAnalystRuns.add(pending.worker.id);
			unwatchWorker(pending.worker.id);
			pendingSettlement = void 0;
			const { route } = pending.analystRun;
			if (route.to !== void 0 && pending.event.type === "finding") await deliverRoutedFinding({
				kind: route.kind,
				to: route.to
			}, pending.event.finding.findings);
			return true;
		}
		commitSettled(pending.worker);
		pendingSettlement = void 0;
		if (pending.analyze && pending.worker.status === "done" && pending.worker.trace.status === "available" && opts.analyzeOnSettle?.length) {
			const routes = opts.analyzeOnSettle.map(normalizeAnalyzeOnSettle);
			const sourceNames = workerRouteNames(pending.worker.id);
			const applicable = routes.filter((route) => route.over === void 0 || route.over.some((name) => sourceNames.has(name)));
			const lensRoutes = applicable.filter((route) => route.agent === void 0);
			const agentRoutes = applicable.filter((route) => route.agent !== void 0);
			if (lensRoutes.length > 0 && opts.analysts) {
				const trace = await workerTraceAnalysisStore(pending.worker.trace, opts.blobs);
				for (const route of lensRoutes) {
					const findings = await opts.analysts.run(route.kind, trace);
					await bus.publish({
						type: "finding",
						finding: canonicalFindingEvent({
							fromWorker: pending.worker.id,
							analyst: route.kind,
							findings
						})
					});
					if (route.to !== void 0) await deliverRoutedFinding(route, findings);
				}
			}
			for (const route of agentRoutes) await spawnAnalystRun(route, pending.worker);
		}
		return true;
	};
	const drainSettlement = async (source = "next") => {
		if (!pendingSettlement) {
			const settled = await (source === "next" ? opts.scope.next() : opts.scope.nextResolved());
			if (!settled) return false;
			const worker = projectSettled(settled);
			const run = analystRuns.get(settled.handle.id);
			pendingSettlement = run ? {
				settled,
				worker,
				event: analystRunFinding(run, settled),
				analyze: false,
				analystRun: run
			} : {
				settled,
				worker,
				event: detachedFrozen({
					type: "settled",
					worker
				}),
				analyze: true
			};
		}
		return flushPendingSettlement();
	};
	const drainResolved = async () => {
		let drained = 0;
		for (;;) {
			if (!pendingSettlement) {
				const settled = await opts.scope.nextResolved();
				if (!settled) return drained;
				const worker = projectSettled(settled);
				const run = analystRuns.get(settled.handle.id);
				pendingSettlement = run ? {
					settled,
					worker,
					event: analystRunFinding(run, settled),
					analyze: false,
					analystRun: run
				} : {
					settled,
					worker,
					event: detachedFrozen({
						type: "settled",
						worker
					}),
					analyze: false
				};
			}
			await flushPendingSettlement();
			drained += 1;
		}
	};
	async function sendDown(type, down, questionIdOrAnalyst) {
		await bus.publish(type === "answer" ? {
			type,
			down,
			questionId: str(questionIdOrAnalyst, "questionId")
		} : questionIdOrAnalyst !== void 0 ? {
			type,
			down,
			analyst: questionIdOrAnalyst
		} : {
			type,
			down
		}, { queue: false });
	}
	const authorizeInstruction = (kind, workerId, instruction, interrupt, questionId) => {
		const workerIdentity = opts.scope.view.nodes.find((node) => node.id === workerId)?.identity;
		let authorizedInstruction = instruction;
		if (opts.authorizeDownMessage) {
			if (workerIdentity === void 0) throw new Error(`coordination tools: cannot authorize ${kind} for worker ${JSON.stringify(workerId)} without durable identity`);
			const decision = detachedFrozen(opts.authorizeDownMessage(detachedFrozen({
				kind,
				workerId,
				workerIdentity,
				instruction,
				interrupt,
				...questionId !== void 0 ? { questionId } : {}
			})));
			if (typeof decision !== "object" || decision === null || Array.isArray(decision) || typeof decision.instruction !== "string" || decision.instruction.length === 0) throw new Error("coordination tools: authorizeDownMessage must return an instruction");
			authorizedInstruction = decision.instruction;
		}
		return detachedFrozen({
			receiptId: randomUUID(),
			kind,
			toWorker: workerId,
			instruction: authorizedInstruction,
			instructionDigest: canonicalCandidateDigest(authorizedInstruction),
			...workerIdentity !== void 0 ? { workerIdentity } : {},
			interrupt,
			...questionId !== void 0 ? { questionId } : {}
		});
	};
	/** Publish before `scope.send`: an awaited durable subscriber therefore commits the exact bytes
	* before the worker can observe them. */
	const recordInstruction = async (instruction) => {
		await bus.publish({
			type: "instruction",
			instruction
		}, { queue: false });
	};
	/** Commit delivery intent after the authorization receipt and before `Scope.send`. An attempt with
	* no matching outcome after a crash is explicitly unknown and must never be replayed. */
	const recordDeliveryAttempt = async (instruction) => {
		const attempt = detachedFrozen({
			receiptId: instruction.receiptId,
			kind: instruction.kind,
			toWorker: instruction.toWorker,
			instructionDigest: instruction.instructionDigest,
			interrupt: instruction.interrupt,
			...instruction.questionId !== void 0 ? { questionId: instruction.questionId } : {}
		});
		await bus.publish({
			type: "delivery-attempt",
			attempt
		}, { queue: false });
		return attempt;
	};
	const deliveryOutcome = (workerId, delivered) => {
		if (delivered) return "delivered";
		if (opts.scope.signal.aborted) return "scope-stopped";
		const node = opts.scope.view.nodes.find((candidate) => candidate.id === workerId);
		if (!node) return "unknown-worker";
		if (!isLiveNodeStatus(node.status)) return "already-settled";
		return "runtime-has-no-inbox";
	};
	const attemptDelivery = async (instruction, message, origin) => {
		await recordDeliveryAttempt(instruction);
		let delivered = false;
		let outcome;
		let error;
		try {
			if (lifetime?.aborted) outcome = "scope-stopped";
			else {
				delivered = opts.scope.send(instruction.toWorker, message);
				outcome = deliveryOutcome(instruction.toWorker, delivered);
			}
		} catch (cause) {
			outcome = "runtime-error";
			error = cause instanceof Error ? cause.message : String(cause);
		}
		const down = detachedFrozen({
			receiptId: instruction.receiptId,
			toWorker: instruction.toWorker,
			instruction: instruction.instruction,
			instructionDigest: instruction.instructionDigest,
			delivered,
			outcome,
			...error !== void 0 ? { error } : {}
		});
		if (instruction.kind === "answer") await sendDown("answer", down, str(instruction.questionId, "questionId"));
		else await sendDown("steer", down, origin?.analyst);
		if (error !== void 0) throw new Error(`coordination tools: delivery failed: ${error}`);
		return down;
	};
	const steerWorker = async (workerId, instruction, options = {}) => {
		const interrupt = options.interrupt === true;
		const authorized = authorizeInstruction("steer", workerId, instruction, interrupt);
		await recordInstruction(authorized);
		return await attemptDelivery(authorized, {
			steer: authorized.instruction,
			interrupt
		});
	};
	const projectEvent = (ev) => {
		if (ev.type === "settled") {
			const { id, status, ...evidence } = ev.worker;
			return {
				type: "settled",
				settled: id,
				status,
				...evidence,
				...evidence.outRef === void 0 ? {} : { outputRead: {
					tool: "observe_agent",
					arguments: { workerId: id }
				} }
			};
		}
		if (ev.type === "question") return {
			type: "question",
			question: ev.question
		};
		if (ev.type === "finding") return {
			type: "finding",
			...ev.finding
		};
		if (ev.type === "submission") return {
			type: "submission",
			result: ev.result
		};
		if (ev.type === "answer") return {
			type: "answer",
			...ev.down,
			questionId: ev.questionId
		};
		if (ev.type === "instruction") return {
			type: "instruction",
			...ev.instruction
		};
		if (ev.type === "delivery-attempt") return {
			type: "delivery-attempt",
			...ev.attempt
		};
		if (ev.type === "mail") return {
			type: "mail",
			...ev.mail
		};
		if (ev.type === "escalation") return {
			type: "escalation",
			...ev.escalation
		};
		if (ev.type === "analyst-defined") return {
			type: "analyst-defined",
			...ev.analyst
		};
		if (ev.type === "acknowledgement") return {
			type: "acknowledgement",
			...ev.acknowledgement
		};
		return {
			type: ev.type,
			...ev.down
		};
	};
	const peerMail = opts.peerMail ? createPeerMailbox({
		scope: opts.scope,
		publish: (mail) => bus.publish({
			type: "mail",
			mail
		}, { queue: false }).then(() => void 0),
		...opts.peerMail.limits ? { limits: opts.peerMail.limits } : {}
	}) : void 0;
	const nextQuestionId = (from) => {
		for (;;) {
			const id = `${from}:q${questionSeq++}`;
			if (!questions.some((question) => question.id === id)) return id;
		}
	};
	const normalizeQuestion = (q, fallbackFrom) => {
		const from = str(q.from ?? fallbackFrom, "from");
		return {
			id: typeof q.id === "string" && q.id.length > 0 ? q.id : nextQuestionId(from),
			from,
			level: level(q.level),
			question: str(q.question, "question"),
			reason: str(q.reason, "reason"),
			...q.options ? { options: q.options } : {},
			urgency: urgency(q.urgency)
		};
	};
	const addQuestion = (raw, fallbackFrom, decision) => {
		const q = normalizeQuestion(raw, fallbackFrom);
		const existing = questions.find((x) => x.id === q.id);
		if (existing) return {
			question: existing,
			added: false
		};
		const effectiveDecision = decision ?? (questionPolicy === "bubble" ? {
			kind: "escalate",
			to: "parent",
			reason: "question policy bubbled to parent"
		} : void 0);
		const status = effectiveDecision?.kind === "answer" ? "answered" : effectiveDecision?.kind === "defer" ? "deferred" : effectiveDecision?.kind === "escalate" ? "escalated" : "open";
		const record = {
			...q,
			status,
			openedAt: Date.now(),
			...effectiveDecision ? { decision: effectiveDecision } : {}
		};
		questions.push(record);
		return {
			question: record,
			added: true
		};
	};
	const emitNewQuestion = async (record) => {
		if (record.added) await bus.publish({
			type: "question",
			question: record.question
		}, { priority: urgencyPriority(record.question.urgency) });
		return record.question;
	};
	/** The refusal every `answer_question` path returns for an id this manager has no question for.
	*  A THROW here reaches the manager as a transport error with no vocabulary it can act on, and
	*  this is the verb the `no-parent` guidance tells it to use — so it names the condition. */
	const unknownQuestion = (questionId) => ({
		error: "unknown-question",
		reason: `this manager has no question with the id ${JSON.stringify(questionId)}; call list_questions for the ids you may decide`
	});
	const decideQuestion = (questionId, decision) => {
		const idx = questions.findIndex((q) => q.id === questionId);
		if (idx < 0) throw new Error(`unknown questionId ${JSON.stringify(questionId)}`);
		const prior = questions[idx];
		const status = decision.kind === "answer" ? "answered" : decision.kind === "defer" ? "deferred" : "escalated";
		const next = {
			...prior,
			status,
			decision
		};
		questions[idx] = next;
		return next;
	};
	const escalations = [...opts.priorEscalations ?? []];
	const escalate = async (question) => {
		let outcome;
		if (opts.escalateQuestion === void 0) outcome = {
			delivered: false,
			reason: "this manager has no parent inbox in this run, so nothing above it can receive the question"
		};
		else try {
			outcome = await opts.escalateQuestion(question);
		} catch (error) {
			outcome = {
				delivered: false,
				reason: `the parent channel refused the question: ${error instanceof Error ? error.message : String(error)}`
			};
		}
		const record = Object.freeze({
			questionId: question.id,
			from: question.from,
			urgency: question.urgency,
			delivered: outcome.delivered,
			...outcome.delivered ? { to: outcome.to } : { reason: outcome.reason },
			at: Date.now()
		});
		escalations.push(record);
		await bus.publish({
			type: "escalation",
			escalation: record
		}, { queue: false });
		return record;
	};
	const blockingQuestionsForStop = () => {
		if (questionPolicy === "auto" || questionPolicy === "bubble") return [];
		return questions.filter((q) => {
			if (!(q.urgency === "blocks-step" || q.urgency === "blocks-run")) return false;
			if (questionPolicy === "mustDecide") return q.status === "open";
			return q.status !== "answered" && q.status !== "deferred";
		});
	};
	const redactJournalEvent = resolveRedactor(opts.redactJournal);
	const clampBound = (raw, field, fallback, max) => {
		if (raw === void 0) return fallback;
		if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error(`coordination tools: "${field}" must be an integer`);
		return Math.min(Math.max(raw, 1), max);
	};
	const journalKinds = (raw) => {
		if (raw === void 0) return void 0;
		if (!Array.isArray(raw)) throw new Error("coordination tools: \"kinds\" must be an array of event kinds");
		for (const kind of raw) if (!journalEventKinds.includes(kind)) throw new Error(`coordination tools: "kinds" accepts ${journalEventKinds.join(", ")}; received ${JSON.stringify(kind)}`);
		return new Set(raw);
	};
	const redactedRow = (record) => {
		try {
			return redactJournalEvent(detachedFrozen(record.event));
		} catch (error) {
			return {
				type: record.event.type,
				redactionFailed: error instanceof Error ? error.message : String(error)
			};
		}
	};
	const priorJournal = opts.priorJournal ?? [];
	const journalRows = () => {
		const rows = [];
		let row = 0;
		for (const record of priorJournal) rows.push({
			row: row++,
			seq: record.seq,
			at: record.at,
			priority: record.priority,
			prior: true,
			event: void 0,
			record
		});
		for (const record of bus.history()) rows.push({
			row: row++,
			seq: record.seq,
			at: record.at,
			priority: record.priority,
			event: void 0,
			record
		});
		return rows;
	};
	const readJournal = (raw) => {
		const a = raw === void 0 ? {} : obj(raw);
		const sinceRow = a.sinceRow === void 0 ? 0 : typeof a.sinceRow === "number" && Number.isInteger(a.sinceRow) && a.sinceRow >= 0 ? a.sinceRow : (() => {
			throw new Error("coordination tools: \"sinceRow\" must be a non-negative integer");
		})();
		const limit = clampBound(a.limit, "limit", JOURNAL_READ_BOUNDS.defaultLimit, JOURNAL_READ_BOUNDS.maxLimit);
		const maxBytes = clampBound(a.maxBytes, "maxBytes", JOURNAL_READ_BOUNDS.defaultMaxBytes, JOURNAL_READ_BOUNDS.maxMaxBytes);
		const kinds = journalKinds(a.kinds);
		const matching = journalRows().filter((candidate) => candidate.row >= sinceRow && (!kinds || kinds.has(candidate.record.event.type)));
		const entries = [];
		let usedBytes = 2;
		let index = 0;
		let bounded = false;
		for (; index < matching.length; index++) {
			if (entries.length >= limit) {
				bounded = true;
				break;
			}
			const { record, event: _placeholder, ...stamp } = matching[index];
			const row = {
				...stamp,
				event: redactedRow(record)
			};
			const bytes = Buffer.byteLength(safeJsonText(row), "utf8") + (entries.length === 0 ? 0 : 1);
			if (usedBytes + bytes > maxBytes) {
				bounded = true;
				if (entries.length > 0) break;
				const marker = {
					...stamp,
					event: { type: record.event.type },
					oversize: {
						type: record.event.type,
						bytes
					}
				};
				entries.push(marker);
				usedBytes += Buffer.byteLength(safeJsonText(marker), "utf8");
				index++;
				break;
			}
			entries.push(row);
			usedBytes += bytes;
		}
		const last = entries[entries.length - 1];
		const nextRow = last === void 0 ? sinceRow : last.row + 1;
		journalReadTo = Math.max(journalReadTo, nextRow);
		return {
			entries,
			nextRow,
			remaining: matching.length - index,
			truncated: bounded,
			bounds: {
				sinceRow,
				limit,
				maxBytes,
				usedBytes
			},
			priorRows: priorJournal.length
		};
	};
	const definedAnalysts = [...opts.priorAnalystDefinitions ?? []];
	const analystMenu = () => [...opts.analysts?.kinds ?? [], ...definedAnalysts.map((record) => record.kind)];
	const maxDefinedAnalysts = opts.maxDefinedAnalysts ?? ANALYST_DEFINITION_BOUNDS.maxDefinitionsPerManager;
	const defineAnalyst = async (raw) => {
		const register = opts.analysts?.register;
		if (register === void 0) return {
			error: "authoring-unavailable",
			reason: "this run's analyst registry admits no authored lens"
		};
		if (maxDefinedAnalysts > 0 && definedAnalysts.length >= maxDefinedAnalysts) return {
			error: "max-defined-analysts",
			reason: `you have defined ${definedAnalysts.length} lenses, the cap for this manager; run the ones you have instead of defining more`,
			defined: definedAnalysts.map((record) => record.kind.id)
		};
		const parsed = parseAuthoredAnalystDefinition(raw);
		if ("issues" in parsed) return {
			error: "invalid-definition",
			reason: parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
			issues: parsed.issues
		};
		const { definition } = parsed;
		const taken = analystMenu().find((kind) => kind.id === definition.id);
		if (taken !== void 0) return {
			error: "duplicate-analyst",
			reason: `the lens id ${JSON.stringify(definition.id)} is already on the menu (${taken.description}); choose a different id or run the existing lens`
		};
		let kind;
		try {
			kind = await register(definition);
		} catch (error) {
			return {
				error: "register-refused",
				reason: error instanceof Error ? error.message : String(error)
			};
		}
		const record = Object.freeze({
			definition,
			kind: Object.freeze({
				id: kind.id,
				description: kind.description,
				area: kind.area
			}),
			digest: canonicalCandidateDigest(definition),
			definedAt: Date.now()
		});
		definedAnalysts.push(record);
		await bus.publish({
			type: "analyst-defined",
			analyst: record
		}, { queue: false });
		return {
			analyst: record.kind,
			digest: record.digest,
			defined: definedAnalysts.length
		};
	};
	const liveWorkerCount = () => opts.scope.view.nodes.filter((n) => isLiveNodeStatus(n.status)).length;
	const queuedWorkerCount = () => opts.scope.view.nodes.filter((n) => n.status === "queued").length;
	const projectNodeEvidence = (node, resumed = false) => ({
		id: node.id,
		status: node.status,
		...node.assignmentId === void 0 ? {} : { assignmentId: node.assignmentId },
		...node.identity === void 0 ? {} : { identity: node.identity },
		...node.materialization === void 0 ? {} : { materialization: node.materialization },
		...node.executionBindings === void 0 ? {} : { executionBindings: node.executionBindings },
		spent: node.spent,
		...node.settledAt === void 0 ? {} : { settledAt: node.settledAt },
		...node.outRef === void 0 ? {} : { outRef: node.outRef },
		...node.trace === void 0 ? {} : { trace: node.trace },
		...resumed ? { resumed: true } : {}
	});
	const liveSnapshot = () => opts.scope.view.nodes.filter((n) => isLiveNodeStatus(n.status)).map((n) => projectNodeEvidence(n));
	const openWork = () => {
		const received = new Set(ledger.map((worker) => worker.id));
		const nodes = opts.scope.view?.nodes ?? [];
		return {
			running: nodes.filter((node) => isLiveNodeStatus(node.status) && node.status !== "waiting"),
			unqueued: nodes.filter((node) => !isLiveNodeStatus(node.status) && !received.has(node.id) && !flushedAnalystRuns.has(node.id)),
			queued: bus.queued(["settled", "finding"])
		};
	};
	const openWorkRefusal = (verb) => {
		const { running, unqueued, queued } = openWork();
		if (running.length === 0 && unqueued.length === 0 && queued.length === 0) return void 0;
		const parts = [];
		if (running.length > 0) parts.push(`${running.length} worker${running.length === 1 ? " is" : "s are"} still running (${running.map((node) => node.id).join(", ")})`);
		const waiting = unqueued.length + queued.length;
		if (waiting > 0) parts.push(`${waiting} event${waiting === 1 ? " is" : "s are"} waiting for you in await_event`);
		return {
			error: "open-work",
			reason: `${parts.join(" and ")}. Call await_event until it returns idle, read each settled worker's output, and then call ${verb} again. Nothing was ${verb === "stop" ? "stopped" : "checked"}.`,
			running: running.map((node) => ({
				id: node.id,
				label: node.label,
				status: node.status
			})),
			waiting: [...queued.map((record) => ({
				type: record.event.type,
				...eventWorker(record.event) === void 0 ? {} : { worker: eventWorker(record.event) }
			})), ...unqueued.map((node) => ({
				type: "settled",
				worker: node.id
			}))]
		};
	};
	const freeWorkerSlots = () => opts.scope.workerCapacity?.freeSlots ?? null;
	const readProgress = (id) => {
		const scope = opts.scope;
		if (typeof scope.progress !== "function") return void 0;
		try {
			return scope.progress(id, opts.stallAfterMs !== void 0 ? { stallAfterMs: opts.stallAfterMs } : {});
		} catch {
			return;
		}
	};
	const watchers = /* @__PURE__ */ new Map();
	const watchWorker = (id) => {
		const watch = opts.watchWorkers;
		if (!watch) return;
		const scope = opts.scope;
		if (typeof scope.traceSource !== "function") return;
		let source;
		try {
			source = scope.traceSource(id);
		} catch {
			return;
		}
		if (!source) return;
		const cap = watch.maxFindingsPerWorker ?? 3;
		let raised = 0;
		const unsub = watchTrace(source, {
			...watch.detectors ? { detectors: watch.detectors } : {},
			onSignal: async (signal, span) => {
				if (cap > 0 && raised >= cap) return;
				raised += 1;
				await bus.publish({
					type: "finding",
					finding: canonicalFindingEvent({
						fromWorker: id,
						analyst: `online:${signal.detector}`,
						findings: {
							detector: signal.detector,
							severity: signal.severity,
							reason: signal.reason,
							streak: signal.streak,
							...signal.failureClass ? { failureClass: signal.failureClass } : {},
							toolName: span.toolName,
							at: span.endedAt,
							progress: readProgress(id)
						}
					})
				});
			}
		});
		watchers.set(id, unsub);
	};
	const unwatchWorker = (id) => {
		const unsub = watchers.get(id);
		if (!unsub) return;
		watchers.delete(id);
		try {
			unsub();
		} catch {}
	};
	const awaitTimeoutMs = opts.awaitTimeoutMs ?? 15e3;
	let inFlightDrain = null;
	const ensureDrain = () => {
		if (!inFlightDrain) inFlightDrain = drainSettlement().finally(() => {
			inFlightDrain = null;
		});
		return inFlightDrain;
	};
	const raceDrainWithTimeout = async (drain) => {
		if (awaitTimeoutMs <= 0) return { drained: await drain };
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => resolve(void 0), awaitTimeoutMs);
			if (typeof timer?.unref === "function") timer.unref();
		});
		try {
			return await Promise.race([drain.then((drained) => ({ drained })), timeout]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	};
	const tools = [
		{
			name: "spawn_worker",
			description: "Start a worker the driver will drive. `profile` is the worker or another driver; `task` is what it should do. Reserves budget from the conserved pool and fails closed. Pass an optional `budget` (per-field) to give a sub-task more or less than the default — it merges over the per-worker default; the conserved pool is still the hard fence. Each worker reserves its whole budget when it starts, so the pool divided by the per-worker budget is how many run at once: to run a wide team at once, give each worker less. When every worker slot is busy, or the pool cannot cover the budget until your running workers return what they hold, the worker is admitted with `status: \"queued\"` and starts on its own when a slot and its budget free — it is never refused for concurrency, so spawn all the work you want done and await_event for the results. A queued worker whose budget never frees settles down as budget-exhausted. Pass a `key` naming the assignment to make it run-once ACROSS restarts: a key that already completed returns the finished result (`resumed: \"completed\"` — no work re-runs, nothing is spent), a key whose prior attempt failed (`down`) spawns fresh and says so (`resumed: \"retried\"`), and a key the process died with IN FLIGHT retries under the same key when the executor provably died with the process (an inline worker — the same `resumed: \"retried\"`, naming the interruption). A key with no terminal receipt whose execution may still exist elsewhere (sandbox, CLI bridge, router) is refused (`error: \"in-doubt\"`) until its exact prior execution is recovered. A key still running is refused (`error: \"duplicate-key\"`). Returns `freeSlots`: how many MORE workers start at once (`null` = no slot bound), and `queued`: how many of your workers wait for a slot. Parallel workers finish the run sooner than one at a time." + (profileTable === void 0 ? "" : " This run has a profiles table: pass `profile` as one of the table's names to run that exact profile, or write a new profile under a name the table does not hold."),
			inputSchema: {
				type: "object",
				properties: {
					profile: profileTable === void 0 ? spawnProfileArg() : spawnProfileArgWithTable(profileTable),
					task: { description: "The task the worker should perform." },
					label: {
						type: "string",
						description: "Optional trace label."
					},
					key: {
						type: "string",
						description: "Optional semantic name for this assignment (e.g. \"summarize-ch3\"). The same key never runs twice: completed keys return their committed result, even after a coordinator restart."
					},
					continuity: {
						type: "string",
						enum: ["fresh", "resume"],
						description: "How this spawn continues the node's prior work. \"fresh\" (the default) starts a brand-new session. \"resume\" re-attaches to the node's most recent SETTLED worker: a NEW live worker is spawned whose session continues where that worker stopped (the backend receives the prior workerId and the resume sequence). Resume fails closed when the node has no settled prior worker (`error: \"resume-no-prior\"` — spawn it fresh first), while a prior worker of the node is still live (`error: \"resume-while-live\"` — steer_agent is the live-worker channel), and under a `key` (`error: \"resume-with-key\"` — keys are run-once, resume runs again). Omit to use the run's declared default for this profile name."
					},
					successorOf: {
						type: "string",
						description: "The workerId of a SETTLED worker you spawned that this new worker replaces — for example one that failed, stalled, or finished with a weak result, restarted with a changed profile or task. The run record then names the predecessor on the new worker. Refused for an id you did not spawn (`error: \"successor-unknown\"`) and for a worker still live (`error: \"successor-live\"` — await_event until it settles). Put what the successor needs from its predecessor in `task`."
					},
					budget: {
						type: "object",
						description: "Optional per-spawn budget that merges over the per-worker default (per field). Only set the ceilings this sub-task needs raised; the conserved pool still fences.",
						properties: {
							maxIterations: {
								type: "number",
								minimum: 0
							},
							maxTokens: {
								type: "number",
								minimum: 0
							},
							maxUsd: {
								type: "number",
								minimum: 0
							},
							deadlineMs: {
								type: "number",
								minimum: 0
							},
							resources: {
								type: "object",
								additionalProperties: {
									type: "object",
									properties: {
										unit: {
											type: "string",
											minLength: 1
										},
										limit: {
											type: "integer",
											minimum: 0,
											maximum: Number.MAX_SAFE_INTEGER
										}
									},
									required: ["unit", "limit"]
								}
							}
						}
					}
				},
				required: ["profile", "task"]
			},
			handler: async (raw) => {
				const a = obj(raw);
				const key = a.key === void 0 ? void 0 : str(a.key, "key");
				const tableRefusal = profileTableRefusal(profileTable, a.profile);
				if (tableRefusal !== void 0) return {
					error: "invalid-profile",
					reason: tableRefusal,
					issues: [{
						path: "profile",
						message: tableRefusal
					}]
				};
				const tableEntry = typeof a.profile === "string" ? profileTable?.get(a.profile) : void 0;
				const resourcePaths = tableEntry === void 0 ? await resolveSpawnResourcePaths(a.profile, opts.spawnResourceReader ?? opts.spawnResourceRoot) : {
					ok: true,
					profile: tableEntry.profile,
					resolved: []
				};
				if (!resourcePaths.ok) return {
					error: "invalid-profile",
					reason: `resources.${resourcePaths.at}: ${resourcePaths.reason}`,
					issues: [{
						path: `resources.${resourcePaths.at}`,
						message: resourcePaths.reason
					}]
				};
				const parsedProfile = agentProfileSchema.safeParse(resourcePaths.profile);
				if (!parsedProfile.success) return Promise.resolve({
					error: "invalid-profile",
					reason: `the profile you wrote is not a valid AgentProfile: ${parsedProfile.error.issues.map((issue) => `${issue.path.join(".") || "profile"} ${issue.message}`).join("; ")}`,
					issues: parsedProfile.error.issues.map((issue) => ({
						path: issue.path.join("."),
						message: issue.message
					}))
				});
				const profile = detachedFrozen(opts.composeSpawnProfile ? agentProfileSchema.parse(opts.composeSpawnProfile(parsedProfile.data)) : parsedProfile.data);
				const continuity = resolveContinuity(parseContinuity(a.continuity), profile.name, key);
				if ("error" in continuity) return Promise.resolve({
					error: continuity.error,
					reason: continuity.hint,
					hint: continuity.hint,
					live: liveWorkerCount(),
					freeSlots: freeWorkerSlots()
				});
				const successorOf = a.successorOf === void 0 ? void 0 : str(a.successorOf, "successorOf");
				if (successorOf !== void 0) {
					const predecessor = nodeForWorker(successorOf);
					if (predecessor === void 0 || predecessor.parent !== opts.scope.view.root) return {
						error: "successor-unknown",
						reason: `'${successorOf}' is not a worker this manager spawned — successorOf takes a workerId from one of your own spawn_worker results`,
						live: liveWorkerCount(),
						freeSlots: freeWorkerSlots()
					};
					if (isLiveNodeStatus(predecessor.status)) return {
						error: "successor-live",
						reason: `worker '${successorOf}' has not settled — await_event until it does, then spawn its successor (steer_agent redirects a live worker instead)`,
						live: liveWorkerCount(),
						freeSlots: freeWorkerSlots()
					};
				}
				const task = detachedFrozen(a.task);
				const label = typeof a.label === "string" ? a.label : "worker";
				if (opts.preflightSpawn) {
					const preflightProfile = opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile;
					const refusal = await opts.preflightSpawn(preflightProfile, {
						label,
						...key !== void 0 ? { key } : {},
						task
					});
					if (refusal) {
						preflightCounts[refusal.cause] += 1;
						return {
							error: "preflight-refused",
							reason: `the spawn pre-flight refused this profile (${refusal.cause}): ${refusal.detail}`,
							cause: refusal.cause,
							detail: refusal.detail,
							live: liveWorkerCount(),
							freeSlots: freeWorkerSlots()
						};
					}
				}
				const budget = Object.freeze(a.budget === void 0 ? opts.perWorker : mergeBudget(opts.perWorker, a.budget));
				const assignmentId = key !== void 0 ? `key:${key}` : `ordinal:${unkeyedAssignmentOrdinal++}`;
				const peerMailUrl = peerMail?.mintCapability(assignmentId);
				const context = Object.freeze({
					assignmentId,
					parentNodeId: opts.scope.view.root,
					budget,
					task,
					label,
					...key !== void 0 ? { key } : {},
					continuity: continuity.continuity,
					...continuity.continuity === "resume" ? { resume: continuity.resume } : {},
					...successorOf !== void 0 ? { successorOf } : {},
					...peerMailUrl !== void 0 ? { peerMailUrl } : {}
				});
				const res = opts.scope.spawn(() => opts.makeWorkerAgent(profile, context), task, {
					budget,
					label,
					assignmentId,
					...key !== void 0 ? { key } : {},
					...successorOf !== void 0 ? { successorOf } : {}
				});
				if (res.ok && res.prior?.state === "completed") {
					const s = res.prior.settled;
					const { id, status, resumed: _resumed, ...evidence } = projectSettled(s);
					return Promise.resolve({
						workerId: id,
						resumed: "completed",
						status,
						...evidence,
						...evidence.outRef === void 0 ? {} : { outputRead: {
							tool: "observe_agent",
							arguments: { workerId: id }
						} },
						live: liveWorkerCount(),
						freeSlots: freeWorkerSlots()
					});
				}
				if (res.ok) {
					watchWorker(res.handle.id);
					liveHandles.set(res.handle.id, res.handle);
					peerMail?.bindCapability(assignmentId, res.handle.id);
					if (typeof profile.name === "string" && profile.name.length > 0) profileNameByWorker.set(res.handle.id, profile.name);
				}
				const priorHistory = res.ok && res.prior !== void 0 && res.prior.state !== "completed" ? {
					resumed: res.prior.state,
					priorWorkerId: res.prior.priorId,
					...res.prior.state === "retried" ? { priorReason: res.prior.reason } : {}
				} : {};
				return Promise.resolve(res.ok ? {
					workerId: res.handle.id,
					assignmentId: res.handle.assignmentId ?? assignmentId,
					...res.handle.identity === void 0 ? {} : { identity: res.handle.identity },
					...res.handle.materialization === void 0 ? {} : { materialization: res.handle.materialization },
					...res.handle.executionBindings === void 0 ? {} : { executionBindings: res.handle.executionBindings },
					continuity: continuity.continuity,
					...continuity.continuity === "resume" ? { resume: continuity.resume } : {},
					...successorOf !== void 0 ? { successorOf } : {},
					status: res.handle.status,
					live: liveWorkerCount(),
					queued: queuedWorkerCount(),
					freeSlots: freeWorkerSlots(),
					...priorHistory,
					...resourcePaths.resolved.length === 0 ? {} : { resourcesFromPath: resourcePaths.resolved }
				} : {
					error: res.reason,
					reason: spawnRefusalReason(res.reason, res.shortfalls, {
						usdUnbudgeted: "this run's root budget declares no maxUsd, so a child budget naming maxUsd can never be admitted at any amount — spawn with a budget that omits maxUsd",
						inDoubt: "this key has a prior worker recorded as started without a terminal receipt; no replacement was started because that remote worker may still be running — inspect or recover the exact prior execution before retrying",
						scopeSettled: "this run has already reached its join barrier — its driver returned and the supervisor is settling, so no further worker can be started, joined, or paid for; record this stage as not started"
					}),
					...res.shortfalls === void 0 ? {} : { shortfalls: res.shortfalls },
					...res.reason === "usd-unbudgeted" ? { hint: "This run's root budget declares no maxUsd, so a child budget naming maxUsd can never be admitted — at any amount. Retrying with a smaller maxUsd will fail identically. Spawn with a budget that omits maxUsd, or ask the caller to give the run a root maxUsd." } : res.reason === "in-doubt" ? { hint: "Do not retry this key. Use the recorded prior worker identity to inspect or recover that exact execution. A terminal receipt or explicit recovery is required before replacement work can start." } : {},
					live: liveWorkerCount(),
					freeSlots: freeWorkerSlots()
				});
			}
		},
		{
			name: "observe_agent",
			description: "Inspect a worker WHILE IT RUNS, not only after it finishes: status, spend so far, and `progress` — how long since it last did anything (`idleMs`), whether that counts as stalled, how many turns it has taken, the last tools/files it touched (`recentActivity`), what its executor CHANGED about the profile you gave it (`derived` — an MCP config it materialized, an extension it had to add), whether a steer can even reach it (`steerable`), and how many steers it has not yet read (`pendingMessages`). For a worker that leads its own team, `progress.team` counts the agents below it (working, queued, done, down) and its idle clock reads the newest activity anywhere in that team, so a lead whose workers are busy is not stalled. A queued worker waits for a worker slot and is never stalled. A worker whose executor has FINISHED but whose settlement you have not yet drained reports `settlementPending` with its terminal kind; its `status` still reads running until await_event delivers it, so call await_event, not observe_agent again. The settled output artifact is returned once drained. Select a field with `outputPath`, for example [\"content\"] to read a provider result without its event history. Omit it to read the complete artifact. Large outputs return a bounded JSON `outputPage`; repeat with `outputOffset: outputPage.nextOffset` until it is null, concatenate page text, then parse the JSON. Offsets and limits count UTF-16 characters. The full artifact stays retained; an outRef is a content address, not a workspace path. Use this BEFORE steer_agent: a steer is only worth sending when the progress says the worker is on the wrong path or has stopped making any.",
			inputSchema: {
				type: "object",
				properties: {
					workerId: idArg,
					outRef: {
						type: "string",
						description: "Instead of workerId: the content address of a result listed in a settled worker's `subtree.results`, to read one of its team's outputs in full."
					},
					outputPath: {
						type: "array",
						items: { type: "string" },
						description: "Own field names from the artifact root; array indices use strings. Default: the complete artifact."
					},
					outputOffset: {
						type: "integer",
						minimum: 0,
						description: "Start at this retained JSON character offset; default 0."
					},
					outputLimit: {
						type: "integer",
						minimum: 1,
						maximum: WORKER_OUTPUT_PAGE_CHARS,
						description: `Maximum JSON characters per page; default ${WORKER_OUTPUT_PAGE_CHARS}.`
					}
				}
			},
			handler: async (raw) => {
				const args = obj(raw);
				const outputRead = workerOutputReadOptions(args);
				if (args.outRef !== void 0 && args.workerId === void 0) {
					const outRef = str(args.outRef, "outRef");
					if (!descendantOutRefs.has(outRef)) return {
						error: "unknown-result",
						reason: "this outRef was not listed in any subtree summary you received; pass the outRef of an entry in a settled worker’s subtree.results, or observe your own worker by workerId"
					};
					return {
						outRef,
						...await readWorkerOutput(outRef, outputRead)
					};
				}
				const id = str(args.workerId, "workerId");
				const node = opts.scope.view.nodes.find((n) => n.id === id);
				if (!node) {
					const resumed = opts.scope.resume?.view.nodes.find((n) => n.id === id);
					if (!resumed) return {
						error: "unknown-worker",
						reason: `no worker of this manager has the id ${JSON.stringify(id)}; spawn_worker returns the ids you may observe`
					};
					return {
						...projectNodeEvidence(resumed, true),
						outRef: resumed.outRef ?? null,
						...await readWorkerOutput(resumed.outRef, outputRead),
						progress: null
					};
				}
				const progress = readProgress(id);
				const pending = node.settlementPending;
				return {
					...projectNodeEvidence(node),
					outRef: node.outRef ?? null,
					...await readWorkerOutput(node.outRef, outputRead),
					progress: progress ?? null,
					...pending ? {
						settlementPending: pending,
						hint: `this worker has finished (${pending.kind}); its settlement is queued — call await_event to receive it, observing again will not change this`
					} : {}
				};
			}
		},
		{
			name: "steer_agent",
			description: "Send a message DOWN to a still-LIVE worker (parent→child): a new instruction, a course correction, or a continuation. The worker drains it at its next step boundary — and before it may settle, so it cannot finish while a message it never read is pending. A worker that already settled is gone (returns delivered:false) — spawn a fresh one instead.",
			inputSchema: {
				type: "object",
				properties: {
					workerId: idArg,
					instruction: {
						type: "string",
						description: "What the worker should do next."
					},
					interrupt: {
						type: "boolean",
						description: "true = forceful: abort the worker’s in-flight inference so it re-plans on the NEXT turn (a tool already mid-execution finishes first; only the owned tool-loop honors this). false/omitted = queued: it flushes at the next step boundary (and before it may settle)."
					}
				},
				required: ["workerId", "instruction"]
			},
			handler: async (raw) => {
				const a = obj(raw);
				const workerId = str(a.workerId, "workerId");
				const instruction = str(a.instruction, "instruction");
				const delivery = await steerWorker(workerId, instruction, { interrupt: a.interrupt === true });
				if (delivery.delivered) return {
					delivered: true,
					progress: readProgress(workerId) ?? null
				};
				return {
					delivered: false,
					outcome: delivery.outcome,
					reason: downMessageRefusalReasons[delivery.outcome],
					progress: readProgress(workerId) ?? null
				};
			}
		},
		{
			name: "cancel_worker",
			description: "Cancel one of YOUR live workers — running, or queued for a worker slot — and every worker it leads. Its unspent budget returns to your pool when it settles, so this is how you take back what a stalled or no-longer-needed worker holds (for example when spawn_worker is refused budget-exhausted while workers you no longer need hold the budget). The cancelled worker still settles `down` through await_event with what it spent. Refused (`error: \"not-live\"`) for a worker that already settled or is not yours.",
			inputSchema: {
				type: "object",
				properties: {
					workerId: idArg,
					reason: {
						type: "string",
						description: "Why it is cancelled; recorded on its settlement."
					}
				},
				required: ["workerId"]
			},
			handler: async (raw) => {
				const a = obj(raw);
				const workerId = str(a.workerId, "workerId");
				const why = a.reason === void 0 ? "cancelled by its manager" : str(a.reason, "reason");
				const cancelled = opts.scope.view.nodes.some((node) => node.id === workerId && isLiveNodeStatus(node.status)) ? abortWorker(workerId, why) : void 0;
				if (cancelled === void 0) return {
					error: "not-live",
					reason: `'${workerId}' is not a live worker you spawned; only your own running or queued workers can be cancelled`,
					live: liveWorkerCount(),
					queued: queuedWorkerCount()
				};
				return {
					cancelled: true,
					workerId: cancelled.id,
					label: cancelled.label,
					live: liveWorkerCount(),
					queued: queuedWorkerCount()
				};
			}
		},
		{
			name: "await_event",
			description: "Wait for and pull the next message a worker, sub-driver, or analyst sent up — the unified inbox. Read a settled artifact with the returned `outputRead` call; the receipt carries its reference, not its bytes. An event is one of: a settled worker output ('settled'), a question needing your answer ('question', from ask_parent / the worker's ask-user), or a trace-analyst finding ('finding', from analyze-on-settle). Pass kinds:['settled'] for just the next finished worker; omit `kinds` to also receive questions and findings. Returns { idle: true } when nothing is queued and no workers are live. If a worker is still running when the wait elapses, returns { pending: true, live: [...] } (the workers still in flight) instead of blocking indefinitely — call await_event again to keep waiting; the settlement is not lost. Every reply carries `freeSlots`: how many more workers you can start right now (`null` = uncapped). A settled worker frees its slot, so `freeSlots > 0` means capacity is sitting idle — spawn into it before waiting again. Each event carries `eventSeq`; pass the ones you have processed in `acknowledge` on a later call. An event delivered to a turn that ends in failure is named again when you are re-entered, until it is acknowledged. Pass `max` above 1 to read a whole team at once: the reply is `{ events: [...] }` with the first event it waited for plus every other event already waiting, up to `max`, so a lead of hundreds of workers reads their receipts in a few turns instead of one each.",
			inputSchema: {
				type: "object",
				properties: {
					kinds: {
						type: "array",
						items: {
							type: "string",
							enum: [...awaitableEventKinds]
						},
						description: "Restrict to these event kinds (any if omitted)."
					},
					acknowledge: {
						type: "array",
						items: {
							type: "integer",
							minimum: 0
						},
						description: "The eventSeq of each earlier event you have now processed."
					},
					max: {
						type: "integer",
						minimum: 1,
						description: "Most events to return in one reply. Omit or 1 for one event; above 1 returns `{ events }`."
					}
				}
			},
			handler: async (raw) => {
				const args = raw === void 0 ? {} : obj(raw);
				const max = args.max === void 0 ? 1 : args.max;
				if (typeof max !== "number" || !Number.isSafeInteger(max) || max < 1) throw new Error("coordination tools: \"max\" must be a positive integer");
				const k = args.kinds;
				const kinds = Array.isArray(k) ? k.filter(isAwaitableEventKind) : void 0;
				if (Array.isArray(args.acknowledge)) {
					const named = new Set(args.acknowledge.filter((value) => typeof value === "number" && Number.isInteger(value)));
					await acknowledge(deliveries.filter((delivery) => named.has(delivery.record.seq)), "manager");
				}
				const deliver = (record) => {
					deliveries.push({
						record,
						attempt: driverAttempt,
						acknowledged: false
					});
					return {
						...projectEvent(record.event),
						eventSeq: record.seq
					};
				};
				if (max > 1) {
					const fenceAt = awaitTimeoutMs > 0 ? Date.now() + awaitTimeoutMs / 2 : Infinity;
					if (!inFlightDrain) {
						inFlightDrain = (async () => {
							let drained = false;
							while (bus.pending(kinds) < max && Date.now() < fenceAt) {
								if (!await drainSettlement("nextResolved")) break;
								drained = true;
							}
							return drained;
						})().finally(() => {
							inFlightDrain = null;
						});
						await inFlightDrain;
					}
					const events = [];
					const takeQueued = () => {
						for (let next = bus.pullRecord(kinds); next; next = bus.pullRecord(kinds)) {
							events.push(deliver(next));
							if (events.length >= max) return;
						}
					};
					takeQueued();
					if (events.length === 0) {
						const first = await pullOne();
						if (!("eventSeq" in first)) return first;
						const { freeSlots: _slots, ...head } = first;
						events.push(head);
						takeQueued();
					}
					return {
						events,
						freeSlots: freeWorkerSlots()
					};
				}
				return pullOne();
				async function pullOne() {
					let ev = bus.pullRecord(kinds);
					if (ev) return {
						...deliver(ev),
						freeSlots: freeWorkerSlots()
					};
					const raced = await raceDrainWithTimeout(ensureDrain());
					if (raced === void 0) return {
						pending: true,
						live: liveSnapshot(),
						freeSlots: freeWorkerSlots()
					};
					ev = bus.pullRecord(kinds);
					if (!ev) return {
						idle: !raced.drained,
						freeSlots: freeWorkerSlots()
					};
					return {
						...deliver(ev),
						freeSlots: freeWorkerSlots()
					};
				}
			}
		},
		{
			name: "list_questions",
			description: "List questions raised by workers, drivers, or analysts. Blocking stop behavior follows questionPolicy.",
			inputSchema: {
				type: "object",
				properties: {}
			},
			handler: () => Promise.resolve({ questions })
		},
		{
			name: "answer_question",
			description: "Record an answer, deferral, or escalation for a loop question.",
			inputSchema: {
				type: "object",
				properties: {
					questionId: { type: "string" },
					answer: { type: "string" },
					by: {
						type: "string",
						description: "Node id or \"user\"."
					},
					deferReason: { type: "string" },
					escalateTo: {
						type: "string",
						enum: questionEscalationTargets
					},
					escalateReason: { type: "string" }
				},
				required: ["questionId"]
			},
			handler: async (raw) => {
				const a = obj(raw);
				const questionId = str(a.questionId, "questionId");
				if (typeof a.answer === "string" && a.answer.length > 0) {
					const answer = a.answer;
					const pendingQuestion = questions.find((question) => question.id === questionId);
					if (pendingQuestion === void 0) return unknownQuestion(questionId);
					const interrupt = pendingQuestion.urgency === "blocks-run" || pendingQuestion.urgency === "blocks-step";
					const authorized = authorizeInstruction("answer", pendingQuestion.from, answer, interrupt, questionId);
					await recordInstruction(authorized);
					const delivery = await attemptDelivery(authorized, {
						answer: authorized.instruction,
						questionId,
						interrupt
					});
					return {
						question: delivery.delivered ? decideQuestion(questionId, {
							kind: "answer",
							answer: authorized.instruction,
							by: typeof a.by === "string" && a.by.length > 0 ? a.by : "user"
						}) : pendingQuestion,
						delivered: delivery.delivered,
						...delivery.delivered ? {} : {
							outcome: delivery.outcome,
							reason: downMessageRefusalReasons[delivery.outcome]
						}
					};
				}
				if (typeof a.deferReason === "string" && a.deferReason.length > 0) {
					if (!questions.some((question) => question.id === questionId)) return Promise.resolve(unknownQuestion(questionId));
					return Promise.resolve({ question: decideQuestion(questionId, {
						kind: "defer",
						reason: a.deferReason
					}) });
				}
				if (typeof a.escalateTo === "string" && a.escalateTo.length > 0) {
					if (!isQuestionEscalationTarget(a.escalateTo)) return Promise.resolve({
						error: "invalid-escalation-target",
						reason: `escalateTo must be one of ${questionEscalationTargets.join(", ")}; received ${JSON.stringify(a.escalateTo)}`
					});
					if (!questions.some((question) => question.id === questionId)) return Promise.resolve(unknownQuestion(questionId));
					const escalateReason = typeof a.escalateReason === "string" && a.escalateReason.length > 0 ? a.escalateReason : "driver escalated";
					const decided = decideQuestion(questionId, {
						kind: "escalate",
						to: a.escalateTo,
						reason: escalateReason
					});
					if (a.escalateTo !== "parent") return Promise.resolve({ question: decided });
					return escalate(decided).then((escalation) => ({
						question: decided,
						escalated: escalation.delivered,
						outcome: escalation.delivered ? "queued-for-parent" : "no-parent",
						reason: escalation.delivered ? `the question is held by ${escalation.to}` : escalation.reason,
						...escalation.delivered ? {} : { guidance: "No inbox above this manager is configured to receive it, so nothing will route an answer back to you. The question stays on the run record for anyone watching. Do not BLOCK on it: answer_question it yourself, or answer_question with deferReason to record that it stays open." }
					}));
				}
				return Promise.resolve({
					error: "no-decision",
					reason: "a decision is required: pass `answer` to answer the question, `deferReason` to record that it stays open, or `escalateTo` to hand it further up"
				});
			}
		},
		{
			name: "ask_parent",
			description: "Raise a question to the parent driver/Pi/user when this driver cannot decide.",
			inputSchema: {
				type: "object",
				properties: {
					from: { type: "string" },
					level: {
						type: "string",
						enum: [
							"worker",
							"driver",
							"loop"
						]
					},
					question: { type: "string" },
					reason: { type: "string" },
					urgency: {
						type: "string",
						enum: [
							"continue-without",
							"blocks-step",
							"blocks-run"
						]
					}
				},
				required: [
					"from",
					"level",
					"question",
					"reason",
					"urgency"
				]
			},
			handler: async (raw) => {
				const a = obj(raw);
				const from = str(a.from, "from");
				const q = await emitNewQuestion(addQuestion({
					from,
					level: level(a.level),
					question: str(a.question, "question"),
					reason: str(a.reason, "reason"),
					urgency: urgency(a.urgency)
				}, from, {
					kind: "escalate",
					to: "parent",
					reason: "asked parent"
				}));
				const escalation = await escalate(q);
				return {
					question: q,
					escalated: escalation.delivered,
					outcome: escalation.delivered ? "queued-for-parent" : "no-parent",
					reason: escalation.delivered ? `the question is held by ${escalation.to}` : escalation.reason,
					...escalation.delivered ? {} : { guidance: "Nobody above this manager received the question. It is journaled for the operator, and YOU are the last decider: answer_question it yourself, or answer_question with deferReason to record that it stays open. Do not wait for an answer." }
				};
			}
		},
		...deliverable ? [{
			name: "submit_result",
			description: [
				"Submit the complete result to the injected independent check.",
				"The first passing result is retained; stop work when accepted.",
				...deliverable.describe ? [`Expected result: ${deliverable.describe}`] : []
			].join(" "),
			inputSchema: {
				type: "object",
				properties: { result: { description: "The complete result in the form requested by the task." } },
				required: ["result"],
				additionalProperties: false
			},
			handler: async (raw) => {
				if (submitted) return {
					accepted: true,
					retained: "earlier-passing-result",
					stop: true
				};
				const a = obj(raw);
				if (!Object.hasOwn(a, "result")) throw new Error("submit_result: \"result\" is required");
				const open = openWorkRefusal("submit_result");
				if (open !== void 0) {
					lastRejection = {
						at: Date.now(),
						reason: String(open.reason)
					};
					return {
						accepted: false,
						stop: false,
						...open
					};
				}
				const result = structuredClone(a.result);
				let verdict;
				let fault;
				try {
					verdict = checkVerdictOf(await deliverable.check(result));
				} catch (error) {
					fault = {
						unavailable: error instanceof CheckUnavailableError,
						message: error instanceof Error ? error.message : String(error)
					};
				}
				const read = recordCheckRead({
					source: "submit",
					...verdict === void 0 ? {} : { verdict },
					...fault === void 0 ? {} : { unavailable: fault.message }
				});
				if (verdict === void 0 || !verdict.pass) {
					const refusal = verdict !== void 0 ? refusalText(verdict, deliverable, read.read) : fault?.unavailable === true ? `the check could not run, so this result was not judged (check read ${read.read}): ${fault.message}` : `the independent check THREW, so nothing was accepted (check read ${read.read}): ${fault?.message}. This is a fault in the check, not necessarily in your result — report it rather than resubmitting unchanged`;
					lastRejection = {
						at: Date.now(),
						reason: refusal
					};
					return {
						accepted: false,
						stop: false,
						reason: refusal,
						checkRead: read.read
					};
				}
				if (submitted) return {
					accepted: true,
					retained: "earlier-passing-result",
					stop: true
				};
				if (submissionInFlight) {
					await submissionInFlight;
					return {
						accepted: true,
						retained: "earlier-passing-result",
						stop: true
					};
				}
				const acceptedSubmission = detachedFrozen({ result });
				const commit = bus.publish({
					type: "submission",
					result: acceptedSubmission.result
				}, { queue: false }).then(() => {
					submitted = acceptedSubmission;
					stopped = true;
					reason = "result-accepted";
					notifyStop();
				});
				submissionInFlight = commit;
				try {
					await commit;
				} finally {
					if (submissionInFlight === commit) submissionInFlight = void 0;
				}
				await acknowledge(deliveries, "result-accepted");
				return {
					accepted: true,
					retained: "this-result",
					stop: true
				};
			}
		}] : [],
		...deliverable ? [] : [{
			name: "stop",
			description: "Declare the run complete.",
			inputSchema: {
				type: "object",
				properties: { reason: {
					type: "string",
					description: "Why you are stopping."
				} }
			},
			handler: (raw) => {
				const blocking = blockingQuestionsForStop();
				if (blocking.length) {
					const unheard = blocking.filter((question) => escalations.some((record) => record.questionId === question.id && record.delivered === false));
					return Promise.resolve({
						stopped: false,
						error: "unresolved-blocking-questions",
						reason: `${blocking.length} blocking question${blocking.length === 1 ? "" : "s"} ${blocking.length === 1 ? "is" : "are"} still undecided` + (unheard.length > 0 ? `, and ${unheard.length} of them reached no parent — nothing above this manager will answer ${unheard.length === 1 ? "it" : "them"}. Decide ${unheard.length === 1 ? "it" : "them"} with answer_question (answer, or deferReason to record that it stays open) and stop again.` : ". Decide each with answer_question (answer, deferReason, or escalateTo) and stop again."),
						questions: blocking,
						...unheard.length > 0 ? { unheardQuestionIds: unheard.map((q) => q.id) } : {}
					});
				}
				const open = openWorkRefusal("stop");
				if (open !== void 0) return Promise.resolve({
					stopped: false,
					...open
				});
				stopped = true;
				const r = obj(raw).reason;
				reason = typeof r === "string" ? r : void 0;
				notifyStop();
				return Promise.resolve({ stopped: true });
			}
		}],
		...opts.readContinuation ? [{
			name: "read_continuation",
			description: ["Read a continuation note in full: the note, every line of the check's verdict, and", "the question panel's answers. Omit continuation for the latest."].join(" "),
			inputSchema: {
				type: "object",
				properties: { continuation: {
					type: "integer",
					minimum: 1,
					description: "Which continuation, 1-based. Omit for the latest."
				} },
				additionalProperties: false
			},
			handler: async (raw) => {
				const value = obj(raw).continuation;
				if (value !== void 0 && (!Number.isInteger(value) || value < 1)) throw new Error("read_continuation: \"continuation\" must be an integer >= 1");
				return opts.readContinuation?.(value);
			}
		}] : [],
		{
			name: "report_blocked",
			description: [
				"Report that a tool you need keeps failing, so the run cannot go on.",
				"Name the tool, the arguments you called it with, and the error you saw.",
				"The coordinator calls that tool again, with those arguments, under your identity.",
				"When the call succeeds you are not blocked: the reply carries its result, and you continue.",
				"When it fails again, the run ends as blocked and the record keeps both errors.",
				"submit_result, stop and report_blocked cannot be probed."
			].join(" "),
			inputSchema: {
				type: "object",
				properties: {
					tool: {
						type: "string",
						description: "The tool that failed, as you called it."
					},
					arguments: {
						type: "object",
						description: "The arguments you called it with. Omit for none."
					},
					error: {
						type: "string",
						description: "The error the tool returned to you."
					}
				},
				required: ["tool", "error"],
				additionalProperties: false
			},
			handler: async (raw) => {
				const a = obj(raw);
				const named = str(a.tool, "tool");
				const reported = str(a.error, "error");
				const bare = named.replace(/^mcp__.+?__/u, "").replace(/^.*?coordination_+/u, "");
				if (unprobeableVerbs.has(bare)) return {
					blocked: false,
					error: "unprobeable",
					reason: `${bare} changes the run, so the coordinator does not call it for you`
				};
				const target = opts.resolveProbeTool?.(bare) ?? tools.find((tool) => tool.name === bare);
				if (target === void 0) return {
					blocked: false,
					error: "unknown-tool",
					reason: `no tool named ${JSON.stringify(bare)} is served to you, so there is nothing to probe; call the tools you were given`
				};
				const args = a.arguments === void 0 ? {} : typeof a.arguments === "object" && a.arguments !== null && !Array.isArray(a.arguments) ? a.arguments : void 0;
				if (args === void 0) return {
					blocked: false,
					error: "invalid-arguments",
					reason: "\"arguments\" must be an object"
				};
				let probe;
				try {
					probe = {
						ok: true,
						result: await runWithin(target.handler(structuredClone(args)), REPORT_BLOCKED_PROBE_MS, `the probe of ${bare} did not answer within ${REPORT_BLOCKED_PROBE_MS}ms`)
					};
				} catch (error) {
					probe = {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				if (probe.ok) return {
					blocked: false,
					probe: {
						tool: bare,
						ok: true,
						result: probe.result
					},
					guidance: "The call worked when the coordinator made it under your identity, so the tool is not blocked. Use this result and continue the objective."
				};
				blockedEvidence = Object.freeze({
					tool: bare,
					reported,
					probed: probe.error
				});
				stopped = true;
				reason = `blocked: ${bare} failed when the coordinator probed it: ${probe.error}`;
				notifyStop();
				return {
					blocked: true,
					stopped: true,
					probe: {
						tool: bare,
						ok: false,
						error: probe.error
					}
				};
			}
		},
		{
			name: "read_journal",
			description: [
				"Re-read YOUR OWN coordination journal: every spawn you made, every worker that settled,",
				"every question raised or decided, every steer you authorized, and every analyst finding —",
				"oldest first, on this node only, including what you did before a restart. Read it before",
				"deciding what to do next, so you can see what you already tried. Bounded: page with the",
				"returned `nextRow`, and check `truncated` before concluding you have read everything."
			].join(" "),
			inputSchema: {
				type: "object",
				properties: {
					sinceRow: {
						type: "integer",
						minimum: 0,
						description: "First journal row to return (inclusive, 0 = the first record of the run). Pass the previous call’s `nextRow` to continue."
					},
					kinds: {
						type: "array",
						items: {
							type: "string",
							enum: [...journalEventKinds]
						},
						description: "Return only these event kinds. Omit for every kind."
					},
					limit: {
						type: "integer",
						minimum: 1,
						description: `Maximum rows to return. Default ${JOURNAL_READ_BOUNDS.defaultLimit}; anything above ${JOURNAL_READ_BOUNDS.maxLimit} is clamped to it.`
					},
					maxBytes: {
						type: "integer",
						minimum: 1,
						description: `Byte budget for the returned rows. Default ${JOURNAL_READ_BOUNDS.defaultMaxBytes}; anything above ${JOURNAL_READ_BOUNDS.maxMaxBytes} is clamped to it.`
					}
				},
				additionalProperties: false
			},
			handler: async (raw) => readJournal(raw)
		}
	];
	if (opts.analysts) {
		tools.push({
			name: "list_analysts",
			description: "List trace-analyst lenses available to run over a settled worker — the ones this run was given plus any you defined with define_analyst.",
			inputSchema: {
				type: "object",
				properties: {}
			},
			handler: () => Promise.resolve({ analysts: analystMenu() })
		});
		tools.push({
			name: "run_analyst",
			description: "Apply an analyst lens to a settled worker trace.",
			inputSchema: {
				type: "object",
				properties: {
					kind: {
						type: "string",
						description: "The analyst kind id."
					},
					workerId: idArg
				},
				required: ["kind", "workerId"]
			},
			handler: async (raw) => {
				const a = obj(raw);
				const id = str(a.workerId, "workerId");
				const node = nodeForWorker(id);
				if (!node) return {
					error: "unknown-worker",
					reason: `no worker of this manager has the id ${JSON.stringify(id)}; spawn_worker returns the ids you may analyze`
				};
				if (isLiveNodeStatus(node.status)) return {
					error: "worker-not-settled",
					reason: `worker ${JSON.stringify(id)} has not settled, so it has no trace to analyze yet — await_event until it settles, then run the lens`
				};
				const trace = ledger.find((worker) => worker.id === id)?.trace ?? node.trace ?? {
					status: "unavailable",
					reason: "legacy-settlement-without-trace-evidence"
				};
				let store;
				try {
					store = await workerTraceAnalysisStore(trace, opts.blobs);
				} catch (error) {
					return {
						error: "trace-unreadable",
						reason: `the settled worker's trace evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
						trace
					};
				}
				const kind = str(a.kind, "kind");
				if (!analystMenu().some((entry) => entry.id === kind)) return {
					error: "unknown-analyst",
					reason: `no lens named ${JSON.stringify(kind)} is on this manager's menu; call list_analysts to see what you may run`
				};
				return { findings: await opts.analysts?.run(kind, store) };
			}
		});
		if (opts.analysts.register) tools.push({
			name: "define_analyst",
			description: [
				"Define a NEW trace-analyst lens for this run, then run it with run_analyst like any",
				"other. You write the research question, the policy for answering it, which trace tools",
				"it may use, and the model seat — data only, never code. The definition is journaled, so",
				"the lens you invented is reproducible and attributed to you."
			].join(" "),
			inputSchema: {
				type: "object",
				properties: {
					id: {
						type: "string",
						description: "Stable lens id: lowercase letters, digits and hyphens, 2-64 characters. It is the `kind` you pass to run_analyst and the analyst_id on every finding."
					},
					description: {
						type: "string",
						description: `One line naming what this lens looks for. At most ${ANALYST_DEFINITION_BOUNDS.maxDescriptionChars} characters.`
					},
					area: {
						type: "string",
						description: "The finding area this lens reports under, e.g. coordination, tool-use, cost."
					},
					question: {
						type: "string",
						description: `The research question, in your own words. At most ${ANALYST_DEFINITION_BOUNDS.maxQuestionChars} characters.`
					},
					instructions: {
						type: "string",
						description: `How to answer it: evidence rules, what counts as a finding, what to refuse to infer. At most ${ANALYST_DEFINITION_BOUNDS.maxInstructionsChars} characters.`
					},
					toolGroup: {
						type: "string",
						enum: [...analystToolGroupNames],
						description: "Smallest trace-tool set that can answer the question. discovery = overview/query/count only; discoveryAndRead adds deep reads; discoveryAndSearch adds regex; targeted and singleTrace narrow further; all grants every trace tool."
					},
					model: {
						type: "string",
						description: "The model seat this lens should run on. Omit for the run default. It is a request: registration may refuse a seat this run cannot serve."
					},
					limits: {
						type: "object",
						properties: {
							maxIterations: {
								type: "integer",
								minimum: 1,
								maximum: ANALYST_DEFINITION_BOUNDS.maxIterations
							},
							maxLlmCalls: {
								type: "integer",
								minimum: 1,
								maximum: ANALYST_DEFINITION_BOUNDS.maxLlmCalls
							},
							maxToolCalls: {
								type: "integer",
								minimum: 1,
								maximum: ANALYST_DEFINITION_BOUNDS.maxToolCalls
							},
							maxOutputChars: {
								type: "integer",
								minimum: 1,
								maximum: ANALYST_DEFINITION_BOUNDS.maxOutputChars
							}
						},
						additionalProperties: false,
						description: "Investigation ceilings. Values above the maximum are clamped, not refused."
					},
					minimumEvidenceCitations: {
						type: "integer",
						minimum: 1,
						maximum: ANALYST_DEFINITION_BOUNDS.maxEvidenceCitations,
						description: "Distinct evidence citations required per finding. Default 1."
					}
				},
				required: [
					"id",
					"description",
					"area",
					"question",
					"instructions",
					"toolGroup"
				],
				additionalProperties: false
			},
			handler: async (raw) => defineAnalyst(raw)
		});
	}
	const abortWorker = (ref, reason) => {
		const live = opts.scope.view.nodes.filter((node) => isLiveNodeStatus(node.status));
		const target = live.find((node) => node.id === ref) ?? live.find((node) => profileNameByWorker.get(node.id) === ref) ?? live.find((node) => node.label === ref);
		if (target === void 0) return void 0;
		const handle = liveHandles.get(target.id);
		if (handle === void 0) return void 0;
		handle.abort(reason);
		return {
			id: target.id,
			label: target.label
		};
	};
	return {
		tools,
		ready,
		history: () => bus.history(),
		raiseFinding: (finding) => bus.publish({
			type: "finding",
			finding: canonicalFindingEvent(finding)
		}).then(() => void 0),
		steerWorker,
		stats: () => opts.preflightSpawn === void 0 ? bus.stats() : {
			...bus.stats(),
			preflight: { ...preflightCounts }
		},
		isStopped: () => stopped,
		stopReason: () => reason,
		submittedResult: () => submitted,
		settled: () => ledger,
		questions: () => questions,
		escalations: () => escalations,
		definedAnalysts: () => definedAnalysts,
		drainResolved,
		abortWorker,
		beginDriverAttempt: (attempt) => {
			driverAttempt = attempt;
		},
		endDriverAttempt: async (outcome) => {
			const attempt = driverAttempt;
			if (outcome === "completed") await acknowledge(deliveries.filter((delivery) => delivery.attempt === attempt), "turn-completed");
		},
		reentryState: () => {
			const { unqueued, queued } = openWork();
			const deliveredSettled = new Set(deliveries.flatMap((delivery) => delivery.record.event.type === "settled" ? [delivery.record.event.worker.id] : []));
			return detachedFrozen({
				journalRows: priorJournal.length + bus.history().length,
				journalReadTo,
				live: (opts.scope.view?.nodes ?? []).filter((node) => isLiveNodeStatus(node.status)).map((node) => ({
					id: node.id,
					label: node.label,
					status: node.status
				})),
				settled: [...ledger.map((worker) => ({
					id: worker.id,
					status: worker.status,
					...worker.status === "done" && worker.valid !== void 0 ? { valid: worker.valid } : {},
					delivered: deliveredSettled.has(worker.id)
				})), ...unqueued.map((node) => ({
					id: node.id,
					status: node.status === "done" ? "done" : "down",
					delivered: false
				}))],
				waiting: [...queued.map((record) => ({
					type: record.event.type,
					...eventWorker(record.event) === void 0 ? {} : { worker: eventWorker(record.event) }
				})), ...unqueued.map((node) => ({
					type: "settled",
					worker: node.id
				}))],
				unacknowledged: deliveries.filter((delivery) => !delivery.acknowledged).map((delivery) => ({
					seq: delivery.record.seq,
					type: delivery.record.event.type,
					...eventWorker(delivery.record.event) === void 0 ? {} : { worker: eventWorker(delivery.record.event) },
					...delivery.attempt === void 0 ? {} : { attempt: delivery.attempt }
				})),
				...lastRejection === void 0 ? {} : { lastRejection }
			});
		},
		blocked: () => blockedEvidence,
		checkReads: () => checkReads,
		recordCheckRead,
		...peerMail ? { peerMail } : {}
	};
}
/**
* The refusal a failed check reading returns to `submit_result`: the verdict as a located fact,
* the FAIL lines unless the check's tests must stay hidden, and how many times the manager has
* read the check.
*/
function refusalText(verdict, deliverable, read) {
	const total = Object.keys(verdict.items ?? {}).length;
	const failed = failedItems(verdict).length;
	const score = verdict.composite === void 0 ? "" : ` (composite ${verdict.composite}${verdict.threshold === void 0 ? "" : `, passes at ${verdict.threshold}`})`;
	const head = total > 0 ? `The outside check failed: ${failed} of ${total} items fail${score}. Check read ${read}.` : `The outside check failed${score}. Check read ${read}.`;
	if (deliverable.feedback === "pass-only") return head;
	const lines = verdict.failures ?? [];
	if (lines.length === 0) return deliverable.describe ? `${head} Expected: ${deliverable.describe}` : head;
	const shown = lines.slice(0, 40);
	return [
		head,
		...shown,
		...lines.length > shown.length ? [`${lines.length - shown.length} more failure lines.`] : []
	].join("\n");
}
/** The verbs `report_blocked` never calls on a manager's behalf: each one changes the run. */
const unprobeableVerbs = /* @__PURE__ */ new Set([
	"submit_result",
	"stop",
	"report_blocked"
]);
/** How long one `report_blocked` probe may run before it counts as a failure. */
const REPORT_BLOCKED_PROBE_MS = 6e4;
async function runWithin(work, ms, message) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
		if (typeof timer?.unref === "function") timer.unref();
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
function nextUnkeyedAssignmentOrdinal(scope) {
	let next = 0;
	const views = [scope.resume?.view, scope.view];
	for (const view of views) {
		if (view === void 0) continue;
		for (const node of view.nodes) {
			const match = /^ordinal:(\d+)$/.exec(node.assignmentId ?? "");
			if (match === null) continue;
			const ordinal = Number(match[1]);
			if (!Number.isSafeInteger(ordinal)) throw new Error(`coordination: durable assignment id '${node.assignmentId}' exceeds the safe ordinal range`);
			next = Math.max(next, ordinal + 1);
		}
	}
	if (!Number.isSafeInteger(next)) throw new Error("coordination: durable assignment ordinal space is exhausted");
	return next;
}
/** Stringify a findings payload for a routed delivery; never throws (a cyclic payload degrades to
*  its String form rather than killing the settle path). */
function safeJsonText(value) {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}
//#endregion
//#region src/runtime/supervise/run-cancellation.ts
/** Apply a durable request through the run's existing abort controller. */
function applyRunCancellation(dir, abortRun, now, path = "turn-boundary") {
	const request = readRunCancelRequest(dir);
	if (request === void 0) return void 0;
	const prior = readRunCancellation(dir, request.operationId);
	if (prior !== void 0) return prior;
	abortRun(request.reason ?? "run cancel requested", request);
	const observedAt = now();
	const appliedAfterMs = Math.max(0, Date.parse(observedAt) - Date.parse(request.at));
	const record = {
		operationId: request.operationId,
		effect: "cancel_requested",
		path,
		appliedAfterMs,
		...request.deadlineMs === void 0 ? {} : { deadlineExceeded: appliedAfterMs > request.deadlineMs },
		requestedAt: request.at,
		observedAt,
		...request.reason === void 0 ? {} : { reason: request.reason },
		...request.operator === void 0 ? {} : { operator: request.operator },
		detail: "root abort issued to the whole run; termination not yet proven"
	};
	writeRunCancellation(dir, record);
	return record;
}
/** External drivers may remain silent indefinitely, so turn boundaries cannot observe control. */
function watchRunCancellation(dir, abortRun, createWatch = watch) {
	mkdirSync(workerCancellationsDir(dir), { recursive: true });
	let active = true;
	let failure;
	const check = (path = "observer") => {
		if (failure !== void 0) throw failure;
		if (active) applyRunCancellation(dir, abortRun, () => (/* @__PURE__ */ new Date()).toISOString(), path);
	};
	const fail = (error) => {
		if (!active) return;
		failure = error;
		abortRun(`durable run cancellation observer failed: ${String(error)}`);
	};
	let watcher;
	try {
		watcher = createWatch(workerCancellationsDir(dir), (_event, filename) => {
			if (!active || filename !== null && filename !== "run.request.json") return;
			try {
				check();
			} catch (error) {
				fail(error);
			}
		});
	} catch (error) {
		const code = error.code;
		if (code !== "EMFILE" && code !== "ENOSPC") throw error;
	}
	watcher?.on("error", fail);
	const fallback = setInterval(() => {
		try {
			check("fallback");
		} catch (error) {
			fail(error);
		}
	}, 100);
	fallback.unref();
	return {
		check,
		close() {
			active = false;
			watcher?.close();
			clearInterval(fallback);
		}
	};
}
//#endregion
//#region src/runtime/supervise/coordination-log.ts
/**
* Durable side-log for coordination evidence the spawn journal does not own: questions, analyst
* findings, answer decisions, authorized continuation receipts, delivery-attempt markers, and
* delivery outcomes. A durable run
* (`supervise({ runDir })`) appends them as they publish and loads them on resume, so a restarted
* coordinator retains the exact evidence produced by prior processes.
*
* Answer down-events also fold status on load: a question answered before the crash reloads as
* `answered`, not as a re-blocking `open`. Settled events are skipped (the spawn journal is their
* ledger). A receipt followed by an attempt but no outcome proves the process died in the delivery
* window; that outcome remains unknown and no prior instruction is auto-delivered.
*
* JSONL, one fsynced record per event, keyed by `runId` — several runs may share one log file
* exactly as they share one spawn-journal file.
*
* @experimental
*/
/** Persist prior context plus exact continuation authorization, attempt, and result evidence.
* Settlements have their own journal. */
function persisted(event) {
	return event.type !== "settled";
}
/** FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. */
var FileCoordinationLog = class {
	path;
	appendTail = Promise.resolve();
	constructor(path) {
		this.path = path;
	}
	async append(runId, record, ownerId) {
		if (!persisted(record.event)) return;
		const append = this.appendTail.then(() => this.appendRecord(runId, record, ownerId));
		this.appendTail = append.catch(() => void 0);
		return append;
	}
	async appendRecord(runId, busRecord, ownerId) {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		await fs.mkdir(path.dirname(this.path), { recursive: true });
		const record = {
			runId,
			...ownerId !== void 0 ? { ownerId } : {},
			...busRecord
		};
		const needsSeparator = await prepareJsonlAppend(this.path);
		const fh = await fs.open(this.path, "a");
		try {
			await writeAllBytes(fh, `${needsSeparator ? "\n" : ""}${JSON.stringify(record)}\n`);
			await fh.sync();
		} finally {
			await fh.close();
		}
	}
	async load(runId, ownerId) {
		return foldCoordinationRecords(readCommittedJsonLines(this.path, { allowMissing: true }), runId, ownerId);
	}
};
/** @internal Shared replay semantics for file and SQL coordination evidence. */
async function foldCoordinationRecords(source, runId, ownerId) {
	const byId = /* @__PURE__ */ new Map();
	const findings = [];
	const escalations = [];
	const analystDefinitions = [];
	const continuations = [];
	const deliveryEvidence = [];
	const mail = [];
	const records = [];
	let legacySeq = 0;
	for await (const stored of source) {
		if (stored.runId !== runId) continue;
		if (ownerId !== void 0 && stored.ownerId !== ownerId) continue;
		const record = "seq" in stored ? {
			seq: stored.seq,
			at: stored.at,
			priority: stored.priority,
			event: stored.event
		} : {
			seq: legacySeq++,
			at: Date.parse(stored.at),
			priority: 0,
			event: stored.event
		};
		records.push(record);
		const ev = record.event;
		if (ev.type === "delivery-attempt" || ev.type === "steer" || ev.type === "answer") deliveryEvidence.push(ev);
		if (ev.type === "question") byId.set(ev.question.id, ev.question);
		else if (ev.type === "finding") findings.push(ev.finding);
		else if (ev.type === "answer") {
			const prior = byId.get(ev.questionId);
			if (prior && ev.down.delivered) byId.set(ev.questionId, {
				...prior,
				status: "answered",
				decision: {
					kind: "answer",
					answer: ev.down.instruction,
					by: "prior-run"
				}
			});
		} else if (ev.type === "instruction") continuations.push(ev.instruction);
		else if (ev.type === "mail") mail.push(ev.mail);
		else if (ev.type === "escalation") escalations.push(ev.escalation);
		else if (ev.type === "analyst-defined") analystDefinitions.push(ev.analyst);
	}
	return {
		...ownerId !== void 0 ? { ownerId } : {},
		questions: [...byId.values()],
		findings,
		escalations,
		analystDefinitions,
		continuations,
		deliveryEvidence,
		mail,
		records
	};
}
//#endregion
//#region src/runtime/supervise/run-context.ts
/**
*
* `createInMemoryRunContext` — the one-call bundle of the in-memory stores a
* `createSupervisor().run(root, task, opts)` needs: a fresh `InMemorySpawnJournal`
* (the event-sourced spawn log), a fresh `InMemoryResultBlobStore` (the
* content-addressed `outRef` payload store the driver's `observe`/`finalize` reads
* settled outputs through), and a fresh `createExecutorRegistry()` (the open
* `AgentSpec → Executor` resolver).
*
* It exists to kill the boilerplate every offline/local supervised run repeats by
* hand — three constructors threaded into `SupervisorOpts` — and to single-source the
* ONE wiring invariant that is easy to get wrong: when the root is the recursive
* `driverAgent` LLM-driver brain AND it may spawn nested managed children, the registry MUST be
* wrapped with `withDriverExecutor` so a child constructed by `driverChild` resolves to the
* nested-scope executor — and that SAME blob
* store MUST be the one passed to `driverAgent({ blobs })`, or the driver
* reads from a different store than the scope writes to. Pass `{ withDriver: true }`
* and reuse the returned `blobs` for both.
*
* The spread shape matches `SupervisorOpts` exactly, so the call site reads:
*   const run = createInMemoryRunContext()
*   await createSupervisor().run(root, task, { budget, runId, ...run })
*
* @experimental
*/
/** Hold a run context's ownership (when it has any) across the whole run, releasing after. */
async function withRunContext(context, signal, run) {
	if (context.acquire === void 0) return run(context, signal);
	const lease = await context.acquire(signal);
	try {
		const result = await run(lease.context, signal === void 0 ? lease.signal : AbortSignal.any([signal, lease.signal]));
		lease.signal.throwIfAborted();
		return result;
	} finally {
		await lease.release();
	}
}
/**
* Build a fresh in-memory run context. Every call returns NEW stores (no shared global
* state between runs), so two runs never cross-contaminate their journals/blobs.
*/
function createInMemoryRunContext(opts = {}) {
	const base = createExecutorRegistry();
	return {
		journal: new InMemorySpawnJournal(),
		blobs: new InMemoryResultBlobStore(),
		executors: opts.withDriver ? withDriverExecutor(base) : base
	};
}
/**
* Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced
* per append/write) under `dir`, and the context carries `resume: true` so spreading it into
* `SupervisorOpts` makes the supervisor `loadTree`-first. A run that dies mid-flight therefore
* resumes when it is re-run with the SAME `runId` and the SAME `dir`: the committed children come
* back on `Scope.resume` (rehydrated by `replaySpawnTree`) instead of being re-executed.
*
* Layout: `${dir}/spawn-journal.jsonl` (one JSONL record per event), `${dir}/blobs/` (one
* content-addressed JSON file per settled result), and `${dir}/coordination-log.jsonl`
* (questions, findings, answer decisions, and authorized continuation receipts retained as
* evidence). The directory is created on first write.
*
* Opt-in by construction — `createInMemoryRunContext()` is unchanged and stays the default, so no
* existing consumer writes to disk or resumes unless it asks for this.
*/
function createFileRunContext(dir, opts = {}) {
	const base = createExecutorRegistry();
	return {
		journal: new FileSpawnJournal(`${dir}/spawn-journal.jsonl`),
		blobs: new FileResultBlobStore(`${dir}/blobs`),
		executors: opts.withDriver ? withDriverExecutor(base) : base,
		resume: true,
		coordinationLog: new FileCoordinationLog(`${dir}/coordination-log.jsonl`)
	};
}
//#endregion
//#region src/runtime/anytime.ts
/**
* The best-so-far fold — the ONE definition of "how good was the run after k results", shared by
* the post-run anytime report below and by the LIVE progress-based stop rules
* (`supervise/stop-rules.ts`). Given the observed objective per settled result in order, it returns
* the running maximum. A result with no objective (`undefined` — it failed, or it was never
* scored) carries the previous best forward rather than resetting it.
*
* It is extracted rather than duplicated on purpose: a stop rule that decides a run has plateaued
* must agree, number for number, with the report that later says whether stopping was right.
*/
function bestSoFar(values) {
	const out = [];
	let best = 0;
	for (const v of values) {
		if (typeof v === "number" && v > best) best = v;
		out.push(best);
	}
	return out;
}
/** Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher =
*  the run climbed earlier. Shared with the stop rules so "improving" means one thing. */
function areaUnderCurve(curve) {
	if (curve.length === 0) return 0;
	return curve.reduce((s, v) => s + v, 0) / curve.length;
}
/**
* How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value
* `window` steps back — i.e. the length of the current PLATEAU, in settles. `0` means the most
* recent settle improved the best by more than `minDelta`.
*
* The plateau math the live stop rules read. Defined here, beside the report that measures whether
* the plateau was real, so there is exactly one notion of "not improving".
*/
function plateauLength(curve, minDelta) {
	if (curve.length === 0) return 0;
	const last = curve[curve.length - 1];
	let i = curve.length - 1;
	while (i > 0 && last - curve[i - 1] <= minDelta) i -= 1;
	return curve.length - 1 - i;
}
const median = (xs) => {
	if (xs.length === 0) return null;
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
/** Derive anytime metrics from waterfall spans. `targets` are the satisficing score
*  bars (default [1] = fully resolved; COCO-style multi-target: [0.5, 0.8, 1]);
*  `targetFor` overrides the bar per task (task-specific satisfaction) — when set, the
*  per-task bar replaces every entry of `targets` for that task. */
function anytimeReport(spans, opts) {
	const targets = opts?.targets ?? [1];
	const byRun = /* @__PURE__ */ new Map();
	for (const s of spans) {
		if (!s.label.startsWith("shot:")) continue;
		const list = byRun.get(s.runId) ?? [];
		list.push(s);
		byRun.set(s.runId, list);
	}
	const perTask = [];
	for (const [runId, shots] of byRun) {
		const m = runId.match(/^agentic:(.+):(.+)$/);
		const strategy = m?.[1] ?? runId;
		const taskId = m?.[2] ?? runId;
		const ordered = [...shots].sort((a, b) => (a.endMs ?? a.startMs) - (b.endMs ?? b.startMs));
		const t0 = Math.min(...ordered.map((s) => s.startMs));
		const taskTargets = opts?.targetFor ? [opts.targetFor(taskId)] : targets;
		const bests = bestSoFar(ordered.map((s) => typeof s.score === "number" ? s.score : void 0));
		let cumUsd = 0;
		const points = [];
		const hits = {};
		for (const t of taskTargets) hits[String(t)] = null;
		for (const [i, s] of ordered.entries()) {
			cumUsd += s.usd;
			const best = bests[i];
			const elapsedMs = (s.endMs ?? s.startMs) - t0;
			points.push({
				elapsedMs,
				cumUsd,
				best
			});
			for (const t of taskTargets) if (hits[String(t)] === null && best >= t) hits[String(t)] = {
				ms: elapsedMs,
				shots: points.length,
				usd: cumUsd
			};
		}
		perTask.push({
			taskId,
			strategy,
			points,
			hits
		});
	}
	const byStrategy = /* @__PURE__ */ new Map();
	for (const t of perTask) {
		const list = byStrategy.get(t.strategy) ?? [];
		list.push(t);
		byStrategy.set(t.strategy, list);
	}
	const perStrategy = [];
	for (const [strategy, tasks] of byStrategy) {
		const totalMs = tasks.reduce((s, t) => s + (t.points[t.points.length - 1]?.elapsedMs ?? 0), 0);
		const totalUsd = tasks.reduce((s, t) => s + (t.points[t.points.length - 1]?.cumUsd ?? 0), 0);
		const maxShots = Math.max(0, ...tasks.map((t) => t.points.length));
		const curveByShot = [];
		for (let i = 0; i < maxShots; i += 1) {
			const vals = tasks.map((t) => t.points[Math.min(i, t.points.length - 1)].best);
			curveByShot.push(vals.reduce((s, v) => s + v, 0) / vals.length);
		}
		const auc = areaUnderCurve(curveByShot);
		const summaryTargets = opts?.targetFor ? [NaN] : targets;
		for (const t of summaryTargets) {
			const key = (taskCurve) => opts?.targetFor ? Object.values(taskCurve.hits)[0] ?? null : taskCurve.hits[String(t)] ?? null;
			const reached = tasks.filter((x) => key(x) !== null);
			perStrategy.push({
				strategy,
				target: t,
				tasks: tasks.length,
				reachedTarget: reached.length,
				medianTttMs: median(reached.map((x) => key(x).ms)),
				medianShotsToTarget: median(reached.map((x) => key(x).shots)),
				ertMs: reached.length > 0 ? totalMs / reached.length : null,
				erUsd: reached.length > 0 ? totalUsd / reached.length : null,
				curveByShot,
				auc
			});
		}
	}
	perStrategy.sort((a, b) => a.strategy.localeCompare(b.strategy) || a.target - b.target);
	return {
		targets,
		perTask,
		perStrategy
	};
}
/** One row per (strategy, satisficing target): the shareable time-to-satisfactory table. */
function renderAnytimeTable(report) {
	const lines = [`anytime metrics · satisficing targets [${report.targets.join(", ")}] · ERT = Σ all wall-time / #successes (COCO)`, "strategy            ≥tgt   reach   med-TTT   med-shots   ERT(all-in)   $/success   AUC   curve"];
	for (const s of report.perStrategy) {
		const curve = s.curveByShot.map((v) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(v * 8))]).join("");
		const tgt = Number.isNaN(s.target) ? "task" : s.target.toFixed(2);
		lines.push(`${s.strategy.padEnd(19)} ${tgt.padStart(4)} ${String(s.reachedTarget).padStart(4)}/${String(s.tasks).padEnd(3)} ${s.medianTttMs === null ? "      —" : `${(s.medianTttMs / 1e3).toFixed(1).padStart(6)}s`}   ${s.medianShotsToTarget === null ? "    —" : String(s.medianShotsToTarget).padStart(5)}   ${s.ertMs === null ? "         —" : `${(s.ertMs / 1e3).toFixed(1).padStart(9)}s`}   ${s.erUsd === null ? "       —" : `$${s.erUsd.toFixed(4)}`}   ${s.auc.toFixed(2)}   ${curve}`);
	}
	return lines.join("\n");
}
//#endregion
//#region src/runtime/supervise/stop-rules.ts
/**
*
* PROGRESS-BASED STOP RULES — end a long-horizon run for the right reason.
*
* Every existing bound is a CEILING: iterations, tokens, dollars, an absolute deadline, a turn
* cap. A ceiling answers "may this run continue?" and never "is this run still getting anywhere?".
* So a supervision tree that stopped learning at settle 4 keeps buying workers until it hits a
* wall — the run ends on exhaustion, and the operator cannot tell a run that finished from a run
* that ran out.
*
* A stop rule reads the run's own PROGRESS and decides. Three signals feed it:
*   - the objective curve over settled work (best-so-far, from `anytime.ts` — see below),
*   - the LIVE worker feed (`WorkerProgress`: `idleMs`, `stalled`, `turns`, `tokens`),
*   - tree-level shape (how many are in flight, how many are waiting, when the last settle landed).
*
* ── Two boundaries this module holds deliberately ───────────────────────────────────────────────
*
* ENFORCEMENT lives here; THRESHOLDS do not. "Stop after 5 settles with no improvement" is a
* judgment about a domain — how noisy its scores are, how expensive a worker is, how much a late
* breakthrough is worth. That belongs to the caller (a loop, a bench, a product). Every rule below
* takes its thresholds as required options with no hidden defaults for the numbers that decide;
* the module ships the MECHANISM and refuses to ship the judgment.
*
* A stop rule can only ADD a stop, never remove one. The driver evaluates the hard ceilings
* (`poolStarved`, `deadlinePassed`, abort, the driver's own stop) FIRST and independently; the
* rule is consulted only when they all say "continue". So no rule can talk a run past its budget.
*
* ── What is reused, not re-derived ──────────────────────────────────────────────────────────────
*
* `anytime.ts` already computed best-so-far curves, their area, and plateau detection — but only
* after a run was over, from waterfall spans. Rather than write a second copy for the live path,
* `bestSoFar` / `areaUnderCurve` / `plateauLength` were extracted there and are imported here. A
* stop rule that calls a run plateaued therefore agrees, number for number, with the report that
* later judges whether stopping was right.
*
* @experimental
*/
const CONTINUE = { stop: false };
/** Build the settled-work ledger a `StopRule` decides from: record each settlement (idempotent by
*  id) and materialize a `ProgressView` combining the best-so-far curve with the live worker feed. */
function createProgressTracker(opts = {}) {
	const now = opts.now ?? Date.now;
	const requireDelivered = opts.requireDelivered ?? true;
	const minImprovement = opts.minImprovement ?? 0;
	const seen = /* @__PURE__ */ new Set();
	const recorded = [];
	return {
		record(sample) {
			if (seen.has(sample.id)) return false;
			seen.add(sample.id);
			recorded.push(sample);
			return true;
		},
		samples: () => [...recorded],
		view(scope, viewOpts) {
			const curve = bestSoFar(recorded.map((s) => requireDelivered && !s.delivered ? void 0 : s.objective));
			const best = curve.length > 0 ? curve[curve.length - 1] : 0;
			let lastImprovementAt = 0;
			let lastImprovementIdx = -1;
			let prev = 0;
			for (const [i, value] of curve.entries()) {
				if (value - prev > minImprovement) {
					lastImprovementAt = recorded[i].at;
					lastImprovementIdx = i;
				}
				prev = value;
			}
			const treeView = scope?.view;
			const workers = [];
			if (scope && treeView) for (const node of treeView.nodes) {
				if (isTerminalNodeStatus(node.status)) continue;
				if (node.status === "waiting") continue;
				const p = scope.progress(node.id, viewOpts?.stallAfterMs !== void 0 ? {
					now: now(),
					stallAfterMs: viewOpts.stallAfterMs
				} : { now: now() });
				if (p) workers.push(p);
			}
			return {
				now: now(),
				settles: recorded.length,
				delivered: recorded.filter((s) => s.delivered).length,
				curve,
				best,
				auc: areaUnderCurve(curve),
				lastSettleAt: recorded.length > 0 ? recorded[recorded.length - 1].at : 0,
				lastImprovementAt,
				settlesSinceImprovement: lastImprovementIdx < 0 ? recorded.length : recorded.length - 1 - lastImprovementIdx,
				workers,
				inFlight: treeView?.inFlight ?? 0,
				waiting: treeView?.waiting ?? 0
			};
		},
		evaluate(rule, scope, viewOpts) {
			return rule(this.view(scope, viewOpts));
		}
	};
}
/** Build a `ProgressSample` from a scope settlement. The objective is the verdict score and
*  `delivered` is the verdict's `valid` — the SAME single delivery signal `finalizeBestDelivered`
*  and `defaultSelectWinner` use, so "progress" and "winner" cannot disagree. */
function sampleFromSettled(settled, at) {
	if (settled.kind === "down") return {
		id: settled.handle.id,
		at,
		delivered: false
	};
	return {
		id: settled.handle.id,
		at,
		...settled.verdict?.score !== void 0 ? { objective: settled.verdict.score } : {},
		delivered: settled.verdict?.valid === true
	};
}
/**
* "Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no
* IMPROVEMENT over the last `settles` settlements.
*
* A tree whose only remaining nodes are armed WAITS is exempt from the time bound: a run waiting
* on CI is not a run that stopped making progress, and killing it there would defeat mechanic C.
*/
function noProgressFor(opts) {
	if (opts.ms === void 0 && opts.settles === void 0) throw new ValidationError("noProgressFor: set at least one of { ms, settles }");
	if (opts.ms !== void 0 && opts.ms <= 0) throw new ValidationError("noProgressFor: ms must be > 0");
	if (opts.settles !== void 0 && opts.settles < 1) throw new ValidationError("noProgressFor: settles must be >= 1");
	const minSettles = opts.minSettles ?? 1;
	return (v) => {
		if (v.settles < minSettles) return CONTINUE;
		if (opts.settles !== void 0 && v.settlesSinceImprovement >= opts.settles) return {
			stop: true,
			reason: `no-progress: ${v.settlesSinceImprovement} settles with no improvement (limit ${opts.settles}), best=${v.best}`
		};
		if (opts.ms !== void 0 && v.waiting === 0 && v.lastSettleAt > 0) {
			const idle = v.now - v.lastSettleAt;
			if (idle >= opts.ms) return {
				stop: true,
				reason: `no-progress: ${idle}ms since the last settlement (limit ${opts.ms}ms)`
			};
		}
		return CONTINUE;
	};
}
/**
* "The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than
* `minDelta` across the last `window` settlements.
*
* Built on `anytime.plateauLength` — the same plateau math the post-run anytime report uses, so a
* rule that stops a run and a report that grades the decision cannot disagree about whether the
* run was flat.
*/
function plateau(opts) {
	if (!Number.isInteger(opts.window) || opts.window < 1) throw new ValidationError("plateau: window must be a positive integer");
	if (!Number.isFinite(opts.minDelta) || opts.minDelta < 0) throw new ValidationError("plateau: minDelta must be >= 0");
	const minSettles = opts.minSettles ?? opts.window;
	return (v) => {
		if (v.settles < minSettles) return CONTINUE;
		const flat = plateauLength(v.curve, opts.minDelta);
		if (flat >= opts.window) return {
			stop: true,
			reason: `plateau: best-so-far rose <= ${opts.minDelta} over the last ${flat} settles (window ${opts.window}), best=${v.best}, auc=${v.auc.toFixed(3)}`
		};
		return CONTINUE;
	};
}
/**
* "Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for
* longer than the stall threshold — and none of the tree is merely waiting.
*
* `stalled` is a derived read at observation time, never a background watchdog; this rule only
* reads it. A tree with armed waits never fires: waiting is not stalling.
*/
function allWorkersStalled(opts = {}) {
	const minWorkers = opts.minWorkers ?? 1;
	return (v) => {
		if (v.waiting > 0) return CONTINUE;
		if (v.workers.length < minWorkers) return CONTINUE;
		if (!v.workers.every((w) => w.stalled)) return CONTINUE;
		const worst = Math.max(...v.workers.map((w) => w.idleMs));
		return {
			stop: true,
			reason: `all-stalled: ${v.workers.length} live workers idle, worst ${worst}ms`
		};
	};
}
/** Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end). */
function anyOf(...rules) {
	return (v) => {
		for (const rule of rules) {
			const d = rule(v);
			if (d.stop) return d;
		}
		return CONTINUE;
	};
}
/** Stop only when EVERY rule stops — for a conservative gate that needs corroboration. */
function allOf(...rules) {
	if (rules.length === 0) throw new ValidationError("allOf: needs at least one rule");
	return (v) => {
		const reasons = [];
		for (const rule of rules) {
			const d = rule(v);
			if (!d.stop) return CONTINUE;
			reasons.push(d.reason);
		}
		return {
			stop: true,
			reason: reasons.join(" AND ")
		};
	};
}
/**
* Evaluate a rule against the run's settled work — the ONE evaluator both supervisor arms call.
*
* The router arm calls it before each driver inference turn; the harness arm calls it on each
* worker settle. Ordering is the contract in both: the hard ceilings (`poolStarved`,
* `deadlinePassed`, abort, the driver's own stop) are checked first and independently, so a stop
* rule can only ever ADD a stop — it can never keep a run alive past a budget it has exhausted.
*
* Folding the whole roster each call is idempotent by worker id, so it costs O(settled) and never
* double-counts. `settledAt` carries the instant the ledger recorded a settlement; `now()` is the
* fallback resolution a per-turn guard has.
*/
function progressStop(tracker, rule, ledger, scope, now, stallAfterMs) {
	for (const w of ledger.settled()) tracker.record({
		id: w.id,
		at: w.settledAt ?? now(),
		...w.score !== void 0 ? { objective: w.score } : {},
		delivered: w.status === "done" && w.valid === true
	});
	return tracker.evaluate(rule, scope, stallAfterMs !== void 0 ? { stallAfterMs } : void 0);
}
//#endregion
//#region src/runtime/supervise/coordination-driver.ts
/**
*
* `driverAgent` — the driver's BRAIN.
*
* The recursive driver-executor (`driver-executor.ts`) runs a driver `Agent.act` inside a
* nested `Scope`; this is the intelligent `act`: it mounts the coordination MCP verbs
* (`createCoordinationTools`) over that scope and runs an LLM tool-loop, so the driver
* REASONS — spawn / observe / steer / await / stop — about how to drive its children,
* instead of running a fixed script. Each turn: ask the driver LLM for tool calls, run them
* against the live scope, fold the results back, repeat until the driver stops (no tool
* calls) or the turn cap forces a keep-best finalize.
*
* Recursion composes through `makeWorkerAgent`: `spawn_worker` resolves a `profile` to a
* worker LEAF or — when the profile is a driver — a `driverChild` wrapping ANOTHER
* `driverAgent` over its own nested scope (see `driver-executor.ts`). So an agent
* drives an agent that drives an agent, each an LLM tool-loop, all on one conserved-budget
* tree.
*
* Two seams are INJECTED so the loop runs offline with no creds and stays decoupled:
*  - `brain` (`ToolLoopChat`) — one driver-LLM turn over the canonical tool-loop seam; a test
*    drives a scripted mock, production passes the router's tool-calling (`routerBrain`), a
*    sandboxed harness drives the verbs as MCP tools. The same seam every tool-loop uses.
*  - `systemPrompt` — the driver's stance (the agent-eval worker-driver prompt / the prompt
*    generator). Injected, never hardcoded — the prompt is a pluggable role.
*
* @experimental
*/
/** The default chapter-close prompt: the brain summarizes its OWN progress for its future self before
*  the detailed history is dropped. Emphasis on PENDING work — the part a too-eager chapter-close
*  loses (the coding-burn counter-finding: closing after one fix leaves integration bugs uncircled). */
const distillInstruction = "CONTEXT COMPACTION. Your detailed turn-by-turn history is about to be discarded to free your context window. Write a COMPLETE, compact handoff note for your future self so you can keep going without it. Cover: (1) what you have accomplished; (2) every worker you spawned and its current status/result; (3) what subtasks remain unfinished, failing, or unverified — be specific and exhaustive here, this is the part you must not lose; (4) your immediate next action. Do not call any tools; respond with the note only.";
/** Factual ground truth for the digest — the live worker roster from Scope plus the delivered-result
*  ledger, independent of whatever the brain's prose summary captures. */
function summarizeRoster(view, settled) {
	if (view.nodes.length === 0) return "Workers in current live scope: none yet.";
	const settledById = new Map(settled.map((w) => [w.id, w]));
	const lines = view.nodes.map((node) => formatRosterNode(node, settledById.get(node.id)));
	return `Workers in current live scope (ground truth from the run, ${view.nodes.length} total, ${view.inFlight} in flight):\n${lines.join("\n")}`;
}
function formatRosterNode(node, settled) {
	const result = settled?.status === "done" ? `, delivered=${settled.valid ?? false}${settled.score !== void 0 ? `, score=${settled.score}` : ""}${settled.outRef ? `, outRef=${settled.outRef}` : ""}` : settled?.status === "down" ? `, reason=${settled.reason ?? "unknown"}` : node.outRef ? `, outRef=${node.outRef}` : "";
	const overspend = formatOverspend(settled?.budgetViolation ?? node.budgetViolation);
	return `- ${node.id}: ${node.status}, label=${node.label}, runtime=${node.runtime}${result}${overspend}`;
}
/** One roster clause naming each channel a settled worker spent beyond its reservation. */
function formatOverspend(violation) {
	if (violation === void 0) return "";
	return `, overspent=${violation.overspent.map((entry) => `${entry.channel} ${entry.spent} > reserved ${entry.reserved}`).join("; ")}`;
}
/** Spawn-progress is impossible: the pool can't afford another worker AND nothing is in flight to
*  await. A long-horizon driver bounded by the conserved pool stops here instead of spinning (the
*  in-loop budget guard the turn cap alone never provided). Checks BOTH conserved channels: tokens
*  (can't afford a worker) and usd (a usd-capped pool whose ceiling the driver's own metered
*  inference has drained — `meter` debits usd, so without this a huge-token/small-usd pool would
*  overspend usd up to the turn tripwire). */
function poolStarved(scope, perWorker, preserveOwnerTurns = false) {
	const b = scope.budget;
	if (scope.view.inFlight > 0 || scope.view.waiting > 0) return false;
	const tokenStarved = preserveOwnerTurns ? b.tokensLeft <= 0 : b.tokensLeft < perWorker.maxTokens;
	const iterationStarved = b.iterationsLeft <= 0;
	const usdStarved = b.usdCapped && (b.usdLeft <= 0 || !preserveOwnerTurns && perWorker.maxUsd !== void 0 && b.usdLeft < perWorker.maxUsd);
	const resourceStarved = Object.entries(b.resources ?? {}).some(([name, value]) => !value.known || value.remaining <= 0 || !preserveOwnerTurns && value.remaining < (perWorker.resources?.[name]?.limit ?? 0));
	return tokenStarved || iterationStarved || usdStarved || resourceStarved;
}
/** The number of driver turns a manager whose spend Runtime cannot measure may take when no
*  deadline or dollar cap bounds it. */
const UNMETERED_DRIVER_TURNS = 16;
/**
* Safety guards for a manager's own turns when no deadline bounds them.
*
* `poolStarved` lets a manager keep taking turns while its workers run, because those workers hold
* the pool its turns would otherwise be refused from. With no turn cap and no deadline, a manager
* waiting on a worker that never settles would take a metered turn per `await_event` fence forever.
* Money bounds that: a manager that has overdrawn its pool by as much again as the whole pool stops.
* A brain that reports no usage cannot be bounded by money, so without a deadline or dollar cap it
* keeps the historical 16-turn bound. A caller's explicit `maxTurns` or a deadline replaces both.
*/
function ownTurnsUnbounded(scope, poolTokens, turns, maxTurns) {
	const b = scope.budget;
	if (maxTurns !== void 0 || b.deadlineMs > 0) return false;
	if (poolTokens > 0 && b.tokensLeft < -poolTokens) return true;
	return !b.tokensKnown && !b.usdCapped && turns > UNMETERED_DRIVER_TURNS;
}
/** The absolute wall-clock deadline (when the root set one) has passed. */
function deadlinePassed(scope, now) {
	const b = scope.budget;
	return b.deadlineMs > 0 && now() >= b.deadlineMs;
}
/** The USD-denominated members of {@link PromptCacheUsage} — the schema, not a guess. Every
*  other known member (`readTokens`, `writeTokens`, `missTokens`) is a token COUNT. */
const PROMPT_CACHE_USD_FIELDS = /* @__PURE__ */ new Set(["readSavingsUsd"]);
/** Dollar amounts above this are provider nonsense, not evidence. The old all-integer rule
*  rejected them as a side effect; keeping an explicit ceiling preserves that protection
*  without pretending a dollar amount is an integer. */
const MAX_PROMPT_CACHE_USD = 1e6;
/**
* Validate provider-reported prompt-cache evidence.
*
* Prompt-cache carries two kinds of number and they obey different rules: token COUNTS are
* integers, and USD amounts are fractional by nature. Applying the count rule to a dollar
* field refuses every provider that reports cache savings in dollars — a healthy router
* response carrying `readSavingsUsd: 0.0034` failed the driver outright before this split.
*
* Classification is schema-first: a field named in {@link PromptCacheUsage} is validated by
* what that member IS. `promptCache` is an open record (the sandbox path forwards provider
* fields verbatim), so an unknown field falls back to the `usd` name-suffix convention —
* documented here as the contract a provider must follow to report dollars.
*
* Returns the refusal, or `undefined` when the evidence is acceptable.
*/
function validateDriverPromptCache(promptCache) {
	for (const [field, value] of Object.entries(promptCache ?? {})) {
		if (typeof value !== "number") continue;
		if (PROMPT_CACHE_USD_FIELDS.has(field) || /usd$/i.test(field)) {
			if (!Number.isFinite(value) || value < 0 || value > MAX_PROMPT_CACHE_USD) return new ValidationError(`driverAgent: prompt-cache field ${JSON.stringify(field)} must be a non-negative finite number of dollars`);
			continue;
		}
		if (!Number.isSafeInteger(value) || value < 0) return new ValidationError(`driverAgent: prompt-cache field ${JSON.stringify(field)} must be a non-negative safe integer`);
	}
}
/** The journal file `createFileRunContext` writes inside the run directory. The acknowledger
*  reads it as EVIDENCE for the terminated-descendants set — the nested trees of a cancelled
*  lead journal their terminal records there before the lead settles into this scope. */
const SPAWN_JOURNAL_FILE = "spawn-journal.jsonl";
/**
* Apply externally admitted steers once through the owning manager's control path.
*
* The `unknown` acknowledgement lands before authorization or delivery. A crash after that write
* can lose this steer, but a restarted manager never delivers it again. This is the same
* at-most-once crash boundary as coordination instruction receipts: no duplicate instruction is
* safer than replaying a mutation whose first delivery may already have succeeded.
*/
function createSteerAcknowledger(deps) {
	const iso = () => new Date(deps.now()).toISOString();
	const directChildId = (ref) => ref.startsWith(`${deps.ownerId}:s`) && /^s\d+$/.test(ref.slice(deps.ownerId.length + 1));
	const base = (request) => ({
		schemaVersion: 1,
		operationId: request.operationId,
		requestDigest: request.requestDigest,
		worker: request.worker,
		requestedAt: request.at
	});
	return { async pass(phase) {
		for (const request of readWorkerSteerRequests(deps.dir)) {
			if (phase === "turn" && deps.signal?.aborted) return;
			const rootRequest = request.worker === deps.ownerId && deps.deliverRoot !== void 0;
			if (!rootRequest && !directChildId(request.worker)) continue;
			if (readWorkerSteerAcknowledgement(deps.dir, request.operationId) !== void 0) continue;
			if (phase === "final") {
				writeWorkerSteerAcknowledgement(deps.dir, {
					...base(request),
					effect: "not_live",
					observedAt: iso(),
					detail: "run ended before the steer was applied"
				});
				continue;
			}
			if (rootRequest && deps.deliverRootReady !== void 0 && !deps.deliverRootReady()) continue;
			if (!claimWorkerSteerDelivery(deps.dir, {
				...base(request),
				effect: "unknown",
				observedAt: iso(),
				detail: "delivery admitted; outcome not yet known"
			})) continue;
			try {
				let outcome;
				if (rootRequest) {
					const delivered = deps.deliverRoot({
						steer: request.message,
						interrupt: request.interrupt
					});
					outcome = {
						delivered,
						outcome: delivered ? "delivered" : "runtime-has-no-inbox"
					};
				} else outcome = await deps.coord.steerWorker(request.worker, request.message, { interrupt: request.interrupt });
				const effect = outcome.delivered ? "delivered" : outcome.outcome === "runtime-has-no-inbox" ? "unsupported" : outcome.outcome === "unknown-worker" || outcome.outcome === "already-settled" || outcome.outcome === "scope-stopped" ? "not_live" : "unknown";
				writeWorkerSteerAcknowledgement(deps.dir, {
					...base(request),
					effect,
					observedAt: iso(),
					detail: rootRequest ? outcome.delivered ? "the root inbox accepted the steer; consumption is not confirmed" : "the root exposes no accepting inbox at delivery time" : steerAcknowledgementDetail(outcome)
				});
			} catch (error) {
				writeWorkerSteerAcknowledgement(deps.dir, {
					...base(request),
					effect: "unknown",
					observedAt: iso(),
					detail: "delivery outcome is unknown after a runtime error"
				});
			}
		}
	} };
}
/**
* The OPERATOR-facing sentence for a steer outcome, written into the durable acknowledgement file.
*
* Deliberately separate from `downMessageRefusalReasons`, which is the MANAGER-facing sentence: one
* says what happened for someone reading the run afterwards, the other tells a model what to do
* next, and merging them would make one audience read the other's copy. They must nonetheless cover
* the SAME outcomes, so `tests/kernel/refusal-reasons.test.ts` holds both maps total over
* `DownMessageDeliveryOutcome` — a new code cannot land in only one.
*/
function steerAcknowledgementDetail(outcome) {
	switch (outcome.outcome) {
		case "delivered": return "the owning manager delivered the steer to the exact live worker";
		case "runtime-has-no-inbox": return "the exact worker does not expose a steer inbox";
		case "unknown-worker": return "the owning manager does not know the exact worker";
		case "already-settled": return "the exact worker settled before delivery";
		case "scope-stopped": return "the owning manager stopped before delivery";
		case "runtime-error": return "delivery outcome is unknown after a runtime error";
	}
}
/**
* The worker-cancel ACKNOWLEDGER — the runtime-side half of `run-layout`'s `cancelWorker`
* contract. Router managers check between turns; native managers observe throughout their invocation.
* Every manager with a `controlDir` mounts one;
* OWNERSHIP keeps them from colliding: a request naming a node id is owned by the manager whose
* own id is that node's parent, and a label/profile-name reference is owned by the `'run'`-scoped
* (root) manager only — so exactly one acknowledger can ever apply one operation.
*
* Two-phase, honestly reported: `cancel_requested` is written the moment a live worker's abort is
* issued (through the per-child abort chain the scope already owns, so siblings are untouched);
* `cancelled` is written only when that worker's settlement is DELIVERED on the settle path with
* a terminal `down`, and then the record names every subtree node id proven terminated. A worker
* that already settled — or that settles `done` despite the abort — records `not_live`; a
* reference matching nothing this manager owns stays pending (`cancelWorker` reports it
* `unknown`). No path reports success for a missing worker.
*
* Expiry is run end, not a clock: `finish()` (after the final post-drain pass) writes `not_live`
* for every owned request never applied and `unknown` for an issued abort whose settle the run
* ended too soon to observe. A pending request can therefore never outlive its run and abort a
* future spawn that happens to reuse a label.
*
* Idempotency is a lookup, in-process and across processes: an operation with a durable
* acknowledgement is returned as-is and never re-applied.
*/
function createCancelAcknowledger(deps) {
	const tracked = /* @__PURE__ */ new Map();
	let runTracked;
	const abortIssuedAt = /* @__PURE__ */ new Map();
	const iso = () => new Date(deps.now()).toISOString();
	const write = (record) => {
		writeWorkerCancellation(deps.dir, record);
		tracked.set(record.operationId, record);
	};
	/** `ref` is exactly one of THIS manager's direct-child node ids (`${ownerId}:s<seq>`). */
	const directChildId = (ref) => ref.startsWith(`${deps.ownerId}:s`) && /^s\d+$/.test(ref.slice(deps.ownerId.length + 1));
	/** Whether this acknowledger owns `ref`. A node id deeper in this subtree belongs to the nested
	*  manager that parents it; anything that is not a node id under this manager is a
	*  label/profile-name reference, owned by the `'run'`-scoped manager alone. */
	const owned = (ref) => {
		if (directChildId(ref)) return true;
		if (deps.controlScope !== "run") return false;
		return !ref.startsWith(`${deps.ownerId}:`) && ref !== deps.ownerId;
	};
	const deliveredTerminal = (id) => {
		const row = deps.coord.settled().find((w) => w.id === id);
		if (row !== void 0) return row.status;
		const node = deps.scope.view.nodes.find((n) => n.id === id);
		if (node === void 0) return void 0;
		if (node.status === "done") return "done";
		if (node.status === "failed" || node.status === "cancelled") return "down";
	};
	const apply = (request) => {
		const aborted = deps.coord.abortWorker(request.worker, request.reason ?? "cancel requested");
		const base = {
			operationId: request.operationId,
			worker: request.worker,
			requestedAt: request.at,
			observedAt: iso(),
			...request.reason === void 0 ? {} : { reason: request.reason }
		};
		if (aborted !== void 0) {
			abortIssuedAt.set(request.operationId, base.observedAt);
			write({
				...base,
				effect: "cancel_requested",
				workerId: aborted.id,
				detail: `abort issued to live worker '${aborted.label}' (${aborted.id}); termination not yet proven`,
				terminated: []
			});
			return;
		}
		const goneId = deps.scope.view.nodes.find((n) => (n.id === request.worker || n.label === request.worker) && isTerminalNodeStatus(n.status))?.id ?? deps.coord.settled().find((w) => w.id === request.worker)?.id;
		if (goneId !== void 0) write({
			...base,
			effect: "not_live",
			workerId: goneId,
			detail: `worker '${goneId}' had already settled before this operation was applied`,
			terminated: []
		});
	};
	/** The proven-terminated set for one record: the worker plus every subtree id with a terminal
	*  journal record at/after the abort was issued. Union with what the record already names, so
	*  the set only ever grows (a late teardown journal adds; nothing removes). */
	const provenTerminated = (record, workerId) => {
		const since = abortIssuedAt.get(record.operationId) ?? record.observedAt;
		return [.../* @__PURE__ */ new Set([
			...record.terminated,
			workerId,
			...terminatedDescendants(deps.dir, workerId, since)
		])].sort();
	};
	const reconcile = (record) => {
		const workerId = record.workerId;
		if (workerId === void 0) return;
		const terminal = deliveredTerminal(workerId);
		if (terminal === void 0) return;
		if (terminal === "down") {
			write({
				...record,
				effect: "cancelled",
				observedAt: iso(),
				terminated: provenTerminated(record, workerId),
				detail: `worker '${workerId}' reached a terminal down state on the settle path`
			});
			return;
		}
		write({
			...record,
			effect: "not_live",
			observedAt: iso(),
			terminated: [],
			detail: `worker '${workerId}' settled done despite the abort request; nothing was terminated`
		});
	};
	/** Re-scan a `cancelled` record while the manager still turns: a descendant whose teardown
	*  journals after the lead's settle joins the set on a later pass instead of being lost. Only
	*  a grown set is re-written; the window needs the in-process abort instant, so a record a
	*  PRIOR process closed stays as that process proved it. */
	const regrow = (record) => {
		const workerId = record.workerId;
		if (workerId === void 0 || !abortIssuedAt.has(record.operationId)) return;
		const terminated = provenTerminated(record, workerId);
		if (terminated.length > record.terminated.length) write({
			...record,
			observedAt: iso(),
			terminated
		});
	};
	/**
	* The RUN-scoped request: seen once, `cancel_requested` written the moment the run's cascading
	* abort is issued through the one controller the run already has. The `supervise()` settle path
	* records what the run then actually did — this manager cannot observe its own tree's terminal
	* state from inside `act`.
	*
	* Applied only at a TURN boundary, never on the final post-drain pass: by then the driver has
	* finished and drained, so a root abort could only void work that is already delivered. A
	* request that arrives that late expires in `finish()` instead — it terminated nothing.
	*/
	const passRun = () => {
		if (deps.controlScope !== "run" || deps.abortRun === void 0) return;
		if (runTracked !== void 0) return;
		runTracked = applyRunCancellation(deps.dir, deps.abortRun, iso);
	};
	const pass = (phase) => {
		if (phase === "turn") passRun();
		for (const request of readWorkerCancelRequests(deps.dir)) {
			if (!owned(request.worker)) continue;
			let record = tracked.get(request.operationId);
			if (record === void 0) {
				record = readWorkerCancellation(deps.dir, request.operationId);
				if (record !== void 0) tracked.set(request.operationId, record);
			}
			if (record === void 0) {
				if (phase === "turn") apply(request);
				continue;
			}
			if (record.effect === "cancel_requested") reconcile(record);
			else if (record.effect === "cancelled") regrow(record);
		}
	};
	return {
		pass,
		finish() {
			const runRequest = deps.controlScope === "run" && deps.abortRun !== void 0 ? readRunCancelRequest(deps.dir) : void 0;
			if (runRequest !== void 0 && readRunCancellation(deps.dir, runRequest.operationId) === void 0) writeRunCancellation(deps.dir, {
				operationId: runRequest.operationId,
				effect: "not_live",
				requestedAt: runRequest.at,
				observedAt: iso(),
				...runRequest.reason === void 0 ? {} : { reason: runRequest.reason },
				...runRequest.operator === void 0 ? {} : { operator: runRequest.operator },
				detail: "run ended before the request was applied"
			});
			for (const request of readWorkerCancelRequests(deps.dir)) {
				if (!owned(request.worker)) continue;
				const record = tracked.get(request.operationId) ?? readWorkerCancellation(deps.dir, request.operationId);
				if (record === void 0) {
					write({
						operationId: request.operationId,
						worker: request.worker,
						effect: "not_live",
						requestedAt: request.at,
						observedAt: iso(),
						...request.reason === void 0 ? {} : { reason: request.reason },
						detail: "run ended before the request was applied",
						terminated: []
					});
					continue;
				}
				if (record.effect === "cancel_requested") write({
					...record,
					effect: "unknown",
					observedAt: iso(),
					detail: "abort issued; run ended before termination was observed"
				});
			}
		}
	};
}
/**
* Subtree node ids with a terminal `down`/`cancelled` journal record at or after `sinceIso` —
* the abort-issue instant (the acknowledger's own `observedAt` on the `cancel_requested` record,
* runtime clock), never the client's `requestedAt` — read from the durable spawn journal beside
* the run layout. The set is proven at acknowledgement time and is approximate about post-abort
* causation: a descendant that died of its OWN cause after the abort was issued is
* indistinguishable from the cascade and may be included; one whose teardown journals late joins
* on a later acknowledger pass; a teardown journal still absent when the run ends is absent from
* the set. Ids are hierarchical (`parent:sN`), so `${nodeId}:` prefixes exactly the subtree.
* Tolerant of a missing or partially-written journal: evidence that cannot be read names fewer
* nodes, never wrong ones.
*/
function terminatedDescendants(dir, nodeId, sinceIso) {
	let raw;
	try {
		raw = readFileSync(join(dir, SPAWN_JOURNAL_FILE), "utf8");
	} catch {
		return [];
	}
	const prefix = `${nodeId}:`;
	const ids = /* @__PURE__ */ new Set();
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (parsed.kind !== "event" || parsed.event === void 0) continue;
		const event = parsed.event;
		if (!(event.kind === "settled" && event.status === "down" || event.kind === "cancelled")) continue;
		if (typeof event.id !== "string" || !event.id.startsWith(prefix)) continue;
		if (typeof event.at !== "string" || event.at < sinceIso) continue;
		ids.add(event.id);
	}
	return [...ids].sort();
}
/**
* Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
* `driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.
*/
function driverAgent(opts) {
	if (typeof opts.brain !== "function") throw new ValidationError("driverAgent: opts.brain must be a function");
	if (!Array.isArray(opts.toolNames)) throw new ValidationError("driverAgent: toolNames must name every granted tool explicitly");
	if (new Set(opts.toolNames).size !== opts.toolNames.length) throw new ValidationError("driverAgent: toolNames contains a duplicate name");
	if ((opts.extraTools?.length ?? 0) > 0 && typeof opts.executeExtraTool !== "function") throw new ValidationError("driverAgent: extraTools requires executeExtraTool (how to run a work-tool call)");
	if ((opts.analyzeOnSettle ?? []).map(normalizeAnalyzeOnSettle).some((route) => route.agent === void 0) && !opts.analysts) throw new ValidationError("driverAgent: analyzeOnSettle requires analysts (the lens registry the kinds resolve against)");
	const reserved = new Set(coordinationVerbNames);
	for (const tool of opts.nodeTools ?? []) {
		if (reserved.has(tool.name)) throw new ValidationError(`driverAgent: node tool "${tool.name}" collides with a coordination verb or another node tool`);
		reserved.add(tool.name);
	}
	for (const t of opts.extraTools ?? []) {
		if (reserved.has(t.name)) throw new ValidationError(`driverAgent: extra work tool "${t.name}" collides with a coordination verb or node tool`);
		reserved.add(t.name);
	}
	if (opts.maxTurns !== void 0 && opts.maxTurns < 0) throw new ValidationError("driverAgent: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)");
	const maxTurns = opts.maxTurns ?? 0;
	const now = opts.now ?? Date.now;
	const inbox = opts.inbox ?? createInbox();
	const transcript = opts.transcript ?? createRouterTranscript();
	return {
		name: opts.name,
		deliver(message) {
			return inbox.deliver(message);
		},
		harnessTranscript: () => transcript.capture(),
		async act(task, scope) {
			const ownerReader = opts.spawnResourceReader ?? (opts.spawnResourceRoot === void 0 ? scopeRetainedOwnerResourceReader(scope) : void 0);
			let probeableByName;
			const coord = createCoordinationTools({
				scope,
				blobs: opts.blobs,
				makeWorkerAgent: opts.makeWorkerAgent,
				...opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {},
				perWorker: opts.perWorker,
				...opts.deliverable ? { deliverable: opts.deliverable } : {},
				...opts.analysts ? { analysts: opts.analysts } : {},
				...opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {},
				...opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {},
				...opts.stallAfterMs !== void 0 ? { stallAfterMs: opts.stallAfterMs } : {},
				...opts.awaitTimeoutMs !== void 0 ? { awaitTimeoutMs: opts.awaitTimeoutMs } : {},
				...opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {},
				...opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {},
				...opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {},
				...opts.composeSpawnProfile ? { composeSpawnProfile: opts.composeSpawnProfile } : {},
				...opts.profiles ? { profiles: opts.profiles } : {},
				...opts.spawnResourceRoot ? { spawnResourceRoot: opts.spawnResourceRoot } : {},
				...ownerReader ? { spawnResourceReader: ownerReader } : {},
				...opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {},
				...opts.onEvent ? { onEvent: opts.onEvent } : {},
				...opts.replaySettlements ? { replaySettlements: true } : {},
				...opts.priorCoordination?.questions.length ? { priorQuestions: opts.priorCoordination.questions } : {},
				...opts.priorCoordination?.escalations?.length ? { priorEscalations: opts.priorCoordination.escalations } : {},
				...opts.priorCoordination?.records.length ? { priorJournal: opts.priorCoordination.records } : {},
				...opts.priorCoordination?.analystDefinitions?.length ? { priorAnalystDefinitions: opts.priorCoordination.analystDefinitions } : {},
				resolveProbeTool: (name) => probeableByName?.get(name)
			});
			await coord.ready();
			const availableTools = [...coord.tools, ...opts.nodeTools ?? []];
			const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]));
			const extraByName = new Map((opts.extraTools ?? []).map((tool) => [tool.name, tool]));
			const selectedTools = opts.toolNames.map((name) => {
				const descriptor = availableByName.get(name);
				if (descriptor !== void 0) return {
					kind: "descriptor",
					descriptor
				};
				const extra = extraByName.get(name);
				if (extra === void 0) throw new ValidationError(`driverAgent: requested tool ${JSON.stringify(name)} is unavailable`);
				return {
					kind: "extra",
					extra
				};
			});
			const modelTools = selectedTools.flatMap((selected) => selected.kind === "descriptor" ? [selected.descriptor] : []);
			probeableByName = new Map(modelTools.map((tool) => [tool.name, tool]));
			const selectedExtraNames = new Set(selectedTools.flatMap((selected) => selected.kind === "extra" ? [selected.extra.name] : []));
			opts.onCoordinationTools?.(modelTools);
			const acknowledger = opts.controlDir === void 0 ? void 0 : createCancelAcknowledger({
				dir: opts.controlDir,
				coord,
				scope,
				now,
				ownerId: scope.view.root,
				controlScope: opts.controlScope ?? "run",
				...opts.abortRun ? { abortRun: opts.abortRun } : {}
			});
			const steerAcknowledger = opts.steerDir === void 0 && opts.controlDir === void 0 ? void 0 : createSteerAcknowledger({
				dir: opts.steerDir ?? opts.controlDir,
				coord,
				now,
				ownerId: scope.view.root,
				signal: scope.signal,
				...opts.controlScope === "subtree" ? {} : { deliverRoot: inbox.deliver }
			});
			for (const w of scope.resume?.waits ?? []) {
				const rearmed = scope.wait(w.spec, { label: w.label });
				if (!rearmed.ok) throw new RuntimeRunStateError(`driverAgent: cannot re-arm resumed wait '${w.label}' (${rearmed.reason})`);
			}
			const byName = new Map(modelTools.map((tool) => [tool.name, tool]));
			const toolSpecs = selectedTools.map((selected) => selected.kind === "descriptor" ? {
				type: "function",
				function: {
					name: selected.descriptor.name,
					description: selected.descriptor.description,
					parameters: selected.descriptor.inputSchema
				}
			} : {
				type: "function",
				function: {
					name: selected.extra.name,
					description: selected.extra.description,
					parameters: selected.extra.parameters
				}
			});
			const system = typeof opts.systemPrompt === "function" ? opts.systemPrompt(task) : opts.systemPrompt;
			const tracker = opts.stopRule ? createProgressTracker({ now }) : void 0;
			const poolTokens = scope.budget.tokensLeft + scope.budget.reservedTokens;
			let driverTurns = 0;
			let progressStopReason;
			let driverTurn = 0;
			let driverCall = 0;
			const meteredBrain = async (messages, tools, detail, conversationTurn) => {
				let res;
				const call = driverCall;
				driverCall += 1;
				const callContext = Object.freeze({
					signal: scope.signal,
					callId: `${scope.view.root}:brain:${crypto.randomUUID()}`,
					correlationId: scope.view.root
				});
				try {
					res = await opts.brain(messages, tools, callContext);
				} catch (error) {
					opts.onProviderModel?.(void 0);
					try {
						await meterRuntimeOwnedProviderAttempt(scope, withBudgetResources(unmeteredSpend(0), scope.budget), providerAttemptEvidence(void 0), {
							driver: opts.name,
							inferenceFailed: true,
							call,
							callId: callContext.callId,
							correlationId: callContext.correlationId,
							...detail
						});
					} catch (meteringError) {
						throw new RuntimeRunStateError(`${errMessage(error)}; accounting failed: ${errMessage(meteringError)}`, { cause: error });
					}
					throw error;
				}
				let evidenceError;
				opts.onProviderModel?.(res.model);
				if (opts.expectedModel !== void 0) {
					if (res.model === void 0) evidenceError = new ValidationError(`driverAgent: Router response omitted model identity; expected ${JSON.stringify(opts.expectedModel)}`);
					else if (res.model !== opts.expectedModel) evidenceError = new ValidationError(`driverAgent: Router response reported model ${JSON.stringify(res.model)}; expected ${JSON.stringify(opts.expectedModel)}`);
				}
				if (res.transportAttempts !== void 0 && (!Number.isSafeInteger(res.transportAttempts) || res.transportAttempts < 1)) evidenceError = new ValidationError("driverAgent: transportAttempts must be a positive safe integer when reported");
				evidenceError = validateDriverPromptCache(res.promptCache) ?? evidenceError;
				const trustedCost = res.costProvenance === "provider-receipt" || res.costProvenance === "billing-receipt";
				const cacheUsage = promptCacheTokenClasses(res.usage?.input, res.promptCache);
				await meterRuntimeOwnedProviderAttempt(scope, withBudgetResources({
					...addResourceSpend(res.resources),
					iterations: 0,
					tokens: {
						input: res.usage?.input ?? 0,
						output: res.usage?.output ?? 0,
						...cacheUsage
					},
					...res.usage === void 0 ? { tokensKnown: false } : {},
					usd: trustedCost ? res.costUsd ?? 0 : 0,
					...trustedCost && res.costUsd !== void 0 ? {} : { usdKnown: false },
					ms: 0
				}, scope.budget), providerAttemptEvidence(res.model), {
					driver: opts.name,
					call,
					callId: callContext.callId,
					correlationId: callContext.correlationId,
					toolCalls: (res.toolCalls ?? []).map((c) => c.name),
					...res.model !== void 0 ? { model: res.model } : {},
					...res.transportAttempts !== void 0 ? { transportAttempts: res.transportAttempts } : {},
					...res.usage?.reasoning !== void 0 ? { reasoningTokens: res.usage.reasoning } : {},
					...res.promptCache !== void 0 ? { promptCache: res.promptCache } : {},
					...res.usageUnknown === true ? { streamUsageMissing: true } : {},
					...res.costProvenance === "catalog-estimate" ? { estimatedCostUsd: res.costUsd } : {},
					...detail,
					...conversationTurn ? { conversation: conversationTurn(res) } : {}
				});
				if (evidenceError !== void 0) throw evidenceError;
				return res;
			};
			const chat = async (messages, tools) => {
				const turn = driverTurn;
				transcript.observe(messages);
				const res = await meteredBrain(messages, tools, {
					kind: "driver-inference",
					turn
				}, (reply) => transcript.reply(reply));
				driverTurn += 1;
				return res;
			};
			const compaction = opts.compaction ? {
				thresholdTokens: opts.compaction.thresholdTokens,
				distill: opts.compaction.distill ?? (async (msgs) => {
					const roster = summarizeRoster(scope.view, coord.settled());
					try {
						const narrative = ((await meteredBrain([...msgs, {
							role: "user",
							content: distillInstruction
						}], [], {
							kind: "driver-compaction",
							compactingTurn: driverTurn
						})).content ?? "").trim();
						return narrative ? `${roster}\n\n## Progress notes\n${narrative}` : roster;
					} catch (e) {
						return `${roster}\n\n## Progress notes\nSummary unavailable: ${errMessage(e)}`;
					}
				}),
				...opts.compaction.onCompact ? { onCompact: opts.compaction.onCompact } : {},
				...opts.compaction.preserveHead !== void 0 ? { preserveHead: opts.compaction.preserveHead } : {},
				...opts.compaction.estimateTokens ? { estimateTokens: opts.compaction.estimateTokens } : {}
			} : void 0;
			await runBrainLoop({
				chat,
				tools: toolSpecs,
				...compaction ? { compaction } : {},
				execute: async (name, args) => {
					if (opts.executeExtraTool && selectedExtraNames.has(name)) {
						const worked = await runExtraTool(opts.executeExtraTool, name, args);
						if (worked !== null && worked !== void 0) return worked;
					}
					const tool = byName.get(name);
					return safeJson(tool ? await runTool(tool, args) : { error: `unknown tool: ${name}` });
				},
				initialMessages: [
					{
						role: "system",
						content: system
					},
					{
						role: "user",
						content: stringifyTask(task)
					},
					...scope.resume ? [{
						role: "user",
						content: resumeBrief(scope.resume, scope.view, opts.priorCoordination)
					}] : hasPriorCoordination(opts.priorCoordination) ? [{
						role: "user",
						content: priorCoordinationBrief(opts.priorCoordination)
					}] : []
				],
				maxTurns,
				hooks: {
					beforeTurn: async (_turn, messages) => {
						driverTurns += 1;
						await steerAcknowledger?.pass("turn");
						acknowledger?.pass("turn");
						const pending = inbox.drain();
						if (pending.length > 0) messages.push({
							role: "user",
							content: inbox.fold(pending)
						});
						transcript.observe(messages);
					},
					stopBefore: () => {
						if (coord.isStopped() || scope.signal.aborted || poolStarved(scope, opts.perWorker, opts.preserveOwnerTurns) || deadlinePassed(scope, now) || ownTurnsUnbounded(scope, poolTokens, driverTurns, opts.maxTurns)) return true;
						if (!opts.stopRule || !tracker) return false;
						const decision = progressStop(tracker, opts.stopRule, coord, scope, now, opts.stallAfterMs);
						if (!decision.stop) return false;
						if (progressStopReason === void 0) {
							progressStopReason = decision.reason;
							opts.onProgressStop?.(decision.reason);
						}
						return true;
					}
				}
			});
			await coord.drainResolved();
			await steerAcknowledger?.pass("final");
			acknowledger?.pass("final");
			acknowledger?.finish();
			const submitted = coord.submittedResult();
			if (submitted) {
				opts.onAcceptedSubmission?.(submitted.result);
				return submitted.result;
			}
			return runFinalizer(opts.finalizer ?? bestDelivered, {
				settled: coord.settled(),
				blobs: opts.blobs,
				tree: runTree(scope),
				budget: scope.budget,
				...opts.deliverable ? { deliverable: opts.deliverable } : {}
			});
		}
	};
}
/**
* The factual context a resumed driver starts from — everything the durable stores prove about
* the prior process(es): committed settlements, per-key states (completed / in-doubt / failed),
* re-armed waits, carried-over questions/findings/continuation receipts, and spend already paid.
* Injected as the brain's first user-context on a resumed run so it continues from unresolved work;
* old continuation receipts are evidence and are never auto-delivered.
*/
function resumeBrief(resume, current, prior) {
	const lines = [
		"RESUME: this run continues a prior coordinator process. Its committed work is restored",
		"below and already counts toward the deliverable — do NOT redo it. Continue from the",
		"unresolved work only.",
		"",
		`Committed workers (${resume.settled.length}):`
	];
	if (resume.settled.length === 0) lines.push("- none");
	for (const s of resume.settled) lines.push((s.kind === "done" ? `- ${s.handle.id} (${s.handle.label}): done, score=${s.verdict?.score ?? 0}, valid=${s.verdict?.valid ?? false}, outRef=${s.outRef}` : `- ${s.handle.id} (${s.handle.label}): down, reason=${s.reason}`) + formatOverspend(s.budgetViolation));
	const byState = (state) => [...resume.keys].filter(([, v]) => v.state === state);
	const completed = byState("completed");
	const currentIds = new Set(current.nodes.map((node) => node.id));
	const recovered = byState("in-doubt").filter(([, value]) => currentIds.has(value.id));
	const inDoubt = byState("in-doubt").filter(([, value]) => !currentIds.has(value.id));
	const failed = byState("down");
	if (completed.length > 0) lines.push("", "COMPLETED keys — spawn_worker with the same key returns the finished result, spending nothing:", ...completed.map(([k, v]) => `- ${k} → ${v.id} (${v.label})`));
	if (recovered.length > 0) lines.push("", "Recovered keys are attached to this scope. Use await_event to receive their results and coordinate with their original workers:", ...recovered.map(([key, value]) => `- ${key} → ${value.id} (${value.label})`));
	if (inDoubt.length > 0) lines.push("", "Keys IN DOUBT — a prior process recorded them as started but never recorded a terminal receipt. Do NOT spawn a replacement under these keys; inspect or recover each exact prior execution first:", ...inDoubt.map(([k, v]) => `- ${k} (prior attempt ${v.id}, ${v.label})`));
	if (failed.length > 0) lines.push("", "Keys whose prior attempt FAILED (settled down) — spawn_worker with the same key retries:", ...failed.map(([k, v]) => `- ${k} (prior attempt ${v.id}, ${v.label})`));
	if (resume.waits.length > 0) lines.push("", "Pending waits RE-ARMED on their original deadlines (they settle through await_event):", ...resume.waits.map((w) => `- ${w.label} (${w.spec.kind})`));
	appendPriorCoordination(lines, prior);
	const spent = resume.priorSpend;
	lines.push("", "Budget the run ALREADY spent before this process (it counts toward the run total):", `- child work: tokens charged=${chargedTokens(spent.childWork.tokens)} (in=${spent.childWork.tokens.input} out=${spent.childWork.tokens.output}), usd=${spent.childWork.usd}, iterations=${spent.childWork.iterations}`, `- driver inference: tokens charged=${chargedTokens(spent.driverInference.tokens)} (in=${spent.driverInference.tokens.input} out=${spent.driverInference.tokens.output}), usd=${spent.driverInference.usd}`);
	return lines.join("\n");
}
function hasPriorCoordination(prior) {
	return prior !== void 0 && (prior.questions.length > 0 || prior.findings.length > 0 || prior.continuations.length > 0 || prior.deliveryEvidence.length > 0 || prior.records.some((record) => record.event.type === "submission"));
}
function priorCoordinationBrief(prior) {
	const lines = [
		"PRIOR COORDINATION EVIDENCE: this logical supervisor ran in an earlier process.",
		"Use the evidence below as context. Never auto-deliver an old continuation; issue a new",
		"authorized instruction only when current live state still warrants it."
	];
	appendPriorCoordination(lines, prior);
	return lines.join("\n");
}
function appendPriorCoordination(lines, prior) {
	const openQuestions = (prior?.questions ?? []).filter((q) => q.status === "open" || q.status === "escalated");
	if (openQuestions.length > 0) lines.push("", "Questions carried over, still undecided (answer_question decides them; list_questions shows all):", ...openQuestions.map((q) => `- [${q.id}] from=${q.from}, urgency=${q.urgency}: ${q.question}`));
	if ((prior?.findings.length ?? 0) > 0) lines.push("", "Analyst findings from the prior process:", ...(prior?.findings ?? []).map((f) => `- ${f.analyst} on ${f.fromWorker}: ${safeJson(f.findings)}`));
	if ((prior?.continuations.length ?? 0) > 0) {
		const attempts = new Set((prior?.deliveryEvidence ?? []).filter((event) => event.type === "delivery-attempt").map((event) => event.attempt.receiptId));
		const outcomes = new Map((prior?.deliveryEvidence ?? []).filter((event) => event.type === "steer" || event.type === "answer").map((event) => [event.down.receiptId, event.down.outcome]));
		lines.push("", "Authorized continuations committed by the prior process (evidence only; never replayed automatically):", ...(prior?.continuations ?? []).map((continuation) => {
			const delivery = outcomes.get(continuation.receiptId) ?? (attempts.has(continuation.receiptId) ? "unknown-after-crash" : "not-attempted-before-crash");
			return `- receipt=${continuation.receiptId}, ${continuation.kind} → ${continuation.toWorker}, instruction=${continuation.instructionDigest}, delivery=${delivery}`;
		}));
	}
}
/** Run a work tool. A throw is data to the driver (it can recover next turn), not a crash — fold
*  the error back as a string result. null/undefined passes through (the caller treats it as "not
*  handled" and falls to the coordination dispatch). */
async function runExtraTool(execute, name, args) {
	try {
		return await execute(name, args);
	} catch (e) {
		return `error: ${e instanceof Error ? e.message : String(e)}`;
	}
}
async function runTool(tool, args) {
	try {
		return await tool.handler(args);
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
/** Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's
*  output (settled `done` AND `valid` — its deliverable check passed). Returns undefined when no
*  child delivered — an honest "the driver produced nothing", never a high-scoring result that
*  ran without passing its check (Foreman's 0/18 lesson). `valid` is the single delivery signal,
*  matching `defaultSelectWinner`'s valid-first rule; the oracle just doesn't fall back to an
*  unchecked best-effort. The same argmax as the `bestDelivered` finalizer (`pickBestDelivered`);
*  this direct form serves callers that hold a bare ledger + blob store. */
async function finalizeBestDelivered(settled, blobs) {
	const best = pickBestDelivered(settled.filter((w) => w.status === "done" && w.valid === true));
	if (best === void 0) return void 0;
	return best.outRef ? await blobs.get(best.outRef) : void 0;
}
function stringifyTask(task) {
	return typeof task === "string" ? task : safeJson(task);
}
function safeJson(v) {
	try {
		return JSON.stringify(v) ?? String(v);
	} catch {
		return String(v);
	}
}
//#endregion
export { createCoordinationTools as A, applyRunCancellation as C, analystToolGroupNames as D, DEFAULT_AWAIT_EVENT_TIMEOUT_MS as E, questionEscalationTargets as F, createEventBus as I, defaultToolDetectors as L, downMessageRefusalReasons as M, normalizeAnalyzeOnSettle as N, canonicalFindingEvent as O, parseAuthoredAnalystDefinition as P, watchTrace as R, foldCoordinationRecords as S, ANALYST_DEFINITION_BOUNDS as T, renderAnytimeTable as _, allOf as a, withRunContext as b, createProgressTracker as c, progressStop as d, sampleFromSettled as f, plateauLength as g, bestSoFar as h, finalizeBestDelivered as i, createCoordinationToolsForManager as j, coordinationVerbNames as k, noProgressFor as l, areaUnderCurve as m, createSteerAcknowledger as n, allWorkersStalled as o, anytimeReport as p, driverAgent as r, anyOf as s, createCancelAcknowledger as t, plateau as u, createFileRunContext as v, watchRunCancellation as w, FileCoordinationLog as x, createInMemoryRunContext as y };

//# sourceMappingURL=coordination-driver-BBL_OgRw.js.map