/**
 * Public types for the closed-loop analyst orchestrator.
 *
 * The orchestrator is the one call agent apps reach for. It binds:
 *   - the AnalystRegistry + a chosen set of analyst kinds
 *   - a FindingsStore (durable JSONL ledger + cross-run diff)
 *   - an optional knowledge proposal source
 *   - an optional agent-surface proposal source
 *
 * Adapters keep agent-runtime decoupled from the specific storage
 * implementation. Consumers wire agent-knowledge once at app init.
 */

import type {
  AnalystFinding,
  AnalystRunEvent,
  AnalystRunInputs,
  AnalystRunResult,
  AnalystRunSummary,
  CostLedgerHandle,
  FindingsDiff,
} from '@tangle-network/agent-eval'

/** Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge. */
export interface KnowledgeProposalSource<TProposal = unknown> {
  /**
   * Convert a findings batch into proposals. Returns the partitioned
   * result so the loop can report malformed
   * findings. Implementations SHOULD honour the convention "non-
   * knowledge subjects return null and are counted in `skipped`."
   */
  proposeFromFindings(
    findings: ReadonlyArray<AnalystFinding>,
  ): Promise<KnowledgeProposalBatch<TProposal>> | KnowledgeProposalBatch<TProposal>
}

export interface KnowledgeProposalBatch<TProposal = unknown> {
  proposals: TProposal[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
}

/** Agent-surface bridge — proposes prompt, skill, tool, and scaffolding edits. */
export interface ImprovementProposalSource<TEdit = unknown> {
  proposeFromFindings(
    findings: ReadonlyArray<AnalystFinding>,
  ): Promise<ImprovementEditBatch<TEdit>> | ImprovementEditBatch<TEdit>
}

export interface ImprovementEditBatch<TEdit = unknown> {
  edits: TEdit[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
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
  knowledgeProposalSource?: KnowledgeProposalSource
  /** Agent-surface bridge — usually a prompt, skill, or tool diff producer. */
  improvementProposalSource?: ImprovementProposalSource
  /** Shared account for analyst calls that belong to a larger improvement run. */
  costLedger?: CostLedgerHandle
  /** Attribution label forwarded to every analyst call in the shared account. */
  costPhase?: string
  /** Cancels analyst work before downstream proposal work starts. */
  signal?: AbortSignal
  /** Optional logger. Defaults to `console.log` for `[analyst-loop]` lines. */
  log?: (msg: string, fields?: Record<string, unknown>) => void
  /**
   * Event sink for live progress. Called for every phase of the loop:
   * baseline resolution, registry events forwarded from `runStream`,
   * ledger persistence, diff, knowledge / improvement proposals, and
   * the terminal `loop-completed`. Awaited so
   * slow sinks (SSE write, JSONL append) apply backpressure.
   *
   * The callback MUST NOT throw — exceptions propagate and abort the
   * loop. Catch + swallow internally if your sink is unreliable.
   */
  onEvent?: (event: AnalystLoopEvent) => void | Promise<void>
}

export interface RunAnalystLoopResult<TProposal = unknown, TEdit = unknown> {
  runId: string
  baselineRunId: string | null
  /** Full wall-clock time for analysis, persistence, and proposal preparation. */
  durationMs: number
  analystResult: AnalystRunResult
  diff: FindingsDiff | null
  knowledge: KnowledgeReport<TProposal> | null
  improvement: ImprovementReport<TEdit> | null
}

export interface KnowledgeReport<TProposal = unknown> {
  proposals: TProposal[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
}

export interface ImprovementReport<TEdit = unknown> {
  edits: TEdit[]
  skipped: number
  errors: Array<{ findingId: string; subject: string; message: string }>
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

/**
 * Narrow the `AnalystRegistryLike` further when we need streaming: the
 * loop checks if the registry exposes `runStream` and uses it when
 * present, falling back to `run()` otherwise. This keeps the type
 * surface backwards-compatible — older registry shims that only
 * implement `run` still work; they just don't forward per-analyst
 * events.
 */
export interface AnalystRegistryStreamingLike extends AnalystRegistryLike {
  runStream?(
    runId: string,
    inputs: AnalystRunInputs,
    opts?: {
      priorFindings?: ReadonlyArray<AnalystFinding> | Record<string, ReadonlyArray<AnalystFinding>>
      [k: string]: unknown
    },
  ): AsyncIterable<AnalystRunEvent>
}

/**
 * Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and
 * JSONL tail-sinks consume this stream. The loop awaits each
 * callback so a slow sink applies backpressure to the loop's phases
 * (e.g. an SSE write that takes 200ms delays the next phase by
 * 200ms — the loop never out-paces its observer).
 *
 * Forwards registry events verbatim via `analyst` so consumers don't
 * have to wire two streams.
 */
export type AnalystLoopEvent =
  | {
      type: 'baseline-resolved'
      runId: string
      baselineRunId: string | null
      priorFindingCount: number
    }
  | {
      type: 'analyst'
      runId: string
      /** Forwarded verbatim from `AnalystRegistry.runStream`. */
      event: AnalystRunEvent
    }
  | {
      type: 'findings-persisted'
      runId: string
      count: number
    }
  | {
      type: 'diff-computed'
      runId: string
      baselineRunId: string
      appeared: number
      disappeared: number
      persisted: number
      changed: number
    }
  | {
      type: 'knowledge-proposed'
      runId: string
      proposalCount: number
      skipped: number
      errors: number
    }
  | {
      type: 'improvement-proposed'
      runId: string
      editCount: number
      skipped: number
      errors: number
    }
  | {
      type: 'loop-completed'
      runId: string
      durationMs: number
    }
