import { createHash } from 'node:crypto'
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

const fixtureHash = 'a'.repeat(64)
let fixtureOrdinal = 0

function rec(partial: {
  model: string
  harness?: string
  candidateId?: string
  scenarioId: string
  score: number
  splitTag?: RunRecord['splitTag']
  costUsd?: number | null
  costKind?: 'observed' | 'estimated'
  wallMs?: number
  tokensIn?: number
  tokensOut?: number
  raw?: Record<string, number>
}): RunRecord {
  fixtureOrdinal += 1
  const costUsd = partial.costUsd === undefined ? 0.01 : partial.costUsd
  const model = `${partial.model}@test`
  const candidateId = partial.candidateId ?? partial.model
  const splitTag = partial.splitTag ?? 'holdout'
  const profileHash = createHash('sha256')
    .update(`${partial.harness ?? ''}\0${model}\0${candidateId}`)
    .digest('hex')
  const costProvenance: RunRecord['costProvenance'] =
    costUsd === null
      ? { kind: 'uncaptured', usd: null }
      : { kind: partial.costKind ?? 'observed', usd: costUsd }
  return {
    runId: `${partial.model}-${partial.scenarioId}-${fixtureOrdinal}`,
    experimentId: 'exp',
    candidateId,
    seed: fixtureOrdinal,
    model,
    promptHash: fixtureHash,
    configHash: fixtureHash,
    commitSha: 'sha',
    wallMs: partial.wallMs ?? 1000,
    costUsd,
    costProvenance,
    tokenUsage: { input: partial.tokensIn ?? 100, output: partial.tokensOut ?? 50 },
    terminalOutcome: 'succeeded',
    outcome: {
      ...(splitTag === 'holdout'
        ? { holdoutScore: partial.score }
        : { searchScore: partial.score }),
      raw: partial.raw ?? {},
    },
    splitTag,
    scenarioId: partial.scenarioId,
    ...(partial.harness
      ? {
          agentProfile: {
            schemaVersion: 'agent-profile-cell/v1',
            cellId: `agent-profile-cell:sha256:${profileHash}`,
            profileId: partial.model,
            sourceProfile: { kind: 'test-profile', hash: fixtureHash },
            harness: { id: partial.harness },
            model,
          },
        }
      : {}),
  }
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
    expect(report.profiles.map((p) => p.label)).toEqual([
      'claude-code·strong@test',
      'opencode·weak@test',
    ])
    expect(report.profiles[0]?.meanScore).toBeCloseTo(1)
    expect(report.profiles[1]?.meanScore).toBeCloseTo(0.25)
  })

  it('builds the profile × axis (scenario) matrix with per-cell means', () => {
    const report = leaderboard(records)
    expect(report.axes).toEqual(['t1', 't2'])
    const weak = report.profiles.find((p) => p.label === 'opencode·weak@test')!
    expect(weak.perAxis.t1).toBeCloseTo(0.5)
    expect(weak.perAxis.t2).toBeCloseTo(0)
  })

  it('reports the binary solve rate (score ≥ 0.999)', () => {
    const report = leaderboard(records)
    expect(
      report.profiles.find((p) => p.label === 'claude-code·strong@test')!.solveRate,
    ).toBeCloseTo(1)
    expect(report.profiles.find((p) => p.label === 'opencode·weak@test')!.solveRate).toBeCloseTo(0)
  })

  it('aggregates cost, tokens and latency per profile', () => {
    const report = leaderboard(records)
    const strong = report.profiles.find((p) => p.label === 'claude-code·strong@test')!
    expect(strong.observedCostUsd).toBeCloseTo(0.2)
    expect(strong.estimatedCostUsd).toBe(0)
    expect(strong.uncapturedCostRunCount).toBe(0)
    expect(strong.tokensIn).toBe(200)
    expect(strong.runCount).toBe(2)
    expect(strong.scenarioCount).toBe(2)
  })

  it('reports observed, estimated, and uncaptured costs separately', () => {
    const report = leaderboard([
      rec({ model: 'mixed-cost', scenarioId: 't1', score: 1, costUsd: 0.02 }),
      rec({
        model: 'mixed-cost',
        scenarioId: 't2',
        score: 1,
        costUsd: 0.03,
        costKind: 'estimated',
      }),
      rec({ model: 'mixed-cost', scenarioId: 't3', score: 1, costUsd: null }),
    ])
    const row = report.profiles[0]!
    expect(row.observedCostUsd).toBeCloseTo(0.02)
    expect(row.estimatedCostUsd).toBeCloseTo(0.03)
    expect(row.uncapturedCostRunCount).toBe(1)
    expect(report.provenance.observedCostUsd).toBeCloseTo(0.02)
    expect(report.provenance.estimatedCostUsd).toBeCloseTo(0.03)
    expect(report.provenance.uncapturedCostRunCount).toBe(1)
    expect(renderLeaderboardMarkdown(report)).toContain('$0.020 | $0.030 | 1 |')
  })

  it('uses canonical profile and candidate identities instead of merging equal models', () => {
    const report = leaderboard([
      rec({ model: 'same', candidateId: 'candidate-a', scenarioId: 't1', score: 1 }),
      rec({ model: 'same', candidateId: 'candidate-b', scenarioId: 't1', score: 0 }),
    ])

    expect(report.profiles).toHaveLength(2)
    expect(report.profiles.map((row) => row.profileKey).sort()).toEqual([
      'candidate-a',
      'candidate-b',
    ])
    expect(report.profiles.map((row) => row.meanScore).sort()).toEqual([0, 1])

    const profiled = rec({
      model: 'profiled',
      harness: 'runtime',
      candidateId: 'display-name',
      scenarioId: 't1',
      score: 1,
    })
    expect(leaderboard([profiled]).profiles[0]?.profileKey).toBe(profiled.agentProfile?.cellId)
  })

  it('keeps split as a first-class row and comparison dimension', () => {
    const mixed = [
      rec({
        model: 'a',
        candidateId: 'a',
        scenarioId: 't1',
        score: 1,
        splitTag: 'search',
      }),
      rec({
        model: 'a',
        candidateId: 'a',
        scenarioId: 't1',
        score: 0,
        splitTag: 'holdout',
      }),
      rec({
        model: 'b',
        candidateId: 'b',
        scenarioId: 't1',
        score: 0,
        splitTag: 'search',
      }),
      rec({
        model: 'b',
        candidateId: 'b',
        scenarioId: 't1',
        score: 1,
        splitTag: 'holdout',
      }),
    ]

    const report = leaderboard(mixed)
    expect(report.profiles).toHaveLength(4)
    expect(report.provenance.splits).toEqual(['holdout', 'search'])
    expect(report.profiles.filter((row) => row.profileKey === 'a')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ splitTag: 'search', meanScore: 1 }),
        expect.objectContaining({ splitTag: 'holdout', meanScore: 0 }),
      ]),
    )

    const comparisons = pairwiseSignificance(mixed, { minPairs: 1 })
    expect(comparisons).toHaveLength(2)
    expect(comparisons.map((comparison) => comparison.splitTag).sort()).toEqual([
      'holdout',
      'search',
    ])
  })

  it('weights headline scores, solve rate, and grouped axes by scenario', () => {
    const uneven = [
      rec({ model: 'm', scenarioId: 'many-reps', score: 1 }),
      rec({ model: 'm', scenarioId: 'many-reps', score: 1 }),
      rec({ model: 'm', scenarioId: 'many-reps', score: 1 }),
      rec({ model: 'm', scenarioId: 'one-rep', score: 0 }),
    ]
    const report = leaderboard(uneven, {
      groupOf: () => 'all-scenarios',
      passThreshold: 0.5,
      stats: true,
    })
    const row = report.profiles[0]!
    expect(report.provenance.runCount).toBe(4)
    expect(report.provenance.scenarioCount).toBe(2)
    expect(row.runCount).toBe(4)
    expect(row.scenarioCount).toBe(2)
    expect(row.meanScore).toBeCloseTo(0.5)
    expect(row.solveRate).toBeCloseTo(0.5)
    expect(row.perAxis['all-scenarios']).toBeCloseTo(0.5)
    expect(row.scoreCi?.lower).toBeLessThanOrEqual(0.5)
    expect(row.scoreCi?.upper).toBeGreaterThanOrEqual(0.5)
  })

  it('supports custom axis decomposition (judge dimensions) replacing scenario axes', () => {
    const dimRecords = [
      rec({ model: 'm', scenarioId: 't1', score: 1, raw: { correctness: 1, style: 0.4 } }),
      rec({ model: 'm', scenarioId: 't1', score: 1, raw: { correctness: 1, style: 0.4 } }),
      rec({ model: 'm', scenarioId: 't2', score: 1, raw: { correctness: 0, style: 0.8 } }),
    ]
    const report = leaderboard(dimRecords, {
      axisScoresOf: (r) => r.outcome.raw,
    })
    expect(report.axes).toEqual(['correctness', 'style'])
    const m = report.profiles[0]!
    expect(m.perAxis.correctness).toBeCloseTo(0.5)
    expect(m.perAxis.style).toBeCloseTo(0.6)
  })

  it('renders markdown with leaderboard and matrix', () => {
    const md = renderLeaderboardMarkdown(leaderboard(records, { title: 'My Bench' }))
    expect(md).toContain('# My Bench')
    expect(md).toContain('## Leaderboard')
    expect(md).toContain('## Score matrix')
    expect(md).toContain('claude-code·strong@test')
  })

  it('renders a non-trivial SVG and a self-contained HTML page', () => {
    const report = leaderboard(records, { title: 'Viz' })
    const svg = renderLeaderboardSvg(report)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('</svg>')
    const html = renderLeaderboardHtml(report)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<svg')
    expect(html).toContain('claude-code·strong@test')
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
    ] as unknown as RunRecord[]
    expect(() => leaderboard(bad, { stats: true })).toThrow(/scenarioId/)
  })

  it('rejects a record without an explicit split score even when raw metrics look scored', () => {
    const unscored: RunRecord = {
      ...rec({ model: 'm', scenarioId: 'x', score: 1 }),
      outcome: { raw: { score: 1, passed: 1 } },
    }
    expect(() => leaderboard([unscored])).toThrow(/no benchmark score/)
  })

  it('rejects duplicate run identities instead of double-counting them', () => {
    const original = rec({ model: 'm', scenarioId: 'x', score: 1 })
    const duplicate: RunRecord = { ...original }
    expect(() => leaderboard([original, duplicate])).toThrow(/duplicate runId/)
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
    const a = report.profiles.find((p) => p.label === 'a@test')!
    expect('t2' in a.perAxis).toBe(false) // not 0 — absent
    expect(renderLeaderboardMarkdown(report)).toContain('·')
  })
})
