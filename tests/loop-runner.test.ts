import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/errors'
import { type DelegatedLoopRegistry, runDelegatedLoop } from '../src/loop-runner'

const clock = () => {
  let t = 0
  return () => (t += 100)
}

describe('runDelegatedLoop — mode dispatch', () => {
  it('does not expose the legacy proposer-driven self-improvement factory', async () => {
    const runtime = await import('../src/index')
    expect(runtime).not.toHaveProperty('selfImproveLoopRunner')
  })

  it('routes to the registered runner and returns a uniform ok result', async () => {
    const registry: DelegatedLoopRegistry = {
      research: async () => ({ grounded: 3 }),
    }
    const r = await runDelegatedLoop('research', registry, { now: clock() })
    expect(r.mode).toBe('research')
    expect(r.ok).toBe(true)
    expect(r.output).toEqual({ grounded: 3 })
    expect(r.durationMs).toBeGreaterThan(0)
  })

  it('fails loud (ConfigError) on a mode with no registered runner', async () => {
    await expect(runDelegatedLoop('audit', {})).rejects.toThrow(ConfigError)
    await expect(runDelegatedLoop('audit', {})).rejects.toThrow(
      /no runner registered for mode 'audit'/,
    )
  })

  it('captures a thrown engine as ok:false (unattended runs record, not crash)', async () => {
    const registry: DelegatedLoopRegistry = {
      'self-improve': async () => {
        throw new Error('reflection model 502')
      },
    }
    const r = await runDelegatedLoop('self-improve', registry, { now: clock() })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('reflection model 502')
    expect(r.durationMs).toBeGreaterThan(0)
  })
})

import { researchLoopRunner, type VetoedFact } from '../src/loop-runner'
import type { FactCandidate } from '../src/mcp/kb-gate'

const neverAbort = new AbortController().signal

describe('researchLoopRunner — valid-only KB growth with remediation', () => {
  const grounded: FactCandidate = {
    claim: 'revenue was 100',
    verbatimPassage: 'revenue was 100 in 2025',
    sourceText: 'The filing notes revenue was 100 in 2025.',
  }
  const ungrounded: FactCandidate = {
    claim: 'profit was 50',
    verbatimPassage: 'profit was 50',
    sourceText: 'this source says nothing of the sort',
  }

  it('accepts grounded facts, vetoes ungrounded ones (single round, escalates the veto)', async () => {
    const runner = researchLoopRunner({ research: async () => [grounded, ungrounded] })
    const res = await runner(neverAbort)
    expect(res.rounds).toBe(1)
    expect(res.accepted).toHaveLength(1)
    expect(res.accepted[0]?.claim).toBe('revenue was 100')
    expect(res.vetoed).toHaveLength(1)
    expect(res.vetoed[0]?.vetoedBy).toBe('passage-present')
  })

  it('re-researches vetoed facts next round and accepts once grounded (correct-on-veto)', async () => {
    const research = async (round: number, vetoed: VetoedFact[]): Promise<FactCandidate[]> => {
      if (round === 0) return [grounded, ungrounded]
      // round 1: re-ground the previously-vetoed candidate with a real source
      return vetoed.map((v) => ({
        ...v.candidate,
        sourceText: 'a better source: profit was 50 last year',
      }))
    }
    const runner = researchLoopRunner({ research, maxRounds: 2 })
    const res = await runner(neverAbort)
    expect(res.rounds).toBe(2)
    expect(res.accepted.map((f) => f.claim).sort()).toEqual(['profit was 50', 'revenue was 100'])
    expect(res.vetoed).toHaveLength(0)
  })
})
