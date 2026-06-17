import type { DetectorSignal } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { createPushTraceSource, watchTrace } from '../../src/runtime'

describe('watchTrace (online analyst over a TraceSource)', () => {
  it('raises a stuck-loop signal when a worker repeats the same tool call', () => {
    const signals: DetectorSignal[] = []
    const { source, record } = createPushTraceSource({ runId: 'r' })
    watchTrace(source, { onSignal: (s) => signals.push(s) })
    record({ toolName: 'run_tests', args: { path: 'src/' } })
    record({ toolName: 'run_tests', args: { path: 'src/' } })
    record({ toolName: 'run_tests', args: { path: 'src/' } }) // 3rd → trip
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      detector: 'repeated-action',
      streak: 3,
      failureClass: 'tool_recovery_failure',
    })
  })

  it('does NOT signal when args differ (real progress through distinct calls)', () => {
    const signals: DetectorSignal[] = []
    const { source, record } = createPushTraceSource()
    watchTrace(source, { onSignal: (s) => signals.push(s) })
    record({ toolName: 'edit', args: { file: 'a.ts' } })
    record({ toolName: 'edit', args: { file: 'b.ts' } })
    record({ toolName: 'edit', args: { file: 'c.ts' } })
    expect(signals).toHaveLength(0)
  })

  it('raises an error-streak signal when consecutive tool calls error', () => {
    const signals: DetectorSignal[] = []
    const { source, record } = createPushTraceSource()
    watchTrace(source, { onSignal: (s) => signals.push(s) })
    record({ toolName: 'build', args: { n: 1 }, status: 'error' })
    record({ toolName: 'build', args: { n: 2 }, status: 'error' })
    record({ toolName: 'build', args: { n: 3 }, status: 'error' })
    expect(signals.some((s) => s.detector === 'error-streak' && s.streak === 3)).toBe(true)
  })

  it('never throws on unhashable (circular) args — observability must not crash the worker', () => {
    const { source, record } = createPushTraceSource()
    watchTrace(source)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => record({ toolName: 'x', args: circular })).not.toThrow()
  })

  it('unsubscribe stops watching', () => {
    const signals: DetectorSignal[] = []
    const { source, record } = createPushTraceSource()
    const off = watchTrace(source, { onSignal: (s) => signals.push(s) })
    record({ toolName: 't', args: {} })
    off()
    record({ toolName: 't', args: {} })
    record({ toolName: 't', args: {} }) // would be the 3rd, but we unsubscribed
    expect(signals).toHaveLength(0)
  })
})
