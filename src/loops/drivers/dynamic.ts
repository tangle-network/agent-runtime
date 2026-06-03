/**
 * @experimental
 *
 * Dynamic driver — the agent authors the loop topology at runtime.
 *
 * Where `refine` and `fanout-vote` encode a fixed shape as a pure function of
 * history, this driver delegates the per-round shape to an injected
 * `TopologyPlanner`. Each round the planner inspects the task + iteration
 * history and emits one `TopologyMove`:
 *   - `refine` → one task next round (optionally rewritten from the prior attempt)
 *   - `fanout` → N tasks next round (the kernel round-robins `agentRuns`, so a
 *     2-harness fanout dispatches branch 0 to harness A and branch 1 to harness B)
 *   - `stop`   → terminate; the kernel selects the winner across all iterations
 *
 * The planner is the brain; this driver is the structure. It maps moves onto
 * the kernel's `plan`/`decide` contract, enforces the iteration + fanout caps,
 * and fails loud on a malformed move. The planner is injected exactly like
 * `refine`'s `refineTask` and `fanout-vote`'s `selector` — so a test can drive
 * a deterministic policy through the real kernel, and production can wire it to
 * an LLM via `createSandboxPlanner`.
 *
 * Topology is orthogonal to harness: the planner never names a backend. Which
 * harness runs a branch is decided by the `AgentRunSpec` the kernel round-robins
 * to, so one dynamic driver works across claude-code, codex, opencode, pi —
 * including fanning a single round across several at once.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import { PlannerError, ValidationError } from '../../errors'
import type { Driver, Iteration, LoopPlanDescription } from '../types'
import { stringifySafe } from '../util'

/** Terminal once `decide` returns `'done'` (a kernel terminal decision). */
export type DynamicDecision = 'continue' | 'done'

/**
 * One topology decision for the next round. `fanout` carries explicit tasks
 * rather than a count so the planner can issue heterogeneous branches (a
 * different sub-task per harness); pass N copies of one task for a homogeneous
 * fanout that relies on `agentRuns` diversity instead.
 *
 * @experimental
 */
export type TopologyMove<Task> =
  | { kind: 'refine'; task: Task; rationale?: string; parentIndex?: number }
  | { kind: 'fanout'; tasks: Task[]; rationale?: string; parentIndex?: number }
  // `stop` carries no parentIndex — it never produces an edge, so the
  // describePlan guard below reads parentIndex only on refine/fanout.
  | { kind: 'stop'; rationale?: string }
  // `select` — the planner AUTHORS the winner: terminal like stop, but the kernel
  // uses iteration `index` as the winner instead of its argmax. The selector role
  // made emittable. No edge → no parentIndex.
  | { kind: 'select'; index: number; rationale?: string }

/** @experimental */
export interface PlannerContext<Task, Output> {
  /** The root task the loop was invoked with — stable across rounds. */
  task: Task
  /** Every iteration so far, in dispatch order, with outputs + verdicts. */
  history: ReadonlyArray<Iteration<Task, Output>>
  /** `history.length` — iterations already spent. */
  iterationsSpent: number
  /** Iterations left before the driver's `maxIterations` cap forces a stop. */
  iterationsRemaining: number
  /**
   * Trace-analyst findings about the attempts so far — populated only when an
   * `analyze` hook is wired into the driver (see CreateDynamicDriverOptions).
   * This is the channel that lets the planner steer from the DIAGNOSIS
   * (`f(trace, findings)`), not the verdict score alone. Undefined = no analyst
   * wired (the planner runs exactly as before). @experimental
   */
  analyses?: ReadonlyArray<AnalystFinding>
}

/**
 * Chooses the next topology move from the task + history. Sync or async; an
 * async planner is where an LLM call goes (see `createSandboxPlanner`).
 *
 * @experimental
 */
export type TopologyPlanner<Task, Output> = (
  ctx: PlannerContext<Task, Output>,
) => TopologyMove<Task> | Promise<TopologyMove<Task>>

/**
 * Input to the optional `analyze` hook: the root task + the trace so far. The
 * hook turns this into `AnalystFinding[]` — the caller's seam to `runAnalystLoop`.
 * @experimental
 */
export interface AnalyzeInput<Task, Output> {
  task: Task
  history: ReadonlyArray<Iteration<Task, Output>>
}

/** @experimental */
export interface CreateDynamicDriverOptions<Task, Output> {
  /** The agent-authored topology policy. Invoked once per round in `plan`. */
  planner: TopologyPlanner<Task, Output>
  /**
   * Optional trace-analyst hook. When set, the driver calls it each round AFTER
   * the first (a trace must exist) and BEFORE the planner, then passes the
   * findings to the planner via `PlannerContext.analyses` — so the planner
   * decides from the diagnosis, not the verdict score alone. This is the seam to
   * `runAnalystLoop`; it lives on the driver so `run-loop` stays analyst-free
   * (the layering rule). Fail-loud: a throwing or non-array hook aborts the round
   * (no silent empty findings).
   */
  analyze?: (
    input: AnalyzeInput<Task, Output>,
  ) => ReadonlyArray<AnalystFinding> | Promise<ReadonlyArray<AnalystFinding>>
  /**
   * Hard safety cap on total iterations. When reached, the driver stops before
   * consulting the planner. Default 8. Set the kernel's `runLoop`
   * `maxIterations >= ` this so the driver's cap governs and the loop closes on
   * a clean `'done'` rather than a truncated `'continue'`.
   */
  maxIterations?: number
  /** Max branches a single `fanout` move may dispatch. Default 4. */
  maxFanout?: number
  /** Stable identifier surfaced in trace events. Default `'dynamic'`. */
  name?: string
}

/** @experimental */
export function createDynamicDriver<Task, Output>(
  options: CreateDynamicDriverOptions<Task, Output>,
): Driver<Task, Output, DynamicDecision> {
  if (typeof options.planner !== 'function') {
    throw new ValidationError('createDynamicDriver: planner must be a function')
  }
  const maxIterations = options.maxIterations ?? 8
  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new ValidationError('createDynamicDriver: maxIterations must be > 0')
  }
  const maxFanout = options.maxFanout ?? 4
  if (!Number.isFinite(maxFanout) || maxFanout < 1) {
    throw new ValidationError('createDynamicDriver: maxFanout must be >= 1')
  }

  // The kernel calls plan(), runs the batch, then calls decide() — strictly
  // sequential, one driver instance per loop. Caching the move the planner
  // chose this round lets decide() report terminality without re-invoking the
  // planner (which would double every LLM call).
  let pending: TopologyMove<Task> | undefined

  return {
    name: options.name ?? 'dynamic',
    async plan(task, history) {
      if (history.length >= maxIterations) {
        pending = { kind: 'stop', rationale: `maxIterations (${maxIterations}) reached` }
        return []
      }
      // The wire: turn the trace into a diagnosis BEFORE the planner decides, so
      // the move is f(trace, findings), not f(verdict-score). Skipped on round 0
      // (no trace to analyze). Fail-loud — a broken analyst aborts the round.
      const analyses =
        options.analyze && history.length > 0
          ? await runAnalyze(options.analyze, task, history)
          : undefined
      const move = await options.planner({
        task,
        history,
        iterationsSpent: history.length,
        iterationsRemaining: maxIterations - history.length,
        ...(analyses ? { analyses } : {}),
      })
      pending = validateMove(move, maxFanout)
      if (pending.kind === 'select') {
        // The planner may override the kernel's argmax, but not invent a winner:
        // the selected iteration must be a completed attempt that produced output.
        // Range + output are checked here, where history is in scope. Fail loud.
        const iter = history[pending.index]
        if (!iter || iter.output === undefined) {
          throw new PlannerError(
            `dynamic planner select.index ${pending.index} is not a completed iteration with output (history length ${history.length})`,
          )
        }
      }
      switch (pending.kind) {
        case 'refine':
          return [pending.task]
        case 'fanout':
          return pending.tasks
        case 'stop':
        case 'select':
          return []
      }
    },
    decide() {
      // pending is set by the plan() call that immediately precedes every
      // decide(). `stop` and `select` terminate; refine/fanout keep looping so
      // plan() — and thus the planner — runs again next round.
      return pending?.kind === 'stop' || pending?.kind === 'select' ? 'done' : 'continue'
    },
    describePlan() {
      // Surface the move the planner just chose (kind + rationale + an optional
      // DECLARED branch source) so the kernel's loop.plan trace carries the
      // agent's intent — including faithful edge lineage when the planner
      // branched off a specific (non-winner) iteration. `pending` is the move
      // set by the preceding plan().
      if (!pending) return undefined
      const out: LoopPlanDescription = { kind: pending.kind }
      if (pending.rationale !== undefined) out.rationale = pending.rationale
      if (
        (pending.kind === 'refine' || pending.kind === 'fanout') &&
        pending.parentIndex !== undefined
      ) {
        out.parentIndex = pending.parentIndex
      }
      return out
    },
    selectWinner(history) {
      // Authored winner: only when the last move was `select`. The kernel calls
      // this at finalize (absent a caller-supplied selectWinner); returning
      // undefined for every other move falls through to the default argmax. The
      // selected iteration's output presence was enforced in plan().
      if (pending?.kind !== 'select') return undefined
      const iter = history[pending.index]
      if (!iter || iter.output === undefined) return undefined
      return {
        task: iter.task,
        output: iter.output,
        verdict: iter.verdict,
        iterationIndex: iter.index,
        agentRunName: iter.agentRunName,
      }
    },
  }
}

function validateMove<Task>(move: TopologyMove<Task>, maxFanout: number): TopologyMove<Task> {
  if (!move || typeof move !== 'object' || typeof (move as { kind?: unknown }).kind !== 'string') {
    throw new PlannerError(`dynamic planner returned a non-move value: ${stringifySafe(move)}`)
  }
  switch (move.kind) {
    case 'refine':
      return move
    case 'stop':
      return move
    case 'select': {
      if (!Number.isInteger(move.index) || move.index < 0) {
        throw new PlannerError(
          `dynamic planner select move must carry a non-negative integer index, got ${stringifySafe(move.index)}`,
        )
      }
      return move
    }
    case 'fanout': {
      if (!Array.isArray(move.tasks) || move.tasks.length === 0) {
        throw new PlannerError('dynamic planner fanout move must carry a non-empty tasks[]')
      }
      if (move.tasks.length <= maxFanout) return move
      // Clamp rather than reject — over-fanning is a budget concern, not a
      // structural error. The clamp is recorded in the rationale for traces.
      return {
        kind: 'fanout',
        tasks: move.tasks.slice(0, maxFanout),
        rationale: `${move.rationale ?? ''} [clamped ${move.tasks.length}→${maxFanout}]`.trim(),
      }
    }
    default:
      throw new PlannerError(
        `dynamic planner returned unknown move kind: ${stringifySafe((move as { kind: unknown }).kind)}`,
      )
  }
}

/** Call the analyze hook and fail loud on a non-array return (no silent empty). */
async function runAnalyze<Task, Output>(
  analyze: NonNullable<CreateDynamicDriverOptions<Task, Output>['analyze']>,
  task: Task,
  history: ReadonlyArray<Iteration<Task, Output>>,
): Promise<ReadonlyArray<AnalystFinding>> {
  const findings = await analyze({ task, history })
  if (!Array.isArray(findings)) {
    throw new PlannerError(
      `createDynamicDriver: analyze hook must return AnalystFinding[], got ${stringifySafe(findings)}`,
    )
  }
  assertTraceDerivedFindings(findings)
  return findings
}

/**
 * Steer-firewall (selector ≠ judge). The diagnosis the driver steers from must be
 * TRACE-derived, never JUDGE-derived. A finding whose evidence is a judge/verdict
 * score (an EvidenceRef of `kind:'metric'` with a verdict/judge/score uri scheme)
 * would smuggle the external write-only judge back into steering — the one coupling
 * the architecture forbids. This is a PROVENANCE check, not a content check:
 * span/event/artifact/finding refs and empty-evidence findings are allowed; only a
 * judge-scheme metric ref is rejected. Fail loud — a tainted finding aborts the round.
 */
const JUDGE_EVIDENCE_URI = /^(verdict|judge|score)\b/i
function assertTraceDerivedFindings(findings: ReadonlyArray<AnalystFinding>): void {
  for (const f of findings) {
    for (const ref of f.evidence_refs ?? []) {
      if (ref.kind === 'metric' && JUDGE_EVIDENCE_URI.test(ref.uri)) {
        throw new PlannerError(
          `steer-firewall: finding ${stringifySafe(f.finding_id)} cites judge-derived evidence (${stringifySafe(ref.uri)}); analyses fed to the driver must be trace-derived, not judge-derived (selector ≠ judge)`,
        )
      }
    }
  }
}

/**
 * Compact, planner-facing rendering of trace-analyst findings — the diagnosis the
 * planner steers from. Empty input renders to '' (callers omit the section). Shows
 * severity·area·claim·recommended_action·confidence; raw evidence_refs/metadata are
 * for renderers that know the analyst, not the topology decision.
 * @experimental
 */
export function renderAnalyses(findings: ReadonlyArray<AnalystFinding>): string {
  if (findings.length === 0) return ''
  const rows = findings.map((f) => {
    const action = f.recommended_action ? ` → ${f.recommended_action}` : ''
    return `  - [${f.severity}/${f.area}] ${f.claim}${action} (conf ${f.confidence.toFixed(2)})`
  })
  return `Trace-analyst findings (diagnosis of the attempts so far — steer from these, not the verdict score alone):\n${rows.join('\n')}`
}

/** One row of the planner-facing history summary. @experimental */
export interface HistorySummaryRow {
  index: number
  agentRunName: string
  valid?: boolean
  score?: number
  error?: string
  output?: string
}

/**
 * Compact, planner-friendly view of iteration history — what an LLM planner
 * needs to choose the next move without the raw event streams. Output is
 * truncated so a long run's prompt stays bounded.
 *
 * @experimental
 */
export function summarizeHistory<Task, Output>(
  history: ReadonlyArray<Iteration<Task, Output>>,
  opts: { maxOutputChars?: number } = {},
): HistorySummaryRow[] {
  const maxOutputChars = opts.maxOutputChars ?? 600
  return history.map((iter) => {
    const row: HistorySummaryRow = { index: iter.index, agentRunName: iter.agentRunName }
    if (iter.verdict) {
      row.valid = iter.verdict.valid
      if (typeof iter.verdict.score === 'number') row.score = iter.verdict.score
    }
    if (iter.error) row.error = iter.error.message
    if (iter.output !== undefined) {
      row.output = stringifySafe(iter.output, { max: maxOutputChars })
    }
    return row
  })
}
