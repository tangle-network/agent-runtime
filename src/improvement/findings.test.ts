/**
 * Typed-findings accessor proof: conforming `AnalystFinding`s pass through by
 * reference, untyped seeds are LIFTED into real envelopes (not blind-cast),
 * and garbage is dropped without throwing. Guards the regression where
 * `improvement-driver` cast `unknown[]` findings to `AnalystFinding[]` and
 * build prompts rendered `(undefined) undefined` lines.
 */

import { makeFinding } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { isAnalystFinding, LIFTED_FINDING_ANALYST_ID, toAnalystFindings } from './findings'

const realFinding = makeFinding({
  analyst_id: 'test',
  severity: 'high',
  area: 'tool-use',
  confidence: 1,
  claim: 'the agent never reads before editing',
  evidence_refs: [],
})

describe('isAnalystFinding', () => {
  it('accepts the makeFinding envelope and rejects look-alikes', () => {
    expect(isAnalystFinding(realFinding)).toBe(true)
    expect(isAnalystFinding({ claim: 'partial', severity: 'high' })).toBe(false)
    expect(isAnalystFinding('a string finding')).toBe(false)
    expect(isAnalystFinding(null)).toBe(false)
    expect(isAnalystFinding({ ...realFinding, severity: 'catastrophic' })).toBe(false)
  })
})

describe('toAnalystFindings', () => {
  it('passes real findings through by reference and lifts the rest', () => {
    const digest = { scenario: 'b', composite: 0.2, notes: 'tour is not a permutation' }
    const out = toAnalystFindings([realFinding, 'raw string lesson', digest, 42, null, {}])

    // Real finding: same object, not re-enveloped.
    expect(out[0]).toBe(realFinding)
    // String seed: becomes the claim.
    expect(out[1]!.claim).toBe('raw string lesson')
    expect(out[1]!.analyst_id).toBe(LIFTED_FINDING_ANALYST_ID)
    // Digest object: most actionable text field wins; original rides in metadata.
    expect(out[2]!.claim).toBe('tour is not a permutation')
    expect(out[2]!.metadata).toEqual({ raw: digest })
    // number / null / {} carry no text — dropped, never thrown.
    expect(out).toHaveLength(3)
    expect(out.every(isAnalystFinding)).toBe(true)
  })

  it('prefers recommended_action over claim, matching the curator extraction order', () => {
    const out = toAnalystFindings([{ claim: 'what happened', recommended_action: 'what to do' }])
    expect(out[0]!.claim).toBe('what to do')
  })

  it('falls back to compact JSON for text-less objects so the signal survives', () => {
    const out = toAnalystFindings([{ seed: 'static-seed-finding' }])
    expect(out[0]!.claim).toBe('{"seed":"static-seed-finding"}')
  })
})
