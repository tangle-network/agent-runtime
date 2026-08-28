import {
  type AgentExactRunControlRef,
  type RuntimeEventEnvelope,
  RuntimeEventEnvelopeSchema,
  type StreamEvent,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'
import {
  abortError,
  assertCanonicalEventBinding,
  assertEventBinding,
  assertSequence,
  assertStableText,
  awaitAbortable,
  RetainedRunProviderContractError,
} from './retained-run-binding'
import type { RetainedRunEventOptions } from './retained-run-types'
import { extractTransportEventIdentity, parseCanonicalTransportEvent } from './sandbox-events'

export async function* retainedRunEvents(
  session: AgentSession,
  controlRef: AgentExactRunControlRef,
  options: RetainedRunEventOptions | undefined,
  now: () => number,
): AsyncGenerator<RuntimeEventEnvelope> {
  const after = options?.after
  if (after) {
    assertStableText(after.cursor, 'replay cursor')
    assertSequence(after.sequence, 'replay sequence')
  }
  let nextSequence = after === undefined ? 1 : after.sequence + 1
  let lastSequence = after?.sequence ?? -1
  const seen = new Set<string>()
  let firstAfterEvent = after !== undefined
  const iterator = session
    .events({
      ...(after === undefined ? {} : { since: after.cursor }),
      ...(controlRef.executionId === undefined ? {} : { executionId: controlRef.executionId }),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    })
    [Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = await awaitAbortable(
        Promise.resolve().then(() => iterator.next()),
        options?.signal,
      )
      if (next.done) break
      const source = next.value
      const identity = extractTransportEventIdentity(source)
      const sourceCursor = identity.cursor ?? identity.eventId
      assertEventBinding(source, controlRef)
      if (sourceCursor === after?.cursor) continue
      const event = canonicalEvent(source)
      if (!event) continue
      assertCanonicalEventBinding(controlRef, event)
      if (firstAfterEvent && after !== undefined) {
        if (identity.sequence !== undefined && identity.sequence <= after.sequence) {
          throw new Error(
            'provider replay did not prove that the first event follows the requested cursor',
          )
        }
        firstAfterEvent = false
      }
      const eventId = identity.eventId ?? identity.cursor
      if (!eventId) {
        throw new Error('replayable canonical event has no stable provider event id or cursor')
      }
      assertStableText(eventId, 'provider event id')
      if (seen.has(eventId)) throw new Error(`provider replay repeated event id "${eventId}"`)
      seen.add(eventId)
      const sourceSequence = identity.sequence
      const sequence = sourceSequence ?? nextSequence
      if (sequence <= lastSequence) {
        throw new Error(
          `provider event sequence is not monotonic: ${sequence} follows ${lastSequence}`,
        )
      }
      const occurredAt = identity.occurredAt
      const envelope = RuntimeEventEnvelopeSchema.parse({
        runId: controlRef.runId,
        eventId,
        sequence,
        cursor: identity.cursor ?? eventId,
        ...(occurredAt === undefined ? {} : { occurredAt }),
        receivedAt: new Date(now()).toISOString(),
        event,
      })
      yield envelope
      lastSequence = sequence
      nextSequence = sequence + 1
    }
  } catch (error) {
    if (options?.signal?.aborted) {
      try {
        void Promise.resolve(iterator.return?.()).catch(() => undefined)
      } catch {
        // The caller's abort is the only observable result of an interrupted read.
      }
      throw abortError(options.signal.reason)
    }
    if (error instanceof RetainedRunProviderContractError) throw error
    throw new RetainedRunProviderContractError(
      error instanceof Error ? error.message : 'provider retained event stream failed',
      { code: 'RETAINED_EVENT_STREAM_INVALID', cause: error },
    )
  } finally {
    if (!options?.signal?.aborted) await iterator.return?.()
  }
}

function canonicalEvent(source: AgentEnvironmentEvent): StreamEvent | undefined {
  return parseCanonicalTransportEvent(
    source.type,
    source.data,
    source.normalized ?? source.data.normalized,
    'provider',
  )
}
