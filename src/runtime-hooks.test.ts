import { describe, expect, it } from 'vitest'
import {
  composeRuntimeHooks,
  notifyRuntimeDecisionPoint,
  notifyRuntimeHookEvent,
  type RuntimeHookEvent,
} from './runtime-hooks'

describe('runtime hooks', () => {
  it('composes event and decision handlers in order', () => {
    const seen: string[] = []
    const hooks = composeRuntimeHooks(
      {
        onEvent: (event) => {
          seen.push(`a:event:${event.target}`)
        },
        onDecisionPoint: (point) => {
          seen.push(`a:decision:${point.kind}`)
        },
      },
      {
        onEvent: (event) => {
          seen.push(`b:event:${event.target}`)
        },
        onDecisionPoint: (point) => {
          seen.push(`b:decision:${point.kind}`)
        },
      },
    )

    notifyRuntimeHookEvent(hooks, hookEvent())
    notifyRuntimeDecisionPoint(hooks, {
      id: 'decision-1',
      runId: 'run-1',
      stepIndex: 0,
      kind: 'retry',
      candidateActions: ['retry', 'stop'],
      evidence: [],
    })

    expect(seen).toEqual([
      'a:event:agent.run',
      'b:event:agent.run',
      'a:decision:retry',
      'b:decision:retry',
    ])
  })

  it('routes hook failures to onHookError without throwing', () => {
    const errors: string[] = []
    const hooks = {
      onEvent: () => {
        throw new Error('event failed')
      },
      onHookError: (error: Error) => {
        errors.push(error.message)
      },
    }

    notifyRuntimeHookEvent(hooks, hookEvent())

    expect(errors).toEqual(['event failed'])
  })
})

function hookEvent(): RuntimeHookEvent {
  return {
    id: 'event-1',
    runId: 'run-1',
    target: 'agent.run',
    phase: 'before',
    timestamp: 1,
  }
}
