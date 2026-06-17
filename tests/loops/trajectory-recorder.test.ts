import { describe, expect, it } from 'vitest'
import { createTrajectoryRecorder } from '../../src/runtime'

// A deterministic clock so windowMs assertions are stable.
const fakeClock = () => {
  let t = 0
  return () => (t += 10)
}

describe('trajectory recorder (settle-time agent-eval analyzers)', () => {
  it('replays tool steps as spans and the batch stuck-loop view detects a repeated call', async () => {
    const rec = createTrajectoryRecorder('run-1', fakeClock())
    // A loop interleaved with another call — the FULL-run view (total occurrences) still catches it,
    // where a purely-consecutive online detector might not.
    rec.observeToolStep({ toolName: 'run_tests', args: { path: 'src/' } })
    rec.observeToolStep({ toolName: 'read', args: { f: 'log.txt' } })
    rec.observeToolStep({ toolName: 'run_tests', args: { path: 'src/' } })
    rec.observeToolStep({ toolName: 'run_tests', args: { path: 'src/' } })

    const analysis = await rec.analyze()

    // buildTrajectory gave a structured summary over the real spans.
    expect(analysis.trajectory.toolCalls).toBe(4)
    // stuckLoopView (agent-eval) flagged the repeated run_tests call.
    const loop = analysis.stuckLoop.findings.find((f) => f.toolName === 'run_tests')
    expect(loop?.occurrences).toBe(3)
    expect(loop?.windowMs).toBeGreaterThan(0)
  })

  it('does not flag distinct calls as a loop', async () => {
    const rec = createTrajectoryRecorder('run-2', fakeClock())
    rec.observeToolStep({ toolName: 'edit', args: { f: 'a.ts' } })
    rec.observeToolStep({ toolName: 'edit', args: { f: 'b.ts' } })
    rec.observeToolStep({ toolName: 'edit', args: { f: 'c.ts' } })
    const analysis = await rec.analyze()
    expect(analysis.trajectory.toolCalls).toBe(3)
    expect(analysis.stuckLoop.findings).toHaveLength(0)
  })

  it('reset clears captured steps', async () => {
    const rec = createTrajectoryRecorder('run-3', fakeClock())
    rec.observeToolStep({ toolName: 't', args: {} })
    rec.reset()
    const analysis = await rec.analyze()
    expect(analysis.trajectory.toolCalls).toBe(0)
  })
})
