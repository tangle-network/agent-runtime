/**
 * `'rollout-policy'` surface proof.
 *
 * What this guards: `improve()` can tune the inference-time structuralRollout
 * dials { k, repairRounds, testgen } through agent-eval's generic string-surface
 * contract — deterministic bounded candidate enumeration, held-out gate deciding,
 * winner persisted into `profile.extensions['structural-rollout']`, and a strict
 * no-op when the profile never opted into structural rollout.
 *
 * Deterministic and offline throughout: the proposer is enumeration (no LLM), the
 * judge is a pure function of the candidate policy's `k` dial, and the stub agent
 * reports token-bearing cost so the backend-integrity guard sees a real backend.
 */

import { isProposedCandidate, type ProposedCandidate } from '@tangle-network/agent-eval/campaign'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import type { StructuralRolloutPolicy } from '../runtime/structural-rollout'
import { improve } from './improve'
import {
  applyRolloutPolicyToProfile,
  enumerateNeighborPolicies,
  normalizeRolloutPolicy,
  parseRolloutPolicy,
  ROLLOUT_POLICY_BOUNDS,
  ROLLOUT_POLICY_EXTENSION,
  rolloutPolicyProposer,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'

const inBounds = (p: StructuralRolloutPolicy) =>
  p.k >= ROLLOUT_POLICY_BOUNDS.k.min &&
  p.k <= ROLLOUT_POLICY_BOUNDS.k.max &&
  p.repairRounds >= ROLLOUT_POLICY_BOUNDS.repairRounds.min &&
  p.repairRounds <= ROLLOUT_POLICY_BOUNDS.repairRounds.max &&
  p.testgen >= ROLLOUT_POLICY_BOUNDS.testgen.min &&
  p.testgen <= ROLLOUT_POLICY_BOUNDS.testgen.max

describe('enumerateNeighborPolicies — bounded single-dial moves', () => {
  it('emits all six in-bounds neighbors of an interior policy, none equal to it', () => {
    const base: StructuralRolloutPolicy = { k: 5, repairRounds: 2, testgen: 6 }
    const neighbors = enumerateNeighborPolicies(base)
    expect(neighbors.map((n) => [n.k, n.repairRounds, n.testgen])).toEqual([
      [7, 2, 6],
      [3, 2, 6],
      [5, 3, 6],
      [5, 1, 6],
      [5, 2, 9],
      [5, 2, 3],
    ])
    for (const n of neighbors) expect(inBounds(n)).toBe(true)
    expect(neighbors.map(serializeRolloutPolicy)).not.toContain(serializeRolloutPolicy(base))
  })

  it('clamps at the floor: downward moves that clamp to a no-op are dropped', () => {
    const neighbors = enumerateNeighborPolicies({ k: 1, repairRounds: 0, testgen: 0 })
    expect(neighbors.map((n) => [n.k, n.repairRounds, n.testgen])).toEqual([
      [3, 0, 0],
      [1, 1, 0],
      [1, 0, 3],
    ])
    for (const n of neighbors) expect(inBounds(n)).toBe(true)
  })

  it('clamps at the ceiling: upward moves that clamp to a no-op are dropped', () => {
    const neighbors = enumerateNeighborPolicies({ k: 10, repairRounds: 3, testgen: 10 })
    expect(neighbors.map((n) => [n.k, n.repairRounds, n.testgen])).toEqual([
      [8, 3, 10],
      [10, 2, 10],
      [10, 3, 7],
    ])
    for (const n of neighbors) expect(inBounds(n)).toBe(true)
  })

  it('a clamped move that lands in-bounds survives (k=2 reaches the k=1 preset)', () => {
    const neighbors = enumerateNeighborPolicies({ k: 2, repairRounds: 0, testgen: 0 })
    expect(neighbors.map((n) => n.k)).toContain(1)
    for (const n of neighbors) expect(inBounds(n)).toBe(true)
  })

  it('never mutates diverse/temperature — they ride through every neighbor', () => {
    const neighbors = enumerateNeighborPolicies({
      k: 5,
      repairRounds: 2,
      testgen: 6,
      diverse: true,
      temperature: 0.7,
    })
    for (const n of neighbors) {
      expect(n.diverse).toBe(true)
      expect(n.temperature).toBe(0.7)
    }
  })
})

describe('rolloutPolicyProposer — deterministic bounded proposal', () => {
  const ctx = (overrides: Record<string, unknown> = {}) =>
    ({
      currentSurface: serializeRolloutPolicy({ k: 5, repairRounds: 2, testgen: 6 }),
      history: [],
      findings: [],
      populationSize: 4,
      generation: 0,
      signal: new AbortController().signal,
      ...overrides,
    }) as never

  const asProposed = (proposals: Array<unknown>): ProposedCandidate[] =>
    proposals.filter((p): p is ProposedCandidate => isProposedCandidate(p as ProposedCandidate))

  it('caps at min(populationSize, 4) candidates, every surface a valid in-bounds policy', async () => {
    const raw = await rolloutPolicyProposer().propose(ctx())
    const proposals = asProposed(raw)
    // Every proposal carries its {label, rationale} — never a bare surface.
    expect(proposals.length).toBe(raw.length)
    expect(proposals.length).toBe(4)
    for (const p of proposals) {
      const parsed = parseRolloutPolicy(p.surface)
      expect(parsed).toBeDefined()
      expect(inBounds(parsed as StructuralRolloutPolicy)).toBe(true)
      expect(p.label).toMatch(/^(k|repairRounds|testgen) \d+→\d+$/)
      expect(p.rationale.length).toBeGreaterThan(0)
    }
    const two = await rolloutPolicyProposer().propose(ctx({ populationSize: 2 }))
    expect(two.length).toBe(2)
  })

  it('rotates the neighbor window by generation, so a held generation explores differently', async () => {
    const gen0 = asProposed(await rolloutPolicyProposer().propose(ctx({ generation: 0 })))
    const gen1 = asProposed(await rolloutPolicyProposer().propose(ctx({ generation: 1 })))
    expect(new Set(gen0.map((p) => p.surface))).not.toEqual(new Set(gen1.map((p) => p.surface)))
  })

  it('proposes nothing when the surface carries no policy (empty, malformed, or code-tier)', async () => {
    const proposer = rolloutPolicyProposer()
    expect(await proposer.propose(ctx({ currentSurface: '' }))).toEqual([])
    expect(await proposer.propose(ctx({ currentSurface: 'not json' }))).toEqual([])
    expect(await proposer.propose(ctx({ currentSurface: '{"k": 0}' }))).toEqual([])
    expect(await proposer.propose(ctx({ currentSurface: { worktreeRef: 'refs/x' } }))).toEqual([])
  })
})

describe('policy persistence — profile extensions round-trip', () => {
  it('applyRolloutPolicyToProfile → structuralRolloutPolicyFromProfile is identity', () => {
    const policy: StructuralRolloutPolicy = {
      k: 3,
      repairRounds: 1,
      testgen: 0,
      diverse: false,
      temperature: 0.2,
    }
    const profile: AgentProfile = { name: 'fixture' }
    const next = applyRolloutPolicyToProfile(profile, policy)
    expect(structuralRolloutPolicyFromProfile(next)).toEqual(policy)
    // Never mutates the input profile.
    expect(profile.extensions).toBeUndefined()
  })

  it('a partial extension resolves the missing dials to the measured defaults', () => {
    const profile: AgentProfile = {
      extensions: { [ROLLOUT_POLICY_EXTENSION]: { k: 1 } },
    }
    expect(structuralRolloutPolicyFromProfile(profile)).toEqual({
      k: 1,
      repairRounds: 2,
      testgen: 6,
    })
  })

  it('a corrupt extension reads as not-configured, never a fabricated recipe', () => {
    for (const bad of [{ k: 0 }, { k: 1.5 }, { repairRounds: -1 }, { testgen: 'six' }]) {
      const profile: AgentProfile = {
        extensions: { [ROLLOUT_POLICY_EXTENSION]: bad as never },
      }
      expect(structuralRolloutPolicyFromProfile(profile)).toBeUndefined()
    }
    expect(normalizeRolloutPolicy(null)).toBeUndefined()
    expect(normalizeRolloutPolicy([1, 2])).toBeUndefined()
  })
})

// ── improve() end-to-end: the gate decides, the winner persists ─────────────────────

// Eight scenarios at holdoutFraction 0.5 → 4 train + 4 holdout: enough held-out
// cells for the gate statistic on a deterministic score gradient.
const scenarios: Scenario[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => ({
  id,
  kind: 'fixture',
}))

// The agent parses the policy surface into the artifact; the judge rewards the k
// dial (composite = k/10). Baseline k=5 → 0.5; the k=7 neighbor → 0.7 on every
// scenario: a +0.2 held-out lift the default gate (deltaThreshold 0.05) ships.
async function policyAgent(
  surface: unknown,
  _scenario: Scenario,
  ctx: DispatchContext,
): Promise<{ policy: StructuralRolloutPolicy | undefined }> {
  ctx.cost.observe(0.0001, 'stub-agent')
  ctx.cost.observeTokens({ input: 1, output: 1 })
  return { policy: parseRolloutPolicy(String(surface)) }
}

const kJudge: JudgeConfig<{ policy: StructuralRolloutPolicy | undefined }, Scenario> = {
  name: 'k-dial-judge',
  dimensions: [{ key: 'q', description: 'rewards selection breadth' }],
  score: ({ artifact }) => {
    const composite = (artifact.policy?.k ?? 0) / 10
    return { dimensions: { q: composite }, composite, notes: '' }
  },
}

describe("improve() surface 'rollout-policy'", () => {
  it('a gated win persists the winning policy into profile.extensions', async () => {
    const profile: AgentProfile = {
      name: 'fixture-agent',
      extensions: {
        [ROLLOUT_POLICY_EXTENSION]: { k: 5, repairRounds: 2, testgen: 6 },
      },
    }
    const result = await improve(profile, [], {
      surface: 'rollout-policy',
      scenarios,
      judge: kJudge,
      agent: policyAgent,
      budget: { generations: 1, populationSize: 4, holdoutFraction: 0.5 },
    })

    expect(result.gateDecision).toBe('ship')
    expect(result.shipped).toBe(true)
    expect(result.lift).toBeCloseTo(0.2, 5)
    // The k=7 neighbor won and was written back where the runtime reads it.
    expect(structuralRolloutPolicyFromProfile(result.profile)).toEqual({
      k: 7,
      repairRounds: 2,
      testgen: 6,
    })
    // Input profile untouched (applyWinnerToProfile is copy-on-write).
    expect(structuralRolloutPolicyFromProfile(profile)).toEqual({
      k: 5,
      repairRounds: 2,
      testgen: 6,
    })
  })

  it('no-ops when the profile has no structural rollout config', async () => {
    const profile: AgentProfile = { name: 'fixture-agent', prompt: { systemPrompt: 'base' } }
    const result = await improve(profile, [], {
      surface: 'rollout-policy',
      scenarios,
      judge: kJudge,
      agent: policyAgent,
      budget: { generations: 1, populationSize: 4, holdoutFraction: 0.5 },
    })

    // The proposer proposed nothing, so nothing could ship; the exact same
    // profile object comes back (no fabricated extension, no dial changes).
    expect(result.shipped).toBe(false)
    expect(result.gateDecision).toBe('hold')
    expect(result.profile).toBe(profile)
    expect(structuralRolloutPolicyFromProfile(result.profile)).toBeUndefined()
  })
})
