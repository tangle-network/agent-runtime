/**
 * Substrate passthrough guard: the pure probe over module text plus the live
 * fail-loud assertion against the installed agent-eval contract bundle. The
 * live assertion doubles as the CI stale-install check — a bench wired to a
 * substrate that drops premeasuredBaseline/maxImprovementShots fails HERE,
 * before any run can silently re-spend its baseline.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertSubstratePassthroughs,
  detectPassthroughCaps,
  resolveContractModulePath,
} from './capabilities.mts'

describe('detectPassthroughCaps (pure)', () => {
  it('an option name absent from the bundle reads as no capability', () => {
    expect(detectPassthroughCaps('')).toEqual({ premeasuredBaseline: false, maxImprovementShots: false })
    expect(detectPassthroughCaps('function selfImprove(opts) { return runSelfImprove(opts) }')).toEqual({
      premeasuredBaseline: false,
      maxImprovementShots: false,
    })
  })

  it('the forwarding literals flip their capability independently', () => {
    expect(detectPassthroughCaps('premeasuredBaseline: opts.premeasuredBaseline,')).toEqual({
      premeasuredBaseline: true,
      maxImprovementShots: false,
    })
    expect(detectPassthroughCaps('maxImprovementShots: budget.maxImprovementShots,')).toEqual({
      premeasuredBaseline: false,
      maxImprovementShots: true,
    })
  })
})

describe('live substrate guard', () => {
  it('the installed contract bundle names both passthroughs (stale install = loud failure)', () => {
    const path = resolveContractModulePath()
    expect(path).toMatch(/agent-eval/)
    const caps = detectPassthroughCaps(readFileSync(path, 'utf8'))
    expect(caps).toEqual({ premeasuredBaseline: true, maxImprovementShots: true })
    const logged: string[] = []
    expect(() => assertSubstratePassthroughs((msg) => logged.push(msg))).not.toThrow()
    expect(logged.join('\n')).toContain('premeasuredBaseline=true')
    expect(logged.join('\n')).toContain('maxImprovementShots=true')
  })
})
