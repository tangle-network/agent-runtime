/**
 * `runAnalystLoop` — the one call agent apps reach for to close the
 * recursive-self-improvement loop.
 *
 *   1. Load baseline findings (last run, or the slice the caller specifies)
 *   2. Run the analyst registry with priorFindings injected
 *   3. Persist the new run's findings to the ledger
 *   4. Diff the new run against the baseline
 *   5. Hand the findings to the knowledge proposal source
 *   6. Hand the findings to the agent-surface proposal source
 *   7. Return a single report the consumer renders / persists / acts on.
 *
 * Proposal sources are optional: the loop also works as a plain
 * "run + diff + report" primitive.
 */

import type { AnalystFinding, AnalystRunResult, FindingsDiff } from '@tangle-network/agent-eval'
import { diffFindings } from '@tangle-network/agent-eval'

import type {
  AnalystLoopEvent,
  AnalystRegistryStreamingLike,
  ImprovementReport,
  KnowledgeReport,
  RunAnalystLoopOpts,
  RunAnalystLoopResult,
} from './types'

/** Analyze a run and apply accepted knowledge and agent-surface proposals. */
export async function runAnalystLoop<TProposal = unknown, TEdit = unknown>(
  opts: RunAnalystLoopOpts,
): Promise<RunAnalystLoopResult<TProposal, TEdit>> {
  const log = opts.log ?? defaultLog
  const strategy = opts.priorFindingsStrategy ?? 'per-kind'
  const emit = makeEmitter(opts.onEvent)
  const startedAt = Date.now()

  // 1. Resolve baseline + load prior findings.
  const baselineRunId = resolveBaselineRunId(opts)
  const priorAll: ReadonlyArray<AnalystFinding & { run_id: string }> = baselineRunId
    ? (opts.findingsStore?.loadRun(baselineRunId) ?? [])
    : []
  log('baseline resolved', { baselineRunId, prior_findings: priorAll.length })
  await emit({
    type: 'baseline-resolved',
    runId: opts.runId,
    baselineRunId,
    priorFindingCount: priorAll.length,
  })

  // 2. Run the registry. Strategy controls how analysts see priors.
  //    When the registry exposes runStream, forward each event verbatim
  //    so subscribers see per-analyst progress in real time.
  const priorFindings = buildPriorFindingsInput(priorAll, strategy, opts.registry.list())
  const analystResult = await runRegistry(opts, priorFindings, emit)
  log('analyst run complete', {
    findings: analystResult.findings.length,
    cost_usd: analystResult.total_cost_usd,
    per_analyst: analystResult.per_analyst.map((s) => ({
      id: s.analyst_id,
      status: s.status,
      n: s.findings_count,
    })),
  })

  // 3. Persist the new run before proposal generation so the ledger remains
  //    the source of truth if a proposal source throws.
  if (opts.findingsStore && analystResult.findings.length > 0) {
    await opts.findingsStore.append(opts.runId, analystResult.findings)
    await emit({
      type: 'findings-persisted',
      runId: opts.runId,
      count: analystResult.findings.length,
    })
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
    await emit({
      type: 'diff-computed',
      runId: opts.runId,
      baselineRunId,
      appeared: diff.appeared.length,
      disappeared: diff.disappeared.length,
      persisted: diff.persisted.length,
      changed: diff.changed.length,
    })
  }

  // 5. Knowledge proposals. This loop never writes live knowledge.
  let knowledge: KnowledgeReport<TProposal> | null = null
  if (opts.knowledgeProposalSource) {
    knowledge = await runKnowledgeProposalSource(opts, analystResult.findings, log, emit)
  }

  // 6. Agent-surface proposals. This loop never writes live agent state.
  let improvement: ImprovementReport<TEdit> | null = null
  if (opts.improvementProposalSource) {
    improvement = await runImprovementProposalSource(opts, analystResult.findings, log, emit)
  }

  await emit({
    type: 'loop-completed',
    runId: opts.runId,
    durationMs: Date.now() - startedAt,
  })

  return {
    runId: opts.runId,
    baselineRunId,
    analystResult,
    diff,
    knowledge,
    improvement,
  }
}

type Emitter = (event: AnalystLoopEvent) => Promise<void>

function makeEmitter(onEvent: RunAnalystLoopOpts['onEvent']): Emitter {
  if (!onEvent) return async () => {}
  return async (event) => {
    await onEvent(event)
  }
}

async function runRegistry(
  opts: RunAnalystLoopOpts,
  priorFindings: ReturnType<typeof buildPriorFindingsInput>,
  emit: Emitter,
): Promise<AnalystRunResult> {
  const reg = opts.registry as AnalystRegistryStreamingLike
  if (typeof reg.runStream === 'function' && opts.onEvent) {
    let final: AnalystRunResult | null = null
    for await (const ev of reg.runStream(opts.runId, opts.inputs, { priorFindings })) {
      await emit({ type: 'analyst', runId: opts.runId, event: ev })
      if (ev.type === 'run-completed') final = ev.result
    }
    if (!final) {
      throw new Error('runAnalystLoop: registry.runStream ended without run-completed event')
    }
    return final
  }
  return opts.registry.run(opts.runId, opts.inputs, { priorFindings })
}

function resolveBaselineRunId(opts: RunAnalystLoopOpts): string | null {
  if (opts.baselineRunId === null) return null
  if (typeof opts.baselineRunId === 'string') return opts.baselineRunId
  if (!opts.findingsStore) return null
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
  void registry
  return stripped
}

async function runKnowledgeProposalSource<TProposal>(
  opts: RunAnalystLoopOpts,
  findings: ReadonlyArray<AnalystFinding>,
  log: NonNullable<RunAnalystLoopOpts['log']>,
  emit: Emitter,
): Promise<KnowledgeReport<TProposal>> {
  const source = opts.knowledgeProposalSource!
  const batch = await source.proposeFromFindings(findings)
  log('knowledge.proposeFromFindings', {
    proposals: batch.proposals.length,
    skipped: batch.skipped,
    errors: batch.errors.length,
  })
  await emit({
    type: 'knowledge-proposed',
    runId: opts.runId,
    proposalCount: batch.proposals.length,
    skipped: batch.skipped,
    errors: batch.errors.length,
  })

  return {
    proposals: batch.proposals as TProposal[],
    skipped: batch.skipped,
    errors: batch.errors,
  }
}

async function runImprovementProposalSource<TEdit>(
  opts: RunAnalystLoopOpts,
  findings: ReadonlyArray<AnalystFinding>,
  log: NonNullable<RunAnalystLoopOpts['log']>,
  emit: Emitter,
): Promise<ImprovementReport<TEdit>> {
  const source = opts.improvementProposalSource!
  const batch = await source.proposeFromFindings(findings)
  log('improvement.proposeFromFindings', {
    edits: batch.edits.length,
    skipped: batch.skipped,
    errors: batch.errors.length,
  })
  await emit({
    type: 'improvement-proposed',
    runId: opts.runId,
    editCount: batch.edits.length,
    skipped: batch.skipped,
    errors: batch.errors.length,
  })

  return {
    edits: batch.edits as TEdit[],
    skipped: batch.skipped,
    errors: batch.errors,
  }
}

function defaultLog(msg: string, fields?: Record<string, unknown>): void {
  if (fields) console.log(`[analyst-loop] ${msg}`, fields)
  else console.log(`[analyst-loop] ${msg}`)
}
