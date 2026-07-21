/**
 * Substrate passthrough guard: the pure probe over module text plus the live
 * contract check against the installed agent-eval bundle. The guard must pass
 * cleanly on a substrate that threads premeasuredBaseline +
 * maxImprovementShots and THROW LOUD (never fall back) on one that drops
 * them — so a run against a stale install dies at t≈0, before it can
 * silently re-spend its baseline.
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
  it('passes on a substrate that names both passthroughs, throws loud otherwise', () => {
    const path = resolveContractModulePath()
    expect(path).toMatch(/agent-eval/)
    const caps = detectPassthroughCaps(readFileSync(path, 'utf8'))
    // The guard's contract holds against whatever substrate is installed:
    // both literals present ⇒ clean pass with the caps logged; anything less
    // ⇒ a loud actionable error naming the stale bundle (never a silent
    // fallback). A run against a stale install dies HERE, at t≈0.
    if (caps.premeasuredBaseline && caps.maxImprovementShots) {
      const logged: string[] = []
      expect(() => assertSubstratePassthroughs((msg) => logged.push(msg))).not.toThrow()
      expect(logged.join('\n')).toContain('premeasuredBaseline=true')
      expect(logged.join('\n')).toContain('maxImprovementShots=true')
    } else {
      expect(() => assertSubstratePassthroughs()).toThrow(/stale substrate install/)
    }
  })
})
