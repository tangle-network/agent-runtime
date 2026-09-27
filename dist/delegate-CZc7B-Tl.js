import { i as ConfigError } from "./errors-DodWX-cb.js";
import { r as supervise } from "./supervise-DBQdrp7H.js";
import { agentProfileSchema } from "@tangle-network/agent-interface";
import { computeFindingId, makeFinding } from "@tangle-network/agent-eval";
//#region src/runtime/supervise/authoring.ts
/**
*
* The supervisor's intelligence is AUTHORING the agents it spawns — not pressing buttons.
*
* Every agent here is three things: instructions (system prompt), tools, and a model — its
* `AgentProfile`. The supervisor's job is to WRITE those profiles: read the task, decompose it,
* and for each sub-task author a tailored worker recipe. `supervisorInstructions` is the how-to the
* supervisor reads; canonical Runtime executors materialize the resulting profile.
*
* The skill is the single OPTIMIZABLE surface: edit it → the supervisor designs better agents.
* That is the self-improvement lever (the prompt/skill lever), not the execution plumbing.
*
* @experimental
*/
/** Narrow an untyped `spawn_worker` profile argument to an `AuthoredProfile`, or null if the
*  supervisor failed to author one (empty/placeholder profile — a skill violation worth catching). */
function asAuthoredProfile(raw) {
	const parsed = agentProfileSchema.safeParse(raw);
	if (!parsed.success) return null;
	const systemPrompt = parsed.data.prompt?.systemPrompt;
	if (typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) return null;
	return {
		...parsed.data,
		name: typeof parsed.data.name === "string" && parsed.data.name.length > 0 ? parsed.data.name : "worker",
		prompt: {
			...parsed.data.prompt,
			systemPrompt
		}
	};
}
/** The supervisor skill: an explicit profile-authoring instruction, never an implicit Runtime
* policy. Editing this text changes how a profile designs the descendants it spawns. */
function supervisorInstructions(opts) {
	return [
		"Your delegation craft is AUTHORING: a spawned worker is exactly as good as the profile you write.",
		"",
		"For the task you are given:",
		"1. DECOMPOSE it into the smallest set of sub-tasks a single focused worker can each deliver.",
		"2. For EACH sub-task, AUTHOR a worker by calling spawn_worker with a COMPLETE `profile`:",
		"   • name and description: who this specialist is and why it exists.",
		"   • prompt.systemPrompt: rich instructions for THIS sub-task — exact output, process, evidence, and what \"done\" means.",
		"   • model.default, model.reasoningEffort, and harness: choose the execution system deliberately when the task benefits from it.",
		"   • tools, mcp, resources.skills/files/instructions, hooks, subagents, permissions, and modes: grant or attach every capability the worker needs; omit an axis only when it is intentionally unnecessary.",
		"   • tools.agent_runtime_coordination_spawn_worker: true ONLY when this child should author and drive descendants. Add only the other agent_runtime_coordination_<verb> tools it will call, such as await_event or steer_agent.",
		"   • A child with spawn_worker MUST carry this complete profile-authoring instruction as an immutable resources.skills entry with resources.failOnError: true, so it can author its own descendants from the same contract.",
		"   • metadata may describe the work, but it never grants recursion or selects a Runtime execution path.",
		"   NEVER spawn a worker with an empty profile. The quality of the worker IS the quality of the profile you write.",
		"3. await_event (kinds:['settled']) to collect each worker. Its result says valid:true only if the deployable check passed.",
		"4. If a worker did NOT deliver, AUTHOR A NEW profile whose prompt.systemPrompt names the SPECIFIC failure and how to fix it — never just retry the same profile.",
		"5. read_journal to re-read YOUR OWN record before you decide the next move: every spawn you made, every settle, every question and answer, every steer, every analyst finding — oldest first, this node only, including what you did before a restart. Use it to see what you already tried instead of trying it again. It is paged: pass the returned nextRow as the next call's sinceRow, narrow with kinds, and raise limit/maxBytes only as far as you will actually read. A truncated:true page means a bound cut it short — keep paging before you conclude you have read everything.",
		"6. AUTHOR YOUR OWN LENS when the questions you can already ask of a settled trace do not cover the failure you are chasing: define_analyst takes an id, a description, an area, the question in your own words, the instructions for answering it with trace evidence, and the smallest toolGroup that can answer it (model is the seat it runs on; omit it for the run default). It is DATA, never code. Then run_analyst it on any settled worker like a lens the run shipped with, and read the finding. list_analysts shows what you have. Define a lens when you need a different question asked — not a second copy of a question already on the menu.",
		"7. EVERY refusal you get back carries a `reason` naming the exact unmet condition. Read it and change that condition — a spawn refused for budget-exhausted needs a smaller budget or the refund of a settled worker, an invalid-profile needs the named field fixed, a submit_result refused because the check THREW is a broken check to report, not a result to resubmit. Never repeat a call that was refused without changing what it was refused for.",
		"8. ask_parent ONLY when you genuinely cannot decide, and then READ ITS OUTCOME. \"queued-for-parent\" means an inbox above you now holds the question. \"no-parent\" means no inbox above you is configured to receive it: the question is still on the run record for anyone watching, but nothing will route an answer back to you, so do not block. Decide it with answer_question, or answer_question with deferReason to record that it stays open, and carry on — a blocking question left undecided also refuses your stop.",
		"9. Stop (reply with no tool call) once the work is delivered.",
		...opts?.goal ? ["", `The goal: ${opts.goal}`] : []
	].join("\n");
}
/** Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt. */
const defaultProfileRichnessThresholds = {
	minSystemPromptChars: 600,
	minSystemPromptLines: 6
};
/** Read the system prompt from any authored shape: canonical `prompt.systemPrompt`, the sandbox
*  `prompt.system` convention, or a bare-string `prompt`. */
function resolveSystemPrompt(profile) {
	const pr = profile.prompt;
	if (typeof pr === "string") return pr;
	if (pr && typeof pr === "object") {
		const o = pr;
		if (typeof o.systemPrompt === "string") return o.systemPrompt;
		if (typeof o.system === "string") return o.system;
	}
	return "";
}
/** OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task
*  context (`needsMcp`) lets a domain say "this work needs a data/tool MCP" so a missing MCP counts. */
function assessAuthoredProfile(profile, opts) {
	const th = {
		...defaultProfileRichnessThresholds,
		...opts?.thresholds ?? {}
	};
	const systemPrompt = resolveSystemPrompt(profile);
	const trimmed = systemPrompt.trim();
	const systemPromptChars = trimmed.length;
	const systemPromptLines = trimmed ? trimmed.split("\n").filter((l) => l.trim().length > 0).length : 0;
	const sentenceCount = trimmed ? (trimmed.match(/[.!?](\s|$)/g) ?? []).length || (trimmed ? 1 : 0) : 0;
	const hasDescription = typeof profile.description === "string" && profile.description.trim().length > 0;
	const tools = profile.tools;
	const hasTools = !!tools && Object.keys(tools).length > 0;
	const skills = profile.resources?.skills;
	const hasSkills = Array.isArray(skills) && skills.length > 0;
	const mcp = profile.mcp;
	const hasMcp = !!mcp && Object.keys(mcp).length > 0;
	const subagents = profile.subagents;
	const hasSubagents = !!subagents && Object.keys(subagents).length > 0;
	const reasons = [];
	const promptThin = systemPromptChars < th.minSystemPromptChars || systemPromptLines < th.minSystemPromptLines;
	if (promptThin) reasons.push(`system prompt is thin (${systemPromptChars} chars, ${systemPromptLines} lines; need ≥${th.minSystemPromptChars} chars and ≥${th.minSystemPromptLines} lines)`);
	if (!hasTools) reasons.push("no tools granted (a worker can only act through the tools you grant it)");
	if (!hasSkills) reasons.push("no skills attached (no reusable how-to notes injected)");
	if (opts?.needsMcp && !hasMcp) reasons.push("no MCP server, but the task needs data/tool access");
	const signals = [
		!promptThin,
		hasTools,
		hasSkills,
		hasDescription,
		opts?.needsMcp ? hasMcp : true
	];
	const richness = signals.filter(Boolean).length / signals.length;
	const thin = promptThin || !hasTools && !hasSkills && !hasMcp;
	return {
		name: profile.name ?? "worker",
		systemPrompt,
		systemPromptChars,
		systemPromptLines,
		sentenceCount,
		hasDescription,
		hasTools,
		hasSkills,
		hasMcp,
		hasSubagents,
		richness,
		thin,
		reasons
	};
}
/** Turn a {@link ProfileRichness} verdict into a bus-routable `AnalystFinding` (area `profile-quality`).
*  Severity scales with thinness; the recommended action names the MISSING lever so the supervisor can
*  re-author. `subject` = the worker name so per-worker findings diff cleanly across re-authors. */
function profileRichnessFinding(richness, opts) {
	const analyst_id = opts?.analystId ?? "profile-richness";
	const subject = richness.name;
	const claim = richness.thin ? `Worker "${richness.name}" was authored as a THIN profile: ${richness.reasons.join("; ")}.` : `Worker "${richness.name}" was authored as a rich profile (richness ${(richness.richness * 100).toFixed(0)}%).`;
	return makeFinding({
		analyst_id,
		severity: richness.thin ? richness.richness < .25 ? "high" : "medium" : "info",
		area: "profile-quality",
		claim,
		subject,
		confidence: .9,
		evidence_refs: [{
			kind: "metric",
			uri: `profile:${subject}`,
			excerpt: `chars=${richness.systemPromptChars} lines=${richness.systemPromptLines} tools=${richness.hasTools} skills=${richness.hasSkills} mcp=${richness.hasMcp} richness=${richness.richness.toFixed(2)}`
		}],
		...richness.thin ? { recommended_action: `Re-author "${richness.name}" with: ${richness.reasons.join("; ")}.` } : {},
		id_basis: computeFindingId({
			analyst_id,
			area: "profile-quality",
			subject,
			claim: `richness:${richness.thin ? "thin" : "rich"}`
		})
	});
}
//#endregion
//#region src/runtime/supervise/delegate.ts
/**
*
* `delegate` — the one generic delegation verb. You hand it an INTENT (what you want done) and it
* hands that intent to a default AUTHORING supervisor: a router-brained supervisor whose standing
* instruction is `supervisorInstructions()` (the authoring-agent-profiles skill). The supervisor
* DECOMPOSES the intent and AUTHORS the worker profile it needs per sub-task — there is NO hardcoded
* coder/researcher profile here. That is the whole point: `delegate('fix the failing test', …)` and
* `delegate('research X and cite sources', …)` route through the SAME front door; the supervisor
* writes a code-shaped or research-shaped worker on its own.
*
* It is a thin wrapper over `supervise()` — the one front door — so the conserved-budget pool, the
* completion oracle (`deliverable`), the coordination toolbox, and equal-compute accounting all come
* for free; nothing is hand-rolled. The result is `supervise()`'s `SupervisedResult` returned
* UNCHANGED, so its `spentTotal` (`{ iterations, tokens, usd, ms }`) rides straight back to the
* caller on BOTH paths — a `winner` carries the delivered worker's spend, a `no-winner` carries the
* spend incurred before it failed. That cost channel means a `delegate()` caller always learns what
* the delegation actually spent.
*
* @experimental
*/
/** The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`.
*  A modest token ceiling + a small iteration ceiling — generous enough for a few-worker decompose,
*  bounded enough that an unsupervised intent cannot run away. Callers override via `opts.budget`. */
const defaultDelegateBudget = {
	maxIterations: 50,
	maxTokens: 2e5
};
/**
* Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged.
*
* The supervisor authors + spawns whatever worker the intent needs over the conserved-budget pool;
* `result.spentTotal` reports what the whole delegation actually cost. A `winner` result carries the
* authored worker's delivered output; a `no-winner` result names why (never a fabricated success).
*/
async function delegate(intent, opts) {
	if (typeof intent !== "string" || intent.trim().length === 0) throw new ConfigError("delegate: `intent` must be a non-empty string");
	return supervise(opts.supervisorProfile, intent, {
		budget: opts.budget ?? defaultDelegateBudget,
		...opts.backend ? { backend: opts.backend } : {},
		...opts.deliverable ? { deliverable: opts.deliverable } : {},
		router: opts.router,
		...opts.allowedModels ? { allowedModels: opts.allowedModels } : {},
		...opts.runId ? { runId: opts.runId } : {}
	});
}
//#endregion
export { defaultProfileRichnessThresholds as a, assessAuthoredProfile as i, delegate as n, profileRichnessFinding as o, asAuthoredProfile as r, supervisorInstructions as s, defaultDelegateBudget as t };

//# sourceMappingURL=delegate-CZc7B-Tl.js.map