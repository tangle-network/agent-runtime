/**
 * Substrate passthrough feature-detect: the pure probe over module text plus
 * a live probe against the installed agent-eval contract bundle (shape only —
 * the live values flip to true the day feat/improve-loop-passthroughs merges,
 * which is the intended behavior, so they are not pinned here).
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  detectPassthroughCaps,
  loadSubstrateCaps,
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

describe('live substrate probe', () => {
  it('resolves the installed contract bundle and returns booleans, fail-closed on error', () => {
    const path = resolveContractModulePath()
    expect(path).toMatch(/agent-eval/)
    expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0)
    const caps = loadSubstrateCaps()
    expect(typeof caps.premeasuredBaseline).toBe('boolean')
    expect(typeof caps.maxImprovementShots).toBe('boolean')
    // The probe result must equal the pure detector over the same bytes.
    expect(caps).toEqual(detectPassthroughCaps(readFileSync(path, 'utf8')))
  })
})
