import { CanonicalStreamEventSchema, type StreamEvent } from '@tangle-network/agent-interface'
import { assertRuntimeTimestamp } from './timestamps'

/**
 * Transport type whose payload is the harness's OWN event, passed through verbatim.
 *
 * A `raw` payload names a harness-native type from a vocabulary the canonical schema does not
 * define (codex emits `thread.started` / `turn.started` / `turn.completed`). The transport type is
 * therefore the only canonical statement such an event makes, and its payload must never be read
 * as a canonical type: the mismatch guard below exists to catch a producer that MISLABELS a
 * canonical event, which a harness-native payload cannot do. A payload that does satisfy the
 * canonical `raw` shape (`backend` + `event`) still parses; anything else is not a canonical
 * event, and the caller reads it off the transport event instead.
 */
const harnessNativePayloadType = 'raw'

/** Parse canonical payload fields without treating transport identity as event data. */
export function parseCanonicalTransportEvent(
  type: unknown,
  data: Record<string, unknown>,
  normalized: unknown,
  source: string,
): StreamEvent | undefined {
  if (!isRecord(data)) {
    throw new Error(`${source} emitted a canonical event without an object payload`)
  }
  const outerType = String(type ?? '')
  const harnessNative = outerType === harnessNativePayloadType
  if (normalized !== undefined) {
    if (
      !harnessNative &&
      typeof normalized === 'object' &&
      normalized !== null &&
      'type' in normalized &&
      typeof normalized.type === 'string' &&
      normalized.type !== outerType
    ) {
      throw new Error(
        `${source} canonical event type "${normalized.type}" does not match transport type "${outerType}"`,
      )
    }
    const candidate = CanonicalStreamEventSchema.safeParse(normalized)
    if (!candidate.success) {
      if (harnessNative) return undefined
      throw new Error(`${source} emitted an invalid normalized canonical event`, {
        cause: candidate.error,
      })
    }
    return candidate.data
  }
  const {
    type: embeddedType,
    eventId: _eventId,
    cursor: _cursor,
    sequence: _sequence,
    occurredAt: _occurredAt,
    normalized: _normalized,
    ...payload
  } = data
  if (!harnessNative && embeddedType !== undefined && embeddedType !== outerType) {
    throw new Error(
      `${source} canonical event type "${String(embeddedType)}" does not match transport type "${outerType}"`,
    )
  }
  const candidate = CanonicalStreamEventSchema.safeParse({ ...payload, type: outerType })
  return candidate.success ? candidate.data : undefined
}

/** Identity fields carried by either the transport envelope or its data payload. */
export interface TransportEventIdentity {
  readonly eventId?: string
  readonly cursor?: string
  readonly sequence?: number
  readonly occurredAt?: string
}

/** Extract shared event identity without privileging one provider wire shape. */
export function extractTransportEventIdentity(event: unknown): TransportEventIdentity {
  const record = isRecord(event) ? event : {}
  const data = isRecord(record.data) ? record.data : {}
  const providerEvent = isRecord(record.providerEvent) ? record.providerEvent : {}
  const providerData = isRecord(providerEvent.data) ? providerEvent.data : {}
  const eventId = canonicalEventId(record, data, providerEvent, providerData)
  const cursor = stableString(
    record.cursor ?? data.cursor ?? providerEvent.cursor ?? providerData.cursor,
  )
  const sequence = optionalSequence(
    record.sequence ?? data.sequence ?? providerEvent.sequence ?? providerData.sequence,
  )
  const occurredAt = optionalTimestamp(
    record.occurredAt ?? data.occurredAt ?? providerEvent.occurredAt ?? providerData.occurredAt,
  )
  return {
    ...(eventId === undefined ? {} : { eventId }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(sequence === undefined ? {} : { sequence }),
    ...(occurredAt === undefined ? {} : { occurredAt }),
  }
}

function canonicalEventId(
  record: Record<string, unknown>,
  data: Record<string, unknown>,
  providerEvent: Record<string, unknown>,
  providerData: Record<string, unknown>,
): string | undefined {
  const candidates = [
    ['data.eventId', data.eventId],
    ['providerEvent.eventId', providerEvent.eventId],
    ['providerData.eventId', providerData.eventId],
    ['record.eventId', record.eventId],
  ] as const
  const present = candidates.filter(([, value]) => value !== undefined)
  // `record.id` may be the provider's replay cursor, so use it only without a canonical field.
  if (present.length === 0) return stableString(record.id ?? providerEvent.id)

  const normalized = present.map(([source, value]) => {
    const eventId = stableString(value)
    if (eventId === undefined) throw new Error(`transport event ${source} must be a stable string`)
    return { source, eventId }
  })
  const first = normalized[0]!
  if (normalized.some((candidate) => candidate.eventId !== first.eventId)) {
    throw new Error('transport event canonical identities disagree')
  }
  return first.eventId
}

function stableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.trim() === value ? value : undefined
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function optionalSequence(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (finiteNonNegativeInteger(value) === undefined) {
    throw new Error('transport event sequence must be a non-negative safe integer')
  }
  return value as number
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined
  assertRuntimeTimestamp(value, 'occurredAt')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
