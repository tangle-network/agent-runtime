import { $ as bindScopeRetainedOwnerProvider, $i as detachedSnapshot, $t as parseWorkerToolTraceArtifact, A as driverExecutorFactory, Aa as resourceTelemetry, Ai as readCommittedJsonLines, An as bridgeAdmissionRefusal, Ar as readHarnessTranscript, At as createExecutor, B as recordScopeOwnerMaterialization, Bi as providerAttemptEvidence, Br as createOtelExporter, C as createContinuationKeeper, Cr as runAbortable, Da as withTimeout, Di as isNoEntError, Dt as captureReusableExecutorConfig, Ea as unmeteredSpend, Ei as worktreeCliProfileMaterialization, Et as bindReusableExecutorExecutionId, F as beginScopeOwnerAttempt, Fa as DEFAULT_SUCCESSFUL_SHUTDOWN_MS, Gi as runtimeOwnedExecutorProviderEvidence, H as restoreScopeOwnerAcceptedExecution, Hi as runtimeOwnedDriveHarnessProviderEvidence, Hr as generateSpanId, Ii as inheritRuntimeOwnedExecutorAttestation, In as bridgeRuntimeAttachmentsKey, It as createRouterTranscript, Jn as routerBrain, Ki as runtimeOwnedPendingExecutorMaterialization, Kr as toOtelAttributes, L as deriveNodeExecutionIdentity, La as teardownExecutor, Ln as bridgeStopSignalKey, Mt as snapshotExecutorConfig, Ni as attestRuntimeOwnedScopeOwner, Oa as zeroSpend, P as assertRecursiveReservationPolicy, Q as bindScopeRetainedOwnerEnvironmentId, R as meterRuntimeOwnedAccounting, Ra as teardownSurfaces, Sa as sleep, Si as renderUnsupported, Sr as linkAbort, U as scopeOwnerExecutorNodeContext, Ui as runtimeOwnedExecutorExecutionBinding, V as recordScopeOwnerPause, Vi as recordRuntimeOwnedDriveHarnessProviderEvidence, Wi as runtimeOwnedExecutorMaterialization, _ as CheckUnavailableError, _i as promptControlProfileMaterialization, an as meterUsageEvent, at as scopeRetainedOwnerPriorSpend, b as bestComposite, br as RunCancellationReason, c as runTree, cn as spendFromUsageTotals, ct as scopeRetainedOwnerResult, dr as retainedExecutorSeamKey, et as consumeScopeRetainedOwnerResult, f as runDriverWithRetry, fi as assertProfileMaterialization, fr as errMessage, gi as profileMaterializationAxes$1, h as CONTINUATIONS_DIR, hi as fullProfileMaterialization, i as bestDelivered, it as scopeRetainedOwnerContext, j as isDriverSpec, ja as withBudgetResources, jn as bridgeModelRouteRefusal, jr as contentAddress, k as driverChild, ka as addResourceSpend, ki as prepareJsonlAppend, kn as executorFailure, kr as persistHarnessTranscript, ln as WORKER_TRACE_PROPAGATION, ma as addSpend, mi as defineProfileMaterializationContract, n as createRootHandle, nt as prepareScopeRetainedOwnerTask, on as newUsageTotals, ot as scopeRetainedOwnerResourceReader, p as summarizeDriverAttempts, pi as controlProfileMaterialization, qi as runtimeOwnedScopeOwnerRuntime, r as createSupervisor, rn as assertValidBudget, rr as resolveAgentEnvironmentProvider, rt as reconcileScopeRetainedOwnerEnvironment, s as runFinalizer, st as scopeRetainedOwnerRestorePoint, tt as noteScopeRetainedOwnerCoordination, u as HarnessTurnFailedError, ur as registerRetainedExecutorPreparation, v as admitContinuationPolicy, vi as promptModelProfileMaterialization, vn as createInbox, wi as unsupportedProfileDimensions, x as checkVerdictOf, z as meterRuntimeOwnedProviderAttempt } from "./supervisor-DtlPj9me.js";
import { f as RuntimeRunStateError, i as ConfigError, m as ValidationError } from "./errors-DodWX-cb.js";
import { a as concreteProfileModel, c as profileModelExecutionSettings, d as agentHarness, f as harnessRunsAgent, n as assertModelAllowed, o as enforceTokenLimits, r as assertProfileModelsAllowed, s as profileBridgeWireModel, t as assertExecutableAgentProfile } from "./model-policy-BbSCSak0.js";
import { t as composeRuntimeHooks } from "./runtime-hooks-tXpAarhW.js";
import { n as assertNoSymlinkDescendant } from "./durable-file-DWQA4ooo.js";
import { C as applyRunCancellation, E as DEFAULT_AWAIT_EVENT_TIMEOUT_MS, b as withRunContext, c as createProgressTracker, d as progressStop, j as createCoordinationToolsForManager, k as coordinationVerbNames, n as createSteerAcknowledger, r as driverAgent, t as createCancelAcknowledger, u as plateau, v as createFileRunContext, w as watchRunCancellation, y as createInMemoryRunContext } from "./coordination-driver-BBL_OgRw.js";
import { r as createStdioToolServer, t as PROTOCOL_VERSION } from "./tool-server-Dqer2M4_.js";
import { k as writeRunCancellation, o as readRunCancelRequest, s as readRunCancellation } from "./run-layout-vwd4SwX_.js";
import { agentProfileSchema, canonicalAgentProfileDigest, canonicalCandidateDigest, canonicalCandidateJson, validateAgentProfileSecurity } from "@tangle-network/agent-interface";
import { toolSpansToTraceAnalysisStore } from "@tangle-network/agent-eval";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { isMaterializerHarness } from "@tangle-network/agent-profile-materialize";
import { ATTR } from "@tangle-network/agent-trace-contract";
import { createServer } from "node:http";
import { withProfileKb } from "@tangle-network/agent-interface/profile-kb";
//#region src/runtime/supervise/completion-gate.ts
/**
*
* The completion-oracle: **settled ⟺ DELIVERED.**
*
* Foreman's one hard lesson (0/18 self-improvement deliverables) — "done" must mean a check
* PASSED, not the agent's say-so. `gateOnDeliverable` wraps an `Executor` so its settlement
* is `valid` ONLY when the deliverable check passes. The child still RUNS and settles (its
* spend is conserved into the pool either way), but a child that ran WITHOUT delivering
* settles `valid:false` — so a keep-best driver never counts it as done, and a gate never
* inflates with self-judged wins.
*
* Dual-purpose by construction:
*  - product: the agent fleet only advances on real, checked deliverables.
*  - proof: the gate's `valid` is the honest settle — equal-k comparisons can't be gamed by an
*    arm that "ran" without producing the artifact.
*
* The check is a DEPLOYABLE oracle — a test command, a state verifier, the commit0 judge —
* read off the child's output, never the model judging itself. A throwing check is
* fail-closed (not delivered), never a crash.
*
* @experimental
*/
/**
* Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the
* inner verdict. Handles both `execute` shapes (one-shot `Promise<ExecutorResult>` and
* streaming `AsyncIterable<UsageEvent>` + `resultArtifact()`); the check runs once the inner
* executor has produced its output. The inner `score` is preserved; only `valid` is gated.
*/
function gateOnDeliverable(inner, deliverable) {
	let gated;
	const check = async (out, baseScore) => {
		let delivered;
		try {
			delivered = checkVerdictOf(await deliverable.check(out)).pass;
		} catch {
			delivered = false;
		}
		return {
			valid: delivered,
			score: baseScore ?? (delivered ? 1 : 0)
		};
	};
	/**
	* Ask the delivery question once, from whatever the inner executor managed to produce.
	*
	* Fail-closed on the artifact being unavailable: an executor that never produced one delivered
	* nothing, and leaving `gated` unset keeps the existing invalid-by-default reading.
	*/
	const settleVerdict = async () => {
		let art;
		try {
			art = inner.resultArtifact();
		} catch {
			return;
		}
		gated = await check(art.out, art.verdict?.score);
	};
	return inheritRuntimeOwnedExecutorAttestation(inner, {
		runtime: inner.runtime,
		...inner.budgetExempt !== void 0 ? { budgetExempt: inner.budgetExempt } : {},
		...inner.deliver ? { deliver: (m) => inner.deliver?.(m) } : {},
		...inner.progress ? { progress: () => inner.progress?.() } : {},
		...inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {},
		...inner.metered ? { metered: () => inner.metered?.() } : {},
		...inner.harnessTranscript ? { harnessTranscript: () => inner.harnessTranscript?.() } : {},
		execute(task, signal) {
			const r = inner.execute(task, signal);
			if (isAsyncIterable$2(r)) return (async function* () {
				try {
					for await (const ev of r) yield ev;
				} finally {
					await settleVerdict();
				}
			})();
			return (async () => {
				let res;
				try {
					res = await r;
				} catch (error) {
					await settleVerdict();
					throw error;
				}
				gated = await check(res.out, res.verdict?.score);
				return {
					...res,
					verdict: gated
				};
			})();
		},
		teardown: (grace) => inner.teardown(grace),
		...teardownSurfaces(inner),
		resultArtifact() {
			const art = inner.resultArtifact();
			return {
				...art,
				verdict: gated ?? art.verdict
			};
		}
	});
}
/**
* Transform a Runtime executor's terminal artifact without losing its private
* profile-materialization attestation or altering its measured spend. This is
* the composition point for deterministic post-processing and grading; callers
* must not rebuild an Executor around a model transport merely to change `out`.
*/
function mapExecutorResult(inner, map) {
	let mapped;
	const settle = async (result, task) => {
		const transformed = await map(result, task);
		mapped = {
			outRef: transformed.outRef,
			out: transformed.out,
			...transformed.verdict ? { verdict: transformed.verdict } : {},
			spent: result.spent
		};
		return mapped;
	};
	return inheritRuntimeOwnedExecutorAttestation(inner, {
		runtime: inner.runtime,
		...inner.budgetExempt !== void 0 ? { budgetExempt: inner.budgetExempt } : {},
		...inner.deliver ? { deliver: (message) => inner.deliver?.(message) } : {},
		...inner.progress ? { progress: () => inner.progress?.() } : {},
		...inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {},
		...inner.accounting ? { accounting: () => inner.accounting?.() } : {},
		...inner.metered ? { metered: () => inner.metered?.() } : {},
		...inner.harnessTranscript ? { harnessTranscript: () => inner.harnessTranscript?.() } : {},
		execute(task, signal) {
			const execution = inner.execute(task, signal);
			if (isAsyncIterable$2(execution)) return (async function* () {
				for await (const event of execution) yield event;
				await settle(inner.resultArtifact(), task);
			})();
			return (async () => settle(await execution, task))();
		},
		teardown: (grace) => inner.teardown(grace),
		...teardownSurfaces(inner),
		resultArtifact() {
			if (!mapped) throw new Error("mapExecutorResult: resultArtifact() read before execute()");
			return mapped;
		}
	});
}
function isAsyncIterable$2(v) {
	return v != null && typeof v[Symbol.asyncIterator] === "function";
}
//#endregion
//#region src/runtime/supervise/coordination-http.ts
function coordinationHttpLimits(options) {
	const positive = (name, value, fallback) => {
		const resolved = value ?? fallback;
		if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new ConfigError(`coordination ${name} must be a positive safe integer`);
		return resolved;
	};
	const origins = new Set(options.allowedOrigins ?? []);
	for (const origin of origins) {
		const parsed = new URL(origin);
		if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) throw new ConfigError("coordination allowedOrigins must contain canonical HTTP origins");
	}
	const requestTimeoutMs = positive("requestTimeoutMs", options.requestTimeoutMs, 3e4);
	if (requestTimeoutMs > 2147483647) throw new ConfigError("coordination requestTimeoutMs exceeds the timer limit");
	return {
		maxRequestBytes: positive("maxRequestBytes", options.maxRequestBytes, 1024 * 1024),
		requestTimeoutMs,
		maxConcurrentRequests: positive("maxConcurrentRequests", options.maxConcurrentRequests, 32),
		requestsPerMinute: positive("requestsPerMinute", options.requestsPerMinute, 600),
		origins
	};
}
/** One bounded HTTP adapter around the existing JSON-RPC handler; it owns no run commands. */
function coordinationHttpHandler(input) {
	const limits = coordinationHttpLimits(input.options);
	let active = 0;
	let controlActive = 0;
	let controlRequests = 0;
	let windowStart = Date.now();
	let requests = 0;
	const audit = async (outcome, status, action) => {
		await input.options.onAudit?.({
			...input.identity,
			outcome,
			status,
			...action ? { action } : {}
		});
	};
	return (req, res) => {
		let finished = false;
		let executing = false;
		let timedOut = false;
		let admitted = false;
		let controlAdmission = false;
		let action;
		let timer;
		const release = () => {
			if (admitted) {
				admitted = false;
				if (controlAdmission) controlActive--;
				else active--;
			}
			if (timer) clearTimeout(timer);
		};
		const respond = (status, value) => {
			if (finished) return;
			finished = true;
			if (timer) clearTimeout(timer);
			res.writeHead(status, {
				"content-type": "application/json",
				"cache-control": "no-store",
				...status === 405 ? { allow: "POST" } : {}
			});
			res.end(value === void 0 ? void 0 : JSON.stringify(value));
			if (!executing) release();
		};
		const reject = (status) => {
			respond(status);
			audit("rejected", status, action).catch(() => void 0);
			req.resume();
		};
		req.on("error", () => reject(400));
		req.on("aborted", () => {
			finished = true;
			if (!executing) release();
		});
		res.on("close", () => {
			finished = true;
			if (!executing) release();
		});
		if (req.method !== "POST") {
			reject(405);
			return;
		}
		const authorization = input.authorize(req);
		if (authorization !== void 0) {
			reject(authorization);
			return;
		}
		const origin = req.headers.origin;
		if (origin !== void 0 && !limits.origins.has(origin)) {
			reject(403);
			return;
		}
		if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
			reject(415);
			return;
		}
		const length = req.headers["content-length"];
		if (length !== void 0 && (!/^\d+$/.test(length) || Number(length) > limits.maxRequestBytes)) {
			reject(413);
			return;
		}
		const now = Date.now();
		if (now - windowStart >= 6e4) {
			windowStart = now;
			requests = 0;
			controlRequests = 0;
		}
		controlAdmission = active + input.backgroundActions() >= limits.maxConcurrentRequests || requests >= limits.requestsPerMinute;
		if (controlAdmission) {
			if (controlActive >= 2 || controlRequests >= 60) {
				reject(429);
				return;
			}
			controlActive++;
		} else {
			requests++;
			active++;
		}
		admitted = true;
		timer = setTimeout(() => {
			timedOut = true;
			reject(executing ? 504 : 408);
		}, limits.requestTimeoutMs);
		timer.unref();
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			if (finished) return;
			size += chunk.length;
			if (size > limits.maxRequestBytes) {
				reject(413);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (finished) return;
			let message;
			try {
				const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
				if (!value || typeof value !== "object" || Array.isArray(value) || !("jsonrpc" in value) || value.jsonrpc !== "2.0" || !("method" in value) || typeof value.method !== "string" || "id" in value && value.id !== null && typeof value.id !== "string" && (typeof value.id !== "number" || !Number.isFinite(value.id))) {
					reject(400);
					return;
				}
				message = value;
			} catch {
				reject(400);
				return;
			}
			const authorization = input.authorize(req);
			if (authorization !== void 0) {
				reject(authorization);
				return;
			}
			if (message.method === "tools/call" && message.params && typeof message.params === "object" && "name" in message.params && typeof message.params.name === "string" && input.toolNames.has(message.params.name)) action = message.params.name;
			if (controlAdmission) {
				if (!(message.method === "initialize" || message.method === "tools/list" || action === "stop" || action === "observe_agent" || action === "read_journal")) {
					reject(429);
					return;
				}
				controlRequests++;
			}
			executing = true;
			(async () => {
				try {
					await audit("accepted", 200, action);
					if (finished) return;
					const authorization = input.authorize(req);
					if (authorization !== void 0) {
						reject(authorization);
						return;
					}
					const response = await input.handle(message);
					if (!finished) respond(response === null ? 202 : 200, response ?? void 0);
					await audit(timedOut ? "completed-after-deadline" : "completed", timedOut ? 504 : response === null ? 202 : 200, action);
				} catch {
					respond(500);
				} finally {
					executing = false;
					release();
				}
			})();
		});
	};
}
//#endregion
//#region src/runtime/supervise/coordination-preflight.ts
const MAX_RESPONSE_BYTES = 1024 * 1024;
var CoordinationPreflightError = class extends ConfigError {
	constructor(reason) {
		super(`coordination public endpoint preflight failed: ${reason}`);
	}
};
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Check the operator's route before it becomes a provider attachment. This does not prove cloud egress. */
async function preflightPublicCoordination(input) {
	const deadline = new AbortController();
	const linked = linkAbort(input.signal, deadline.signal);
	const timer = setTimeout(() => deadline.abort(), Math.min(input.requestTimeoutMs, 1e4));
	timer.unref();
	const rpc = async (method, params) => {
		const response = await fetch(input.url, {
			method: "POST",
			headers: {
				...input.headers,
				"content-type": "application/json",
				accept: "application/json"
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: method,
				method,
				...params ? { params } : {}
			}),
			redirect: "manual",
			signal: linked.signal
		});
		if (response.status !== 200) {
			response.body?.cancel().catch(() => void 0);
			throw new CoordinationPreflightError(`HTTP ${response.status}`);
		}
		const reader = response.body?.getReader();
		if (!reader) throw new CoordinationPreflightError("invalid MCP response");
		let size = 0;
		const chunks = [];
		try {
			for (;;) {
				const part = await reader.read();
				if (part.done) break;
				size += part.value.byteLength;
				if (size > MAX_RESPONSE_BYTES) {
					reader.cancel().catch(() => void 0);
					throw new CoordinationPreflightError("response too large");
				}
				chunks.push(part.value);
			}
		} finally {
			reader.releaseLock();
		}
		let body;
		try {
			body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
		} catch {
			throw new CoordinationPreflightError("invalid MCP response");
		}
		if (!record$1(body) || body.jsonrpc !== "2.0" || body.id !== method || body.error || !record$1(body.result)) throw new CoordinationPreflightError("invalid MCP response");
		return body.result;
	};
	try {
		await runAbortable(async () => {
			const initialized = await rpc("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: {
					name: "agent-runtime-coordination-preflight",
					version: "1"
				}
			});
			if (initialized.protocolVersion !== "2024-11-05" || !record$1(initialized.serverInfo) || initialized.serverInfo.name !== "coordination" || !record$1(initialized.capabilities) || !record$1(initialized.capabilities.tools)) throw new CoordinationPreflightError("invalid MCP initialization");
			const listing = await rpc("tools/list");
			if (!Array.isArray(listing.tools) || listing.tools.some((tool) => !record$1(tool) || typeof tool.name !== "string")) throw new CoordinationPreflightError("invalid MCP tool list");
			const names = listing.tools.map((tool) => tool.name).sort();
			if (JSON.stringify(names) !== JSON.stringify([...input.toolNames].sort())) throw new CoordinationPreflightError("coordination tool grants differ");
		}, linked.signal, "coordination public endpoint preflight cancelled");
	} catch (error) {
		if (input.signal.aborted) throw new CoordinationPreflightError("cancelled");
		if (deadline.signal.aborted) throw new CoordinationPreflightError("timed out");
		if (error instanceof CoordinationPreflightError) throw error;
		throw new CoordinationPreflightError("transport unavailable");
	} finally {
		clearTimeout(timer);
		linked.release();
	}
}
//#endregion
//#region src/runtime/supervise/single-flight-tools.ts
/**
* Serve method-supplied supervisor tools on the coordination MCP as single-flight, fenced calls.
*
* A method tool can run for hours: a literature graph spawns and joins its own children inside one
* call. The coordination transport answers 504 at `requestTimeoutMs`, so an unwrapped long call
* reaches the caller as a hard tool error while its handler keeps running. A caller that retries
* starts a second full run. Run mech-interp-foundations-glm2-20260911d spawned the same enumerate
* and extract children twice this way.
*
* Two rules close that failure:
* - Identity. A call joins an existing invocation when its tool name and its RFC 8785 canonical
*   arguments match, and that invocation has not yet returned its outcome to a caller. The handler
*   is not invoked again. Key order does not matter: the observed retry reordered every key.
* - Fence. A call waits at most `fenceMs` for the outcome. If the handler is still running, the call
*   returns a non-error pending result. A later identical call keeps waiting, then returns the value
*   or throws the handler's error once the handler settles.
*
* An invocation's identity ends when a call returns its outcome. The next identical call is a fresh
* run, because equal arguments do not make a call a replay. Code mode's `execute` and Knowledge's
* `knowledge_search` read live state, so their callers repeat identical arguments to get a current
* answer. A handler that finishes within the fence therefore behaves exactly as it did unwrapped.
* No escape hatch is needed: the only calls this absorbs are ones whose caller could not have seen
* the outcome.
*/
function singleFlightTools(tools, options) {
	const { fenceMs } = options;
	if (!Number.isSafeInteger(fenceMs) || fenceMs <= 0) throw new ValidationError("singleFlightTools: fenceMs must be a positive safe integer");
	const now = options.now ?? Date.now;
	const invocations = /* @__PURE__ */ new Map();
	const start = (tool, raw) => {
		const invocation = {
			startedAt: now(),
			settled: (async () => tool.handler(raw))().then((value) => {
				invocation.outcome = {
					ok: true,
					value
				};
				return invocation.outcome;
			}, (error) => {
				invocation.outcome = {
					ok: false,
					error
				};
				return invocation.outcome;
			}),
			outcome: void 0,
			waiting: 0
		};
		return invocation;
	};
	const wrap = (tool) => Object.freeze({
		...tool,
		handler: async (raw) => {
			const key = invocationKey(tool.name, raw);
			let invocation = invocations.get(key);
			if (invocation === void 0) {
				invocation = start(tool, raw);
				invocations.set(key, invocation);
			}
			if (invocation.outcome === void 0) {
				invocation.waiting++;
				try {
					await withTimeout(invocation.settled, fenceMs);
				} finally {
					invocation.waiting--;
				}
			}
			const outcome = invocation.outcome;
			if (outcome === void 0) return pendingToolCall(tool.name, now() - invocation.startedAt);
			if (invocations.get(key) === invocation) invocations.delete(key);
			if (outcome.ok) return outcome.value;
			throw outcome.error;
		}
	});
	return {
		tools: Object.freeze(tools.map(wrap)),
		background() {
			let count = 0;
			for (const invocation of invocations.values()) if (invocation.outcome === void 0 && invocation.waiting === 0) count++;
			return count;
		}
	};
}
function invocationKey(name, raw) {
	try {
		return canonicalCandidateJson([name, raw]);
	} catch (error) {
		throw new ValidationError(`${name}: arguments must be finite JSON so a repeated call can join its earlier run`, { cause: error });
	}
}
function pendingToolCall(tool, elapsedMs) {
	return {
		pending: true,
		tool,
		elapsedMs,
		instruction: `${tool} is still running; nothing failed. Call ${tool} again with the same arguments to keep waiting. That call joins this run and returns its result, or its error, once it finishes. Different arguments start a separate run.`
	};
}
//#endregion
//#region src/runtime/supervise/coordination-mcp.ts
/**
*
* Serve the coordination verbs (spawn_worker / await_event / observe_agent / steer_agent / stop)
* as a real HTTP MCP server over a LIVE `Scope`. This is the keystone that lets a coding-harness
* agent (opencode via the cli-bridge, claude-code, codex) BE the supervisor: it mounts this MCP
* (`mcp.mcpServers.coordination`) and calls `spawn_worker` as a native tool, which lands on
* `Scope.spawn` — a real box driving real boxes, not emulated function-tools.
*
* Coordination vs DELEGATION (`../../mcp/delegates.ts`): coordination SPAWNS workers in a CHOSEN
* backend (`createExecutor({ backend })` — sandbox OR cli-bridge) and live-drives them — observe /
* steer / resume, recursive sub-drivers, one conserved budget. To instead delegate a coding task
* INSIDE the agent's OWN sandbox (a durable fire-and-poll job that survives an MCP restart), use the
* delegation MCP. Coordination is the live, cross-backend supervisor; delegation is own-sandbox async.
*
* Transport: JSON-RPC over HTTP POST (the MCP streamable-HTTP shape — `application/json` for a
* single response). The server is created INSIDE an agent's `act(task, scope)` so it fronts that
* agent's live scope; tear it down when the act returns.
*
* @experimental
*/
/** Hosts that reach only this machine, including the IPv4-mapped and bracketed IPv6 spellings a
*  caller may pass through from config. A name that is not recognizably loopback counts as REMOTE:
*  whether it resolves to a loopback interface is not knowable here, and the safe direction of that
*  doubt is "exposed". */
function isLoopbackHost(host) {
	const h = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
	if (h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || h === "::ffff:127.0.0.1") return true;
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}
function assertCoordinationTransport(options) {
	if (!isLoopbackHost(options.host ?? "127.0.0.1") && !options.authentication) throw new ConfigError("coordination non-loopback address requires authentication; allowUnauthenticatedRemote is no longer supported");
	if (options.authentication !== void 0 && options.authentication !== true && (typeof options.authentication !== "object" || options.authentication === null || Array.isArray(options.authentication))) throw new ConfigError("coordination authentication must be true or a credential lifetime configuration");
	const ttl = typeof options.authentication === "object" ? options.authentication.ttlMs : void 0;
	if (ttl !== void 0 && (!Number.isSafeInteger(ttl) || ttl <= 0 || !Number.isSafeInteger(Date.now() + ttl))) throw new ConfigError("coordination credential ttlMs must be a positive safe integer with a safe expiry");
	if (options.publicUrl !== void 0 && !options.authentication) throw new ConfigError("coordination publicUrl requires authentication");
	const signingKeys = typeof options.authentication === "object" ? options.authentication.signingKeys : void 0;
	if (signingKeys !== void 0) {
		if (!options.publicUrl) throw new ConfigError("coordination signingKeys requires a stable publicUrl");
		if (!signingKeys.activeKeyId || !Object.hasOwn(signingKeys.keys, signingKeys.activeKeyId)) throw new ConfigError("coordination signingKeys must contain the active key");
		for (const [id, key] of Object.entries(signingKeys.keys)) if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof key !== "string" || Buffer.byteLength(key) < 32) throw new ConfigError("coordination signing keys require bounded key IDs and at least 32 secret bytes");
	}
	coordinationHttpLimits(options);
}
/**
* The coordination verb that runs an injected deliverable's check inside its request, so its work
* can outlast one request and it is served like `nodeTools`. src/mcp/tools/coordination.ts builds it
* exactly when a deliverable is injected.
*/
const DELIVERABLE_VERB = "submit_result";
/**
* The longest one coordination call holds its HTTP response before it answers with a re-pollable
* pending result instead: `await_event` by default, and `submit_result` and every method-supplied
* node tool always.
*
* It is half of `requestTimeoutMs`, so the answer leaves before the transport's own 504 at
* `requestTimeoutMs`, with the other half left for body transfer, admission, and serialization.
* Deriving it here means a configured request timeout moves both fences with it. It is capped at
* {@link DEFAULT_AWAIT_EVENT_TIMEOUT_MS} so a long request timeout does not lengthen each wait; at
* the default 30 s request timeout both values are 15 s.
*/
function coordinationResponseFenceMs(requestTimeoutMs) {
	return Math.max(1, Math.min(DEFAULT_AWAIT_EVENT_TIMEOUT_MS, Math.floor(requestTimeoutMs / 2)));
}
/** Stand up the existing coordination tools with bounded HTTP access over one live scope. */
async function serveCoordinationMcp(opts) {
	return (await serveCoordinationMcpForManager(opts)).handle;
}
/** Runtime-only binding: operator controls stay off the public MCP handle and tool grants. */
async function serveCoordinationMcpForManager(opts, lifetime) {
	const host = opts.host ?? "127.0.0.1";
	assertCoordinationTransport(opts);
	const requestTimeoutMs = coordinationHttpLimits(opts).requestTimeoutMs;
	const responseFenceMs = coordinationResponseFenceMs(requestTimeoutMs);
	if (opts.peerMail && (!isLoopbackHost(host) || opts.publicUrl)) throw new ConfigError("remote peer mail requires a separate reachable capability transport; coordination authentication does not authorize the peer listener");
	const identity = Object.freeze({ ...opts.identity ?? {
		runId: opts.scope.view?.root ?? "",
		actorId: opts.scope.view?.root ?? ""
	} });
	if ((opts.authentication || opts.onAudit) && (!identity.runId.trim() || !identity.actorId.trim())) throw new ConfigError("authenticated coordination requires a trusted run and actor identity");
	const auth = typeof opts.authentication === "object" ? opts.authentication : void 0;
	const signingKeys = auth?.signingKeys ? {
		activeKeyId: auth.signingKeys.activeKeyId,
		keys: { ...auth.signingKeys.keys }
	} : void 0;
	let token;
	let credentialExpiresAt;
	let headers = Object.freeze({});
	let credentialAudience = "";
	let closed = false;
	const revoked = /* @__PURE__ */ new Map();
	const grantDigest = createHash("sha256").update(JSON.stringify([...opts.toolNames].sort())).digest("hex");
	const rotateCredential = () => {
		if (!opts.authentication) throw new ConfigError("coordination authentication is not configured");
		if (closed) throw new ConfigError("coordination server is closed");
		const deadline = opts.scope.budget.deadlineMs;
		const expiresAt = auth?.ttlMs === void 0 ? deadline > 0 ? deadline : void 0 : Date.now() + auth.ttlMs;
		if (expiresAt !== void 0 && !Number.isSafeInteger(expiresAt)) throw new ConfigError("coordination credential expiry must remain a safe integer");
		for (const [credential, expiry] of revoked) if (expiry <= Date.now()) revoked.delete(credential);
		if (token) revoked.set(token.toString(), credentialExpiresAt ?? Number.POSITIVE_INFINITY);
		credentialExpiresAt = expiresAt;
		const nonce = randomBytes(32).toString("base64url");
		let text = nonce;
		if (signingKeys) {
			const payload = Buffer.from(JSON.stringify({
				key: signingKeys.activeKeyId,
				run: identity.runId,
				actor: identity.actorId,
				audience: credentialAudience,
				grants: grantDigest,
				expires: credentialExpiresAt ?? null,
				nonce
			})).toString("base64url");
			text = `${payload}.${createHmac("sha256", signingKeys.keys[signingKeys.activeKeyId]).update(payload).digest("base64url")}`;
		}
		token = Buffer.from(text);
		headers = Object.freeze({ Authorization: `Bearer ${text}` });
	};
	const validCredential = (supplied) => {
		const deadline = opts.scope.budget.deadlineMs;
		if (closed || opts.scope.signal.aborted || deadline > 0 && Date.now() >= deadline || revoked.has(supplied.toString())) return false;
		if (!signingKeys) return token !== void 0 && (credentialExpiresAt === void 0 || Date.now() < credentialExpiresAt) && supplied.length === token.length && timingSafeEqual(supplied, token);
		if (supplied.length > 8192) return false;
		try {
			const parts = supplied.toString().split(".");
			if (parts.length !== 2) return false;
			const payload = parts[0];
			const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
			if (!claims || typeof claims.key !== "string" || !Object.hasOwn(signingKeys.keys, claims.key)) return false;
			const expected = createHmac("sha256", signingKeys.keys[claims.key]).update(payload).digest();
			const signature = Buffer.from(parts[1], "base64url");
			return signature.toString("base64url") === parts[1] && signature.length === expected.length && timingSafeEqual(signature, expected) && claims.run === identity.runId && claims.actor === identity.actorId && claims.audience === credentialAudience && claims.grants === grantDigest && (claims.expires === null && auth?.ttlMs === void 0 || Number.isSafeInteger(claims.expires) && claims.expires > Date.now());
		} catch {
			return false;
		}
	};
	const audiences = /* @__PURE__ */ new Set();
	const paths = /* @__PURE__ */ new Set(["/mcp"]);
	const ownerReader = opts.spawnResourceReader ?? (opts.spawnResourceRoot === void 0 ? scopeRetainedOwnerResourceReader(opts.scope) : void 0);
	let probeableByName;
	const coord = createCoordinationToolsForManager({
		resolveProbeTool: (name) => probeableByName?.get(name),
		scope: opts.scope,
		blobs: opts.blobs,
		makeWorkerAgent: opts.makeWorkerAgent,
		...opts.authorizeDownMessage ? { authorizeDownMessage: opts.authorizeDownMessage } : {},
		perWorker: opts.perWorker,
		...opts.deliverable ? { deliverable: opts.deliverable } : {},
		...opts.readContinuation ? { readContinuation: opts.readContinuation } : {},
		...opts.onStop ? { onStop: opts.onStop } : {},
		awaitTimeoutMs: opts.awaitTimeoutMs ?? responseFenceMs,
		...opts.analysts ? { analysts: opts.analysts } : {},
		...opts.analyzeOnSettle ? { analyzeOnSettle: opts.analyzeOnSettle } : {},
		...opts.watchWorkers ? { watchWorkers: opts.watchWorkers } : {},
		...opts.stallAfterMs !== void 0 ? { stallAfterMs: opts.stallAfterMs } : {},
		...opts.continuityByProfile ? { continuityByProfile: opts.continuityByProfile } : {},
		...opts.onEvent ? { onEvent: opts.onEvent } : {},
		...opts.replaySettlements ? { replaySettlements: true } : {},
		...opts.questionPolicy ? { questionPolicy: opts.questionPolicy } : {},
		...opts.escalateQuestion ? { escalateQuestion: opts.escalateQuestion } : {},
		...opts.priorEscalations?.length ? { priorEscalations: opts.priorEscalations } : {},
		...opts.priorQuestions?.length ? { priorQuestions: opts.priorQuestions } : {},
		...opts.priorJournal?.length ? { priorJournal: opts.priorJournal } : {},
		...opts.priorAnalystDefinitions?.length ? { priorAnalystDefinitions: opts.priorAnalystDefinitions } : {},
		...opts.preflightSpawn ? { preflightSpawn: opts.preflightSpawn } : {},
		...opts.resolveSpawnProfile ? { resolveSpawnProfile: opts.resolveSpawnProfile } : {},
		...opts.composeSpawnProfile ? { composeSpawnProfile: opts.composeSpawnProfile } : {},
		...opts.profiles ? { profiles: opts.profiles } : {},
		...opts.spawnResourceRoot ? { spawnResourceRoot: opts.spawnResourceRoot } : {},
		...ownerReader ? { spawnResourceReader: ownerReader } : {},
		...opts.peerMail ? { peerMail: typeof opts.peerMail === "object" && opts.peerMail.limits ? { limits: opts.peerMail.limits } : {} } : {}
	}, lifetime);
	await coord.ready();
	const reservedNames = new Set(coord.tools.map((tool) => tool.name));
	for (const tool of opts.nodeTools ?? []) {
		if (reservedNames.has(tool.name)) throw new ValidationError(`serveCoordinationMcp: node tool ${JSON.stringify(tool.name)} shadows a coordination verb or another node tool`);
		reservedNames.add(tool.name);
	}
	const nodeTools = singleFlightTools(opts.nodeTools ?? [], { fenceMs: responseFenceMs });
	const fencedVerbs = singleFlightTools(coord.tools.filter((tool) => tool.name === DELIVERABLE_VERB), { fenceMs: responseFenceMs });
	if (opts.deliverable && fencedVerbs.tools.length !== 1) throw new ValidationError(`serveCoordinationMcp: a deliverable is injected but the coordination verbs lack ${DELIVERABLE_VERB}, so its check would run unfenced`);
	const fencedByName = new Map(fencedVerbs.tools.map((tool) => [tool.name, tool]));
	const availableTools = [...coord.tools.map((tool) => fencedByName.get(tool.name) ?? tool), ...nodeTools.tools];
	const availableByName = new Map(availableTools.map((tool) => [tool.name, tool]));
	if (!Array.isArray(opts.toolNames)) throw new ValidationError("serveCoordinationMcp: toolNames must name every granted tool explicitly");
	const selectedNames = opts.toolNames;
	if (new Set(selectedNames).size !== selectedNames.length) throw new ValidationError("serveCoordinationMcp: toolNames contains a duplicate name");
	const servedTools = selectedNames.map((name) => {
		const tool = availableByName.get(name);
		if (tool === void 0) throw new ValidationError(`serveCoordinationMcp: requested tool ${JSON.stringify(name)} is unavailable`);
		return tool;
	});
	probeableByName = new Map(servedTools.map((tool) => [tool.name, tool]));
	const mcp = createStdioToolServer({
		serverName: "coordination",
		serverVersion: "1",
		tools: servedTools
	});
	opts.onCoordinationTools?.([...mcp.tools.values()]);
	const server = createServer(coordinationHttpHandler({
		options: opts,
		identity,
		toolNames: new Set(servedTools.map((tool) => tool.name)),
		handle: async (message) => {
			const response = await mcp.handle(message);
			if (message.method === "tools/call") noteScopeRetainedOwnerCoordination(opts.scope);
			return response;
		},
		backgroundActions: () => nodeTools.background() + fencedVerbs.background(),
		authorize: (req) => {
			if (!paths.has(req.url ?? "")) return 404;
			const address = req.socket.localAddress?.replace(/^::ffff:/, "");
			const localAuthority = address?.includes(":") ? `[${address}]:${req.socket.localPort}` : `${address}:${req.socket.localPort}`;
			const boundAuthority = audiences.size > 0 && (host === "0.0.0.0" || host === "::") && address !== void 0 && req.socket.localPort !== void 0 && req.headers.host === localAuthority;
			if (!audiences.has(req.headers.host ?? "") && !boundAuthority) return 403;
			if (closed) return 401;
			if (!opts.authentication) return void 0;
			const authorization = req.headers.authorization;
			const supplied = typeof authorization === "string" && authorization.startsWith("Bearer ") ? Buffer.from(authorization.slice(7)) : Buffer.alloc(0);
			if (!validCredential(supplied)) return 401;
		}
	}));
	server.requestTimeout = requestTimeoutMs;
	server.headersTimeout = requestTimeoutMs;
	const port = await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(opts.port ?? 0, host, () => {
			const addr = server.address();
			resolve(typeof addr === "object" && addr ? addr.port : opts.port ?? 0);
		});
	});
	const addressLifetime = new AbortController();
	const abortAddress = () => addressLifetime.abort(opts.scope.signal.reason);
	opts.scope.signal.addEventListener("abort", abortAddress, { once: true });
	if (opts.scope.signal.aborted) abortAddress();
	const releaseAddress = () => {
		opts.scope.signal.removeEventListener("abort", abortAddress);
		if (!addressLifetime.signal.aborted) addressLifetime.abort(/* @__PURE__ */ new Error("coordination listener closed"));
	};
	const localUrl = `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/mcp`;
	let url;
	try {
		const resolver = opts.publicUrl;
		const configured = typeof resolver === "function" ? await runAbortable(async () => resolver({
			host,
			port,
			...identity,
			signal: addressLifetime.signal
		}), opts.scope.signal, "coordination public address resolution aborted") : resolver;
		const publicAddress = new URL(configured ?? localUrl);
		if (!["http:", "https:"].includes(publicAddress.protocol) || publicAddress.username || publicAddress.password || publicAddress.search || publicAddress.hash) throw new ConfigError("coordination publicUrl must be an HTTP endpoint without credentials, query, or fragment");
		if (configured !== void 0 && publicAddress.protocol !== "https:" && !isLoopbackHost(publicAddress.hostname)) throw new ConfigError("remote coordination publicUrl must use HTTPS");
		url = publicAddress.href;
		credentialAudience = url;
		if (opts.authentication) rotateCredential();
		audiences.add(new URL(localUrl).host);
		audiences.add(publicAddress.host);
		if (host === "0.0.0.0" || host === "::") audiences.add(`127.0.0.1:${port}`);
		paths.add(publicAddress.pathname);
		if (configured !== void 0) await preflightPublicCoordination({
			url,
			headers,
			signal: opts.scope.signal,
			requestTimeoutMs,
			toolNames: selectedNames
		});
	} catch (error) {
		releaseAddress();
		closed = true;
		await new Promise((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
		throw error;
	}
	const mailbox = coord.peerMail;
	const mailListener = mailbox === void 0 ? void 0 : await servePeerMail(mailbox, host);
	return {
		handle: {
			url,
			port,
			get headers() {
				return headers;
			},
			get credentialExpiresAt() {
				return credentialExpiresAt;
			},
			rotateCredential,
			settled: () => coord.settled(),
			submittedResult: () => coord.submittedResult(),
			drainResolved: () => coord.drainResolved(),
			isStopped: () => coord.isStopped(),
			history: () => coord.history(),
			stats: () => coord.stats(),
			raiseFinding: (finding) => coord.raiseFinding(finding),
			mailHistory: () => mailbox?.history() ?? [],
			stopMailThread: (threadId) => mailbox?.stopThread(threadId) ?? false,
			close: async () => {
				releaseAddress();
				closed = true;
				await new Promise((resolve) => {
					server.close(() => resolve());
				});
				await mailListener?.close();
			}
		},
		controls: coord
	};
}
/**
* Stand up the peer-mail capability listener: one HTTP server, one secret path per worker, and on
* each path a tool server carrying ONLY `send_mail` / `read_mail` with that worker's identity
* closed over. An unknown path is a flat 404 — the path is the credential, so a request that does
* not present a minted one is not a client to reason with.
*
* The host is the coordination host, which the caller has already had to justify: the loopback gate
* above governs both listeners, and there is deliberately no way to bind mail somewhere else.
*/
async function servePeerMail(mailbox, host) {
	const servers = /* @__PURE__ */ new Map();
	const forCapability = (capabilityId) => {
		const existing = servers.get(capabilityId);
		if (existing) return existing;
		const created = createStdioToolServer({
			serverName: "peer-mail",
			serverVersion: "1",
			tools: mailbox.tools(capabilityId)
		});
		servers.set(capabilityId, created);
		return created;
	};
	const listener = createServer((req, res) => {
		const capabilityId = /^\/mail\/([0-9a-f]{32})$/.exec(req.url ?? "")?.[1];
		if (req.method !== "POST" || capabilityId === void 0 || !mailbox.hasCapability(capabilityId)) {
			res.writeHead(404).end();
			return;
		}
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			(async () => {
				try {
					const message = JSON.parse(body);
					const response = await forCapability(capabilityId).handle(message);
					if (response === null) {
						res.writeHead(202).end();
						return;
					}
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(response));
				} catch (e) {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({
						jsonrpc: "2.0",
						id: null,
						error: {
							code: -32700,
							message: e instanceof Error ? e.message : "parse error"
						}
					}));
				}
			})();
		});
	});
	const port = await new Promise((resolve, reject) => {
		listener.once("error", reject);
		listener.listen(0, host, () => {
			const addr = listener.address();
			resolve(typeof addr === "object" && addr ? addr.port : 0);
		});
	});
	mailbox.setEndpoint(`http://${host}:${port}/mail`);
	return { close: () => new Promise((resolve) => {
		listener.close(() => resolve());
	}) };
}
//#endregion
//#region src/runtime/supervise/otel-spans.ts
/**
* Supervisor tree → OTLP spans. OPT-IN, off by default.
*
* WHY. A supervised tree is legible today only by parsing this package's own spawn journal, so
* every other multi-agent shape on the machine (a coding-CLI's subagents, a pi fanout, ad-hoc tool
* parallelism) needs its own bespoke reader. A span carrying `parent_span_id` IS a tree, and any
* system can emit one — so emitting spans makes the supervisor readable by the same viewer as
* everything else, with no per-system reader.
*
* WHAT IT IS NOT. This is telemetry, never the record of truth. The spawn journal remains the sole
* durable ledger for replay/resume and for cost; nothing here is read back, and a run whose export
* fails is unaffected in every observable way. The two data models are deliberately separate.
*
* HOW IT ATTACHES. This is a pure `RuntimeHooks` observer over the lifecycle events `Scope` ALREADY
* emits — `agent.spawn` (a node opened), `agent.child` (a node settled), `agent.turn` (a driver
* inference turn was metered). It adds no event, mutates no journal, and changes no result. Because
* `Scope` re-seeds the same hooks into every nested scope (`makeNestedScopeSeam`), one observer sees
* the WHOLE recursion at arbitrary depth.
*
* SPAN SHAPE. One span per supervised node, opened at spawn and closed at settle, parented to its
* parent node's span; the run root is the trace. Driver inference rides as an `LLM` child span under
* the node that metered it. Attributes reuse the vocabulary the rest of the stack already reads
* (`openinference.span.kind`, `agent.name`, `llm.token_count.*`, `llm.cost_usd`, `tangle.cost.usd`)
* — see `@tangle-network/agent-eval`'s `src/trace/attribute-vocabulary.ts`, which is the consumer.
*
* UNKNOWN IS NEVER ZERO. `Spend.tokensKnown === false` / `usdKnown === false` mark work that
* HAPPENED with an unreported count. Those spans OMIT the token/cost attribute entirely and set
* `tangle.supervise.tokens_known` / `tangle.supervise.cost_known` to `false`, so a reader can never
* mistake an unmeasured turn for a free one.
*/
/** OTEL status codes (`UNSET` / `OK` / `ERROR`) — the numeric wire values `OtelSpan.status` carries. */
const STATUS_UNSET = 0;
const STATUS_OK = 1;
const STATUS_ERROR = 2;
/** Longest string attribute value written from free-form detail, so an oversized turn payload
*  cannot inflate a span. Identity/label attributes we control are never truncated. */
const MAX_DETAIL_CHARS = 256;
/**
* Build the span recorder for one supervised run, or `undefined` when no exporter resolves — the
* off-by-default path. A run that passes no `exporter` and no `exportConfig` never reaches this
* function at all; one that passes an `exportConfig` with no endpoint (and no env endpoint) gets
* `undefined` here, so "configured but unreachable" also costs nothing.
*/
function createSupervisorSpanRecorder(opts) {
	const exporter = opts.exporter ?? createOtelExporter(opts.exportConfig);
	if (!exporter) return void 0;
	const ownsExporter = opts.exporter === void 0;
	const now = opts.now ?? Date.now;
	const traceId = normalizeTraceId(opts.traceId, opts.runId);
	const rootSpanId = generateSpanId();
	const rootStartMs = now();
	const base = {
		"tangle.run.id": opts.runId,
		"tangle.sessionId": opts.runId,
		...opts.attributes ?? {}
	};
	/** Node id → its open span. Seeded with the run id ⇒ the root span, because a depth-0 spawn's
	*  `parentId` is the run id itself and every deeper spawn's is a real node id. */
	const open = /* @__PURE__ */ new Map();
	const spanIdOf = /* @__PURE__ */ new Map([[opts.runId, rootSpanId]]);
	let finished = false;
	/**
	* The span a node's event hangs under. A parent node whose span this recorder never opened (it
	* ran in an earlier process) leaves the child on the root span, which is a placeholder, not a
	* recorded parent.
	*/
	const parentSpan = (parentId) => {
		const spanId = parentId === void 0 ? void 0 : spanIdOf.get(parentId);
		return spanId ? {
			spanId,
			confidence: "explicit"
		} : {
			spanId: rootSpanId,
			confidence: "unknown"
		};
	};
	/** Every export is best-effort: a throwing exporter must never reach the run. */
	const emit = (span) => {
		try {
			exporter.exportSpan(span);
		} catch {}
	};
	const span = (spanId, parentSpanId, name, startMs, endMs, attrs, status, message) => ({
		traceId,
		spanId,
		...parentSpanId ? { parentSpanId } : {},
		name,
		kind: 1,
		startTimeUnixNano: msToNano(startMs),
		endTimeUnixNano: msToNano(Math.max(startMs, endMs)),
		attributes: toOtelAttributes(attrs),
		status: {
			code: status,
			...message ? { message } : {}
		}
	});
	function onSpawn(event) {
		const p = record(event.payload);
		const childId = str(p.childId);
		if (!childId) return;
		const label = str(p.label) ?? "node";
		const runtime = str(p.runtime);
		const isWait = runtime === "wait";
		const attrs = {
			...base,
			[ATTR.spanKind]: isWait ? "CHAIN" : "AGENT",
			"agent.name": label,
			"tangle.supervise.node.id": childId,
			"tangle.supervise.node.label": label,
			"tangle.supervise.node.kind": isWait ? "wait" : "agent",
			"tangle.supervise.tree.root": event.runId
		};
		if (event.parentId) attrs["tangle.supervise.node.parent_id"] = event.parentId;
		if (runtime) attrs["tangle.supervise.node.runtime"] = runtime;
		if (typeof p.depth === "number") attrs["tangle.supervise.node.depth"] = p.depth;
		const key = str(p.key);
		const operation = str(p.assignmentId) ?? key;
		if (operation) attrs[ATTR.operationId] = operation;
		const attempt = str(p.attemptId);
		if (attempt) attrs[ATTR.attemptId] = attempt;
		if (key) attrs[ATTR.idempotencyKey] = key;
		if (typeof event.stepIndex === "number") attrs["tangle.supervise.node.ordinal"] = event.stepIndex;
		if (p.resumed === true) attrs["tangle.supervise.node.resumed"] = true;
		assignBudget(attrs, p.budget);
		const parent = parentSpan(event.parentId);
		attrs[ATTR.parentConfidence] = parent.confidence;
		const spanId = generateSpanId();
		spanIdOf.set(childId, spanId);
		open.set(childId, {
			spanId,
			parentSpanId: parent.spanId,
			name: label,
			startMs: event.timestamp,
			attrs
		});
	}
	function onSettled(event) {
		const p = record(event.payload);
		const childId = str(p.childId);
		if (!childId) return;
		const node = open.get(childId);
		if (!node) return;
		open.delete(childId);
		const status = str(p.status);
		const down = status === "down";
		const attrs = {
			...node.attrs,
			"tangle.supervise.node.status": status ?? "done"
		};
		if (typeof event.stepIndex === "number") attrs["tangle.supervise.node.seq"] = event.stepIndex;
		if (typeof p.outRef === "string") attrs["tangle.supervise.node.out_ref"] = p.outRef;
		if (typeof p.valid === "boolean") attrs["tangle.supervise.verdict.valid"] = p.valid;
		if (typeof p.score === "number") attrs["tangle.supervise.verdict.score"] = p.score;
		if (down) {
			attrs["error.type"] = p.infra === true ? "infra" : "child-down";
			const reason = str(p.reason);
			if (reason) attrs["error.message"] = truncate(reason);
			if (typeof p.infra === "boolean") attrs["tangle.supervise.node.infra"] = p.infra;
		}
		const wokeBy = str(record(p.wait).settled);
		if (wokeBy) attrs["tangle.supervise.wait.settled"] = wokeBy;
		assignSpend(attrs, p.spent);
		emit(span(node.spanId, node.parentSpanId, node.name, node.startMs, event.timestamp, attrs, down ? STATUS_ERROR : STATUS_OK, down ? str(p.reason) ?? "child down" : void 0));
	}
	function onTurn(event) {
		const p = record(event.payload);
		const parentId = event.parentId;
		const parent = parentId ? parentSpan(parentId) : {
			spanId: rootSpanId,
			confidence: "explicit"
		};
		const parentSpanId = parent.spanId;
		const attrs = {
			...base,
			[ATTR.parentConfidence]: parent.confidence,
			[ATTR.spanKind]: "LLM",
			"inference.observation_kind": "LLM",
			"tangle.supervise.node.kind": "inference"
		};
		if (parentId) attrs["tangle.supervise.node.id"] = parentId;
		for (const [key, value] of Object.entries(p)) {
			if (key === "spend") continue;
			if (key === "driver" && typeof value === "string") {
				attrs["agent.name"] = value;
				attrs["inference.agent_name"] = value;
				continue;
			}
			if (key === "model" && typeof value === "string") {
				attrs["llm.model_name"] = value;
				continue;
			}
			if (Array.isArray(value)) {
				const scalars = value.filter((v) => typeof v === "string" || typeof v === "number");
				if (scalars.length > 0) attrs[`tangle.supervise.turn.${key}`] = truncate(scalars.join(","));
				continue;
			}
			if (typeof value === "string") attrs[`tangle.supervise.turn.${key}`] = truncate(value);
			else if (typeof value === "number" || typeof value === "boolean") attrs[`tangle.supervise.turn.${key}`] = value;
		}
		const spend = assignSpend(attrs, p.spend);
		const endMs = event.timestamp + (spend?.ms ?? 0);
		emit(span(generateSpanId(), parentSpanId, "gen_ai.client.inference", event.timestamp, endMs, attrs, STATUS_OK));
	}
	return {
		hooks: { onEvent(event) {
			if (finished) return;
			try {
				if (event.phase !== "after") return;
				if (event.target === "agent.spawn") onSpawn(event);
				else if (event.target === "agent.child") onSettled(event);
				else if (event.target === "agent.turn") onTurn(event);
			} catch {}
		} },
		traceId,
		rootSpanId,
		workerTrace(spawningNodeId) {
			return {
				traceId,
				parentSpanId: spanIdOf.get(spawningNodeId) ?? rootSpanId
			};
		},
		async finish(outcome) {
			if (finished) return;
			finished = true;
			const endMs = now();
			try {
				for (const [nodeId, node] of open) emit(span(node.spanId, node.parentSpanId, node.name, node.startMs, endMs, {
					...node.attrs,
					"tangle.supervise.node.status": "unsettled",
					"tangle.supervise.node.settled": false,
					"tangle.supervise.node.id": nodeId
				}, STATUS_UNSET));
				open.clear();
				emit(span(rootSpanId, opts.parentSpanId, "supervisor.run", rootStartMs, endMs, {
					...rootAttrs(base, opts.agentName ?? "supervisor", outcome),
					...opts.parentSpanId ? { [ATTR.parentConfidence]: "explicit" } : {}
				}, rootStatus(outcome), rootMessage(outcome)));
			} catch {}
			try {
				await exporter.flush();
			} catch (error) {
				const s = exporter.stats();
				console.warn(`[agent-runtime] supervisor span export dropped ${s.dropped} span(s): ${s.lastError ?? String(error)}`);
			} finally {
				if (ownsExporter) await exporter.shutdown();
			}
		},
		stats: () => exporter.stats()
	};
}
function rootAttrs(base, agentName, outcome) {
	const attrs = {
		...base,
		[ATTR.spanKind]: "AGENT",
		"inference.observation_kind": "AGENT",
		"agent.name": agentName,
		"inference.agent_name": agentName,
		"tangle.supervise.node.kind": "root"
	};
	const result = outcome?.result;
	if (result) {
		attrs["tangle.supervise.result"] = result.kind;
		if (result.kind === "no-winner") {
			attrs["tangle.supervise.reason"] = result.reason;
			attrs["tangle.supervise.down_count"] = result.downCount;
			if (result.reason === "driver-failed") {
				attrs["error.type"] = result.error.name;
				attrs["error.message"] = truncate(result.error.message);
			}
		}
		assignSpend(attrs, result.spentTotal);
	}
	if (outcome?.error !== void 0) {
		attrs["tangle.supervise.result"] = "error";
		const err = outcome.error;
		attrs["error.type"] = err instanceof Error ? err.name : typeof err;
		attrs["error.message"] = truncate(err instanceof Error ? err.message : String(err));
	}
	return attrs;
}
function rootStatus(outcome) {
	if (outcome?.error !== void 0) return STATUS_ERROR;
	if (!outcome?.result) return STATUS_UNSET;
	return outcome.result.kind === "winner" ? STATUS_OK : STATUS_ERROR;
}
function rootMessage(outcome) {
	if (outcome?.error !== void 0) return truncate(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
	const result = outcome?.result;
	return result && result.kind === "no-winner" ? result.reason : void 0;
}
/**
* Write a `Spend` onto a span, honouring the "a missing measurement is never zero" invariant: a
* channel marked NOT known contributes no number at all and instead flags itself, so nothing
* downstream can sum an unmeasured turn as free. Returns the spend it read (for the duration).
*/
function assignSpend(attrs, value) {
	if (!isRecord(value)) return void 0;
	const spend = value;
	const tokens = isRecord(spend.tokens) ? spend.tokens : void 0;
	if (spend.tokensKnown === false) attrs["tangle.supervise.tokens_known"] = false;
	else if (tokens) {
		if (typeof tokens.input === "number") attrs["llm.token_count.prompt"] = tokens.input;
		if (typeof tokens.output === "number") attrs["llm.token_count.completion"] = tokens.output;
	}
	if (spend.usdKnown === false) attrs["tangle.supervise.cost_known"] = false;
	else if (typeof spend.usd === "number" && Number.isFinite(spend.usd)) {
		attrs["llm.cost_usd"] = spend.usd;
		attrs["tangle.cost.usd"] = spend.usd;
	}
	if (typeof spend.iterations === "number") attrs["tangle.supervise.iterations"] = spend.iterations;
	if (typeof spend.ms === "number" && spend.ms > 0) attrs["tangle.supervise.duration_ms"] = spend.ms;
	if (typeof spend.boxMinutes === "number" && Number.isFinite(spend.boxMinutes)) attrs["tangle.platform.box_minutes"] = spend.boxMinutes;
	if (spend.boxMinutesProvenance !== void 0) {
		attrs["tangle.platform.box_minutes_provenance"] = spend.boxMinutesProvenance;
		attrs["tangle.platform.box_minutes_known"] = spend.boxMinutesKnown === true;
	}
	if (spend.tokensProvenance !== void 0) attrs["tangle.supervise.tokens_provenance"] = spend.tokensProvenance;
	return spend;
}
function assignBudget(attrs, value) {
	if (!isRecord(value)) return;
	const budget = value;
	if (typeof budget.maxTokens === "number") attrs["tangle.supervise.budget.max_tokens"] = budget.maxTokens;
	if (typeof budget.maxIterations === "number") attrs["tangle.supervise.budget.max_iterations"] = budget.maxIterations;
	if (typeof budget.maxUsd === "number") attrs["tangle.supervise.budget.max_usd"] = budget.maxUsd;
}
/**
* A trace id must be 32 hex characters. A caller-supplied one is used verbatim when it already is;
* anything else (and the default) is DERIVED from the run id by content address — deterministic, so
* a resumed run rejoins the trace its first process opened rather than forking a new one.
*/
function normalizeTraceId(traceId, runId) {
	if (traceId && /^[0-9a-f]{32}$/i.test(traceId)) return traceId.toLowerCase();
	return contentAddress(traceId ?? runId).slice(7, 39);
}
function msToNano(ms) {
	return (BigInt(Number.isFinite(ms) ? Math.floor(ms) : 0) * 1000000n).toString();
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value) {
	return isRecord(value) ? value : {};
}
function str(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function truncate(value) {
	return value.length > MAX_DETAIL_CHARS ? `${value.slice(0, MAX_DETAIL_CHARS)}…` : value;
}
//#endregion
//#region src/runtime/supervise/reentry.ts
/** Continuity when nothing is proven: compose the full state. */
const UNPROVEN_CONTINUITY = Object.freeze({
	session: "new",
	environment: "unknown",
	workspace: "unknown"
});
/** Compose the task for one re-entered drive. */
function composeReentryTask(input) {
	const { reentry, continuity, state } = input;
	if (reentry.reason === "unmet-contract" && continuity.session === "continued") {
		const changes = stateLines(state, false);
		return [reentry.steer, ...changes.length > 0 ? ["", ...changes] : []].join("\n");
	}
	return [
		`You are re-entering a run that is already in progress (driver attempt ${input.attempt}). This is the same run and the same objective, not a new one.`,
		whyLine(reentry),
		environmentLine(continuity),
		"",
		"## Objective",
		"",
		"This is the original task of the run, unchanged:",
		"",
		taskText(input.originalTask),
		"",
		"## Completion check",
		"",
		input.contract === void 0 || input.contract.trim().length === 0 ? "The run ends when submit_result passes the independent check." : `The run ends when submit_result passes the independent check. It expects: ${input.contract.trim()}`,
		...reentry.reason === "unmet-contract" ? [
			"",
			"What is still unmet:",
			"",
			reentry.steer
		] : [],
		"",
		"## Run state, from the coordinator",
		"",
		...stateLines(state, true),
		"",
		"## What to do now",
		"",
		"Continue the run from this state.",
		...continuity.workspace === "kept" || continuity.workspace === "restored" ? ["Read the files you already wrote before you repeat any step of the task. A step whose file is there is done, and its content stands."] : [],
		"Receive the waiting events with await_event, and read the output of every settled worker before you spawn anything new.",
		"Do not spawn a replacement for a worker that is running or has settled.",
		"Your coordination tools are served by the same coordinator as before, and the state above comes from it."
	].join("\n");
}
/**
* Why the driver is back, in one clause. The failure's own text stays in the attempt records and
* never reaches the driver: measured 2026-09-11, a continuation told the details of a provider
* failure spent two of its first four children probing the infrastructure, while its peer, told
* only what to continue, spent all forty-five on the research.
*/
function whyLine(reentry) {
	if (reentry.reason === "unmet-contract") return `Your previous turn ended with the completion check unmet (continuation ${reentry.continuation}).`;
	return reentry.reason === "upstream-unavailable" ? "Your previous turn was interrupted before it finished; the run itself is intact." : `Your previous turn ended before it finished (retry ${reentry.retry}); the run itself is intact.`;
}
function environmentLine(continuity) {
	if (continuity.environment === "same") return `You run in the same environment as before${continuity.environmentId === void 0 ? "" : ` (${continuity.environmentId})`}, and your files are where you left them.`;
	if (continuity.environment === "replaced") return `Your previous environment${continuity.previousEnvironmentId === void 0 ? "" : ` (${continuity.previousEnvironmentId})`} is gone, and you run in a new one. ` + (continuity.workspace === "kept" ? "Its files were carried over." : continuity.workspace === "restored" ? `Its files were restored from a checkpoint taken at ${continuity.checkpointAt ?? "your last coordination call"}; anything you wrote after that is not here. The coordinator and the knowledge store kept everything below.` : "Files you wrote there are not here. The coordinator and the knowledge store kept everything below.");
	return "You may be in a new environment. Check for files before you rely on them; the coordinator kept everything below.";
}
function stateLines(state, full) {
	const lines = [];
	if (full || state.journalRows > state.journalReadTo) lines.push(`Journal: ${state.journalRows} rows. You last read up to row ${state.journalReadTo}; call read_journal with sinceRow ${state.journalReadTo} to read what happened since, or sinceRow 0 to read the whole run.`);
	if (state.live.length > 0) lines.push(`Workers running: ${state.live.map((worker) => `${worker.id} (${worker.label}, ${worker.status})`).join("; ")}.`);
	else if (full) lines.push("Workers running: none.");
	const settled = full ? state.settled : state.settled.filter((worker) => !worker.delivered);
	if (settled.length > 0) lines.push(`Workers settled${full ? "" : " that you have not received"}: ${settled.map((worker) => `${worker.id} (${worker.status}${worker.valid === void 0 ? "" : worker.valid ? ", passed its check" : ", did not pass its check"}${worker.delivered ? "" : ", not yet received"})`).join("; ")}. Read an output with observe_agent and the worker id.`);
	else if (full) lines.push("Workers settled: none.");
	if (state.waiting.length > 0) lines.push(`Events waiting for you in await_event: ${state.waiting.length} (${state.waiting.map((event) => event.worker === void 0 ? event.type : `${event.type} from ${event.worker}`).join("; ")}).`);
	else if (full) lines.push("Events waiting for you in await_event: none.");
	if (state.unacknowledged.length > 0) lines.push(`Events delivered to a turn that did not finish, so treat them as unread: ${state.unacknowledged.map((event) => `#${event.seq} ${event.type}${event.worker === void 0 ? "" : ` from ${event.worker}`}`).join("; ")}. Pass their numbers in await_event's acknowledge once you have processed them.`);
	if (state.lastRejection !== void 0) lines.push(`Your last submit_result was refused: ${state.lastRejection.reason}`);
	return lines;
}
function taskText(task) {
	if (typeof task === "string") return task;
	try {
		return JSON.stringify(task, null, 2) ?? String(task);
	} catch {
		return String(task);
	}
}
//#endregion
//#region src/runtime/supervise/root-stream.ts
/**
* The root manager's own provider stream, retained where Runtime owns it.
*
* Measured motive (agent-runtime#1233, 2026-09-15): a CHILD's full event stream — reasoning, text,
* and tool parts, 28k to 76k reasoning characters per child — is retained in the blob its
* `settled` record names as `outRef`. The ROOT's stream reached nobody: `driveHarnessFromBackend`
* drained the root executor for accounting and discarded every `progress` event, and on a
* `winner` run `result.outRef` is the SELECTED CHILD's artifact, not the root's. A root that died
* at its join barrier (fourier-e, 63 children) left a 607-byte `failure.json` and nothing it
* thought; the Lab's only transcript of a root was a post-hoc scrape of the harness's own
* database.
*
* `<runDir>/root-stream.jsonl` is the record: one JSONL line per `ExecutorProgressEvent`, written
* AS IT ARRIVES, so a root whose process is killed mid-turn keeps every line already written. The
* file itself is the evidence; the receipt (`ref`, the content address of the file's bytes, and
* `events`, its committed line count) is what `result.json` and `failure.json` carry. The winner's
* `outRef` keeps its meaning; this is a separate reference.
*
* Durability boundary: each line is written synchronously to an `O_APPEND` descriptor before the
* next event is drained, and the file is fsynced at every drive-attempt boundary and at close, not
* per line. Measured 2026-09-15 on this host's APFS: an fsync per line cost 7.1 ms per event over
* 1,000 events and 8.1 ms over 5,000 (~80 s for a root emitting ten thousand text deltas, all of
* it serialized inside the drain loop that also meters the budget); an async `FileHandle.write`
* still cost 0.9 to 1.1 ms per line in the thread pool the children's journal writes share; a
* `writeSync` costs 6 µs. A process kill loses nothing written; only a kernel crash or power
* loss can drop lines written since the last fsync, and the reader's torn-tail rule keeps such a
* file readable.
*
* The bridge wire carries text and tool calls only: cli-bridge's SSE frames decode
* `delta.content` and `delta.tool_calls`, never a reasoning delta. A bridge-placed root's retained
* stream is therefore text plus tool calls; reasoning arrives only on the provider/sandbox path,
* which projects `message.part.updated` reasoning parts to `reasoning_delta`.
*/
/** The root stream: one JSONL line per progress event the root's executor observed. */
const ROOT_STREAM_FILE = "root-stream.jsonl";
/** Create the writer for `<runDir>/root-stream.jsonl`. Nothing touches disk until the first
*  `beginAttempt`, so a run whose root never drives leaves no file and no receipt. */
function createRootStreamSink(runDir, now) {
	const dir = resolve(runDir);
	const path = resolve(dir, ROOT_STREAM_FILE);
	let fd;
	let attempt = 0;
	let seq = 0;
	let closed = false;
	const openOnce = async () => {
		if (fd !== void 0) return;
		await mkdir(dir, { recursive: true });
		assertNoSymlinkDescendant(dir, path, "root stream");
		const needsSeparator = await prepareJsonlAppend(path);
		seq = 0;
		for await (const _record of readCommittedJsonLines(path, { allowMissing: true })) seq += 1;
		fd = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0), 384);
		if (needsSeparator) writeLine(fd, "");
	};
	return {
		async beginAttempt() {
			if (closed) throw new Error("root stream: beginAttempt after close");
			attempt += 1;
			if (fd !== void 0) fsyncSync(fd);
			await openOnce();
		},
		append(event) {
			if (closed) throw new Error("root stream: append after close");
			if (fd === void 0) throw new Error("root stream: append before beginAttempt");
			const at = new Date(now()).toISOString();
			const record = {
				seq: seq + 1,
				at,
				attempt,
				event
			};
			let line;
			try {
				line = JSON.stringify(record);
			} catch (error) {
				line = JSON.stringify({
					seq: seq + 1,
					at,
					attempt,
					dropped: {
						kind: event.kind,
						reason: errorMessage(error)
					}
				});
			}
			if (line === void 0) line = JSON.stringify({
				seq: seq + 1,
				at,
				attempt,
				dropped: {
					kind: event.kind,
					reason: "event serialized to nothing"
				}
			});
			writeLine(fd, line);
			seq += 1;
		},
		async close() {
			if (closed) throw new Error("root stream: closed twice");
			closed = true;
			if (fd === void 0) return void 0;
			try {
				fsyncSync(fd);
			} finally {
				closeSync(fd);
				fd = void 0;
			}
			return readRootStreamReceipt(dir);
		}
	};
}
/** `writeSync` may legally make a short write; loop until the whole line and its newline land. */
function writeLine(fd, line) {
	const bytes = Buffer.from(`${line}\n`, "utf8");
	let offset = 0;
	while (offset < bytes.byteLength) {
		const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
		if (written <= 0) throw new Error(`root stream: append made no progress at byte ${offset}`);
		offset += written;
	}
}
/**
* The receipt for the root stream a run directory holds, recomputed from the file's bytes, or
* `undefined` when the directory holds none. This is what a run that never settled — a root that
* died mid-turn — gets on its failure record, and it equals what `close()` returned for a run
* that did.
*/
async function readRootStreamReceipt(runDir) {
	const path = resolve(runDir, ROOT_STREAM_FILE);
	const hash = createHash("sha256");
	let events = 0;
	try {
		for await (const _record of readCommittedJsonLines(path, { onBytes: (bytes) => {
			hash.update(bytes);
		} })) events += 1;
	} catch (error) {
		if (isNoEntError(error)) return void 0;
		throw error;
	}
	return Object.freeze({
		ref: `sha256:${hash.digest("hex")}`,
		events
	});
}
/** Every committed line of the root stream, in order, or `undefined` when there is no file. A
*  torn final line from a process that died mid-write is not a record and is left out. */
async function readRootStream(runDir) {
	const path = resolve(runDir, ROOT_STREAM_FILE);
	const records = [];
	try {
		for await (const record of readCommittedJsonLines(path)) records.push(record);
	} catch (error) {
		if (isNoEntError(error)) return void 0;
		throw error;
	}
	return records;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/runtime/supervise/run-traces.ts
/**
* A manager's own run as one trace store: what the continuation's question panel reads.
*
* The panel asks about the director's own work and about its workers' (discovery
* `docs/38-one-loop-and-continuation.md`, section 5), so it reads both: the director's root stream
* (`root-stream.jsonl`) and each settled worker's structured tool trace. Each agent is one trace,
* named by its node id, so a `{worker}` question and a `trace://<worker id>/<span id>` citation
* name the same worker.
*
* The root stream is progress events, not spans. Each tool call becomes one span with its result,
* and each run of the director's text, and of its reasoning, between two other events becomes one
* span named for what it is (`assistant_text`, `assistant_reasoning`): the director's claims live in
* its text, and a panel that saw only its tool calls could not check them. Span ids are the
* record's `seq`, which is unique in the file and stable across reads.
*/
/** The span a run of the director's text becomes. */
const ASSISTANT_TEXT_SPAN = "assistant_text";
/** The span a run of the director's reasoning becomes. */
const ASSISTANT_REASONING_SPAN = "assistant_reasoning";
/** The director's root stream as tool spans in one trace named `traceId`. */
function rootStreamToolSpans(records, traceId) {
	const spans = [];
	const open = /* @__PURE__ */ new Map();
	let prose;
	const at = (record) => {
		const ms = Date.parse(record.at);
		if (!Number.isFinite(ms)) throw new ValidationError(`root stream line ${record.seq} has no valid time`);
		return ms;
	};
	const base = (record, name) => ({
		kind: "tool",
		spanId: `s${record.seq}`,
		runId: traceId,
		name,
		toolName: name,
		startedAt: at(record),
		attributes: {
			attempt: record.attempt,
			seq: record.seq
		}
	});
	for (const record of records) {
		if (!("event" in record)) {
			prose = void 0;
			continue;
		}
		const { event } = record;
		if (event.kind === "text_delta" || event.kind === "reasoning_delta") {
			if (prose !== void 0 && prose.kind === event.kind && prose.attempt === record.attempt) {
				prose.text += event.text;
				prose.span.result = prose.text;
				prose.span.endedAt = at(record);
				continue;
			}
			const span = {
				...base(record, event.kind === "text_delta" ? ASSISTANT_TEXT_SPAN : ASSISTANT_REASONING_SPAN),
				args: {},
				result: event.text,
				endedAt: at(record)
			};
			spans.push(span);
			prose = {
				span,
				text: event.text,
				kind: event.kind,
				attempt: record.attempt
			};
			continue;
		}
		prose = void 0;
		if (event.kind === "tool_call") {
			const span = {
				...base(record, event.toolName),
				args: event.args,
				...event.args === void 0 ? { argsCaptured: false } : {},
				endedAt: at(record)
			};
			if (event.toolCallId !== void 0) span.attributes = {
				...span.attributes,
				toolCallId: event.toolCallId
			};
			spans.push(span);
			open.set(`${record.attempt}\u0000${event.toolCallId ?? `name:${event.toolName}`}`, span);
			continue;
		}
		if (event.kind === "tool_result") {
			const key = `${record.attempt}\u0000${event.toolCallId ?? `name:${event.toolName}`}`;
			const call = open.get(key);
			if (call !== void 0) {
				open.delete(key);
				call.result = event.result;
				call.endedAt = at(record);
				continue;
			}
			spans.push({
				...base(record, event.toolName),
				args: void 0,
				argsCaptured: false,
				result: event.result,
				endedAt: at(record)
			});
		}
	}
	return spans;
}
/** One worker's persisted tool spans, re-keyed to the worker's node id. Unavailable: none. */
async function workerSpans(worker, blobs) {
	if (worker.trace.status !== "available") return [];
	const raw = await blobs.get(worker.trace.traceRef);
	if (raw === void 0) throw new ValidationError(`worker ${worker.id}'s trace blob '${worker.trace.traceRef}' is missing; its settlement evidence is incomplete`);
	const { spans } = parseWorkerToolTraceArtifact(raw, worker.trace.traceRef);
	return spans.map((span) => ({
		...span,
		runId: worker.id,
		...span.runId === worker.id ? {} : { attributes: {
			...span.attributes,
			sourceRunId: span.runId
		} }
	}));
}
/**
* The store over a manager's run: its own root stream when it has one, and every settled worker's
* tool trace. `undefined` when the run has recorded no span yet, which is not a store a panel can
* read: agent-eval refuses an empty trace, because it cannot tell a tool-free run from a failed
* capture.
*/
async function runTraceAnalysisStore(input) {
	const records = input.root === void 0 ? void 0 : await input.root.read();
	const spans = [...records === void 0 || input.root === void 0 ? [] : rootStreamToolSpans(records, input.root.id), ...(await Promise.all(input.workers.map((worker) => workerSpans(worker, input.blobs)))).flat()];
	return spans.length === 0 ? void 0 : toolSpansToTraceAnalysisStore(spans);
}
//#endregion
//#region src/runtime/supervise/worker-control-observer.ts
/** Observe durable worker controls while the native harness owns the manager's turn loop. */
function observeWorkerControls(options) {
	const { dir, coord, scope, signal, controlScope, onError } = options;
	const steerDir = options.steerDir ?? dir;
	const deps = {
		coord,
		scope,
		signal,
		now: Date.now,
		ownerId: scope.view.root,
		controlScope
	};
	const steers = steerDir === void 0 ? void 0 : createSteerAcknowledger({
		...deps,
		dir: steerDir,
		deliverRoot: options.deliverRoot,
		deliverRootReady: options.deliverRootReady
	});
	const cancellations = dir === void 0 ? void 0 : createCancelAcknowledger({
		...deps,
		dir
	});
	let active = true;
	let timer;
	let steering = false;
	let inFlight = Promise.resolve();
	let failure;
	let closing;
	const stop = () => {
		active = false;
		clearInterval(timer);
		signal.removeEventListener("abort", stop);
	};
	const fail = (error) => {
		failure = { error };
		stop();
		onError(error);
	};
	const poll = () => {
		if (!active) return;
		try {
			cancellations?.pass("turn");
			if (steers === void 0 || steering) return;
			steering = true;
			inFlight = steers.pass("turn").catch(fail).finally(() => {
				steering = false;
			});
		} catch (error) {
			fail(error);
		}
	};
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();
	else {
		timer = setInterval(poll, 100);
		timer.unref();
		poll();
	}
	const finish = async () => {
		stop();
		await inFlight;
		try {
			await steers?.pass("final");
			cancellations?.pass("final");
		} finally {
			cancellations?.finish();
		}
		if (failure) throw failure.error;
	};
	return { close: () => closing ??= finish() };
}
//#endregion
//#region src/runtime/supervise/supervisor-agent.ts
/**
* `supervisorAgent` — build a supervisor `Agent` FROM its profile. The brain is resolved from
* `profile.harness` exactly as `createExecutor({ backend })` resolves a worker: backend-as-data,
* no hand-built brain. The supervisor stops being special — it's one profile, materialized by the
* same resolution rule as every other agent.
*
*  - `harness` omitted or `cli-base` → the in-process router tool-loop: `driverAgent` over the
*    canonical `ToolLoopChat`, built by `routerBrain` from the profile's model + the router seam.
*  - `harness` a coding CLI (`claude-code`/`opencode`/`codex`/…) → an EXTERNAL harness drives the
*    coordination verbs: `serveCoordinationMcp` exposes spawn/await/steer/stop over the live scope,
*    and the caller's `driveHarness` runs the harness with that MCP mounted. `supervise()` builds
*    this automatically only for a local bridge; a remote sandbox needs an explicit reachable
*    relay or tunnel. The harness IS the brain.
*
* Both arms spawn children through the SAME `makeWorkerAgent` seam and apply the SAME independent
* deliverable check to direct submissions. Raw driver prose is never eligible.
*/
/** Runtime-owned coordination is mounted under this MCP alias. */
const coordinationMcpAlias = "agent-runtime-coordination";
/** A profile declares Runtime-owned tools with this provider-neutral prefix. */
const coordinationProfileToolPrefix = `${coordinationMcpAlias.replaceAll("-", "_")}_`;
const coordinationVerbNameSet$1 = new Set(coordinationVerbNames);
/** Bare Runtime tool names explicitly enabled by one exact profile. */
function declaredRuntimeToolNames(profile) {
	const names = Object.entries(profile.tools ?? {}).filter(([name, enabled]) => enabled === true && name.startsWith(coordinationProfileToolPrefix)).map(([name]) => name.slice(coordinationProfileToolPrefix.length));
	return Object.freeze([...new Set(names)].sort());
}
/** Describe Runtime declarations that cannot resolve without a product tool provider. */
function runtimeToolDeclarationError(profile, hasProductToolResolver, mountedStaticToolNames = []) {
	const mountedStaticToolNameSet = new Set(mountedStaticToolNames);
	const unresolved = declaredRuntimeToolNames(profile).filter((name) => !coordinationVerbNameSet$1.has(name) && !hasProductToolResolver && !mountedStaticToolNameSet.has(name));
	if (unresolved.length === 0) return void 0;
	return `the profile declares ${unresolved.map((name) => JSON.stringify(`${coordinationProfileToolPrefix}${name}`)).join(", ")}, but this run has no resolveSupervisorTools provider or router-mounted static tool for those tools`;
}
/** Runtime owns this attachment alias. An authored entry would make the provider mount ambiguous. */
function assertNoReservedCoordinationMcpAlias(profile, context) {
	if (profile.mcp?.["agent-runtime-coordination"] === void 0) return;
	throw new ValidationError(`${context}: profile MCP alias ${JSON.stringify(coordinationMcpAlias)} is reserved for Runtime coordination`);
}
/**
* Project one canonical profile to the profile a provider may receive.
*
* The reserved prefix is Runtime-owned in its entirety. A `true` declaration must resolve to a
* mounted Runtime or product descriptor before execution; a `false` declaration grants nothing.
* Neither is a provider-native tool. Stripping the whole namespace keeps a false or refused grant
* from becoming an invented harness capability during strict materialization.
*/
function providerVisibleProfile(profile) {
	if (profile.tools === void 0) return profile;
	const providerTools = Object.fromEntries(Object.entries(profile.tools).filter(([name]) => !name.startsWith(coordinationProfileToolPrefix)));
	if (Object.keys(providerTools).length === Object.keys(profile.tools).length) return profile;
	if (Object.keys(providerTools).length > 0) return {
		...profile,
		tools: providerTools
	};
	const { tools: _runtimeTools, ...withoutTools } = profile;
	return withoutTools;
}
/**
* The instruction lines a canonical `resources.instructions` contributes. A plain string and an
* `inline` resource are their own text; a `github` reference names bytes that live elsewhere and
* cannot be fetched while building a supervisor synchronously — that fails loud rather than
* dropping instructions the profile says the agent runs under (the same rule
* `improve()`'s memory surface applies to the same field).
*/
function resourceInstructionLines(instructions) {
	if (instructions === void 0) return [];
	if (typeof instructions === "string") return instructions.length > 0 ? [instructions] : [];
	if (instructions.kind === "inline") return instructions.content.length > 0 ? [instructions.content] : [];
	throw new ConfigError(`supervisorAgent: profile.resources.instructions is a github resource reference (${JSON.stringify(instructions.path)}), which cannot be fetched while the supervisor is built — pass the instruction text as a string or an inline resource`);
}
/**
* Refuse a best-effort resource policy on the router arm.
*
* The router arm inlines `resources.instructions` into the standing prompt and has no channel that
* could report a resource it skipped. `resources.failOnError: false` asks for the supported subset
* plus a warning about the rest, so this arm cannot honor it. Running such a profile as strict
* would apply a policy the profile did not ask for, which is the silent drop the materialization
* contract exists to prevent.
*/
function assertRouterArmResourcePolicy(profile) {
	if (profile.resources?.failOnError !== false) return;
	throw new ConfigError("supervisorAgent: resources.failOnError: false requests a best-effort resource subset; the router-brained supervisor inlines its resources and reports no skipped resource, so the best-effort policy is refused rather than applied as strict");
}
/**
* The standing instruction both arms run under: `prompt.systemPrompt`, then canonical prompt and
* resource instruction lines.
* `undefined` only when the profile names none at all.
*/
function resolveSupervisorSystemPrompt(profile) {
	const promptSystem = profile.prompt?.systemPrompt;
	const lines = [...profile.prompt?.instructions ?? [], ...resourceInstructionLines(profile.resources?.instructions)];
	if (lines.length === 0) return promptSystem;
	return (promptSystem !== void 0 ? [promptSystem, ...lines] : lines).join("\n");
}
/** Resolve the model after refusing any incomplete execution identity. */
function resolveSupervisorModelId(profile) {
	assertExecutableAgentProfile(profile, "supervisorAgent");
	return concreteProfileModel(profile);
}
/**
* Reduce one canonical executable profile to the scalars the two brain arms consume.
*/
function resolveSupervisorProfile(profile) {
	const exact = agentProfileSchema.parse(profile);
	assertExecutableAgentProfile(exact, "resolveSupervisorProfile");
	const systemPrompt = resolveSupervisorSystemPrompt(exact);
	const modelId = resolveSupervisorModelId(exact);
	return {
		name: exact.name ?? "supervisor",
		harness: agentHarness(exact.harness) ?? null,
		modelId,
		...systemPrompt !== void 0 ? { systemPrompt } : {}
	};
}
/** Validate a manager's coordination authentication and request limits before execution. */
function assertCoordinationBinding(binding) {
	assertCoordinationTransport(binding ?? {});
}
function createVerbSlot() {
	let bound;
	const verb = (name) => async (args) => {
		if (bound === void 0) throw new ValidationError(`supervisorAgent: coordination verb "${name}" was called before this manager's coordination tools were bound`);
		const tool = bound.find((descriptor) => descriptor.name === name);
		if (tool === void 0) throw new ValidationError(`supervisorAgent: coordination verb "${name}" is not mounted on this manager`);
		return tool.handler(args);
	};
	return {
		verbs: Object.freeze({
			spawnAgent: verb("spawn_worker"),
			awaitEvent: verb("await_event"),
			steerAgent: verb("steer_agent"),
			observeAgent: verb("observe_agent"),
			listQuestions: verb("list_questions"),
			answerQuestion: verb("answer_question"),
			runAnalyst: verb("run_analyst"),
			readJournal: verb("read_journal"),
			defineAnalyst: verb("define_analyst")
		}),
		descriptors() {
			if (bound === void 0) throw new ValidationError("supervisorAgent: coordinationTools() was called before this manager's coordination tools were bound");
			return Object.freeze(bound.map(({ name, description, inputSchema }) => Object.freeze({
				name,
				description,
				inputSchema
			})));
		},
		bind(tools) {
			bound = tools;
		}
	};
}
const ROUTER_TRANSPORT_FIELDS = /* @__PURE__ */ new Set([
	"routerBaseUrl",
	"routerKey",
	"complete"
]);
/** Capture the transport-only Router seam before any profile lowering. TypeScript excess-property
* checks are not a runtime boundary: JavaScript and widened objects can otherwise smuggle private
* generation/retry fields through a spread and override an AgentProfile that omitted them. */
function snapshotRouterTransportConfig(input) {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ValidationError("supervisorAgent: deps.router must be a RouterTransportConfig object");
	const unsupported = Object.keys(input).filter((field) => !ROUTER_TRANSPORT_FIELDS.has(field));
	if (unsupported.length > 0) throw new ValidationError(`supervisorAgent: deps.router contains unsupported behavioral fields: ${unsupported.sort().join(", ")}`);
	if (typeof input.routerBaseUrl !== "string" || input.routerBaseUrl.length === 0) throw new ValidationError("supervisorAgent: deps.router.routerBaseUrl must be a non-empty string");
	if (typeof input.routerKey !== "string" || input.routerKey.length === 0) throw new ValidationError("supervisorAgent: deps.router.routerKey must be a non-empty string");
	if (input.complete !== void 0 && typeof input.complete !== "function") throw new ValidationError("supervisorAgent: deps.router.complete must be a function when provided");
	return Object.freeze({
		routerBaseUrl: input.routerBaseUrl,
		routerKey: input.routerKey,
		...input.complete !== void 0 ? { complete: input.complete } : {}
	});
}
/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness`
* (backend-as-data), the same resolution rule as every worker. */
function supervisorAgent(profile, deps) {
	if ("brain" in deps) throw new ValidationError("supervisorAgent: direct brain injection is test-only; production execution derives the model call from AgentProfile");
	return buildSupervisorAgent(profile, deps);
}
/** Scripted-brain construction for deterministic tests. Not exported from Runtime's main entry. */
function supervisorAgentWithTestBrain(profile, deps) {
	const { brain, ...runtimeDeps } = deps;
	return buildSupervisorAgent(profile, runtimeDeps, brain);
}
function buildSupervisorAgent(profile, deps, testBrain) {
	const exactProfile = agentProfileSchema.parse(profile);
	assertExecutableAgentProfile(exactProfile, "supervisorAgent");
	const stableProfile = detachedSnapshot(exactProfile, "supervisorAgent profile");
	const stableRouter = deps.router === void 0 ? void 0 : snapshotRouterTransportConfig(deps.router);
	const resolveTools = deps.resolveSupervisorTools;
	assertNoReservedCoordinationMcpAlias(stableProfile, "supervisorAgent");
	const harness = agentHarness(stableProfile.harness) ?? null;
	const runtimeToolError = runtimeToolDeclarationError(stableProfile, resolveTools !== void 0, harness === null ? deps.extraTools?.map((tool) => tool.name) : void 0);
	if (runtimeToolError !== void 0) throw new ValidationError(`supervisorAgent: ${runtimeToolError}`);
	const observeNodeEvent = deps.observeNodeEvent;
	const nodeContextSeed = deps.nodeContext === void 0 ? void 0 : detachedSnapshot(deps.nodeContext, "supervisorAgent node context");
	if ((resolveTools || observeNodeEvent) && !nodeContextSeed) throw new ValidationError("supervisorAgent: nodeContext is required with resolveSupervisorTools or observeNodeEvent");
	const name = stableProfile.name ?? "supervisor";
	const profilePrompt = resolveSupervisorSystemPrompt(stableProfile);
	const runtimeToolNames = declaredRuntimeToolNames(stableProfile);
	const coordination = deps.coordination ? { ...deps.coordination } : void 0;
	assertCoordinationBinding(coordination);
	if (harness === null && coordination !== void 0) throw new ConfigError("supervisorAgent: coordination binding is only meaningful for a harness-brained supervisor (profile.harness set). A router-brained supervisor calls the coordination verbs in process and serves no MCP, so this binding would be silently ignored.");
	if (harness === null && deps.peerMail) throw new ValidationError("supervisorAgent: peerMail is only served by a harness-brained supervisor (profile.harness set). A router-brained supervisor serves no coordination MCP listener, so there is no peer-mail post office to mint worker capabilities from.");
	if (harness !== null && deps.compaction) throw new ValidationError("supervisorAgent: compaction is only supported for router-brained supervisors (profile.harness omitted or cli-base)");
	if (harness === null && deps.continuation !== void 0) throw new ValidationError("supervisorAgent: continuation applies to an EXTERNAL-harness supervisor only (profile.harness set). A router-brained supervisor runs its own turn loop in process, so the policy would be silently ignored.");
	if (deps.continuation !== void 0 && deps.deliverable === void 0) throw new ValidationError("supervisorAgent: continuation needs a `deliverable` completion check — with no check there is no contract that can be unmet");
	if (harness !== null && deps.deliverable !== void 0 && deps.continuation === void 0) throw new ValidationError("supervisorAgent: a manager with a completion check needs a continuation policy (deadline, maxBarren, the note profile and switches). Runtime supplies no default: how long to send a director back, and what to tell it, is the record's decision");
	if (deps.deliverable !== void 0 && runtimeToolNames.includes("stop")) throw new ValidationError(`supervisorAgent: the profile grants ${coordinationProfileToolPrefix}stop to a manager with a completion check. Such a manager ends only through submit_result (the check passes) or report_blocked (a failed probe); remove stop from its tools`);
	const continuationDeadlineMs = deps.continuation === void 0 ? void 0 : admitContinuationPolicy(deps.continuation, "supervisorAgent");
	if (harness === null) {
		assertRouterArmResourcePolicy(stableProfile);
		const brain = testBrain ?? routerBrainFromProfile(stableProfile, stableRouter);
		const inbox = createInbox();
		const transcript = createRouterTranscript();
		const build = (priorCoordination, nodeTools, onEvent, slot) => driverAgent({
			name,
			brain,
			transcript,
			...testBrain === void 0 ? { expectedModel: resolveSupervisorModelId(stableProfile) } : {},
			...deps.onProviderModel ? { onProviderModel: deps.onProviderModel } : {},
			blobs: deps.blobs,
			makeWorkerAgent: deps.makeWorkerAgent,
			...deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {},
			perWorker: deps.perWorker,
			...deps.preserveOwnerTurns ? { preserveOwnerTurns: true } : {},
			systemPrompt: resolveSupervisorSystemPrompt(stableProfile) ?? "",
			...deps.deliverable ? { deliverable: deps.deliverable } : {},
			...deps.onAcceptedSubmission ? { onAcceptedSubmission: deps.onAcceptedSubmission } : {},
			toolNames: runtimeToolNames,
			...nodeTools?.length ? { nodeTools } : {},
			...deps.extraTools ? { extraTools: deps.extraTools } : {},
			...deps.executeExtraTool ? { executeExtraTool: deps.executeExtraTool } : {},
			...deps.analysts ? { analysts: deps.analysts } : {},
			...deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {},
			...deps.escalateQuestion ? { escalateQuestion: deps.escalateQuestion } : {},
			...deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {},
			...deps.stallAfterMs !== void 0 ? { stallAfterMs: deps.stallAfterMs } : {},
			...deps.awaitTimeoutMs !== void 0 ? { awaitTimeoutMs: deps.awaitTimeoutMs } : {},
			...deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {},
			...deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {},
			...deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {},
			...deps.composeSpawnProfile ? { composeSpawnProfile: deps.composeSpawnProfile } : {},
			...deps.profiles ? { profiles: deps.profiles } : {},
			...deps.spawnResourceRoot ? { spawnResourceRoot: deps.spawnResourceRoot } : {},
			...deps.spawnResourceReader ? { spawnResourceReader: deps.spawnResourceReader } : {},
			...deps.stopRule ? { stopRule: deps.stopRule } : {},
			...deps.onProgressStop ? { onProgressStop: deps.onProgressStop } : {},
			...deps.maxTurns !== void 0 ? { maxTurns: deps.maxTurns } : {},
			...deps.compaction ? { compaction: deps.compaction } : {},
			...onEvent ? { onEvent } : {},
			...deps.replaySettlements ? { replaySettlements: true } : {},
			...priorCoordination ? { priorCoordination } : {},
			...deps.finalizer ? { finalizer: deps.finalizer } : {},
			...slot ? { onCoordinationTools: (tools) => slot.bind(tools) } : {},
			...deps.controlDir === void 0 ? {} : { controlDir: deps.controlDir },
			...deps.steerDir === void 0 ? {} : { steerDir: deps.steerDir },
			...deps.controlScope === void 0 ? {} : { controlScope: deps.controlScope },
			...deps.abortRun ? { abortRun: deps.abortRun } : {},
			inbox
		});
		if (!deps.loadPriorCoordination && !resolveTools && !observeNodeEvent) return build(deps.priorCoordination, void 0, deps.onEvent);
		return {
			name,
			deliver(message) {
				return inbox.deliver(message);
			},
			harnessTranscript: () => transcript.capture(),
			async act(task, scope) {
				const context = nodeContextSeed ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope) : void 0;
				const priorCoordination = await deps.loadPriorCoordination?.();
				const slot = createVerbSlot();
				const nodeTools = resolveTools && context ? await bindSupervisorTools(resolveTools, context, scope.signal, slot) : void 0;
				const onEvent = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent);
				return build(priorCoordination, nodeTools, onEvent, slot).act(task, scope);
			}
		};
	}
	const driveHarness = deps.driveHarness;
	if (!driveHarness) throw new ValidationError(`supervisorAgent: profile.harness="${harness}" needs deps.driveHarness (how to run the harness with the coordination MCP mounted)`);
	const deliver = driveHarness.deliver?.bind(driveHarness);
	const rawDeliverReady = driveHarness.deliverReady;
	if (rawDeliverReady !== void 0 && typeof rawDeliverReady !== "function") throw new ValidationError("supervisorAgent: driveHarness.deliverReady must be a function when provided");
	const deliverReady = rawDeliverReady?.bind(driveHarness);
	const externalAgent = {
		name,
		...deliver ? { deliver(message) {
			return deliver(message);
		} } : {},
		traceSource: () => driveHarness.traceSource?.(),
		progress: () => driveHarness.progress?.(),
		...driveHarness.harnessTranscript ? { harnessTranscript: () => driveHarness.harnessTranscript?.() } : {},
		async act(task, scope) {
			const context = nodeContextSeed ? supervisorNodeContext(nodeContextSeed, stableProfile, task, scope) : void 0;
			const priorCoordination = deps.loadPriorCoordination ? await deps.loadPriorCoordination() : deps.priorCoordination;
			const slot = createVerbSlot();
			const nodeTools = resolveTools && context ? await bindSupervisorTools(resolveTools, context, scope.signal, slot) : void 0;
			const nodeObserver = bindSupervisorNodeObserver(context, observeNodeEvent, deps.onEvent);
			const stopController = new AbortController();
			const coordinationLifetime = linkAbort(scope.signal);
			let harnessInvocationActive = false;
			const tracker = deps.stopRule ? createProgressTracker({ now: Date.now }) : void 0;
			let progressStopReason;
			let ledger;
			const rule = deps.stopRule;
			const onEvent = tracker && rule ? async (event, record) => {
				await nodeObserver?.(event, record);
				if (event.type !== "settled") return;
				if (ledger === void 0) throw new ValidationError("supervisorAgent: a worker settled before the coordination server was bound");
				const decision = progressStop(tracker, rule, ledger, scope, Date.now, deps.stallAfterMs);
				if (!decision.stop || progressStopReason !== void 0) return;
				progressStopReason = decision.reason;
				deps.onProgressStop?.(decision.reason);
				if (!stopController.signal.aborted) stopController.abort(decision.reason);
			} : nodeObserver;
			let keeper;
			const { handle: mcp, controls } = await serveCoordinationMcpForManager({
				scope,
				blobs: deps.blobs,
				makeWorkerAgent: deps.makeWorkerAgent,
				...deps.authorizeDownMessage ? { authorizeDownMessage: deps.authorizeDownMessage } : {},
				perWorker: deps.perWorker,
				...coordination ?? {},
				...context ? { identity: {
					runId: context.runNamespace,
					actorId: context.ownerId
				} } : {},
				...deps.deliverable ? { deliverable: deps.deliverable } : {},
				...deps.continuation ? { readContinuation: (n) => keeper?.read(n) ?? {
					found: false,
					reason: "no continuation has been sent"
				} } : {},
				onStop: (reason) => {
					if (!stopController.signal.aborted) stopController.abort(reason ?? "coordination stop");
				},
				...deps.analysts ? { analysts: deps.analysts } : {},
				...deps.analyzeOnSettle ? { analyzeOnSettle: deps.analyzeOnSettle } : {},
				...deps.escalateQuestion ? { escalateQuestion: deps.escalateQuestion } : {},
				...deps.watchWorkers ? { watchWorkers: deps.watchWorkers } : {},
				...deps.stallAfterMs !== void 0 ? { stallAfterMs: deps.stallAfterMs } : {},
				...deps.continuityByProfile ? { continuityByProfile: deps.continuityByProfile } : {},
				onEvent: async (event, record) => {
					await runAbortable(async () => {
						await onEvent?.(event, record);
					}, coordinationLifetime.signal, "supervisor coordination stopped");
				},
				...deps.replaySettlements ? { replaySettlements: true } : {},
				...deps.preflightSpawn ? { preflightSpawn: deps.preflightSpawn } : {},
				...deps.resolveSpawnProfile ? { resolveSpawnProfile: deps.resolveSpawnProfile } : {},
				...deps.composeSpawnProfile ? { composeSpawnProfile: deps.composeSpawnProfile } : {},
				...deps.profiles ? { profiles: deps.profiles } : {},
				...deps.spawnResourceRoot ? { spawnResourceRoot: deps.spawnResourceRoot } : {},
				...deps.spawnResourceReader ? { spawnResourceReader: deps.spawnResourceReader } : {},
				...deps.peerMail ? { peerMail: deps.peerMail } : {},
				...priorCoordination?.questions.length ? { priorQuestions: priorCoordination.questions } : {},
				...priorCoordination?.escalations?.length ? { priorEscalations: priorCoordination.escalations } : {},
				...priorCoordination?.records.length ? { priorJournal: priorCoordination.records } : {},
				...priorCoordination?.analystDefinitions?.length ? { priorAnalystDefinitions: priorCoordination.analystDefinitions } : {},
				...nodeTools?.length ? { nodeTools } : {},
				toolNames: runtimeToolNames,
				onCoordinationTools: (tools) => slot.bind(tools)
			}, coordinationLifetime.signal).catch((error) => {
				coordinationLifetime.abort(error);
				throw error;
			});
			ledger = mcp;
			const coordinationTools = slot.descriptors();
			const providerProfile = detachedSnapshot(providerVisibleProfile(stableProfile), "supervisorAgent provider-visible profile");
			let controlObserver;
			try {
				if (deps.controlDir !== void 0 || deps.steerDir !== void 0) controlObserver = observeWorkerControls({
					...deps.controlDir === void 0 ? {} : { dir: deps.controlDir },
					...deps.steerDir === void 0 ? {} : { steerDir: deps.steerDir },
					coord: controls,
					scope,
					signal: coordinationLifetime.signal,
					controlScope: deps.controlScope ?? "run",
					...deps.controlScope === "subtree" ? {} : {
						deliverRoot: (message) => deliver?.(message) ?? false,
						deliverRootReady: () => deliver === void 0 || harnessInvocationActive && (deliverReady === void 0 || deliverReady())
					},
					onError: (error) => {
						coordinationLifetime.abort(error);
						stopController.abort(error);
					}
				});
				const recoveredSubmission = mcp.submittedResult();
				if (recoveredSubmission) {
					deps.onAcceptedSubmission?.(recoveredSubmission.result);
					return recoveredSubmission.result;
				}
				const baseTokensLeft = scope.budget.tokensLeft;
				const contractDeclared = deps.deliverable !== void 0;
				const continuation = deps.continuation;
				if (continuation !== void 0 && deps.deliverable !== void 0) keeper = createContinuationKeeper({
					policy: continuation,
					task,
					...deps.deliverable.describe === void 0 ? {} : { owed: deps.deliverable.describe },
					...deps.deliverable.feedback === void 0 ? {} : { feedback: deps.deliverable.feedback },
					...deps.deliverable.sealed === true ? { sealed: true } : {},
					reads: () => controls.checkReads(),
					workers: () => {
						const labels = new Map((scope.view?.nodes ?? []).map((node) => [node.id, node.label]));
						return mcp.settled().map((worker) => ({
							id: worker.id,
							label: labels.get(worker.id) ?? worker.id
						}));
					},
					...deps.continuationDir === void 0 ? {} : { dir: deps.continuationDir },
					traces: () => {
						const rootStreamPath = deps.rootStreamPath;
						return runTraceAnalysisStore({
							...rootStreamPath === void 0 ? {} : { root: {
								id: scope.view.root,
								read: () => readRootStream(dirname(rootStreamPath))
							} },
							workers: mcp.settled(),
							blobs: deps.blobs
						});
					},
					canReadMore: runtimeToolNames.includes("read_continuation")
				});
				let candidate;
				const finalizerDeliverable = deps.deliverable === void 0 ? void 0 : {
					...deps.deliverable,
					check: async (out) => {
						let verdict;
						try {
							verdict = checkVerdictOf(await deps.deliverable?.check(out));
						} catch (error) {
							controls.recordCheckRead({
								source: "turn-end",
								unavailable: error instanceof Error ? error.message : String(error)
							});
							throw error;
						}
						controls.recordCheckRead({
							source: "turn-end",
							verdict
						});
						return verdict;
					}
				};
				const finalize = () => runFinalizer(deps.finalizer ?? bestDelivered, {
					settled: mcp.settled(),
					blobs: deps.blobs,
					tree: runTree(scope),
					budget: scope.budget,
					...finalizerDeliverable ? { deliverable: finalizerDeliverable } : {}
				});
				const readProgress = () => {
					const settled = mcp.settled();
					const deliveredCount = settled.filter((w) => w.status === "done" && w.valid === true).length;
					const submitted = Boolean(mcp.submittedResult());
					const composite = bestComposite(controls.checkReads());
					return {
						poolTokensSpent: baseTokensLeft - scope.budget.tokensLeft,
						settledCount: settled.length,
						submitted,
						deliveredCount,
						contract: !contractDeclared ? "none" : submitted || candidate !== void 0 ? "met" : "unmet",
						...composite === void 0 ? {} : { composite }
					};
				};
				/**
				* The check runs when a turn ends without an accepted result. A read already taken in this
				* turn stands (the manager just heard it); otherwise a check that judges state reads the
				* run now. A check that could not run is not a verdict: the loop pauses.
				*/
				const readCheckAtTurnEnd = async (attempt) => {
					const deliverable = deps.deliverable;
					if (deliverable === void 0) return;
					const last = controls.checkReads().filter((read) => read.attempt === attempt).at(-1);
					if (last === void 0 && deliverable.checkState !== void 0) try {
						const verdict = checkVerdictOf(await deliverable.checkState());
						controls.recordCheckRead({
							source: "turn-end",
							verdict
						});
						return;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						controls.recordCheckRead({
							source: "turn-end",
							unavailable: message
						});
						throw new CheckUnavailableError(`the completion check could not run: ${message}`, { cause: error });
					}
					if (last?.unavailable !== void 0) throw new CheckUnavailableError(`the completion check could not run: ${last.unavailable}`);
				};
				const loopRecords = [];
				let environmentReplacements = 0;
				let workspaceRestores = 0;
				const describe = deps.deliverable?.describe;
				const settleLoop = () => {
					const stopReason = controls.stopReason() ?? progressStopReason;
					const closedBy = mcp.submittedResult() ? "result-accepted" : controls.blocked() !== void 0 ? "blocked" : mcp.isStopped() ? "stop" : progressStopReason !== void 0 ? "stop-rule" : void 0;
					deps.onDriverLoopSettled?.({
						...summarizeDriverAttempts(loopRecords),
						environmentReplacements,
						workspaceRestores,
						...closedBy === void 0 ? {} : { closedBy },
						...stopReason === void 0 ? {} : { stopReason },
						continuations: keeper?.entries() ?? []
					});
				};
				try {
					await runDriverWithRetry({
						drive: async (attempt, reentry) => {
							candidate = void 0;
							if (deps.controlDir !== void 0 && deps.abortRun !== void 0) applyRunCancellation(deps.controlDir, deps.abortRun, () => (/* @__PURE__ */ new Date()).toISOString());
							scope.signal.throwIfAborted();
							beginScopeOwnerAttempt(scope, attempt);
							controls.beginDriverAttempt(attempt);
							const compose = reentry === void 0 ? void 0 : (continuity) => composeReentryTask({
								originalTask: task,
								...describe === void 0 ? {} : { contract: describe },
								reentry,
								continuity,
								state: controls.reentryState(),
								attempt
							});
							harnessInvocationActive = true;
							let completed = false;
							try {
								await driveHarness({
									profile: providerProfile,
									authoredProfile: stableProfile,
									...profilePrompt !== void 0 ? { systemPrompt: profilePrompt } : {},
									task: compose === void 0 ? task : compose(UNPROVEN_CONTINUITY),
									...compose === void 0 ? {} : { reentry: {
										compose,
										onContinuity: (continuity) => {
											if (continuity.environment === "replaced") environmentReplacements += 1;
											if (continuity.workspace === "restored") workspaceRestores += 1;
										}
									} },
									scope,
									coordinationMcpUrl: mcp.url,
									coordinationMcpHeaders: mcp.headers,
									stopSignal: stopController.signal,
									coordinationTools
								});
								completed = true;
							} catch (error) {
								if (!mcp.submittedResult() && !mcp.isStopped()) throw error;
								completed = true;
							} finally {
								harnessInvocationActive = false;
								if (completed) await controls.endDriverAttempt("completed");
								else await controls.endDriverAttempt("failed").catch(() => void 0);
							}
							if (contractDeclared && !mcp.submittedResult()) {
								await mcp.drainResolved();
								candidate = await finalize();
								if (candidate === void 0 && !mcp.isStopped()) await readCheckAtTurnEnd(attempt);
							}
						},
						progress: readProgress,
						budget: () => scope.budget,
						signal: scope.signal,
						...deps.driverRetry ? { policy: deps.driverRetry } : {},
						...continuation !== void 0 && keeper !== void 0 && continuationDeadlineMs ? { continuation: {
							maxBarren: continuation.maxBarren,
							deadlineMs: continuationDeadlineMs,
							compose: (context) => keeper.compose(context),
							closed: () => mcp.isStopped() || progressStopReason !== void 0
						} } : {},
						onAttempt: async (record) => {
							loopRecords.push(record);
							if (record.classification === "unavailable" && record.retryInMs !== void 0) await recordScopeOwnerPause(scope, {
								attempt: record.attempt,
								signal: record.unavailableSignal ?? "unavailable",
								cause: record.error ?? "",
								attemptMs: record.durationMs,
								pauseMs: record.retryInMs,
								madeProgress: record.madeProgress
							});
							await deps.onDriverAttempt?.(record);
						}
					});
				} finally {
					settleLoop();
				}
				if (!contractDeclared) await mcp.drainResolved();
				const submitted = mcp.submittedResult();
				if (submitted) {
					deps.onAcceptedSubmission?.(submitted.result);
					return submitted.result;
				}
				return contractDeclared ? candidate : await finalize();
			} finally {
				coordinationLifetime.abort(/* @__PURE__ */ new Error("supervisor manager stopped"));
				try {
					await controlObserver?.close();
				} finally {
					await mcp.close();
				}
			}
		}
	};
	const runtime = runtimeOwnedScopeOwnerRuntime(driveHarness);
	return runtime === void 0 ? externalAgent : attestRuntimeOwnedScopeOwner(externalAgent, runtime);
}
function supervisorNodeContext(seed, profile, task, scope) {
	return detachedSnapshot({
		...seed,
		nodeId: scope.view.root,
		profile,
		task
	}, "supervisorAgent trusted node context");
}
async function bindSupervisorTools(resolveTools, context, signal, slot) {
	const resolved = await resolveTools(context);
	if (!Array.isArray(resolved)) throw new ValidationError("supervisorAgent: resolveSupervisorTools must return an array");
	const invocationContext = Object.freeze({
		...context,
		signal,
		verbs: slot.verbs,
		coordinationTools: slot.descriptors
	});
	const names = new Set(coordinationVerbNames);
	return Object.freeze(resolved.map((rawTool, index) => {
		if (typeof rawTool !== "object" || rawTool === null || Array.isArray(rawTool)) throw new ValidationError(`supervisorAgent: resolved tool at index ${index} must be a descriptor`);
		const { name, description, inputSchema, handler } = rawTool;
		if (typeof name !== "string" || name.length === 0) throw new ValidationError(`supervisorAgent: resolved tool at index ${index} needs a non-empty name`);
		if (names.has(name)) throw new ValidationError(`supervisorAgent: resolved tool "${name}" collides with a coordination verb or another resolved tool`);
		names.add(name);
		if (typeof description !== "string" || description.length === 0) throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs a description`);
		if (typeof inputSchema !== "object" || inputSchema === null || Array.isArray(inputSchema)) throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs an inputSchema`);
		if (typeof handler !== "function") throw new ValidationError(`supervisorAgent: resolved tool "${name}" needs a handler`);
		const descriptor = detachedSnapshot({
			name,
			description,
			inputSchema
		}, `supervisorAgent resolved tool ${JSON.stringify(name)}`);
		return Object.freeze({
			...descriptor,
			handler: (raw) => handler(detachedSnapshot(raw, `supervisorAgent tool ${JSON.stringify(name)} input`), invocationContext)
		});
	}));
}
function bindSupervisorNodeObserver(context, observeNodeEvent, onEvent) {
	if (!observeNodeEvent && !onEvent) return void 0;
	return async (event, record) => {
		if (observeNodeEvent) {
			if (!context) throw new ValidationError("supervisorAgent: observeNodeEvent has no trusted node context");
			await observeNodeEvent(context, event, record);
		}
		await onEvent?.(event, record);
	};
}
function routerBrainFromProfile(profile, router) {
	if (!router) throw new ValidationError("supervisorAgent: a router-brained supervisor (harness omitted or cli-base) needs deps.router");
	const modelId = resolveSupervisorModelId(profile);
	const settings = profileModelExecutionSettings(profile, "supervisorAgent");
	return routerBrain({
		routerBaseUrl: router.routerBaseUrl,
		routerKey: router.routerKey,
		...router.complete !== void 0 ? { complete: router.complete } : {},
		model: modelId,
		...settings.retry !== void 0 ? { retry: settings.retry } : {},
		...enforceTokenLimits(settings.tokenLimits, "router", "supervisorAgent").applied,
		...settings.stream !== void 0 ? { stream: settings.stream } : {}
	}, {
		...settings.temperature !== void 0 ? { temperature: settings.temperature } : {},
		...settings.seed !== void 0 ? { seed: settings.seed } : {},
		...settings.toolChoice !== void 0 ? { toolChoice: settings.toolChoice } : {},
		...settings.extraBody !== void 0 ? { extraBody: settings.extraBody } : {},
		...profile.model?.reasoningEffort ? { reasoningEffort: profile.model.reasoningEffort } : {}
	});
}
//#endregion
//#region src/runtime/supervise/worker-retry.ts
/**
* WORKER-SPAWN RETRY — the second chance `driverRetry` gives the root, given to a leaf.
*
* `driverRetry` guards the root and nothing else. A worker that dies is typed into a `down`
* settlement, which is the right shape when the worker RAN. It is the wrong shape when the worker
* never started, and one failure produces exactly that:
*
*   bridgeExecutor: bridge stream error: host-executor: acquire timeout after 60000ms
*   (in_flight=4/4, queued=1)
*
* Measured 2026-08-22 on discovery-lab cells oscnp s2/s3: two live cells held 2 leads and up to 8
* workers on one bridge whose host executor caps live harness children at 4. A worker spawn that
* queued past the bridge's single 60 s acquire deadline died there, and the run lost that worker
* permanently even though a slot freed seconds later. The bridge retries nothing.
*
* Retrying execution is dangerous by default, so this seam is FAIL-CLOSED on two independent
* proofs that the attempt did no work:
*
*  1. The error carries a PRE-SPAWN signature — a refusal the backend emits before the harness
*     child or the box exists ({@link isPreSpawnExecutorFailure}). No provider call started.
*  2. The attempt yielded NO execution event. An attempt that streamed anything may have metered
*     usage, and a blind re-run would double-spend, so it stays fatal whatever its message says.
*
* Either proof missing means no retry. This is deliberately NARROWER than "is this an
* infrastructure hiccup": `ECONNRESET` is a transient transport failure and is NOT retried here,
* because it can arrive mid-stream after a metered call.
*
* Re-entry re-invokes `execute` on the SAME executor object. Nothing is rebuilt, so the executor's
* runtime-owned materialization attestation, its bound session id, and its inbox are all the ones
* the kernel admitted. For the bridge backend a second `execute` is a fresh session stream over the
* same durable execution id, and a saturation refusal happens before that session's child spawned.
*
* @experimental
*/
/**
* The backend refusals that are emitted BEFORE any child process, box, or provider request exists.
*
* Each is a queue admission deadline: the executor asked for a slot, waited, and was refused
* without anything being started. The three names are the pools cli-bridge and the container host
* admit through — the host executor, one scoped per-run host executor, and the container pool.
*
* The pattern is anchored to the whole phrase, including the `after <n>ms` deadline, so a message
* that merely mentions a queue does not qualify.
*/
const PRE_SPAWN_SIGNATURES = Object.freeze([/\b(?:host-executor|scoped-host-executor|container-pool): acquire timeout after \d+ms\b/u]);
const DEFAULT_MAX_TOTAL_MS = 9e5;
const DEFAULT_INITIAL_BACKOFF_MS = 5e3;
const DEFAULT_MAX_BACKOFF_MS = 6e4;
/**
* True when `error` is a backend refusal issued before anything ran.
*
* This answers "did this fail BEFORE any provider call", which is a strictly narrower question
* than "is this an infrastructure hiccup". The broader question admits `ECONNRESET` and a bare
* `fetch failed`, both of which can arrive after a metered call, and answering the broad question
* where the narrow one is required is what makes a retry double-spend.
*/
function isPreSpawnExecutorFailure(error, additionalSignatures = []) {
	const message = error instanceof Error ? error.message : String(error);
	for (const signature of PRE_SPAWN_SIGNATURES) if (signature.test(message)) return true;
	for (const signature of additionalSignatures) if (signature.test(message)) return true;
	return false;
}
/** Read the policy, refusing a number a run cannot act on rather than silently clamping it. */
function resolveWorkerSpawnRetry(policy) {
	if (policy === void 0 || policy.enabled === false) return void 0;
	const maxTotalMs = policy.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
	const initialBackoffMs = policy.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
	const maxBackoffMs = policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
	for (const [name, value] of [
		["maxTotalMs", maxTotalMs],
		["initialBackoffMs", initialBackoffMs],
		["maxBackoffMs", maxBackoffMs]
	]) if (!Number.isFinite(value) || value < 0) throw new ValidationError(`workerRetry.${name} must be a nonnegative finite number of milliseconds`);
	const signatures = policy.additionalPreSpawnSignatures ?? [];
	for (const signature of signatures) if (!(signature instanceof RegExp)) throw new ValidationError("workerRetry.additionalPreSpawnSignatures must contain RegExp values");
	return Object.freeze({
		maxTotalMs,
		initialBackoffMs,
		maxBackoffMs: Math.max(initialBackoffMs, maxBackoffMs),
		signatures: Object.freeze([...signatures])
	});
}
/**
* Wrap a worker seam so a leaf whose spawn is refused before it runs is re-entered instead of
* settling dead.
*
* The wrapper composes the agent's `executorFactory`, which is where a leaf executor is built with
* the real child signal and node context, and it never replaces the executor object the factory
* returned: the retry lives in one `execute` wrapper that carries the inner executor's attestation
* forward and delegates every other surface to it.
*/
function withWorkerSpawnRetry(make, policy, hooks = {}) {
	const resolved = resolveWorkerSpawnRetry(policy);
	if (resolved === void 0) return make;
	return (profile, spawnContext) => {
		const agent = make(profile, spawnContext);
		const spec = agent.executorSpec;
		if (spec === void 0) return agent;
		const seamHooks = {
			...hooks,
			...typeof profile.name === "string" ? { worker: profile.name } : {}
		};
		if (spec.executorFactory !== void 0) {
			const innerFactory = spec.executorFactory;
			const executorFactory = (builtSpec, ctx) => retryPreSpawnRefusals(innerFactory(builtSpec, ctx), resolved, seamHooks);
			return {
				...agent,
				executorSpec: {
					...spec,
					executorFactory
				}
			};
		}
		if (spec.executor !== void 0) {
			const executor = retryPreSpawnRefusals(spec.executor, resolved, seamHooks);
			return {
				...agent,
				executorSpec: {
					...spec,
					executor
				}
			};
		}
		return agent;
	};
}
/**
* Re-enter `execute` on one executor while a pre-spawn refusal keeps proving nothing ran.
*
* Exported so an owner of `makeLeafAgent` — which builds its own executors — gets the same seam
* without reimplementing the two proofs.
*/
function retryPreSpawnRefusals(inner, policy, hooks = {}) {
	const now = hooks.now ?? Date.now;
	const sleep = hooks.sleep ?? defaultSleep;
	/** The wait before the next attempt, or `null` when this failure stays fatal. */
	const nextWait = (error, attempt, yielded, startedAt, signal) => {
		if (yielded) return null;
		if (signal?.aborted) return null;
		if (!isPreSpawnExecutorFailure(error, policy.signatures)) return null;
		const backoff = Math.min(policy.maxBackoffMs, policy.initialBackoffMs * 2 ** (attempt - 1));
		if (now() - startedAt + backoff >= policy.maxTotalMs) return null;
		return backoff;
	};
	const report = (error, attempt, waitMs) => {
		hooks.onRetry?.({
			attempt,
			waitMs,
			...hooks.worker === void 0 ? {} : { worker: hooks.worker },
			error: error instanceof Error ? error.message : String(error)
		});
	};
	const wrapped = {
		runtime: inner.runtime,
		...inner.budgetExempt !== void 0 ? { budgetExempt: inner.budgetExempt } : {},
		...inner.deliver ? { deliver: (message) => inner.deliver?.(message) } : {},
		...inner.progress ? { progress: () => inner.progress?.() } : {},
		...inner.traceSource ? { traceSource: () => inner.traceSource?.() } : {},
		...inner.metered ? { metered: () => inner.metered?.() } : {},
		...inner.harnessTranscript ? { harnessTranscript: () => inner.harnessTranscript?.() } : {},
		...inner.interactive === void 0 ? {} : { interactive: () => interactiveOf(inner) },
		execute(task, signal) {
			const first = inner.execute(task, signal);
			const restart = () => inner.execute(task, signal);
			return isAsyncIterable$1(first) ? retryStream(first, restart, signal) : retryOneShot(first, restart, signal);
		},
		teardown: (grace) => inner.teardown(grace),
		...teardownSurfaces(inner),
		resultArtifact: () => inner.resultArtifact()
	};
	async function* retryStream(first, restart, signal) {
		const startedAt = now();
		let execution = first;
		for (let attempt = 1;; attempt += 1) {
			let yielded = false;
			try {
				for await (const event of execution) {
					yielded = true;
					yield event;
				}
				return;
			} catch (error) {
				const waitMs = nextWait(error, attempt, yielded, startedAt, signal);
				if (waitMs === null) throw error;
				report(error, attempt, waitMs);
				await sleep(waitMs, signal);
				const next = restart();
				if (!isAsyncIterable$1(next)) throw new ValidationError("retryPreSpawnRefusals: executor changed execution shape between attempts");
				execution = next;
			}
		}
	}
	async function retryOneShot(first, restart, signal) {
		const startedAt = now();
		let execution = first;
		for (let attempt = 1;; attempt += 1) try {
			return await execution;
		} catch (error) {
			const waitMs = nextWait(error, attempt, false, startedAt, signal);
			if (waitMs === null) throw error;
			report(error, attempt, waitMs);
			await sleep(waitMs, signal);
			const next = restart();
			if (isAsyncIterable$1(next)) throw new ValidationError("retryPreSpawnRefusals: executor changed execution shape between attempts");
			execution = next;
		}
	}
	return inheritRuntimeOwnedExecutorAttestation(inner, wrapped);
}
/** Forward the inner executor's interactive contract exactly. The method is present only when the
*  inner executor implements it, so the reachable call always has one to delegate to. */
function interactiveOf(inner) {
	if (inner.interactive === void 0) throw new ValidationError("retryPreSpawnRefusals: inner executor exposes no interactive session");
	return inner.interactive();
}
function isAsyncIterable$1(value) {
	return value !== null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
}
/** The wait stays REF'd: a worker waiting out a saturated executor is live work, and an unref'd
*  timer lets the process exit mid-backoff when nothing else is pending. */
function defaultSleep(ms, signal) {
	if (ms <= 0 || signal?.aborted) return Promise.resolve();
	return sleep(ms, signal);
}
//#endregion
//#region src/runtime/supervise/supervise.ts
/**
* `supervise` — the one-call "just invoke the supervisor". Builds + runs a supervisor from its
* profile with sensible defaults, so the common case is `supervise(profile, task, { backend, budget })`
* instead of hand-wiring `blobs` / `perWorker` / `journal` / `executors` / `maxDepth`. The raw seams
* (`supervisorAgent` + `createSupervisor().run`) stay available for power use.
*
* `workerFromBackend` derives the worker seam (`makeWorkerAgent`) from a backend config + an optional
* completion oracle — so "where the workers run" is one data choice, not a hand-rolled factory.
*
* @stable
*/
/**
* Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
* deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
* deliver"). The ONE place a backend becomes a spawnable worker.
*
* `seams` exists because this path builds the leaf executor EAGERLY and hands it back as a BYO
* `executorSpec.executor`. The registry resolves a BYO executor without ever consulting the
* per-child `ExecutorContext` the `Scope` seeds, so anything the scope would have supplied is
* invisible here and has to be passed in. It is a FUNCTION because it is resolved once per worker
* construction, so a caller may hand back something the run only learns later — which is exactly how
* `supervise()` gives a traced run's workers their trace context without ordering the span recorder
* ahead of the worker seam.
*
* Continuity: the `bridge` backend honors `continuity: 'resume'` by session re-attachment. A
* bridge session id IS the harness conversation key (cli-bridge maps it to the CLI's own resume —
* opencode `-s <id>`, claude `--resume`), so this seam records the session id each supervised
* spawn was bound to, keyed by the worker id the Scope assigned, and a resume spawn binds the
* prior worker's recorded session id instead of deriving a fresh one. The record is process-local
* by construction, which matches the kernel's resume boundary (a prior process's workers are not
* resume targets). Every other backend keeps failing loud: their executors have no re-attachable
* session, and accepting the spawn would ledger `continuity: 'resume'` over a brand-new session —
* a stamp asserting something that never happened.
*/
function workerFromBackend(backend, deliverable, seams) {
	const capturedBackend = captureReusableExecutorConfig(backend, "workerFromBackend");
	const unscopedNamespace = randomUUID();
	let unscopedOrdinal = 0;
	const bridgeSessionByWorker = /* @__PURE__ */ new Map();
	return (rawProfile, spawnContext) => {
		const parsed = agentProfileSchema.safeParse(rawProfile);
		if (!parsed.success) throw new ValidationError(`workerFromBackend: invalid AgentProfile: ${parsed.error.message}`);
		const profile = parsed.data;
		assertBackendProfileMaterialization(profile, capturedBackend, "workerFromBackend");
		assertBridgeProfileMaterializes(profile, capturedBackend, "workerFromBackend");
		const resumeSessionId = bridgeResumeSessionId(capturedBackend, spawnContext, bridgeSessionByWorker);
		const name = profile.name ?? "worker";
		const assignmentId = spawnContext?.assignmentId ?? `unscoped:${unscopedNamespace}:${unscopedOrdinal++}`;
		const executionScope = spawnContext?.parentNodeId;
		const boundBackend = bindReusableExecutorExecutionId(capturedBackend, resumeSessionId ?? externalExecutionId("supervised-worker", {
			assignmentId,
			...executionScope === void 0 ? {} : { scope: executionScope }
		}));
		const boundSessionId = boundBackend.backend === "bridge" ? boundBackend.sessionId : void 0;
		const peerMailAttachment = peerMailRuntimeAttachment(profile, capturedBackend, spawnContext);
		const baseFactory = createExecutor(boundBackend);
		const executorFactory = (spec, ctx) => {
			if (boundSessionId !== void 0 && ctx.node?.nodeId !== void 0) bridgeSessionByWorker.set(ctx.node.nodeId, boundSessionId);
			const extraSeams = seams?.();
			const seamsForChild = extraSeams === void 0 && peerMailAttachment === void 0 ? ctx.seams : {
				...extraSeams,
				...ctx.seams,
				...peerMailAttachment === void 0 ? {} : { [bridgeRuntimeAttachmentsKey]: {
					...readCallerRuntimeAttachments(ctx.seams),
					...peerMailAttachment
				} }
			};
			const built = baseFactory(spec, seamsForChild === ctx.seams ? ctx : {
				...ctx,
				seams: seamsForChild
			});
			return deliverable ? gateOnDeliverable(built, deliverable) : built;
		};
		return {
			name,
			act: async () => "",
			executorSpec: {
				profile,
				harness: null,
				executorFactory,
				...spawnContext?.execution ? { execution: spawnContext.execution } : {}
			}
		};
	};
}
/**
* The reserved MCP alias one worker's PEER MAIL capability endpoint mounts under.
*
* Distinct from the driver's coordination alias on purpose: the two servers carry different
* authority. Coordination mounts spawn_worker / steer_agent / stop; mail mounts send_mail and
* read_mail and nothing else, on a per-worker secret path bound to that worker's identity.
*/
const peerMailMcpAlias = "agent-runtime-peer-mail";
/**
* The Runtime-owned MCP attachment that carries this spawn's peer-mail endpoint into the worker,
* or `undefined` when this backend runs no MCP client at all.
*
* The endpoint rides the SAME out-of-band channel the driver's coordination MCP rides
* (`runtime_attachments` on the bridge wire), for the same reason: the capability path carries
* fresh random bytes per process, so writing it into `AgentProfile.mcp` would move the canonical
* profile digest a durable session is bound to, and a keyed re-spawn would then fail its identity
* check against the journal. Nothing in the authored profile changes, and this runs inside the
* leaf factory — after `authorizeSpawn` has already decided the profile — so the authorization
* chain is unchanged.
*
* Three backend classes, three honest answers:
*
*  - `bridge` MOUNTS it. cli-bridge advertises `capabilities.runtimeAttachments.mcp` and mounts
*    the named servers for the run without binding them into the session profile.
*  - `router`, `router-tools` and `provider` mount NOTHING. Those workers are in-process tool
*    loops with no MCP client; their tool surface is the caller's own array, and
*    `WorkerSpawnContext.peerMailUrl` is the deliverable a caller uses directly.
*  - Every other backend REFUSES the spawn. A sandbox box or a local CLI harness receives tools
*    only through its materialized `AgentProfile`, and the runtime has no channel that reaches it
*    out of band, so minting a capability it can never call would ledger a channel that does not
*    exist. This is the same rule `bridgeResumeSessionId` applies to `continuity: 'resume'`.
*/
function peerMailRuntimeAttachment(profile, backend, spawnContext) {
	const url = spawnContext?.peerMailUrl;
	if (url === void 0) return void 0;
	switch (backend.backend) {
		case "router":
		case "router-tools":
		case "provider": return;
		case "bridge": break;
		default: throw new ValidationError(`workerFromBackend: the '${backend.backend}' backend seam cannot mount a peer-mail endpoint — it materializes tools only through the AgentProfile, and writing a per-process capability URL there would move the canonical profile digest. Run peer-mail workers on the 'bridge' backend, mount the endpoint yourself from WorkerSpawnContext.peerMailUrl through makeLeafAgent or makeWorkerAgent, or drop peerMail for this run`);
	}
	if (profile.mcp?.[peerMailMcpAlias] !== void 0) throw new ValidationError(`workerFromBackend: profile MCP alias ${JSON.stringify(peerMailMcpAlias)} is reserved`);
	return Object.freeze({ [peerMailMcpAlias]: Object.freeze({
		transport: "http",
		url
	}) });
}
/**
* Runtime attachments a caller already put on the child's `ExecutorContext`, so mounting peer mail
* ADDS one server rather than replacing the map. An absent or malformed value contributes nothing;
* the executor that reads the seam owns its validation and refuses a malformed map there.
*/
function readCallerRuntimeAttachments(seams) {
	const existing = seams[bridgeRuntimeAttachmentsKey];
	return existing !== null && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
}
function externalExecutionId(kind, identity) {
	return `${kind}-${canonicalCandidateDigest({
		kind,
		identity
	}).slice(7)}`;
}
/**
* The bridge session id a `'resume'` spawn re-attaches, or `undefined` for a fresh spawn.
* Every refusal throws BEFORE a worker exists, which is what keeps the kernel's continuity
* ledger true: a `'resume'` stamp can only appear over a session that was actually re-attached.
*/
function bridgeResumeSessionId(backend, spawnContext, sessions) {
	if (spawnContext?.continuity !== "resume") return void 0;
	if (backend.backend !== "bridge") throw new ValidationError(`workerFromBackend: the '${backend.backend}' backend seam does not re-attach sessions and cannot honor continuity: 'resume' — only the 'bridge' backend resumes here (cli-bridge keys the harness conversation by session id). Provide a makeWorkerAgent that resumes (it receives spawnContext.resume.ofWorker), or use continuity: 'fresh'`);
	const ofWorker = spawnContext.resume?.ofWorker;
	if (ofWorker === void 0) throw new ValidationError("workerFromBackend: a 'resume' spawn carries no resume lineage — the kernel stamps spawnContext.resume for ledgered spawns; a direct caller must pass { ofWorker, sequence }");
	const prior = sessions.get(ofWorker);
	if (prior === void 0) throw new ValidationError(`workerFromBackend: no recorded bridge session for worker '${ofWorker}' — this seam re-attaches only sessions it bound in this process (the kernel resume boundary). Spawn the node fresh first, or use continuity: 'fresh'`);
	return prior;
}
/**
* The `trace-unpropagated` declaration for a worker backend, or `undefined` when the backend HAS a
* propagation channel. The census (`WORKER_TRACE_PROPAGATION`) says WHETHER a backend propagates;
* this maps the non-propagating arms to WHY: `router`/`router-tools`/`provider` have no worker
* process to inherit an environment, `cli-worktree` has a worker but no environment channel
* through its transport.
*/
function workerTraceUnpropagatedDeclaration(backend) {
	if (WORKER_TRACE_PROPAGATION[backend]) return void 0;
	return {
		backend,
		reason: backend === "router" || backend === "router-tools" || backend === "provider" ? "no-worker-process" : "no-env-channel"
	};
}
/**
* NOT a harness-name test — `ExecutorConfig.backend` is a discriminated-union TAG naming HOW a
* profile is materialized (bridge / sandbox / cli-worktree / cli-in-place / router / cli /
* provider), which is a
* different axis from WHICH CLI runs. An exhaustive switch on a closed union tag is the correct
* shape and must stay: it is what makes a new executor kind a compile error here rather than a
* silently weaker materialization contract. Every other `backend.backend === …` in this file and
* in `runtime.ts` is the same tag; none of them are harness names.
*/
function backendProfileMaterialization(backend) {
	switch (backend.backend) {
		case "bridge":
		case "sandbox":
		case "provider": return fullProfileMaterialization;
		case "cli-worktree": return backend.bridge ? fullProfileMaterialization : worktreeCliProfileMaterialization;
		case "cli-in-place": return worktreeCliProfileMaterialization;
		case "router":
		case "router-tools": return promptModelProfileMaterialization;
		case "cli": return controlProfileMaterialization;
	}
}
function assertProfileContract(profile, contract, context, runtimeConsumesCoordinationTools = false) {
	assertProfileMaterialization({
		contract,
		changedAxes: profileMaterializationAxes$1(runtimeConsumesCoordinationTools ? profileWithoutDeclaredRuntimeCoordinationTools(profile) : profile),
		context
	});
}
/**
* Materialization contracts need the profile axes the provider owns, before an individual manager
* has asynchronously resolved its exact product-tool descriptors. Runtime-owned declarations are
* not provider tools; unsupported declarations still fail when the coordination surface resolves.
*/
/** The child with its manager's Runtime coordination grants, unless the child's author wrote any
*  coordination entry: an explicit grant or refusal is the author's choice and stands. A refusal
*  (`false`) grants nothing, so it is removed once it has decided the child stays a leaf; a
*  harness-less leaf carries no tools axis at all. */
function withInheritedSpawnRights(parent, child) {
	const childTools = child.tools ?? {};
	const authored = Object.entries(childTools).filter(([name]) => name.startsWith(coordinationProfileToolPrefix));
	if (authored.length > 0) {
		if (authored.every(([, enabled]) => enabled !== false)) return child;
		const kept = Object.entries(childTools).filter(([name, enabled]) => !(name.startsWith(coordinationProfileToolPrefix) && enabled === false));
		const { tools: _tools, ...rest } = child;
		return agentProfileSchema.parse(kept.length === 0 ? rest : {
			...rest,
			tools: Object.fromEntries(kept)
		});
	}
	const inherited = Object.entries(parent.tools ?? {}).filter(([name, enabled]) => enabled === true && name.startsWith(coordinationProfileToolPrefix) && coordinationVerbNameSet.has(name.slice(coordinationProfileToolPrefix.length)));
	if (!inherited.some(([name]) => name === `${coordinationProfileToolPrefix}spawn_worker`)) return child;
	return agentProfileSchema.parse({
		...child,
		tools: {
			...childTools,
			...Object.fromEntries(inherited),
			[`${coordinationProfileToolPrefix}submit_result`]: true
		}
	});
}
const coordinationVerbNameSet = new Set(coordinationVerbNames);
function profileWithoutDeclaredRuntimeCoordinationTools(profile) {
	return providerVisibleProfile(profile);
}
function assertBackendProfileMaterialization(profile, backend, context) {
	assertProfileContract(profile, backendProfileMaterialization(backend), context);
}
/**
* The dimensions cli-bridge lowers through its OWN native controls rather than the workspace plan,
* per harness. The pre-spawn check must skip exactly these, or it refuses a profile the bridge
* would have executed. Mirrors `provisionProfileWorkspace` / `provisionPiProfile` in cli-bridge
* `src/backends/profile-support.ts`.
*/
function bridgeMaterializationSkip(harness) {
	return harness === "pi" ? ["mcp", "extensions"] : ["mcp"];
}
/**
* The two prompt intents, gated here because they are the ONLY profile dimensions cli-bridge
* refuses independently of whether a harness materializes a workspace at all
* (`assertProfilePromptIntentsSupported`, cli-bridge `src/backends/profile-support.ts`): a
* backend either owns a control that reaches the harness's system-prompt position or it does not.
* Every other dimension's verdict belongs to the workspace plan the executing backend builds, and
* the run's own materialization receipt already refuses those after the fact.
*/
const gatedPromptDimensions = ["systemPrompt", "appendSystemPrompt"];
/**
* Refuse a bridge-bound profile whose prompt intent the harness cannot execute, at the SYNCHRONOUS
* spawn seam — before the reservation commits, the `spawned` event is journaled, or a token is
* metered. The verdict is a pure function of the profile and the harness, but the bridge only
* reaches it while assembling the prompt, by which point the child is spawned, metered, and
* settled `down` to deliver an answer that was available before it started.
*
* Applies to the profiles the runtime SPAWNS — a worker and a nested driver child. A root manager
* profile is the caller's own input and is not a spawn: the bridge answers it on the manager's
* first turn without a child ever existing.
*
* Silent for every other backend: `cli-worktree` runs the full plan check on its own local plan
* (`runWorktreeHarness`), and no other backend hands the profile to a harness materializer.
*/
function assertBridgeProfileMaterializes(profile, backend, context) {
	if (backend.backend !== "bridge") return;
	const harness = agentHarness(profile.harness);
	if (harness === void 0 || !isMaterializerHarness(harness)) return;
	const unsupported = unsupportedProfileDimensions(profile, harness, gatedPromptDimensions, bridgeMaterializationSkip(harness));
	if (unsupported.length === 0) return;
	throw new ValidationError(`${context}: ${harness} cannot materialize the profile: ${renderUnsupported(unsupported)}`);
}
/**
* The ROOT router-brained supervisor's materialization claim. The router arm consumes the
* identity fields, the resolved system prompt (`prompt.systemPrompt` + `prompt.instructions` +
* `resources.instructions`), and the resolved model id (`model.default`); the remaining model
* fields are either applied by the profile-bound Router adapter or refused. Every behavioral axis
* the Router brain cannot materialize fails before compute.
*
* `resourceFailOnError` is carried by the router arm itself. A strict root fails closed on an
* instruction resource the arm cannot fetch, which is the policy the profile declares. A
* best-effort root is refused, because the arm reports no skipped resource. Dropping the field
* would instead force an edit to a champion profile before it can be re-seated as a supervisor
* root, and that edit changes the profile's canonical identity.
*/
const routerSupervisorProfileMaterialization = defineProfileMaterializationContract({
	name: "router-supervisor-execution",
	axes: [
		"name",
		"description",
		"version",
		"tags",
		"systemPrompt",
		"instructions",
		"resourceInstructions",
		"resourceFailOnError",
		"modelDefault",
		"modelProvider",
		"modelReasoningEffort",
		"modelMaxVisibleOutputTokens",
		"modelMaxTotalOutputTokens",
		"modelMetadata",
		"harness",
		"metadata"
	]
});
/**
* The pre-flight `supervise` installs for a bridge backend. No new knob: the backend already says
* where the bridge is, and these are the questions only the bridge can answer.
*
* Two bridge causes, after the profile-owned tool preflight:
*
* - `model-route` — `GET /v1/capabilities?model=<wire id>`. The bridge answers exactly this
*   question and 404s `no backend matches model "…"`. FAIL CLOSED: any answer that is not a route
*   refuses, including a transport error or an unexpected status, because a pre-flight that skips
*   itself on an error is the silent admission it exists to remove.
* - `bridge-full` — `GET /health` checks the bulk lane that an unreserved Runtime request uses.
*   Older bridges fall back to the overall admission counters. Capacity is advisory, so only a
*   positive reading of fullness refuses the spawn.
*/
function bridgeSpawnPreflight(seam) {
	return async (profile) => {
		const wireModel = profileBridgeWireModel(profile);
		if (wireModel === void 0) return {
			cause: "model-route",
			detail: "the child AgentProfile resolves no bridge wire model (harness + provider + model)"
		};
		const routeRefusal = await bridgeModelRouteRefusal(seam, wireModel);
		if (routeRefusal !== void 0) return {
			cause: "model-route",
			detail: routeRefusal.detail
		};
		const admissionRefusal = await bridgeAdmissionRefusal(seam);
		if (admissionRefusal !== void 0) return {
			cause: "bridge-full",
			detail: admissionRefusal
		};
	};
}
/** Refuse a Runtime-managed child whose declared tools cannot exist on its execution path. */
function profileToolSpawnPreflight(runtimeOwnsManager, canResolveProductTools) {
	return async (profile) => {
		if (!runtimeOwnsManager) return void 0;
		const declarationError = runtimeToolDeclarationError(profile, canResolveProductTools);
		if (declarationError !== void 0) return {
			cause: "unmountable-tool",
			detail: declarationError
		};
	};
}
/**
* Refuse a harness-brained child that declares Runtime coordination tools when nothing can carry
* the coordination server to it. Such a child runs as a nested manager through `driveHarness`, and
* the automatic driver reaches Runtime's loopback coordination MCP only through the bridge's
* runtime-attachments seam (`automaticDriverBackendSupported`). The worker factory throws the same
* fault, but only after a live-worker permit and a budget reservation were taken and as an unnamed
* tool error; here it is a pre-flight cause the manager can re-author against, and neither an
* environment nor a reservation exists yet. A router-brained child holds the same tools in-process
* and needs no channel.
*/
function coordinationChannelSpawnPreflight(runtimeOwnsManager, hasCustomDriveHarness, managerBackend, coordination) {
	if (!runtimeOwnsManager || hasCustomDriveHarness) return void 0;
	if (managerBackend !== void 0 && automaticDriverBackendSupported(managerBackend, coordination)) {
		if (managerBackend.backend !== "provider") return void 0;
		return async (profile) => {
			if (!isExternalSupervisor(profile) || declaredRuntimeToolNames(profile).length === 0) return void 0;
			return await providerAcceptsCoordinationAttachments(managerBackend) ? void 0 : {
				cause: "unmountable-tool",
				detail: "the 'provider' backend does not advertise create.runtimeAttachments.mcp; Runtime cannot mount this manager's coordination tools before dispatch"
			};
		};
	}
	const missingChannel = managerBackend === void 0 ? "this run has no driverBackend" : `the '${managerBackend.backend}' backend has no coordination channel`;
	return async (profile) => {
		if (!isExternalSupervisor(profile)) return void 0;
		const declared = declaredRuntimeToolNames(profile);
		if (declared.length === 0) return void 0;
		return {
			cause: "unmountable-tool",
			detail: `the profile declares ${declared.map((name) => JSON.stringify(`${coordinationProfileToolPrefix}${name}`)).join(", ")} with harness ${JSON.stringify(profile.harness)}, but ${missingChannel}: Use a local bridge, or a provider with runtime MCP attachments and an authenticated coordination.publicUrl this child can reach; an explicit driveHarness may supply its own channel`
		};
	};
}
function composeSpawnPreflights(...preflights) {
	const active = preflights.filter((preflight) => preflight !== void 0);
	if (active.length === 0) return void 0;
	return async (profile, context) => {
		for (const preflight of active) {
			const refusal = await preflight(profile, context);
			if (refusal !== void 0) return refusal;
		}
	};
}
const defaultAllowedMcpHosts = [];
Object.freeze(defaultAllowedMcpHosts);
/** Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and
* ambient connection grants therefore fail closed by default, in addition to local MCP and hooks. */
const DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY = Object.freeze({
	allowLocalMcp: false,
	allowHooks: false,
	allowedMcpHosts: defaultAllowedMcpHosts,
	allowConnections: false
});
/**
* A manager keeps a dedicated environment. It serves its coordination credential through
* create-time environment, and every co-tenant of a shared box could read it.
*/
function managerExecutorConfig(config) {
	if (config.backend !== "provider" || config.shared === void 0) return config;
	const { shared: _shared, ...dedicated } = config;
	return Object.freeze(dedicated);
}
function isExternalSupervisor(profile) {
	return harnessRunsAgent(profile.harness);
}
function automaticDriverBackendSupported(backend, coordination) {
	return backend.backend === "bridge" || backend.backend === "provider" && !backend.steering && coordination?.authentication !== void 0 && coordination.publicUrl !== void 0;
}
async function providerAcceptsCoordinationAttachments(backend) {
	const create = (await resolveAgentEnvironmentProvider(backend.provider, backend.registry).capabilities()).create;
	if (!create || !("runtimeAttachments" in create)) return false;
	const attachments = create.runtimeAttachments;
	return Boolean(attachments && typeof attachments === "object" && "mcp" in attachments && attachments.mcp === true);
}
/** Run a harness-brained manager through the same executor factory as its children. The manager's
* full profile is preserved, the live coordination server is added under one reserved alias, and
* every streamed turn is charged to the manager's scope before it may continue. */
function driveHarnessFromBackend(backend, executionId, now = Date.now, maxTurns, rootStream) {
	if (maxTurns !== void 0 && maxTurns < 0) throw new ValidationError("driveHarnessFromBackend: maxTurns must be >= 0 (0 lifts the turn cap; bounds become the conserved pool + deadline + abort)");
	const turnCap = maxTurns ?? 0;
	const boundBackend = bindReusableExecutorExecutionId(managerExecutorConfig(captureReusableExecutorConfig(backend, "driveHarnessFromBackend")), executionId);
	const baseFactory = createExecutor(boundBackend);
	const ownerRuntime = boundBackend.backend === "provider" ? boundBackend.runtime ?? resolveAgentEnvironmentProvider(boundBackend.provider, boundBackend.registry).name : "cli";
	let activeExecutor;
	let managerTranscript;
	const drive = async ({ profile, authoredProfile, task, scope, coordinationMcpUrl, coordinationMcpHeaders, stopSignal, coordinationTools, reentry }) => {
		const retainedOwner = boundBackend.backend === "provider" ? scopeRetainedOwnerContext(scope) : void 0;
		if (retainedOwner && boundBackend.backend === "provider") {
			bindScopeRetainedOwnerProvider(scope, resolveAgentEnvironmentProvider(boundBackend.provider, boundBackend.registry));
			bindScopeRetainedOwnerEnvironmentId(scope, () => {
				if (activeExecutor === void 0) return void 0;
				const execution = runtimeOwnedExecutorMaterialization(activeExecutor)?.execution;
				return execution?.kind === "environment" ? execution.id : void 0;
			});
		}
		let driveTask = task;
		if (reentry !== void 0) {
			const continuity = await reentryContinuity(boundBackend, scope, retainedOwner !== void 0);
			reentry.onContinuity?.(continuity);
			driveTask = reentry.compose(continuity);
		}
		const originalTask = retainedOwner ? await prepareScopeRetainedOwnerTask(scope, driveTask) : driveTask;
		const acceptedOwner = retainedOwner ? await scopeRetainedOwnerResult(scope) : void 0;
		if (acceptedOwner) {
			await restoreScopeOwnerAcceptedExecution(scope);
			consumeScopeRetainedOwnerResult(scope);
			const replayedFailure = executorFailure(acceptedOwner);
			if (replayedFailure !== void 0) throw new HarnessTurnFailedError(ownerRuntime, replayedFailure);
			return;
		}
		const initialBudget = scope.budget;
		if (!(scope.view.inFlight > 0 || scope.view.waiting > 0) && (initialBudget.tokensLeft <= 0 || initialBudget.iterationsLeft <= 0 || initialBudget.usdCapped && initialBudget.usdLeft <= 0 || Object.values(initialBudget.resources ?? {}).some((resource) => !resource.known || resource.remaining <= 0) || initialBudget.deadlineMs > 0 && now() >= initialBudget.deadlineMs)) throw new ValidationError("driveHarnessFromBackend: supervisor budget exhausted");
		const canonicalDriverProfile = agentProfileSchema.parse(authoredProfile);
		assertNoReservedCoordinationMcpAlias(canonicalDriverProfile, "driveHarnessFromBackend");
		const stableCoordinationTools = detachedSnapshot(coordinationTools, "driveHarnessFromBackend coordination tools");
		const expectedProviderProfile = providerVisibleProfile(canonicalDriverProfile);
		const providerDriverProfile = agentProfileSchema.parse(profile);
		if (canonicalAgentProfileDigest(providerDriverProfile) !== canonicalAgentProfileDigest(expectedProviderProfile)) throw new ValidationError("driveHarnessFromBackend: supervisor passed a provider profile that does not match its canonical profile and mounted coordination tools");
		const spec = {
			profile: providerDriverProfile,
			harness: boundBackend.backend === "sandbox" ? providerDriverProfile.harness : null
		};
		const turnStop = turnCap > 0 ? new AbortController() : void 0;
		const effectiveStopSignal = turnStop === void 0 ? stopSignal : stopSignal === void 0 ? turnStop.signal : AbortSignal.any([stopSignal, turnStop.signal]);
		const attachment = {
			transport: "http",
			url: coordinationMcpUrl,
			...coordinationMcpHeaders ? { headers: coordinationMcpHeaders } : {}
		};
		let factory = baseFactory;
		if (boundBackend.backend === "provider") {
			const credentialName = "AGENT_RUNTIME_COORDINATION_TOKEN";
			const authorization = coordinationMcpHeaders?.Authorization;
			if (!authorization?.startsWith("Bearer ")) throw new ValidationError("driveHarnessFromBackend: provider coordination requires a bearer credential");
			if (Object.hasOwn(boundBackend.defaults?.env ?? {}, credentialName)) throw new ValidationError("driveHarnessFromBackend: provider defaults contain the reserved coordination credential name");
			if (Object.hasOwn(boundBackend.defaults?.runtimeAttachments?.mcp ?? {}, "agent-runtime-coordination")) throw new ValidationError("driveHarnessFromBackend: provider defaults contain the reserved coordination attachment alias");
			if (!await providerAcceptsCoordinationAttachments(boundBackend)) throw new ValidationError("driveHarnessFromBackend: provider does not advertise create.runtimeAttachments.mcp; no environment was created");
			factory = createExecutor({
				...boundBackend,
				defaults: {
					...boundBackend.defaults ?? {},
					env: {
						...boundBackend.defaults?.env ?? {},
						[credentialName]: authorization.slice(7)
					},
					runtimeAttachments: { mcp: {
						...boundBackend.defaults?.runtimeAttachments?.mcp ?? {},
						[coordinationMcpAlias]: {
							transport: "http",
							url: coordinationMcpUrl,
							headers: { Authorization: {
								kind: "secret-ref",
								key: credentialName,
								format: "bearer"
							} }
						}
					} }
				}
			});
		}
		const executor = factory(spec, {
			signal: scope.signal,
			node: scopeOwnerExecutorNodeContext(scope),
			seams: {
				...retainedOwner ? { [retainedExecutorSeamKey]: {
					...retainedOwner,
					onResult: async (result) => commitOwnerResult(result)
				} } : {},
				...effectiveStopSignal === void 0 ? {} : { [bridgeStopSignalKey]: effectiveStopSignal },
				[bridgeRuntimeAttachmentsKey]: { [coordinationMcpAlias]: attachment }
			}
		});
		activeExecutor = executor;
		let completed = false;
		let started = false;
		let terminalAccountingCaptured = false;
		let pendingUsage = [];
		const ownerUsage = newUsageTotals();
		let observedOwnerSpend = zeroSpend();
		let committedOwnerSpend = retainedOwner ? await scopeRetainedOwnerPriorSpend(scope) : zeroSpend();
		const ownerDelta = (total, committed = committedOwnerSpend) => ({
			...addResourceSpend(total.resources === void 0 ? void 0 : Object.fromEntries(Object.entries(total.resources).map(([name, value]) => {
				const prior = committed.resources?.[name];
				if (prior && prior.unit !== value.unit) throw new ValidationError(`resource ${name}: unit mismatch`);
				return [name, {
					...value,
					amount: Math.max(0, value.amount - (prior?.amount ?? 0)),
					known: value.known && (prior?.known ?? true)
				}];
			}))),
			iterations: Math.max(0, total.iterations - committed.iterations),
			tokens: {
				input: Math.max(0, total.tokens.input - committed.tokens.input),
				output: Math.max(0, total.tokens.output - committed.tokens.output),
				...unmeteredOwnerCache(total.tokens, committed.tokens)
			},
			usd: Math.max(0, total.usd - committed.usd),
			...total.usdEstimated === void 0 ? {} : { usdEstimated: Math.min(Math.max(0, total.usd - committed.usd), Math.max(0, total.usdEstimated - (committed.usdEstimated ?? 0))) },
			...total.tokensProvenance === void 0 ? {} : { tokensProvenance: total.tokensProvenance },
			ms: Math.max(0, total.ms - committed.ms),
			...total.tokensKnown === false ? { tokensKnown: false } : {},
			...total.usdKnown === false ? { usdKnown: false } : {}
		});
		let meteredProviderAttempts = 0;
		const providerEvidenceForNextMeter = () => {
			const attempt = runtimeOwnedExecutorProviderEvidence(executor)?.attempts[meteredProviderAttempts++];
			if (attempt === void 0) return providerAttemptEvidence(void 0);
			const observations = Object.freeze([...attempt.observations]);
			const models = Object.freeze([...new Set(observations)]);
			const providerDispatch = attempt.providerDispatch;
			return Object.freeze(attempt.identityConflict === true || providerDispatch === "not_started" || providerDispatch !== "not_started" && observations.length === 0 ? {
				status: "unknown",
				attempts: Object.freeze([Object.freeze({
					observations,
					...attempt.identityConflict === true ? { identityConflict: true } : {},
					...providerDispatch === "not_started" ? { providerDispatch } : {}
				})]),
				models,
				reason: attempt.identityConflict === true ? "provider-model-conflict" : "provider-model-missing"
			} : {
				status: "known",
				attempts: Object.freeze([Object.freeze({ observations })]),
				models
			});
		};
		let teardownStarted = false;
		const deadlineAtMs = scope.budget.deadlineMs || void 0;
		const teardownOnce = async (grace) => {
			if (teardownStarted) return;
			teardownStarted = true;
			await teardownExecutor(executor, grace, deadlineAtMs, now);
		};
		const meterPending = async (forceUnknown = false) => {
			if (pendingUsage.length === 0) return;
			for (;;) {
				if ((runtimeOwnedExecutorProviderEvidence(executor)?.attempts[meteredProviderAttempts])?.providerDispatch !== "not_started") break;
				await meterRuntimeOwnedProviderAttempt(scope, zeroSpend(), providerEvidenceForNextMeter(), {
					role: "driver",
					runtime: executor.runtime,
					telemetry: "known-zero-before-dispatch"
				});
			}
			const batch = pendingUsage;
			pendingUsage = [];
			for (const event of batch) meterUsageEvent(ownerUsage, event);
			const measured = spendFromUsageTotals(ownerUsage);
			const charge = ownerDelta(measured, retainedOwner ? committedOwnerSpend : observedOwnerSpend);
			observedOwnerSpend = detachedSnapshot(measured, "metered owner spend");
			await meterRuntimeOwnedProviderAttempt(scope, forceUnknown ? {
				...charge,
				tokensKnown: false,
				usdKnown: false
			} : charge, providerEvidenceForNextMeter(), {
				role: "driver",
				runtime: executor.runtime
			});
			if (retainedOwner) committedOwnerSpend = addSpend(committedOwnerSpend, charge);
			const budget = scope.budget;
			if (budget.tokensLeft <= 0 || budget.usdCapped && budget.usdLeft <= 0 || Object.values(budget.resources ?? {}).some((resource) => !resource.known || resource.remaining <= 0) || budget.deadlineMs > 0 && now() >= budget.deadlineMs) throw new ValidationError("driveHarnessFromBackend: supervisor budget exhausted");
		};
		const pending = runtimeOwnedPendingExecutorMaterialization(executor);
		let failed = false;
		let failure;
		let turnFailure;
		let ownerMaterializationPublished = false;
		const ownerDeclaration = (exactDeclaration) => ({
			...exactDeclaration,
			authoredProfile: canonicalDriverProfile,
			effectiveProfile: providerDriverProfile,
			platformAttachments: { [coordinationMcpAlias]: {
				kind: "coordination-mcp",
				transport: "http",
				tools: stableCoordinationTools
			} }
		});
		const publishMaterialization = async (exactDeclaration, exactBinding) => {
			await recordScopeOwnerMaterialization(scope, executor.runtime, ownerDeclaration(exactDeclaration), {
				...exactBinding,
				binding: {
					stableBinding: exactBinding.binding,
					platformAttachments: { [coordinationMcpAlias]: {
						transport: "http",
						url: coordinationMcpUrl
					} }
				},
				descriptor: {
					...exactBinding.descriptor,
					coordination: true
				}
			});
		};
		const commitOwnerResult = async (result) => {
			const declaration = runtimeOwnedExecutorMaterialization(executor);
			const binding = runtimeOwnedExecutorExecutionBinding(executor);
			if (!declaration || !binding) throw new ValidationError("retained owner result requires terminal materialization before release");
			if (!ownerMaterializationPublished) {
				await publishMaterialization(declaration, binding);
				ownerMaterializationPublished = true;
			}
			await meterPending();
			const total = withBudgetResources({
				...result.spent,
				...resourceTelemetry(observedOwnerSpend, result.spent),
				iterations: 0
			}, scope.budget);
			const delta = ownerDelta(total);
			await meterRuntimeOwnedAccounting(scope, delta, {
				role: "driver",
				runtime: executor.runtime
			});
			committedOwnerSpend = addSpend(committedOwnerSpend, delta);
			await retainedOwner.onResult(result);
			terminalAccountingCaptured = true;
		};
		try {
			const declaration = runtimeOwnedExecutorMaterialization(executor);
			const executionBinding = runtimeOwnedExecutorExecutionBinding(executor);
			if (pending === void 0 && (declaration === void 0 || executionBinding === void 0)) throw new ValidationError(`driveHarnessFromBackend: built-in runtime ${JSON.stringify(executor.runtime)} has no trusted materialization declaration or execution binding`);
			if (pending !== void 0) {
				if (pending.runtime !== executor.runtime || pending.binding.attemptId !== scopeOwnerExecutorNodeContext(scope).attemptId) throw new ValidationError("driveHarnessFromBackend: pending executor did not bind the kernel-minted attempt");
				if (canonicalAgentProfileDigest(pending.declaration.effectiveProfile) !== canonicalAgentProfileDigest(providerDriverProfile)) throw new ValidationError("driveHarnessFromBackend: pending executor changed the provider-visible AgentProfile before execution");
			} else {
				await publishMaterialization(declaration, executionBinding);
				ownerMaterializationPublished = true;
			}
			if (executor.budgetExempt) throw new ValidationError(`driveHarnessFromBackend: runtime ${JSON.stringify(executor.runtime)} does not report usage and cannot drive a budgeted supervisor`);
			started = true;
			if (retainedOwner?.admissions.length && !executor.recover) throw new ValidationError("retained owner executor does not support recovery");
			await rootStream?.beginAttempt();
			const run = retainedOwner?.admissions.length ? executor.recover(originalTask, scope.signal) : executor.execute(originalTask, scope.signal);
			if (isAsyncIterable(run)) {
				let turns = 0;
				for await (const event of run) if (event.kind === "iteration") {
					await meterPending();
					turns += 1;
					if (turnStop !== void 0 && turns >= turnCap && !turnStop.signal.aborted) turnStop.abort(`supervise: maxTurns ${turnCap} reached`);
				} else if (event.kind === "progress") rootStream?.append(event.progress);
				else pendingUsage.push(event);
				await meterPending();
				const artifact = executor.resultArtifact();
				const terminalResources = withBudgetResources({
					...artifact.spent,
					...resourceTelemetry(observedOwnerSpend, artifact.spent)
				}, scope.budget).resources;
				const resourceCorrection = addResourceSpend(terminalResources === void 0 ? void 0 : Object.fromEntries(Object.entries(terminalResources).map(([name, value]) => [name, {
					...value,
					amount: Math.max(0, value.amount - (observedOwnerSpend.resources?.[name]?.amount ?? 0))
				}])));
				if (!retainedOwner && (artifact.spent.tokensKnown === false || artifact.spent.usdKnown === false || resourceCorrection.resources !== void 0)) await meterRuntimeOwnedAccounting(scope, {
					...resourceCorrection,
					iterations: 0,
					tokens: {
						input: 0,
						output: 0
					},
					...artifact.spent.tokensKnown === false ? { tokensKnown: false } : {},
					usd: 0,
					...artifact.spent.usdKnown === false ? { usdKnown: false } : {},
					ms: 0
				}, {
					role: "driver",
					runtime: executor.runtime,
					telemetry: "unknown"
				});
				terminalAccountingCaptured = true;
				const reported = executorFailure(artifact);
				if (reported !== void 0) turnFailure = new HarnessTurnFailedError(executor.runtime, reported);
			} else {
				const artifact = await run;
				await meterRuntimeOwnedProviderAttempt(scope, withBudgetResources({
					...artifact.spent,
					iterations: 0
				}, scope.budget), providerEvidenceForNextMeter(), {
					role: "driver",
					runtime: executor.runtime
				});
				terminalAccountingCaptured = true;
				const reported = executorFailure(artifact);
				if (reported !== void 0) turnFailure = new HarnessTurnFailedError(executor.runtime, reported);
			}
			if (pending !== void 0 && !ownerMaterializationPublished) {
				const acknowledged = runtimeOwnedExecutorMaterialization(executor);
				const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor);
				if (acknowledged === void 0 || acknowledgedBinding === void 0) throw new ValidationError("driveHarnessFromBackend: external executor completed without a terminal materialization acknowledgement");
				await publishMaterialization(acknowledged, acknowledgedBinding);
				ownerMaterializationPublished = true;
			}
			completed = true;
		} catch (error) {
			failed = true;
			failure = error;
		} finally {
			if (pending !== void 0 && !ownerMaterializationPublished) {
				const acknowledged = runtimeOwnedExecutorMaterialization(executor);
				const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor);
				if (acknowledged !== void 0 && acknowledgedBinding !== void 0) try {
					await publishMaterialization(acknowledged, acknowledgedBinding);
					ownerMaterializationPublished = true;
				} catch (error) {
					if (!failed) {
						failed = true;
						failure = error;
					}
				}
			}
			recordRuntimeOwnedDriveHarnessProviderEvidence(drive, runtimeOwnedExecutorProviderEvidence(executor));
			try {
				await meterPending(failed && started && !terminalAccountingCaptured);
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
			if (failed && started && !terminalAccountingCaptured) try {
				for (;;) {
					const evidence = runtimeOwnedExecutorProviderEvidence(executor);
					if ((evidence?.attempts.length ?? 0) <= meteredProviderAttempts) break;
					const providerDispatchDidNotStart = evidence?.attempts[meteredProviderAttempts]?.providerDispatch === "not_started";
					await meterRuntimeOwnedProviderAttempt(scope, withBudgetResources(providerDispatchDidNotStart ? zeroSpend() : unmeteredSpend(0), scope.budget, providerDispatchDidNotStart), providerEvidenceForNextMeter(), {
						role: "driver",
						runtime: executor.runtime,
						telemetry: providerDispatchDidNotStart ? "known-zero-before-dispatch" : "unknown-after-failure"
					});
				}
				if (meteredProviderAttempts === 0) await meterRuntimeOwnedProviderAttempt(scope, withBudgetResources(unmeteredSpend(0), scope.budget), providerEvidenceForNextMeter(), {
					role: "driver",
					runtime: executor.runtime,
					telemetry: "unknown-after-failure"
				});
				const attempts = runtimeOwnedExecutorProviderEvidence(executor)?.attempts;
				const provenNotStarted = attempts !== void 0 && attempts.length > 0 && attempts.every((attempt) => attempt.providerDispatch === "not_started");
				if (scope.budget.resources !== void 0 && !provenNotStarted) await meterRuntimeOwnedAccounting(scope, withBudgetResources(zeroSpend(), scope.budget), {
					role: "driver",
					runtime: executor.runtime,
					telemetry: "unknown-after-failure"
				});
			} catch (error) {
				failure = new RuntimeRunStateError(`${errMessage(failure)}; accounting failed: ${errMessage(error)}`, { cause: failure });
			}
			try {
				if (!retainedOwner?.preserveEnvironment || retainedOwner.admissions.length === 0) await teardownOnce(completed ? DEFAULT_SUCCESSFUL_SHUTDOWN_MS : "brutalKill");
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
			const capture = executor.harnessTranscript?.();
			if (capture !== void 0 && (capture.status === "captured" || managerTranscript?.status !== "captured")) managerTranscript = capture;
			if (activeExecutor === executor) activeExecutor = void 0;
		}
		if (failed) throw failure;
		if (turnFailure !== void 0) throw turnFailure;
	};
	drive.deliver = (message) => {
		const deliver = activeExecutor?.deliver;
		if (!deliver) return false;
		return deliver.call(activeExecutor, message) !== false;
	};
	drive.deliverReady = () => activeExecutor !== void 0;
	drive.traceSource = () => activeExecutor?.traceSource?.();
	drive.progress = () => activeExecutor?.progress?.();
	if (boundBackend.backend === "provider") drive.harnessTranscript = () => managerTranscript ?? activeExecutor?.harnessTranscript?.();
	return attestRuntimeOwnedScopeOwner(drive, ownerRuntime);
}
/**
* What the next drive of a harness-brained manager continues, as far as its backend proves it.
*
* A bridge reattaches the harness session by its durable execution id. A retained provider owner
* continues in the environment it last used while the provider still holds it, and a deliberate
* later invocation there continues the same harness session. A provider without retained control
* creates a new environment for every drive and releases the old one. Anything else is unproven.
*/
async function reentryContinuity(backend, scope, retainedOwner) {
	if (backend.backend === "bridge") return {
		session: "continued",
		environment: "same",
		workspace: "kept"
	};
	if (backend.backend !== "provider" || !retainedOwner) return UNPROVEN_CONTINUITY;
	if ((await resolveAgentEnvironmentProvider(backend.provider, backend.registry).capabilities()).retainedControl === void 0) return {
		session: "new",
		environment: "replaced",
		workspace: "lost"
	};
	const environment = await reconcileScopeRetainedOwnerEnvironment(scope);
	if (environment.state === "live") return {
		session: "continued",
		environment: "same",
		environmentId: environment.environmentId,
		workspace: "kept"
	};
	if (environment.state === "lost") {
		const restorePoint = await scopeRetainedOwnerRestorePoint(scope);
		return {
			session: "new",
			environment: "replaced",
			previousEnvironmentId: environment.environmentId,
			...restorePoint === void 0 ? { workspace: "lost" } : {
				workspace: "restored",
				checkpointAt: restorePoint.takenAt
			}
		};
	}
	return UNPROVEN_CONTINUITY;
}
function isAsyncIterable(value) {
	return value !== null && typeof value === "object" && Symbol.asyncIterator in value && typeof value[Symbol.asyncIterator] === "function";
}
/** Resolve one option that may be given as a value OR as a name into `opts.registry`. Both failure
*  modes name the option, the requested name, and the table it was looked up in — a typo must not
*  degrade into a silently unconfigured run (which for `deliverable` means "no run can ever
*  deliver"). A resolver port cannot enumerate its names, so the message names the table instead of
*  listing what was in it. */
function resolveNamed(option, table, value, registry) {
	if (typeof value !== "string") return value;
	if (!registry) throw new ConfigError(`supervise: opts.${option} = ${JSON.stringify(value)} names a registry entry, but no opts.registry.${table} was provided to resolve it against`);
	const entry = registry.resolve(value);
	if (entry === void 0) throw new ConfigError(`supervise: opts.${option} = ${JSON.stringify(value)} is not in opts.registry.${table} — the table resolved no entry under that name`);
	return entry;
}
/** Read the profiles table once, before anything is built or spent, and freeze what it returns.
*  Every entry must parse as an AgentProfile (the schema refuses a credential written as a public
*  value), be executable, use an allowed model, and carry its table name as `profile.name`.
*  `assertMountable` applies the spawn path's own mount checks, so an entry that can never be
*  mounted fails here instead of after a director spent a turn on it. A promoted entry's decision
*  must promote, and a treatment arm of its sealed play must name the entry's canonical digest;
*  the seal itself is verified by {@link verifyProfilePromotions}. An empty table is no table. */
function snapshotProfileTable(table, allowedModels, assertMountable) {
	if (table === void 0) return void 0;
	if (typeof table.names !== "function" || typeof table.resolve !== "function") throw new ConfigError("supervise: opts.registry.profiles must implement resolve(name) and names(): a director can spawn only the names it is shown");
	const entries = /* @__PURE__ */ new Map();
	for (const name of table.names()) {
		const at = `opts.registry.profiles ${JSON.stringify(name)}`;
		if (typeof name !== "string" || name.trim().length === 0 || name !== name.trim()) throw new ConfigError(`supervise: ${at} is not a non-empty trimmed name`);
		if (entries.has(name)) throw new ConfigError(`supervise: ${at} is listed twice`);
		const entry = table.resolve(name);
		if (entry === void 0) throw new ConfigError(`supervise: ${at} is listed, but the table resolved no entry under it`);
		const parsed = agentProfileSchema.safeParse(entry.profile);
		if (!parsed.success) throw new ValidationError(`supervise: ${at} is not a valid AgentProfile: ${parsed.error.message}`);
		const profile = freezeDetached(parsed.data);
		if (profile.name !== name) throw new ValidationError(`supervise: ${at} holds profile.name ${JSON.stringify(profile.name)}; a table entry is spawned and continued by its name, so the two must be equal`);
		assertExecutableAgentProfile(profile, `supervise: ${at}`);
		assertProfileModelsAllowed(profile, allowedModels);
		assertMountable?.(profile, `supervise: ${at} would be refused at mount`);
		const promotion = entry.promotion;
		if (promotion !== void 0) {
			if (promotion.decision?.promote !== true) throw new ValidationError(`supervise: ${at} cites a PairedPromotionDecision that did not promote; list it without promotion to run it as exploratory`);
			const digest = canonicalAgentProfileDigest(profile);
			if (!(promotion.experiment?.spec?.arms ?? []).some((arm) => arm.role === "treatment" && arm.profileDigest === digest)) throw new ValidationError(`supervise: ${at} cites sealed play ${JSON.stringify(promotion.experiment?.spec?.id)}, but no treatment arm of it names this profile's digest ${digest}`);
		}
		entries.set(name, Object.freeze({
			profile,
			...promotion === void 0 ? {} : { promotion: freezeDetached(promotion) }
		}));
	}
	return entries.size === 0 ? void 0 : entries;
}
/** Verify the seal of every promoted profiles-table entry. Eval's seal check is asynchronous, so it
*  runs at the start of the run, before the first model call; a broken seal refuses the run. */
async function verifyProfilePromotions(table) {
	const promoted = [...table ?? []].filter(([, entry]) => entry.promotion !== void 0);
	if (promoted.length === 0) return;
	const { verifySealedExperiment } = await import("@tangle-network/agent-eval/experiment");
	for (const [name, entry] of promoted) if (!await verifySealedExperiment(entry.promotion.experiment)) throw new ValidationError(`supervise: opts.registry.profiles ${JSON.stringify(name)} cites a sealed play whose digest does not match its spec`);
}
const superviseOptionKeySet = /* @__PURE__ */ new Set([
	"allowedModels",
	"analysts",
	"analyzeOnSettle",
	"authorizeMessage",
	"authorizeSpawn",
	"backend",
	"blobs",
	"budget",
	"childSettleGraceMs",
	"teardownConfirmMs",
	"retainedAtSettlement",
	"compaction",
	"continuityByProfile",
	"coordination",
	"deliverable",
	"driveHarness",
	"driveHarnessMaterialization",
	"driverBackend",
	"driverRetry",
	"executeExtraTool",
	"execution",
	"extraTools",
	"finalizer",
	"hooks",
	"inheritSpawnRights",
	"journal",
	"makeLeafAgent",
	"makeWorkerAgent",
	"escalateQuestion",
	"maxDepth",
	"maxTurns",
	"now",
	"onCoordinationEvent",
	"onDriverAttempt",
	"onProgressStop",
	"otel",
	"peerMail",
	"perWorker",
	"reservationPolicy",
	"probes",
	"profileGuidance",
	"profileSecurity",
	"registry",
	"resolveDeliverable",
	"resolveDriveHarness",
	"resolveSpawnProfile",
	"resolveSupervisorTools",
	"rootDriverFromBackend",
	"rootHandle",
	"router",
	"runDir",
	"resume",
	"runContext",
	"runId",
	"signal",
	"stallAfterMs",
	"awaitTimeoutMs",
	"steerDir",
	"stopRule",
	"watchWorkers",
	"continuation",
	"workerRetry",
	"onWorkerRetry",
	"workerSlots",
	"recoverExecutor"
]);
/**
* Refuse a top-level option key `supervise()` reads nowhere, naming it.
*
* The shape is `assertExactConfigKeys`, which does the same for one executor configuration: an
* unknown field is a caller asking for behavior that will not happen, and intake is the only
* moment it is observable. The error class is not the same, on purpose. A bad `SuperviseOptions`
* key is a configuration fault, and `ConfigError` is already what `supervise()` throws for one —
* see `resolveNamed`, for an option that names a registry entry the registry does not hold.
*/
function assertSuperviseOptionKeys(opts, context) {
	const unknown = Object.keys(opts).filter((key) => !superviseOptionKeySet.has(key));
	if (unknown.length > 0) throw new ConfigError(`${context}: unknown option ${unknown.sort().join(", ")} — no reader consults that name, so the value would be discarded and the capability it asks for would silently be absent`);
}
function captureDeliverable(deliverable, context) {
	if (typeof deliverable !== "object" || deliverable === null || Array.isArray(deliverable)) throw new ValidationError(`${context}: deliverable must be an object`);
	if (typeof deliverable.check !== "function") throw new ValidationError(`${context}: deliverable.check must be a function`);
	if (deliverable.checkState !== void 0 && typeof deliverable.checkState !== "function") throw new ValidationError(`${context}: deliverable.checkState must be a function`);
	if (deliverable.feedback !== void 0 && deliverable.feedback !== "verbatim" && deliverable.feedback !== "pass-only") throw new ValidationError(`${context}: deliverable.feedback must be 'verbatim' or 'pass-only'`);
	return Object.freeze({
		...detachedSnapshot({
			describe: deliverable.describe,
			...deliverable.feedback === void 0 ? {} : { feedback: deliverable.feedback },
			...deliverable.sealed === void 0 ? {} : { sealed: deliverable.sealed === true }
		}, `${context} configuration`),
		check: deliverable.check,
		...deliverable.checkState === void 0 ? {} : { checkState: deliverable.checkState }
	});
}
Object.freeze([...[
	"authorizeMessage",
	"authorizeSpawn",
	"driveHarness",
	"escalateQuestion",
	"executeExtraTool",
	"finalizer",
	"makeLeafAgent",
	"makeWorkerAgent",
	"now",
	"onCoordinationEvent",
	"onDriverAttempt",
	"onProgressStop",
	"onWorkerRetry",
	"recoverExecutor",
	"resolveDeliverable",
	"resolveDriveHarness",
	"resolveSpawnProfile",
	"resolveSupervisorTools",
	"stopRule"
]]);
/**
* Refuse a callback that reached the decision-data remainder, naming the option.
*
* The type test above cannot see a callback nested inside an object-valued option, and
* `detachedSnapshot` would report only that its input is not structured-cloneable. This says which
* key carries the callback and what to do about it, so the next occurrence is a five-second fix
* instead of a bisect over every option a caller passed.
*/
function assertNoUncapturedExecutableOption(decisionData) {
	const carried = Object.entries(decisionData).filter(([, value]) => typeof value === "function").map(([key]) => key);
	if (carried.length > 0) throw new ValidationError(`supervise: option ${carried.sort().join(", ")} carries a callback that the option capture does not forward, so the run would fail on a structured-clone refusal that names the snapshot instead of the option; lift the key out of the decision data in captureSuperviseOptions and add it to superviseExecutableOptionKeys`);
}
/** Capture the public one-call configuration before any asynchronous work starts. Decision data is
* detached and frozen; executable ports are copied as the exact references selected at intake.
* Service internals intentionally remain live, while replacing a callback/service on the caller's
* mutable options object can no longer change an in-flight run. */
/** The directory a root manager's spawn may resolve an inline resource `path` under. Only a
*  loopback bridge driver has one this process can read: its `cwd` is a directory on this host.
*  A remote bridge, a provider sandbox, or an in-process driver with no cwd yields `undefined`. */
function rootSpawnResourceRoot(backend) {
	if (backend === void 0 || backend.backend !== "bridge" || backend.cwd === void 0) return void 0;
	let host;
	try {
		host = new URL(backend.bridgeUrl).hostname;
	} catch {
		return;
	}
	return isLoopbackHost(host) ? resolve(backend.cwd) : void 0;
}
function captureSuperviseOptions(opts) {
	assertSuperviseOptionKeys(opts, "supervise");
	const { backend, coordination, driverBackend, deliverable, resolveDeliverable, router, compaction, watchWorkers, analysts, makeWorkerAgent, makeLeafAgent, recoverExecutor, resume, resolveSpawnProfile, blobs, journal, runContext, probes, registry, hooks, otel, authorizeSpawn, authorizeMessage, driveHarness, resolveDriveHarness, resolveSupervisorTools, escalateQuestion, onCoordinationEvent, executeExtraTool, stopRule, onProgressStop, onDriverAttempt, continuation, workerRetry, onWorkerRetry, finalizer, now, signal, rootHandle, workerSlots, ...decisionData } = opts;
	assertNoUncapturedExecutableOption(decisionData);
	const capturedData = detachedSnapshot(decisionData, "supervise options");
	const capturedCoordination = coordination === void 0 ? void 0 : (() => {
		const { publicUrl, onAudit, ...configuration } = coordination;
		return Object.freeze({
			...detachedSnapshot(configuration, "supervise coordination configuration"),
			...publicUrl === void 0 ? {} : { publicUrl },
			...onAudit === void 0 ? {} : { onAudit }
		});
	})();
	const capturedBackend = backend === void 0 ? void 0 : snapshotExecutorConfig(backend);
	const capturedDriverBackend = driverBackend === void 0 ? void 0 : snapshotExecutorConfig(driverBackend);
	const capturedDeliverable = deliverable === void 0 || typeof deliverable === "string" ? deliverable : captureDeliverable(deliverable, "supervise deliverable");
	const capturedRouter = router === void 0 ? void 0 : (() => {
		const { complete, ...routerData } = router;
		return Object.freeze({
			...detachedSnapshot(routerData, "supervise router configuration"),
			...complete === void 0 ? {} : { complete }
		});
	})();
	const capturedCompaction = compaction === void 0 ? void 0 : (() => {
		const { distill, estimateTokens, onCompact, ...compactionData } = compaction;
		return Object.freeze({
			...detachedSnapshot(compactionData, "supervise compaction configuration"),
			...distill === void 0 ? {} : { distill },
			...estimateTokens === void 0 ? {} : { estimateTokens },
			...onCompact === void 0 ? {} : { onCompact }
		});
	})();
	const capturedWatchWorkers = watchWorkers === void 0 ? void 0 : Object.freeze({
		...detachedSnapshot({ maxFindingsPerWorker: watchWorkers.maxFindingsPerWorker }, "supervise worker-watch configuration"),
		...watchWorkers.detectors === void 0 ? {} : { detectors: Object.freeze([...watchWorkers.detectors]) }
	});
	const capturedWorkerRetry = workerRetry === void 0 ? void 0 : Object.freeze({
		...detachedSnapshot({
			...workerRetry.enabled === void 0 ? {} : { enabled: workerRetry.enabled },
			...workerRetry.maxTotalMs === void 0 ? {} : { maxTotalMs: workerRetry.maxTotalMs },
			...workerRetry.initialBackoffMs === void 0 ? {} : { initialBackoffMs: workerRetry.initialBackoffMs },
			...workerRetry.maxBackoffMs === void 0 ? {} : { maxBackoffMs: workerRetry.maxBackoffMs }
		}, "supervise worker-retry configuration"),
		...workerRetry.additionalPreSpawnSignatures === void 0 ? {} : { additionalPreSpawnSignatures: Object.freeze([...workerRetry.additionalPreSpawnSignatures]) }
	});
	const capturedAnalysts = analysts === void 0 || typeof analysts === "string" ? analysts : Object.freeze({
		kinds: detachedSnapshot(analysts.kinds, "supervise analyst kinds"),
		run: analysts.run,
		...typeof analysts.register === "function" ? { register: analysts.register } : {}
	});
	const capturedContinuation = continuation === void 0 ? void 0 : (() => {
		const { runPanel, append, ...policy } = continuation;
		return Object.freeze({
			...detachedSnapshot(policy, "supervise continuation"),
			...runPanel === void 0 ? {} : { runPanel },
			...append === void 0 ? {} : { append }
		});
	})();
	return Object.freeze({
		...capturedData,
		...capturedCoordination === void 0 ? {} : { coordination: capturedCoordination },
		...capturedBackend === void 0 ? {} : { backend: capturedBackend },
		...capturedDriverBackend === void 0 ? {} : { driverBackend: capturedDriverBackend },
		...capturedDeliverable === void 0 ? {} : { deliverable: capturedDeliverable },
		...resolveDeliverable === void 0 ? {} : { resolveDeliverable },
		...capturedRouter === void 0 ? {} : { router: capturedRouter },
		...capturedCompaction === void 0 ? {} : { compaction: capturedCompaction },
		...capturedWatchWorkers === void 0 ? {} : { watchWorkers: capturedWatchWorkers },
		...capturedAnalysts === void 0 ? {} : { analysts: capturedAnalysts },
		...makeWorkerAgent === void 0 ? {} : { makeWorkerAgent },
		...makeLeafAgent === void 0 ? {} : { makeLeafAgent },
		...recoverExecutor === void 0 ? {} : { recoverExecutor },
		...resolveSpawnProfile === void 0 ? {} : { resolveSpawnProfile },
		...blobs === void 0 ? {} : { blobs },
		...journal === void 0 ? {} : { journal },
		...resume === void 0 ? {} : { resume },
		...runContext === void 0 ? {} : { runContext },
		...workerSlots === void 0 ? {} : { workerSlots },
		...probes === void 0 ? {} : { probes },
		...authorizeSpawn === void 0 ? {} : { authorizeSpawn },
		...authorizeMessage === void 0 ? {} : { authorizeMessage },
		...driveHarness === void 0 ? {} : { driveHarness },
		...resolveDriveHarness === void 0 ? {} : { resolveDriveHarness },
		...resolveSupervisorTools === void 0 ? {} : { resolveSupervisorTools },
		...escalateQuestion === void 0 ? {} : { escalateQuestion },
		...onCoordinationEvent === void 0 ? {} : { onCoordinationEvent },
		...executeExtraTool === void 0 ? {} : { executeExtraTool },
		...stopRule === void 0 ? {} : { stopRule },
		...onProgressStop === void 0 ? {} : { onProgressStop },
		...onDriverAttempt === void 0 ? {} : { onDriverAttempt },
		...capturedContinuation === void 0 ? {} : { continuation: capturedContinuation },
		...capturedWorkerRetry === void 0 ? {} : { workerRetry: capturedWorkerRetry },
		...onWorkerRetry === void 0 ? {} : { onWorkerRetry },
		...finalizer === void 0 ? {} : { finalizer },
		...now === void 0 ? {} : { now },
		...signal === void 0 ? {} : { signal },
		...rootHandle === void 0 ? {} : { rootHandle },
		...registry === void 0 ? {} : { registry },
		...hooks === void 0 ? {} : { hooks },
		...otel === void 0 ? {} : { otel }
	});
}
/**
* Record what a run-scoped cancel actually did, at the ONE place that observes the run's terminal
* state: the `supervise()` settle path.
*
* The observer writes `cancel_requested` when it issues the abort; only here is the run's own
* outcome known. An aborted run reads `cancelled` only with confirmed teardown, otherwise `unknown`.
* A run that reached any other terminal state despite the request terminated nothing and reads `not_live`,
* never a success. A request the run ended before applying is expired here too, so a reader can
* tell run-over from in-progress and a stale request cannot outlive its run.
*/
function recordRunCancellationOutcome(runDir, result, now) {
	if (runDir === void 0) return;
	const dir = resolve(runDir);
	const request = readRunCancelRequest(dir);
	if (request === void 0) return;
	const record = readRunCancellation(dir, request.operationId);
	if (record !== void 0 && record.effect !== "cancel_requested") return;
	const aborted = result.kind === "no-winner" && result.reason === "cancelled" && result.operationId === request.operationId;
	const observedAt = new Date(now()).toISOString();
	const base = {
		operationId: request.operationId,
		requestedAt: request.at,
		observedAt,
		...record?.path === void 0 ? {} : { path: record.path },
		...record?.appliedAfterMs === void 0 ? {} : { appliedAfterMs: record.appliedAfterMs },
		...record?.deadlineExceeded === void 0 ? {} : { deadlineExceeded: record.deadlineExceeded },
		...request.reason === void 0 ? {} : { reason: request.reason },
		...request.operator === void 0 ? {} : { operator: request.operator }
	};
	if (record === void 0) {
		writeRunCancellation(dir, {
			...base,
			effect: "not_live",
			detail: "run ended before the request was applied"
		});
		return;
	}
	if (aborted && result.teardownUnconfirmed?.length) {
		writeRunCancellation(dir, {
			...base,
			effect: "unknown",
			detail: `run aborted but teardown remains unconfirmed for: ${result.teardownUnconfirmed.map((node) => node.environments?.length ? `${node.id} (${node.environments.map((environment) => `${environment.provider}:${environment.environmentId}`).join(", ")})` : node.id).join(", ")}`
		});
		return;
	}
	writeRunCancellation(dir, aborted ? {
		...base,
		effect: "cancelled",
		detail: "the run reached its terminal cancelled state"
	} : {
		...base,
		effect: "not_live",
		detail: `run settled ${result.kind === "winner" ? "winner" : result.reason} despite the abort request; nothing was terminated`
	});
}
/** A quarter of token and optional dollar capacity per worker; nested managers partition again. */
/** A per-child budget may not exceed the conserved pool it is reserved from. */
function assertPerWorkerWithinPool(perWorker, pool) {
	const over = (child, total, field) => child > total ? `supervise perWorker.${field} (${child}) exceeds budget.${field} (${total})` : null;
	for (const [name, resource] of Object.entries(pool.resources ?? {})) {
		const child = perWorker.resources?.[name];
		if (!child) throw new ValidationError(`supervise perWorker resource ${name}: child must declare its limit`);
		if (child.unit !== resource.unit) throw new ValidationError(`supervise perWorker resource ${name}: unit mismatch`);
		const problem = over(child.limit, resource.limit, `resources.${name}.limit`);
		if (problem) throw new ValidationError(problem);
	}
	for (const name of Object.keys(perWorker.resources ?? {})) if (!Object.hasOwn(pool.resources ?? {}, name)) throw new ValidationError(`supervise perWorker resource ${name}: root must declare its limit`);
	const problems = [
		over(perWorker.maxTokens, pool.maxTokens, "maxTokens"),
		over(perWorker.maxIterations, pool.maxIterations, "maxIterations"),
		perWorker.maxUsd !== void 0 && pool.maxUsd !== void 0 ? over(perWorker.maxUsd, pool.maxUsd, "maxUsd") : null
	].filter((x) => x !== null);
	if (problems.length > 0) throw new ValidationError(`${problems.join("; ")} — a per-child ceiling cannot exceed the pool it draws from, and accepting it silently leaves the caller believing a knob is in effect when the reservation still clamps the child.`);
}
/** The slice a child gets when its manager names none: a quarter of the part of the manager's
*  budget its children may reserve, so four default children fill that part and the manager's
*  own share stays free for its turns. Each nested manager divides its own slice the same way. */
function defaultPerWorker(budget, ownerShare) {
	const share = (1 - ownerShare) / 4;
	return {
		...budget.resources === void 0 ? {} : { resources: Object.fromEntries(Object.entries(budget.resources).map(([name, value]) => [name, {
			unit: value.unit,
			limit: Math.floor(value.limit * share)
		}])) },
		maxIterations: Math.max(1, Math.floor(budget.maxIterations * share)),
		maxTokens: Math.max(1, Math.floor(budget.maxTokens * share)),
		...budget.maxUsd !== void 0 ? { maxUsd: budget.maxUsd * share } : {}
	};
}
function freezeDetached(value) {
	return detachedSnapshot(value, "supervise");
}
function freezeDetachedProfile(value) {
	return freezeDetached(agentProfileSchema.parse(value));
}
function canonicalExecution(profile, task, rawExecution, context) {
	const execution = rawExecution === void 0 ? void 0 : freezeDetached(rawExecution);
	if (execution !== void 0) {
		if (typeof execution !== "object" || execution === null || Array.isArray(execution)) throw new ValidationError(`${context}: execution must be an object`);
		const unknown = Object.keys(execution).filter((key) => key !== "candidateDigest" && key !== "correlation");
		if (unknown.length > 0) throw new ValidationError(`${context}: unknown execution fields: ${unknown.join(", ")}`);
	}
	const identity = deriveNodeExecutionIdentity({
		profile,
		execution
	}, task);
	if (!identity?.profileDigest || !identity.taskDigest) throw new ValidationError(`${context}: profile and task must be finite, acyclic canonical JSON for durable identity`);
	const ref = identity.candidateDigest || identity.correlation ? Object.freeze({
		...identity.candidateDigest ? { candidateDigest: identity.candidateDigest } : {},
		...identity.correlation ? { correlation: identity.correlation } : {}
	}) : void 0;
	return {
		identity,
		...ref ? { ref } : {}
	};
}
function rootCoordinationOwner(identity) {
	return canonicalCandidateDigest({
		kind: "supervisor-root",
		identity
	});
}
function childCoordinationOwner(parentOwnerId, identity, context, depth) {
	return canonicalCandidateDigest({
		kind: "supervisor-child",
		parentOwnerId,
		identity,
		assignment: {
			id: context.assignmentId,
			label: context.label,
			key: context.key ?? null,
			depth
		}
	});
}
function supervisionRunNamespace(runDir, runId) {
	return canonicalCandidateDigest(runDir === void 0 ? {
		kind: "supervise-ephemeral-run",
		runId,
		nonce: randomUUID()
	} : {
		kind: "supervise-durable-run",
		runId,
		runDir: resolve(runDir)
	});
}
function workerAssignmentNamespace(runNamespace, parentOwnerId, assignmentId) {
	return canonicalCandidateDigest({
		kind: "supervise-worker-assignment",
		runNamespace,
		parentOwnerId,
		assignmentId
	});
}
/** Hash only durable coordination meaning. Bus sequence/timestamp are delivery metadata and a
* resumed projection's marker describes the reader, not the original settlement. */
function coordinationEventId(context, event) {
	const durableEvent = event.type === "settled" && event.worker.resumed === true ? (() => {
		const { resumed: _resumed, ...worker } = event.worker;
		return {
			type: "settled",
			worker
		};
	})() : event;
	return canonicalCandidateDigest({
		kind: "supervise-coordination-event",
		runNamespace: context.runNamespace,
		ownerId: context.ownerId,
		event: detachedSnapshot(durableEvent, "supervise coordination event identity")
	});
}
/** One-call supervisor: build + run a supervisor from its exact profile. @stable */
function supervise(profile, task, opts) {
	if ("brain" in opts) throw new ValidationError("supervise: direct brain injection is test-only; production execution derives the model call from AgentProfile");
	return superviseWithContext(profile, task, opts);
}
/** A stop rule as a function, or the declared plateau form a record carries as data. */
function stopRuleOf(rule) {
	if (typeof rule === "function") return rule;
	if (typeof rule === "object" && rule !== null && "plateau" in rule) return plateau(rule.plateau);
	throw new ValidationError("supervise: stopRule must be a StopRule or { plateau: { window, minDelta } }");
}
/** Deterministic scripted-brain path for tests. Not exported from Runtime's main entry. */
function superviseWithTestBrain(profile, task, opts) {
	const { brain, ...runtimeOptions } = opts;
	return superviseWithContext(profile, task, runtimeOptions, brain);
}
/**
* The composer `profileGuidance` selects, or `undefined` when no guidance is selected. The result
* is re-validated as an AgentProfile, and a composition that breaks the schema is refused as a
* ValidationError. `supervise` applies it to the root and to authored spawns; `runGraph` applies
* it to pinned node profiles.
*/
function profileGuidanceComposer(guidance) {
	if (guidance === void 0) return void 0;
	if (guidance !== "profile-kb") throw new ValidationError(`supervise: profileGuidance must be 'profile-kb' when set, got ${JSON.stringify(guidance)}`);
	return (profile) => {
		const composed = agentProfileSchema.safeParse(withProfileKb(profile));
		if (!composed.success) throw new ValidationError(`supervise: profile-kb guidance produced an invalid AgentProfile: ${composed.error.message}`);
		return composed.data;
	};
}
/**
* The exact root profile `supervise` executes: `profile` parsed as an AgentProfile, with the
* selected `profileGuidance` composed. The root's journaled `identity.profileDigest` is this
* value's digest, so a reader that must match a recorded root derives it here, not by hand.
*/
function superviseRootProfile(profile, profileGuidance) {
	const parsedProfile = agentProfileSchema.safeParse(profile);
	if (!parsedProfile.success) throw new ValidationError(`supervise: invalid AgentProfile: ${parsedProfile.error.message}`);
	const compose = profileGuidanceComposer(profileGuidance);
	return freezeDetachedProfile(compose ? compose(parsedProfile.data) : parsedProfile.data);
}
function superviseWithContext(profile, task, opts, brain) {
	if (opts.runContext?.acquire === void 0) return superviseInternal(profile, task, opts, brain);
	const options = captureSuperviseOptions(opts);
	const capturedProfile = freezeDetached(profile);
	const capturedTask = freezeDetached(task);
	return withRunContext(opts.runContext, options.signal, (runContext, signal) => superviseInternal(capturedProfile, capturedTask, {
		...options,
		runContext,
		...signal === void 0 ? {} : { signal }
	}, brain));
}
function superviseInternal(profile, task, opts, testBrain) {
	const options = captureSuperviseOptions(opts);
	if (options.runContext?.durability === "sql") {
		if (options.runDir !== void 0 || options.journal !== void 0 && options.journal !== options.runContext.journal || options.blobs !== void 0 && options.blobs !== options.runContext.blobs || options.runId !== void 0 && options.runId !== options.runContext.runId) throw new ValidationError("supervise: SQL runContext cannot be mixed with another run identity or persistence path");
		if (options.backend?.backend !== "provider" || options.makeWorkerAgent || options.makeLeafAgent) throw new ValidationError("supervise: SQL runContext requires backend-derived retained provider workers");
	}
	assertValidBudget(options.budget, "supervise budget");
	const composeSpawnProfile = profileGuidanceComposer(options.profileGuidance);
	const canonicalProfile = superviseRootProfile(profile, options.profileGuidance);
	assertExecutableAgentProfile(canonicalProfile, "supervise root");
	const canonicalTask = freezeDetached(task);
	if (options.makeWorkerAgent && options.authorizeSpawn) throw new ValidationError("supervise: authorizeSpawn cannot be combined with caller-owned makeWorkerAgent; use makeLeafAgent to override leaf execution inside the authorized path, or use backend-derived workers");
	if (options.makeWorkerAgent && options.makeLeafAgent) throw new ValidationError("supervise: makeWorkerAgent replaces the worker path and makeLeafAgent overrides a leaf inside it; pass one");
	if (options.makeWorkerAgent && (options.workerRetry || options.onWorkerRetry)) throw new ValidationError("supervise: workerRetry applies only to backend-derived workers; compose withWorkerSpawnRetry onto a caller-owned makeWorkerAgent explicitly");
	if (options.makeWorkerAgent && options.resolveDeliverable) throw new ValidationError("supervise: resolveDeliverable applies only to backend-derived workers; wrap a caller-owned makeWorkerAgent with its completion checks explicitly");
	const authorizeDownFor = (parent, depth) => {
		if (!options.authorizeSpawn && !options.authorizeMessage) return void 0;
		return (input) => {
			if (!options.authorizeMessage) throw new ValidationError("supervise: authorizeMessage is required before steer_agent or answer_question when authorizeSpawn is enabled");
			return freezeDetached(options.authorizeMessage(freezeDetached({
				...input,
				parent,
				depth
			})));
		};
	};
	const rootExecution = canonicalExecution(canonicalProfile, canonicalTask, options.execution, "supervise root");
	const backendModel = options.backend?.model;
	const driverBackendModel = options.driverBackend?.model;
	assertProfileModelsAllowed(canonicalProfile, options.allowedModels);
	assertModelAllowed(typeof backendModel === "string" ? backendModel : void 0, options.allowedModels);
	assertModelAllowed(typeof driverBackendModel === "string" ? driverBackendModel : void 0, options.allowedModels);
	const deliverable = resolveNamed("deliverable", "deliverables", options.deliverable, options.registry?.deliverables);
	const finalizer = resolveNamed("finalizer", "finalizers", options.finalizer, options.registry?.finalizers);
	const analysts = resolveNamed("analysts", "analysts", options.analysts, options.registry?.analysts);
	const probes = resolveNamed("probes", "probes", options.probes, options.registry?.probes);
	const profileTable = snapshotProfileTable(options.registry?.profiles, options.allowedModels, options.makeWorkerAgent === void 0 && options.authorizeSpawn === void 0 ? (entry, context) => {
		const security = validateAgentProfileSecurity(entry, options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY);
		if (!security.ok) throw new ValidationError(`${context}: ${security.issues.filter((issue) => issue.level === "error").map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ""}`).join(", ")}`);
		if (options.backend !== void 0 && options.makeLeafAgent === void 0 && declaredRuntimeToolNames(entry).length === 0) assertBackendProfileMaterialization(entry, options.backend, context);
	} : void 0);
	assertCoordinationBinding(options.coordination);
	const ctx = options.runContext ?? (options.runDir !== void 0 ? createFileRunContext(options.runDir, { withDriver: true }) : createInMemoryRunContext({ withDriver: true }));
	const blobs = options.blobs ?? ctx.blobs;
	assertRecursiveReservationPolicy(options.reservationPolicy);
	const ownerShare = options.reservationPolicy?.ownerShare ?? 0;
	const perWorker = options.perWorker ?? defaultPerWorker(options.budget, ownerShare);
	assertValidBudget(perWorker, "supervise perWorker");
	assertPerWorkerWithinPool(perWorker, options.budget);
	const journal = options.journal ?? ctx.journal;
	const runId = options.runId ?? ctx.runId ?? "supervise";
	const runNamespace = ctx.namespace ?? supervisionRunNamespace(options.runDir, runId);
	const log = ctx.coordinationLog;
	const rootOwnerId = rootCoordinationOwner(rootExecution.identity);
	const rootProviderModels = [];
	const rootStreamSink = options.runDir === void 0 ? void 0 : createRootStreamSink(resolve(options.runDir), options.now ?? Date.now);
	const observeNodeEvent = options.onCoordinationEvent ? async (context, event, record) => {
		await options.onCoordinationEvent?.(context, coordinationEventId(context, event), record);
	} : void 0;
	const managerBackend = options.driverBackend ?? (options.rootDriverFromBackend === false ? void 0 : options.backend);
	if (options.driveHarness && options.resolveDriveHarness) throw new ValidationError("supervise: provide driveHarness or resolveDriveHarness, not both");
	const hasCustomDriveHarness = Boolean(options.driveHarness || options.resolveDriveHarness);
	const spawnResourceRoot = hasCustomDriveHarness ? void 0 : rootSpawnResourceRoot(managerBackend);
	const spawnPreflight = composeSpawnPreflights(profileToolSpawnPreflight(options.makeWorkerAgent === void 0, options.resolveSupervisorTools !== void 0), coordinationChannelSpawnPreflight(options.makeWorkerAgent === void 0, hasCustomDriveHarness, managerBackend, options.coordination), options.backend?.backend === "bridge" ? bridgeSpawnPreflight(options.backend) : void 0);
	const driverMaterialization = hasCustomDriveHarness ? options.driveHarnessMaterialization ?? fullProfileMaterialization : managerBackend && automaticDriverBackendSupported(managerBackend, options.coordination) ? backendProfileMaterialization(managerBackend) : void 0;
	if (isExternalSupervisor(canonicalProfile) && !options.driveHarness && !options.resolveDriveHarness && (!managerBackend || !automaticDriverBackendSupported(managerBackend, options.coordination))) throw new ValidationError(`supervise: external supervisor profile.harness=${JSON.stringify(canonicalProfile.harness)} requires a local bridge, a provider with authenticated coordination.publicUrl and runtime MCP attachments, or an explicit driveHarness with reachable coordination transport`);
	const externalManagersAvailable = hasCustomDriveHarness || managerBackend !== void 0 && automaticDriverBackendSupported(managerBackend, options.coordination);
	const canLead = (child) => isExternalSupervisor(child) ? externalManagersAvailable : options.router !== void 0;
	const childrenCanSubmit = deliverable !== void 0 || options.resolveDeliverable !== void 0;
	const composeSpawnProfileFor = (parent) => {
		if (options.inheritSpawnRights === false || options.makeWorkerAgent !== void 0 || !childrenCanSubmit) return composeSpawnProfile;
		return (authored) => {
			const composed = composeSpawnProfile ? composeSpawnProfile(authored) : authored;
			return canLead(composed) ? withInheritedSpawnRights(parent, composed) : composed;
		};
	};
	const harnessClaims = /* @__PURE__ */ new WeakMap();
	const claimDriveHarness = (rawHarness, ownerId) => {
		if (typeof rawHarness !== "function") throw new ValidationError("supervise: resolveDriveHarness must return a DriveHarness function");
		const harness = rawHarness;
		const deliver = harness.deliver;
		if (deliver !== void 0 && typeof deliver !== "function") throw new ValidationError("supervise: driveHarness.deliver must be a function when provided");
		const deliverReady = harness.deliverReady;
		if (deliverReady !== void 0 && typeof deliverReady !== "function") throw new ValidationError("supervise: driveHarness.deliverReady must be a function when provided");
		const claim = harnessClaims.get(harness);
		const conflictingOwner = claim ? [...claim.owners].find((claimedOwner) => claimedOwner !== ownerId) : void 0;
		const steerable = typeof deliver === "function";
		if (conflictingOwner !== void 0 && (steerable || claim?.steerable === true)) throw new ValidationError(`supervise: steerable driveHarness is already bound to manager owner ${JSON.stringify(conflictingOwner)}; resolveDriveHarness must return a distinct steerable instance for owner ${JSON.stringify(ownerId)}`);
		if (claim) {
			claim.owners.add(ownerId);
			claim.steerable ||= steerable;
		} else harnessClaims.set(harness, {
			owners: /* @__PURE__ */ new Set([ownerId]),
			steerable
		});
		return harness;
	};
	const driveHarnessForOwner = (context) => {
		if (options.resolveDriveHarness) return claimDriveHarness(options.resolveDriveHarness(context), context.ownerId);
		if (options.driveHarness) return claimDriveHarness(options.driveHarness, context.ownerId);
		return managerBackend && automaticDriverBackendSupported(managerBackend, options.coordination) ? driveHarnessFromBackend(managerBackend, externalExecutionId("supervised-manager", {
			runNamespace,
			ownerId: context.ownerId
		}), options.now ?? Date.now, options.maxTurns, context.depth === 0 ? rootStreamSink : void 0) : void 0;
	};
	const rootDriveHarness = isExternalSupervisor(canonicalProfile) ? driveHarnessForOwner(freezeDetached({
		runId,
		runNamespace,
		ownerId: rootOwnerId,
		depth: 0,
		identity: rootExecution.identity,
		profile: canonicalProfile,
		task: canonicalTask
	})) : void 0;
	const rootOwnerRuntime = !isExternalSupervisor(canonicalProfile) || rootDriveHarness === void 0 ? void 0 : runtimeOwnedScopeOwnerRuntime(rootDriveHarness);
	assertProfileContract(canonicalProfile, isExternalSupervisor(canonicalProfile) ? driverMaterialization : testBrain ? promptControlProfileMaterialization : routerSupervisorProfileMaterialization, "supervise root", true);
	const now = options.now ?? Date.now;
	let spans;
	const traceUnpropagated = options.backend ? workerTraceUnpropagatedDeclaration(options.backend.backend) : void 0;
	const recoveryFactories = /* @__PURE__ */ new WeakMap();
	let makeWorkerAgent = options.makeWorkerAgent;
	if (!makeWorkerAgent) {
		if (!options.backend && !options.makeLeafAgent) throw new ValidationError("supervise: provide opts.backend (where workers run), opts.makeLeafAgent, or opts.makeWorkerAgent");
		const withRetry = (make) => withWorkerSpawnRetry(make, options.workerRetry, { ...options.onWorkerRetry ? { onRetry: options.onWorkerRetry } : {} });
		const makeLeaf = withRetry(options.makeLeafAgent ?? workerFromBackend(options.backend, deliverable));
		const securityPolicy = options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY;
		const makeRecursiveWorkerFor = (parent, parentIdentity, depth, parentOwnerId) => {
			const makeRecursiveWorker = (authoredProfile, spawnContext, recovering = false) => {
				if (!spawnContext) throw new ValidationError("supervise: backend-derived workers require spawn context");
				const input = freezeDetachedProfile(authoredProfile);
				const authorizationInput = Object.freeze({
					profile: input,
					parent,
					parentIdentity,
					parentNodeId: spawnContext.parentNodeId,
					assignmentId: spawnContext.assignmentId,
					task: spawnContext.task,
					budget: spawnContext.budget,
					label: spawnContext.label,
					...spawnContext.key !== void 0 ? { key: spawnContext.key } : {},
					depth,
					...spawnContext.analyst !== void 0 ? { analyst: spawnContext.analyst } : {},
					...spawnContext.continuity !== void 0 ? { continuity: spawnContext.continuity } : {}
				});
				const decision = !recovering && options.authorizeSpawn ? freezeDetached(options.authorizeSpawn(authorizationInput)) : Object.freeze({
					profile: input,
					...spawnContext.execution ? { execution: spawnContext.execution } : {}
				});
				if (typeof decision !== "object" || decision === null || Array.isArray(decision)) throw new ValidationError("supervise: authorizeSpawn must return an AuthorizedSpawn");
				const authorized = freezeDetachedProfile(decision.profile);
				const childExecution = canonicalExecution(authorized, spawnContext.task, decision.execution, `supervise spawn ${JSON.stringify(spawnContext.label)}`);
				const authorizedContext = Object.freeze({
					...spawnContext,
					...childExecution.ref ? { execution: childExecution.ref } : {}
				});
				const postAuthorizationContext = freezeDetached({
					profile: authorized,
					parent,
					parentIdentity,
					execution: childExecution.identity,
					parentNodeId: spawnContext.parentNodeId,
					assignmentId: spawnContext.assignmentId,
					task: spawnContext.task,
					budget: spawnContext.budget,
					label: spawnContext.label,
					...spawnContext.key !== void 0 ? { key: spawnContext.key } : {},
					depth
				});
				const security = validateAgentProfileSecurity(authorized, securityPolicy);
				if (!security.ok) throw new ValidationError(`supervise: spawned AgentProfile refused: ${security.issues.filter((issue) => issue.level === "error").map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ""}`).join(", ")}`);
				assertProfileModelsAllowed(authorized, options.allowedModels);
				const selectedDeliverable = options.resolveDeliverable?.(postAuthorizationContext);
				const childDeliverable = selectedDeliverable === void 0 ? deliverable : captureDeliverable(selectedDeliverable, `supervise deliverable for ${JSON.stringify(spawnContext.label)}`);
				if (!(declaredRuntimeToolNames(authorized).length > 0)) {
					if (childDeliverable !== deliverable && !options.backend) throw new ValidationError("supervise: resolveDeliverable selected a per-spawn deliverable but there is no backend to derive that leaf from; makeLeafAgent owns its own completion check");
					return (childDeliverable === deliverable ? makeLeaf : withRetry(workerFromBackend(options.backend, childDeliverable)))(authorized, Object.freeze({
						...authorizedContext,
						assignmentId: workerAssignmentNamespace(runNamespace, parentOwnerId, spawnContext.assignmentId)
					}));
				}
				const ownerId = childCoordinationOwner(parentOwnerId, childExecution.identity, spawnContext, depth);
				const nestedDriveHarness = isExternalSupervisor(authorized) ? driveHarnessForOwner(freezeDetached({
					runId,
					runNamespace,
					ownerId,
					depth,
					identity: childExecution.identity,
					assignmentId: spawnContext.assignmentId,
					profile: authorized,
					task: spawnContext.task
				})) : void 0;
				if (isExternalSupervisor(authorized) && !nestedDriveHarness) throw new ValidationError(`supervise: authored external supervisor profile.harness=${JSON.stringify(authorized.harness)} requires a local bridge, a provider with authenticated coordination.publicUrl and runtime MCP attachments, or an explicit driveHarness with reachable coordination transport`);
				assertProfileContract(authorized, isExternalSupervisor(authorized) ? driverMaterialization : promptModelProfileMaterialization, `supervise driver ${JSON.stringify(spawnContext.label)}`, true);
				if (managerBackend) assertBridgeProfileMaterializes(profileWithoutDeclaredRuntimeCoordinationTools(authorized), managerBackend, `supervise driver ${JSON.stringify(spawnContext.label)}`);
				const childFactory = makeRecursiveWorkerFor(authorized, childExecution.identity, depth + 1, ownerId);
				const nestedPerWorker = defaultPerWorker(spawnContext.budget, ownerShare);
				const authorizeNestedMessage = authorizeDownFor(authorized, depth + 1);
				let acceptedSubmission = false;
				return driverChild(authorized, supervisorAgent(authorized, {
					blobs,
					makeWorkerAgent: childFactory,
					...authorizeNestedMessage ? { authorizeDownMessage: authorizeNestedMessage } : {},
					perWorker: nestedPerWorker,
					...ownerShare > 0 ? { preserveOwnerTurns: true } : {},
					...options.router ? { router: options.router } : {},
					...nestedDriveHarness ? { driveHarness: nestedDriveHarness } : {},
					...options.coordination && isExternalSupervisor(authorized) ? { coordination: options.coordination } : {},
					nodeContext: {
						runId,
						runNamespace,
						ownerId,
						depth,
						identity: childExecution.identity,
						assignmentId: spawnContext.assignmentId
					},
					...options.resolveSupervisorTools ? { resolveSupervisorTools: options.resolveSupervisorTools } : {},
					...observeNodeEvent ? {
						observeNodeEvent,
						replaySettlements: true
					} : {},
					...analysts ? { analysts } : {},
					...options.escalateQuestion ? { escalateQuestion: options.escalateQuestion } : {},
					...options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {},
					...options.watchWorkers ? { watchWorkers: options.watchWorkers } : {},
					...options.stallAfterMs !== void 0 ? { stallAfterMs: options.stallAfterMs } : {},
					...options.awaitTimeoutMs !== void 0 ? { awaitTimeoutMs: options.awaitTimeoutMs } : {},
					...options.continuityByProfile ? { continuityByProfile: options.continuityByProfile } : {},
					...spawnPreflight ? { preflightSpawn: spawnPreflight } : {},
					...options.resolveSpawnProfile ? { resolveSpawnProfile: options.resolveSpawnProfile } : {},
					...composeSpawnProfileFor(authorized) ? { composeSpawnProfile: composeSpawnProfileFor(authorized) } : {},
					...profileTable ? { profiles: profileTable } : {},
					...options.peerMail ? { peerMail: options.peerMail } : {},
					...options.stopRule ? { stopRule: stopRuleOf(options.stopRule) } : {},
					...options.onProgressStop ? { onProgressStop: options.onProgressStop } : {},
					...options.maxTurns !== void 0 ? { maxTurns: options.maxTurns } : {},
					...options.compaction ? { compaction: options.compaction } : {},
					...options.driverRetry ? { driverRetry: options.driverRetry } : {},
					...options.onDriverAttempt ? { onDriverAttempt: options.onDriverAttempt } : {},
					...childDeliverable ? { deliverable: childDeliverable } : {},
					...childDeliverable ? { onAcceptedSubmission: () => {
						acceptedSubmission = true;
					} } : {},
					...childDeliverable && options.continuation && isExternalSupervisor(authorized) ? {
						continuation: options.continuation,
						...options.runDir === void 0 ? {} : { continuationDir: resolve(options.runDir, CONTINUATIONS_DIR, "managers", encodeURIComponent(ownerId)) }
					} : {},
					...log ? {
						onEvent: (_event, record) => log.append(runId, record, ownerId),
						loadPriorCoordination: () => log.load(runId, ownerId)
					} : {},
					...finalizer ? { finalizer } : {},
					...options.runDir === void 0 ? {} : {
						controlDir: resolve(options.runDir),
						abortRun: cancelDurableRun
					},
					...options.steerDir === void 0 ? {} : { steerDir: resolve(options.steerDir) },
					...options.runDir === void 0 && options.steerDir === void 0 ? {} : { controlScope: "subtree" }
				}), journal, childExecution.ref, () => acceptedSubmission, recoveryFactories.get(childFactory));
			};
			if (options.makeLeafAgent === void 0 && options.backend?.backend === "provider" && !options.backend.steering) {
				const factory = registerRetainedExecutorPreparation(createExecutor(options.backend), ({ spawned, profile, task }) => {
					if (!spawned.ownedTreeRoot || !spawned.parent || !spawned.assignmentId || !spawned.identity) return void 0;
					const execution = {
						...spawned.identity.candidateDigest ? { candidateDigest: spawned.identity.candidateDigest } : {},
						...spawned.identity.correlation ? { correlation: spawned.identity.correlation } : {}
					};
					const spec = makeRecursiveWorker(profile, {
						assignmentId: spawned.assignmentId,
						parentNodeId: spawned.parent,
						budget: spawned.budget,
						task,
						label: spawned.label,
						...spawned.key === void 0 ? {} : { key: spawned.key },
						execution
					}, true).executorSpec;
					if (!spec || !isDriverSpec(spec)) return void 0;
					return {
						spec,
						factory: driverExecutorFactory
					};
				});
				recoveryFactories.set(makeRecursiveWorker, factory);
			}
			return makeRecursiveWorker;
		};
		makeWorkerAgent = makeRecursiveWorkerFor(canonicalProfile, rootExecution.identity, 1, rootOwnerId);
	}
	const runControl = options.rootHandle ?? (options.runDir === void 0 ? void 0 : createRootHandle());
	const durableCancellation = new AbortController();
	const cancelDurableRun = (reason, request) => {
		durableCancellation.abort(request === void 0 ? new Error(reason) : new RunCancellationReason(request.source, reason, request.operationId));
	};
	const workerFactory = makeWorkerAgent;
	let rootContinuation;
	const start = async () => {
		if (ctx.durability === "sql") {
			if (options.backend?.backend !== "provider" || options.backend.steering || options.driveHarness || options.resolveDriveHarness || options.driverBackend) throw new ValidationError("supervise: SQL runContext requires a local coordinator and non-steering retained provider workers");
			const provider = resolveAgentEnvironmentProvider(options.backend.provider, options.backend.registry);
			const capabilities = await provider.capabilities();
			if (!capabilities.retainedControl || !capabilities.streaming.turnIdempotency || !capabilities.streaming.replay || !provider.get) throw new ValidationError("supervise: SQL runContext requires retainedControl, replay, turn idempotency, and provider.get");
		}
		await verifyProfilePromotions(profileTable);
		const priorCoordination = log ? await log.load(runId, rootOwnerId) : void 0;
		const authorizeRootMessage = authorizeDownFor(canonicalProfile, 1);
		const agentDeps = {
			blobs,
			makeWorkerAgent: workerFactory,
			...authorizeRootMessage ? { authorizeDownMessage: authorizeRootMessage } : {},
			perWorker,
			...ownerShare > 0 ? { preserveOwnerTurns: true } : {},
			...log ? { onEvent: (_event, record) => log.append(runId, record, rootOwnerId) } : {},
			...deliverable ? { deliverable } : {},
			onProviderModel(model) {
				rootProviderModels.push(model);
			},
			onDriverLoopSettled(record) {
				rootContinuation = record;
			},
			...priorCoordination && (priorCoordination.questions.length > 0 || priorCoordination.findings.length > 0 || priorCoordination.continuations.length > 0 || priorCoordination.deliveryEvidence.length > 0 || priorCoordination.records.some((record) => record.event.type === "submission")) ? { priorCoordination } : {},
			...finalizer ? { finalizer } : {},
			...options.coordination && isExternalSupervisor(canonicalProfile) ? { coordination: options.coordination } : {},
			...spawnPreflight ? { preflightSpawn: spawnPreflight } : {},
			...options.resolveSpawnProfile ? { resolveSpawnProfile: options.resolveSpawnProfile } : {},
			...composeSpawnProfileFor(canonicalProfile) ? { composeSpawnProfile: composeSpawnProfileFor(canonicalProfile) } : {},
			...profileTable ? { profiles: profileTable } : {},
			...spawnResourceRoot === void 0 ? {} : { spawnResourceRoot },
			...options.peerMail ? { peerMail: options.peerMail } : {},
			...options.router ? { router: options.router } : {},
			...rootDriveHarness ? { driveHarness: rootDriveHarness } : {},
			nodeContext: {
				runId,
				runNamespace,
				ownerId: rootOwnerId,
				depth: 0,
				identity: rootExecution.identity
			},
			...options.resolveSupervisorTools ? { resolveSupervisorTools: options.resolveSupervisorTools } : {},
			...observeNodeEvent ? {
				observeNodeEvent,
				replaySettlements: true
			} : {},
			...options.extraTools ? { extraTools: options.extraTools } : {},
			...options.executeExtraTool ? { executeExtraTool: options.executeExtraTool } : {},
			...analysts ? { analysts } : {},
			...options.escalateQuestion ? { escalateQuestion: options.escalateQuestion } : {},
			...options.analyzeOnSettle ? { analyzeOnSettle: options.analyzeOnSettle } : {},
			...options.watchWorkers ? { watchWorkers: options.watchWorkers } : {},
			...options.stallAfterMs !== void 0 ? { stallAfterMs: options.stallAfterMs } : {},
			...options.awaitTimeoutMs !== void 0 ? { awaitTimeoutMs: options.awaitTimeoutMs } : {},
			...options.continuityByProfile ? { continuityByProfile: options.continuityByProfile } : {},
			...options.stopRule ? { stopRule: stopRuleOf(options.stopRule) } : {},
			...options.onProgressStop ? { onProgressStop: options.onProgressStop } : {},
			...options.maxTurns !== void 0 ? { maxTurns: options.maxTurns } : {},
			...options.compaction ? { compaction: options.compaction } : {},
			...options.driverRetry ? { driverRetry: options.driverRetry } : {},
			...options.onDriverAttempt ? { onDriverAttempt: options.onDriverAttempt } : {},
			...deliverable && options.continuation && isExternalSupervisor(canonicalProfile) ? {
				continuation: options.continuation,
				...options.runDir === void 0 ? {} : {
					continuationDir: resolve(options.runDir, CONTINUATIONS_DIR),
					rootStreamPath: resolve(options.runDir, ROOT_STREAM_FILE)
				}
			} : {},
			...options.runDir === void 0 || runControl === void 0 ? {} : {
				controlDir: resolve(options.runDir),
				abortRun: cancelDurableRun
			},
			...options.steerDir === void 0 ? {} : { steerDir: resolve(options.steerDir) }
		};
		const agent = testBrain === void 0 ? supervisorAgent(canonicalProfile, agentDeps) : supervisorAgentWithTestBrain(canonicalProfile, {
			...agentDeps,
			brain: testBrain
		});
		spans = options.otel ? createSupervisorSpanRecorder({
			runId,
			...options.otel,
			now
		}) : void 0;
		const recorder = spans;
		const hooks = recorder ? composeRuntimeHooks(options.hooks, recorder.hooks) : options.hooks;
		const supervisor = createSupervisor();
		if (runControl !== void 0) supervisor.attach(runControl);
		const cancellation = options.runDir !== void 0 && runControl !== void 0 ? watchRunCancellation(resolve(options.runDir), cancelDurableRun) : void 0;
		try {
			cancellation?.check();
		} catch (error) {
			cancellation?.close();
			throw error;
		}
		const run = supervisor.run(agent, canonicalTask, {
			budget: options.budget,
			runId,
			journal,
			blobs,
			executors: ctx.executors,
			...options.recoverExecutor ?? recoveryFactories.get(workerFactory) ? { recoverExecutor: options.recoverExecutor ?? recoveryFactories.get(workerFactory) } : {},
			rootIdentity: rootExecution.identity,
			...rootOwnerRuntime === void 0 ? {} : { rootMaterialization: {
				runtime: rootOwnerRuntime,
				declaration: "deferred",
				authoredProfile: canonicalProfile
			} },
			maxDepth: options.maxDepth ?? 16,
			...options.childSettleGraceMs !== void 0 ? { childSettleGraceMs: options.childSettleGraceMs } : {},
			...options.teardownConfirmMs !== void 0 ? { teardownConfirmMs: options.teardownConfirmMs } : {},
			...options.retainedAtSettlement !== void 0 ? { retainedAtSettlement: options.retainedAtSettlement } : {},
			ownerWorkspaceRetention: managerBackend?.backend === "provider" && managerBackend.workspaceRetention !== void 0,
			...options.workerSlots !== void 0 ? { workerSlots: options.workerSlots } : {},
			...options.reservationPolicy ? { reservationPolicy: options.reservationPolicy } : {},
			...probes ? { probes } : {},
			...ctx.resume === true || options.runDir === void 0 && options.resume === true ? { resume: true } : {},
			...options.now ? { now: options.now } : {},
			signal: options.signal ? AbortSignal.any([options.signal, durableCancellation.signal]) : durableCancellation.signal,
			...hooks ? { hooks } : {},
			...recorder ? { workerTrace: recorder.workerTrace } : {},
			...recorder && traceUnpropagated ? { workerTraceUnpropagated: traceUnpropagated } : {},
			...options.runDir === void 0 ? {} : { interactiveBindingDir: resolve(options.runDir) }
		});
		const settle = async () => {
			let result;
			let rootStream;
			try {
				result = await run;
			} finally {
				try {
					rootStream = await rootStreamSink?.close();
				} finally {
					cancellation?.close();
					cancellation?.check();
				}
			}
			recordRunCancellationOutcome(options.runDir, result, now);
			const rootHarnessTranscript = rootDriveHarness === void 0 ? void 0 : await persistHarnessTranscript(readHarnessTranscript(rootDriveHarness), blobs);
			const rootProviderModel = ctx.resume === true ? rootProviderModelEvidence([]) : rootProviderModels.length > 0 ? rootProviderModelEvidence(rootProviderModels) : rootDriveHarness === void 0 ? rootProviderModelEvidence([]) : rootProviderModelEvidenceFromExecution(runtimeOwnedDriveHarnessProviderEvidence(rootDriveHarness));
			return {
				...result,
				rootProviderModel,
				...rootStream === void 0 ? {} : { rootStream },
				...rootHarnessTranscript === void 0 ? {} : { rootHarnessTranscript },
				...rootContinuation === void 0 ? {} : { continuation: rootContinuation }
			};
		};
		if (!recorder) return settle();
		try {
			const result = await settle();
			await recorder.finish({ result });
			return result;
		} catch (error) {
			await recorder.finish({ error });
			throw error;
		}
	};
	return start();
}
/** Historical unclassified input is already charged; replay cannot refund it with a class-only delta. */
function unmeteredOwnerCache(total, committed) {
	const cache = {
		...total.freshInput === void 0 ? {} : { freshInput: Math.max(0, total.freshInput - (committed.freshInput ?? 0)) },
		...total.cacheRead === void 0 ? {} : { cacheRead: Math.max(0, total.cacheRead - (committed.cacheRead ?? 0)) },
		...total.cacheWrite === void 0 ? {} : { cacheWrite: Math.max(0, total.cacheWrite - (committed.cacheWrite ?? 0)) }
	};
	if ((cache.freshInput ?? 0) + (cache.cacheRead ?? 0) + (cache.cacheWrite ?? 0) > Math.max(0, total.input - committed.input)) return { cacheBreakdownKnown: false };
	return {
		...cache,
		...total.cacheBreakdownKnown === false ? { cacheBreakdownKnown: false } : {}
	};
}
function rootProviderModelEvidence(observations) {
	const attempts = Object.freeze(observations.map((model) => Object.freeze({ observations: Object.freeze(model === void 0 ? [] : [model]) })));
	const models = [...new Set(observations.filter((model) => model !== void 0))];
	if (observations.length === 0 || observations.some((model) => model === void 0)) return Object.freeze({
		status: "unknown",
		attempts,
		models: Object.freeze(models),
		reason: "provider-model-missing"
	});
	return Object.freeze({
		status: "known",
		attempts,
		models: Object.freeze(models)
	});
}
function rootProviderModelEvidenceFromExecution(evidence) {
	return evidence ?? rootProviderModelEvidence([]);
}
//#endregion
export { gateOnDeliverable as C, serveCoordinationMcp as S, readRootStream as _, superviseWithTestBrain as a, composeReentryTask as b, resolveWorkerSpawnRetry as c, assertCoordinationBinding as d, coordinationProfileToolPrefix as f, ROOT_STREAM_FILE as g, supervisorAgentWithTestBrain as h, superviseRootProfile as i, retryPreSpawnRefusals as l, supervisorAgent as m, profileGuidanceComposer as n, workerFromBackend as o, resolveSupervisorProfile as p, supervise as r, isPreSpawnExecutorFailure as s, DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY as t, withWorkerSpawnRetry as u, readRootStreamReceipt as v, mapExecutorResult as w, createSupervisorSpanRecorder as x, UNPROVEN_CONTINUITY as y };

//# sourceMappingURL=supervise-DBQdrp7H.js.map