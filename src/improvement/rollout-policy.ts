/**
 * `rolloutPolicyProposer` — the `'rollout-policy'` surface for `improve()`: the
 * inference-time `StructuralRolloutPolicy` dials { k, repairRounds, testgen } as a
 * held-out-gated optimizable surface.
 *
 * Why this seam: agent-eval's loop contract is already generic — `MutableSurface`
 * admits any string, documented as "serialized tool config" — so the policy rides
 * the SAME serialize→propose→gate→parse-back cycle the tools/mcp/hooks surfaces
 * use. No agent-eval changes; the only net-new piece is this proposer.
 *
 * Why deterministic: prompt-wording proposals are a measured zero on this stack,
 * and the policy space is tiny and fully enumerable. The proposer emits bounded
 * single-dial neighbors (k±2 in [1,10], repairRounds±1 in [0,3], testgen±3 in
 * [0,10], ≤4 per generation) and lets the held-out gate do ALL the deciding — an
 * LLM proposer would add cost and nondeterminism with nothing to reason about.
 *
 * Persistence: the policy lives in `profile.extensions['structural-rollout']`
 * (AgentProfile's designed slot for runtime-specific config). A gated winner is
 * written back there by `improve()`, the same profile-field write-back every other
 * config surface gets; `structuralRolloutPolicyFromProfile` is the read side a
 * runtime caller feeds to `structuralRollout({ policy })`.
 *
 * @experimental
 */

import type {
  MutableSurface,
  ProposeContext,
  ProposedCandidate,
  SurfaceProposer,
} from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  defaultStructuralRolloutPolicy,
  type StructuralRolloutPolicy,
} from '../runtime/structural-rollout'

/** The profile extensions namespace the policy persists under. */
export const ROLLOUT_POLICY_EXTENSION = 'structural-rollout'

/** Proposal bounds per dial. These are the SEARCH bounds (what the proposer may
 *  explore), chosen so every reachable value is a measured-sane recipe: k=1 is the
 *  low-compute preset, testgen=0 disables check authoring, repairRounds caps where
 *  the measured increment flattens (+1–3pp beyond round 2). */
export const ROLLOUT_POLICY_BOUNDS = {
  k: { min: 1, max: 10, step: 2 },
  repairRounds: { min: 0, max: 3, step: 1 },
  testgen: { min: 0, max: 10, step: 3 },
} as const

/** Max candidates per generation — the search space is 3 dials, so a small
 *  neighborhood per generation converges without burning gate budget. */
const MAX_CANDIDATES_PER_GENERATION = 4

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

const isBoundedInt = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min

/** Parse a serialized policy surface. Defensive by design — the proposer reads
 *  `ctx.currentSurface`, which the loop types as `string | CodeSurface`. Returns
 *  `undefined` (never throws) for non-strings, malformed JSON, or a shape that
 *  violates the policy's own invariants: the no-op signal. Unknown dials are
 *  dropped; `diverse`/`temperature` ride through untouched (the proposer never
 *  mutates them — `diverse` is a measured paired null). */
export function parseRolloutPolicy(surface: MutableSurface): StructuralRolloutPolicy | undefined {
  if (typeof surface !== 'string' || surface.trim().length === 0) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(surface)
  } catch {
    return undefined
  }
  return normalizeRolloutPolicy(raw)
}

/** Normalize an untyped policy bag (a parsed surface or a profile extension) into
 *  a full `StructuralRolloutPolicy`, defaults merged. Returns `undefined` when any
 *  present dial violates the policy invariants (mirrors `resolvePolicy`: integer
 *  k ≥ 1, repairRounds ≥ 0, testgen ≥ 0) — a corrupt config must read as "not
 *  configured", never as a fabricated recipe. */
export function normalizeRolloutPolicy(raw: unknown): StructuralRolloutPolicy | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const bag = raw as Record<string, unknown>
  const k = bag.k ?? defaultStructuralRolloutPolicy.k
  const repairRounds = bag.repairRounds ?? defaultStructuralRolloutPolicy.repairRounds
  const testgen = bag.testgen ?? defaultStructuralRolloutPolicy.testgen
  if (!isBoundedInt(k, 1) || !isBoundedInt(repairRounds, 0) || !isBoundedInt(testgen, 0)) {
    return undefined
  }
  return {
    k,
    repairRounds,
    testgen,
    ...(typeof bag.diverse === 'boolean' ? { diverse: bag.diverse } : {}),
    ...(typeof bag.temperature === 'number' ? { temperature: bag.temperature } : {}),
  }
}

/** Stable serialization — dial order is fixed so identical policies produce
 *  identical surfaces (the loop dedupes/hashes candidates by surface content). */
export function serializeRolloutPolicy(policy: StructuralRolloutPolicy): string {
  return JSON.stringify({
    k: policy.k,
    repairRounds: policy.repairRounds,
    testgen: policy.testgen,
    ...(policy.diverse !== undefined ? { diverse: policy.diverse } : {}),
    ...(policy.temperature !== undefined ? { temperature: policy.temperature } : {}),
  })
}

/** Read the persisted policy off the profile. `undefined` when the profile does
 *  not opt into structural rollout — the improve() surface no-ops then, because
 *  tuning dials nothing consumes would ship dead config. */
export function structuralRolloutPolicyFromProfile(
  profile: AgentProfile,
): StructuralRolloutPolicy | undefined {
  const bag = profile.extensions?.[ROLLOUT_POLICY_EXTENSION]
  if (bag === undefined) return undefined
  return normalizeRolloutPolicy(bag)
}

/** Persist a policy into the profile's extensions namespace. Shallow copy; never
 *  mutates the input profile (the applyWinnerToProfile contract). */
export function applyRolloutPolicyToProfile(
  profile: AgentProfile,
  policy: StructuralRolloutPolicy,
): AgentProfile {
  const bag: Record<string, unknown> = {
    k: policy.k,
    repairRounds: policy.repairRounds,
    testgen: policy.testgen,
    ...(policy.diverse !== undefined ? { diverse: policy.diverse } : {}),
    ...(policy.temperature !== undefined ? { temperature: policy.temperature } : {}),
  }
  return {
    ...profile,
    extensions: { ...profile.extensions, [ROLLOUT_POLICY_EXTENSION]: bag },
  }
}

/** All bounded single-dial neighbors of `policy`, in a fixed priority order: k
 *  first (selection breadth carries 85–92% of the measured effect), then
 *  repairRounds, then testgen. Steps clamp to the dial's bounds; clamped-to-no-op
 *  and duplicate policies are dropped. */
export function enumerateNeighborPolicies(
  policy: StructuralRolloutPolicy,
): StructuralRolloutPolicy[] {
  const moves: Array<{ dial: 'k' | 'repairRounds' | 'testgen'; delta: 1 | -1 }> = [
    { dial: 'k', delta: 1 },
    { dial: 'k', delta: -1 },
    { dial: 'repairRounds', delta: 1 },
    { dial: 'repairRounds', delta: -1 },
    { dial: 'testgen', delta: 1 },
    { dial: 'testgen', delta: -1 },
  ]
  const seen = new Set<string>([serializeRolloutPolicy(policy)])
  const neighbors: StructuralRolloutPolicy[] = []
  for (const move of moves) {
    const bounds = ROLLOUT_POLICY_BOUNDS[move.dial]
    const next = clamp(policy[move.dial] + move.delta * bounds.step, bounds.min, bounds.max)
    const candidate: StructuralRolloutPolicy = { ...policy, [move.dial]: next }
    const key = serializeRolloutPolicy(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    neighbors.push(candidate)
  }
  return neighbors
}

function candidateLabel(base: StructuralRolloutPolicy, next: StructuralRolloutPolicy): string {
  for (const dial of ['k', 'repairRounds', 'testgen'] as const) {
    if (next[dial] !== base[dial]) return `${dial} ${base[dial]}→${next[dial]}`
  }
  return 'unchanged'
}

/**
 * The deterministic `SurfaceProposer` for the `'rollout-policy'` surface.
 *
 * Each generation: parse the current policy surface, enumerate its bounded
 * single-dial neighbors, and return at most `min(populationSize, 4)` of them,
 * rotating the enumeration window by generation so successive generations explore
 * different neighbors when nothing promoted. Proposes NOTHING when the surface
 * carries no policy (the profile never opted in) — an empty proposal is the
 * loop-native no-op, mirroring `improvementDriver`'s no-findings behavior.
 */
export function rolloutPolicyProposer(): SurfaceProposer {
  return {
    kind: 'rollout-policy',
    async propose(ctx: ProposeContext): Promise<ProposedCandidate[]> {
      const policy = parseRolloutPolicy(ctx.currentSurface)
      if (!policy) return []
      const neighbors = enumerateNeighborPolicies(policy)
      if (neighbors.length === 0) return []
      const cap = Math.max(1, Math.min(ctx.populationSize, MAX_CANDIDATES_PER_GENERATION))
      const start = (ctx.generation * cap) % neighbors.length
      const window: StructuralRolloutPolicy[] = []
      for (let i = 0; i < Math.min(cap, neighbors.length); i += 1) {
        window.push(neighbors[(start + i) % neighbors.length] as StructuralRolloutPolicy)
      }
      return window.map((candidate) => ({
        surface: serializeRolloutPolicy(candidate),
        label: candidateLabel(policy, candidate),
        rationale:
          'bounded single-dial neighbor of the current structuralRollout policy; ' +
          'the held-out gate decides (deterministic enumeration — the dial space is tiny ' +
          'and prompt-style reflective proposals are a measured zero here)',
      }))
    },
  }
}
