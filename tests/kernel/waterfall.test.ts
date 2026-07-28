/**
 * Waterfall collector: spans from the lifecycle stream sum to the run's full cost
 * story — every spawn timed, every settle billed, rollups by kind.
 */
import { describe, expect, it } from 'vitest'
import { createWaterfallCollector } from '../../src/runtime/waterfall'

const spawn = (id: string, label: string, t: number) => ({
  id: `${id}:spawn`,
  runId: 'run-1',
  target: 'agent.spawn' as const,
  phase: 'after' as const,
  timestamp: t,
  payload: { childId: id, label },
})
const settle = (
  id: string,
  t: number,
  usd: number,
  input: number,
  output: number,
  score?: number,
  down = false,
) => ({
  id: `${id}:settled`,
  runId: 'run-1',
  target: 'agent.child' as const,
  phase: 'after' as const,
  timestamp: t,
  payload: {
    childId: id,
    status: down ? 'down' : 'done',
    ...(score !== undefined ? { score } : {}),
    spent: { usd, tokens: { input, output } },
  },
})

describe('createWaterfallCollector', () => {
  it('sums every span into the full cost story with by-kind rollups', () => {
    const w = createWaterfallCollector()
    w.hooks.onEvent?.(spawn('s0', 'shot:0', 1000) as never, {})
    w.hooks.onEvent?.(settle('s0', 3000, 0.01, 100, 50, 0.5) as never, {})
    w.hooks.onEvent?.(spawn('a0', 'analyst:0', 3000) as never, {})
    w.hooks.onEvent?.(settle('a0', 4000, 0.002, 40, 20) as never, {})
    w.hooks.onEvent?.(spawn('s1', 'shot:1', 4000) as never, {})
    w.hooks.onEvent?.(settle('s1', 7000, 0.012, 120, 60, 1, false) as never, {})

    const r = w.report()
    expect(r.spans).toHaveLength(3)
    expect(r.totalMs).toBe(6000)
    expect(r.totalUsd).toBeCloseTo(0.024)
    expect(r.totalTokens).toEqual({ input: 260, output: 130 })
    expect(r.byKind.shot?.count).toBe(2)
    expect(r.byKind.shot?.usd).toBeCloseTo(0.022)
    expect(r.byKind.analyst?.count).toBe(1)
    expect(r.byKind.analyst?.usd).toBeCloseTo(0.002)

    const text = w.render({ width: 20 })
    expect(text).toContain('shot:0')
    expect(text).toContain('analyst:0')
    expect(text).toContain('TOTAL')
    expect(text).toContain('$0.0240')
  })

  it('a downed span renders distinctly and still bills its spend', () => {
    const w = createWaterfallCollector()
    w.hooks.onEvent?.(spawn('x', 'shot:0', 0) as never, {})
    w.hooks.onEvent?.(settle('x', 500, 0.001, 10, 0, undefined, true) as never, {})
    const r = w.report()
    expect(r.spans[0]?.status).toBe('down')
    expect(r.totalUsd).toBeCloseTo(0.001)
    expect(w.render()).toContain('DOWN')
  })

  it('reset clears accumulated spans', () => {
    const w = createWaterfallCollector()
    w.hooks.onEvent?.(spawn('s', 'shot:0', 0) as never, {})
    w.reset()
    expect(w.report().spans).toHaveLength(0)
  })
})
