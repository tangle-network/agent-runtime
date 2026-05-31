import { describe, expect, it } from 'vitest'
import { createKbGate, type FactCandidate, type FactJudge } from '../../src/mcp/kb-gate'

const SOURCE =
  'The 2025 annual report states total revenue was $1,200,000,000 for the fiscal year, up 12% year over year.'

function fact(overrides: Partial<FactCandidate>): FactCandidate {
  return {
    claim: 'revenue was 1.2B',
    verbatimPassage: 'total revenue was $1,200,000,000 for the fiscal year',
    sourceText: SOURCE,
    ...overrides,
  }
}

describe('createKbGate — valid-only KB growth', () => {
  it('accepts a grounded fact whose passage is present in the source', async () => {
    const gate = createKbGate()
    const r = await gate(fact({}))
    expect(r.accepted).toBe(true)
    expect(r.vetoedBy).toBeUndefined()
  })

  it('vetoes a fact whose passage is NOT in the source (the anti-hallucination floor)', async () => {
    const gate = createKbGate()
    const r = await gate(fact({ verbatimPassage: 'revenue tripled to nine billion dollars' }))
    expect(r.accepted).toBe(false)
    expect(r.vetoedBy).toBe('passage-present')
  })

  it('vetoes a too-short passage', async () => {
    const gate = createKbGate({ minPassageChars: 12 })
    const r = await gate(fact({ verbatimPassage: 'revenue' }))
    expect(r.accepted).toBe(false)
    expect(r.vetoedBy).toBe('passage-non-empty')
  })

  it('vetoes a value not present in the passage', async () => {
    const gate = createKbGate()
    const r = await gate(fact({ value: 999 }))
    expect(r.accepted).toBe(false)
    expect(r.vetoedBy).toBe('value-in-passage')
  })

  it('accepts a numeric value via comma-grouped form', async () => {
    const gate = createKbGate()
    const r = await gate(fact({ value: 1_200_000_000 }))
    expect(r.accepted).toBe(true)
  })

  it('accepts a numeric value via billion shorthand when the source uses it', async () => {
    const gate = createKbGate()
    const r = await gate(
      fact({
        verbatimPassage: 'revenue reached 1.2 billion in 2025',
        sourceText: 'Per the filing, revenue reached 1.2 billion in 2025.',
        value: 1_200_000_000,
      }),
    )
    expect(r.accepted).toBe(true)
  })

  it('vetoes a circular citation to a self-generated artifact (laundering)', async () => {
    const gate = createKbGate({ selfArtifactKinds: ['spec', 'cad_params'] })
    const r = await gate(fact({ citation: '[cad_params.v2]' }))
    expect(r.accepted).toBe(false)
    expect(r.vetoedBy).toBe('no-circular-citation')
  })

  it('runs consumer judges after the floor, fail-closed on first veto', async () => {
    const domainJudge: FactJudge = {
      name: 'requires-year',
      judge: (c) =>
        /\b20\d{2}\b/.test(c.verbatimPassage)
          ? { accept: true }
          : { accept: false, reason: 'no year' },
    }
    const gate = createKbGate({ judges: [domainJudge] })
    // passage is grounded but has no year → the consumer judge vetoes
    const r = await gate(
      fact({
        verbatimPassage: 'total revenue was $1,200,000,000 for the fiscal year',
      }),
    )
    expect(r.accepted).toBe(false)
    expect(r.vetoedBy).toBe('requires-year')
  })

  it('accepts when no value is asserted (value check is conditional)', async () => {
    const gate = createKbGate()
    const r = await gate(fact({ value: undefined }))
    expect(r.accepted).toBe(true)
  })
})
