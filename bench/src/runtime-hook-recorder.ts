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

const MAX_STRING_LENGTH = 12_000
const MAX_CONTEXT_LENGTH = 20_000
const MAX_EVIDENCE_DETAIL_LENGTH = 2_000
const MAX_CANDIDATE_ACTIONS = 50
const MAX_EVIDENCE_REFS = 50
const MAX_METADATA_DEPTH = 4
const MAX_METADATA_KEYS = 100
const SENSITIVE_KEY_RE = /(?:authorization|api[_-]?key|token|secret|password|cookie|credential|bearer)/i
const SENSITIVE_VALUE_RES = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|gh[pousr])_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:sk|ghp|gho|ghu|ghs|ghr)-[A-Za-z0-9_-]{20,}\b/g,
  /\b(api[_-]?key|token|secret|password|cookie)\s*[:=]\s*["']?[^"'\s,;}]+/gi,
]

function sanitizeString(value: string, maxLength: number): string {
  let sanitized = value
  for (const pattern of SENSITIVE_VALUE_RES) {
    sanitized = sanitized.replace(pattern, (match, key: string | undefined) => {
      if (typeof key === 'string') return `${key}=[REDACTED]`
      return '[REDACTED]'
    })
  }
  if (sanitized.length <= maxLength) return sanitized
  return sanitized.slice(0, maxLength)
}

function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return sanitizeString(value, MAX_STRING_LENGTH)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= MAX_METADATA_DEPTH) return '[MaxDepth]'
    return value.slice(0, MAX_METADATA_KEYS).map((item) => sanitizeMetadata(item, depth + 1))
  }
  if (typeof value !== 'object') return undefined
  if (depth >= MAX_METADATA_DEPTH) return '[MaxDepth]'

  const sanitized: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    sanitized[key] = SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeMetadata(nested, depth + 1)
  }
  return sanitized
}

function sanitizeMetadataRecord(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const sanitized = sanitizeMetadata(metadata)
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) return undefined
  return sanitized as Record<string, unknown>
}

function snapshotDecisionPoint(point: BenchRuntimeDecisionPoint): BenchRuntimeDecisionPoint {
  return {
    id: point.id,
    runId: point.runId,
    scenarioId: point.scenarioId,
    stepIndex: point.stepIndex,
    kind: point.kind,
    candidateActions: point.candidateActions.slice(0, MAX_CANDIDATE_ACTIONS).map((action) => sanitizeString(action, MAX_STRING_LENGTH)),
    context: typeof point.context === 'string' ? sanitizeString(point.context, MAX_CONTEXT_LENGTH) : undefined,
    evidence: point.evidence.slice(0, MAX_EVIDENCE_REFS).map((ref) => ({
      source: sanitizeString(ref.source, MAX_STRING_LENGTH),
      id: sanitizeString(ref.id, MAX_STRING_LENGTH),
      detail: typeof ref.detail === 'string' ? sanitizeString(ref.detail, MAX_EVIDENCE_DETAIL_LENGTH) : undefined,
      metadata: sanitizeMetadataRecord(ref.metadata),
    })),
    metadata: sanitizeMetadataRecord(point.metadata),
  }
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
        decisionPoints.push(snapshotDecisionPoint(point))
      },
    },
  }
}
