import { Ca as Validator, Yi as AgentRunSpec, Zi as Driver, va as OutputAdapter } from "./types-D56jQad-.js";
import { AgentProfile } from "@tangle-network/agent-interface";
//#region src/profiles/coder.d.ts
/**
 *
 * `CoderTask` + `coderTaskToPrompt` — the per-task DATA + pure formatter for code-modification tasks
 * (§1.5: the system authors profiles; there is no hardcoded coder profile constant). A domain
 * customizes the worker by authoring its own `AgentProfile` and handing it to a leaf executor
 * (`createWorktreeCliExecutor`) or a fanout (`worktreeFanout`); "is it delivered" is a
 * `DeliverableSpec` (`patchDelivered`), not a bundled validator. This formatter renders a `CoderTask`
 * into the per-task instruction that profile receives.
 *
 * @experimental
 */
/** @experimental The per-task inputs `coderTaskToPrompt` renders + the worktree gate enforces. */
interface CoderTask {
  /** What the agent must accomplish. Free-form prose. */
  goal: string;
  /** Absolute path inside the sandbox where the repo lives. */
  repoRoot: string;
  /** Default `main`. The branch the agent diffs against. */
  baseBranch?: string;
  /** Default `pnpm test --run`. */
  testCmd?: string;
  /** Default `pnpm typecheck`. */
  typecheckCmd?: string;
  /** Files the agent may inspect for context. Surfaced verbatim in the prompt. */
  contextFiles?: string[];
  /**
   * Paths the agent must not touch. The mechanical gate hard-fails on any match.
   * Use glob-free literal path prefixes for unambiguous enforcement.
   */
  forbiddenPaths?: string[];
  /** Default 400. Hard cap; the gate hard-fails when exceeded. */
  maxDiffLines?: number;
}
/** Render a `CoderTask` into the per-task instruction handed to the coder profile. @experimental */
declare function coderTaskToPrompt(task: CoderTask): string;
//#endregion
//#region src/profiles/researcher.d.ts
/** Source families a researcher profile may prefer for a task. One owner: the delegation
 *  vocabulary (`DelegateResearchArgs.sources`) re-exports this type rather than restating it.
 *  @experimental */
type ResearchSource = 'web' | 'corpus' | 'twitter' | 'github' | 'docs';
/** Task contract for a source-grounded research agent. @experimental */
interface ResearchTask {
  /** The research question to answer. */
  question: string;
  /** Bound: e.g. "audience for cpg-founder ICP". */
  scope?: string;
  /** Multi-tenant scope (customer-id, workspace-id). Validator enforces. */
  knowledgeNamespace: string;
  sources?: ResearchSource[];
  recencyWindow?: {
    since?: Date;
    until?: Date;
  };
  maxItems?: number;
  /** Per-item minimum confidence in [0, 1]. Validator scores recall vs this. */
  minConfidence?: number;
}
/**
 * Knowledge item emitted by the researcher.
 *
 * Profile-local type. When agent-knowledge promotes `KnowledgeClaim` →
 * top-level `KnowledgeItem` substrate-wide, these fields collapse 1:1.
 *
 * @experimental
 */
interface KnowledgeItem {
  id: string;
  /** Multi-tenant scope. MUST equal `task.knowledgeNamespace`. */
  namespace: string;
  /** The factual claim, in the researcher's words. */
  claim: string;
  /** Provenance — at least one entry required. */
  evidence: Array<{
    source: string;
    quote?: string;
    url?: string;
    capturedAt: number;
  }>;
  /** Researcher's self-reported confidence in [0, 1]. */
  confidence: number;
  /** Prior item ids this supersedes (chain). */
  supersedes?: string[];
  /** Set if the agent is retracting an earlier item. Unix ms. */
  retractedAt?: number;
  authoredBy: {
    kind: 'human' | 'agent';
    id: string;
  };
}
/**
 * A proposed write to the knowledge base. The profile does NOT apply
 * these — the caller decides.
 *
 * @experimental
 */
type KnowledgeUpdate = {
  kind: 'insert';
  namespace: string;
  item: KnowledgeItem;
} | {
  kind: 'supersede';
  namespace: string;
  previousId: string;
  item: KnowledgeItem;
} | {
  kind: 'retract';
  namespace: string;
  itemId: string;
  reason: string;
};
/**
 * Researcher output. Required fields are typed; optional fields preserve
 * the agent's free-form intelligence (`notes`, `raw`). The validator
 * enforces the typed minimum.
 *
 * @experimental
 */
interface ResearchOutput {
  items: KnowledgeItem[];
  citations: Array<{
    url: string;
    quote: string;
    confidence: number;
  }>;
  proposedWrites: KnowledgeUpdate[];
  gaps?: string[];
  notes?: string;
  /** Anything the agent emitted beyond the typed fields. */
  raw?: unknown;
}
/** Options for the source-grounded researcher profile preset. @experimental */
interface ResearcherProfileOptions {
  /** Caller-owned exact harness/provider/model identity. */
  profile: AgentProfile;
  /** Custom system prompt replacement. Default = built-in researcher preset. */
  systemPrompt?: string;
  /** Stable name for `AgentRunSpec.name`. Default = `profile.name`. */
  name?: string;
  /**
   * Default 0.7. Minimum (citations with quote) / items ratio for `valid=true`.
   * Below this floor, citation_density scores < 1 and the item set is gated.
   */
  citationDensityMin?: number;
}
/** Build a source-grounded researcher profile with output parsing and validation. @experimental */
declare function researcherProfile(options: ResearcherProfileOptions & {
  task?: ResearchTask;
}): {
  profile: AgentProfile;
  taskToPrompt: (task: ResearchTask) => string;
  output: OutputAdapter<ResearchOutput>;
  validator: Validator<ResearchOutput>;
  agentRunSpec: AgentRunSpec<ResearchTask>;
};
/** @experimental */
interface MultiHarnessResearcherFanoutOptions {
  /** Exact execution profiles, one per parallel researcher. */
  profiles: ReadonlyArray<AgentProfile>;
  /** Default citation density floor for the shared validator. */
  citationDensityMin?: number;
  /** Optional task — narrows the validator's namespace check. */
  task?: ResearchTask;
}
/**
 * Build a fanout topology over multiple harnesses. The kernel round-robins
 * `agentRuns` across the N parallel iterations and the `FanoutVote` driver
 * picks the highest-scoring valid output.
 *
 * @experimental
 */
declare function multiHarnessResearcherFanout(options: MultiHarnessResearcherFanoutOptions): {
  agentRuns: AgentRunSpec<ResearchTask>[];
  output: OutputAdapter<ResearchOutput>;
  validator: Validator<ResearchOutput>;
  driver: Driver<ResearchTask, ResearchOutput, 'done'>;
};
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
declare function createResearcherValidator(task: ResearchTask, config?: {
  citationDensityMin?: number;
  namespaceCheck?: boolean;
}): Validator<ResearchOutput>;
//#endregion
//#region src/profiles/ui-auditor/substrate.d.ts
/**
 *
 * UI audit finding shapes — the unit of evidence a contributor can act on.
 *
 * A finding describes a single, actionable UI problem: lens, severity,
 * route, observation, impact, suggested fix, and screenshot evidence.
 * Findings are produced by the auditor profile, persisted by the issue
 * writer as self-contained GitHub-issue Markdown, and surfaced over MCP.
 *
 * The shapes are deliberately constraining — the validator + writer
 * hard-fail on missing screenshot evidence, missing lens, missing title.
 *
 * @experimental
 */
/**
 * Canonical audit lenses. Each lens scopes a finding to a single class of
 * problem so a single audit pass can iterate them without pile-on findings
 * under a generic label.
 */
type UiLens = 'consistency' | 'hierarchy' | 'layout' | 'ux-flow' | 'duplication' | 'accessibility' | 'responsive' | 'states' | 'content' | 'interaction' | 'performance-perceived' | 'other';
/** Frozen tuple of lenses for validation + iteration. */
declare const UI_LENSES: readonly UiLens[];
/**
 * Severity scale.
 *   - `critical` — blocks a core task or is an accessibility blocker.
 *   - `high`     — confusing, broken-looking, or noticeable friction.
 *   - `med`      — visible polish issue, would be caught in code review.
 *   - `low`      — nitpick worth fixing eventually.
 */
type UiFindingSeverity = 'low' | 'med' | 'high' | 'critical';
/** Frozen severity tuple, ordered worst → least bad for sort/report. */
declare const UI_FINDING_SEVERITIES: readonly UiFindingSeverity[];
/** Pointer to a screenshot referenced by a finding (workspace-relative path). */
interface UiFindingScreenshot {
  path: string;
  viewport?: string;
  label?: string;
}
/**
 * A single UI audit finding — the unit of work a contributor can act on.
 *
 * Every field except the documented optionals is required. The auditor
 * validator + writer hard-fail on missing screenshot evidence, missing
 * lens, missing title, etc.
 */
interface UiFinding {
  /** Monotonic id assigned by the writer when persisting. Optional in-transit. */
  id?: number;
  title: string;
  lens: UiLens;
  severity: UiFindingSeverity;
  /** Logical route the finding was observed on (e.g. `home`, `checkout-step-2`). */
  route: string;
  /** Fully qualified URL the finding was observed at. */
  url?: string;
  /** Viewport string the offending capture was taken at (e.g. `1280x800`). */
  viewport?: string;
  /** CSS selector pinning the offending element, when one can be identified. */
  selector?: string;
  /** 1–3 sentences describing what the screenshot shows that is wrong. */
  observation: string;
  /** Who is affected and how. */
  impact: string;
  /** A specific change a contributor could apply without asking back. */
  suggestedFix: string;
  /** Optional explicit reproduction steps. Writer synthesizes from route/url/selector when omitted. */
  reproSteps?: string;
  /** Free-form tags. */
  tags?: readonly string[];
  /** Screenshot references — must be non-empty for actionable findings. */
  screenshots: readonly UiFindingScreenshot[];
  /** Cross-references to similar findings already on file, by id. */
  similarTo?: readonly number[];
  /** ISO-8601 creation timestamp set by the writer when persisted. */
  createdAt?: string;
}
//#endregion
export { CoderTask as _, UiFindingSeverity as a, KnowledgeUpdate as c, ResearchSource as d, ResearchTask as f, researcherProfile as g, multiHarnessResearcherFanout as h, UiFindingScreenshot as i, MultiHarnessResearcherFanoutOptions as l, createResearcherValidator as m, UI_LENSES as n, UiLens as o, ResearcherProfileOptions as p, UiFinding as r, KnowledgeItem as s, UI_FINDING_SEVERITIES as t, ResearchOutput as u, coderTaskToPrompt as v };
//# sourceMappingURL=substrate-CHQ5GYnU.d.ts.map