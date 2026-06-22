/**
 * `runLifecycle` — the ONE closed-loop orchestrator: generate → measure →
 * promote → store.
 *
 * It is surface-agnostic: it knows nothing about skills vs tools vs prompts. All
 * per-surface logic lives behind the `CandidateGenerator` seam. The loop:
 *
 *   1. GENERATE   — ask each generator for candidate artifacts from the agent's
 *                   history (traces/findings). Register them as `candidate`s.
 *   2. MEASURE    — for each candidate, run `measureMarginalLift` on the held-
 *                   back split (the with/without ablation, baseline shared across
 *                   candidates so the "without" arm runs once).
 *   3. PROMOTE    — run the `PromotionGate` (default: the held-back exam). On a
 *                   pass, `promoteWithLift` records the measured lift — the
 *                   registry invariant: no measured lift ⇒ never active.
 *   4. STORE      — every candidate (promoted or not) lands in the registry with
 *                   provenance (domain, generation, generator kind, gate verdict)
 *                   + its lift in metadata, so the decision is auditable.
 *
 * Compose is intentionally NOT part of this loop — folding the promoted set back
 * into a profile is a separate, explicit `composeProfile` call the caller makes
 * when it wants a deployable profile. Keeping them separate means a caller can
 * run the loop to grow the catalog without committing a profile change.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import type { PromotionGate, PromotionVerdict } from './gate'
import type { CandidateGenerator, GenerateContext } from './generator'
import { type EvalResult, type EvalRunner, measureMarginalLift } from './marginal-lift'
import { ArtifactRegistry } from './registry'
import type { ArtifactKind, ProfileArtifact } from './types'

export interface RunLifecycleOptions {
  /** The baseline profile candidates are proposed and measured on top of. On a
   *  cold start this is the empty (or near-empty) profile. */
  baseline: AgentProfile
  /** The agent/domain id — namespaces provenance + scopes generators. */
  domain: string
  /** The per-surface candidate generators. One per surface the loop grows; the
   *  loop runs them in order and pools their candidates. */
  generators: ReadonlyArray<CandidateGenerator>
  /** Scores a profile on the HELD-BACK split. Run by `measureMarginalLift` —
   *  once for the shared baseline, once per candidate. */
  evalRunner: EvalRunner
  /** The promotion gate (the held-back exam). Default-free on purpose: the
   *  caller chooses the policy (`thresholdPromotionGate` / `heldOutPromotionGate`). */
  gate: PromotionGate
  /** Trace-analyst findings the generators distill/propose from. */
  findings?: ReadonlyArray<AnalystFinding>
  /** Raw captured traces for generators (e.g. a skill `distill`). Opaque. */
  traces?: unknown
  /** Generation counter for provenance. Default 0. */
  generation?: number
  /** An existing registry to grow across generations. Default: a fresh one. */
  registry?: ArtifactRegistry
  /** Cooperative cancellation. */
  signal?: AbortSignal
}

/** The per-candidate record of what the loop decided and why. */
export interface CandidateOutcome {
  /** The stored artifact (status reflects the gate verdict). */
  artifact: ProfileArtifact
  /** The surface this candidate targeted. */
  kind: ArtifactKind
  /** Measured held-back lift (with − without composite). */
  scoreDelta: number
  /** Measured extra USD cost the artifact adds. */
  costDelta: number
  /** The gate's verdict. */
  verdict: PromotionVerdict
  /** Whether the candidate was promoted into the registry as active. */
  promoted: boolean
}

export interface RunLifecycleResult {
  /** The registry, grown with this generation's candidates + promotions. */
  registry: ArtifactRegistry
  /** One outcome per candidate the generators produced, in generation order. */
  outcomes: CandidateOutcome[]
  /** Ids of the artifacts promoted this generation. */
  promoted: string[]
  /** The shared baseline eval (the "without" arm, measured once). */
  baselineResult: EvalResult
}

/**
 * Run ONE generation of the artifact lifecycle.
 *
 * @example Cold start on a fixture domain (the closed loop in one call):
 *   const out = await runLifecycle({
 *     baseline: emptyProfile,
 *     domain: 'support-bot',
 *     generators: [skillGenerator({ distill, refine })],
 *     evalRunner: scoreOnHeldBackSplit,
 *     gate: thresholdPromotionGate(),
 *     traces: seededTraces,
 *   })
 *   const composed = composeProfile(out.registry, emptyProfile, { kind: 'skill' })
 */
export async function runLifecycle(opts: RunLifecycleOptions): Promise<RunLifecycleResult> {
  if (opts.generators.length === 0) {
    throw new ValidationError('runLifecycle: at least one CandidateGenerator is required')
  }

  const registry = opts.registry ?? new ArtifactRegistry()
  const generation = opts.generation ?? 0
  const findings = opts.findings ?? []
  const ctx: GenerateContext = {
    baseline: opts.baseline,
    domain: opts.domain,
    findings,
    traces: opts.traces,
    signal: opts.signal,
  }

  // 1. GENERATE — pool candidates from every surface's generator.
  const candidates: ProfileArtifact[] = []
  for (const generator of opts.generators) {
    if (opts.signal?.aborted) break
    const inputs = await generator.generate(ctx)
    for (const input of inputs) {
      const stored = registry.register({
        ...input,
        // Provenance: who proposed this, for which domain, in which generation.
        metadata: {
          ...input.metadata,
          domain: opts.domain,
          generation,
          generatorKind: generator.kind,
        },
      })
      candidates.push(stored)
    }
  }

  // 2. MEASURE — share the baseline arm across all candidates (run it once).
  const baselineResult = await opts.evalRunner(opts.baseline, opts.signal)

  const outcomes: CandidateOutcome[] = []
  const promoted: string[] = []
  for (const candidate of candidates) {
    if (opts.signal?.aborted) break
    const lift = await measureMarginalLift({
      baseline: opts.baseline,
      candidate,
      evalRunner: opts.evalRunner,
      baselineResult,
      signal: opts.signal,
    })

    // 3. PROMOTE — the held-back exam decides; the lift score is the receipt.
    const verdict = opts.gate.decide(lift)
    let artifact = candidate
    if (verdict.promote) {
      artifact = registry.promoteWithLift(candidate.id, lift.scoreDelta)
      promoted.push(candidate.id)
    } else {
      // 4. STORE the verdict on a rejected candidate too (auditable trail).
      artifact = registry.register({
        ...toInput(candidate),
        metadata: {
          ...candidate.metadata,
          gateReason: verdict.reason,
          gateRejectionCode: verdict.rejectionCode,
          scoreDelta: lift.scoreDelta,
        },
      })
    }

    outcomes.push({
      artifact,
      kind: candidate.kind,
      scoreDelta: lift.scoreDelta,
      costDelta: lift.costDelta,
      verdict,
      promoted: verdict.promote,
    })
  }

  return { registry, outcomes, promoted, baselineResult }
}

/** Re-derive a registry input from a stored artifact (preserves the stable id so
 *  re-registration replaces in place rather than minting a duplicate). */
function toInput(artifact: ProfileArtifact): {
  id: string
  kind: ArtifactKind
  key?: string
  name: string
  description?: string
  payload: ProfileArtifact['payload']
} {
  return {
    id: artifact.id,
    kind: artifact.kind,
    key: artifact.key,
    name: artifact.name,
    description: artifact.description,
    payload: artifact.payload,
  }
}
