import { describe, expect, it } from 'vitest'
import {
  createDataCreationLoop,
  discriminativeAcceptRule,
  qualityCheck,
} from './agentic-data-creation'
import {
  baseInstruction,
  buildRubricJudge,
  challengerClient,
  groundingDoc,
  solverClient,
} from './offline-fixtures'

describe('discriminativeAcceptRule (the new piece)', () => {
  it('accepts an example that separates strong from weak', () => {
    const d = discriminativeAcceptRule({ strongScore: 0.77, weakScore: 0.46 })
    expect(d.accept).toBe(true)
    expect(d.reason).toContain('discriminates')
  })

  it('rejects "too easy" when the weak solver passes', () => {
    const d = discriminativeAcceptRule({ strongScore: 0.86, weakScore: 0.84 })
    expect(d.accept).toBe(false)
    expect(d.reason).toContain('too easy')
  })

  it('rejects "too hard" when even the strong solver misses', () => {
    const d = discriminativeAcceptRule({ strongScore: 0.55, weakScore: 0.3 })
    expect(d.accept).toBe(false)
    expect(d.reason).toContain('too hard')
  })

  it('rejects when the gap is below minGap even if both thresholds hold', () => {
    const d = discriminativeAcceptRule({ strongScore: 0.66, weakScore: 0.48 })
    expect(d.accept).toBe(false)
    expect(d.reason).toContain('not discriminative')
  })

  it('honors custom thresholds', () => {
    const strict = discriminativeAcceptRule({ strongScore: 0.77, weakScore: 0.46, minGap: 0.4 })
    expect(strict.accept).toBe(false)
  })
})

describe('qualityCheck', () => {
  it('rejects a reference that leaks verbatim into the context', () => {
    const q = qualityCheck({
      context: 'The answer is 42 and nothing else matters.',
      question: 'What is the answer?',
      reference: 'The answer is 42',
      rubric: ['a', 'b'],
    })
    expect(q.ok).toBe(false)
    expect(q.reason).toContain('leaked')
  })

  it('rejects a thin rubric', () => {
    const q = qualityCheck({ context: 'c', question: 'q', reference: 'r', rubric: ['only one'] })
    expect(q.ok).toBe(false)
    expect(q.reason).toContain('thin rubric')
  })

  it('passes a clean example', () => {
    const q = qualityCheck({
      context: 'Some grounding context that does not contain the answer phrasing.',
      question: 'Why does it matter?',
      reference: 'Because of a distinct reasoning chain.',
      rubric: ['states X', 'explains Y'],
    })
    expect(q.ok).toBe(true)
  })
})

describe('createDataCreationLoop (offline)', () => {
  it('manufactures discriminating examples and separates plain from agentic gaps', async () => {
    const result = await createDataCreationLoop({
      doc: groundingDoc,
      baseInstruction,
      challenger: challengerClient(),
      weakSolver: solverClient('weak'),
      strongSolver: solverClient('strong'),
      judge: buildRubricJudge(),
      target: 2,
      samples: 3,
      maxRetries: 4,
    })

    expect(result.accepted).toHaveLength(2)
    for (const ex of result.accepted) {
      expect(ex.decision.accept).toBe(true)
      expect(ex.gap).toBeGreaterThanOrEqual(0.2)
    }

    // Calibration: the agentic (loop-accepted) gap must clearly exceed the plain (first-draft) gap.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const plain = mean(result.plainGaps)
    const agentic = mean(result.agenticGaps)
    expect(plain).toBeLessThan(0.1)
    expect(agentic).toBeGreaterThan(0.25)
    expect(agentic - plain).toBeGreaterThanOrEqual(0.15)

    // Accepted examples accreted into the corpus, and the cost ledger recorded real spend.
    const stored = await result.corpus.query({ area: 'training-data' })
    expect(stored).toHaveLength(2)
    expect(result.cost.summary().totalCostUsd).toBeGreaterThan(0)
  })

  it('never force-accepts a rejected example (the null case yields zero accepted)', async () => {
    // `runAgentRounds`'s winner is best-SCORING, and falls back to the best score even when nothing passed
    // the accept rule. With an accept rule that always rejects, NO example should be accepted — the
    // loop must report an honest empty set, not the least-bad reject pushed through as a "winner".
    const result = await createDataCreationLoop({
      doc: groundingDoc,
      baseInstruction,
      challenger: challengerClient(),
      weakSolver: solverClient('weak'),
      strongSolver: solverClient('strong'),
      judge: buildRubricJudge(),
      target: 2,
      samples: 2,
      maxRetries: 2,
      accept: () => ({ accept: false, reason: 'forced reject (null-case regression)' }),
    })

    expect(result.accepted).toHaveLength(0)
    expect(result.agenticGaps).toHaveLength(0)
    expect(await result.corpus.query({ area: 'training-data' })).toHaveLength(0)
    // Plain-gap calibration is still recorded even when nothing is accepted.
    expect(result.plainGaps.length).toBeGreaterThan(0)
  })
})
