import { describe, expect, it } from 'vitest'
import { analyzeTrace, createPushTraceSource } from '../../src/runtime'

const fakeClock = () => {
  let t = 0
  return () => (t += 10)
}

describe('analyzeTrace (settle-time agent-eval analyzers over a TraceSource)', () => {
  it('collects spans and the batch stuck-loop view detects a repeated call', async () => {
    const { source, record } = createPushTraceSource({ runId: 'r1', now: fakeClock() })
    // A loop interleaved with another call — the FULL-run view still catches it.
    record({ toolName: 'run_tests', args: { path: 'src/' } })
    record({ toolName: 'read', args: { f: 'log.txt' } })
    record({ toolName: 'run_tests', args: { path: 'src/' } })
    record({ toolName: 'run_tests', args: { path: 'src/' } })

    const analysis = await analyzeTrace(source)

    expect(analysis.trajectory.toolCalls).toBe(4)
    const loop = analysis.stuckLoop.findings.find((f) => f.toolName === 'run_tests')
    expect(loop?.occurrences).toBe(3)
    expect(loop?.windowMs).toBeGreaterThan(0)
  })

  it('does not flag distinct calls as a loop', async () => {
    const { source, record } = createPushTraceSource({ now: fakeClock() })
    record({ toolName: 'edit', args: { f: 'a.ts' } })
    record({ toolName: 'edit', args: { f: 'b.ts' } })
    record({ toolName: 'edit', args: { f: 'c.ts' } })
    const analysis = await analyzeTrace(source)
    expect(analysis.trajectory.toolCalls).toBe(3)
    expect(analysis.stuckLoop.findings).toHaveLength(0)
  })
})
