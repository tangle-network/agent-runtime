import { Ci as sandboxActProfileMaterialization, Ei as worktreeCliProfileMaterialization, Ti as validateProfileMaterialization, _i as promptControlProfileMaterialization, bi as promptResourceProfileMaterialization, ca as mapSandboxEvent, di as AGENT_PROFILE_MATERIALIZATION_AXES, fi as assertProfileMaterialization, gi as profileMaterializationAxes, hi as fullProfileMaterialization, mi as defineProfileMaterializationContract, pi as controlProfileMaterialization, vi as promptModelProfileMaterialization, xi as renderProfileMaterializationIssues, yi as promptOnlyProfileMaterialization, zn as createSandboxForSpec } from "./supervisor-DtlPj9me.js";
import "./runtime-DsAHXig2.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseFindingSubject } from "@tangle-network/agent-eval/analyst";
//#region src/agent/surfaces.ts
/**
* `AgentSurfaces` — declarative map of the mutable file/directory paths
* the self-improvement loop can edit on behalf of an agent.
*
* The substrate uses this map to resolve every parsed `FindingSubject`
* (from agent-eval) to a real on-disk path. No per-vertical glue;
* no fabricated paths; no silent `existsSync(...)` skips that hide
* misconfiguration from the operator.
*
* Surfaces are validated at `defineAgent` time — missing paths fail
* loud with a list of every offender. A surface that's not needed
* (e.g. an agent with no RAG corpora) is simply omitted; the loop
* refuses to route those subjects rather than fabricating a target.
*/
/**
* Resolve a parsed `FindingSubject` to the file path the substrate
* should edit (or create) on disk.
*
* Returns `null` when:
*   - the subject targets a surface the agent didn't declare
*     (e.g. `rag:*` when `surfaces.rag` is undefined), OR
*   - the subject is a `cluster` (failure-mode emits these as evidence,
*     not actionable mutations — they don't route to a file).
*
* Returns a `ResolvedSurface` with `intent: 'create-new'` when the
* subject names a path that doesn't yet exist (e.g. a new wiki page).
* The caller chooses whether to honour the create — for tightly-managed
* surfaces like `systemPrompt` it's usually a contract violation
* (the analyst named a section that doesn't exist); for `knowledge`
* it's the whole point.
*/
function resolveSubjectPath(subject, surfaces, repoRoot) {
	const candidates = candidatePathsForSubject(subject, surfaces);
	if (candidates.length === 0) return null;
	for (const rel of candidates) {
		const abs = isAbsolute(rel) ? rel : join(repoRoot, rel);
		if (existsSync(abs)) return {
			absolutePath: abs,
			repoRelativePath: rel,
			exists: true,
			intent: "edit-existing"
		};
	}
	const fallback = candidates[0];
	return {
		absolutePath: isAbsolute(fallback) ? fallback : join(repoRoot, fallback),
		repoRelativePath: fallback,
		exists: false,
		intent: "create-new"
	};
}
function candidatePathsForSubject(subject, surfaces) {
	switch (subject.kind) {
		case "knowledge.wiki":
		case "knowledge.stale": return optionalPath(safeJoin(surfaces.knowledge, `${subject.slug}.md`));
		case "knowledge.claim": return optionalPath(safeJoin(surfaces.knowledge, "claims", `${slugify(subject.topic)}.md`));
		case "knowledge.raw": return optionalPath(safeJoin(surfaces.knowledge, "raw", `${subject.sourceId}.md`));
		case "system-prompt": {
			const slug = slugify(subject.section);
			return [
				safeJoin(surfaces.systemPrompt, `${slug}.md`),
				safeJoin(surfaces.systemPrompt, slug, "SKILL.md"),
				safeJoin(surfaces.systemPrompt, slug, "index.md")
			].filter((path) => path !== null);
		}
		case "skill":
			if (!surfaces.skills) return [];
			return [safeJoin(surfaces.skills, subject.name, "SKILL.md"), safeJoin(surfaces.skills, `${subject.name}.md`)].filter((path) => path !== null);
		case "tool-doc":
			if (subject.aspect) return optionalPath(safeJoin(surfaces.tools, subject.tool, `${slugify(subject.aspect)}.md`));
			return [safeJoin(surfaces.tools, subject.tool, "README.md"), safeJoin(surfaces.tools, `${subject.tool}.md`)].filter((path) => path !== null);
		case "new-tool": return optionalPath(safeJoin(surfaces.tools, subject.name, "README.md"));
		case "mcp":
			if (!surfaces.mcp) return [];
			return subject.tool ? optionalPath(safeJoin(surfaces.mcp, subject.server, `${subject.tool}.md`)) : [safeJoin(surfaces.mcp, `${subject.server}.json`), safeJoin(surfaces.mcp, subject.server, "README.md")].filter((path) => path !== null);
		case "hook":
			if (!surfaces.hooks) return [];
			return [safeJoin(surfaces.hooks, `${subject.name}.md`), safeJoin(surfaces.hooks, `${subject.name}.json`)].filter((path) => path !== null);
		case "subagent":
			if (!surfaces.subagents) return [];
			return [
				safeJoin(surfaces.subagents, `${subject.name}.md`),
				safeJoin(surfaces.subagents, `${subject.name}.yaml`),
				safeJoin(surfaces.subagents, `${subject.name}.json`)
			].filter((path) => path !== null);
		case "workflow":
			if (!surfaces.workflows) return [];
			return [
				safeJoin(surfaces.workflows, `${subject.name}.md`),
				safeJoin(surfaces.workflows, `${subject.name}.yaml`),
				safeJoin(surfaces.workflows, `${subject.name}.json`)
			].filter((path) => path !== null);
		case "rollout-policy": return surfaces.rolloutPolicy ? [surfaces.rolloutPolicy] : [];
		case "agent-profile": return surfaces.agentProfile ? [surfaces.agentProfile] : [];
		case "code": {
			if (!surfaces.code) return [];
			const path = safeJoin(surfaces.code, subject.path);
			return path ? [path] : [];
		}
		case "rag":
			if (!surfaces.rag) return [];
			return optionalPath(safeJoin(surfaces.rag, subject.corpus, `${subject.docId}.md`));
		case "memory":
			if (!surfaces.memory) return [];
			return optionalPath(safeJoin(surfaces.memory, `${slugify(subject.key)}.json`));
		case "scaffolding":
			if (!surfaces.scaffolding) return [];
			return optionalPath(safeJoin(surfaces.scaffolding, `${slugify(subject.concern)}.md`));
		case "output-schema":
			if (!surfaces.outputSchema) return [];
			return [surfaces.outputSchema];
		case "websearch.outdated":
		case "prior-run-summary": return [];
		case "cluster": return [];
	}
}
function safeJoin(root, ...children) {
	if (children.some((child) => child.includes("\0") || isAbsolute(child))) return null;
	const rootAbsolute = resolve(root);
	const escaped = relative(rootAbsolute, resolve(rootAbsolute, ...children));
	if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) return null;
	return join(root, ...children);
}
function optionalPath(path) {
	return path ? [path] : [];
}
function slugify(s) {
	return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200) || "untitled";
}
/** Validate an `AgentSurfaces` map on disk — missing paths fail loud at `defineAgent` time instead of silently skipping self-improvement edits. */
function validateSurfaces(surfaces, repoRoot) {
	const issues = [];
	const dirSurfaces = [
		"systemPrompt",
		"tools",
		"personas",
		"knowledge"
	];
	const fileSurfaces = ["rubric"];
	const optionalDirSurfaces = [
		"scaffolding",
		"memory",
		"rag",
		"skills",
		"mcp",
		"hooks",
		"subagents",
		"workflows",
		"code"
	];
	const optionalFileSurfaces = [
		"outputSchema",
		"rolloutPolicy",
		"agentProfile"
	];
	for (const key of dirSurfaces) {
		const p = surfaces[key];
		if (!p) {
			issues.push({
				surface: key,
				path: "",
				reason: "missing"
			});
			continue;
		}
		const abs = isAbsolute(p) ? p : join(repoRoot, p);
		if (!existsSync(abs)) issues.push({
			surface: key,
			path: p,
			reason: "missing"
		});
		else if (!statSync(abs).isDirectory()) issues.push({
			surface: key,
			path: p,
			reason: "not-directory"
		});
	}
	for (const key of fileSurfaces) {
		const p = surfaces[key];
		if (!p) {
			issues.push({
				surface: key,
				path: "",
				reason: "missing"
			});
			continue;
		}
		const abs = isAbsolute(p) ? p : join(repoRoot, p);
		if (!existsSync(abs)) issues.push({
			surface: key,
			path: p,
			reason: "missing"
		});
		else if (!statSync(abs).isFile()) issues.push({
			surface: key,
			path: p,
			reason: "not-file"
		});
	}
	for (const key of [...optionalDirSurfaces, ...optionalFileSurfaces]) {
		const p = surfaces[key];
		if (p === void 0) continue;
		const abs = isAbsolute(p) ? p : join(repoRoot, p);
		if (!existsSync(abs)) {
			issues.push({
				surface: key,
				path: p,
				reason: "missing"
			});
			continue;
		}
		const expectedDirectory = optionalDirSurfaces.includes(key);
		if (expectedDirectory && !statSync(abs).isDirectory()) issues.push({
			surface: key,
			path: p,
			reason: "not-directory"
		});
		else if (!expectedDirectory && !statSync(abs).isFile()) issues.push({
			surface: key,
			path: p,
			reason: "not-file"
		});
	}
	return issues;
}
/** Format a list of surface validation issues into a human-readable error string. */
function renderSurfaceIssues(issues, repoRoot) {
	if (issues.length === 0) return "";
	const lines = issues.map((i) => `  - ${i.surface}: ${i.path ? `"${i.path}"` : "<not set>"} (${i.reason})`);
	return [
		`Agent surface validation failed against repoRoot=${repoRoot}:`,
		...lines,
		"",
		"Fix the manifest: every required surface must point at an existing",
		"directory (systemPrompt / tools / personas / knowledge) or file",
		"(rubric). Optional surfaces (scaffolding / memory / rag / outputSchema)",
		"may be omitted; the loop will reject findings targeting omitted",
		"surfaces rather than fabricating a path."
	].join("\n");
}
//#endregion
//#region src/agent/define-agent.ts
/**
* Stub for agents whose `runtime.act` is not yet wired to the substrate's
* eval path. Preserves the streaming contract (empty event stream + a
* rejected `output` promise that tells the caller exactly what to fix).
*
* Per-vertical manifests usually start with this stub and replace it with
* the agent's real streaming runtime (`runChatTurn` or equivalent) once
* the eval path consumes the manifest end-to-end.
*/
function unimplementedAgentRun(reason = "AgentRuntime.act is not yet wired for this manifest") {
	return {
		events: (async function* empty() {})(),
		output: Promise.reject(new Error(reason))
	};
}
/**
* Drain `act`'s `events` into an array AND await its `output`. Useful for
* eval / outcome-measurement code paths that don't care about live
* rendering. The events array is preserved so the substrate can inspect
* tool calls / readiness / questions retrospectively.
*
* IMPORTANT: chat-centric UX MUST NOT call this — it defeats streaming
* (no incremental render). Use `for await (const ev of invocation.events)`
* directly in the chat surface.
*/
async function collectAgentRun(invocation) {
	const events = [];
	for await (const ev of invocation.events) events.push(ev);
	return {
		events,
		output: await invocation.output
	};
}
/** Thrown when `defineAgent` finds a required surface missing on disk. */
var AgentManifestError = class extends Error {
	agentId;
	issues;
	constructor(message, agentId, issues = []) {
		super(message);
		this.agentId = agentId;
		this.issues = issues;
		this.name = "AgentManifestError";
	}
};
/**
* Construct a validated agent manifest. Throws `AgentManifestError`
* if any required surface is missing on disk.
*
* Generics: pass your persona / output types if you want narrowed
* `runtime.act` signatures:
*   `defineAgent<TaxPersona, TaxRunOutput>({ ... })`
*
* Most callers don't need the generics — the substrate operates on
* `unknown` payloads internally and the manifest's `score` /
* `runtime.act` see the typed shapes via TypeScript inference at
* the call site.
*/
function defineAgent(manifest) {
	if (!manifest.id || manifest.id.trim().length === 0) throw new AgentManifestError("defineAgent: `id` is required", manifest.id ?? "");
	if (!manifest.repoRoot || manifest.repoRoot.trim().length === 0) throw new AgentManifestError("defineAgent: `repoRoot` is required", manifest.id);
	const issues = validateSurfaces(manifest.surfaces, manifest.repoRoot);
	if (issues.length > 0) throw new AgentManifestError(renderSurfaceIssues(issues, manifest.repoRoot), manifest.id, issues);
	const total = manifest.rubric.dimensions.reduce((acc, d) => acc + d.weight, 0);
	if (manifest.rubric.dimensions.length > 0 && (total < .5 || total > 1.5)) throw new AgentManifestError(`defineAgent(${manifest.id}): rubric dimension weights sum to ${total.toFixed(3)} — should be ~1.0`, manifest.id);
	return manifest;
}
//#endregion
//#region src/agent/improvement-adapter.ts
/**
* Surface improvement proposer — resolves analyst findings into LLM-drafted
* candidate patches without changing the caller's repository.
*
* The proposer parses each finding's `subject` via
* `parseFindingSubject` (agent-eval), resolves it to a real file path
* via the agent's `AgentSurfaces`, reads the current content, and asks
* an LLM to draft a unified-diff patch given the finding + current
* content + per-kind editing-discipline rules.
*
* Fail-loud rules:
*   - Findings whose subject doesn't parse → counted in `errors`.
*   - Findings whose subject targets an undeclared surface → counted in
*     `errors` with the offending kind in the message.
*   - Findings whose target path doesn't exist AND the kind isn't a
*     create-new variant (`new-tool`, `knowledge.wiki`) → counted in
*     `errors` with the resolved path in the message.
*   - LLM drafts that fail JSON-schema validation → counted in
*     `errors` with the schema issue.
*
* No silent skips. Every dropped finding has a recorded reason the
* loop's report surfaces.
*/
const DEFAULT_CREATE_KINDS = [
	"knowledge.wiki",
	"knowledge.claim",
	"knowledge.raw",
	"new-tool"
];
/** Resolve each finding to a real surface and draft a detached patch candidate. */
function createSurfaceImprovementProposer(opts) {
	const allowCreate = opts.allowCreateForKinds ?? DEFAULT_CREATE_KINDS;
	return { async proposeFromFindings(findings) {
		const edits = [];
		const errors = [];
		let skipped = 0;
		for (const f of findings) {
			const subject = parseFindingSubject(f.subject);
			if (subject === null) {
				if (f.subject !== void 0) errors.push({
					findingId: f.finding_id,
					subject: f.subject,
					message: "subject does not parse against the finding-subject grammar"
				});
				else skipped += 1;
				continue;
			}
			if (subject.kind === "cluster") {
				skipped += 1;
				continue;
			}
			if (subject.kind.startsWith("knowledge.")) {
				skipped += 1;
				continue;
			}
			const target = resolveSubjectPath(subject, opts.surfaces, opts.repoRoot);
			if (target === null) {
				errors.push({
					findingId: f.finding_id,
					subject: f.subject ?? "",
					message: `subject kind "${subject.kind}" targets an undeclared surface; declare it in AgentSurfaces or stop emitting this subject`
				});
				continue;
			}
			if (target.intent === "create-new" && !allowCreate.includes(subject.kind)) {
				errors.push({
					findingId: f.finding_id,
					subject: f.subject ?? "",
					message: `target ${target.repoRelativePath} does not exist; the kind "${subject.kind}" requires an existing target (analyst named a section that isn't in the codebase)`
				});
				continue;
			}
			const currentContent = target.exists ? readFileSync(target.absolutePath, "utf-8") : "";
			let draft;
			try {
				draft = await opts.draftPatch({
					finding: f,
					subject,
					target,
					currentContent
				});
			} catch (err) {
				errors.push({
					findingId: f.finding_id,
					subject: f.subject ?? "",
					message: `draftPatch threw: ${err instanceof Error ? err.message : String(err)}`
				});
				continue;
			}
			if (draft.patch.trim().length === 0) {
				skipped += 1;
				continue;
			}
			edits.push({
				id: `imp-${f.finding_id}`,
				sourceFindingId: f.finding_id,
				subject,
				target,
				baseSha256: sha256(currentContent),
				patch: draft.patch,
				summary: draft.summary,
				rationale: draft.rationale,
				confidence: f.confidence,
				severity: f.severity
			});
		}
		return {
			edits,
			skipped,
			errors
		};
	} };
}
function sha256(s) {
	return createHash("sha256").update(s, "utf-8").digest("hex");
}
//#endregion
//#region src/agent/sandbox-act.ts
/**
* Build an `AgentRuntime.act` implementation backed by a single prod-profile
* sandbox run. The returned function honours the `act` contract: it returns
* synchronously with a live `events` iterator and an `output` promise that
* resolves only after the iterator drains.
*/
function createSandboxAct(options) {
	assertProfileMaterialization({
		contract: sandboxActProfileMaterialization,
		changedAxes: options.requiredProfileAxes ?? [],
		context: "createSandboxAct"
	});
	const mapEvent = options.mapEvent ?? mapSandboxEvent;
	return (persona, ctx) => {
		const profile = applyComposeOverrides(options.baseProfile, options.compose?.(persona));
		const agentRunName = options.name ?? profile.name ?? "agent";
		const message = options.buildPrompt(persona);
		const signal = ctx.signal ?? new AbortController().signal;
		const raw = [];
		let settle;
		let fail;
		const output = new Promise((resolve, reject) => {
			settle = resolve;
			fail = reject;
		});
		output.catch(() => {});
		const spec = {
			profile,
			taskToPrompt: () => message,
			name: agentRunName,
			...options.sandboxOverrides ? { sandboxOverrides: options.sandboxOverrides } : {}
		};
		async function* events() {
			try {
				const box = await createSandboxForSpec(options.sandboxClient, spec, signal);
				for await (const event of box.streamPrompt(message, { signal })) {
					raw.push(event);
					const mapped = mapEvent(event, { agentRunName });
					if (mapped) yield mapped;
				}
				settle(options.output.parse(raw));
			} catch (err) {
				fail(err);
				throw err;
			}
		}
		return {
			events: events(),
			output
		};
	};
}
/** Overlay the per-persona overrides onto the base profile. Each slot merges over the base; an
*  absent override leaves the base profile untouched. */
function applyComposeOverrides(base, overrides) {
	if (!overrides) return base;
	const prompt = overrides.systemPrompt ? {
		...base.prompt,
		systemPrompt: overrides.systemPrompt
	} : base.prompt;
	const mergedTools = overrides.tools ? {
		...base.tools ?? {},
		...overrides.tools
	} : base.tools;
	const mergedMcp = overrides.mcpConnections ? {
		...base.mcp ?? {},
		...overrides.mcpConnections
	} : base.mcp;
	const baseFiles = base.resources?.files ?? [];
	const mergedFiles = overrides.extraFiles?.length ? [...baseFiles, ...overrides.extraFiles] : [...baseFiles];
	return {
		...base,
		name: overrides.name ?? base.name,
		prompt,
		...mergedTools ? { tools: mergedTools } : {},
		...mergedMcp ? { mcp: mergedMcp } : {},
		resources: {
			...base.resources,
			files: mergedFiles
		}
	};
}
//#endregion
export { AGENT_PROFILE_MATERIALIZATION_AXES, AgentManifestError, assertProfileMaterialization, collectAgentRun, controlProfileMaterialization, createSandboxAct, createSurfaceImprovementProposer, defineAgent, defineProfileMaterializationContract, fullProfileMaterialization, profileMaterializationAxes, promptControlProfileMaterialization, promptModelProfileMaterialization, promptOnlyProfileMaterialization, promptResourceProfileMaterialization, renderProfileMaterializationIssues, renderSurfaceIssues, resolveSubjectPath, sandboxActProfileMaterialization, unimplementedAgentRun, validateProfileMaterialization, validateSurfaces, worktreeCliProfileMaterialization };

//# sourceMappingURL=agent.js.map