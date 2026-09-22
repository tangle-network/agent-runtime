import { envelopeRuntimeEvents, type RuntimeStreamEventEnvelope } from '../runtime-event-envelope'
import type { RuntimeStreamEvent } from '../types'
import { projectedEventIdentity } from './stream-agent-turn-projection'
import { streamAgentTurn } from './stream-agent-turn'
import type { AgentTurnBackend, StreamAgentTurnOptions } from './stream-agent-turn-types'

/** Options for a run-identified, replay-safe turn stream. @experimental */
export interface StreamAgentTurnEnvelopeOptions extends StreamAgentTurnOptions {
  readonly runId: string
  readonly startSequence?: number
  readonly now?: () => number
}

/**
 * Run one turn and add stable run/event identity without changing the existing
 * payload vocabulary.
 *
 * @experimental
 */
export function streamAgentTurnEnvelopes(
  backend: AgentTurnBackend,
  prompt: string,
  options: StreamAgentTurnEnvelopeOptions,
): AsyncIterable<RuntimeStreamEventEnvelope> {
  const { runId, startSequence, now, ...turnOptions } = options
  // The in-process chat contract exposes normalized payloads but no durable
  // source cursor for ordinary deltas. Do not advertise reconnectable
  // envelopes for it until that provider contract supplies one.
  const events =
    backend.kind === 'chat'
      ? unsupportedEnvelopeEvents()
      : streamAgentTurn(backend, prompt, turnOptions)
  return envelopeRuntimeEvents(events, {
    runId,
    ...(startSequence === undefined ? {} : { startSequence }),
    ...(now === undefined ? {} : { now }),
    identity(event) {
      if (
        event.type === 'backend_start' ||
        event.type === 'backend_error' ||
        event.type === 'final'
      ) {
        return { eventId: `${runId}:${event.type}` }
      }
      const projected = projectedEventIdentity(event)
      if (projected) return projected
      if (event.type !== 'canonical_event') return undefined
      return {
        ...(event.eventId === undefined ? {} : { eventId: event.eventId }),
        ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
        ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
      }
    },
  })
}

function unsupportedEnvelopeEvents(): AsyncIterable<RuntimeStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw new Error(
            'streamAgentTurnEnvelopes requires a backend with durable event identity; chat backends do not provide one',
          )
        },
      }
    },
  }
}
