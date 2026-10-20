import { clearImmediate, setImmediate } from 'node:timers'
import { AgentTurnInputSchema, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentTurnInput,
  AgentTurnResult,
} from '@tangle-network/agent-interface/environment-provider'
import { defaultRedactor } from '../../redact'
import {
  assertEventBinding,
  awaitAbortable,
  exactSession,
  RetainedRunProviderContractError,
} from '../retained-run-binding'
import {
  assertRetainedRunReplayMaterial,
  mintRetainedIdentity,
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
} from '../retained-run-start'
import type { RetainedRunHandle } from '../retained-run-types'
import { extractTransportEventIdentity } from '../sandbox-events'
import { armDeadlineTimer } from '../supervise/deadline'
import { RetainedExecutionPendingError } from '../supervise/retained-executor'
import { verifyWorkspaceMarker } from '../supervise/workspace-checkpoint'
import type { RetainedAwaitingResult, StreamProviderExecutorArgs } from './contracts'
import { isTerminalEnvironmentEvent } from './events'
import {
  assertRuntimeMcpAttachments,
  hasRuntimeMcpAttachments,
  subscriptionTurnProfile,
} from './turn-input'

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
/** One retained dispatch owns creation, replay, result identity, and cancellation. */
export async function providerExecutionSource(
  args: StreamProviderExecutorArgs,
  turn: AgentTurnInput,
  signal: AbortSignal,
): Promise<{
  environment: AgentEnvironment
  events: AsyncIterable<AgentEnvironmentEvent | RetainedAwaitingResult>
  retained: boolean
}> {
  const selectedTurn = subscriptionTurnProfile(turn, args.profile)
  AgentTurnInputSchema.parse(selectedTurn)
  const needsMcp = hasRuntimeMcpAttachments(args.options.defaults)
  const capabilities = args.retention || needsMcp ? await args.provider.capabilities() : undefined
  assertRuntimeMcpAttachments(args.provider.name, args.options.defaults, capabilities)
  const useRetained = args.retention !== undefined && capabilities?.retainedControl !== undefined
  if (!useRetained) {
    if (args.recovering)
      throw new Error(`provider ${args.provider.name} cannot recover retained executions`)
    const environment = await args.provider.create({
      ...args.options.defaults,
      profile: args.createProfile,
      signal,
    })
    return { environment, events: environment.stream(selectedTurn), retained: false }
  }
  const retention = args.retention!
  let admitted = args.recovering
  let executionAdmitted =
    args.recovering && retention.admissions.some((admission) => admission.phase === 'dispatched')
  const onAdmission = async (admission: Parameters<typeof retention.onAdmission>[0]) => {
    if (admission.phase === 'dispatched') executionAdmitted = true
    await retention.onAdmission(admission)
    admitted = true
    args.onPending(true)
  }
  const priorSession = retention.priorSession
  const environmentKey = priorSession?.idempotencyKey ?? `runtime:${args.executionId}`
  const turnId = `${args.executionId}:turn:0`
  // A new environment that replaces one the provider lost starts from its latest checkpoint, so
  // the re-entered manager keeps its files. An environment that is continued needs none.
  const restore = priorSession === undefined ? retention.restoreWorkspace : undefined
  const material = {
    environment: {
      ...args.options.defaults,
      ...(restore === undefined
        ? {}
        : { workspace: { ...args.options.defaults?.workspace, checkpoint: restore.checkpoint } }),
      profile: args.createProfile,
      idempotencyKey: environmentKey,
      signal,
    },
    turn: { ...selectedTurn, turnId },
    ...(priorSession === undefined
      ? {}
      : {
          existingEnvironmentId: priorSession.environmentId,
          // A new session in the same environment is minted from this invocation's own keys,
          // exactly as a first invocation's is, so a recovery replays the same identity.
          identity: {
            sessionId: retention.newSession
              ? mintRetainedIdentity(environmentKey, turnId).sessionId
              : priorSession.sessionId,
            executionId: mintRetainedIdentity(environmentKey, turnId).executionId,
          },
        }),
  }
  try {
    const admissions = retention.admissions
    const dispatched = [...admissions]
      .reverse()
      .find((admission) => admission.phase === 'dispatched')
    const intent = admissions.find((admission) => admission.phase === 'intent')
    const environmentAdmission = admissions.find((admission) => admission.phase === 'environment')
    // A journaled execution input can precede the first provider admission. In that case
    // no provider call happened: onAdmission(intent) is awaited before create/dispatch.
    // Start with the original execution keys; once any admission exists, validate its intent.
    if (args.recovering && admissions.length > 0) {
      if (!intent) throw new Error('retained provider execution has no original intent')
      try {
        assertRetainedRunReplayMaterial(args.provider, material, intent)
      } catch (error) {
        if (selectedTurn === turn) throw error
        // An older admission may have relied on the create-time profile. Only
        // its exact original material may replay; a new turn uses the profile.
        const original = { ...material, turn: { ...turn, turnId } }
        assertRetainedRunReplayMaterial(args.provider, original, intent)
        material.turn = original.turn
      }
    }
    let handle: RetainedRunHandle
    if (args.recovering && dispatched?.phase === 'dispatched') {
      const reconnected = await reconnectRetainedRun({
        provider: args.provider,
        controlRef: dispatched.controlRef,
      })
      if (!reconnected) throw new Error('retained provider environment is unavailable')
      handle = reconnected
    } else if (args.recovering && environmentAdmission?.phase === 'environment') {
      // Before a new turn dispatches, a reused session still identifies its previous turn.
      // Replay the committed intent rather than mistaking that prior result for this execution.
      let recovered =
        material.existingEnvironmentId !== undefined && intent?.phase === 'intent'
          ? await recoverRetainedRun({
              provider: args.provider,
              admission: intent,
              replay: material,
              onAdmission,
            })
          : await recoverRetainedRun({
              provider: args.provider,
              environmentId: environmentAdmission.environmentId,
              sessionId: environmentAdmission.sessionId,
              executionId: environmentAdmission.executionId,
            })
      if (recovered.outcome === 'unverifiable' && intent?.phase === 'intent') {
        // The environment admission precedes dispatch. Replay the validated original keys
        // when the provider cannot yet identify a session, including a lost dispatch reply.
        recovered = await recoverRetainedRun({
          provider: args.provider,
          admission: intent,
          replay: material,
          onAdmission,
        })
      }
      if (recovered.outcome !== 'recovered')
        throw new Error(`retained provider execution is ${recovered.outcome}`)
      handle = recovered.handle
      await onAdmission({
        phase: 'dispatched',
        controlRef: handle.controlRef,
        idempotencyKey: environmentAdmission.idempotencyKey,
        turnId: environmentAdmission.turnId,
      })
    } else if (args.recovering && intent?.phase === 'intent') {
      const recovered = await recoverRetainedRun({
        provider: args.provider,
        admission: intent,
        replay: material,
        onAdmission,
      })
      if (recovered.outcome !== 'recovered')
        throw new Error(`retained provider execution is ${recovered.outcome}`)
      handle = recovered.handle
    } else {
      if (args.recovering && admissions.length > 0)
        throw new Error('retained provider execution has no durable admission')
      handle = await startRetainedRun({ provider: args.provider, ...material, onAdmission })
    }
    executionAdmitted = true
    args.onRetained(handle)
    args.onPending(true)
    const environment = await args.provider.get?.(handle.controlRef.environmentId)
    if (!environment) throw new Error('retained provider environment is unavailable')
    if (restore !== undefined && !args.recovering) {
      // The provider restores a checkpoint or fails the create; the marker Runtime wrote before
      // the checkpoint is the evidence it did, journaled before the turn's result is judged.
      const found = await verifyWorkspaceMarker(environment, restore.marker, signal)
      await retention.onWorkspaceRestored?.({
        environmentId: environment.id,
        checkpoint: restore.checkpoint,
        ...found,
      })
    }
    const session = exactSession(environment, handle.controlRef).session
    async function* events(): AsyncIterable<AgentEnvironmentEvent | RetainedAwaitingResult> {
      let observationFailure: { error: unknown } | undefined
      // Give an immediately available frame its binding check before reading the exact result.
      // A quiet first read starts the same result read at the next scheduler turn instead.
      let exactResult: Promise<AgentTurnResult> | undefined
      let exactResultSettled = false
      let observedFrames = 0
      let framesAfterResult = 0
      let observationBudgetExceeded = false
      const readExactResult = () => {
        if (exactResult === undefined) {
          exactResult = awaitAbortable(
            Promise.resolve().then(() => handle.result()),
            signal,
          )
          void exactResult.then(
            () => {
              exactResultSettled = true
            },
            () => {
              exactResultSettled = true
            },
          )
        }
        return exactResult
      }
      // One reaction on the exact result for the whole drain, not one per event read. Each read adds its
      // waker here and removes it when the read ends, so a read's event is released with it. A reaction
      // added per read to this run-long promise kept every drained event reachable through Promise.race:
      // on 2026-10-18 free-tier supervisors (whole ~225 KB part states per update) grew to node's 4 GB
      // heap limit within an hour.
      const exactWakers = new Set<() => void>()
      let exactWatched = false
      const onExactResult = (waker: () => void): (() => void) => {
        if (exactResultSettled) {
          waker()
          return () => {}
        }
        exactWakers.add(waker)
        if (!exactWatched) {
          exactWatched = true
          const fire = () => {
            for (const wake of [...exactWakers]) wake()
          }
          void readExactResult().then(fire, fire)
        }
        return () => {
          exactWakers.delete(waker)
        }
      }
      // The last frame that carried a replay position, and whether any frame ended the turn. The
      // SSE contract lets a frame arrive with no position; such a frame does not move the cursor,
      // so this is where a reconnect resumes from.
      let lastReplayPosition: string | undefined
      let sawTerminal = false
      let lastObservedAt = Date.now()
      // When the stream last delivered a new frame; undefined until it delivers one.
      let lastFrameAt: number | undefined
      // The node publishes its wait once per invocation; the row's `since` is when it began.
      let awaitingPublished = false
      const awaitingResult = (since: number): RetainedAwaitingResult => {
        awaitingPublished = true
        return { awaitingResultSince: new Date(since).toISOString() }
      }
      const seenEvents = new Map<string, string>()
      const drain = async function* (
        open: () => AsyncIterable<AgentEnvironmentEvent>,
      ): AsyncGenerator<AgentEnvironmentEvent | RetainedAwaitingResult, boolean> {
        let iterator: AsyncIterator<AgentEnvironmentEvent> | undefined
        let failed = false
        try {
          iterator = open()[Symbol.asyncIterator]()
        } catch (error) {
          if (signal.aborted) throw error
          observationFailure = { error }
          return false
        }
        // A read that lost a race to the awaiting mark stays the stream's next read: a second
        // `next()` would queue behind it and drop the frame it delivers.
        let pendingRead:
          | Promise<{ kind: 'event'; value: IteratorResult<AgentEnvironmentEvent> }>
          | undefined
        try {
          while (true) {
            if (framesAfterResult >= RETAINED_OBSERVATION_BATCH_EVENTS) {
              observationBudgetExceeded = true
              break
            }
            if (observedFrames > 0 && observedFrames % RETAINED_OBSERVATION_BATCH_EVENTS === 0) {
              // Ready iterators can otherwise monopolize the microtask queue and starve the
              // result transport, cancellation, and deadlines. Duplicates count as work too.
              await awaitAbortable(new Promise<void>((resolve) => setImmediate(resolve)), signal)
            }
            let next: IteratorResult<AgentEnvironmentEvent>
            let wake: ReturnType<typeof setImmediate> | undefined
            let grace: ReturnType<typeof setTimeout> | undefined
            let unwatch: (() => void) | undefined
            let clearQuiet: (() => void) | undefined
            try {
              // Give this event read one scheduler turn before an exact result closes a quiet
              // subscription. A stream still owing its terminal frame whose last frame came within
              // RETAINED_TAIL_FLOW_MS keeps reading for the rest of that window; a quiet one closes
              // at once. Ready tails are observed only within the finite work allowance.
              const exactWake = new Promise<{ kind: 'exact-result' }>((resolve) => {
                wake = setImmediate(() => {
                  const close = () => {
                    const flowing =
                      sawTerminal || lastFrameAt === undefined
                        ? 0
                        : RETAINED_TAIL_FLOW_MS - (Date.now() - lastFrameAt)
                    if (flowing <= 0) {
                      resolve({ kind: 'exact-result' })
                      return
                    }
                    grace = setTimeout(() => resolve({ kind: 'exact-result' }), flowing)
                    if (typeof grace.unref === 'function') grace.unref()
                  }
                  unwatch = onExactResult(close)
                })
              })
              pendingRead ??= awaitAbortable(
                Promise.resolve().then(() => iterator!.next()),
                signal,
              ).then((value) => ({ kind: 'event' as const, value }))
              // No new evidence for a while publishes the wait; the read and the result race on.
              const quiet = awaitingPublished
                ? undefined
                : new Promise<{ kind: 'quiet' }>((resolve) => {
                    clearQuiet = armDeadlineTimer(
                      Math.max(
                        0,
                        RETAINED_AWAITING_RESULT_AFTER_MS - (Date.now() - lastObservedAt),
                      ),
                      () => resolve({ kind: 'quiet' }),
                    )
                  })
              const observed = await Promise.race([
                pendingRead,
                exactWake,
                ...(quiet === undefined ? [] : [quiet]),
              ])
              if (observed.kind === 'quiet') {
                yield awaitingResult(lastObservedAt)
                continue
              }
              if (observed.kind === 'exact-result') {
                observationFailure ??= {
                  error: new Error('retained provider stream remained open after its exact result'),
                }
                break
              }
              pendingRead = undefined
              next = observed.value
            } catch (error) {
              if (signal.aborted) throw error
              observationFailure = { error }
              failed = true
              break
            } finally {
              if (wake !== undefined) clearImmediate(wake)
              if (grace !== undefined) clearTimeout(grace)
              unwatch?.()
              clearQuiet?.()
            }
            if (next.done) break
            observedFrames += 1
            if (exactResultSettled) framesAfterResult += 1
            // A received event for another execution must never be accepted as evidence — and
            // it is the PROVIDER's contract that was broken, so it must classify as such (#1204).
            try {
              assertEventBinding(next.value, handle.controlRef)
            } catch (error) {
              throw new RetainedRunProviderContractError(
                error instanceof Error ? error.message : 'provider event bound to another run',
                { code: 'RETAINED_EVENT_BINDING_INVALID', cause: error },
              )
            }
            const identity = extractTransportEventIdentity(next.value)
            const eventId = identity.eventId ?? identity.cursor
            if (eventId !== undefined) {
              const digest = canonicalCandidateDigest({
                type: next.value.type,
                data: next.value.data,
                ...(next.value.usage === undefined ? {} : { usage: next.value.usage }),
                ...(next.value.normalized === undefined
                  ? {}
                  : { normalized: next.value.normalized }),
              })
              const prior = seenEvents.get(eventId)
              if (prior !== undefined) {
                if (prior !== digest) {
                  throw new RetainedRunProviderContractError(
                    `provider replay changed retained event ${eventId}`,
                    { code: 'RETAINED_EVENT_DUPLICATE_CHANGED' },
                  )
                }
                continue
              }
              seenEvents.set(eventId, digest)
            }
            // A replayed frame is not progress. Only new evidence extends the silence bound;
            // otherwise a provider repeating one cursor could keep a finished turn open forever.
            lastObservedAt = Date.now()
            lastFrameAt = lastObservedAt
            if (identity.cursor !== undefined) lastReplayPosition = identity.cursor
            else if (eventId !== undefined) lastReplayPosition = eventId
            const terminal = isTerminalEnvironmentEvent(next.value)
            if (terminal) sawTerminal = true
            readExactResult()
            yield next.value
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
      const completed = yield* drain(() =>
        session.events({ executionId: handle.controlRef.executionId, signal }),
      )
      if (!completed && !sawTerminal && lastReplayPosition !== undefined) {
        // The live stream broke before the terminal receipt. That receipt is where a Sandbox
        // execution reports its token usage, and the exact result read below does not carry it,
        // so a break here used to settle a 15-minute turn at 0 tokens with tokensKnown: false,
        // which the conserved pool debits as nothing. Measured on
        // mech-interp-foundations-pi-20260915k turn 1 (926 s, 0/0) and -20260915l turns 2 and 3
        // (1693 s and 846 s, 0/0), each cut by one frame the provider refused mid-stream. The
        // provider replays from a cursor, so resume once from the last replay position. A second
        // failure keeps the first as the recorded cause; it is the one that lost the frames.
        const firstFailure = observationFailure
        observationFailure = undefined
        const resumed = yield* drain(() =>
          session.events({
            executionId: handle.controlRef.executionId,
            since: lastReplayPosition,
            signal,
          }),
        )
        if (!resumed) observationFailure = firstFailure
      }
      if (observationBudgetExceeded) {
        // Preserve a definite exact-result error instead of masking it as observation loss.
        await readExactResult()
        // A result does not prove that unobserved queued frames were bound or non-refusals.
        // Preserve the original admission rather than accepting success at an arbitrary cut.
        throw new RetainedExecutionPendingError(
          new Error(
            `retained provider observation exceeded ${RETAINED_OBSERVATION_BATCH_EVENTS} frames after its exact result`,
          ),
          'unobservable',
        )
      }
      if (!sawTerminal && observationFailure === undefined) {
        observationFailure = {
          error: new Error('retained provider stream did not yield a terminal event'),
        }
      }
      // Observation failure does not establish execution failure. Only the exact retained
      // result can settle the invocation; retain incomplete observation beside that result.
      // A stream that ended short is not an end: the node waits on the provider's exact result
      // for as long as the provider takes, and only the turn's signal ends that wait sooner.
      // The Sandbox SDK builds that result by replaying the execution's events, and a replay that
      // closes short returns `success: false`, "Agent stream ended without a terminal event", with
      // no error code. Runtime cannot tell that from the execution's own failure, so it settles as
      // failed; 64 of the 82 C1 attempts (2026-10-12..20) ended there. The SDK owns that verdict.
      if (!sawTerminal && !exactResultSettled && !awaitingPublished) {
        yield awaitingResult(Date.now())
      }
      let result: AgentTurnResult
      try {
        result = await readExactResult()
      } catch (error) {
        if (signal.aborted) throw error
        if (observationFailure === undefined) throw error
        throw new AggregateError(
          [observationFailure.error, error],
          `retained event observation failed (${observationFailureText(observationFailure)}) and its exact result could not be reconciled`,
          { cause: error },
        )
      }
      yield {
        type: 'result',
        data: {
          finalText: result.text,
          success: result.success,
          ...(result.error ? { error: result.error } : {}),
          usageMode: 'cumulative',
          ...(observationFailure === undefined
            ? {}
            : {
                eventStreamComplete: false,
                ...(result.usage === undefined ? { tokensKnown: false } : {}),
                ...(result.usage?.cost === undefined ? { usdKnown: false } : {}),
                eventStreamError: observationFailureText(observationFailure),
              }),
        },
        ...(result.usage ? { usage: result.usage } : {}),
      }
    }
    return { environment, events: events(), retained: true }
  } catch (error) {
    // A durable dispatch or exact reattachment proves execution admission before observation starts.
    if (admitted)
      throw new RetainedExecutionPendingError(error, executionAdmitted ? 'execution' : 'admission')
    throw error
  }
}

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
