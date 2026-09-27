import { Br as createOtelExporter, Er as resolveRedactor, Ir as buildLoopOtelSpans, Rr as buildRuntimeEventOtelSpans, Vr as flatOtelSpan, rr as resolveAgentEnvironmentProvider, wr as defaultRedactor } from "./supervisor-DtlPj9me.js";
import { a as createRuntimeUsageTotals, i as addRuntimeUsage, n as executeAgentImprovementActivation, o as isUsageAmount, r as verifyAgentImprovementActivationResult, t as createAgentImprovementActivationResult } from "./activation-BkUdrvqh.js";
import { C as canonicalCandidateDigest$1, D as immutableCandidateValue } from "./workspace-archive-C9lgf77y.js";
import { C as optimizationActivationReceiptFromMetadata, D as agentImprovementProfileSurfaceDigest, E as agentImprovementProfileDiffs, F as isAgentImprovementProfileSurface, I as isAgentProfileMeasuredSurface, N as assertProfileImprovementTargetsShareIdentity, O as agentImprovementProfileSurfaceInput, P as buildAgentImprovementActivationTargets, S as createOptimizationActivationReceipt, T as AGENT_PROFILE_MEASURED_SURFACES, V as assertProfileTrainingIsHeldOut, _ as profilePolicyWithBudget, a as executeAgentCandidateExperimentCell, b as profileTaskScenarioIdentity, d as verifyAgentImprovementActivation, f as verifyAgentImprovementProposal, g as profileImprovementMetadata, h as createProfileImprovementCostLedger, i as createAgentImprovementProposal, j as agentImprovementTargetProfileDiffs, l as reviewAgentImprovementProposal, m as verifyCandidateExecutionEvidence, n as createAgentImprovementActivation, o as proposeAgentImprovement, p as verifyAgentImprovementReview, r as createAgentImprovementMeasuredComparison, s as proposeAgentProfileImprovement, t as AgentCandidateExperimentCellExecutionError, u as runAgentCandidateExperiment, v as profilePreparationAccounting, w as AGENT_IMPROVEMENT_PROFILE_SURFACES, x as sealProfileImprovementBenchmark, y as profileStateDigest$1 } from "./improvement-cycle-Bi43xCVa.js";
import { a as AGENT_CANDIDATE_EXECUTION_SUPPORT } from "./prepare-DVlvGP7V.js";
import { d as omitUndefinedObjectFields, f as parseAgentCandidateProfileActivation, i as applyExactAgentProfileDiff, p as parseExactAgentProfile } from "./profile-D3eXNBQV.js";
import { n as exactProcessProviderAsCandidateExecutor, t as createProtectedAgentCandidateModelPort } from "./protected-model-port-BrWgsCnl.js";
import { agentImprovementSourceSchema, agentProfileImprovementArmSchema, applyAgentProfileDiff } from "@tangle-network/agent-interface";
import { contentHash } from "@tangle-network/agent-eval";
import { ATTR } from "@tangle-network/agent-trace-contract";
import { assertProposalFindings } from "@tangle-network/agent-eval/analyst";
import { measuredComparisonFromAgentProfileImprovementExperiment, runAgentProfileImprovementExperiment, sealAgentProfileImprovementExperiment, verifyAgentProfileImprovementExperimentComparison } from "@tangle-network/agent-eval/contract";
//#region src/intelligence/delivery.ts
const defaultPlaneBaseUrl = "https://intelligence.tangle.tools";
const defaultRefreshMs = 3e5;
const defaultPlaneRequestTimeoutMs = 1e4;
const maxPlaneErrorTextLength = 200;
/** Resolve the ONE Intelligence base URL — the single knob both the send and
*  receive paths derive from. Env fallback: `TANGLE_INTELLIGENCE_URL`. */
function resolveIntelligenceBaseUrl(baseUrl) {
	if (baseUrl) return baseUrl.replace(/\/+$/, "");
	if (typeof process !== "undefined" && process.env.TANGLE_INTELLIGENCE_URL) return process.env.TANGLE_INTELLIGENCE_URL.replace(/\/+$/, "");
	return defaultPlaneBaseUrl;
}
function resolveApiKey(apiKey) {
	if (apiKey) return apiKey;
	if (typeof process !== "undefined" && process.env.TANGLE_API_KEY) return process.env.TANGLE_API_KEY;
	return "";
}
/** Make one authenticated request and retain whether the network call began. */
async function requestPlane(input) {
	const doFetch = input.fetchImpl ?? globalThis.fetch;
	if (!doFetch) return {
		succeeded: false,
		attempted: false,
		error: "no fetch implementation available"
	};
	const apiKey = resolveApiKey(input.apiKey);
	if (!apiKey) return {
		succeeded: false,
		attempted: false,
		error: "no apiKey (set TANGLE_API_KEY or opts.apiKey)"
	};
	try {
		return {
			succeeded: true,
			response: await doFetch(`${resolveIntelligenceBaseUrl(input.baseUrl)}${input.path}`, {
				...input.method === void 0 ? {} : { method: input.method },
				headers: {
					authorization: `Bearer ${apiKey}`,
					...input.headers ?? {}
				},
				...input.body === void 0 ? {} : { body: input.body },
				signal: AbortSignal.timeout(input.timeoutMs ?? defaultPlaneRequestTimeoutMs)
			})
		};
	} catch (err) {
		return {
			succeeded: false,
			attempted: true,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
function asRecord(value) {
	return value && typeof value === "object" ? value : {};
}
function capPlaneErrorText(value) {
	return value.slice(0, maxPlaneErrorTextLength);
}
function toDiffProvenance(value) {
	const p = asRecord(value);
	return {
		version: typeof p.version === "number" ? p.version : null,
		lift: typeof p.lift === "string" ? p.lift : null,
		contentHash: typeof p.contentHash === "string" ? p.contentHash : "",
		promotedAt: typeof p.promotedAt === "string" ? p.promotedAt : ""
	};
}
/**
* Deserialize the composed-endpoint response into a `CertifiedProfile`. The
* previously-dropped `agentProfileDiffs`/`capabilities`/`agentProfile` are read
* here so they round-trip to the consumer; a plane that has not yet promoted any
* diffs simply yields empty arrays / a null profile (fail-closed, never a crash).
*/
function normalizeCertifiedProfile(raw) {
	const r = asRecord(raw);
	const promptSurface = r.promptSurface ? r.promptSurface : null;
	const artifacts = r.artifacts ?? {};
	const agentProfileDiffs = Array.isArray(r.agentProfileDiffs) ? r.agentProfileDiffs.map((entry) => {
		const e = asRecord(entry);
		return {
			diff: e.diff,
			provenance: toDiffProvenance(e.provenance)
		};
	}) : [];
	const capabilities = Array.isArray(r.capabilities) ? r.capabilities : [];
	return {
		target: typeof r.target === "string" ? r.target : "",
		generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
		promptSurface,
		artifacts,
		agentProfileDiffs,
		capabilities,
		agentProfile: r.agentProfile ?? null
	};
}
/**
* Pull the certified composed profile for a target. Fail-closed: a network
* error or a non-2xx returns a typed `succeeded: false` (never throws), so a
* caller can run on its base surface when Intelligence is unreachable. A 404 is
* the normal "nothing promoted yet" signal, carried as `status: 404`.
*/
async function pullCertified(opts) {
	const request = await requestPlane({
		...opts,
		path: `/v1/profiles/${encodeURIComponent(opts.target)}/composed`
	});
	if (!request.succeeded) return {
		succeeded: false,
		error: request.attempted ? `pull request failed: ${request.error}` : request.error
	};
	const res = request.response;
	if (res.status === 404) return {
		succeeded: false,
		error: "no certified artifacts promoted for target yet",
		status: 404
	};
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		return {
			succeeded: false,
			error: `pull ${res.status}: ${body.slice(0, 200)}`,
			status: res.status
		};
	}
	try {
		return {
			succeeded: true,
			value: normalizeCertifiedProfile(await res.json())
		};
	} catch (err) {
		return {
			succeeded: false,
			error: `pull response parse failed: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}
/**
* Submit a completed Runtime proposal to Intelligence for product-side review.
* This never runs an experiment, approves a proposal, or applies a candidate.
* A 4xx response is a confirmed `rejected` request. Network failures, timeouts,
* 5xx responses, and invalid success responses are `unconfirmed`, so callers
* can retry the same digest because Intelligence stores proposals idempotently.
*/
async function submitAgentImprovementProposal(opts) {
	let proposal;
	try {
		proposal = verifyAgentImprovementProposal(opts.proposal);
	} catch (err) {
		return {
			succeeded: false,
			submission: "not-sent",
			error: `proposal validation failed: ${err instanceof Error ? err.message : String(err)}`
		};
	}
	const request = await requestPlane({
		...opts,
		path: "/v1/improvements/proposals",
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ proposal })
	});
	if (!request.succeeded) return {
		succeeded: false,
		submission: request.attempted ? "unconfirmed" : "not-sent",
		error: request.attempted ? `proposal submission request failed: ${request.error}` : request.error
	};
	const res = request.response;
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		let code;
		let message = capPlaneErrorText(body);
		try {
			const parsed = asRecord(JSON.parse(body));
			if (typeof parsed.error === "string") code = capPlaneErrorText(parsed.error);
			if (typeof parsed.message === "string") message = capPlaneErrorText(parsed.message);
		} catch {}
		return {
			succeeded: false,
			submission: res.status >= 400 && res.status < 500 ? "rejected" : "unconfirmed",
			error: `proposal submission ${res.status}: ${message}`,
			status: res.status,
			...code === void 0 ? {} : { code }
		};
	}
	try {
		const recorded = verifyAgentImprovementProposal(asRecord(await res.json()).proposal);
		if (recorded.digest !== proposal.digest) return {
			succeeded: false,
			submission: "unconfirmed",
			error: "proposal submission returned a different proposal digest",
			status: res.status
		};
		return {
			succeeded: true,
			value: recorded,
			status: res.status
		};
	} catch (err) {
		return {
			succeeded: false,
			submission: "unconfirmed",
			error: `proposal submission response parse failed: ${capPlaneErrorText(err instanceof Error ? err.message : String(err))}`,
			status: res.status
		};
	}
}
/** Artifact-type buckets that fold into the system prompt, in fold order. A
*  certified `context` capability whose content is free text (`instructions`)
*  is delivered here so it actually reaches the agent — never bucketed into a
*  type the fold then silently skips. The resolver reuses this exact set so its
*  `promptAdditions` slot matches the folded prompt byte-for-byte. */
const promptFoldTypes = [
	"prompt-surface",
	"skill",
	"instructions"
];
/**
* Fold the certified prompt surface (and any certified prompt-folding artifacts:
* `prompt-surface` / `skill` / `instructions`) into a base system prompt under a
* marked section, so the deployed agent prompt == base + the gate-certified
* additions. Order is stable (prompt surface first, then artifact buckets in
* `promptFoldTypes` order, then by path within a bucket) so the same profile
* renders byte-identically each call. Returns `base` unchanged when there is no
* usable certified content. Reads only the prompt-folding slice of a profile.
*/
function composeCertifiedPrompt(base, certified) {
	if (!certified) return base;
	const parts = [];
	if (certified.promptSurface?.surface.trim()) parts.push(certified.promptSurface.surface.trim());
	for (const type of promptFoldTypes) {
		const bucket = certified.artifacts[type] ?? [];
		for (const a of [...bucket].sort((x, y) => (x.path ?? "").localeCompare(y.path ?? ""))) if (a.content.trim()) parts.push(a.content.trim());
	}
	if (parts.length === 0) return base;
	return `${base.trim()}\n\n## Certified guidance (Tangle Intelligence)\n\n${parts.join("\n\n")}`;
}
/**
* Create the cached certified-prompt source — the ONE module-scope-cache +
* coalesced-refresh + keep-last-known implementation. Product wiring uses this
* rather than hand-rolling the same lines around `pullCertified`. The
* `withIntelligence` hook rides this same source for its prompt delivery.
*/
function createCertifiedPromptSource(opts) {
	const pullOptions = { ...opts };
	const refreshMs = pullOptions.refreshMs ?? defaultRefreshMs;
	let certified = null;
	let lastPullAt;
	let inflight = null;
	async function refresh(options) {
		if (inflight) return inflight;
		if (!options?.force && lastPullAt !== void 0 && Date.now() - lastPullAt < refreshMs) return;
		inflight = (async () => {
			const outcome = await pullCertified(pullOptions);
			lastPullAt = Date.now();
			if (outcome.succeeded) certified = outcome.value;
		})();
		try {
			await inflight;
		} finally {
			inflight = null;
		}
	}
	return {
		refresh,
		current: () => certified,
		async compose(base) {
			await refresh();
			return composeCertifiedPrompt(base, certified);
		}
	};
}
//#endregion
//#region src/intelligence/effort.ts
const presets = {
	off: {
		analysts: false,
		corpus: "off",
		fanout: 1,
		loops: false,
		intelligenceBudgetUsd: 0
	},
	eco: {
		analysts: true,
		corpus: "read",
		fanout: 1,
		loops: false,
		intelligenceBudgetUsd: .25
	},
	standard: {
		analysts: true,
		corpus: "read-write",
		fanout: 3,
		loops: true,
		intelligenceBudgetUsd: 2
	},
	thorough: {
		analysts: true,
		corpus: "read-write",
		fanout: 5,
		loops: true,
		intelligenceBudgetUsd: 10
	},
	max: {
		analysts: true,
		corpus: "read-write",
		fanout: 8,
		loops: true,
		intelligenceBudgetUsd: null
	}
};
/** The default tier when a client declares no effort. `'standard'` turns
*  intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
*  `'thorough'`/`'max'`. */
const defaultEffortTier = "standard";
/**
* Compile a named tier (plus optional per-field overrides) into the flat
* `EffortSettings` the wrapper reads. Pure: same inputs → same object, no I/O,
* no execution. Fails loud on an unknown tier rather than silently defaulting —
* a typo'd tier must not quietly grant or deny intelligence.
*
* Invariant preserved for the billing floor: `resolveEffort('off')` always
* yields `intelligenceBudgetUsd: 0` with every intelligence knob off UNLESS the
* caller explicitly overrides a field — overriding off is an opt-in the caller
* owns, not a default the composer leaks.
*/
function resolveEffort(tier, overrides) {
	const preset = presets[tier];
	if (!preset) throw new Error(`resolveEffort: unknown effort tier ${JSON.stringify(tier)} (expected one of ${Object.keys(presets).map((t) => `'${t}'`).join(", ")})`);
	return {
		...preset,
		...overrides ?? {}
	};
}
/**
* True when these settings admit NO intelligence spawn — the passthrough
* predicate the wrapper branches on. Every intelligence axis must be off:
* analysts disabled, corpus off, no breadth, no loops, and a zero intelligence
* budget. A caller who overrides any one of these back on is no longer at the
* OFF floor and the wrapper treats them as an intelligence-enabled run.
*/
function isIntelligenceOff(settings) {
	return settings.analysts === false && settings.corpus === "off" && settings.fanout <= 1 && settings.loops === false && settings.intelligenceBudgetUsd === 0;
}
/**
* Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same
* input → same object, no I/O, no execution, no construction. It is the single place that
* maps the effort axes onto the run-config knobs, so no `if (effort)` leaks into the
* supervise kernel — the kernel stays effort-blind, the caller reads these flags once.
*
* `off`/`eco` (`analysts: false`) compile to `withAnalyst: false` ⇒ the caller omits the
* analyst and the run degrades to the dormant base agent rather than throwing. `fanout: 1`
* (no breadth) at `off`; `withLoops: false` no-ops the improvement cycle. `standard`+
* compile to `withAnalyst: true`, the tier's `fanout`, and `withLoops: true`.
*/
function compileEffort(settings) {
	return {
		withAnalyst: settings.analysts,
		fanout: settings.fanout,
		withLoops: settings.loops,
		intelligenceBudgetUsd: settings.intelligenceBudgetUsd
	};
}
//#endregion
//#region src/intelligence/usage.ts
/** Numeric reports replace subtotals; explicit or malformed missingness is irreversible. */
function mergeReportedUsage(target, report) {
	const update = {
		...report.usage,
		inferenceUsd: report.usage?.inferenceUsd ?? report.costUsd
	};
	for (const [amount, known] of [
		["inferenceUsd", "inferenceUsdKnown"],
		["intelligenceUsd", "intelligenceUsdKnown"],
		["estimatedInferenceUsd", void 0]
	]) {
		const value = update[amount];
		if (isUsageAmount(value)) target[amount] = value;
		else if (value !== void 0 && known !== void 0) target[known] = false;
		if (known !== void 0 && update[known] === false) target[known] = false;
	}
}
/** Absence is unknown; OFF alone proves zero Intelligence spend without a receipt. */
function normalizeReportedUsage(usage, intelligenceOff = false) {
	const inferenceKnown = isUsageAmount(usage.inferenceUsd) && usage.inferenceUsdKnown !== false;
	const intelligenceKnown = intelligenceOff || isUsageAmount(usage.intelligenceUsd) && usage.intelligenceUsdKnown !== false;
	return {
		inferenceUsd: isUsageAmount(usage.inferenceUsd) ? usage.inferenceUsd : 0,
		intelligenceUsd: intelligenceOff || !isUsageAmount(usage.intelligenceUsd) ? 0 : usage.intelligenceUsd,
		...!inferenceKnown ? { inferenceUsdKnown: false } : {},
		...!intelligenceKnown ? { intelligenceUsdKnown: false } : {},
		...isUsageAmount(usage.estimatedInferenceUsd) ? { estimatedInferenceUsd: usage.estimatedInferenceUsd } : {}
	};
}
//#endregion
//#region src/intelligence/authored-profile-improvement.ts
/**
* Put a complete authored/imported profile through the canonical profile
* experiment and proposal path without invoking `improve()`.
*/
async function proposeAuthoredAgentProfileImprovement(options) {
	const source = agentImprovementSourceSchema.parse(options.source);
	const metadata = profileImprovementMetadata(options.metadata, source);
	const inputLineage = options.candidateLineage;
	if (inputLineage.source === "optimizer") throw new Error("authored profile improvement refuses optimizer lineage; use improve()");
	if (Object.hasOwn(inputLineage, "profileDiffIds")) throw new Error("authored profile improvement derives candidateLineage.profileDiffIds");
	const findings = immutableCandidateValue([...assertProposalFindings(options.findings ?? [], "authored profile improvement findings")]);
	const costLedger = createProfileImprovementCostLedger(options.budgetUsd, "authored profile improvement");
	const preparationStartedAt = performance.now();
	const baselineProfile = parseExactAgentProfile(options.profile, "authored profile baseline");
	const candidateProfile = parseExactAgentProfile(options.candidateProfile, "authored profile candidate");
	const baselineStateDigest = profileStateDigest$1(options.stateDigest, source.sourceIdentity, baselineProfile);
	if (baselineStateDigest !== source.sourceDigest) throw new Error("authored profile source digest does not match the measured profile state");
	const candidateStateDigest = profileStateDigest$1(options.stateDigest, source.sourceIdentity, candidateProfile);
	if (candidateStateDigest === baselineStateDigest) throw new Error("authored profile candidate state digest matches the baseline");
	const change = agentImprovementProfileDiffs(baselineProfile, candidateProfile, {
		...options.diff,
		id: options.diff?.id ?? `profile-improvement:${candidateStateDigest}`,
		metadata: {
			...options.diff?.metadata,
			sourceIdentity: source.sourceIdentity,
			sourceRevision: source.sourceRevision
		}
	});
	const profileDiffIds = change.map((step) => {
		if (!step.id) throw new Error("authored profile change requires an exact diff id");
		return step.id;
	});
	const candidateLineage = immutableCandidateValue({
		...inputLineage,
		profileDiffIds
	});
	const policy = profilePolicyWithBudget(options.benchmark.policy, options.budgetUsd, "authored profile");
	const benchmark = sealProfileImprovementBenchmark({
		...options.benchmark,
		policy
	});
	const heldOutDigests = new Set(benchmark.tasks.map((task) => task.scenario.digest));
	assertProfileTrainingIsHeldOut(baselineProfile, heldOutDigests);
	assertProfileTrainingIsHeldOut(candidateProfile, heldOutDigests);
	assertDirectCandidateReleaseWorkIsFresh(benchmark, candidateLineage, options.developmentScenarios);
	const experiment = sealAgentProfileImprovementExperiment({
		kind: "agent-profile-improvement-experiment",
		digestAlgorithm: "rfc8785-sha256",
		source,
		executionRef: options.executor.executionRef,
		baseline: { stateDigest: baselineStateDigest },
		candidate: { stateDigest: candidateStateDigest },
		change,
		candidateLineage,
		benchmark,
		policy
	});
	const profilesByStateDigest = /* @__PURE__ */ new Map([[baselineStateDigest, baselineProfile], [candidateStateDigest, candidateProfile]]);
	const preparation = profilePreparationAccounting(costLedger, preparationStartedAt);
	const run = await runAgentProfileImprovementExperiment({
		experiment,
		...options.maxConcurrency === void 0 ? {} : { maxConcurrency: options.maxConcurrency },
		costLedger,
		...options.signal ? { signal: options.signal } : {},
		execute: async (input) => {
			const measuredProfile = profilesByStateDigest.get(input.stateDigest);
			if (!measuredProfile) throw new Error("authored profile execution requested an unknown profile state");
			return options.executor.measure({
				...input,
				profile: measuredProfile
			});
		}
	});
	const evaluation = verifyAgentProfileImprovementExperimentComparison(measuredComparisonFromAgentProfileImprovementExperiment({
		experiment,
		measurements: run.measurements,
		runId: options.runId,
		...options.candidate ? { candidate: options.candidate } : {},
		generationsExplored: 0,
		preparation,
		measurement: run.measurement,
		metadata
	}));
	const proposal = createAgentImprovementProposal({
		runId: options.runId,
		findings,
		evaluation,
		...options.now ? { now: options.now } : {}
	});
	return {
		candidateProfile,
		candidateLineage,
		experiment,
		measurements: run.measurements,
		proposal
	};
}
function assertDirectCandidateReleaseWorkIsFresh(benchmark, lineage, developmentScenarios) {
	if (lineage.developmentSplitDigest === benchmark.suite.splitDigest) throw new Error("authored profile development and held-out splits must be disjoint");
	if (!developmentScenarios || developmentScenarios.length === 0) return;
	const development = new Set(developmentScenarios.map(canonicalCandidateDigest$1));
	const reused = benchmark.tasks.map(profileTaskScenarioIdentity).filter((scenario) => development.has(canonicalCandidateDigest$1(scenario))).map((scenario) => scenario.id);
	if (reused.length > 0) throw new Error(`authored profile release reuses development scenario(s): [${reused.join(", ")}]`);
}
//#endregion
//#region src/intelligence/capability.ts
/**
* A consumer rejected a binding that its executor does not admit.
*/
var CapabilityNotAdmittedError = class extends Error {
	kind;
	capabilityId;
	constructor(kind, capabilityId, reason) {
		super(`capability '${capabilityId}': binding '${kind}' not admitted — ${reason}`);
		this.name = "CapabilityNotAdmittedError";
		this.kind = kind;
		this.capabilityId = capabilityId;
	}
};
const provenanceFromArtifact = (a) => ({
	contentHash: a.contentHash,
	version: a.version,
	lift: a.lift,
	promotedAt: a.promotedAt,
	sourcePath: a.path
});
const contextKindForType = (type) => type === "prompt-surface" || type === "skill" ? type : "instructions";
/**
* Heuristic shape-inference for a non-context artifact. The plane stores
* `artifactType` as a free string today, so a tool/mcp-shaped artifact arrives
* as opaque content. We infer the narrowest binding that is always-valid:
*   - a parseable OpenAI-tool JSON (`{ name, parameters, url? }`) → an `http`
*     tool when it carries a `url`, else an inline `tool` definition;
*   - a parseable MCP-server JSON (`{ command }` or `{ url, transport }`) → the
*     matching strict mcp binding;
*   - anything else → `context`/inline (the fail-safe — the bytes still reach the
*     agent as prompt context, never dropped).
*/
function inferCapability(type, a) {
	const id = `${type}:${a.path ?? a.index}`;
	const provenance = provenanceFromArtifact(a);
	const parsed = tryParseJson(a.content);
	if (parsed && typeof parsed === "object") {
		const obj = parsed;
		if (typeof obj.command === "string") return {
			id,
			iface: {
				surface: "mcp",
				serverName: String(obj.name ?? type)
			},
			binding: {
				kind: "mcp-stdio",
				command: obj.command,
				...Array.isArray(obj.args) ? { args: obj.args.map(String) } : {},
				...isStringRecord(obj.env) ? { env: obj.env } : {},
				...typeof obj.cwd === "string" ? { cwd: obj.cwd } : {}
			},
			auth: { mode: "none" },
			provenance
		};
		if (typeof obj.url === "string" && (obj.transport === "http" || obj.transport === "sse")) return {
			id,
			iface: {
				surface: "mcp",
				serverName: String(obj.name ?? type)
			},
			binding: {
				kind: "mcp-remote",
				url: obj.url,
				transport: obj.transport,
				...isStringRecord(obj.headers) ? { headers: obj.headers } : {}
			},
			auth: { mode: "none" },
			provenance
		};
		if (typeof obj.name === "string" && isJsonSchema(obj.parameters)) {
			const iface = {
				surface: "tool",
				name: obj.name,
				...typeof obj.description === "string" ? { description: obj.description } : {},
				parameters: obj.parameters
			};
			if (typeof obj.url === "string") return {
				id,
				iface,
				binding: {
					kind: "http",
					url: obj.url,
					...typeof obj.method === "string" ? { method: obj.method } : {}
				},
				auth: { mode: "none" },
				provenance
			};
			return {
				id,
				iface,
				binding: {
					kind: "inline",
					content: {
						kind: "inline",
						content: a.content
					}
				},
				auth: { mode: "none" },
				provenance
			};
		}
	}
	return {
		id,
		iface: {
			surface: "context",
			kind: "instructions",
			name: a.path ?? type
		},
		binding: {
			kind: "inline",
			content: {
				kind: "inline",
				content: a.content
			}
		},
		auth: { mode: "none" },
		provenance
	};
}
/**
* Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
* `prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
* shipped fold, generalized); any other artifact type → best-effort binding
* inference. `promptSurface` is carried through so
* `composeCertifiedPrompt` folds it before other prompt artifacts.
* This delivers the spine against today's wire before the plane changes.
*/
function manifestFromProfile(profile) {
	const capabilities = [];
	for (const type of Object.keys(profile.artifacts).sort()) {
		const sorted = [...profile.artifacts[type] ?? []].map((a, index) => ({
			...a,
			index
		})).sort((x, y) => (x.path ?? "").localeCompare(y.path ?? ""));
		for (const a of sorted) if (type === "prompt-surface" || type === "skill") capabilities.push({
			id: `${type}:${a.path ?? a.index}`,
			iface: {
				surface: "context",
				kind: contextKindForType(type),
				name: a.path ?? type
			},
			binding: {
				kind: "inline",
				content: {
					kind: "inline",
					content: a.content
				}
			},
			auth: { mode: "none" },
			provenance: provenanceFromArtifact(a)
		});
		else capabilities.push(inferCapability(type, a));
	}
	return {
		target: profile.target,
		generatedAt: profile.generatedAt,
		promptSurface: profile.promptSurface,
		capabilities
	};
}
function tryParseJson(s) {
	try {
		return JSON.parse(s);
	} catch {
		return;
	}
}
function isStringRecord(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}
function isJsonSchema(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
//#endregion
//#region src/intelligence/exact-process-candidate.ts
/** Candidate surfaces implemented by the neutral exact-process executor. */
const exactProcessCandidateExperimentExecutionSupport = Object.freeze({
	outcomes: Object.freeze(["output"]),
	outputMediaTypes: Object.freeze([
		"text/*",
		"application/json",
		"*+json"
	]),
	code: Object.freeze(["disabled"]),
	memory: Object.freeze(["disabled"]),
	knowledge: true,
	profile: AGENT_CANDIDATE_EXECUTION_SUPPORT.profile,
	isolation: Object.freeze({
		freshEnvironment: true,
		exactProcess: true,
		egress: Object.freeze(["blocked", "strict"])
	})
});
/** Execute one signed experiment cell through any declared exact-process provider. */
function createExactProcessCandidateExperimentExecutor(options) {
	const executor = exactProcessProviderAsCandidateExecutor({
		provider: resolveAgentEnvironmentProvider(options.provider, options.providerRegistry),
		resources: options.resources,
		...options.providerOptions ? { providerOptions: options.providerOptions } : {},
		...options.provisionTimeoutMs === void 0 ? {} : { provisionTimeoutMs: options.provisionTimeoutMs },
		...options.recoveryRetentionMs === void 0 ? {} : { recoveryRetentionMs: options.recoveryRetentionMs }
	});
	return Object.freeze({
		executor,
		async execute(input) {
			return await executeAgentCandidateExperimentCell({
				...input,
				attempt: input.attempt ?? 1,
				executionId: input.executionId,
				executionRoots: input.executionRoots,
				stagingRoots: input.stagingRoots,
				ports: options.ports,
				...input.preparation ? { preparation: input.preparation } : {},
				execution: {
					executor,
					grader: options.grader,
					outputArtifacts: options.outputArtifacts,
					traceStore: options.traceStore,
					claimStore: options.claimStore,
					...options.cleanupTimeoutMs === void 0 ? {} : { cleanupTimeoutMs: options.cleanupTimeoutMs },
					...options.resultTimeoutMs === void 0 ? {} : { resultTimeoutMs: options.resultTimeoutMs }
				}
			});
		}
	});
}
/** Compose host-owned execution ports with protected model access for one exact-process run. */
function createProtectedExactProcessCandidateExperimentExecutor(options) {
	const { hostPorts, model, ...exactProcess } = options;
	const ports = Object.freeze({
		...hostPorts,
		models: createProtectedAgentCandidateModelPort(model)
	});
	const execution = createExactProcessCandidateExperimentExecutor({
		...exactProcess,
		ports
	});
	return Object.freeze({
		...execution,
		recoveryPorts: Object.freeze({
			models: ports.models,
			memory: ports.memory
		})
	});
}
//#endregion
//#region src/intelligence/profile-activation.ts
/**
* Compare product-owned profiles with an exact measured transition and prepare
* all-or-none replacements. The product owns locking, persistence, and retained
* state; Runtime owns the profile diff semantics and digest checks.
*/
function prepareAgentImprovementProfileActivation(input) {
	if ("profileTransition" in input) {
		const targets = profileTargets(input.profileTransition.targets);
		assertUniqueProfileTargets(targets);
		const current = readCurrentProfiles(input.currentByIdentity, targets);
		if ("status" in current) return immutableCandidateValue(current);
		return prepareProfileImprovementActivation(input, targets, current);
	}
	const targets = input.targets;
	assertUniqueProfileTargets(targets);
	const current = readCurrentProfiles(input.currentByIdentity, targets);
	if ("status" in current) return immutableCandidateValue(current);
	return prepareSurfaceReplacementActivation(targets, current);
}
function prepareSurfaceReplacementActivation(targets, currentProfiles) {
	const current = targets.map((target) => {
		const profile = currentProfiles.byIdentity.get(target.identity);
		if (!profile) throw new Error(`missing agent profile ${target.identity}`);
		return {
			target,
			currentDigest: agentImprovementProfileSurfaceDigest(profile, target.surface)
		};
	});
	const states = targetStates(current);
	if (current.every(({ target, currentDigest }) => currentDigest === target.desiredDigest)) return immutableCandidateValue({
		status: "already-applied",
		targets: states
	});
	if (current.some(({ target, currentDigest }) => currentDigest !== target.expectedBaseDigest)) return immutableCandidateValue({
		status: "conflict",
		targets: states
	});
	const profiles = /* @__PURE__ */ new Map();
	for (const identity of currentProfiles.identities) {
		const currentProfile = currentProfiles.byIdentity.get(identity);
		if (!currentProfile) throw new Error(`missing agent profile ${identity}`);
		const profile = targets.filter((target) => target.identity === identity).flatMap((target) => agentImprovementTargetProfileDiffs(target, {
			id: `${target.identity}:${target.desiredDigest}`,
			metadata: { identity }
		})).reduce((value, diff) => applyExactAgentProfileDiff(value, diff, `agent profile activation ${identity}`), currentProfile);
		profiles.set(identity, immutableCandidateValue(profile));
	}
	for (const target of targets) {
		const profile = profiles.get(target.identity);
		if (!profile || agentImprovementProfileSurfaceDigest(profile, target.surface) !== target.desiredDigest) throw new Error(`agent profile activation did not produce ${target.identity}:${target.surface}`);
	}
	return appliedProfileReplacement(currentProfiles.identities, profiles, targets);
}
function prepareProfileImprovementActivation(input, targets, currentProfiles) {
	const transition = input.profileTransition;
	assertProfileTransitionTargets(transition, targets);
	const current = targets.map((target) => {
		const profile = currentProfiles.byIdentity.get(target.identity);
		if (!profile) throw new Error(`missing agent profile ${target.identity}`);
		return {
			target,
			currentDigest: profileStateDigest(input.stateDigest, target.identity, profile)
		};
	});
	const states = targetStates(current);
	if (current.every(({ currentDigest }) => currentDigest === transition.desiredStateDigest)) return immutableCandidateValue({
		status: "already-applied",
		targets: states
	});
	if (current.some(({ currentDigest }) => currentDigest !== transition.sourceStateDigest)) return immutableCandidateValue({
		status: "conflict",
		targets: states
	});
	const profiles = /* @__PURE__ */ new Map();
	for (const identity of currentProfiles.identities) {
		const currentProfile = currentProfiles.byIdentity.get(identity);
		if (!currentProfile) throw new Error(`missing agent profile ${identity}`);
		const profile = transition.operation.kind === "apply-change" ? transition.operation.changes.reduce((value, diff) => applyExactAgentProfileDiff(value, diff, `profile improvement activation ${identity}`), currentProfile) : restoreProfileState(input.resolveState, identity, transition.desiredStateDigest);
		if (!profile) return immutableCandidateValue({
			status: "unavailable",
			code: "PROFILE_STATE_UNAVAILABLE",
			identities: currentProfiles.identities,
			requiredStateDigest: transition.desiredStateDigest
		});
		const parsed = parseExactAgentProfile(omitUndefinedObjectFields(profile, `profile improvement activation ${identity}`), `profile improvement activation ${identity}`);
		if (profileStateDigest(input.stateDigest, identity, parsed) !== transition.desiredStateDigest) throw new Error(`profile improvement activation did not produce ${identity}`);
		profiles.set(identity, immutableCandidateValue(parsed));
	}
	return appliedProfileReplacement(currentProfiles.identities, profiles, targets);
}
function restoreProfileState(resolveState, identity, stateDigest) {
	return resolveState?.({
		identity,
		stateDigest
	});
}
function assertProfileTransitionTargets(transition, targets) {
	assertProfileImprovementTargetsShareIdentity(targets);
	const operationDigest = canonicalCandidateDigest$1(transition.operation);
	if (targets.some((target) => target.expectedBaseDigest !== transition.sourceStateDigest || target.desiredDigest !== transition.desiredStateDigest || canonicalCandidateDigest$1(target.desiredInput) !== operationDigest)) throw new Error("profile improvement targets do not match their transition");
}
function appliedProfileReplacement(identities, profiles, targets) {
	return immutableCandidateValue({
		status: "apply",
		replacements: identities.map((identity) => {
			const profile = profiles.get(identity);
			if (!profile) throw new Error(`missing prepared agent profile ${identity}`);
			return {
				identity,
				profile
			};
		}),
		targets: targets.map((target) => ({
			surface: target.surface,
			identity: target.identity,
			beforeDigest: target.expectedBaseDigest,
			afterDigest: target.desiredDigest
		}))
	});
}
function targetStates(current) {
	if (!current[0]) throw new Error("agent profile activation requires a target");
	return current.map(({ target, currentDigest }) => ({
		surface: target.surface,
		identity: target.identity,
		currentDigest
	}));
}
function profileStateDigest(stateDigest, identity, profile) {
	return agentProfileImprovementArmSchema.parse({ stateDigest: stateDigest({
		identity,
		profile
	}) }).stateDigest;
}
function readCurrentProfiles(currentByIdentity, targets) {
	const identities = [...new Set(targets.map((target) => target.identity))].sort();
	const missing = identities.filter((identity) => !currentByIdentity.has(identity));
	if (missing.length > 0) return {
		status: "missing",
		identities: missing
	};
	return {
		identities,
		byIdentity: new Map(identities.map((identity) => {
			const profile = currentByIdentity.get(identity);
			if (!profile) throw new Error(`missing agent profile ${identity}`);
			const label = `agent profile activation ${identity}`;
			return [identity, parseExactAgentProfile(omitUndefinedObjectFields(profile, label), label)];
		}))
	};
}
function profileTargets(targets) {
	if (!targets.every((target) => isAgentProfileMeasuredSurface(target.surface))) throw new Error("agent profile activation contains an unsupported surface");
	if (!targets[0]) throw new Error("agent profile activation requires a target");
	return targets;
}
function assertUniqueProfileTargets(targets) {
	const targetKeys = targets.map((target) => `${target.identity}\u0000${target.surface}`);
	if (new Set(targetKeys).size !== targetKeys.length) throw new Error("agent profile activation repeats a target");
}
//#endregion
//#region src/intelligence/with-intelligence.ts
function summarizeRuntimeEvents(events) {
	const summary = createRuntimeUsageTotals();
	for (const event of events) {
		if ("session" in event && event.session) summary.sessionId = event.session.id;
		if (event.type === "llm_call") {
			summary.model = event.model;
			addRuntimeUsage(summary, event);
		} else if (event.type === "backend_error") {
			summary.success = false;
			summary.error = {
				name: event.error?.kind ?? "BackendError",
				message: event.message,
				...event.error?.status !== void 0 ? { code: String(event.error.status) } : {}
			};
		} else if (event.type === "final") {
			summary.success = event.status === "completed";
			if (event.error) summary.error = {
				name: event.error.kind,
				message: event.error.message,
				...event.error.status !== void 0 ? { code: String(event.error.status) } : {}
			};
		}
	}
	return summary;
}
function runError(cause) {
	if (cause instanceof Error) {
		const code = cause.code;
		return {
			name: cause.name || "Error",
			message: cause.message,
			...typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}
		};
	}
	return {
		name: "Error",
		message: String(cause)
	};
}
/**
* Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt
* surface to fold and the promoted profile diffs as proposals — and (b) SENDS a
* typed {@link RunRecord} per call to the plane. The pull is cached and refreshed
* at most every `refreshMs`; a failed pull is fail-closed (the agent runs on its
* base surface, never breaks because Intelligence is unreachable). The send is
* best-effort — an export failure never fails the agent's turn — while an error
* thrown by the agent itself propagates unchanged.
*/
function withIntelligence(agent, config) {
	const client = createIntelligenceClient(config);
	const target = config.target ?? config.project;
	const source = createCertifiedPromptSource({
		target,
		...config.apiKey !== void 0 ? { apiKey: config.apiKey } : {},
		...config.baseUrl !== void 0 ? { baseUrl: config.baseUrl } : {},
		...config.timeoutMs !== void 0 ? { timeoutMs: config.timeoutMs } : {},
		...config.fetchImpl !== void 0 ? { fetchImpl: config.fetchImpl } : {},
		...config.refreshMs !== void 0 ? { refreshMs: config.refreshMs } : {}
	});
	const currentProposals = () => source.current()?.agentProfileDiffs ?? [];
	let lastSignal = "";
	function signalProposals() {
		const proposals = currentProposals();
		if (proposals.length === 0) return;
		const sig = proposals.map((p) => p.provenance.contentHash).join("|");
		if (sig === lastSignal) return;
		lastSignal = sig;
		config.onProposals?.(proposals);
	}
	async function refresh() {
		await source.refresh();
		signalProposals();
	}
	const wrapped = (async (input) => {
		const runId = client.freshRunId();
		const traceId = client.freshTraceId();
		const startedAt = Date.now();
		await refresh();
		const certified = source.current();
		const proposals = currentProposals();
		const report = {};
		const usage = {};
		const applied = {
			runId,
			traceId,
			certified,
			composePrompt: (base) => composeCertifiedPrompt(base, certified),
			proposals,
			applyProfile: (base) => proposals.reduce((profile, p) => applyAgentProfileDiff(profile, p.diff), base),
			record: (r) => {
				const tokens = r.tokens ?? report.tokens;
				const tokensIncomplete = report.tokens?.tokensKnown === false || tokens?.tokensKnown === false;
				mergeReportedUsage(usage, r);
				Object.assign(report, r, {
					usage,
					...tokens ? { tokens: {
						...tokens,
						...tokensIncomplete ? { tokensKnown: false } : {}
					} } : {}
				});
			}
		};
		function exportCompleted(output, caught) {
			const completedAt = Date.now();
			const eventSummary = summarizeRuntimeEvents(report.runtimeEvents ?? []);
			const error = report.error ?? (caught !== void 0 ? runError(caught) : eventSummary.error);
			const tokens = report.tokens !== void 0 || eventSummary.llmCalls > 0 ? {
				input: eventSummary.tokensIn,
				output: eventSummary.tokensOut,
				...eventSummary.tokensKnown === false || report.tokens?.tokensKnown === false ? { tokensKnown: false } : {}
			} : void 0;
			if (tokens && report.tokens) for (const key of [
				"input",
				"output",
				"cachedInput",
				"reasoning"
			]) {
				const value = report.tokens[key];
				if (isUsageAmount(value) && Number.isSafeInteger(value)) tokens[key] = value;
				else if (value !== void 0 || key === "input" || key === "output") tokens.tokensKnown = false;
			}
			const reportedCost = report.usage?.inferenceUsd ?? report.costUsd;
			const inferenceKnown = eventSummary.usdKnown !== false && report.usage?.inferenceUsdKnown !== false && (reportedCost !== void 0 ? isUsageAmount(reportedCost) : eventSummary.llmCalls > 0);
			const estimatedInferenceUsd = isUsageAmount(report.usage?.estimatedInferenceUsd) ? report.usage.estimatedInferenceUsd : eventSummary.estimatedCostUsd;
			const profile = report.profile ?? config.profile;
			const record = {
				runId,
				traceId,
				project: config.project,
				target,
				input,
				output,
				outcome: {
					success: report.success ?? (caught !== void 0 ? false : eventSummary.success ?? error === void 0),
					...report.score !== void 0 ? { score: report.score } : {},
					usage: normalizeReportedUsage({
						inferenceUsd: isUsageAmount(reportedCost) ? reportedCost : eventSummary.costUsd,
						...inferenceKnown ? {} : { inferenceUsdKnown: false },
						...isUsageAmount(estimatedInferenceUsd) ? { estimatedInferenceUsd } : {},
						intelligenceUsd: report.usage?.intelligenceUsd,
						...report.usage?.intelligenceUsdKnown === false ? { intelligenceUsdKnown: false } : {}
					})
				},
				timing: {
					startedAt,
					completedAt,
					durationMs: completedAt - startedAt
				},
				...report.model ?? eventSummary.model ? { model: report.model ?? eventSummary.model } : {},
				...report.provider !== void 0 ? { provider: report.provider } : {},
				...report.loopEvents !== void 0 ? { loopEvents: report.loopEvents } : {},
				...report.runtimeEvents !== void 0 ? { runtimeEvents: report.runtimeEvents } : {},
				...profile !== void 0 ? { profile } : {},
				...report.sessionId ?? eventSummary.sessionId ? { sessionId: report.sessionId ?? eventSummary.sessionId } : {},
				...report.harness ?? profile?.harness ? { harness: report.harness ?? profile?.harness } : {},
				...report.commitSha ?? config.commitSha ? { commitSha: report.commitSha ?? config.commitSha } : {},
				...tokens !== void 0 ? { tokens } : {},
				...error !== void 0 ? { error } : {},
				...report.candidateExecution !== void 0 ? { candidateExecution: report.candidateExecution } : {}
			};
			client.exportRunRecord(record);
		}
		try {
			const output = await agent(input, applied);
			exportCompleted(output);
			return output;
		} catch (cause) {
			exportCompleted(void 0, cause);
			throw cause;
		}
	});
	wrapped.refresh = refresh;
	wrapped.proposals = currentProposals;
	wrapped.flush = client.flush;
	return wrapped;
}
//#endregion
//#region src/intelligence/index.ts
/**
*
* Tangle Intelligence SDK — trace capture plus reviewable improvement.
*
* The client keeps live-agent trace delivery best-effort. The separate
* improvement-cycle exports analyze completed traces, run a signed baseline
* versus candidate experiment, bind review to its result, and activate only
* the exact measured candidate.
*
*   1. OBSERVE — wrap a generic agent and export one trace span per call to
*      Tangle Intelligence, swallowing every export failure so a live agent
*      never fails because Intelligence is down.
*   2. MODE 0 / OFF — at `effort: 'off'`, run the agent as PURE PASSTHROUGH
*      (zero intelligence spawns) with best-effort telemetry still on. The
*      exported trace tags usage by class `{ inferenceUsd, intelligenceUsd }`,
*      and at OFF `intelligenceUsd` is provably `0` — the mechanism that proves
*      an OFF customer paid inference-only.
*
* @module
* @stable
*/
function usageAttributes(usage, intelligenceOff) {
	const normalized = normalizeReportedUsage(usage, intelligenceOff);
	return {
		"tangle.usage.inference_usd": normalized.inferenceUsd,
		"tangle.usage.intelligence_usd": normalized.intelligenceUsd,
		...normalized.inferenceUsdKnown === false ? { "tangle.usage.inference_usd_known": false } : {},
		...normalized.intelligenceUsdKnown === false ? { "tangle.usage.intelligence_usd_known": false } : {},
		...normalized.estimatedInferenceUsd !== void 0 ? { "tangle.usage.inference_usd_estimated": normalized.estimatedInferenceUsd } : {}
	};
}
function resolveEffortConfig(effort) {
	if (effort === void 0) return resolveEffort(defaultEffortTier);
	if (typeof effort === "string") return resolveEffort(effort);
	return resolveEffort(effort.tier, effort.overrides);
}
function freshTraceId() {
	return randomHex(32);
}
function freshRunId() {
	return `run-${randomHex(16)}`;
}
/** Serialize a redacted value without dropping customer trace content. */
function serializeJson(value) {
	let s;
	if (typeof value === "string") s = value;
	else try {
		s = JSON.stringify(value) ?? String(value);
	} catch {
		s = String(value);
	}
	return s;
}
function addPayloadAttributes(labels, key, value, includeFullPayload) {
	const serialized = serializeJson(value);
	labels[`${key}_hash`] = contentHash(serialized);
	labels[`${key}_bytes`] = Buffer.byteLength(serialized, "utf8");
	if (includeFullPayload) labels[key] = serialized;
}
function randomHex(chars) {
	const bytes = new Uint8Array(Math.ceil(chars / 2));
	if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
	else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, chars);
}
/**
* Create an Observe-mode Intelligence client. Resolves effort, the base URL, and
* the redactor up front; the exporter is built lazily and is `undefined` when no
* `apiKey` is present (send becomes a no-op — the ingest requires a tenant key,
* and best-effort export must never spam an unauthenticated plane).
*/
function createIntelligenceClient(config) {
	if (!config.project) throw new Error("createIntelligenceClient: `project` is required");
	const effort = resolveEffortConfig(config.effort);
	const intelligenceOff = isIntelligenceOff(effort);
	const redactor = resolveRedactor(config.redact);
	const includeFullPayload = config.payloadAttributes === "full";
	const apiKey = config.apiKey ?? (typeof process !== "undefined" ? process.env.TANGLE_API_KEY : void 0);
	const otlpEndpoint = `${resolveIntelligenceBaseUrl(config.baseUrl)}/v1/otlp`;
	let exporter;
	let exporterResolved = false;
	function getExporter() {
		if (exporterResolved) return exporter;
		exporterResolved = true;
		if (!apiKey) return void 0;
		exporter = createOtelExporter({
			endpoint: otlpEndpoint,
			headers: { authorization: `Bearer ${apiKey}` },
			serviceName: config.project,
			resourceAttributes: { "tangle.project": config.project }
		});
		return exporter;
	}
	function exportTrace(meta, outcome, output) {
		const ex = getExporter();
		if (!ex) return;
		try {
			const labels = {
				project: config.project,
				"tangle.effort.intelligence_off": outcome.intelligenceOff,
				...usageAttributes(outcome.usage, intelligenceOff),
				...meta.model ? { "gen_ai.request.model": meta.model } : {},
				...meta.provider ? { "provider.name": meta.provider } : {},
				...typeof outcome.success === "boolean" ? { "tangle.outcome.success": outcome.success } : {},
				...typeof outcome.score === "number" ? { "tangle.outcome.score": outcome.score } : {},
				...meta.labels ?? {}
			};
			const redactedInput = meta.input !== void 0 ? redactor(meta.input) : void 0;
			const redactedOutput = output !== void 0 ? redactor(output) : void 0;
			if (redactedInput !== void 0) addPayloadAttributes(labels, "tangle.input", redactedInput, includeFullPayload);
			if (redactedOutput !== void 0) addPayloadAttributes(labels, "tangle.output", redactedOutput, includeFullPayload);
			ex.exportSpan(flatOtelSpan("tangle.intelligence.run", {
				"tangle.runId": outcome.runId,
				...labels,
				[ATTR.spanKind]: "AGENT"
			}, outcome.traceId, Date.now()));
		} catch {}
	}
	function exportRunRecord(record) {
		const ex = getExporter();
		if (!ex) return record.traceId;
		try {
			const repository = record.repository ?? (config.repo ? `${config.repo.owner}/${config.repo.name}` : void 0);
			const labels = {
				project: record.project,
				"tangle.target": record.target,
				"tangle.effort.intelligence_off": intelligenceOff,
				...usageAttributes(record.outcome.usage, intelligenceOff),
				...record.model ? { "gen_ai.request.model": record.model } : {},
				...record.provider ? { "provider.name": record.provider } : {},
				...record.sessionId ? {
					"tangle.sessionId": record.sessionId,
					"gen_ai.conversation.id": record.sessionId
				} : {},
				...record.harness ? { "tangle.agent.harness": record.harness } : {},
				...repository ? { "vcs.repository.name": repository } : {},
				...record.commitSha ? { "vcs.ref.head.revision": record.commitSha } : {},
				...record.timing ? {
					"tangle.started_at_ms": record.timing.startedAt,
					"tangle.completed_at_ms": record.timing.completedAt,
					"tangle.duration_ms": record.timing.durationMs
				} : {},
				...record.tokens ? {
					"gen_ai.usage.input_tokens": record.tokens.input,
					"gen_ai.usage.output_tokens": record.tokens.output,
					...record.tokens.tokensKnown === false ? { "tangle.usage.tokens_known": false } : {},
					...record.tokens.cachedInput !== void 0 ? { "gen_ai.usage.cache_read_input_tokens": record.tokens.cachedInput } : {},
					...record.tokens.reasoning !== void 0 ? { "gen_ai.usage.reasoning_tokens": record.tokens.reasoning } : {}
				} : {},
				...typeof record.outcome.success === "boolean" ? { "tangle.outcome.success": record.outcome.success } : {},
				...typeof record.outcome.score === "number" ? { "tangle.outcome.score": record.outcome.score } : {},
				...record.error ? {
					"error.type": record.error.code ?? record.error.name,
					"error.message": serializeJson(redactor(record.error.message))
				} : {},
				...record.runtimeEvents ? { "tangle.runtime.event_count": record.runtimeEvents.length } : {},
				...record.candidateExecution ? {
					"tangle.candidate.bundle_digest": record.candidateExecution.receipt.bundleDigest,
					"tangle.candidate.experiment_digest": record.candidateExecution.materializationReceipt.executionPlan.material.runCell.experimentDigest,
					"tangle.candidate.execution_id": record.candidateExecution.materializationReceipt.executionPlan.material.executionId,
					"tangle.candidate.execution_plan_digest": record.candidateExecution.receipt.executionPlanDigest,
					"tangle.candidate.materialization_receipt_digest": record.candidateExecution.receipt.materializationReceiptDigest,
					"tangle.candidate.succeeded": record.candidateExecution.receipt.termination.kind === "exit" && record.candidateExecution.receipt.termination.exitCode === 0 && record.candidateExecution.receipt.benchmarkResult.material.passed,
					"tangle.candidate.run_receipt_digest": record.candidateExecution.receipt.digest
				} : {}
			};
			if (record.profile) {
				addPayloadAttributes(labels, "tangle.agent.profile", redactor(record.profile), includeFullPayload);
				if (record.profile.name) labels["gen_ai.agent.name"] = record.profile.name;
			}
			const redactedInput = record.input !== void 0 ? redactor(record.input) : void 0;
			const redactedOutput = record.output !== void 0 ? redactor(record.output) : void 0;
			if (redactedInput !== void 0) addPayloadAttributes(labels, "tangle.input", redactedInput, includeFullPayload);
			if (redactedOutput !== void 0) addPayloadAttributes(labels, "tangle.output", redactedOutput, includeFullPayload);
			const now = Date.now();
			const runSpan = flatOtelSpan("tangle.intelligence.run", {
				"tangle.runId": record.runId,
				...labels,
				[ATTR.spanKind]: "AGENT"
			}, record.traceId, record.timing?.startedAt ?? now, void 0, record.timing?.completedAt ?? now);
			ex.exportSpan(runSpan);
			if (record.runtimeEvents && record.runtimeEvents.length > 0) {
				const spans = buildRuntimeEventOtelSpans(record.runtimeEvents, record.traceId, runSpan.spanId, {
					...config.runtimeTelemetry,
					redact: redactor
				});
				for (const span of spans) ex.exportSpan(span);
			}
			if (record.loopEvents && record.loopEvents.length > 0) {
				const spans = buildLoopOtelSpans(record.loopEvents, record.traceId, runSpan.spanId, redactor);
				for (const span of spans) ex.exportSpan(span);
			}
		} catch {}
		return record.traceId;
	}
	return {
		project: config.project,
		effort,
		exportRunRecord,
		freshRunId,
		freshTraceId,
		async traceRun(meta, fn) {
			const runId = meta.runId ?? freshRunId();
			const traceId = meta.traceId ?? freshTraceId();
			let recordedOutput;
			const usage = {};
			let success;
			let score;
			const result = await fn({
				recordOutput(output) {
					recordedOutput = output;
				},
				recordOutcome(outcome) {
					if (typeof outcome.success === "boolean") success = outcome.success;
					if (typeof outcome.score === "number") score = outcome.score;
					mergeReportedUsage(usage, outcome);
				}
			});
			exportTrace(meta, {
				runId,
				traceId,
				project: config.project,
				effort,
				intelligenceOff,
				...success !== void 0 ? { success } : {},
				...score !== void 0 ? { score } : {},
				usage: normalizeReportedUsage(usage, intelligenceOff)
			}, recordedOutput);
			return result;
		},
		recordTrace(events, meta) {
			const traceId = meta?.traceId ?? freshTraceId();
			const ex = getExporter();
			if (!ex || events.length === 0) return traceId;
			try {
				const spans = buildLoopOtelSpans(events, traceId, meta?.rootParentSpanId);
				for (const span of spans) ex.exportSpan(span);
			} catch {}
			return traceId;
		},
		doctor() {
			const hasRepo = Boolean(config.repo?.owner && config.repo?.name && config.repo?.baseBranch);
			const hasChecks = Boolean(config.checks && config.checks.length > 0);
			const hasSurfaces = Boolean(config.surfaces && config.surfaces.length > 0);
			const prMissing = [];
			if (!hasChecks) prMissing.push("checks");
			if (!hasSurfaces) prMissing.push("surfaces");
			if (!hasRepo) prMissing.push("repo");
			const recommendMissing = [];
			if (intelligenceOff) recommendMissing.push("effort above off");
			return {
				project: config.project,
				effort,
				exportConfigured: Boolean(apiKey),
				modes: {
					observe: {
						ready: true,
						missing: []
					},
					recommend: {
						ready: recommendMissing.length === 0,
						missing: recommendMissing
					},
					pr: {
						ready: prMissing.length === 0,
						missing: prMissing
					}
				}
			};
		},
		async flush() {
			const ex = getExporter();
			if (!ex) return;
			try {
				await ex.flush();
			} catch {}
		},
		exportStats() {
			return getExporter()?.stats();
		}
	};
}
//#endregion
export { AGENT_IMPROVEMENT_PROFILE_SURFACES, AGENT_PROFILE_MEASURED_SURFACES, AgentCandidateExperimentCellExecutionError, CapabilityNotAdmittedError, agentImprovementProfileDiffs, agentImprovementProfileSurfaceDigest, agentImprovementProfileSurfaceInput, agentImprovementTargetProfileDiffs, buildAgentImprovementActivationTargets, compileEffort, composeCertifiedPrompt, createAgentImprovementActivation, createAgentImprovementActivationResult, createAgentImprovementMeasuredComparison, createAgentImprovementProposal, createCertifiedPromptSource, createExactProcessCandidateExperimentExecutor, createIntelligenceClient, createOptimizationActivationReceipt, createProtectedExactProcessCandidateExperimentExecutor, defaultEffortTier, defaultRedactor, exactProcessCandidateExperimentExecutionSupport, executeAgentCandidateExperimentCell, executeAgentImprovementActivation, isAgentImprovementProfileSurface, isAgentProfileMeasuredSurface, isIntelligenceOff, manifestFromProfile, normalizeCertifiedProfile, optimizationActivationReceiptFromMetadata, parseAgentCandidateProfileActivation as parseCandidateProfileMaterialization, prepareAgentImprovementProfileActivation, proposeAgentImprovement, proposeAgentProfileImprovement, proposeAuthoredAgentProfileImprovement, pullCertified, resolveEffort, resolveIntelligenceBaseUrl, resolveRedactor, reviewAgentImprovementProposal, runAgentCandidateExperiment, submitAgentImprovementProposal, verifyAgentImprovementActivation, verifyAgentImprovementActivationResult, verifyAgentImprovementProposal, verifyAgentImprovementReview, verifyCandidateExecutionEvidence, withIntelligence };

//# sourceMappingURL=intelligence.js.map