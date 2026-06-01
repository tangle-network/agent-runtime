/**
 * @experimental
 *
 * `createAnalystSteering` — feed a REAL agent-eval {@link Analyst} into the
 * steering driver's `analyze` seam. Where {@link defaultAnalyze} derives signals
 * from the `Iteration` alone (verdict/error/trajectory, zero model), this runs
 * the substrate's analyst contract over the iteration's trace and maps the
 * structured {@link AnalystFinding}s into {@link SteeringSignal}s the driver
 * acts on.
 *
 * De-dup with the substrate holds: agent-runtime never implements an analyst.
 * The analyst KIND (failure-mode, knowledge-gap, behavioral, …) lives in
 * agent-eval; this module only CONSUMES the `Analyst.analyze()` contract and
 * adapts its output to the loop's steering seam. Wire it as:
 *
 *   planner: createSteeringPlanner({
 *     …,
 *     analyze: createAnalystSteering({
 *       analysts: [createTraceAnalystKind(FAILURE_MODE_KIND_SPEC, { … })],
 *       toInput: (latest) => buildTraceStore(latest.events),
 *       chat,                       // omit → LLM-kind analysts skip, loop survives
 *     }),
 *   })
 *
 * `toInput` is injected for the same reason `decodeTask` is in the sandbox
 * planner: only the caller knows whether its analyst reads a `TraceAnalysisStore`,
 * a `RunRecord`, or a custom input — `Analyst<TInput>` is opaque here.
 */

import type {
  Analyst,
  AnalystContext,
  AnalystFinding,
  ChatClient,
} from '@tangle-network/agent-eval'
import type { Iteration } from '../types'
import { type SteeringSignal, steeringSignalsFromFindings } from './steering-planner'

/** @experimental */
export interface CreateAnalystSteeringOptions<TInput, Task, Output> {
  /**
   * The substrate analysts to run after each shot, in order. Each is the
   * agent-eval `Analyst` contract (`analyze(input, ctx) => AnalystFinding[]`).
   * Findings from all analysts are concatenated and mapped to signals.
   */
  analysts: ReadonlyArray<Analyst<TInput>>
  /**
   * Build the analyst input from the latest attempt (and history). Trace
   * analysts return a `TraceAnalysisStore`; run-record analysts a `RunRecord`;
   * etc. Throwing here degrades to a single `analyst-input-error` signal — the
   * loop is never aborted by an input-construction fault.
   */
  toInput: (
    latest: Iteration<Task, Output>,
    history: ReadonlyArray<Iteration<Task, Output>>,
  ) => TInput | Promise<TInput>
  /**
   * Shared chat client for analysts whose `cost.kind === 'llm'`. When absent,
   * LLM-kind analysts are SKIPPED (not run) with an explicit `analyst-skipped`
   * signal — the driver flies blind for that analyst rather than the pursuit
   * crashing when no model transport is available (e.g. router/platform down).
   * Deterministic analysts (`cost.kind === 'deterministic'`) always run.
   */
  chat?: ChatClient
  /** Per-analyst USD budget forwarded on `AnalystContext`. */
  budgetUsd?: number
  /** Correlation id stamped on the context (defaults to a per-shot id). */
  correlationId?: string
  /** Cancellation forwarded to every analyst via `AnalystContext.signal`. */
  signal?: AbortSignal
  /** Structured logger forwarded on `AnalystContext.log`. */
  log?: (msg: string, fields?: Record<string, unknown>) => void
}

/**
 * @experimental
 *
 * Returns an `analyze` function for {@link CreateSteeringPlannerOptions}. The
 * returned function persists the prior round's findings and feeds them back as
 * `AnalystContext.priorFindings`, so analyst kinds can keep `finding_id`s stable
 * across shots and escalate a finding that reappears without remediation.
 */
export function createAnalystSteering<TInput, Task, Output>(
  opts: CreateAnalystSteeringOptions<TInput, Task, Output>,
): (
  latest: Iteration<Task, Output>,
  history: ReadonlyArray<Iteration<Task, Output>>,
) => Promise<SteeringSignal[]> {
  if (!Array.isArray(opts.analysts) || opts.analysts.length === 0) {
    throw new Error('createAnalystSteering: at least one analyst is required')
  }
  if (typeof opts.toInput !== 'function') {
    throw new Error('createAnalystSteering: toInput is required')
  }

  // Carries the previous round's findings into the next round's context.
  let priorFindings: AnalystFinding[] = []

  return async (latest, history) => {
    let input: TInput
    try {
      input = await opts.toInput(latest, history)
    } catch (err) {
      // An input-construction fault must not abort the loop — steer this round
      // without analyst signals, but say why.
      return [
        {
          label: 'analyst-input-error',
          detail: `building analyst input failed: ${errMsg(err)}; steering this round without analyst signals`,
          severity: 'info',
        },
      ]
    }

    const ctx: AnalystContext = {
      runId: `loop-iter-${latest.index}`,
      correlationId: opts.correlationId ?? `steering-${latest.agentRunName}-${latest.index}`,
      ...(opts.chat ? { chat: opts.chat } : {}),
      ...(opts.budgetUsd !== undefined ? { budgetUsd: opts.budgetUsd } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.log ? { log: opts.log } : {}),
      ...(priorFindings.length > 0 ? { priorFindings } : {}),
    }

    const signals: SteeringSignal[] = []
    const roundFindings: AnalystFinding[] = []

    for (const analyst of opts.analysts) {
      // An LLM analyst with no chat client cannot run — surface it as an
      // explicit info signal instead of silently dropping the analyst.
      if (analyst.cost.kind === 'llm' && !opts.chat) {
        signals.push({
          label: 'analyst-skipped',
          detail: `analyst "${analyst.id}" needs an LLM chat client (cost.kind=llm) but none was provided; its signal is unavailable this round`,
          severity: 'info',
        })
        continue
      }
      try {
        const findings = await analyst.analyze(input, ctx)
        roundFindings.push(...findings)
        signals.push(...steeringSignalsFromFindings(findings))
      } catch (err) {
        // Per-analyst isolation: one failing analyst degrades to an info signal
        // and the rest still run. (createSteeringPlanner also guards the whole
        // analyze call, but this keeps a single fault from blinding every analyst.)
        signals.push({
          label: 'analyst-error',
          detail: `analyst "${analyst.id}" failed: ${errMsg(err)}`,
          severity: 'info',
        })
      }
    }

    priorFindings = roundFindings
    return signals
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
