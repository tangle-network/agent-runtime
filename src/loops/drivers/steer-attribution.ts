/**
 * @experimental
 *
 * `attributeSteer` — causal credit-assignment for the loop DRIVER's steer
 * (moonshot #11). When a shot fails, was it the driver's bad steer or the
 * worker's bad execution? This answers it by *measurement*, not opinion:
 * re-dispatch the failed shot under one or more COUNTERFACTUAL steers through
 * the SAME spec/output/validator, score each, and decompose the failure into a
 * driver share (recoverable by a better steer) and a worker share (irreducible
 * even under the best steer).
 *
 * Why loop-native (not agent-eval's `runCounterfactual`): the substrate's
 * counterfactuals are INTRA-run — they mutate a `TrajectoryStep`
 * (swap-model/swap-tool/…) and replay one agent execution. The driver's steer
 * is INTER-shot — it IS the whole task fed to a fresh worker run, not a step in
 * a trajectory. So this owns the re-dispatch orchestration but EMITS the
 * substrate's `CounterfactualResult` shape and reuses `attributeCounterfactuals`
 * for aggregation (consume the types/aggregator; own the loop binding).
 *
 * Cost: each counterfactual is a full worker re-run (sandbox + model spend).
 * `counterfactualSteers` is a bounded caller list and {@link createAttributionAnalyze}
 * is GATED — attribution is opt-in, never automatic.
 */

import type { CounterfactualResult } from '@tangle-network/agent-eval'
import { attributeCounterfactuals, clamp01 } from '@tangle-network/agent-eval'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import { createSandboxForSpec } from '../run-loop'
import type { AgentRunSpec, Iteration, LoopSandboxClient, OutputAdapter, Validator } from '../types'
import type { SteeringSignal } from './steering-planner'

/** Margin below which driver/worker shares are treated as a tie ('mixed'). */
const ATTRIBUTION_MARGIN = 0.05

/** @experimental */
export type SteerAttributionVerdict =
  | 'driver-attributable'
  | 'worker-attributable'
  | 'mixed'
  | 'inconclusive'

/** @experimental */
export interface SteerAttribution<Task> {
  /** Score of the actual (failed) attempt being explained. */
  actualScore: number | null
  /** Best-scoring counterfactual steer (null when none produced a score). */
  best: { steer: Task; score: number } | null
  /** One `CounterfactualResult` per re-dispatched steer (substrate shape). */
  results: CounterfactualResult[]
  /** Per-mutation aggregate via the substrate's `attributeCounterfactuals`. */
  byMutation: ReturnType<typeof attributeCounterfactuals>
  /** Share recoverable by a better steer = clamp01(bestScore − actualScore). */
  driverShare: number
  /** Irreducible failure under the best steer = clamp01(1 − bestScore). */
  workerShare: number
  verdict: SteerAttributionVerdict
}

/** @experimental */
export interface AttributeSteerOptions<Task, Output> {
  client: LoopSandboxClient
  /** The worker spec — the SAME one the real shot used (apples-to-apples). */
  spec: AgentRunSpec<Task>
  output: OutputAdapter<Output>
  /** Required — attribution is a function of scores. */
  validator: Validator<Output>
  /** The failed shot. `iteration.task` is the actual steer; `verdict.score` the outcome. */
  iteration: Iteration<Task, Output>
  /** Alternative steers to re-dispatch (include a strong/oracle steer for a tight worker bound). */
  counterfactualSteers: readonly Task[]
  /** Max concurrent re-dispatches. Default 2 — attribution is expensive. */
  maxConcurrency?: number
  /**
   * Re-dispatch each counterfactual `reps` times and average the scores.
   * Validator scores are noisy; averaging K reps shrinks the noise ~√K so the
   * driver/worker verdict doesn't flip on measurement jitter. Default 1.
   */
  reps?: number
  /**
   * Decision margin: the driver/worker shares must differ by more than this to
   * pick a side; closer than this is `mixed`. Default {@link ATTRIBUTION_MARGIN}
   * (0.05). Raise it above the score noise floor to keep verdicts stable.
   */
  margin?: number
  signal?: AbortSignal
  log?: (msg: string) => void
  /** Label a counterfactual for its `CounterfactualResult.mutation`. Default: index. */
  describeSteer?: (task: Task, index: number) => string
}

/** @experimental */
export async function attributeSteer<Task, Output>(
  opts: AttributeSteerOptions<Task, Output>,
): Promise<SteerAttribution<Task>> {
  if (!opts.client || typeof opts.client.create !== 'function') {
    throw new ValidationError('attributeSteer: client.create is required')
  }
  if (!opts.validator) {
    throw new ValidationError(
      'attributeSteer: a validator is required (attribution scores outcomes)',
    )
  }
  if (!Array.isArray(opts.counterfactualSteers) || opts.counterfactualSteers.length === 0) {
    throw new ValidationError('attributeSteer: at least one counterfactual steer is required')
  }
  const signal = opts.signal ?? new AbortController().signal
  const maxConcurrency = Math.max(1, Math.floor(opts.maxConcurrency ?? 2))
  const reps = Math.max(1, Math.floor(opts.reps ?? 1))
  const margin = opts.margin ?? ATTRIBUTION_MARGIN
  const actualScore = opts.iteration.verdict?.score ?? null
  const originalRunId = `iter-${opts.iteration.index}`
  const describe = opts.describeSteer ?? ((_t, i) => `counterfactual-steer-${i}`)

  // Bounded counterfactual re-dispatch. Each goes through the SAME exec path as
  // a real shot; a failure scores `null` (per-CF isolation) so one bad steer
  // doesn't sink the attribution. With `reps > 1` each steer is re-dispatched K
  // times and averaged, shrinking validator-score noise so the verdict is stable.
  const scores = await mapBounded(opts.counterfactualSteers, maxConcurrency, (steer, index) =>
    reDispatchAveraged(opts, steer, signal, index, reps),
  )

  const results: CounterfactualResult[] = scores.map((score, index) => ({
    counterfactualRunId: `${originalRunId}-cf-${index}`,
    originalRunId,
    // The substrate's mutation union is step-internal; the steer swap is a
    // run-input change, so it's a `custom` mutation with an identity apply —
    // the `describe` carries the semantics, `apply` is unused for inter-shot.
    mutation: {
      kind: 'custom',
      at: 0,
      describe: describe(opts.counterfactualSteers[index] as Task, index),
      apply: (step) => step,
    },
    delta: {
      originalOutcomeScore: actualScore,
      counterfactualOutcomeScore: score,
      deltaScore: score !== null && actualScore !== null ? score - actualScore : null,
    },
  }))

  let best: { steer: Task; score: number } | null = null
  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index]
    if (score == null) continue
    if (best === null || score > best.score) {
      best = { steer: opts.counterfactualSteers[index] as Task, score }
    }
  }

  const driverShare = best ? clamp01(best.score - (actualScore ?? 0)) : 0
  const workerShare = best
    ? clamp01(1 - best.score)
    : actualScore !== null
      ? clamp01(1 - actualScore)
      : 1
  const verdict = decideVerdict(best !== null, driverShare, workerShare, margin)

  opts.log?.(
    `steer attribution for iter ${opts.iteration.index}: verdict=${verdict} driverShare=${driverShare.toFixed(2)} workerShare=${workerShare.toFixed(2)} (ran ${opts.counterfactualSteers.length} counterfactual${opts.counterfactualSteers.length === 1 ? '' : 's'})`,
  )

  return {
    actualScore,
    best,
    results,
    byMutation: attributeCounterfactuals(results),
    driverShare,
    workerShare,
    verdict,
  }
}

function decideVerdict(
  hasBest: boolean,
  driverShare: number,
  workerShare: number,
  margin: number,
): SteerAttributionVerdict {
  if (!hasBest) return 'inconclusive'
  if (driverShare >= workerShare + margin) return 'driver-attributable'
  if (workerShare >= driverShare + margin) return 'worker-attributable'
  return 'mixed'
}

/**
 * Map a {@link SteerAttribution} to a {@link SteeringSignal} so the verdict
 * feeds back into the steering driver — the loop closure (#11 → #16/#10).
 */
export function steerAttributionSignal<Task>(attr: SteerAttribution<Task>): SteeringSignal {
  const a = attr.actualScore === null ? 'n/a' : attr.actualScore.toFixed(3)
  const b = attr.best ? attr.best.score.toFixed(3) : 'n/a'
  switch (attr.verdict) {
    case 'driver-attributable':
      return {
        label: 'driver-attributable',
        detail: `a counterfactual steer scored ${b} vs the attempt's ${a} — the STEER was the bottleneck, not the worker; adopt the stronger steer rather than replaying`,
        severity: 'high',
      }
    case 'worker-attributable':
      return {
        label: 'worker-attributable',
        detail: `even the best counterfactual steer scored only ${b} (attempt ${a}) — the WORKER cannot execute this task; stop re-steering and change the worker profile/tools/model`,
        severity: 'high',
      }
    case 'mixed':
      return {
        label: 'mixed-attribution',
        detail: `steer and execution both contribute (driverShare ${attr.driverShare.toFixed(2)}, workerShare ${attr.workerShare.toFixed(2)}); a better steer helps but won't fully fix it`,
        severity: 'medium',
      }
    default:
      return {
        label: 'attribution-inconclusive',
        detail: 'no counterfactual steer produced a score; attribution unavailable this round',
        severity: 'info',
      }
  }
}

/** @experimental */
export interface CreateAttributionAnalyzeOptions<Task, Output>
  extends Omit<AttributeSteerOptions<Task, Output>, 'iteration' | 'counterfactualSteers'> {
  /**
   * Gate — attribution is EXPENSIVE (N worker re-runs), so it runs only when
   * this returns true. Default: the latest attempt failed AND it did not improve
   * on the previous one (a plateau worth diagnosing).
   */
  shouldAttribute?: (
    latest: Iteration<Task, Output>,
    history: ReadonlyArray<Iteration<Task, Output>>,
  ) => boolean
  /** Produce the counterfactual steers to try for the latest failed attempt. */
  counterfactualSteers: (
    latest: Iteration<Task, Output>,
    history: ReadonlyArray<Iteration<Task, Output>>,
  ) => Task[] | Promise<Task[]>
}

/**
 * Wrap {@link attributeSteer} into a gated `analyze` for {@link createSteeringPlanner}.
 * Returns `[]` (no re-dispatch) unless the gate fires, then runs attribution and
 * returns its verdict signal — so the driver's NEXT steer is informed by whether
 * the last failure was its fault or the worker's.
 */
export function createAttributionAnalyze<Task, Output>(
  opts: CreateAttributionAnalyzeOptions<Task, Output>,
): (
  latest: Iteration<Task, Output>,
  history: ReadonlyArray<Iteration<Task, Output>>,
) => Promise<SteeringSignal[]> {
  const gate = opts.shouldAttribute ?? defaultShouldAttribute
  return async (latest, history) => {
    if (!gate(latest, history)) return []
    const steers = await opts.counterfactualSteers(latest, history)
    if (!steers || steers.length === 0) return []
    const attr = await attributeSteer<Task, Output>({
      client: opts.client,
      spec: opts.spec,
      output: opts.output,
      validator: opts.validator,
      iteration: latest,
      counterfactualSteers: steers,
      maxConcurrency: opts.maxConcurrency,
      // Default 3 reps on this gated production path: averaging shrinks
      // validator-score noise ~√3 so the verdict doesn't flip on jitter (a flip
      // mis-steers the loop). The caller already opted into attribution cost here;
      // the raw `attributeSteer` primitive stays reps=1 for cheap one-offs.
      reps: opts.reps ?? 3,
      margin: opts.margin,
      signal: opts.signal,
      log: opts.log,
      describeSteer: opts.describeSteer,
    })
    return [steerAttributionSignal(attr)]
  }
}

/** Default gate: latest failed and didn't beat the previous attempt's score. */
function defaultShouldAttribute<Task, Output>(
  latest: Iteration<Task, Output>,
  history: ReadonlyArray<Iteration<Task, Output>>,
): boolean {
  if (latest.verdict?.valid !== false) return false
  if (history.length < 2) return latest.verdict?.valid === false
  const prev = history[history.length - 2]
  const prevScore = prev?.verdict?.score
  const score = latest.verdict?.score
  return typeof prevScore !== 'number' || typeof score !== 'number' || score <= prevScore
}

/** Re-dispatch a steer `reps` times and average the non-null scores (null if all failed). */
async function reDispatchAveraged<Task, Output>(
  opts: AttributeSteerOptions<Task, Output>,
  steer: Task,
  signal: AbortSignal,
  index: number,
  reps: number,
): Promise<number | null> {
  if (reps <= 1) return reDispatchShot(opts, steer, signal, index)
  const samples: number[] = []
  for (let r = 0; r < reps; r += 1) {
    const score = await reDispatchShot(opts, steer, signal, index)
    if (score !== null) samples.push(score)
  }
  if (samples.length === 0) return null
  return samples.reduce((a, b) => a + b, 0) / samples.length
}

// ── Re-dispatch one shot through the kernel's exact exec path ─────────────────
async function reDispatchShot<Task, Output>(
  opts: AttributeSteerOptions<Task, Output>,
  steer: Task,
  signal: AbortSignal,
  index: number,
): Promise<number | null> {
  try {
    const box = await createSandboxForSpec(opts.client, opts.spec, signal)
    const message = opts.spec.taskToPrompt(steer)
    const events: SandboxEvent[] = []
    for await (const event of box.streamPrompt(message, { signal })) {
      events.push(event)
    }
    const parsed = opts.output.parse(events)
    const verdict = await opts.validator.validate(parsed, {
      iteration: opts.iteration.index,
      signal,
    })
    return verdict.score ?? null
  } catch (err) {
    opts.log?.(
      `counterfactual steer ${index} re-dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/** Run `fn` over items with at most `limit` in flight; preserves input order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}
