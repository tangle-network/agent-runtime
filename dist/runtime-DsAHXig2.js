import { $i as detachedSnapshot, $n as LEAF_CONTINUATION_TASK, Ai as readCommittedJsonLines, At as createExecutor, Bn as defaultSelectWinner, Bt as InMemoryResultBlobStore, Ca as stringifySafe, Gt as insideCursorNamespace, Hn as runAgentRounds, Ht as SpawnEventIndex, Ia as armDeadlineTimer, Jn as routerBrain, Kn as assertBoxlessPromptOptions, M as withDriverExecutor, Nt as createWorktreeCliExecutor, O as verdictFromJudgeScore, Oa as zeroSpend, Qi as detachedFrozen, Qt as isTraceAnalysisStore, Sa as sleep, Tt as rollingDispatch, Un as createSandboxLineage, Ut as assertContentAddress, Vt as InMemorySpawnJournal, W as settledToIteration, Wn as probeSandboxCapabilities, Wt as encodeResultBlob, Xi as executableAgentProfileSnapshot, Xn as canonicalObservedModelParts, Yn as runBrainLoop, Zi as executableAgentSpecSnapshot, _ as CheckUnavailableError, ai as harnessInvocation, ar as unavailablePauseMs, ga as cloneSpend, ha as chargedTokens, ir as sandboxClientAsProvider, ji as writeAllBytes, jr as contentAddress, jt as createExecutorRegistry, ki as prepareJsonlAppend, ma as addSpend, or as unavailableSignalOfFailure, qn as readPromptOptions, r as createSupervisor, sr as createPushTraceSource, ua as notifySandboxEventObserver, va as hasCompleteCacheBreakdown, xa as randomSuffix, ya as isAbortError } from "./supervisor-DtlPj9me.js";
import { m as ValidationError, n as AnalystError, s as PlannerError } from "./errors-DodWX-cb.js";
import { E as profileChatClient, S as ObservationError, T as renderReport, b as sample, k as strategyAuthorMethod, v as refine, w as observe, x as sampleThenRefine, y as runAgentic } from "./structural-rollout-D-0X6lsU.js";
import { a as concreteProfileModel, c as profileModelExecutionSettings, i as concreteModelId, l as profileProviderModel, o as enforceTokenLimits, t as assertExecutableAgentProfile } from "./model-policy-BbSCSak0.js";
import { C as canonicalCandidateDigest$1, D as immutableCandidateValue, k as sha256Bytes$1, m as captureMaterializedWorkspace } from "./workspace-archive-C9lgf77y.js";
import { i as notifyRuntimeHookEvent } from "./runtime-hooks-tXpAarhW.js";
import { i as redactProtectedValue, r as redactProtectedReason } from "./protected-redaction-DylCC_ot.js";
import { S as foldCoordinationRecords, y as createInMemoryRunContext } from "./coordination-driver-BBL_OgRw.js";
import { C as gateOnDeliverable, r as supervise, w as mapExecutorResult } from "./supervise-DBQdrp7H.js";
import "./run-layout-vwd4SwX_.js";
import "./provision-supervisor-BvnihiyB.js";
import "./delegate-CZc7B-Tl.js";
import "./graph-Ci8Ufs_f.js";
import { agentProfileSchema, canonicalAgentProfileDigest, canonicalCandidateDigest, sha256Bytes, validateAgentProfileSecurity } from "@tangle-network/agent-interface";
import { CODING_HARNESSES, DEFAULT_TRACE_ANALYST_KINDS, InMemoryTraceStore, OUTPUT_VALUE, benjaminiHochberg, buildTrajectory, computeFindingId as computeFindingId$1, confidenceInterval, createTraceAnalyst, expandProfileAxes, makeFinding as makeFinding$1, pairedBootstrap, paretoFrontier, wilcoxonSignedRank, wilson } from "@tangle-network/agent-eval";
import { createAgentRunOutcomeTracker } from "@tangle-network/sandbox/runtime";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { materializeProfile } from "@tangle-network/agent-profile-materialize";
import { tmpdir } from "node:os";
import { isDeepStrictEqual, promisify } from "node:util";
import { collectAgentResponseText } from "@tangle-network/sandbox";
import { heldoutSignificance, runProfileMatrix } from "@tangle-network/agent-eval/campaign";
import { createInterface } from "node:readline";
import { harnessSystemPromptIntents as harnessSystemPromptIntents$1 } from "@tangle-network/agent-interface/harness-capabilities";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { createContext, runInContext } from "node:vm";
import { stuckLoopView, toolWasteView } from "@tangle-network/agent-eval/pipelines";
//#region src/runtime/tangle-sandbox-exact-process-provider.ts
const exactProcessProviderMarker = "agent-runtime.exact-process-provider";
const exactProcessEgressMarker = "agent-runtime.exact-process-egress";
/**
* Adapt Tangle Sandbox's managed control runtime to Runtime's exact-process provider.
*
* The adapter deliberately exposes no ordinary agent environment: an exact experiment
* must start a fresh Sandbox with no managed agent and launch its declared argv directly.
*/
function createTangleSandboxExactProcessProvider(client, options = {}) {
	const name = options.name ?? "tangle-sandbox-exact-process";
	if (!name.trim()) throw new Error("Tangle Sandbox exact-process provider name must not be empty");
	return {
		name,
		exactProcess: {
			async create(input) {
				throwIfAborted(input.signal);
				assertNoProviderOptions(input.providerOptions);
				const egressPolicy = sandboxEgressPolicy(input.egress);
				const metadata = exactMetadata(input.metadata, name, egressPolicy);
				const sandbox = await client.create({
					environment: requiredText(input.image, "exact-process image"),
					agent: false,
					bare: false,
					ephemeral: true,
					egressPolicy,
					resources: sandboxResources(input),
					maxLifetimeSeconds: sandboxLifetimeSeconds(input.maxLifetimeMs),
					metadata,
					idempotencyKey: requiredText(input.idempotencyKey, "exact-process idempotency key")
				}, {
					...input.provisionTimeoutMs === void 0 ? {} : { timeoutMs: positiveInteger(input.provisionTimeoutMs, "provision timeout") },
					...input.signal === void 0 ? {} : { signal: input.signal }
				});
				try {
					throwIfAborted(input.signal);
					assertExactSandboxMetadata(sandbox, metadata);
					await assertExactSandboxEgress(sandbox, egressPolicy);
				} catch (error) {
					await discardInvalidSandbox(sandbox, error);
				}
				return sandboxAsExactProcessEnvironment(sandbox, name);
			},
			async get(id) {
				const sandbox = await client.get(id);
				if (!sandbox || !isExactSandbox(sandbox, name)) return null;
				await assertExactSandboxEgress(sandbox, egressFromMetadata(sandbox.metadata));
				return sandboxAsExactProcessEnvironment(sandbox, name);
			},
			async list(query) {
				assertNoProviderOptions(query?.providerOptions);
				const sandboxes = await client.list();
				return Promise.all(sandboxes.filter((sandbox) => isExactSandbox(sandbox, name)).filter((sandbox) => metadataMatches(sandbox.metadata, query?.metadata)).map(async (sandbox) => {
					await assertExactSandboxEgress(sandbox, egressFromMetadata(sandbox.metadata));
					return sandboxAsExactProcessEnvironment(sandbox, name);
				}));
			}
		},
		capabilities: exactProcessOnlyCapabilities,
		async create() {
			throw new Error(`agent environment provider "${name}" supports exactProcess.create() only`);
		}
	};
}
function sandboxAsExactProcessEnvironment(sandbox, provider) {
	return {
		id: requiredText(sandbox.id, "Sandbox id"),
		provider,
		...sandbox.metadata ? { metadata: sandbox.metadata } : {},
		process: {
			async list() {
				return (await sandbox.process.list()).map((status) => exactProcessStatus(status));
			},
			async get(pid) {
				const process = await sandbox.process.get(pid);
				return process ? sandboxProcessAsExactProcess(process) : null;
			},
			async spawn(input, options) {
				return sandboxProcessAsExactProcess(await afterAbortCheck(options?.signal, () => sandbox.process.spawnExact(input.executable, [...input.args], {
					cwd: input.cwd,
					env: { ...input.env },
					inheritEnv: false,
					...input.stdin === void 0 ? {} : { stdin: input.stdin },
					timeoutMs: input.timeoutMs
				})));
			}
		},
		async writeFile(path, bytes, options) {
			if (sandbox.fs.supportsWriteMode !== true) throw new Error("Tangle Sandbox does not declare exact file-mode support");
			await afterAbortCheck(options.signal, () => sandbox.fs.write(path, Buffer.from(bytes).toString("base64"), {
				encoding: "base64",
				mode: fileMode(options.mode)
			}));
		},
		async readFile(path, options) {
			const maxBytes = nonnegativeInteger(options.maxBytes, "exact-process file read maximum");
			const initialSize = nonnegativeInteger((await afterAbortCheck(options.signal, () => sandbox.fs.stat(path))).size, `Tangle Sandbox file size for "${path}"`);
			if (initialSize > maxBytes) throw new Error(`Tangle Sandbox file "${path}" exceeds the ${maxBytes}-byte exact read maximum`);
			const result = await afterAbortCheck(options.signal, () => sandbox.fs.readBatch([path], { encoding: "base64" }));
			const failure = result.errors.find((entry) => entry.path === path);
			if (failure) throw new Error(`Tangle Sandbox failed to read "${path}": ${failure.error}`);
			const files = result.files.filter((entry) => entry.path === path);
			if (files.length !== 1) throw new Error(`Tangle Sandbox returned ${files.length} files for exact read "${path}"`);
			const file = files[0];
			if (file.encoding !== "base64") throw new Error(`Tangle Sandbox returned non-binary content for exact read "${path}"`);
			const size = nonnegativeInteger(file.size, `Tangle Sandbox file size for "${path}"`);
			if (size !== initialSize) throw new Error(`Tangle Sandbox file "${path}" changed during exact read`);
			if (size > maxBytes) throw new Error(`Tangle Sandbox file "${path}" exceeds the ${maxBytes}-byte exact read maximum`);
			const bytes = Buffer.from(file.content, "base64");
			if (bytes.byteLength !== size || bytes.toString("base64") !== file.content) throw new Error(`Tangle Sandbox returned an invalid binary payload for exact read "${path}"`);
			return Uint8Array.from(bytes);
		},
		async destroy() {
			await sandbox.delete();
		}
	};
}
function sandboxProcessAsExactProcess(process) {
	const pid = positiveInteger(process.pid, "Tangle Sandbox process pid");
	return {
		pid,
		async status() {
			return exactProcessStatus(await process.status(), pid);
		},
		async wait() {
			const waitExitCode = await process.wait();
			if (!Number.isSafeInteger(waitExitCode)) throw new Error("Tangle Sandbox process wait returned an invalid exit code");
			const status = exactProcessStatus(await process.status(), pid);
			if (status.running || !status.termination) throw new Error("Tangle Sandbox process wait returned before terminal status");
			if (status.termination.kind === "exit" && status.termination.exitCode !== waitExitCode) throw new Error("Tangle Sandbox process wait and status disagree on exit code");
			return status.termination;
		},
		async kill() {
			await process.kill("SIGKILL", { tree: true });
		},
		async *stdout() {
			yield* process.stdout();
		},
		async *stderr() {
			yield* process.stderr();
		}
	};
}
function exactProcessStatus(status, expectedPid) {
	const pid = positiveInteger(status.pid, "Tangle Sandbox process pid");
	if (expectedPid !== void 0 && pid !== expectedPid) throw new Error("Tangle Sandbox process status changed process identity");
	if (typeof status.running !== "boolean") throw new Error("Tangle Sandbox process status is missing running state");
	if (!Number.isSafeInteger(status.exitCode)) throw new Error("Tangle Sandbox process status is missing an integer exit code");
	const exitSignal = optionalText(status.exitSignal, "Tangle Sandbox process exit signal");
	if (status.running) {
		if (status.exitCode !== -1) throw new Error("Tangle Sandbox running process must report exit code -1");
		if (exitSignal) throw new Error("Tangle Sandbox running process must not report an exit signal");
		return {
			pid,
			running: true,
			exitCode: -1
		};
	}
	const termination = exitSignal ? {
		kind: "signal",
		signal: exitSignal
	} : status.exitCode >= 0 ? {
		kind: "exit",
		exitCode: status.exitCode
	} : void 0;
	if (!termination) throw new Error("Tangle Sandbox stopped process has no terminal reason");
	return {
		pid,
		running: false,
		exitCode: status.exitCode,
		...exitSignal ? { exitSignal } : {},
		termination
	};
}
function exactMetadata(metadata, provider, egressPolicy) {
	for (const marker of [exactProcessProviderMarker, exactProcessEgressMarker]) if (Object.hasOwn(metadata, marker)) throw new Error(`exact-process metadata must not set "${marker}"`);
	return {
		...metadata,
		[exactProcessProviderMarker]: provider,
		[exactProcessEgressMarker]: serializeEgressPolicy(egressPolicy)
	};
}
function isExactSandbox(sandbox, provider) {
	return sandbox.metadata?.[exactProcessProviderMarker] === provider;
}
function metadataMatches(metadata, expected) {
	return expected === void 0 || Object.entries(expected).every(([key, value]) => isDeepStrictEqual(metadata?.[key], value));
}
function assertExactSandboxMetadata(sandbox, expected) {
	if (!metadataMatches(sandbox.metadata, expected)) throw new Error("Tangle Sandbox did not persist exact-process metadata");
}
function egressFromMetadata(metadata) {
	const encoded = metadata?.[exactProcessEgressMarker];
	if (typeof encoded !== "string") throw new Error("Tangle Sandbox exact-process environment is missing egress metadata");
	try {
		const parsed = JSON.parse(encoded);
		if (!parsed || typeof parsed !== "object") throw new Error("expected egress object");
		const policy = parsed;
		if (policy.mode === "blocked" && policy.allowDomains === void 0) return { mode: "blocked" };
		if (policy.mode === "strict" && policy.includeImplicitDomains === false && Array.isArray(policy.allowDomains) && policy.allowDomains.every((domain) => typeof domain === "string")) {
			const allowDomains = sortedDomains(policy.allowDomains);
			if (new Set(allowDomains).size === allowDomains.length) return {
				mode: "strict",
				allowDomains,
				includeImplicitDomains: false
			};
		}
	} catch {
		throw new Error("Tangle Sandbox exact-process environment has invalid egress metadata");
	}
	throw new Error("Tangle Sandbox exact-process environment has invalid egress metadata");
}
async function assertExactSandboxEgress(sandbox, expected) {
	const actual = (await sandbox.egress.get()).policy;
	if (actual.mode !== expected.mode) throw new Error(`Tangle Sandbox egress mismatch: expected ${expected.mode}, received ${actual.mode}`);
	if (expected.mode === "blocked") {
		const allowDomains = actual.allowDomains;
		if (actual.mode === "blocked" && (allowDomains === void 0 || Array.isArray(allowDomains) && allowDomains.length === 0)) return;
		throw new Error("Tangle Sandbox blocked egress retained an allowlist");
	}
	if (actual.mode !== "strict") throw new Error("Tangle Sandbox did not return strict egress policy");
	const expectedDomains = sortedDomains(expected.allowDomains);
	if (!isDeepStrictEqual(sortedDomains(actual.allowDomains ?? []), expectedDomains)) throw new Error("Tangle Sandbox strict egress differs from the exact allowlist");
	if (actual.includeImplicitDomains !== false) throw new Error("Tangle Sandbox strict egress retained implicit domains");
}
function sandboxEgressPolicy(input) {
	if (input.mode === "blocked") return { mode: "blocked" };
	const allowDomains = input.allowDomains.map((domain) => requiredText(domain, "strict egress domain"));
	if (new Set(allowDomains).size !== allowDomains.length) throw new Error("strict egress domains must not contain duplicates");
	return {
		mode: "strict",
		allowDomains,
		includeImplicitDomains: false
	};
}
function serializeEgressPolicy(policy) {
	return JSON.stringify(policy.mode === "blocked" ? { mode: "blocked" } : {
		mode: "strict",
		allowDomains: sortedDomains(policy.allowDomains),
		includeImplicitDomains: false
	});
}
function sandboxResources(input) {
	const cpuCores = positiveNumber(input.resources.cpu, "exact-process cpu");
	const memoryMB = positiveInteger(input.resources.memoryMb, "exact-process memory");
	const diskMb = positiveInteger(input.resources.diskMb, "exact-process disk");
	if (diskMb % 1024 !== 0) throw new Error("Tangle Sandbox exact-process disk must be a whole GiB");
	return {
		cpuCores,
		memoryMB,
		diskGB: diskMb / 1024
	};
}
function sandboxLifetimeSeconds(maxLifetimeMs) {
	const milliseconds = positiveInteger(maxLifetimeMs, "exact-process maximum lifetime");
	if (milliseconds % 1e3 !== 0) throw new Error("Tangle Sandbox exact-process maximum lifetime must be a whole number of seconds");
	return milliseconds / 1e3;
}
function fileMode(value) {
	const mode = nonnegativeInteger(value, "exact-process file mode");
	if (mode > 4095) throw new Error("exact-process file mode exceeds POSIX mode bits");
	return mode;
}
function assertNoProviderOptions(providerOptions) {
	if (providerOptions && Object.keys(providerOptions).length > 0) throw new Error("Tangle Sandbox exact-process provider does not accept providerOptions");
}
function exactProcessOnlyCapabilities() {
	return {
		profile: {
			namedProfiles: false,
			systemPrompt: {
				replace: false,
				append: false
			},
			instructions: false,
			tools: false,
			permissions: false,
			mcp: false,
			subagents: false,
			resources: {
				files: false,
				instructions: false,
				tools: false,
				skills: false,
				agents: false,
				commands: false
			},
			hooks: false,
			modes: false,
			runtimeUpdate: false,
			validation: false
		},
		streaming: {
			live: false,
			replay: false,
			detach: false,
			turnIdempotency: false
		},
		sessions: {
			continue: false,
			list: false,
			messages: false
		},
		workspace: {
			read: false,
			write: false,
			exec: false,
			git: false,
			upload: false,
			download: false
		},
		branching: {
			checkpoint: false,
			fork: false
		},
		placement: false,
		usage: false,
		confidential: false,
		exactProcess: { egress: ["blocked", "strict"] }
	};
}
async function discardInvalidSandbox(sandbox, cause) {
	try {
		await sandbox.delete();
	} catch (destroyError) {
		throw new AggregateError([cause, destroyError], "Tangle Sandbox exact-process creation failed and cleanup failed");
	}
	throw cause;
}
function sortedDomains(domains) {
	return [...domains].sort((left, right) => left.localeCompare(right));
}
function requiredText(value, label) {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
	return value;
}
function optionalText(value, label) {
	if (value === void 0) return void 0;
	return requiredText(value, label);
}
function positiveNumber(value, label) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
	return value;
}
function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
	return value;
}
function nonnegativeInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
	return value;
}
function throwIfAborted(signal) {
	signal?.throwIfAborted();
}
async function afterAbortCheck(signal, operation) {
	throwIfAborted(signal);
	const result = await operation();
	throwIfAborted(signal);
	return result;
}
//#endregion
//#region src/runtime/key-provider.ts
/** The env-backed provider: reads the (dotenvx-loaded) process env. Empty /
*  whitespace-only values count as absent — fail loud, not with a blank key. */
function envKeyProvider(env = process.env) {
	return { async get(name) {
		const value = env[name];
		return value !== void 0 && value.trim().length > 0 ? value : void 0;
	} };
}
/** The `AgentProfileMcpServer.metadata` key the declarative secret-env map
*  rides under: `{ ENV_VAR_NAME: 'PROVIDER_KEY_NAME' }`. Names only — values
*  are resolved at materialize time and never stored. */
const mcpSecretEnvMetadataKey = "secretEnv";
/** Read (and validate) a server entry's declared secret-env map, if any.
*  Malformed metadata throws — a half-declared secret must never half-boot. */
function secretEnvOfMcpServer(server) {
	const raw = server.metadata?.[mcpSecretEnvMetadataKey];
	if (raw === void 0 || raw === null) return void 0;
	if (typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError(`secretEnvOfMcpServer: metadata.${mcpSecretEnvMetadataKey} must be an object mapping env var name -> key name`);
	const entries = Object.entries(raw);
	if (entries.length === 0) return void 0;
	for (const [envName, keyName] of entries) if (!envName.trim() || typeof keyName !== "string" || !keyName.trim()) throw new ValidationError(`secretEnvOfMcpServer: metadata.${mcpSecretEnvMetadataKey}['${envName}'] must name a non-empty provider key`);
	return raw;
}
/**
* Resolve a declared secret-env map into the real env entries for a server
* spawn. Fail-closed: no provider or a missing key throws, naming the KEY
* NAME only (the value never appears in any message). `label` names the
* server for the error (e.g. `profile.mcp['exa']`).
*/
async function resolveSecretEnv(secretEnv, keys, label) {
	const entries = Object.entries(secretEnv);
	if (entries.length === 0) return {};
	if (!keys) throw new ValidationError(`${label} declares secret env (${entries.map(([e]) => e).join(", ")}) but no KeyProvider was supplied — refusing to boot an external server keyless`);
	const resolved = {};
	for (const [envName, keyName] of entries) {
		const value = await keys.get(keyName);
		if (value === void 0) throw new ValidationError(`${label}: the KeyProvider holds no value for '${keyName}' (wanted for env ${envName}) — provision the key or drop the grant`);
		resolved[envName] = value;
	}
	return resolved;
}
/** Apply a secret-ref's declared decoration to its resolved raw value. */
function formatSecretValue(value, format) {
	return format === "bearer" ? `Bearer ${value}` : value;
}
/**
* Resolve a profile MCP server's `args`/`env` config values (interface ≥0.40
* `AgentProfileConfigValue`) plus the legacy `metadata.secretEnv` channel into
* the plain strings a spawn needs.
*
* Rules, all fail-closed:
* - `args` must be public values. A secret-ref in argv is refused: argv is
*   readable by every host process (/proc/PID/cmdline) and outside the
*   protected-value redaction channel, so a secret there cannot be contained.
* - `env` secret-refs resolve through the KeyProvider (missing provider or key
*   throws, naming the KEY NAME only) and land in `protectedEnv`.
* - An env var declared secret on BOTH channels (env secret-ref and
*   metadata.secretEnv) is ambiguous configuration and throws.
* - A public `env` entry shadowed by a legacy metadata secret keeps the
*   pre-0.40 spawn precedence: the secret value wins in the child env.
*/
async function resolveMcpServerLaunch(server, keys, label) {
	const args = server.args?.map((value, index) => {
		if (value.kind !== "public") throw new ValidationError(`${label}.args[${index}] is a secret-ref ('${value.key}') — argv is readable by every host process and exempt from redaction; declare the secret in env instead`);
		return value.value;
	});
	const publicEnv = {};
	const envSecretRefs = {};
	const envSecretFormats = {};
	for (const [envName, value] of Object.entries(server.env ?? {})) if (value.kind === "public") publicEnv[envName] = value.value;
	else {
		envSecretRefs[envName] = value.key;
		envSecretFormats[envName] = value.format;
	}
	const legacySecretEnv = secretEnvOfMcpServer(server);
	for (const envName of Object.keys(legacySecretEnv ?? {})) if (envName in envSecretRefs) throw new ValidationError(`${label}: env ${envName} is declared secret twice — once as an env secret-ref and once in metadata.${mcpSecretEnvMetadataKey}; keep exactly one declaration`);
	const resolvedRefs = await resolveSecretEnv(envSecretRefs, keys, label);
	const protectedEnv = {
		...legacySecretEnv ? await resolveSecretEnv(legacySecretEnv, keys, label) : {},
		...Object.fromEntries(Object.entries(resolvedRefs).map(([envName, raw]) => [envName, formatSecretValue(raw, envSecretFormats[envName])]))
	};
	return {
		...args ? { args } : {},
		...server.env ? { env: publicEnv } : {},
		...Object.keys(protectedEnv).length > 0 ? { protectedEnv } : {}
	};
}
//#endregion
//#region src/runtime/mcp-environment.ts
/** POST JSON-RPC and parse a JSON body OR the last `data:` line of an SSE stream.
*  Retries thrown fetches (transient network) with linear backoff; HTTP status and
*  JSON-RPC errors are returned to the caller, not retried. */
async function rpc(endpoint, body) {
	let lastErr;
	for (let attempt = 0; attempt < 4; attempt += 1) try {
		const r = await fetch(endpoint.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...endpoint.headers ?? {}
			},
			body: JSON.stringify(body)
		});
		const text = await r.text();
		const dataLines = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
		const payload = dataLines.length ? dataLines[dataLines.length - 1] : text;
		try {
			return {
				status: r.status,
				json: JSON.parse(payload ?? "null")
			};
		} catch {
			return {
				status: r.status,
				json: text
			};
		}
	} catch (err) {
		lastErr = err;
		await new Promise((res) => setTimeout(res, 1e3 * (attempt + 1)));
	}
	throw new Error(`mcp rpc ${endpoint.url} failed after 4 attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
/** Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema.
*  Shared with the same-host stdio client (`materializeLocalMcp`) — one coercion
*  rule for every MCP tool a worker sees, regardless of transport. */
function sanitizeMcpToolSchema(s) {
	const o = s && typeof s === "object" ? s : {};
	const banned = o.oneOf || o.anyOf || o.allOf || o.not || o.enum;
	if (o.type === "object" && !banned && o.properties && typeof o.properties === "object") return {
		type: "object",
		properties: o.properties,
		...Array.isArray(o.required) ? { required: o.required } : {}
	};
	return {
		type: "object",
		properties: {}
	};
}
/** Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks. */
function createMcpEnvironment(opts) {
	const endpoints = /* @__PURE__ */ new Map();
	const maxChars = opts.maxResultChars ?? 1500;
	return {
		name: opts.name,
		async open(task) {
			const { handle, endpoint } = await opts.open(task);
			endpoints.set(handle.id, endpoint);
			return handle;
		},
		async tools(task, handle) {
			const endpoint = endpoints.get(handle.id);
			if (!endpoint) throw new Error(`${opts.name}: tools() before open() for ${handle.id}`);
			const { json } = await rpc(endpoint, {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
				params: {}
			});
			const all = (json.result?.tools ?? []).map((t) => ({
				type: "function",
				function: {
					name: t.name,
					description: (t.description ?? "").slice(0, 1e3),
					parameters: sanitizeMcpToolSchema(t.inputSchema)
				}
			}));
			return opts.selectTools ? opts.selectTools(task, all) : all;
		},
		async call(handle, name, args) {
			const endpoint = endpoints.get(handle.id);
			if (!endpoint) return "ERROR: workspace closed";
			const { json } = await rpc(endpoint, {
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: {
					name,
					arguments: args
				}
			});
			const result = json ?? {};
			if (result.error) return `ERROR: ${JSON.stringify(result.error).slice(0, 300)}`;
			return (result.result?.content?.map((c) => c.text ?? "").join("\n") ?? JSON.stringify(result.result ?? json)).slice(0, maxChars);
		},
		score: (task, handle) => opts.score(task, handle),
		async close(handle) {
			endpoints.delete(handle.id);
			await opts.close?.(handle);
		}
	};
}
//#endregion
//#region src/runtime/stdio-mcp-client.ts
/**
* Same-host stdio MCP: the ONE persistent newline-delimited JSON-RPC 2.0
* connection to a spawned MCP server child process. This is the handshake
* `mcpServeVerifier` boots for its probe (`initialize` →
* `notifications/initialized` → `tools/list`), extracted so a trusted
* same-host consumer can keep the server running and route `tools/call` to it.
* This module does not isolate the child: callers must use a real sandbox for
* user- or model-authored code.
*
* Two layers:
*   - `connectStdioMcp`     — spawn ONE server at its cwd, run the real MCP
*     handshake, return a live connection: the listed tools, `callTool`, `close`.
*   - `materializeLocalMcp` — spawn EVERY enabled stdio server in
*     `profile.mcp`, namespace each server's tools as `<server>__<tool>` so
*     they can share a worker's tool list with a domain surface's tools, and
*     expose one route/close facade over the set. Fail-CLOSED: a declared
*     server that cannot boot throws — silently scoring the profile as if it
*     had no MCP surface would fake the with/without ablation.
*
* Failure taxonomy (mirrors `commandVerifier`/`mcpServeVerifier`): a missing
* start binary or spawn fault is a SETUP bug (`McpSpawnFault` — candidate
* graders must rethrow it, never score it); a server that crashes, errors the
* handshake, or times out is an ordinary `Error` carrying the stderr tail; a
* JSON-RPC error on `tools/call` is the AGENT's outcome — returned as an
* `ERROR: …` string, never thrown (the `createMcpEnvironment` convention).
*
* Protocol matches the runtime's own stdio MCP server (src/mcp/server.ts):
* newline-delimited JSON-RPC 2.0, protocol version 2024-11-05.
*/
const PROTOCOL_VERSION = "2024-11-05";
/** Non-sensitive process settings a stdio child may inherit without receiving
* credentials, agent settings, provider configuration, or tracing state. */
const SAFE_INHERITED_ENV_NAMES = [
	"PATH",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"PATHEXT"
];
function inheritedStdioEnv(source = process.env) {
	const env = {};
	for (const name of SAFE_INHERITED_ENV_NAMES) {
		const value = source[name];
		if (value !== void 0) env[name] = value;
	}
	return env;
}
/** A missing start binary / spawn fault: a SETUP bug, never a failed candidate.
*  Graders (the serve verifier) must rethrow this instead of scoring it. */
var McpSpawnFault = class extends Error {};
/** Spawn a trusted host command, complete the stdio MCP handshake, and return
* the live connection. This low-level function provides no process isolation. */
async function connectStdioMcp(spec) {
	const timeoutMs = spec.timeoutMs ?? 3e4;
	const protectedValues = Object.values(spec.protectedEnv ?? {});
	const redactReason = (value) => redactProtectedReason(value, protectedValues);
	const child = spawn(spec.command, spec.args ?? [], {
		...spec.cwd ? { cwd: spec.cwd } : {},
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		],
		env: {
			...inheritedStdioEnv(),
			...spec.env,
			...spec.protectedEnv
		}
	});
	const stderr = [];
	child.stderr.on("data", (d) => stderr.push(String(d)));
	const stderrTail = () => stderr.length > 0 ? `\nstderr:\n${redactReason(stderr.join("")).slice(-2e3)}` : "";
	let nextId = 1;
	let spawnFault;
	let closed = false;
	const pending = /* @__PURE__ */ new Map();
	const failAllPending = (err) => {
		for (const p of pending.values()) {
			p.clearTimer();
			p.reject(err);
		}
		pending.clear();
	};
	child.on("error", (err) => {
		spawnFault = err.code === "ENOENT" ? new McpSpawnFault(`'${spec.command}' not found in PATH (setup bug, not a failed candidate)`) : new McpSpawnFault(`'${spec.command}' failed to spawn: ${err.message}`);
		failAllPending(spawnFault);
	});
	child.stdin.on("error", (err) => {
		failAllPending(new Error(redactReason(`writing to MCP server stdin failed: ${err.message}${stderrTail()}`)));
	});
	child.on("close", (code, signal) => {
		failAllPending(spawnFault ?? new Error(redactReason(`MCP server exited (code ${code}, signal ${signal}) before serving${stderrTail()}`)));
	});
	const rl = createInterface({ input: child.stdout });
	rl.on("line", (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (!msg || typeof msg !== "object" || typeof msg.id !== "number") return;
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		p.clearTimer();
		p.resolve(msg);
	});
	const send = (msg) => {
		child.stdin.write(`${JSON.stringify(msg)}\n`);
	};
	const request = (method, params, timeoutMessage = `MCP server did not answer '${method}' within ${timeoutMs}ms`) => new Promise((resolve, reject) => {
		if (spawnFault) return reject(spawnFault);
		if (closed) return reject(/* @__PURE__ */ new Error("MCP connection closed"));
		const id = nextId++;
		const clearTimer = armDeadlineTimer(timeoutMs, () => {
			pending.delete(id);
			reject(new Error(redactReason(`${timeoutMessage}${stderrTail()}`)));
		}, true);
		pending.set(id, {
			resolve,
			reject,
			clearTimer
		});
		try {
			send({
				jsonrpc: "2.0",
				id,
				method,
				...params ? { params } : {}
			});
		} catch (err) {
			pending.delete(id);
			clearTimer();
			reject(new Error(redactReason(`writing to MCP server stdin failed: ${err instanceof Error ? err.message : String(err)}${stderrTail()}`)));
		}
	});
	const close = async () => {
		if (closed) return;
		closed = true;
		rl.close();
		failAllPending(/* @__PURE__ */ new Error("MCP connection closed"));
		child.kill("SIGKILL");
	};
	const handshakeTimeout = `MCP server did not complete the handshake within ${timeoutMs}ms`;
	try {
		const init = await request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: {
				name: "agent-runtime-local-mcp",
				version: "0"
			}
		}, handshakeTimeout);
		if (init.error) throw new Error(redactReason(`initialize errored: ${JSON.stringify(init.error)}${stderrTail()}`));
		send({
			jsonrpc: "2.0",
			method: "notifications/initialized"
		});
		const list = await request("tools/list", void 0, handshakeTimeout);
		if (list.error) throw new Error(redactReason(`tools/list errored: ${JSON.stringify(list.error)}${stderrTail()}`));
		const rawTools = list.result?.tools;
		if (!Array.isArray(rawTools)) throw new Error(`tools/list result has no tools array${stderrTail()}`);
		const tools = redactProtectedValue(rawTools, protectedValues).value;
		const callTool = async (name, args) => {
			const res = await request("tools/call", {
				name,
				arguments: args
			});
			if (res.error) return `ERROR: ${redactReason(JSON.stringify(res.error)).slice(0, 300)}`;
			const result = res.result;
			const chunks = result?.content?.map((c) => c.text ?? "");
			const joined = chunks?.join("\n") ?? JSON.stringify(result ?? null);
			const collapsed = chunks?.join("");
			let text = joined;
			if (collapsed !== void 0) {
				const collapsedRedacted = redactReason(collapsed);
				if (collapsedRedacted !== collapsed) text = collapsedRedacted;
			}
			return redactReason(result?.isError ? `ERROR: ${text}` : text);
		};
		return {
			tools,
			callTool,
			close
		};
	} catch (err) {
		await close();
		throw err;
	}
}
/**
* Spawn every explicitly trusted stdio server in `profile.mcp` as a same-host
* child and expose its tools under `<server>__<tool>` names. The default policy
* refuses local processes. A profile with no MCP surface returns zero tools.
*/
async function materializeLocalMcp(profile, opts = {}) {
	const security = validateAgentProfileSecurity(profile, opts.profileSecurityPolicy);
	if (!security.ok) throw new ValidationError(`materializeLocalMcp: profile host execution refused: ${security.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("; ")}`);
	const maxResultChars = opts.maxResultChars ?? 2e3;
	const connections = [];
	const routes = /* @__PURE__ */ new Map();
	const tools = [];
	const close = async () => {
		await Promise.all(connections.map((c) => c.close()));
	};
	try {
		for (const [key, server] of Object.entries(profile.mcp ?? {})) {
			if (server.enabled === false) continue;
			const transport = server.transport ?? "stdio";
			if (transport !== "stdio") throw new ValidationError(`materializeLocalMcp: profile.mcp['${key}'] has transport '${transport}' — the same-host client only spawns stdio servers; a remote (http/sse) server needs an http MCP client (not yet built here) or the sandbox backend. Failing loud: scoring this profile without its declared server would fake the with/without ablation`);
			if (!server.command || server.command.trim().length === 0) throw new ValidationError(`materializeLocalMcp: profile.mcp['${key}'] declares a stdio server with no command`);
			const launch = await resolveMcpServerLaunch(server, opts.keys, `materializeLocalMcp: profile.mcp['${key}']`);
			const conn = await connectStdioMcp({
				command: server.command,
				...launch.args ? { args: launch.args } : {},
				...server.cwd ? { cwd: server.cwd } : {},
				...launch.env ? { env: launch.env } : {},
				...launch.protectedEnv ? { protectedEnv: launch.protectedEnv } : {},
				...opts.timeoutMs !== void 0 ? { timeoutMs: opts.timeoutMs } : {}
			});
			connections.push(conn);
			const prefix = key.replace(/[^a-zA-Z0-9_-]/g, "_");
			for (const t of conn.tools) {
				const name = `${prefix}__${t.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
				if (routes.has(name)) throw new ValidationError(`materializeLocalMcp: namespaced tool '${name}' collides across servers — rename the profile.mcp keys`);
				routes.set(name, {
					conn,
					tool: t.name
				});
				tools.push({
					type: "function",
					function: {
						name,
						description: (t.description ?? "").slice(0, 1e3),
						parameters: sanitizeMcpToolSchema(t.inputSchema)
					}
				});
			}
		}
	} catch (err) {
		await close();
		throw err;
	}
	return {
		tools,
		owns: (name) => routes.has(name),
		call: async (name, args) => {
			const route = routes.get(name);
			if (!route) throw new Error(`materializeLocalMcp: unknown tool '${name}'`);
			const out = await route.conn.callTool(route.tool, args);
			return out.length > maxResultChars ? out.slice(0, maxResultChars) : out;
		},
		close
	};
}
//#endregion
//#region src/durable/spawn-journal-sql.ts
/**
* SQL-backed durable stores for supervised runs — `SqlSpawnJournal` and `SqlResultBlobStore`
* over the same minimal statement seam `SqlConversationJournal` uses (D1, postgres, sqlite,
* libSQL; positional `?` placeholders). This closes the orchestration-durability gap recorded in
* `conformance/durability/STATUS.md`: until now the spawn layer was file-only.
*
* Parity with the JSONL file stores, by construction:
*   • same corruption guards — `beginTree` precedes events (enforced by the schema: an event row
*     names a tree row), duplicate cursor seqs and duplicate materialization receipts are refused
*     by the same `SpawnEventIndex` the file journal replays through, on both append and load;
*   • same content-address law for blobs — a `put` whose ref does not hash to the artifact is
*     refused, a re-put of the same ref asserts the identical bytes;
*   • load order is insertion order (`INTEGER PRIMARY KEY AUTOINCREMENT`), the SQL analogue of
*     the JSONL append-only spine.
*
* Durability note: this suite and its process-kill test run against `node:sqlite`, whose
* autocommit commits survive SIGKILL (process death, not OS crash). A deployment that must
* survive power loss sets its driver's synchronous mode (`PRAGMA synchronous=FULL` + WAL) at the
* adapter; agent-runtime takes no opinion.
*
* @experimental — draft: cross-process ownership is single-writer by convention (the same
* limitation `createFileRunContext` documents); a machine-visible ownership lease is follow-up.
*/
const TREES_DDL = (table) => `
  CREATE TABLE IF NOT EXISTS ${table}_trees (
    root TEXT PRIMARY KEY,
    begun_at TEXT NOT NULL
  )
`;
const EVENTS_DDL = (table) => `
  CREATE TABLE IF NOT EXISTS ${table}_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root TEXT NOT NULL REFERENCES ${table}_trees (root),
    body TEXT NOT NULL
  )
`;
const BLOBS_DDL = (table) => `
  CREATE TABLE IF NOT EXISTS ${table}_blobs (
    ref TEXT PRIMARY KEY,
    body TEXT NOT NULL
  )
`;
/** SQL-backed `SpawnJournal`. One row per event; insertion order is replay order. */
var SqlSpawnJournal = class {
	db;
	table;
	cache = /* @__PURE__ */ new Map();
	appendTail = Promise.resolve();
	constructor(db, table = "runtime_spawn_journal") {
		this.db = db;
		this.table = table;
	}
	/** Create the journal's tables if absent. Idempotent. */
	async migrate() {
		await this.db.exec(TREES_DDL(this.table));
		await this.db.exec(EVENTS_DDL(this.table));
	}
	async loadTree(root) {
		if ((await this.db.query(`SELECT begun_at FROM ${this.table}_trees WHERE root = ?`, [root])).length === 0) return void 0;
		const rows = await this.db.query(`SELECT id, body FROM ${this.table}_events WHERE root = ? ORDER BY id`, [root]);
		const index = new SpawnEventIndex(root);
		const events = [];
		for (const row of rows) {
			const event = JSON.parse(row.body);
			index.assert(event);
			index.add(event);
			events.push(event);
		}
		return events;
	}
	async beginTree(root, at) {
		return this.serializeAppend(async () => {
			await this.ensureMigrated();
			const existing = await this.db.query(`SELECT begun_at FROM ${this.table}_trees WHERE root = ?`, [root]);
			if (existing.length > 0) {
				const begunAt = existing[0]?.begun_at;
				if (begunAt !== at) throw new Error(`spawn tree '${root}' already begun in SQL at ${begunAt}; refusing to overwrite with ${at}`);
				return;
			}
			await this.db.exec(`INSERT INTO ${this.table}_trees (root, begun_at) VALUES (?, ?)`, [root, at]);
			this.cache.set(root, {
				maxId: 0,
				index: new SpawnEventIndex(root)
			});
		});
	}
	async appendEvent(root, ev) {
		const event = detachedSnapshot(ev, "spawn event");
		return this.serializeAppend(async () => {
			await this.ensureMigrated();
			const state = await this.validationIndex(root);
			state.index.assert(event);
			if ((await this.db.exec(`INSERT INTO ${this.table}_events (root, body) VALUES (?, ?)`, [root, JSON.stringify(event)])).rowsAffected !== 1) throw new Error(`spawn journal SQL: append of an event for tree '${root}' affected no rows`);
			state.index.add(event);
			state.maxId = await this.maxEventId(root);
		});
	}
	async validationIndex(root) {
		if ((await this.db.query(`SELECT begun_at FROM ${this.table}_trees WHERE root = ?`, [root])).length === 0) throw new Error(`appendEvent called for unknown spawn tree '${root}'; call beginTree first`);
		const max = await this.maxEventId(root);
		const cached = this.cache.get(root);
		if (cached && cached.maxId === max) return cached;
		const index = new SpawnEventIndex(root);
		if (max > 0) {
			const rows = await this.db.query(`SELECT body FROM ${this.table}_events WHERE root = ? ORDER BY id`, [root]);
			for (const row of rows) {
				const event = JSON.parse(row.body);
				index.assert(event);
				index.add(event);
			}
		}
		const state = {
			maxId: max,
			index
		};
		this.cache.set(root, state);
		return state;
	}
	async maxEventId(root) {
		return (await this.db.query(`SELECT MAX(id) AS max FROM ${this.table}_events WHERE root = ?`, [root]))[0]?.max ?? 0;
	}
	migrated = false;
	async ensureMigrated() {
		if (this.migrated) return;
		await this.migrate();
		this.migrated = true;
	}
	serializeAppend(operation) {
		const append = this.appendTail.then(operation);
		this.appendTail = append.catch(() => void 0);
		return append;
	}
};
/** SQL-backed `ResultBlobStore`. One content-addressed row per settled result. */
var SqlResultBlobStore = class {
	db;
	table;
	migrated = false;
	constructor(db, table = "runtime_result_blobs") {
		this.db = db;
		this.table = table;
	}
	async migrate() {
		await this.db.exec(BLOBS_DDL(this.table));
	}
	async put(outRef, artifact) {
		await this.ensureMigrated();
		const { text } = encodeResultBlob(outRef, artifact);
		if ((await this.db.exec(`INSERT OR IGNORE INTO ${this.table}_blobs (ref, body) VALUES (?, ?)`, [outRef, text])).rowsAffected === 1) return;
		assertContentAddress(outRef, await this.get(outRef));
	}
	async get(outRef) {
		await this.ensureMigrated();
		const rows = await this.db.query(`SELECT body FROM ${this.table}_blobs WHERE ref = ?`, [outRef]);
		if (rows.length === 0) return void 0;
		const artifact = JSON.parse(rows[0]?.body ?? "null");
		assertContentAddress(outRef, artifact);
		return artifact;
	}
	async ensureMigrated() {
		if (this.migrated) return;
		await this.migrate();
		this.migrated = true;
	}
};
//#endregion
//#region src/durable/sql-run-store.ts
/** Refuses a competing or stale SQL run owner before it can publish new work. */
var SqlRunOwnershipError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "SqlRunOwnershipError";
	}
};
/**
* Append-only immutable records, published by ONE compare-and-set of the run's head.
*
* SqlAdapter has no pinned-connection transaction API. INSERT ... SELECT owner is NOT a
* fence on MVCC databases: its snapshot can outlive a takeover. Here both publication and
* takeover UPDATE the SAME row. Unpublished records are harmless, unreachable staging.
* Healthy appends write only their new payload and one fixed-size head, never the history.
*
* Liveness uses a persisted progress counter, not incomparable host clocks. A contender must
* observe the SAME generation/counter for leaseMs before replacing it with a CAS. Every
* heartbeat and publication advances that counter. The interval is stored per run so a
* differently configured contender cannot shorten an existing owner's lease.
* @internal
*/
async function openSqlRunStore(db, runId, options = {}) {
	const prefix = options.tablePrefix ?? "agent_run";
	const leaseMs = options.leaseMs ?? 3e4;
	const heartbeatMs = options.heartbeatMs ?? Math.floor(leaseMs / 3);
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(prefix)) throw new Error("SQL run context tablePrefix must be a SQL identifier of at most 40 characters");
	if (typeof runId !== "string" || runId.length === 0) throw new Error("SQL runId must be nonempty");
	if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 2147483647) throw new Error("SQL leaseMs must be an integer between 100 and 2147483647");
	if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > leaseMs / 3) throw new Error("SQL heartbeatMs must be a positive integer no greater than leaseMs / 3");
	const heads = `${prefix}_heads`;
	const records = `${prefix}_records`;
	await db.exec(`CREATE TABLE IF NOT EXISTS ${heads} (
    run_id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    generation INTEGER NOT NULL,
    pulse INTEGER NOT NULL,
    head TEXT NOT NULL,
    revision INTEGER NOT NULL,
    lease_ms INTEGER NOT NULL,
    namespace TEXT NOT NULL
  )`);
	await db.exec(`CREATE TABLE IF NOT EXISTS ${records} (
    run_id TEXT NOT NULL,
    id TEXT NOT NULL,
    parent TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (run_id, id)
  )`);
	await db.exec(`INSERT INTO ${heads} (run_id, owner, generation, pulse, head, revision, lease_ms, namespace)
     VALUES (?, '', 0, 0, '', 0, ?, ?) ON CONFLICT (run_id) DO NOTHING`, [
		runId,
		leaseMs,
		randomUUID()
	]);
	async function readHead() {
		const [row] = await db.query(`SELECT * FROM ${heads} WHERE run_id = ?`, [runId]);
		if (!row) throw new Error(`SQL run '${runId}' has no head`);
		for (const key of [
			"generation",
			"pulse",
			"revision",
			"lease_ms"
		]) {
			row[key] = Number(row[key]);
			if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error(`SQL run '${runId}' has an invalid ${key}`);
		}
		if (typeof row.namespace !== "string" || row.namespace.length === 0 || typeof row.head !== "string" || typeof row.owner !== "string" || row.head === "" !== (row.revision === 0)) throw new Error(`SQL run '${runId}' has an invalid head`);
		if (row.lease_ms !== leaseMs) throw new Error(`SQL run '${runId}' lease configuration differs: recorded ${row.lease_ms}ms, requested ${leaseMs}ms`);
		return row;
	}
	async function load(head) {
		if (head.revision === 0) return [];
		const rows = await db.query(`SELECT id, parent, revision, payload FROM ${records} WHERE run_id = ? AND revision <= ?`, [runId, head.revision]);
		const byId = new Map(rows.map((row) => [row.id, row]));
		const history = [];
		let id = head.head;
		for (let revision = head.revision; revision > 0; revision -= 1) {
			const row = byId.get(id);
			if (!row || Number(row.revision) !== revision || recordId(row.parent, revision, row.payload) !== id) throw new Error(`SQL run '${runId}' has a missing or corrupt committed record at revision ${revision}`);
			history.push(JSON.parse(row.payload));
			id = row.parent;
		}
		if (id !== "") throw new Error(`SQL run '${runId}' has an invalid history origin`);
		return history.reverse();
	}
	return {
		namespace: (await readHead()).namespace,
		async read() {
			return load(await readHead());
		},
		async acquire(signal) {
			signal?.throwIfAborted();
			const observed = await readHead();
			if (observed.owner !== "") await wait(leaseMs, signal);
			signal?.throwIfAborted();
			const owner = randomUUID();
			let claimed = false;
			try {
				claimed = (await db.exec(`UPDATE ${heads} SET owner = ?, generation = generation + 1, pulse = pulse + 1
           WHERE run_id = ? AND owner = ? AND generation = ? AND pulse = ?`, [
					owner,
					runId,
					observed.owner,
					observed.generation,
					observed.pulse
				])).rowsAffected === 1;
			} catch (error) {
				if ((await readHead().catch(() => void 0))?.owner !== owner) throw error;
				claimed = true;
			}
			if (!claimed) throw new SqlRunOwnershipError(`SQL run '${runId}' is owned by another live process`);
			const generation = observed.generation + 1;
			const controller = new AbortController();
			let accepting = true;
			let released;
			let tail = Promise.resolve();
			let heartbeat;
			let progressAt = performance.now();
			let head = observed.head;
			let revision = observed.revision;
			let history = [];
			const lose = (error) => {
				accepting = false;
				clearInterval(timer);
				controller.abort(error);
			};
			const timer = setInterval(() => {
				if (controller.signal.aborted) return;
				if (performance.now() - progressAt >= leaseMs) {
					lose(new SqlRunOwnershipError(`SQL run '${runId}' lease heartbeat expired`));
					return;
				}
				if (heartbeat) return;
				heartbeat = db.exec(`UPDATE ${heads} SET pulse = pulse + 1 WHERE run_id = ? AND owner = ? AND generation = ?`, [
					runId,
					owner,
					generation
				]).then((result) => {
					if (result.rowsAffected !== 1) throw new SqlRunOwnershipError(`SQL run '${runId}' lease was replaced`);
					progressAt = performance.now();
				}).catch(lose).finally(() => {
					heartbeat = void 0;
				});
			}, heartbeatMs);
			timer.unref();
			const lease = {
				signal: controller.signal,
				get records() {
					return JSON.parse(JSON.stringify(history));
				},
				append(payload) {
					if (!accepting) return Promise.reject(controller.signal.reason ?? new SqlRunOwnershipError(`SQL run '${runId}' lease is released`));
					let encoded;
					try {
						encoded = JSON.stringify(payload);
						if (encoded === void 0) throw new Error("SQL run records must be JSON serializable");
					} catch (error) {
						return Promise.reject(error);
					}
					const write = tail.then(async () => {
						controller.signal.throwIfAborted();
						const nextRevision = revision + 1;
						const id = recordId(head, nextRevision, encoded);
						try {
							await db.exec(`INSERT INTO ${records} (run_id, id, parent, revision, payload) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (run_id, id) DO NOTHING`, [
								runId,
								id,
								head,
								nextRevision,
								encoded
							]);
						} catch (error) {
							const [staged] = await db.query(`SELECT id, parent, revision, payload FROM ${records} WHERE run_id = ? AND id = ?`, [runId, id]).catch(() => []);
							if (!staged || staged.payload !== encoded || staged.parent !== head || Number(staged.revision) !== nextRevision) throw error;
						}
						controller.signal.throwIfAborted();
						let published = false;
						let failure;
						try {
							published = (await db.exec(`UPDATE ${heads} SET head = ?, revision = ?, pulse = pulse + 1
                 WHERE run_id = ? AND owner = ? AND generation = ? AND head = ? AND revision = ?`, [
								id,
								nextRevision,
								runId,
								owner,
								generation,
								head,
								revision
							])).rowsAffected === 1;
						} catch (error) {
							failure = error;
						}
						if (!published) {
							const current = await readHead();
							if (current.owner !== owner || current.generation !== generation) throw new SqlRunOwnershipError(`SQL run '${runId}' lease was replaced before publication`);
							if (current.head !== id || current.revision !== nextRevision) throw failure ?? new SqlRunOwnershipError(`SQL run '${runId}' publication conflicted`);
						}
						controller.signal.throwIfAborted();
						head = id;
						revision = nextRevision;
						history.push(JSON.parse(encoded));
						progressAt = performance.now();
					});
					tail = write.catch(lose);
					return write;
				},
				release() {
					if (released) return released;
					accepting = false;
					released = (async () => {
						await tail;
						clearInterval(timer);
						try {
							await db.exec(`UPDATE ${heads} SET owner = '', pulse = pulse + 1 WHERE run_id = ? AND owner = ? AND generation = ?`, [
								runId,
								owner,
								generation
							]);
						} finally {
							controller.abort(new SqlRunOwnershipError(`SQL run '${runId}' lease is released`));
						}
					})();
					return released;
				}
			};
			try {
				history = await load(observed);
				signal?.throwIfAborted();
				controller.signal.throwIfAborted();
				return lease;
			} catch (error) {
				await lease.release().catch(() => void 0);
				throw error;
			}
		}
	};
}
function recordId(parent, revision, payload) {
	return createHash("sha256").update(`${revision}\0${parent}\0${payload}`).digest("hex");
}
function wait(ms, signal) {
	return new Promise((resolve, reject) => {
		const cleanup = () => signal?.removeEventListener("abort", abort);
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			cleanup();
			reject(signal?.reason);
		};
		if (signal?.aborted) abort();
		else signal?.addEventListener("abort", abort, { once: true });
	});
}
//#endregion
//#region src/runtime/audit-intent.ts
/** Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories. */
const defaultAuditorInstruction = "You audit whether an AI agent is on the RIGHT ROUTE — not whether it works hard, but whether its actions serve the stated intents. Infer the REVEALED intent from the action pattern (what the trajectory is actually optimizing). Compare against the declared task intent, the user intent when given, and the meta-intent when given. Flawless execution down the wrong route is DIVERGED. Busy-work that neither advances nor harms is DRIFTING. Judge only from the trajectory — be specific about which actions ground your verdict. Recommend abort only when continuing cannot serve the intent.";
function summarize(trace, maxLines) {
	const lines = [];
	for (const ev of trace) {
		const e = ev;
		const role = e.role;
		if (role === "tool") lines.push(`RESULT ${String(e.content).slice(0, 200)}`);
		else if (role === "assistant") {
			const calls = e.tool_calls?.map((c) => `${c.function?.name}(${(c.function?.arguments ?? "").slice(0, 120)})`).join(", ");
			lines.push(calls ? `CALL ${calls}` : `SAY ${String(e.content).slice(0, 160)}`);
		} else if (role === "user") lines.push(`USER ${String(e.content).slice(0, 160)}`);
	}
	return lines.slice(-maxLines).join("\n");
}
const auditSchema = {
	name: "intent_audit",
	schema: {
		type: "object",
		additionalProperties: false,
		required: [
			"revealedIntent",
			"verdict",
			"evidence",
			"recommendation",
			"confidence"
		],
		properties: {
			revealedIntent: { type: "string" },
			verdict: {
				type: "string",
				enum: [
					"aligned",
					"drifting",
					"diverged"
				]
			},
			evidence: { type: "string" },
			recommendation: {
				type: "string",
				enum: [
					"continue",
					"steer",
					"abort"
				]
			},
			steer: { type: "string" },
			confidence: { type: "number" }
		}
	}
};
/** The route-rigor analyst: compare declared vs revealed vs user intent over a trajectory and return aligned / drifting / diverged with evidence and one recommended intervention. */
async function auditIntent(input, opts) {
	const res = await profileChatClient({
		profile: opts.profile,
		executor: opts.executor,
		context: "intent auditor"
	}).chat({
		jsonSchema: auditSchema,
		messages: [{
			role: "user",
			content: `DECLARED INTENT (the task):\n${input.declaredIntent}\n\n` + (input.userIntent ? `USER INTENT (the principal's actual goal):\n${input.userIntent}\n\n` : "") + (input.metaIntent ? `META-INTENT (what the whole run is for):\n${input.metaIntent}\n\n` : "") + `TRAJECTORY (in order):\n${summarize(input.trace, opts.maxTraceLines ?? 80)}\n\nAudit the route: revealed intent, verdict, evidence, one recommendation.`
		}]
	}, { ...opts.signal ? { signal: opts.signal } : {} });
	let parsed;
	try {
		parsed = JSON.parse(res.content);
	} catch {
		throw new Error(`auditIntent: auditor returned non-JSON: ${res.content.slice(0, 200)}`);
	}
	if (!parsed.verdict || !parsed.recommendation) throw new Error(`auditIntent: missing verdict/recommendation: ${res.content.slice(0, 200)}`);
	return {
		revealedIntent: parsed.revealedIntent ?? "",
		verdict: parsed.verdict,
		evidence: parsed.evidence ?? "",
		recommendation: parsed.recommendation,
		...parsed.steer ? { steer: parsed.steer } : {},
		confidence: typeof parsed.confidence === "number" ? parsed.confidence : .5
	};
}
//#endregion
//#region src/runtime/benchmark-report.ts
/**
* benchmark-report — turn a fleet of `RunRecord`s into a publishable, multi-axis benchmark report:
* a ranked leaderboard, the full profile×axis score matrix, the cost/latency/token columns, and
* embeddable charts (SVG) + a self-contained HTML page. Domain-agnostic by construction — it reads ONLY
* the universal `RunRecord` currency (model, scenario, score, cost, tokens, latency, the `outcome.raw`
* metric bag), so the SAME engine reports any benchmark in any domain: coding, search, agents, multimodal.
*
* This is the surface a hosted leaderboard (à la vals.ai) renders: for every harness×model profile, its
* score on every axis, not a curated subset. It pairs with `runProfileMatrix` (whose `result.records`
* feed straight in) but takes the records directly, so it is independent of how they were produced.
*
* An AXIS is any way to slice the score into columns — by default one column per scenario group
* (`groupOf`, default = the scenario id), so the matrix is profile × scenario. Pass `axisScoresOf` to
* score along judge dimensions or any custom decomposition instead. The reporter never invents a number:
* a missing cell renders blank, never zero.
*/
const defaultScoreOf = (r) => {
	const o = r.outcome;
	if (typeof o.holdoutScore === "number") return o.holdoutScore;
	if (typeof o.searchScore === "number") return o.searchScore;
	const raw = o.raw ?? {};
	for (const k of [
		"composite",
		"score",
		"passed",
		"resolved"
	]) if (typeof raw[k] === "number") return raw[k];
};
const defaultProfileKeyOf = (r) => {
	const harness = r.agentProfile?.harness?.id;
	const model = r.agentProfile?.model ?? r.model;
	return harness ? `${harness}·${model}` : model;
};
const defaultGroupOf = (r) => r.scenarioId ?? r.experimentId;
function quantile(sorted, q) {
	if (sorted.length === 0) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
}
function mean(xs) {
	return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
/** Collapse reps to ONE mean score per scenario — the honest unit for a CI or a paired test. Reps
*  tighten the per-(profile, scenario) estimate but are NOT independent samples, so feeding raw reps into
*  a CI lets identical reps fake a narrower interval. Fails LOUD on a record missing `scenarioId`: an
*  empty-string fallback would silently merge distinct scenarios into one bucket. */
function meanByScenario(records, scoreOf) {
	const sums = /* @__PURE__ */ new Map();
	for (const r of records) {
		const s = scoreOf(r);
		if (typeof s !== "number") continue;
		const id = r.scenarioId;
		if (!id) throw new Error(`benchmark-report: RunRecord (candidate ${r.candidateId ?? "unknown"}) is missing scenarioId — cannot pair or interval it honestly. Pass opts.stats only on a scenario-tagged corpus.`);
		const acc = sums.get(id) ?? {
			total: 0,
			n: 0
		};
		acc.total += s;
		acc.n += 1;
		sums.set(id, acc);
	}
	const out = /* @__PURE__ */ new Map();
	for (const [id, acc] of sums) out.set(id, acc.n ? acc.total / acc.n : 0);
	return out;
}
/** Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. */
function leaderboard(records, opts = {}) {
	const scoreOf = opts.scoreOf ?? defaultScoreOf;
	const profileKeyOf = opts.profileKeyOf ?? defaultProfileKeyOf;
	const groupOf = opts.groupOf ?? defaultGroupOf;
	const labelOf = opts.labelOf ?? ((k) => k);
	const axisSet = /* @__PURE__ */ new Set();
	if (opts.axisScoresOf) for (const r of records) for (const k of Object.keys(opts.axisScoresOf(r))) axisSet.add(k);
	else for (const r of records) axisSet.add(groupOf(r));
	const axes = [...axisSet].sort();
	const byProfile = /* @__PURE__ */ new Map();
	for (const r of records) {
		const key = profileKeyOf(r);
		const bucket = byProfile.get(key);
		if (bucket) bucket.push(r);
		else byProfile.set(key, [r]);
	}
	const rows = [];
	for (const [profileKey, recs] of byProfile) {
		const scores = recs.map(scoreOf).filter((s) => typeof s === "number");
		const axisBuckets = /* @__PURE__ */ new Map();
		for (const r of recs) if (opts.axisScoresOf) for (const [axis, s] of Object.entries(opts.axisScoresOf(r))) {
			const b = axisBuckets.get(axis) ?? [];
			b.push(s);
			axisBuckets.set(axis, b);
		}
		else {
			const s = scoreOf(r);
			if (typeof s === "number") {
				const axis = groupOf(r);
				const b = axisBuckets.get(axis) ?? [];
				b.push(s);
				axisBuckets.set(axis, b);
			}
		}
		const perAxis = {};
		for (const [axis, b] of axisBuckets) perAxis[axis] = mean(b);
		const latencies = recs.map((r) => r.wallMs).sort((a, b) => a - b);
		const pass = opts.passThreshold ?? .999;
		let scoreCi;
		let passCi;
		if (opts.stats) {
			const collapsed = [...meanByScenario(recs, scoreOf).values()];
			if (collapsed.length > 0) {
				const ci = confidenceInterval(collapsed, .95, { seed: 7 });
				scoreCi = {
					lower: ci.lower,
					upper: ci.upper
				};
				const w = wilson(collapsed.filter((s) => s >= pass).length, collapsed.length, .95);
				passCi = {
					lower: w.lower,
					upper: w.upper
				};
			}
		}
		const cost = summarizeCost(recs);
		rows.push({
			profileKey,
			label: labelOf(profileKey),
			model: recs[0]?.model ?? profileKey,
			n: recs.length,
			meanScore: mean(scores),
			solveRate: scores.length === 0 ? 0 : scores.filter((s) => s >= pass).length / scores.length,
			perAxis,
			costUsd: cost.uncapturedRecords === 0 ? cost.capturedUsd : null,
			capturedCostUsd: cost.capturedUsd,
			uncapturedCostRuns: cost.uncapturedRecords,
			tokensIn: recs.reduce((a, r) => a + (r.tokenUsage?.input ?? 0), 0),
			tokensOut: recs.reduce((a, r) => a + (r.tokenUsage?.output ?? 0), 0),
			latencyP50Ms: quantile(latencies, .5),
			latencyP90Ms: quantile(latencies, .9),
			...scoreCi ? { scoreCi } : {},
			...passCi ? { passCi } : {}
		});
	}
	rows.sort((a, b) => b.meanScore - a.meanScore || compareCompleteCost(a.costUsd, b.costUsd) || a.label.localeCompare(b.label));
	const models = [...new Set(records.map((r) => r.model))].sort();
	const totalCost = summarizeCost(records);
	return {
		title: opts.title ?? "Benchmark report",
		axes,
		profiles: rows,
		meta: opts.meta ?? {},
		provenance: {
			records: records.length,
			profiles: rows.length,
			axes: axes.length,
			models,
			totalCostUsd: totalCost.uncapturedRecords === 0 ? totalCost.capturedUsd : null,
			capturedCostUsd: totalCost.capturedUsd,
			uncapturedCostRecords: totalCost.uncapturedRecords
		}
	};
}
function summarizeCost(records) {
	return records.reduce((summary, record) => {
		if (record.costUsd === null) summary.uncapturedRecords += 1;
		else summary.capturedUsd += record.costUsd;
		return summary;
	}, {
		capturedUsd: 0,
		uncapturedRecords: 0
	});
}
function compareCompleteCost(left, right) {
	if (left === null) return right === null ? 0 : 1;
	if (right === null) return -1;
	return left - right;
}
/** Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real
*  paired-test p-value, BH-corrected across all pairs. This is the honest "did A beat B" table the
*  leaderboard's point ranking cannot answer. Reuses the agent-eval statistics substrate. */
function pairwiseSignificance(records, opts = {}) {
	const scoreOf = opts.scoreOf ?? defaultScoreOf;
	const profileKeyOf = opts.profileKeyOf ?? defaultProfileKeyOf;
	const labelOf = opts.labelOf ?? ((k) => k);
	const minPairs = opts.minPairs ?? 12;
	const byProfile = /* @__PURE__ */ new Map();
	for (const r of records) {
		const k = profileKeyOf(r);
		const b = byProfile.get(k);
		if (b) b.push(r);
		else byProfile.set(k, [r]);
	}
	const keys = [...byProfile.keys()].sort();
	const collapsed = new Map(keys.map((k) => [k, meanByScenario(byProfile.get(k) ?? [], scoreOf)]));
	const raw = [];
	for (let i = 0; i < keys.length; i += 1) for (let j = i + 1; j < keys.length; j += 1) {
		const ka = keys[i];
		const kb = keys[j];
		const am = collapsed.get(ka);
		const bm = collapsed.get(kb);
		const aScores = [];
		const bScores = [];
		for (const sid of [...am.keys()].sort()) {
			const bv = bm.get(sid);
			if (bv !== void 0) {
				aScores.push(am.get(sid));
				bScores.push(bv);
			}
		}
		if (aScores.length === 0) continue;
		const boot = pairedBootstrap(aScores, bScores, {
			seed: 7,
			statistic: "median"
		});
		const test = wilcoxonSignedRank(aScores, bScores, { seed: 7 });
		raw.push({
			a: labelOf(ka),
			b: labelOf(kb),
			pairs: aScores.length,
			delta: boot.median,
			ciLow: boot.low,
			ciHigh: boot.high,
			nonZeroPairs: test.nNonZero,
			testMethod: test.method,
			pFloor: test.pFloor,
			p: test.p
		});
	}
	const { qValues, significant } = benjaminiHochberg(raw.map((result) => result.p), opts.fdr ?? .05);
	return raw.map((r, i) => ({
		...r,
		q: qValues[i] ?? 1,
		significant: (significant[i] ?? false) && r.pairs >= minPairs
	}));
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const ci = (iv) => iv ? ` [${pct(iv.lower)}, ${pct(iv.upper)}]` : "";
const cost = (totalUsd, capturedUsd, uncapturedRecords, digits) => totalUsd === null ? `at least $${capturedUsd.toFixed(digits)} (${uncapturedRecords} uncaptured)` : `$${totalUsd.toFixed(digits)}`;
/** Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis
*  matrix → cost/latency/token columns. Every axis is shown — a curated subset is a reporting failure. */
function renderLeaderboardMarkdown(report) {
	const lines = [];
	lines.push(`# ${report.title}`, "");
	const p = report.provenance;
	lines.push(`**${p.profiles} profiles × ${p.axes} axes**, ${p.records} runs, ${p.models.length} models · total ${cost(p.totalCostUsd, p.capturedCostUsd, p.uncapturedCostRecords, 2)}`, "");
	for (const [k, v] of Object.entries(report.meta)) lines.push(`- **${k}:** ${v}`);
	if (Object.keys(report.meta).length) lines.push("");
	lines.push("## Leaderboard", "");
	lines.push("| # | Profile | Score (95% CI) | Solved (95% CI) | Runs | Cost | Tok in/out | p50 | p90 |");
	lines.push("|---|---|--:|--:|--:|--:|--:|--:|--:|");
	report.profiles.forEach((r, i) => {
		lines.push(`| ${i + 1} | ${r.label} | ${pct(r.meanScore)}${ci(r.scoreCi)} | ${pct(r.solveRate)}${ci(r.passCi)} | ${r.n} | ${cost(r.costUsd, r.capturedCostUsd, r.uncapturedCostRuns, 3)} | ${r.tokensIn}/${r.tokensOut} | ${(r.latencyP50Ms / 1e3).toFixed(1)}s | ${(r.latencyP90Ms / 1e3).toFixed(1)}s |`);
	});
	lines.push("");
	lines.push("## Score matrix — profile × axis", "");
	lines.push(`| Profile | ${report.axes.join(" | ")} |`);
	lines.push(`|---|${report.axes.map(() => "--:").join("|")}|`);
	for (const r of report.profiles) {
		const cells = report.axes.map((a) => {
			const v = r.perAxis[a];
			return v === void 0 ? "·" : pct(v);
		});
		lines.push(`| ${r.label} | ${cells.join(" | ")} |`);
	}
	lines.push("");
	lines.push("> `·` = the profile never ran that axis (blank, never zero).");
	return lines.join("\n");
}
/** Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected
*  verdict. Feed it `pairwiseSignificance(records)`. This is the "did A really beat B" evidence the point
*  ranking cannot give. */
function renderPairwiseMarkdown(verdicts, title = "Pairwise significance (paired, BH-corrected)") {
	const lines = [`## ${title}`, ""];
	if (verdicts.length === 0) return lines.concat("_no comparable pairs_").join("\n");
	lines.push("| A vs B | Δ(b−a) median | 95% CI | pairs | changed | test | p | p floor | q | verdict |");
	lines.push("|---|--:|--:|--:|--:|---|--:|--:|--:|---|");
	for (const v of verdicts) {
		const verdict = v.nonZeroPairs === 0 ? "tie" : v.significant ? `**${v.delta >= 0 ? v.b : v.a} wins**` : "ns";
		lines.push(`| ${v.a} vs ${v.b} | ${v.delta >= 0 ? "+" : ""}${pct(v.delta)} | [${pct(v.ciLow)}, ${pct(v.ciHigh)}] | ${v.pairs} | ${v.nonZeroPairs} | ${v.testMethod} | ${formatProbability(v.p)} | ${formatProbability(v.pFloor)} | ${formatProbability(v.q)} | ${verdict} |`);
	}
	lines.push("", "> `changed` excludes exact ties. `p` is the raw two-sided signed-rank probability; `q` is Benjamini-Hochberg adjusted. `ns` means q did not clear the target or the pair count was below the configured minimum.");
	return lines.join("\n");
}
function formatProbability(value) {
	return value > 0 && value < .001 ? value.toExponential(2) : value.toFixed(3);
}
function esc(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function ramp(score) {
	const x = Math.max(0, Math.min(1, score));
	return `rgb(${Math.round(x < .5 ? 220 : 220 - (x - .5) * 2 * 160)},${Math.round(x < .5 ? x * 2 * 170 : 170)},60)`;
}
/** Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps,
*  embeddable anywhere (README, HTML page, hosted leaderboard). */
function renderLeaderboardSvg(report) {
	const rowH = 26;
	const labelW = 220;
	const cellW = 54;
	const pad = 16;
	const barAreaW = 360;
	const profiles = report.profiles;
	const heatTop = profiles.length * rowH + pad + 48;
	const heatW = labelW + report.axes.length * cellW + pad;
	const heatH = profiles.length * rowH + pad;
	const width = Math.max(612, heatW);
	const height = heatTop + heatH + pad;
	const out = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12">`);
	out.push(`<rect width="${width}" height="${height}" fill="white"/>`);
	out.push(`<text x="${pad}" y="20" font-weight="700" font-size="14">${esc(report.title)} — score</text>`);
	profiles.forEach((r, i) => {
		const y = 28 + i * rowH;
		out.push(`<text x="${pad}" y="${y + 14}">${esc(r.label)}</text>`);
		const w = Math.round(r.meanScore * barAreaW);
		out.push(`<rect x="${labelW}" y="${y + 4}" width="${barAreaW}" height="16" fill="#eef0f2"/>`);
		out.push(`<rect x="${labelW}" y="${y + 4}" width="${w}" height="16" fill="${ramp(r.meanScore)}"/>`);
		out.push(`<text x="586" y="${y + 16}">${pct(r.meanScore)}</text>`);
	});
	out.push(`<text x="${pad}" y="${heatTop - 12}" font-weight="700" font-size="14">profile × axis</text>`);
	report.axes.forEach((a, c) => {
		const x = labelW + c * cellW;
		out.push(`<text x="${x + cellW / 2}" y="${heatTop}" text-anchor="middle" fill="#555">${esc(a.length > 8 ? `${a.slice(0, 7)}…` : a)}</text>`);
	});
	profiles.forEach((r, i) => {
		const y = heatTop + 8 + i * rowH;
		out.push(`<text x="${pad}" y="${y + 16}">${esc(r.label)}</text>`);
		report.axes.forEach((a, c) => {
			const x = labelW + c * cellW;
			const s = r.perAxis[a];
			if (s !== void 0) {
				out.push(`<rect x="${x}" y="${y}" width="${cellW - 3}" height="${rowH - 4}" fill="${ramp(s)}"/>`);
				out.push(`<text x="${x + (cellW - 3) / 2}" y="${y + 15}" text-anchor="middle" fill="white" font-size="10">${Math.round(100 * s)}</text>`);
			} else out.push(`<rect x="${x}" y="${y}" width="${cellW - 3}" height="${rowH - 4}" fill="#f3f4f6"/>`);
		});
	});
	out.push("</svg>");
	return out.join("\n");
}
/** Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown
*  matrix as a table. Single file, no assets, opens in any browser. */
function renderLeaderboardHtml(report) {
	const svg = renderLeaderboardSvg(report);
	const p = report.provenance;
	const rows = report.profiles.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td class="n">${pct(r.meanScore)}</td><td class="n">${pct(r.solveRate)}</td><td class="n">${r.n}</td><td class="n">${cost(r.costUsd, r.capturedCostUsd, r.uncapturedCostRuns, 3)}</td>${report.axes.map((a) => {
		const v = r.perAxis[a];
		return `<td class="n">${v === void 0 ? "·" : pct(v)}</td>`;
	}).join("")}</tr>`).join("\n");
	const axisHead = report.axes.map((a) => `<th>${esc(a)}</th>`).join("");
	return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
body{font:14px ui-sans-serif,system-ui,sans-serif;margin:2rem;color:#111}
h1{font-size:1.4rem}.sub{color:#555;margin:.2rem 0 1.2rem}
table{border-collapse:collapse;margin-top:1rem}td,th{border:1px solid #e5e7eb;padding:.35rem .6rem}
th{background:#f9fafb;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
tr:first-child td{font-weight:600}
</style></head><body>
<h1>${esc(report.title)}</h1>
<div class="sub">${p.profiles} profiles × ${p.axes} axes · ${p.records} runs · ${p.models.length} models · total ${cost(p.totalCostUsd, p.capturedCostUsd, p.uncapturedCostRecords, 2)}</div>
${svg}
<table><thead><tr><th>#</th><th>Profile</th><th>Score</th><th>Solved</th><th>Runs</th><th>Cost</th>${axisHead}</tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`;
}
//#endregion
//#region src/runtime/completion.ts
/** Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`. */
function completionAuthorizes(v, policy) {
	if (!v?.done) return false;
	if (v.determinism === "deterministic") return true;
	return (v.confidence ?? 0) >= (policy?.minConfidence ?? .8);
}
/**
* A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the
* seed (no Math.random — reproducible + attributable to the node); the agent is instructed to
* emit it VERBATIM when it judges itself done. Unguessable enough that content never trips it.
*/
function stopSentinel(seed) {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i += 1) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `<<<{{STOP:${(h >>> 0).toString(16).padStart(8, "0")}}}>>>`;
}
/**
* Completion for a sandbox-agent node: done iff the latest output carries the node's stop
* sentinel. PROBABILISTIC (the agent's own self-judgment) — the driver validates it.
*/
function sentinelCompletion(sentinel, opts) {
	return { assess({ history }) {
		const last = history[history.length - 1];
		const done = (typeof last?.output === "string" ? last.output : "").includes(sentinel);
		return {
			done,
			determinism: "probabilistic",
			confidence: done ? opts?.confidence ?? .9 : 0,
			reasons: done ? "agent emitted its assigned stop sentinel" : void 0,
			evidence: done && last ? [{
				kind: "artifact",
				uri: `attempt:${last.index}`
			}] : []
		};
	} };
}
/**
* Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check
* passes. Ground truth — the driver ends directly, no validation. The check reads the output
* (a verifier), never the judge verdict — selector ≠ judge stays intact.
*/
function deterministicCompletion(check) {
	return { assess({ history }) {
		const last = history[history.length - 1];
		if (last?.output === void 0) return {
			done: false,
			determinism: "deterministic",
			reasons: "no output yet"
		};
		const r = check(last.output, history);
		return {
			done: r.passed,
			determinism: "deterministic",
			reasons: r.reasons,
			evidence: [{
				kind: "artifact",
				uri: `attempt:${last.index}`
			}]
		};
	} };
}
//#endregion
//#region src/runtime/isolated-checker.ts
const toolchains = [
	"/usr",
	"/bin",
	"/lib",
	"/lib64"
];
const contains = (parent, child) => {
	const path = relative(parent, child);
	return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};
/**
* Run an untrusted check in Linux Bubblewrap, or in its own Sandbox box when `box` is set.
* Never falls back to host execution.
*
* Bubblewrap requires /usr/bin/bwrap and permission to create Linux namespaces.
* Only trusted system toolchains, private proc/dev/tmp, and the writable copy are mounted.
* The canonical input path remains the working directory; copy writes are discarded.
* Limits bound command time and captured output, not copy size or memory consumption.
* Callers must keep the input and trusted toolchains stable while preparing the check.
*
* A box check creates one fresh box with no owner secrets and blocked egress (or strict egress to
* the placement's named domains), delivers the tree's regular files verified by sha256, runs the
* command there with only the environment `env` names, and deletes the box.
*/
async function runIsolatedCheck(options) {
	if (options.box) return runInBox(options, options.box);
	let scratch;
	let result;
	try {
		if (process.platform !== "linux") throw new Error("Linux Bubblewrap namespaces are required");
		const { timeoutMs, maxOutputBytes } = checkLimits(options);
		if (options.signal?.aborted) return {
			succeeded: false,
			reason: "cancelled",
			diagnostic: "Check cancelled"
		};
		const { workspace, tree } = await protectedTree(options);
		const binds = [];
		for (const path of toolchains) {
			let actual;
			try {
				actual = await realpath(path);
			} catch (error) {
				if (error.code === "ENOENT") continue;
				throw error;
			}
			for (const mount of [path, actual]) if (contains(mount, workspace) || contains(workspace, mount) || contains(mount, tree) || contains(tree, mount)) throw new Error(`Toolchain overlaps protected workspace: ${path}`);
			binds.push("--ro-bind", actual, path);
		}
		if (["/proc", "/dev"].some((path) => contains(path, tree) || contains(tree, path))) throw new Error("Tree overlaps a reserved namespace mount");
		scratch = await mkdtemp(join(tmpdir(), "runtime-check-"));
		if (contains(tree, scratch)) throw new Error("Temporary storage must be outside the input tree");
		const copy = join(scratch, "tree");
		await cp(tree, copy, {
			recursive: true,
			dereference: false,
			verbatimSymlinks: true
		});
		result = await execute([
			"--unshare-all",
			"--die-with-parent",
			"--new-session",
			"--cap-drop",
			"ALL",
			"--clearenv",
			"--setenv",
			"PATH",
			"/usr/bin:/bin",
			"--setenv",
			"HOME",
			"/tmp",
			"--setenv",
			"LANG",
			"C",
			...Object.entries(options.env ?? {}).flatMap(([name, value]) => [
				"--setenv",
				name,
				value
			]),
			...binds,
			"--proc",
			"/proc",
			"--dev",
			"/dev",
			"--tmpfs",
			"/tmp",
			"--bind",
			copy,
			tree,
			"--chdir",
			tree,
			"--",
			...options.command
		], timeoutMs, maxOutputBytes, options.signal);
	} catch (error) {
		result = {
			succeeded: false,
			reason: "refused",
			diagnostic: String(error)
		};
	}
	if (scratch) try {
		await removeScratch(scratch);
	} catch (error) {
		const cleanupDiagnostic = String(error);
		result = result.succeeded ? {
			succeeded: false,
			reason: "cleanup-failed",
			diagnostic: cleanupDiagnostic,
			stdout: result.value.stdout,
			stderr: result.value.stderr,
			exitCode: 0
		} : {
			...result,
			cleanupDiagnostic
		};
	}
	return result;
}
function checkLimits(options) {
	const timeoutMs = options.timeoutMs ?? 3e4;
	const maxOutputBytes = options.maxOutputBytes ?? 1048576;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error("Invalid execution limits");
	if (!options.command.length || !options.command[0]) throw new Error("A command is required");
	return {
		timeoutMs,
		maxOutputBytes
	};
}
async function protectedTree(options) {
	const workspace = await realpath(options.workspaceRoot);
	const tree = await realpath(options.tree);
	if (!contains(workspace, tree) || !(await stat(tree)).isDirectory()) throw new Error("Tree must be a directory inside the workspace");
	return {
		workspace,
		tree
	};
}
/** Box-workspace-relative directory that receives the tree and is the command's cwd. */
const BOX_TREE = "tree";
/** Bound on provisioning, delivery, and deletion; the box expires even if this process dies. */
const BOX_SETUP_SECONDS = 900;
/** The box's own process timeout is a backstop behind this module's deadline. */
const BOX_PROCESS_BACKSTOP_MS = 3e4;
/** Concurrent file deliveries into one check box. */
const BOX_UPLOADS = 4;
/** The box's process supervisor prefixes this to stderr when it cannot start the executable. */
const BOX_EXEC_FAILURE = "process-supervisor: exec failed";
async function runInBox(options, placement) {
	let box;
	let evidence;
	let result;
	try {
		const { timeoutMs, maxOutputBytes } = checkLimits(options);
		if (options.signal?.aborted) return {
			succeeded: false,
			reason: "cancelled",
			diagnostic: "Check cancelled"
		};
		const { tree } = await protectedTree(options);
		const captured = await captureMaterializedWorkspace(tree);
		if (placement.builderAccounts.length === 0 || placement.builderAccounts.some((id) => !id)) throw new Error("builderAccounts must name the account of every key the judged run holds");
		const account = (await placement.client.getIdentity()).customerId;
		if (!account) throw new Error("Sandbox returned no account for the check key");
		if (placement.builderAccounts.includes(account)) throw new Error(`Check account ${account} is an account the judged run holds a key to, so the run can reach the check box`);
		options.signal?.throwIfAborted();
		box = await placement.client.createIsolated({
			environment: placement.environment,
			agent: placement.containers === true,
			bare: false,
			ephemeral: placement.containers !== true,
			egressPolicy: egressFor(placement),
			...placement.resources ? { resources: placement.resources } : {},
			maxLifetimeSeconds: Math.ceil(timeoutMs / 1e3) + BOX_SETUP_SECONDS,
			idempotencyKey: `agent-runtime-check-${randomUUID()}`
		}, options.signal ? { signal: options.signal } : void 0);
		const receipt = box.createReceipt();
		if (receipt?.outcome !== "created" || receipt.ownerContext !== "isolated" || !Array.isArray(receipt.injectedSecrets) || receipt.injectedSecrets.length !== 0) throw new Error("Sandbox did not confirm a fresh box with no owner secrets");
		const egress = (await box.egress.get()).policy;
		const wanted = egressFor(placement);
		if (egress.mode !== wanted.mode || wanted.mode === "strict" && (egress.includeImplicitDomains === true || [...egress.allowDomains ?? []].sort().join(",") !== [...wanted.allowDomains ?? []].sort().join(","))) throw new Error(`Check box egress is ${egress.mode} ${JSON.stringify(egress.allowDomains ?? [])}, not ${wanted.mode} ${JSON.stringify(wanted.allowDomains ?? [])}`);
		await box.fs.mkdir(BOX_TREE, { recursive: true });
		const digests = new Map(captured.manifest.files.map((entry) => [entry.path, entry.sha256]));
		const target = box;
		const pending = [...captured.files];
		const deliver = async () => {
			try {
				for (let file = pending.shift(); file; file = pending.shift()) {
					options.signal?.throwIfAborted();
					const received = await target.fs.uploadData(`${BOX_TREE}/${file.path}`, file.bytes, { mode: file.mode });
					if (`sha256:${received.hash.replace(/^sha256:/, "").toLowerCase()}` !== digests.get(file.path) || received.size !== file.bytes.byteLength) throw new Error(`Check box received different bytes for ${file.path}`);
				}
			} catch (error) {
				pending.length = 0;
				throw error;
			}
		};
		await Promise.all(Array.from({ length: BOX_UPLOADS }, deliver));
		evidence = {
			sandboxId: box.id,
			account,
			input: captured.manifest,
			inputDigest: canonicalCandidateDigest(captured.manifest)
		};
		result = await executeInBox(box, options.command, timeoutMs, maxOutputBytes, options.env ?? {}, options.signal);
	} catch (error) {
		result = {
			succeeded: false,
			reason: options.signal?.aborted ? "cancelled" : "refused",
			diagnostic: String(error)
		};
	}
	if (box) try {
		await box.delete();
	} catch (error) {
		const cleanupDiagnostic = `Check box ${box.id} was not deleted: ${String(error)}`;
		result = result.succeeded ? {
			succeeded: false,
			reason: "cleanup-failed",
			diagnostic: cleanupDiagnostic,
			stdout: result.value.stdout,
			stderr: result.value.stderr,
			exitCode: 0
		} : {
			...result,
			cleanupDiagnostic
		};
	}
	return evidence ? {
		...result,
		box: evidence
	} : result;
}
/** Blocked unless the placement names domains; then strict, with no implicit domain list. */
function egressFor(placement) {
	const domains = [...new Set(placement.egress ?? [])].filter((domain) => domain.trim() !== "");
	return domains.length === 0 ? { mode: "blocked" } : {
		mode: "strict",
		allowDomains: domains,
		includeImplicitDomains: false
	};
}
async function executeInBox(box, command, timeoutMs, limit, env, signal) {
	const [executable, ...args] = command;
	const child = await box.process.spawnExact(executable, args, {
		cwd: BOX_TREE,
		env: {
			PATH: "/usr/bin:/bin",
			HOME: "/tmp",
			LANG: "C",
			...env
		},
		inheritEnv: false,
		timeoutMs: timeoutMs + BOX_PROCESS_BACKSTOP_MS
	});
	const stdout = [];
	const stderr = [];
	let bytes = 0;
	let failure;
	let stopping;
	const stop = (reason) => {
		failure ??= reason;
		stopping ??= child.kill("SIGKILL", { tree: true }).catch(() => void 0);
	};
	const clearTimer = armDeadlineTimer(timeoutMs, () => stop("timeout"), true);
	const cancel = () => stop("cancelled");
	signal?.addEventListener("abort", cancel, { once: true });
	if (signal?.aborted) cancel();
	const capture = async (stream, target) => {
		for await (const text of stream) {
			const chunk = Buffer.from(text);
			const remaining = Math.max(0, limit - bytes);
			bytes += chunk.length;
			if (remaining) target.push(chunk.subarray(0, remaining));
			if (bytes > limit) stop("output-limit");
		}
	};
	let exitCode;
	let exitSignal;
	try {
		await Promise.all([capture(child.stdout(), stdout), capture(child.stderr(), stderr)]);
		exitCode = await child.wait();
		exitSignal = (await child.status()).exitSignal;
	} finally {
		clearTimer();
		signal?.removeEventListener("abort", cancel);
		await stopping;
	}
	const out = Buffer.concat(stdout).toString();
	const err = Buffer.concat(stderr).toString();
	const evidence = {
		stdout: out,
		stderr: err,
		exitCode: exitSignal ? null : exitCode
	};
	if (failure) return {
		succeeded: false,
		reason: failure,
		diagnostic: err || failure,
		...evidence
	};
	if (exitCode === 127 && err.startsWith(BOX_EXEC_FAILURE)) return {
		succeeded: false,
		reason: "refused",
		diagnostic: err,
		...evidence
	};
	if (exitSignal) return {
		succeeded: false,
		reason: "failed",
		diagnostic: err || `Check killed by ${exitSignal}`,
		...evidence
	};
	if (exitCode !== 0) return {
		succeeded: false,
		reason: "failed",
		diagnostic: err || out || `Check exited ${exitCode}`,
		...evidence
	};
	return {
		succeeded: true,
		value: {
			stdout: out,
			stderr: err
		}
	};
}
function execute(args, timeoutMs, limit, signal) {
	return new Promise((done) => {
		const child = spawn("/usr/bin/bwrap", [
			"--json-status-fd",
			"3",
			...args
		], {
			env: {},
			stdio: [
				"ignore",
				"pipe",
				"pipe",
				"pipe"
			],
			detached: true
		});
		const stdout = [];
		const stderr = [];
		let bytes = 0;
		let status = "";
		let failure;
		const stop = (reason) => {
			failure ??= reason;
			if (child.pid) try {
				process.kill(-child.pid, "SIGKILL");
			} catch (error) {
				if (error.code !== "ESRCH") child.kill("SIGKILL");
			}
		};
		const clearTimer = armDeadlineTimer(timeoutMs, () => stop("timeout"), true);
		const cancel = () => stop("cancelled");
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
		const capture = (target) => (chunk) => {
			const remaining = Math.max(0, limit - bytes);
			bytes += chunk.length;
			if (remaining) target.push(chunk.subarray(0, remaining));
			if (bytes > limit) stop("output-limit");
		};
		child.stdio[3]?.on("data", (chunk) => {
			if (status.length + chunk.length > 16384) {
				stop("output-limit");
				return;
			}
			status += chunk.toString();
		});
		child.stdout.on("data", capture(stdout));
		child.stderr.on("data", capture(stderr));
		let spawnError;
		child.on("error", (error) => {
			spawnError = error;
		});
		child.on("close", (code) => {
			clearTimer();
			signal?.removeEventListener("abort", cancel);
			const out = Buffer.concat(stdout).toString();
			const err = Buffer.concat(stderr).toString();
			const evidence = {
				stdout: out,
				stderr: err,
				exitCode: code
			};
			const executed = status.split("\n").some((line) => {
				try {
					const record = JSON.parse(line);
					return record !== null && typeof record === "object" && "exit-code" in record && typeof record["exit-code"] === "number" && record["exit-code"] === code;
				} catch {
					return false;
				}
			});
			if (failure) done({
				succeeded: false,
				reason: failure,
				diagnostic: err || failure,
				...evidence
			});
			else if (spawnError) done({
				succeeded: false,
				reason: "refused",
				diagnostic: String(spawnError),
				...evidence
			});
			else if (!executed) done({
				succeeded: false,
				reason: "refused",
				diagnostic: err || "Bubblewrap did not confirm command execution",
				...evidence
			});
			else if (code !== 0) done({
				succeeded: false,
				reason: "failed",
				diagnostic: err || out || `Check exited ${code}`,
				...evidence
			});
			else done({
				succeeded: true,
				value: {
					stdout: out,
					stderr: err
				}
			});
		});
	});
}
const executeFile = promisify(execFile);
/** GNU tools traverse relative to open directories, including trees deeper than PATH_MAX.
* Recursive chmod ignores encountered symlinks; rm never follows their targets. */
async function removeScratch(path) {
	const options = {
		env: {},
		timeout: 1e4,
		maxBuffer: 16384
	};
	let permissionError;
	try {
		await executeFile("/bin/chmod", [
			"--recursive",
			"--preserve-root",
			"u+rwX",
			"--",
			path
		], options);
	} catch (error) {
		permissionError = error;
	}
	try {
		await executeFile("/bin/rm", [
			"--recursive",
			"--force",
			"--one-file-system",
			"--",
			path
		], options);
	} catch (error) {
		throw new Error([permissionError, error].filter((value) => value !== void 0).map(String).join("; "));
	}
}
//#endregion
//#region src/runtime/declared-check.ts
/**
* A declared check: the one frozen evaluator program that decides "done" for a run, named by
* digest, run by Runtime in a fresh box on the check account.
*
* The same program is read three times (discovery `docs/38-one-loop-and-continuation.md`, section
* 1): inside the run on every `submit_result` and at a turn end with no accepted result, after the
* run to score it, and after each version to rank versions. Before this, each play wrote its own
* check as Lab code in a method bundle — an exact-check judge, a sealed-cases judge, a product
* judge — and the in-run check was a separate, weaker "shape and persistence" test, so 22 directors
* passed their own check and then failed the outside one.
*
* The program prints one agent-eval `JudgeScore` as JSON on its last line of stdout: each checked
* item is a dimension, `composite` is the score, and `notes` holds one `FAIL <item> <where>:
* <reason>` line per failed item. The record states the pass threshold. A program that does not
* run, or prints no score, gives no verdict: it is {@link CheckUnavailableError}, and the loop
* pauses instead of blaming the director.
*
* The box receives the program's files at its working directory, the submitted result at
* `_input/result.json` when there is one, the run's state at `_input/state/` when the host
* captures it, and the sealed cases at `_sealed/` only when the read scores a run or a version.
* `CHECK_SET` is `development` or `sealed`; `CHECK_RESULT` names the result file and
* `CHECK_STATE` the state directory when present. Sealed cases never reach an in-run read, so
* their lines never reach the director.
*
* The state is what a check reads when the work is not in the submitted value. A Terminal-Bench
* task is done when its container holds the right files, and the box that holds that container is
* the run's, which the check box cannot reach. So the host copies the declared paths out before
* each read ({@link DeclaredCheckStateCapture}), and the check reads those bytes.
*/
const INPUT_DIR = "_input";
const STATE_DIR = "state";
const SEALED_DIR = "_sealed";
const DEFAULT_TIMEOUT_MS = 15 * 6e4;
/** Refuse a malformed declaration before any compute. */
function assertDeclaredCheck(check, context) {
	const fail = (message) => {
		throw new ValidationError(`${context}: check ${message}`);
	};
	if (typeof check !== "object" || check === null) fail("must be an object");
	if (typeof check.program?.dir !== "string" || check.program.dir.trim() === "") fail("program.dir must name the evaluator directory");
	if (!/^sha256:[0-9a-f]{64}$/u.test(check.program?.digest ?? "")) fail("program.digest must be a sha256 digest");
	if (!Array.isArray(check.command) || check.command.length === 0 || !check.command[0]) fail("command must name an executable");
	if (typeof check.environment !== "string" || check.environment.trim() === "") fail("environment must name the box image");
	if (typeof check.pass !== "number" || !Number.isFinite(check.pass)) fail("pass must be a finite threshold on the composite");
	if (check.feedback !== "verbatim" && check.feedback !== "pass-only") fail("feedback must be 'verbatim' or 'pass-only'");
	if (check.sealed !== void 0 && !/^sha256:[0-9a-f]{64}$/u.test(check.sealed.digest ?? "")) fail("sealed.digest must be a sha256 digest");
	for (const name of check.secrets ?? []) if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) fail(`secret name ${JSON.stringify(name)} is not an env name`);
	if (check.containers !== void 0 && typeof check.containers !== "boolean") fail("containers must be a boolean");
}
/** The canonical digest of a directory's files: the digest a record names a program by. */
async function checkProgramDigest(dir) {
	return canonicalCandidateDigest((await captureMaterializedWorkspace(dir)).manifest);
}
/** The digest a version judge records: the program, the sealed cases, and how they are run. */
function declaredCheckDigest(check) {
	return sha256Bytes(Buffer.from(JSON.stringify({
		program: check.program.digest,
		sealed: check.sealed?.digest ?? null,
		command: check.command,
		environment: check.environment,
		pass: check.pass,
		...check.containers === true ? { containers: true } : {}
	})));
}
/**
* Read the check once. `result` is the submitted result, absent for a read of the run's state.
* `state` is a local directory of the run's state; the box receives a copy of its files at
* `_input/state/`. `set: 'sealed'` adds the sealed cases. Throws {@link CheckUnavailableError} when
* the program could not run or printed no score.
*/
async function readDeclaredCheck(check, placement, read) {
	if (read.set === "sealed" && check.sealed === void 0) throw new ValidationError("readDeclaredCheck: a sealed read needs check.sealed");
	const environment = placement.env ?? process.env;
	const secrets = {};
	for (const name of check.secrets ?? []) {
		const value = environment[name];
		if (value === void 0 || value === "") throw new CheckUnavailableError(`the check's secret ${name} is not set on this host`);
		secrets[name] = value;
	}
	const workspace = await mkdtemp(join(tmpdir(), "declared-check-"));
	try {
		const tree = join(workspace, "tree");
		await copyVerified(check.program.dir, check.program.digest, tree, "program");
		const entries = await readdir(tree);
		if (entries.includes(INPUT_DIR) || entries.includes(SEALED_DIR)) throw new ValidationError(`readDeclaredCheck: the program may not hold ${INPUT_DIR}/ or ${SEALED_DIR}/; Runtime mounts them`);
		const env = {
			...secrets,
			CHECK_SET: read.set
		};
		if (read.result !== void 0) {
			await mkdir(join(tree, INPUT_DIR), { recursive: true });
			await writeFile(join(tree, INPUT_DIR, "result.json"), `${JSON.stringify(read.result)}\n`);
			env.CHECK_RESULT = `${INPUT_DIR}/result.json`;
		}
		if (read.state !== void 0) {
			await mkdir(join(tree, INPUT_DIR, STATE_DIR), { recursive: true });
			await writeFiles((await captureMaterializedWorkspace(read.state)).files, join(tree, INPUT_DIR, STATE_DIR));
			env.CHECK_STATE = `${INPUT_DIR}/${STATE_DIR}`;
		}
		if (read.set === "sealed" && check.sealed !== void 0) await copyVerified(check.sealed.dir, check.sealed.digest, join(tree, SEALED_DIR), "sealed cases");
		return verdictOf(await runIsolatedCheck({
			workspaceRoot: workspace,
			tree,
			command: check.command,
			timeoutMs: check.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			env,
			...read.signal === void 0 ? {} : { signal: read.signal },
			box: {
				client: placement.client,
				builderAccounts: placement.builderAccounts,
				environment: check.environment,
				...check.egress === void 0 ? {} : { egress: check.egress },
				...check.resources === void 0 ? {} : { resources: check.resources },
				...check.containers === true ? { containers: true } : {}
			}
		}), check.pass);
	} finally {
		await rm(workspace, {
			recursive: true,
			force: true
		});
	}
}
/**
* The declared check as a manager's completion check: every in-run read uses development cases.
* With `state`, each read first captures the run's state and the check reads it beside the
* submitted result, on `submit_result` and at a turn end alike.
*/
function declaredCheckDeliverable(check, placement, options = {}) {
	assertDeclaredCheck(check, "declaredCheckDeliverable");
	const { state } = options;
	if (state !== void 0 && typeof state !== "function") throw new ValidationError("declaredCheckDeliverable: state must be a capture function");
	const read = async (result) => {
		if (state === void 0) return readDeclaredCheck(check, placement, {
			result,
			set: "development"
		});
		const into = await mkdtemp(join(tmpdir(), "declared-check-state-"));
		try {
			try {
				await state(into);
			} catch (error) {
				throw new CheckUnavailableError(`the run's state could not be captured: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
			}
			return await readDeclaredCheck(check, placement, {
				result,
				state: into,
				set: "development"
			});
		} finally {
			await rm(into, {
				recursive: true,
				force: true
			});
		}
	};
	return {
		check: (result) => read(result),
		checkState: () => read(),
		feedback: check.feedback,
		...check.sealed === void 0 ? {} : { sealed: true },
		...check.describe === void 0 ? {} : { describe: check.describe }
	};
}
/**
* The declared check as a version chain's judge: it scores a settled version on its sealed cases
* when the record has them, and on its development cases otherwise. The per-item verdict rides in
* the ledger, so the next version's review names each item. A read that could not run scores
* `null`, which never counts as an improvement.
*/
function declaredCheckJudge(check, placement) {
	assertDeclaredCheck(check, "declaredCheckJudge");
	const digest = declaredCheckDigest(check);
	return {
		digest,
		async judge(version, signal) {
			try {
				const verdict = await readDeclaredCheck(check, placement, {
					...version.result.kind === "winner" ? { result: version.result.out } : {},
					set: check.sealed === void 0 ? "development" : "sealed",
					signal
				});
				return {
					score: verdict.composite ?? (verdict.pass ? 1 : 0),
					judgeDigest: digest,
					check: verdict
				};
			} catch (error) {
				if (!(error instanceof CheckUnavailableError)) throw error;
				return {
					score: null,
					judgeDigest: digest,
					detail: { unavailable: error.message }
				};
			}
		}
	};
}
function verdictOf(outcome, pass) {
	if (!outcome.succeeded) throw new CheckUnavailableError(`the check program ${outcome.reason}: ${outcome.diagnostic.slice(0, 2e3)}`);
	const last = outcome.value.stdout.trimEnd().split("\n").at(-1) ?? "";
	let score;
	try {
		score = JSON.parse(last);
	} catch {
		throw new CheckUnavailableError("the check program printed no JudgeScore on its last line");
	}
	const raw = score;
	if (typeof raw !== "object" || raw === null || typeof raw.dimensions !== "object" || raw.dimensions === null || typeof raw.composite !== "number" || typeof raw.notes !== "string") throw new CheckUnavailableError("the check program printed a line that is not a JudgeScore");
	return verdictFromJudgeScore({
		dimensions: raw.dimensions,
		composite: raw.composite,
		notes: raw.notes,
		...raw.failed === true ? { failed: true } : {}
	}, pass);
}
/** Copy exactly the bytes whose digest was checked: the files are read once, verified, and those
*  bytes are written, so a file changed after the check cannot reach the box. */
async function copyVerified(from, digest, to, label) {
	const captured = await captureMaterializedWorkspace(from);
	const actual = canonicalCandidateDigest(captured.manifest);
	if (actual !== digest) throw new ValidationError(`readDeclaredCheck: the ${label} at ${from} is ${actual}; the record names ${digest}`);
	await writeFiles(captured.files, to);
}
async function writeFiles(files, to) {
	for (const file of files) {
		const path = join(to, file.path);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, file.bytes, { mode: file.mode });
	}
}
//#endregion
//#region src/runtime/loop-dispatch.ts
/** Bridge a campaign `DispatchContext.trace` to a `LoopTraceEmitter` so every
*  `loop.*` event lands as a span under the cell's scoped trace. */
function campaignTraceToLoopEmitter(trace) {
	return { emit(event) {
		trace.span(event.kind, {
			runId: event.runId,
			timestamp: event.timestamp,
			...event.payload
		}).end();
	} };
}
async function runLoopForCell(opts, scenario, profile, ctx) {
	const loopOptions = opts.toLoopOptions(scenario, profile);
	return runLoopWithCampaignContext(opts, loopOptions, ctx, {
		model: profile.model?.default ?? modelFromLoopOptions(loopOptions),
		maximumCharge: typeof opts.maximumCharge === "function" ? opts.maximumCharge(scenario, profile) : opts.maximumCharge,
		resolveModel: opts.resolveCostModel ? (result) => opts.resolveCostModel?.(result, scenario, profile) : void 0
	});
}
async function runLoopWithCampaignContext(opts, loopOptions, ctx, cost) {
	const paid = await ctx.cost.runPaidCall({
		channel: "agent",
		actor: opts.costSource ?? "loop",
		model: cost.model,
		signal: ctx.signal,
		...cost.maximumCharge ? { maximumCharge: cost.maximumCharge } : {},
		execute: (executionSignal) => runAgentRounds({
			...loopOptions,
			ctx: {
				sandboxClient: opts.sandboxClient,
				...opts.promptOptions === void 0 ? {} : { promptOptions: opts.promptOptions },
				signal: executionSignal,
				traceEmitter: opts.forwardTrace === false ? void 0 : campaignTraceToLoopEmitter(ctx.trace)
			}
		}),
		receipt: (result) => loopCostReceipt(result, cost.resolveModel?.(result) ?? cost.model)
	});
	if (!paid.succeeded) throw paid.error;
	const result = paid.value;
	return (opts.toArtifact ?? ((r) => r.winner?.output))(result);
}
function loopCostReceipt(result, model) {
	return costReceiptFromUsage(result.tokenUsage, model, {
		usageUnknown: result.tokenUsage.tokensKnown === false,
		actualCostUsd: result.costUsdKnown !== false ? result.costUsd : void 0,
		costUnknown: result.costUsdKnown === false,
		estimatedCostUsd: result.estimatedCostUsd
	});
}
/** Map Runtime usage into Eval's canonical paid-call receipt without inventing cache classes. */
function costReceiptFromUsage(usage, model, cost) {
	const cacheComplete = hasCompleteCacheBreakdown(usage) && (usage.freshInput !== void 0 || usage.cacheRead !== void 0 || usage.cacheWrite !== void 0);
	const cacheRead = cacheComplete ? usage.cacheRead ?? 0 : void 0;
	const cacheWrite = cacheComplete ? usage.cacheWrite ?? 0 : void 0;
	const classified = (cacheRead ?? 0) + (cacheWrite ?? 0);
	return {
		model,
		inputTokens: cacheComplete ? usage.input - classified : usage.input,
		outputTokens: usage.output,
		...cacheComplete ? {
			cachedTokens: cacheRead,
			cacheWriteTokens: cacheWrite
		} : {},
		...usage.tokensKnown === false || cost.usageUnknown ? { usageUnknown: true } : {},
		...cost.actualCostUsd !== void 0 ? { actualCostUsd: cost.actualCostUsd } : {},
		...cost.costUnknown ? { costUnknown: true } : {},
		...cost.estimatedCostUsd !== void 0 ? { estimatedCostUsd: cost.estimatedCostUsd } : {}
	};
}
/** Eval has one pre-admitted paid call for this dispatch. A tree can settle that call only when
* Runtime has provider-served identity for every inference attempt that actually started. Plan
* materialization is deliberately ignored: it describes what Runtime requested, not what the
* provider served. Every visible terminal child must carry provider attempt evidence; a missing
* evidence record stays unknown, including zero-valued or incomplete spend.
* @internal Testable identity projection used by superviseDispatch. */
function supervisedTreeModelForDispatch(result, rootProfile) {
	const canonicalModels = /* @__PURE__ */ new Set();
	const observedModels = [];
	const wholeTreeEvidence = result.providerModel;
	if (wholeTreeEvidence === void 0 || wholeTreeEvidence.status !== "known" && wholeTreeEvidence.reason !== "provider-model-conflict" || wholeTreeEvidence.attempts.length === 0) return { kind: "unknown" };
	const wholeTreeIdentity = collectProviderModels(wholeTreeEvidence, () => true);
	if (wholeTreeIdentity.kind !== "known") return wholeTreeIdentity;
	for (const model of wholeTreeIdentity.observed) {
		observedModels.push(model.raw);
		canonicalModels.add(model.canonical);
	}
	if (canonicalModels.size === 0) return { kind: "unknown" };
	if (canonicalModels.size !== 1) return {
		kind: "mixed",
		models: [...canonicalModels].sort()
	};
	return {
		kind: "known",
		model: observedModels[0]
	};
}
function collectProviderModels(evidence, validate) {
	if (evidence.status !== "known" && evidence.reason !== "provider-model-conflict" || !Array.isArray(evidence.attempts) || evidence.attempts.length === 0 || !Array.isArray(evidence.models)) return { kind: "unknown" };
	const observed = [];
	const canonical = /* @__PURE__ */ new Set();
	const observedRaw = /* @__PURE__ */ new Set();
	for (const attempt of evidence.attempts) {
		if (attempt.providerDispatch === "not_started") {
			if (attempt.observations.length > 0 || attempt.identityConflict === true) return { kind: "unknown" };
			continue;
		}
		if (attempt === null || typeof attempt !== "object" || !Array.isArray(attempt.observations) || attempt.observations.length === 0 || attempt.identityConflict === true) return { kind: "unknown" };
		let attemptBase;
		let attemptSnapshot;
		let attemptSnapshotKind;
		let representative;
		for (const model of attempt.observations) {
			if (typeof model !== "string" || !validate(model)) return { kind: "unknown" };
			const identity = canonicalObservedModelParts(model);
			if (identity === void 0) return { kind: "unknown" };
			const base = identity.base;
			const snapshot = identity.snapshot;
			if (attemptBase !== void 0 && attemptBase !== base) return {
				kind: "mixed",
				models: [.../* @__PURE__ */ new Set([...attemptBase ? [attemptBase] : [], identity.canonical])]
			};
			if (attemptSnapshot !== void 0 && snapshot !== void 0 && (attemptSnapshot !== snapshot || attemptSnapshotKind !== identity.snapshotKind)) {
				if (attemptBase === void 0 || attemptSnapshotKind === void 0) return { kind: "unknown" };
				return {
					kind: "mixed",
					models: [attemptIdentityText(attemptBase, attemptSnapshot, attemptSnapshotKind), identity.canonical]
				};
			}
			attemptBase = base;
			attemptSnapshot ??= snapshot;
			attemptSnapshotKind ??= identity.snapshotKind;
			if (snapshot !== void 0) representative = model;
			observedRaw.add(model);
		}
		if (attemptBase === void 0 || attemptSnapshot === void 0 || attemptSnapshotKind === void 0 || representative === void 0) return { kind: "unknown" };
		const attemptIdentity = attemptIdentityText(attemptBase, attemptSnapshot, attemptSnapshotKind);
		observed.push({
			raw: representative,
			canonical: attemptIdentity
		});
		canonical.add(attemptIdentity);
	}
	if (observed.length === 0) return { kind: "unknown" };
	const declaredRaw = /* @__PURE__ */ new Set();
	for (const model of evidence.models) {
		if (typeof model !== "string") return { kind: "unknown" };
		declaredRaw.add(model);
	}
	if (declaredRaw.size !== observedRaw.size || [...declaredRaw].some((model) => !observedRaw.has(model))) return { kind: "unknown" };
	return canonical.size > 1 ? {
		kind: "mixed",
		models: [...canonical].sort()
	} : {
		kind: "known",
		observed
	};
}
function attemptIdentityText(base, snapshot, kind) {
	return kind === "date" ? `${base}-${snapshot}` : `${base}@${snapshot}`;
}
/** The Eval receipt surface has no pre-admitted per-model recursive-tree receipt bundle yet. */
var SupervisedTreeModelIdentityError = class extends Error {
	constructor(identity) {
		const detail = identity.kind === "mixed" ? `multiple models (${identity.models.join(", ")})` : "an unknown materialized model";
		super(`superviseDispatch: cannot settle one Eval paid-call receipt for a tree with ${detail}`);
		this.name = "SupervisedTreeModelIdentityError";
	}
};
function unknownSupervisedTreeReceipt() {
	return {
		model: "unknown",
		inputTokens: 0,
		outputTokens: 0,
		usageUnknown: true,
		costUnknown: true
	};
}
/** Run one recursive supervised tree inside Eval's pre-execution paid-call lifecycle. */
function superviseDispatch(opts) {
	return async (profile, scenario, ctx) => {
		const superviseOptions = opts.toSuperviseOptions(scenario, profile);
		const task = opts.toTask(scenario, profile);
		const maximumCharge = typeof opts.maximumCharge === "function" ? opts.maximumCharge(scenario, profile) : opts.maximumCharge;
		const paid = await ctx.cost.runPaidCall({
			channel: "agent",
			actor: opts.costSource ?? "supervise",
			model: "unknown",
			signal: ctx.signal,
			...maximumCharge ? { maximumCharge } : {},
			execute: async (executionSignal) => {
				const result = await supervise(profile, task, {
					...superviseOptions,
					signal: executionSignal
				});
				const identity = supervisedTreeModelForDispatch(result, profile);
				if (identity.kind !== "known") throw new SupervisedTreeModelIdentityError(identity);
				return result;
			},
			receipt: (result) => {
				const identity = supervisedTreeModelForDispatch(result, profile);
				if (identity.kind !== "known") throw new SupervisedTreeModelIdentityError(identity);
				return costReceiptFromUsage(result.spentTotal.tokens, identity.model, {
					usageUnknown: result.spentTotal.tokensKnown === false,
					actualCostUsd: result.spentTotal.usdKnown !== false ? result.spentTotal.usd : void 0,
					costUnknown: result.spentTotal.usdKnown === false
				});
			},
			receiptFromError: (error) => error instanceof SupervisedTreeModelIdentityError ? unknownSupervisedTreeReceipt() : void 0
		});
		if (!paid.succeeded) throw paid.error;
		return (opts.toArtifact ?? ((result) => {
			if (result.kind !== "winner") throw new Error(`superviseDispatch: supervised tree ended without a winner (${result.reason})`);
			return result.out;
		}))(paid.value);
	};
}
function modelFromLoopOptions(options) {
	const profiles = options.agentRun ? [options.agentRun.profile] : options.agentRuns?.map((run) => run.profile) ?? [];
	const models = new Set(profiles.map((profile) => profile.model?.default).filter((model) => !!model));
	if (models.size === 1) return [...models][0];
	return models.size > 1 ? "mixed" : "unknown";
}
/**
* Adapter for plain `runCampaign` scenarios. This is the Runtime-side pair for
* agent-eval fixture scenarios: load fixtures in `agent-eval/campaign`, build
* the Runtime cell here, and keep paid-call admission, receipts, and traces
* automatic.
*/
function loopCampaignDispatch(opts) {
	return (scenario, ctx) => {
		const loopOptions = opts.toLoopOptions(scenario);
		return runLoopWithCampaignContext(opts, loopOptions, ctx, {
			model: modelFromLoopOptions(loopOptions),
			maximumCharge: typeof opts.maximumCharge === "function" ? opts.maximumCharge(scenario) : opts.maximumCharge,
			resolveModel: opts.resolveCostModel ? (result) => opts.resolveCostModel?.(result, scenario) : void 0
		});
	};
}
/**
* Adapter for `runProfileMatrix` (profile is an axis). Returns a
* `ProfileDispatchFn` that runs `runAgentRounds` per (profile, scenario) cell
* inside Eval's paid-call lifecycle.
*/
function loopDispatch(opts) {
	return (profile, scenario, ctx) => runLoopForCell(opts, scenario, profile, ctx);
}
//#endregion
//#region src/runtime/inline-sandbox-client.ts
/**
* The ONE pseudo-box adapter: present any one-shot `Executor` (router / bridge /
* BYO) as a `SandboxClient` so the round-synchronous `runAgentRounds` can drive it
* without each call site re-faking a box. This is the single shell that
* `bench/src/router-executor.ts`, generate-eval's old `bridgeSandboxClient`, and
* the search-bench bridge transport were each re-implementing.
*
* It is deliberately for NON-box executors only — a real sandbox harness already
* IS a `SandboxClient` (boxes, sessions, fs, fork are real there). Here each
* `streamPrompt` runs the executor once and emits its result plus the canonical
* `done` event. The result carries output and usage; `done` confirms execution settled.
* There are no sessions, no fs,
* no fork (those degrade gracefully via the optional `SandboxClient` methods).
*/
function isAsyncIterable$1(v) {
	return typeof v === "object" && v !== null && Symbol.asyncIterator in v;
}
/** Drive a (possibly streaming) executor to its terminal artifact. */
async function settle(exec, task, signal) {
	const r = exec.execute(task, signal);
	if (isAsyncIterable$1(r)) {
		for await (const _ of r);
		return exec.resultArtifact();
	}
	return r;
}
/**
* Adapt an `ExecutorFactory` into a `SandboxClient` for `runAgentRounds`. The factory is
* instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
* run once on the prompt, emit the terminal result event, tear down.
*
* There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
* other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
*/
function inlineSandboxClient(factory, defaults = {}) {
	const capturedDefaultProfile = defaults.profile === void 0 ? void 0 : agentProfileSchema.parse(structuredClone(defaults.profile));
	let seq = 0;
	return { async create(options) {
		const id = `inline-${seq++}`;
		const createOptions = options;
		return {
			id,
			async *streamPrompt(message, opts) {
				assertBoxlessPromptOptions(opts, "inlineSandboxClient");
				const controller = new AbortController();
				const callerSignal = opts?.signal;
				const onAbort = () => controller.abort(callerSignal?.reason ?? /* @__PURE__ */ new Error("prompt aborted"));
				if (callerSignal) if (callerSignal.aborted) onAbort();
				else callerSignal.addEventListener("abort", onAbort, { once: true });
				const requestedProfile = (options?.backend && typeof options.backend === "object" ? options.backend.profile : void 0) ?? capturedDefaultProfile;
				const parsedProfile = agentProfileSchema.safeParse(requestedProfile);
				if (!parsedProfile.success) throw new Error("inlineSandboxClient: an exact AgentProfile is required; pass defaults.profile or create({ backend: { profile } })");
				const exec = factory({
					profile: parsedProfile.data,
					harness: null
				}, {
					signal: controller.signal,
					seams: { createOptions }
				});
				try {
					const artifact = await settle(exec, message, controller.signal);
					const out = artifact.out;
					const tokensIn = artifact.spent.tokens.input;
					const tokensOut = artifact.spent.tokens.output;
					const costUsd = artifact.spent.usd;
					const estimatedCostUsd = out?.estimatedCostUsd;
					if (artifact.spent.iterations > 0 || artifact.spent.tokensKnown === false || artifact.spent.usdKnown === false || tokensIn > 0 || tokensOut > 0 || costUsd > 0 || estimatedCostUsd !== void 0) yield {
						type: "llm_call",
						data: {
							...artifact.spent.tokensKnown === false ? {} : {
								tokensIn,
								tokensOut
							},
							...artifact.spent.usdKnown !== false ? { costUsd } : {},
							...artifact.spent.tokensKnown === false ? { tokensKnown: false } : {},
							...artifact.spent.usdKnown === false ? { costKnown: false } : {},
							...artifact.spent.usdKnown !== false ? {
								costKnown: true,
								costProvenance: "provider-receipt"
							} : {},
							...estimatedCostUsd !== void 0 ? { estimatedCostUsd } : {},
							...out?.promptCache ? { promptCache: out.promptCache } : {}
						}
					};
					yield {
						type: "result",
						data: {
							finalText: out?.content ?? "",
							...artifact.spent.tokensKnown === false ? { tokensKnown: false } : { tokenUsage: {
								inputTokens: tokensIn,
								outputTokens: tokensOut
							} },
							...artifact.spent.usdKnown === false ? {
								costKnown: false,
								...costUsd > 0 ? { costUsd } : {}
							} : {
								costUsd,
								costKnown: true,
								costProvenance: "provider-receipt"
							},
							...estimatedCostUsd !== void 0 ? { estimatedCostUsd } : {},
							...out?.promptCache ? { promptCache: out.promptCache } : {}
						}
					};
					yield {
						type: "done",
						data: { outcome: { type: "completed" } }
					};
				} finally {
					callerSignal?.removeEventListener("abort", onAbort);
					await exec.teardown("brutalKill").catch(() => {});
				}
			},
			async delete() {}
		};
	} };
}
//#endregion
//#region src/runtime/local-sandbox-client.ts
/**
* `localSandboxClient` — the SAME-HOST pseudo-box: a `SandboxClient` whose
* `create()` MATERIALIZES the profile's stdio MCP servers as local child
* processes (`materializeLocalMcp`) and whose `streamPrompt` drives a real
* tool loop (`runBrainLoop` over the router brain) with those live tools.
*
* Despite the interface name, this does NOT isolate processes. It is only for
* author-controlled profiles whose local MCP commands a caller explicitly
* trusts; user- or model-authored code belongs in a real sandbox. `delete()`
* kills the children.
*
* A per-create profile may change the prompt surface. Permission to start a
* local MCP process applies only when its full canonical bytes match the fixed
* constructor profile; a different generated profile is refused.
*
* Event protocol matches `inlineSandboxClient`: known token usage is emitted as one `llm_call`;
* Router catalog cost remains a separately-labelled estimate, never billed spend.
*/
/** A same-host `SandboxClient` adapter with no process isolation. Local MCP is
* refused unless the caller explicitly supplies a policy that allows it.
*
* There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
* other per-prompt options (`timeoutMs`, `context`) are accepted and ignored. */
function localSandboxClient(opts) {
	const defaultProfile = opts.profile === void 0 ? void 0 : executableAgentProfileSnapshot(opts.profile, "localSandboxClient default profile");
	const router = Object.freeze({ ...opts.router });
	if (opts.profileSecurityPolicy?.allowLocalMcp && defaultProfile === void 0) throw new ValidationError("localSandboxClient: allowLocalMcp requires a fixed author-controlled profile; dynamic profiles need a real sandbox");
	const trustedProfileDigest = opts.profileSecurityPolicy?.allowLocalMcp && defaultProfile !== void 0 ? canonicalAgentProfileDigest(defaultProfile) : void 0;
	let seq = 0;
	return { async create(options) {
		const profile = executableAgentProfileSnapshot((options?.backend)?.profile ?? defaultProfile, "localSandboxClient");
		const model = profileProviderModel(profile);
		const settings = profileModelExecutionSettings(profile, "localSandboxClient");
		const policyApplies = opts.profileSecurityPolicy !== void 0 && (!opts.profileSecurityPolicy.allowLocalMcp || trustedProfileDigest !== void 0 && canonicalAgentProfileDigest(profile) === trustedProfileDigest);
		const mcp = await materializeLocalMcp(profile, {
			...opts.keys ? { keys: opts.keys } : {},
			...policyApplies ? { profileSecurityPolicy: opts.profileSecurityPolicy } : {}
		});
		const brain = routerBrain({
			routerBaseUrl: router.baseUrl,
			routerKey: router.key,
			model,
			...settings.retry !== void 0 ? { retry: settings.retry } : {},
			...enforceTokenLimits(settings.tokenLimits, "router", "localSandboxClient").applied,
			...settings.stream !== void 0 ? { stream: settings.stream } : {}
		}, {
			...settings.temperature !== void 0 ? { temperature: settings.temperature } : {},
			...settings.seed !== void 0 ? { seed: settings.seed } : {},
			...settings.toolChoice !== void 0 ? { toolChoice: settings.toolChoice } : {},
			...settings.extraBody !== void 0 ? { extraBody: settings.extraBody } : {},
			...profile.model?.reasoningEffort ? { reasoningEffort: profile.model.reasoningEffort } : {}
		});
		const system = [profile.prompt?.systemPrompt, ...profile.prompt?.instructions ?? []].filter((s) => typeof s === "string" && s.trim().length > 0).join("\n\n");
		return {
			id: `local-${seq++}`,
			async *streamPrompt(message, popts) {
				assertBoxlessPromptOptions(popts, "localSandboxClient");
				let estimatedCostUsd = 0;
				let sawEstimatedCost = false;
				const chat = async (messages, tools) => {
					const r = await brain(messages, tools);
					if (r.costProvenance === "catalog-estimate" && r.costUsd !== void 0) {
						estimatedCostUsd += r.costUsd;
						sawEstimatedCost = true;
					}
					return r;
				};
				const r = await runBrainLoop({
					chat,
					tools: mcp.tools,
					execute: (name, args) => mcp.call(name, args),
					initialMessages: [...system ? [{
						role: "system",
						content: system
					}] : [], {
						role: "user",
						content: message
					}],
					maxTurns: settings.maxTurns ?? 0,
					hooks: { stopBefore: () => popts?.signal?.aborted === true }
				});
				if (r.turns > 0) yield {
					type: "llm_call",
					data: {
						model,
						tools: mcp.tools.map((t) => t.function.name),
						...r.tokensKnown === false ? { tokensKnown: false } : {
							tokensIn: r.usage.input,
							tokensOut: r.usage.output
						},
						costKnown: false,
						...sawEstimatedCost ? { estimatedCostUsd } : {}
					}
				};
				yield {
					type: "result",
					data: {
						finalText: r.final,
						...r.tokensKnown === false ? { tokensKnown: false } : { tokenUsage: {
							inputTokens: r.usage.input,
							outputTokens: r.usage.output
						} },
						costKnown: false,
						...sawEstimatedCost ? { estimatedCostUsd } : {}
					}
				};
			},
			async delete() {
				await mcp.close();
			}
		};
	} };
}
//#endregion
//#region src/runtime/resolve-sandbox-client.ts
/**
* The product-facing backend selector: one call picks the execution transport a
* `runAgentRounds` (or any consumer that drives a `SandboxClient`) runs on, from the
* package a product already depends on. It is pure sugar over the existing
* primitives — `createExecutor({ backend })` + `inlineSandboxClient` — and adds
* ZERO transport code (the node:http cli-bridge transport lives in `bridgeExecutor`).
*
* The heavy `resolveBenchClient` in `@tangle-network/agent-bench` is the bench-side
* sibling: it layers router/search specifics a product should not have to depend on.
* This is the generic, dep-light core products call to switch backends:
*
*   - `backend: 'sandbox'` → IN-BOX: return the caller's real Sandbox-backed
*                            `sandboxClient` unchanged. Fail loud if absent — a
*                            product on the sandbox backend already holds its box.
*   - `backend: 'bridge'`  → OFF-BOX: a local cli-bridge fronting a harness CLI
*                            (opencode / kimi-code / …) as the leaf executor, wired
*                            through the resumable `bridgeExecutor`.
*   - `backend: 'router'`  → OFF-BOX: a router chat-completion as the leaf executor,
*                            presented as a `SandboxClient` (no sandbox dependency).
*   - `backend: 'local'`   → SAME-HOST: a router-brain tool loop with the
*                            profile's stdio MCP servers spawned as LOCAL child
*                            processes — the only backend that can reach an MCP
*                            server built into a host worktree.
*/
/**
* Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core
* that `resolveBenchClient` builds on — reuse this instead of hand-rolling the
* `createExecutor`/`inlineSandboxClient` branch in each product.
*/
function resolveSandboxClient(opts) {
	switch (opts.backend) {
		case "sandbox":
			if (!opts.sandboxClient) throw new Error("resolveSandboxClient: backend 'sandbox' requires opts.sandboxClient");
			return opts.sandboxClient;
		case "bridge": {
			const bridge = opts.bridge;
			if (!bridge?.bearer) throw new Error("resolveSandboxClient: backend 'bridge' requires bridge.bearer");
			return inlineSandboxClient(createExecutor({
				backend: "bridge",
				bridgeUrl: bridge.url ?? "http://127.0.0.1:3355",
				bridgeBearer: bridge.bearer,
				timeoutMs: bridge.timeoutMs
			}));
		}
		case "router": {
			const router = opts.router;
			if (!router?.baseUrl || !router.key) throw new Error("resolveSandboxClient: backend 'router' requires router.baseUrl and router.key");
			return inlineSandboxClient(createExecutor({
				backend: "router",
				routerBaseUrl: router.baseUrl,
				routerKey: router.key
			}));
		}
		case "local": {
			const local = opts.local;
			if (!local?.router?.baseUrl || !local.router.key) throw new Error("resolveSandboxClient: backend 'local' requires local.router.baseUrl and local.router.key");
			return localSandboxClient(local);
		}
	}
}
//#endregion
//#region src/runtime/define-leaderboard.ts
/**
* `defineLeaderboard` — the declarative eval-leaderboard facade.
*
* A product's harness×model leaderboard is always the same assembly: expand a
* base profile across the harness×model axes (`expandProfileAxes`), run every
* (profile, case) cell as a driven loop (`loopDispatch` + the naive retry driver), score
* with the domain's grader, and emit ONE `runProfileMatrix` call. Each product
* hand-rolled that assembly (~650 lines each) and re-hit the same footguns:
* stale cell-cache reuse, zero-token stub cells, missing model snapshots.
*
* This facade IS that assembly, once, with the domain reduced to a declarative
* spec: `cases` + `prompt` + `score`. It contains NO execution, judging, or
* metering logic of its own — every moving part is an existing primitive, and
* every default is overridable:
*
*   - LEVEL 0 (declarative): `cases` / `prompt` / `score` / `axis`.
*   - LEVEL 1 (seams): `backends`, `flags`, `parseOutput`, `onCellEvents`,
*     `resolveModel`, `setup`/`teardown`, `export`, `matrix`
*     passthrough.
*   - LEVEL 2 (replacement): `dispatch` and `judges` swap out the whole
*     loop wiring or scoring; `runProfileMatrix` itself stays public as the
*     escape floor — a product overriding everything just writes what it has
*     today, no capability removed.
*
* `toBenchmarkAdapter()` exposes the same domain surface in the structural
* `BenchmarkAdapter` shape (`name`/`preflight`/`loadTasks`/`judge`/
* `goldArtifact`) so a product leaderboard can register into a benchmark
* registry without this module depending on one.
*
* @experimental
*/
/**
* The no-signal retry floor as a bare `Driver` literal: re-run the case VERBATIM as an
* independent attempt until one shot scores (`verdict.valid`) or the shot cap. It reads ONLY
* `verdict.valid` — never `notes`/`scores` — so a leaderboard cell's retries carry no grader
* findings into the next shot (the leak-free firewall). Steering POLICY texts are registry data
* (`delegates/naive-continuation` and siblings in the kernel prompt registry) attached to graph
* edges; this loop-kernel control folds no text in — each shot is the same task object, and the
* per-shot nonce in `taskToPrompt` keeps the attempts independent at the router.
*/
function naiveRetryDriver(shots) {
	return {
		name: "naive",
		plan(task, history) {
			if (history.length === 0) return Promise.resolve([task]);
			if (history[history.length - 1]?.verdict?.valid === true) return Promise.resolve([]);
			if (history.length >= shots) return Promise.resolve([]);
			return Promise.resolve([task]);
		},
		decide(history) {
			if (history.some((it) => it.verdict?.valid)) return "pick-winner";
			return history.length < shots ? "refine" : "fail";
		},
		describePlan() {
			return {
				kind: "refine",
				rationale: "naive fixed continuation (no grade signal)"
			};
		}
	};
}
/** Read `--name <value>` from an argv array. */
function argOf(argv, name) {
	const i = argv.indexOf(`--${name}`);
	if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
}
function splitList(v) {
	if (v === void 0) return void 0;
	const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
	return parts.length > 0 ? parts : void 0;
}
/** RunRecords reject a bare model id — the eval IDENTITY model must carry a
*  snapshot (`name@<snapshot>`). Unchanged when already stamped. */
function withSnapshot(model, snapshot) {
	return model.includes("@") ? model : `${model}@${snapshot}`;
}
function gitSha() {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	} catch {
		return "unknown";
	}
}
function normalizeScore(s) {
	return typeof s === "number" ? { composite: s } : s;
}
/**
* Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable
* harness×model leaderboard — `run()` executes the matrix, `toBenchmarkAdapter()`
* exposes the same domain as a structural `BenchmarkAdapter`.
*/
function defineLeaderboard(spec) {
	const caseId = (c) => {
		const id = spec.caseId ? spec.caseId(c) : c.id;
		if (typeof id !== "string" || id.length === 0) throw new Error(`defineLeaderboard(${spec.name}): every case needs a stable string id — give cases an \`id\` property or supply spec.caseId`);
		return id;
	};
	const selectCases = (ids) => {
		if (!ids) return spec.cases;
		const byId = new Map(spec.cases.map((c) => [caseId(c), c]));
		return ids.map((id) => {
			const c = byId.get(id);
			if (c === void 0) throw new Error(`defineLeaderboard(${spec.name}): unknown case "${id}" (have: ${[...byId.keys()].join(", ")})`);
			return c;
		});
	};
	const scoreJudge = {
		name: `${spec.name}-score`,
		dimensions: [{
			key: "composite",
			description: `${spec.name} case score`
		}],
		score({ artifact, scenario }) {
			const s = normalizeScore(spec.score(artifact, scenario.case));
			return {
				composite: s.composite,
				dimensions: {
					composite: s.composite,
					...s.dimensions
				},
				notes: s.notes ?? ""
			};
		}
	};
	async function run(argv = process.argv.slice(2)) {
		const args = {};
		for (const name of [
			"backend",
			"harnesses",
			"models",
			"cases",
			"shots",
			"reps",
			"model-snapshot",
			"run-dir",
			"export-dir"
		]) args[name] = argOf(argv, name);
		for (const [name, flag] of Object.entries(spec.flags ?? {})) args[name] = argOf(argv, name) ?? flag.default;
		const backendName = args.backend ?? "sandbox";
		const shots = Number(args.shots ?? spec.shots ?? 1);
		const reps = Number(args.reps ?? spec.reps ?? 1);
		const snapshot = args["model-snapshot"] ?? "leaderboard";
		const runDir = args["run-dir"] ?? join(tmpdir(), `leaderboard-${spec.name}-${Date.now()}-${process.pid}`);
		const exportDir = args["export-dir"] ?? join(runDir, "export");
		mkdirSync(runDir, { recursive: true });
		const cases = selectCases(splitList(args.cases));
		if (cases.length === 0) throw new Error(`defineLeaderboard(${spec.name}): no cases to run`);
		const scenarios = cases.map((c) => ({
			id: caseId(c),
			kind: spec.name,
			case: c
		}));
		const harnesses = splitList(args.harnesses) ?? spec.axis?.harnesses ?? CODING_HARNESSES;
		const rawModels = splitList(args.models) ?? spec.axis?.models ?? (spec.baseProfile?.model?.default !== void 0 ? [spec.baseProfile.model.default] : void 0);
		if (!rawModels || rawModels.length === 0) throw new Error(`defineLeaderboard(${spec.name}): no models — pass --models, set spec.axis.models, or give spec.baseProfile a model.default`);
		const models = rawModels.map((m) => withSnapshot(m, snapshot));
		const profiles = expandProfileAxes({
			base: spec.baseProfile,
			harnesses,
			models
		});
		for (const profile of profiles) assertExecutableAgentProfile(profile, `defineLeaderboard(${spec.name})`);
		const ctx = {
			name: spec.name,
			backend: backendName,
			runDir,
			exportDir,
			args,
			harnesses,
			models,
			caseIds: scenarios.map((s) => s.id),
			shots,
			reps
		};
		const backends = {
			sandbox: () => {
				throw new Error(`defineLeaderboard(${spec.name}): the 'sandbox' backend needs your product's real Sandbox client — supply spec.backends.sandbox (e.g. () => new Sandbox({ apiKey, baseUrl }))`);
			},
			"cli-bridge": () => {
				const bearer = process.env.BRIDGE_BEARER ?? process.env.CLI_BRIDGE_BEARER;
				if (!bearer) throw new Error(`defineLeaderboard(${spec.name}): backend 'cli-bridge' needs BRIDGE_BEARER or CLI_BRIDGE_BEARER set`);
				return resolveSandboxClient({
					backend: "bridge",
					bridge: {
						url: process.env.CLI_BRIDGE_URL,
						bearer,
						timeoutMs: 9e5
					}
				});
			},
			...spec.backends
		};
		const makeClient = backends[backendName];
		if (!makeClient) throw new Error(`defineLeaderboard(${spec.name}): unknown backend "${backendName}" (have: ${Object.keys(backends).join(", ")})`);
		const sandboxClient = makeClient();
		const promptById = /* @__PURE__ */ new Map();
		for (const s of scenarios) promptById.set(s.id, await spec.prompt(s.case));
		const promptOf = (s) => {
			const p = promptById.get(s.id);
			if (p === void 0) throw new Error(`defineLeaderboard(${spec.name}): no prompt for case "${s.id}"`);
			return p;
		};
		let shotNonce = 0;
		const maximumCharge = spec.maximumCharge;
		const dispatch = spec.dispatch ?? ((profile, scenario, dispatchCtx) => {
			return loopDispatch({
				sandboxClient,
				maximumCharge: typeof maximumCharge === "function" ? (cellScenario, cellProfile) => maximumCharge(cellProfile, cellScenario) : maximumCharge,
				resolveCostModel: (result, _cellScenario, cellProfile) => {
					if (!spec.resolveModel) return cellProfile.model?.default;
					const served = new Set(result.iterations.map((iteration) => spec.resolveModel?.(iteration.events)).filter((model) => model !== void 0));
					if (served.size > 1) throw new Error(`defineLeaderboard(${spec.name}): one cell reported multiple served models: ${[...served].join(", ")}`);
					return [...served][0] ?? cellProfile.model?.default;
				},
				toLoopOptions: (cellScenario, cellProfile) => {
					return {
						driver: naiveRetryDriver(shots),
						agentRun: {
							profile: cellProfile,
							taskToPrompt: (s) => `${promptOf(s)}\n\n<!-- independent-attempt:${shotNonce++} -->`
						},
						output: { parse: (events) => spec.parseOutput ? spec.parseOutput(events, cellScenario.case) : collectAgentResponseText(events) ?? "" },
						validator: { validate: async (output) => {
							const s = normalizeScore(spec.score(output, cellScenario.case));
							return {
								valid: s.composite > 0,
								score: s.composite
							};
						} },
						task: cellScenario,
						maxIterations: shots
					};
				},
				toArtifact: (result) => {
					for (const iter of result.iterations) spec.onCellEvents?.(iter.events, scenario.case, {
						index: iter.index,
						...iter.error ? { error: iter.error.message } : {},
						...iter.verdict ? { verdict: { score: iter.verdict.score } } : {}
					});
					return result.winner?.output;
				}
			})(profile, scenario, dispatchCtx);
		});
		await spec.setup?.(ctx);
		try {
			const result = await runProfileMatrix({
				profiles,
				scenarios,
				dispatch,
				judges: spec.judges ?? [scoreJudge],
				runDir,
				commitSha: gitSha(),
				reps,
				...spec.matrix
			});
			if (spec.export) await spec.export(result, ctx);
			else {
				mkdirSync(exportDir, { recursive: true });
				writeFileSync(join(runDir, "matrix-result.json"), `${JSON.stringify(result, null, 2)}\n`);
				const table = renderLeaderboardMarkdown(leaderboard(result.records, {
					title: spec.name,
					meta: { backend: backendName }
				}));
				writeFileSync(join(exportDir, "leaderboard.md"), table);
				console.log(table);
			}
			return result;
		} finally {
			await spec.teardown?.(ctx);
		}
	}
	function toBenchmarkAdapter() {
		return {
			name: spec.name,
			async preflight() {
				const seen = /* @__PURE__ */ new Set();
				for (const c of spec.cases) {
					const id = caseId(c);
					if (seen.has(id)) throw new Error(`defineLeaderboard(${spec.name}): duplicate case id "${id}"`);
					seen.add(id);
				}
			},
			async loadTasks(opts) {
				const selected = selectCases(opts?.ids);
				const limited = opts?.limit !== void 0 ? selected.slice(0, opts.limit) : selected;
				return Promise.all(limited.map(async (c) => ({
					id: caseId(c),
					prompt: await spec.prompt(c),
					metadata: { case: c }
				})));
			},
			async judge(task, artifact) {
				const [c] = selectCases([task.id]);
				if (c === void 0) throw new Error(`defineLeaderboard(${spec.name}): no case "${task.id}"`);
				const s = normalizeScore(spec.score(artifact, c));
				return {
					resolved: s.composite > 0,
					score: s.composite,
					detail: s.notes
				};
			},
			async goldArtifact() {}
		};
	}
	return {
		run,
		toBenchmarkAdapter
	};
}
//#endregion
//#region src/runtime/harvest-corpus.ts
/**
* Analyze completed runs through the selected observer and retain findings in a corpus.
*
* Store-agnostic by design: the caller maps its trace store's rows (a
* `ProductionTraceSink` ndjson, OTLP spans, RunRecords) to `ObserveInput` — task text,
* final output, the event trace, terminal outcome.
* The default observer reads execution evidence; an injected analysis owns its admitted sources.
*
* The nightly product job is then three lines:
*   const runs = mapSinkRowsToObserveInputs(await readSink(yesterday))
*   const report = await harvestCorpus({ runs, profile, executor, corpus })
*   log(report)   // runsObserved / findings / learned / failures
*
* Consumers choose how retained findings inform later work and how to assess their value.
*/
/** The completed batch evidence remains available even when every analysis failed. */
var HarvestError = class extends Error {
	report;
	constructor(report) {
		super(`harvestCorpus: every run failed analysis (${report.failures.length}) — first: ${report.failures[0]?.error}`);
		this.report = report;
		this.name = "HarvestError";
	}
};
/** Batch the selected observation implementation over completed runs and retain its findings. */
async function harvestCorpus(opts) {
	const concurrency = opts.concurrency ?? 4;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || opts.maxRuns !== void 0 && (!Number.isSafeInteger(opts.maxRuns) || opts.maxRuns < 0)) throw new TypeError("harvest limits require positive integer concurrency and nonnegative integer maxRuns");
	const report = {
		runsObserved: 0,
		findings: 0,
		learned: 0,
		failures: [],
		usage: {
			input: 0,
			output: 0,
			known: true
		}
	};
	const iterator = Symbol.asyncIterator in Object(opts.runs) ? opts.runs[Symbol.asyncIterator]() : (async function* () {
		yield* opts.runs;
	})();
	let consumed = 0;
	let done = false;
	const next = async () => {
		if (done || opts.signal?.aborted || opts.maxRuns !== void 0 && consumed >= opts.maxRuns) return null;
		const sequence = ++consumed;
		let r;
		try {
			r = await iterator.next();
		} catch (error) {
			done = true;
			report.failures.push({
				runId: `source-${sequence}`,
				error: `trace source: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`
			});
			return null;
		}
		if (r.done) {
			done = true;
			return null;
		}
		return {
			input: r.value,
			sequence
		};
	};
	const workers = Array.from({ length: concurrency }, async () => {
		for (let run = await next(); run !== null; run = await next()) {
			const { input, sequence } = run;
			if (opts.signal?.aborted) return;
			try {
				const obs = await observe(input, opts);
				report.runsObserved += 1;
				report.findings += obs.findings.length;
				report.learned += obs.learned.length;
				report.usage.input += obs.usage.input;
				report.usage.output += obs.usage.output;
				report.usage.known &&= obs.usage.known;
			} catch (e) {
				report.usage.known &&= e instanceof ObservationError && e.usage.known;
				if (e instanceof ObservationError) {
					report.usage.input += e.usage.input;
					report.usage.output += e.usage.output;
				}
				report.failures.push({
					runId: input.runId ?? `run-${sequence}`,
					error: e instanceof Error ? e.message.slice(0, 300) : String(e)
				});
			}
		}
	});
	await Promise.all(workers);
	if (report.runsObserved === 0 && report.failures.length > 0) throw new HarvestError(report);
	return report;
}
//#endregion
//#region src/runtime/in-process-sandbox-client.ts
/**
* The ONE in-process pseudo-box: present a plain user callback as a
* `SandboxClient` so an example or test can drive `runAgentRounds` / `openSandboxRun`
* with zero credentials and zero network — without re-faking a box at each call
* site via `as unknown as SandboxInstance`.
*
* It is the structural sibling of {@link inlineSandboxClient}: that one adapts an
* `Executor` (router / bridge / BYO) into a box; this one adapts a single
* `onPrompt(prompt, round)` callback into a box. Both exist because
* `SandboxInstance` is a `declare class` with private fields — a plain object
* literal can NEVER structurally satisfy it, so every offline seam was forced to
* write `as unknown as SandboxInstance`. The one unavoidable cast now lives HERE,
* documented and tested, instead of in every example.
*
* What the box implements is exactly the subset `runAgentRounds` + `openSandboxRun`
* actually call on a box:
*   - `id` — stable per box, used for trace correlation.
*   - `streamPrompt(prompt, opts?)` — runs `onPrompt` and streams its events.
*   - `fs.read` / `fs.write` — over the optional real `workdir` (the deliverable
*     artifact + any seeded fixtures live there). Present only when a `workdir`
*     is given.
*   - `exec(command)` — runs the command in `workdir`. Present only when a
*     `workdir` is given.
*   - `delete()` — removes the per-box temp dir (when one was minted) and is a
*     no-op otherwise; `deleteBoxSafe` calls it at teardown.
*
* The `SandboxEvent` shape the callback returns — `{ type, data }` — is the
* runtime metering protocol the kernel reads: emit a flat `llm_call`
* (`{ tokensIn, tokensOut, costUsd }`) or a terminal `done`
* (`{ tokenUsage, totalCostUsd }`) / `result` event and the kernel's cost ledger
* picks it up. No cast is needed on the events (the union is structural); only
* the box object is cast, once, inside this file.
*/
function isAsyncIterable(v) {
	return typeof v === "object" && v !== null && Symbol.asyncIterator in v;
}
/**
* Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for
* `runAgentRounds` / `openSandboxRun`. Returns a PROPERLY-TYPED `SandboxClient`: the
* lone `SandboxInstance` cast (object literal → `declare class`) lives inside
* this function, so call sites stay cast-free.
*
* There is no box, so a per-prompt `backend` override is refused rather than dropped. A per-turn
* `model` IS delivered, because `onPrompt` receives the verbatim options and is free to honor it.
* Other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
*
* @experimental
*/
function inProcessSandboxClient(options) {
	const { onPrompt, workdir: workdirPrefix, id: idOption } = options;
	let seq = 0;
	return { async create(_options) {
		const current = seq++;
		const id = typeof idOption === "function" ? idOption(current) : idOption ?? `in-process-${current}`;
		const boxWorkdir = workdirPrefix !== void 0 ? mkdtempSync(join(tmpdir(), `${workdirPrefix}-`)) : void 0;
		let round = 0;
		const fsMembers = boxWorkdir !== void 0 ? {
			fs: {
				async read(path) {
					return readFile(join(boxWorkdir, path), "utf8");
				},
				async write(path, content) {
					const abs = join(boxWorkdir, path);
					await mkdir(dirname(abs), { recursive: true });
					await writeFile(abs, content, "utf8");
				}
			},
			async exec(command) {
				const { exec: execCb } = await import("node:child_process");
				const { promisify } = await import("node:util");
				const execAsync = promisify(execCb);
				try {
					const { stdout, stderr } = await execAsync(command, {
						cwd: boxWorkdir,
						timeout: 3e4
					});
					return {
						exitCode: 0,
						stdout,
						stderr
					};
				} catch (err) {
					const e = err;
					return {
						exitCode: e.code ?? 1,
						stdout: e.stdout ?? "",
						stderr: e.stderr ?? e.message ?? ""
					};
				}
			}
		} : {};
		async function* drive(behavior, message, opts) {
			const prompt = typeof message === "string" ? message : JSON.stringify(message);
			const { signal: optSignal, ...rest } = opts ?? {};
			const signal = optSignal ?? new AbortController().signal;
			const ctx = {
				round,
				workdir: boxWorkdir,
				signal,
				...Object.keys(rest).length > 0 ? { options: rest } : {}
			};
			round += 1;
			const produced = await behavior(prompt, ctx);
			if (isAsyncIterable(produced)) for await (const ev of produced) yield ev;
			else for (const ev of produced) yield ev;
		}
		return {
			id,
			streamPrompt(message, opts) {
				assertBoxlessPromptOptions(opts, "inProcessSandboxClient", ["backend"]);
				return drive(onPrompt, message, opts);
			},
			...fsMembers,
			async delete() {
				if (boxWorkdir !== void 0) rmSync(boxWorkdir, {
					recursive: true,
					force: true
				});
			}
		};
	} };
}
//#endregion
//#region src/runtime/observation-registry.ts
/** Adapt any Eval analyst registry, including recursive engines, to observation and harvesting. */
function observationFromRegistry(registry, options) {
	if (!["production", "search"].includes(options.proposalOrigin)) throw new TypeError("registry observation requires an explicit production or search origin");
	return async (input, context) => {
		const signals = [context.signal, options.runOptions?.signal].filter((signal) => signal !== void 0);
		const result = await registry.run(input.runId ?? randomUUID(), typeof options.inputs === "function" ? await options.inputs(input) : options.inputs, {
			...options.runOptions,
			...signals.length ? { signal: AbortSignal.any(signals) } : {}
		});
		const usage = {
			input: 0,
			output: 0,
			known: true
		};
		for (const analyst of result.per_analyst) {
			const receipt = analyst.usage;
			usage.input += receipt.tokens?.input ?? receipt.partialTokens?.input ?? 0;
			usage.output += receipt.tokens?.output ?? receipt.partialTokens?.output ?? 0;
			usage.known &&= receipt.tokens !== null && receipt.tokens.tokensKnown !== false && receipt.tokensEstimated !== true;
		}
		try {
			await options.record?.(result, input);
			const incomplete = result.per_analyst.filter((analyst) => analyst.status !== "ok");
			if (incomplete.length) throw new Error(incomplete.map((analyst) => `${analyst.analyst_id}: ${analyst.error?.message ?? analyst.reason ?? analyst.status}`).join("; "));
			const findings = result.findings.map((finding) => ({
				...finding,
				proposal_origin: options.proposalOrigin
			}));
			return {
				findings,
				report: renderReport(findings),
				usage
			};
		} catch (cause) {
			throw new ObservationError(cause instanceof Error ? cause.message : String(cause), usage, { cause });
		}
	};
}
//#endregion
//#region src/runtime/personify/analyst.ts
/**
* The diagnosis a combinator steers from must be TRACE-derived, never JUDGE-derived. A finding
* whose evidence is a judge/verdict score (an `EvidenceRef` of `kind:'metric'` with a
* verdict/judge/score uri scheme) would smuggle the external write-only judge back into steering —
* the one coupling the architecture forbids. This is a PROVENANCE check, not a content check:
* span/event/artifact/finding refs and empty-evidence findings are allowed; only a judge-scheme
* metric ref is rejected. Fail loud — a tainted finding aborts.
*/
const judgeEvidenceUri = /^(verdict|judge|score)\b/i;
/** Reject analyst findings derived from evaluation scores instead of execution traces. */
const assertTraceDerivedFindings = (findings) => {
	for (const f of findings) for (const ref of f.evidence_refs ?? []) if (ref.kind === "metric" && judgeEvidenceUri.test(ref.uri)) throw new PlannerError(`steer-firewall: finding ${stringifySafe(f.finding_id)} cites judge-derived evidence (${stringifySafe(ref.uri)}); findings fed to a combinator's steer decision must be trace-derived, not judge-derived (selector ≠ judge)`);
};
/**
* Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is
* metered by the conserved pool), drains its single settlement, and enforces the trace-derived
* firewall before returning. The `scope` is the SAME scope the combinator is draining its children
* from — the analyst is spawned as a sibling and its result is read off `scope.next()` in cursor
* order, replay-safe like any other child.
*
* Fail loud (no silent empty findings):
*  - the pool refuses the analyst spawn → `AnalystError` (the steer would otherwise run on nothing)
*  - the analyst settles `down` → `AnalystError` (a broken capture path, not a verdict)
*  - the analyst returns a non-array → `PlannerError`
*  - any finding cites judge-derived metric evidence → `PlannerError` via the firewall
*/
function createScopeAnalyst(scope, options) {
	if (!options.analyst || typeof options.analyst.act !== "function") throw new AnalystError("createScopeAnalyst: analyst must be an Agent with an act() method");
	const label = options.label ?? "analyst";
	return { async analyze(input) {
		const task = options.buildTask(input);
		const spawned = scope.spawn(options.analyst, task, {
			budget: options.budget,
			label
		});
		if (!spawned.ok) throw new AnalystError(`createScopeAnalyst: analyst spawn refused by the conserved pool (${spawned.reason}); cannot steer node ${stringifySafe(input.nodeId)} on an unrun analyst`);
		const findings = readAnalystFindings(await drainAnalystSettlement(scope, spawned.handle.id));
		assertTraceDerivedFindings(findings);
		return findings;
	} };
}
/**
* Drain `scope.next()` until the analyst child's own settlement is yielded, matching on its node
* id so an unrelated sibling that settles first is skipped, not mistaken for the analyst. A
* `ScopeAnalyst` is invoked AFTER a combinator has drained its workers, so in practice the analyst
* is the only live child; the id match keeps it correct even when it is not. Fails loud if the
* scope empties before the analyst settles (the steer would otherwise run on nothing).
*/
async function drainAnalystSettlement(scope, analystId) {
	for (;;) {
		const settled = await scope.next();
		if (settled === null) throw new AnalystError(`createScopeAnalyst: scope drained before analyst ${stringifySafe(analystId)} settled`);
		if (settled.handle.id === analystId) return settled;
	}
}
/**
* Read the analyst child's settlement into its `AnalystFinding[]`. A `down` analyst is a broken
* capture path (fail loud — not "no findings"); a `done` analyst whose `out` is not an array is a
* malformed analyst (fail loud — the dynamic driver's `runAnalyze` contract, carried across).
*/
function readAnalystFindings(settled) {
	if (settled.kind === "down") throw new AnalystError(`createScopeAnalyst: analyst ${stringifySafe(settled.handle.id)} settled down (${settled.infra ? "infra" : "result"}): ${stringifySafe(settled.reason)}`);
	const out = settled.out;
	if (!Array.isArray(out)) throw new PlannerError(`createScopeAnalyst: analyst ${stringifySafe(settled.handle.id)} must return AnalystFinding[], got ${stringifySafe(out)}`);
	return out;
}
/**
* A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges
* N analyst KINDS into one `AnalystRunResult.findings`; `analyze` runs it over the caller-projected
* `{ runId, inputs }` and pipes the merged findings through the SAME `assertTraceDerivedFindings`
* firewall `createScopeAnalyst` uses (single-sourced selector≠judge). Distinct from `panel()`
* (judges-vs-one-artifact) — this is analysts-over-a-trace, the diagnosis side of the wire.
*
* Fail loud: a registry that throws propagates; a judge-derived finding aborts via the firewall.
* The projection is the caller's (`buildInputs`) — if the scope settlements do not cleanly map to
* the registry's `AnalystRunInputs`, that is a caller-side contract gap, surfaced there, not papered
* over with a fabricated input here.
*/
function registryScopeAnalyst(registry, buildInputs) {
	return { async analyze(input) {
		const projection = buildInputs(input);
		const findings = (await registry.run(projection.runId, projection.inputs, projection.opts)).findings;
		assertTraceDerivedFindings(findings);
		return findings;
	} };
}
/**
* Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any
* future steer). One place enforces the firewall: `findings` is asserted trace-derived before it is
* surfaced, and `lastValidScore` is provided for OBSERVABILITY only — a combinator that steers off
* it re-introduces selector = judge, the coupling the architecture forbids.
*
* `findings` is re-asserted here even when it came from `createScopeAnalyst` (which already asserted
* it): the assertion is cheap and idempotent, and a `SteerContext` may be built from findings that
* arrived by another path (a caller-supplied diagnosis). Belt-and-suspenders on the one coupling
* that must never leak.
*/
function buildSteerContext(findings, settledSoFar) {
	assertTraceDerivedFindings(findings);
	const lastValidScore = observedBestScore(settledSoFar);
	return {
		findings,
		settledSoFar,
		...lastValidScore !== void 0 ? { lastValidScore } : {}
	};
}
/**
* The best valid score among the drained children — OBSERVABILITY ONLY. Read for rendering/traces,
* never to make a steer decision (that is the selector = judge coupling). Reads `verdict.score` off
* `done` settlements whose verdict is `valid`; a `down` child carries no verdict and contributes
* nothing.
*/
function observedBestScore(settledSoFar) {
	let best;
	for (const s of settledSoFar) {
		if (s.kind !== "done") continue;
		const v = s.verdict;
		if (v?.valid !== true || typeof v.score !== "number") continue;
		if (best === void 0 || v.score > best) best = v.score;
	}
	return best;
}
//#endregion
//#region src/runtime/personify/combinators.ts
/**
*
* The generic combinator library — the content-free act-bodies the wave's §1 contract froze.
*
* Each export is a `CombinatorShape<Task, D>` (an alias of `LoopShape<Task, D>`): a factory
* `(ShapeContext) => Agent<Task, Outcome<D>>` whose `act` runs ONE composition shape over the
* keystone `Scope` — spawn children through `ctx.spawnChild` + `scope.spawn`, drain settlements
* via `scope.next()`, select across `done` children with the SINGLE-SOURCED `settledToIteration`
* + `defaultSelectWinner` (selector≠judge — never a re-rank behind the driver), and synthesize a
* terminal `Outcome<D>`.
*
* The shapes carry NO domain: a "research sweep over angles" is `fanout(angles, { synthesize })`
* under a research persona; a "code build test" is `pipeline([plan, implement, integrate])` under
* a coder persona. The SHAPE is here; the model/prompt/role/goal live on the `Persona` + task,
* threaded to each child verbatim by the spec-objects the builders take. No model name, prompt,
* role, or domain noun appears below.
*
* Two fail-loud invariants every combinator honors: a child the conserved pool cannot admit is a
* CONCRETE blocker (never an eager over-fan, never a silent drop), and a `blocked` outcome always
* names at least one blocker (a shape that cannot finish MUST say why — `blocked([])` throws).
*
* @stable
*/
/**
* The single content-free valid-only winner selector. Among the gated-VALID children only
* (`verdict.valid === true`), pick by `strategy` — best score / smallest delivered artifact /
* earliest — ties broken by earliest index; returns `undefined` when NONE is valid (an ungated
* output can never win — the deliverable gate is the point). `sizeOf` (for `'smallest-artifact'`)
* reads the child's settled deliverable — the raw value a leaf settles, or the unwrapped `Outcome<D>`
* a delegate path produces; a domain passes e.g. patch diff-lines. This is the de-duplicated home of
* the selection logic previously copied per role.
*/
function selectValidWinner(opts) {
	const strategy = opts?.strategy ?? "highest-score";
	const sizeOfIter = (iter) => {
		const out = iter.output;
		if (out === void 0 || opts?.sizeOf === void 0) return Number.POSITIVE_INFINITY;
		const deliverable = out.kind === "done" ? out.deliverable : out;
		return opts.sizeOf(deliverable);
	};
	return (iterations) => {
		const valid = iterations.filter((iter) => iter.output !== void 0 && !iter.error && iter.verdict?.valid === true);
		if (valid.length === 0) return void 0;
		switch (strategy) {
			case "first-valid": return [...valid].sort((a, b) => a.index - b.index)[0];
			case "smallest-artifact": return [...valid].sort((a, b) => sizeOfIter(a) - sizeOfIter(b) || a.index - b.index)[0];
			default: return [...valid].sort((a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.index - b.index)[0];
		}
	};
}
/**
* `pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the
* next stage's task. The first stage that ends `blocked` (a child that went down, a child the
* pool would not admit, or a stage whose `collect` chose to block) short-circuits — its blockers
* ARE the pipeline's blockers, never coerced past a failed stage. The terminal stage's `done`
* deliverable is the pipeline's deliverable.
*
* @stable
*/
function pipeline(stages) {
	if (stages.length === 0) throw new ValidationError("pipeline: at least one stage is required");
	return (ctx) => ({
		name: `${ctx.persona.name}/pipeline`,
		async act(task, scope) {
			let carry = task;
			for (const stage of stages) {
				const child = ctx.spawnChild(stage.label, ctx.persona.root);
				const res = scope.spawn(child, stage.feed(carry, ctx, task), {
					budget: ctx.budget.perChild,
					label: stage.label
				});
				if (!res.ok) return blocked([`${stage.label}: not admitted (${res.reason})`]);
				const settled = await drainOne(scope, stage.label);
				const out = stage.collect(settled);
				if (out.kind === "blocked") return out;
				carry = out.deliverable;
			}
			return {
				kind: "done",
				deliverable: carry
			};
		}
	});
}
/**
* `fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved
* pool's fail-closed admission), drain via `scope.next()`, then either synthesize over the
* gathered settlements (one SEPARATE synthesis child) or return the best-valid child via the
* single-sourced selector. A round that admitted zero children, or whose synthesis child could
* not be admitted, is a concrete blocker.
*
* `opts.width` swaps the single round for `rollingDispatch`: at most `width` items live at once,
* refilled the instant one settles. Selection, blockers, and the conserved pool are unchanged —
* the refill behavior lives in the existing combinator rather than in a rival primitive.
*
* @stable
*/
function fanout(items, opts) {
	if (opts.synthesize && opts.selectWinner) throw new ValidationError("fanout: pass at most one of `synthesize` or `selectWinner`");
	return (ctx) => ({
		name: `${ctx.persona.name}/fanout`,
		async act(_task, scope) {
			const rejected = [];
			const unitAt = (i) => {
				const item = items[i];
				if (item === void 0) return void 0;
				const label = opts.label ? opts.label(item, i) : `item:${i}`;
				const spec = opts.itemSpec ? opts.itemSpec(item, i, ctx) : ctx.persona.root;
				return {
					agent: ctx.spawnChild(label, spec),
					task: opts.itemTask(item, i, ctx),
					opts: {
						budget: ctx.budget.perChild,
						label
					}
				};
			};
			let opened = 0;
			let drained;
			if (opts.width !== void 0) {
				let next = 0;
				const report = await rollingDispatch(scope, {
					width: opts.width,
					nextUnit: () => {
						const unit = unitAt(next);
						next += 1;
						return unit;
					}
				});
				opened = report.admitted;
				for (const r of report.rejected) {
					const [label, reason] = splitOnce(r, ": ");
					rejected.push(`${label}: not admitted (${reason})`);
				}
				drained = projectDrain(report.settled);
			} else {
				for (let i = 0; i < items.length; i += 1) {
					const unit = unitAt(i);
					if (unit === void 0) continue;
					const res = scope.spawn(unit.agent, unit.task, unit.opts);
					if (res.ok) opened += 1;
					else rejected.push(`${unit.opts.label}: not admitted (${res.reason})`);
				}
				drained = opened === 0 ? emptyRound() : await drain$1(scope);
			}
			if (opened === 0) return blocked(rejected.length > 0 ? rejected : ["fanout: budget admitted no item (fanout fully rejected)"]);
			if (drained.done.length === 0) return blocked(orderedBlockers(drained.blockers, rejected, "fanout: every item settled without a usable result"));
			if (!opts.synthesize) {
				const winner = (opts.selectWinner ?? defaultSelectWinner)(drained.iterations);
				if (!winner || winner.output === void 0) return blocked(orderedBlockers(drained.blockers, rejected, "fanout: no item survived selection"));
				return {
					kind: "done",
					deliverable: winner.output
				};
			}
			const synthLabel = "synthesize";
			const synthChild = ctx.spawnChild(synthLabel, ctx.persona.root);
			const synthRes = scope.spawn(synthChild, opts.synthesize.synthesisTask(drained.done, ctx), {
				budget: ctx.budget.perChild,
				label: synthLabel
			});
			if (!synthRes.ok) return blocked([...drained.blockers, `${synthLabel}: not admitted (${synthRes.reason})`]);
			const synthSettled = await drainOne(scope, synthLabel);
			const out = opts.synthesize.collect(synthSettled);
			if (out.kind === "blocked") return out;
			return out;
		}
	});
}
/**
* `loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into
* the running state; `until` (reading the round's trace findings, NOT a fresh raw verdict) is
* the deployable stop. The conserved pool IS the loop bound: once `spawn` fails closed the loop
* stops. A loop that exhausted the pool without `until` ever satisfying is a concrete blocker.
*
* When `ctx.analyst` is set, each round runs it over the children settled so far and steers
* `until` on the resulting trace-derived findings (the analyst spawns into THIS scope, so its
* compute is conserved-pooled — equal-k holds by construction). Absent an analyst the findings
* argument is the empty array — never a fabricated finding (fail-loud honesty over a silent default).
*
* @stable
*/
function loopUntil(seed, spec) {
	return (ctx) => ({
		name: `${ctx.persona.name}/loopUntil`,
		async act(task, scope) {
			let state = {
				round: 0,
				value: seed
			};
			const blockers = [];
			const settledSoFar = [];
			for (;;) {
				const label = spec.label ? spec.label(state.round) : `step:${state.round}`;
				const child = ctx.spawnChild(label, ctx.persona.root);
				const res = scope.spawn(child, spec.step(task, state, ctx), {
					budget: ctx.budget.perChild,
					label
				});
				if (!res.ok) {
					if (state.round === 0) return blocked([`${label}: not admitted (${res.reason})`]);
					break;
				}
				const settled = await drainOne(scope, label);
				if (settled.kind === "down") blockers.push(blockerFromDown(settled));
				settledSoFar.push(settled);
				state = spec.fold(state, settled);
				const findings = ctx.analyst ? await ctx.analyst.analyze({
					task,
					settledSoFar,
					nodeId: scope.view.root
				}) : [];
				const reached = spec.until(state, findings);
				if (reached) return reached;
				state = {
					round: state.round + 1,
					value: state.value
				};
			}
			return blocked(blockers.length > 0 ? blockers : ["loopUntil: budget exhausted before the satisfiability gate was reached"]);
		}
	});
}
/**
* `panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements,
* and fold them into a panel verdict via the pure WRITE-ONLY `merge` (a judge's output never
* reaches another judge's task; the merge never spawns or re-ranks). A `down` judge carries no
* verdict and is excluded from the merge denominator. A panel that admitted no judge is a
* concrete blocker before `merge` is consulted.
*
* @stable
*/
function panel(spec) {
	if (spec.judges.length === 0) throw new ValidationError("panel: at least one judge is required");
	return (ctx) => ({
		name: `${ctx.persona.name}/panel`,
		async act(task, scope) {
			const artifact = task;
			const byLabel = /* @__PURE__ */ new Map();
			const rejected = [];
			let opened = 0;
			for (const judge of spec.judges) {
				const child = ctx.spawnChild(judge.label, ctx.persona.root);
				const res = scope.spawn(child, spec.judgeTask(artifact, judge, ctx), {
					budget: ctx.budget.perChild,
					label: judge.label
				});
				if (res.ok) {
					byLabel.set(judge.label, judge);
					opened += 1;
				} else rejected.push(`${judge.label}: not admitted (${res.reason})`);
			}
			if (opened === 0) return blocked(rejected.length > 0 ? rejected : ["panel: budget admitted no judge"]);
			const verdicts = [];
			for (let s = await scope.next(); s !== null; s = await scope.next()) {
				const judge = byLabel.get(s.handle.label);
				if (!judge) throw new ValidationError(`panel: settled child "${s.handle.label}" has no judge descriptor`);
				if (s.kind === "down") {
					verdicts.push({
						judge,
						down: true
					});
					continue;
				}
				verdicts.push({
					judge,
					down: false,
					...s.verdict ? { verdict: s.verdict } : {},
					output: s.out
				});
			}
			return spec.merge(verdicts, artifact);
		}
	});
}
/**
* `verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades
* it; only a `valid` verifier verdict ships. Any other outcome (implement down, verifier down,
* verifier verdict absent or not `valid`) is a concrete blocker carrying the failure verbatim —
* never a coerced "done". The implement child does not grade itself.
*
* @stable
*/
function verify(spec) {
	return (ctx) => ({
		name: `${ctx.persona.name}/verify`,
		async act(task, scope) {
			const implementLabel = spec.implementLabel ?? "implement";
			const implChild = ctx.spawnChild(implementLabel, ctx.persona.root);
			const implRes = scope.spawn(implChild, spec.implement(task, ctx), {
				budget: ctx.budget.perChild,
				label: implementLabel
			});
			if (!implRes.ok) return blocked([`${implementLabel}: not admitted (${implRes.reason})`]);
			const candidate = await drainOne(scope, implementLabel);
			if (candidate.kind === "down") return blocked([blockerFromDown(candidate)]);
			const verifierLabel = spec.verifierLabel ?? "verify";
			const verifierChild = ctx.spawnChild(verifierLabel, ctx.persona.root);
			const verifierRes = scope.spawn(verifierChild, spec.verifier(candidate, ctx), {
				budget: ctx.budget.perChild,
				label: verifierLabel
			});
			if (!verifierRes.ok) return blocked([`${verifierLabel}: not admitted (${verifierRes.reason})`]);
			const gate = await drainOne(scope, verifierLabel);
			if (gate.kind === "down") return blocked([blockerFromDown(gate)]);
			if (gate.verdict?.valid !== true) return blocked([`${verifierLabel}: gate rejected the candidate (${verdictDetail(gate)})`]);
			return spec.collect(candidate, gate.verdict);
		}
	});
}
/**
* `widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS
* to each `scope.next()`: on every settled child it consults `spec.gate.decide` and, when the gate
* returns `widen`, spawns AT MOST ONE more child toward the chosen lineage under the remaining
* conserved pool. `promising` is derived from the round's trace findings (the analyst seam),
* never a child's raw `verdict` — and the default gate (`flatWidenGate`) never widens, so the R2
* firewall stays dormant. Terminal selection is `spec.synthesize` over every settled lineage.
*
* When `ctx.analyst` is set, `decide` is consulted with that round's trace-derived findings;
* absent an analyst the findings argument is the empty array a flat gate ignores. The analyst
* spawns into THIS scope (conserved-pooled, so equal-k holds). Streaming caveat: a wired analyst
* drains its own child off the SHARED cursor by id-match, so on a NON-flat gate (which spawns
* widen children that are live concurrently) the analyst can consume a sibling's settlement before
* the widen loop sees it. The shipped default (`flatWidenGate`) never widens, so no widen child is
* ever live when the analyst runs and the wire is exact; a non-flat gate must drive the analyst on
* a scope whose siblings are quiesced, or read findings without the shared-cursor drain.
*
* @stable
*/
function widen(spec) {
	return (ctx) => ({
		name: `${ctx.persona.name}/widen`,
		async act(_task, scope) {
			let opened = 0;
			for (const [i, seed] of spec.seeds.entries()) {
				const label = `seed:${i}`;
				const child = ctx.spawnChild(label, ctx.persona.root);
				if (scope.spawn(child, spec.seedTask(seed, i, ctx), {
					budget: ctx.budget.perChild,
					label
				}).ok) opened += 1;
			}
			if (opened === 0) return blocked(["widen: budget admitted no seed lineage"]);
			const gathered = [];
			let widenIndex = 0;
			for (let s = await scope.next(); s !== null; s = await scope.next()) {
				gathered.push(s);
				const findings = ctx.analyst ? await ctx.analyst.analyze({
					task: _task,
					settledSoFar: gathered,
					nodeId: scope.view.root
				}) : [];
				const decision = spec.gate.decide(s, findings, scope.budget);
				if (decision.kind !== "widen") continue;
				const label = `widen:${widenIndex}`;
				widenIndex += 1;
				const child = ctx.spawnChild(label, ctx.persona.root);
				scope.spawn(child, spec.widenTask(decision.toward, ctx), {
					budget: ctx.budget.perChild,
					label
				});
			}
			const done = gathered.filter(isDone);
			if (done.length === 0) return blocked(orderedBlockers(gathered.filter(isDown).map(blockerFromDown), [], "widen: every lineage settled without a usable result"));
			return spec.synthesize(done, ctx);
		}
	});
}
/**
* The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision
* dormant. A gate run passes this explicitly; a test asserts the default is flat.
*/
function flatWidenGate() {
	return { decide() {
		return { kind: "stop" };
	} };
}
function emptyRound() {
	return {
		iterations: [],
		done: [],
		blockers: []
	};
}
/** Fold an already-collected settlement list into the same shape `drain` produces, so the rolling
*  dispatch path and the batch path hand identical evidence to selection/synthesis. */
function projectDrain(settled) {
	const round = emptyRound();
	for (const s of settled) {
		if (s.kind === "down") {
			round.blockers.push(blockerFromDown(s));
			continue;
		}
		round.iterations.push(settledToIteration(s));
		round.done.push(s);
	}
	return round;
}
/** Split on the FIRST occurrence of `sep`, keeping any later occurrences in the tail — a reason
*  string may itself contain the separator. */
function splitOnce(text, sep) {
	const at = text.indexOf(sep);
	if (at < 0) return [text, ""];
	return [text.slice(0, at), text.slice(at + sep.length)];
}
async function drain$1(scope) {
	const iterations = [];
	const done = [];
	const blockers = [];
	for (let s = await scope.next(); s !== null; s = await scope.next()) {
		if (s.kind === "down") {
			blockers.push(blockerFromDown(s));
			continue;
		}
		iterations.push(settledToIteration(s));
		done.push(s);
	}
	return {
		iterations,
		done,
		blockers
	};
}
/**
* Drain exactly one settlement off a scope whose prior children are fully drained, so `next()`
* yields precisely the child just spawned. Fail loud if it yields nothing — a spawned child that
* never settles is a keystone invariant violation, not a result the combinator may swallow.
*/
async function drainOne(scope, label) {
	const s = await scope.next();
	if (s === null) throw new ValidationError(`combinator: child "${label}" was spawned but never settled`);
	return s;
}
function isDone(s) {
	return s.kind === "done";
}
function isDown(s) {
	return s.kind === "down";
}
function blockerFromDown(s) {
	return `${s.handle.label}: ${s.infra ? "infra" : "failed"} — ${s.reason}`;
}
function verdictDetail(s) {
	if (!s.verdict) return "no verdict";
	return s.verdict.notes ?? `score ${s.verdict.score}`;
}
/** Compose the round's drained blockers + rejected-admission reasons, falling back to a named
*  default ONLY when neither produced a reason — a `blocked` outcome must never be vacuous. */
function orderedBlockers(drained, rejected, fallback) {
	const all = [...drained, ...rejected];
	return all.length > 0 ? all : [fallback];
}
/** Build a `blocked` outcome, failing loud on the empty-blocker contract violation (a shape that
*  cannot finish MUST name at least one concrete blocker — never a vacuous block). */
function blocked(blockers) {
	if (blockers.length === 0) throw new ValidationError("combinator: a blocked outcome must name at least one blocker");
	return {
		kind: "blocked",
		blockers
	};
}
//#endregion
//#region src/runtime/personify/corpus.ts
const corpusSchemaVersion = "1.0.0";
/**
* Assert a value is a well-formed `CorpusRecord`. A PROVENANCE-and-shape check: every
* identity/render-gating field must be present and typed, `confidence` must be a finite 0..1,
* `evidence` (when present) must be `{ kind, uri }[]`. Throws on any violation — a corpus that
* silently accepted a malformed fact would project garbage into a future run's prompt. The
* thrown message names the offending field so a bad on-disk line is diagnosable.
*/
function assertCorpusRecord(value, where) {
	if (typeof value !== "object" || value === null) throw new Error(`${where}: corpus record is not an object`);
	const r = value;
	if (r.schemaVersion !== corpusSchemaVersion) throw new Error(`${where}: corpus record schemaVersion '${String(r.schemaVersion)}' != '${corpusSchemaVersion}'`);
	requireNonEmptyString(r.id, `${where}.id`);
	requireNonEmptyString(r.runId, `${where}.runId`);
	requireNonEmptyString(r.producedAt, `${where}.producedAt`);
	requireNonEmptyString(r.area, `${where}.area`);
	requireNonEmptyString(r.claim, `${where}.claim`);
	if (r.rationale !== void 0 && typeof r.rationale !== "string") throw new Error(`${where}.rationale: expected string, got ${typeof r.rationale}`);
	if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== "string")) throw new Error(`${where}.tags: expected string[]`);
	if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence)) throw new Error(`${where}.confidence: expected a finite number, got ${String(r.confidence)}`);
	if (r.confidence < 0 || r.confidence > 1) throw new Error(`${where}.confidence: ${r.confidence} is outside the [0, 1] range`);
	if (r.evidence !== void 0) {
		if (!Array.isArray(r.evidence)) throw new Error(`${where}.evidence: expected an array`);
		for (let i = 0; i < r.evidence.length; i++) {
			const ev = r.evidence[i];
			if (typeof ev !== "object" || ev === null) throw new Error(`${where}.evidence[${i}]: not an object`);
			requireNonEmptyString(ev.kind, `${where}.evidence[${i}].kind`);
			requireNonEmptyString(ev.uri, `${where}.evidence[${i}].uri`);
		}
	}
}
function requireNonEmptyString(value, where) {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${where}: expected a non-empty string, got ${describe(value)}`);
}
function describe(value) {
	if (value === void 0) return "undefined";
	if (value === null) return "null";
	if (typeof value === "string") return `'${value}'`;
	return typeof value;
}
/**
* Two records collide IFF they share an `id`. An append under an already-stored `id` is idempotent
* only when the new record is byte-identical to the stored one (same fact, re-learned); any other
* field differing under the same `id` is a CONFLICT — a typed-error append, never a silent
* overwrite. The identity field is `id`; the producer mints it over its identity-defining fields
* (claim + tags) so a re-learned fact dedups.
*/
function recordsEqual(a, b) {
	return stableStringify(a) === stableStringify(b);
}
function stableStringify(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	return `{${Object.entries(value).filter(([, v]) => v !== void 0).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
/**
* Apply a `CorpusFilter` as an AND-narrowing over a record list and sort most-confident first
* (ties → most-recent `producedAt`, so the freshest of two equally-confident facts wins). Pure —
* the in-mem and file impls both route their reads through this so query semantics are
* single-sourced. An empty result is valid (not an error).
*/
function applyFilter(records, filter) {
	const ordered = [...records.filter((r) => {
		if (filter.area !== void 0 && r.area !== filter.area) return false;
		if (filter.runId !== void 0 && r.runId !== filter.runId) return false;
		if (filter.minConfidence !== void 0 && r.confidence < filter.minConfidence) return false;
		if (filter.tags !== void 0 && !filter.tags.every((t) => r.tags.includes(t))) return false;
		return true;
	})].sort((a, b) => b.confidence !== a.confidence ? b.confidence - a.confidence : b.producedAt < a.producedAt ? -1 : b.producedAt > a.producedAt ? 1 : 0);
	if (filter.limit !== void 0) {
		if (!Number.isInteger(filter.limit) || filter.limit < 0) throw new Error(`corpus query: filter.limit must be a non-negative integer, got ${filter.limit}`);
		return ordered.slice(0, filter.limit);
	}
	return ordered;
}
/**
* In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an
* identical re-append, and returns a typed `{ succeeded: false }` on a conflicting re-append under
* the same `id` (never overwrites). `query` routes through the single-sourced `applyFilter`.
*/
var InMemoryCorpus = class {
	byId = /* @__PURE__ */ new Map();
	async append(record) {
		let snapshot;
		try {
			assertCorpusRecord(record, "append: record");
			snapshot = detachedFrozen(record);
		} catch (err) {
			return {
				succeeded: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}
		const existing = this.byId.get(snapshot.id);
		if (existing) {
			if (recordsEqual(existing, snapshot)) return { succeeded: true };
			return {
				succeeded: false,
				error: `corpus conflict: id '${record.id}' is already stored with a different record; a learned fact is append-only — re-mint the id or reconcile before re-appending`
			};
		}
		this.byId.set(snapshot.id, snapshot);
		return { succeeded: true };
	}
	async query(filter) {
		return applyFilter([...this.byId.values()], filter);
	}
};
/**
* JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole
* file, validating every line (a malformed line fails loud — a corrupted corpus must never read
* back silently) and folding by `id`: a later identical line dedups, a later conflicting line
* under the same `id` is a corruption (fail loud). `append` first replays to enforce the same
* idempotence/conflict contract as the in-mem impl, then fsyncs the new line so a crash between
* writes never loses an acknowledged fact. Reads and appends over the shared append-only
* spine (`durable/jsonl-file`) — the same one the spawn journal uses — but the interface stays
* separate (a learned fact is not a replay record).
*/
var FileCorpus = class {
	path;
	constructor(path) {
		this.path = path;
	}
	async append(record) {
		try {
			assertCorpusRecord(record, "append: record");
			const snapshot = detachedFrozen(record);
			const fs = await import("node:fs/promises");
			const { dirname } = await import("node:path");
			const { tryAcquireAtomicFileLock } = await import("@tangle-network/agent-eval/ledger-core");
			await fs.mkdir(dirname(this.path), { recursive: true });
			await (await fs.open(this.path, "a")).close();
			const canonicalPath = await fs.realpath(this.path);
			const deadline = Date.now() + 5e3;
			for (;;) {
				const acquisition = tryAcquireAtomicFileLock({ lockPath: `${canonicalPath}.lock` });
				if (!acquisition.acquired) {
					if (Date.now() >= deadline) throw new Error(`corpus append lock unavailable after 5000ms: ${canonicalPath}`);
					await new Promise((resolve) => setTimeout(resolve, 25));
					continue;
				}
				try {
					const existing = (await this.load(canonicalPath)).get(snapshot.id);
					if (existing) {
						if (recordsEqual(existing, snapshot)) return { succeeded: true };
						return {
							succeeded: false,
							error: `corpus conflict: id '${snapshot.id}' is already stored in ${canonicalPath} with a different record; a learned fact is append-only — re-mint the id or reconcile before re-appending`
						};
					}
					await this.appendLine(canonicalPath, snapshot);
					return { succeeded: true };
				} finally {
					acquisition.lock.release();
				}
			}
		} catch (err) {
			return {
				succeeded: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	}
	async query(filter) {
		return applyFilter([...(await this.load()).values()], filter);
	}
	async load(path = this.path) {
		const byId = /* @__PURE__ */ new Map();
		let recordNumber = 0;
		for await (const parsed of readCommittedJsonLines(path, { allowMissing: true })) {
			assertCorpusRecord(parsed, `corpus ${this.path} line ${++recordNumber}`);
			const existing = byId.get(parsed.id);
			if (existing && !recordsEqual(existing, parsed)) throw new Error(`corpus corrupted: ${this.path} has two different records for id '${parsed.id}'; an append-only corpus must never hold a conflicting re-append under one id`);
			byId.set(parsed.id, detachedFrozen(parsed));
		}
		return byId;
	}
	async appendLine(path, record) {
		const fs = await import("node:fs/promises");
		const needsSeparator = await prepareJsonlAppend(path);
		const fh = await fs.open(path, "a");
		try {
			await writeAllBytes(fh, `${needsSeparator ? "\n" : ""}${JSON.stringify(record)}\n`);
			await fh.sync();
		} finally {
			await fh.close();
		}
	}
};
/**
* The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts
* (most-confident first, capped by `maxLines`) into instruction lines, and returns a FRESH
* `AgentProfile` with them merged in — never mutates the input profile. Default `target: 'prompt'`
* appends the lines to `prompt.instructions[]` (the additive append-line seam); `target:
* 'resources'` folds them into the single-blob `resources.instructions` string (preserving any
* existing blob, but failing loud on a non-string existing blob — a `resources.instructions` that
* was already an `AgentProfileResourceRef` cannot be string-appended without dropping it).
*
* An empty query result returns a fresh COPY of the profile with no instruction change (a valid
* "nothing learned yet" read, not an error).
*/
async function renderCorpusToInstructions(opts) {
	const { corpus, filter, profile, target = "prompt", maxLines } = opts;
	if (maxLines !== void 0 && (!Number.isInteger(maxLines) || maxLines < 0)) throw new Error(`renderCorpusToInstructions: maxLines must be a non-negative integer, got ${maxLines}`);
	const matched = await corpus.query(filter);
	const lines = (maxLines !== void 0 ? matched.slice(0, maxLines) : matched).map(renderLine);
	if (lines.length === 0) return structuredClone(profile);
	const next = structuredClone(profile);
	if (target === "resources") {
		const resources = next.resources ?? {};
		const prior = resources.instructions;
		if (prior !== void 0 && typeof prior !== "string") throw new Error("renderCorpusToInstructions: resources.instructions is an AgentProfileResourceRef, not a string; cannot string-append corpus facts without dropping the ref (pass target: 'prompt' or pre-resolve the ref)");
		const blob = [prior, ...lines].filter((s) => typeof s === "string" && s.length > 0);
		next.resources = {
			...resources,
			instructions: blob.join("\n")
		};
		return next;
	}
	const prompt = next.prompt ?? {};
	next.prompt = {
		...prompt,
		instructions: [...prompt.instructions ?? [], ...lines]
	};
	return next;
}
/** One corpus fact → one instruction line. The claim is the line; a rationale (when present) is
*  appended in parentheses so a reader sees the why without a second line. Content-only — no
*  metric/score/verdict text is synthesized (the corpus holds facts, not selector evidence). */
function renderLine(record) {
	return record.rationale ? `${record.claim} (${record.rationale})` : record.claim;
}
//#endregion
//#region src/runtime/personify/registry.ts
/**
*
* The loop-shape registry — the OPEN, content-free extension point for the personify layer.
*
* A `LoopShape` is reusable STRUCTURE (how to decompose / fan out / verify / synthesize),
* parameterized by a persona's CONTENT. The registry lets a caller resolve a composed shape by
* NAME: register a factory once, then `runPersonified({ shape: '<name>' })` resolves it with zero
* edits elsewhere. `register` fails loud on a duplicate; `resolve` returns a typed outcome so an
* unknown name is a named error, never a silent default.
*
* No shape is pre-registered: the generic combinators (`pipeline`/`fanout`/`loopUntil`/`panel`/
* `verify`/`widen`) take spec arguments, so they are not bare zero-arg factories — a caller that
* wants name-resolution registers its own COMPOSED shape (a combinator already applied to its
* spec) on a registry instance. The registry carries SHAPE only; the domain lives on the persona.
*
* @experimental
*/
/**
* Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
* caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.
*/
function createShapeRegistry() {
	const shapes = /* @__PURE__ */ new Map();
	return {
		register(name, factory) {
			if (shapes.has(name)) throw new ValidationError(`shape registry: shape "${name}" already registered`);
			shapes.set(name, factory);
		},
		resolve(name) {
			const factory = shapes.get(name);
			if (!factory) return {
				succeeded: false,
				error: `shape registry: unknown shape "${name}"`
			};
			return {
				succeeded: true,
				value: factory
			};
		},
		names() {
			return [...shapes.keys()];
		}
	};
}
/** The default registry `runPersonified` resolves a shape name against. Empty by construction —
*  a caller registers its own composed shapes; the engine ships no domain shape. */
const builtinShapes = createShapeRegistry();
/** Register a composed shape on the default `builtinShapes` registry — the one-call extension
*  point a caller invokes so its shape is resolvable by name with zero edits to the engine. */
function registerShape(name, factory) {
	builtinShapes.register(name, factory);
}
//#endregion
//#region src/runtime/personify/persona.ts
/**
*
* The personify layer impl — `definePersona` (the thin builder) + `runPersonified` (composes
* the persona + chosen shape onto the keystone `Supervisor`), plus `createShapeContext`, the
* seam that hands a shape its spawn helpers without it touching the registry.
*
* This file adds NO engine: `runPersonified` is `createSupervisor().run(rootAgent, task, …)`
* where `rootAgent` is the persona's chosen `LoopShape` applied to a `ShapeContext`. All the
* conserved-budget / journal / abort / typed-result machinery is the keystone's; this layer
* only wires the persona's CONTENT (root spec + directive + context + seams) into it.
*
* One non-obvious invariant it must honor: `createSupervisor().run` builds the root `Scope`
* with an EMPTY seam bag (`seams: {}`), so the built-in metered runtimes (router/sandbox/cli)
* cannot read their seams off `ExecutorContext` through the default supervisor path. A persona
* that supplies raw `seams` is therefore wrapped here into a registry whose resolved factories
* receive a ctx with the persona seams merged in — so a persona never has to pre-close its
* factories by hand. A persona may instead supply a fully-built `registry` and skip the wrap.
*
* @stable
*/
/**
* Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with
* neither a pre-built registry nor a seam bag cannot resolve its built-in runtimes, so it is
* unrunnable — refuse it at definition time, not at the first spawn. Pure; no I/O.
*
* @stable
*/
function definePersona(input) {
	if (!input.executors.registry && !input.executors.seams) throw new ValidationError(`definePersona("${input.name}"): executors must supply a registry or a seams bag (built-in runtimes read their seams off ExecutorContext; neither was provided)`);
	if (!input.root || typeof input.root !== "object" || !("harness" in input.root)) throw new ValidationError(`definePersona("${input.name}"): root must be an AgentSpec`);
	const root = executableAgentSpecSnapshot(input.root, `definePersona("${input.name}")`);
	return Object.freeze({
		name: input.name,
		root,
		directive: input.directive,
		context: input.context,
		executors: input.executors,
		...input.extensions ? { extensions: input.extensions } : {}
	});
}
/**
* Build the `ShapeContext` a `LoopShape` factory consumes. `spawnChild` wraps an `AgentSpec`
* into a leaf `Agent` carrying it as `executorSpec` (the structural field `scope.spawn`
* reads); `childSpec` derives a narrower child spec from the persona's root by overriding the
* profile. The shape never touches the registry — resolution stays single-sourced in the
* scope/registry the supervisor owns.
*/
function createShapeContext(persona, budget, analyst) {
	return {
		persona,
		budget,
		...analyst ? { analyst } : {},
		spawnChild(name, spec) {
			return {
				name,
				executorSpec: spec,
				act() {
					throw new ValidationError(`personify: spawned child "${name}" was run directly; its executorSpec drives it (a leaf, or — for a driver child — a nested scope through the recursive driver-executor)`);
				}
			};
		},
		childSpec(profile, harness) {
			return {
				profile,
				harness: harness === void 0 ? persona.root.harness : harness,
				...persona.root.executor ? { executor: persona.root.executor } : {}
			};
		}
	};
}
/**
* Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape
* (a factory verbatim, or a registered name through `builtinShapes`), applies it to a
* `ShapeContext`, and runs the resulting root `Agent` to a typed `SupervisedResult<Outcome>`.
* Fail loud on an unknown shape name or an unresolvable persona registry — never a silent
* default-shape fallback.
*
* @stable
*/
async function runPersonified(options) {
	const { persona } = options;
	const shape = resolveShape(options.shape);
	const rootAgent = shape(createShapeContext(persona, resolveShapeBudget(options.budget, options.shapeBudget), options.analyst));
	const executors = personaRegistry(persona);
	const supervisor = createSupervisor();
	if (options.handle) supervisor.attach(options.handle);
	const supervisorOpts = {
		budget: options.budget,
		runId: options.runId ?? `${persona.name}:${shapeName(options.shape, shape)}`,
		journal: options.journal ?? new InMemorySpawnJournal(),
		blobs: options.blobs ?? new InMemoryResultBlobStore(),
		executors,
		...options.rootIdentity !== void 0 ? { rootIdentity: options.rootIdentity } : {},
		...options.maxDepth !== void 0 ? { maxDepth: options.maxDepth } : {},
		...options.workerSlots !== void 0 ? { workerSlots: options.workerSlots } : {},
		...options.maxRestarts !== void 0 ? { maxRestarts: options.maxRestarts } : {},
		...options.withinMs !== void 0 ? { withinMs: options.withinMs } : {},
		...options.teardownConfirmMs !== void 0 ? { teardownConfirmMs: options.teardownConfirmMs } : {},
		...options.resume !== void 0 ? { resume: options.resume } : {},
		...options.now ? { now: options.now } : {},
		...options.signal ? { signal: options.signal } : {},
		...options.hooks ? { hooks: options.hooks } : {}
	};
	return supervisor.run(rootAgent, options.task, supervisorOpts);
}
function resolveShape(shape) {
	if (typeof shape !== "string") return shape;
	const resolved = builtinShapes.resolve(shape);
	if (!resolved.succeeded) throw new ValidationError(`runPersonified: ${resolved.error} (registered: ${builtinShapes.names().join(", ")})`);
	return resolved.value;
}
function shapeName(shape, _resolved) {
	return typeof shape === "string" ? shape : shape.name || "shape";
}
/**
* Default the shape's per-child sizing + fanout width from the root budget when the caller
* omits them. The per-child token ceiling is the root divided across the fanout so the
* conserved pool can admit a full round; iterations default to the root's. A caller override
* wins per-field.
*/
function resolveShapeBudget(root, over) {
	const fanout = over?.fanout ?? defaultFanout;
	return {
		perChild: over?.perChild ?? {
			...root.resources === void 0 ? {} : { resources: Object.fromEntries(Object.entries(root.resources).map(([name, resource]) => [name, {
				...resource,
				limit: Math.floor(resource.limit / fanout)
			}])) },
			maxIterations: Math.max(1, Math.floor(root.maxIterations / fanout)),
			maxTokens: Math.max(1, Math.floor(root.maxTokens / fanout)),
			...root.maxUsd !== void 0 ? { maxUsd: root.maxUsd / fanout } : {},
			...root.deadlineMs !== void 0 ? { deadlineMs: root.deadlineMs } : {}
		},
		fanout
	};
}
const defaultFanout = 3;
/**
* Resolve the persona's executor resolution into a single `ExecutorRegistry`. A pre-built
* `registry` is used verbatim; otherwise the persona's raw `seams` are wrapped so resolved
* factories receive an `ExecutorContext` with the persona seams merged in — the supervisor
* threads an empty bag, so this is the one place the persona seams reach the built-ins.
*/
function personaRegistry(persona) {
	const { registry, seams } = persona.executors;
	if (registry) return withDriverExecutor(registry);
	if (!seams) throw new ValidationError(`personify: persona "${persona.name}" supplies neither a registry nor seams`);
	return withDriverExecutor(withSeams(createExecutorRegistry(), seams));
}
/**
* Wrap a registry so every resolved `ExecutorFactory` receives a ctx whose `seams` are
* the persona seams merged over whatever the scope threaded (the scope threads `{}`, so the
* persona seams win). A BYO `spec.executor` still resolves to a trivial factory that ignores
* ctx — so this wrap is transparent for BYO and only matters for the metered built-ins.
*/
function withSeams(base, seams) {
	return {
		register(runtime, factory) {
			base.register(runtime, factory);
		},
		resolve(spec) {
			const resolved = base.resolve(spec);
			if (!resolved.succeeded) return resolved;
			const inner = resolved.value;
			const wrapped = (s, ctx) => inner(s, mergeSeams(ctx, seams));
			return {
				succeeded: true,
				value: wrapped
			};
		}
	};
}
function mergeSeams(ctx, seams) {
	return {
		signal: ctx.signal,
		seams: {
			...seams,
			...ctx.seams
		}
	};
}
//#endregion
//#region src/runtime/personify/trajectory.ts
/**
*
* Trajectory trace + cost ledger — the post-hoc tree reconstructor (§4 of `wave-types`).
*
* `trajectoryReport` rebuilds the WHOLE realized spawn tree from the durable
* `SpawnJournal` (+ optionally the `ResultBlobStore` for `done` artifacts): every node
* (driver AND leaf), the real parent/child edges, each node's terminal status, its OWN
* conserved `Spend`, and the `Spend` ROLLED UP over its subtree. Roll-up is a post-order
* fold over the parent edges: a node's `rolledUpSpend` is its own spend plus every
* descendant's, so a driver is charged for the fanout it caused — the root's roll-up is
* the whole run's conserved total (tokens + usd + iterations + ms).
*
* `equalKOnCost` compares separate runs (arms) on that conserved COST, not on raw
* iteration COUNT. The sandbox executor reports tokens/usd INCLUSIVE of a leaf's internal
* sub-agent fanout, so charging an arm by `total.tokens`/`total.usd` (not by how many
* `next()` cursors it logged) closes the leaf-fanout confound: a treatment leaf that fanned
* out internally pays for it in cost, where a per-iteration count would hide it. The
* within-run conserved pool already guarantees `Σk` equal by construction; this check is the
* CROSS-run analogue the pool cannot reach — proving equal compute before any win is claimed.
*
* Pure over the journal/blobs — no live agent calls; safe to run on a finished run's log.
*
* @experimental
*/
const defaultEqualKTolerance = .05;
/**
* Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the
* journal for structure + spend and, when `withOutputs`, the blob store for each `done`
* node's artifact. Fail loud on a tree that was never journaled, a settle/cancel for an
* un-spawned node (a corrupted log), or — under `withOutputs` — a `done` node whose blob the
* store cannot rehydrate (a silent gap would mis-cost or mis-evidence the tree).
*/
async function trajectoryReport(journal, blobs, root, options = {}) {
	const events = await journal.loadTree(root);
	if (events === void 0) throw new Error(`trajectoryReport: no journaled tree for root '${root}'`);
	const spawns = events.filter(isNodeCreation).sort(bySeq);
	const closes = events.filter(insideCursorNamespace).sort(bySeq);
	const nodes = /* @__PURE__ */ new Map();
	for (const ev of spawns) nodes.set(ev.id, {
		id: ev.id,
		parent: ev.parent,
		label: ev.label,
		runtime: ev.kind === "waiting" ? "wait" : ev.runtime,
		status: ev.kind === "waiting" ? "waiting" : "pending",
		ownSpend: zeroSpend(),
		children: []
	});
	for (const ev of closes) {
		const node = requireNode(nodes, ev.id, root);
		if (ev.kind === "cancelled") {
			node.status = "cancelled";
			continue;
		}
		if (ev.kind === "woken") {
			node.status = ev.by === "cancelled" ? "cancelled" : "done";
			node.outRef = ev.outRef;
			continue;
		}
		node.status = ev.status === "done" ? "done" : "failed";
		node.ownSpend = cloneSpend(ev.spent);
		node.verdict = ev.verdict;
		node.outRef = ev.outRef;
	}
	for (const ev of events) {
		if (ev.kind !== "metered") continue;
		const node = requireNode(nodes, ev.id, root);
		node.ownSpend = addSpend(node.ownSpend, ev.spend);
	}
	if (!nodes.has(root)) throw new Error(`trajectoryReport: root '${root}' has no spawned event in its journaled tree (corrupted log)`);
	for (const ev of spawns) {
		if (ev.parent === void 0) continue;
		requireNode(nodes, ev.parent, root).children.push(ev.id);
	}
	const rolledUp = rollUpSpend(nodes, root);
	if (options.withOutputs) await attachOutputs(nodes, blobs);
	const reported = spawns.map((ev) => nodes.get(ev.id)).filter(isNode).map((node) => freezeNode(node, requireSpend(rolledUp, node.id, root)));
	return {
		root,
		nodes: reported,
		total: requireSpend(rolledUp, root, root),
		statusCounts: countStatuses(reported)
	};
}
/**
* Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration
* count. Compares each arm's root-rolled-up `total` on the two conserved channels: an arm is
* within-tolerance when the per-channel spread (max − min across arms) over the median is
* `≤ tolerance`. Pure over the reports — no I/O. Fails loud on an empty arm list (nothing to
* compare) so a vacuous "equal" is never returned.
*
* The token channel uses `chargedTokens`, the same unit the conserved pool spends, so the cross-run
* check and the within-run pool cannot disagree about what an arm cost. Charging the rolled-up
* prompt total instead would rate an arm by how often it re-read a cached prefix: two arms given
* identical work would read as unequal compute whenever their cache hit rates differed.
*/
function equalKOnCost(arms, options = {}) {
	if (arms.length === 0) throw new Error("equalKOnCost: no arms to compare");
	const tolerance = options.tolerance ?? defaultEqualKTolerance;
	const armCosts = arms.map((arm) => ({
		label: arm.label,
		tokens: chargedTokens(arm.report.total.tokens),
		usd: arm.report.total.usd,
		iterations: arm.report.total.iterations
	}));
	const tokenValues = armCosts.map((a) => a.tokens);
	const usdValues = armCosts.map((a) => a.usd);
	const spread = {
		tokens: spreadOf(tokenValues),
		usd: spreadOf(usdValues)
	};
	return {
		withinTolerance: fractionalSpread(tokenValues) <= tolerance && fractionalSpread(usdValues) <= tolerance,
		arms: armCosts,
		spread,
		tolerance
	};
}
/**
* Post-order fold: a node's rolled-up spend is its own spend plus every child's rolled-up
* spend. Iterative (an explicit stack) so a deep tree never overflows the call stack; a node
* is finalized only after all its children are, so the parent edges are honored exactly.
*/
function rollUpSpend(nodes, root) {
	const rolled = /* @__PURE__ */ new Map();
	const stack = [{
		id: root,
		expanded: false
	}];
	while (stack.length > 0) {
		const frame = stack.pop();
		if (frame === void 0) continue;
		const node = requireNode(nodes, frame.id, root);
		if (!frame.expanded) {
			stack.push({
				id: frame.id,
				expanded: true
			});
			for (const child of node.children) stack.push({
				id: child,
				expanded: false
			});
			continue;
		}
		let sum = cloneSpend(node.ownSpend);
		for (const child of node.children) sum = addSpend(sum, requireSpend(rolled, child, root));
		rolled.set(frame.id, sum);
	}
	return rolled;
}
/**
* Rehydrate each `done` node's artifact from the blob store. Fail loud on a `done` node whose
* blob the store cannot resolve — a missing payload under `withOutputs` is a corrupted store,
* not an absent output (a `down`/`cancelled` node legitimately has none).
*/
async function attachOutputs(nodes, blobs) {
	for (const node of nodes.values()) {
		if (node.status !== "done" || node.outRef === void 0) continue;
		const out = await blobs.get(node.outRef);
		if (out === void 0) throw new Error(`trajectoryReport: blob store has no artifact for outRef '${node.outRef}' (node '${node.id}')`);
		node.output = out;
	}
}
function freezeNode(node, rolledUpSpend) {
	return {
		id: node.id,
		parent: node.parent,
		children: [...node.children],
		label: node.label,
		runtime: node.runtime,
		status: node.status,
		ownSpend: node.ownSpend,
		rolledUpSpend,
		verdict: node.verdict,
		output: node.output,
		outRef: node.outRef
	};
}
function countStatuses(reported) {
	const counts = {
		done: 0,
		failed: 0,
		cancelled: 0,
		pending: 0,
		waiting: 0
	};
	for (const node of reported) counts[node.status] += 1;
	return counts;
}
function spreadOf(values) {
	if (values.length === 0) return 0;
	return Math.max(...values) - Math.min(...values);
}
/**
* Fractional spread on one channel: `(max − min) / median`. A zero-median channel (every arm
* spent zero on it) is trivially equal — spread is also zero, so it never trips the tolerance.
*/
function fractionalSpread(values) {
	const spread = spreadOf(values);
	if (spread === 0) return 0;
	const median = medianOf(values);
	if (median === 0) throw new Error("equalKOnCost: arms have a non-zero cost spread on a zero-median channel; cannot express it as a fraction");
	return spread / median;
}
function medianOf(values) {
	if (values.length === 0) throw new Error("equalKOnCost: cannot take the median of an empty channel");
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const hi = sorted[mid];
	if (sorted.length % 2 !== 0) return hi;
	return (sorted[mid - 1] + hi) / 2;
}
/** Node-CREATION events — a spawned child or an armed wait-state. Both mint a node in the
*  ordinal namespace; their settlements (`settled` / `woken`) close them in the cursor namespace. */
function isNodeCreation(ev) {
	return ev.kind === "spawned" || ev.kind === "waiting";
}
function isNode(node) {
	return node !== void 0;
}
function bySeq(a, b) {
	return a.seq - b.seq;
}
function requireNode(nodes, id, root) {
	const node = nodes.get(id);
	if (!node) throw new Error(`trajectoryReport: tree '${root}' references node '${id}' with no prior spawn (corrupted log)`);
	return node;
}
function requireSpend(rolled, id, root) {
	const spend = rolled.get(id);
	if (!spend) throw new Error(`trajectoryReport: node '${id}' was never rolled up in tree '${root}' (unreachable from root)`);
	return spend;
}
//#endregion
//#region src/runtime/promotion-gate.ts
/**
* promotionGate — the statistical promotion decision over a holdout benchmark: does the
* candidate strategy beat the incumbent on held-out tasks by a margin the task noise
* cannot fake? The statistics come from `heldoutSignificance`, which chooses the
* decision interval that matches the outcome shape, applies a minimum-evidence floor,
* and requires the interval's lower bound to clear `deltaThreshold`. A raw h1>h0 point
* comparison on m≈8 holdout tasks certifies false champions at near coin-flip rates.
*/
/** Statistical promotion decision over a holdout benchmark using the outcome-appropriate interval selected by `heldoutSignificance`. */
function promotionGate(opts) {
	const mode = opts.mode ?? "superiority";
	if (opts.candidate === opts.incumbent) return {
		promoted: false,
		reason: "identical-champion",
		mode,
		n: 0,
		lift: {
			mean: 0,
			median: 0,
			low: 0,
			high: 0
		}
	};
	const before = [];
	const after = [];
	const incUsd = [];
	const candUsd = [];
	const incMs = [];
	const candMs = [];
	const cellIds = [];
	/** Tasks where either arm's dollars were never measured — see the refusal below. */
	const costUnknownTasks = [];
	for (const row of opts.report.perTask) {
		const inc = row.cells?.[opts.incumbent];
		const cand = row.cells?.[opts.candidate];
		if (!inc || !cand) continue;
		before.push(inc.score);
		after.push(cand.score);
		incUsd.push(inc.usd);
		candUsd.push(cand.usd);
		if (inc.usdKnown === false || cand.usdKnown === false) costUnknownTasks.push(row.taskId);
		incMs.push(inc.ms);
		candMs.push(cand.ms);
		cellIds.push(row.taskId);
	}
	if (before.length === 0) throw new Error(`promotionGate: no holdout task carried cells for both "${opts.incumbent}" and "${opts.candidate}" — the report must come from a run that included both strategies`);
	const sig = heldoutSignificance({
		before,
		after,
		cellIds
	}, {
		deltaThreshold: opts.deltaThreshold ?? 0,
		minProductiveRuns: opts.minPairedTasks ?? 6,
		statistic: opts.statistic ?? "mean",
		...opts.seed !== void 0 ? { seed: opts.seed } : {},
		...opts.resamples !== void 0 ? { resamples: opts.resamples } : {}
	});
	const lift = {
		mean: sig.bootstrap.mean,
		median: sig.bootstrap.median,
		low: sig.decision.low,
		high: sig.decision.high
	};
	const latSig = heldoutSignificance({
		before: incMs,
		after: candMs,
		cellIds
	}, {
		deltaThreshold: 0,
		minProductiveRuns: 1,
		statistic: opts.statistic ?? "mean",
		...opts.seed !== void 0 ? { seed: opts.seed } : {},
		...opts.resamples !== void 0 ? { resamples: opts.resamples } : {}
	});
	const latency = {
		mean: latSig.bootstrap.mean,
		median: latSig.bootstrap.median,
		low: latSig.decision.low,
		high: latSig.decision.high
	};
	if (mode === "superiority") {
		if (sig.fewRuns) return {
			promoted: false,
			reason: "few-tasks",
			mode,
			n: sig.n,
			lift,
			latency
		};
		return sig.significant ? {
			promoted: true,
			reason: "significant",
			mode,
			n: sig.n,
			lift,
			latency
		} : {
			promoted: false,
			reason: "no-margin",
			mode,
			n: sig.n,
			lift,
			latency
		};
	}
	const tolerance = opts.scoreTolerance ?? .05;
	const scoreSig = heldoutSignificance({
		before,
		after,
		cellIds
	}, {
		deltaThreshold: -tolerance,
		minProductiveRuns: opts.minPairedTasks ?? 6,
		statistic: opts.statistic ?? "mean",
		...opts.seed !== void 0 ? { seed: opts.seed } : {},
		...opts.resamples !== void 0 ? { resamples: opts.resamples } : {}
	});
	if (costUnknownTasks.length > 0) return {
		promoted: false,
		reason: "cost-unknown",
		mode,
		n: before.length,
		lift,
		costUnknownTasks: [...costUnknownTasks],
		latency
	};
	const costSig = heldoutSignificance({
		before: candUsd,
		after: incUsd,
		cellIds
	}, {
		deltaThreshold: 0,
		minProductiveRuns: opts.minPairedTasks ?? 6,
		statistic: opts.statistic ?? "mean",
		...opts.seed !== void 0 ? { seed: opts.seed } : {},
		...opts.resamples !== void 0 ? { resamples: opts.resamples } : {}
	});
	const costSavings = {
		mean: costSig.bootstrap.mean,
		median: costSig.bootstrap.median,
		low: costSig.decision.low,
		high: costSig.decision.high
	};
	if (scoreSig.fewRuns) return {
		promoted: false,
		reason: "few-tasks",
		mode,
		n: scoreSig.n,
		lift,
		costSavings,
		latency
	};
	if (!scoreSig.significant) return {
		promoted: false,
		reason: "non-inferiority-unproven",
		mode,
		n: scoreSig.n,
		lift,
		costSavings,
		latency
	};
	if (!costSig.significant) return {
		promoted: false,
		reason: "not-cheaper",
		mode,
		n: scoreSig.n,
		lift,
		costSavings,
		latency
	};
	return {
		promoted: true,
		reason: "non-inferior-and-cheaper",
		mode,
		n: scoreSig.n,
		lift,
		costSavings,
		latency
	};
}
//#endregion
//#region src/runtime/run-benchmark.ts
/**
* runBenchmark — the packaged optimization suite. Define a domain by implementing an
* `Environment` (open / tools / call / score / close); get the optimization strategies
* compared, scored by your own deployable check, with a paired-bootstrap report — free.
*
* The mental model: you have a TASK + a deployable CHECK + a compute BUDGET. A strategy
* is how you spend the budget to beat the check. Two built-ins:
*
*   sample  — N independent attempts, keep the best-verifying one.   (best-of-N / resample)
*   refine  — attempt → a critic reads the trace → steer the next → repeat. (iterate-with-feedback)
*
* Both run at equal budget through the Supervisor's conserved pool; the headline is the
* paired lift of refine over sample. Author your own strategy with `defineStrategy`.
*/
/** Bounded-concurrency map preserving order. */
async function pool(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (next < items.length) {
			const i = next;
			next += 1;
			out[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return out;
}
async function preflightModels(cfg) {
	if (cfg.modelPreflight === false) return;
	if (cfg.worker.complete && !cfg.modelPreflight) return;
	const profiles = [cfg.worker.workerProfile, cfg.worker.analystProfile ?? cfg.worker.workerProfile];
	const profilesByModel = /* @__PURE__ */ new Map();
	for (const [index, profile] of profiles.entries()) {
		const model = concreteModelId(profile.model?.default);
		if (!model) throw new Error(`Benchmark ${index === 0 ? "worker" : "analyst"} AgentProfile.model.default must name an exact model`);
		if (!profilesByModel.has(model)) profilesByModel.set(model, profile);
	}
	const models = [...profilesByModel.keys()];
	const timeoutMs = cfg.modelPreflightTimeoutMs ?? 3e4;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("modelPreflightTimeoutMs must be a positive finite number");
	const check = cfg.modelPreflight ?? (async (model, worker, signal) => {
		const profile = profilesByModel.get(model);
		if (!profile) throw new Error(`Benchmark preflight has no AgentProfile for model ${model}`);
		await profileChatClient({
			profile,
			context: `runBenchmark model preflight (${model})`,
			executor: {
				backend: "router",
				routerBaseUrl: worker.routerBaseUrl,
				routerKey: worker.routerKey
			}
		}).chat({
			model,
			messages: [{
				role: "user",
				content: "Reply OK."
			}]
		}, { signal });
	});
	const failures = (await Promise.allSettled(models.map(async (model) => {
		const controller = new AbortController();
		let timeoutError;
		let clearTimer;
		try {
			await Promise.race([check(model, cfg.worker, controller.signal), new Promise((_, reject) => {
				clearTimer = armDeadlineTimer(timeoutMs, () => {
					timeoutError = /* @__PURE__ */ new Error(`timed out after ${timeoutMs} ms`);
					controller.abort(timeoutError);
					reject(timeoutError);
				}, true);
			})]);
		} catch (cause) {
			const reported = timeoutError ?? cause;
			const message = reported instanceof Error ? reported.message : String(reported);
			throw new Error(`Benchmark model "${model}" preflight failed: ${message}`, { cause: reported });
		} finally {
			clearTimer?.();
		}
	}))).flatMap((result) => result.status === "rejected" ? [result.reason] : []);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) {
		const message = failures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join("; ");
		throw new AggregateError(failures, message);
	}
}
/** Run the requested strategies over the tasks, scored by the Environment's own check.
*  Resilient: a task whose rollouts fail (transient infra) is excluded from the stats but
*  reported in `perTask` with the error — never silently dropped. */
async function runBenchmark(cfg) {
	const strategies = cfg.strategies ?? [sample, refine];
	const budget = cfg.budget ?? 3;
	const concurrency = cfg.concurrency ?? 3;
	await preflightModels(cfg);
	let settled = 0;
	const perTask = await pool(cfg.tasks, concurrency, async (task) => {
		const cells = {};
		const errors = {};
		let row;
		try {
			for (const s of strategies) try {
				const r = await runAgentic({
					...cfg.worker,
					surface: cfg.environment,
					task,
					strategy: s,
					budget,
					...cfg.hooks ? { hooks: cfg.hooks } : {}
				});
				cells[s.name] = {
					score: r.score,
					resolved: r.resolved,
					progression: r.progression,
					usd: r.usd,
					usdKnown: r.usdKnown,
					ms: r.ms,
					tokens: r.tokens,
					tokensKnown: r.tokensKnown
				};
			} catch (e) {
				errors[s.name] = e instanceof Error ? e.message.slice(0, 300) : String(e);
				cells[s.name] = {
					score: 0,
					resolved: false,
					progression: [],
					usd: 0,
					usdKnown: false,
					ms: 0,
					tokens: {
						input: 0,
						output: 0
					},
					tokensKnown: false
				};
			}
			row = {
				taskId: task.id,
				cells,
				...Object.keys(errors).length > 0 ? { errors } : {}
			};
		} catch (e) {
			row = {
				taskId: task.id,
				error: e instanceof Error ? e.message.slice(0, 300) : String(e)
			};
		}
		settled += 1;
		cfg.onTask?.(row, settled, cfg.tasks.length);
		return row;
	});
	const ok = perTask.filter((r) => !!r.cells);
	const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
	const perStrategy = {};
	for (const s of strategies) {
		const cells = ok.map((r) => r.cells[s.name]).filter((c) => !!c);
		perStrategy[s.name] = {
			score: mean(cells.map((c) => c.score)),
			resolved: mean(cells.map((c) => c.resolved ? 1 : 0)),
			usd: mean(cells.map((c) => c.usd)),
			usdKnownRate: mean(cells.map((c) => c.usdKnown ? 1 : 0)),
			ms: mean(cells.map((c) => c.ms))
		};
	}
	const frontier = paretoFrontier(Object.entries(perStrategy).map(([name, v]) => ({
		name,
		score: v.score,
		usd: v.usd
	})), [{
		name: "score",
		direction: "maximize",
		value: (c) => c.score
	}, {
		name: "usd",
		direction: "minimize",
		value: (c) => c.usd
	}]).frontier.map((c) => c.name);
	const report = {
		n: ok.length,
		excluded: perTask.length - ok.length,
		perStrategy,
		perTask,
		pareto: frontier
	};
	const names = strategies.map((s) => s.name);
	if (names.includes("refine") && names.includes("sample") && ok.length >= 2) {
		const b = pairedBootstrap(ok.map((r) => r.cells.sample?.score ?? 0), ok.map((r) => r.cells.refine?.score ?? 0));
		report.refineVsSample = {
			mean: b.mean,
			low: b.low,
			high: b.high,
			n: b.n
		};
	}
	return report;
}
/** Pretty-print a report — the "free optimization" verdict, with the cost vector. */
function printBenchmarkReport(report) {
	const pct = (x) => `${(x * 100).toFixed(1)}%`;
	const pp = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}pp`;
	console.log(`\n=== benchmark · n=${report.n}${report.excluded ? ` (excluded ${report.excluded})` : ""} ===`);
	console.log(`  ${"strategy".padEnd(16)} ${"score".padStart(7)} ${"resolved".padStart(9)} ${"$/task".padStart(8)} ${"s/task".padStart(7)}`);
	for (const [s, v] of Object.entries(report.perStrategy)) console.log(`  ${(report.pareto.includes(s) ? `${s} *` : s).padEnd(16)} ${pct(v.score).padStart(7)} ${pct(v.resolved).padStart(9)} ${`$${v.usd.toFixed(3)}`.padStart(8)} ${(v.ms / 1e3).toFixed(0).padStart(6)}s`);
	if (report.pareto.length) console.log(`  * = on the (score, $) Pareto frontier`);
	for (const row of report.perTask) if (row.error) console.log(`  ⚠ ${row.taskId}: ${row.error.slice(0, 120)}`);
	const l = report.refineVsSample;
	if (l) {
		const sig = l.low > 0 ? "SIGNIF +" : l.high < 0 ? "SIGNIF -" : "n.s.";
		console.log(`  refine − sample: ${pp(l.mean)}  CI [${pp(l.low)}, ${pp(l.high)}]  (${sig})`);
	}
}
//#endregion
//#region src/runtime/box-read-retry.ts
/**
* One bounded-retry read over a sandbox box's filesystem, shared by every caller that reads a
* path the agent may have just written.
*
* The box data plane can transiently 404 a file that exists: the write is not yet flushed, or an
* edge read lands on a stale view. A first-attempt failure is therefore not evidence of absence,
* and a caller that treats it as such records a lie — "the agent produced nothing" for a
* deliverable, or "the agent deleted this surface" for a mounted profile file.
*
* Retries wait `delayMs × attempt` (linear), so the total wait for n attempts is
* `delayMs × n(n-1)/2`. Set `delayMs` to 0 to retry without waiting (tests).
*/
/** The diagnostic for a failed attempt. `undefined` in, `undefined` out — so a caller can pass the
*  "no attempt has failed yet" state through without inventing a message for it. */
function boxReadErrorMessage(error) {
	if (error === void 0) return void 0;
	return error instanceof Error ? error.message : String(error);
}
async function readBoxPathWithRetry(read, path, options) {
	const attempts = Math.max(1, options.attempts);
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		options.beforeAttempt?.(lastError);
		if (options.signal?.aborted) {
			lastError ??= /* @__PURE__ */ new Error(`readBoxPathWithRetry: aborted before reading ${JSON.stringify(path)}`);
			break;
		}
		try {
			return {
				succeeded: true,
				text: await read(path)
			};
		} catch (err) {
			lastError = err;
			if (attempt < attempts && options.delayMs > 0) await sleep(options.delayMs * attempt, options.signal);
		}
	}
	return {
		succeeded: false,
		error: lastError
	};
}
//#endregion
//#region src/runtime/sandbox-run.ts
/**
* Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained
* BEFORE the abort fired (and any in-progress `readError`) so an aborted run is
* DIAGNOSABLE — the caller can tell never-started (`events: []`) from looped
* (many events, no terminal `result`) from produced-nothing-then-cancelled.
*
* `name === 'AbortError'`, so existing `err.name === 'AbortError'` callers (the
* loop kernel, scope, supervise runtime) keep matching it unchanged.
*
* @experimental
*/
var SandboxRunAbortError = class extends Error {
	name = "AbortError";
	/** Events drained from the stream before the abort interrupted the turn. */
	events;
	/** The last artifact read error, if the abort fired during the retry loop. */
	readError;
	constructor(events, readError) {
		super("aborted");
		this.events = events;
		if (readError !== void 0) this.readError = readError;
	}
};
/**
* Open a sandbox run. Harness-agnostic: the harness lives in
* `options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
* kimi-code all flow through this one entrypoint with identical env/auth wiring.
*
* @experimental
*/
async function openSandboxRun(client, options, deliverable) {
	const runId = options.runId ?? `sandbox-run-${randomSuffix()}`;
	const now = options.now ?? Date.now;
	const agentRunName = options.agentRun.name ?? options.agentRun.profile.name ?? "agent";
	const promptOptions = readPromptOptions(options.promptOptions, "openSandboxRun: promptOptions");
	const lineage = createSandboxLineage(client, await probeSandboxCapabilities(client), { ...options.maxConcurrency !== void 0 ? { maxConcurrency: options.maxConcurrency } : {} });
	let handle;
	let started = false;
	let runStartedAt;
	let failed = false;
	let turnCount = 0;
	function emit(event) {
		notifyRuntimeHookEvent(options.hooks, {
			id: `${runId}:${event.target}:${event.phase}${event.stepIndex === void 0 ? "" : `:${event.stepIndex}`}`,
			runId,
			scenarioId: options.scenarioId,
			target: event.target,
			phase: event.phase,
			timestamp: event.timestamp,
			stepIndex: event.stepIndex,
			payload: event.payload,
			metadata: { producer: "openSandboxRun" }
		}, { signal: options.signal });
	}
	const runPayload = () => ({
		agentName: agentRunName,
		profileName: options.agentRun.profile.name,
		backendType: backendType(options.agentRun),
		deliverableKind: deliverable.kind,
		...deliverable.kind === "artifact" ? { deliverablePath: deliverable.path } : {},
		...handle ? {
			sessionId: handle.sessionId,
			sandboxId: handle.box.id
		} : {}
	});
	const turnPayload = (prompt, turnKind, startedAt, result, error) => ({
		...runPayload(),
		turnKind,
		promptChars: prompt.length,
		promptHash: hashText(prompt),
		...result !== void 0 || error !== void 0 ? { durationMs: Math.max(0, now() - startedAt) } : {},
		...result ? {
			eventCount: result.events.length,
			eventTypes: eventTypeCounts(result.events),
			...result.readError !== void 0 ? { readError: result.readError } : {}
		} : {},
		...error !== void 0 ? { error: errorMessage$1(error) } : {}
	});
	async function settle(box, events, turnIndex, turnKind) {
		const collected = [];
		const outcomeTracker = createAgentRunOutcomeTracker();
		try {
			for await (const ev of events) {
				collected.push(ev);
				outcomeTracker.observe(ev);
				notifySandboxEventObserver(ev, options.onSandboxEvent, {
					turnIndex,
					turnKind,
					agentRunName
				});
			}
		} catch (err) {
			if (isAbortError(err)) throw new SandboxRunAbortError(collected);
			throw err;
		}
		const outcome = outcomeTracker.finish();
		if (deliverable.kind === "events") return {
			out: deliverable.fromEvents(collected),
			events: collected,
			outcome
		};
		if (options.signal.aborted) throw new SandboxRunAbortError(collected);
		const attempted = await readBoxPathWithRetry(box.fs.read.bind(box.fs), deliverable.path, {
			attempts: 4,
			delayMs: options.readRetryDelayMs ?? 1e3,
			signal: options.signal,
			beforeAttempt: (lastError) => {
				if (options.signal.aborted) throw new SandboxRunAbortError(collected, boxReadErrorMessage(lastError));
			}
		});
		const raw = attempted.succeeded ? attempted.text : "";
		const readError = attempted.succeeded ? void 0 : boxReadErrorMessage(attempted.error);
		return {
			out: deliverable.fromArtifact(raw, collected),
			events: collected,
			outcome,
			...readError !== void 0 ? { readError } : {}
		};
	}
	return {
		get box() {
			if (!handle) throw new Error("openSandboxRun: box unavailable before start()");
			return handle.box;
		},
		get sessionId() {
			if (!handle) throw new Error("openSandboxRun: sessionId unavailable before start()");
			return handle.sessionId;
		},
		async start(prompt) {
			if (started) throw new Error("openSandboxRun: start() already called — use resume() to continue the session");
			started = true;
			runStartedAt = now();
			emit({
				target: "agent.run",
				phase: "before",
				timestamp: runStartedAt,
				payload: {
					...runPayload(),
					turnCount: 0
				}
			});
			const stepIndex = turnCount;
			const turnStartedAt = now();
			emit({
				target: "agent.turn",
				phase: "before",
				timestamp: turnStartedAt,
				stepIndex,
				payload: turnPayload(prompt, "start", turnStartedAt)
			});
			try {
				const r = await lineage.start(options.agentRun, prompt, options.signal, promptOptions);
				handle = r.handle;
				await options.beforeStart?.({
					box: handle.box,
					sessionId: handle.sessionId,
					signal: options.signal
				});
				const result = await settle(handle.box, r.events, stepIndex, "start");
				turnCount += 1;
				emit({
					target: "agent.turn",
					phase: "after",
					timestamp: now(),
					stepIndex,
					payload: turnPayload(prompt, "start", turnStartedAt, result)
				});
				return result;
			} catch (error) {
				failed = true;
				emit({
					target: "agent.turn",
					phase: "error",
					timestamp: now(),
					stepIndex,
					payload: turnPayload(prompt, "start", turnStartedAt, void 0, error)
				});
				emit({
					target: "agent.run",
					phase: "error",
					timestamp: now(),
					payload: {
						...runPayload(),
						turnCount,
						error: errorMessage$1(error)
					}
				});
				throw error;
			}
		},
		async resume(prompt) {
			if (!handle) throw new Error("openSandboxRun: resume() called before start()");
			const stepIndex = turnCount;
			const turnStartedAt = now();
			emit({
				target: "agent.turn",
				phase: "before",
				timestamp: turnStartedAt,
				stepIndex,
				payload: turnPayload(prompt, "resume", turnStartedAt)
			});
			try {
				const result = await settle(handle.box, await lineage.continue(handle, prompt, options.signal, promptOptions), stepIndex, "resume");
				turnCount += 1;
				emit({
					target: "agent.turn",
					phase: "after",
					timestamp: now(),
					stepIndex,
					payload: turnPayload(prompt, "resume", turnStartedAt, result)
				});
				return result;
			} catch (error) {
				failed = true;
				emit({
					target: "agent.turn",
					phase: "error",
					timestamp: now(),
					stepIndex,
					payload: turnPayload(prompt, "resume", turnStartedAt, void 0, error)
				});
				emit({
					target: "agent.run",
					phase: "error",
					timestamp: now(),
					payload: {
						...runPayload(),
						turnCount,
						error: errorMessage$1(error)
					}
				});
				throw error;
			}
		},
		async close() {
			await lineage.teardown();
			if (runStartedAt !== void 0) emit({
				target: "agent.run",
				phase: "after",
				timestamp: now(),
				payload: {
					...runPayload(),
					turnCount,
					status: failed ? "error" : "completed",
					durationMs: Math.max(0, now() - runStartedAt)
				}
			});
		}
	};
}
function backendType(spec) {
	return (spec.sandboxOverrides?.backend)?.type;
}
function eventTypeCounts(events) {
	const counts = {};
	for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
	return counts;
}
function hashText(value) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
function errorMessage$1(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/runtime/shared-box.ts
/**
* Shared-box placement: many harness workers in one Sandbox box, each as its own process.
*
* The default provider placement gives every worker its own Sandbox box. A box costs a create
* call, a sidecar, an egress proxy, a preview link and a memory reservation sized for the box,
* while one opencode worker uses about half a gigabyte. This module packs workers into a small
* pool of boxes instead. Each worker runs `opencode run` as a separate process with its own
* working directory and its own HOME, so each worker has its own harness session, its own
* materialized profile and its own transcript files.
*
* Why processes and not sidecar sessions: the sidecar serves every session in one box from one
* workspace and writes each session's profile into the same files. Measured 2026-09-24 on
* sandbox-ff52a989e7c9: eight concurrent sessions with different instructions, and seven of eight
* answered with another session's instructions. A process with its own directory, its own HOME and
* `OPENCODE_DISABLE_PROJECT_CONFIG` reads only its own configuration: sixteen of sixteen concurrent
* workers answered with their own instructions and wrote only into their own directory.
*
* The boundary is cooperative, not a security boundary. Every worker runs as the same Linux user,
* so a worker can read a co-tenant's files through its shell. A profile that writes a repository,
* runs untrusted code, holds a credential of its own, or must stay blind to its siblings keeps a
* dedicated box: {@link SharedBoxPlacement.refusal} names the profile features this placement
* cannot carry, and Runtime then uses the dedicated provider.
*
* A worker whose model provider refuses a turn for capacity keeps its process's session and
* directory, pauses by the driver's rule, and continues the same opencode session, the way a
* dedicated leaf does (`ProviderExecutorOptions.unavailablePause`). Measured 2026-09-24: 15 of 23
* down children of play anomaly-referee-v3d ended on `provider_quota_exhausted`, and opencode
* itself gives up on a refused model after about 70 seconds of its own retries.
*
* The workers of one box share the box's router key. Each worker names itself to the router with
* the `x-tangle-client` header, which the router stores as `clientName` on every usage row, so a
* keeper can price one worker from the key's per-client rows (`tangle-admin router-spend --key
* <box key>`). A request without the header stays charged to the box.
*
* `workersPerBox` is the one structural cap, and it protects the box. A Tangle box has a fixed
* 512-task pids limit. An idle box uses about 118 tasks and one opencode worker about 34, so
* twelve workers reach the limit. At that limit the sidecar's own process spawn fails with EAGAIN
* and the sidecar restarts, which ends every worker in the box (measured on the same box: 28
* workers crashed the sidecar twice; 16 workers crashed it once).
*/
/**
* The most workers one default box carries at once.
*
* It keeps a worker count that the 512-task pids limit of a Tangle box can hold with headroom
* for the sidecar's own processes and the workers' tool shells: 118 idle tasks plus 8 workers at
* about 34 tasks each is 390. Memory is not the binding limit: 8 workers used about 4 GB in a
* 16 GB box. Raise it only for a box whose pids limit was raised with it.
*/
const DEFAULT_SHARED_BOX_WORKERS = 8;
/** The box shape the default placement creates: memory for 8 workers at about 0.5 GB each plus
*  the sidecar, and 4 cores, because the workers wait on the model most of the time. */
const DEFAULT_SHARED_BOX_RESOURCES = Object.freeze({
	cpuCores: 4,
	memoryMB: 8192
});
const DEFAULT_WORKER_ROOT = "/home/agent/workers";
const HARNESS = "opencode";
const SHARED_PROVIDER_NAME = "tangle-shared-box";
const DEFAULT_EXEC_TIMEOUT_MS = 12e4;
/** The request header the router records as a usage row's `clientName`. */
const ROUTER_CLIENT_HEADER = "x-tangle-client";
/**
* The router client name of the worker that runs supervised node `nodeId`.
*
* The node id is already in the spawn journal, so a keeper joins a router row to a node without
* a new record: the row whose `clientName` is `agent-runtime-node/<nodeId>` is that node's spend.
*/
function sharedWorkerClientName(nodeId) {
	if (!/^[!-~]+$/u.test(nodeId)) throw new ValidationError("sharedWorkerClientName: a node id must be visible ASCII");
	return `agent-runtime-node/${nodeId}`;
}
/**
* Attempts for one Sandbox API call that failed on the way to the box.
*
* Every call re-verifies the API key with the platform, and a burst of workers makes that check
* time out: 8 of 64 workers failed with `502 platform_unavailable` (reason `platform_timeout`) in
* one burst on 2026-09-24, and 3 more lost their transcript enumeration the same way. The check
* refuses the request before it reaches the box, so repeating it is safe; five attempts over about
* fifteen seconds rode out every such failure measured.
*/
const TRANSIENT_ATTEMPTS = 5;
const TRANSIENT_BASE_DELAY_MS = 1e3;
/** A failure that a repeated request can change: the platform, the gateway or the network. */
function isTransientSandboxFailure(error) {
	if (error === null || typeof error !== "object") return false;
	const record = error;
	if (typeof record.status === "number" && [
		408,
		425,
		429,
		500,
		502,
		503,
		504
	].includes(record.status)) return true;
	const text = `${String(record.code ?? "")} ${String(record.name ?? "")} ${String(record.message ?? "")}`;
	return /platform_unavailable|platform_timeout|platform_unreachable|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|UND_ERR|bad gateway|gateway timeout/iu.test(text);
}
async function transientRetry(operation, options = {}) {
	const delayMs = options.delayMs ?? TRANSIENT_BASE_DELAY_MS;
	for (let attempt = 1;; attempt += 1) try {
		return await operation(attempt);
	} catch (error) {
		if (attempt >= TRANSIENT_ATTEMPTS || !isTransientSandboxFailure(error)) throw error;
		options.signal?.throwIfAborted();
		await sleep(delayMs * 2 ** (attempt - 1), options.signal);
	}
}
/**
* Why a shared box cannot carry `profile`, or `undefined` when it can.
*
* A shared box carries a profile whose whole behavior reaches an opencode process through its own
* working directory, its own configuration and the box's own model credential. Everything else
* keeps a dedicated box: another harness, a model the box credential cannot reach, a replaced
* system prompt, MCP servers, connections, hooks, subagents, extensions, tool grants, and any
* resource the materializer does not lower into the worker's directory.
*/
function sharedBoxRefusal(profile) {
	if (profile.harness !== HARNESS) return `harness ${String(profile.harness)} is not ${HARNESS}`;
	if (concreteProfileModel(profile) === void 0) return "profile names no concrete model";
	if (profile.model?.provider === void 0) return "profile names no model provider";
	if (profile.model?.reasoningEffort !== void 0) {
		if (tryInvocation(profile) === void 0) return "model.reasoningEffort has no opencode variant";
	}
	if (profile.prompt?.systemPrompt !== void 0) return "prompt.systemPrompt replaces a system prompt";
	for (const field of [
		"mcp",
		"connections",
		"hooks",
		"subagents",
		"extensions",
		"confidential",
		"modes"
	]) if (profile[field] !== void 0) return `profile declares ${field}`;
	if (profile.tools !== void 0 && Object.keys(profile.tools).length > 0) return "profile grants tools";
	const resources = profile.resources;
	if (resources !== void 0) {
		for (const field of [
			"skills",
			"agents",
			"commands",
			"tools"
		]) if (resources[field] !== void 0) return `profile declares resources.${field}`;
		for (const file of resources.files ?? []) if (file.resource.kind !== "inline") return `resource file ${file.path} is not inline`;
		if (resources.instructions !== void 0 && typeof resources.instructions !== "string" && resources.instructions.kind !== "inline") return "resources.instructions is not inline";
	}
	let plan;
	try {
		plan = materializeProfile(profile, HARNESS);
	} catch (error) {
		return `opencode materialization failed: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (plan.unsupported.length > 0) return `opencode cannot carry ${plan.unsupported.map((row) => row.dimension).join(", ")}`;
	if (Object.keys(plan.env).length > 0 || plan.flags.length > 0) return "profile needs launch environment or flags";
	for (const file of plan.files) {
		if (file.root === "agent") return `profile writes ${file.relPath} into the harness home`;
		if ((file.secretSlots?.length ?? 0) > 0) return `profile file ${file.relPath} carries a secret`;
		if (isUnsafeRelativePath(file.relPath)) return `profile file ${file.relPath} leaves its directory`;
	}
}
function tryInvocation(profile) {
	try {
		return harnessInvocation(HARNESS, invocationProfile(profile), "probe").args;
	} catch {
		return;
	}
}
/**
* The profile the invocation table reads. The prompt reaches opencode through its configuration
* and the model through the provider this placement declares, so only the reasoning effort is
* left for the table to lower into `--variant`.
*/
function invocationProfile(profile) {
	const { prompt: _prompt, model, ...rest } = profile;
	return {
		...rest,
		...model?.reasoningEffort === void 0 ? {} : { model: { reasoningEffort: model.reasoningEffort } }
	};
}
function isUnsafeRelativePath(path) {
	return path.length === 0 || path.startsWith("/") || path.split("/").some((segment) => segment === ".." || segment === "");
}
/**
* Place accepted workers as processes in a pool of shared Sandbox boxes.
*
* The pool fills a box before it creates the next one and deletes a box when its last worker
* releases it. Runtime reaches this placement through `createExecutor({ backend: 'provider',
* shared })`: a profile that {@link SharedBoxPlacement.refusal} accepts runs here, and every other
* profile keeps the dedicated provider.
*/
function sharedBoxPlacement(options) {
	const workersPerBox = options.workersPerBox ?? 8;
	if (!Number.isSafeInteger(workersPerBox) || workersPerBox < 1) throw new ValidationError("sharedBoxPlacement: workersPerBox must be a positive integer");
	const workerRoot = options.workerRoot ?? DEFAULT_WORKER_ROOT;
	if (!workerRoot.startsWith("/") || isUnsafeRelativePath(workerRoot.slice(1))) throw new ValidationError("sharedBoxPlacement: workerRoot must be an absolute, normalized path");
	const boxOptions = {
		resources: { ...DEFAULT_SHARED_BOX_RESOURCES },
		...options.box ?? {}
	};
	if (boxOptions.backend !== void 0) throw new ValidationError("sharedBoxPlacement: box.backend is owned by Runtime");
	const identity = {
		id: "shared-box",
		digest: canonicalCandidateDigest({
			kind: "shared-box-placement.v1",
			harness: HARNESS,
			workersPerBox,
			workerRoot,
			box: publicBoxOptions(boxOptions)
		})
	};
	const retryDelayMs = options.retryDelayMs ?? TRANSIENT_BASE_DELAY_MS;
	const pool = createBoxPool(options.client, boxOptions, workersPerBox, retryDelayMs);
	const providerFor = (worker = {}) => {
		const clientName = worker.nodeId === void 0 ? void 0 : sharedWorkerClientName(worker.nodeId);
		return sandboxClientAsProvider({ async create(createOptions) {
			const profile = workerProfile(createOptions);
			const refusal = sharedBoxRefusal(profile);
			if (refusal !== void 0) throw new ValidationError(`sharedBoxPlacement: ${refusal}`);
			assertWorkerCreateOptions(createOptions);
			const lease = await pool.acquire();
			try {
				return await createWorker(lease, workerRoot, profile, {
					retryDelayMs,
					clientName,
					unavailablePause: options.unavailablePause ?? {}
				});
			} catch (error) {
				await lease.release();
				throw error;
			}
		} }, {
			name: SHARED_PROVIDER_NAME,
			capabilities: sharedBoxCapabilities()
		});
	};
	return {
		providerFor,
		identity,
		refusal: sharedBoxRefusal,
		stats: () => pool.stats(),
		close: () => pool.close()
	};
}
function publicBoxOptions(box) {
	const { env, secrets, ...rest } = box;
	return {
		...rest,
		...env === void 0 ? {} : { environmentVariableNames: Object.keys(env).sort() },
		...secrets === void 0 ? {} : { secrets }
	};
}
function sharedBoxCapabilities() {
	return {
		profile: {
			namedProfiles: false,
			systemPrompt: {
				...harnessSystemPromptIntents$1(HARNESS),
				replace: false
			},
			instructions: true,
			tools: false,
			permissions: true,
			mcp: false,
			subagents: false,
			resources: {
				files: true,
				instructions: true
			},
			runtimeUpdate: false,
			validation: false
		},
		streaming: {
			live: true,
			replay: false,
			detach: false,
			turnIdempotency: false
		},
		sessions: {
			continue: false,
			list: false,
			messages: false
		},
		workspace: {
			read: true,
			write: true,
			exec: true,
			git: false,
			upload: false,
			download: false
		},
		branching: {
			checkpoint: false,
			fork: false
		},
		placement: true,
		usage: true,
		confidential: false
	};
}
function workerProfile(createOptions) {
	const raw = (createOptions?.backend)?.profile;
	const parsed = agentProfileSchema.safeParse(raw);
	if (!parsed.success) throw new ValidationError("sharedBoxPlacement: an exact AgentProfile is required at create");
	return parsed.data;
}
/**
* A worker create carries only what a slot in a shared box can honor. Box-level settings belong
* to the placement's own box options, and a per-worker request for them is refused rather than
* dropped: a worker that asked for an environment variable, a repository or its own resources
* would otherwise run without them and report nothing.
*/
function assertWorkerCreateOptions(createOptions) {
	const options = createOptions ?? {};
	for (const key of [
		"git",
		"fromSnapshot",
		"fromSandboxId",
		"environment",
		"cwd",
		"resources"
	]) if (options[key] !== void 0) throw new ValidationError(`sharedBoxPlacement: a shared worker cannot set ${key}`);
	const env = options.env;
	if (env !== void 0 && Object.keys(env).length > 0) throw new ValidationError("sharedBoxPlacement: a shared worker cannot set env");
	const secrets = options.secrets;
	if (Array.isArray(secrets) && secrets.length > 0) throw new ValidationError("sharedBoxPlacement: a shared worker cannot request secrets");
	const backend = options.backend;
	if (backend?.runtimeAttachments !== void 0) throw new ValidationError("sharedBoxPlacement: a shared worker cannot carry runtime attachments");
	if (backend?.type !== void 0 && backend.type !== HARNESS) throw new ValidationError(`sharedBoxPlacement: backend ${String(backend.type)} is not ${HARNESS}`);
}
function createBoxPool(client, boxOptions, workersPerBox, retryDelayMs) {
	const poolId = randomUUID();
	const boxes = [];
	const history = [];
	let seq = 0;
	let placed = 0;
	let peak = 0;
	let closing = false;
	const retire = async (entry) => {
		if (entry.retired) return void 0;
		entry.retired = true;
		const index = boxes.indexOf(entry);
		if (index >= 0) boxes.splice(index, 1);
		let handle;
		try {
			handle = await entry.ready;
		} catch {
			return;
		}
		try {
			await transientRetry(() => handle.delete(), { delayMs: retryDelayMs });
			entry.deleted = true;
			return {
				boxId: handle.id,
				deleted: true
			};
		} catch (error) {
			return {
				boxId: handle.id,
				deleted: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	};
	return {
		async acquire() {
			if (closing) throw new ValidationError("sharedBoxPlacement: the placement is closed");
			let entry = boxes.find((candidate) => !candidate.retired && candidate.workers < workersPerBox);
			if (entry === void 0) {
				const boxSeq = seq++;
				const request = {
					...boxOptions,
					name: boxOptions.name ?? `shared-box-${poolId.slice(0, 8)}-${boxSeq}`,
					idempotencyKey: `shared-box-${poolId}-${boxSeq}`,
					backend: {
						type: HARNESS,
						profile: {
							name: "shared-box",
							harness: HARNESS
						}
					}
				};
				const requestedAt = Date.now();
				const created = {
					seq: boxSeq,
					ready: transientRetry(() => client.create(request), { delayMs: retryDelayMs }).then((box) => box),
					workers: 0,
					served: 0,
					retired: false,
					deleted: false
				};
				created.ready.then((box) => {
					created.id = box.id;
					created.createMs = Date.now() - requestedAt;
				}, () => {
					const index = boxes.indexOf(created);
					if (index >= 0) boxes.splice(index, 1);
					created.retired = true;
				});
				boxes.push(created);
				history.push(created);
				entry = created;
			}
			const leased = entry;
			leased.workers += 1;
			leased.served += 1;
			placed += 1;
			peak = Math.max(peak, leased.workers);
			let box;
			try {
				box = await leased.ready;
			} catch (error) {
				leased.workers -= 1;
				throw error;
			}
			let released = false;
			return {
				box,
				async release() {
					if (released) return;
					released = true;
					leased.workers -= 1;
					if (leased.workers === 0 && !closing) await retire(leased);
				}
			};
		},
		stats() {
			return {
				boxesCreated: history.length,
				boxesLive: history.filter((entry) => !entry.retired).length,
				workersPlaced: placed,
				workersLive: history.reduce((sum, entry) => sum + entry.workers, 0),
				peakWorkersPerBox: peak,
				boxes: history.filter((entry) => entry.id !== void 0).map((entry) => ({
					id: entry.id,
					workersServed: entry.served,
					deleted: entry.deleted,
					createMs: entry.createMs ?? 0
				}))
			};
		},
		async close() {
			closing = true;
			return (await Promise.all(history.map((entry) => retire(entry)))).filter((receipt) => receipt !== void 0);
		}
	};
}
/** The environment one worker's processes see: its own directory, HOME and XDG roots. */
function workerEnv(paths) {
	return [
		"OPENCODE_DISABLE_PROJECT_CONFIG=1",
		`OPENCODE_CONFIG_DIR=${paths.dir}/.opencode`,
		`PWD=${paths.dir}`,
		`HOME=${paths.home}`,
		`XDG_DATA_HOME=${paths.home}/.local/share`,
		`XDG_CONFIG_HOME=${paths.home}/.config`,
		`XDG_STATE_HOME=${paths.home}/.local/state`,
		`XDG_CACHE_HOME=${paths.cache}`
	];
}
async function createWorker(lease, root, createProfile, placement) {
	const { clientName, unavailablePause } = placement;
	const box = resilientBox(lease.box, placement.retryDelayMs);
	const workerId = `w-${randomUUID()}`;
	const paths = {
		dir: `${root}/${workerId}`,
		home: `${root}/${workerId}/.home`,
		cache: `${root}/.cache`
	};
	const made = await box.exec(`mkdir -p '${paths.home}' '${paths.cache}'`, { timeoutMs: DEFAULT_EXEC_TIMEOUT_MS });
	if ((made.exitCode ?? 1) !== 0) throw new Error(`sharedBoxPlacement: could not create ${paths.dir}: ${made.stderr ?? ""}`);
	const env = workerEnv(paths);
	let running;
	let turnActive = false;
	let released = false;
	const started = /* @__PURE__ */ new Set();
	const run = async (args, timeoutMs, extraEnv) => {
		const process = await box.spawnInDirectory("/usr/bin/env", [...env, ...args], {
			cwd: paths.dir,
			...extraEnv === void 0 ? {} : { env: extraEnv },
			timeoutMs
		}, started);
		started.add(process.pid);
		return process;
	};
	const collect = async (process) => {
		const [stdout, stderr, exitCode] = await Promise.all([
			drain(box.output(process, "stdout")),
			drain(box.output(process, "stderr")),
			box.wait(process)
		]);
		return {
			exitCode,
			stdout,
			stderr
		};
	};
	const resolvePath = (path) => {
		if (path.startsWith("/")) return path;
		if (isUnsafeRelativePath(path)) throw new ValidationError(`sharedBoxPlacement: path ${path} leaves the worker directory`);
		return `${paths.dir}/${path}`;
	};
	/**
	* One turn: one or more opencode runs of the same session. The first runs `message`; a later run
	* continues the session after the model provider refused a run for capacity.
	*/
	async function* turn(message, turnProfile, options) {
		const signal = options?.signal;
		const timeoutMs = options?.timeoutMs ?? 0;
		const turnDeadline = timeoutMs > 0 ? Date.now() + timeoutMs : void 0;
		let sessionId;
		const subagents = /* @__PURE__ */ new Set();
		let refusalsInARow = 0;
		let prompt = message;
		for (let invocation = 1;; invocation += 1) {
			const launch = await materializeWorker(box, paths, turnProfile, prompt, options?.backend?.model, clientName, sessionId);
			signal?.throwIfAborted();
			const remainingMs = turnDeadline === void 0 ? 0 : Math.max(1, turnDeadline - Date.now());
			const process = await run(launch.args, remainingMs, { OPENCODE_CONFIG_CONTENT: launch.config });
			running = process;
			const onAbort = () => {
				process.kill("SIGKILL", { tree: true }).catch(() => void 0);
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			const stderr = drain(box.output(process, "stderr"));
			const lines = lineReader();
			const parsed = createOpencodeEventParser(launch.model);
			let exitCode;
			let errorText;
			try {
				for await (const chunk of box.output(process, "stdout")) for (const line of lines.push(chunk)) yield* parsed.line(line);
				for (const line of lines.end()) yield* parsed.line(line);
				exitCode = await box.wait(process);
				errorText = (await stderr).slice(-4e3);
			} finally {
				signal?.removeEventListener("abort", onAbort);
				running = void 0;
			}
			sessionId = parsed.sessionId() ?? sessionId;
			for (const child of parsed.subagentSessionIds()) subagents.add(child);
			const failure = parsed.failure(exitCode, errorText);
			const refusal = failure === void 0 || unavailablePause === false || signal?.aborted ? void 0 : unavailableSignalOfFailure({ error: failure });
			refusalsInARow = parsed.madeProgress() ? 1 : refusalsInARow + 1;
			const pauseMs = refusal === void 0 || unavailablePause === false ? 0 : unavailablePauseMs(refusalsInARow, unavailablePause);
			if (refusal === void 0 || turnDeadline !== void 0 && Date.now() + pauseMs >= turnDeadline) {
				if (sessionId !== void 0) await exportSession(run, collect, paths, sessionId);
				for (const child of subagents) if (child !== sessionId) await exportSession(run, collect, paths, child);
				signal?.throwIfAborted();
				yield* parsed.finish(exitCode, errorText, invocation);
				return;
			}
			await sleep(pauseMs, signal);
			signal?.throwIfAborted();
			if (released) throw new ValidationError("sharedBoxPlacement: this worker was released");
			prompt = sessionId === void 0 ? message : LEAF_CONTINUATION_TASK;
		}
	}
	return {
		id: `${box.id}/${workerId}`,
		name: workerId,
		status: "running",
		metadata: {
			sharedBoxId: box.id,
			workerId,
			workerDir: paths.dir
		},
		async *streamPrompt(message, options) {
			if (released) throw new ValidationError("sharedBoxPlacement: this worker was released");
			if (turnActive) throw new ValidationError("sharedBoxPlacement: a worker runs one turn at a time");
			const turnProfile = options?.backend?.profile === void 0 ? createProfile : agentProfileSchema.parse(options.backend.profile);
			if (canonicalAgentProfileDigest(turnProfile) !== canonicalAgentProfileDigest(createProfile) && sharedBoxRefusal(turnProfile) !== void 0) throw new ValidationError(`sharedBoxPlacement: ${sharedBoxRefusal(turnProfile)}`);
			if (options?.backend?.type !== void 0 && options.backend.type !== HARNESS) throw new ValidationError(`sharedBoxPlacement: backend ${options.backend.type} is not ${HARNESS}`);
			turnActive = true;
			try {
				yield* turn(message, turnProfile, options);
			} finally {
				turnActive = false;
			}
		},
		async exec(command, options) {
			const process = await run([
				"/bin/sh",
				"-c",
				command
			], options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS);
			return await collect(process);
		},
		async read(path) {
			return await box.fs.read(resolvePath(path));
		},
		async write(path, content) {
			await box.fs.write(resolvePath(path), content);
		},
		async refresh() {},
		async delete() {
			if (released) return;
			released = true;
			try {
				await running?.kill("SIGKILL", { tree: true });
				await box.exec(`rm -rf '${paths.dir}'`, { timeoutMs: DEFAULT_EXEC_TIMEOUT_MS });
			} finally {
				await lease.release();
			}
		}
	};
}
/**
* The Sandbox calls one worker makes, each repeated on a transient failure.
*
* A launch is repeated only after the pool confirms the box did not start it: a failed request
* may have reached the box before its answer was lost, so the repeat first looks for a process
* in the worker's own directory that this worker did not start yet, and adopts it. A process log
* that breaks mid-stream is read again from the start, because the box replays a process's
* buffered output, and the part already delivered is skipped.
*/
function resilientBox(box, delayMs) {
	const retry = (operation) => transientRetry(operation, { delayMs });
	return {
		id: box.id,
		exec: (command, options) => retry(() => box.exec(command, options)),
		fs: {
			read: (path) => retry(() => box.fs.read(path)),
			write: (path, content) => retry(() => box.fs.write(path, content))
		},
		async spawnInDirectory(executable, args, options, known) {
			return await transientRetry(async (attempt) => {
				if (attempt > 1) {
					const launched = (await box.process.list()).find((entry) => entry.cwd === options.cwd && entry.command === executable && !known.has(entry.pid));
					const adopted = launched === void 0 ? null : await box.process.get(launched.pid);
					if (adopted !== null) return adopted;
				}
				return await box.process.spawnExact(executable, args, options);
			}, { delayMs });
		},
		async wait(process) {
			return await retry(async () => {
				try {
					return await process.wait();
				} catch (error) {
					if (!isTransientSandboxFailure(error)) throw error;
					const again = await box.process.get(process.pid);
					if (again === null) throw error;
					return await again.wait();
				}
			});
		},
		async *output(process, stream) {
			let delivered = 0;
			let source = process;
			for (let attempt = 1;; attempt += 1) {
				let seen = 0;
				try {
					for await (const chunk of source[stream]()) {
						const fresh = seen + chunk.length <= delivered ? "" : chunk.slice(Math.max(0, delivered - seen));
						seen += chunk.length;
						if (fresh.length > 0) {
							delivered += fresh.length;
							yield fresh;
						}
					}
					return;
				} catch (error) {
					if (attempt >= TRANSIENT_ATTEMPTS || !isTransientSandboxFailure(error)) throw error;
					await sleep(delayMs * 2 ** (attempt - 1));
					source = await retry(() => box.process.get(process.pid)) ?? source;
				}
			}
		},
		delete: () => retry(() => box.delete())
	};
}
async function drain(stream) {
	let text = "";
	for await (const chunk of stream) text += chunk;
	return text;
}
function lineReader() {
	let pending = "";
	return {
		push(chunk) {
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			return lines.filter((line) => line.trim().length > 0);
		},
		end() {
			const rest = pending.trim();
			pending = "";
			return rest.length > 0 ? [rest] : [];
		}
	};
}
/**
* Write the worker's materialized profile into its directory and build its launch.
*
* The files come from the same materializer the Sandbox sidecar uses, so a shared worker gets the
* same instruction file, permissions and resource files a dedicated box would. The generated
* `opencode.json` is passed as `OPENCODE_CONFIG_CONTENT` with its instruction paths made absolute,
* because opencode resolves an instruction path in that variable against nothing.
*/
async function materializeWorker(box, paths, profile, task, turnModel, clientName, continueSession) {
	const refusal = sharedBoxRefusal(profile);
	if (refusal !== void 0) throw new ValidationError(`sharedBoxPlacement: ${refusal}`);
	if (turnModel?.authFiles !== void 0 || turnModel?.authMode === "oauth") throw new ValidationError("sharedBoxPlacement: a shared worker cannot carry auth files");
	const plan = materializeProfile(profile, HARNESS);
	let generated = {};
	for (const file of plan.files) {
		if (file.relPath === "opencode.json" && file.source === "generated") {
			generated = JSON.parse(file.content);
			continue;
		}
		if (continueSession === void 0) await box.fs.write(`${paths.dir}/${file.relPath}`, file.content);
	}
	const instructions = Array.isArray(generated.instructions) ? generated.instructions.map((entry) => typeof entry === "string" && !entry.startsWith("/") ? `${paths.dir}/${entry}` : entry) : void 0;
	const providerId = profile.model.provider;
	const modelId = profileProviderModel(profile);
	const apiKeyEnv = typeof turnModel?.apiKeyEnv === "string" ? turnModel.apiKeyEnv : "OPENCODE_MODEL_API_KEY";
	const baseURL = typeof turnModel?.baseUrl === "string" ? turnModel.baseUrl : "{env:OPENCODE_MODEL_BASE_URL}";
	const config = {
		$schema: "https://opencode.ai/config.json",
		...generated,
		...instructions === void 0 ? {} : { instructions },
		permission: {
			external_directory: {
				"*": "deny",
				"/tmp/**": "allow"
			},
			...generated.permission ?? {}
		},
		provider: { [providerId]: {
			npm: "@ai-sdk/openai-compatible",
			name: providerId,
			options: {
				baseURL,
				apiKey: `{env:${apiKeyEnv}}`,
				...clientName === void 0 ? {} : { headers: { [ROUTER_CLIENT_HEADER]: clientName } }
			},
			models: { [modelId]: { name: modelId } }
		} }
	};
	const invocation = harnessInvocation(HARNESS, invocationProfile(profile), task, { dangerouslySkipPermissions: true });
	const model = `${providerId}/${modelId}`;
	if (continueSession !== void 0 && !/^[A-Za-z0-9_-]+$/u.test(continueSession)) throw new ValidationError(`sharedBoxPlacement: session id ${continueSession} is not opencode's`);
	return {
		args: [
			invocation.command,
			...invocation.args,
			...continueSession === void 0 ? [] : ["--session", continueSession],
			"--format",
			"json",
			"-m",
			model
		],
		config: JSON.stringify(config),
		model
	};
}
/**
* Save the harness's own record of the session where the transcript capture reads it.
*
* Current opencode keeps sessions in a SQLite database, which the capture cannot carry as text.
* `opencode export` writes the same session as JSON.
*/
async function exportSession(run, collect, paths, sessionId) {
	if (!SESSION_ID.test(sessionId)) return;
	await collect(await run([
		"/bin/sh",
		"-c",
		"mkdir -p \"$(dirname \"$2\")\" && exec opencode export \"$1\" > \"$2\"",
		"export-session",
		sessionId,
		`${paths.home}/.local/share/opencode/export/${sessionId}.json`
	], DEFAULT_EXEC_TIMEOUT_MS));
}
const SESSION_ID = /^[A-Za-z0-9_-]+$/u;
/** A subagent's session id in a `task` result (`<task id="ses_…">`) or failure (`task_id: ses_…`). */
const TASK_SESSION = /(?:<task id="|task_id: )(ses_[A-Za-z0-9]+)/u;
/**
* The session a harness subagent ran in, named by its parent's `task` tool part.
*
* opencode starts each subagent in a child session and refuses a nested one unless the
* configuration raises `subagent_depth` above 1, so under the default the parent's parts name
* every subagent session. A running part carries the id in `state.metadata.sessionId`; a finished
* one also carries it in its output, and a failed one in its error.
*/
function subagentSessionOf(part) {
	if (part.type !== "tool" || part.tool !== "task") return void 0;
	const state = part.state;
	if (state === void 0 || state === null || typeof state !== "object") return void 0;
	const { metadata, output, error } = state;
	const named = metadata !== null && typeof metadata === "object" ? metadata.sessionId : void 0;
	if (typeof named === "string" && SESSION_ID.test(named)) return named;
	for (const text of [output, error]) {
		const match = typeof text === "string" ? TASK_SESSION.exec(text) : null;
		if (match !== null) return match[1];
	}
}
/**
* Translate opencode's JSON event lines into the Sandbox event wire the provider executor reads.
*
* Every part becomes `message.part.updated`, which is how the sidecar forwards opencode parts, so
* the existing trace and progress readers decode them unchanged. Each `step-finish` part also
* becomes one canonical `llm_call` receipt with its token counts. opencode reports no dollar
* receipt for a custom provider, so every receipt says the cost is unknown and Runtime prices the
* tokens as an estimate instead of a bill.
*/
function createOpencodeEventParser(model) {
	let sessionId;
	let finalMessageId;
	const textByMessage = /* @__PURE__ */ new Map();
	const subagentSessions = /* @__PURE__ */ new Set();
	const errors = [];
	let malformed = 0;
	let spentTokens = false;
	const failureOf = (exitCode, stderr) => {
		if (exitCode !== 0) {
			const said = [...errors, stderr.trim().slice(-1e3)].filter((text) => text.length > 0);
			return `opencode exited ${exitCode}${said.length > 0 ? `: ${said.join("; ")}` : ""}`;
		}
		return errors.length > 0 && finalMessageId === void 0 ? errors.join("; ") : void 0;
	};
	return {
		sessionId: () => sessionId,
		subagentSessionIds: () => [...subagentSessions],
		/** Why this run failed, or `undefined` when it answered. */
		failure: failureOf,
		/** Whether this run spent any model tokens before it ended. */
		madeProgress: () => spentTokens,
		*line(raw) {
			let event;
			try {
				event = JSON.parse(raw);
			} catch {
				malformed += 1;
				return;
			}
			if (typeof event.sessionID === "string") sessionId ??= event.sessionID;
			if (event.type === "error") {
				const message = errorMessage(event.error);
				errors.push(message);
				yield {
					type: "error",
					data: { message }
				};
				return;
			}
			const part = event.part;
			if (part === void 0 || part === null || typeof part !== "object") return;
			const subagent = subagentSessionOf(part);
			if (subagent !== void 0) subagentSessions.add(subagent);
			yield {
				type: "message.part.updated",
				data: { part }
			};
			const messageId = typeof part.messageID === "string" ? part.messageID : void 0;
			if (part.type === "text" && messageId !== void 0 && typeof part.text === "string") {
				const texts = textByMessage.get(messageId) ?? [];
				texts.push(part.text);
				textByMessage.set(messageId, texts);
			}
			if (part.type === "step-finish") {
				if (messageId !== void 0) finalMessageId = messageId;
				const receipt = stepReceipt(part, model);
				if (receipt !== void 0) {
					const data = receipt.data;
					if ((data?.tokensIn ?? 0) > 0 || (data?.tokensOut ?? 0) > 0) spentTokens = true;
					yield receipt;
				}
			}
		},
		/** The turn's terminal frames, from its last run. `runs` counts the runs of the session. */
		*finish(exitCode, stderr, runs = 1) {
			const finalText = (finalMessageId === void 0 ? void 0 : textByMessage.get(finalMessageId)?.join("")) ?? "";
			const failure = failureOf(exitCode, stderr);
			const counted = {
				...malformed > 0 ? { malformedLines: malformed } : {},
				...runs > 1 ? { sessionRuns: runs } : {}
			};
			if (failure !== void 0) {
				yield {
					type: "result",
					data: {
						success: false,
						status: "failed",
						error: failure,
						finalText,
						...counted
					}
				};
				yield {
					type: "done",
					data: { outcome: { type: "failed" } }
				};
				return;
			}
			yield {
				type: "result",
				data: {
					success: true,
					finalText,
					...counted
				}
			};
			yield {
				type: "done",
				data: { outcome: { type: "completed" } }
			};
		}
	};
}
function stepReceipt(part, model) {
	const tokens = part.tokens;
	if (tokens === void 0 || tokens === null || typeof tokens !== "object") return void 0;
	const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : void 0;
	const cache = tokens.cache ?? {};
	const input = count(tokens.input);
	const output = count(tokens.output);
	const reasoning = count(tokens.reasoning) ?? 0;
	const cacheRead = count(cache.read) ?? 0;
	const cacheWrite = count(cache.write) ?? 0;
	const known = input !== void 0 && output !== void 0;
	return {
		type: "llm_call",
		...typeof part.id === "string" ? { id: part.id } : {},
		data: {
			usageMode: "delta",
			model,
			...known ? {
				tokensIn: input + cacheRead + cacheWrite,
				tokensOut: output + reasoning,
				...reasoning > 0 ? { reasoningTokens: reasoning } : {}
			} : { tokensKnown: false },
			costKnown: false
		}
	};
}
function errorMessage(error) {
	if (typeof error === "string") return error;
	if (error !== null && typeof error === "object") {
		const record = error;
		const data = record.data;
		const text = typeof data?.message === "string" ? data.message : typeof record.message === "string" ? record.message : typeof record.name === "string" ? record.name : "opencode reported an error";
		const status = data?.statusCode;
		return typeof status === "number" && Number.isSafeInteger(status) ? `${text} (status code ${status})` : text;
	}
	return "opencode reported an error";
}
//#endregion
//#region src/runtime/authored-code.ts
/**
* The ONE lint over model-authored source.
*
* Two features have a model write code the runtime then runs: `authorStrategy` (an authored
* optimization strategy, since 0.60) and code mode's `execute` (a program over the coordination
* verbs). Both need the same refusals; this module is the single copy both import.
*
* A LINT, NOT A SANDBOX — it reads text and cannot constrain what running code does, and trivial
* concatenation defeats any token match. Its only job is refusing the obvious escapes so a typo or
* a lazy model does not run; it is never the security boundary. Isolation, where required, is the
* execution boundary's job (a jailed runner, a sandboxed loader), never this check's.
*/
/** Refuse the obvious escapes in authored source. See the module doc for what this is NOT. */
function assertAuthoredCode(code, options = {}) {
	const context = options.context ?? "authored code";
	const allowed = options.allowedImports ?? [];
	for (const line of code.split("\n")) {
		if (!/^\s*import\s/.test(line)) continue;
		if (!allowed.some((specifier) => line.includes(`'${specifier}'`) || line.includes(`"${specifier}"`))) throw new ValidationError(`${context} rejected: foreign import — ${line.trim().slice(0, 120)}${allowed.length === 0 ? " (no import is allowed here)" : ` (allowed: ${allowed.join(", ")})`}`);
	}
	for (const [pattern, what] of [
		[/\brequire\s*\(/, "require()"],
		[/\bimport\s*\(/, "dynamic import()"],
		[/\beval\s*\(/, "eval()"],
		[/new\s+Function\s*\(/, "new Function()"],
		[/\bprocess\s*[.[]/, "process access"],
		[/\bglobalThis\s*[.[]/, "globalThis access"],
		[/\bfetch\s*\(/, "network access"],
		[/child_process|node:fs|node:net|node:http|worker_threads/, "node builtin access"]
	]) if (pattern.test(code)) throw new ValidationError(`${context} rejected: ${what}`);
}
//#endregion
//#region src/runtime/strategy-author.ts
/**
* authorStrategy — the agent-authored layer as a package primitive (software-3.0): an
* LLM reads a benchmark's per-task LOSSES + the defineStrategy contract and writes a NEW
* optimization strategy as code; the caller gates it like any human-built candidate
* (runBenchmark + a frozen holdout).
*
* Brokered shot()/critique() calls spend through the Supervisor's conserved pool.
* Source validation checks obvious forbidden operations; it is not an execution sandbox.
* Code that uses other execution paths can access state or spend outside that pool.
* Callers must provide isolation when authored code requires an enforced boundary.
*
* The authored module is written to `outDir` and dynamically imported — run under a
* TS-capable loader (tsx) since models often emit type annotations.
*/
/** The compressed consumable a skill carries: everything an author needs to emit a loop. */
const strategyAuthorContract = `
You author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to
spend a compute budget to beat a task's deployable check. You compose exactly two steps:

  shot(spec?: { handle?, messages?, steer?, profile?, tools? }): Promise<ShotResult | null>
    Runs ONE worker attempt (a bounded tool loop) over an artifact.
    - omit handle  => the shot opens its OWN fresh artifact and closes it after (a sample).
    - pass handle  => the shot CONTINUES that artifact (state accumulates across shots).
    - messages     => the carried conversation (pass the previous ShotResult.messages to continue).
    - steer        => a corrective instruction injected before the shot.
    - profile      => a complete AgentProfile — give THIS shot its own instructions,
      model, skills, tools, hooks, and subagents. Include name, harness, and
      model: { provider, default }; put standing instructions in prompt.systemPrompt.
      For example: { ...opts.workerProfile, name: 'researcher',
        prompt: { ...opts.workerProfile.prompt,
          systemPrompt: 'Inspect the evidence before proposing a change.' } }.
      Choose an available model from the current execution setup. Omit profile to use
      the worker's exact profile. Every shot spends from the same conserved budget.
    - tools        => string[] — restrict THIS shot to a subset of the task's tools by
      name (focus an explore shot on read-only tools, an execute shot on write tools).
      Restriction-only; unknown names make the shot fail. ALWAYS select from
      await listTools(handle) — never hardcode. Omitted => the shot sees every tool.
    ShotResult = { messages, score (0..1 on the task's check), passes, total, completions, toolErrors }
    Returns null if the attempt failed infra-wise.

  critique(messages): Promise<string | null>
    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective
    instruction (or null when it judges the work complete). Costs ~1 completion.

  consult(messages, instruction): Promise<string | null>
    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the
    trajectory verbatim (no reformatting) — use it when you need a specific reply format
    (a decision, a prediction). Costs ~1 completion.

  surface.open(task) / surface.close(handle)
    Open a persistent artifact you manage yourself (remember to close in a finally).
    close is idempotent — closing an already-closed handle is a safe no-op.

  listTools(handle): Promise<Array<{ name, description? }>>
    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a
    shot with \`tools\`, you MUST pick names from await listTools(handle); hardcoding
    names from an example kills your shots on every task whose tools differ.

Rules:
- ALWAYS await every shot/critique/surface call — a floating promise that rejects
  crashes the whole benchmark run.
- Stay within ~budget total shots; every shot/critique spends from a conserved pool.
- For a FRESH attempt OMIT \`messages\` entirely (never pass \`[]\` — an empty array is a
  fresh conversation too, but be explicit). To CONTINUE, pass the previous
  ShotResult.messages unchanged.
- Return { score, resolved, completions, progression, shots } — score = the BEST checkpoint
  you reached (keep-best, never final-state), progression = score after each shot.
- The module must be EXACTLY this shape (no other imports, no commentary outside code):

import { defineStrategy } from '@tangle-network/agent-runtime/kernel'
export default defineStrategy('your-strategy-name', async ({ surface, task, opts, budget, shot, critique, listTools }) => {
  // your composition (listTools comes from the destructured context — it is NOT a global)
})
`;
/** Standing behavior callers put in the strategy-author AgentProfile. */
const strategyAuthorSystemPrompt = "You are a senior researcher authoring optimization strategies for agent loops: you read per-task losses like experimental data, form a mechanism-level hypothesis, and author the one composition that tests it. Output exactly one fenced ```ts code block and nothing else.";
/** Static CONTRACT lint over an authored strategy module — the module-boundary
*  enforcement of the harness's two measurement invariants:
*    - author blindness: the only import allowed is the kernel surface. A body that could
*      reach the filesystem, network, or process could read or mutate verifier/artifact
*      state outside the brokered shots, and the harness-verified score would stop
*      meaning "what the shots achieved".
*    - conserved dose: no out-of-band compute (fetch/require/eval) — every unit a
*      strategy spends is metered by the Supervisor's pool, which is what makes
*      equal-budget comparisons between strategies valid.
*  A lint, not a sandbox: its job is keeping the benchmark numbers interpretable. */
function assertStrategyContract(code) {
	assertAuthoredCode(code, { allowedImports: ["@tangle-network/agent-runtime/kernel"] });
}
/** One authoring attempt: chat with the given model, extract the fenced module. Throws
*  when the reply carries no code block. */
async function requestAuthoredCode(opts, profile) {
	const res = await profileChatClient({
		profile,
		executor: opts.executor,
		context: "strategy author"
	}).chat({ messages: [{
		role: "user",
		content: `${opts.contract ?? strategyAuthorContract}\n\nBASELINE RESULTS on the "${opts.environmentName}" environment (budget=${opts.budget}) — the per-task losses are your gradient:\n${opts.lossesJson}\n\nAuthor ONE new strategy that you expect to beat the baselines on THIS environment at the same budget.\n${strategyAuthorMethod}\n\nOutput only the module code block.`
	}] }, { ...opts.signal ? { signal: opts.signal } : {} });
	const match = res.content.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
	if (!match?.[1]) throw new Error(`authorStrategy: no code block in the author's reply: ${res.content.slice(0, 300)}`);
	return match[1];
}
/** Author + load a strategy from losses. Throws when the author emits no loadable module;
*  with `fallbackModel` set, the named fallback gets one attempt first. */
async function authorStrategy(opts) {
	let code;
	try {
		code = await requestAuthoredCode(opts, opts.profile);
	} catch (primaryError) {
		if (!opts.fallbackProfile) throw primaryError;
		code = await requestAuthoredCode(opts, opts.fallbackProfile);
	}
	assertStrategyContract(code);
	mkdirSync(opts.outDir, { recursive: true });
	const file = join(opts.outDir, `authored-${Date.now()}.mts`);
	writeFileSync(file, code);
	const mod = await import(`file://${file}`);
	if (!mod.default || typeof mod.default.driver !== "function" || !mod.default.name) throw new Error(`authorStrategy: ${file} does not export a default Strategy`);
	return {
		strategy: mod.default,
		file,
		code
	};
}
//#endregion
//#region src/runtime/strategy-evolution.ts
/**
* runStrategyEvolution — the multi-generation strategy search: per generation the system
* authors a POPULATION of candidate strategies from the current tournament's losses,
* plays them against the incumbent at equal budget, and advances a champion; one final
* promotion decision runs on a NEVER-BEFORE-USED holdout slice through `promotionGate`.
*
* Measurement invariants (the reasons this design is shaped the way it is):
*  - The author sees TRAIN losses only. The holdout slice is drawn fresh (disjoint task
*    offsets) after all authoring is done — one promotion decision, one untouched slice,
*    so adaptive reuse of evaluation data never enters the verdict.
*  - Every tournament runs at the same per-strategy budget through the conserved pool;
*    candidates cannot win by overspending.
*  - Champion selection within the search is a SEARCH policy (configurable, default
*    cost-aware: ties on score go to the cheapest strategy — a scalar hides a strategy
*    that ties at half the cost). The promotion verdict never comes from search
*    selection; it comes from the gate on the fresh slice.
*  - Every authored artifact's description length (gzip bits) is recorded, so the
*    artifact-complexity-vs-holdout-gap relation is analyzable from any run's report.
*
* Lineage fields (`parent`, `generation`) are recorded on every archive node so a
* descendant-productivity parent-selection policy can be added without changing the
* report schema; the v1 search authors from the latest tournament's losses.
*
* @experimental
*/
/** Strategy means recomputed over the DISCRIMINATING tasks only — tasks where the field
*  strategies did not all score identically. Zero-spread tasks (everyone 1.0, everyone
*  0.0, everyone tied) carry no selection information; averaging over them dilutes real
*  differences toward zero. Search-side denoising only — the gate never uses this. */
function discriminatingMeans(report, fieldOrder) {
	const rows = report.perTask.filter((r) => {
		if (!r.cells) return false;
		const scores = fieldOrder.map((n) => r.cells?.[n]?.score).filter((s) => s !== void 0);
		if (scores.length < fieldOrder.length) return false;
		return Math.max(...scores) - Math.min(...scores) > 0;
	});
	if (rows.length === 0) return null;
	const out = {};
	for (const name of fieldOrder) {
		const cells = rows.map((r) => r.cells?.[name]).filter((c) => !!c);
		out[name] = {
			score: cells.reduce((s, c) => s + c.score, 0) / cells.length,
			usd: cells.reduce((s, c) => s + c.usd, 0) / cells.length
		};
	}
	return out;
}
/** The champion pick over a means table. 'score' takes the best mean score (ties →
*  field order). 'costAware' treats scores within `epsilon` of the best as tied and
*  takes the cheapest — the (score, $) Pareto rule collapsed to one pick. */
function pickChampion(means, fieldOrder, policy, epsilon) {
	const entries = fieldOrder.map((name) => ({
		name,
		summary: means[name]
	})).filter((e) => !!e.summary);
	if (entries.length === 0) throw new Error("pickChampion: the means table carries none of the field strategies");
	const best = Math.max(...entries.map((e) => e.summary.score));
	const pick = policy === "score" ? entries.find((e) => e.summary.score === best) : entries.filter((e) => e.summary.score >= best - epsilon).sort((a, b) => a.summary.usd - b.summary.usd || b.summary.score - a.summary.score)[0];
	if (!pick) throw new Error("pickChampion: empty pick (unreachable)");
	return {
		name: pick.name,
		score: pick.summary.score,
		usd: pick.summary.usd
	};
}
/** Search-side champion selection over a tournament report. */
function selectChampion(report, fieldOrder, policy, epsilon) {
	return pickChampion(report.perStrategy, fieldOrder, policy, epsilon);
}
const fieldSummary = (archive) => archive.map((n) => `- ${n.name} (${n.source}, gen ${n.generation}, last score ${(n.score * 100).toFixed(0)}%)`).join("\n");
/** The author-visible losses: EVERY train task in compact form (score/resolved/
*  progression per cell). A pretty-printed prefix slice would hide the tail tasks from
*  the author and bias which failure modes it can target; the hard cap stays only as a
*  guard against enormous fields. */
const compactLosses = (report, detail) => {
	const r2 = (x) => Math.round(x * 100) / 100;
	const rows = report.perTask.map((row) => row.cells ? {
		task: row.taskId,
		...row.errors ? { errors: Object.fromEntries(Object.entries(row.errors).map(([n, msg]) => [n, msg.slice(0, 100)])) } : {},
		cells: Object.fromEntries(Object.entries(row.cells).map(([name, c]) => [name, detail === "binary" ? {
			resolved: c.resolved,
			usd: Math.round(c.usd * 1e4) / 1e4
		} : {
			score: r2(c.score),
			resolved: c.resolved,
			usd: Math.round(c.usd * 1e4) / 1e4,
			progression: (c.progression ?? []).map(r2)
		}]))
	} : {
		task: row.taskId,
		error: row.error?.slice(0, 80)
	});
	return JSON.stringify(rows).slice(0, 12e3);
};
/** Rename a strategy AND the deliverable's mode label its driver closes over — report
*  keys and observability labels must never diverge for a renamed candidate. */
function renameStrategy(orig, unique) {
	if (orig.name === unique) return orig;
	return {
		name: unique,
		driver: (s, t, o, b) => {
			const agent = orig.driver(s, t, o, b);
			return {
				...agent,
				name: unique,
				act: async (task, scope) => {
					const out = await agent.act(task, scope);
					if (out.kind !== "done") return out;
					const deliverable = {
						...out.deliverable,
						mode: unique
					};
					return {
						...out,
						deliverable
					};
				}
			};
		}
	};
}
/** Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice. */
async function runStrategyEvolution(cfg) {
	const budget = cfg.budget ?? 3;
	const concurrency = cfg.concurrency ?? 3;
	const generations = cfg.generations ?? 2;
	const populationSize = cfg.populationSize ?? 2;
	const baselines = cfg.baselines ?? [
		sample,
		refine,
		sampleThenRefine
	];
	const policy = cfg.champion ?? "costAware";
	const epsilon = cfg.championEpsilon ?? (cfg.objective === "cost" ? cfg.scoreTolerance ?? .05 : .01);
	const byName = new Map(baselines.map((s) => [s.name, s]));
	const codeByName = /* @__PURE__ */ new Map();
	for (const [label, count] of Object.entries({
		trainN: cfg.trainN,
		holdoutN: cfg.holdoutN
	})) if (!Number.isSafeInteger(count) || count < 1) throw new Error(`evolution: ${label} must be a positive integer`);
	const holdoutOffset = cfg.holdoutOffset ?? 0;
	if (!Number.isSafeInteger(holdoutOffset) || holdoutOffset < 0) throw new Error("evolution: holdoutOffset must be a non-negative integer");
	if (baselines.length === 0 || byName.size !== baselines.length) throw new Error("evolution: baselines must have non-empty, unique names");
	if (cfg.checkpoint && !/^sha256:[0-9a-f]{64}$/.test(cfg.checkpoint.executionRef)) throw new Error("evolution checkpoint: executionRef must be a lowercase sha256:<64 hex> digest");
	const fingerprint = cfg.checkpoint ? canonicalCandidateDigest$1({
		schemaVersion: 2,
		executionRef: cfg.checkpoint?.executionRef ?? null,
		environment: cfg.environment.name,
		trainN: cfg.trainN,
		holdoutN: cfg.holdoutN,
		holdoutOffset,
		budget,
		concurrency,
		generations,
		populationSize,
		baselines: baselines.map((baseline) => baseline.name),
		objective: cfg.objective ?? "score",
		scoreTolerance: cfg.scoreTolerance ?? .05,
		champion: policy,
		championEpsilon: epsilon,
		minPairedTasks: cfg.minPairedTasks ?? null,
		band: cfg.band ?? null,
		lossesDetail: cfg.lossesDetail ?? "exact",
		reproducerCheck: cfg.reproducerCheck ?? null,
		modelPreflight: cfg.modelPreflight !== false,
		modelPreflightTimeoutMs: cfg.modelPreflightTimeoutMs ?? null,
		worker: {
			routerBaseUrl: cfg.worker.routerBaseUrl,
			profile: cfg.worker.workerProfile,
			analystProfile: cfg.worker.analystProfile ?? cfg.worker.workerProfile,
			corpusTags: cfg.worker.corpusTags ?? [],
			corpusReadback: cfg.worker.corpusReadback ?? null
		},
		author: {
			profile: cfg.author.profile,
			fallbackProfile: cfg.author.fallbackProfile ?? null,
			executorBackend: cfg.author.executor.backend
		},
		authorContract: strategyAuthorContract
	}) : void 0;
	let ckpt;
	if (cfg.checkpoint?.resume && existsSync(cfg.checkpoint.path)) {
		const raw = JSON.parse(readFileSync(cfg.checkpoint.path, "utf8"));
		if (raw.fingerprint !== fingerprint) throw new Error(`evolution resume: checkpoint design mismatch at ${cfg.checkpoint.path}; use a new checkpoint or restore the original execution dependencies`);
		ckpt = raw;
	}
	const train = checkedTaskSlice(await cfg.tasks(0, cfg.trainN), cfg.trainN, "train", !!cfg.checkpoint);
	const trainDigest = cfg.checkpoint ? canonicalCandidateDigest$1(train) : void 0;
	if (ckpt && ckpt.trainDigest !== trainDigest) throw new Error("evolution resume: train task payloads changed");
	let holdoutPoolDigest;
	const save = (state) => {
		if (cfg.checkpoint) writeFileSync(cfg.checkpoint.path, JSON.stringify({
			...state,
			fingerprint,
			trainDigest,
			holdoutPoolDigest
		}, null, 1));
	};
	let modelsPreflighted = false;
	const bench = async (phase, tasks, strategies) => {
		await cfg.onPhase?.(phase);
		const report = await runBenchmark({
			environment: cfg.environment,
			tasks,
			worker: cfg.worker,
			strategies,
			budget,
			concurrency,
			modelPreflight: modelsPreflighted ? false : cfg.modelPreflight,
			modelPreflightTimeoutMs: cfg.modelPreflightTimeoutMs,
			...cfg.onTask ? { onTask: (row, done, total) => cfg.onTask?.(phase, row, done, total) } : {},
			...cfg.hooks ? { hooks: cfg.hooks } : {}
		});
		modelsPreflighted = true;
		return report;
	};
	const probeTask = train[0];
	if (!probeTask) throw new Error("runStrategyEvolution: empty train slice");
	const probe = await cfg.environment.open(probeTask);
	let toolCatalog;
	try {
		toolCatalog = (await cfg.environment.tools(probeTask, probe)).map((t) => `- ${t.function.name}${t.function.description ? ` — ${t.function.description.slice(0, 120)}` : ""}`).join("\n");
	} finally {
		await cfg.environment.close(probe);
	}
	const gen0 = ckpt?.gen0 ?? await bench("gen0", train, baselines);
	const archive = ckpt?.archive ? [...ckpt.archive] : baselines.map((s) => ({
		name: s.name,
		source: "baseline",
		generation: 0,
		score: gen0.perStrategy[s.name]?.score ?? 0,
		usd: gen0.perStrategy[s.name]?.usd ?? 0
	}));
	const gen0Champion = ckpt?.gen0Champion ?? selectChampion(gen0, baselines.map((s) => s.name), policy, epsilon);
	const generationRows = ckpt?.generations ? [...ckpt.generations] : [];
	const trajectory = ckpt?.trajectory ? [...ckpt.trajectory] : [{
		generation: 0,
		champion: gen0Champion.name,
		score: gen0Champion.score,
		usd: gen0Champion.usd
	}];
	for (const row of generationRows) for (const c of row.candidates) {
		if (c.error) continue;
		if (!c.file || !c.sourceSha256) throw new Error(`evolution resume: missing source identity for '${c.name}'`);
		const bytes = readFileSync(c.file);
		if (sha256Bytes$1(bytes) !== c.sourceSha256) throw new Error(`evolution resume: authored source changed for '${c.name}' (${c.file})`);
		const sourceUrl = pathToFileURL(c.file);
		sourceUrl.searchParams.set("sha256", c.sourceSha256);
		const mod = await import(sourceUrl.href);
		if (!mod.default || typeof mod.default.driver !== "function") throw new Error(`evolution resume: ${c.file} no longer exports a Strategy — cannot restore "${c.name}"`);
		byName.set(c.name, renameStrategy(mod.default, c.name));
		codeByName.set(c.name, bytes.toString("utf8"));
	}
	let authoredOk = generationRows.reduce((n, row) => n + row.candidates.filter((c) => !c.error).length, 0);
	const lastRow = generationRows[generationRows.length - 1];
	let incumbent = lastRow ? lastRow.champion : gen0Champion;
	let latestReport = lastRow ? lastRow.report : gen0;
	if (!ckpt) save({
		gen0,
		gen0Champion,
		generations: generationRows,
		archive,
		trajectory
	});
	for (let g = generationRows.length + 1; g <= generations; g += 1) {
		const lossesJson = compactLosses(latestReport, cfg.lossesDetail ?? "exact");
		const candidates = [];
		const newStrategies = [];
		for (let i = 0; i < populationSize; i += 1) {
			const contract = `${strategyAuthorContract}${cfg.objective === "cost" ? `\n\nYOUR OBJECTIVE: match or exceed the incumbent's SCORE while spending LESS (the losses include usd per task). Promotion requires proven score non-inferiority PLUS significant cost savings — a strategy that ties the score at half the cost WINS; a cheaper strategy that loses score by more than ${((cfg.scoreTolerance ?? .05) * 100).toFixed(0)}pp LOSES.` : ""}\n\nEXAMPLE TOOLS FROM ONE TASK (tool sets VARY per task on this domain — a strategy MUST select tool names from await listTools(handle) at runtime; hardcoding these example names will zero your score on most tasks):\n${toolCatalog}\n\nSTRATEGIES ALREADY IN THE TOURNAMENT (author something MEANINGFULLY different — a new composition, not a rename):\n${fieldSummary(archive)}\n\nYou are authoring candidate ${i + 1} of ${populationSize} this generation; explore a distinct region of the strategy space from your siblings.`;
			try {
				const authored = await authorStrategy({
					profile: cfg.author.profile,
					executor: cfg.author.executor,
					...cfg.author.fallbackProfile ? { fallbackProfile: cfg.author.fallbackProfile } : {},
					contract,
					environmentName: cfg.environment.name,
					lossesJson,
					budget,
					outDir: cfg.outDir
				});
				const unique = byName.has(authored.strategy.name) ? `${authored.strategy.name}-g${g}c${i + 1}` : authored.strategy.name;
				const strategy = renameStrategy(authored.strategy, unique);
				byName.set(unique, strategy);
				codeByName.set(unique, authored.code);
				newStrategies.push(strategy);
				archive.push({
					name: unique,
					source: "authored",
					generation: g,
					parent: incumbent.name,
					gzipBits: gzipSync(Buffer.from(authored.code)).length * 8,
					file: authored.file,
					score: 0,
					usd: 0
				});
				candidates.push({
					name: unique,
					file: authored.file,
					sourceSha256: sha256Bytes$1(Buffer.from(authored.code)),
					gzipBits: gzipSync(Buffer.from(authored.code)).length * 8,
					codeChars: authored.code.length
				});
				authoredOk += 1;
			} catch (e) {
				candidates.push({
					name: `(author-failed g${g}c${i + 1})`,
					error: e instanceof Error ? e.message.slice(0, 300) : String(e)
				});
			}
		}
		const incumbentStrategy = byName.get(incumbent.name);
		if (!incumbentStrategy) throw new Error(`evolution: incumbent "${incumbent.name}" missing from the field`);
		const field = [incumbentStrategy, ...newStrategies];
		const report = await bench(`gen${g}`, train, field);
		for (const node of archive) {
			const cell = report.perStrategy[node.name];
			if (cell) {
				node.score = cell.score;
				node.usd = cell.usd;
			}
		}
		const fieldNames = field.map((s) => s.name);
		const champion = pickChampion(cfg.band ? discriminatingMeans(report, fieldNames) ?? report.perStrategy : report.perStrategy, fieldNames, policy, epsilon);
		generationRows.push({
			generation: g,
			candidates,
			report,
			champion
		});
		trajectory.push({
			generation: g,
			champion: champion.name,
			score: champion.score,
			usd: champion.usd
		});
		incumbent = champion;
		latestReport = report;
		save({
			gen0,
			gen0Champion,
			generations: generationRows,
			archive,
			trajectory
		});
	}
	if (authoredOk === 0) throw new Error("runStrategyEvolution: every author attempt failed across all generations — no search happened; see the candidates[].error entries");
	const poolN = cfg.band?.holdoutPoolN ?? cfg.holdoutN;
	const pool = checkedTaskSlice(await cfg.tasks(cfg.trainN + holdoutOffset, poolN), poolN, "holdout", !!cfg.checkpoint);
	const trainIds = new Set(train.map((task) => task.id));
	if (pool.some((task) => trainIds.has(task.id))) throw new Error("evolution: train and holdout task IDs must be disjoint");
	holdoutPoolDigest = cfg.checkpoint ? canonicalCandidateDigest$1(pool) : void 0;
	if (ckpt?.holdout && ckpt.holdoutPoolDigest !== holdoutPoolDigest) throw new Error("evolution resume: holdout task payloads changed");
	let holdoutTasks = [];
	let bandInfo;
	if (ckpt?.holdout && ckpt.verdict) {
		bandInfo = ckpt.band;
		if (cfg.reproducerCheck && codeByName.has(incumbent.name)) {
			const gateIds = new Set(ckpt.holdout.perTask.map((r) => r.taskId));
			holdoutTasks = pool.filter((t) => gateIds.has(t.id));
		}
	} else if (cfg.band) {
		const maxRef = cfg.band.maxRefScore ?? .99;
		const reference = baselines[0];
		if (!reference) throw new Error("evolution band: baselines[0] required as the screening reference");
		const refScores = (await bench("band-screen", pool, [reference])).perTask.filter((r) => r.cells?.[reference.name]).map((r) => ({
			taskId: r.taskId,
			score: r.cells?.[reference.name]?.score ?? 0
		}));
		const inBandIds = new Set(refScores.filter((r) => r.score <= maxRef).map((r) => r.taskId));
		const kept = pool.filter((t) => inBandIds.has(t.id));
		if (kept.length < cfg.holdoutN) throw new Error(`evolution band: only ${kept.length}/${cfg.holdoutN} holdout tasks have headroom (pool ${cfg.band.holdoutPoolN}, reference "${reference.name}" ≤ ${maxRef}) — widen holdoutPoolN or raise maxRefScore`);
		holdoutTasks = kept.slice(0, cfg.holdoutN);
		bandInfo = {
			screened: refScores.length,
			inBand: kept.length,
			refScores
		};
	} else holdoutTasks = pool;
	let holdout;
	let verdict;
	if (ckpt?.holdout && ckpt.verdict) {
		holdout = ckpt.holdout;
		verdict = ckpt.verdict;
	} else {
		const finalists = [.../* @__PURE__ */ new Set([gen0Champion.name, incumbent.name])].map((n) => byName.get(n)).filter((s) => !!s);
		holdout = await bench("holdout", holdoutTasks, finalists);
		verdict = promotionGate({
			report: holdout,
			incumbent: gen0Champion.name,
			candidate: incumbent.name,
			...cfg.objective === "cost" ? {
				mode: "non-inferiority",
				...cfg.scoreTolerance !== void 0 ? { scoreTolerance: cfg.scoreTolerance } : {}
			} : {},
			...cfg.minPairedTasks !== void 0 ? { minPairedTasks: cfg.minPairedTasks } : {}
		});
		save({
			gen0,
			gen0Champion,
			generations: generationRows,
			archive,
			trajectory,
			holdout,
			verdict,
			...bandInfo ? { band: bandInfo } : {}
		});
	}
	let reproduction;
	const championCode = codeByName.get(incumbent.name);
	if (cfg.reproducerCheck && championCode) {
		const words = cfg.reproducerCheck.summaryMaxWords ?? 64;
		const tolerance = cfg.reproducerCheck.tolerance ?? .05;
		const championHoldoutScore = holdout.perStrategy[incumbent.name]?.score ?? 0;
		try {
			const summary = (await profileChatClient({
				profile: {
					...cfg.author.profile,
					prompt: {
						...cfg.author.profile.prompt,
						systemPrompt: `Summarize the optimization strategy implemented by this code in at most ${words} words. Describe the COMPOSITION (shots, critique, artifact handling, restarts, stopping) — not the code. Output only the summary.`
					}
				},
				executor: cfg.author.executor,
				context: "strategy reproducer summary"
			}).chat({ messages: [{
				role: "user",
				content: championCode
			}] })).content.trim();
			const reproduced = await authorStrategy({
				profile: cfg.author.profile,
				executor: cfg.author.executor,
				...cfg.author.fallbackProfile ? { fallbackProfile: cfg.author.fallbackProfile } : {},
				contract: `${strategyAuthorContract}\n\nIMPLEMENT EXACTLY THIS STRATEGY (a colleague's description — do not invent a different approach):\n${summary}`,
				environmentName: cfg.environment.name,
				lossesJson: "[]",
				budget,
				outDir: cfg.outDir
			});
			const reproStrategy = {
				name: `${incumbent.name}-reproduced`,
				driver: reproduced.strategy.driver
			};
			const reproducedHoldoutScore = (await bench("reproduce", holdoutTasks, [reproStrategy])).perStrategy[reproStrategy.name]?.score ?? 0;
			reproduction = {
				summary,
				reproducedName: reproStrategy.name,
				file: reproduced.file,
				championHoldoutScore,
				reproducedHoldoutScore,
				gap: championHoldoutScore - reproducedHoldoutScore,
				reproducible: reproducedHoldoutScore >= championHoldoutScore - tolerance
			};
		} catch (e) {
			reproduction = {
				summary: "",
				reproducedName: "",
				championHoldoutScore,
				reproducedHoldoutScore: 0,
				gap: championHoldoutScore,
				reproducible: false,
				error: e instanceof Error ? e.message.slice(0, 300) : String(e)
			};
		}
	}
	return {
		gen0,
		gen0Champion,
		generations: generationRows,
		archive,
		finalChampion: incumbent,
		holdout,
		verdict,
		...bandInfo ? { band: bandInfo } : {},
		...reproduction ? { reproduction } : {},
		trajectory
	};
}
function checkedTaskSlice(tasks, count, label, snapshot) {
	if (!Number.isSafeInteger(count) || count < 1 || tasks.length !== count) throw new Error(`evolution: ${label} must supply exactly ${count} tasks; received ${tasks.length}`);
	const ids = /* @__PURE__ */ new Set();
	for (const task of tasks) {
		if (typeof task.id !== "string" || !task.id.trim() || ids.has(task.id)) throw new Error(`evolution: ${label} task IDs must be non-empty and unique`);
		ids.add(task.id);
	}
	return snapshot ? immutableCandidateValue(tasks) : tasks;
}
//#endregion
//#region src/runtime/supervise/chat-transport-executor.ts
/**
* A session-owning composition over Runtime's canonical Router tool-loop executor.
*
* This module adds conversation persistence for graph-edge `resume` continuity. It does not own
* model selection, prompts, generation controls, retries, tool policy, or provider accounting:
* those are lowered from one exact `AgentProfile` by `createExecutor({ backend: 'router-tools' })`.
*
* @experimental
*/
/** In-memory, process-local conversation store with detached reads and writes. */
function createChatSessionStore() {
	const sessions = /* @__PURE__ */ new Map();
	return {
		load(workerId) {
			const messages = sessions.get(workerId);
			return messages === void 0 ? void 0 : structuredClone(messages);
		},
		save(workerId, messages) {
			sessions.set(workerId, structuredClone(messages));
		}
	};
}
function exactProfile(profile, context) {
	const parsed = agentProfileSchema.safeParse(profile);
	if (!parsed.success) throw new ValidationError(`${context}: invalid AgentProfile: ${parsed.error.message}`);
	assertExecutableAgentProfile(parsed.data, context);
	return parsed.data;
}
function initialMessages(opts) {
	if (!opts.resume) return void 0;
	if (!opts.sessions) throw new ValidationError("chat transport: a 'resume' spawn needs the session store holding the prior conversation");
	const prior = opts.sessions.load(opts.resume.ofWorker);
	if (prior === void 0) throw new ValidationError(`chat transport: no recorded conversation for worker '${opts.resume.ofWorker}'`);
	return prior;
}
function executorConfig(opts) {
	const profile = exactProfile(opts.profile, "chat transport");
	if (!opts.complete && !opts.url) throw new ValidationError("chat transport: url required unless complete is injected");
	const tools = opts.tools ?? [];
	for (const tool of tools) if (!tool.spec.function.name || typeof tool.execute !== "function") throw new ValidationError("chat transport: every tool needs spec.function.name and execute");
	const resumed = initialMessages(opts);
	return {
		profile,
		config: {
			backend: "router-tools",
			routerBaseUrl: opts.url ?? "http://injected.invalid",
			routerKey: opts.bearer ?? (opts.complete ? "injected-transport" : ""),
			tools: tools.map((tool) => tool.spec),
			executeToolCall: async (name, args, task) => {
				const tool = tools.find((candidate) => candidate.spec.function.name === name);
				if (!tool) throw new ValidationError(`chat transport: unknown tool ${JSON.stringify(name)}`);
				return tool.execute(args, task);
			},
			...opts.complete ? { complete: opts.complete } : {},
			...resumed ? { initialMessages: resumed } : {},
			...opts.sessions && opts.sessionKey ? { onMessages: (messages) => {
				opts.sessions?.save(opts.sessionKey, messages);
			} } : {}
		}
	};
}
function buildChatTransportExecutor(opts, context) {
	const { config, profile } = executorConfig(opts);
	const spec = {
		profile,
		harness: null
	};
	return mapExecutorResult(createExecutor(config)(spec, context), (result) => {
		const raw = result.out;
		const content = typeof raw?.content === "string" ? raw.content : "";
		return {
			outRef: contentAddress({
				kind: "chat-transport",
				profile,
				content
			}),
			out: content,
			...result.verdict ? { verdict: result.verdict } : {}
		};
	});
}
/**
* Build one exact profile-driven chat executor through `createExecutor`.
* Prefer `chatWorkerSeam` for supervised work because it supplies trusted node identity.
*/
function chatTransportExecutor(opts) {
	return buildChatTransportExecutor(opts, {
		signal: new AbortController().signal,
		seams: {}
	});
}
/** Session-owning worker factory for graph continuity. */
function chatWorkerSeam(opts) {
	if (!opts.complete && !opts.url) throw new ValidationError("chatWorkerSeam: url required unless complete is injected");
	const sessions = opts.sessions ?? createChatSessionStore();
	return (rawProfile, spawnContext) => {
		const profile = exactProfile(rawProfile, "chatWorkerSeam");
		return {
			name: profile.name ?? "chat-worker",
			act: async () => void 0,
			executorSpec: {
				profile,
				harness: null,
				executorFactory: (executorSpec, context) => {
					const executor = buildChatTransportExecutor({
						profile: executorSpec.profile,
						...opts.url ? { url: opts.url } : {},
						...opts.bearer ? { bearer: opts.bearer } : {},
						...opts.tools ? { tools: opts.tools } : {},
						...opts.complete ? { complete: opts.complete } : {},
						sessions,
						...context.node?.nodeId ? { sessionKey: context.node.nodeId } : {},
						...spawnContext?.resume ? { resume: spawnContext.resume } : {}
					}, context);
					return opts.deliverable ? gateOnDeliverable(executor, opts.deliverable) : executor;
				}
			}
		};
	};
}
//#endregion
//#region src/runtime/supervise/code-mode.ts
/**
* Code mode — the pattern Cloudflare ("Code Mode") and Anthropic ("code execution with MCP")
* define, over this runtime's coordination verbs: generate a typed API from the tools' schemas,
* expose exactly two tools (`search`, `execute`), and run model-written code whose only intended
* capability is the API bindings. One model turn where the tool-calling loop pays one round trip
* per call; intermediates live in the program, not the context window.
*
* WHAT THIS RUNTIME OWNS AND THE SOURCES' CENTRAL PROPERTY — read this before choosing a runner.
* The sources isolate execution in a REAL boundary: Cloudflare runs the code in a V8 isolate with
* a separate heap; Anthropic runs it out of process. That is not a detail — it is the whole reason
* "let the model write code" is safe. This runtime does NOT ship an isolate, so `execute`'s
* execution boundary is a SEAM you must fill: `codeModeSupervisorTools(runner)` REQUIRES a
* `CodeModeRunner`, and there is no default. For untrusted model output, supply a jailed runner
* (a sub-sandbox, a worker isolate). {@link unsafeInProcessRunner} is provided for TRUSTED output
* only — your own eval harness, an offline test, a model you control — and is named for what it is:
* `node:vm` shares the host realm, so host code is reachable from inside it and it is not a
* security boundary. Choosing it for a hostile model is remote code execution, by construction.
*
* WHAT IS GENUINELY THIS RUNTIME'S CONTRIBUTION, and survives audit: every call the program makes
* crosses the IDENTICAL kernel path an MCP verb crosses. Bindings dispatch through `context.verbs`
* → the live coordination descriptor's own handler → authorization, the conserved pool, the
* journal ("there is no second spawn path"). The model authors a workflow as code at runtime and
* the kernel still meters and records every edge of it — a dynamic workflow system, not a bypass.
* Verb RESULTS are detached (JSON round-trip) before they re-enter the program, so in-code calls
* cannot mutate live coordination state the MCP transport would have copied.
*
* WHAT STAYS THE MODEL'S: `submit_result`, `stop`, `ask_parent` are never in the API — a program
* that could settle the run would be a second brain. `search` names them and says why. Code does
* the mechanics; the model keeps the judgment, the same split the sources draw.
*
* THE GRANT CANNOT DRIFT FROM THE DOCS: `search` renders from `context.coordinationTools()`, the
* same descriptor objects the verbs are served from — never prose written beside them.
*/
/** The coordination verbs callable in code, and the `context.verbs` member each maps to. */
const CODE_CALLABLE_VERBS = {
	spawn_worker: "spawnAgent",
	await_event: "awaitEvent",
	steer_agent: "steerAgent",
	observe_agent: "observeAgent",
	list_questions: "listQuestions",
	answer_question: "answerQuestion",
	run_analyst: "runAnalyst",
	read_journal: "readJournal",
	define_analyst: "defineAnalyst"
};
/** The manager's own lifecycle verbs — never callable from code; `search` names them and why. */
const LIFECYCLE_VERBS = [
	"submit_result",
	"stop",
	"ask_parent"
];
/** Render a JSON Schema as TypeScript type text. Bounded and structural: enough for tool input
*  schemas (objects, enums, arrays, unions); anything unrecognized renders `unknown`, never a
*  guess. Module-level (not root) export: consumed by `renderCodeModeApi` and its tests only. */
function renderJsonSchemaType(schema, depth = 0) {
	if (depth > 6 || typeof schema !== "object" || schema === null) return "unknown";
	const node = schema;
	if (node.const !== void 0) return JSON.stringify(node.const);
	if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ");
	const variants = node.anyOf ?? node.oneOf;
	if (Array.isArray(variants)) return variants.map((variant) => renderJsonSchemaType(variant, depth + 1)).join(" | ");
	const type = Array.isArray(node.type) ? node.type : [node.type];
	if (type.includes("object") || node.type === void 0 && node.properties !== void 0) {
		const properties = node.properties ?? {};
		const required = new Set(Array.isArray(node.required) ? node.required : []);
		const fields = Object.entries(properties).map(([name, property]) => {
			const doc = describeSchema(property);
			const optional = required.has(name) ? "" : "?";
			return `${doc}${JSON.stringify(name).slice(1, -1)}${optional}: ${renderJsonSchemaType(property, depth + 1)}`;
		});
		if (fields.length === 0) return "Record<string, unknown>";
		const indent = "  ".repeat(depth + 1);
		return `{\n${fields.map((field) => `${indent}${field}`).join("\n")}\n${"  ".repeat(depth)}}`;
	}
	if (type.includes("array")) return `Array<${renderJsonSchemaType(node.items, depth + 1)}>`;
	const primitives = type.map((entry) => entry === "integer" ? "number" : typeof entry === "string" ? entry : void 0).filter((entry) => entry === "string" || entry === "number" || entry === "boolean" || entry === "null");
	return primitives.length > 0 ? primitives.join(" | ") : "unknown";
}
function describeSchema(schema) {
	const description = typeof schema === "object" && schema !== null ? schema.description : void 0;
	if (typeof description !== "string" || description.length === 0) return "";
	const first = description.split("\n")[0] ?? "";
	return `/** ${first.length > 140 ? `${first.slice(0, 140)}…` : first} */ `;
}
/** Render the callable API from tool faces — `declare function` per tool, doc from its own
*  description. This is the text `search` answers; generated, never hand-written. Module-level
*  export for tests. */
function renderCodeModeApi(tools, query) {
	const needle = query?.trim().toLowerCase();
	const blocks = tools.filter((tool) => !needle || tool.name.toLowerCase().includes(needle) || (tool.description ?? "").toLowerCase().includes(needle)).map((tool) => {
		const doc = (tool.description ?? "").split("\n")[0] ?? "";
		const args = tool.inputSchema === void 0 ? "unknown" : renderJsonSchemaType(tool.inputSchema);
		return `/** ${doc} */\ndeclare function ${tool.name}(args: ${args}): Promise<unknown>`;
	});
	const header = [
		"// Call these as `api.<name>(args)` from code passed to `execute`.",
		"// Results are the same JSON the tools return. Intermediates stay in your program;",
		"// return only what the next decision needs.",
		`// NOT callable from code: ${LIFECYCLE_VERBS.join(", ")} — those are your own tools,`,
		"// because a program that could settle the run would be a second brain."
	].join("\n");
	if (blocks.length === 0) return `${header}\n\n// No API member matches ${JSON.stringify(query ?? "")}. Call search with no query for the full API.`;
	return `${header}\n\n${blocks.join("\n\n")}`;
}
/**
* An in-process runner for TRUSTED model output ONLY. NOT a security boundary.
*
* It runs the program in a `node:vm` context whose globals are the bindings (`api`) and a
* capturing `console`, with code generation disabled and inherited properties stripped. Those are
* capability discipline, not containment: `node:vm` shares the host realm, and a host function's
* `.constructor` is the host `Function`, so code that WANTS out can get out
* (`api.<binding>.constructor('return process')()`). Use this for your own eval harness, offline
* tests, or a model you trust; for untrusted output supply a jailed `CodeModeRunner` instead.
*/
function unsafeInProcessRunner() {
	return { async run({ code, bindings, signal }) {
		const logs = [];
		const capture = (level) => (...args) => {
			const line = args.map((value) => typeof value === "string" ? value : safeJson(value)).join(" ");
			if (logs.length < 200) logs.push(level === "log" ? line : `[${level}] ${line}`);
		};
		const target = Object.create(null);
		for (const [name, fn] of Object.entries(bindings)) target[name] = fn;
		const sandbox = Object.create(null);
		sandbox.api = new Proxy(Object.freeze(target), { get(owned, member) {
			if (typeof member !== "string") return void 0;
			if (Object.hasOwn(owned, member)) return owned[member];
			throw new ValidationError(LIFECYCLE_VERBS.includes(member) ? `code mode: api.${member} is not callable from code — it is the manager's own lifecycle verb; return from your program and call it as a tool` : `code mode: api.${member} is not in the granted API — call search to see what is`);
		} });
		sandbox.console = Object.freeze({
			log: capture("log"),
			warn: capture("warn"),
			error: capture("error")
		});
		const context = createContext(sandbox, { codeGeneration: {
			strings: false,
			wasm: false
		} });
		const program = runInContext(`(async () => {\n${code}\n})()`, context);
		const aborted = new Promise((_resolve, reject) => {
			if (signal.aborted) reject(abortReason(signal));
			else signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
		});
		return {
			result: await Promise.race([program, aborted]) ?? null,
			logs
		};
	} };
}
function abortReason(signal) {
	const reason = signal.reason;
	return reason instanceof Error ? reason : new ValidationError("code mode: program aborted");
}
function safeJson(value) {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}
/** Detach a verb result before it re-enters the program — the deep copy the MCP transport makes,
*  so in-code calls cannot mutate live coordination state. Matches the MCP path exactly (both
*  JSON round-trip); a non-serializable result degrades to a marker rather than leaking a live
*  reference. */
function detach(value) {
	if (value === void 0) return void 0;
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return { nonSerializable: true };
	}
}
/**
* Put a supervisor in code mode: its product tool surface becomes exactly `search` and `execute`.
*
* `runner` is REQUIRED and has no default — this runtime ships no isolate, so the execution
* boundary is the caller's explicit choice (see the module doc). Use {@link unsafeInProcessRunner}
* for trusted output; a jailed runner for untrusted models.
*
* Pass the result as `SuperviseOptions.resolveSupervisorTools` (which `runGraph` forwards to its
* root supervisor). The graph engine's `supervisorKind` does not accept it yet, so a graph
* supervisor node cannot be put in code mode through node config today.
*/
function codeModeSupervisorTools(runner, options = {}) {
	if (runner === void 0 || typeof runner.run !== "function") throw new ValidationError("codeModeSupervisorTools: a CodeModeRunner is required (no default) — pass unsafeInProcessRunner() for trusted output, or a jailed runner for untrusted models");
	const timeoutMs = options.timeoutMs ?? null;
	if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) throw new ValidationError("codeModeSupervisorTools: timeoutMs must be a positive safe integer or null");
	const faces = (context) => context.coordinationTools().filter((tool) => CODE_CALLABLE_VERBS[tool.name] !== void 0);
	return () => [{
		name: "search",
		description: "Search the callable API. Returns TypeScript declarations for the operations your code may call, generated from the live grant. Optional `query` filters by name or description; omit it for the full API.",
		inputSchema: {
			type: "object",
			properties: { query: {
				type: "string",
				description: "Substring filter over names and descriptions."
			} }
		},
		handler: async (raw, context) => {
			const query = typeof raw === "object" && raw !== null ? raw.query : void 0;
			return renderCodeModeApi(faces(context), typeof query === "string" ? query : void 0);
		}
	}, {
		name: "execute",
		description: "Run JavaScript against the API from `search`. Write the BODY of an async function: call `api.<name>(args)` (await each call), use loops and Promise.all for fan-out, keep intermediates in variables, `return` only what the next decision needs. `console.log` lines come back beside the result. No imports, no network, no filesystem — the API is the intended capability.",
		inputSchema: {
			type: "object",
			properties: { code: {
				type: "string",
				description: "The async function body to run."
			} },
			required: ["code"]
		},
		handler: async (raw, context) => {
			const code = typeof raw === "object" && raw !== null ? raw.code : void 0;
			if (typeof code !== "string" || code.trim().length === 0) throw new ValidationError("code mode: execute needs { code: string }");
			assertAuthoredCode(code, { context: `code mode (${context.nodeId})` });
			const execution = new AbortController();
			let timedOut = false;
			const onScopeAbort = () => execution.abort(abortReason(context.signal));
			const clearTimer = timeoutMs === null ? void 0 : armDeadlineTimer(timeoutMs, () => {
				if (!execution.signal.aborted) {
					timedOut = true;
					execution.abort(new ValidationError(`code mode: program timed out after ${timeoutMs}ms`));
				}
			}, true);
			if (context.signal.aborted) execution.abort(abortReason(context.signal));
			else context.signal.addEventListener("abort", onScopeAbort, { once: true });
			const bindings = {};
			for (const face of faces(context)) {
				const member = CODE_CALLABLE_VERBS[face.name];
				if (member === void 0) continue;
				bindings[face.name] = async (args) => {
					if (execution.signal.aborted) {
						if (!timedOut) throw abortReason(execution.signal);
						throw new ValidationError(`code mode: the execute deadline passed; api.${face.name} is refused so no work outlives the call`);
					}
					return detach(await context.verbs[member](args));
				};
			}
			try {
				return await runner.run({
					code,
					bindings,
					signal: execution.signal
				});
			} finally {
				clearTimer?.();
				context.signal.removeEventListener("abort", onScopeAbort);
			}
		}
	}];
}
//#endregion
//#region src/runtime/supervise/patch-checks.ts
const DEFAULT_MAX_DIFF_LINES = 400;
/**
* Default-on credential-path floor: a patch that touches a credential-shaped path is rejected
* regardless of the per-task `forbiddenPaths` config. Catches `.env`, private keys, keystores,
* wallets, and the common secret/credential JSON files.
*/
const secretPathPattern = /(^|\/)(\.env(\.|$)|.*\.(pem|key|p12|pfx|keystore|wallet)|id_rsa|id_ed25519|secrets?\.json|credentials?\.json)$/i;
/** The unified-diff paths the patch touches — the `+++`/`---` headers, de-`a/`/`b/`-prefixed,
*  with `/dev/null` (a delete's other side) dropped. */
function touchedPathsFromPatch(patch) {
	const out = /* @__PURE__ */ new Set();
	for (const line of patch.split(/\r?\n/)) if (line.startsWith("+++ ") || line.startsWith("--- ")) {
		const rest = line.slice(4).trim();
		if (rest === "/dev/null") continue;
		const stripped = rest.startsWith("a/") || rest.startsWith("b/") ? rest.slice(2) : rest;
		out.add(stripped);
	}
	return [...out];
}
/** Count the added/removed content lines in a unified diff (excludes the `+++`/`---` headers). */
function countDiffLines(patch) {
	let count = 0;
	for (const line of patch.split(/\r?\n/)) if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) count += 1;
	return count;
}
/**
*
* The pure mechanical gate — the SINGLE source of the no-op / always-on secret-path floor /
* diff-size / forbidden-path / test / typecheck checks. No I/O: it scores a patch + its
* already-derived pass signals.
*
* Checks in order: (1) no-op rejection, (2) always-on secret-path floor (independent of
* `forbiddenPaths`), (3) forbidden-path, (4) diff-size cap, (5) tests, (6) typecheck.
* Aggregate score: `0.5*tests + 0.3*typecheck + 0.2*(1 - diffLines/maxDiff)`; `valid` is the
* conjunction of all six.
*
* @experimental
*/
function runCoderChecks(input, constraints = {}) {
	const maxDiff = constraints.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;
	const forbidden = constraints.forbiddenPaths ?? [];
	const scores = {};
	const notes = [];
	let pass = true;
	const touched = touchedPathsFromPatch(input.patch);
	if (touched.length === 0 || input.patch.trim().length === 0) {
		pass = false;
		scores.nonEmpty = 0;
		notes.push("empty patch — no files changed");
	} else scores.nonEmpty = 1;
	const touchedSecrets = touched.filter((p) => secretPathPattern.test(p));
	if (touchedSecrets.length > 0) {
		pass = false;
		scores.noSecrets = 0;
		notes.push(`touched secret-shaped paths: ${touchedSecrets.join(", ")}`);
	} else scores.noSecrets = 1;
	const touchedForbidden = forbidden.filter((path) => {
		const prefix = path.endsWith("/") ? path : `${path}/`;
		const exact = prefix.slice(0, -1);
		return touched.some((p) => p === exact || p.startsWith(prefix));
	});
	if (touchedForbidden.length > 0) {
		pass = false;
		scores.forbiddenPath = 0;
		notes.push(`touched forbidden paths: ${touchedForbidden.join(", ")}`);
	} else scores.forbiddenPath = 1;
	const diffLines = countDiffLines(input.patch);
	if (diffLines > maxDiff) {
		pass = false;
		scores.diffSize = 0;
		notes.push(`diff ${diffLines} lines exceeds cap ${maxDiff}`);
	} else scores.diffSize = maxDiff === 0 ? 0 : Math.max(0, 1 - diffLines / maxDiff);
	scores.tests = input.testsPassed ? 1 : 0;
	scores.typecheck = input.typecheckPassed ? 1 : 0;
	if (!input.testsPassed) {
		pass = false;
		notes.push("tests failed");
	}
	if (!input.typecheckPassed) {
		pass = false;
		notes.push("typecheck failed");
	}
	const score = .5 * scores.tests + .3 * scores.typecheck + .2 * scores.diffSize;
	const verdict = {
		valid: pass,
		score: Number.isFinite(score) ? score : 0,
		scores
	};
	if (notes.length > 0) verdict.notes = notes.join("; ");
	return verdict;
}
//#endregion
//#region src/runtime/supervise/patch-deliverable.ts
/**
* Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical
* gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals and returns
* whether the patch is DELIVERED (the `valid` conjunction).
*
* @experimental
*/
function patchDelivered(options = {}) {
	const require = new Set(options.require ?? []);
	const constraints = {
		...options.maxDiffLines !== void 0 ? { maxDiffLines: options.maxDiffLines } : {},
		...options.forbiddenPaths !== void 0 ? { forbiddenPaths: options.forbiddenPaths } : {}
	};
	return {
		describe: "patch: no-op/secret/forbidden/diff-size + required test/typecheck pass",
		check(artifact) {
			return runCoderChecks({
				patch: artifact.patch,
				testsPassed: signalPass(artifact.checks?.tests?.passed, require.has("tests")),
				typecheckPassed: signalPass(artifact.checks?.typecheck?.passed, require.has("typecheck"))
			}, constraints).valid === true;
		}
	};
}
/**
* Resolve a derived PASS signal into the boolean the gate folds in:
*   - signal present  → its value (true/false).
*   - signal absent + required → false (fail closed: the gate demanded a signal that was never run).
*   - signal absent + not required → true (the executor simply didn't run that command).
*/
function signalPass(value, required) {
	if (value !== void 0) return value;
	return !required;
}
//#endregion
//#region src/runtime/supervise/run-context-sql.ts
/**
*
* `createSqlRunContext` — the SQL-backed durable bundle a `createSupervisor().run` (or a
* `runGraph`/`supervise` call that accepts injected stores) needs: a `SqlSpawnJournal`, a
* `SqlResultBlobStore` (both over one `SqlStatements` seam — the same adapter shape
* `SqlConversationJournal` takes), and a fresh `createExecutorRegistry()`, with `resume: true`
* so spreading the context makes the run loadTree-first.
*
* The SQL analogue of `createFileRunContext`: where that bundle owns a directory, this one owns
* tables in a database the caller already operates. The durable coordination side-log and
* cancellation observers remain file-based behind `runDir`; a SQL coordination log is follow-up.
*
* @experimental
*/
/** Build a durable run context over one SQL statement seam. Tables are created on first use. */
function createSqlRunContext(db) {
	return {
		journal: new SqlSpawnJournal(db),
		blobs: new SqlResultBlobStore(db),
		executors: createExecutorRegistry(),
		resume: true
	};
}
//#endregion
//#region src/runtime/supervise/sql-run-context.ts
/**
* A cross-machine run context on the existing autocommit SqlAdapter. Reuse the same database,
* tablePrefix and runId on every host; no runDir or shared filesystem is required.
*
* Each ownership generation gets fresh store capabilities. The public context can inspect SQL
* at any time, but cannot write without acquire(). runGraph/supervise acquire and release it.
* Retained provider execution supplies external admission/result idempotency; SQL does not turn
* an arbitrary unkeyed network effect into an exactly-once operation.
* @experimental
*/
async function createFencedSqlRunContext(db, runId, options = {}) {
	const store = await openSqlRunStore(db, runId, options);
	const { executors } = createInMemoryRunContext({ withDriver: options.withDriver ?? true });
	const cold = async () => projection(await store.read());
	const unowned = async () => {
		throw new SqlRunOwnershipError(`SQL run '${runId}' requires an acquired lease before writing`);
	};
	const context = {
		durability: "sql",
		runId,
		namespace: store.namespace,
		resume: true,
		executors,
		journal: {
			loadTree: async (root) => (await cold()).journal.loadTree(root),
			beginTree: unowned,
			appendEvent: unowned,
			appendEvents: unowned
		},
		blobs: {
			get: async (ref) => (await cold()).blobs.get(ref),
			put: unowned
		},
		coordinationLog: {
			load: async (id, owner) => (await cold()).loadCoordination(id, owner),
			append: unowned
		},
		async acquire(signal) {
			const lease = await store.acquire(signal);
			try {
				const failureController = new AbortController();
				const leaseSignal = AbortSignal.any([lease.signal, failureController.signal]);
				const view = await projection(lease.records);
				let tail = Promise.resolve();
				let accepting = true;
				let failed;
				let hasFailed = false;
				const check = () => {
					leaseSignal.throwIfAborted();
					if (hasFailed) throw failed;
				};
				const read = async (operation) => {
					await tail;
					check();
					return operation();
				};
				const commit = (entry) => {
					if (!accepting) return unowned();
					const captured = detachedSnapshot(entry, "SQL run record");
					const write = tail.then(async () => {
						check();
						if (await view.apply(captured)) await lease.append(captured);
					});
					tail = write.catch((error) => {
						hasFailed = true;
						failed = error;
						failureController.abort(error);
					});
					return write;
				};
				const bound = {
					durability: "sql",
					runId,
					namespace: store.namespace,
					resume: true,
					executors,
					journal: {
						loadTree: (root) => read(() => view.journal.loadTree(root)),
						beginTree: (root, at) => commit({
							kind: "begin",
							root,
							at
						}),
						appendEvent: (root, event) => commit({
							kind: "events",
							root,
							events: [event]
						}),
						appendEvents: (root, events) => commit({
							kind: "events",
							root,
							events: [...events]
						})
					},
					blobs: {
						get: (ref) => read(() => view.blobs.get(ref)),
						put: (ref, value) => commit({
							kind: "blobs",
							ref,
							value
						})
					},
					coordinationLog: {
						load: (id, owner) => read(() => view.loadCoordination(id, owner)),
						append: (id, record, ownerId) => commit({
							kind: "coordination",
							runId: id,
							record,
							...ownerId === void 0 ? {} : { ownerId }
						})
					}
				};
				return {
					context: Object.freeze(bound),
					signal: leaseSignal,
					async release() {
						accepting = false;
						await tail;
						await lease.release();
					}
				};
			} catch (error) {
				await lease.release().catch(() => void 0);
				throw error;
			}
		}
	};
	return Object.freeze(context);
}
/** Reuse the existing journal's uniqueness/sequence rules and blob hash validation verbatim. */
async function projection(entries) {
	const journal = new InMemorySpawnJournal();
	const blobs = new InMemoryResultBlobStore();
	const beginnings = /* @__PURE__ */ new Map();
	const coordination = [];
	const apply = async (entry) => {
		switch (entry.kind) {
			case "begin": {
				const prior = beginnings.get(entry.root);
				await journal.beginTree(entry.root, entry.at);
				beginnings.set(entry.root, entry.at);
				return prior === void 0;
			}
			case "events":
				for (const event of entry.events) await journal.appendEvent(entry.root, event);
				return entry.events.length > 0;
			case "blobs": {
				const existing = await blobs.get(entry.ref);
				await blobs.put(entry.ref, entry.value);
				return existing === void 0;
			}
			case "coordination":
				if (entry.record.event.type === "settled") return false;
				coordination.push(entry);
				return true;
			default: throw new Error("Unknown SQL run record kind");
		}
	};
	for (const entry of entries) await apply(entry);
	return {
		journal,
		blobs,
		apply,
		loadCoordination(id, ownerId) {
			return foldCoordinationRecords(coordination.map(({ runId, ownerId, record }) => ({
				runId,
				...record,
				...ownerId === void 0 ? {} : { ownerId }
			})), id, ownerId);
		}
	};
}
//#endregion
//#region src/runtime/supervise/trajectory-recorder.ts
/**
*
* The SETTLE-time analyst: when a worker finishes, collect its tool spans from a `TraceSource` and run
* agent-eval's PUBLISHED batch analyzers over them — `buildTrajectory` (structured run summary),
* `stuckLoopView` (full-run repeated-call view, complementing the online consecutive detector), and
* `toolWasteView`. Substrate-agnostic: the spans come from any source (an owned loop's buffer OR a
* sandbox box session). No analysis reimplemented — this is the thin bridge into agent-eval's analyzers.
*
* @experimental
*/
/** Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`. */
async function analyzeTrace(source, runId = "worker") {
	const spans = await source.collect();
	const store = new InMemoryTraceStore();
	const laneSpanId = `${runId}-session-lane`;
	if (spans.length > 0) {
		const startedAt = Math.min(...spans.map((span) => span.startedAt));
		const endedAt = Math.max(...spans.map((span) => span.endedAt ?? span.startedAt));
		const agentSpanId = `${runId}-agent`;
		await store.appendSpan({
			spanId: agentSpanId,
			runId,
			kind: "agent",
			name: "trace-source-agent",
			startedAt,
			endedAt
		});
		await store.appendSpan({
			spanId: laneSpanId,
			parentSpanId: agentSpanId,
			runId,
			kind: "custom",
			name: "trace-source-session",
			startedAt,
			endedAt
		});
	}
	for (let i = 0; i < spans.length; i += 1) {
		const s = spans[i];
		if (s) await store.appendSpan({
			...s,
			runId,
			spanId: `${runId}-t${i}`,
			parentSpanId: laneSpanId
		});
	}
	const [trajectory, stuckLoop, toolWaste] = await Promise.all([
		buildTrajectory(store, runId),
		stuckLoopView(store, {
			runId,
			maxInterveningToolCalls: 1
		}),
		toolWasteView(store, { runId })
	]);
	return {
		trajectory,
		stuckLoop,
		toolWaste
	};
}
//#endregion
//#region src/runtime/supervise/untracked-clone.ts
/**
* Worker-clone preparation: make each worker's fresh clone a FAITHFUL copy of the
* shared workspace's working tree, not just of its git history.
*
* `runInWorkspace` materializes a worker dir via `git clone`, which carries only
* COMMITTED files. Real workspaces (SWE-bench instance images: astropy,
* matplotlib) hold compiled extension modules (.so/.pyd) as UNTRACKED build
* artifacts — inside a bare clone `import astropy` dies with "cannot import name
* '_compiler'" before the worker's first edit, so its verify gate is physically
* unpassable regardless of patch quality (observed: 7/7 astropy and 6/6
* matplotlib workers failed exactly this way while the shared workspace verified
* fine). The fix copies the source tree's untracked files — including git-ignored
* build outputs — into the clone right after materialize and before the worker
* starts.
*
* Isolation is preserved: artifacts are COPIED (copy-on-write via FICLONE where
* the filesystem supports it — never hardlinked, a worker rebuild opening an
* artifact with O_TRUNC on a shared inode would corrupt the source workspace for
* every sibling), and an absolute symlink pointing inside the source tree is
* rewritten to the clone-local path so no worker holds a live handle back into
* shared mutable state.
*
* Fidelity stops at git history: every copied path is appended to the clone's
* `.git/info/exclude`, so the clone-side `git add -A` (both the local delegate's
* diff capture and `gitWorkspace.commit`) can never stage pre-existing build
* artifacts into the shared ref — in the source they are untracked, and a
* delivery must not silently start tracking them.
*
* Promoted verbatim from `loops/src/worker-clone.ts` (see agent-dev-container#4519): any harness
* that materializes workers via `git clone` needs the working tree, not just the history.
*
* @experimental
*/
/** Agent-infra dirs living inside a workspace; orchestration state, never build inputs. `.loops` is the pre-rename location of `.agent` supervisor state. */
const SKIPPED_TOP_LEVEL = /* @__PURE__ */ new Set([
	".agent",
	".loops",
	".evolve",
	".agent-worktrees",
	".claude"
]);
/** Warn (and copy anyway) past this untracked payload size. */
const DEFAULT_WARN_BYTES = 2 * 1024 * 1024 * 1024;
/**
* Copy every untracked file of `sourceDir`'s working tree — including git-ignored
* build outputs (`git ls-files --others` with NO exclude flags lists both) — into
* `cloneDir`, then shield the copied paths from the clone's `git add -A` via
* `.git/info/exclude`. Nested git repos (listed as bare `dir/` entries), any path
* containing a `.git` segment, and loop-infra dirs are skipped.
*/
function copyUntrackedIntoClone(sourceDir, cloneDir, opts = {}) {
	const warnBytes = opts.warnBytes ?? DEFAULT_WARN_BYTES;
	const log = opts.log ?? ((message) => console.warn(message));
	const src = resolve(sourceDir);
	const dst = resolve(cloneDir);
	const ls = spawnSync("git", [
		"-C",
		src,
		"ls-files",
		"--others",
		"-z"
	], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024
	});
	if (ls.status !== 0) throw new Error(`git ls-files --others failed in ${src}: ${(ls.stderr ?? "").trim() || `exit ${ls.status}`}`);
	const plan = [];
	for (const rel of (ls.stdout ?? "").split("\0")) {
		if (!rel || rel.endsWith("/")) continue;
		const segments = rel.split("/");
		if (segments.includes(".git")) continue;
		if (SKIPPED_TOP_LEVEL.has(segments[0] ?? "")) continue;
		let stat;
		try {
			stat = lstatSync(join(src, rel));
		} catch {
			continue;
		}
		if (stat.isSymbolicLink()) plan.push({
			rel,
			kind: "symlink",
			size: 0,
			mode: stat.mode
		});
		else if (stat.isFile()) plan.push({
			rel,
			kind: "file",
			size: stat.size,
			mode: stat.mode
		});
	}
	const bytes = plan.reduce((sum, entry) => sum + entry.size, 0);
	if (bytes > warnBytes) log(`worker clone: untracked payload in ${src} is ${(bytes / 1024 / 1024).toFixed(0)}MB (> ${(warnBytes / 1024 / 1024).toFixed(0)}MB) — copying anyway so the clone stays runnable`);
	let copied = 0;
	const excludeLines = [];
	for (const entry of plan) {
		const from = join(src, entry.rel);
		const to = join(dst, entry.rel);
		try {
			mkdirSync(dirname(to), { recursive: true });
			if (entry.kind === "symlink") {
				let target = readlinkSync(from);
				if (isAbsolute(target)) {
					const resolved = resolve(target);
					if (resolved === src || resolved.startsWith(src + sep)) target = join(dst, relative(src, resolved));
				}
				rmSync(to, { force: true });
				symlinkSync(target, to);
			} else {
				copyFileSync(from, to, constants.COPYFILE_FICLONE);
				chmodSync(to, entry.mode & 4095);
			}
			copied += 1;
			excludeLines.push(toExcludePattern(entry.rel));
		} catch (err) {
			log(`worker clone: failed to copy untracked ${entry.rel}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	if (excludeLines.length > 0) {
		const infoDir = join(dst, ".git", "info");
		mkdirSync(infoDir, { recursive: true });
		appendFileSync(join(infoDir, "exclude"), `# untracked artifacts copied from the shared workspace — never commit them back\n${excludeLines.join("\n")}\n`, "utf8");
	}
	return {
		copied,
		bytes
	};
}
/** Root-anchored literal exclude pattern: glob metachars and trailing spaces escaped. */
function toExcludePattern(rel) {
	return `/${rel.replace(/([\\*?[\]])/g, "\\$1").replace(/ +$/, (spaces) => "\\ ".repeat(spaces.length))}`;
}
/**
* Wrap a `Workspace` so every `materialize` (the per-worker `git clone` inside
* `runInWorkspace`) is followed by the untracked-artifact copy above — the clone
* the worker starts in matches the source WORKING TREE, not just its history.
* `commit`/`head` pass through untouched, so delivery semantics are unchanged.
*/
function withUntrackedArtifacts(ws, sourceDir, log) {
	return {
		ref: ws.ref,
		materialize: async (dir) => {
			await ws.materialize(dir);
			copyUntrackedIntoClone(sourceDir, dir, log ? { log } : {});
		},
		commit: (dir, message) => ws.commit(dir, message),
		head: () => ws.head()
	};
}
//#endregion
//#region src/runtime/supervise/worker-evidence.ts
/**
* Evidence-rich worker settlement.
*
* The supervisor BRAIN decides respawn/steer/stop from what a settled worker
* shows it. A bare `finished passed=false patchBytes=6138` starves that
* decision: the brain cannot quote the failing assertion, so its next worker
* goal is authored blind. This module composes the bounded evidence block a
* settling worker appends to its event stream and — on failure — returns as
* its output artifact, so `observe_agent` hands the brain the failing verify
* tail, a diff summary, and the worker's final note instead of counters.
*/
/** Hard cap on one worker's evidence block so the brain's context cannot blow up. */
const EVIDENCE_MAX_CHARS = 3e3;
/** Tail of the verify output — the failing assertion lives at the END of a test log. */
const VERIFY_TAIL_CHARS = 1200;
const PATCH_HEAD_LINES = 40;
const PATCH_LINE_MAX_CHARS = 200;
/** Cap on the worker's closing note inside the evidence block. */
const NOTE_MAX_CHARS = 300;
/**
* Compose the settle evidence block. Section order is priority order under the
* hard cap: the verify tail (what failed) survives before the diff head (what
* was tried) and the worker note — a truncated diff is recoverable from the
* persisted patch file, a truncated failing assertion is not recoverable at all.
*/
function composeWorkerEvidence(input) {
	const sections = [];
	const failures = [...input.testPassed ? [] : ["tests failed"], ...input.typecheckPassed ? [] : ["typecheck failed"]];
	sections.push(input.passed ? "verify PASSED" : `verify FAILED (${failures.join(", ") || "gate not passed"})`);
	const testTail = input.testOutput.trim().slice(-1200);
	if (testTail) sections.push(`--- verify output (tail) ---\n${testTail}`);
	if (!input.typecheckPassed) {
		const typecheckTail = input.typecheckOutput.trim().slice(-400);
		if (typecheckTail) sections.push(`--- typecheck output (tail) ---\n${typecheckTail}`);
	}
	sections.push(diffSummary(input.patch));
	const note = input.reviewerNotes?.trim();
	if (note) sections.push(`--- worker note ---\n${note.slice(0, 300)}`);
	return sections.join("\n").slice(0, EVIDENCE_MAX_CHARS);
}
/**
* What a settled worker exposes as its output artifact (the blob the brain's
* `observe_agent` reads). A passing worker's output is its patch — the
* deliverable. A failing worker's output is its evidence block. A passing
* worker with NO edits — the post-delivery read-only reviewer: the workspace
* already holds a delivered fix, so the gate stays green under an empty diff —
* would otherwise settle with an EMPTY output and its review would be lost, so
* it exposes its evidence block instead (the worker note carries the review).
*/
function settledWorkerOut(input) {
	if (input.evidence.length === 0) return input.patch;
	if (!input.passed) return input.evidence;
	return input.patch.trim().length > 0 ? input.patch : input.evidence;
}
/**
* The worker's closing commentary off a local harness run: the TAIL of its
* stdout (falling back to stderr), bounded to the note cap so a reviewer's
* final verdict line — written last — survives into the evidence block
* (`composeWorkerEvidence` keeps the note's FIRST `NOTE_MAX_CHARS` chars).
*/
function closingWorkerNote(stdout, stderr) {
	const source = stdout.trim() || stderr.trim();
	if (!source) return void 0;
	return source.slice(-300);
}
function diffSummary(patch) {
	const trimmed = patch.trim();
	if (!trimmed) return "--- diff: EMPTY (the worker produced no edits) ---";
	const lines = trimmed.split("\n");
	const filesChanged = lines.filter((line) => line.startsWith("diff --git ")).length;
	const head = lines.slice(0, PATCH_HEAD_LINES).map((line) => line.length > PATCH_LINE_MAX_CHARS ? `${line.slice(0, PATCH_LINE_MAX_CHARS)}~` : line);
	const omitted = lines.length - head.length;
	return `${`--- diff: ${filesChanged} file(s) changed, ${Buffer.byteLength(patch)} bytes; first ${head.length} line(s) ---`}\n${head.join("\n")}${omitted > 0 ? `\n... (${omitted} more patch lines; full patch persisted per worker)` : ""}`;
}
//#endregion
//#region src/runtime/supervise/worktree-fanout.ts
/**
* Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })`
* — equal-k holds by construction (the conserved budget pool bounds the N leaves), and selection is
* the shared valid-only `selectValidWinner` (never a judge).
*
* @experimental
*/
function worktreeFanout(options) {
	const deliverable = options.deliverable ?? patchDelivered({
		...options.maxDiffLines !== void 0 ? { maxDiffLines: options.maxDiffLines } : {},
		...options.forbiddenPaths !== void 0 ? { forbiddenPaths: options.forbiddenPaths } : {},
		...options.require !== void 0 ? { require: options.require } : {}
	});
	const itemSpec = (item) => {
		const executorFactory = (_spec, ctx) => {
			if (!ctx.node) throw new Error("worktreeFanout: supervised node context required");
			return gateOnDeliverable(createWorktreeCliExecutor({
				repoRoot: options.repoRoot,
				profile: item.profile,
				taskPrompt: options.taskPrompt,
				executionAttemptId: ctx.node.attemptId,
				...item.budgetExempt !== void 0 ? { budgetExempt: item.budgetExempt } : {},
				...item.codexReproducible !== void 0 ? { codexReproducible: item.codexReproducible } : {},
				...item.codexReadDeniedPaths !== void 0 ? { codexReadDeniedPaths: item.codexReadDeniedPaths } : {},
				...item.runId ? { runId: item.runId } : {},
				...item.baseRef ? { baseRef: item.baseRef } : {},
				...options.testCmd !== void 0 ? { testCmd: options.testCmd } : {},
				...options.typecheckCmd !== void 0 ? { typecheckCmd: options.typecheckCmd } : {},
				...options.harnessTimeoutMs !== void 0 ? { harnessTimeoutMs: options.harnessTimeoutMs } : {},
				...options.runGit ? { runGit: options.runGit } : {},
				...options.runHarness ? { runHarness: options.runHarness } : {},
				...options.runCommand ? { runCommand: options.runCommand } : {}
			}), deliverable);
		};
		return {
			profile: item.profile,
			harness: null,
			executorFactory
		};
	};
	const selectWinner = selectValidWinner({
		strategy: options.winnerStrategy ?? "highest-score",
		sizeOf: (a) => a.stats.insertions + a.stats.deletions
	});
	return fanout(options.harnesses, {
		itemTask: () => options.taskPrompt,
		label: (item, i) => `${item.name}:${i}`,
		itemSpec: (item) => itemSpec(item),
		selectWinner
	});
}
//#endregion
//#region src/runtime/supervise-surface.ts
/**
* superviseSurface — drive a team of agents to solve a graded `AgenticSurface` task. ONE capability that
* replaces the worker-seam + "self-improving supervisor" wrapper pair: the driver (`profile`) spawns
* workers that each run `runAgentic` over the surface (`refine` by default), settle on the surface's OWN
* check (settled ⟺ resolved — a worker that ran but didn't pass settles invalid, so a keep-best driver
* never counts it done), and feed the driver a self-improvement lens (the still-FAILING tests, by default)
* so the next spawn targets the persistently-hard cases. Returns the deployable outcome + the full
* conserved spend.
*
* WHY this lives here and not as a `supervise()` backend: `runAgentic` depends on the supervise core
* (`strategy.ts` → `supervise/`), so a surface-solving worker cannot be a supervise built-in without an
* import cycle. It is therefore a COMPOSITION of `supervise()` + `runAgentic` at the layer above both —
* the right home for "supervise over a graded surface". The within-run self-improvement is the analyst
* (authored content, swap `analysts`); the across-run kind wraps this call in `improve()`.
*/
/** Instrument every real surface call with the shared push trace source. The last test report remains
*  available on `SurfaceWorkerOut` for compatibility, but analysts read only the persisted spans. */
function traceSurfaceCalls(base) {
	let lastReport = "";
	const trace = createPushTraceSource();
	return {
		surface: {
			name: base.name,
			open: (t) => base.open(t),
			tools: (t, h) => base.tools(t, h),
			async call(h, name, args) {
				const startedAt = Date.now();
				const recordedArgs = structuredClone(args);
				try {
					const out = await base.call(h, name, args);
					trace.record({
						toolName: name,
						args: recordedArgs,
						result: out,
						status: out.startsWith("ERROR:") ? "error" : "ok",
						startedAt,
						endedAt: Date.now()
					});
					if (name === "run_tests") lastReport = out;
					return out;
				} catch (error) {
					trace.record({
						toolName: name,
						args: recordedArgs,
						result: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
						status: "error",
						startedAt,
						endedAt: Date.now()
					});
					throw error;
				}
			},
			score: (t, h) => base.score(t, h),
			close: (h) => base.close(h)
		},
		failing: () => failingTestNames(lastReport),
		traceSource: trace.source
	};
}
/**
* Adapt an `agent-eval` `AnalystRegistry` into the lens shape `supervise({ analysts })` takes.
*
* The two registries were never structurally compatible: eval's class exposes `list()` and
* `run(runId, inputs, opts)` and returns an `AnalystRunResult`, while `supervise` wants `kinds`
* and `run(kindId, trace)`. So `'kinds' in buildDefaultAnalystRegistry()` is `false` and the five
* calibrated lenses in `DEFAULT_TRACE_ANALYST_KINDS` were unreachable from any supervised run —
* every consumer hand-rolled a lens instead (#630).
*
* The adapter lives HERE, not in eval, for one reason: eval must never import runtime, and runtime
* already owns both shapes — it consumes `AnalystFinding` / `AnalystRunResult` from eval for its
* analyst loop and defines the supervise lens itself. Writing it in eval would mean eval declaring
* a duck-typed copy of a type this package already exports.
*
* `kinds` is the DEFINITION list, not `registry.list()`, because `Analyst` carries no `area` while
* `TraceAnalystDefinition` does — `list()` cannot supply the field the lens shape requires. Every
* id must be registered: an unknown kind throws at adapt time rather than returning nothing at run
* time, when the driver would read the silence as "no findings".
*/
function analystsFromRegistry(registry, kinds = DEFAULT_TRACE_ANALYST_KINDS, opts) {
	const registered = new Set(registry.list().map((analyst) => analyst.id));
	const missing = kinds.map((kind) => kind.id).filter((id) => !registered.has(id));
	if (missing.length > 0) throw new ValidationError(`analystsFromRegistry: ${missing.map((id) => JSON.stringify(id)).join(", ")} ${missing.length === 1 ? "is" : "are"} not registered; the registry has ${[...registered].map((id) => JSON.stringify(id)).join(", ") || "<none>"}`);
	const adapted = kinds.map((kind) => ({
		id: kind.id,
		description: kind.description,
		area: kind.area
	}));
	const authoring = opts?.authoring;
	if (authoring !== void 0 && typeof registry.register !== "function") throw new ValidationError("analystsFromRegistry: `authoring` needs a registry with `register`; pass the agent-eval AnalystRegistry itself, not a read-only shim");
	const authoringRegistry = registry;
	return {
		kinds: adapted,
		run: async (kindId, trace) => {
			const result = await registry.run(`supervise-analyst-${kindId}-${randomUUID()}`, { traceStore: trace }, {
				...opts?.runOpts,
				only: [kindId]
			});
			const summary = result.per_analyst.find((entry) => entry.analyst_id === kindId);
			if (summary?.status !== "ok") throw new ValidationError(`analyst ${JSON.stringify(kindId)} did not complete: ${summary?.status ?? "missing result"}`);
			return result.findings;
		},
		...authoring === void 0 ? {} : { register: (definition) => {
			const engine = authoring.resolveEngine(definition.model);
			const analyst = createTraceAnalyst(traceAnalystFromAuthored(definition), {
				engine,
				...authoring.settlementTimeoutMs === void 0 ? {} : { settlementTimeoutMs: authoring.settlementTimeoutMs }
			});
			try {
				authoringRegistry.register(analyst);
			} catch (error) {
				throw new ValidationError(`the lens id ${JSON.stringify(definition.id)} is already registered for this run — analyst ids are shared by every manager in the tree, so pick a more specific id: ${error instanceof Error ? error.message : String(error)}`);
			}
			return {
				id: definition.id,
				description: definition.description,
				area: definition.area
			};
		} }
	};
}
/**
* Map an authored definition onto the eval definition `createTraceAnalyst` compiles.
*
* The version is DERIVED from the definition's own canonical digest, never supplied by the manager.
* That is what makes an invented lens reproducible: the same authored words always compile to the
* same version, two different wordings can never share one, and a finding's `analyst_id`
* plus version names the exact text that produced it.
*/
function traceAnalystFromAuthored(definition) {
	return {
		id: definition.id,
		description: definition.description,
		area: definition.area,
		version: `1.0.0+authored.${canonicalCandidateDigest(definition).slice(-12)}`,
		question: definition.question,
		instructions: definition.instructions,
		toolGroup: definition.toolGroup,
		...definition.limits === void 0 ? {} : { limits: definition.limits },
		...definition.minimumEvidenceCitations === void 0 ? {} : { minimumEvidenceCitations: definition.minimumEvidenceCitations }
	};
}
/** The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
*  the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
*  cases. Swap `analysts` to change what the driver improves from — that's the one knob. */
function failuresAnalyst() {
	return {
		kinds: [{
			id: "failures",
			description: "Surface the worker's still-failing tests so the driver targets them next.",
			area: "progress"
		}],
		run: async (_kindId, trace) => {
			if (!isTraceAnalysisStore(trace)) return missingRunTestsEvidence();
			const report = await latestRunTestsReport(trace);
			if (report === void 0) return missingRunTestsEvidence();
			const failing = failingTestNames(report);
			return { summary: failing.length ? `Latest structured run_tests evidence reports STILL FAILING (${failing.length}): ${failing.join(", ")}. Spawn the next worker to fix exactly these; if a test keeps failing across workers, give it concrete guidance about that case.` : allTestsPassed(report) ? "Latest structured run_tests evidence reports every test passed; stop." : `Latest structured run_tests evidence contains no parseable failing-test names. Refusing to infer them from worker prose. run_tests output: ${report.slice(0, 300)}` };
		}
	};
}
async function latestRunTestsReport(store) {
	const overview = await store.getOverview({ tool_names: ["run_tests"] });
	const candidates = [];
	let ordinal = 0;
	for (const traceId of overview.sample_trace_ids) {
		let spans = (await store.viewTrace({
			trace_id: traceId,
			per_attribute_byte_cap: 16384
		})).spans;
		if (spans === void 0) {
			const matches = await store.searchTrace({
				trace_id: traceId,
				regex_pattern: "run_tests",
				max_matches: 100
			});
			const spanIds = [...new Set(matches.hits.filter((hit) => hit.span_name === "run_tests").map((hit) => hit.span_id))];
			spans = spanIds.length ? (await store.viewSpans({
				trace_id: traceId,
				span_ids: spanIds,
				per_attribute_byte_cap: 16384
			})).spans : [];
		}
		for (const span of spans) {
			if (span.tool_name !== "run_tests") continue;
			const output = span.attributes[OUTPUT_VALUE];
			if (typeof output !== "string") continue;
			candidates.push({
				output,
				endedAt: span.end_time,
				ordinal: ordinal++
			});
		}
	}
	candidates.sort((left, right) => Date.parse(left.endedAt) - Date.parse(right.endedAt) || left.ordinal - right.ordinal);
	return candidates.at(-1)?.output;
}
function failingTestNames(report) {
	const body = /FAILING:\s*([^\n]+)/iu.exec(report)?.[1];
	if (body === void 0) return [];
	return body.replace(/\.\s+COLLECTION-BLOCKED:.*$/iu, "").replace(/\s*\(\+\d+\s+more\)\s*$/iu, "").split(",").map((name) => name.trim()).filter(Boolean);
}
function allTestsPassed(report) {
	const fraction = /(\d+)\s*\/\s*(\d+)\s+tests?\s+passed/iu.exec(report);
	return fraction !== null && Number(fraction[1]) === Number(fraction[2]);
}
function missingRunTestsEvidence() {
	return { summary: "Missing structured run_tests span evidence. Refusing to infer failing-test names from worker prose." };
}
/** One spawned worker = one `runAgentic` attempt over the surface task. The driver's brief is threaded
*  into the attempt (so a re-spawn can take a targeted angle, not an identical retry); `runAgentic` stamps
*  real tokens/usd/ms, forwarded as `Spend`; the still-failing tests are captured for the analyst. */
function surfaceWorkerExecutor(surface, task, worker, strategy) {
	let artifact;
	const traced = traceSurfaceCalls(surface);
	return {
		runtime: "surface-worker",
		async execute(brief) {
			const guidance = typeof brief === "string" ? brief.trim() : brief ? JSON.stringify(brief) : "";
			const attemptTask = guidance ? {
				...task,
				userPrompt: `${task.userPrompt}\n\n— Supervisor guidance for THIS attempt (incorporate it; do not just repeat a prior approach) —\n${guidance}`
			} : task;
			const r = await runAgentic({
				surface: traced.surface,
				task: attemptTask,
				strategy,
				budget: worker.budget ?? 1,
				routerBaseUrl: worker.routerBaseUrl,
				routerKey: worker.routerKey,
				workerProfile: worker.profile,
				...worker.analystProfile ? { analystProfile: worker.analystProfile } : {},
				...worker.innerTurns !== void 0 ? { innerTurns: worker.innerTurns } : {}
			});
			const out = {
				resolved: r.resolved,
				score: r.score,
				shots: r.shots,
				summary: `${strategy.name} ${r.shots} shot(s) → ${(100 * r.score).toFixed(0)}% (${r.resolved ? "resolved" : "unresolved"})`,
				failing: r.resolved ? [] : traced.failing()
			};
			const spent = {
				iterations: r.completions,
				tokens: r.tokens,
				...r.tokensKnown ? {} : { tokensKnown: false },
				usd: r.usd,
				...r.usdKnown ? {} : { usdKnown: false },
				ms: r.ms
			};
			artifact = {
				outRef: `surface-worker:${task.id}:${r.shots}:${r.resolved ? "ok" : "no"}`,
				out,
				verdict: {
					valid: r.resolved,
					score: r.score
				},
				spent
			};
			return artifact;
		},
		traceSource: () => traced.traceSource,
		teardown: () => Promise.resolve({ destroyed: true }),
		resultArtifact() {
			if (!artifact) throw new Error("surfaceWorkerExecutor: resultArtifact before execute");
			return artifact;
		}
	};
}
/** Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and
*  report the deployable outcome + the full conserved spend. This is `supervise()` configured for surfaces
*  — there is no other entrypoint to learn. */
async function superviseSurface(profile, task, opts) {
	const strategy = opts.strategy ?? refine;
	const innerTurns = opts.worker.innerTurns ?? 6;
	const router = opts.router ?? {
		routerBaseUrl: opts.worker.routerBaseUrl,
		routerKey: opts.worker.routerKey
	};
	const budget = opts.budget ?? {
		maxIterations: (innerTurns + 2) * 5 + 16,
		maxTokens: 1e9
	};
	const workerMaxTokens = Math.max(1, Math.floor(budget.maxTokens / 8));
	const makeWorkerAgent = (rawProfile) => {
		const p = rawProfile ?? {};
		return {
			name: typeof p.name === "string" && p.name.length > 0 ? p.name : "surface-worker",
			act: async () => "",
			executorSpec: {
				profile: rawProfile,
				harness: null,
				executor: surfaceWorkerExecutor(opts.surface, task, opts.worker, strategy)
			}
		};
	};
	const deliverable = {
		describe: `resolve the surface task ${task.id} (every required check passes)`,
		check: (out) => out?.resolved === true
	};
	const analysts = opts.analysts === null ? void 0 : opts.analysts ?? failuresAnalyst();
	const result = await supervise(profile, task, {
		makeWorkerAgent,
		deliverable,
		budget,
		workerSlots: opts.workerSlots ?? 1,
		perWorker: {
			maxIterations: innerTurns + 2,
			maxTokens: workerMaxTokens
		},
		router,
		...analysts ? {
			analysts,
			analyzeOnSettle: analysts.kinds.map((k) => k.id)
		} : {}
	});
	const out = result.kind === "winner" ? result.out : void 0;
	const sp = result.spentTotal;
	return {
		resolved: out?.resolved ?? false,
		score: out?.score ?? 0,
		usd: sp.usd,
		tokensIn: sp.tokens.input,
		tokensOut: sp.tokens.output,
		ms: sp.ms,
		completions: sp.iterations
	};
}
//#endregion
//#region src/runtime/surface-diff.ts
/**
*
* Settle-time surface-diff harvest — the read-back dual of the mount manifest.
*
* `RunProvenance.mounts` records what the caller placed INTO a run's workspace before the agent saw
* it (instructions, skills, memory files — the profile surfaces the substrate materialized). This
* module answers the reverse question at settle: **which of those mounted surfaces did the agent
* itself change while working?** Harnesses mutate their own profile-adjacent surfaces as a matter of
* course — a memory file appended to, an instructions file edited, a skill rewritten — and that
* self-mutation is improvement-relevant evidence: an OBSERVED, session-scoped edit that may later be
* lifted into the measured proposal pipeline (`proposeAgentImprovement`), never auto-promoted.
*
* The harvest is harness-agnostic by construction: it compares content hashes against the mount
* manifest, so it needs no harness event format, no refinement protocol, and no knowledge of WHY a
* surface changed. A harness that additionally reports structured self-edit events can enrich this
* signal; nothing requires it to.
*
* The kernel never reads workspace contents itself — the caller supplies the read seam (a box
* `fs.read`, a worktree read, a test double), mirroring how `recordMount` keeps mount hashing with
* the byte owner. Reads return typed outcomes; a failed read is reported as an `unreadable` diff
* carrying the error, never silently dropped.
*
* @experimental
*/
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Contain a reader that violates its typed-outcome contract by THROWING: the module's law is that
*  a failed read becomes an `unreadable` diff, so one bad path must not reject the whole harvest
*  and silently drop every other diff. */
const readOutcome = async (read, path) => {
	try {
		return await read(path);
	} catch (err) {
		return {
			succeeded: false,
			missing: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
/** The collision/dedup key for a path: a leading `./` stripped, so `./AGENTS.md` (a mount
*  recorder's form) and `AGENTS.md` (a file-tree enumeration's form) are one surface. Absolute vs
*  relative cannot be reconciled here — keep those forms consistent between mounts and watches. */
const pathKey = (p) => p.replace(/^\.\//, "");
/**
* Re-read every mounted (and watched) surface and report the ones whose settled state differs from
* the manifest — modified, removed, or created. Unchanged surfaces and still-absent watched paths
* produce no entry; reads run concurrently; output preserves record order, mounts before
* watch-only paths. Mounts and watches sharing a path key are each collapsed to the LAST entry,
* and a watched path that was also mounted compares against its mount (never reports `created`).
*
* The harvest takes no `AbortSignal`: it is pure fan-out over the read seam and waits on nothing
* itself, so every cancellable moment belongs to the reader. Pass a signal to the reader instead
* ({@link BoxSurfaceReaderOptions.signal}, or close over one in a custom {@link SurfaceReader}) —
* that cuts the backoff waits, and the harvest still returns the diffs it did establish rather
* than discarding settle-time evidence on a late cancellation.
*/
async function harvestSurfaceDiffs(options) {
	const byPath = /* @__PURE__ */ new Map();
	for (const entry of options.mounts) byPath.set(pathKey(entry.path), entry);
	const watchByPath = /* @__PURE__ */ new Map();
	for (const watched of options.watch ?? []) {
		if (byPath.has(pathKey(watched.path))) continue;
		watchByPath.set(pathKey(watched.path), watched);
	}
	const mountDiffs = await Promise.all([...byPath.values()].map(async (entry) => {
		const outcome = await readOutcome(options.read, entry.path);
		if (!outcome.succeeded) return outcome.missing ? {
			path: entry.path,
			status: "removed",
			mountedSha256: entry.sha256,
			source: entry.source
		} : {
			path: entry.path,
			status: "unreadable",
			mountedSha256: entry.sha256,
			source: entry.source,
			error: outcome.error
		};
		const settledSha256 = sha256Hex(outcome.value);
		if (settledSha256 === entry.sha256.toLowerCase()) return void 0;
		return {
			path: entry.path,
			status: "modified",
			mountedSha256: entry.sha256,
			source: entry.source,
			settledSha256,
			settledBytes: outcome.value.byteLength
		};
	}));
	const watchDiffs = await Promise.all([...watchByPath.values()].map(async (watched) => {
		const outcome = await readOutcome(options.read, watched.path);
		if (!outcome.succeeded) {
			if (outcome.missing) return void 0;
			return {
				path: watched.path,
				status: "unreadable",
				source: watched.source ?? "watched",
				error: outcome.error
			};
		}
		return {
			path: watched.path,
			status: "created",
			source: watched.source ?? "watched",
			settledSha256: sha256Hex(outcome.value),
			settledBytes: outcome.value.byteLength
		};
	}));
	return [...mountDiffs, ...watchDiffs].filter((d) => d !== void 0);
}
/**
* A {@link SurfaceReader} over a sandbox box's filesystem — the same `box.fs.read` seam
* `openSandboxRun` reads deliverables through, with the same transient-404 posture (bounded
* retry). The box wire returns UTF-8 TEXT (the SDK's binary path is `download()`), which profile
* surfaces are; hashes are computed over the UTF-8 encoding, and content the wire had to
* lossy-decode (a U+FFFD replacement character) is reported `unreadable` rather than hashed as
* mojibake. The SDK's not-found error is detected structurally (`err.name === 'NotFoundError'`)
* and maps to `missing: true` — unless its `resourceType` names something other than a file/path
* (the BOX or session being gone), which is a transport failure, not an absent surface.
*/
function boxSurfaceReader(box, options = {}) {
	return async (path) => {
		const result = await readBoxPathWithRetry(box.fs.read.bind(box.fs), path, {
			attempts: options.attempts ?? 3,
			delayMs: options.retryDelayMs ?? 250,
			signal: options.signal
		});
		if (result.succeeded) {
			if (result.text.includes("�")) return {
				succeeded: false,
				missing: false,
				error: `boxSurfaceReader: content at ${JSON.stringify(path)} is not valid UTF-8 text (the box text wire lossy-decoded it); binary surfaces need a byte-faithful reader`
			};
			return {
				succeeded: true,
				value: new TextEncoder().encode(result.text)
			};
		}
		const err = result.error;
		const notFound = err instanceof Error && err.name === "NotFoundError";
		const resourceType = err && typeof err === "object" && "resourceType" in err ? String(err.resourceType) : void 0;
		const transportGone = resourceType !== void 0 && /sandbox|session/i.test(resourceType);
		return {
			succeeded: false,
			missing: notFound && !transportGone,
			error: err instanceof Error ? err.message : String(err)
		};
	};
}
/**
* A {@link SurfaceReader} over the local filesystem, for worktree/local workers. Every path —
* relative or absolute — must resolve INSIDE `root`: a path that escapes it (`../`, an absolute
* path elsewhere) fails as a contained non-missing outcome rather than reading outside the
* worktree, so a persisted or mistyped manifest path cannot turn the harvest into an
* existence/hash oracle over the host filesystem. Containment is checked twice — once on the
* lexical path, then again on the symlink-resolved path, because `readFile` follows a link and a
* link planted inside the root would otherwise read host bytes through a contained-looking name.
* Absence maps to `missing: true`; every other failure carries the error message.
*/
function fsSurfaceReader(root) {
	const lexicalRoot = resolve(root);
	let resolvedRoot;
	const escapes = (candidate, boundary) => candidate !== boundary && !candidate.startsWith(boundary + sep);
	const outside = (path, boundary) => ({
		succeeded: false,
		missing: false,
		error: `fsSurfaceReader: path ${JSON.stringify(path)} resolves outside the reader root ${JSON.stringify(boundary)}`
	});
	return async (path) => {
		const target = isAbsolute(path) ? resolve(path) : resolve(lexicalRoot, path);
		if (escapes(target, lexicalRoot)) return outside(path, lexicalRoot);
		try {
			resolvedRoot ??= await realpath(lexicalRoot);
		} catch (err) {
			return {
				succeeded: false,
				missing: false,
				error: `fsSurfaceReader: reader root ${JSON.stringify(lexicalRoot)} is unreadable (${err instanceof Error ? err.message : String(err)})`
			};
		}
		try {
			const resolvedTarget = await realpath(target);
			if (escapes(resolvedTarget, resolvedRoot)) return outside(path, resolvedRoot);
			return {
				succeeded: true,
				value: new Uint8Array(await readFile(resolvedTarget))
			};
		} catch (err) {
			const code = err.code;
			return {
				succeeded: false,
				missing: code === "ENOENT" || code === "ENOTDIR",
				error: err instanceof Error ? err.message : String(err)
			};
		}
	};
}
//#endregion
//#region src/runtime/verifier-environment.ts
const submitTool = {
	type: "function",
	function: {
		name: "submit_answer",
		description: "Submit your answer for evaluation. You may submit more than once — the best-scoring submission counts. Submit the COMPLETE final answer, not a fragment.",
		parameters: {
			type: "object",
			properties: { answer: {
				type: "string",
				description: "The complete final answer."
			} },
			required: ["answer"]
		}
	}
};
/** Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it. */
function createVerifierEnvironment(opts) {
	if (opts.extraTools?.length && !opts.callExtra) throw new Error(`${opts.name}: extraTools requires callExtra`);
	const states = /* @__PURE__ */ new Map();
	let seq = 0;
	return {
		name: opts.name,
		async open(task) {
			seq += 1;
			const handle = {
				id: `${opts.name}-${seq}`,
				surface: opts.name
			};
			states.set(handle.id, {
				task,
				submissions: []
			});
			return handle;
		},
		async tools() {
			return [submitTool, ...opts.extraTools ?? []];
		},
		async call(handle, name, args) {
			const state = states.get(handle.id);
			if (!state) return "ERROR: workspace closed";
			if (name === "submit_answer") {
				const answer = String(args.answer ?? "").trim();
				if (!answer) return "ERROR: empty answer";
				state.submissions.push(answer);
				return `submission ${state.submissions.length} recorded`;
			}
			if (opts.callExtra && opts.extraTools?.some((t) => t.function.name === name)) try {
				return await opts.callExtra(state.task, name, args);
			} catch (e) {
				return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
			}
			return `ERROR: unknown tool ${name}`;
		},
		async score(task, handle) {
			const state = states.get(handle.id);
			if (!state || state.submissions.length === 0) return {
				passes: 0,
				total: 1,
				errored: 0
			};
			let best = {
				passes: 0,
				total: 1,
				errored: 0
			};
			const ratio = (s) => s.total > 0 ? s.passes / s.total : 0;
			for (const answer of state.submissions) {
				const s = await opts.check(task, answer);
				if (ratio(s) > ratio(best)) best = s;
			}
			return best;
		},
		async close(handle) {
			states.delete(handle.id);
		}
	};
}
//#endregion
//#region src/runtime/waterfall.ts
/** Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline. */
function createWaterfallCollector() {
	let spans = /* @__PURE__ */ new Map();
	const onEvent = (event) => {
		if (event.target === "agent.spawn") {
			const p = event.payload ?? {};
			const id = p.childId ?? event.id;
			spans.set(id, {
				id,
				label: p.label ?? id,
				runId: event.runId,
				...event.parentId !== void 0 ? { parentId: event.parentId } : {},
				startMs: event.timestamp,
				status: "running",
				usd: 0,
				tokens: {
					input: 0,
					output: 0
				}
			});
			return;
		}
		if (event.target === "agent.child") {
			const p = event.payload ?? {};
			const id = p.childId;
			if (!id) return;
			const span = spans.get(id);
			if (!span) return;
			if (span.endMs !== void 0 && p.retainedExecution === "released") return;
			span.endMs = event.timestamp;
			span.status = p.status === "down" ? "down" : "done";
			span.usd = p.spent?.usd ?? 0;
			span.tokens = {
				input: p.spent?.tokens?.input ?? 0,
				output: p.spent?.tokens?.output ?? 0
			};
			if (typeof p.score === "number") span.score = p.score;
		}
	};
	const report = () => {
		const all = [...spans.values()].sort((a, b) => a.startMs - b.startMs);
		const start = all[0]?.startMs ?? 0;
		const end = Math.max(start, ...all.map((s) => s.endMs ?? s.startMs));
		const byKind = {};
		let totalUsd = 0;
		const totalTokens = {
			input: 0,
			output: 0
		};
		for (const s of all) {
			totalUsd += s.usd;
			totalTokens.input += s.tokens.input;
			totalTokens.output += s.tokens.output;
			const kind = s.label.includes(":") ? s.label.split(":")[0] : s.label;
			let k = byKind[kind];
			if (!k) {
				k = {
					count: 0,
					ms: 0,
					usd: 0,
					tokens: {
						input: 0,
						output: 0
					}
				};
				byKind[kind] = k;
			}
			k.count += 1;
			k.ms += (s.endMs ?? s.startMs) - s.startMs;
			k.usd += s.usd;
			k.tokens.input += s.tokens.input;
			k.tokens.output += s.tokens.output;
		}
		return {
			spans: all,
			totalMs: end - start,
			totalUsd,
			totalTokens,
			byKind
		};
	};
	const render = (opts) => {
		const { spans: all, totalMs, totalUsd, byKind } = report();
		if (all.length === 0) return "(no spans observed)";
		const width = opts?.width ?? 48;
		const maxRows = opts?.maxRows ?? 60;
		const start = all[0]?.startMs ?? 0;
		const scale = totalMs > 0 ? width / totalMs : 0;
		const lines = [];
		const labelWidth = Math.min(24, Math.max(...all.map((s) => s.label.length)) + 1);
		for (const s of all.slice(0, maxRows)) {
			const offset = Math.round((s.startMs - start) * scale);
			const dur = (s.endMs ?? s.startMs) - s.startMs;
			const len = Math.max(1, Math.round(dur * scale));
			const bar = `${" ".repeat(Math.min(offset, width))}${(s.status === "down" ? "░" : "█").repeat(Math.max(1, Math.min(len, width - Math.min(offset, width) + 1)))}`;
			const mark = s.status === "down" ? " DOWN" : s.score !== void 0 ? ` ${(s.score * 100).toFixed(0)}%` : "";
			lines.push(`${s.label.padEnd(labelWidth)}|${bar.padEnd(width + 1)}| ${(dur / 1e3).toFixed(1)}s $${s.usd.toFixed(4)} ${s.tokens.input}/${s.tokens.output}tok${mark}`);
		}
		if (all.length > maxRows) lines.push(`… ${all.length - maxRows} more spans`);
		lines.push("—".repeat(labelWidth + width + 2));
		for (const [kind, k] of Object.entries(byKind)) lines.push(`${kind.padEnd(labelWidth)} ×${k.count}  ${(k.ms / 1e3).toFixed(1)}s busy  $${k.usd.toFixed(4)}  ${k.tokens.input}/${k.tokens.output}tok`);
		lines.push(`TOTAL${" ".repeat(labelWidth - 5)} ${(totalMs / 1e3).toFixed(1)}s wall  $${totalUsd.toFixed(4)}`);
		return lines.join("\n");
	};
	return {
		hooks: { onEvent },
		report,
		render,
		reset: () => {
			spans = /* @__PURE__ */ new Map();
		}
	};
}
//#endregion
//#region src/runtime/workspace.ts
/** Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit). */
function localShell() {
	return async (args, cwd) => {
		const { execFile } = await import("node:child_process");
		const [bin, ...rest] = args;
		return new Promise((resolve) => {
			execFile(bin ?? "", rest, {
				cwd,
				encoding: "utf-8",
				maxBuffer: 64 * 1024 * 1024
			}, (err, stdout, stderr) => {
				resolve({
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					code: err ? err.code ?? 1 : 0
				});
			});
		});
	};
}
/** A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned. */
function gitWorkspace(opts) {
	const shell = opts.shell ?? localShell();
	const branch = opts.branch ?? "main";
	const cfg = opts.noHooks === false ? [] : ["-c", "core.hooksPath=/dev/null"];
	const ident = [
		"-c",
		"user.email=workspace@tangle.local",
		"-c",
		"user.name=workspace"
	];
	const run = async (args, cwd) => {
		const res = await shell([
			"git",
			...cfg,
			...ident,
			...args
		], cwd);
		if (res.code !== 0) throw new Error(`git ${args.join(" ")} failed (${res.code}): ${tail(res.stderr || res.stdout)}`);
		return res.stdout;
	};
	return {
		ref: opts.ref,
		materialize: (dir) => run([
			"clone",
			"--branch",
			branch,
			opts.ref,
			dir
		]).then(() => {}),
		async commit(dir, message) {
			await run(["add", "-A"], dir);
			if (!(await run(["status", "--porcelain"], dir)).trim()) return {
				ok: true,
				rev: (await run(["rev-parse", "HEAD"], dir)).trim()
			};
			await run([
				"commit",
				"-m",
				message
			], dir);
			const pull = await shell([
				"git",
				...cfg,
				...ident,
				"pull",
				"--rebase",
				"origin",
				branch
			], dir);
			if (pull.code !== 0) {
				await shell([
					"git",
					...cfg,
					"rebase",
					"--abort"
				], dir).catch(() => {});
				return {
					ok: false,
					conflict: tail(pull.stderr || pull.stdout)
				};
			}
			const push = await shell([
				"git",
				...cfg,
				...ident,
				"push",
				"origin",
				branch
			], dir);
			if (push.code !== 0) return {
				ok: false,
				conflict: tail(push.stderr || push.stdout)
			};
			return {
				ok: true,
				rev: (await run(["rev-parse", "HEAD"], dir)).trim()
			};
		},
		async head() {
			return (await run([
				"ls-remote",
				opts.ref,
				`refs/heads/${branch}`
			])).split(/\s+/)[0] ?? "";
		}
	};
}
/** A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote).
*  Same port, same `Shell` — a drop-in for `gitWorkspace`. jj suits agent loops:
*  no staging area, and a first-class operation log (native resume/undo). Live use
*  requires `jj` on the `Shell`'s host. */
function jjWorkspace(opts) {
	const shell = opts.shell ?? localShell();
	const branch = opts.branch ?? "main";
	const ident = [
		"--config-toml",
		"user.name=\"workspace\"",
		"--config-toml",
		"user.email=\"workspace@tangle.local\""
	];
	const jj = async (args, cwd) => {
		const res = await shell([
			"jj",
			...ident,
			...args
		], cwd);
		if (res.code !== 0) throw new Error(`jj ${args.join(" ")} failed (${res.code}): ${tail(res.stderr || res.stdout)}`);
		return res.stdout;
	};
	return {
		ref: opts.ref,
		materialize: (dir) => jj([
			"git",
			"clone",
			"--colocate",
			opts.ref,
			dir
		]).then(() => {}),
		async commit(dir, message) {
			await jj([
				"describe",
				"-m",
				message
			], dir);
			await jj(["new"], dir);
			const push = await shell([
				"jj",
				...ident,
				"git",
				"push",
				"--branch",
				branch
			], dir);
			if (push.code !== 0) return {
				ok: false,
				conflict: tail(push.stderr || push.stdout)
			};
			return {
				ok: true,
				rev: (await jj([
					"log",
					"--no-graph",
					"-r",
					"@-",
					"-T",
					"commit_id"
				], dir)).trim()
			};
		},
		async head() {
			return (await shell([
				"git",
				"ls-remote",
				opts.ref,
				`refs/heads/${branch}`
			])).stdout.split(/\s+/)[0] ?? "";
		}
	};
}
/**
* Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back
* so the next worker (or the supervisor) builds on it. This is the seam that turns isolated
* per-worker cwds into one compounding artifact — `body` gets a real materialized dir, its
* delivery is committed to the shared ref iff it's valid (a conflict is returned, never thrown).
* The clone is removed after; durable state lives only in the ref.
*/
async function runInWorkspace(ws, body, opts = {}) {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), opts.tmpPrefix ?? "ws-run-"));
	try {
		await ws.materialize(dir);
		const r = await body(dir);
		if (r.valid || opts.commitOnInvalid) {
			const message = r.message ?? (r.valid ? "worker: delivered" : "worker: wip");
			const commit = await ws.commit(dir, message);
			return {
				valid: r.valid,
				value: r.value,
				commit
			};
		}
		return {
			valid: r.valid,
			value: r.value
		};
	} finally {
		rmSync(dir, {
			recursive: true,
			force: true
		});
	}
}
function tail(s) {
	return s.slice(-400);
}
//#endregion
export { equalKOnCost as $, SqlResultBlobStore as $t, unsafeInProcessRunner as A, loopDispatch as At, strategyAuthorContract as B, deterministicCompletion as Bt, withUntrackedArtifacts as C, HarvestError as Ct, patchDelivered as D, localSandboxClient as Dt, createSqlRunContext as E, resolveSandboxClient as Et, pickChampion as F, declaredCheckDigest as Ft, sharedBoxPlacement as G, renderLeaderboardHtml as Gt, DEFAULT_SHARED_BOX_RESOURCES as H, stopSentinel as Ht, runStrategyEvolution as I, declaredCheckJudge as It, SandboxRunAbortError as J, renderPairwiseMarkdown as Jt, sharedBoxRefusal as K, renderLeaderboardMarkdown as Kt, selectChampion as L, readDeclaredCheck as Lt, chatWorkerSeam as M, assertDeclaredCheck as Mt, createChatSessionStore as N, checkProgramDigest as Nt, runCoderChecks as O, inlineSandboxClient as Ot, discriminatingMeans as P, declaredCheckDeliverable as Pt, promotionGate as Q, openSqlRunStore as Qt, assertStrategyContract as R, runIsolatedCheck as Rt, copyUntrackedIntoClone as S, inProcessSandboxClient as St, createFencedSqlRunContext as T, defineLeaderboard as Tt, DEFAULT_SHARED_BOX_WORKERS as U, leaderboard as Ut, strategyAuthorSystemPrompt as V, sentinelCompletion as Vt, ROUTER_CLIENT_HEADER as W, pairwiseSignificance as Wt, printBenchmarkReport as X, defaultAuditorInstruction as Xt, openSandboxRun as Y, auditIntent as Yt, runBenchmark as Z, SqlRunOwnershipError as Zt, NOTE_MAX_CHARS as _, assertTraceDerivedFindings as _t, localShell as a, sanitizeMcpToolSchema as an, registerShape as at, composeWorkerEvidence as b, registryScopeAnalyst as bt, createVerifierEnvironment as c, resolveMcpServerLaunch as cn, renderCorpusToInstructions as ct, harvestSurfaceDiffs as d, createTangleSandboxExactProcessProvider as dn, loopUntil as dt, SqlSpawnJournal as en, trajectoryReport as et, analystsFromRegistry as f, panel as ft, EVIDENCE_MAX_CHARS as g, widen as gt, worktreeFanout as h, verify as ht, jjWorkspace as i, createMcpEnvironment as in, createShapeRegistry as it, chatTransportExecutor as j, superviseDispatch as jt, codeModeSupervisorTools as k, loopCampaignDispatch as kt, boxSurfaceReader as l, resolveSecretEnv as ln, fanout as lt, superviseSurface as m, selectValidWinner as mt, makeFinding$1 as n, connectStdioMcp as nn, runPersonified as nt, runInWorkspace as o, envKeyProvider as on, FileCorpus as ot, failuresAnalyst as p, pipeline as pt, sharedWorkerClientName as q, renderLeaderboardSvg as qt, gitWorkspace as r, materializeLocalMcp as rn, builtinShapes as rt, createWaterfallCollector as s, mcpSecretEnvMetadataKey as sn, InMemoryCorpus as st, computeFindingId$1 as t, McpSpawnFault as tn, definePersona as tt, fsSurfaceReader as u, secretEnvOfMcpServer as un, flatWidenGate as ut, VERIFY_TAIL_CHARS as v, buildSteerContext as vt, analyzeTrace as w, harvestCorpus as wt, settledWorkerOut as x, observationFromRegistry as xt, closingWorkerNote as y, createScopeAnalyst as yt, authorStrategy as z, completionAuthorizes as zt };

//# sourceMappingURL=runtime-DsAHXig2.js.map