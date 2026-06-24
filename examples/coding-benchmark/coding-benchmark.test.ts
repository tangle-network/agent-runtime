/**
 * Offline smoke test — proves the whole pipeline runs with no creds and that the
 * two load-bearing honesty claims hold:
 *   1. the matrix produces exactly `harnesses × scenarios × reps` records and a
 *      defined leaderboard (the wiring is real, not a stub that returns nothing);
 *   2. the realness gate actually catches a `return true` stub and gates it to 0
 *      (the README's anti-fake claim, asserted against the real scan).
 */

import { describe, expect, it } from 'vitest'
import { main } from './benchmark'
import { realnessGate } from './eval'
import { harnessProfiles } from './profiles'
import { scenarios } from './scenarios'

describe('coding-benchmark (offline)', () => {
  // Integration smoke: runs the real matrix end-to-end (real box.exec on the offline
  // toolchain, all refine rounds since the checks can't pass without the toolchain).
  it('runs the full matrix and returns a defined leaderboard', async () => {
    const reps = 1
    const summary = await main(['--reps', String(reps)])
    expect(summary.records).toBe(harnessProfiles.length * scenarios.length * reps)
    expect(summary.leaderboard).toBe(harnessProfiles.length)
  }, 180_000)

  it('realness gate catches a return-true stub', () => {
    const rl = scenarios.find((s) => s.id === 'rate-limiter')
    expect(rl).toBeDefined()
    const stub = 'export class RateLimiter { tryRemove(n: number): boolean { return true } }\n'
    const verdict = realnessGate(
      [{ path: 'src/rate-limiter.ts', content: stub }],
      (rl as NonNullable<typeof rl>).realnessSignals,
    )
    expect(verdict.gated).toBe(true)
    expect(verdict.score).toBe(0)
  })

  it('realness gate passes a real token-bucket implementation', () => {
    const rl = scenarios.find((s) => s.id === 'rate-limiter')
    const real =
      'export class RateLimiter {\n  private tokens = 0\n  private last = Date.now()\n' +
      '  constructor(private capacity: number, private refillPerSec: number) { this.tokens = capacity }\n' +
      '  tryRemove(n: number): boolean {\n    const now = Date.now()\n' +
      '    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec)\n' +
      '    this.last = now\n    if (n > this.tokens) return false\n    this.tokens -= n\n    return true\n  }\n}\n'
    const verdict = realnessGate(
      [{ path: 'src/rate-limiter.ts', content: real }],
      (rl as NonNullable<typeof rl>).realnessSignals,
    )
    expect(verdict.gated).toBe(false)
    expect(verdict.score).toBeGreaterThan(0)
  })
})
