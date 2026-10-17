import {
  type AgentExactRunControlRef,
  canonicalCandidateDigest,
  type RuntimeEventEnvelope,
  RuntimeEventEnvelopeSchema,
  type StreamEvent,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentSession,
  AgentSessionStatus,
} from '@tangle-network/agent-interface/environment-provider'
import {
  abortError,
  assertCanonicalEventBinding,
  assertEventBinding,
  assertSequence,
  assertStableText,
  awaitAbortable,
  delay,
  isLiveSessionStatus,
  RetainedRunProviderContractError,
} from './retained-run-binding'
import type { RetainedRunEventOptions } from './retained-run-types'
import {
  extractTransportEventIdentity,
  isTerminalEnvironmentEvent,
  parseCanonicalTransportEvent,
} from './sandbox-events'
import { armDeadlineTimer } from './supervise/deadline'

/** The runtime's own contract checks inside the stream loop, so the catch can tell a broken
 *  answer (a verdict) from a read the provider's iterator failed (a wrapper). */
const runtimeChecks = new WeakSet<Error>()
function contractCheckFailed(message: string): never {
  const error = new Error(message)
  runtimeChecks.add(error)
  throw error
}
/** Run one of the runtime's own checks; whatever it throws is a verdict, not a failed read. */
function verdict<T>(check: () => T): T {
  try {
    return check()
  } catch (error) {
    if (error instanceof Error) runtimeChecks.add(error)
    throw error
  }
}

/** Bounds the provider status read that decides whether an ended stream is resumed. */
const STATUS_READ_MS = 15_000
/** Spacing before a resume that follows a subscription which delivered nothing new. */
const QUIET_RESUME_DELAY_MS = 250

/** The provider positively reports the exact execution still running; any doubt reads as not. */
async function providerReportsRunning(
  session: AgentSession,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    const status = await new Promise<AgentSessionStatus | null>((resolve, reject) => {
      const clear = armDeadlineTimer(STATUS_READ_MS, () => resolve(null))
      awaitAbortable(
        Promise.resolve().then(() => session.status(signal === undefined ? undefined : { signal })),
        signal,
      ).then(
        (value) => {
          clear()
          resolve(value)
        },
        (error: unknown) => {
          clear()
          reject(error)
        },
      )
    })
    return isLiveSessionStatus(status)
  } catch (error) {
    if (signal?.aborted) throw abortError(signal.reason)
    return false
  }
}

/**
 * The exact execution's canonical events, in provider order, until its terminal frame.
 *
 * A provider stream is transport, not the execution. When it ends after delivering events but
 * before the terminal frame, and the provider still reports the exact execution running, the
 * stream resumes from the last provider position instead of ending: a consumer that reads the
 * exact result next would otherwise wait on a run that is still working and report it lost.
 * Two consecutive resumes that deliver nothing new end the stream, and so does any doubt about
 * the execution's status. A resumed subscription may replay frames already delivered; they are
 * skipped, and a frame two resumed subscriptions deliver with different content is a contract
 * violation.
 */
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
  const seen = new Map<string, string | undefined>()
  let firstAfterEvent = after !== undefined
  let resumeCursor = after?.cursor
  let sawTerminal = false
  let delivered = 0
  async function* subscription(
    since: string | undefined,
    resumed: boolean,
  ): AsyncGenerator<RuntimeEventEnvelope> {
    const iterator = session
      .events({
        ...(since === undefined ? {} : { since }),
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
        verdict(() => assertEventBinding(source, controlRef))
        if (sourceCursor !== undefined && sourceCursor === since) continue
        if (isTerminalEnvironmentEvent(source)) sawTerminal = true
        const event = canonicalEvent(source)
        if (!event) {
          if (sourceCursor !== undefined) resumeCursor = sourceCursor
          continue
        }
        verdict(() => assertCanonicalEventBinding(controlRef, event))
        if (firstAfterEvent && after !== undefined) {
          if (identity.sequence !== undefined && identity.sequence <= after.sequence) {
            contractCheckFailed(
              'provider replay did not prove that the first event follows the requested cursor',
            )
          }
          firstAfterEvent = false
        }
        const eventId = identity.eventId ?? identity.cursor
        if (!eventId) {
          contractCheckFailed('replayable canonical event has no stable provider event id or cursor')
        }
        assertStableText(eventId, 'provider event id')
        // Only a resumed subscription can replay a delivered frame, so only it pays for a digest.
        const digest = resumed ? frameDigest(source) : undefined
        if (seen.has(eventId)) {
          const prior = seen.get(eventId)
          if (!resumed || (prior !== undefined && digest !== undefined && prior !== digest)) {
            contractCheckFailed(`provider replay repeated event id "${eventId}"`)
          }
          continue
        }
        seen.set(eventId, digest)
        const sourceSequence = identity.sequence
        const sequence = sourceSequence ?? nextSequence
        if (sequence <= lastSequence) {
          contractCheckFailed(
            `provider event sequence is not monotonic: ${sequence} follows ${lastSequence}`,
          )
        }
        const occurredAt = identity.occurredAt
        const envelope = verdict(() =>
          RuntimeEventEnvelopeSchema.parse({
            runId: controlRef.runId,
            eventId,
            sequence,
            cursor: identity.cursor ?? eventId,
            ...(occurredAt === undefined ? {} : { occurredAt }),
            receivedAt: new Date(now()).toISOString(),
            event,
          }),
        )
        yield envelope
        lastSequence = sequence
        nextSequence = sequence + 1
        resumeCursor = envelope.cursor ?? eventId
        delivered += 1
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
      // Two facts share this catch: the runtime's own checks above threw (the provider's answer
      // broke its contract), or the provider's iterator threw (the READ failed). Name each so a
      // settlement can tell them apart (#1204); the read is a wrapper, the check is a verdict.
      const fromProvider = error instanceof Error && !runtimeChecks.has(error)
      throw new RetainedRunProviderContractError(
        error instanceof Error ? error.message : 'provider retained event stream failed',
        {
          code: fromProvider ? 'RETAINED_EVENT_STREAM_READ_FAILED' : 'RETAINED_EVENT_STREAM_INVALID',
          cause: error,
        },
      )
    } finally {
      if (!options?.signal?.aborted) await iterator.return?.()
    }
  }
  let resumed = false
  let quietResumes = 0
  for (;;) {
    const deliveredBefore = delivered
    yield* subscription(resumeCursor, resumed)
    if (sawTerminal || delivered === 0 || resumeCursor === undefined) return
    const progressed = delivered > deliveredBefore
    quietResumes = progressed ? 0 : quietResumes + 1
    if (quietResumes > 1) return
    if (!(await providerReportsRunning(session, options?.signal))) return
    if (!progressed) await delay(QUIET_RESUME_DELAY_MS, options?.signal)
    resumed = true
  }
}

/** A frame's content digest, for telling an identical replay from changed content. A frame the
 *  canonical digest cannot represent has none, and its replay is not judged by content. */
function frameDigest(source: AgentEnvironmentEvent): string | undefined {
  try {
    return canonicalCandidateDigest({
      type: source.type,
      data: source.data,
      ...(source.usage === undefined ? {} : { usage: source.usage }),
      ...(source.normalized === undefined ? {} : { normalized: source.normalized }),
    })
  } catch {
    return undefined
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
