export type BenchRuntimeHookPhase = 'before' | 'after' | 'error' | 'event'

export interface BenchRuntimeHookEvent<Payload = unknown> {
  id: string
  runId: string
  scenarioId?: string
  target: string
  phase: BenchRuntimeHookPhase
  timestamp: number
  stepIndex?: number
  parentId?: string
  payload?: Payload
  metadata?: Record<string, unknown>
}

export interface BenchRuntimeHooks {
  onEvent?: (
    event: BenchRuntimeHookEvent,
    context: { signal?: AbortSignal },
  ) => void | Promise<void>
}

export interface RuntimeHookRecorder {
  readonly events: BenchRuntimeHookEvent[]
  readonly hooks: BenchRuntimeHooks
}

export function createRuntimeHookRecorder(): RuntimeHookRecorder {
  const events: BenchRuntimeHookEvent[] = []
  return {
    events,
    hooks: {
      onEvent: (event) => {
        events.push(event)
      },
    },
  }
}
