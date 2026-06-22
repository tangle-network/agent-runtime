/**
 * `driftWatch` — the scheduled re-measure that demotes decayed artifacts.
 *
 * Every test is deterministic: a stub `EvalRunner` whose score depends on which
 * artifacts the profile carries, so the re-measured lift is exact and the
 * demote/keep decision is predictable. The POINT is the state machine —
 * `active` → `decayed` when the lift drops, `active` stays when it holds — and
 * that a demoted artifact drops out of `composeProfile`.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import { composeProfile } from './compose'
import { driftWatch } from './drift-watch'
import type { EvalResult, EvalRunner } from './marginal-lift'
import { ArtifactRegistry, lifecycleReasonKey } from './registry'

const baseProfile = (): AgentProfile => ({ name: 'agent', prompt: { instructions: [] } })

const promptArtifact = (id: string, instruction: string) => ({
  id,
  kind: 'prompt' as const,
  name: id,
  payload: { instruction },
})

/**
 * An eval runner that scores a profile by how many of a given set of "valuable"
 * instructions it carries (0.2 each). Drop an instruction from the valuable set
 * to simulate the world moving on — that artifact's lift goes to zero.
 */
const runnerValuing = (valuable: ReadonlySet<string>): EvalRunner => {
  return async (profile): Promise<EvalResult> => {
    const instructions = profile.prompt?.instructions ?? []
    const hits = instructions.filter((i) => valuable.has(i)).length
    return { composite: hits * 0.2, costUsd: instructions.length * 0.001 }
  }
}

/** Register `input` and immediately promote it WITH a lift (the active state). */
function registerActive(
  reg: ArtifactRegistry,
  input: ReturnType<typeof promptArtifact>,
  lift: number,
): void {
  reg.register(input)
  reg.promoteWithLift(input.id, lift)
}

describe('driftWatch', () => {
  it('demotes an active artifact whose lift decayed to zero, keeping one that holds', async () => {
    const reg = new ArtifactRegistry()
    // Two active artifacts, each promoted on a real +0.2 lift.
    registerActive(reg, promptArtifact('keeps', 'still-valuable'), 0.2)
    registerActive(reg, promptArtifact('decays', 'once-valuable'), 0.2)

    // The world moved on: only 'still-valuable' still earns lift now.
    const runner = runnerValuing(new Set(['still-valuable']))

    const out = await driftWatch({ registry: reg, baseline: baseProfile(), evalRunner: runner })

    // The decayed one was demoted; the holding one stayed active.
    expect(out.demoted).toEqual(['decays'])
    expect(reg.get('decays')?.status).toBe('decayed')
    expect(reg.get('keeps')?.status).toBe('active')

    // The check records the before/after lift and a reason on the demotion.
    const decayedCheck = out.checks.find((c) => c.artifact.id === 'decays')!
    expect(decayedCheck.priorLift).toBeCloseTo(0.2, 10)
    expect(decayedCheck.currentLift).toBeCloseTo(0, 10)
    expect(decayedCheck.demoted).toBe(true)
    expect(reg.get('decays')?.metadata?.[lifecycleReasonKey]).toContain('decayed')

    // The kept artifact's lift receipt is refreshed to the latest measurement.
    expect(reg.liftOf('keeps')).toBeCloseTo(0.2, 10)
  })

  it('demoting drops the artifact out of composeProfile (active set only)', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('a', 'still-valuable'), 0.2)
    registerActive(reg, promptArtifact('b', 'once-valuable'), 0.2)

    // Before drift: both compose in.
    const before = composeProfile(reg, baseProfile())
    expect(before.prompt?.instructions).toEqual(['still-valuable', 'once-valuable'])

    await driftWatch({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: runnerValuing(new Set(['still-valuable'])),
    })

    // After drift: only the artifact that held its lift composes in.
    const after = composeProfile(reg, baseProfile())
    expect(after.prompt?.instructions).toEqual(['still-valuable'])
  })

  it('a decayed artifact is re-promotable when a later re-measure recovers its lift', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('x', 'seasonal'), 0.2)

    // First watch: 'seasonal' earns nothing → decayed.
    await driftWatch({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: runnerValuing(new Set()),
    })
    expect(reg.get('x')?.status).toBe('decayed')

    // Re-promote it on a recovered measurement (the loop's normal path).
    reg.promoteWithLift('x', 0.2)
    expect(reg.get('x')?.status).toBe('active')

    // Second watch with the value back: it survives.
    const out = await driftWatch({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: runnerValuing(new Set(['seasonal'])),
    })
    expect(out.demoted).toEqual([])
    expect(reg.get('x')?.status).toBe('active')
  })

  it('honors an absolute minLift keep-bar above zero', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('weak', 'weakly-valuable'), 0.2)

    // 'weak' still earns +0.2, but the keep-bar is 0.3 → it decays.
    const out = await driftWatch({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: runnerValuing(new Set(['weakly-valuable'])),
      minLift: 0.3,
    })
    expect(out.demoted).toEqual(['weak'])
    expect(reg.get('weak')?.status).toBe('decayed')
  })

  it('honors a relative-decay keep-bar (lift fell below a fraction of its prior)', async () => {
    const reg = new ArtifactRegistry()
    // Promoted on +0.4; a runner where it now earns only +0.2 (half its prior).
    reg.register(promptArtifact('halved', 'half'))
    reg.promoteWithLift('halved', 0.4)

    const runner: EvalRunner = async (profile): Promise<EvalResult> => {
      const has = (profile.prompt?.instructions ?? []).includes('half')
      return { composite: has ? 0.2 : 0, costUsd: 0 }
    }

    // Absolute floor 0 alone would KEEP it (+0.2 > 0). The relative bar (lost
    // more than 25% of its 0.4 prior) demotes it.
    const out = await driftWatch({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: runner,
      maxRelativeDecay: 0.25,
    })
    expect(out.demoted).toEqual(['halved'])
    expect(reg.get('halved')?.metadata?.[lifecycleReasonKey]).toContain('decay floor')
  })

  it('runs the shared baseline arm once regardless of active-set size', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('a', 'x'), 0.2)
    registerActive(reg, promptArtifact('b', 'y'), 0.2)
    registerActive(reg, promptArtifact('c', 'z'), 0.2)

    let baselineRuns = 0
    let withRuns = 0
    const runner: EvalRunner = async (profile): Promise<EvalResult> => {
      const n = (profile.prompt?.instructions ?? []).length
      if (n === 0) baselineRuns += 1
      else withRuns += 1
      return { composite: n * 0.2, costUsd: 0 }
    }

    await driftWatch({ registry: reg, baseline: baseProfile(), evalRunner: runner })
    expect(baselineRuns).toBe(1) // one shared "without" arm
    expect(withRuns).toBe(3) // one "with" arm per active artifact
  })

  it('only touches the active set — candidates and already-decayed are left alone', async () => {
    const reg = new ArtifactRegistry()
    registerActive(reg, promptArtifact('active', 'v'), 0.2)
    reg.register(promptArtifact('cand', 'v')) // candidate, never promoted

    const out = await driftWatch({
      registry: reg,
      baseline: baseProfile(),
      evalRunner: runnerValuing(new Set()), // nothing earns lift
    })
    // The active one decayed; the candidate was never examined.
    expect(out.checks.map((c) => c.artifact.id)).toEqual(['active'])
    expect(reg.get('cand')?.status).toBe('candidate')
  })

  it('rejects a non-finite minLift and a negative maxRelativeDecay (fail loud)', async () => {
    const reg = new ArtifactRegistry()
    await expect(
      driftWatch({
        registry: reg,
        baseline: baseProfile(),
        evalRunner: runnerValuing(new Set()),
        minLift: Number.NaN,
      }),
    ).rejects.toThrow(ValidationError)
    await expect(
      driftWatch({
        registry: reg,
        baseline: baseProfile(),
        evalRunner: runnerValuing(new Set()),
        maxRelativeDecay: -0.1,
      }),
    ).rejects.toThrow(ValidationError)
  })
})
