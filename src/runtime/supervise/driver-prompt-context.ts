import { budgetOverspendText, type SettledWorker } from '../../mcp/tools/coordination'
import { chargedTokens } from '../util'
import type { PriorCoordination } from './coordination-log'
import type { BudgetViolation, NodeSnapshot, ResumedWork, TreeView } from './types'

/** The default chapter-close prompt: the brain summarizes its OWN progress for its future self before
 *  the detailed history is dropped. Emphasis on PENDING work — the part a too-eager chapter-close
 *  loses (the coding-burn counter-finding: closing after one fix leaves integration bugs uncircled). */
export const distillInstruction =
  'CONTEXT COMPACTION. Your detailed turn-by-turn history is about to be discarded to free your context window. Write a COMPLETE, compact handoff note for your future self so you can keep going without it. Cover: (1) what you have accomplished; (2) every worker you spawned and its current status/result; (3) what subtasks remain unfinished, failing, or unverified — be specific and exhaustive here, this is the part you must not lose; (4) your immediate next action. Do not call any tools; respond with the note only.'

/** Factual ground truth for the digest — the live worker roster from Scope plus the delivered-result
 *  ledger, independent of whatever the brain's prose summary captures. */
export function summarizeRoster(view: TreeView, settled: ReadonlyArray<SettledWorker>): string {
  if (view.nodes.length === 0) return 'Workers in current live scope: none yet.'
  const settledById = new Map(settled.map((w) => [w.id, w]))
  const lines = view.nodes.map((node) => formatRosterNode(node, settledById.get(node.id)))
  return `Workers in current live scope (ground truth from the run, ${view.nodes.length} total, ${view.inFlight} in flight):\n${lines.join('\n')}`
}

function formatRosterNode(node: NodeSnapshot, settled?: SettledWorker): string {
  const result =
    settled?.status === 'done'
      ? `, delivered=${settled.valid ?? false}${
          settled.score !== undefined ? `, score=${settled.score}` : ''
        }${settled.outRef ? `, outRef=${settled.outRef}` : ''}`
      : settled?.status === 'down'
        ? `, reason=${settled.reason ?? 'unknown'}`
        : node.outRef
          ? `, outRef=${node.outRef}`
          : ''
  const violation = settled?.budgetViolation ?? node.budgetViolation
  // A worker that settled done past its budget is stopped work, not finished work: say so where
  // the status is read.
  const status =
    node.status === 'done' && violation !== undefined
      ? `done (${budgetStopClause(violation)})`
      : node.status
  const overspend =
    node.status === 'done' || violation === undefined ? '' : `, ${budgetStopClause(violation)}`
  return `- ${node.id}: ${status}, label=${node.label}, runtime=${node.runtime}${result}${overspend}`
}

/** `budget stop: tokens 235,857 of 42,000`: the roster's name for a budget overspend. */
function budgetStopClause(violation: BudgetViolation): string {
  return `budget stop: ${budgetOverspendText(violation)}`
}

/**
 * The factual context a resumed driver starts from — everything the durable stores prove about
 * the prior process(es): committed settlements, per-key states (completed / in-doubt / failed),
 * re-armed waits, carried-over questions/findings/continuation receipts, and spend already paid.
 * Injected as the brain's first user-context on a resumed run so it continues from unresolved work;
 * old continuation receipts are evidence and are never auto-delivered.
 */
export function resumeBrief(
  resume: ResumedWork<unknown>,
  current: TreeView,
  prior?: PriorCoordination,
): string {
  const lines: string[] = [
    'RESUME: this run continues a prior coordinator process. Its committed work is restored',
    'below and already counts toward the deliverable — do NOT redo it. Continue from the',
    'unresolved work only.',
    '',
    `Committed workers (${resume.settled.length}):`,
  ]
  if (resume.settled.length === 0) lines.push('- none')
  for (const s of resume.settled) {
    lines.push(
      s.kind === 'done'
        ? `- ${s.handle.id} (${s.handle.label}): ${
            s.budgetViolation === undefined
              ? 'done'
              : `done (${budgetStopClause(s.budgetViolation)})`
          }, score=${s.verdict?.score ?? 0}, valid=${s.verdict?.valid ?? false}, outRef=${s.outRef}`
        : `- ${s.handle.id} (${s.handle.label}): down, reason=${s.reason}${
            s.budgetViolation === undefined ? '' : `, ${budgetStopClause(s.budgetViolation)}`
          }`,
    )
  }
  const byState = (state: 'completed' | 'in-doubt' | 'down') =>
    [...resume.keys].filter(([, v]) => v.state === state)
  const completed = byState('completed')
  const currentIds = new Set(current.nodes.map((node) => node.id))
  const recovered = byState('in-doubt').filter(([, value]) => currentIds.has(value.id))
  const inDoubt = byState('in-doubt').filter(([, value]) => !currentIds.has(value.id))
  const failed = byState('down')
  if (completed.length > 0) {
    lines.push(
      '',
      'COMPLETED keys — spawn_worker with the same key returns the finished result, spending nothing:',
      ...completed.map(([k, v]) => `- ${k} → ${v.id} (${v.label})`),
    )
  }
  if (recovered.length > 0) {
    lines.push(
      '',
      'Recovered keys are attached to this scope. Their results arrive when you are woken; coordinate with their original workers:',
      ...recovered.map(([key, value]) => `- ${key} → ${value.id} (${value.label})`),
    )
  }
  if (inDoubt.length > 0) {
    lines.push(
      '',
      'Keys IN DOUBT — a prior process recorded them as started but never recorded a terminal receipt. Do NOT spawn a replacement under these keys; inspect or recover each exact prior execution first:',
      ...inDoubt.map(([k, v]) => `- ${k} (prior attempt ${v.id}, ${v.label})`),
    )
  }
  if (failed.length > 0) {
    lines.push(
      '',
      'Keys whose prior attempt FAILED (settled down) — spawn_worker with the same key retries:',
      ...failed.map(([k, v]) => `- ${k} (prior attempt ${v.id}, ${v.label})`),
    )
  }
  appendPriorCoordination(lines, prior)
  const spent = resume.priorSpend
  lines.push(
    '',
    'Budget the run ALREADY spent before this process (it counts toward the run total):',
    // `charged` is what the token cap debited: newly-presented tokens, not the rolled-up prompt
    // total, which counts a cached prefix again on every turn that reads it. A driver told the
    // rolled-up number would read a cache-heavy resume as near-exhaustion of a cap it has barely
    // touched.
    `- child work: tokens charged=${chargedTokens(spent.childWork.tokens)} (in=${spent.childWork.tokens.input} out=${spent.childWork.tokens.output}), usd=${spent.childWork.usd}, iterations=${spent.childWork.iterations}`,
    `- driver inference: tokens charged=${chargedTokens(spent.driverInference.tokens)} (in=${spent.driverInference.tokens.input} out=${spent.driverInference.tokens.output}), usd=${spent.driverInference.usd}`,
  )
  return lines.join('\n')
}

export function hasPriorCoordination(prior?: PriorCoordination): boolean {
  return (
    prior !== undefined &&
    (prior.questions.length > 0 ||
      prior.findings.length > 0 ||
      prior.continuations.length > 0 ||
      prior.deliveryEvidence.length > 0 ||
      prior.records.length > 0)
  )
}

export function priorCoordinationBrief(prior: PriorCoordination): string {
  const lines = [
    'PRIOR COORDINATION EVIDENCE: this logical supervisor ran in an earlier process.',
    'Use the evidence below as context. Never auto-deliver an old continuation; issue a new',
    'authorized instruction only when current live state still warrants it.',
  ]
  appendPriorCoordination(lines, prior)
  return lines.join('\n')
}

function appendPriorCoordination(lines: string[], prior?: PriorCoordination): void {
  const openQuestions = (prior?.questions ?? []).filter(
    (q) => q.status === 'open' || q.status === 'escalated',
  )
  if (openQuestions.length > 0) {
    lines.push(
      '',
      'Questions carried over, still undecided (answer_question decides them; list_questions shows all):',
      ...openQuestions.map(
        (q) => `- [${q.id}] from=${q.from}, urgency=${q.urgency}: ${q.question}`,
      ),
    )
  }
  if ((prior?.findings.length ?? 0) > 0) {
    lines.push(
      '',
      'Analyst findings from the prior process:',
      ...(prior?.findings ?? []).map(
        (f) => `- ${f.analyst} on ${f.fromWorker}: ${safeJson(f.findings)}`,
      ),
    )
  }
  if ((prior?.continuations.length ?? 0) > 0) {
    const attempts = new Set(
      (prior?.deliveryEvidence ?? [])
        .filter((event) => event.type === 'delivery-attempt')
        .map((event) => event.attempt.receiptId),
    )
    const outcomes = new Map(
      (prior?.deliveryEvidence ?? [])
        .filter((event) => event.type === 'steer' || event.type === 'answer')
        .map((event) => [event.down.receiptId, event.down.outcome] as const),
    )
    lines.push(
      '',
      'Authorized continuations committed by the prior process (evidence only; never replayed automatically):',
      ...(prior?.continuations ?? []).map((continuation) => {
        const outcome = outcomes.get(continuation.receiptId)
        const delivery =
          outcome ??
          (attempts.has(continuation.receiptId)
            ? 'unknown-after-crash'
            : 'not-attempted-before-crash')
        return `- receipt=${continuation.receiptId}, ${continuation.kind} → ${continuation.toWorker}, instruction=${continuation.instructionDigest}, delivery=${delivery}`
      }),
    )
  }
}

export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}
