/**
 * Offline smoke test — proves the whole pipeline runs with no creds and that the
 * load-bearing honesty claims hold:
 *   1. the matrix produces exactly `harnesses × scenarios × reps` records and a
 *      defined leaderboard (the wiring is real, not a stub that returns nothing);
 *   2. the realness gate gates the ACTUAL round-0 stub the dispatch writes (not a
 *      separate strawman) to composite 0 — the anti-cheat demo fires on the
 *      benchmark's own data, and passes the real refined impl;
 *   3. reps tighten the per-cell estimate HONESTLY — identical reps do NOT narrow
 *      the leaderboard CI vs reps=1 (reps are not independent samples).
 */

import type { RunRecord } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { main, offlineSolutions } from './benchmark'
import { realnessGate } from './eval'
import { harnessProfiles } from './profiles'
import { scenarios } from './scenarios'
import { pairwiseStats } from './stats'

describe('coding-benchmark (offline)', () => {
  // Integration smoke: runs the real matrix end-to-end (real box.exec on the offline
  // toolchain, all refine rounds since the checks can't pass without the toolchain).
  it('runs the full matrix and returns a defined leaderboard', async () => {
    const reps = 1
    const summary = await main(['--reps', String(reps)])
    expect(summary.records).toBe(harnessProfiles.length * scenarios.length * reps)
    expect(summary.leaderboard).toBe(harnessProfiles.length)
  }, 180_000)

  it("gates the dispatch's OWN round-0 stub to composite 0 (the demo fires on real data)", () => {
    const rl = scenarios.find((s) => s.id === 'rate-limiter')
    expect(rl).toBeDefined()
    const script = offlineSolutions['rate-limiter']
    expect(script).toBeDefined()
    // The EXACT content the offline dispatch writes on round 0 — not a hand-built
    // strawman. If a future edit makes this stub look real, this test goes red.
    const round0 = (script as NonNullable<typeof script>).solutionFor(0)
    const verdict = realnessGate(
      [{ path: 'src/rate-limiter.ts', content: round0 }],
      (rl as NonNullable<typeof rl>).realnessSignals,
    )
    expect(verdict.gated).toBe(true)
    expect(verdict.score).toBe(0)
  })

  it("passes the dispatch's refined round-1 token-bucket implementation", () => {
    const rl = scenarios.find((s) => s.id === 'rate-limiter')
    const script = offlineSolutions['rate-limiter']
    expect(script).toBeDefined()
    const round1 = (script as NonNullable<typeof script>).solutionFor(1)
    const verdict = realnessGate(
      [{ path: 'src/rate-limiter.ts', content: round1 }],
      (rl as NonNullable<typeof rl>).realnessSignals,
    )
    expect(verdict.gated).toBe(false)
    expect(verdict.score).toBeGreaterThan(0)
  })

  it('reps do NOT fake independent n — identical reps leave the CI unchanged', () => {
    // Two harnesses, two scenarios, identical scores. Build records for reps=1 and
    // reps=3 (the extra reps are exact duplicates → zero new information). The honest
    // leaderboard collapses reps to one mean per (harness, scenario), so the CI width
    // and the n must be IDENTICAL across reps — duplicating a sample cannot tighten it.
    const mk = (harness: string, scenarioId: string, s: number): RunRecord =>
      ({
        candidateId: harness,
        scenarioId,
        outcome: { searchScore: s },
      }) as unknown as RunRecord
    const base: Array<[string, string, number]> = [
      ['a', 's1', 0.9],
      ['a', 's2', 0.4],
      ['b', 's1', 0.8],
      ['b', 's2', 0.5],
    ]
    const nameOf = (id: string) => id
    const reps1 = base.map(([h, s, v]) => mk(h, s, v))
    const reps3 = base.flatMap(([h, s, v]) => [mk(h, s, v), mk(h, s, v), mk(h, s, v)])

    const r1 = pairwiseStats(reps1, nameOf)
    const r3 = pairwiseStats(reps3, nameOf)

    for (const harness of ['a', 'b']) {
      const row1 = r1.leaderboard.find((r) => r.harness === harness)
      const row3 = r3.leaderboard.find((r) => r.harness === harness)
      expect(row1).toBeDefined()
      expect(row3).toBeDefined()
      const r1Row = row1 as NonNullable<typeof row1>
      const r3Row = row3 as NonNullable<typeof row3>
      // Same honest n (= distinct scenarios), same mean, and the CI must NOT narrow.
      expect(r3Row.n).toBe(r1Row.n)
      expect(r3Row.meanComposite).toBeCloseTo(r1Row.meanComposite, 10)
      const width1 = r1Row.ci.upper - r1Row.ci.lower
      const width3 = r3Row.ci.upper - r3Row.ci.lower
      expect(width3).toBeCloseTo(width1, 10)
      // The pass-rate Wilson interval likewise must not tighten.
      const pw1 = r1Row.passCi.upper - r1Row.passCi.lower
      const pw3 = r3Row.passCi.upper - r3Row.passCi.lower
      expect(pw3).toBeCloseTo(pw1, 10)
    }
  })
})
