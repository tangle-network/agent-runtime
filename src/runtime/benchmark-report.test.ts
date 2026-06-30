import type { RunRecord } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import {
  leaderboard,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
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
