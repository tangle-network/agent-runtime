/** Serialize and apply Runtime's structural rollout profile coordinate. */

import type { MutableSurface } from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  defaultStructuralRolloutPolicy,
  type StructuralRolloutPolicy,
} from '../runtime/structural-rollout'

/** The profile extensions namespace the policy persists under. */
export const ROLLOUT_POLICY_EXTENSION = 'structural-rollout'

const isBoundedInt = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min

/** Parse a serialized policy surface. Returns `undefined` for non-strings,
 * malformed JSON, or values outside the policy invariants. Unknown fields are
 * dropped; supported optional fields are preserved. */
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

/** Stable serialization with fixed field order. */
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
 *  not opt into structural rollout. */
export function structuralRolloutPolicyFromProfile(
  profile: AgentProfile,
): StructuralRolloutPolicy | undefined {
  const bag = profile.extensions?.[ROLLOUT_POLICY_EXTENSION]
  if (bag === undefined) return undefined
  return normalizeRolloutPolicy(bag)
}

/** Persist a detached policy under the profile extension without mutating the input. */
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
