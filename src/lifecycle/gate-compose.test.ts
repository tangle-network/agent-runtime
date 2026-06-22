import type { RunRecord } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { composeProfile } from './compose'
import { heldOutPromotionGate, thresholdPromotionGate } from './gate'
import type { MarginalLift } from './marginal-lift'
import { ArtifactRegistry } from './registry'
import type { ArtifactInput } from './types'

const base = (): AgentProfile => ({ name: 'a', prompt: { instructions: [] } })

const promptInput = (instruction: string, name: string): ArtifactInput<'prompt'> => ({
  kind: 'prompt',
  name,
  payload: { instruction },
})

// A per-task RunRecord with a given split score, paired by seed.
const rec = (
  candidateId: string,
  split: 'search' | 'holdout',
  score: number,
  seed: number,
): RunRecord => ({
  runId: `${candidateId}-${split}-${seed}`,
  experimentId: 'exp',
  candidateId,
  seed,
  model: 'm',
  promptHash: 'p',
  configHash: 'c',
  commitSha: 's',
  wallMs: 1,
  costUsd: 0.01,
  tokenUsage: { input: 1, output: 1 },
  outcome: split === 'search' ? { searchScore: score, raw: {} } : { holdoutScore: score, raw: {} },
  splitTag: split,
})

const liftWithRuns = (
  candidate: RunRecord[],
  baseline: RunRecord[],
  scoreDelta: number,
): MarginalLift => ({
  artifactId: 'x',
  withArtifact: { composite: 0.9, costUsd: 0.01, runs: candidate },
  withoutArtifact: { composite: 0.5, costUsd: 0.01, runs: baseline },
  scoreDelta,
  costDelta: 0,
})

describe('thresholdPromotionGate', () => {
  it('promotes on positive held-back lift, rejects on non-positive', () => {
    const gate = thresholdPromotionGate()
    expect(gate.decide({ scoreDelta: 0.1 } as MarginalLift).promote).toBe(true)
    const reject = gate.decide({ scoreDelta: 0 } as MarginalLift)
    expect(reject.promote).toBe(false)
    expect(reject.rejectionCode).toBe('negative_delta')
  })

  it('honors a custom minDelta', () => {
    const gate = thresholdPromotionGate(0.2)
    expect(gate.decide({ scoreDelta: 0.15 } as MarginalLift).promote).toBe(false)
    expect(gate.decide({ scoreDelta: 0.25 } as MarginalLift).promote).toBe(true)
  })
})

describe('heldOutPromotionGate', () => {
  it('promotes when the candidate beats baseline on paired holdout records', () => {
    const gate = heldOutPromotionGate({ baselineKey: 'base', minProductiveRuns: 1 })
    const cand = [
      rec('cand', 'search', 0.9, 1),
      rec('cand', 'holdout', 0.9, 1),
      rec('cand', 'search', 0.9, 2),
      rec('cand', 'holdout', 0.9, 2),
    ]
    const baseline = [
      rec('base', 'search', 0.5, 1),
      rec('base', 'holdout', 0.5, 1),
      rec('base', 'search', 0.5, 2),
      rec('base', 'holdout', 0.5, 2),
    ]
    const verdict = gate.decide(liftWithRuns(cand, baseline, 0.4))
    expect(verdict.promote).toBe(true)
    expect(verdict.rejectionCode).toBeNull()
  })

  it('rejects when the candidate does not beat baseline on the holdout', () => {
    const gate = heldOutPromotionGate({ baselineKey: 'base', minProductiveRuns: 1 })
    const cand = [rec('cand', 'holdout', 0.5, 1), rec('cand', 'holdout', 0.5, 2)]
    const baseline = [rec('base', 'holdout', 0.5, 1), rec('base', 'holdout', 0.5, 2)]
    const verdict = gate.decide(liftWithRuns(cand, baseline, 0))
    expect(verdict.promote).toBe(false)
  })

  it('FAILS LOUD when the eval produced no per-task records (no fabricated significance)', () => {
    const gate = heldOutPromotionGate({ baselineKey: 'base' })
    const lift: MarginalLift = {
      artifactId: 'x',
      withArtifact: { composite: 0.9, costUsd: 0 },
      withoutArtifact: { composite: 0.5, costUsd: 0 },
      scoreDelta: 0.4,
      costDelta: 0,
    }
    expect(() => gate.decide(lift)).toThrow(/no per-task records/)
  })
})

describe('composeProfile', () => {
  it('folds in the top-k active artifacts ranked by measured lift', () => {
    const reg = new ArtifactRegistry()
    const low = reg.register(promptInput('low lift line', 'low'))
    const high = reg.register(promptInput('high lift line', 'high'))
    const mid = reg.register(promptInput('mid lift line', 'mid'))
    reg.promoteWithLift(low.id, 0.1)
    reg.promoteWithLift(high.id, 0.9)
    reg.promoteWithLift(mid.id, 0.5)

    // top-2 by lift → high then mid, in lift order
    const composed = composeProfile(reg, base(), { k: 2 })
    expect(composed.prompt?.instructions).toEqual(['high lift line', 'mid lift line'])
  })

  it('excludes artifacts promoted WITHOUT a measured lift (the invariant)', () => {
    const reg = new ArtifactRegistry()
    const measured = reg.register(promptInput('measured line', 'measured'))
    const flagged = reg.register(promptInput('flag-only line', 'flagged'))
    reg.promoteWithLift(measured.id, 0.3)
    reg.promote(flagged.id) // bare flag, no lift receipt

    const composed = composeProfile(reg, base())
    expect(composed.prompt?.instructions).toEqual(['measured line'])
  })

  it('filters by kind', () => {
    const reg = new ArtifactRegistry()
    const p = reg.register(promptInput('a prompt line', 'p'))
    const t = reg.register({ kind: 'tool', key: 'edit', name: 'edit', payload: { enabled: true } })
    reg.promoteWithLift(p.id, 0.5)
    reg.promoteWithLift(t.id, 0.9)

    const onlyPrompt = composeProfile(reg, base(), { kind: 'prompt' })
    expect(onlyPrompt.prompt?.instructions).toEqual(['a prompt line'])
    expect(onlyPrompt.tools).toBeUndefined()
  })

  it('returns the base unchanged when no artifact is active', () => {
    const reg = new ArtifactRegistry()
    reg.register(promptInput('candidate only', 'c')) // never promoted
    const composed = composeProfile(reg, base())
    expect(composed.prompt?.instructions).toEqual([])
  })
})
