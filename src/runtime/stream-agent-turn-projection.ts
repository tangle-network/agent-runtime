import type { SandboxEvent } from '@tangle-network/sandbox'
import type { RuntimeStreamEvent } from '../types'
import { extractTransportEventIdentity } from './sandbox-events'

const projectedRuntimeEventIdentity = Symbol('projected-runtime-event-identity')

type ProjectedRuntimeEvent = RuntimeStreamEvent & {
  [projectedRuntimeEventIdentity]?: {
    eventId?: string
    cursor?: string
    sequence?: number
    occurredAt?: string
  }
}

/** Attach source identity to an event projected from a sandbox event. */
export function projectedEventWithIdentity(
  event: RuntimeStreamEvent,
  source: SandboxEvent,
): RuntimeStreamEvent {
  const identity = extractTransportEventIdentity(source)
  const sourceId = identity.eventId ?? identity.cursor
  if (sourceId === undefined) return event
  const projected: ProjectedRuntimeEvent = event
  Object.defineProperty(projected, projectedRuntimeEventIdentity, {
    configurable: true,
    value: {
      eventId: `${sourceId}:${event.type}`,
      ...(identity.cursor === undefined ? {} : { cursor: `${identity.cursor}:${event.type}` }),
      ...(identity.occurredAt === undefined ? {} : { occurredAt: identity.occurredAt }),
    },
  })
  return projected
}

/** Read source identity attached to a projected event, if present. */
export function projectedEventIdentity(event: RuntimeStreamEvent): {
  eventId?: string
  cursor?: string
  sequence?: number
  occurredAt?: string
} | undefined {
  return (event as ProjectedRuntimeEvent)[projectedRuntimeEventIdentity]
}
