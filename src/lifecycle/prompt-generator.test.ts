/**
 * The PROMPT-surface proof: the prompt generator closes the same generate →
 * measure → promote → compose loop the skill generator does, AND its
 * diverse-seed arm escapes a local minimum the incumbent-grounded refine arm
 * cannot reach.
 *
 * The fixture is deliberately a LOCAL-MINIMUM TRAP. The held-back exam rewards a
 * profile whose prompt has internalized one tactic — "verify after every edit".
 * The incumbent prompt is stuck in a neighborhood ("be fast, be terse") whose
 * rewrites never mention verification — so the refine arm, which only ever
 * perturbs the incumbent, can polish forever and never clear the exam. Only a
 * GENUINELY DIFFERENT framing, authored fresh from the task spec, reaches the
 * basin the exam rewards. That is the escape the seed arm exists to provide.
 *
 * Everything is deterministic — pure-stub `refine` + `authorDiverseSeeds`, a
 * pure `evalRunner`, the stub-free `thresholdPromotionGate`. The POINT is the
 * WIRING + the escape, not a live model run.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { composeProfile } from './compose'
import { thresholdPromotionGate } from './gate'
import type { GenerateContext } from './generator'
import type { EvalResult } from './marginal-lift'
import { type PromptDraft, promptGenerator } from './prompt-generator'
import { runLifecycle } from './run-lifecycle'

// The tactic the held-back exam rewards a prompt for having internalized.
const targetTactic = 'verify after every edit'

// The incumbent prompt: stuck in a basin that never mentions verification.
const incumbentProfile = (): AgentProfile => ({
  name: 'fixture-agent',
  prompt: { systemPrompt: 'You are an agent. Be fast and terse.' },
})

// The held-back exam: 1.0 iff any standing instruction teaches the tactic.
const heldBackExam = async (profile: AgentProfile): Promise<EvalResult> => {
  const instructions = profile.prompt?.instructions ?? []
  const teaches = instructions.some((i) => i.toLowerCase().includes(targetTactic))
  return { composite: teaches ? 1 : 0, costUsd: instructions.length * 0.001 }
}

// REFINE — the incumbent-grounded arm. It only ever perturbs the current
// framing ("be fast, be terse"), so it proposes terseness/speed variants and
// NEVER reaches verification. This is the local minimum the refine arm is stuck
// in by construction.
const refineStuck = (): PromptDraft[] => [
  {
    instruction: 'Be even faster and more terse; cut every unneeded word.',
    label: 'refine:terser',
    rationale: 'incumbent-grounded rewrite — polishes the speed/terseness framing',
  },
]

// SEED — the diverse arm. Authored FROM THE TASK SPEC, not the incumbent, so it
// can land in a different basin: it writes a failure-mode-first line that
// teaches the target tactic. This is the escape.
const seedDiverse = (_ctx: GenerateContext, count: number): PromptDraft[] => {
  const all: PromptDraft[] = [
    {
      instruction: 'Take a different stance: prefer breadth over speed when uncertain.',
      label: 'seed:principle',
      rationale: 'fresh framing #1 — a principle, distinct from terseness',
    },
    {
      instruction: `Before declaring done, ${targetTactic} by re-reading the changed lines.`,
      label: 'seed:failure-mode-first',
      rationale: 'fresh framing #2 — failure-mode-first, reaches the rewarded basin',
    },
    {
      instruction: 'Checklist: state the goal, list the steps, then execute.',
      label: 'seed:checklist',
      rationale: 'fresh framing #3 — a checklist, distinct again',
    },
  ]
  return all.slice(0, count)
}

describe('promptGenerator — prompt surface closed loop + local-minimum escape', () => {
  it('seeds escape the basin the refine arm is stuck in; the composed profile beats the incumbent', async () => {
    const base = incumbentProfile()

    // Ground truth: the incumbent fails the exam (no instruction teaches the tactic).
    expect((await heldBackExam(base)).composite).toBe(0)

    const result = await runLifecycle({
      baseline: base,
      domain: 'fixture-prompt-domain',
      generators: [
        promptGenerator({
          refine: refineStuck,
          authorDiverseSeeds: seedDiverse,
          diverseSeedCount: 3,
        }),
      ],
      evalRunner: heldBackExam,
      gate: thresholdPromotionGate(),
      findings: [],
    })

    // GENERATE produced 4 prompt candidates (3 diverse seeds + 1 refine).
    expect(result.outcomes).toHaveLength(4)
    expect(result.outcomes.every((o) => o.kind === 'prompt')).toBe(true)

    // The refine arm's candidate earns ZERO lift — it never reaches the basin.
    const refineOutcome = result.outcomes.find((o) => o.artifact.name === 'refine:terser')
    expect(refineOutcome?.scoreDelta).toBe(0)
    expect(refineOutcome?.promoted).toBe(false)

    // Exactly the failure-mode-first SEED escapes and earns +1.0 held-back lift.
    const escaped = result.outcomes.find((o) => o.artifact.name === 'seed:failure-mode-first')
    expect(escaped?.scoreDelta).toBeCloseTo(1, 10)
    expect(escaped?.promoted).toBe(true)
    expect(result.promoted).toContain(escaped?.artifact.id)

    // The rationale rode into the artifact metadata (auditable promotion).
    expect(escaped?.artifact.metadata?.rationale).toContain('failure-mode-first')

    // COMPOSE the promoted prompt artifact(s) back; the composed profile BEATS
    // the incumbent on the same held-back exam.
    const composed = composeProfile(result.registry, base, { kind: 'prompt' })
    expect((await heldBackExam(composed)).composite).toBe(1)

    // The base profile was never mutated.
    expect(base.prompt?.instructions ?? []).toEqual([])
  })

  it('refine-only (no seeds) stays stuck in the local minimum — proves seeds are load-bearing', async () => {
    const base = incumbentProfile()

    const result = await runLifecycle({
      baseline: base,
      domain: 'fixture-prompt-domain',
      generators: [promptGenerator({ refine: refineStuck })],
      evalRunner: heldBackExam,
      gate: thresholdPromotionGate(),
    })

    // Only the stuck refine candidate; it earns no lift and never promotes.
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0]?.scoreDelta).toBe(0)
    expect(result.promoted).toHaveLength(0)

    // Compose folds in nothing — the incumbent stays at 0 on the exam.
    const composed = composeProfile(result.registry, base, { kind: 'prompt' })
    expect((await heldBackExam(composed)).composite).toBe(0)
  })

  it('dedupes when refine and a seed land on the same instruction (first wins)', async () => {
    const base = incumbentProfile()
    const sameLine = 'Be even faster and more terse; cut every unneeded word.'

    const result = await runLifecycle({
      baseline: base,
      domain: 'fixture-prompt-domain',
      generators: [
        promptGenerator({
          authorDiverseSeeds: () => [
            { instruction: sameLine, label: 'seed:dup', rationale: 'collides with refine' },
          ],
          refine: () => [{ instruction: sameLine, label: 'refine:dup', rationale: 'same line' }],
          diverseSeedCount: 1,
        }),
      ],
      evalRunner: heldBackExam,
      gate: thresholdPromotionGate(),
    })

    // One candidate survives the dedupe (seed runs first, so it wins).
    expect(result.outcomes).toHaveLength(1)
    expect(result.outcomes[0]?.artifact.name).toBe('seed:dup')
  })

  it('throws at construction when neither arm is wired (a generator that can never produce)', () => {
    expect(() => promptGenerator({})).toThrow(/at least one of/)
  })
})
