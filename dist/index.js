import { Ai as readCommittedJsonLines, Br as createOtelExporter, Er as resolveRedactor, Gr as padTraceId, Hr as generateSpanId, Ir as buildLoopOtelSpans, Jr as createRuntimeStreamEventCollector, Kr as toOtelAttributes, Lr as buildLoopSpanNodes, Rr as buildRuntimeEventOtelSpans, Tr as defaultRedactorIdentityMaterial, Ur as loopEventToOtelSpan, Va as providerMessageText, Wr as padSpanId, Xi as executableAgentProfileSnapshot, Xr as sanitizeKnowledgeReadinessReport, Yr as sanitizeAgentRuntimeEvent, Zr as sanitizeRuntimeStreamEvent, ji as writeAllBytes, ki as prepareJsonlAppend, qr as createRuntimeEventCollector, zr as createOpenInferenceFileExporter } from "./supervisor-DtlPj9me.js";
import { a as JudgeError, c as RetainedInteractiveAdmissionError, d as RetainedRunDispatchBindingError, f as RuntimeRunStateError, i as ConfigError, l as RetainedInteractiveBindingError, m as ValidationError, o as NotFoundError, r as BackendTransportError, s as PlannerError, t as AgentEvalError, u as RetainedRunAdmissionError } from "./errors-DodWX-cb.js";
import { F as InMemoryRuntimeSessionStore, I as newRuntimeSession, L as nowIso, M as createIterableBackend, N as createSandboxPromptBackend, O as optimizerMethod, P as normalizeBackendStreamEvent, R as startOrResumeRuntimeSession, j as streamAgentTurn, k as strategyAuthorMethod, z as touchSession } from "./structural-rollout-D-0X6lsU.js";
import { t as assertExecutableAgentProfile } from "./model-policy-BbSCSak0.js";
import { a as createRuntimeUsageTotals, i as addRuntimeUsage, o as isUsageAmount, t as createAgentImprovementActivationResult } from "./activation-BkUdrvqh.js";
import { C as canonicalCandidateDigest$1, D as immutableCandidateValue, E as embeddedCandidateArtifact, O as omitTopLevelDigest, S as canonicalCandidateBytes$1, a as persistCandidateOutputArtifact, t as captureAgentCandidateWorkspace } from "./workspace-archive-C9lgf77y.js";
import { nn as connectStdioMcp, tn as McpSpawnFault } from "./runtime-DsAHXig2.js";
import { i as notifyRuntimeHookEvent, n as defineRuntimeHooks, r as notifyRuntimeDecisionPoint, t as composeRuntimeHooks } from "./runtime-hooks-tXpAarhW.js";
import { $ as commandVerifier, B as assertCandidateValidator, G as rawTraceDistiller, H as parseExecutionRef, J as normalizeRolloutPolicy, K as ROLLOUT_POLICY_EXTENSION, L as improve, Q as agenticGenerator, R as createCommandProfileTrainer, U as privateValuePaths, W as withMethodRuntimeControls, X as serializeRolloutPolicy, Y as parseRolloutPolicy, Z as structuralRolloutPolicyFromProfile, et as defaultBuildPrompt, q as applyRolloutPolicyToProfile, z as searchMethod } from "./improvement-cycle-Bi43xCVa.js";
import { t as sealAgentCandidateBundle } from "./bundle-CvLGRVO-.js";
import { r as supervise } from "./supervise-DBQdrp7H.js";
import { a as isDelegatedLoopMode, c as worktreeLoopRunner, i as auditLoopRunner, n as runLoopRunnerCli, o as researchLoopRunner, r as DELEGATED_LOOP_MODES, s as runDelegatedLoop, t as parseLoopRunnerArgv } from "./loop-runner-bin-C9FJshTP.js";
import { n as mcpToolsForRuntimeMcpSubset, t as mcpToolsForRuntimeMcp } from "./openai-tools-DoQ32vpe.js";
import { agentCandidateKnowledgeSchema, agentProfileSchema, canonicalAgentProfileDigest, sha256DigestSchema } from "@tangle-network/agent-interface";
import { FAILURE_CLASSES, acquisitionPlansForKnowledgeGaps, blockingKnowledgeEval, canonicalJson, runAgentControlLoop, scoreKnowledgeReadiness, userQuestionsForKnowledgeGaps } from "@tangle-network/agent-eval";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { gepaOptimizationMethod, skillOptOptimizationMethod } from "@tangle-network/agent-eval/campaign";
import { evaluateKnowledgeBaseReadiness, fromAgentCandidateKnowledgeRef, improveKnowledgeBase, knowledgeImprovementCandidateRef, loadKnowledgeImprovementActivationResult, normalizeKnowledgeStateScope, promoteKnowledgeCandidate, restoreKnowledgeCandidateBaseline, toAgentCandidateKnowledgeRef, withKnowledgeImprovementComparison } from "@tangle-network/agent-knowledge";
//#region src/runtime/profile-execution-backend.ts
/**
* Bind one exact profile and Runtime executor to the stable `AgentExecutionBackend` contract used
* by `runAgentTaskStream` and conversations.
*
* Runtime still owns the model call through `streamAgentTurn`.
* The adapter only translates the two stream protocols and carries the caller's request headers
* into `ExecutorContext` so an HTTP executor can preserve authorization, recursion depth, and
* trace identity.
*
* @stable
*/
function createProfileExecutionBackend(options) {
	const profile = executableAgentProfileSnapshot(options.profile, "createProfileExecutionBackend");
	const executor = options.executor;
	return {
		kind: "runtime-profile",
		async *stream(input, context) {
			const propagatedHeaders = snapshotPropagatedHeaders(context.propagatedHeaders);
			const contextualExecutor = (spec, executorContext) => executor(spec, {
				...executorContext,
				...propagatedHeaders === void 0 ? {} : { propagatedHeaders }
			});
			const providerMessages = input.providerOptions?.messages;
			const turnInput = input.messages !== void 0 ? { providerOptions: { messages: input.messages.map((message) => ({ ...message })) } } : Array.isArray(providerMessages) ? { providerOptions: { messages: structuredClone(providerMessages) } } : { prompt: input.message ?? context.task.intent };
			let terminal = false;
			let emittedText = false;
			for await (const event of streamAgentTurn({
				kind: "executor",
				profile,
				factory: contextualExecutor
			}, turnInput, {
				signal: context.signal,
				...context.turnId ? { callId: context.turnId } : {},
				...context.runId ? { correlationId: context.runId } : {}
			})) {
				if (event.type === "backend_start") continue;
				if (event.type === "backend_error") throw backendError(event.error, event.message);
				if (event.type === "final") {
					terminal = true;
					if (event.status !== "completed") throw backendError(event.error, event.reason);
					if (!emittedText && event.text) yield {
						type: "text_delta",
						task: context.task,
						session: context.session,
						text: event.text,
						timestamp: event.timestamp
					};
					continue;
				}
				if (event.type === "text_delta") emittedText = true;
				yield rebindEvent(event, context);
			}
			if (!terminal) throw new ValidationError("createProfileExecutionBackend: streamAgentTurn ended without a terminal event");
		}
	};
}
function snapshotPropagatedHeaders(headers) {
	if (headers === void 0) return void 0;
	const snapshot = {};
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value !== "string") throw new ValidationError(`createProfileExecutionBackend: propagated header ${JSON.stringify(name)} must be a string`);
		snapshot[name] = value;
	}
	return Object.freeze(snapshot);
}
function backendError(detail, message) {
	if (detail?.kind === "transport") return new BackendTransportError("runtime-profile", detail.message, {
		status: detail.status,
		body: detail.body
	});
	return new Error(detail?.message ?? message);
}
function rebindEvent(event, context) {
	return {
		...event,
		task: context.task,
		session: context.session
	};
}
//#endregion
//#region src/conversation/call-policy.ts
/** Thrown when the circuit breaker is open for a participant and no retry is allowed yet. */
var CircuitOpenError = class extends Error {
	constructor(participant, retryAfterMs) {
		super(`circuit open for participant '${participant}'; ${retryAfterMs}ms remaining before retry allowed`);
		this.name = "CircuitOpenError";
	}
};
/** Thrown when a backend call exceeds its per-attempt deadline. */
var DeadlineExceededError = class extends Error {
	constructor(deadlineMs) {
		super(`backend call exceeded per-attempt deadline of ${deadlineMs}ms`);
		this.name = "DeadlineExceededError";
	}
};
/**
* Default retryable classification — network/timeout class errors. Errors
* a model deliberately throws (validation, refusal, 4xx) are not retried;
* those represent real outcomes, not transient infrastructure faults.
*/
const defaultIsRetryable = (err) => {
	if (err instanceof DeadlineExceededError) return true;
	if (err instanceof Error) {
		const name = err.name;
		const message = err.message.toLowerCase();
		if (name === "AbortError" || name === "TimeoutError") return true;
		if (message.includes("econnreset") || message.includes("etimedout") || message.includes("econnrefused") || message.includes("socket hang up") || message.includes("network") || message.includes("fetch failed")) return true;
	}
	return false;
};
/** Live circuit-breaker state — one instance per (participant, conversation run). */
var CircuitBreakerState = class {
	config;
	consecutiveFailures = 0;
	openedAt;
	constructor(config) {
		this.config = config;
	}
	/**
	* Check whether the next call is allowed. Throws `CircuitOpenError` when
	* the breaker is open and the cooldown hasn't elapsed.
	*/
	preflight(participant, now = Date.now()) {
		if (!this.config || this.openedAt === void 0) return;
		const remaining = this.config.cooldownMs - (now - this.openedAt);
		if (remaining > 0) throw new CircuitOpenError(participant, remaining);
		this.openedAt = void 0;
		this.consecutiveFailures = 0;
	}
	recordSuccess() {
		this.consecutiveFailures = 0;
		this.openedAt = void 0;
	}
	recordFailure(now = Date.now()) {
		if (!this.config) return;
		this.consecutiveFailures += 1;
		if (this.consecutiveFailures >= this.config.failuresToOpen) this.openedAt = now;
	}
};
/**
* Build a per-attempt AbortSignal linked to the parent signal AND fired when
* the deadline elapses. The returned `dispose()` MUST be called in a
* `finally` (clears the timer, detaches the listener) so we don't leak.
*
* When the deadline fires, the signal's `reason` is a `DeadlineExceededError`
* — callers can detect timeout-vs-cancel by reading `signal.reason` after
* the underlying operation throws.
*/
function makePerAttemptSignal(parentSignal, deadlineMs) {
	const controller = new AbortController();
	let deadlineError;
	const cleanups = [];
	if (parentSignal) if (parentSignal.aborted) controller.abort(parentSignal.reason);
	else {
		const onAbort = () => controller.abort(parentSignal.reason);
		parentSignal.addEventListener("abort", onAbort, { once: true });
		cleanups.push(() => parentSignal.removeEventListener("abort", onAbort));
	}
	if (deadlineMs !== void 0) {
		const ms = deadlineMs;
		const timer = setTimeout(() => {
			deadlineError = new DeadlineExceededError(ms);
			controller.abort(deadlineError);
		}, ms);
		cleanups.push(() => clearTimeout(timer));
	}
	return {
		signal: controller.signal,
		dispose() {
			for (const c of cleanups) c();
		},
		getDeadlineError() {
			return deadlineError;
		}
	};
}
/** Compute the delay before the next attempt. Default: 250ms exponential with jitter. */
function computeBackoff(spec, attempt) {
	if (spec === void 0) {
		const base = 250;
		const jitter = Math.floor(Math.random() * base);
		return base * 2 ** (attempt - 1) + jitter;
	}
	if (typeof spec === "function") return Math.max(0, spec(attempt));
	return Math.max(0, spec);
}
/** Resolve after `ms` milliseconds — used for retry backoff in conversation call policy. */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
//#endregion
//#region src/conversation/headers.ts
/**
*
* Cross-gateway forwarding headers — the wire-level contract that makes
* agent-to-agent communication composable across organizational boundaries.
* Every header here is read on inbound and re-emitted on outbound, so a chain
* `caller → A's gateway → A's runtime → B's gateway → B's runtime` ends with
* B billing the original user, the depth counter monotonically incremented,
* and the run/turn correlation IDs preserved end-to-end.
*
* The actual depth refusal (HTTP 413 at MAX_DEPTH) is enforced by
* `agent-gateway`'s middleware; this module owns the names + the propagation
* rules so both sides agree.
*
* Full protocol: `docs/agent-bus-protocol.md`.
*
* @stable
*/
/** Standard names — lowercased so Headers maps interop on every runtime. */
const FORWARD_HEADERS = {
	/** Forwarded original-user identity (`Bearer sk-tan-<user>`); downstream gateways bill against this. */
	authorization: "x-tangle-forwarded-authorization",
	/** Monotonically incremented on every gateway hop. Refused at MAX_DEPTH. */
	depth: "x-tangle-forwarded-depth",
	/** Top-level conversation run identifier, propagated through every nested call. */
	runId: "x-tangle-runid",
	/** This call's turn within the run; deterministic + stable across retries. */
	turnId: "x-tangle-turnid",
	/** When the call is *inside* another turn (recursion), the parent turn's id. */
	parentTurnId: "x-tangle-parent-turnid",
	/** Logical conversation peer label at the sending side, for trace stitching. */
	speaker: "x-tangle-speaker"
};
/**
* Lowercase a header lookup so we read the same key regardless of source
* casing (Hono, fetch's `Headers`, raw Node IncomingMessage, …).
*/
function lc(name) {
	return name.toLowerCase();
}
/**
* Read the depth counter off an inbound request. Missing → 0 (caller is the
* origin). Non-integer → throws — silent coercion would let a bad caller
* reset depth and bypass the limit.
*/
function readDepth(headers) {
	const raw = pickHeader(headers, FORWARD_HEADERS.depth);
	if (raw === void 0 || raw === "") return 0;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) throw new Error(`invalid ${FORWARD_HEADERS.depth} header value '${raw}' — must be a non-negative integer`);
	return n;
}
/**
* Build the headers to emit on an outbound participant call, given the
* conversation's propagation context. Depth is incremented from the inbound
* value; runId / turnId / speaker stamp the current hop; the user's
* `Authorization` is preserved verbatim so the downstream gateway bills the
* right wallet.
*/
function buildForwardHeaders(input) {
	const out = {
		[FORWARD_HEADERS.depth]: String(input.inboundDepth + 1),
		[FORWARD_HEADERS.runId]: input.runId,
		[FORWARD_HEADERS.turnId]: input.turnId,
		[FORWARD_HEADERS.speaker]: input.speaker
	};
	if (input.forwardedAuthorization !== void 0) out[FORWARD_HEADERS.authorization] = input.forwardedAuthorization;
	if (input.parentTurnId !== void 0) out[FORWARD_HEADERS.parentTurnId] = input.parentTurnId;
	return out;
}
function pickHeader(headers, name) {
	const target = lc(name);
	for (const key of Object.keys(headers)) if (lc(key) === target) {
		const value = headers[key];
		if (Array.isArray(value)) return value[0];
		return value;
	}
}
//#endregion
//#region src/conversation/turn-id.ts
/**
*
* Deterministic turn identifier. Stable across retries of the same logical
* turn so backends (and any caching gateway in between) can dedupe on it.
* A retry triggered by a network blip or deadline timeout MUST produce the
* same `turn_id`; only the underlying attempt count differs.
*
* Shape: `${runId}.t${index}.${speakerSlug}` — readable in logs, sortable by
* turn index, attributable to a speaker. Slugify keeps the speaker portion
* URL-safe so it can ride in HTTP headers without escaping.
*
* @stable
*/
function turnId(runId, index, speaker) {
	return `${runId}.t${index}.${slugifySpeaker(speaker)}`;
}
/**
* Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough
* substance to read in a log line; collisions between speakers within a
* single Conversation are prevented by `defineConversation`'s
* unique-name check, so the slug only needs to be deterministic, not unique.
*/
function slugifySpeaker(speaker) {
	return speaker.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "anon";
}
//#endregion
//#region src/conversation/run-conversation.ts
/** Run a conversation to completion and return its terminal result. */
async function runConversation(conversation, options) {
	let result;
	for await (const event of runConversationStream(conversation, options)) {
		if (options.onEvent) await options.onEvent(event);
		if (event.type === "conversation_end") result = event.result;
	}
	if (!result) throw new BackendTransportError("conversation", "conversation stream ended without a conversation_end event");
	return result;
}
/** Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers. */
async function* runConversationStream(conversation, options) {
	const runId = options.runId ?? `conv_${crypto.randomUUID()}`;
	const inboundDepth = options.inboundDepth ?? 0;
	const forwardedAuthorization = (options.propagatedHeaders ?? {})[FORWARD_HEADERS.authorization];
	const breakers = /* @__PURE__ */ new Map();
	for (const participant of conversation.participants) {
		const cfg = participant.callPolicy?.circuitBreaker ?? conversation.policy.defaultCallPolicy?.circuitBreaker;
		breakers.set(participant.name, new CircuitBreakerState(cfg));
	}
	let transcript = [];
	let spentCreditsCents = 0;
	let startedAt = nowIso();
	let resumed = false;
	const sessionStore = options.sessionStore ?? new InMemoryRuntimeSessionStore();
	if (options.journal) {
		const prior = await options.journal.loadRun(runId);
		if (prior) {
			if (prior.halted) {
				const replayResult = {
					runId,
					transcript: prior.turns,
					turns: prior.turns.length,
					spentCreditsCents: prior.turns.reduce((sum, t) => sum + centsFromUsd(t.usage?.costUsd ?? 0), 0),
					halted: prior.halted,
					durationMs: 0,
					startedAt: prior.startedAt,
					endedAt: prior.endedAt ?? prior.startedAt
				};
				yield {
					type: "conversation_resumed",
					runId,
					participants: conversation.participants.map((p) => p.name),
					transcript: prior.turns,
					timestamp: nowIso()
				};
				yield {
					type: "conversation_end",
					runId,
					result: replayResult,
					timestamp: nowIso()
				};
				return;
			}
			transcript = [...prior.turns];
			spentCreditsCents = transcript.reduce((sum, t) => sum + centsFromUsd(t.usage?.costUsd ?? 0), 0);
			startedAt = prior.startedAt;
			resumed = true;
		} else await options.journal.beginRun(runId, startedAt);
	}
	const startedAtMs = Date.now();
	const participantSessions = sessionIdsFrom(transcript);
	if (resumed) yield {
		type: "conversation_resumed",
		runId,
		participants: conversation.participants.map((p) => p.name),
		transcript: [...transcript],
		timestamp: nowIso()
	};
	else yield {
		type: "conversation_start",
		runId,
		participants: conversation.participants.map((p) => p.name),
		seed: options.seed,
		timestamp: startedAt
	};
	let currentInput = transcript.length === 0 ? options.seed : transcript[transcript.length - 1]?.text ?? options.seed;
	let halt;
	const initialOffset = transcript.length;
	for (let turnIndex = initialOffset; turnIndex < conversation.policy.maxTurns; turnIndex++) {
		if (options.signal?.aborted) {
			halt = { kind: "abort" };
			break;
		}
		if (conversation.policy.maxCreditsCents !== void 0 && spentCreditsCents >= conversation.policy.maxCreditsCents) {
			halt = {
				kind: "max_credits",
				spentCents: spentCreditsCents,
				capCents: conversation.policy.maxCreditsCents
			};
			break;
		}
		const speakerIdx = selectSpeaker(conversation.policy.turnOrder, conversation.participants.length, {
			transcript,
			turnIndex,
			spentCreditsCents
		});
		const speaker = conversation.participants[speakerIdx];
		if (!speaker) throw new BackendTransportError("conversation", `turnOrder selector returned out-of-range index ${speakerIdx} for ${conversation.participants.length} participants`);
		const tid = turnId(runId, turnIndex, speaker.name);
		const callPolicy = speaker.callPolicy ?? conversation.policy.defaultCallPolicy;
		const breaker = breakers.get(speaker.name);
		if (!breaker) throw new BackendTransportError("conversation", `internal: no circuit-breaker state registered for participant '${speaker.name}'`);
		const isRetryable = callPolicy?.isRetryable ?? defaultIsRetryable;
		const totalAttempts = 1 + (callPolicy?.maxRetries ?? 0);
		yield {
			type: "turn_start",
			runId,
			index: turnIndex,
			speaker: speaker.name,
			turnId: tid,
			attempt: 1,
			timestamp: nowIso()
		};
		let aggregator;
		let attemptCount = 0;
		let lastError;
		let breakerOpenFailure;
		for (let attempt = 1; attempt <= totalAttempts; attempt++) {
			attemptCount = attempt;
			try {
				breaker.preflight(speaker.name);
			} catch (err) {
				breakerOpenFailure = err;
				break;
			}
			if (attempt > 1) yield {
				type: "turn_retry",
				runId,
				index: turnIndex,
				speaker: speaker.name,
				turnId: tid,
				attempt,
				reason: lastError instanceof Error ? lastError.message : String(lastError),
				timestamp: nowIso()
			};
			const perAttempt = makePerAttemptSignal(options.signal, callPolicy?.perAttemptDeadlineMs);
			const localAgg = new TurnAggregator({
				index: turnIndex,
				speaker: speaker.name,
				startedAt: nowIso()
			});
			try {
				for await (const delta of driveSingleAttempt({
					speaker,
					participants: conversation.participants,
					seed: options.seed,
					input: currentInput,
					turnIndex,
					runId,
					turnId: tid,
					transcript,
					participantSessions,
					sessionStore,
					signal: perAttempt.signal,
					aggregator: localAgg,
					propagatedHeaders: buildForwardHeaders({
						inboundDepth,
						forwardedAuthorization: resolveAuthForwarding(speaker, {
							transcript,
							turnIndex,
							spentCreditsCents
						}) ? forwardedAuthorization : void 0,
						runId,
						turnId: tid,
						parentTurnId: options.parentTurnId,
						speaker: speaker.name
					})
				})) yield {
					type: "turn_text_delta",
					runId,
					index: turnIndex,
					speaker: speaker.name,
					turnId: tid,
					text: delta.text,
					timestamp: delta.timestamp
				};
				perAttempt.dispose();
				breaker.recordSuccess();
				aggregator = localAgg;
				break;
			} catch (err) {
				perAttempt.dispose();
				breaker.recordFailure();
				lastError = perAttempt.getDeadlineError() ?? err;
				if (attempt >= totalAttempts || !isRetryable(lastError)) break;
				await sleep(computeBackoff(callPolicy?.retryBackoffMs, attempt));
			}
		}
		if (!aggregator) {
			const failure = breakerOpenFailure ?? lastError;
			const message = failure instanceof Error ? failure.message : String(failure);
			halt = {
				kind: "participant_error",
				participant: speaker.name,
				message
			};
			break;
		}
		const turn = aggregator.toTurn({
			turnId: tid,
			attempts: attemptCount
		});
		if (turn.sessionId) bindParticipantSession(participantSessions, turn.speaker, turn.sessionId);
		transcript.push(turn);
		spentCreditsCents += centsFromUsd(turn.usage?.costUsd ?? 0);
		if (options.journal) await options.journal.appendTurn(runId, turn);
		yield {
			type: "turn_end",
			runId,
			turn,
			timestamp: nowIso()
		};
		if (conversation.policy.haltOn) {
			const haltCtx = {
				transcript,
				lastTurn: turn,
				turnIndex,
				spentCreditsCents
			};
			const decision = await conversation.policy.haltOn(haltCtx);
			if (decision === true) {
				halt = {
					kind: "predicate",
					reason: "predicate_true"
				};
				break;
			}
			if (typeof decision === "object" && decision !== null && decision.halted) {
				halt = {
					kind: "predicate",
					reason: decision.reason
				};
				break;
			}
		}
		currentInput = turn.text;
	}
	if (!halt) halt = {
		kind: "max_turns",
		turns: transcript.length
	};
	const endedAt = nowIso();
	const result = {
		runId,
		transcript,
		turns: transcript.length,
		spentCreditsCents,
		halted: halt,
		durationMs: Date.now() - startedAtMs,
		startedAt,
		endedAt
	};
	if (options.journal) await options.journal.recordHalt(runId, halt, endedAt);
	yield {
		type: "conversation_end",
		runId,
		result,
		timestamp: endedAt
	};
}
async function* driveSingleAttempt(args) {
	const task = {
		id: args.turnId,
		intent: args.input,
		metadata: {
			runId: args.runId,
			turnId: args.turnId,
			turnIndex: args.turnIndex,
			speaker: args.speaker.name,
			participants: args.participants.map((p) => p.name)
		}
	};
	const knowledge = passingReadiness(task.id);
	const startCtx = {
		task,
		knowledge,
		signal: args.signal,
		runId: args.runId,
		turnId: args.turnId,
		propagatedHeaders: args.propagatedHeaders
	};
	const previousSessionId = args.participantSessions.get(args.speaker.name);
	const opened = await startOrResumeRuntimeSession({
		backend: args.speaker.backend,
		input: () => fullConversationInput(task, args.speaker.name, args.seed, args.transcript),
		continuationInput: () => continuedConversationInput(task, args.speaker.name, args.transcript),
		context: startCtx,
		store: args.sessionStore,
		sessionId: previousSessionId ?? participantSessionId(args.runId, args.speaker.name, args.participants),
		resume: previousSessionId !== void 0 && args.speaker.backend.resume !== void 0,
		validateSession: (session) => assertParticipantSessionAvailable(args.participantSessions, args.speaker.name, session.id)
	});
	const session = opened.session;
	args.aggregator.recordSession(session.id);
	const streamCtx = {
		task,
		knowledge,
		session,
		signal: args.signal,
		runId: args.runId,
		turnId: args.turnId,
		propagatedHeaders: args.propagatedHeaders
	};
	for await (const event of args.speaker.backend.stream(opened.input, streamCtx)) {
		if (args.signal.aborted) {
			const reason = args.signal.reason;
			throw reason instanceof Error ? reason : /* @__PURE__ */ new Error("aborted");
		}
		if (event.type === "text_delta") {
			args.aggregator.appendText(event.text);
			yield {
				text: event.text,
				timestamp: event.timestamp
			};
		} else if (event.type === "llm_call") args.aggregator.recordUsage(event);
		else if (event.type === "backend_error") throw new BackendTransportError(args.speaker.backend.kind, event.message, {
			status: event.error?.status,
			body: event.error?.body
		});
		else if (event.type === "final") {
			if (event.status !== "completed") throw new BackendTransportError(args.speaker.backend.kind, event.error?.message ?? event.reason, {
				status: event.error?.status,
				body: event.error?.body
			});
			args.aggregator.adoptFinalText(event.text);
		}
	}
	if (!args.aggregator.hasText()) throw new BackendTransportError(args.speaker.backend.kind, `backend '${args.speaker.backend.kind}' completed without text`);
}
var TurnAggregator = class {
	base;
	text = "";
	adoptedFinal = false;
	sessionId;
	usage;
	constructor(base) {
		this.base = base;
	}
	appendText(text) {
		if (this.adoptedFinal) return;
		this.text += text;
	}
	/**
	* Use the backend's `final.text` only when no streamed deltas were observed.
	* Some backends emit deltas AND a final summary; treating both as content
	* would double-count.
	*/
	adoptFinalText(text) {
		if (!text) return;
		if (this.text.length > 0) return;
		this.text = text;
		this.adoptedFinal = true;
	}
	hasText() {
		return this.text.trim().length > 0;
	}
	recordSession(sessionId) {
		this.sessionId = sessionId;
	}
	recordUsage(event) {
		const u = this.usage ?? {};
		if (event.tokensIn !== void 0) u.tokensIn = (u.tokensIn ?? 0) + event.tokensIn;
		if (event.tokensOut !== void 0) u.tokensOut = (u.tokensOut ?? 0) + event.tokensOut;
		if (event.costUsd !== void 0) u.costUsd = (u.costUsd ?? 0) + event.costUsd;
		if (event.latencyMs !== void 0) u.latencyMs = event.latencyMs;
		if (event.model !== void 0) u.model = event.model;
		this.usage = u;
	}
	toTurn(meta) {
		return {
			index: this.base.index,
			speaker: this.base.speaker,
			turnId: meta.turnId,
			...this.sessionId ? { sessionId: this.sessionId } : {},
			text: this.text.trim(),
			usage: this.usage,
			attempts: meta.attempts,
			startedAt: this.base.startedAt,
			endedAt: nowIso()
		};
	}
};
/**
* Build the participant's POV of the transcript so an OpenAI-compatible
* backend sees its own turns as `assistant` and everyone else's as `user`,
* with explicit speaker tags so 3+ party conversations stay disambiguated.
*/
function buildMessagesFor(speakerName, seed, transcript) {
	const messages = seed ? [{
		role: "user",
		content: seed
	}] : [];
	for (const turn of transcript) if (turn.speaker === speakerName) messages.push({
		role: "assistant",
		content: turn.text
	});
	else messages.push({
		role: "user",
		content: `[${turn.speaker}] ${turn.text}`
	});
	return messages;
}
function fullConversationInput(task, speakerName, seed, transcript) {
	return {
		task,
		message: [seed, ...transcript.map((turn) => `[${turn.speaker}] ${turn.text}`)].filter((part) => part.length > 0).join("\n\n"),
		messages: buildMessagesFor(speakerName, seed, transcript)
	};
}
function continuedConversationInput(task, speakerName, transcript) {
	let lastOwnTurn = -1;
	for (let index = transcript.length - 1; index >= 0; index -= 1) if (transcript[index]?.speaker === speakerName) {
		lastOwnTurn = index;
		break;
	}
	const unseen = transcript.slice(lastOwnTurn + 1);
	const message = unseen.length > 0 ? unseen.map((turn) => `[${turn.speaker}] ${turn.text}`).join("\n\n") : "Continue.";
	return {
		task,
		message,
		messages: [{
			role: "user",
			content: message
		}]
	};
}
function sessionIdsFrom(transcript) {
	const sessions = /* @__PURE__ */ new Map();
	for (const turn of transcript) if (turn.sessionId) bindParticipantSession(sessions, turn.speaker, turn.sessionId);
	return sessions;
}
function bindParticipantSession(sessions, speakerName, sessionId) {
	assertParticipantSessionAvailable(sessions, speakerName, sessionId);
	sessions.set(speakerName, sessionId);
}
function assertParticipantSessionAvailable(sessions, speakerName, sessionId) {
	for (const [boundSpeaker, boundSessionId] of sessions) if (boundSpeaker !== speakerName && boundSessionId === sessionId) throw new BackendTransportError("conversation", `session '${sessionId}' is already bound to participant '${boundSpeaker}'`);
}
function participantSessionId(runId, speakerName, participants) {
	const participantIndex = participants.findIndex((participant) => participant.name === speakerName);
	if (participantIndex < 0) throw new BackendTransportError("conversation", `participant '${speakerName}' is not registered in this conversation`);
	return `${runId}.participant.${participantIndex}.${slugifySpeaker(speakerName)}`;
}
/**
* True when this participant should forward the caller's
* `X-Tangle-Forwarded-Authorization` on outbound calls (the "pass-through"
* commercial mode). False when it elects to pay for its own outbound calls
* (the "reseller" / "bundle" mode). See ConversationParticipant.authSource.
*/
function resolveAuthForwarding(participant, state) {
	return (typeof participant.authSource === "function" ? participant.authSource(state) : participant.authSource ?? "forward-user") === "forward-user";
}
function selectSpeaker(order, participantCount, state) {
	const resolved = order ?? (participantCount === 2 ? "alternate" : "round-robin");
	if (resolved === "alternate" || resolved === "round-robin") return state.turnIndex % participantCount;
	if (typeof resolved === "function") {
		const idx = resolved(state);
		if (!Number.isInteger(idx) || idx < 0 || idx >= participantCount) throw new BackendTransportError("conversation", `turnOrder function returned invalid index ${String(idx)} for ${participantCount} participants`);
		return idx;
	}
	throw new BackendTransportError("conversation", `unknown turnOrder: ${String(resolved)}`);
}
function centsFromUsd(usd) {
	return Math.round(usd * 100);
}
/**
* Synthesize a knowledge-readiness report that *passes* every gate, used to
* satisfy `AgentBackendContext.knowledge` per turn. Conversations don't apply
* task-level readiness gating per-turn — that's a `runAgentTask` concern.
*/
function passingReadiness(taskId) {
	return {
		taskId,
		readinessScore: 1,
		blockingMissingRequirements: [],
		nonBlockingGaps: [],
		recommendedAction: "run_agent",
		bundle: {
			taskId,
			requirements: [],
			evidenceIds: [],
			claimIds: [],
			wikiPageIds: [],
			userAnswers: {},
			missing: [],
			readinessScore: 1
		},
		severity: "info",
		reason: "conversation-mode: readiness gating not applied per-turn"
	};
}
//#endregion
//#region src/conversation/conversation-backend.ts
/**
*
* Wrap a `Conversation` so it satisfies `AgentExecutionBackend`. The result is
* an addressable "single agent" whose internal behavior is an N-party
* orchestrated conversation — the recursion primitive that lets a swarm be a
* participant inside another swarm, or be published behind a single
* agent-gateway endpoint.
*
* Stream events from inner participants are NOT forwarded verbatim. Outer
* callers see one `text_delta` per inner turn (the turn's full text), tagged
* with `[speaker] ` prefix so the outer transcript stays attributable. The
* conversation's `conversation_end` halt reason rides on a `final` event.
*
* @stable
*/
/** Adapt a multi-participant conversation into the standard execution backend contract. */
function createConversationBackend(options) {
	const kind = options.kind ?? "conversation";
	return {
		kind,
		start(_input, context) {
			return newRuntimeSession(kind, context.requestedSessionId, { participants: options.conversation.participants.map((p) => p.name) });
		},
		async *stream(input, context) {
			const seed = input.message ?? input.messages?.at(-1)?.content ?? providerMessageText(input.providerOptions) ?? context.task.intent;
			const task = context.task;
			const session = context.session;
			yield {
				type: "backend_start",
				task,
				session,
				backend: kind,
				timestamp: nowIso()
			};
			let finalText = "";
			let totalCostUsd = 0;
			let totalTokensIn = 0;
			let totalTokensOut = 0;
			const inboundDepth = parseInboundDepth(context.propagatedHeaders);
			for await (const event of runConversationStream(options.conversation, {
				seed,
				signal: context.signal,
				runId: context.runId,
				propagatedHeaders: context.propagatedHeaders,
				inboundDepth,
				parentTurnId: context.turnId
			})) if (event.type === "turn_end") {
				const tagged = `[${event.turn.speaker}] ${event.turn.text}\n`;
				finalText += tagged;
				yield {
					type: "text_delta",
					task,
					session,
					text: tagged,
					timestamp: event.timestamp
				};
				if (event.turn.usage) {
					const u = event.turn.usage;
					if (u.costUsd !== void 0) totalCostUsd += u.costUsd;
					if (u.tokensIn !== void 0) totalTokensIn += u.tokensIn;
					if (u.tokensOut !== void 0) totalTokensOut += u.tokensOut;
					yield {
						type: "llm_call",
						task,
						session,
						model: u.model ?? `${kind}/${event.turn.speaker}`,
						tokensIn: u.tokensIn,
						tokensOut: u.tokensOut,
						costUsd: u.costUsd,
						latencyMs: u.latencyMs,
						timestamp: event.timestamp
					};
				}
			} else if (event.type === "conversation_end") {
				const halt = event.result.halted;
				yield {
					type: "final",
					task,
					session,
					status: halt.kind === "participant_error" ? "failed" : "completed",
					reason: describeHalt(halt),
					text: finalText.trim(),
					metadata: {
						conversationRunId: event.result.runId,
						turns: event.result.turns,
						spentCreditsCents: event.result.spentCreditsCents,
						halted: halt,
						durationMs: event.result.durationMs,
						tokensIn: totalTokensIn,
						tokensOut: totalTokensOut,
						costUsd: totalCostUsd
					},
					timestamp: event.timestamp
				};
			}
			yield {
				type: "backend_end",
				task,
				session,
				backend: kind,
				timestamp: nowIso()
			};
		}
	};
}
function parseInboundDepth(headers) {
	if (!headers) return 0;
	const raw = headers[FORWARD_HEADERS.depth];
	if (raw === void 0) return 0;
	try {
		return readDepth({ [FORWARD_HEADERS.depth]: raw });
	} catch {
		return 0;
	}
}
function describeHalt(halt) {
	switch (halt.kind) {
		case "max_turns": return `max_turns (${halt.turns})`;
		case "max_credits": return `max_credits (${halt.spentCents}/${halt.capCents}¢)`;
		case "predicate": return `predicate: ${halt.reason}`;
		case "abort": return "abort";
		case "participant_error": return `participant_error[${halt.participant}]: ${halt.message}`;
	}
}
//#endregion
//#region src/conversation/define-conversation.ts
/**
*
* Declarative constructor for a multi-agent `Conversation`. Validates inputs
* fail-loud at definition time (duplicate participant names, alternate order
* with ≠2 participants, non-positive `maxTurns`) so misconfiguration is caught
* before `runConversation` is called and not buried inside a streaming run.
*
* @stable
*/
/** Validate and define a conversation before execution. */
function defineConversation(input) {
	if (input.participants.length < 2) throw new ValidationError(`Conversation requires at least 2 participants; received ${input.participants.length}.`);
	const seen = /* @__PURE__ */ new Set();
	for (const p of input.participants) {
		if (!p.name || p.name.trim() === "") throw new ValidationError("Conversation participant.name must be a non-empty string.");
		if (seen.has(p.name)) throw new ValidationError(`Conversation participant names must be unique within a Conversation; '${p.name}' appears more than once.`);
		seen.add(p.name);
		if (!p.backend || typeof p.backend.stream !== "function") throw new ValidationError(`Conversation participant '${p.name}' is missing a backend with a stream() method.`);
	}
	const policy = normalizePolicy(input.policy, input.participants.length);
	return {
		participants: input.participants,
		policy
	};
}
function normalizePolicy(policy, participantCount) {
	if (!Number.isInteger(policy.maxTurns) || policy.maxTurns < 1) throw new ValidationError(`ConversationPolicy.maxTurns must be a positive integer; received ${String(policy.maxTurns)}.`);
	if (policy.maxCreditsCents !== void 0 && (!Number.isFinite(policy.maxCreditsCents) || policy.maxCreditsCents < 0)) throw new ValidationError(`ConversationPolicy.maxCreditsCents must be a non-negative finite number when set; received ${String(policy.maxCreditsCents)}.`);
	const turnOrder = policy.turnOrder ?? (participantCount === 2 ? "alternate" : "round-robin");
	if (turnOrder === "alternate" && participantCount !== 2) throw new ValidationError(`ConversationPolicy.turnOrder 'alternate' requires exactly 2 participants; received ${participantCount}. Use 'round-robin' or a custom selector for N-party conversations.`);
	return {
		...policy,
		turnOrder
	};
}
//#endregion
//#region src/conversation/journal.ts
/**
*
* Durable conversation transcript — survives a driver process crash mid-run.
* The runner journals every committed turn before yielding `turn_end`, so a
* resumed run replays the same `runId` against the same journal and picks up
* from the first un-recorded turn. Combined with the deterministic
* `turnId(runId, index, speaker)`, a retried turn collides with the prior
* attempt's id and any caching gateway can dedupe.
*
* The interface is small enough that a Cloudflare D1 / R2 / postgres adapter
* is ~30 lines. The in-memory adapter is the default for tests and scratch.
* The file adapter (JSONL on disk) is the default-durable choice when no
* upstream store is wired.
*
* @stable
*/
/** In-memory `ConversationJournal` — suitable for testing and single-process runs. */
var InMemoryConversationJournal = class {
	entries = /* @__PURE__ */ new Map();
	async loadRun(runId) {
		const entry = this.entries.get(runId);
		if (!entry) return void 0;
		return {
			runId: entry.runId,
			startedAt: entry.startedAt,
			halted: entry.halted,
			endedAt: entry.endedAt,
			turns: [...entry.turns]
		};
	}
	async beginRun(runId, startedAt) {
		const existing = this.entries.get(runId);
		if (existing) {
			if (existing.startedAt !== startedAt) throw new Error(`runId '${runId}' already exists with startedAt=${existing.startedAt}; refusing to overwrite with ${startedAt}`);
			return;
		}
		this.entries.set(runId, {
			runId,
			startedAt,
			turns: []
		});
	}
	async appendTurn(runId, turn) {
		const entry = this.entries.get(runId);
		if (!entry) throw new Error(`appendTurn called for unknown runId '${runId}'; call beginRun first or use the runner which handles it`);
		if (entry.halted) throw new Error(`cannot append turn to halted run '${runId}' (halt reason: ${JSON.stringify(entry.halted)})`);
		entry.turns.push(turn);
	}
	async recordHalt(runId, halt, endedAt) {
		const entry = this.entries.get(runId);
		if (!entry) throw new Error(`recordHalt called for unknown runId '${runId}'`);
		entry.halted = halt;
		entry.endedAt = endedAt;
	}
};
/**
* JSONL on disk. One line per record; first line is the `begin`, subsequent
* lines are `turn` records, terminal line is `halt`. Replays the whole file
* on `loadRun` — cheap for the conversation sizes this is designed for
* (thousands of turns, not millions). For huge runs, plug in a real DB
* adapter; the interface is small.
*
* Reads and appends over the shared append-only spine (`durable/jsonl-file`): each
* `appendTurn` / `recordHalt` finishes a short write and calls `fsync`, so a process
* crash between writes never loses an acknowledged turn, and a crash DURING one leaves
* an uncommitted final line that the next read skips and the next append truncates.
*/
var FileConversationJournal = class {
	path;
	constructor(path) {
		this.path = path;
	}
	async loadRun(runId) {
		let entry;
		for await (const record of readCommittedJsonLines(this.path, { allowMissing: true })) {
			if (record.runId !== runId) continue;
			if (record.kind === "begin") entry = {
				runId,
				startedAt: record.startedAt,
				turns: []
			};
			else if (record.kind === "turn") {
				if (!entry) throw new Error(`journal corrupted: turn record for runId '${runId}' precedes its begin record`);
				entry.turns.push(record.turn);
			} else if (record.kind === "halt") {
				if (!entry) throw new Error(`journal corrupted: halt record for runId '${runId}' precedes its begin record`);
				entry.halted = record.halted;
				entry.endedAt = record.endedAt;
			}
		}
		return entry;
	}
	async beginRun(runId, startedAt) {
		const existing = await this.loadRun(runId);
		if (existing) {
			if (existing.startedAt !== startedAt) throw new Error(`runId '${runId}' already exists in ${this.path} with startedAt=${existing.startedAt}; refusing to overwrite with ${startedAt}`);
			return;
		}
		await this.appendRecord({
			kind: "begin",
			runId,
			startedAt
		});
	}
	async appendTurn(runId, turn) {
		await this.appendRecord({
			kind: "turn",
			runId,
			turn
		});
	}
	async recordHalt(runId, halt, endedAt) {
		await this.appendRecord({
			kind: "halt",
			runId,
			halted: halt,
			endedAt
		});
	}
	async appendRecord(record) {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		await fs.mkdir(path.dirname(this.path), { recursive: true });
		const needsSeparator = await prepareJsonlAppend(this.path);
		const fh = await fs.open(this.path, "a");
		try {
			await writeAllBytes(fh, `${needsSeparator ? "\n" : ""}${JSON.stringify(record)}\n`);
			await fh.sync();
		} finally {
			await fh.close();
		}
	}
};
//#endregion
//#region src/conversation/journal-sql.ts
/**
* Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1
* consumers don't have to write the wrapper themselves; the runtime never
* imports `@cloudflare/workers-types` directly (peer-style typing).
*/
function d1ToSqlAdapter(db) {
	return {
		async exec(sql, params = []) {
			const stmt = db.prepare(sql);
			const meta = (await (params.length > 0 ? stmt.bind(...params) : stmt).run()).meta;
			return { rowsAffected: meta?.rows_written ?? meta?.changes ?? 0 };
		},
		async query(sql, params = []) {
			const stmt = db.prepare(sql);
			return (await (params.length > 0 ? stmt.bind(...params) : stmt).all()).results ?? [];
		}
	};
}
const RUNS_TABLE_DDL = (table) => `
  CREATE TABLE IF NOT EXISTS ${table}_runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    halted_kind TEXT,
    halted_payload TEXT,
    ended_at TEXT
  )
`;
const TURNS_TABLE_DDL = (table) => `
  CREATE TABLE IF NOT EXISTS ${table}_turns (
    run_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (run_id, turn_index)
  )
`;
const TURNS_INDEX_DDL = (table) => `
  CREATE INDEX IF NOT EXISTS idx_${table}_turns_run ON ${table}_turns (run_id, turn_index)
`;
/**
* SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
* start/halt timestamps + halt reason) and turns (one row per committed turn,
* payload is the ConversationTurn JSON). Replays the turns table on
* `loadRun` and writes append-only per `appendTurn`.
*/
var SqlConversationJournal = class {
	db;
	table;
	/**
	* @param db    SQL adapter (D1, postgres, sqlite, libSQL — all work)
	* @param table Table-name prefix; the journal creates `${table}_runs` and
	*              `${table}_turns`. Lets multiple journals share a database
	*              without colliding (e.g. one per product surface).
	*/
	constructor(db, table = "agent_runtime_journal") {
		this.db = db;
		this.table = table;
	}
	/**
	* Create the journal's tables if absent. Idempotent. Call once at deploy
	* (or at app boot) — running on every request is harmless but adds latency.
	*/
	async migrate() {
		await this.db.exec(RUNS_TABLE_DDL(this.table));
		await this.db.exec(TURNS_TABLE_DDL(this.table));
		await this.db.exec(TURNS_INDEX_DDL(this.table));
	}
	async loadRun(runId) {
		const row = (await this.db.query(`SELECT run_id, started_at, halted_kind, halted_payload, ended_at FROM ${this.table}_runs WHERE run_id = ?`, [runId]))[0];
		if (!row) return void 0;
		const turns = await this.db.query(`SELECT payload, turn_index FROM ${this.table}_turns WHERE run_id = ? ORDER BY turn_index ASC`, [runId]);
		return {
			runId: row.run_id,
			startedAt: row.started_at,
			halted: row.halted_payload ? JSON.parse(row.halted_payload) : void 0,
			endedAt: row.ended_at ?? void 0,
			turns: turns.map((t) => JSON.parse(t.payload))
		};
	}
	async beginRun(runId, startedAt) {
		const existing = await this.db.query(`SELECT started_at FROM ${this.table}_runs WHERE run_id = ?`, [runId]);
		if (existing.length > 0) {
			if (existing[0]?.started_at !== startedAt) throw new Error(`runId '${runId}' already exists with startedAt=${existing[0]?.started_at}; refusing to overwrite with ${startedAt}`);
			return;
		}
		await this.db.exec(`INSERT INTO ${this.table}_runs (run_id, started_at) VALUES (?, ?)`, [runId, startedAt]);
	}
	async appendTurn(runId, turn) {
		const halted = await this.db.query(`SELECT halted_kind FROM ${this.table}_runs WHERE run_id = ?`, [runId]);
		if (halted.length === 0) throw new Error(`appendTurn called for unknown runId '${runId}'; call beginRun first or use the runner which handles it`);
		if (halted[0]?.halted_kind) throw new Error(`cannot append turn to halted run '${runId}' (halt kind: ${halted[0]?.halted_kind})`);
		await this.db.exec(`INSERT INTO ${this.table}_turns (run_id, turn_index, payload) VALUES (?, ?, ?)`, [
			runId,
			turn.index,
			JSON.stringify(turn)
		]);
	}
	async recordHalt(runId, halt, endedAt) {
		if ((await this.db.exec(`UPDATE ${this.table}_runs SET halted_kind = ?, halted_payload = ?, ended_at = ? WHERE run_id = ?`, [
			halt.kind,
			JSON.stringify(halt),
			endedAt,
			runId
		])).rowsAffected === 0) throw new Error(`recordHalt called for unknown runId '${runId}'`);
	}
};
//#endregion
//#region src/conversation/run-persona.ts
/** Adapt one exact profile + Runtime executor into the conversation stream protocol. */
function profileRuntimeBackend(profile, factory, counter) {
	const backend = createProfileExecutionBackend({
		profile,
		executor: factory
	});
	if (!counter) return backend;
	return {
		...backend,
		async *stream(input, context) {
			for await (const event of backend.stream(input, context)) {
				if (event.type === "llm_call") addRuntimeUsage(counter, event);
				yield event;
			}
		}
	};
}
/** A persona participant that replays scripted user turns in order. */
function scriptedPersonaBackend(turns) {
	let idx = 0;
	return createIterableBackend({
		kind: "persona-user",
		async *stream(_input, context) {
			const text = turns[idx];
			if (text === void 0) throw new Error(`persona-user: ran out of scripted turns at index ${idx} (had ${turns.length})`);
			idx += 1;
			yield {
				type: "text_delta",
				task: context.task,
				session: context.session,
				text,
				timestamp: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
	});
}
/**
* Run one worker profile against one persona as a multi-round conversation.
* The persona leads (participant 0): it speaks, the worker answers, repeat,
* until `maxTurns`. Returns the persistent transcript + worker-only usage.
*/
async function runPersonaConversation(opts) {
	const counter = createRuntimeUsageTotals();
	const workerName = opts.workerName ?? "agent";
	const worker = profileRuntimeBackend(opts.worker, opts.executorFor(opts.worker, "worker"), counter);
	let persona;
	let maxTurns;
	if (opts.persona.kind === "scripted") {
		if (opts.persona.turns.length === 0) throw new Error("runPersonaConversation: scripted persona has no turns");
		persona = scriptedPersonaBackend(opts.persona.turns);
		maxTurns = opts.maxTurns ?? 2 * opts.persona.turns.length;
	} else {
		persona = profileRuntimeBackend(opts.persona.profile, opts.executorFor(opts.persona.profile, "persona"));
		if (opts.maxTurns === void 0) throw new Error("runPersonaConversation: maxTurns is required for a profile-driven persona");
		maxTurns = opts.maxTurns;
	}
	const result = await runConversation(defineConversation({
		participants: [{
			name: "user",
			backend: persona
		}, {
			name: workerName,
			backend: worker
		}],
		policy: {
			maxTurns,
			turnOrder: "alternate",
			...opts.haltOn ? { haltOn: opts.haltOn } : {}
		}
	}), {
		seed: opts.seed ?? "Begin.",
		signal: opts.signal
	});
	const fallbackCostKnown = counter.llmCalls === 0 && opts.persona.kind === "scripted" && result.spentCreditsCents > 0;
	const costUsd = fallbackCostKnown ? result.spentCreditsCents / 100 : counter.costUsd;
	const tokensKnown = counter.llmCalls > 0 && counter.tokensKnown !== false;
	const costUsdKnown = counter.llmCalls > 0 ? counter.usdKnown !== false : fallbackCostKnown;
	return {
		transcript: result.transcript,
		turns: result.turns,
		halted: result.halted,
		costUsd,
		tokensIn: counter.tokensIn,
		tokensOut: counter.tokensOut,
		...tokensKnown ? {} : { tokensKnown: false },
		...costUsdKnown ? {} : { costUsdKnown: false },
		...counter.estimatedCostUsd !== void 0 ? { estimatedCostUsd: counter.estimatedCostUsd } : {}
	};
}
/**
* Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for
* `runProfileMatrix`: the profile axis is the worker-under-test, the scenario
* axis is the persona, and the runner is the cell. Meters the worker through
* `ctx.cost` so the matrix's backend-integrity guard sees real usage.
*/
function runPersonaDispatch(config) {
	return async (worker, scenario, ctx) => {
		const model = worker.model?.default ?? "unknown";
		const maximumCharge = typeof config.maximumCharge === "function" ? config.maximumCharge(worker, scenario) : config.maximumCharge;
		const paid = await ctx.cost.runPaidCall({
			channel: "agent",
			actor: "persona-conversation",
			model,
			signal: ctx.signal,
			...maximumCharge ? { maximumCharge } : {},
			execute: (executionSignal) => runPersonaConversation({
				worker,
				persona: config.personaOf(scenario),
				executorFor: config.executorFor,
				maxTurns: config.maxTurns?.(scenario),
				seed: config.seed?.(scenario),
				signal: executionSignal,
				workerName: config.workerName
			}),
			receipt: (result) => ({
				model,
				inputTokens: result.tokensIn,
				outputTokens: result.tokensOut,
				...result.tokensKnown === false ? { usageUnknown: true } : {},
				...result.costUsdKnown === false ? { costUnknown: true } : { actualCostUsd: result.costUsd }
			})
		});
		if (!paid.succeeded) throw paid.error;
		const result = paid.value;
		return config.artifactOf(result.transcript, scenario);
	};
}
//#endregion
//#region src/improvement/build-prompts.ts
/** Render findings as the ranked-evidence block every build prompt ends with. */
function findingLines(findings) {
	return findings.map((f) => {
		const where = f.subject ? ` [${f.subject}]` : "";
		const action = f.recommended_action ? ` → ${f.recommended_action}` : "";
		return `- (${f.severity})${where} ${f.claim}${action}`;
	});
}
/** Build the starting instruction for a coder agent tasked with implementing a new tool. */
function toolBuildPrompt(args) {
	return [
		"You are building a new TOOL for this codebase — a capability the agent measurably lacks,",
		"evidenced by the failure findings at the bottom. The tool is an experiment: after it is",
		"built and verified, its marginal lift is measured on held-out tasks, and only a real lift",
		"promotes it.",
		"",
		optimizerMethod,
		"",
		"THE SURFACE — what a deliverable tool looks like here:",
		"- ONE small, self-contained module PLUS tests that exercise its contract (what callers rely",
		"  on), not its internals. The tests are the experiment for sub-goal correctness — write the",
		"  test that would fail if your hypothesis about the gap were wrong.",
		"- It must compile and its tests must pass — they run automatically; on failure you get the",
		"  verifier output and another attempt, resuming on top of your own edits (fix in place, do",
		"  not start over).",
		"- Match the codebase grain: reuse its existing helpers, style, and test framework; a tool",
		"  that fights the codebase is the wrong tool even if it passes.",
		"- Do not commit; leave the changes in the working tree.",
		"",
		"FINDINGS — ranked evidence from real failed runs (the gaps the tool must close):",
		...findingLines(args.findings)
	].join("\n");
}
/** Build the starting instruction for a coder agent tasked with implementing a new MCP server. */
function mcpBuildPrompt(args) {
	return [
		"You are building a new MCP SERVER (Model Context Protocol) exposing tool(s) that close the",
		"capability gaps evidenced by the failure findings at the bottom, so any harness can mount",
		"them. The server is an experiment: after it is built and boot-verified, its marginal lift is",
		"measured on held-out tasks, and only a real lift promotes it.",
		"",
		optimizerMethod,
		"",
		"RESEARCH FIRST — ADOPT BEFORE BUILD: you may discover and ADOPT an existing external MCP",
		"server if it fits the gaps better than building one. Registries and vendor docs list",
		"maintained servers for most common capabilities (web search, fetch, GitHub, filesystems,",
		"databases). To adopt, deliver a short adoption note instead of an implementation: the",
		"server's launch command or HTTP endpoint, and the API key it needs BY NAME (e.g.",
		"EXA_API_KEY) — never a key value; provisioning injects the value at materialize time. If",
		"your environment has no web access, decide from what you already know and say so.",
		"",
		"THE SURFACE — what a deliverable MCP server looks like here (checked by BOOTING it):",
		"- it starts over stdio and answers the MCP `initialize` handshake,",
		"- `tools/list` returns at least one tool with a valid input schema,",
		"- newline-delimited JSON-RPC 2.0, protocol version 2024-11-05,",
		"- a clear start command (a package.json `start` script or an obvious entrypoint).",
		"Design the tool surface for the FINDINGS, not for generality: each exposed tool should map to",
		"a named failure mechanism, with a description that tells the agent when to reach for it (a",
		"tool the agent never calls measures zero). If the boot-and-probe fails you get the error and",
		"another attempt, resuming on top of your own edits. Do not commit; leave the changes in the",
		"working tree.",
		"",
		"FINDINGS — ranked evidence from real failed runs (the capabilities the server must provide):",
		...findingLines(args.findings)
	].join("\n");
}
//#endregion
//#region src/improvement/mcp-serve-verifier.ts
/**
* `mcpServeVerifier` — the intrinsic verifier for a built MCP server: the
* boot-and-probe checker named in docs/artifact-lifecycle-frontier.md. A
* generated MCP server is only a candidate if it actually *serves* — so this
* boots it over stdio (the default local MCP transport) and runs the real
* handshake: `initialize` → `notifications/initialized` → `tools/list`, and
* asserts the server answers with at least `minTools` tools.
*
* The spawn + handshake is the SHARED same-host stdio connection
* (`connectStdioMcp`) — the same code path that later serves the built server
* LIVE to a scored run (`materializeLocalMcp`), so "verified it serves" and
* "served while scored" can never drift apart.
*
* Outcomes follow the `Verifier` contract: a server that fails to start, exits
* early, errors the handshake, times out, or exposes no tools is a FAILED
* candidate (`{ok:false}`, fed back into the next generation shot); a missing
* start binary or spawn fault THROWS (a setup bug, never a silent fallback).
*/
/** Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools. */
function mcpServeVerifier(spec) {
	const minTools = spec.minTools ?? 1;
	return async (worktreePath) => {
		let conn;
		try {
			conn = await connectStdioMcp({
				command: spec.command,
				...spec.args ? { args: spec.args } : {},
				cwd: worktreePath,
				...spec.env ? { env: spec.env } : {},
				...spec.timeoutMs !== void 0 ? { timeoutMs: spec.timeoutMs } : {}
			});
		} catch (err) {
			if (err instanceof McpSpawnFault) throw new Error(`mcpServeVerifier: ${err.message}`);
			return {
				ok: false,
				feedback: err instanceof Error ? err.message : String(err)
			};
		}
		try {
			if (conn.tools.length < minTools) return {
				ok: false,
				feedback: `tools/list returned ${conn.tools.length} tool(s), need >= ${minTools}`
			};
			return { ok: true };
		} finally {
			await conn.close();
		}
	};
}
//#endregion
//#region src/improvement/official-optimizers.ts
const defaultMaxFindingsChars = 5e4;
const pythonClientDocs = "https://github.com/tangle-network/agent-eval/tree/main/clients/python";
const bridgeInstall = "`python -m pip install \"agent-eval-rpc==0.145.0\"`";
const gepaWheelInstall = "`python -m pip install \"gepa[full]==0.1.4\"`";
const gepaSourceInstall = "`python -m pip install \"gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f\"`";
const skillOptInstall = `${bridgeInstall}, then \`python -m pip install "skillopt @ git+https://github.com/microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90"\``;
/** Missing optional Python dependencies for an official optimizer. */
var OfficialOptimizerUnavailableError = class extends ConfigError {
	optimizer;
	constructor(optimizer, cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		const install = optimizer === "gepa" ? [
			`Install the Python bridge: ${bridgeInstall}.`,
			`The direct GEPA engine uses the published wheel: ${gepaWheelInstall}.`,
			`Composed recipes and source-only engines use the tested source revision: ${gepaSourceInstall}.`
		].join(" ") : `Install Microsoft SkillOpt: ${skillOptInstall}.`;
		super([
			`Official ${optimizer === "gepa" ? "GEPA" : "SkillOpt"} could not start.`,
			"Runtime did not use a local fallback.",
			install,
			`Setup: ${pythonClientDocs}.`,
			`Cause: ${detail}`
		].join(" "), { cause });
		this.optimizer = optimizer;
	}
};
/**
* Build a complete method backed by GEPA's official Optimize Anything API.
*
* The recipe is passed through unchanged. Use `engine`, `sequential`,
* `adaptive-sequential`, `best-of`, `vote`, or `omni` explicitly.
*/
function officialGepa(options) {
	return officialOptimizer("gepa", options, (config) => gepaOptimizationMethod(config));
}
/** Build a complete method backed by Microsoft's official SkillOpt trainer. */
function officialSkillOpt(options) {
	return officialOptimizer("skillopt", options, (config) => skillOptOptimizationMethod(config));
}
/** Keep evidence redaction, identity, dependency errors, and candidate controls identical for both wrappers. */
function officialOptimizer(optimizer, options, create) {
	const label = optimizer === "gepa" ? "officialGepa" : "officialSkillOpt";
	const { background, includeFindings = true, maxFindingsChars, describeScenario, describeArtifact, redact, authorizeSensitiveCandidate, ...config } = options;
	const redactor = resolveRedactor(redact);
	const redactionPolicyRef = optimizerRedactionPolicyRef(redact);
	assertMaxFindingsChars(label, maxFindingsChars);
	const objective = redactOptimizerText(label, "objective", config.objective, redactor);
	return (context) => {
		const externalEvaluationRef = optimizerEvidencePolicyRef({
			runtimeEvaluationRef: context.evaluationRef,
			redactionPolicyRef,
			describeScenario,
			describeArtifact,
			authorizeSensitiveCandidate
		});
		return withMethodRuntimeControls(withDependencyHelp(optimizer, externalEvaluationRef, redactor, redactionPolicyRef, create({
			...config,
			objective,
			evaluationId: externalEvaluationRef,
			searchLedger: { identity: optimizerSearchIdentity(optimizer, context, externalEvaluationRef, config) },
			background: methodBackground({
				context,
				background,
				includeFindings,
				maxFindingsChars,
				label,
				redactor
			}),
			...describeScenario ? { describeScenario: (scenario) => redactOptimizerEvidence(label, "scenario descriptor", describeScenario(scenario), redactor) } : {},
			...describeArtifact ? { describeArtifact: (artifact, scenario) => redactOptimizerEvidence(label, "artifact descriptor", describeArtifact(artifact, scenario), redactor) } : {}
		})), {
			costAttribution: "optimizer-run",
			validateCandidate: (input) => assertSafeOptimizerCandidate(label, input, authorizeSensitiveCandidate)
		});
	};
}
/**
* The identities the optimizer's search ledger records. Its search source is
* a digest of the optimizer's declared settings under this evaluation; the
* upstream revision it ran is in the method's provenance. Its proposer is the
* optimizer model Eval's proxy meters, or GEPA's own reflection model.
*/
function optimizerSearchIdentity(optimizer, context, evaluationId, config) {
	const { resume: _resume, trustResumeState: _trustResumeState, runner: _runner, timeoutMs: _timeoutMs, ...searchSettings } = config;
	const search = {
		uri: `agent-runtime:official-${optimizer}`,
		revision: canonicalCandidateDigest$1({
			optimizer,
			evaluationId,
			settings: JSON.parse(JSON.stringify(searchSettings))
		})
	};
	const model = config.optimizer;
	return {
		...context.searchIdentity,
		search,
		proposer: model ? {
			kind: "model",
			model: {
				provider: "unspecified",
				alias: model.model,
				unknown: "Eval meters each optimizer call; the ledger records the configured model"
			},
			source: {
				uri: `optimizer-call:${model.callRef}`,
				revision: canonicalCandidateDigest$1({
					callRef: model.callRef,
					model: model.model
				})
			}
		} : {
			kind: "model",
			model: {
				provider: "unspecified",
				alias: "unspecified",
				unknown: "GEPA calls the reflection model its recipe configures"
			},
			source: search
		}
	};
}
function assertMaxFindingsChars(label, value) {
	if (value !== void 0 && (!Number.isSafeInteger(value) || value <= 0)) throw new ConfigError(`${label}: maxFindingsChars must be a positive safe integer`);
}
function methodBackground(options) {
	const { context, background, includeFindings, maxFindingsChars = defaultMaxFindingsChars, label, redactor } = options;
	const safeBackground = background === void 0 ? void 0 : redactOptimizerText(label, "background", background, redactor);
	const safeProfileName = context.profile.name === void 0 ? void 0 : redactOptimizerText(label, "profile name", context.profile.name, redactor);
	const sections = [safeBackground?.trim(), safeProfileName ? `Agent profile: ${safeProfileName}. Surface: ${context.surface}.` : `Agent surface: ${context.surface}.`].filter((value) => Boolean(value));
	if (includeFindings && context.findings.length > 0) {
		let serialized;
		try {
			serialized = canonicalJson(redactOptimizerEvidence(label, "findings", context.findings, redactor));
		} catch (cause) {
			throw new ConfigError(`${label}: findings must be JSON-serializable`, { cause });
		}
		if (serialized.length > maxFindingsChars) throw new ConfigError(`${label}: serialized findings exceed maxFindingsChars (${serialized.length} > ${maxFindingsChars})`);
		sections.push(`Observed failures:\n${serialized}`);
	}
	return sections.join("\n\n");
}
function assertSafeOptimizerCandidate(label, input, authorizeSensitiveCandidate) {
	const privatePaths = privateValuePaths([input.value, input.candidateSurface]);
	if (privatePaths.length > 0) throw new ConfigError(`${label}: the selected profile surface contains a common credential or private value at ${privatePaths.slice(0, 8).join(", ")}. Store live credentials as provider references, or remove private data before starting an external optimizer.`);
	const sensitivePaths = sensitiveProfileSurfacePaths(input);
	if (sensitivePaths.length === 0) return;
	let authorized = false;
	if (authorizeSensitiveCandidate) try {
		authorized = authorizeSensitiveCandidate(Object.freeze({
			...input,
			sensitivePaths: Object.freeze([...sensitivePaths])
		})) === true;
	} catch (cause) {
		throw new ConfigError(`${label}: sensitive candidate authorization failed`, { cause });
	}
	if (!authorized) throw new ConfigError(`${label}: the selected profile surface contains fields that may carry private values: ${sensitivePaths.slice(0, 8).join(", ")}. Remove them, replace values with safe references, or authorize the exact profile with authorizeSensitiveCandidate.`);
}
function sensitiveProfileSurfacePaths(input) {
	const paths = /* @__PURE__ */ new Set();
	if (input.surface === "tools" || input.surface === "mcp" || input.surface === "hooks" || input.surface === "subagents" || input.surface === "agent-profile") paths.add("$");
	const seen = /* @__PURE__ */ new WeakSet();
	const visit = (current, path) => {
		if (current === null || typeof current !== "object") return;
		if (seen.has(current)) return;
		seen.add(current);
		if (Array.isArray(current)) {
			current.forEach((child, index) => {
				visit(child, `${path}[${index}]`);
			});
			return;
		}
		for (const [key, child] of Object.entries(current)) {
			const childPath = `${path}.${key}`;
			if ([
				"env",
				"headers",
				"url",
				"metadata",
				"extensions"
			].includes(key.toLowerCase())) {
				paths.add(childPath);
				continue;
			}
			visit(child, childPath);
		}
	};
	visit(input.value, "$");
	return [...paths];
}
function redactOptimizerEvidence(label, field, value, redactor) {
	try {
		return redactor(value);
	} catch (cause) {
		throw new ConfigError(`${label}: ${field} redaction failed`, { cause });
	}
}
function redactOptimizerText(label, field, value, redactor) {
	const redacted = redactOptimizerEvidence(label, field, value, redactor);
	if (typeof redacted !== "string" || !redacted.trim()) throw new ConfigError(`${label}: ${field} redaction must return a non-empty string`);
	return redacted;
}
function redactJudgeScore(score, redactor) {
	const notes = redactOptimizerEvidence("official optimizer", "judge notes", score.notes, redactor);
	return {
		...score,
		notes: typeof notes === "string" ? notes : "[redacted]"
	};
}
function optimizerRedactionPolicyRef(redact, builtInIdentity = defaultRedactorIdentityMaterial()) {
	if (redact === false) return "caller-approved-raw";
	return canonicalCandidateDigest$1({
		kind: redact === void 0 ? "default-redactor" : "caller-redactor-with-default",
		builtIn: builtInIdentity,
		...redact === void 0 ? {} : {
			callerSource: Function.prototype.toString.call(redact),
			composition: Function.prototype.toString.call(resolveRedactor)
		}
	});
}
function optimizerEvidencePolicyRef(input) {
	return canonicalCandidateDigest$1({
		runtimeEvaluationRef: input.runtimeEvaluationRef,
		redactionPolicyRef: input.redactionPolicyRef,
		describeScenario: callbackSource(input.describeScenario),
		describeArtifact: callbackSource(input.describeArtifact),
		authorizeSensitiveCandidate: callbackSource(input.authorizeSensitiveCandidate)
	});
}
function callbackSource(callback) {
	return typeof callback === "function" ? Function.prototype.toString.call(callback) : null;
}
function withDependencyHelp(optimizer, evaluationRef, redactor, redactionPolicyRef, method) {
	return {
		...method,
		async optimize(input) {
			try {
				const judges = input.judges.map((judge) => Object.freeze({
					...judge,
					judgeVersion: canonicalCandidateDigest$1({
						evaluationRef,
						name: judge.name,
						dimensions: judge.dimensions,
						judgeVersion: judge.judgeVersion ?? null,
						outwardEvidence: redactionPolicyRef
					}),
					async score(scoreInput) {
						return redactJudgeScore(await judge.score(scoreInput), redactor);
					}
				}));
				return await method.optimize({
					...input,
					judges: Object.freeze(judges)
				});
			} catch (cause) {
				if (isMissingDependency(optimizer, cause)) throw new OfficialOptimizerUnavailableError(optimizer, cause);
				throw cause;
			}
		}
	};
}
function isMissingDependency(optimizer, cause) {
	const message = cause instanceof Error ? cause.message : String(cause);
	const common = [
		`${optimizer === "gepa" ? "GEPA" : "SkillOpt"} bridge could not start`,
		"source inspection could not start",
		"No module named 'agent_eval_rpc'",
		`No module named 'agent_eval_rpc.${optimizer === "gepa" ? "gepa_bridge" : "skillopt_bridge"}'`
	];
	const specific = optimizer === "gepa" ? [
		"requires GEPA",
		"requires GEPA's Optimize Anything",
		"No module named 'gepa'",
		"gepa is importable but its package metadata is unavailable"
	] : [
		"requires skillopt",
		"requires SkillOpt",
		"No module named 'skillopt'",
		"skillopt is importable but its package metadata is unavailable"
	];
	return [...common, ...specific].some((fragment) => message.includes(fragment));
}
//#endregion
//#region src/improvement/profile-improvement-harness.ts
/**
* Bind one exact profile and executor into a repeatable self-improvement
* harness. The returned `run` method remains generic over every existing
* profile surface, optimization method, split, gate, and budget option.
*/
function createProfileImprovementHarness(options) {
	const parsed = agentProfileSchema.safeParse(options.profile);
	if (!parsed.success) throw new ConfigError(`createProfileImprovementHarness: invalid AgentProfile: ${parsed.error.message}`);
	if (typeof options.agent !== "function") throw new ConfigError("createProfileImprovementHarness: agent must be a function");
	assertCandidateValidator(options.validateCandidate);
	const profile = immutableCandidateValue(parsed.data);
	const executionRef = parseExecutionRef(options.executionRef, "createProfileImprovementHarness");
	const agent = options.agent;
	const defaultValidator = options.validateCandidate;
	const validatorFor = (validator) => {
		assertCandidateValidator(validator);
		return validator ?? defaultValidator;
	};
	return Object.freeze({
		profile,
		profileDigest: canonicalAgentProfileDigest(profile),
		executionRef,
		train(trainOptions) {
			const validateCandidate = validatorFor(trainOptions.validateCandidate);
			return improve(profile, {
				...trainOptions,
				mode: "training",
				...validateCandidate === void 0 ? {} : { validateCandidate }
			});
		},
		run(runOptions) {
			const validateCandidate = validatorFor(runOptions.validateCandidate);
			return improve(profile, {
				...runOptions,
				executionRef,
				agent,
				...validateCandidate === void 0 ? {} : { validateCandidate }
			});
		}
	});
}
//#endregion
//#region src/improvement/prompt-instructions-profile-components.ts
/** Stable component-name prefix used for `profile.prompt.instructions`. */
const PROMPT_INSTRUCTION_COMPONENT_PREFIX = "prompt.instruction:";
const COMPONENT_INDEX_WIDTH = 6;
function componentName(index) {
	return `${PROMPT_INSTRUCTION_COMPONENT_PREFIX}${String(index).padStart(COMPONENT_INDEX_WIDTH, "0")}`;
}
function orderedInstructionValues(components) {
	const entries = Object.entries(components).sort(([left], [right]) => left.localeCompare(right));
	if (entries.length === 0) throw new ConfigError("promptInstructionsProfileComponents: at least one prompt instruction is required");
	for (const [index, [name, value]] of entries.entries()) {
		const expected = componentName(index);
		if (name !== expected) throw new ConfigError(`promptInstructionsProfileComponents: expected component ${JSON.stringify(expected)}, got ${JSON.stringify(name)}`);
		if (typeof value !== "string") throw new ConfigError(`promptInstructionsProfileComponents: component ${JSON.stringify(name)} must be a string`);
	}
	return entries.map(([, value]) => value);
}
/**
* Canonical `ImproveProfileComponents` mapping for the ordered
* `AgentProfile.prompt.instructions` list.
*
* Use it with `surface: 'agent-profile'` when an optimizer should rewrite the
* exact instruction texts without being allowed to change their count, order,
* labels, or any unrelated profile field:
*
* ```ts
* await improve(profile, {
*   surface: 'agent-profile',
*   profileComponents: promptInstructionsProfileComponents,
*   // method, scenarios, judge, executionRef, agent, ...
* })
* ```
*
* Component names are zero-padded and stable. Runtime's existing component
* materializer requires every candidate to preserve the exact key set and
* verifies that `apply(read(profile))` reproduces the baseline profile. A
* profile with no prompt instructions is refused rather than inventing a
* sentinel instruction that could accidentally ship.
*/
const promptInstructionsProfileComponents = Object.freeze({
	read(profile) {
		const instructions = profile.prompt?.instructions ?? [];
		if (instructions.length === 0) throw new ConfigError("promptInstructionsProfileComponents: profile.prompt.instructions must contain at least one instruction");
		return Object.fromEntries(instructions.map((instruction, index) => [componentName(index), instruction]));
	},
	apply(profile, components) {
		const instructions = orderedInstructionValues(components);
		return agentProfileSchema.parse({
			...profile,
			prompt: {
				...profile.prompt,
				instructions
			}
		});
	}
});
//#endregion
//#region src/improvement/reflective-generator.ts
/**
*
* `reflectiveGenerator` — the cheap, no-sandbox `CandidateGenerator`. It drafts
* surface edits via the existing improvement proposer (`proposeFromFindings`,
* one LLM patch per finding) and applies them as ONE coherent improvement into
* the candidate worktree. `maxShots` is ignored — reflection is single-shot by
* construction (the patches are already drafted).
*
* This is the `shots=1, sandbox=off` code-candidate setting.
* `agenticGenerator` supplies the multi-shot verify-in-session setting.
*
* @stable
*/
/** Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. */
function reflectiveGenerator(opts) {
	return {
		kind: "reflective",
		async generate(context) {
			const { worktreePath, findings, signal } = context;
			signal.throwIfAborted();
			const batch = await opts.createImprovementProposalSource(context).proposeFromFindings(findings);
			signal.throwIfAborted();
			if (batch.errors.length > 0) throw new AggregateError(batch.errors.map((error) => /* @__PURE__ */ new Error(`${error.findingId}: ${error.message}`)), `reflectiveGenerator: proposal failed: ${batch.errors.map((error) => error.message).join("; ")}`);
			if (batch.edits.length === 0) return {
				applied: false,
				summary: ""
			};
			for (const edit of batch.edits) {
				assertPatchTarget(edit, worktreePath);
				assertCurrentBase(edit, worktreePath);
			}
			applyPatches(batch.edits, worktreePath);
			signal.throwIfAborted();
			return {
				applied: true,
				summary: batch.edits.length === 1 ? batch.edits[0].summary : `analyst: ${batch.edits.length} surface edits`
			};
		}
	};
}
function assertPatchTarget(edit, cwd) {
	for (const reverse of [false, true]) {
		const result = spawnSync("git", [
			"apply",
			"--numstat",
			"-z",
			"-p0",
			...reverse ? ["--reverse"] : [],
			"-"
		], {
			cwd,
			input: edit.patch,
			encoding: "utf8"
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`reflectiveGenerator: invalid patch: ${result.stderr.trim()}`);
		const paths = result.stdout.split("\0").filter(Boolean).map((entry) => entry.slice(entry.indexOf("	", entry.indexOf("	") + 1) + 1));
		const target = resolve(cwd, edit.target.repoRelativePath);
		if (paths.length === 0 || paths.some((path) => resolve(cwd, path) !== target)) throw new Error("reflectiveGenerator: patch paths do not match the declared target");
	}
}
function assertCurrentBase(edit, cwd) {
	const root = realpathSync(cwd);
	const path = resolve(root, edit.target.repoRelativePath);
	assertWithinWorktree(root, path);
	let content;
	try {
		assertWithinWorktree(root, realpathSync(path));
		content = readFileSync(path, "utf8");
	} catch (error) {
		if (edit.target.intent !== "create-new" || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		content = "";
	}
	if (createHash("sha256").update(content, "utf8").digest("hex") !== edit.baseSha256) throw new Error(`reflectiveGenerator: stale proposal base for ${edit.target.repoRelativePath}`);
}
function assertWithinWorktree(root, path) {
	const local = relative(root, path);
	if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error("reflectiveGenerator: proposal target is outside the candidate worktree");
}
function applyPatches(edits, cwd) {
	const result = spawnSync("git", [
		"apply",
		"-p0",
		"-"
	], {
		cwd,
		input: edits.map((edit) => `${edit.patch.trimEnd()}\n`).join(""),
		encoding: "utf-8"
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`reflectiveGenerator: patch batch failed: ${result.stderr.trim()}`);
}
//#endregion
//#region src/knowledge/activation.ts
/** Apply or restore one local knowledge candidate through the shared activation contract. */
function createKnowledgeImprovementActivationExecutor(options) {
	if (!options.identity.trim()) throw new Error("knowledge activation identity is required");
	return {
		reconcile: async (transition) => {
			const inspected = await inspectKnowledgeActivation(options, transition);
			return inspected.settled ? inspected.result : void 0;
		},
		transition: async (transition) => {
			if (transition.expired) throw new Error("knowledge write transition cannot run after authorization expires");
			const inspected = await inspectKnowledgeActivation(options, transition);
			if (inspected.settled) return inspected.result;
			const mutationOptions = {
				root: options.root,
				candidate: inspected.candidate,
				activation: {
					activation: transition.activation,
					attemptedAt: transition.attemptedAt,
					identity: options.identity,
					createResult: (receipt) => inspected.create(knowledgeMutationOutcome(receipt, inspected, transition.activation.intent))
				},
				...options.ownerId ? { ownerId: options.ownerId } : {},
				...options.leaseTtlMs === void 0 ? {} : { leaseTtlMs: options.leaseTtlMs },
				...options.now ? { now: options.now } : {},
				...options.onState ? { onState: options.onState } : {}
			};
			const improvement = transition.activation.intent === "activate-candidate" ? await promoteKnowledgeCandidate(mutationOptions) : await restoreKnowledgeCandidateBaseline(mutationOptions);
			if (!improvement.activationResult) throw new Error("knowledge mutation did not persist its shared activation result");
			return options.results.putIfAbsent(improvement.activationResult);
		}
	};
}
async function inspectKnowledgeActivation(options, transition) {
	const stored = await options.results.load(transition.activation.digest);
	if (stored !== void 0) return {
		settled: true,
		result: stored
	};
	const create = (outcome) => createAgentImprovementActivationResult(transition, {
		completedAt: completionTime(transition, options.now),
		outcome
	});
	const store = (outcome) => options.results.putIfAbsent(create(outcome));
	if (transition.kind !== "sealed-candidate") {
		if (transition.expired) return {
			settled: true,
			result: void 0
		};
		return {
			settled: true,
			result: await store({
				status: "unsupported",
				code: "KNOWLEDGE_PROFILE_TRANSITION_UNSUPPORTED",
				message: "The knowledge adapter accepts only sealed knowledge candidates."
			})
		};
	}
	const target = supportedKnowledgeTarget(transition, options.identity);
	if (!target) {
		if (transition.expired) return {
			settled: true,
			result: void 0
		};
		return {
			settled: true,
			result: await store({
				status: "unsupported",
				code: "KNOWLEDGE_TARGET_SET_UNSUPPORTED",
				message: "The knowledge adapter requires exactly one matching knowledge target."
			})
		};
	}
	const knowledge = transition.candidateBundle.knowledge;
	if (!knowledge) {
		if (transition.expired) return {
			settled: true,
			result: void 0
		};
		return {
			settled: true,
			result: await store({
				status: "unsupported",
				code: "KNOWLEDGE_CANDIDATE_MISSING",
				message: "The measured candidate bundle does not contain a knowledge candidate."
			})
		};
	}
	const candidate = fromAgentCandidateKnowledgeRef(knowledge.candidate);
	const expectedDigest = transition.activation.intent === "activate-candidate" ? knowledge.candidate.baseHash : knowledge.candidate.candidateHash;
	const desiredDigest = transition.activation.intent === "activate-candidate" ? knowledge.candidate.candidateHash : knowledge.candidate.baseHash;
	if (target.expectedBaseDigest !== expectedDigest || target.desiredDigest !== desiredDigest) {
		if (transition.expired) return {
			settled: true,
			result: void 0
		};
		return {
			settled: true,
			result: await store({
				status: "failed",
				code: "KNOWLEDGE_TARGET_MISMATCH",
				message: "The activation target does not match the measured knowledge candidate."
			})
		};
	}
	const durable = await loadKnowledgeImprovementActivationResult({
		root: options.root,
		candidate,
		activation: transition.activation,
		identity: options.identity
	});
	if (durable) return {
		settled: true,
		result: await options.results.putIfAbsent(durable)
	};
	if (transition.expired) return {
		settled: true,
		result: void 0
	};
	return {
		settled: false,
		target,
		candidate,
		expectedDigest,
		desiredDigest,
		create
	};
}
function supportedKnowledgeTarget(transition, identity) {
	if (transition.targets.length !== 1) return void 0;
	const target = transition.targets[0];
	return target.surface === "knowledge" && target.identity === identity ? target : void 0;
}
function knowledgeMutationOutcome(receipt, inspected, intent) {
	const expectedTarget = intent === "activate-candidate" ? "candidate" : "baseline";
	const beforeDigest = prefixedDigest(receipt.beforeHash);
	const afterDigest = prefixedDigest(receipt.afterHash);
	if (receipt.target !== expectedTarget || receipt.changed !== (beforeDigest !== afterDigest) || !receipt.changed && (receipt.transactionId !== null || receipt.recovered)) throw new Error("knowledge mutation returned inconsistent state evidence");
	if (receipt.changed) {
		if (receipt.transactionId === null || beforeDigest !== inspected.expectedDigest || afterDigest !== inspected.desiredDigest) throw new Error("knowledge activation did not apply its authorized content transition");
		return {
			status: "applied",
			transactionId: receipt.transactionId,
			targets: [{
				surface: inspected.target.surface,
				identity: inspected.target.identity,
				beforeDigest,
				afterDigest
			}]
		};
	}
	if (afterDigest === inspected.desiredDigest) return {
		status: "already-applied",
		targets: [targetState(inspected.target, afterDigest)]
	};
	if (afterDigest === inspected.expectedDigest) throw new Error("knowledge activation did not attempt its authorized content transition");
	return {
		status: "conflict",
		targets: [targetState(inspected.target, afterDigest)]
	};
}
function targetState(target, currentDigest) {
	return {
		surface: target.surface,
		identity: target.identity,
		currentDigest
	};
}
function prefixedDigest(hash) {
	return sha256DigestSchema.parse(`sha256:${hash}`);
}
function completionTime(transition, now) {
	const completedAt = (now ?? (() => /* @__PURE__ */ new Date()))().toISOString();
	return Date.parse(completedAt) < Date.parse(transition.attemptedAt) ? transition.attemptedAt : completedAt;
}
//#endregion
//#region src/knowledge/supervised-update.ts
/** Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. */
const RESEARCH_SUPERVISOR_SYSTEM_PROMPT = [
	"You are a research supervisor. You do not answer the research question yourself.",
	"You create and manage researcher workers that improve one shared knowledge base until it is ready.",
	"",
	"Each round:",
	"1. Read the goal and the gaps the readiness check still reports.",
	"2. Decompose the open work into independent sub-topics.",
	"3. Spawn one researcher per sub-topic; split by sub-topic, never duplicate work.",
	"4. Wait for researchers to settle, steer or re-spawn thin sub-topics, then stop when the check passes.",
	"",
	"Conserve the shared budget. Prefer a small number of well-scoped researchers over a large fanout that re-covers the same ground."
].join("\n");
/** Build the completion check a supervised KB update uses to stop only when the KB is ready. */
function knowledgeReadinessDeliverable(options) {
	return {
		describe: `knowledge base at ${options.root} is ready for: ${options.goal}`,
		async check() {
			const result = await options.readiness({
				root: options.root,
				goal: options.goal,
				readinessSpecs: options.readinessSpecs,
				readinessTaskId: options.readinessTaskId,
				readiness: options.readinessOptions
			});
			return typeof result === "boolean" ? result : result.ready;
		}
	};
}
/** Create an `improveKnowledgeBase` update callback backed by runtime supervision. */
function createSupervisedKnowledgeUpdater(options) {
	return (input) => runSupervisedKnowledgeUpdate({
		...options,
		root: input.candidateRoot ?? input.root ?? options.root,
		goal: input.goal ?? options.goal,
		findings: input.findings ?? options.findings,
		metadata: {
			...options.metadata,
			...input.metadata
		}
	});
}
/** Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. */
async function runSupervisedKnowledgeUpdate(options) {
	const exactSupervisor = agentProfileSchema.parse(options.supervisorProfile);
	assertExecutableAgentProfile(exactSupervisor, "runSupervisedKnowledgeUpdate");
	const supervised = await (options.runSupervised ?? supervise)(exactSupervisor, formatSupervisedKnowledgeTask(options), {
		...options.superviseOptions,
		budget: options.budget,
		backend: options.backend,
		deliverable: knowledgeReadinessDeliverable(options),
		makeWorkerAgent: options.makeWorkerAgent,
		allowedModels: options.allowedModels
	});
	return {
		applied: supervised.kind === "winner",
		summary: supervised.kind === "winner" ? "research supervisor completed and the knowledge base passed readiness" : `research supervisor stopped without a ready knowledge base: ${supervised.reason}`,
		supervised,
		metadata: {
			supervised: true,
			root: options.root,
			goal: options.goal,
			result: supervised.kind
		}
	};
}
/** Format the supervisor task with the KB root, readiness requirements, current findings, and metadata. */
function formatSupervisedKnowledgeTask(options) {
	return `${[
		`Goal: ${options.goal}`,
		`Knowledge base root: ${options.root}`,
		options.readinessTaskId ? `Readiness task id: ${options.readinessTaskId}` : void 0,
		options.readinessSpecs?.length ? `Readiness specs:\n${JSON.stringify(options.readinessSpecs, null, 2)}` : void 0,
		options.findings?.length ? `Current findings:\n${JSON.stringify(options.findings, null, 2)}` : void 0,
		options.metadata && Object.keys(options.metadata).length > 0 ? `Metadata:\n${JSON.stringify(options.metadata, null, 2)}` : void 0
	].filter((section) => Boolean(section)).join("\n\n")}\n\nUpdate files under the knowledge base root only. Stop when the readiness check passes.`;
}
//#endregion
//#region src/knowledge/improvement-job.ts
/** Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring. */
function createAgentKnowledgeReadinessCheck(options) {
	return async (input) => {
		const readiness = await evaluateKnowledgeBaseReadiness({
			root: input.root,
			goal: input.goal ?? options.goal,
			readinessSpecs: input.readinessSpecs ?? options.readinessSpecs,
			readinessTaskId: input.readinessTaskId ?? options.readinessTaskId,
			readiness: input.readiness ?? options.readiness,
			strict: options.strict,
			kbQuality: options.kbQuality
		});
		return {
			ready: readiness.ready,
			summary: readiness.summary,
			metadata: {
				dimensions: readiness.dimensions,
				validationOk: readiness.validation.ok,
				kbQualityOk: readiness.kbQuality.ok,
				blockingMissing: readiness.readiness?.report.blockingMissingRequirements.length ?? 0
			}
		};
	};
}
/** Produce a frozen KB candidate while leaving live knowledge content unchanged. */
async function runKnowledgeImprovementJob(options) {
	const { allowedModels, backend, budget, candidateArtifacts, makeWorkerAgent, onMeasurement, readinessCheck, runSupervised, supervisorProfile, superviseOptions, ...knowledgeOptions } = options;
	const startedAtMs = Date.now();
	const startedAt = new Date(startedAtMs).toISOString();
	const supervisedSpent = emptySpent();
	let updateCalls = 0;
	let updateDurationMs = 0;
	const readiness = readinessCheck ?? createAgentKnowledgeReadinessCheck(options);
	const updateKnowledge = createSupervisedKnowledgeUpdater({
		root: options.root,
		goal: options.goal,
		readiness,
		readinessSpecs: options.readinessSpecs,
		readinessTaskId: options.readinessTaskId,
		readinessOptions: options.readiness,
		budget,
		backend,
		makeWorkerAgent,
		supervisorProfile,
		superviseOptions,
		allowedModels,
		runSupervised
	});
	const instrumentedUpdateKnowledge = async (input) => {
		const updateStartedAt = Date.now();
		updateCalls += 1;
		const result = await updateKnowledge(input);
		updateDurationMs += Date.now() - updateStartedAt;
		addSpent(supervisedSpent, result.supervised);
		return result;
	};
	const resolvedImprovement = await improveKnowledgeBase({
		...knowledgeOptions,
		updateKnowledge: instrumentedUpdateKnowledge
	});
	let knowledge;
	if (resolvedImprovement.candidate?.status === "candidate-ready" || resolvedImprovement.candidate?.status === "promoted") knowledge = await freezeKnowledgeCandidatePair(options.root, resolvedImprovement, candidateArtifacts, knowledgeOptions.signal);
	const finishedAtMs = Date.now();
	const measurement = {
		startedAt,
		finishedAt: new Date(finishedAtMs).toISOString(),
		durationMs: finishedAtMs - startedAtMs,
		updateCalls,
		updateDurationMs,
		supervisedSpent
	};
	await onMeasurement?.(measurement);
	return {
		improvement: resolvedImprovement,
		...knowledge ? { knowledge } : {},
		measurement,
		blocked: resolvedImprovement.blocked
	};
}
/** Attach both frozen knowledge inputs to one otherwise-identical bundle pair. */
function buildKnowledgeImprovementExperimentBundles(bundle, knowledge) {
	const input = omitTopLevelDigest(bundle);
	const withSnapshot = (snapshot) => agentCandidateKnowledgeSchema.parse({
		candidate: knowledge.reference,
		...knowledge.stateScope ? { stateScope: knowledge.stateScope } : {},
		snapshot,
		evaluation: knowledge.evaluation
	});
	return Object.freeze({
		baseline: sealAgentCandidateBundle({
			...input,
			knowledge: withSnapshot(knowledge.baseline)
		}),
		candidate: sealAgentCandidateBundle({
			...input,
			knowledge: withSnapshot(knowledge.candidate)
		})
	});
}
async function freezeKnowledgeCandidatePair(root, improvement, artifacts, signal) {
	const candidate = knowledgeImprovementCandidateRef(improvement);
	const candidateRef = toAgentCandidateKnowledgeRef(candidate);
	return withKnowledgeImprovementComparison({
		root,
		candidate
	}, async (comparison) => {
		const freeze = async (target) => {
			const executionId = `knowledge-${candidate.candidateId}-${target}`;
			return (await captureAgentCandidateWorkspace(await realpath(comparison[target].root), { ...artifacts ? { artifactPersistence: {
				executionId,
				outputArtifacts: artifacts,
				...signal ? { signal } : {}
			} } : {} })).snapshot;
		};
		const evaluation = await captureKnowledgeEvidence(canonicalCandidateBytes$1({
			kind: "agent-knowledge-candidate-evaluation",
			candidate: candidateRef,
			metric: comparison.evaluation
		}), "knowledge-evaluation", `knowledge-${candidate.candidateId}`, artifacts, signal);
		const normalizedScope = normalizeKnowledgeStateScope(comparison.stateScope);
		const defaultScope = normalizeKnowledgeStateScope();
		const stateScope = normalizedScope.pagesDirectory === defaultScope.pagesDirectory && normalizedScope.researchState === defaultScope.researchState ? void 0 : Object.freeze(normalizedScope);
		const baseline = await freeze("baseline");
		const proposed = await freeze("candidate");
		return Object.freeze({
			reference: candidateRef,
			...stateScope ? { stateScope } : {},
			evaluation,
			baseline,
			candidate: proposed
		});
	});
}
async function captureKnowledgeEvidence(bytes, purpose, executionId, artifacts, signal) {
	if (!artifacts) return embeddedCandidateArtifact(bytes);
	return persistCandidateOutputArtifact(artifacts, {
		executionId,
		purpose,
		bytes,
		...signal ? { signal } : {}
	});
}
/** The starting accumulator, before any supervised run has been folded in. Zero iterations means
*  nothing ran, so a zero dollar total IS the measured amount; `addSpent` lowers `usdKnown` as
*  soon as it folds a run whose own dollars were not proven. */
function emptySpent() {
	return {
		iterations: 0,
		inputTokens: 0,
		outputTokens: 0,
		usdKnown: true,
		usd: 0,
		ms: 0
	};
}
function addSpent(target, result) {
	const spent = result.spentTotal;
	target.iterations += spent.iterations;
	target.inputTokens += spent.tokens.input;
	target.outputTokens += spent.tokens.output;
	target.usdKnown = target.usdKnown && spent.usdKnown !== false;
	target.usd += spent.usd;
	target.ms += spent.ms;
}
//#endregion
//#region src/model-resolution.ts
/** Default Tangle Router base URL used when no env override is set. */
const DEFAULT_ROUTER_BASE_URL = "https://router.tangle.tools";
/** Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. */
function resolveRouterBaseUrl(env = {}) {
	return (env.TANGLE_ROUTER_URL ?? env.TANGLE_ROUTER_BASE_URL ?? "https://router.tangle.tools").replace(/\/v1\/?$/, "").replace(/\/$/, "");
}
/**
* Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx
* response — callers decide whether to fail open (empty catalog) or closed.
*/
async function getModels(routerBaseUrl = DEFAULT_ROUTER_BASE_URL) {
	const res = await fetch(`${routerBaseUrl}/v1/models`, { headers: { Accept: "application/json" } });
	if (!res.ok) throw new Error(`router /v1/models ${res.status}`);
	const body = await res.json();
	return Array.isArray(body.data) ? body.data : [];
}
/** Trim a candidate model id; `undefined` for non-strings and blanks. */
function cleanModelId(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
/**
* Resolve a chat model by precedence: the first candidate carrying a
* non-blank model wins, else `fallback`. The caller owns the precedence
* order, so each product keeps its own policy (request → workspace → env,
* etc.) while the first-non-blank logic and the telemetry shape stay shared.
*/
function resolveChatModel(candidates, fallback) {
	for (const candidate of candidates) {
		const model = cleanModelId(candidate.model);
		if (model) return {
			source: candidate.source,
			model
		};
	}
	return fallback;
}
const WELL_FORMED_MODEL_ID = /^[A-Za-z0-9._/@:-]+$/;
function isWellFormedModelId(modelId) {
	return modelId.length <= 200 && WELL_FORMED_MODEL_ID.test(modelId);
}
/**
* Every id a catalog entry can be addressed by — its bare id, plus a
* `provider/id` form when the router exposes a separate provider slug.
*/
function catalogIdsForModel(model) {
	const ids = /* @__PURE__ */ new Set();
	const id = cleanModelId(model.id);
	if (id) ids.add(id);
	const provider = cleanModelId(model._provider) ?? cleanModelId(model.provider);
	if (provider && id && !id.includes("/")) ids.add(`${provider}/${id}`);
	return [...ids];
}
/**
* Validate a caller-supplied chat-model id. Rejects non-strings, malformed
* ids, and ids absent from both the caller's `allowlist` and the live router
* catalog. Fails closed: when the catalog cannot be fetched, an unverifiable
* id is rejected rather than admitted — a bad model never reaches the agent.
*/
async function validateChatModelId(modelId, options = {}) {
	const { allowlist = [], routerBaseUrl = DEFAULT_ROUTER_BASE_URL, loadModels = getModels } = options;
	const cleaned = cleanModelId(modelId);
	if (!cleaned) return {
		succeeded: false,
		error: "Model id must be a non-empty string."
	};
	if (!isWellFormedModelId(cleaned)) return {
		succeeded: false,
		error: `Model id is malformed: ${cleaned}`
	};
	if (allowlist.some((id) => cleanModelId(id) === cleaned)) return {
		succeeded: true,
		value: cleaned
	};
	let catalog;
	try {
		catalog = await loadModels(routerBaseUrl);
	} catch (err) {
		return {
			succeeded: false,
			error: `Could not validate model catalog: ${err instanceof Error ? err.message : String(err)}`
		};
	}
	if (!new Set(catalog.flatMap(catalogIdsForModel)).has(cleaned)) return {
		succeeded: false,
		error: `Model is not available: ${cleaned}`
	};
	return {
		succeeded: true,
		value: cleaned
	};
}
//#endregion
//#region src/readiness.ts
const DEFAULT_MINIMUM_READINESS_SCORE = .7;
/**
* Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on.
*
* @stable
*/
function decideKnowledgeReadiness(report, options = {}) {
	const minimumScore = options.minimumScore ?? DEFAULT_MINIMUM_READINESS_SCORE;
	if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) throw new ValidationError(`minimumScore must be a finite number in [0, 1]; received ${String(minimumScore)}`);
	const blockingGapIds = report.blockingMissingRequirements.map((requirement) => requirement.id);
	const nonBlockingGapIds = report.nonBlockingGaps.map((requirement) => requirement.id);
	if (blockingGapIds.length > 0) return {
		passed: false,
		status: "blocked",
		reason: report.reason,
		readinessScore: report.readinessScore,
		recommendedAction: report.recommendedAction,
		severity: report.severity,
		blockingGapIds,
		nonBlockingGapIds
	};
	if (report.readinessScore < minimumScore) return {
		passed: false,
		status: "caveat",
		reason: `Knowledge readiness score ${report.readinessScore.toFixed(3)} is below minimum ${minimumScore.toFixed(3)}.`,
		readinessScore: report.readinessScore,
		recommendedAction: report.recommendedAction,
		severity: report.severity,
		blockingGapIds,
		nonBlockingGapIds
	};
	return {
		passed: true,
		status: "ready",
		reason: report.reason,
		readinessScore: report.readinessScore,
		recommendedAction: report.recommendedAction,
		severity: report.severity,
		blockingGapIds,
		nonBlockingGapIds
	};
}
//#endregion
//#region src/run.ts
/**
*
* The two top-level entry points:
*
*  - `runAgentTask` — single-shot lifecycle for adapter-driven tasks.
*  - `runAgentTaskStream` — streaming lifecycle that delegates execution to an
*    `AgentExecutionBackend` (model API, sandbox, or custom iterable).
*
* Both gate the run on `KnowledgeReadinessReport` from `agent-eval`, emit the
* same lifecycle event vocabulary (under different shapes — see `types.ts`),
* and route session lifecycle through a pluggable `RuntimeSessionStore`.
*
* @stable
*/
const FAILURE_CLASS_SET = new Set(FAILURE_CLASSES);
/** True when a free-form control failure string is a canonical taxonomy
*  class — so only real taxonomy tags are promoted to the cross-agent
*  `RunRecord.failureClass` key; novel strings stay as `failureMode` detail. */
function asFailureClass(value) {
	return value && FAILURE_CLASS_SET.has(value) ? value : void 0;
}
/** Stamp cross-cutting defaults onto adapter-projected RunRecords without
*  overriding anything the adapter set explicitly:
*   - `scenarioId` — the run's scenario, when the record omits one.
*   - `failureClass` — the control layer's failure classification promoted
*     onto the canonical cross-agent key, but ONLY when it's a real taxonomy
*     class. This is what lets the substrate aggregate failures across every
*     agent in one vocabulary instead of per-agent ad-hoc strings. */
function applyRunRecordDefaults(records, scenarioId, controlFailureClass) {
	const fc = asFailureClass(controlFailureClass);
	return records.map((record) => {
		let r = record;
		if (r.scenarioId === void 0) r = {
			...r,
			scenarioId
		};
		if (r.failureClass === void 0 && fc) r = {
			...r,
			failureClass: fc
		};
		return r;
	});
}
/**
* Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable.
*
* @stable
*/
async function runAgentTask(options) {
	const task = options.task;
	await emit(options.onEvent, {
		type: "task_start",
		task
	});
	await emit(options.onEvent, {
		type: "readiness_start",
		task
	});
	let knowledge = await buildReadiness(task, options.knowledge);
	await emit(options.onEvent, {
		type: "readiness_end",
		task,
		knowledge
	});
	const questions = userQuestionsForKnowledgeGaps(knowledge.blockingMissingRequirements);
	const acquisitionPlans = acquisitionPlansForKnowledgeGaps([...knowledge.blockingMissingRequirements, ...knowledge.nonBlockingGaps]);
	const preflight = await runKnowledgePreflight(task, questions, acquisitionPlans, options.knowledge, options.onEvent);
	if (options.knowledge?.refreshReadiness && (Object.keys(preflight.userAnswers).length > 0 || preflight.acquiredEvidenceIds.length > 0)) {
		await emit(options.onEvent, {
			type: "readiness_start",
			task
		});
		knowledge = await options.knowledge.refreshReadiness({
			task,
			previous: knowledge,
			userAnswers: preflight.userAnswers,
			acquiredEvidenceIds: preflight.acquiredEvidenceIds
		});
		await emit(options.onEvent, {
			type: "readiness_end",
			task,
			knowledge
		});
	}
	await emit(options.onEvent, {
		type: "control_start",
		task,
		knowledge
	});
	const scenarioId = options.scenarioId ?? task.id;
	const control = await runAgentControlLoop({
		intent: task.intent,
		budget: task.budget,
		signal: options.signal,
		store: options.store,
		scenarioId,
		projectId: options.projectId,
		variantId: options.variantId,
		observe: ({ history, abortSignal }) => options.adapter.observe({
			task,
			knowledge,
			history,
			abortSignal
		}),
		validate: async ({ state, history, abortSignal }) => {
			return [blockingKnowledgeEval(knowledge, { minimumScore: options.minimumReadinessScore }), ...await options.adapter.validate({
				task,
				knowledge,
				state,
				history,
				abortSignal
			})];
		},
		decide: (ctx) => {
			if (isKnowledgeBlocked(ctx.evals)) return options.adapter.onKnowledgeBlocked?.({
				task,
				knowledge,
				questions,
				acquisitionPlans
			}) ?? {
				type: "stop",
				pass: false,
				score: knowledge.readinessScore,
				reason: `knowledge readiness blocked: ${knowledge.reason}`
			};
			return options.adapter.decide(toAgentContext(task, knowledge, ctx));
		},
		act: (action, ctx) => options.adapter.act(action, toAgentContext(task, knowledge, ctx)),
		shouldStop: options.adapter.shouldStop ? (ctx) => options.adapter.shouldStop(toAgentContext(task, knowledge, ctx)) : void 0,
		getActionCostUsd: options.adapter.getActionCostUsd ? ({ action, result, state, evals, history }) => options.adapter.getActionCostUsd({
			action,
			result,
			task,
			state,
			evals,
			history
		}) : void 0,
		onStep: (step) => emit(options.onEvent, {
			type: "control_step",
			task,
			step
		})
	});
	await emit(options.onEvent, {
		type: "control_end",
		task,
		control
	});
	const status = statusFromControl(control);
	await emit(options.onEvent, {
		type: "task_end",
		task,
		status,
		reason: control.reason
	});
	return {
		task,
		status,
		knowledge,
		questions,
		acquisitionPlans,
		userAnswers: preflight.userAnswers,
		acquiredEvidenceIds: preflight.acquiredEvidenceIds,
		control,
		runRecords: applyRunRecordDefaults(options.adapter.projectRunRecords?.(control, task) ?? [], scenarioId, control.failureClass)
	};
}
/**
* Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen.
*
* @stable
*/
async function* runAgentTaskStream(options) {
	const task = options.task;
	const input = {
		task,
		...options.input ?? {}
	};
	yield streamEvent({
		type: "task_start",
		task
	});
	yield streamEvent({
		type: "readiness_start",
		task
	});
	let knowledge = await buildReadiness(task, options.knowledge);
	const preflight = await runKnowledgePreflightStream(task, userQuestionsForKnowledgeGaps(knowledge.blockingMissingRequirements), acquisitionPlansForKnowledgeGaps([...knowledge.blockingMissingRequirements, ...knowledge.nonBlockingGaps]), options.knowledge);
	for (const event of preflight.events) yield event;
	if (options.knowledge?.refreshReadiness && (Object.keys(preflight.userAnswers).length > 0 || preflight.acquiredEvidenceIds.length > 0)) {
		yield streamEvent({
			type: "readiness_start",
			task
		});
		knowledge = await options.knowledge.refreshReadiness({
			task,
			previous: knowledge,
			userAnswers: preflight.userAnswers,
			acquiredEvidenceIds: preflight.acquiredEvidenceIds
		});
	}
	const decision = decideKnowledgeReadiness(knowledge, { minimumScore: options.minimumReadinessScore });
	yield streamEvent({
		type: "readiness_end",
		task,
		knowledge,
		decision
	});
	if (!decision.passed && decision.status === "blocked") {
		const reason = `knowledge readiness blocked: ${decision.reason}`;
		yield streamEvent({
			type: "task_end",
			task,
			status: "blocked",
			reason
		});
		yield streamEvent({
			type: "final",
			task,
			status: "blocked",
			reason
		});
		return;
	}
	const store = options.sessionStore;
	const opened = await startOrResumeRuntimeSession({
		backend: options.backend,
		input,
		context: {
			task,
			knowledge,
			signal: options.signal
		},
		store,
		sessionId: options.sessionId,
		resume: options.resume
	});
	let session = opened.session;
	const shouldResume = opened.resumed;
	const sessionEvent = streamEvent({
		type: shouldResume ? "session_resumed" : "session_created",
		task,
		session
	});
	await store?.appendEvent?.(session.id, sessionEvent);
	yield sessionEvent;
	const backendStart = streamEvent({
		type: "backend_start",
		task,
		session,
		backend: options.backend.kind
	});
	await store?.appendEvent?.(session.id, backendStart);
	yield backendStart;
	let finalText = "";
	try {
		for await (const rawEvent of options.backend.stream(opened.input, {
			task,
			knowledge,
			session,
			signal: options.signal
		})) {
			const event = normalizeBackendStreamEvent(rawEvent, task, session);
			if (event.type === "text_delta") finalText += event.text;
			await store?.appendEvent?.(session.id, event);
			yield event;
		}
		const completedStatus = "completed";
		session = touchSession({
			...session,
			status: completedStatus
		});
		await store?.put(session);
		const backendEnd = streamEvent({
			type: "backend_end",
			task,
			session,
			backend: options.backend.kind
		});
		await store?.appendEvent?.(session.id, backendEnd);
		yield backendEnd;
		const reason = "backend completed";
		const taskEnd = streamEvent({
			type: "task_end",
			task,
			status: completedStatus,
			reason
		});
		await store?.appendEvent?.(session.id, taskEnd);
		yield taskEnd;
		const final = streamEvent({
			type: "final",
			task,
			session,
			status: completedStatus,
			reason,
			text: finalText || void 0
		});
		await store?.appendEvent?.(session.id, final);
		yield final;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		session = touchSession({
			...session,
			status: options.signal?.aborted ? "aborted" : "failed"
		});
		await store?.put(session);
		let stopErrorMessage;
		try {
			await options.backend.stop?.(session, message);
		} catch (stopErr) {
			stopErrorMessage = stopErr instanceof Error ? stopErr.message : String(stopErr);
		}
		const combinedMessage = stopErrorMessage ? `${message}; backend stop failed: ${stopErrorMessage}` : message;
		const errorDetail = err instanceof BackendTransportError ? {
			kind: "transport",
			message: combinedMessage,
			status: err.status,
			body: err.body
		} : {
			kind: "backend",
			message: combinedMessage
		};
		const backendError = streamEvent({
			type: "backend_error",
			task,
			session,
			backend: options.backend.kind,
			message: combinedMessage,
			recoverable: !options.signal?.aborted,
			error: errorDetail
		});
		await store?.appendEvent?.(session.id, backendError);
		yield backendError;
		const status = options.signal?.aborted ? "aborted" : "failed";
		const taskEnd = streamEvent({
			type: "task_end",
			task,
			status,
			reason: message
		});
		await store?.appendEvent?.(session.id, taskEnd);
		yield taskEnd;
		const final = streamEvent({
			type: "final",
			task,
			session,
			status,
			reason: message,
			text: finalText || void 0,
			error: errorDetail
		});
		await store?.appendEvent?.(session.id, final);
		yield final;
	}
}
async function runKnowledgePreflight(task, questions, acquisitionPlans, provider, onEvent) {
	let userAnswers = {};
	let acquiredEvidenceIds = [];
	if (questions.length > 0 && provider?.answerQuestions) {
		await emit(onEvent, {
			type: "questions_start",
			task,
			questions
		});
		userAnswers = await provider.answerQuestions(questions, task);
		await emit(onEvent, {
			type: "questions_end",
			task,
			questions,
			userAnswers
		});
	}
	if (acquisitionPlans.length > 0 && provider?.executeAcquisitionPlans) {
		await emit(onEvent, {
			type: "acquisition_start",
			task,
			acquisitionPlans
		});
		acquiredEvidenceIds = await provider.executeAcquisitionPlans(acquisitionPlans, task);
		await emit(onEvent, {
			type: "acquisition_end",
			task,
			acquisitionPlans,
			acquiredEvidenceIds
		});
	}
	return {
		userAnswers,
		acquiredEvidenceIds
	};
}
async function runKnowledgePreflightStream(task, questions, acquisitionPlans, provider) {
	const events = [];
	let userAnswers = {};
	let acquiredEvidenceIds = [];
	if (questions.length > 0 && provider?.answerQuestions) {
		events.push(streamEvent({
			type: "questions_start",
			task,
			questions
		}));
		userAnswers = await provider.answerQuestions(questions, task);
		events.push(streamEvent({
			type: "questions_end",
			task,
			questions,
			userAnswers
		}));
	}
	if (acquisitionPlans.length > 0 && provider?.executeAcquisitionPlans) {
		events.push(streamEvent({
			type: "acquisition_start",
			task,
			acquisitionPlans
		}));
		acquiredEvidenceIds = await provider.executeAcquisitionPlans(acquisitionPlans, task);
		events.push(streamEvent({
			type: "acquisition_end",
			task,
			acquisitionPlans,
			acquiredEvidenceIds
		}));
	}
	return {
		userAnswers,
		acquiredEvidenceIds,
		events
	};
}
function streamEvent(event) {
	return {
		...event,
		timestamp: nowIso()
	};
}
function buildReadiness(task, provider) {
	if (provider?.buildReadiness) return provider.buildReadiness(task);
	return scoreKnowledgeReadiness({
		taskId: task.id,
		requirements: task.requiredKnowledge ?? [],
		metadata: {
			domain: task.domain,
			...task.metadata
		}
	});
}
function isKnowledgeBlocked(evals) {
	return evals.some((evalResult) => evalResult.id === "knowledge-ready" && !evalResult.passed);
}
function statusFromControl(control) {
	if (control.stoppedBy === "abort") return "aborted";
	if (control.reason.includes("knowledge readiness blocked")) return "blocked";
	if (control.pass) return "completed";
	return "failed";
}
async function emit(sink, event) {
	await sink?.(event);
}
function toAgentContext(task, knowledge, ctx) {
	return {
		task,
		knowledge,
		state: ctx.state,
		evals: ctx.evals,
		history: ctx.history,
		budget: ctx.budget,
		stepIndex: ctx.stepIndex,
		wallMs: ctx.wallMs,
		spentCostUsd: ctx.spentCostUsd,
		remainingCostUsd: ctx.remainingCostUsd,
		abortSignal: ctx.abortSignal
	};
}
//#endregion
//#region src/runtime-run.ts
/**
*
* Production-run lifecycle: record what the agent did on behalf of a customer,
* what it cost, and how it ended.
*
* Three concerns live in this module:
*
*  1. **Lifecycle state machine** — `running` -> `completed | failed | cancelled`,
*     enforced by `RuntimeRunStateError`. Completion is idempotent for the same
*     status (a second `complete()` call is a no-op so retries / cleanup paths
*     don't double-fire side effects). A different terminal status is a state
*     error.
*
*  2. **Cost ledger** — every `llm_call` event the handle observes contributes
*     `tokensIn`, `tokensOut`, `costUsd`, and bumps `llmCalls`. Wall time is
*     measured from `startRuntimeRun()` to `complete()`. Surface via
*     `handle.cost()` for cost-per-task dashboards.
*
*  3. **Persistence adapter** — `RuntimeRunPersistenceAdapter` is the seam
*     consumers plug in to write a `RuntimeRunRow` to their D1 / postgres /
*     KV store. The adapter receives a sanitized row shape; no telemetry
*     payload bytes flow through it unless the consumer opts in via
*     `RuntimeRunOptions.telemetryEvents`.
*
* @stable
*/
/**
*
* Construct a runtime-run handle. The returned handle is mutable across its
* lifetime; consumers should not share it across requests.
*
* @stable
*/
function startRuntimeRun(options) {
	if (!options.workspaceId) throw new ValidationError("startRuntimeRun: workspaceId is required");
	if (!options.taskSpec?.id) throw new ValidationError("startRuntimeRun: taskSpec.id is required");
	const now = options.now ?? Date.now;
	const startedAtMs = now();
	const startedAt = new Date(startedAtMs).toISOString();
	const id = options.id ?? `${options.taskSpec.id}:${randomSuffix()}`;
	let status = "running";
	let completedAtMs;
	let resultSummary;
	let error;
	let completionMetadata;
	const ledger = createRuntimeUsageTotals();
	const snapshotCost = () => ({
		...ledger,
		wallMs: (completedAtMs ?? now()) - startedAtMs
	});
	const buildRow = (extraMetadata) => ({
		id,
		workspaceId: options.workspaceId,
		sessionId: options.sessionId,
		agentId: options.agentId,
		domain: options.taskSpec.domain,
		taskId: options.taskSpec.id,
		scenarioId: options.scenarioId,
		status,
		resultSummary,
		error,
		cost: snapshotCost(),
		startedAt,
		completedAt: completedAtMs !== void 0 ? new Date(completedAtMs).toISOString() : void 0,
		metadata: mergeMetadata(completionMetadata, extraMetadata)
	});
	return {
		id,
		workspaceId: options.workspaceId,
		sessionId: options.sessionId,
		taskSpec: options.taskSpec,
		get status() {
			return status;
		},
		observe(event) {
			if (event.type !== "llm_call") return;
			addRuntimeUsage(ledger, event);
		},
		cost: snapshotCost,
		complete(input) {
			if (input.status === "running") throw new ValidationError("complete() requires a terminal status, got \"running\"");
			if (status !== "running") {
				if (status === input.status) return;
				throw new RuntimeRunStateError(`Cannot transition runtime run from "${status}" to "${input.status}"`);
			}
			status = input.status;
			completedAtMs = now();
			resultSummary = input.resultSummary;
			error = input.error;
			completionMetadata = input.metadata;
			if (input.cost) {
				for (const key of [
					"tokensIn",
					"tokensOut",
					"costUsd",
					"llmCalls",
					"estimatedCostUsd"
				]) {
					const value = input.cost[key];
					if (isUsageAmount(value)) ledger[key] = value;
				}
				if (input.cost.tokensKnown === false) ledger.tokensKnown = false;
				if (input.cost.usdKnown === false) ledger.usdKnown = false;
			}
		},
		toRow(metadata) {
			return buildRow(metadata);
		},
		async persist(metadata) {
			if (status === "running") throw new RuntimeRunStateError("Cannot persist a runtime run before complete() is called");
			if (!options.adapter) return;
			await options.adapter.upsert(buildRow(metadata));
		}
	};
}
function mergeMetadata(base, extra) {
	if (!base && !extra) return void 0;
	return {
		...base ?? {},
		...extra ?? {}
	};
}
function randomSuffix() {
	return Math.random().toString(36).slice(2, 10);
}
//#endregion
//#region src/sse.ts
/** @stable */
function encodeServerSentEvent(data, options = {}) {
	const lines = [];
	if (options.id) lines.push(`id: ${stripNewlines(options.id)}`);
	if (options.event) lines.push(`event: ${stripNewlines(options.event)}`);
	if (typeof options.retry === "number" && Number.isFinite(options.retry) && options.retry >= 0) lines.push(`retry: ${Math.floor(options.retry)}`);
	const payload = typeof data === "string" ? data : JSON.stringify(data);
	for (const line of payload.split(/\r?\n/)) lines.push(`data: ${line}`);
	return `${lines.join("\n")}\n\n`;
}
/** Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string. @stable */
function readinessServerSentEvent(report, options = {}) {
	const { event, id, retry, ...telemetryOptions } = options;
	return encodeServerSentEvent({
		type: "readiness",
		readiness: sanitizeKnowledgeReadinessReport(report, telemetryOptions)
	}, {
		event,
		id,
		retry
	});
}
/** Serialize a `RuntimeStreamEvent` as a Server-Sent Event string. @stable */
function runtimeStreamServerSentEvent(event, options = {}) {
	const { event: sseEvent, id, retry, ...telemetryOptions } = options;
	return encodeServerSentEvent(sanitizeRuntimeStreamEvent(event, telemetryOptions), {
		event: sseEvent,
		id,
		retry
	});
}
function stripNewlines(value) {
	return value.replace(/[\r\n]/g, " ");
}
//#endregion
export { AgentEvalError, BackendTransportError, ConfigError, DEFAULT_ROUTER_BASE_URL, DELEGATED_LOOP_MODES, FileConversationJournal, InMemoryConversationJournal, InMemoryRuntimeSessionStore, JudgeError, NotFoundError, OfficialOptimizerUnavailableError, PROMPT_INSTRUCTION_COMPONENT_PREFIX, PlannerError, RESEARCH_SUPERVISOR_SYSTEM_PROMPT, ROLLOUT_POLICY_EXTENSION, RetainedInteractiveAdmissionError, RetainedInteractiveBindingError, RetainedRunAdmissionError, RetainedRunDispatchBindingError, RuntimeRunStateError, SqlConversationJournal, ValidationError, agenticGenerator, applyRolloutPolicyToProfile, applyRunRecordDefaults, auditLoopRunner, buildKnowledgeImprovementExperimentBundles, buildLoopOtelSpans, buildLoopSpanNodes, buildRuntimeEventOtelSpans, cleanModelId, commandVerifier, composeRuntimeHooks, createAgentKnowledgeReadinessCheck, createCommandProfileTrainer, createConversationBackend, createIterableBackend, createKnowledgeImprovementActivationExecutor, createOpenInferenceFileExporter, createOtelExporter, createProfileExecutionBackend, createProfileImprovementHarness, createRuntimeEventCollector, createRuntimeStreamEventCollector, createSandboxPromptBackend, createSupervisedKnowledgeUpdater, d1ToSqlAdapter, decideKnowledgeReadiness, defaultBuildPrompt, defineConversation, defineRuntimeHooks, findingLines, formatSupervisedKnowledgeTask, generateSpanId, getModels, improve, isDelegatedLoopMode, knowledgeReadinessDeliverable, loopEventToOtelSpan, mcpBuildPrompt, mcpServeVerifier, mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset, normalizeRolloutPolicy, notifyRuntimeDecisionPoint, notifyRuntimeHookEvent, officialGepa, officialSkillOpt, optimizerMethod, padSpanId, padTraceId, parseLoopRunnerArgv, parseRolloutPolicy, promptInstructionsProfileComponents, rawTraceDistiller, readinessServerSentEvent, reflectiveGenerator, researchLoopRunner, resolveChatModel, resolveRouterBaseUrl, runAgentTask, runAgentTaskStream, runConversation, runConversationStream, runDelegatedLoop, runKnowledgeImprovementJob, runLoopRunnerCli, runPersonaConversation, runPersonaDispatch, runSupervisedKnowledgeUpdate, runtimeStreamServerSentEvent, sanitizeAgentRuntimeEvent, sanitizeKnowledgeReadinessReport, sanitizeRuntimeStreamEvent, searchMethod, serializeRolloutPolicy, startRuntimeRun, strategyAuthorMethod, structuralRolloutPolicyFromProfile, toOtelAttributes, toolBuildPrompt, validateChatModelId, worktreeLoopRunner };

//# sourceMappingURL=index.js.map