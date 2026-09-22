import { CanonicalStreamEventSchema, type StreamEvent } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { RuntimeStreamEvent } from '../types'
import { assertRuntimeTimestamp } from './timestamps'

/**
 * Preserve a canonical interface event carried by a sandbox stream.
 *
 * Sandbox transports put the event discriminator in `type` and its remaining
 * fields in `data`; some adapters instead provide a complete `normalized`
 * value. Only schema-valid canonical events cross this boundary.
 *
 * @experimental
 */
export function mapSandboxCanonicalEvent(
  event: SandboxEvent,
): (RuntimeStreamEvent & { type: 'canonical_event' }) | undefined {
  if (!event || typeof event !== 'object') return undefined
  const record = event as unknown as Record<string, unknown>
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  const normalizedValue = record.normalized ?? data.normalized
  const canonical = parseCanonicalTransportEvent(event.type, data, normalizedValue, 'sandbox')
  if (!canonical) return undefined

  const identity = extractTransportEventIdentity(event)
  const eventId = identity.eventId
  const cursor = identity.cursor ?? eventId
  const sequence = identity.sequence
  const occurredAt = identity.occurredAt
  return {
    type: 'canonical_event',
    event: canonical,
    ...(eventId === undefined ? {} : { eventId }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(sequence === undefined ? {} : { sequence }),
    ...(occurredAt === undefined ? {} : { occurredAt, timestamp: occurredAt }),
  }
}

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
  if (normalized !== undefined) {
    if (
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
  if (embeddedType !== undefined && embeddedType !== outerType) {
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
  const eventId = stableString(
    record.id ??
      record.eventId ??
      data.eventId ??
      providerEvent.id ??
      providerEvent.eventId ??
      providerData.eventId,
  )
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
