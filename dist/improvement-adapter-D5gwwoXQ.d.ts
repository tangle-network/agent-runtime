import { o as ImprovementProposalSource } from "./types-zWfqDjeL.js";
import { AnalystFinding, FindingSubject } from "@tangle-network/agent-eval";
//#region src/agent/surfaces.d.ts
/**
 * Surface declarations. Every path is repo-relative (or absolute) at
 * `defineAgent` time. At resolution time, paths are joined against the
 * agent's `repoRoot`.
 *
 * `systemPrompt`, `tools`, `personas` are DIRECTORIES; the loop appends
 * `<section>.md`, `<tool>/README.md`, `<persona-id>.yaml` etc.
 * `rubric`, `outputSchema` are SINGLE FILES; the loop edits them in
 * place.
 *
 * `knowledge` is the agent-knowledge root (typically `.agent-knowledge`);
 * `applyKnowledgeWriteBlocks` writes pages relative to it.
 *
 * Optional surfaces (`scaffolding`, `memory`, `rag`, `outputSchema`)
 * can be omitted — the loop will reject findings targeting them with a
 * clear log message instead of fabricating a path.
 */
interface AgentSurfaces {
  /** Directory containing one markdown file per system-prompt section. */
  systemPrompt: string;
  /** Directory containing one subdir per tool (`<tool>/README.md`). */
  tools: string;
  /** Single file (TypeScript module) defining the rubric weights + dimensions. */
  rubric: string;
  /** Knowledge-base root; typically `.agent-knowledge`. */
  knowledge: string;
  /** Directory containing one YAML/JSON file per persona. */
  personas: string;
  /** Optional: directory containing scaffolding rules (precondition checks, retry policies). */
  scaffolding?: string;
  /** Optional: memory store path (JSONL / SQLite / DB). */
  memory?: string;
  /** Optional: directory containing RAG corpora (`<corpus>/<doc-id>.md`). */
  rag?: string;
  /** Optional: single file defining the output schema (Zod / JSON Schema). */
  outputSchema?: string;
  /** Optional: directory containing Agent Skill packages. */
  skills?: string;
  /** Optional: directory containing MCP server/tool configuration. */
  mcp?: string;
  /** Optional: directory containing hook definitions. */
  hooks?: string;
  /** Optional: directory containing subagent definitions. */
  subagents?: string;
  /** Optional: directory containing orchestration/workflow policies. */
  workflows?: string;
  /** Optional: single file containing rollout-policy settings. */
  rolloutPolicy?: string;
  /** Optional: single canonical AgentProfile file. */
  agentProfile?: string;
  /** Optional: source root for code findings. */
  code?: string;
}
interface ResolvedSurface {
  /** Absolute filesystem path the operator can `cat` / `vim`. */
  absolutePath: string;
  /** Repo-relative path for PR descriptions, diffs, audit logs. */
  repoRelativePath: string;
  /** Whether the path currently exists on disk. */
  exists: boolean;
  /** The substrate's intent: edit an existing file or create a new one. */
  intent: 'edit-existing' | 'create-new';
}
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
declare function resolveSubjectPath(subject: FindingSubject, surfaces: AgentSurfaces, repoRoot: string): ResolvedSurface | null;
/**
 * Validate that every declared surface exists on disk under `repoRoot`.
 *
 * Returns an array of `SurfaceValidationIssue` — empty when all required
 * surfaces resolve. `defineAgent` throws with the issues rendered, so
 * a misconfigured manifest fails at startup (not at the first finding
 * the loop produces 20 minutes later).
 */
interface SurfaceValidationIssue {
  surface: keyof AgentSurfaces;
  path: string;
  reason: 'missing' | 'not-directory' | 'not-file';
}
/** Validate an `AgentSurfaces` map on disk — missing paths fail loud at `defineAgent` time instead of silently skipping self-improvement edits. */
declare function validateSurfaces(surfaces: AgentSurfaces, repoRoot: string): ReadonlyArray<SurfaceValidationIssue>;
/** Format a list of surface validation issues into a human-readable error string. */
declare function renderSurfaceIssues(issues: ReadonlyArray<SurfaceValidationIssue>, repoRoot: string): string;
//#endregion
//#region src/agent/improvement-adapter.d.ts
interface SurfaceImprovementEdit {
  /** Stable id derived from the source finding so re-proposals are idempotent. */
  id: string;
  /** The finding that produced this edit — for revert + audit trail. */
  sourceFindingId: string;
  /** Parsed subject; included so the apply step doesn't re-parse. */
  subject: FindingSubject;
  /** Resolved on-disk target. */
  target: ResolvedSurface;
  /** SHA-256 of the current file content the patch was drafted against. */
  baseSha256: string;
  /** Unified-diff patch the LLM drafted (relative to `target.absolutePath`). */
  patch: string;
  /** One-line summary the operator sees in the report / PR title. */
  summary: string;
  /** Multi-line rationale for the PR body — finding context + LLM reasoning. */
  rationale: string;
  /** Carry-forward from the finding so the apply gate can check the threshold. */
  confidence: number;
  /** Carry-forward severity for prioritization. */
  severity: AnalystFinding['severity'];
}
interface CreateSurfaceImprovementProposerOptions {
  surfaces: AgentSurfaces;
  repoRoot: string;
  /**
   * LLM-draft callback. Given a finding + current file content + the
   * resolved target, returns a unified-diff patch + summary + rationale.
   *
   * Required — the substrate doesn't ship a hardcoded prompt; the agent
   * author picks the model (Haiku for cheap routine drafts, Sonnet for
   * substantive prompt rewrites, etc.) via this callback.
   */
  draftPatch: (input: DraftPatchInput) => Promise<DraftPatchOutput>;
  /**
   * When the resolved target doesn't exist, allow the substrate to
   * CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
   * true for those kinds, false for `system-prompt` / `rubric` / etc.
   * (named sections that don't exist are a contract violation, not a
   * scaffolding opportunity).
   */
  allowCreateForKinds?: ReadonlyArray<FindingSubject['kind']>;
}
interface DraftPatchInput {
  finding: AnalystFinding;
  subject: FindingSubject;
  target: ResolvedSurface;
  /** Current file content (empty string when `intent === 'create-new'`). */
  currentContent: string;
}
interface DraftPatchOutput {
  /** Unified diff against the current file content. Empty string skips this finding. */
  patch: string;
  /** One-line summary for the operator. */
  summary: string;
  /** Multi-line rationale for the PR body. */
  rationale: string;
}
/** Resolve each finding to a real surface and draft a detached patch candidate. */
declare function createSurfaceImprovementProposer(opts: CreateSurfaceImprovementProposerOptions): ImprovementProposalSource<SurfaceImprovementEdit>;
//#endregion
export { createSurfaceImprovementProposer as a, SurfaceValidationIssue as c, validateSurfaces as d, SurfaceImprovementEdit as i, renderSurfaceIssues as l, DraftPatchInput as n, AgentSurfaces as o, DraftPatchOutput as r, ResolvedSurface as s, CreateSurfaceImprovementProposerOptions as t, resolveSubjectPath as u };
//# sourceMappingURL=improvement-adapter-D5gwwoXQ.d.ts.map