/**
 * `driftWatch` — the scheduled re-measure that DEMOTES decayed artifacts.
 *
 * Promotion is a one-time decision on the evidence available THEN; the world
 * moves on. A skill that earned its lift against last month's task mix, a tool
 * grant the underlying model has since internalized, a prompt line another active
 * artifact now subsumes — each can quietly stop pulling its weight. An artifact
 * that no longer earns its keep but stays `active` is dead weight in every
 * composed profile and a lie in the registry's lift receipt.
 *
 * `driftWatch` closes that gap. It re-runs the SAME `measureMarginalLift`
 * ablation the loop used to promote each `active` artifact — over the CURRENT
 * baseline and the CURRENT eval — and demotes any whose re-measured held-back
 * lift fell below the keep-bar. Demotion moves the artifact `active` → `decayed`
 * (reversible: a later re-measure that recovers the lift can re-promote it), so
 * it drops out of `composeProfile` immediately while staying in the registry as
 * an auditable record.
 *
 * This is NOT a new execution model — it is the existing ablation, run on a
 * schedule, against the active set. The schedule itself is the caller's cron;
 * this module is the one re-measure-and-demote step that cron invokes. It is
 * surface-agnostic (skills, tools, prompts, MCP all re-measure identically) — the
 * only per-surface logic lives, as everywhere in the lifecycle, behind the
 * artifact's own `applyArtifact` bridge, which `measureMarginalLift` already uses.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { type EvalResult, type EvalRunner, measureMarginalLift } from './marginal-lift'
import type { ArtifactRegistry } from './registry'
import type { ProfileArtifact } from './types'

export interface DriftWatchOptions {
  /** The registry whose `active` artifacts are re-measured. Mutated in place:
   *  artifacts that fail the keep-bar are demoted to `decayed`. */
  registry: ArtifactRegistry
  /** The baseline profile each artifact is re-measured ON TOP OF — the SAME
   *  ablation shape as promotion. Pass the CURRENT baseline (the world the
   *  artifact lives in now), which may differ from the one it was promoted on. */
  baseline: AgentProfile
  /** Scores a profile on the held-back split. The shared baseline arm is run
   *  once and reused across every artifact's ablation (the "without" arm). */
  evalRunner: EvalRunner
  /**
   * The absolute keep-bar: an artifact stays `active` only while its re-measured
   * held-back lift is STRICTLY ABOVE this floor. Default 0 — an artifact that no
   * longer adds anything (or now subtracts) decays. Mirrors `thresholdPromotionGate`'s
   * `minDelta` so the keep-bar and the promote-bar can be set consistently.
   */
  minLift?: number
  /**
   * The relative keep-bar: an artifact also decays if its re-measured lift fell
   * to below this FRACTION of the lift recorded at promotion (`registry.liftOf`).
   * E.g. `0.5` demotes an artifact that lost more than half its original lift,
   * even if it still clears `minLift`. Default: unset (no relative check — only
   * the absolute `minLift` floor applies). Ignored for an artifact with no
   * recorded prior lift (a bare `promote`), which is judged on `minLift` alone.
   */
  maxRelativeDecay?: number
  /** Restrict the watch to one surface (e.g. re-measure only skills). Default:
   *  every `active` artifact, regardless of kind. */
  kind?: ProfileArtifact['kind']
  /** A pre-computed baseline result, to skip the shared "without" run when the
   *  caller already scored the current baseline this cycle. */
  baselineResult?: EvalResult
  /** Cooperative cancellation, forwarded to every `evalRunner` call. */
  signal?: AbortSignal
}

/** Per-artifact record of what the re-measure found and decided. */
export interface DriftCheck {
  /** The re-measured artifact (status reflects the decision: still `active`, or
   *  now `decayed`). */
  artifact: ProfileArtifact
  /** The lift recorded at promotion time (`registry.liftOf` before the check),
   *  or `undefined` if it was promoted without a lift receipt. */
  priorLift: number | undefined
  /** The freshly re-measured held-back lift (with − without composite). */
  currentLift: number
  /** Whether this re-measure demoted the artifact (`active` → `decayed`). */
  demoted: boolean
  /** Human-readable reason the artifact was kept or demoted (the same string
   *  recorded under `lifecycleReasonKey` on a demotion). */
  reason: string
}

export interface DriftWatchResult {
  /** One check per `active` artifact examined, in registry order. */
  checks: DriftCheck[]
  /** Ids of the artifacts demoted to `decayed` this cycle. */
  demoted: string[]
  /** The shared baseline eval (the "without" arm, measured once). */
  baselineResult: EvalResult
}

/**
 * Re-measure every `active` artifact and demote those whose held-back lift
 * decayed below the keep-bar.
 *
 * For each `active` artifact (optionally filtered to one `kind`), this re-runs
 * `measureMarginalLift` over the supplied `baseline`, then applies the keep-bar:
 *
 *   - ABSOLUTE: `currentLift > minLift` (default `> 0`), and
 *   - RELATIVE (when `maxRelativeDecay` is set AND a prior lift exists):
 *     `currentLift >= priorLift * (1 − maxRelativeDecay)`.
 *
 * An artifact failing EITHER bar is demoted to `decayed` (recording the
 * re-measured lift + reason) and drops out of `composeProfile`. An artifact that
 * passes both bars stays `active`, with its recorded lift refreshed to the latest
 * measurement so `liftOf` never reports stale evidence.
 *
 * The baseline "without" arm is scored ONCE and shared across all artifacts, so
 * the cost is `1 + (number of active artifacts)` eval runs.
 *
 * @example A nightly cron that demotes any active artifact that lost its lift:
 *   const out = await driftWatch({ registry, baseline, evalRunner, minLift: 0 })
 *   if (out.demoted.length) report(`demoted ${out.demoted.length} decayed artifacts`)
 */
export async function driftWatch(opts: DriftWatchOptions): Promise<DriftWatchResult> {
  if (opts.maxRelativeDecay !== undefined) {
    if (!Number.isFinite(opts.maxRelativeDecay) || opts.maxRelativeDecay < 0) {
      throw new ValidationError(
        `driftWatch: maxRelativeDecay must be a finite, non-negative fraction (got ${opts.maxRelativeDecay})`,
      )
    }
  }
  const minLift = opts.minLift ?? 0
  if (!Number.isFinite(minLift)) {
    throw new ValidationError(`driftWatch: minLift must be a finite number (got ${minLift})`)
  }

  // The active set is the only thing that can decay. Snapshot it BEFORE mutating,
  // so demotions this cycle don't shift the set mid-iteration.
  const active = opts.registry.list({ status: 'active', kind: opts.kind })

  // Share the baseline "without" arm across every artifact's ablation.
  const baselineResult = opts.baselineResult ?? (await opts.evalRunner(opts.baseline, opts.signal))

  const checks: DriftCheck[] = []
  const demoted: string[] = []
  for (const artifact of active) {
    if (opts.signal?.aborted) break
    const priorLift = opts.registry.liftOf(artifact.id)
    const lift = await measureMarginalLift({
      baseline: opts.baseline,
      candidate: artifact,
      evalRunner: opts.evalRunner,
      baselineResult,
      signal: opts.signal,
    })
    const currentLift = lift.scoreDelta

    const decision = keepDecision(currentLift, priorLift, minLift, opts.maxRelativeDecay)
    if (decision.keep) {
      // Still earning its keep — refresh the lift receipt to the latest evidence.
      const refreshed = opts.registry.promoteWithLift(artifact.id, currentLift)
      checks.push({
        artifact: refreshed,
        priorLift,
        currentLift,
        demoted: false,
        reason: decision.reason,
      })
    } else {
      const decayed = opts.registry.demote(artifact.id, decision.reason, currentLift)
      demoted.push(artifact.id)
      checks.push({
        artifact: decayed,
        priorLift,
        currentLift,
        demoted: true,
        reason: decision.reason,
      })
    }
  }

  return { checks, demoted, baselineResult }
}

/** Apply the absolute + relative keep-bars and explain the verdict. */
function keepDecision(
  currentLift: number,
  priorLift: number | undefined,
  minLift: number,
  maxRelativeDecay: number | undefined,
): { keep: boolean; reason: string } {
  if (!(currentLift > minLift)) {
    return {
      keep: false,
      reason: `re-measured lift Δ=${currentLift.toFixed(4)} ≤ keep-bar ${minLift} — decayed`,
    }
  }
  if (maxRelativeDecay !== undefined && priorLift !== undefined && priorLift > 0) {
    const floor = priorLift * (1 - maxRelativeDecay)
    if (currentLift < floor) {
      return {
        keep: false,
        reason: `re-measured lift Δ=${currentLift.toFixed(4)} fell below ${(maxRelativeDecay * 100).toFixed(0)}%-decay floor ${floor.toFixed(4)} of prior ${priorLift.toFixed(4)} — decayed`,
      }
    }
  }
  return {
    keep: true,
    reason: `re-measured lift Δ=${currentLift.toFixed(4)} clears the keep-bar — still active`,
  }
}
