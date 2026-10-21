import { notifyRuntimeHookEvent } from '../runtime-hooks'
import type { RunAgentRoundsOptions } from './agent-rounds'
import type { LoopTraceEmitter, LoopTraceEvent } from './types'

export function emitRunLoopHook<Task, Output, Decision>(
  options: RunAgentRoundsOptions<Task, Output, Decision>,
  event: {
    target: 'agent.run' | 'agent.plan' | 'agent.decision'
    phase: 'before' | 'after' | 'error' | 'event'
    runId: string
    timestamp: number
    stepIndex?: number
    payload?: Record<string, unknown>
  },
): void {
  notifyRuntimeHookEvent(
    options.ctx.hooks,
    {
      id: `${event.runId}:${event.target}:${event.phase}${
        event.stepIndex === undefined ? '' : `:${event.stepIndex}`
      }`,
      runId: event.runId,
      target: event.target,
      phase: event.phase,
      timestamp: event.timestamp,
      stepIndex: event.stepIndex,
      payload: event.payload,
      metadata: { producer: 'run-loop' },
    },
    { signal: options.ctx.signal },
  )
}

export async function emitTrace(
  emitter: LoopTraceEmitter | undefined,
  event: LoopTraceEvent,
): Promise<void> {
  if (!emitter) return
  await emitter.emit(event)
}
