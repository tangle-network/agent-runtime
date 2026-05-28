import { describe, expect, it } from 'vitest'
import { allShapes } from '../examples/agents-of-all-shapes/shapes'
import { spansForRuns, toInsightReport } from '../examples/agents-of-all-shapes/shared/intelligence'

/**
 * Verifies the showcase end-to-end with NO sandbox, NO hosted endpoint, NO
 * LLM key: every agent shape → canonical OTel spans → fromOtelSpans →
 * analyzeRuns → a real InsightReport. This is the QA path a customer runs to
 * prove "any agent, not just your sandbox" before wiring their own traces.
 */
describe('agents-of-all-shapes — one intelligence pipe, no sandbox', () => {
  it('every shape produces a real InsightReport in-process', async () => {
    const shapes = allShapes()
    expect(Object.keys(shapes).sort()).toEqual([
      'claude-agent-sdk',
      'mastra',
      'openai-compatible',
      'tangle-runtime',
    ])

    for (const [name, runs] of Object.entries(shapes)) {
      expect(runs.length).toBeGreaterThan(0)
      const report = await toInsightReport(spansForRuns(runs))
      // Real decision packet per framework — composite over its runs.
      expect(report.composite.n).toBe(runs.length)
      expect(report.composite.mean).toBeGreaterThan(0)
      expect(report.composite.mean).toBeLessThanOrEqual(1)
      expect(report.composite.min).toBeGreaterThanOrEqual(0)
      expect(report.composite.max).toBeLessThanOrEqual(1)
      expect(Array.isArray(report.recommendations)).toBe(true)
      // Cost/quality Pareto is computed from the gen_ai.usage.cost_usd attrs.
      expect(report.costQuality).toBeDefined()
    }
  })

  it('merges all shapes into one fleet report (cross-framework aggregation)', async () => {
    const shapes = allShapes()
    const total = Object.values(shapes).reduce((sum, r) => sum + r.length, 0)
    const fleet = await toInsightReport(spansForRuns(Object.values(shapes).flat()))
    expect(fleet.composite.n).toBe(total)
    // The merged corpus carries failures from multiple frameworks; the
    // model-free failureModes breakdown surfaces the dominant one.
    expect(fleet.failureModes).toBeDefined()
    expect(fleet.failureModes!.length).toBeGreaterThan(0)
    expect(fleet.failureModes![0]!.count).toBeGreaterThan(0)
  })

  it('derives a real cost from gen_ai.usage.cost_usd across shapes', async () => {
    const fleet = await toInsightReport(spansForRuns(Object.values(allShapes()).flat()))
    // The Pareto/cost view is populated from the OTel cost attribute, not zeros.
    expect(fleet.costQuality.cost.n).toBeGreaterThan(0)
    expect(fleet.costQuality.cost.mean).toBeGreaterThan(0)
  })
})
