import type { DetectorSignal } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { createDetectorMonitor } from '../../src/runtime'

describe('detector monitor (online analyst on the worker pipe)', () => {
  it('raises a stuck-loop signal when a worker repeats the same tool call', () => {
    const signals: DetectorSignal[] = []
    const monitor = createDetectorMonitor({ onSignal: (s) => signals.push(s) })
    // The worker runs the SAME tool with the SAME args three times — a stuck loop.
    monitor.observeToolStep({ toolName: 'run_tests', args: { path: 'src/' } })
    monitor.observeToolStep({ toolName: 'run_tests', args: { path: 'src/' } })
    monitor.observeToolStep({ toolName: 'run_tests', args: { path: 'src/' } }) // 3rd → trip
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      detector: 'repeated-action',
      streak: 3,
      failureClass: 'tool_recovery_failure',
      evidence: { action: 'run_tests' },
    })
  })

  it('does NOT signal when args differ (real progress through distinct calls)', () => {
    const signals: DetectorSignal[] = []
    const monitor = createDetectorMonitor({ onSignal: (s) => signals.push(s) })
    monitor.observeToolStep({ toolName: 'edit', args: { file: 'a.ts' } })
    monitor.observeToolStep({ toolName: 'edit', args: { file: 'b.ts' } })
    monitor.observeToolStep({ toolName: 'edit', args: { file: 'c.ts' } })
    expect(signals).toHaveLength(0)
  })

  it('raises an error-streak signal when consecutive tool calls error', () => {
    const signals: DetectorSignal[] = []
    const monitor = createDetectorMonitor({ onSignal: (s) => signals.push(s) })
    monitor.observeToolStep({ toolName: 'build', args: { n: 1 }, status: 'error' })
    monitor.observeToolStep({ toolName: 'build', args: { n: 2 }, status: 'error' })
    const fired = monitor.observeToolStep({ toolName: 'build', args: { n: 3 }, status: 'error' })
    expect(fired.some((s) => s.detector === 'error-streak' && s.streak === 3)).toBe(true)
  })

  it('reset clears the streak so a fresh run starts clean', () => {
    const monitor = createDetectorMonitor()
    monitor.observeToolStep({ toolName: 't', args: {} })
    monitor.observeToolStep({ toolName: 't', args: {} })
    monitor.reset()
    expect(monitor.observeToolStep({ toolName: 't', args: {} })).toHaveLength(0) // streak back to 1
  })
})
