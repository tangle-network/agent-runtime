import { i as ConfigError } from "./errors-DodWX-cb.js";
import { t as assertExecutableAgentProfile } from "./model-policy-BbSCSak0.js";
import { n as UI_LENSES, t as UI_FINDING_SEVERITIES } from "./substrate-B0TYNrXn.js";
import { t as coderTaskToPrompt } from "./coder-yhVWbdWc.js";
import { agentProfileSchema } from "@tangle-network/agent-interface";
import { promises } from "node:fs";
import path from "node:path";
//#region src/profiles/ui-auditor/slugify.ts
/**
*
* Shared slug helper used by both the in-process auditor client (for
* screenshot filenames) and the issue writer (for issue Markdown
* filenames). Lowercases, normalizes, strips non-alphanumeric, trims
* dashes, caps at 80 chars. Throws when the result is empty so callers
* never silently write to a name-less filename.
*
* @experimental
*/
/** @experimental */
function slugify(value, fieldName) {
	const slug = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
	if (slug.length === 0) throw new Error(`ui-auditor: ${fieldName} slugified to empty string. Provide a non-empty value (got ${JSON.stringify(value)}).`);
	return slug;
}
//#endregion
//#region src/audit/issue-writer.ts
/**
*
* UI-audit issue writer — pure I/O. Takes a workspace dir + `UiFinding[]`
* and emits:
*   - `<workspace>/issues/NNN--<lens>--<slug>.md` — one self-contained
*     GitHub-issue-ready Markdown per finding, with embedded screenshot
*     references.
*   - `<workspace>/registry.json` — finding index for dedup and audit
*     resume across iterations.
*   - `<workspace>/index.md` — human-readable rollup (severity / lens /
*     route counts plus a sorted finding list).
*
* The writer is deterministic, idempotent for `appendFindings()`, and
* never invokes an LLM. It assigns the next monotonic id to a finding the
* caller did not pre-id.
*
* @experimental
*/
const SEVERITY_ORDER = {
	critical: 0,
	high: 1,
	med: 2,
	low: 3
};
function assertValidWorkspaceDir(dir) {
	if (typeof dir !== "string" || dir.length === 0) throw new Error(`audit-writer: workspaceDir must be a non-empty string (got ${JSON.stringify(dir)})`);
	if (!path.isAbsolute(dir)) throw new Error(`audit-writer: workspaceDir must be an absolute path (got ${JSON.stringify(dir)})`);
	if (dir.split(path.sep).includes("..")) throw new Error(`audit-writer: workspaceDir must not contain '..' segments (got ${JSON.stringify(dir)})`);
}
/** Create the `issues/`, `screenshots/`, and `registry.json` scaffold in a new audit workspace. @experimental */
async function initAuditWorkspace(workspaceDir) {
	assertValidWorkspaceDir(workspaceDir);
	await promises.mkdir(path.join(workspaceDir, "issues"), { recursive: true });
	await promises.mkdir(path.join(workspaceDir, "screenshots"), { recursive: true });
	const regPath = path.join(workspaceDir, "registry.json");
	try {
		await promises.access(regPath);
	} catch {
		await promises.writeFile(regPath, JSON.stringify({
			schemaVersion: 1,
			findings: [],
			routes: {}
		}, null, 2));
	}
}
/** Read and validate the `registry.json` from an audit workspace. @experimental */
async function readAuditRegistry(workspaceDir) {
	assertValidWorkspaceDir(workspaceDir);
	const regPath = path.join(workspaceDir, "registry.json");
	const text = await promises.readFile(regPath, "utf8");
	const parsed = JSON.parse(text);
	if (!parsed || typeof parsed !== "object") throw new Error(`audit-writer: registry.json at ${regPath} is not a JSON object`);
	const reg = parsed;
	if (reg.schemaVersion !== 1 || !Array.isArray(reg.findings) || typeof reg.routes !== "object") throw new Error(`audit-writer: registry.json at ${regPath} has an unrecognized shape`);
	return reg;
}
async function writeAuditRegistry(workspaceDir, reg) {
	const regPath = path.join(workspaceDir, "registry.json");
	const tmpPath = `${regPath}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await promises.writeFile(tmpPath, JSON.stringify(reg, null, 2));
	await promises.rename(tmpPath, regPath);
}
const workspaceLocks = /* @__PURE__ */ new Map();
async function withWorkspaceLock(workspaceDir, fn) {
	const key = path.resolve(workspaceDir);
	const prev = workspaceLocks.get(key) ?? Promise.resolve();
	let signalDone;
	const done = new Promise((resolve) => {
		signalDone = resolve;
	});
	workspaceLocks.set(key, done);
	try {
		await prev;
		return await fn();
	} finally {
		signalDone();
		if (workspaceLocks.get(key) === done) workspaceLocks.delete(key);
	}
}
function assertFindingShape(f, index) {
	const where = `audit-writer: findings[${index}]`;
	if (!UI_LENSES.includes(f.lens)) throw new Error(`${where}: invalid lens ${JSON.stringify(f.lens)}; one of ${UI_LENSES.join("|")}`);
	if (!UI_FINDING_SEVERITIES.includes(f.severity)) throw new Error(`${where}: invalid severity ${JSON.stringify(f.severity)}; one of ${UI_FINDING_SEVERITIES.join("|")}`);
	for (const field of [
		"title",
		"route",
		"observation",
		"impact",
		"suggestedFix"
	]) {
		const v = f[field];
		if (typeof v !== "string" || v.trim().length === 0) throw new Error(`${where}: ${field} must be a non-empty string`);
	}
	if (!Array.isArray(f.screenshots) || f.screenshots.length === 0) throw new Error(`${where}: screenshots must be a non-empty array`);
	for (let i = 0; i < f.screenshots.length; i += 1) {
		const s = f.screenshots[i];
		if (!s || typeof s.path !== "string" || s.path.length === 0) throw new Error(`${where}.screenshots[${i}].path must be a non-empty string`);
		if (s.path.split(/[/\\]/).includes("..")) throw new Error(`${where}.screenshots[${i}].path must not contain '..' segments`);
	}
}
function nextFindingId(reg) {
	let max = 0;
	for (const f of reg.findings) if (typeof f.id === "number" && f.id > max) max = f.id;
	return max + 1;
}
function slugifyTitle(title) {
	return slugify(title, "title");
}
function renderFinding(finding) {
	if (!finding.id) throw new Error("audit-writer: cannot render a finding without an assigned id");
	if (finding.screenshots.length === 0) throw new Error(`audit-writer: finding #${finding.id} has no screenshots`);
	const id = finding.id;
	const metaLines = [`> **Issue #${String(id).padStart(3, "0")}** · **Severity:** ${finding.severity} · **Lens:** ${finding.lens}`, `> **Route:** \`${finding.route}\`${finding.url ? ` · **URL:** ${finding.url}` : ""}`];
	if (finding.viewport) metaLines.push(`> **Viewport:** ${finding.viewport}`);
	if (finding.selector) metaLines.push(`> **Selector:** \`${finding.selector}\``);
	if (finding.tags && finding.tags.length > 0) metaLines.push(`> **Tags:** ${finding.tags.map((t) => `\`${t}\``).join(", ")}`);
	if (finding.similarTo && finding.similarTo.length > 0) metaLines.push(`> **Possible duplicates:** ${finding.similarTo.map((n) => `#${String(n).padStart(3, "0")}`).join(", ")}`);
	metaLines.push(`> _Generated: ${finding.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()}_`);
	const reproSteps = finding.reproSteps ?? `1. Open \`${finding.route}\`${finding.url ? ` (${finding.url})` : ""}\n2. Observe the area shown in the screenshot${finding.selector ? ` (selector: \`${finding.selector}\`)` : ""}.`;
	const evidence = finding.screenshots.map((s) => `![${path.basename(s.path)}](../${s.path})`).join("\n\n");
	return [
		`# [UI] ${finding.title}`,
		"",
		metaLines.join("\n"),
		"",
		"## Observation",
		finding.observation.trim(),
		"",
		"## Why it matters",
		finding.impact.trim(),
		"",
		"## Steps to reproduce",
		reproSteps,
		"",
		"## Suggested fix",
		finding.suggestedFix.trim(),
		"",
		"## Evidence",
		evidence,
		"",
		"---",
		`<sub>Generated by agent-runtime/ui-auditor · lens=\`${finding.lens}\` · severity=\`${finding.severity}\`</sub>`,
		""
	].join("\n");
}
/**
* Append findings to a workspace, writing one Markdown file per finding
* and updating registry.json. Assigns monotonically increasing ids to
* findings that arrived without one.
*
* Findings already carrying an id that collides with the registry are
* rejected — callers must either freshly mint findings (id undefined) or
* use a separate update path. This protects against accidental overwrite.
*
* @experimental
*/
async function appendFindings(workspaceDir, findings) {
	assertValidWorkspaceDir(workspaceDir);
	for (let i = 0; i < findings.length; i += 1) {
		const f = findings[i];
		if (!f) throw new Error(`audit-writer: findings[${i}] is undefined`);
		assertFindingShape(f, i);
	}
	return withWorkspaceLock(workspaceDir, async () => {
		await initAuditWorkspace(workspaceDir);
		const reg = await readAuditRegistry(workspaceDir);
		const usedIds = /* @__PURE__ */ new Set();
		for (const f of reg.findings) if (typeof f.id === "number") usedIds.add(f.id);
		const written = [];
		const files = [];
		let nextId = nextFindingId(reg);
		for (const incoming of findings) {
			let id = incoming.id;
			if (id !== void 0) {
				if (usedIds.has(id)) throw new Error(`audit-writer: incoming finding id ${id} (title=${JSON.stringify(incoming.title)}) collides with an existing registry entry`);
			} else {
				id = nextId;
				while (usedIds.has(id)) id += 1;
				nextId = id + 1;
			}
			usedIds.add(id);
			const createdAt = incoming.createdAt ?? (/* @__PURE__ */ new Date()).toISOString();
			const persisted = {
				...incoming,
				id,
				createdAt
			};
			const slug = slugifyTitle(persisted.title);
			const fileName = `${String(id).padStart(3, "0")}--${persisted.lens}--${slug}.md`;
			const filePathAbs = path.join(workspaceDir, "issues", fileName);
			const filePathRel = `issues/${fileName}`;
			await promises.writeFile(filePathAbs, renderFinding(persisted));
			reg.findings.push(persisted);
			written.push(persisted);
			files.push(filePathRel);
		}
		await writeAuditRegistry(workspaceDir, reg);
		return {
			written,
			files
		};
	});
}
/**
* Record screenshots taken for a route in the registry, without filing a
* finding. Useful when the auditor wants to remember which captures
* exist for resume / dedup purposes.
*
* @experimental
*/
async function registerCaptures(workspaceDir, options) {
	assertValidWorkspaceDir(workspaceDir);
	if (typeof options.route !== "string" || options.route.trim().length === 0) throw new Error("audit-writer: registerCaptures: route must be a non-empty string");
	return withWorkspaceLock(workspaceDir, async () => {
		await initAuditWorkspace(workspaceDir);
		const reg = await readAuditRegistry(workspaceDir);
		const slot = reg.routes[options.route] ?? { captures: [] };
		if (options.url) slot.url = options.url;
		slot.captures = [...slot.captures, ...options.captures];
		reg.routes[options.route] = slot;
		await writeAuditRegistry(workspaceDir, reg);
	});
}
/** Compute finding counts by severity, lens, and route from an `AuditRegistry`. @experimental */
function summarizeRegistry(reg) {
	const bySeverity = {
		critical: 0,
		high: 0,
		med: 0,
		low: 0
	};
	const byLens = {};
	const byRoute = {};
	for (const f of reg.findings) {
		bySeverity[f.severity] += 1;
		byLens[f.lens] = (byLens[f.lens] ?? 0) + 1;
		byRoute[f.route] = (byRoute[f.route] ?? 0) + 1;
	}
	return {
		total: reg.findings.length,
		bySeverity,
		byLens,
		byRoute
	};
}
/**
* Regenerate `<workspace>/index.md` from registry.json.
*
* @experimental
*/
async function writeAuditIndex(workspaceDir) {
	assertValidWorkspaceDir(workspaceDir);
	const reg = await readAuditRegistry(workspaceDir);
	const summary = summarizeRegistry(reg);
	const sorted = [...reg.findings].sort((a, b) => {
		const sa = SEVERITY_ORDER[a.severity];
		const sb = SEVERITY_ORDER[b.severity];
		if (sa !== sb) return sa - sb;
		return (a.id ?? 0) - (b.id ?? 0);
	});
	const lines = [];
	lines.push("# UI audit index", "");
	lines.push(`_Generated: ${(/* @__PURE__ */ new Date()).toISOString()}_`, "");
	lines.push(`**Total findings:** ${summary.total}`, "");
	lines.push("## By severity");
	for (const s of [
		"critical",
		"high",
		"med",
		"low"
	]) {
		const n = summary.bySeverity[s] ?? 0;
		if (n > 0) lines.push(`- **${s}** — ${n}`);
	}
	lines.push("", "## By lens");
	const lensEntries = Object.entries(summary.byLens).map(([k, v]) => [k, v ?? 0]);
	for (const [lens, n] of lensEntries.sort((a, b) => b[1] - a[1])) lines.push(`- **${lens}** — ${n}`);
	lines.push("", "## By route");
	const routeEntries = Object.entries(summary.byRoute).map(([k, v]) => [k, v ?? 0]);
	for (const [route, n] of routeEntries.sort((a, b) => b[1] - a[1])) lines.push(`- \`${route}\` — ${n}`);
	lines.push("", "## Findings", "");
	for (const f of sorted) {
		if (typeof f.id !== "number") continue;
		const num = String(f.id).padStart(3, "0");
		const slug = slugifyTitle(f.title);
		const file = `issues/${num}--${f.lens}--${slug}.md`;
		lines.push(`- [#${num} \`${f.severity}\` \`${f.lens}\` \`${f.route}\` — ${f.title}](${file})`);
	}
	lines.push("");
	const out = path.join(workspaceDir, "index.md");
	const body = lines.join("\n");
	await promises.writeFile(out, body);
	return out;
}
//#endregion
//#region src/profiles/researcher.ts
/**
* Opinionated preset for source-grounded research
* tasks. The agent is told to:
*   - bound its work to a single `knowledgeNamespace`
*   - emit `items[]` carrying provenance + confidence
*   - emit `citations[]` linking quotes back to source urls
*   - emit `proposedWrites[]` — never call materialize itself
*   - describe `gaps` it could not answer
*
* The profile is stateless and agent-agnostic. The caller supplies the exact execution profile;
* this preset adds only the researcher prompt, tools, parser, and validator.
*
* Propose-don't-apply: the profile NEVER writes to the knowledge base.
* It produces `proposedWrites: KnowledgeUpdate[]` in the output. The
* caller (gtm-agent, journey-eval, user) decides whether to feed those
* updates through `applyKnowledgeWriteBlocks` / a KbStore put.
*
* Namespace isolation: every `KnowledgeItem` + `KnowledgeUpdate` in the
* output carries `namespace`. The validator hard-fails when any item
* touches a namespace other than `task.knowledgeNamespace`.
*
* @experimental
*/
const DEFAULT_CITATION_DENSITY_MIN = .7;
/** Build a source-grounded researcher profile with output parsing and validation. @experimental */
function researcherProfile(options) {
	const base = agentProfileSchema.parse(options.profile);
	assertExecutableAgentProfile(base, "researcherProfile");
	const name = options.name ?? base.name;
	const systemPrompt = options.systemPrompt ?? RESEARCHER_SYSTEM_PROMPT;
	const citationDensityMin = options.citationDensityMin ?? DEFAULT_CITATION_DENSITY_MIN;
	const profile = {
		...base,
		name,
		description: base.description ?? "Source-grounded research agent. Propose-don't-apply.",
		prompt: {
			...base.prompt,
			systemPrompt
		},
		tools: {
			web_search: true,
			fs: true,
			shell: true,
			...base.tools
		},
		metadata: {
			...base.metadata,
			specialty: "researcher"
		}
	};
	return {
		profile,
		taskToPrompt: formatResearcherPrompt,
		output: { parse: parseResearcherEvents },
		validator: options.task ? createResearcherValidator(options.task, { citationDensityMin }) : createResearcherValidator({
			question: "",
			knowledgeNamespace: ""
		}, {
			citationDensityMin,
			namespaceCheck: false
		}),
		agentRunSpec: {
			name,
			profile,
			taskToPrompt: formatResearcherPrompt
		}
	};
}
/**
* Build a fanout topology over multiple harnesses. The kernel round-robins
* `agentRuns` across the N parallel iterations and the `FanoutVote` driver
* picks the highest-scoring valid output.
*
* @experimental
*/
function multiHarnessResearcherFanout(options) {
	if (options.profiles.length === 0) throw new ConfigError("multiHarnessResearcherFanout: at least one exact profile is required");
	const agentRuns = options.profiles.map((profile) => {
		const { agentRunSpec } = researcherProfile({ profile });
		return agentRunSpec;
	});
	const { output, validator } = researcherProfile({
		profile: options.profiles[0],
		citationDensityMin: options.citationDensityMin,
		task: options.task
	});
	return {
		agentRuns,
		output,
		validator,
		driver: {
			name: "researcher-fanout",
			async plan(task, history) {
				return history.length === 0 ? Array.from({ length: agentRuns.length }, () => task) : [];
			},
			decide() {
				return "done";
			},
			describePlan() {
				return { kind: "fanout" };
			}
		}
	};
}
/**
* Build a validator that closes over a specific `ResearchTask`'s constraints.
*
* Checks in order:
*   1. Items must be non-empty.
*   2. Every item carries `evidence.length >= 1`.
*   3. Every item + proposedWrite is scoped to `task.knowledgeNamespace`
*      (hard-fail on any namespace mismatch — defence in depth for the
*      multi-tenant invariant).
*   4. Citation density (citations with quote / items) >= floor.
*
* Aggregate score:
*   0.4 · citation_density
* + 0.2 · source_diversity (distinct sources / max(items, 1))
* + 0.2 · recency_match (mean fraction within `recencyWindow`)
* + 0.2 · (1 − gaps/maxGaps), maxGaps = max(items, 1)
*
* @experimental
*/
function createResearcherValidator(task, config = {}) {
	const citationDensityMin = config.citationDensityMin ?? DEFAULT_CITATION_DENSITY_MIN;
	const namespaceCheck = config.namespaceCheck ?? true;
	return { async validate(output) {
		const notes = [];
		const scores = {};
		let pass = true;
		if (!Array.isArray(output.items) || output.items.length === 0) {
			pass = false;
			notes.push("no items");
			scores.items = 0;
		} else scores.items = 1;
		const missingEvidence = (output.items ?? []).filter((item) => !Array.isArray(item.evidence) || item.evidence.length === 0);
		if (missingEvidence.length > 0) {
			pass = false;
			notes.push(`${missingEvidence.length} item(s) without evidence`);
			scores.provenance = 0;
		} else scores.provenance = 1;
		if (namespaceCheck) {
			const foreignItems = (output.items ?? []).filter((item) => item.namespace !== task.knowledgeNamespace);
			const foreignWrites = (output.proposedWrites ?? []).filter((write) => write.namespace !== task.knowledgeNamespace);
			if (foreignItems.length > 0 || foreignWrites.length > 0) {
				pass = false;
				notes.push(`namespace violation: ${foreignItems.length} item(s) + ${foreignWrites.length} write(s) outside ${task.knowledgeNamespace}`);
				scores.namespace = 0;
			} else scores.namespace = 1;
		}
		const itemCount = Math.max(output.items?.length ?? 0, 1);
		const citationsWithQuote = (output.citations ?? []).filter((citation) => typeof citation.quote === "string" && citation.quote.length > 0).length;
		const citationDensity = Math.min(1, citationsWithQuote / itemCount);
		if (citationDensity < citationDensityMin) {
			pass = false;
			notes.push(`citation density ${citationDensity.toFixed(2)} below floor ${citationDensityMin.toFixed(2)}`);
		}
		scores.citation_density = citationDensity;
		const sourceSet = /* @__PURE__ */ new Set();
		for (const item of output.items ?? []) for (const evidence of item.evidence ?? []) if (evidence.source) sourceSet.add(evidence.source);
		scores.source_diversity = Math.min(1, sourceSet.size / itemCount);
		scores.recency_match = recencyMatchScore(output.items ?? [], task.recencyWindow);
		const maxGaps = itemCount;
		const gapCount = output.gaps?.length ?? 0;
		scores.gap_coverage = Math.max(0, 1 - gapCount / maxGaps);
		const score = .4 * scores.citation_density + .2 * scores.source_diversity + .2 * scores.recency_match + .2 * scores.gap_coverage;
		const verdict = {
			valid: pass,
			score: Number.isFinite(score) ? score : 0,
			scores
		};
		if (notes.length > 0) verdict.notes = notes.join("; ");
		return verdict;
	} };
}
function recencyMatchScore(items, window) {
	if (!window || window.since === void 0 && window.until === void 0) return 1;
	if (items.length === 0) return 0;
	const sinceMs = window.since?.getTime() ?? Number.NEGATIVE_INFINITY;
	const untilMs = window.until?.getTime() ?? Number.POSITIVE_INFINITY;
	let hits = 0;
	let total = 0;
	for (const item of items) for (const evidence of item.evidence ?? []) {
		if (typeof evidence.capturedAt !== "number") continue;
		total += 1;
		if (evidence.capturedAt >= sinceMs && evidence.capturedAt <= untilMs) hits += 1;
	}
	return total === 0 ? 0 : hits / total;
}
/** Built-in source-grounded research contract added to a caller-owned exact profile. */
const RESEARCHER_SYSTEM_PROMPT = [
	"You are a research agent. Your job is to answer a research question with",
	"source-grounded knowledge items that the caller will choose whether to",
	"persist to a multi-tenant knowledge base.",
	"",
	"Hard rules:",
	"  1. Every item you emit MUST carry the task's knowledgeNamespace exactly.",
	"     Never write to a different namespace.",
	"  2. Every item MUST carry at least one evidence entry with a source.",
	"     A quote + url is strongly preferred; capturedAt is unix ms.",
	"  3. You propose writes — you do NOT apply them. The caller decides.",
	"  4. Self-report confidence honestly in [0, 1]. Do not inflate.",
	"  5. List what you could not answer in `gaps`. Better to admit a gap",
	"     than fabricate.",
	"",
	"When you finish, emit a single final structured message of the shape:",
	"  ```json",
	"  { \"items\": [{ \"id\": \"...\", \"namespace\": \"...\", \"claim\": \"...\",",
	"                \"evidence\": [{ \"source\": \"...\", \"quote\": \"...\",",
	"                               \"url\": \"...\", \"capturedAt\": 0 }],",
	"                \"confidence\": 0.0,",
	"                \"authoredBy\": { \"kind\": \"agent\", \"id\": \"...\" } }],",
	"    \"citations\": [{ \"url\": \"...\", \"quote\": \"...\", \"confidence\": 0.0 }],",
	"    \"proposedWrites\": [{ \"kind\": \"insert\", \"namespace\": \"...\",",
	"                         \"item\": { /* same shape as items[] */ } }],",
	"    \"gaps\": [\"...\"],",
	"    \"notes\": \"free-form commentary\" }",
	"  ```"
].join("\n");
function formatResearcherPrompt(task) {
	const sources = task.sources?.length ? task.sources.join(", ") : "(no preference)";
	const window = formatRecencyWindow(task.recencyWindow);
	return [
		`Question: ${task.question}`,
		`Knowledge namespace (DO NOT cross): ${task.knowledgeNamespace}`,
		`Scope: ${task.scope ?? "(unspecified)"}`,
		`Preferred sources: ${sources}`,
		`Recency window: ${window}`,
		`Max items: ${task.maxItems ?? "(no cap)"}`,
		`Per-item minimum confidence: ${task.minConfidence ?? "(no floor)"}`,
		"",
		"Produce knowledge items with provenance + citations + proposed writes.",
		"List gaps for anything you could not answer. Emit the final JSON",
		"result block exactly as instructed."
	].join("\n");
}
function formatRecencyWindow(window) {
	if (!window) return "(none)";
	return `${window.since ? window.since.toISOString() : "-∞"} .. ${window.until ? window.until.toISOString() : "now"}`;
}
/**
* Walk the event stream and return the last structured `research.result`
* payload. Falls back to scanning text deltas for a fenced JSON block.
*/
function parseResearcherEvents(events) {
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (!event) continue;
		const type = String(event.type ?? "");
		const data = isRecord(event.data) ? event.data : {};
		if (type === "result" || type === "final" || type === "research.result") {
			const direct = coerceResearchOutput(data.result ?? data.output ?? data);
			const finalText = pickString(data.finalText);
			const fenced = finalText ? extractFencedJson(finalText) : void 0;
			const fromFinalText = fenced ? coerceResearchOutput(fenced) : void 0;
			if (direct && !isEmptyOutput(direct)) return direct;
			if (fromFinalText) return fromFinalText;
			if (direct) return direct;
		}
	}
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (!event) continue;
		const data = isRecord(event.data) ? event.data : {};
		const text = pickString(data.text) ?? pickString(data.delta) ?? pickString(data.finalText);
		if (!text) continue;
		const fenced = extractFencedJson(text);
		if (!fenced) continue;
		const coerced = coerceResearchOutput(fenced);
		if (coerced) return coerced;
	}
	return {
		items: [],
		citations: [],
		proposedWrites: []
	};
}
function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** A coerced output that carries no items, citations, or proposed writes. */
function isEmptyOutput(o) {
	return o.items.length === 0 && o.citations.length === 0 && o.proposedWrites.length === 0;
}
function pickString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function extractFencedJson(text) {
	const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (!match) return void 0;
	const body = (match[1] ?? "").trim();
	if (!body) return void 0;
	try {
		return JSON.parse(body);
	} catch {
		return;
	}
}
function coerceResearchOutput(value) {
	if (!isRecord(value)) return void 0;
	const items = coerceItems(value.items);
	const citations = coerceCitations(value.citations);
	const proposedWrites = coerceProposedWrites(value.proposedWrites);
	if (items === void 0 && citations === void 0 && proposedWrites === void 0) return;
	const output = {
		items: items ?? [],
		citations: citations ?? [],
		proposedWrites: proposedWrites ?? []
	};
	if (Array.isArray(value.gaps)) output.gaps = value.gaps.filter((entry) => typeof entry === "string");
	const notes = pickString(value.notes);
	if (notes) output.notes = notes;
	const known = /* @__PURE__ */ new Set([
		"items",
		"citations",
		"proposedWrites",
		"gaps",
		"notes"
	]);
	const extras = {};
	let extrasCount = 0;
	for (const [key, val] of Object.entries(value)) {
		if (known.has(key)) continue;
		extras[key] = val;
		extrasCount += 1;
	}
	if (extrasCount > 0) output.raw = extras;
	return output;
}
function coerceItems(value) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const id = pickString(entry.id);
		const namespace = pickString(entry.namespace);
		const claim = pickString(entry.claim);
		const evidence = coerceEvidence(entry.evidence);
		const confidence = toFiniteNumber(entry.confidence);
		const authoredBy = coerceAuthoredBy(entry.authoredBy);
		if (!id || !namespace || !claim || !authoredBy) continue;
		const item = {
			id,
			namespace,
			claim,
			evidence,
			confidence: clamp01(confidence),
			authoredBy
		};
		if (Array.isArray(entry.supersedes)) item.supersedes = entry.supersedes.filter((s) => typeof s === "string");
		const retractedAt = toFiniteNumber(entry.retractedAt);
		if (retractedAt > 0) item.retractedAt = retractedAt;
		out.push(item);
	}
	return out;
}
function coerceEvidence(value) {
	if (!Array.isArray(value)) return [];
	const out = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const source = pickString(entry.source);
		if (!source) continue;
		const item = {
			source,
			capturedAt: toFiniteNumber(entry.capturedAt)
		};
		const quote = pickString(entry.quote);
		if (quote) item.quote = quote;
		const url = pickString(entry.url);
		if (url) item.url = url;
		out.push(item);
	}
	return out;
}
function coerceAuthoredBy(value) {
	if (!isRecord(value)) return void 0;
	const kind = value.kind === "human" || value.kind === "agent" ? value.kind : void 0;
	const id = pickString(value.id);
	if (!kind || !id) return void 0;
	return {
		kind,
		id
	};
}
function coerceCitations(value) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const url = pickString(entry.url);
		const quote = pickString(entry.quote);
		if (!url || !quote) continue;
		out.push({
			url,
			quote,
			confidence: clamp01(toFiniteNumber(entry.confidence))
		});
	}
	return out;
}
function coerceProposedWrites(value) {
	if (!Array.isArray(value)) return void 0;
	const out = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const namespace = pickString(entry.namespace);
		if (!namespace) continue;
		if (entry.kind === "insert") {
			const item = coerceItems([entry.item])?.[0];
			if (!item) continue;
			out.push({
				kind: "insert",
				namespace,
				item
			});
		} else if (entry.kind === "supersede") {
			const previousId = pickString(entry.previousId);
			const item = coerceItems([entry.item])?.[0];
			if (!previousId || !item) continue;
			out.push({
				kind: "supersede",
				namespace,
				previousId,
				item
			});
		} else if (entry.kind === "retract") {
			const itemId = pickString(entry.itemId);
			const reason = pickString(entry.reason);
			if (!itemId || !reason) continue;
			out.push({
				kind: "retract",
				namespace,
				itemId,
				reason
			});
		}
	}
	return out;
}
function toFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function clamp01(value) {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}
//#endregion
//#region src/profiles/ui-auditor/lens-prompts.ts
/** Cross-lens rules injected into every UI audit iteration: finding quality standards and scope limits. @experimental */
const SHARED_AUDITOR_RULES = `
You are auditing a UI for a specific class of problems. Stay strictly in your assigned lens — do not file issues that belong to another lens (a separate iteration will catch those).

A finding is only valid if a thoughtful product designer would agree the screenshot shows something that should change. Avoid:
- Personal taste ("I'd prefer brand blue").
- Hallucinated text or controls you cannot actually see in the screenshot.
- Suggestions that depend on requirements you don't have access to.
- Pile-on findings about the same root cause — file ONE finding and use \`similarTo\` to link the rest.

Required for every finding:
- title: concrete, names the offending element AND what's wrong (NOT "improve UX").
- severity: critical=blocks a core task or accessibility blocker; high=noticeable friction; med=visible polish issue; low=nitpick.
- observation: 1–3 sentences describing exactly what you see that is wrong.
- impact: who is affected and how (concrete).
- suggestedFix: a specific change a developer could apply without asking you back.
- screenshots: refer to the captures attached to this iteration by path.
- selector: when you can pin the offending element with a CSS selector.

Most findings are med or low. Reserve high/critical for genuine blockers.
`.trim();
/** Per-lens auditor briefs: concrete signals to look for and cross-lens distinctions to respect. @experimental */
const LENS_BRIEFS = {
	consistency: `
LENS: consistency
Look for inconsistencies in the design system — things that look like they came from different products glued together.
Signals: multiple font families, inconsistent weights/sizes for the same role, two shades of "primary", arbitrary paddings/margins that don't snap to a scale (4/8/12/16/24), same control with different border-radius or shadow on different pages, mixed icon styles (filled vs outlined), inconsistent button heights/padding for the same variant, inconsistent capitalization (Title Case vs sentence case) for the same role.
NOT this lens: layout misalignment (use \`layout\`), confusing user flow (use \`ux-flow\`), contrast/keyboard issues (use \`accessibility\`).
Title format: \`Inconsistent <thing> between <A> and <B>\`.
`.trim(),
	hierarchy: `
LENS: hierarchy
Look for broken visual hierarchy — places where the eye does not land on what matters most.
Signals: primary CTA same weight as secondary/tertiary controls, headings (H1/H2/H3) nearly the same size, important data buried (headline number smaller than its label), decoration outshining content, too many emphases competing, wrong scan order, missing or overly heavy section dividers.
NOT this lens: same-role styled differently (\`consistency\`), grid/alignment (\`layout\`), contrast-failing text (\`accessibility\`).
Title format: \`Weak hierarchy: <element> does not read as the <intended-role>\`.
`.trim(),
	layout: `
LENS: layout
Look for layout and organization problems — alignment, grouping, whitespace, structural choices that hurt scannability.
Signals: misalignment within rows, inconsistent gutters in grids, orphan whitespace next to crammed regions, poor grouping (related fields separated, unrelated fields adjacent), no visual sections (long wall of content), container overflow (text/content punching out of card boundaries), cramped or oversized hit targets, sidebars/headers sized wrong relative to main content.
NOT this lens: same-role styled differently (\`consistency\`), click-distance/friction (\`ux-flow\`), overflow specifically at small viewports (\`responsive\`).
Title format: \`<Region> alignment/spacing problem\` or \`<Region> grouping unclear\`.
`.trim(),
	"ux-flow": `
LENS: ux-flow
Look for interaction-flow friction — action sequences that are slower, more annoying, or more error-prone than necessary.
Signals: sequential clicks far apart (e.g. Next top-right while user is bottom-left), destructive action adjacent to primary with same weight, confirmations that don't say what's being confirmed, primary CTA below the fold or hidden in a kebab menu, silent state changes (toggle gives no feedback), form ordering that fights real-world order, dead-end states after submit, lost inputs on back-navigation, hidden pre-selected options.
NOT this lens: visual style only (\`consistency\`), component arrangement without a flow problem (\`layout\`), microcopy clarity (\`content\`).
Title format: \`<Action A> → <Action B> friction: <root cause>\`.
`.trim(),
	duplication: `
LENS: duplication
Look for redundancy — the same control, link, or piece of content appearing more than once with no good reason.
Signals: two ways to do the same action on the same screen with no difference, repeated nav (same links in sidebar AND top nav), drifted duplicates (two copies that have diverged), content repeated verbatim, icon + label saying the same thing twice in one row, per-row + bulk actions that overlap confusingly, multiple status indicators conveying the same status.
NOT this lens: inconsistent styling of duplicates (\`consistency\`) — this lens is about the existence of duplicates.
Title format: \`Duplicate <thing> in <location A> and <location B>\`.
`.trim(),
	accessibility: `
LENS: accessibility
Look for accessibility blockers and degradations. Be conservative — do not assume violations you cannot see.
Signals: insufficient contrast on body text or controls, missing/invisible focus styles, tiny tap targets (<24px on mobile), color as sole signal (red border with no message), form labels missing or not associated (placeholders standing in for labels), broken heading order (H1 → H4), modals that don't trap focus, decorative elements that take focus, errors not announced, important text rendered inside images.
NOT this lens: generic "looks confusing" (\`hierarchy\` or \`content\`), layout overflow at small viewports (\`responsive\`).
Title format: \`Accessibility: <specific blocker> in <element>\`.
`.trim(),
	responsive: `
LENS: responsive
Look for layout breakage across viewport sizes — content that works at one width but degrades at another. This iteration's captures should include the same surface at >=2 viewports; compare across them.
Signals: horizontal scroll where content should reflow, overlapping elements (header overlaps content, fixed footer covers inputs), desktop nav crammed into mobile without collapsing, table columns that don't truncate, tap targets too close at touch sizes, controls vanishing at certain widths, layout flips that break grouping order, modals exceeding viewport height (confirm button unreachable).
NOT this lens: issues present at every viewport (\`consistency\` / \`hierarchy\` instead).
Title format: \`<Element/Region> breaks at <viewport>\`.
`.trim(),
	states: `
LENS: states
Look for missing or broken UI states — the not-happy-paths that make a product feel finished or unfinished. The iteration's captures should depict at least one non-default state.
Signals: empty lists with no guidance, skeletons that don't match final layout (CLS on settle), error states with no message or recovery action, disabled buttons with no explanation, toasts that disappear before being read, success states that don't confirm, missing hover/focus/active/disabled variants on primary controls, no long-content view, no-permission state broken.
NOT this lens: generic polish on the happy path (other lenses), missing focus rings specifically (\`accessibility\`).
Title format: \`Missing/broken <state> state on <surface>\`.
`.trim(),
	content: `
LENS: content
Look for microcopy and content problems — text that is unclear, inconsistent, condescending, jargon-heavy, or wrong.
Signals: jargon/internal language leaking ("Provisioning a Tenant" instead of "Setting up your account"), inconsistent terminology (workspace vs team), verbose button labels, empty-state copy that's just "No results", error messages blaming the user, tone inconsistency, truncation without affordance, mixed date/number formats on one page, placeholder used as a label, "Saved!" toast appearing before save completes, typos and grammar errors.
NOT this lens: visual treatment of text (\`hierarchy\` / \`consistency\`), missing labels for a11y (\`accessibility\`).
Title format: \`Copy: "<actual text>" in <location>\` or \`Inconsistent term: "<A>" vs "<B>"\`.
`.trim(),
	interaction: `
LENS: interaction
Look for interaction quality problems — affordances, feedback, and micro-interactions.
Signals: no affordance (clickable areas not looking clickable, non-clickable areas looking clickable), missing feedback (>100ms click with no progress), hover surprises (whole row highlights but only title clickable), cursor inconsistency, animations that block input, missing transitions where they're needed (accordion snaps open), drag-and-drop without indicators, scroll-jacking, click-through bugs (card click handler firing alongside button), hover-only revelations on touch.
NOT this lens: position of controls (\`layout\` / \`ux-flow\`), missing focus styles (\`accessibility\`).
Title format: \`<Action> on <element>: <missing/wrong> feedback\`.
`.trim(),
	"performance-perceived": `
LENS: performance-perceived
Look for perceived-performance problems — visible jank a real user would notice, not benchmark numbers. This iteration's captures should include >=2 frames during load to show shift.
Signals: layout shift (CLS) when late-arriving images/fonts/banners settle, FOUC (flash of unstyled content), font swap jumps, late-loading hero images that shift everything, skeletons that don't match final shape, spinners on instant local actions, loading state reappearing after content paints (refetch on focus), modal open animation longer than the operation it precedes.
NOT this lens: slow API calls (file separately), stale data after navigation (\`states\`).
Title format: \`Layout shift / late paint on <route>: <root cause>\`.
`.trim(),
	other: `
LENS: other
Use ONLY when a finding is clearly a UI quality issue but does not fit any other lens. Strongly prefer a specific lens — \`other\` should be rare. Title must still be concrete.
`.trim()
};
/**
* Build a system prompt for a single auditor iteration.
*
* @experimental
*/
function buildAuditorSystemPrompt(lens) {
	const brief = LENS_BRIEFS[lens];
	return `${SHARED_AUDITOR_RULES}\n\n${brief}`;
}
//#endregion
//#region src/profiles/ui-auditor/output-adapter.ts
const KNOWN_LENS_VALUES = new Set(UI_LENSES);
function isUiLens(v) {
	return typeof v === "string" && KNOWN_LENS_VALUES.has(v);
}
/** Parse raw `SandboxEvent` emissions from an audit iteration into structured `UiAuditOutput`. @experimental */
function parseAuditorEvents(events) {
	const findings = [];
	const captures = [];
	let lens;
	let notes;
	for (const evt of events) {
		if (!evt || typeof evt !== "object") continue;
		const type = String(evt.type ?? "");
		const data = evt.data && typeof evt.data === "object" ? evt.data : void 0;
		if (!data) continue;
		switch (type) {
			case "audit.lens": {
				const v = data.lens;
				if (isUiLens(v)) lens = v;
				break;
			}
			case "audit.capture": {
				const cap = data;
				if (typeof cap.path === "string" && typeof cap.viewport === "string" && typeof cap.fullPage === "boolean" && typeof cap.route === "string" && typeof cap.url === "string" && typeof cap.capturedAt === "string") {
					const out = {
						path: cap.path,
						viewport: cap.viewport,
						fullPage: cap.fullPage,
						route: cap.route,
						url: cap.url,
						capturedAt: cap.capturedAt
					};
					if (cap.elementSelector) out.elementSelector = cap.elementSelector;
					if (cap.label) out.label = cap.label;
					captures.push(out);
				}
				break;
			}
			case "audit.finding": {
				const f = data;
				if (typeof f.title === "string" && f.title.trim().length > 0 && isUiLens(f.lens) && typeof f.severity === "string" && [
					"low",
					"med",
					"high",
					"critical"
				].includes(f.severity) && typeof f.route === "string" && typeof f.observation === "string" && typeof f.impact === "string" && typeof f.suggestedFix === "string" && Array.isArray(f.screenshots)) findings.push(f);
				break;
			}
			case "audit.notes": {
				const n = data.notes;
				if (typeof n === "string" && n.trim().length > 0) notes = n;
				break;
			}
			default: break;
		}
	}
	const out = {
		lens: lens ?? "other",
		findings,
		captures
	};
	if (notes) out.notes = notes;
	return out;
}
//#endregion
//#region src/profiles/ui-auditor/prompt.ts
const ENVELOPE_BEGIN = "<<UI_AUDIT_TASK>>";
const ENVELOPE_END = "<<UI_AUDIT_TASK_END>>";
/** Wrap a `UiAuditTask` in a machine-readable envelope so iterations are self-describing. @experimental */
function encodeAuditTaskEnvelope(task) {
	return `${ENVELOPE_BEGIN}${JSON.stringify(task)}${ENVELOPE_END}`;
}
/**
* Parse a task envelope back out of a prompt string. Returns undefined if
* the prompt does not contain a complete envelope OR if the payload is
* not valid JSON.
*
* @experimental
*/
function decodeAuditTaskEnvelope(prompt) {
	const start = prompt.indexOf(ENVELOPE_BEGIN);
	if (start === -1) return void 0;
	const payloadStart = start + 17;
	const end = prompt.indexOf(ENVELOPE_END, payloadStart);
	if (end === -1) return void 0;
	const payload = prompt.slice(payloadStart, end);
	try {
		const parsed = JSON.parse(payload);
		if (!parsed || typeof parsed !== "object") return void 0;
		const t = parsed;
		if (typeof t.lens !== "string" || !Array.isArray(t.captures)) return void 0;
		return t;
	} catch {
		return;
	}
}
/** Produce the user message for one audit iteration: lens, captures to take, and the task envelope. @experimental */
function formatAuditorPrompt(task) {
	const lines = [];
	lines.push(`# UI audit iteration — lens: ${task.lens}`);
	lines.push("");
	if (task.productContext && task.productContext.trim().length > 0) {
		lines.push("## Product context");
		lines.push(task.productContext.trim());
		lines.push("");
	}
	lines.push("## Captures to take");
	task.captures.forEach((cap, i) => {
		const detail = [
			`viewport=${cap.viewport ? `${cap.viewport.width}x${cap.viewport.height}` : "1280x800 (default)"}`,
			cap.fullPage ? "fullPage=true" : null,
			cap.elementSelector ? `selector=\`${cap.elementSelector}\`` : null,
			cap.waitFor ? `waitFor=\`${cap.waitFor}\`` : null,
			cap.waitMs !== void 0 ? `waitMs=${cap.waitMs}` : null,
			cap.label ? `label=${cap.label}` : null
		].filter((s) => s !== null).join(" · ");
		lines.push(`${i + 1}. route=\`${cap.route}\` url=${cap.url} ${detail ? `(${detail})` : ""}`);
	});
	lines.push("");
	if (task.knownFindingIds && task.knownFindingIds.length > 0) {
		lines.push("## Known findings (link via similarTo, do not refile)");
		lines.push(task.knownFindingIds.map((n) => `#${String(n).padStart(3, "0")}`).join(", "));
		lines.push("");
	}
	lines.push("## Output format");
	lines.push("Emit a single JSON object with the shape `{ findings: UiFinding[], notes?: string }` where every finding has the fields enumerated in your system prompt. The screenshots field on each finding must reference the captures above by path. Do not emit findings outside the lens.");
	return lines.join("\n");
}
//#endregion
//#region src/profiles/ui-auditor/validator.ts
const GENERIC_TITLE_PATTERNS = [
	/^improve\s/i,
	/^fix\s/i,
	/^update\s/i,
	/^better\s/i,
	/^bad\s/i,
	/^make\s.+\sbetter/i,
	/\bUX\b\s*$/i,
	/\bUI\b\s*$/i
];
function isGenericTitle(title) {
	const t = title.trim();
	if (t.length < 16) return true;
	return GENERIC_TITLE_PATTERNS.some((re) => re.test(t));
}
/** Build a `Validator` that rejects off-lens findings and findings missing screenshot evidence. @experimental */
function createUiAuditorValidator(task) {
	return { async validate(output) {
		const findings = output.findings;
		const captures = output.captures;
		const capturePaths = new Set(captures.map((c) => c.path));
		const offLens = findings.filter((f) => f.lens !== task.lens);
		if (offLens.length > 0) return {
			valid: false,
			score: 0,
			notes: `${offLens.length} finding(s) filed under wrong lens (expected ${task.lens}; got ${offLens.map((f) => f.lens).join(", ")})`,
			scores: { offLens: 0 }
		};
		const missingEvidence = findings.filter((f) => !Array.isArray(f.screenshots) || f.screenshots.length === 0);
		if (missingEvidence.length > 0) return {
			valid: false,
			score: 0,
			notes: `${missingEvidence.length} finding(s) have no screenshot evidence`,
			scores: { evidence: 0 }
		};
		const unresolvedShot = findings.filter((f) => f.screenshots.some((s) => !capturePaths.has(s.path)));
		if (unresolvedShot.length > 0) return {
			valid: false,
			score: 0,
			notes: `${unresolvedShot.length} finding(s) reference screenshot paths not captured this iteration`,
			scores: { evidence: 0 }
		};
		if (findings.length === 0) return {
			valid: true,
			score: .5,
			notes: "No findings reported. Neither a confident pass nor a failure.",
			scores: {
				specificity: 0,
				evidence: 1,
				titles: 1
			}
		};
		const specificity = findings.filter((f) => typeof f.selector === "string").length / findings.length;
		const titles = 1 - findings.filter((f) => isGenericTitle(f.title)).length / findings.length;
		const evidence = findings.filter((f) => Array.isArray(f.screenshots) && f.screenshots.length > 0 && f.screenshots.every((s) => capturePaths.has(s.path))).length / findings.length;
		return {
			valid: true,
			score: Number((.4 * specificity + .4 * evidence + .2 * titles).toFixed(4)),
			notes: `${findings.length} finding(s) — specificity=${specificity.toFixed(2)} evidence=${evidence.toFixed(2)} titles=${titles.toFixed(2)}`,
			scores: {
				specificity,
				evidence,
				titles
			}
		};
	} };
}
//#endregion
export { LENS_BRIEFS, SHARED_AUDITOR_RULES, UI_FINDING_SEVERITIES, UI_LENSES, appendFindings, buildAuditorSystemPrompt, coderTaskToPrompt, createResearcherValidator, createUiAuditorValidator, decodeAuditTaskEnvelope, encodeAuditTaskEnvelope, formatAuditorPrompt, initAuditWorkspace, multiHarnessResearcherFanout, parseAuditorEvents, readAuditRegistry, registerCaptures, researcherProfile, summarizeRegistry, writeAuditIndex };

//# sourceMappingURL=profiles.js.map