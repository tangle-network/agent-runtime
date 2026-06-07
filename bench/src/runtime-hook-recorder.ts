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

export interface BenchRuntimeDecisionEvidenceRef {
  source: string
  id: string
  detail?: string
  metadata?: Record<string, unknown>
}

export interface BenchRuntimeDecisionPoint {
  id: string
  runId: string
  scenarioId?: string
  stepIndex: number
  kind: string
  candidateActions: string[]
  context?: string
  evidence: BenchRuntimeDecisionEvidenceRef[]
  metadata?: Record<string, unknown>
}

export interface BenchRuntimeHooks {
  onEvent?: (
    event: BenchRuntimeHookEvent,
    context: { signal?: AbortSignal },
  ) => void | Promise<void>
  onDecisionPoint?: (
    point: BenchRuntimeDecisionPoint,
    context: { signal?: AbortSignal },
  ) => void | Promise<void>
}

export interface RuntimeHookRecorder {
  readonly events: BenchRuntimeHookEvent[]
  readonly decisionPoints: BenchRuntimeDecisionPoint[]
  readonly hooks: BenchRuntimeHooks
}

export function createRuntimeHookRecorder(): RuntimeHookRecorder {
  const events: BenchRuntimeHookEvent[] = []
  const decisionPoints: BenchRuntimeDecisionPoint[] = []
  return {
    events,
    decisionPoints,
    hooks: {
      onEvent: (event) => {
        events.push(event)
      },
      onDecisionPoint: (point) => {
        decisionPoints.push(point)
      },
    },
  }
}
