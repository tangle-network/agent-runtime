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
import { armDeadlineTimer } from '../supervise/deadline'
import { RetainedExecutionPendingError } from '../supervise/retained-executor'
import { isTerminalEnvironmentEvent } from './provider-event-projection'

/**
 * How long a retained stream may go without new evidence before the node publishes that it is
 * waiting on its exact result. It never ends the turn: silence is a wait, and only the provider's
 * exact result or an abort with its named cause ends it. Ending here failed 18 attempts as
 * `terminal-event-lost` over 2026-10-12..20 whose executions were still running. The bound on a
 * wait that never ends is the Lab keeper's hung-root re-drive, which fires on 15 minutes without a
 * stream write whether or not it reads this row.
 */
const RETAINED_AWAITING_RESULT_AFTER_MS = 8 * 60_000

// Bound observation work, not elapsed provider latency. AsyncIterable has no buffered frontier.
const RETAINED_OBSERVATION_BATCH_EVENTS = 1_024

/**
 * After its exact result, a stream that still owes its terminal frame keeps reading only while its
 * frames keep coming: the next frame must arrive within this long of the last one. A quiet stream,
 * or one with no frame at all, closes on the result at once and never holds the wake. A provider
 * sends a turn's last frames and its result together on two connections, and a burst that
 * straddles the result is read whole.
 */
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

/**
 * Why the event stream stopped short, as bounded redacted text. A settlement reason is built from
 * messages and `cause` links only, never from an AggregateError's members, so a wrapper that
 * leaves this out hides which layer lost the stream: a tournament judge on 2026-10-16
 * (critics-tournament-v1-158ca88e83bf:s1) settled as a lost terminal event and its journal could
 * not say whether the stream ended, broke, or refused a frame.
 */
function observationFailureText(failure: { readonly error: unknown }): string {
  const error = failure.error
  return String(defaultRedactor(error instanceof Error ? error.message : String(error))).slice(
    0,
    2_048,
  )
}

/** Everything one retained dispatch has observed of its event stream and exact result. */
export class RetainedObservation {
  private failure: { error: unknown } | undefined
  // The last frame that carried a replay position, and whether any frame ended the turn. The
  // SSE contract lets a frame arrive with no position; such a frame does not move the cursor,
  // so this is where a reconnect resumes from.
  private lastReplayPosition: string | undefined
  private sawTerminal = false
  private lastObservedAt = 0
  // When the stream last delivered a new frame; undefined until it delivers one.
  private lastFrameAt: number | undefined
  // The node publishes its wait once per invocation; the row's `since` is when it began.
  private awaitingPublished = false
  private exactResult: Promise<AgentTurnResult> | undefined
  private exactResultSettled = false
  private observedFrames = 0
  private framesAfterResult = 0
  private budgetExceeded = false
  // One reaction on the exact result for the whole drain, not one per event read. Each read adds its
  // waker here and removes it when the read ends, so a read's event is released with it. A reaction
  // added per read to this run-long promise kept every drained event reachable through Promise.race:
  // on 2026-10-18 free-tier supervisors (whole ~225 KB part states per update) grew to node's 4 GB
  // heap limit within an hour.
  private readonly exactWakers = new Set<() => void>()
  private exactWatched = false
  private readonly seenEvents = new Map<string, string>()
  // A read that lost a race to the awaiting mark stays the stream's next read: a second
  // `next()` would queue behind it and drop the frame it delivers.
  private pendingRead: Promise<FrameRead> | undefined

  constructor(
    private readonly handle: RetainedRunHandle,
    private readonly signal: AbortSignal,
  ) {}

  /** Stream the provider's frames, resume once after a break, then yield the exact result. */
  async *observe(
    session: AgentSession,
  ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult> {
    this.lastObservedAt = Date.now()
    const completed = yield* this.drain(() =>
      session.events({ executionId: this.handle.controlRef.executionId, signal: this.signal }),
    )
    if (!completed && !this.sawTerminal && this.lastReplayPosition !== undefined) {
      // The live stream broke before the terminal receipt. That receipt is where a Sandbox
      // execution reports its token usage, and the exact result read below does not carry it,
      // so a break here used to settle a 15-minute turn at 0 tokens with tokensKnown: false,
      // which the conserved pool debits as nothing. Measured on
      // mech-interp-foundations-pi-20260915k turn 1 (926 s, 0/0) and -20260915l turns 2 and 3
      // (1693 s and 846 s, 0/0), each cut by one frame the provider refused mid-stream. The
      // provider replays from a cursor, so resume once from the last replay position. A second
      // failure keeps the first as the recorded cause; it is the one that lost the frames.
      const firstFailure = this.failure
      this.failure = undefined
      const since = this.lastReplayPosition
      const resumed = yield* this.drain(() =>
        session.events({
          executionId: this.handle.controlRef.executionId,
          since,
          signal: this.signal,
        }),
      )
      if (!resumed) this.failure = firstFailure
    }
    if (this.budgetExceeded) {
      // Preserve a definite exact-result error instead of masking it as observation loss.
      await this.readExactResult()
      // A result does not prove that unobserved queued frames were bound or non-refusals.
      // Preserve the original admission rather than accepting success at an arbitrary cut.
      throw new RetainedExecutionPendingError(
        new Error(
          `retained provider observation exceeded ${RETAINED_OBSERVATION_BATCH_EVENTS} frames after its exact result`,
        ),
        'unobservable',
      )
    }
    if (!this.sawTerminal && this.failure === undefined) {
      this.failure = { error: new Error('retained provider stream did not yield a terminal event') }
    }
    // Observation failure does not establish execution failure. Only the exact retained
    // result can settle the invocation; retain incomplete observation beside that result.
    // A stream that ended short is not an end: the node waits on the provider's exact result
    // for as long as the provider takes, and only the turn's signal ends that wait sooner.
    // The Sandbox SDK builds that result by replaying the execution's events, and a replay that
    // closes short returns `success: false`, "Agent stream ended without a terminal event", with
    // no error code. Runtime cannot tell that from the execution's own failure, so it settles as
    // failed; 64 of the 82 C1 attempts (2026-10-12..20) ended there. The SDK owns that verdict.
    if (!this.sawTerminal && !this.exactResultSettled && !this.awaitingPublished) {
      yield this.awaitingResult(Date.now())
    }
    yield await this.resultFrame()
  }

  private async resultFrame(): Promise<AgentEnvironmentEvent> {
    let result: AgentTurnResult
    try {
      result = await this.readExactResult()
    } catch (error) {
      if (this.signal.aborted) throw error
      if (this.failure === undefined) throw error
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
        this.exactResultSettled = true
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
    if (!this.exactWatched) {
      this.exactWatched = true
      const fire = () => {
        for (const wake of [...this.exactWakers]) wake()
      }
      void this.readExactResult().then(fire, fire)
    }
    return () => {
      this.exactWakers.delete(waker)
    }
  }

  private awaitingResult(since: number): RetainedAwaitingResult {
    this.awaitingPublished = true
    return { awaitingResultSince: new Date(since).toISOString() }
  }

  /** Read the stream's next frame, or learn first that the wait should publish or the result won. */
  private async raceNextRead(iterator: AsyncIterator<AgentEnvironmentEvent>): Promise<FrameRead> {
    let wake: ReturnType<typeof setImmediate> | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let unwatch: (() => void) | undefined
    let clearQuiet: (() => void) | undefined
    try {
      // Give this event read one scheduler turn before an exact result closes a quiet
      // subscription. A stream still owing its terminal frame whose last frame came within
      // RETAINED_TAIL_FLOW_MS keeps reading for the rest of that window; a quiet one closes
      // at once. Ready tails are observed only within the finite work allowance.
      const exactWake = new Promise<FrameRead>((resolve) => {
        wake = setImmediate(() => {
          const close = () => {
            const flowing =
              this.sawTerminal || this.lastFrameAt === undefined
                ? 0
                : RETAINED_TAIL_FLOW_MS - (Date.now() - this.lastFrameAt)
            if (flowing <= 0) {
              resolve({ kind: 'exact-result' })
              return
            }
            grace = setTimeout(() => resolve({ kind: 'exact-result' }), flowing)
            if (typeof grace.unref === 'function') grace.unref()
          }
          unwatch = this.onExactResult(close)
        })
      })
      this.pendingRead ??= awaitAbortable(
        Promise.resolve().then(() => iterator.next()),
        this.signal,
      ).then((value) => ({ kind: 'event' as const, value }))
      // No new evidence for a while publishes the wait; the read and the result race on.
      const quiet = this.awaitingPublished
        ? undefined
        : new Promise<FrameRead>((resolve) => {
            clearQuiet = armDeadlineTimer(
              Math.max(0, RETAINED_AWAITING_RESULT_AFTER_MS - (Date.now() - this.lastObservedAt)),
              () => resolve({ kind: 'quiet' }),
            )
          })
      return await Promise.race([
        this.pendingRead,
        exactWake,
        ...(quiet === undefined ? [] : [quiet]),
      ])
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
    // A received event for another execution must never be accepted as evidence — and
    // it is the PROVIDER's contract that was broken, so it must classify as such (#1204).
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
    // A replayed frame is not progress. Only new evidence extends the silence bound;
    // otherwise a provider repeating one cursor could keep a finished turn open forever.
    this.lastObservedAt = Date.now()
    this.lastFrameAt = this.lastObservedAt
    if (identity.cursor !== undefined) this.lastReplayPosition = identity.cursor
    else if (eventId !== undefined) this.lastReplayPosition = eventId
    if (isTerminalEnvironmentEvent(event)) this.sawTerminal = true
    this.readExactResult()
    return true
  }

  /** Yield one subscription's new frames; false when the stream failed rather than ended. */
  private async *drain(
    open: () => AsyncIterable<AgentEnvironmentEvent>,
  ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult, boolean> {
    let iterator: AsyncIterator<AgentEnvironmentEvent> | undefined
    let failed = false
    try {
      iterator = open()[Symbol.asyncIterator]()
    } catch (error) {
      if (this.signal.aborted) throw error
      this.failure = { error }
      return false
    }
    this.pendingRead = undefined
    try {
      while (true) {
        if (this.framesAfterResult >= RETAINED_OBSERVATION_BATCH_EVENTS) {
          this.budgetExceeded = true
          break
        }
        if (
          this.observedFrames > 0 &&
          this.observedFrames % RETAINED_OBSERVATION_BATCH_EVENTS === 0
        ) {
          // Ready iterators can otherwise monopolize the microtask queue and starve the
          // result transport, cancellation, and deadlines. Duplicates count as work too.
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
          yield this.awaitingResult(this.lastObservedAt)
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
      // Subscription cleanup cannot establish execution readiness or suppress a binding
      // verdict. A provider may never resolve return(); source teardown has its own proof.
      void Promise.resolve()
        .then(() => iterator?.return?.())
        .catch(() => undefined)
    }
    return !failed
  }
}
