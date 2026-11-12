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
  RetainedRunProviderContractError,
} from '../retained-run-binding'
import type { RetainedRunHandle } from '../retained-run-types'
import { extractTransportEventIdentity } from '../sandbox-transport-events'
import { linkAbort } from '../supervise/abortable'
import { armDeadlineTimer } from '../supervise/deadline'
import { causeChain } from '../supervise/error-message'
import { turnFailureOf } from '../supervise/executor-outcome'
import { hostRestartReconnect } from '../supervise/host-restart'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import { isTerminalEnvironmentEvent } from './provider-event-projection'

const RETAINED_AWAITING_RESULT_AFTER_MS = 8 * 60_000
const RETAINED_STATUS_READ_MS = 60_000

// Bound post-result work; later reconciliation resumes after the last position read.
const RETAINED_OBSERVATION_BATCH_EVENTS = 1_024

// The result and terminal frame may arrive on separate connections.
const RETAINED_TAIL_FLOW_MS = 100

/** Runtime progress while awaiting the exact result; never a provider frame. */
export interface RetainedAwaitingResult {
  readonly awaitingResultSince: string
}

type FrameRead =
  | { kind: 'event'; value: IteratorResult<AgentEnvironmentEvent> }
  | { kind: 'exact-result' }
  | { kind: 'quiet' }

const streamFailure = (message: string) =>
  Object.assign(new Error(message), { name: 'RetainedStreamError' })

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
    const failure = turnFailureOf(refusal)
    const resetAt: unknown = Reflect.get(refusal, 'resetAt')
    return {
      text: '',
      success: false,
      error: `Subscription account capacity is unavailable${typeof resetAt === 'string' ? ` until ${resetAt}` : ''}`,
      errorCode: 'provider_quota_exhausted',
      statusCode: 429,
      failure: failure ?? {
        kind: 'capacity' as const,
        code: 'provider_quota_exhausted',
        ...(typeof resetAt === 'string' && Number.isFinite(Date.parse(resetAt))
          ? { resetAt: new Date(resetAt).toISOString() }
          : {}),
      },
    }
  } catch {
    return undefined
  }
}

export class RetainedObservation {
  private failure: { error: unknown } | undefined
  private lastReplayPosition: string | undefined
  private readonly resumedFrom: string | undefined
  private sawTerminal = false
  private lastObservedAt = 0
  // The awaiting mark grants one more quiet interval, not an indefinitely renewable lease.
  private silenceHandledAt: number | undefined
  private exactResult: Promise<AgentTurnResult> | undefined
  private exactResultSettled = false
  private observedFrames = 0
  private framesAfterResult = 0
  // One reaction on the run-long exact result; a reaction per read kept every drained event alive.
  private readonly exactWakers = new Set<() => void>()
  private readonly seenEvents = new Map<string, string>()
  // Reuse the losing read: another next() would queue behind it and drop its frame.
  private pendingRead: Promise<FrameRead> | undefined
  // A planned host restart ends the stream and the result read; both resume under this execution.
  private readonly restart: ReturnType<typeof hostRestartReconnect>

  constructor(
    private readonly handle: RetainedRunHandle,
    private readonly signal: AbortSignal,
    private readonly position?: Pick<RetainedExecutorContext, 'observed' | 'onObserved'>,
    private readonly quietMs = RETAINED_AWAITING_RESULT_AFTER_MS,
  ) {
    this.restart = hostRestartReconnect(signal)
    const observed = position?.observed
    if (observed?.executionId === handle.controlRef.executionId)
      this.lastReplayPosition = this.resumedFrom = observed.replayPosition
  }

  async *observe(
    session: AgentSession,
  ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult> {
    let replayedFrom: string | undefined
    let firstFailure: typeof this.failure
    while (true) {
      this.lastObservedAt = Date.now()
      if ((yield* this.drain(session, replayedFrom ?? this.resumedFrom)) || this.sawTerminal) break
      firstFailure ??= this.failure
      const restarted = await this.restart.retry(this.failure?.error)
      if (
        !restarted &&
        (this.lastReplayPosition === undefined || this.lastReplayPosition === replayedFrom)
      ) {
        this.failure = firstFailure
        break
      }
      replayedFrom = this.lastReplayPosition
      this.failure = undefined
    }
    // An earlier attempt read the frames up to a resumed position, usage receipts among them.
    const resumed = this.resumedFrom && `retained provider stream resumed after ${this.resumedFrom}`
    if (resumed) this.failure ??= { error: streamFailure(resumed) }
    if (!this.sawTerminal && this.failure === undefined) {
      this.failure = {
        error: streamFailure('retained provider stream did not yield a terminal event'),
      }
    }
    // A short stream is not an end: only the exact result settles the invocation.
    if (!this.sawTerminal && !this.exactResultSettled && this.silenceHandledAt === undefined) {
      yield this.awaitingResult(Date.now())
      this.lastObservedAt = Date.now()
    }
    while (!(await this.exactOrQuiet())) await this.stopQuietObservation(session)
    yield await this.resultFrame()
  }

  private exactOrQuiet(): Promise<boolean> {
    let unwatch = [() => {}]
    return new Promise<boolean>((resolve) => {
      unwatch = [this.armQuiet(() => resolve(false)), this.onExactResult(() => resolve(true))]
    }).finally(() => unwatch.map((stop) => stop()))
  }

  private armQuiet(onQuiet: () => void): () => void {
    const quietFrom = Math.max(this.lastObservedAt, this.silenceHandledAt ?? 0)
    const quietMs = this.quietMs - (Date.now() - quietFrom)
    return armDeadlineTimer(Math.max(0, quietMs), onQuiet)
  }

  /** Status diagnoses the observation stop; it cannot substitute for a frame or exact result. */
  private async stopQuietObservation(session: AgentSession): Promise<void> {
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
      cause = new Error(`provider status reads ${status}`)
    } catch (error) {
      if (this.signal.aborted) throw error
      cause = deadline.signal.aborted ? deadline.signal.reason : error
    } finally {
      clear()
    }
    if (this.exactResultSettled) return
    throw Object.assign(
      streamFailure(
        'retained provider observation exceeded its quiet interval; exact execution remains pending',
      ),
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
        ...(result.failure === undefined ? {} : { failure: result.failure }),
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

  private readExactResult(retried = false): Promise<AgentTurnResult> {
    if (this.exactResult === undefined) {
      const read = (): Promise<AgentTurnResult> =>
        this.handle.result().catch(async (error: unknown) => {
          if (await this.restart.retry(error)) return read()
          throw error
        })
      this.exactResult = awaitAbortable(Promise.resolve().then(read), this.signal)
      const settle = (...failed: [error?: unknown]) => {
        if (this.observedFrames === 0) this.lastObservedAt = Date.now()
        // One failed read is not the exact result: observation reads on while one more read runs.
        const retry = !retried && failed.length > 0 && !exactQuotaRefusal(failed[0])
        if (retry) this.exactResult = undefined
        else this.exactResultSettled = true
        for (const wake of [...this.exactWakers]) wake()
        if (retry) this.readExactResult(true)
      }
      void this.exactResult.then(() => settle(), settle)
    }
    return this.exactResult
  }

  private onExactResult(waker: () => void): () => void {
    this.exactWakers.add(waker)
    if (this.exactResultSettled) waker()
    else this.readExactResult()
    return () => this.exactWakers.delete(waker)
  }

  private awaitingResult(since: number): RetainedAwaitingResult {
    this.silenceHandledAt = Date.now()
    return { awaitingResultSince: new Date(since).toISOString() }
  }

  private async raceNextRead(iterator: AsyncIterator<AgentEnvironmentEvent>): Promise<FrameRead> {
    let wake: ReturnType<typeof setImmediate> | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let unwatch: (() => void) | undefined
    let clearQuiet: (() => void) | undefined
    try {
      // Give ready frames one scheduler turn, then wait out the terminal-frame flow window.
      const exactWake = new Promise<FrameRead>((resolve) => {
        wake = setImmediate(() => {
          const close = () => {
            if (!this.exactResultSettled) return
            const flowing = this.sawTerminal
              ? 0
              : RETAINED_TAIL_FLOW_MS - (Date.now() - this.lastObservedAt)
            if (flowing <= 0) {
              wake = setImmediate(() => resolve({ kind: 'exact-result' }))
              return
            }
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
    this.restart.settled()
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

  private async *drain(
    session: AgentSession,
    since?: string,
  ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult, boolean> {
    const subscription = linkAbort(this.signal)
    let iterator: AsyncIterator<AgentEnvironmentEvent> | undefined
    try {
      iterator = session
        .events({
          executionId: this.handle.controlRef.executionId,
          ...(since === undefined ? {} : { since }),
          signal: subscription.signal,
        })
        [Symbol.asyncIterator]()
    } catch (error) {
      subscription.abort()
      if (this.signal.aborted) throw error
      this.failure = { error }
      return false
    }
    this.pendingRead = undefined
    try {
      while (true) {
        if (this.framesAfterResult >= RETAINED_OBSERVATION_BATCH_EVENTS) {
          this.failure ??= {
            error: streamFailure(
              `retained provider stream sent ${RETAINED_OBSERVATION_BATCH_EVENTS} frames after its exact result; the rest were not read`,
            ),
          }
          return true
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
          return false
        }
        if (observed.kind === 'quiet') {
          if (this.silenceHandledAt === undefined) yield this.awaitingResult(this.lastObservedAt)
          this.failure ??= {
            error: streamFailure('retained provider stream stalled before its exact result'),
          }
          return false
        }
        if (observed.kind === 'exact-result') {
          this.failure ??= {
            error: streamFailure('retained provider stream remained open after its exact result'),
          }
          return true
        }
        this.pendingRead = undefined
        if (observed.value.done) return this.sawTerminal
        if (this.acceptFrame(observed.value.value)) {
          yield observed.value.value
          // Consumer persistence is backpressure, not silence on the provider connection.
          this.lastObservedAt = Date.now()
        }
      }
    } finally {
      subscription.abort()
      this.pendingRead = undefined
      // A pending read must stop before return(), which queues behind it.
      void Promise.resolve()
        .then(() => iterator?.return?.())
        .catch(() => undefined)
    }
  }
}
