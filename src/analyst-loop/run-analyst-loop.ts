/**
 * `runAnalystLoop` — the one call agent apps reach for to close the
 * recursive-self-improvement loop.
 *
 *   1. Load baseline findings (last run, or the slice the caller specifies)
 *   2. Run the analyst registry with priorFindings injected
 *   3. Persist the new run's findings to the ledger
 *   4. Diff the new run against the baseline
 *   5. Hand the findings to the knowledge adapter → proposals (and
 *      optionally apply them) → wiki edits
 *   6. Hand the findings to the improvement adapter → prompt / tool /
 *      scaffolding edits (review-only by default)
 *   7. Return a single report the consumer renders / persists / acts on.
 *
 * Adapters are optional: the loop works as a "run + diff + report"
 * primitive when no adapters are wired; it closes end-to-end when
 * both adapters are wired.
 */

import type { AnalystFinding, FindingsDiff } from '@tangle-network/agent-eval'
import { diffFindings } from '@tangle-network/agent-eval'

import type {
  ImprovementReport,
  KnowledgeReport,
  RunAnalystLoopOpts,
  RunAnalystLoopResult,
} from './types'

export async function runAnalystLoop<TProposal = unknown, TEdit = unknown>(
  opts: RunAnalystLoopOpts,
): Promise<RunAnalystLoopResult<TProposal, TEdit>> {
  const log = opts.log ?? defaultLog
  const strategy = opts.priorFindingsStrategy ?? 'per-kind'

  // 1. Resolve baseline + load prior findings.
  const baselineRunId = resolveBaselineRunId(opts)
  const priorAll: ReadonlyArray<AnalystFinding & { run_id: string }> = baselineRunId
    ? (opts.findingsStore?.loadRun(baselineRunId) ?? [])
    : []
  log('baseline resolved', { baselineRunId, prior_findings: priorAll.length })

  // 2. Run the registry. Strategy controls how analysts see priors.
  const priorFindings = buildPriorFindingsInput(priorAll, strategy, opts.registry.list())
  const analystResult = await opts.registry.run(opts.runId, opts.inputs, { priorFindings })
  log('analyst run complete', {
    findings: analystResult.findings.length,
    cost_usd: analystResult.total_cost_usd,
    per_analyst: analystResult.per_analyst.map((s) => ({
      id: s.analyst_id,
      status: s.status,
      n: s.findings_count,
    })),
  })

  // 3. Persist the new run before any side-effecting adapter runs so
  //    the ledger is the source of truth even if an adapter throws.
  if (opts.findingsStore && analystResult.findings.length > 0) {
    await opts.findingsStore.append(opts.runId, analystResult.findings)
  }

  // 4. Diff vs baseline.
  let diff: FindingsDiff | null = null
  if (baselineRunId && analystResult.findings.length > 0) {
    diff = diffFindings(
      priorAll.map((f) => ({ ...f })),
      analystResult.findings.map((f) => ({ ...f, run_id: opts.runId })),
    )
    log('diff vs baseline', {
      appeared: diff.appeared.length,
      disappeared: diff.disappeared.length,
      persisted: diff.persisted.length,
      changed: diff.changed.length,
    })
  }

  // 5. Knowledge adapter — proposals + optional auto-apply.
  let knowledge: KnowledgeReport<TProposal> | null = null
  if (opts.knowledgeAdapter) {
    knowledge = await runKnowledgeAdapter(opts, analystResult.findings, log)
  }

  // 6. Improvement adapter — prompt / tool / scaffolding edits.
  let improvement: ImprovementReport<TEdit> | null = null
  if (opts.improvementAdapter) {
    improvement = await runImprovementAdapter(opts, analystResult.findings, log)
  }

  return {
    runId: opts.runId,
    baselineRunId,
    analystResult,
    diff,
    knowledge,
    improvement,
  }
}

function resolveBaselineRunId(opts: RunAnalystLoopOpts): string | null {
  if (opts.baselineRunId === null) return null
  if (typeof opts.baselineRunId === 'string') return opts.baselineRunId
  if (!opts.findingsStore) return null
  // Auto-pick the most recent run id in the store, excluding the
  // current `runId`. The store stamps each row with `run_id` so a
  // single pass finds the last distinct id without parsing dates.
  const all = opts.findingsStore.loadAll()
  let last: string | null = null
  for (const row of all) {
    if (row.run_id === opts.runId) continue
    last = row.run_id
  }
  return last
}

function buildPriorFindingsInput(
  prior: ReadonlyArray<AnalystFinding & { run_id: string }>,
  strategy: 'per-kind' | 'wildcard' | 'none',
  registry: ReadonlyArray<{ id: string }>,
): ReadonlyArray<AnalystFinding> | Record<string, ReadonlyArray<AnalystFinding>> | undefined {
  if (strategy === 'none' || prior.length === 0) return undefined
  const stripped = prior.map(({ run_id: _run_id, ...rest }) => rest as AnalystFinding)
  if (strategy === 'wildcard') {
    return { '*': stripped }
  }
  // per-kind: registry filters by analyst_id automatically when given
  // an array. We pass the array; analysts that have no prior of their
  // own see undefined (not empty).
  // Defensive: when an analyst id has zero priors AND a sibling has
  // many, the array form still works correctly because the registry
  // filters server-side.
  void registry
  return stripped
}

async function runKnowledgeAdapter<TProposal>(
  opts: RunAnalystLoopOpts,
  findings: ReadonlyArray<AnalystFinding>,
  log: NonNullable<RunAnalystLoopOpts['log']>,
): Promise<KnowledgeReport<TProposal>> {
  const adapter = opts.knowledgeAdapter!
  const batch = await adapter.proposeFromFindings(findings)
  log('knowledge.proposeFromFindings', {
    proposals: batch.proposals.length,
    skipped: batch.skipped,
    errors: batch.errors.length,
  })

  const auto = opts.autoApply?.knowledge ?? false
  const threshold = opts.autoApply?.knowledgeConfidenceThreshold ?? 0.85

  if (!auto || !adapter.apply) {
    return {
      proposals: batch.proposals as TProposal[],
      applied: [],
      skipped: batch.skipped,
      errors: batch.errors,
      withheld_for_review: batch.proposals.length,
    }
  }

  const findingsById = new Map(findings.map((f) => [f.finding_id, f]))
  const safe: TProposal[] = []
  let withheld = 0
  for (const p of batch.proposals as Array<TProposal & { sourceFindingId?: string }>) {
    const src = p.sourceFindingId ? findingsById.get(p.sourceFindingId) : undefined
    if (!src) {
      withheld += 1
      continue
    }
    if (src.confidence < threshold) {
      withheld += 1
      continue
    }
    safe.push(p)
  }
  const result = await adapter.apply(safe)
  log('knowledge.apply', {
    applied: result.written.length,
    withheld_for_review: withheld,
    warnings: result.warnings.length,
  })
  return {
    proposals: batch.proposals as TProposal[],
    applied: result.written,
    skipped: batch.skipped,
    errors: batch.errors,
    withheld_for_review: withheld,
  }
}

async function runImprovementAdapter<TEdit>(
  opts: RunAnalystLoopOpts,
  findings: ReadonlyArray<AnalystFinding>,
  log: NonNullable<RunAnalystLoopOpts['log']>,
): Promise<ImprovementReport<TEdit>> {
  const adapter = opts.improvementAdapter!
  const batch = await adapter.proposeFromFindings(findings)
  log('improvement.proposeFromFindings', {
    edits: batch.edits.length,
    skipped: batch.skipped,
    errors: batch.errors.length,
  })

  const auto = opts.autoApply?.improvement ?? false
  const threshold = opts.autoApply?.improvementConfidenceThreshold ?? 0.9

  if (!auto || !adapter.apply) {
    return {
      edits: batch.edits as TEdit[],
      applied: [],
      skipped: batch.skipped,
      errors: batch.errors,
      withheld_for_review: batch.edits.length,
    }
  }

  const findingsById = new Map(findings.map((f) => [f.finding_id, f]))
  const safe: TEdit[] = []
  let withheld = 0
  for (const e of batch.edits as Array<TEdit & { sourceFindingId?: string }>) {
    const src = e.sourceFindingId ? findingsById.get(e.sourceFindingId) : undefined
    if (!src || src.confidence < threshold) {
      withheld += 1
      continue
    }
    safe.push(e)
  }
  const result = await adapter.apply(safe)
  log('improvement.apply', {
    applied: result.applied.length,
    withheld_for_review: withheld,
    warnings: result.warnings.length,
  })
  return {
    edits: batch.edits as TEdit[],
    applied: result.applied,
    skipped: batch.skipped,
    errors: batch.errors,
    withheld_for_review: withheld,
  }
}

function defaultLog(msg: string, fields?: Record<string, unknown>): void {
  if (fields) console.log(`[analyst-loop] ${msg}`, fields)
  else console.log(`[analyst-loop] ${msg}`)
}
