import { C as canonicalCandidateDigest$1, D as immutableCandidateValue, E as embeddedCandidateArtifact, O as omitTopLevelDigest, S as canonicalCandidateBytes$1, k as sha256Bytes$1, w as canonicalCandidateDocument } from "./workspace-archive-C9lgf77y.js";
import { agentCandidateProfileActivationSchema, agentCandidateProfileSchema, agentProfileDiffSchema, agentProfileSchema, applyAgentProfileDiff } from "@tangle-network/agent-interface";
import { posix } from "node:path";
import { isMaterializerHarness, materializeCandidateProfile, resolvePiRuntimePaths } from "@tangle-network/agent-profile-materialize";
//#region src/candidate-execution/system-prompt.ts
const SYSTEM_PROMPT_FILE = ".tangle/system-prompt.md";
const APPEND_SYSTEM_PROMPT_FILE = ".tangle/append-system-prompt.md";
const SYSTEM_PROMPT_FLAGS = ["--system-prompt", "--system-prompt-file"];
const APPEND_SYSTEM_PROMPT_FLAGS = ["--append-system-prompt", "--append-system-prompt-file"];
function argsSetSystemPromptFlag(values) {
	return values.some((value) => SYSTEM_PROMPT_FLAGS.some((flag) => value === flag || value.startsWith(`${flag}=`)));
}
function argsSetAppendSystemPromptFlag(values) {
	return values.some((value) => APPEND_SYSTEM_PROMPT_FLAGS.some((flag) => value === flag || value.startsWith(`${flag}=`)));
}
/** Codex keys that can replace or contaminate the materializer's sealed instructions file. */
const CODEX_INSTRUCTION_KEYS = ["model_instructions_file", "developer_instructions"];
function argsSetCodexInstructionOverride(values) {
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		const config = value === "-c" || value === "--config" ? values[index + 1] : value.startsWith("--config=") ? value.slice(9) : void 0;
		if (config !== void 0 && CODEX_INSTRUCTION_KEYS.some((key) => config.trimStart().startsWith(`${key}=`))) return true;
	}
	return false;
}
const HARNESS_SYSTEM_PROMPTS = {
	"claude-code": {
		executable: "claude",
		project: (plan, systemPrompt, path) => appendFlags(addPromptFile(plan, SYSTEM_PROMPT_FILE, systemPrompt), "--system-prompt-file", path),
		projectAppend: (plan, appendSystemPrompt, path) => appendFlags(addPromptFile(plan, APPEND_SYSTEM_PROMPT_FILE, appendSystemPrompt), "--append-system-prompt-file", path),
		conflictsWithArgs: argsSetSystemPromptFlag,
		conflictsWithAppendArgs: argsSetAppendSystemPromptFlag
	},
	/** OpenCode's bound primary agent is already selected by the materializer's --agent flag. */
	opencode: {
		executable: "opencode",
		project: (plan) => plan,
		retainsProjectedSystemPrompt: true,
		conflictsWithArgs: (values) => values.some((value) => value === "--agent" || value.startsWith("--agent=")),
		conflictsWithAppendArgs: argsSetAppendSystemPromptFlag
	},
	pi: {
		executable: "pi",
		project: (plan, systemPrompt, path) => appendFlags(addPromptFile(plan, SYSTEM_PROMPT_FILE, systemPrompt), "--system-prompt", path),
		projectAppend: (plan, appendSystemPrompt, path) => appendFlags(addPromptFile(plan, APPEND_SYSTEM_PROMPT_FILE, appendSystemPrompt), "--append-system-prompt", path),
		conflictsWithArgs: argsSetSystemPromptFlag,
		conflictsWithAppendArgs: argsSetAppendSystemPromptFlag
	},
	prime: {
		executable: "prime-agent",
		project: (plan, systemPrompt, path) => appendFlags(addPromptFile(plan, SYSTEM_PROMPT_FILE, systemPrompt), "--system-prompt", path),
		projectAppend: (plan, appendSystemPrompt, path) => appendFlags(addPromptFile(plan, APPEND_SYSTEM_PROMPT_FILE, appendSystemPrompt), "--append-system-prompt", path),
		conflictsWithArgs: argsSetSystemPromptFlag,
		conflictsWithAppendArgs: argsSetAppendSystemPromptFlag
	},
	/** Gemini's file and env lowering is materializer-owned; this row supplies the launch proof. */
	gemini: {
		executable: "gemini",
		project: (plan) => plan,
		conflictsWithArgs: argsSetSystemPromptFlag,
		conflictsWithAppendArgs: argsSetAppendSystemPromptFlag
	}
};
/**
* These controls are lowered by agent-profile-materialize into files plus launch inputs. The
* candidate adapter does not own the spawn, so it must reject an arbitrary entrypoint even when
* the plan has the right bytes: only the native binary can make those inputs effective.
*/
const MATERIALIZED_PROMPT_DELIVERIES = {
	codex: {
		executable: "codex",
		delivered: (plan) => plan.files.some((file) => file.relPath === ".codex/system-prompt.md") && plan.flags.some((flag) => flag.value === "model_instructions_file=.codex/system-prompt.md"),
		conflictsWithArgs: argsSetCodexInstructionOverride
	},
	gemini: {
		executable: "gemini",
		delivered: (plan) => plan.files.some((file) => file.relPath === ".gemini/system.md") && plan.env.GEMINI_SYSTEM_MD?.value === "1",
		conflictsWithArgs: argsSetSystemPromptFlag
	}
};
/** Project both prompt intents onto their distinct native process controls. */
function projectCandidatePromptIntents(plan, launch, systemPromptFilePath, requestedSystemPrompt = plan.systemPrompt?.value, requestedAppendSystemPrompt = plan.appendSystemPrompt?.value) {
	const systemPrompt = plan.systemPrompt;
	const appendSystemPrompt = plan.appendSystemPrompt;
	const delivery = MATERIALIZED_PROMPT_DELIVERIES[plan.harness];
	if (systemPrompt === void 0 && delivery?.delivered(plan)) {
		assertProvableNativeLaunch(plan.harness, delivery.executable, launch, "replacement");
		assertNoShadowingArgs(plan.harness, delivery.conflictsWithArgs, launch, "replacement");
		if (requestedSystemPrompt === void 0) return plan;
		return plan;
	}
	if (requestedSystemPrompt === void 0 && requestedAppendSystemPrompt === void 0) return plan;
	const projection = HARNESS_SYSTEM_PROMPTS[plan.harness];
	if (!projection) throw new Error(`candidate system prompt has no native launch projection for ${plan.harness}`);
	const requestedReplacement = requestedSystemPrompt !== void 0;
	if (requestedReplacement && systemPrompt === void 0) throw new Error(`profile materializer did not deliver the candidate system prompt for ${plan.harness}`);
	if (systemPrompt !== void 0 && requestedSystemPrompt === void 0) throw new Error(`profile materializer added an unexpected candidate system prompt for ${plan.harness}`);
	if (systemPrompt !== void 0 && systemPrompt.value !== requestedSystemPrompt) throw new Error("profile materializer changed the candidate system prompt");
	if (appendSystemPrompt !== void 0 && appendSystemPrompt.value !== requestedAppendSystemPrompt) throw new Error("profile materializer changed the candidate append system prompt");
	const intent = requestedReplacement ? "replacement" : "addition";
	assertProvableNativeLaunch(plan.harness, projection.executable, launch, intent);
	const launchArgs = (launch.args ?? []).map((value) => value.value);
	if (requestedReplacement && projection.conflictsWithArgs(launchArgs)) throw new Error(`${plan.harness} launch arguments conflict with the candidate profile system prompt`);
	if (requestedAppendSystemPrompt !== void 0 && projection.conflictsWithAppendArgs(launchArgs)) throw new Error(`${plan.harness} launch arguments conflict with the candidate profile append system prompt`);
	let projected = plan;
	if (systemPrompt !== void 0) projected = projection.project(projection.retainsProjectedSystemPrompt ? projected : omitPromptIntent(projected, "systemPrompt"), systemPrompt.value, systemPromptFilePath);
	if (appendSystemPrompt !== void 0) {
		if (!projection.projectAppend) throw new Error(`candidate append system prompt has no native launch projection for ${plan.harness}`);
		projected = projection.projectAppend(omitPromptIntent(projected, "appendSystemPrompt"), appendSystemPrompt.value, posix.join(posix.dirname(systemPromptFilePath), "append-system-prompt.md"));
	}
	return projected;
}
function assertProvableNativeLaunch(harness, expectedExecutable, launch, intent) {
	if (launch.kind !== "container-command") throw new Error(`candidate-entrypoint launch cannot prove ${harness} system-prompt ${intent}`);
	if (launch.executable !== expectedExecutable && !(posix.isAbsolute(launch.executable) && posix.basename(launch.executable) === expectedExecutable)) throw new Error(`${harness} system-prompt ${intent} requires the native ${expectedExecutable} executable`);
}
function assertNoShadowingArgs(harness, conflictsWithArgs, launch, intent) {
	if (conflictsWithArgs((launch.args ?? []).map((value) => value.value))) throw new Error(`${harness} launch arguments conflict with the candidate profile ${intent === "replacement" ? "system" : "append system"} prompt`);
}
function omitPromptIntent(plan, intent) {
	const projected = { ...plan };
	delete projected[intent];
	return projected;
}
function appendFlags(plan, ...values) {
	return {
		...plan,
		flags: [...plan.flags, ...values.map(publicValue$1)]
	};
}
function publicValue$1(value) {
	return {
		kind: "public",
		value
	};
}
function addPromptFile(plan, relPath, prompt) {
	if (plan.files.some((file) => file.relPath === relPath)) throw new Error(`candidate profile conflicts with reserved ${relPath}`);
	return {
		...plan,
		files: [...plan.files, {
			relPath,
			content: prompt,
			source: "generated"
		}]
	};
}
//#endregion
//#region src/candidate-execution/profile.ts
function candidateMaterializerHarness(harness) {
	if (!isMaterializerHarness(harness)) throw new Error(`sealed candidate profile materialization is unsupported for harness ${harness}`);
	return harness;
}
/** Runtime applies the materializer's launch flags to the candidate process. */
const CANDIDATE_PROFILE_MATERIALIZER_BINDS = ["systemPrompt"];
const PI_CANDIDATE_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const PI_CANDIDATE_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";
/** Derive the exact native profile plan used by preparation and later evidence checks. */
function materializeAgentCandidateProfilePlan(options) {
	const root = options.workspace === "task" ? options.workspaces.taskRoot : options.workspaces.candidateRoot;
	if (!root) throw new Error("candidate profile target is missing its execution workspace root");
	return projectCandidatePromptIntents(materializeCandidateProfile(options.profile, candidateMaterializerHarness(options.harness), {
		binds: CANDIDATE_PROFILE_MATERIALIZER_BINDS,
		resolvedResources: options.resolvedResources
	}), options.launch, posix.join(root, ".tangle/system-prompt.md"), options.profile.prompt?.systemPrompt, options.profile.prompt?.appendSystemPrompt);
}
/** Resolve the private Pi roots needed by an agent-root profile plan. */
function candidateProfileAgentPaths(plan, runtimeHome) {
	if (!plan.files.some((file) => file.root === "agent")) return void 0;
	if (plan.harness !== "pi") throw new Error(`candidate profile agent-root files are unsupported for ${plan.harness}`);
	if (runtimeHome === void 0) throw new Error("candidate profile agent-root files require executionRoots.profileRoot");
	return resolvePiRuntimePaths(runtimeHome);
}
/** Bind exact native profile text to the canonical plan captured during preparation. */
function createAgentCandidateProfileActivation(plan, profilePlan) {
	const sourceByIdentity = new Map(plan.files.map((file) => [profileFileIdentity(file.root, file.relPath), file]));
	if (sourceByIdentity.size !== plan.files.length) throw new Error("candidate profile activation contains duplicate rooted native file paths");
	const files = profilePlan.material.files.map((expected) => {
		const source = sourceByIdentity.get(profileFileIdentity(expected.root, expected.relPath));
		if (!source) throw new Error(`candidate profile activation is missing ${profileFileLabel(expected.root, expected.relPath)}`);
		const mode = source.mode ?? 420;
		if (!Number.isSafeInteger(mode) || mode < 0 || mode > 511) throw new Error(`candidate profile activation has invalid mode for ${profileFileLabel(expected.root, expected.relPath)}`);
		return {
			path: expected.relPath,
			mode,
			content: source.content
		};
	});
	if (files.length !== plan.files.length) throw new Error("candidate profile activation contains unplanned native files");
	return parseAgentCandidateProfileActivation(canonicalCandidateDocument({
		kind: "agent-candidate-profile-activation",
		profilePlan,
		files
	}).value, profilePlan.digest);
}
function profileFileIdentity(root, relPath) {
	return `${root ?? "workspace"}\0${relPath}`;
}
function profileFileLabel(root, relPath) {
	return root === "agent" ? `agent:${relPath}` : relPath;
}
/** Parse and check every native file hash plus both canonical document digests. */
function parseAgentCandidateProfileActivation(input, expectedProfilePlanDigest) {
	const activation = agentCandidateProfileActivationSchema.parse(input);
	const planBytes = canonicalCandidateBytes$1(activation.profilePlan.material);
	const profilePlanArtifact = activation.profilePlan.artifact;
	if (sha256Bytes$1(planBytes) !== activation.profilePlan.digest || profilePlanArtifact.sha256 !== activation.profilePlan.digest || profilePlanArtifact.byteLength !== planBytes.byteLength || "content" in profilePlanArtifact && !Buffer.from(profilePlanArtifact.content, "base64").equals(Buffer.from(planBytes)) || expectedProfilePlanDigest !== void 0 && activation.profilePlan.digest !== expectedProfilePlanDigest) throw new Error("candidate profile activation has an invalid canonical profile plan");
	if (canonicalCandidateDigest$1(omitTopLevelDigest(activation)) !== activation.digest) throw new Error("candidate profile activation digest does not match");
	return immutableCandidateValue(activation);
}
const CANDIDATE_PROFILE_DIRECT_FIELDS = [
	"name",
	"description",
	"version",
	"tags",
	"prompt",
	"harness",
	"permissions",
	"tools",
	"confidential"
];
/** Convert only behavior-preserving generic profile fields into the closed candidate contract. */
function freezeGenericAgentCandidateProfile(input) {
	return candidateProfileFromGenericProfile(parseExactAgentProfile(input, "profile"));
}
/**
* Keep every generic-profile-to-candidate conversion in one place.
* Callers use this both when sealing a new bundle and when proving a measured
* profile is exactly the profile in an existing candidate.
*/
function candidateProfileFromGenericProfile(profile) {
	if (profile.connections !== void 0) unsupportedProfileField("connections");
	if (profile.metadata !== void 0) unsupportedProfileField("metadata");
	if (profile.extensions !== void 0) unsupportedProfileField("extensions");
	if (profile.model?.metadata !== void 0) unsupportedProfileField("model.metadata");
	const candidate = {};
	copyDirectProfileFields(candidate, profile);
	if (profile.model) {
		const { metadata: _metadata, ...model } = profile.model;
		candidate.model = model;
	}
	if (profile.mcp) candidate.mcp = freezeMcpServers(profile.mcp);
	if (profile.subagents) candidate.subagents = Object.fromEntries(Object.entries(profile.subagents).map(([name, subagent]) => {
		if (subagent.metadata !== void 0) unsupportedProfileField(`subagents.${name}.metadata`);
		const { metadata: _metadata, ...value } = subagent;
		return [name, value];
	}));
	if (profile.resources) candidate.resources = freezeResources(profile.resources);
	if (profile.hooks && Object.values(profile.hooks).some((commands) => commands.length > 0)) throw new Error("generic AgentProfile hooks cannot be safely tokenized; use a candidate-profile source with executable/args");
	if (profile.hooks) candidate.hooks = profile.hooks;
	if (profile.modes) candidate.modes = Object.fromEntries(Object.entries(profile.modes).map(([name, mode]) => {
		if (mode.metadata !== void 0) unsupportedProfileField(`modes.${name}.metadata`);
		const { metadata: _metadata, ...value } = mode;
		return [name, value];
	}));
	return parseExactCandidateProfile(candidate);
}
/** Prove the measured generic profile and sealed candidate profile describe the same behavior. */
function assertCandidateProfileBinding(measuredInput, bundled) {
	if (canonicalCandidateDigest$1(candidateProfileFromGenericProfile(parseExactAgentProfile(measuredInput, "measured agent profile"))) !== canonicalCandidateDigest$1(bundled)) throw new Error("measured agent profile does not match sealed candidate profile");
}
/** Parse a complete profile without silently discarding unsupported fields. */
function parseExactAgentProfile(input, label) {
	let parsed;
	try {
		parsed = agentProfileSchema.parse(input);
	} catch (cause) {
		throw new Error(`${label} contains unsupported or non-canonical fields`, { cause });
	}
	assertCanonicalParse(input, parsed, label);
	return parsed;
}
/** Parse a profile diff without silently discarding unsupported fields. */
function parseExactAgentProfileDiff(input, label) {
	let parsed;
	try {
		parsed = agentProfileDiffSchema.parse(input);
	} catch (cause) {
		throw new Error(`${label} contains unsupported or non-canonical fields`, { cause });
	}
	assertCanonicalParse(input, parsed, label);
	return parsed;
}
/** Apply one exact diff and reject any value that cannot be preserved canonically. */
function applyExactAgentProfileDiff(baseInput, diffInput, label) {
	return parseExactAgentProfile(omitUndefinedObjectFields(applyAgentProfileDiff(parseExactAgentProfile(baseInput, `${label} base profile`), parseExactAgentProfileDiff(diffInput, `${label} diff`)), label), `${label} result`);
}
/** Parse a candidate profile without silently discarding unsupported or non-canonical fields. */
function parseExactCandidateProfile(input) {
	const parsed = agentCandidateProfileSchema.parse(input);
	assertCanonicalParse(input, parsed, "candidate profile");
	return parsed;
}
/** Reject profile fields whose behavioral effect is not yet proven by candidate executors. */
function assertCandidateProfileExecutionSupport(profile) {
	const unsupported = [
		"tools",
		"permissions",
		"modes",
		"confidential"
	].filter((field) => hasEntries(profile[field]));
	if (unsupported.length > 0) throw new Error(`candidate execution cannot prove in-session effects for non-empty AgentProfile fields: ${unsupported.join(", ")}`);
}
/** Convert the candidate profile contract into the portable interface profile it represents. */
function agentCandidateProfileAsAgentProfile(candidate) {
	const output = {};
	copyDirectProfileFields(output, candidate);
	if (candidate.model) output.model = { ...candidate.model };
	if (candidate.mcp) output.mcp = Object.fromEntries(Object.entries(candidate.mcp).map(([name, server]) => [name, {
		...server,
		...server.args ? { args: server.args.map((value) => ({ ...value })) } : {},
		...server.env ? { env: cloneRecord(server.env) } : {}
	}]));
	if (candidate.subagents) output.subagents = cloneRecord(candidate.subagents);
	if (candidate.modes) output.modes = cloneRecord(candidate.modes);
	if (candidate.hooks) output.hooks = Object.fromEntries(Object.entries(candidate.hooks).map(([event, hooks]) => [event, hooks.map(({ executable, args, env, ...hook }) => ({
		...hook,
		command: [executable, ...(args ?? []).map(publicValue)].map(shellQuote).join(" "),
		...env ? { env: cloneRecord(env) } : {}
	}))]));
	if (candidate.resources) {
		if (candidate.resources.failOnError !== true) throw new Error("sealed candidate profile contains fields unsupported by generic profiles");
		output.resources = {
			failOnError: true,
			...candidate.resources.files ? { files: candidate.resources.files.map((file) => ({
				...file,
				resource: publicResource(file.resource)
			})) } : {},
			...candidate.resources.tools ? { tools: candidate.resources.tools.map(publicResource) } : {},
			...candidate.resources.skills ? { skills: candidate.resources.skills.map(publicResource) } : {},
			...candidate.resources.agents ? { agents: candidate.resources.agents.map(publicResource) } : {},
			...candidate.resources.commands ? { commands: candidate.resources.commands.map(publicResource) } : {},
			...candidate.resources.instructions !== void 0 ? { instructions: typeof candidate.resources.instructions === "string" ? candidate.resources.instructions : publicResource(candidate.resources.instructions) } : {}
		};
	}
	return output;
}
/** Recursively remove undefined object fields while refusing undefined array entries. */
function omitUndefinedObjectFields(value, path) {
	if (Array.isArray(value)) return value.map((entry, index) => {
		if (entry === void 0) throw new Error(`${path} produced an undefined array entry at ${index}`);
		return omitUndefinedObjectFields(entry, `${path}[${index}]`);
	});
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0).map(([key, entry]) => [key, omitUndefinedObjectFields(entry, `${path}.${key}`)]));
}
function freezeMcpServers(servers) {
	return Object.fromEntries(Object.entries(servers).map(([name, server]) => {
		if (server.transport !== void 0 && server.transport !== "stdio") unsupportedProfileField(`mcp.${name}.transport=${server.transport}`);
		if (server.url !== void 0) unsupportedProfileField(`mcp.${name}.url`);
		if (server.headers !== void 0) unsupportedProfileField(`mcp.${name}.headers`);
		if (server.metadata !== void 0) unsupportedProfileField(`mcp.${name}.metadata`);
		return [name, {
			...server.transport ? { transport: server.transport } : {},
			...server.command ? { command: server.command } : {},
			...server.args ? { args: server.args.map((value, index) => candidatePublicValue(value, `mcp.${name}.args[${index}]`)) } : {},
			...server.env ? { env: mapCandidatePublicValues(server.env, `mcp.${name}.env`) } : {},
			...server.cwd ? { cwd: server.cwd } : {},
			...server.enabled === void 0 ? {} : { enabled: server.enabled }
		}];
	}));
}
function freezeResources(resources) {
	if (resources.failOnError !== true) throw new Error("candidate profile resources require failOnError: true");
	return {
		failOnError: true,
		...resources.files ? { files: resources.files.map((file) => ({
			...file,
			resource: freezeResource(file.resource)
		})) } : {},
		...resources.tools ? { tools: resources.tools.map(freezeResource) } : {},
		...resources.skills ? { skills: resources.skills.map(freezeResource) } : {},
		...resources.agents ? { agents: resources.agents.map(freezeResource) } : {},
		...resources.commands ? { commands: resources.commands.map(freezeResource) } : {},
		...resources.instructions === void 0 ? {} : { instructions: typeof resources.instructions === "string" ? resources.instructions : freezeResource(resources.instructions) }
	};
}
function freezeResource(resource) {
	if (resource.kind === "github") throw new Error("generic GitHub profile resources do not carry byte identity; use a candidate-profile source with a pinned commit, digest, and byte length");
	const bytes = Buffer.from(resource.content, "utf8");
	return {
		...resource,
		sha256: embeddedCandidateArtifact(bytes).sha256,
		byteLength: bytes.byteLength
	};
}
function copyDirectProfileFields(target, source) {
	for (const key of CANDIDATE_PROFILE_DIRECT_FIELDS) if (source[key] !== void 0) target[key] = source[key];
}
function assertCanonicalParse(input, parsed, label) {
	if (!Buffer.from(canonicalCandidateBytes$1(input)).equals(canonicalCandidateBytes$1(parsed))) throw new Error(`${label} contains unsupported or non-canonical fields`);
}
function publicResource(resource) {
	if (resource.kind === "inline") return {
		kind: "inline",
		name: resource.name,
		content: resource.content
	};
	return {
		kind: "github",
		repository: `${resource.repository.owner}/${resource.repository.repo}`,
		path: resource.path,
		ref: resource.commit,
		...resource.name ? { name: resource.name } : {}
	};
}
/** Freeze one profile config value into the candidate's PUBLIC-only config
*  shape. A secret-ref has no candidate representation (AgentCandidateConfigValue
*  is public-only), so it is rejected, never silently dropped or unwrapped. */
function candidatePublicValue(value, path) {
	if (value.kind !== "public") unsupportedProfileField(`${path} (secret-ref '${value.key}')`);
	return {
		kind: "public",
		value: value.value
	};
}
function mapCandidatePublicValues(values, pathPrefix) {
	return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, candidatePublicValue(value, `${pathPrefix}.${name}`)]));
}
function publicValue(value) {
	return value.value;
}
function cloneRecord(values) {
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { ...value }]));
}
function hasEntries(value) {
	return value !== void 0 && value !== null && typeof value === "object" ? Object.keys(value).length > 0 : false;
}
function shellQuote(value) {
	return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}
function unsupportedProfileField(path) {
	throw new Error(`generic AgentProfile field ${path} is not representable in a sealed candidate profile`);
}
//#endregion
export { assertCandidateProfileBinding as a, createAgentCandidateProfileActivation as c, omitUndefinedObjectFields as d, parseAgentCandidateProfileActivation as f, parseExactCandidateProfile as h, applyExactAgentProfileDiff as i, freezeGenericAgentCandidateProfile as l, parseExactAgentProfileDiff as m, PI_CANDIDATE_SESSION_DIR_ENV as n, assertCandidateProfileExecutionSupport as o, parseExactAgentProfile as p, agentCandidateProfileAsAgentProfile as r, candidateProfileAgentPaths as s, PI_CANDIDATE_AGENT_DIR_ENV as t, materializeAgentCandidateProfilePlan as u };

//# sourceMappingURL=profile-D3eXNBQV.js.map