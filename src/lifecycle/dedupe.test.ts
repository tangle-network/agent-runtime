/**
 * `dedupeArtifacts` — retire the redundant half of a non-stacking pair.
 *
 * Deterministic throughout. The key fixture is an eval runner that models
 * OVERLAP: two artifacts each teach the same tactic, so each earns lift ALONE,
 * but composing both adds nothing over either one — the classic non-stacking
 * pair. A control runner models INDEPENDENT artifacts whose lifts DO stack, to
 * prove dedupe retires nothing when there is no overlap.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import { composeProfile } from './compose'
import { dedupeArtifacts } from './dedupe'
import type { EvalResult, EvalRunner } from './marginal-lift'
import { ArtifactRegistry, lifecycleReasonKey } from './registry'

const baseProfile = (): AgentProfile => ({ name: 'agent', prompt: { instructions: [] } })

const promptArtifact = (id: string, instruction: string) => ({
  id,
  kind: 'prompt' as const,
  name: id,
  payload: { instruction },
})

function registerActive(
  reg: ArtifactRegistry,
  input: ReturnType<typeof promptArtifact>,
  lift: number,
): void {
  reg.register(input)
  reg.promoteWithLift(input.id, lift)
}

/**
 * OVERLAP runner: a profile scores by whether it has internalized a TACTIC, not
 * by how many instructions teach it. `teachA` and `teachB` both teach the same
 * tactic, so either alone yields the full +0.5, and BOTH together still yields
 * only +0.5 (they do not stack). `independent` teaches a different tactic worth
 * +0.3 that stacks on top.
 */
const overlapRunner: EvalRunner = async (profile): Promise<EvalResult> => {
  const ins = profile.prompt?.instructions ?? []
  const hasTactic = ins.includes('teachA') || ins.includes('teachB')
  const hasIndependent = ins.includes('independent')
  const composite = (hasTactic ? 0.5 : 0) + (hasIndependent ? 0.3 : 0)
  return { composite, costUsd: ins.length * 0.001 }
}

describe('dedupeArtifacts', () => {
  it('retires the weaker member of a non-stacking (overlapping) pair', async () => {
    const reg = new ArtifactRegistry()
    // Both earn +0.5 alone, but teach the SAME tactic. 'teachA' is the stronger
    // by recorded promotion lift; 'weaker' (teachB) should be retired.
    registerActive(reg, promptArtifact('strong', 'teachA'), 0.5)
    registerActive(reg, promptArtifact('weak', 'teachB'), 0.5)

    const out = await dedupeArtifacts({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: overlapRunner,
    })

    // Exactly one pair examined, judged redundant, weaker retired.
    expect(out.checks).toHaveLength(1)
    const check = out.checks[0]!
    expect(check.liftA).toBeCloseTo(0.5, 10)
    expect(check.liftB).toBeCloseTo(0.5, 10)
    expect(check.combinedLift).toBeCloseTo(0.5, 10) // does NOT stack to 1.0
    expect(check.redundant).toBe(true)
    expect(out.retired).toEqual(['weak'])
    expect(reg.get('weak')?.status).toBe('retired')
    expect(reg.get('strong')?.status).toBe('active')
    expect(reg.get('weak')?.metadata?.[lifecycleReasonKey]).toContain('do not stack')
  })

  it('keeps both artifacts when their lifts stack (independent value)', async () => {
    const reg = new ArtifactRegistry()
    // 'teachA' (+0.5) and 'independent' (+0.3) teach different things → stack.
    registerActive(reg, promptArtifact('tactic', 'teachA'), 0.5)
    registerActive(reg, promptArtifact('indep', 'independent'), 0.3)

    const out = await dedupeArtifacts({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: overlapRunner,
    })

    expect(out.retired).toEqual([])
    expect(out.checks[0]?.combinedLift).toBeCloseTo(0.8, 10) // 0.5 + 0.3 stacks
    expect(out.checks[0]?.redundant).toBe(false)
    expect(reg.get('tactic')?.status).toBe('active')
    expect(reg.get('indep')?.status).toBe('active')
  })

  it('retiring drops the redundant artifact out of composeProfile', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('strong', 'teachA'), 0.5)
    registerActive(reg, promptArtifact('weak', 'teachB'), 0.5)

    await dedupeArtifacts({ registry: reg, baseline: baseProfile(), evalRunner: overlapRunner })

    const composed = composeProfile(reg, baseProfile())
    // Only the kept artifact's instruction is folded in.
    expect(composed.prompt?.instructions).toEqual(['teachA'])
  })

  it('collapses a cluster of three mutually-redundant artifacts to one', async () => {
    const reg = new ArtifactRegistry()
    // Three artifacts ALL teaching the same tactic (all match overlapRunner's
    // tactic test would need three synonyms) — model with a runner where any of
    // the three yields +0.5 and no combination exceeds it.
    const triRunner: EvalRunner = async (profile): Promise<EvalResult> => {
      const ins = profile.prompt?.instructions ?? []
      const has = ins.some((i) => i === 't1' || i === 't2' || i === 't3')
      return { composite: has ? 0.5 : 0, costUsd: 0 }
    }
    registerActive(reg, promptArtifact('a', 't1'), 0.5)
    registerActive(reg, promptArtifact('b', 't2'), 0.5)
    registerActive(reg, promptArtifact('c', 't3'), 0.5)

    const out = await dedupeArtifacts({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: triRunner,
    })

    // Two of the three retired; exactly one survivor stays active.
    expect(out.retired).toHaveLength(2)
    const active = reg.list({ status: 'active' })
    expect(active).toHaveLength(1)
  })

  it('a positive tolerance absorbs a small shortfall (treats it as stacking)', async () => {
    const reg = new ArtifactRegistry()
    // A runner with a tiny overlap: each +0.5 alone, combined 0.95 (shortfall
    // 0.05). With tolerance 0.1 the pair is treated as stacking; with 0 it is not.
    const nearStackRunner: EvalRunner = async (profile): Promise<EvalResult> => {
      const ins = profile.prompt?.instructions ?? []
      const a = ins.includes('na')
      const b = ins.includes('nb')
      let composite = 0
      if (a) composite += 0.5
      if (b) composite += 0.5
      if (a && b) composite -= 0.05 // small overlap
      return { composite, costUsd: 0 }
    }
    registerActive(reg, promptArtifact('na', 'na'), 0.5)
    registerActive(reg, promptArtifact('nb', 'nb'), 0.5)

    const tolerant = await dedupeArtifacts({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: nearStackRunner,
      tolerance: 0.1,
    })
    expect(tolerant.retired).toEqual([])

    // Reset and run with zero tolerance — now the 0.05 shortfall retires one.
    const reg2 = new ArtifactRegistry()
    registerActive(reg2, promptArtifact('na', 'na'), 0.5)
    registerActive(reg2, promptArtifact('nb', 'nb'), 0.5)
    const strict = await dedupeArtifacts({
      registry: reg2,
      baseline: baseProfile(),
      evalRunner: nearStackRunner,
      tolerance: 0,
    })
    expect(strict.retired).toHaveLength(1)
  })

  it('caches each artifact lift across the pairs it appears in', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('a', 'independent'), 0.3)
    registerActive(reg, promptArtifact('b', 'teachA'), 0.5)
    registerActive(reg, promptArtifact('c', 'teachB'), 0.5)

    // Count how many times each single-artifact profile is scored. With caching,
    // each artifact's individual lift is measured exactly once.
    const singleScored = new Map<string, number>()
    const runner: EvalRunner = async (profile): Promise<EvalResult> => {
      const ins = profile.prompt?.instructions ?? []
      if (ins.length === 1) singleScored.set(ins[0]!, (singleScored.get(ins[0]!) ?? 0) + 1)
      return overlapRunner(profile)
    }

    await dedupeArtifacts({ registry: reg, baseline: baseProfile(), evalRunner: runner })

    // Each single artifact scored at most once despite appearing in 2 pairs.
    for (const [, count] of singleScored) expect(count).toBe(1)
  })

  it('rejects a negative tolerance (fail loud)', async () => {
    const reg = new ArtifactRegistry()
    await expect(
      dedupeArtifacts({
        registry: reg,
        baseline: baseProfile(),
        evalRunner: overlapRunner,
        tolerance: -0.1,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('is a no-op with fewer than two active artifacts', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('only', 'teachA'), 0.5)
    const out = await dedupeArtifacts({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: overlapRunner,
    })
    expect(out.checks).toHaveLength(0)
    expect(out.retired).toEqual([])
    expect(reg.get('only')?.status).toBe('active')
  })
})
