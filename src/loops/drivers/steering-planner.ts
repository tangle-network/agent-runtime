/**
 * @experimental
 *
 * `createSteeringPlanner` — the driver gets EYES. Where {@link createSandboxPlanner}
 * shows the planner only a truncated `summarizeHistory` text blob (verdict +
 * 600-char output), the steering planner shows the driver the worker's FULL
 * last output, the per-shot score trajectory, and a set of injected
 * {@link SteeringSignal}s (analyst findings over the worker's trace), then
 * instructs it to emit a refined task that STEERS the next attempt at the
 * concrete fix the signals point to.
 *
 * This is the fix for degenerate multi-shot loops: a blind planner replays the
 * root task (N identical shots, best-of-N collapses to single-shot); a steering
 * planner reads what failed and directs the next shot to differ in the right
 * direction. The steering rides in the refined `task` — no new `TopologyMove`
 * kind, zero kernel-contract change.
 *
 * The analyst is INJECTED (like `refine`'s `refineTask` and `dynamic`'s
 * planner): a test drives a deterministic `analyze`; production wires
 * agent-eval's model-agnostic behavioral analyst — cheap enough to run after
 * every shot. agent-runtime never re-implements the analyst (that KIND lives in
 * the substrate); it only consumes its signals here.
 *
 * Implementation is `createSandboxPlanner` with a steering-aware async
 * `buildPrompt`, so the boot/parse/decode/PlannerError path is the proven one.
 */

import type { Iteration } from '../types'
import type { PlannerContext, TopologyPlanner } from './dynamic'
import { type CreateSandboxPlannerOptions, createSandboxPlanner } from './sandbox-planner'

/**
 * One analyst observation about the latest worker attempt the driver should act
 * on. `label` is a short cluster tag (e.g. `tool-monoculture`, `no-improvement`),
 * `detail` carries the evidence + numbers (no scalar collapse — the driver sees
 * the facts, not a single grade).
 */
export interface SteeringSignal {
  label: string
  detail: string
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info'
}

/**
 * Structural shape of an analyst finding — compatible with agent-eval's
 * `AnalystFinding` without importing it, so agent-runtime stays decoupled from
 * the substrate's concrete type (the dep direction allows the import, but the
 * structural seam keeps this planner usable with any finding source).
 */
export interface SteeringFindingLike {
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info'
  claim: string
  subject?: string
  area?: string
  recommended_action?: string
}

/**
 * Map analyst findings → steering signals. The production wiring for
 * `analyze`:
 *
 *   analyze: async (latest) =>
 *     steeringSignalsFromFindings(await behavioralAnalyst(latest.events))
 *
 * Carries the finding's claim (+ recommended action) as the steer detail so the
 * driver gets the concrete fix, not a collapsed grade.
 */
export function steeringSignalsFromFindings(
  findings: readonly SteeringFindingLike[],
): SteeringSignal[] {
  return findings.map((f) => ({
    label: f.subject ?? f.area ?? 'finding',
    detail: f.recommended_action ? `${f.claim} → ${f.recommended_action}` : f.claim,
    severity: f.severity ?? 'medium',
  }))
}

/** @experimental */
export interface CreateSteeringPlannerOptions<Task, Output>
  extends CreateSandboxPlannerOptions<Task, Output> {
  /**
   * Derive steering signals from the latest worker attempt (and history).
   * Injected: a test passes a deterministic fn; production wires agent-eval's
   * behavioral analyst over `latest.events`. Defaults to {@link defaultAnalyze}
   * (verdict/error/trajectory-derived — zero model, always available).
   */
  analyze?: (
    latest: Iteration<Task, Output>,
    history: ReadonlyArray<Iteration<Task, Output>>,
  ) => SteeringSignal[] | Promise<SteeringSignal[]>
  /** Max chars of the worker's raw output shown to the driver (default 4000). */
  maxOutputChars?: number
  /**
   * Observability hook: fires once per planning round with the signals the
   * driver was shown (after `analyze`, before the driver runs). This is the
   * research seam — recording what the driver saw lets downstream analysts
   * judge whether it steered well. The chosen move is already on the loop's
   * `loop.plan` trace; `iterationIndex` correlates the two. Never throws into
   * the loop (errors are swallowed).
   */
  onSteer?: (info: { iterationIndex: number; signals: SteeringSignal[] }) => void
}

/** @experimental */
export function createSteeringPlanner<Task, Output>(
  opts: CreateSteeringPlannerOptions<Task, Output>,
): TopologyPlanner<Task, Output> {
  const analyze = opts.analyze ?? defaultAnalyze
  const maxOutputChars = opts.maxOutputChars ?? 4000
  // Caller may still override the prompt entirely; otherwise compose the
  // steering prompt (which runs the injected analyst — hence async).
  const buildPrompt =
    opts.buildPrompt ??
    (async (ctx: PlannerContext<Task, Output>): Promise<string> => {
      const latest = ctx.history.at(-1)
      // Graceful degradation: a failing analyst must NOT crash the loop — the
      // driver flies blind for this round with an explicit signal saying so,
      // rather than the whole pursuit aborting on a transient analyst fault.
      let signals: SteeringSignal[] = []
      if (latest) {
        try {
          signals = await analyze(latest, ctx.history)
        } catch (err) {
          signals = [
            {
              label: 'analyst-unavailable',
              detail: `steering analyst failed (${err instanceof Error ? err.message : String(err)}); steering this round without signals`,
              severity: 'info',
            },
          ]
        }
      }
      try {
        opts.onSteer?.({ iterationIndex: ctx.iterationsSpent, signals })
      } catch {
        // Observability must never break the loop.
      }
      return buildSteeringPrompt(ctx, signals, maxOutputChars)
    })
  return createSandboxPlanner({ ...opts, buildPrompt })
}

/**
 * Zero-model default analyst: everything derivable from the `Iteration` without
 * an LLM — validity, error, and whether the score actually moved. Mirrors the
 * deterministic-behavioral spirit of the substrate analyst so the planner is
 * useful even before a richer analyst is wired.
 */
export function defaultAnalyze<Task, Output>(
  latest: Iteration<Task, Output>,
  history: ReadonlyArray<Iteration<Task, Output>>,
): SteeringSignal[] {
  const signals: SteeringSignal[] = []
  const score = latest.verdict?.score
  const scoreStr = typeof score === 'number' ? score.toFixed(3) : 'n/a'

  if (latest.error) {
    signals.push({
      label: 'errored-attempt',
      detail: `attempt ${latest.index} threw: ${latest.error.message}`,
      severity: 'critical',
    })
  } else if (latest.verdict && !latest.verdict.valid) {
    signals.push({
      label: 'invalid-attempt',
      detail: `attempt ${latest.index} failed the validator (score ${scoreStr}); it did not satisfy the success criteria`,
      severity: 'high',
    })
  }

  if (history.length >= 2) {
    const prev = history[history.length - 2]
    const ps = prev?.verdict?.score
    if (typeof ps === 'number' && typeof score === 'number' && score <= ps) {
      signals.push({
        label: 'no-improvement',
        detail: `score did not rise (${ps.toFixed(3)} → ${scoreStr}); the last refinement did not help — change strategy, do not repeat it`,
        severity: 'high',
      })
    }
  }

  return signals
}

function buildSteeringPrompt<Task, Output>(
  ctx: PlannerContext<Task, Output>,
  signals: SteeringSignal[],
  maxOutputChars: number,
): string {
  const latest = ctx.history.at(-1)
  const fullOutput =
    latest === undefined ? '(none)' : truncate(safeJson(latest.output), maxOutputChars)
  const trajectory = ctx.history.map((it) => ({
    index: it.index,
    agent: it.agentRunName,
    valid: it.verdict?.valid,
    score: it.verdict?.score,
  }))

  return [
    'You are the loop DRIVER. You do not do the work — you read what the worker produced and STEER the next attempt.',
    '',
    `Root task:\n${safeJson(ctx.task)}`,
    '',
    `Iterations spent: ${ctx.iterationsSpent}. Remaining before the hard cap: ${ctx.iterationsRemaining}.`,
    '',
    `Score trajectory (index, agent, valid, score):\n${safeJson(trajectory)}`,
    '',
    ctx.history.length === 0
      ? 'No attempts yet.'
      : `Latest worker output (full, truncated to ${maxOutputChars} chars):\n${fullOutput}`,
    '',
    signals.length > 0
      ? `Analyst signals on the latest attempt — your steer MUST address these:\n${safeJson(signals)}`
      : 'No analyst signals on the latest attempt.',
    '',
    'Choose ONE move and emit it as a fenced JSON block:',
    '  - {"kind":"refine","tasks":[<task>],"rationale":"..."} — ONE more attempt. The task you put here IS the steer: rewrite the root task to direct the worker at the concrete fix the signals point to (name the tool, section, or value to change). Do NOT replay the root task unchanged — that repeats the failure.',
    '  - {"kind":"fanout","tasks":[<task>,<task>],"rationale":"..."} — N divergent steered attempts when the signals are ambiguous (or "n": N for N copies of the root task).',
    '  - {"kind":"stop","rationale":"..."} — the latest attempt is already valid, or no steer can help.',
    '',
    'Stop the moment an attempt is valid. Otherwise steer concretely — every refined task must differ from the last in the direction the signals indicate.',
    'Emit ONLY the JSON block.',
  ].join('\n')
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated ${text.length - max} chars]` : text
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
