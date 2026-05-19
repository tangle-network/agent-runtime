/**
 * Public types for the closed-loop analyst orchestrator.
 *
 * The orchestrator is the one call agent apps reach for. It binds:
 *   - the AnalystRegistry + a chosen set of analyst kinds
 *   - a FindingsStore (durable JSONL ledger + cross-run diff)
 *   - an optional KnowledgeAdapter (closes the analysis → wiki side)
 *   - an optional ImprovementAdapter (closes the analysis → prompt /
 *     tool / scaffolding side)
 *
 * Adapters keep agent-runtime decoupled from the specific storage
 * implementation. Consumers wire agent-knowledge once at app init.
 */

import type {
  AnalystFinding,
  AnalystRunInputs,
  AnalystRunResult,
  AnalystRunSummary,
  FindingsDiff,
} from '@tangle-network/agent-eval'

/** Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. */
export interface KnowledgeAdapter<TProposal = unknown> {
  /**
   * Convert a findings batch into proposals. Returns the partitioned
   * result so the loop can report (and optionally fail on) malformed
   * findings. Implementations SHOULD honour the convention "non-
   * knowledge subjects return null and are counted in `skipped`."
   */
  proposeFromFindings(
    findings: ReadonlyArray<AnalystFinding>,
  ): Promise<KnowledgeProposalBatch<TProposal>> | KnowledgeProposalBatch<TProposal>
  /**
   * Optional auto-apply. The loop calls this only when
   * `autoApply.knowledge` is true AND the proposal's source-finding
   * confidence ≥ `autoApply.knowledgeConfidenceThreshold`. Anything
   * below the threshold is returned in the report but never written.
   */
  apply?(proposals: ReadonlyArray<TProposal>): Promise<{ written: string[]; warnings: string[] }>
}

export interface KnowledgeProposalBatch<TProposal = unknown> {
  proposals: TProposal[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
}

/** Improvement-side bridge — proposes / applies prompt + tool + scaffolding edits. */
export interface ImprovementAdapter<TEdit = unknown> {
  proposeFromFindings(
    findings: ReadonlyArray<AnalystFinding>,
  ): Promise<ImprovementEditBatch<TEdit>> | ImprovementEditBatch<TEdit>
  apply?(edits: ReadonlyArray<TEdit>): Promise<{ applied: string[]; warnings: string[] }>
}

export interface ImprovementEditBatch<TEdit = unknown> {
  edits: TEdit[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
}

/** Tunable safety rails for auto-apply. */
export interface AutoApplyPolicy {
  /** When true AND `knowledgeAdapter.apply` exists, write knowledge proposals. */
  knowledge?: boolean
  /** Minimum source-finding confidence required to auto-apply a knowledge proposal. */
  knowledgeConfidenceThreshold?: number
  /** When true AND `improvementAdapter.apply` exists, apply improvement edits. */
  improvement?: boolean
  /** Minimum source-finding confidence required to auto-apply an improvement edit. */
  improvementConfidenceThreshold?: number
}

export interface RunAnalystLoopOpts {
  /** The run id of the work being analysed. */
  runId: string
  /** The registry — pre-populated with the analyst kinds the consumer wants. */
  registry: AnalystRegistryLike
  /** Inputs forwarded to `registry.run` — typically `{ traceStore }`. */
  inputs: AnalystRunInputs
  /**
   * Findings ledger. The loop appends the new run + diffs against the
   * baseline run before running adapters. Pass `null` to skip
   * persistence (useful for one-shot analyses).
   */
  findingsStore: FindingsStoreLike | null
  /**
   * Prior run id whose findings the loop reads + provides to analysts
   * as `priorFindings` AND diffs against. When omitted, the loop picks
   * the most recent run in the store (excluding `runId` itself); pass
   * `null` to explicitly start with an empty baseline.
   */
  baselineRunId?: string | null
  /** Strategy for forwarding prior findings into `ctx.priorFindings`. */
  priorFindingsStrategy?: 'per-kind' | 'wildcard' | 'none'
  /** Knowledge-side bridge — usually `agent-knowledge`'s `proposeFromFindings`. */
  knowledgeAdapter?: KnowledgeAdapter
  /** Improvement-side bridge — usually a consumer-specific prompt/tool diff producer. */
  improvementAdapter?: ImprovementAdapter
  /** Auto-apply rails. Default off; review-then-apply is the safer default. */
  autoApply?: AutoApplyPolicy
  /** Optional logger. Defaults to `console.log` for `[analyst-loop]` lines. */
  log?: (msg: string, fields?: Record<string, unknown>) => void
}

export interface RunAnalystLoopResult<TProposal = unknown, TEdit = unknown> {
  runId: string
  baselineRunId: string | null
  analystResult: AnalystRunResult
  diff: FindingsDiff | null
  knowledge: KnowledgeReport<TProposal> | null
  improvement: ImprovementReport<TEdit> | null
}

export interface KnowledgeReport<TProposal = unknown> {
  proposals: TProposal[]
  applied: string[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
  withheld_for_review: number
}

export interface ImprovementReport<TEdit = unknown> {
  edits: TEdit[]
  applied: string[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
  withheld_for_review: number
}

/**
 * Narrowed shape we accept for `AnalystRegistry` so the orchestrator
 * remains testable without instantiating the real class. The real
 * class satisfies this trivially.
 */
export interface AnalystRegistryLike {
  list(): ReadonlyArray<{ id: string }>
  run(
    runId: string,
    inputs: AnalystRunInputs,
    opts?: {
      priorFindings?: ReadonlyArray<AnalystFinding> | Record<string, ReadonlyArray<AnalystFinding>>
      [k: string]: unknown
    },
  ): Promise<AnalystRunResult>
}

/** Narrowed shape we accept for `FindingsStore`. */
export interface FindingsStoreLike {
  loadAll(): ReadonlyArray<AnalystFinding & { run_id: string }>
  loadRun(runId: string): ReadonlyArray<AnalystFinding & { run_id: string }>
  append(runId: string, findings: ReadonlyArray<AnalystFinding>): Promise<void>
}

/** Re-export so consumers can type per-analyst summaries from the loop result. */
export type { AnalystRunSummary }
