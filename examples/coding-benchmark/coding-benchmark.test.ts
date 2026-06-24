/**
 * Offline smoke test — proves the whole pipeline runs with no creds and that the
 * load-bearing honesty claims hold:
 *   1. the matrix produces exactly `harnesses × scenarios × reps` records and a
 *      defined leaderboard (the wiring is real, not a stub that returns nothing);
 *   2. the realness gate gates the ACTUAL round-0 stub the dispatch writes (not a
 *      separate strawman) to composite 0 — the anti-cheat demo fires on the
 *      benchmark's own data, and passes the real refined impl;
 *   3. the gate also fires on the NATURAL cheat for EVERY task (not just one stub
 *      shape) — the README's "catches the listed stub shapes" claim, ground-truthed;
 *   4. a real impl scored WITH its seeded fixture as a reference carries no spurious
 *      DEAD_ARTIFACT flag (the realness scan sees the artifact is imported);
 *   5. reps tighten the per-cell estimate HONESTLY — identical reps do NOT narrow
 *      the leaderboard CI vs reps=1 (reps are not independent samples).
 */

import type { RunRecord } from '@tangle-network/agent-eval'
import type { ProducedFile } from '@tangle-network/agent-eval/authenticity'
import { describe, expect, it } from 'vitest'
import { main, offlineSolutions } from './benchmark'
import { realnessGate } from './eval'
import { harnessProfiles } from './profiles'
import { type CodingScenario, scenarios } from './scenarios'
import { pairwiseStats } from './stats'

/** The natural cheat per scenario — the shortcut a real agent would actually reach for,
 *  NOT a hand-built strawman: the gate must fire on each of these. */
const naturalCheats: Record<string, string> = {
  // hollow body, but the constructor param is named `refillPerSec` (the prompt's own
  // name) — the decoy that defeated a `/refill/` realImpl.
  'rate-limiter':
    'export class RateLimiter {\n  constructor(_capacity: number, refillPerSec: number) {}\n  tryRemove(n: number): boolean { return true }\n}\n',
  // a for-loop is present, but it splits on newline+comma — the naive parse the
  // RFC-4180 cases break. The loop must NOT read as a real impl.
  'csv-parser':
    'export function parseCsv(input: string): string[][] {\n  const out: string[][] = []\n  for (const line of input.split("\\n")) out.push(line.split(","))\n  return out\n}\n',
  // a Map wrapper that never evicts — grows without bound, fails the at-capacity test.
  'lru-cache':
    'export class LruCache<K, V> {\n  private store = new Map<K, V>()\n  constructor(_capacity: number) {}\n  get(k: K) { return this.store.get(k) }\n  set(k: K, v: V) { this.store.set(k, v) }\n}\n',
}

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

  // The HIGH-severity claim: the gate fires on the NATURAL cheat for every task, not
  // only on one strawman stub shape. Each cheat below is the realistic shortcut with a
  // decoy token that defeated a looser realImpl — all must gate.
  it.each(scenarios)('gates the natural cheat for $id', (scenario: CodingScenario) => {
    const cheat = naturalCheats[scenario.id]
    expect(cheat, `no natural-cheat fixture for ${scenario.id}`).toBeDefined()
    const verdict = realnessGate(
      [{ path: scenario.solutionPath, content: cheat as string }],
      scenario.realnessSignals,
    )
    expect(verdict.gated, `natural cheat for ${scenario.id} slipped past the gate`).toBe(true)
    expect(verdict.score).toBe(0)
  })

  // The real offline solution for every task scores real (not gated). Confirms each
  // scenario's tightened realImpl still accepts the genuine implementation.
  it.each(scenarios)('passes the real offline solution for $id', (scenario: CodingScenario) => {
    const script = offlineSolutions[scenario.id]
    expect(script, `no offline solution for ${scenario.id}`).toBeDefined()
    const content = (script as NonNullable<typeof script>).solutionFor(99) // settled round
    const verdict = realnessGate(
      [{ path: scenario.solutionPath, content }],
      scenario.realnessSignals,
    )
    expect(verdict.gated, `real solution for ${scenario.id} was wrongly gated`).toBe(false)
    expect(verdict.score).toBeGreaterThan(0)
  })

  // The runtime DEAD_ARTIFACT fix: a real solution scored WITH its seeded fixture as a
  // non-scored reference carries no DEAD_ARTIFACT flag (the scan sees it IS imported).
  it.each(
    scenarios,
  )('does not flag DEAD_ARTIFACT on the real $id solution', (scenario: CodingScenario) => {
    const script = offlineSolutions[scenario.id]
    const content = (script as NonNullable<typeof script>).solutionFor(99)
    const reference: ProducedFile[] = [
      { path: scenario.fixture.path, content: scenario.fixture.content },
    ]
    const verdict = realnessGate(
      [{ path: scenario.solutionPath, content }],
      scenario.realnessSignals,
      reference,
    )
    expect(verdict.notes).not.toContain('DEAD_ARTIFACT')
  })

  // A reference cannot rescue a cheat: the gate still fires with the fixture present.
  it.each(
    scenarios,
  )('a fixture reference does not rescue the $id cheat', (scenario: CodingScenario) => {
    const cheat = naturalCheats[scenario.id] as string
    const reference: ProducedFile[] = [
      { path: scenario.fixture.path, content: scenario.fixture.content },
    ]
    const verdict = realnessGate(
      [{ path: scenario.solutionPath, content: cheat }],
      scenario.realnessSignals,
      reference,
    )
    expect(verdict.gated).toBe(true)
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
