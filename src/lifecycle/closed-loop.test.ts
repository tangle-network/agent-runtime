/**
 * THE END-TO-END PROOF — the keystone of #267.
 *
 * Start from an EMPTY profile (no skills) on a small deterministic fixture
 * domain. Run the WHOLE closed loop in one call:
 *
 *   distill a skill from seeded traces  →  measure its marginal lift on a
 *   held-back exam  →  promote it through the gate  →  fold it back with
 *   `composeProfile`  →  assert the COMPOSED profile beats the EMPTY one on the
 *   same held-back exam.
 *
 * Everything is deterministic — a stub `distill`, a stub `evalRunner`, a stub-
 * free `thresholdPromotionGate`. The POINT is proving the WIRING closes
 * (generate → measure → promote → compose, value flowing end to end), NOT a live
 * model run. When this test passes, the loop is closed end-to-end.
 *
 * The fixture domain: the held-back exam rewards a profile that has internalized
 * one tactic — "check state before acting". The empty profile hasn't; the skill
 * the loop distills teaches it. The exam scores a profile by how many of its
 * skills carry that tactic, so a profile WITH the distilled skill scores strictly
 * higher than the empty one — a real, predictable lift the gate can promote on.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { composeProfile } from './compose'
import { thresholdPromotionGate } from './gate'
import type { GenerateContext } from './generator'
import type { EvalResult } from './marginal-lift'
import { runLifecycle } from './run-lifecycle'
import { type SkillDraft, skillGenerator } from './skill-generator'

// The tactic the held-back exam rewards an agent for having internalized.
const targetTactic = 'check state before acting'

// The empty profile: a cold start with NO skills. This is the "empty profile has
// no skills" the lifecycle exists to fix.
const emptyProfile = (): AgentProfile => ({ name: 'fixture-agent', resources: { skills: [] } })

// The held-back exam: score a profile by whether any of its skills teach the
// target tactic. 1.0 if a skill carries the tactic, 0.0 otherwise. Deterministic,
// no model — the WIRING is what's under test.
const heldBackExam = async (profile: AgentProfile): Promise<EvalResult> => {
  const skills = profile.resources?.skills ?? []
  const teachesTactic = skills.some(
    (s) => s.kind === 'inline' && s.content.toLowerCase().includes(targetTactic),
  )
  return { composite: teachesTactic ? 1 : 0, costUsd: skills.length * 0.001 }
}

// DISTILL — create a skill draft from the seeded traces. Production reflects over
// the trace with an LLM; here a pure function reads the seeded observation and
// writes the SKILL.md that teaches the tactic. This is the CREATE step skillOpt
// cannot do — it conjures a skill where the profile had none.
const distillFromTraces = (ctx: GenerateContext): SkillDraft[] => {
  const trace = ctx.traces as { recurringMistake?: string } | undefined
  if (!trace?.recurringMistake) return []
  return [
    {
      name: 'state-discipline',
      description: 'distilled from the recurring mistake in the seeded trace',
      content: `# State discipline\n\nObserved mistake: ${trace.recurringMistake}\n\nTactic: ${targetTactic}.`,
    },
  ]
}

describe('artifact lifecycle — end-to-end closed loop (the #267 proof)', () => {
  it('empty profile → distill → measure → promote → compose beats empty on the held-back exam', async () => {
    const base = emptyProfile()

    // Ground truth: the empty profile fails the held-back exam (no skill teaches
    // the tactic). This is the bar the composed profile must clear.
    const emptyScore = await heldBackExam(base)
    expect(emptyScore.composite).toBe(0)

    // Run the WHOLE loop: generate (distill+refine) → measure → promote → store.
    const result = await runLifecycle({
      baseline: base,
      domain: 'fixture-domain',
      generators: [
        skillGenerator({
          distill: distillFromTraces,
          // REFINE: a deterministic optimizer pass (sharpen the wording). Proves
          // the distill→refine two-step runs; keeps the tactic intact.
          refine: (draft) => ({ ...draft, content: `${draft.content}\n\nRefined: do this first.` }),
        }),
      ],
      evalRunner: heldBackExam,
      gate: thresholdPromotionGate(),
      // The seeded trace the skill is distilled FROM.
      traces: { recurringMistake: 'acted before reading current state, clobbered a value' },
    })

    // GENERATE produced exactly one skill candidate.
    expect(result.outcomes).toHaveLength(1)
    const outcome = result.outcomes[0]!
    expect(outcome.kind).toBe('skill')

    // MEASURE: the distilled skill earns real held-back lift (0 → 1 = +1.0).
    expect(outcome.scoreDelta).toBeCloseTo(1, 10)

    // PROMOTE: the gate shipped it; the registry recorded the lift as the receipt.
    expect(outcome.promoted).toBe(true)
    expect(result.promoted).toHaveLength(1)
    const promotedId = result.promoted[0]!
    expect(result.registry.get(promotedId)?.status).toBe('active')
    // INVARIANT: an active artifact carries a measured lift.
    expect(result.registry.liftOf(promotedId)).toBeCloseTo(1, 10)

    // COMPOSE: fold the top-k active skill back into the (still empty) profile.
    const composed = composeProfile(result.registry, base, { kind: 'skill', k: 1 })

    // THE ASSERTION: the composed profile BEATS the empty one on the held-back exam.
    const composedScore = await heldBackExam(composed)
    expect(composedScore.composite).toBeGreaterThan(emptyScore.composite)
    expect(composedScore.composite).toBe(1)

    // And the base profile was never mutated — the loop is immutable end to end.
    expect(base.resources?.skills).toEqual([])
  })

  it('a worthless distilled skill earns zero lift, fails the gate, and never composes in', async () => {
    const base = emptyProfile()

    // A distill that writes a skill NOT teaching the tactic — zero held-back lift.
    const distillJunk = (): SkillDraft[] => [
      { name: 'noise', content: '# Noise\n\nirrelevant advice that helps nothing' },
    ]

    const result = await runLifecycle({
      baseline: base,
      domain: 'fixture-domain',
      generators: [skillGenerator({ distill: distillJunk })],
      evalRunner: heldBackExam,
      gate: thresholdPromotionGate(),
      traces: { recurringMistake: 'whatever' },
    })

    expect(result.outcomes[0]?.scoreDelta).toBe(0)
    expect(result.outcomes[0]?.promoted).toBe(false)
    expect(result.promoted).toHaveLength(0)

    // Compose folds in NOTHING — no active artifact with a measured lift exists.
    const composed = composeProfile(result.registry, base, { kind: 'skill' })
    expect((await heldBackExam(composed)).composite).toBe(0)
    expect(composed.resources?.skills ?? []).toHaveLength(0)
  })
})
