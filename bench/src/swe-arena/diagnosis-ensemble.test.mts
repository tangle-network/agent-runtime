/**
 * Unit tests for the diagnosis ensemble: strict-JSON parsing of blind-analyst
 * output, and the fusion contract (union + agreement rank; minority findings
 * survive marked as competing hypotheses). Pure — no router, no tokens.
 */

import { describe, expect, it } from 'vitest'
import {
  classSimilarity,
  classTokens,
  defaultAnalysts,
  fuseFindings,
  fusedToAnalystFindings,
  parseAnalystFindings,
  surfacesPlacementRegex,
  type AnalystRawFinding,
  type AnalystReport,
} from './diagnosis-ensemble.ts'

const finding = (overrides: Partial<AnalystRawFinding>): AnalystRawFinding => ({
  failure_class: 'fix placement mismatch',
  evidence_quote: 'idna_encode helper added to django/core/mail/message.py',
  proposed_direction: 'place the helper where the maintainer tests expect it',
  confidence: 0.8,
  ...overrides,
})

const report = (analystId: string, findings: AnalystRawFinding[], ok = true): AnalystReport => ({
  analystId,
  model: 'glm-5.2',
  ok,
  findings,
})

describe('parseAnalystFindings', () => {
  it('parses a strict-JSON findings object', () => {
    const out = parseAnalystFindings(
      JSON.stringify({ findings: [{ failure_class: 'x', evidence_quote: 'q', proposed_direction: 'd', confidence: 0.9 }] }),
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.failure_class).toBe('x')
    expect(out[0]!.confidence).toBe(0.9)
  })

  it('tolerates markdown fences and surrounding prose', () => {
    const text = 'Here is my analysis:\n```json\n{"findings":[{"failure_class":"sandbox env","confidence":1.5}]}\n```\nHope that helps!'
    const out = parseAnalystFindings(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.failure_class).toBe('sandbox env')
    // Confidence is clamped to [0,1]; missing quote/direction default to ''.
    expect(out[0]!.confidence).toBe(1)
    expect(out[0]!.evidence_quote).toBe('')
  })

  it('handles braces inside JSON strings', () => {
    const out = parseAnalystFindings('{"findings":[{"failure_class":"a","evidence_quote":"code { nested } and \\"quoted\\"","confidence":0.5}]} trailing', )
    expect(out[0]!.evidence_quote).toContain('nested')
  })

  it('defaults a missing confidence to 0.5', () => {
    const out = parseAnalystFindings('{"findings":[{"failure_class":"c"}]}')
    expect(out[0]!.confidence).toBe(0.5)
  })

  it('throws on no JSON, empty findings, and missing failure_class', () => {
    expect(() => parseAnalystFindings('no json here')).toThrow(/no JSON object/)
    expect(() => parseAnalystFindings('{"findings":[]}')).toThrow(/no findings array/)
    expect(() => parseAnalystFindings('{"findings":[{"evidence_quote":"q"}]}')).toThrow(/failure_class/)
    expect(() => parseAnalystFindings('{"findings": [ {"failure_class": "x"')).toThrow(/never closes/)
  })
})

describe('classTokens / classSimilarity', () => {
  it('normalizes case, punctuation, and stopwords', () => {
    expect(classTokens('The Fix-Placement of mismatch')).toEqual(['fix', 'mismatch', 'placement'])
  })
  it('scores identical classes 1 and disjoint classes 0', () => {
    expect(classSimilarity('fix placement', 'placement fix')).toBe(1)
    expect(classSimilarity('sandbox environment', 'judge flake')).toBe(0)
  })
})

describe('fuseFindings', () => {
  it('merges same-class findings across analysts and ranks by agreement', () => {
    const fused = fuseFindings([
      report('a#1', [finding({ failure_class: 'fix placement mismatch' })]),
      report('a#2', [
        finding({ failure_class: 'placement mismatch of fix', confidence: 0.6 }),
        finding({ failure_class: 'budget starvation', evidence_quote: 'spentTokens=60000', confidence: 0.9 }),
      ]),
      report('a#3', [finding({ failure_class: 'wrong fix placement', confidence: 0.7 })]),
    ])
    expect(fused[0]!.failure_class).toBe('fix placement mismatch')
    expect(fused[0]!.agreement).toBe(3)
    expect(fused[0]!.analysts.sort()).toEqual(['a#1', 'a#2', 'a#3'])
    expect(fused[0]!.competingHypothesis).toBe(false)
    // Union: the minority finding SURVIVES, flagged as a competing hypothesis.
    const minority = fused.find((f) => f.failure_class === 'budget starvation')
    expect(minority).toBeDefined()
    expect(minority!.agreement).toBe(1)
    expect(minority!.competingHypothesis).toBe(true)
    expect(minority!.evidence[0]).toEqual({ analyst: 'a#2', quote: 'spentTokens=60000' })
  })

  it('does not flag a single-analyst run as competing hypothesis', () => {
    const fused = fuseFindings([report('solo#1', [finding({})])])
    expect(fused[0]!.competingHypothesis).toBe(false)
  })

  it('excludes failed analysts from fusion and from the competing denominator', () => {
    const fused = fuseFindings([
      report('a#1', [finding({})]),
      report('a#2', [], false), // failed analyst — no findings admitted
    ])
    expect(fused).toHaveLength(1)
    expect(fused[0]!.agreement).toBe(1)
    expect(fused[0]!.competingHypothesis).toBe(false)
  })

  it('ranks equal-agreement clusters by mean confidence', () => {
    const fused = fuseFindings([
      report('a#1', [
        finding({ failure_class: 'sandbox import failure', confidence: 0.2 }),
        finding({ failure_class: 'judge verdict flake', confidence: 0.95 }),
      ]),
    ])
    expect(fused.map((f) => f.failure_class)).toEqual(['judge verdict flake', 'sandbox import failure'])
  })

  it('merges labels that share half their tokens (threshold 0.5)', () => {
    const fused = fuseFindings([
      report('a#1', [
        finding({ failure_class: 'low conf class', confidence: 0.2 }),
        finding({ failure_class: 'high conf class', confidence: 0.95 }),
      ]),
    ])
    // 'conf' + 'class' overlap 2 of 4 distinct tokens ⇒ similarity 0.5 ⇒ one cluster.
    expect(fused).toHaveLength(1)
  })

  it('deduplicates one analyst repeating a class (agreement counts analysts, not findings)', () => {
    const fused = fuseFindings([
      report('a#1', [finding({}), finding({ confidence: 0.4 })]),
      report('a#2', [finding({})]),
    ])
    expect(fused).toHaveLength(1)
    expect(fused[0]!.agreement).toBe(2)
    expect(fused[0]!.evidence).toHaveLength(3)
  })
})

describe('fusedToAnalystFindings', () => {
  it('emits substrate AnalystFindings with agreement-scaled severity and artifact refs', () => {
    const fused = fuseFindings([
      report('a#1', [finding({})]),
      report('a#2', [finding({}), finding({ failure_class: 'judge flake', confidence: 0.3 })]),
    ])
    const out = fusedToAnalystFindings(fused, { dirs: ['/runs/x/SUP4'], totalAnalysts: 2 })
    expect(out).toHaveLength(2)
    const majority = out[0]!
    expect(majority.schema_version).toBe('1.0.0')
    expect(majority.finding_id.length).toBeGreaterThan(0)
    expect(majority.analyst_id).toBe('diagnosis-ensemble')
    expect(majority.severity).toBe('high')
    expect(majority.area).toBe('failure-diagnosis')
    expect(majority.claim).toContain('(2/2 analysts)')
    expect(majority.claim).toContain('fix placement mismatch')
    expect(majority.evidence_refs[0]).toEqual({ kind: 'artifact', uri: '/runs/x/SUP4' })
    const minority = out[1]!
    expect(minority.severity).toBe('medium')
    expect(minority.claim).toContain('[competing hypothesis]')
  })
})

describe('defaultAnalysts / placement regex', () => {
  it('builds N same-model specs with distinct ids', () => {
    const specs = defaultAnalysts(3, 'glm-5.2')
    expect(specs.map((s) => s.id)).toEqual(['glm-5.2#1', 'glm-5.2#2', 'glm-5.2#3'])
  })
  it('placement regex catches placement phrasings and misses unrelated classes', () => {
    const re = surfacesPlacementRegex()
    expect(re.test('fix placement mismatch')).toBe(true)
    expect(re.test('the helper belongs in django/utils/encoding.py')).toBe(true)
    expect(re.test('worker put the fix in the wrong file')).toBe(true)
    expect(surfacesPlacementRegex().test('router 503 storm during brain call')).toBe(false)
  })
})
