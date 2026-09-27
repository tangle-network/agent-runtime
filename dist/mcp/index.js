import { $r as runWorktreeHarness, Fr as traceContextToEnv, Hn as runAgentRounds, Kn as assertBoxlessPromptOptions, Mr as createPropagatingTraceEmitter, Nr as mergeTraceEnv, Pr as readTraceContextFromEnv, Sa as sleep, Ta as throwIfAborted, _a as deleteBoxSafe, ci as parseCodexTokenUsage, dt as hostDirectoryReader, ei as captureWorktreeDiff, ft as resolveSpawnResourcePaths, ii as LOCAL_HARNESSES, li as CodexExecutionDiagnosticError, lt as SPAWN_RESOURCE_PATH_MAX_BYTES, ni as removeWorktree, oi as harnessSupportsReasoningEffort, ri as DEFAULT_LOCAL_HARNESS, si as localHarnessExecutable, ti as createWorktree, ut as environmentReader, wa as throwAbort, zn as createSandboxForSpec } from "../supervisor-DtlPj9me.js";
import { i as ConfigError, m as ValidationError } from "../errors-DodWX-cb.js";
import { t as assertExecutableAgentProfile } from "../model-policy-BbSCSak0.js";
import { O as runCoderChecks, mt as selectValidWinner } from "../runtime-DsAHXig2.js";
import { A as createCoordinationTools, D as analystToolGroupNames, E as DEFAULT_AWAIT_EVENT_TIMEOUT_MS, F as questionEscalationTargets, M as downMessageRefusalReasons, P as parseAuthoredAnalystDefinition, T as ANALYST_DEFINITION_BOUNDS } from "../coordination-driver-BBL_OgRw.js";
import { n as SUPPORTED_PROTOCOL_VERSIONS, r as createStdioToolServer } from "../tool-server-Dqer2M4_.js";
import { t as createKbGate } from "../kb-gate-DpaSwXVx.js";
import { _ as InMemoryFeedbackStore, a as validateDelegationStatusArgs, c as DELEGATION_HISTORY_TOOL_NAME, d as delegationProfiles, f as DELEGATE_FEEDBACK_DESCRIPTION, g as validateDelegateFeedbackArgs, h as createDelegateFeedbackHandler, i as createDelegationStatusHandler, l as createDelegationHistoryHandler, m as DELEGATE_FEEDBACK_TOOL_NAME, n as DELEGATION_STATUS_INPUT_SCHEMA, o as DELEGATION_HISTORY_DESCRIPTION, p as DELEGATE_FEEDBACK_INPUT_SCHEMA, r as DELEGATION_STATUS_TOOL_NAME, s as DELEGATION_HISTORY_INPUT_SCHEMA, t as DELEGATION_STATUS_DESCRIPTION, u as validateDelegationHistoryArgs, v as eventToSnapshot } from "../delegation-status-CF4D0NZ_.js";
import { n as mcpToolsForRuntimeMcpSubset, t as mcpToolsForRuntimeMcp } from "../openai-tools-DoQ32vpe.js";
import { t as coderTaskToPrompt } from "../coder-yhVWbdWc.js";
import { C as composeLoopTraceEmitters, S as capDelegationTrace, _ as FileDelegationStore, a as DELEGATE_UI_AUDIT_TOOL_NAME, b as DELEGATION_TRACE_MAX_SPANS, c as DELEGATE_DESCRIPTION, d as createDelegateHandler, f as validateDelegateArgs, g as DelegationStateCorruptError, h as DelegationPersistenceError, i as DELEGATE_UI_AUDIT_INPUT_SCHEMA, l as DELEGATE_INPUT_SCHEMA, m as hashIdempotencyInput, n as createMcpServer, o as createDelegateUiAuditHandler, p as DelegationTaskQueue, r as DELEGATE_UI_AUDIT_DESCRIPTION, s as validateDelegateUiAuditArgs, t as createInProcessTransport, u as DELEGATE_TOOL_NAME, v as InMemoryDelegationStore, w as createDelegationTraceCollector, x as buildDelegationTraceSpans, y as DELEGATION_TRACE_MAX_BYTES } from "../server-Dyc1zvug.js";
import { a as createMemoryToolServer, c as resolveMemoryFromEnv, i as MEMORY_NAME_ENV, n as MEMORY_ITEMS_ENV, o as parseMemoryItems, r as MEMORY_LOG_ENV, s as readMemoryItemsFile, t as MEMORY_FILE_ENV } from "../memory-server-DXQ8IxGR.js";
import { agentProfileSchema } from "@tangle-network/agent-interface";
import { randomUUID } from "node:crypto";
//#region src/mcp/executor.ts
/**
* Wrap a raw sandbox SDK client so the kernel emits
* `loop.iteration.dispatch` events with `{ placement: 'sibling', sandboxId }`.
*
* The returned client `.create()` delegates to the underlying client; the
* only added behavior is a `describePlacement` tag the kernel reads.
*
* @experimental
*/
function createSiblingSandboxExecutor(options) {
	const underlying = options.client;
	return {
		client: {
			create(opts) {
				return underlying.create(opts);
			},
			describePlacement(box) {
				return {
					kind: "sibling",
					sandboxId: readId(box)
				};
			}
		},
		placement: "sibling",
		describe() {
			return "sibling-sandbox (each delegation = fresh sandbox via client.create)";
		}
	};
}
/**
* Build an executor that resolves each delegated iteration to an existing
* machine in `fleet`. The fleet's shared-workspace policy means the worker
* machine sees the caller's filesystem — diffs land in-place with no
* cross-sandbox copy step.
*
* @experimental
*/
function createFleetWorkspaceExecutor(options) {
	const fleet = options.fleet;
	const exclude = new Set(options.excludeMachineIds ?? []);
	let callIndex = 0;
	const placementBySandboxId = /* @__PURE__ */ new Map();
	return {
		client: {
			async create() {
				const ids = fleet.ids.filter((id) => !exclude.has(id));
				if (ids.length === 0) throw new Error(`agent-runtime: fleet ${fleet.fleetId} has no eligible worker machines (ids=[${fleet.ids.join(",")}], excluded=[${[...exclude].join(",")}])`);
				const selector = options.selectMachine;
				const machineId = selector ? selector({
					callIndex,
					ids
				}) : ids[callIndex % ids.length];
				callIndex += 1;
				if (typeof machineId !== "string" || machineId.length === 0) throw new Error("agent-runtime: fleet executor selectMachine returned an empty machine id");
				const box = await fleet.sandbox(machineId);
				const sandboxId = readId(box);
				if (sandboxId) placementBySandboxId.set(sandboxId, { machineId });
				return box;
			},
			describePlacement(box) {
				const sandboxId = readId(box);
				const recorded = sandboxId ? placementBySandboxId.get(sandboxId) : void 0;
				return {
					kind: "fleet",
					sandboxId,
					fleetId: fleet.fleetId,
					machineId: recorded?.machineId
				};
			}
		},
		placement: "fleet",
		describe() {
			const excluded = exclude.size > 0 ? ` (excluded=[${[...exclude].join(",")}])` : "";
			return `fleet-workspace (fleetId=${fleet.fleetId}, machines=[${fleet.ids.join(",")}]${excluded})`;
		}
	};
}
function readId(box) {
	const raw = box.id;
	return typeof raw === "string" && raw.length > 0 ? raw : void 0;
}
//#endregion
//#region src/mcp/in-process-executor.ts
/**
*
* In-process delegation executor — when `agent-runtime-mcp` runs inside a sandbox whose image
* carries the local coding-harness CLIs (claude / codex / opencode), delegations spawn the harness
* AS A SUBPROCESS against a git worktree on the SAME filesystem instead of provisioning a sibling
* sandbox. Zero provisioning latency; worker diffs land in-place; multi-harness fanout = N parallel
* subprocesses in N parallel worktrees. Each authored profile selects its own harness.
*
* This is a THIN adapter over `runWorktreeHarness` (`./worktree-harness`) — the SAME core the
* `Scope` leaf `createWorktreeCliExecutor` uses. It only adapts the core to the `SandboxClient`
* port: `create()` reads the authored profile from `CreateSandboxOptions.backend.profile`, and
* `streamPrompt` runs the core then emits its raw `WorktreeHarnessResult` (the content-addressed
* patch artifact) on the `result` event. The sandbox-session decode layer
* (`./detached-coder`) projects that artifact onto `CoderOutput`; the generic `Scope` path settles
* the artifact directly. The §1.5 payload (systemPrompt + model) reaches the harness inside the core.
*
* @experimental
*/
const DEFAULT_POSTCHECK_TIMEOUT_MS = 120 * 1e3;
/**
* Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()`
* returns a minimal virtual `SandboxInstance`; the kernel calls `streamPrompt(msg)` on it, which
* runs the shared worktree-harness core and emits one `result` event whose `data.result` is the
* raw `WorktreeHarnessResult` (the content-addressed patch artifact). The authored profile
* (`backend.profile`) threads its systemPrompt + model into the harness via the core.
*
* There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
* other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
*
* @experimental
*/
function createInProcessExecutor(options) {
	const runPostCheck = options.runPostCheck ?? defaultRunPostCheck;
	const runCommand = async ({ command, cwd, signal }) => {
		try {
			const r = await runPostCheck(command, cwd, signal);
			return {
				exitCode: r.exitCode,
				output: r.stderr || r.stdout
			};
		} catch (err) {
			return {
				exitCode: -1,
				output: err instanceof Error ? err.message : String(err)
			};
		}
	};
	return {
		client: {
			async create(opts) {
				const rawProfile = (opts?.backend)?.profile;
				if (rawProfile === void 0) throw new ConfigError("in-process executor: backend.profile is required and must select the exact harness, provider, and model");
				const profile = agentProfileSchema.parse(rawProfile);
				assertExecutableAgentProfile(profile, "in-process executor");
				const harness = profile.harness;
				if (!LOCAL_HARNESSES.includes(harness)) throw new ConfigError(`in-process executor: AgentProfile.harness ${JSON.stringify(harness)} is not a local harness; expected ${LOCAL_HARNESSES.join(", ")}`);
				if (opts?.backend?.type !== void 0 && opts.backend.type !== harness) throw new ConfigError(`in-process executor: backend.type ${JSON.stringify(opts.backend.type)} conflicts with AgentProfile.harness ${JSON.stringify(harness)}`);
				const localHarness = harness;
				const runId = randomUUID();
				return {
					id: `in-process-${runId}`,
					__inProcess: {
						runId,
						harness: localHarness
					},
					async *streamPrompt(message, promptOpts) {
						assertBoxlessPromptOptions(promptOpts, "in-process executor");
						const taskPrompt = typeof message === "string" ? message : message.map((p) => typeof p === "object" && p && "text" in p ? String(p.text) : "").join("\n");
						const run = await runWorktreeHarness({
							repoRoot: options.repoRoot,
							profile,
							harness: localHarness,
							taskPrompt,
							runId,
							...options.harnessTimeoutMs !== void 0 ? { harnessTimeoutMs: options.harnessTimeoutMs } : {},
							checkTimeoutMs: options.postCheckTimeoutMs ?? DEFAULT_POSTCHECK_TIMEOUT_MS,
							...options.testCmd !== void 0 ? { testCmd: options.testCmd } : {},
							...options.typecheckCmd !== void 0 ? { typecheckCmd: options.typecheckCmd } : {},
							...options.runGit ? { runGit: options.runGit } : {},
							...options.runHarness ? { runHarness: options.runHarness } : {},
							runCommand,
							...promptOpts?.signal ? { signal: promptOpts.signal } : {}
						});
						this.__inProcess.worktree = run.worktree;
						try {
							yield {
								type: "in_process.harness.started",
								data: {
									runId,
									harness: localHarness,
									worktreePath: run.worktree.path,
									command: localHarness
								}
							};
							const h = run.result.harness;
							yield {
								type: "in_process.harness.ended",
								data: {
									runId,
									exitCode: h.exitCode,
									durationMs: h.durationMs,
									killedBySignal: h.killedBySignal,
									timedOut: h.timedOut,
									stdoutBytes: h.stdout.length,
									stderrBytes: h.stderr.length
								}
							};
							yield {
								type: "result",
								data: {
									result: run.result,
									source: "in-process-executor",
									harness: localHarness,
									runId
								}
							};
						} finally {
							await run.cleanup();
						}
					}
				};
			},
			describePlacement(box) {
				const sandboxId = box.id;
				const meta = box.__inProcess;
				return {
					kind: "in-process",
					sandboxId,
					worktreePath: meta?.worktree?.path,
					harness: meta?.harness
				};
			}
		},
		placement: "in-process",
		describe() {
			return `in-process (repoRoot=${options.repoRoot}, harness=profile-selected${options.testCmd ? `, testCmd="${options.testCmd}"` : ""}${options.typecheckCmd ? `, typecheckCmd="${options.typecheckCmd}"` : ""})`;
		}
	};
}
async function defaultRunPostCheck(cmd, cwd, signal) {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve, reject) => {
		const child = spawn("sh", ["-c", cmd], {
			cwd,
			stdio: "pipe"
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c) => {
			stdout += String(c);
		});
		child.stderr?.on("data", (c) => {
			stderr += String(c);
		});
		if (signal) {
			const onAbort = () => {
				if (!child.killed) child.kill("SIGTERM");
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}
		const killTimer = setTimeout(() => {
			if (!child.killed) child.kill("SIGTERM");
		}, DEFAULT_POSTCHECK_TIMEOUT_MS);
		if (typeof killTimer.unref === "function") killTimer.unref();
		child.on("error", (err) => {
			clearTimeout(killTimer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(killTimer);
			resolve({
				exitCode: code ?? -1,
				stdout,
				stderr
			});
		});
	});
}
//#endregion
//#region src/mcp/bin-helpers.ts
/**
* Pick the right executor for an MCP server invocation based on env vars.
*
* - `TANGLE_FLEET_ID` set → fleet-workspace placement; resolves the handle
*   via `sandboxClient.fleets.get(...)`.
* - Otherwise → sibling-sandbox placement; each delegation creates a fresh
*   sandbox via `sandboxClient.create(...)`.
*
* Fails loud (throws) when fleet mode is requested but the SDK shape is
* incompatible — the operator chose fleet semantics, silently degrading to
* sibling mode would lie about workspace topology.
*
* @experimental
*/
async function detectExecutor(args) {
	const env = args.env ?? process.env;
	if (env.AGENT_RUNTIME_IN_SANDBOX === "1") {
		const repoRoot = env.AGENT_RUNTIME_REPO_ROOT?.trim();
		if (!repoRoot) throw new Error("agent-runtime-mcp: AGENT_RUNTIME_IN_SANDBOX=1 requires AGENT_RUNTIME_REPO_ROOT to point at the workspace root");
		return createInProcessExecutor({
			repoRoot,
			testCmd: env.AGENT_RUNTIME_TEST_CMD?.trim() || void 0,
			typecheckCmd: env.AGENT_RUNTIME_TYPECHECK_CMD?.trim() || void 0
		});
	}
	const fleetId = parseFleetId(env.TANGLE_FLEET_ID);
	if (!fleetId) return createSiblingSandboxExecutor({ client: args.sandboxClient });
	return createFleetWorkspaceExecutor({
		fleet: await (args.resolveFleet ?? defaultResolveFleet)(args.sandboxClient, fleetId),
		excludeMachineIds: parseList(env.TANGLE_FLEET_EXCLUDE_MACHINES)
	});
}
async function defaultResolveFleet(sandboxClient, fleetId) {
	const fleets = sandboxClient.fleets;
	if (!fleets || typeof fleets.get !== "function") throw new Error("agent-runtime-mcp: the configured sandbox client does not expose `.fleets.get`; upgrade @tangle-network/sandbox to >= 0.2.1 or unset TANGLE_FLEET_ID.");
	const raw = await fleets.get(fleetId);
	if (!raw || typeof raw !== "object") throw new Error(`agent-runtime-mcp: fleets.get(${fleetId}) returned no handle`);
	const handle = raw;
	if (typeof handle.fleetId !== "string" || !Array.isArray(handle.ids)) throw new Error(`agent-runtime-mcp: fleet handle for ${fleetId} is missing fleetId/ids — incompatible sandbox SDK shape`);
	if (typeof handle.sandbox !== "function") throw new Error(`agent-runtime-mcp: fleet handle for ${fleetId} is missing sandbox(machineId) — incompatible sandbox SDK shape`);
	return handle;
}
function parseFleetId(raw) {
	if (typeof raw !== "string") return void 0;
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function parseList(raw) {
	if (!raw) return void 0;
	const list = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
	return list.length > 0 ? list : void 0;
}
//#endregion
//#region src/mcp/detached-coder.ts
/**
*
* Sandbox-session coder decode layer. The sandbox-session delegate (`./delegates`) and the
* cross-restart resume driver run the in-box harness over a `SandboxClient` and need to
* (a) build an `AgentRunSpec` from the caller-authored exact worker
* profile, (b) decode the harness event stream into a structured `CoderOutput`, and (c) gate it with
* the shared mechanical checks. This sandbox-session path is kept separate from the generic recursive
* path: `worktreeFanout` instead settles the raw `WorktreePatchArtifact` and gates via
* `patchDelivered`. Prefer `worktreeFanout` / `worktreeLoopRunner` for NEW local-repo coding.
*
* The decode tolerates two `result`-event shapes:
*   1. the in-process executor's raw worktree-harness result (`{ branch, patch, stats, checks }`),
*      projected onto `CoderOutput`; and
*   2. an LLM-emitted JSON block (`{ branch, patch, testResult, typecheckResult, diffStats }`),
*      lifted onto `data.result` or scanned out of the assistant transcript (any harness shape).
*
* @experimental
*/
const DEFAULT_MAX_DIFF_LINES = 400;
/** @experimental Build the `AgentRunSpec<CoderTask>` the sandbox-session `runAgentRounds` path drives. */
function coderRunSpec(options) {
	const profile = agentProfileSchema.parse(options.profile);
	assertExecutableAgentProfile(profile, "coderRunSpec");
	return {
		name: options.name ?? profile.name,
		profile,
		taskToPrompt: coderTaskToPrompt
	};
}
/** @experimental The output adapter the sandbox-session path decodes the harness stream with. */
const coderOutputAdapter = { parse: parseCoderEvents };
/**
* The multi-harness coder fanout driving the sandbox-session delegate's `variants>1` path.
* (`worktreeFanout` is the local-repo generic counterpart for new code.)
*
* @experimental
*/
function multiHarnessCoderFanout(options) {
	if (!options.profiles || options.profiles.length === 0) throw new ConfigError("multiHarnessCoderFanout: at least one exact profile is required");
	const agentRuns = options.profiles.map((profile) => coderRunSpec({ profile }));
	return {
		agentRuns,
		output: coderOutputAdapter,
		validator: defaultCoderValidator(),
		driver: {
			name: "fanout",
			plan: async (task, history) => history.length === 0 ? agentRuns.map(() => task) : [],
			decide: (history) => history.some((i) => i.verdict?.valid === true) ? "pick-winner" : "fail"
		}
	};
}
/**
* The sandbox `CoderOutput` validator. A thin shim over the shared {@link runCoderChecks} gate,
* adapting the parsed `CoderOutput` into the gate inputs.
*
* @experimental
*/
function createCoderValidator(task) {
	const constraints = {
		maxDiffLines: task.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES,
		forbiddenPaths: task.forbiddenPaths ?? []
	};
	return { async validate(output) {
		return runCoderChecks({
			patch: output.patch,
			testsPassed: output.testResult.passed,
			typecheckPassed: output.typecheckResult.passed
		}, constraints);
	} };
}
function defaultCoderValidator() {
	return createCoderValidator({
		goal: "",
		repoRoot: "",
		forbiddenPaths: [],
		maxDiffLines: DEFAULT_MAX_DIFF_LINES
	});
}
/**
* Walk the event stream and return the structured coder payload.
*
* A `result` / `final` event lifts the structured payload onto `data.result`. That payload is
* either the in-process executor's raw worktree-harness result (projected onto `CoderOutput`) or an
* LLM-emitted `CoderOutput`-shaped JSON. When neither is present, the scan accumulates ALL assistant
* text in stream order (any harness shape) and takes the last fenced JSON block that coerces —
* claude-code lifts whole text onto `data.text`/`data.delta`; opencode streams `message.part.updated`
* fragments, so the final block is split across many events and never whole in one.
*/
function parseCoderEvents(events) {
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (!event) continue;
		const type = String(event.type ?? "");
		const data = isRecord(event.data) ? event.data : {};
		if (type === "result" || type === "final" || type === "coder.result") {
			const payload = data.result ?? data.output ?? data;
			const projected = projectWorktreeArtifact(payload);
			if (projected) return projected;
			const direct = coerceCoderOutput(payload);
			if (direct) return direct;
		}
	}
	const transcript = collectAssistantText(events);
	for (const candidate of fencedJsonBlocks(transcript)) {
		const coerced = coerceCoderOutput(candidate);
		if (coerced) return coerced;
	}
	return {
		branch: "",
		patch: "",
		testResult: {
			passed: false,
			output: ""
		},
		typecheckResult: {
			passed: false,
			output: ""
		},
		diffStats: {
			filesChanged: 0,
			insertions: 0,
			deletions: 0
		}
	};
}
/** Project the in-process executor's raw worktree-harness result (`{ branch, patch, stats, checks,
*  harness }`) onto `CoderOutput`. A check that did not run is treated as passing (the executor
*  simply didn't run that command). Returns undefined when the payload is not a worktree artifact. */
function projectWorktreeArtifact(value) {
	if (!isRecord(value)) return void 0;
	const stats = value.stats;
	if (!isRecord(stats)) return void 0;
	const branch = pickString(value.branch) ?? "";
	const patch = pickString(value.patch) ?? "";
	const checks = isRecord(value.checks) ? value.checks : {};
	const tests = isRecord(checks.tests) ? checks.tests : void 0;
	const typecheck = isRecord(checks.typecheck) ? checks.typecheck : void 0;
	const harness = isRecord(value.harness) ? value.harness : void 0;
	const exitCode = harness ? toFiniteInt(harness.exitCode) : 0;
	const timedOut = harness?.timedOut === true;
	const harnessName = harness ? pickString(harness.name) ?? "harness" : "harness";
	return {
		branch,
		patch,
		testResult: {
			passed: tests ? tests.passed === true : true,
			output: tail(pickString(tests?.output) ?? "", 4e3)
		},
		typecheckResult: {
			passed: typecheck ? typecheck.passed === true : true,
			output: tail(pickString(typecheck?.output) ?? "", 4e3)
		},
		diffStats: {
			filesChanged: toFiniteInt(stats.filesChanged),
			insertions: toFiniteInt(stats.insertions),
			deletions: toFiniteInt(stats.deletions)
		},
		...exitCode !== 0 ? { reviewerNotes: `harness ${harnessName} exited ${exitCode}${timedOut ? " (timed out)" : ""}` } : {}
	};
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Keep the last `max` chars of a diagnostic string — harness stdout can be large; the gate reads
*  `passed`, not this text, so only the tail is retained for traces/logs. */
function tail(text, max) {
	return text.length <= max ? text : text.slice(text.length - max);
}
function pickString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/**
* Concatenate assistant text across the event stream in arrival order, tolerating every harness
* shape: claude-code lifts text onto `data.text`/`data.delta`; opencode streams
* `message.part.updated` with `data.part.type === 'text'` carrying `data.delta`/`data.part.text`.
* Reasoning/thinking parts are excluded — only the final answer text carries the result JSON.
*/
function collectAssistantText(events) {
	const chunks = [];
	for (const event of events) {
		if (!event) continue;
		const data = isRecord(event.data) ? event.data : {};
		if (String(event.type ?? "") === "message.part.updated") {
			const part = isRecord(data.part) ? data.part : {};
			const partType = String(part.type ?? "");
			if (partType !== "text" && partType !== "") continue;
			const text = pickString(data.delta) ?? pickString(part.text);
			if (text) chunks.push(text);
			continue;
		}
		const text = pickString(data.text) ?? pickString(data.delta);
		if (text) chunks.push(text);
	}
	return chunks.join("");
}
/** All parseable fenced JSON blocks in `text`, last-first (the final result block the agent emits
*  is the one we want). */
function fencedJsonBlocks(text) {
	const out = [];
	const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
	for (let i = matches.length - 1; i >= 0; i -= 1) {
		const body = (matches[i]?.[1] ?? "").trim();
		if (!body) continue;
		try {
			out.push(JSON.parse(body));
		} catch {}
	}
	return out;
}
function coerceCoderOutput(value) {
	if (!isRecord(value)) return void 0;
	const branch = pickString(value.branch);
	const patch = pickString(value.patch) ?? "";
	if (branch === void 0) return void 0;
	return {
		branch,
		patch,
		testResult: coerceCmdResult(value.testResult),
		typecheckResult: coerceCmdResult(value.typecheckResult),
		diffStats: coerceDiffStats(value.diffStats),
		reviewerNotes: pickString(value.reviewerNotes)
	};
}
function coerceCmdResult(value) {
	if (!isRecord(value)) return {
		passed: false,
		output: ""
	};
	return {
		passed: value.passed === true,
		output: pickString(value.output) ?? ""
	};
}
function coerceDiffStats(value) {
	if (!isRecord(value)) return {
		filesChanged: 0,
		insertions: 0,
		deletions: 0
	};
	return {
		filesChanged: toFiniteInt(value.filesChanged),
		insertions: toFiniteInt(value.insertions),
		deletions: toFiniteInt(value.deletions)
	};
}
function toFiniteInt(value) {
	if (typeof value !== "number") return 0;
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.trunc(value));
}
//#endregion
//#region src/mcp/detached-turn.ts
const DEFAULT_TICK_INTERVAL_MS = 5e3;
/**
* Encode ref parts into the JSON-safe string stored on the record:
* `session=<id>` before the box exists, `sandbox=<id>;session=<id>` once
* bound. Ids must not contain the `;`/`=` delimiters.
*
* @experimental
*/
function formatDetachedSessionRef(parts) {
	assertRefComponent("sessionId", parts.sessionId);
	if (parts.sandboxId === void 0) return `session=${parts.sessionId}`;
	assertRefComponent("sandboxId", parts.sandboxId);
	return `sandbox=${parts.sandboxId};session=${parts.sessionId}`;
}
/** Parse a `detachedSessionRef` string back to parts; throws `ValidationError` on malformed input. @experimental */
function parseDetachedSessionRef(raw) {
	const fields = /* @__PURE__ */ new Map();
	for (const pair of raw.split(";")) {
		const eq = pair.indexOf("=");
		const key = eq === -1 ? "" : pair.slice(0, eq);
		const value = eq === -1 ? "" : pair.slice(eq + 1);
		if (key !== "session" && key !== "sandbox" || value.length === 0 || fields.has(key)) throw new ValidationError(`parseDetachedSessionRef: malformed detachedSessionRef ${JSON.stringify(raw)} — expected "session=<id>" or "sandbox=<id>;session=<id>"`);
		fields.set(key, value);
	}
	const sessionId = fields.get("session");
	if (!sessionId) throw new ValidationError(`parseDetachedSessionRef: detachedSessionRef ${JSON.stringify(raw)} carries no session id`);
	const sandboxId = fields.get("sandbox");
	return {
		sessionId,
		...sandboxId !== void 0 ? { sandboxId } : {}
	};
}
function assertRefComponent(name, value) {
	if (value.length === 0 || value.includes(";") || value.includes("=")) throw new ValidationError(`formatDetachedSessionRef: ${name} ${JSON.stringify(value)} must be non-empty and free of ";" / "="`);
}
/**
* Synthesize the terminal event array a detached turn settles through. Shaped
* so the existing event-stream output adapters (coder, researcher) parse it:
* `data.result` for adapters that read a structured terminal record, `data.text`
* for adapters that scan assistant text for the fenced result block.
*
* @experimental
*/
function detachedTurnEvents(sessionId, turn) {
	return [{
		type: "result",
		id: sessionId,
		data: {
			text: turn.text,
			finalText: turn.text,
			success: true,
			result: turn.result
		}
	}];
}
/**
* Dispatch one detached turn and advance it to a terminal state with
* `driveTurn` ticks. The first tick dispatches (idempotent on `sessionId`);
* subsequent ticks poll. On abort the remote session is cancelled via
* `_sessionCancel` when the box exposes it. The box is torn down on every
* in-process exit path (success, failure, abort) — only a process death skips
* teardown, which is exactly the case the resume driver re-attaches to.
*
* @experimental
*/
async function runDetachedTurn(options) {
	const intervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
	const trace = createDetachedTurnTrace(options);
	trace.started();
	const box = await createSandboxForSpec(options.client, options.spec, options.signal).catch((err) => {
		trace.ended(err instanceof Error ? err.message : String(err));
		throw err;
	});
	const drive = box;
	const onAbort = () => {
		drive._sessionCancel?.(options.sessionId).catch(() => {});
	};
	try {
		if (typeof drive.driveTurn !== "function") throw new ValidationError("runDetachedTurn: the acquired sandbox exposes no driveTurn(message, { sessionId }) — detached dispatch requires @tangle-network/sandbox >= 0.6 and a session-backed placement (sibling/fleet); disable detached dispatch for this executor.");
		const sandboxId = box.id;
		if (typeof sandboxId !== "string" || sandboxId.length === 0) throw new ValidationError("runDetachedTurn: the acquired sandbox carries no id — without it the detached run cannot be resumed after a restart, so refusing to dispatch detached.");
		options.bindSandbox(sandboxId);
		trace.dispatched(sandboxId);
		options.signal.addEventListener("abort", onAbort, { once: true });
		for (;;) {
			throwIfAborted(options.signal);
			const tick = await drive.driveTurn(options.prompt, {
				sessionId: options.sessionId,
				turnId: options.sessionId,
				...options.wallCapMs !== void 0 ? { wallCapMs: options.wallCapMs } : {}
			});
			throwIfAborted(options.signal);
			if (tick.state === "completed") {
				trace.ended();
				return {
					text: tick.text,
					result: tick.result
				};
			}
			if (tick.state === "failed") throw new Error(`detached turn ${options.sessionId} failed: ${tick.error}`);
			options.report({
				iteration: 0,
				phase: detachedRunningPhase(tick.elapsedMs)
			});
			await sleep(intervalMs, options.signal);
		}
	} catch (err) {
		trace.ended(err instanceof Error ? err.message : String(err));
		throw err;
	} finally {
		options.signal.removeEventListener("abort", onAbort);
		if (options.signal.aborted) onAbort();
		await deleteBoxSafe(box);
	}
}
/**
* Synthesize the single-iteration loop event stream for one detached turn so
* the trace sinks (OTEL exporter, delegation journal) observe detached work
* exactly like a streamed `runAgentRounds` run. `runId` = the deterministic session
* id; cost/token figures are structurally unavailable on the `driveTurn`
* surface, so zero observed subtotals carry explicit unknown flags.
*/
function createDetachedTurnTrace(options) {
	const emitter = options.traceEmitter;
	if (!emitter) return {
		started() {},
		dispatched() {},
		ended() {}
	};
	const runId = options.sessionId;
	const agentRunName = options.spec.name ?? options.spec.profile.name ?? "detached-turn";
	const startMs = Date.now();
	let done = false;
	const emit = (event) => {
		emitter.emit(event);
	};
	return {
		started() {
			emit({
				kind: "loop.started",
				runId,
				timestamp: startMs,
				payload: {
					driver: "detached-turn",
					agentRunNames: [agentRunName],
					maxIterations: 1,
					maxConcurrency: 1
				}
			});
			emit({
				kind: "loop.iteration.started",
				runId,
				timestamp: startMs,
				payload: {
					iterationIndex: 0,
					agentRunName,
					taskHash: options.sessionId
				}
			});
		},
		dispatched(sandboxId) {
			emit({
				kind: "loop.iteration.dispatch",
				runId,
				timestamp: Date.now(),
				payload: {
					iterationIndex: 0,
					agentRunName,
					placement: options.placement ?? "sibling",
					sandboxId
				}
			});
		},
		ended(error) {
			if (done) return;
			done = true;
			const endMs = Date.now();
			emit({
				kind: "loop.iteration.ended",
				runId,
				timestamp: endMs,
				payload: {
					iterationIndex: 0,
					agentRunName,
					costUsd: 0,
					costUsdKnown: false,
					durationMs: endMs - startMs,
					tokenUsage: {
						input: 0,
						output: 0,
						tokensKnown: false
					},
					...error !== void 0 ? { error } : {}
				}
			});
			emit({
				kind: "loop.ended",
				runId,
				timestamp: endMs,
				payload: {
					...error === void 0 ? { winnerIterationIndex: 0 } : {},
					totalCostUsd: 0,
					costUsdKnown: false,
					durationMs: endMs - startMs,
					iterations: 1
				}
			});
		}
	};
}
function detachedRunningPhase(elapsedMs) {
	return elapsedMs === void 0 ? "detached-running" : `detached-running ${Math.round(elapsedMs / 1e3)}s`;
}
/**
* Build the `driveTurn`-backed {@link DelegationResumeDriver}. Each `tick()`
* is one settle/poll/dispatch pass:
*
*   - ref without a sandbox binding → `failed` (`DetachedSessionUnboundError`):
*     the previous process died before a box existed; there is nothing to resume.
*   - `driveTurn` `completed` → `settleOutput` → `completed` tick.
*   - `running` → progress via `ctx.report`, `running` tick (queue re-ticks
*     after `intervalMs`).
*   - `failed` → `failed` tick (`DetachedTurnFailedError`) — terminal per the
*     SDK's deterministic-failure contract.
*
* Abort: the queue stops ticking once `cancel()` flips the record, so remote
* cancellation is hooked onto `ctx.signal` (once per task) and fires
* `_sessionCancel` when the SDK surface exposes it. The driver never deletes
* boxes — it cannot know whether `sandboxId` is a disposable sibling or a
* fleet machine, and destroying a fleet machine would be unrecoverable.
*
* @experimental
*/
function createDetachedTurnResumeDriver(options) {
	const cancelHooked = /* @__PURE__ */ new Set();
	return {
		intervalMs: options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS,
		async tick({ record, detachedSessionRef }, ctx) {
			const ref = parseDetachedSessionRef(detachedSessionRef);
			if (ref.sandboxId === void 0) return {
				state: "failed",
				error: {
					message: `detached session "${ref.sessionId}" was never bound to a sandbox — the previous process died before the box was acquired, so the turn was never dispatched and cannot be resumed`,
					kind: "DetachedSessionUnboundError"
				}
			};
			const box = await options.resolveSandbox(ref.sandboxId);
			if (!cancelHooked.has(record.taskId)) {
				cancelHooked.add(record.taskId);
				ctx.signal.addEventListener("abort", () => {
					box._sessionCancel?.(ref.sessionId).catch(() => {});
				}, { once: true });
			}
			if (ctx.signal.aborted) throwAbort();
			const tick = await box.driveTurn(options.buildMessage(record), {
				sessionId: ref.sessionId,
				turnId: ref.sessionId,
				...options.wallCapMs !== void 0 ? { wallCapMs: options.wallCapMs } : {}
			});
			if (tick.state === "completed") return {
				state: "completed",
				output: await options.settleOutput({
					text: tick.text,
					result: tick.result
				}, record, { signal: ctx.signal })
			};
			if (tick.state === "failed") return {
				state: "failed",
				error: {
					message: `detached turn ${ref.sessionId} failed: ${tick.error}`,
					kind: "DetachedTurnFailedError"
				}
			};
			ctx.report({
				iteration: 0,
				phase: detachedRunningPhase(tick.elapsedMs)
			});
			return { state: "running" };
		}
	};
}
//#endregion
//#region src/mcp/delegates.ts
/**
* Build the sandbox-session coder delegate. It drives `runAgentRounds` against the project's
* sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
* topology.
*
* This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
* `SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
* (driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
* the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.
*
* For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
* per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate runs
* held-stream by default and only its OPTIONAL cross-restart resume (the `driveTurn` tick) is opt-in
* behind `MCP_ENABLE_DETACHED_RESUME`.
*
* @experimental
*/
function detachedSessionDelegate(options) {
	if (!options.workerProfile) throw new ConfigError("detachedSessionDelegate: workerProfile is required");
	const workerProfile = coderRunSpec({ profile: options.workerProfile }).profile;
	const fanoutProfiles = options.fanoutProfiles?.map((profile) => coderRunSpec({ profile }).profile);
	if (fanoutProfiles?.length === 0) throw new ConfigError("detachedSessionDelegate: fanoutProfiles must not be empty");
	const executor = resolveExecutor(options);
	const sandboxClient = executor.client;
	const maxConcurrency = options.maxConcurrency ?? 4;
	const traceEmitter = options.traceEmitter;
	return async (args, ctx) => {
		const task = coderTaskFromArgs(args);
		const variants = Math.max(1, Math.trunc(args.variants ?? 1));
		const selectedFanoutProfiles = variants <= 1 ? void 0 : fanoutProfiles ?? Array.from({ length: variants }, () => workerProfile);
		if (selectedFanoutProfiles && selectedFanoutProfiles.length < variants) throw new ConfigError(`detachedSessionDelegate: ${variants} variants requested but only ${selectedFanoutProfiles.length} exact fanout profiles were configured`);
		const loopEmitter = composeLoopTraceEmitters(traceEmitter, ctx.traceEmitter);
		ctx.report({
			iteration: 0,
			phase: "starting"
		});
		if (variants <= 1) {
			const agentRunSpec = coderRunSpec({ profile: workerProfile });
			const output = coderOutputAdapter;
			const validator = createCoderValidator(task);
			if (ctx.detachedSessionRef !== void 0 && ctx.updateDetachedSessionRef) {
				const { sessionId } = parseDetachedSessionRef(ctx.detachedSessionRef);
				const rebind = ctx.updateDetachedSessionRef;
				const chosen = await settleDetachedCoderTurn(await runDetachedTurn({
					client: sandboxClient,
					spec: agentRunSpec,
					prompt: agentRunSpec.taskToPrompt(task),
					sessionId,
					bindSandbox: (sandboxId) => rebind(formatDetachedSessionRef({
						sandboxId,
						sessionId
					})),
					signal: ctx.signal,
					report: ctx.report,
					...loopEmitter ? { traceEmitter: loopEmitter } : {},
					...executor.placement === "fleet" ? { placement: "fleet" } : {},
					...options.detachedTickIntervalMs !== void 0 ? { tickIntervalMs: options.detachedTickIntervalMs } : {},
					...options.detachedWallCapMs !== void 0 ? { wallCapMs: options.detachedWallCapMs } : {}
				}), {
					task,
					sessionId,
					signal: ctx.signal,
					...options.reviewer ? { reviewer: options.reviewer } : {}
				});
				ctx.report({
					iteration: 1,
					phase: "completed"
				});
				return chosen;
			}
			const chosen = await pickCoderWinner({
				iterations: (await runAgentRounds({
					driver: singleShotDriver,
					agentRun: agentRunSpec,
					output,
					validator,
					task,
					ctx: {
						sandboxClient,
						signal: ctx.signal,
						...loopEmitter ? { traceEmitter: loopEmitter } : {}
					},
					maxIterations: 1,
					maxConcurrency
				})).iterations,
				reviewer: options.reviewer,
				selection: options.winnerSelection ?? "highest-score",
				task,
				signal: ctx.signal
			});
			if (!chosen) throw new Error(noWinnerMessage(options.reviewer));
			ctx.report({
				iteration: 1,
				phase: "completed"
			});
			return chosen;
		}
		const fanout = multiHarnessCoderFanout({ profiles: selectedFanoutProfiles.slice(0, variants) });
		const agentRuns = fanout.agentRuns.slice(0, variants);
		const chosen = await pickCoderWinner({
			iterations: (await runAgentRounds({
				driver: fanout.driver,
				agentRuns,
				output: fanout.output,
				validator: fanout.validator,
				task,
				ctx: {
					sandboxClient,
					signal: ctx.signal,
					...loopEmitter ? { traceEmitter: loopEmitter } : {}
				},
				maxIterations: variants,
				maxConcurrency: Math.min(maxConcurrency, variants)
			})).iterations,
			reviewer: options.reviewer,
			selection: options.winnerSelection ?? "highest-score",
			task,
			signal: ctx.signal
		});
		if (!chosen) throw new Error(noWinnerMessage(options.reviewer));
		ctx.report({
			iteration: agentRuns.length,
			phase: "completed"
		});
		return chosen;
	};
}
/**
* Pick the winning coder candidate from a finished loop's iterations:
*   1. keep only mechanically-VALID candidates (the validator already gated
*      tests/typecheck/forbidden/diff/no-op/secrets),
*   2. if a `reviewer` is wired, keep only those it APPROVES,
*   3. select among survivors via the shared `selectValidWinner` (base strategies) or, for the
*      reviewer-only `highest-readiness`, a readiness sort (the one strategy the generic selector
*      does not express — a documented capability of this sandbox-session path).
* Returns `undefined` when nothing survives — the delegate fails loud.
*/
async function pickCoderWinner(args) {
	const eligible = [];
	for (const iter of args.iterations) {
		if (iter.output === void 0 || iter.error || iter.verdict?.valid !== true) continue;
		const readiness = iter.verdict.score ?? 0;
		if (args.reviewer) {
			const review = await args.reviewer(iter.output, args.task, { signal: args.signal });
			if (!review.approved) continue;
			eligible.push({
				iter,
				readiness: review.readiness
			});
		} else eligible.push({
			iter,
			readiness
		});
	}
	if (eligible.length === 0) return void 0;
	if (args.selection === "highest-readiness") return [...eligible].sort((a, b) => b.readiness - a.readiness || a.iter.index - b.iter.index)[0].iter.output;
	const wrapped = eligible.map(({ iter }) => ({
		...iter,
		output: {
			kind: "done",
			deliverable: iter.output
		}
	}));
	const out = selectValidWinner({
		strategy: baseStrategy(args.selection),
		sizeOf: (o) => o.diffStats.insertions + o.diffStats.deletions
	})(wrapped)?.output;
	if (out?.kind !== "done") return void 0;
	return out.deliverable;
}
/** Map the detached-session selection enum onto the shared `WinnerStrategy`. `first-approved`
*  reduces to `first-valid` over the already-approved set; `smallest-diff` to `smallest-artifact`. */
function baseStrategy(selection) {
	switch (selection) {
		case "smallest-diff": return "smallest-artifact";
		case "first-approved": return "first-valid";
		default: return "highest-score";
	}
}
function noWinnerMessage(reviewer) {
	return reviewer ? "coder delegate: no candidate passed validation + review" : "coder delegate: no candidate passed validation";
}
/**
* Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for
* the delegate's live dispatch AND the resume driver's settle/message
* rebuilding, so a resumed record reproduces exactly the task the original
* process dispatched.
*
* @experimental
*/
function coderTaskFromArgs(args) {
	return {
		goal: buildCoderGoal(args),
		repoRoot: args.repoRoot,
		testCmd: args.config?.testCmd,
		typecheckCmd: args.config?.typecheckCmd,
		forbiddenPaths: args.config?.forbiddenPaths,
		maxDiffLines: args.config?.maxDiffLines
	};
}
/**
* Settle a completed detached coder turn through the same gate the streaming
* path applies: parse the terminal payload with the coder output adapter,
* run the mechanical validator (tests/typecheck/forbidden/diff/no-op/secrets),
* then the optional reviewer. Throws when nothing survives — a resumed or
* detached run must not return an unvalidated patch.
*
* SCOPE NOTE (detached/resume): the detached `driveTurn`-tick + cross-restart resume path is
* bound to the `runAgentRounds` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
* journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
* advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
* `createDetachedTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.
*
* @experimental
*/
async function settleDetachedCoderTurn(turn, options) {
	const parsed = coderOutputAdapter.parse(detachedTurnEvents(options.sessionId, turn));
	if ((await createCoderValidator(options.task).validate(parsed, {
		iteration: 0,
		signal: options.signal
	})).valid !== true) throw new Error(noWinnerMessage(options.reviewer));
	if (options.reviewer) {
		if (!(await options.reviewer(parsed, options.task, { signal: options.signal })).approved) throw new Error(noWinnerMessage(options.reviewer));
	}
	return parsed;
}
function buildCoderGoal(args) {
	if (!args.contextHint) return args.goal;
	return [
		args.goal,
		"",
		"## Context",
		args.contextHint
	].join("\n");
}
function resolveExecutor(options) {
	if (options.executor && options.sandboxClient) throw new Error("detachedSessionDelegate: pass exactly one of `executor` or `sandboxClient`");
	if (options.executor) return options.executor;
	if (options.sandboxClient) return createSiblingSandboxExecutor({ client: options.sandboxClient });
	throw new Error("detachedSessionDelegate: `executor` or `sandboxClient` is required");
}
/**
* Single-shot driver — plan one task on iteration 0, stop after one
* iteration. Used by the coder delegate when `variants <= 1`. Keeps the
* runAgentRounds kernel-level accounting (timing, cost, trace emission) while
* skipping fanout/refine topology overhead.
*/
const singleShotDriver = {
	name: "mcp-single-shot",
	async plan(task, history) {
		return history.length === 0 ? [task] : [];
	},
	decide(history) {
		return history.length > 0 ? "pick-winner" : "fail";
	}
};
//#endregion
//#region src/mcp/harness-native-tools.ts
/**
* Sourced native sub-agent tool names, keyed by the same `HarnessType` vocabulary the rest of the
* runtime draws harness names from, so a harness the interface renames is a compile error here.
*/
const harnessNativeTools = {
	codex: [
		"spawn_agent",
		"send_input",
		"resume_agent",
		"close_agent",
		"list_agents",
		"wait_agent",
		"send_message",
		"interrupt_agent",
		"followup_task"
	],
	"claude-code": [
		"Agent",
		"Task",
		"SendMessage",
		"TaskStop",
		"KillAgent"
	],
	opencode: ["task"]
};
/** The harnesses this registry has a sourced list for. */
const sourcedHarnesses = Object.keys(harnessNativeTools);
/**
* The tool names `harness` publishes natively, or `undefined` when no list has been sourced for it.
* The two are different facts and a caller must not read one as the other.
*/
function harnessNativeToolNames(harness) {
	return harnessNativeTools[harness];
}
/**
* The sourced harnesses that publish `name` natively — empty when the name is clear of all of them.
*
* The comparison folds case. A model resolving a bare word out of a prompt does not hold the
* harness's exact casing, so `task` and `Task` are one collision, not two distinct names.
*/
function collidesWithHarnessNativeTool(name) {
	const wanted = name.toLowerCase();
	return sourcedHarnesses.filter((harness) => harnessNativeTools[harness].some((native) => native.toLowerCase() === wanted));
}
//#endregion
export { ANALYST_DEFINITION_BOUNDS, CodexExecutionDiagnosticError, DEFAULT_AWAIT_EVENT_TIMEOUT_MS, DEFAULT_LOCAL_HARNESS, DELEGATE_DESCRIPTION, DELEGATE_FEEDBACK_DESCRIPTION, DELEGATE_FEEDBACK_INPUT_SCHEMA, DELEGATE_FEEDBACK_TOOL_NAME, DELEGATE_INPUT_SCHEMA, DELEGATE_TOOL_NAME, DELEGATE_UI_AUDIT_DESCRIPTION, DELEGATE_UI_AUDIT_INPUT_SCHEMA, DELEGATE_UI_AUDIT_TOOL_NAME, DELEGATION_HISTORY_DESCRIPTION, DELEGATION_HISTORY_INPUT_SCHEMA, DELEGATION_HISTORY_TOOL_NAME, DELEGATION_STATUS_DESCRIPTION, DELEGATION_STATUS_INPUT_SCHEMA, DELEGATION_STATUS_TOOL_NAME, DELEGATION_TRACE_MAX_BYTES, DELEGATION_TRACE_MAX_SPANS, DelegationPersistenceError, DelegationStateCorruptError, DelegationTaskQueue, FileDelegationStore, InMemoryDelegationStore, InMemoryFeedbackStore, LOCAL_HARNESSES, MEMORY_FILE_ENV, MEMORY_ITEMS_ENV, MEMORY_LOG_ENV, MEMORY_NAME_ENV, SPAWN_RESOURCE_PATH_MAX_BYTES, SUPPORTED_PROTOCOL_VERSIONS, analystToolGroupNames, buildDelegationTraceSpans, capDelegationTrace, captureWorktreeDiff, coderTaskFromArgs, collidesWithHarnessNativeTool, composeLoopTraceEmitters, createCoordinationTools, createDelegateFeedbackHandler, createDelegateHandler, createDelegateUiAuditHandler, createDelegationHistoryHandler, createDelegationStatusHandler, createDelegationTraceCollector, createDetachedTurnResumeDriver, createFleetWorkspaceExecutor, createInProcessExecutor, createInProcessTransport, createKbGate, createMcpServer, createMemoryToolServer, createPropagatingTraceEmitter, createSiblingSandboxExecutor, createStdioToolServer, createWorktree, delegationProfiles, detachedSessionDelegate, detachedTurnEvents, detectExecutor, downMessageRefusalReasons, environmentReader, eventToSnapshot, formatDetachedSessionRef, harnessNativeToolNames, harnessNativeTools, harnessSupportsReasoningEffort, hashIdempotencyInput, hostDirectoryReader, localHarnessExecutable, mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset, mergeTraceEnv, parseAuthoredAnalystDefinition, parseCodexTokenUsage, parseDetachedSessionRef, parseMemoryItems, questionEscalationTargets, readMemoryItemsFile, readTraceContextFromEnv, removeWorktree, resolveMemoryFromEnv, resolveSpawnResourcePaths, runDetachedTurn, settleDetachedCoderTurn, sourcedHarnesses, traceContextToEnv, validateDelegateArgs, validateDelegateFeedbackArgs, validateDelegateUiAuditArgs, validateDelegationHistoryArgs, validateDelegationStatusArgs };

//# sourceMappingURL=index.js.map