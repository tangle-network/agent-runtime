import { clearImmediate, setImmediate } from 'node:timers'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentEvent,
  AgentSession,
  AgentTurnResult,
} from '@tangle-network/agent-interface/environment-provider'
import { defaultRedactor } from '../../redact'
import {
  assertEventBinding,
  awaitAbortable,
  isTerminalSessionStatus,
  RetainedRunProviderContractError,
} from '../retained-run-binding'
import type { RetainedRunHandle } from '../retained-run-types'
import { extractTransportEventIdentity } from '../sandbox-transport-events'
import { armDeadlineTimer } from '../supervise/deadline'
import { causeChain } from '../supervise/error-message'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import { isTerminalEnvironmentEvent } from './provider-event-projection'

// Silence never ends a turn. This long without evidence publishes the wait on the exact result
// once, then reads the run's status: a live or unknown answer keeps the wait.
const RETAINED_AWAITING_RESULT_AFTER_MS = 8 * 60_000
// A status read that fails, outlasts this, or finds the run ended leaves the turn pending.
const RETAINED_STATUS_READ_MS = 60_000

// Bound observation work, not elapsed provider latency. AsyncIterable has no buffered frontier.
// Past this many frames after a settled exact result the rest are dropped and the result stands.
// An owner's later reconciliation of the execution subscribes after the last position read.
const RETAINED_OBSERVATION_BATCH_EVENTS = 1_024

/** After its exact result, a stream owing its terminal frame reads on while each frame comes this
 *  soon after the result or the last frame: a provider sends the two on separate connections. */
const RETAINED_TAIL_FLOW_MS = 100

/** Runtime's own mark, beside the provider's frames, that a retained turn now waits on its exact
 *  result. The executor publishes it as an `awaiting-result` progress row; it is never a frame. */
export interface RetainedAwaitingResult {
  readonly awaitingResultSince: string
}

type FrameRead =
  | { kind: 'event'; value: IteratorResult<AgentEnvironmentEvent> }
  | { kind: 'exact-result' }
  | { kind: 'quiet' }

/** Why the event stream stopped short, as bounded redacted text for the settlement reason. */
function observationFailureText({ error }: { readonly error: unknown }): string {
  const text = error instanceof Error ? error.message : String(error)
  return String(defaultRedactor(text)).slice(0, 2_048)
}

/** A result refused `provider_quota_exhausted` is the ended run's failed result, not one to reconcile. */
function exactQuotaRefusal(error: unknown) {
  try {
    const refusal = causeChain(error).find(
      (cause) =>
        Reflect.get(cause, 'name') === 'TangleCredentialCapacityError' &&
        Reflect.get(cause, 'code') === 'provider_quota_exhausted',
    )
    if (refusal === undefined) return undefined
    const resetAt: unknown = Reflect.get(refusal, 'resetAt')
    return {
      text: '',
      success: false,
      error: `Subscription account capacity is unavailable${typeof resetAt === 'string' ? ` until ${resetAt}` : ''}`,
      errorCode: 'provider_quota_exhausted',
      statusCode: 429,
    }
  } catch {
    return undefined
  }
}

/** Everything one retained dispatch has observed of its event stream and exact result. */
export class RetainedObservation {
  private failure: { error: unknown } | undefined
  // Where a reconnect resumes: the last frame that carried a replay position.
  private lastReplayPosition: string | undefined
  private readonly resumedFrom: string | undefined
  private sawTerminal = false
  private lastObservedAt = 0
  // When the turn last acted on silence: unset until it publishes its wait (once per invocation;
  // the row's `since` is when the silence began), then each live status answer.
  private silenceHandledAt: number | undefined
  private exactResult: Promise<AgentTurnResult> | undefined
  private exactResultSettled = false
  private observedFrames = 0
  private framesAfterResult = 0
  // One reaction on the run-long exact result; a reaction per read kept every drained event alive.
  private readonly exactWakers = new Set<() => void>()
  private readonly seenEvents = new Map<string, string>()
  // A read that lost a race to the awaiting mark stays the stream's next read: a second
  // `next()` would queue behind it and drop the frame it delivers.
  private pendingRead: Promise<FrameRead> | undefined

  constructor(
    private readonly handle: RetainedRunHandle,
    private readonly signal: AbortSignal,
    private readonly position?: Pick<RetainedExecutorContext, 'observed' | 'onObserved'>,
  ) {
    const observed = position?.observed
    if (observed?.executionId === handle.controlRef.executionId)
      this.lastReplayPosition = this.resumedFrom = observed.replayPosition
  }

  /** Stream the provider's frames, resume once after a break, then yield the exact result. */
  async *observe(
    session: AgentSession,
  ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult> {
    this.lastObservedAt = Date.now()
    const completed = yield* this.drain(session, this.resumedFrom)
    if (!completed && !this.sawTerminal && this.lastReplayPosition !== undefined) {
      // The terminal receipt carries the turn's usage: resume once; a second failure keeps the first.
      const firstFailure = this.failure
      this.failure = undefined
      if (!(yield* this.drain(session, this.lastReplayPosition))) this.failure = firstFailure
    }
    // An earlier attempt read the frames up to a resumed position, usage receipts among them.
    const resumed = this.resumedFrom && `retained provider stream resumed after ${this.resumedFrom}`
    if (resumed) this.failure ??= { error: new Error(resumed) }
    if (!this.sawTerminal && this.failure === undefined) {
      this.failure = { error: new Error('retained provider stream did not yield a terminal event') }
    }
    // A short stream is not an end: only the exact result settles the invocation.
    if (!this.sawTerminal && !this.exactResultSettled && this.silenceHandledAt === undefined) {
      yield this.awaitingResult(Date.now())
    }
    while (!(await this.exactOrQuiet())) await this.confirmRunLive(session)
    yield await this.resultFrame()
  }

  /** True once the exact result settles, false once a quiet interval passes first. */
  private exactOrQuiet(): Promise<boolean> {
    let unwatch = [() => {}]
    return new Promise<boolean>((resolve) => {
      unwatch = [this.armQuiet(() => resolve(false)), this.onExactResult(() => resolve(true))]
    }).finally(() => unwatch.map((stop) => stop()))
  }

  private armQuiet(onQuiet: () => void): () => void {
    const quietFrom = Math.max(this.lastObservedAt, this.silenceHandledAt ?? 0)
    const quietMs = RETAINED_AWAITING_RESULT_AFTER_MS - (Date.now() - quietFrom)
    return armDeadlineTimer(Math.max(0, quietMs), onQuiet)
  }

  /** Ask the provider whether the run still lives; throw when it cannot say so in time. */
  private async confirmRunLive(session: AgentSession): Promise<void> {
    const deadline = new AbortController()
    const clear = armDeadlineTimer(RETAINED_STATUS_READ_MS, () =>
      deadline.abort(new Error(`no status answer within ${RETAINED_STATUS_READ_MS} ms`)),
    )
    const signal = AbortSignal.any([this.signal, deadline.signal])
    let cause: unknown
    try {
      const status = await awaitAbortable(
        Promise.resolve().then(() => session.status({ signal })),
        signal,
      )
      if (status !== null && !isTerminalSessionStatus(status)) {
        this.silenceHandledAt = Date.now()
        return
      }
      cause = new Error(`provider status reads ${status}`)
    } catch (error) {
      if (this.signal.aborted) throw error
      cause = deadline.signal.aborted ? deadline.signal.reason : error
    } finally {
      clear()
    }
    throw new Error(
      `retained provider brought no frame or exact result since ${new Date(this.lastObservedAt).toISOString()} and did not confirm its run live`,
      { cause },
    )
  }

  private async resultFrame(): Promise<AgentEnvironmentEvent> {
    let result: AgentTurnResult & { readonly errorCode?: string; readonly statusCode?: number }
    try {
      result = await this.readExactResult()
    } catch (error) {
      if (this.signal.aborted) throw error
      const refusal = exactQuotaRefusal(error)
      if (refusal !== undefined) result = refusal
      else if (this.failure === undefined) throw error
      else
        throw new AggregateError(
          [this.failure.error, error],
          `retained event observation failed (${observationFailureText(this.failure)}) and its exact result could not be reconciled`,
          { cause: error },
        )
    }
    return {
      type: 'result',
      data: {
        finalText: result.text,
        success: result.success,
        ...(result.error ? { error: result.error } : {}),
        ...(result.errorCode ? { errorCode: result.errorCode, statusCode: result.statusCode } : {}),
        usageMode: 'cumulative',
        ...(this.failure === undefined
          ? {}
          : {
              eventStreamComplete: false,
              ...(result.usage === undefined ? { tokensKnown: false } : {}),
              ...(result.usage?.cost === undefined ? { usdKnown: false } : {}),
              eventStreamError: observationFailureText(this.failure),
            }),
      },
      ...(result.usage ? { usage: result.usage } : {}),
    }
  }

  // Give an immediately available frame its binding check before reading the exact result.
  // A quiet first read starts the same result read at the next scheduler turn instead.
  private readExactResult(): Promise<AgentTurnResult> {
    if (this.exactResult === undefined) {
      this.exactResult = awaitAbortable(
        Promise.resolve().then(() => this.handle.result()),
        this.signal,
      )
      const settle = () => {
        if (this.observedFrames === 0) this.lastObservedAt = Date.now()
        this.exactResultSettled = true
        for (const wake of [...this.exactWakers]) wake()
      }
      void this.exactResult.then(settle, settle)
    }
    return this.exactResult
  }

  private onExactResult(waker: () => void): () => void {
    if (this.exactResultSettled) {
      waker()
      return () => {}
    }
    this.exactWakers.add(waker)
    this.readExactResult()
    return () => this.exactWakers.delete(waker)
  }

  private awaitingResult(since: number): RetainedAwaitingResult {
    this.silenceHandledAt = Date.now()
    return { awaitingResultSince: new Date(since).toISOString() }
  }

  /** Read the stream's next frame, or learn first that the wait should publish or the result won. */
  private async raceNextRead(iterator: AsyncIterator<AgentEnvironmentEvent>): Promise<FrameRead> {
    let wake: ReturnType<typeof setImmediate> | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let unwatch: (() => void) | undefined
    let clearQuiet: (() => void) | undefined
    try {
      // Give this read one scheduler turn before an exact result closes a quiet subscription; one
      // owing its terminal frame reads on for the rest of the RETAINED_TAIL_FLOW_MS window.
      const exactWake = new Promise<FrameRead>((resolve) => {
        wake = setImmediate(() => {
          const close = () => {
            const flowing = this.sawTerminal
              ? 0
              : RETAINED_TAIL_FLOW_MS - (Date.now() - this.lastObservedAt)
            if (flowing <= 0) return resolve({ kind: 'exact-result' })
            grace = setTimeout(() => {
              wake = setImmediate(() => resolve({ kind: 'exact-result' }))
            }, flowing)
            if (typeof grace.unref === 'function') grace.unref()
          }
          unwatch = this.onExactResult(close)
        })
      })
      this.pendingRead ??= awaitAbortable(
        Promise.resolve().then(() => iterator.next()),
        this.signal,
      ).then((value) => ({ kind: 'event' as const, value }))
      // A quiet interval publishes the wait or asks after the run; the read and result race on.
      const quiet = new Promise<FrameRead>((resolve) => {
        clearQuiet = this.armQuiet(() => resolve({ kind: 'quiet' }))
      })
      return await Promise.race([this.pendingRead, exactWake, quiet])
    } finally {
      if (wake !== undefined) clearImmediate(wake)
      if (grace !== undefined) clearTimeout(grace)
      unwatch?.()
      clearQuiet?.()
    }
  }

  /** Bind a frame to its run and drop an exact replay; false when it carries no new evidence. */
  private acceptFrame(event: AgentEnvironmentEvent): boolean {
    this.observedFrames += 1
    if (this.exactResultSettled) this.framesAfterResult += 1
    // Another execution's event is never evidence: the PROVIDER's contract broke (#1204).
    try {
      assertEventBinding(event, this.handle.controlRef)
    } catch (error) {
      throw new RetainedRunProviderContractError(
        error instanceof Error ? error.message : 'provider event bound to another run',
        { code: 'RETAINED_EVENT_BINDING_INVALID', cause: error },
      )
    }
    const identity = extractTransportEventIdentity(event)
    const eventId = identity.eventId ?? identity.cursor
    if (eventId !== undefined) {
      const digest = canonicalCandidateDigest({
        type: event.type,
        data: event.data,
        ...(event.usage === undefined ? {} : { usage: event.usage }),
        ...(event.normalized === undefined ? {} : { normalized: event.normalized }),
      })
      const prior = this.seenEvents.get(eventId)
      if (prior !== undefined) {
        if (prior !== digest) {
          throw new RetainedRunProviderContractError(
            `provider replay changed retained event ${eventId}`,
            { code: 'RETAINED_EVENT_DUPLICATE_CHANGED' },
          )
        }
        return false
      }
      this.seenEvents.set(eventId, digest)
    }
    // A replayed frame is not progress: a provider repeating one cursor must not hold a finished turn open.
    this.lastObservedAt = Date.now()
    const replayPosition = identity.cursor ?? eventId
    if (replayPosition !== undefined) {
      this.lastReplayPosition = replayPosition
      const { executionId } = this.handle.controlRef
      this.position?.onObserved?.({ executionId, replayPosition })
    }
    if (isTerminalEnvironmentEvent(event)) this.sawTerminal = true
    this.readExactResult()
    return true
  }

  /** Yield one subscription's new frames; false when the stream failed rather than ended. */
  private async *drain(
    session: AgentSession,
    since?: string,
  ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult, boolean> {
    let iterator: AsyncIterator<AgentEnvironmentEvent> | undefined
    let failed = false
    try {
      iterator = session
        .events({
          executionId: this.handle.controlRef.executionId,
          ...(since === undefined ? {} : { since }),
          signal: this.signal,
        })
        [Symbol.asyncIterator]()
    } catch (error) {
      if (this.signal.aborted) throw error
      this.failure = { error }
      return false
    }
    this.pendingRead = undefined
    try {
      while (true) {
        if (this.framesAfterResult >= RETAINED_OBSERVATION_BATCH_EVENTS) {
          this.failure ??= {
            error: new Error(
              `retained provider stream sent ${RETAINED_OBSERVATION_BATCH_EVENTS} frames after its exact result; the rest were not read`,
            ),
          }
          break
        }
        if (this.observedFrames % RETAINED_OBSERVATION_BATCH_EVENTS === 0 && this.observedFrames) {
          // Ready iterators would otherwise starve result transport, cancellation and deadlines.
          await awaitAbortable(new Promise<void>((resolve) => setImmediate(resolve)), this.signal)
        }
        let observed: FrameRead
        try {
          observed = await this.raceNextRead(iterator)
        } catch (error) {
          if (this.signal.aborted) throw error
          this.failure = { error }
          failed = true
          break
        }
        if (observed.kind === 'quiet') {
          if (this.silenceHandledAt !== undefined) await this.confirmRunLive(session)
          else yield this.awaitingResult(this.lastObservedAt)
          continue
        }
        if (observed.kind === 'exact-result') {
          this.failure ??= {
            error: new Error('retained provider stream remained open after its exact result'),
          }
          break
        }
        this.pendingRead = undefined
        if (observed.value.done) break
        if (this.acceptFrame(observed.value.value)) yield observed.value.value
      }
    } finally {
      // Cleanup proves nothing about readiness; a provider may never resolve return().
      void Promise.resolve()
        .then(() => iterator?.return?.())
        .catch(() => undefined)
    }
    return !failed
  }
}
