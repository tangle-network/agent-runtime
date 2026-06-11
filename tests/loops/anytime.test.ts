/**
 * Anytime metrics from waterfall spans: hill-climb curves, multi-target satisficing
 * hits (COCO convention), ERT charging failures' time to the successes.
 */
import { describe, expect, it } from 'vitest'
import { anytimeReport, renderAnytimeTable } from '../../src/runtime/anytime'
import type { WaterfallSpan } from '../../src/runtime/waterfall'

const shot = (
  runId: string,
  n: number,
  start: number,
  end: number,
  usd: number,
  score: number,
): WaterfallSpan => ({
  id: `${runId}:s${n}`,
  label: `shot:${n}`,
  runId,
  startMs: start,
  endMs: end,
  status: 'done',
  usd,
  tokens: { input: 0, output: 0 },
  score,
})

describe('anytimeReport', () => {
  // refine on task t1: climbs 0.5 → 1.0; on t2: stuck at 0.5 (never reaches 1).
  const spans: WaterfallSpan[] = [
    shot('agentic:refine:t1', 0, 0, 2000, 0.01, 0.5),
    shot('agentic:refine:t1', 1, 2000, 5000, 0.01, 1),
    shot('agentic:refine:t2', 0, 0, 3000, 0.01, 0.5),
    shot('agentic:refine:t2', 1, 3000, 6000, 0.01, 0.5),
    { ...shot('agentic:refine:t1', 9, 0, 100, 0.001, 0), label: 'analyst:0' }, // ignored
  ]

  it('multi-target hits, hill-climb curve, and COCO ERT', () => {
    const r = anytimeReport(spans, { targets: [0.5, 1] })
    const t1 = r.perTask.find((t) => t.taskId === 't1')
    expect(t1?.hits['0.5']).toEqual({ ms: 2000, shots: 1, usd: 0.01 })
    expect(t1?.hits['1']).toEqual({ ms: 5000, shots: 2, usd: 0.02 })

    const at1 = r.perStrategy.find((s) => s.target === 1)
    expect(at1?.reachedTarget).toBe(1)
    expect(at1?.medianTttMs).toBe(5000)
    // ERT charges BOTH tasks' wall time (5000 + 6000) to the single success.
    expect(at1?.ertMs).toBe(11000)
    const at05 = r.perStrategy.find((s) => s.target === 0.5)
    expect(at05?.reachedTarget).toBe(2)
    // The anytime curve: mean best-so-far per shot index across tasks.
    expect(at1?.curveByShot[0]).toBeCloseTo(0.5)
    expect(at1?.curveByShot[1]).toBeCloseTo(0.75)
  })

  it('per-task satisficing bars via targetFor', () => {
    const r = anytimeReport(spans, { targetFor: (id) => (id === 't2' ? 0.5 : 1) })
    const row = r.perStrategy[0]
    expect(row?.reachedTarget).toBe(2) // t1 hits 1.0, t2 hits its own 0.5 bar
  })

  it('renders one row per (strategy, target) with the sparkline curve', () => {
    const text = renderAnytimeTable(anytimeReport(spans, { targets: [0.5, 1] }))
    expect(text).toContain('refine')
    expect(text).toContain('0.50')
    expect(text).toContain('1.00')
    expect(text).toContain('ERT')
  })
})
