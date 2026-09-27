import { i as ConfigError, m as ValidationError } from "./errors-DodWX-cb.js";
import { HARNESS_NATIVE_MODEL } from "@tangle-network/agent-eval";
//#region src/runtime/harness-role.ts
/**
* Harness ids that select a router/no-agent mode rather than a coding-agent runtime.
*
* `nanoclaw` is deliberately ABSENT: the shared capability table clamps its reasoning ceiling the
* same way it clamps `cli-base`, but nanoclaw does run an agent (a socket-bridge runner to the
* NanoClaw daemon) and every caller here treats it as a full harness. Add a row only with the
* behavior change stated, never to make the two clamps look symmetric.
*/
const NO_AGENT_HARNESSES = /* @__PURE__ */ new Set(["cli-base"]);
/** Whether this profile harness selects a real coding-agent runtime (vs. the router/no-agent mode
*  or no preference at all). Accepts the looser `string` some local profile shapes declare, and
*  preserves the caller's own harness type when it is narrower. */
function harnessRunsAgent(harness) {
	return harness != null && !NO_AGENT_HARNESSES.has(harness);
}
/** The coding-agent harness this profile selects, or `undefined` when it selects none — the shape
*  callers want when a no-agent mode must fall through to the router arm. */
function agentHarness(harness) {
	return harnessRunsAgent(harness) ? harness : void 0;
}
//#endregion
//#region src/runtime/router-retry-policy.ts
const maximumTimerMs = 2147483647;
const defaultRetryStatuses = Object.freeze([
	408,
	425,
	429,
	500,
	502,
	503,
	504,
	520,
	522,
	524
]);
const retryPolicyKeys = /* @__PURE__ */ new Set([
	"initialBackoffMs",
	"jitter",
	"maxAttempts",
	"maxBackoffMs",
	"requestTimeoutMs",
	"retryStatuses"
]);
/** Parse untrusted profile/config data once and return an immutable complete policy. */
function resolveRouterRetryPolicy(input, context) {
	if (input !== void 0 && (typeof input !== "object" || input === null || Array.isArray(input))) throw new ValidationError(`${context} must be an object`);
	const policy = input === void 0 ? {} : Object.fromEntries(Object.entries(input));
	const unknown = Object.keys(policy).filter((key) => !retryPolicyKeys.has(key));
	if (unknown.length > 0) throw new ValidationError(`${context} has unsupported fields: ${unknown.join(", ")}`);
	const maxAttempts = positiveInteger$1(policy.maxAttempts, 5, `${context}.maxAttempts`);
	const initialBackoffMs = timerInteger(policy.initialBackoffMs, 1e3, `${context}.initialBackoffMs`);
	const maxBackoffMs = timerInteger(policy.maxBackoffMs, 3e4, `${context}.maxBackoffMs`);
	const requestTimeoutMs = timerInteger(policy.requestTimeoutMs, 0, `${context}.requestTimeoutMs`, Number.MAX_SAFE_INTEGER - Date.now());
	const jitter = policy.jitter ?? .25;
	if (typeof jitter !== "number" || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new ValidationError(`${context}.jitter must be a finite number from 0 through 1`);
	const retryStatuses = parseRetryStatuses(policy.retryStatuses, context);
	return Object.freeze({
		maxAttempts,
		initialBackoffMs,
		maxBackoffMs,
		jitter,
		retryStatuses,
		requestTimeoutMs
	});
}
function parseRetryStatuses(value, context) {
	if (value === void 0) return defaultRetryStatuses;
	if (!Array.isArray(value)) throw new ValidationError(`${context}.retryStatuses must be an array of HTTP statuses`);
	const statuses = [];
	const seen = /* @__PURE__ */ new Set();
	for (const status of value) {
		if (!Number.isSafeInteger(status) || status < 100 || status > 599) throw new ValidationError(`${context}.retryStatuses must contain integer HTTP statuses from 100 through 599`);
		if (seen.has(status)) throw new ValidationError(`${context}.retryStatuses must not contain duplicates`);
		seen.add(status);
		statuses.push(status);
	}
	return Object.freeze(statuses);
}
function positiveInteger$1(value, fallback, context) {
	const parsed = value ?? fallback;
	if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) throw new ValidationError(`${context} must be a positive safe integer`);
	return parsed;
}
function timerInteger(value, fallback, context, maximum = maximumTimerMs) {
	const parsed = value ?? fallback;
	if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) throw new ValidationError(`${context} must be a nonnegative safe integer no greater than ${maximum}`);
	return parsed;
}
//#endregion
//#region src/runtime/supervise/model-policy.ts
/**
* `assertModelAllowed` — a fail-loud guard that restricts a run to a chosen subset of
* models. The two front doors (`supervise()` / `improve()`) call it once per configured
* model at resolve time, so a run that names a model outside the allowed set throws before
* any compute is spent — never silently swapped or silently allowed.
*/
/**
* Return the model id an executor may send to a provider.
*
* Eval stamps {@link HARNESS_NATIVE_MODEL} into a profile when model selection is deliberately
* delegated to the configured runtime. That marker belongs in experiment identity and cost
* admission; it is not a provider model id.
*/
function concreteModelId(model) {
	if (model === void 0) return void 0;
	const id = model.trim();
	return id.length > 0 && !isHarnessNativeModel(id) ? id : void 0;
}
/** Whether a model value delegates selection to the chosen execution system. */
function isHarnessNativeModel(model) {
	return model?.trim() === HARNESS_NATIVE_MODEL;
}
/** Return a profile's explicitly selected provider model, if it has one. */
function concreteProfileModel(profile) {
	return concreteModelId(profile.model?.default);
}
/**
* Return the model id for a direct provider request.
*
* A portable profile can qualify its model with the selected provider. The direct endpoint already
* selects that provider, so remove only the exact matching prefix. Preserve every other prefix
* because it can identify a provider-owned nested route, such as `anthropic/claude-sonnet`.
*/
function profileProviderModel(profile) {
	const model = concreteProfileModel(profile);
	const provider = profile.model?.provider?.trim();
	if (!model || !provider || !model.startsWith(`${provider}/`)) return model;
	return concreteModelId(model.slice(provider.length + 1));
}
/** The full cli-bridge wire id declared by a profile: harness/provider/model. */
function profileBridgeWireModel(profile) {
	const model = concreteProfileModel(profile);
	const provider = profile.model?.provider;
	const harness = agentHarness(profile.harness);
	const modelWithoutHarness = model && harness && model.startsWith(`${harness}/`) ? model.slice(harness.length + 1) : model;
	const providerModel = modelWithoutHarness ? provider && !modelWithoutHarness.startsWith(`${provider}/`) ? `${provider}/${modelWithoutHarness}` : modelWithoutHarness : void 0;
	if (!harness) return providerModel;
	if (!providerModel) return harness;
	return providerModel.startsWith(`${harness}/`) ? providerModel : `${harness}/${providerModel}`;
}
/**
* Refuse an incomplete execution identity before any backend may fill it from ambient config.
* `AgentProfile` is the sole behavioral authority: harness, provider, and concrete model all
* participate in its digest. Eval's runtime-selected marker is a matrix-planning value, never an
* executable model.
*/
function assertExecutableAgentProfile(profile, context) {
	if (profile.harness === void 0) throw new ConfigError(`${context}: AgentProfile.harness must be explicit before execution`);
	const declared = profile.model?.default;
	if (!concreteModelId(declared)) throw new ConfigError(`${context}: AgentProfile.model.default is ${isHarnessNativeModel(declared) ? "runtime-selected" : "missing"}; execution requires a concrete model`);
	if (!profile.model?.provider?.trim()) throw new ConfigError(`${context}: AgentProfile.model.provider must be explicit before execution`);
}
const PROFILE_MODEL_METADATA_KEYS = /* @__PURE__ */ new Set([
	"extraBody",
	"maxTurns",
	"retry",
	"seed",
	"stream",
	"temperature",
	"toolChoice"
]);
/**
* Read every Router-affecting control from the exact profile and reject unknown controls.
* Backends receive endpoint/auth and executable ports only; they cannot silently alter behavior.
*/
function profileModelExecutionSettings(profile, context) {
	const metadata = profile.model?.metadata ?? {};
	if (metadata.maxTokens !== void 0) throw new ConfigError(`${context}: AgentProfile.model.metadata.maxTokens is ambiguous across providers; declare AgentProfile.model.maxVisibleOutputTokens, maxReasoningTokens, or maxTotalOutputTokens instead`);
	const unknown = Object.keys(metadata).filter((key) => !PROFILE_MODEL_METADATA_KEYS.has(key));
	if (unknown.length > 0) throw new ConfigError(`${context}: unsupported AgentProfile.model.metadata fields: ${unknown.join(", ")}`);
	const temperature = finiteNumber(metadata.temperature, `${context}: temperature`);
	const tokenLimits = profileTokenLimits(profile, context);
	const retryInput = metadata.retry;
	const retry = retryInput === void 0 ? void 0 : resolveRouterRetryPolicy(retryInput, `${context}: AgentProfile.model.metadata.retry`);
	const seed = safeInteger(metadata.seed, `${context}: seed`);
	const maxTurns = nonnegativeInteger(metadata.maxTurns, `${context}: maxTurns`);
	const stream = optionalBoolean(metadata.stream, `${context}: stream`);
	const toolChoice = metadata.toolChoice;
	if (toolChoice !== void 0 && toolChoice !== "auto" && toolChoice !== "required" && toolChoice !== "none") throw new ConfigError(`${context}: toolChoice must be auto, required, or none`);
	const extraBody = metadata.extraBody;
	if (extraBody !== void 0 && (typeof extraBody !== "object" || extraBody === null || Array.isArray(extraBody))) throw new ConfigError(`${context}: extraBody must be an object`);
	return {
		...temperature !== void 0 ? { temperature } : {},
		tokenLimits,
		...retry !== void 0 ? { retry } : {},
		...seed !== void 0 ? { seed } : {},
		...toolChoice !== void 0 ? { toolChoice } : {},
		...extraBody !== void 0 ? { extraBody: Object.freeze({ ...extraBody }) } : {},
		...maxTurns !== void 0 ? { maxTurns } : {},
		...stream !== void 0 ? { stream } : {}
	};
}
/**
* Read the completion ceilings an exact profile declares. The Interface schema already refines
* these fields, but a profile can reach an executor without a parse, so the same rules are
* enforced here: positive integers, and no single ceiling above the total.
*/
function profileTokenLimits(profile, context) {
	const model = profile.model;
	const visible = positiveInteger(model?.maxVisibleOutputTokens, `${context}: maxVisibleOutputTokens`);
	const reasoning = positiveInteger(model?.maxReasoningTokens, `${context}: maxReasoningTokens`);
	const total = positiveInteger(model?.maxTotalOutputTokens, `${context}: maxTotalOutputTokens`);
	if (total !== void 0) {
		for (const [name, value] of [["maxVisibleOutputTokens", visible], ["maxReasoningTokens", reasoning]]) if (value !== void 0 && value > total) throw new ConfigError(`${context}: AgentProfile.model.${name} (${value}) exceeds maxTotalOutputTokens (${total})`);
	}
	return {
		...visible !== void 0 ? { visible } : {},
		...reasoning !== void 0 ? { reasoning } : {},
		...total !== void 0 ? { total } : {}
	};
}
/**
* Lower the requested ceilings onto one execution path, or refuse the run before any paid
* transport.
*
* - Router and OpenAI-compatible routes send the visible ceiling as `max_tokens` and the total as
*   `max_completion_tokens`.
* - The CLI Bridge lowers ONE completion cap into the run's model catalog, so it carries the total
*   as `max_tokens` and cannot bound the visible half on its own.
* - The Sandbox and environment-provider paths expose no completion cap at all.
* - No route publishes a reasoning-token budget, so a reasoning ceiling is refused everywhere.
*   `AgentProfile.model.reasoningEffort` is an intensity dial, not a token bound.
*/
function enforceTokenLimits(limits, path, context) {
	const refuse = (field, reason) => {
		throw new ConfigError(`${context}: AgentProfile.model.${field} cannot be enforced on the ${path} path (${reason}); remove the ceiling or select a path that enforces it`);
	};
	if (limits.reasoning !== void 0) refuse("maxReasoningTokens", "no route exposes a reasoning-token budget");
	if (path === "router") return {
		requested: limits,
		applied: {
			...limits.visible !== void 0 ? { maxTokens: limits.visible } : {},
			...limits.total !== void 0 ? { maxCompletionTokens: limits.total } : {}
		}
	};
	if (path === "bridge") {
		if (limits.visible !== void 0) refuse("maxVisibleOutputTokens", "the bridge lowers one completion cap covering both halves");
		return {
			requested: limits,
			applied: { ...limits.total !== void 0 ? { maxTokens: limits.total } : {} }
		};
	}
	if (limits.visible !== void 0) refuse("maxVisibleOutputTokens", "the backend accepts no cap");
	if (limits.total !== void 0) refuse("maxTotalOutputTokens", "the backend accepts no cap");
	return {
		requested: limits,
		applied: {}
	};
}
function finiteNumber(value, context) {
	if (value === void 0) return void 0;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new ConfigError(`${context} must be a finite number`);
	return value;
}
function safeInteger(value, context) {
	if (value === void 0) return void 0;
	if (!Number.isSafeInteger(value)) throw new ConfigError(`${context} must be a safe integer`);
	return value;
}
function positiveInteger(value, context) {
	const parsed = safeInteger(value, context);
	if (parsed !== void 0 && parsed < 1) throw new ConfigError(`${context} must be positive`);
	return parsed;
}
function nonnegativeInteger(value, context) {
	const parsed = safeInteger(value, context);
	if (parsed !== void 0 && parsed < 0) throw new ConfigError(`${context} must be nonnegative`);
	return parsed;
}
function optionalBoolean(value, context) {
	if (value === void 0) return void 0;
	if (typeof value !== "boolean") throw new ConfigError(`${context} must be boolean`);
	return value;
}
/**
* Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a
* member of `allowed`. No-op when `allowed` is unset (the unrestricted default) or when
* `model` is undefined (nothing was configured to check).
*/
function assertModelAllowed(model, allowed) {
	if (!allowed || model === void 0) return;
	if (!allowed.includes(model)) throw new ConfigError(`model ${JSON.stringify(model)} is not in the allowed set ${JSON.stringify([...allowed])}`);
}
/** Check every canonical model-bearing field in a complete profile, including the models a
* backend may select for cheap work, named subagents, or modes.
*
* Every compared value is a bare model id. The composed `harness/provider/model` wire id
* (`profileBridgeWireModel`) is neither built nor compared here, so this admits any route that
* declares an allowed id, and a qualified entry in `allowed` matches nothing. Route pinning
* belongs to `SuperviseOptions.authorizeSpawn`. */
function assertProfileModelsAllowed(profile, allowed) {
	assertModelAllowed(profile.model?.default, allowed);
	assertModelAllowed(profile.model?.small, allowed);
	for (const subagent of Object.values(profile.subagents ?? {})) assertModelAllowed(subagent.model, allowed);
	for (const mode of Object.values(profile.modes ?? {})) assertModelAllowed(mode.model, allowed);
}
//#endregion
export { concreteProfileModel as a, profileModelExecutionSettings as c, agentHarness as d, harnessRunsAgent as f, concreteModelId as i, profileProviderModel as l, assertModelAllowed as n, enforceTokenLimits as o, assertProfileModelsAllowed as r, profileBridgeWireModel as s, assertExecutableAgentProfile as t, resolveRouterRetryPolicy as u };

//# sourceMappingURL=model-policy-BbSCSak0.js.map