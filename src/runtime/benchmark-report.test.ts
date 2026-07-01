import type { RunRecord } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import {
  leaderboard,
  pairwiseSignificance,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
  renderPairwiseMarkdown,
} from './benchmark-report'

// A minimal RunRecord with the fields the reporter reads; the rest is filled to satisfy the type.
function rec(partial: {
  model: string
  harness?: string
  scenarioId: string
  score: number
  costUsd?: number
  wallMs?: number
  tokensIn?: number
  tokensOut?: number
  raw?: Record<string, number>
}): RunRecord {
  return {
    runId: `${partial.model}-${partial.scenarioId}`,
    experimentId: 'exp',
    candidateId: partial.model,
    seed: 1,
    model: partial.model,
    promptHash: 'p',
    configHash: 'c',
    commitSha: 'sha',
    wallMs: partial.wallMs ?? 1000,
    costUsd: partial.costUsd ?? 0.01,
    tokenUsage: { input: partial.tokensIn ?? 100, output: partial.tokensOut ?? 50 },
    outcome: { holdoutScore: partial.score, raw: partial.raw ?? {} },
    splitTag: 'holdout',
    scenarioId: partial.scenarioId,
    ...(partial.harness
      ? { agentProfile: { harness: partial.harness, model: partial.model } }
      : {}),
  } as unknown as RunRecord
}

describe('leaderboard', () => {
  const records: RunRecord[] = [
    // strong model: 1.0 on t1, 1.0 on t2
    rec({ model: 'strong', harness: 'claude-code', scenarioId: 't1', score: 1, costUsd: 0.1 }),
    rec({ model: 'strong', harness: 'claude-code', scenarioId: 't2', score: 1, costUsd: 0.1 }),
    // weak model: 0.5 on t1, 0.0 on t2
    rec({ model: 'weak', harness: 'opencode', scenarioId: 't1', score: 0.5, costUsd: 0.02 }),
    rec({ model: 'weak', harness: 'opencode', scenarioId: 't2', score: 0, costUsd: 0.02 }),
  ]

  it('ranks profiles by mean score desc', () => {
    const report = leaderboard(records, { title: 'T' })
    expect(report.profiles.map((p) => p.label)).toEqual(['claude-code·strong', 'opencode·weak'])
    expect(report.profiles[0]?.meanScore).toBeCloseTo(1)
    expect(report.profiles[1]?.meanScore).toBeCloseTo(0.25)
  })

  it('builds the profile × axis (scenario) matrix with per-cell means', () => {
    const report = leaderboard(records)
    expect(report.axes).toEqual(['t1', 't2'])
    const weak = report.profiles.find((p) => p.label === 'opencode·weak')!
    expect(weak.perAxis.t1).toBeCloseTo(0.5)
    expect(weak.perAxis.t2).toBeCloseTo(0)
  })

  it('reports the binary solve rate (score ≥ 0.999)', () => {
    const report = leaderboard(records)
    expect(report.profiles.find((p) => p.label === 'claude-code·strong')!.solveRate).toBeCloseTo(1)
    expect(report.profiles.find((p) => p.label === 'opencode·weak')!.solveRate).toBeCloseTo(0)
  })

  it('aggregates cost, tokens and latency per profile', () => {
    const report = leaderboard(records)
    const strong = report.profiles.find((p) => p.label === 'claude-code·strong')!
    expect(strong.costUsd).toBeCloseTo(0.2)
    expect(strong.tokensIn).toBe(200)
    expect(strong.n).toBe(2)
  })

  it('supports custom axis decomposition (judge dimensions) replacing scenario axes', () => {
    const dimRecords = [
      rec({ model: 'm', scenarioId: 't1', score: 1, raw: { correctness: 0.9, style: 0.4 } }),
      rec({ model: 'm', scenarioId: 't2', score: 1, raw: { correctness: 0.7, style: 0.8 } }),
    ]
    const report = leaderboard(dimRecords, {
      axisScoresOf: (r) => r.outcome.raw,
    })
    expect(report.axes).toEqual(['correctness', 'style'])
    const m = report.profiles[0]!
    expect(m.perAxis.correctness).toBeCloseTo(0.8)
    expect(m.perAxis.style).toBeCloseTo(0.6)
  })

  it('renders markdown with leaderboard and matrix', () => {
    const md = renderLeaderboardMarkdown(leaderboard(records, { title: 'My Bench' }))
    expect(md).toContain('# My Bench')
    expect(md).toContain('## Leaderboard')
    expect(md).toContain('## Score matrix')
    expect(md).toContain('claude-code·strong')
  })

  it('renders a non-trivial SVG and a self-contained HTML page', () => {
    const report = leaderboard(records, { title: 'Viz' })
    const svg = renderLeaderboardSvg(report)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('</svg>')
    const html = renderLeaderboardHtml(report)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<svg')
    expect(html).toContain('claude-code·strong')
  })

  it('computes per-row CIs when opts.stats (Wilson + bootstrap), collapsing reps per scenario', () => {
    // 3 scenarios × 2 reps each; reps collapse so the honest n is 3, not 6.
    const recs: RunRecord[] = []
    for (const s of ['t1', 't2', 't3']) {
      for (let rep = 0; rep < 2; rep++)
        recs.push(rec({ model: 'm', scenarioId: s, score: s === 't3' ? 0 : 1 }))
    }
    const report = leaderboard(recs, { stats: true, passThreshold: 0.999 })
    const row = report.profiles[0]!
    expect(row.scoreCi).toBeDefined()
    expect(row.passCi).toBeDefined()
    expect(row.scoreCi!.lower).toBeLessThanOrEqual(row.meanScore)
    expect(row.scoreCi!.upper).toBeGreaterThanOrEqual(row.meanScore)
    // 2 of 3 scenarios fully solved.
    expect(row.solveRate).toBeCloseTo(2 / 3)
    expect(renderLeaderboardMarkdown(report)).toContain('95% CI')
  })

  it('stats mode fails loud on a record missing scenarioId', () => {
    const bad = [
      { ...rec({ model: 'm', scenarioId: 'x', score: 1 }), scenarioId: undefined },
    ] as RunRecord[]
    expect(() => leaderboard(bad, { stats: true })).toThrow(/missing scenarioId/)
  })

  it('pairwiseSignificance compares profiles on shared scenarios (BH-corrected, power floor)', () => {
    // Strong beats weak on every one of 20 shared scenarios → a clear, significant win.
    const recs: RunRecord[] = []
    for (let i = 0; i < 20; i++) {
      recs.push(rec({ model: 'strong', harness: 'a', scenarioId: `s${i}`, score: 1 }))
      recs.push(rec({ model: 'weak', harness: 'b', scenarioId: `s${i}`, score: 0 }))
    }
    const verdicts = pairwiseSignificance(recs, { minPairs: 12 })
    expect(verdicts).toHaveLength(1)
    const v = verdicts[0]!
    expect(v.pairs).toBe(20)
    expect(v.significant).toBe(true)
    expect(renderPairwiseMarkdown(verdicts)).toContain('wins')
  })

  it('pairwiseSignificance suppresses the verdict below the paired-count floor', () => {
    const recs: RunRecord[] = []
    for (let i = 0; i < 4; i++) {
      recs.push(rec({ model: 'strong', harness: 'a', scenarioId: `s${i}`, score: 1 }))
      recs.push(rec({ model: 'weak', harness: 'b', scenarioId: `s${i}`, score: 0 }))
    }
    // Only 4 shared scenarios < the default floor of 12 → not significant regardless of p.
    expect(pairwiseSignificance(recs)[0]!.significant).toBe(false)
  })

  it('leaves a never-run axis blank, never zero', () => {
    const sparse = [
      rec({ model: 'a', scenarioId: 't1', score: 1 }),
      rec({ model: 'b', scenarioId: 't2', score: 1 }),
    ]
    const report = leaderboard(sparse)
    const a = report.profiles.find((p) => p.label === 'a')!
    expect('t2' in a.perAxis).toBe(false) // not 0 — absent
    expect(renderLeaderboardMarkdown(report)).toContain('·')
  })
})
