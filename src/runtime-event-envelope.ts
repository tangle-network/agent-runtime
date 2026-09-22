/**
 * Ordered runtime event envelopes.
 *
 * `RuntimeStreamEvent` remains the payload vocabulary used by existing turn
 * consumers. This module adds the identity needed by reconnecting clients:
 * one run id, stable event id, monotonic sequence, exclusive replay cursor,
 * occurrence time, and receipt time.
 *
 * @stable
 */

import { assertRuntimeTimestamp } from './runtime/timestamps'
import type { RuntimeStreamEvent } from './types'

/** @stable */
export interface RuntimeStreamEventEnvelope {
  readonly runId: string
  readonly eventId: string
  readonly sequence: number
  readonly cursor?: string
  readonly occurredAt?: string
  readonly receivedAt: string
  readonly event: RuntimeStreamEvent
}

/** Source identity known before an event enters the runtime journal. @stable */
export interface RuntimeEventIdentity {
  readonly eventId?: string
  readonly sequence?: number
  readonly cursor?: string
  readonly occurredAt?: string
  readonly receivedAt?: string
}

/** Options for adding identity to a runtime event stream. @stable */
export interface EnvelopeRuntimeEventsOptions {
  readonly runId: string
  readonly startSequence?: number
  readonly now?: () => number
  readonly identity?: (
    event: RuntimeStreamEvent,
    sequence: number,
  ) => RuntimeEventIdentity | undefined
}

/**
 * Wrap an existing stream without buffering it.
 *
 * A source-provided id or cursor is required. A sequence is ordering metadata,
 * not an identity: synthesizing an invocation-local id would make replay after
 * reconnect indistinguishable from a new event.
 *
 * @stable
 */
export async function* envelopeRuntimeEvents(
  events: AsyncIterable<RuntimeStreamEvent>,
  options: EnvelopeRuntimeEventsOptions,
): AsyncGenerator<RuntimeStreamEventEnvelope> {
  assertStableText(options.runId, 'runtime event run id')
  let sequence = options.startSequence ?? 0
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('runtime event start sequence must be a non-negative safe integer')
  }
  const now = options.now ?? Date.now
  const seenEventIds = new Set<string>()
  for await (const event of events) {
    const identity = options.identity?.(event, sequence)
    const explicitSequence = identity?.sequence ?? sequence
    if (!Number.isSafeInteger(explicitSequence) || explicitSequence < sequence) {
      throw new Error(
        `runtime event sequence must be monotonic: expected at least ${sequence}, received ${explicitSequence}`,
      )
    }
    const receivedAt = identity?.receivedAt ?? new Date(now()).toISOString()
    const occurredAt = identity?.occurredAt ?? timestampFromEvent(event)
    assertRuntimeTimestamp(receivedAt, 'receivedAt')
    if (occurredAt !== undefined) assertRuntimeTimestamp(occurredAt, 'occurredAt')
    const eventId = identity?.eventId ?? identity?.cursor
    if (eventId === undefined) {
      throw new Error('runtime event source has no durable event id or replay cursor')
    }
    assertStableText(eventId, 'runtime event id')
    if (seenEventIds.has(eventId)) {
      throw new Error(`runtime event id "${eventId}" was emitted more than once`)
    }
    seenEventIds.add(eventId)
    if (identity?.cursor !== undefined) assertStableText(identity.cursor, 'runtime event cursor')
    yield {
      runId: options.runId,
      eventId,
      sequence: explicitSequence,
      ...(identity?.cursor === undefined ? {} : { cursor: identity.cursor }),
      ...(occurredAt === undefined ? {} : { occurredAt }),
      receivedAt,
      event,
    }
    sequence = explicitSequence + 1
  }
}

function timestampFromEvent(event: RuntimeStreamEvent): string | undefined {
  if (event.type === 'canonical_event' && event.occurredAt !== undefined) {
    return event.occurredAt
  }
  if (!('timestamp' in event) || typeof event.timestamp !== 'string') return undefined
  return event.timestamp
}

function assertStableText(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be non-empty and have no outer whitespace`)
  }
}
