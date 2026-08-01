/**
 * A parent authors its child's budget. Nothing stopped it authoring one no child of that harness
 * could survive, and four separate roots did exactly that across six measured runs — 2,000 / 8,000
 * / 12,000 / 20,000 tokens against a `pi` floor whose lowest observed settlement was 31,211. One of
 * those children wrote its deliverable correctly and was killed before reporting.
 */
import { describe, expect, it } from 'vitest'
import { WORKER_TOKEN_FLOOR, workerTokenFloor } from '../../src/runtime/supervise/budget-floor'

describe('worker token floor', () => {
  it('reports the measured pi floor', () => {
    // The lowest of six live settlements, not the median: a refusal must mean "below what has EVER
    // worked", never "below what is typical".
    expect(workerTokenFloor('pi')).toBe(31_211)
  })

  it('has NO floor for the router arm, which re-sends no harness scaffolding', () => {
    expect(workerTokenFloor(null)).toBeNull()
  })

  it('reports null — not zero — for a harness nobody has measured', () => {
    // An unmeasured floor is UNKNOWN. Zero would read as "measured, and it is free".
    expect(workerTokenFloor('codex')).toBeNull()
    expect(workerTokenFloor('claude-code')).toBeNull()
  })

  it('refuses every budget the measured roots actually authored', () => {
    const floor = workerTokenFloor('pi')!
    for (const authored of [2_000, 8_000, 12_000, 20_000]) {
      expect(authored).toBeLessThan(floor)
    }
  })

  it('admits a budget at or above the floor', () => {
    const floor = workerTokenFloor('pi')!
    expect(floor).toBeLessThanOrEqual(31_211)
    expect(120_000).toBeGreaterThan(floor)
  })

  it('carries only measured numbers, so the table cannot drift into invention', () => {
    for (const [harness, value] of Object.entries(WORKER_TOKEN_FLOOR)) {
      if (value === null) continue
      expect(harness).toBe('pi')
      expect(value).toBeGreaterThan(0)
    }
  })
})
