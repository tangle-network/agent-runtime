import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { stopRetainedNativeExecution } from '../retained-native-stop'
import type { RetainedRunEnvironmentAdmission } from '../retained-run-types'
import { addSpend, zeroSpend } from '../util'
import { assertValidSpend } from './budget'
import { errMessage, errorText } from './error-message'
import { executorFailureReason } from './executor-outcome'
import {
  executorEvidenceWriter,
  type RetainedExecutionPendingError,
  type RetainedWorkspaceRestore,
  type RetainedWorkspaceRestoreReceipt,
} from './retained-executor'
import {
  continuedEnvironment,
  restoreBefore,
  restoreCapable,
} from './retained-owner-environment-recovery'
import {
  abandonInputAdmittedIntoDebt,
  reconcileOwnerWorkspaceBeforeReuse,
  retryOwnerEvidence,
  unusableEnvironmentIds,
} from './retained-owner-evidence'
import { type OwnerRegistration, type OwnerState, owners } from './retained-owner-state'
import { ownerCaptureWriter, preemptRotationCaptures } from './retained-owner-turn-lifecycle'
import { detachedSnapshot } from './snapshot'
import { traceRootWriter } from './trace-root'
import type { ExecutorResult, Scope, SpawnEvent } from './types'

/** The scope owns these writers; provider adapters receive only the restricted context. */
export function registerScopeRetainedOwner(scope: Scope<unknown>, args: OwnerRegistration): void {
  const events = args.priorEvents.filter((event) => 'id' in event && event.id === args.nodeId)
  const taskEvent = [...events].reverse().find((event) => event.kind === 'execution-input')
  const start = taskEvent === undefined ? 0 : events.indexOf(taskEvent)
  const attempt = events.slice(start)
  const admissions = attempt.flatMap((event) =>
    event.kind === 'execution-admitted' ? [event.admission] : [],
  )
  const acceptedRef = [...attempt].reverse().find((event) => event.kind === 'execution-result')
  const priorSession = taskEvent === undefined ? undefined : committedSession(events, start)
  let sequence = Math.max(0, ...events.map((event) => ('seq' in event ? event.seq : 0)))
  const traceRoots = traceRootWriter(args.blobs, args.nodeId)
  const state: OwnerState = {
    args,
    admissions,
    workspaceRetention: false,
    nextSequence: () => ++sequence,
    ...(taskEvent?.kind === 'execution-input'
      ? { taskRef: taskEvent.taskRef, inputSequence: taskEvent.seq }
      : {}),
    ...(acceptedRef?.kind === 'execution-result' ? { acceptedRef } : {}),
    ...(priorSession ? { priorSession } : {}),
    context: {
      get executionId() {
        if (state.inputSequence === undefined)
          throw new ValidationError('retained owner input was not committed')
        return `${args.nodeId}:input:${state.inputSequence}`
      },
      get priorSession() {
        return state.priorSession
      },
      get newSession() {
        return state.freshSessions === true && state.priorSession !== undefined
      },
      // The first retained turn must stay alive so a later deliberate invocation can reuse it.
      // The owning scope releases it once the complete manager scope finishes.
      preserveEnvironment: true,
      admissions,
      get restoreWorkspace() {
        return state.restore
      },
      onWorkspaceRestored: async (receipt: RetainedWorkspaceRestoreReceipt) => {
        await args.journal.appendEvent(args.rootId, {
          kind: 'workspace-restored',
          id: args.nodeId,
          provider: receipt.checkpoint.provider,
          environmentId: receipt.environmentId,
          checkpointId: receipt.checkpoint.checkpointId,
          sourceEnvironmentId: receipt.checkpoint.source.environmentId,
          verified: receipt.verified,
          ...(receipt.detail === undefined ? {} : { detail: receipt.detail }),
          seq: state.nextSequence(),
          at: new Date(args.now()).toISOString(),
        })
      },
      onAdmission: async (admission) => {
        scope.signal.throwIfAborted()
        const prior = admissions.find((record) => record.phase === admission.phase)
        if (prior !== undefined) {
          if (contentAddress(prior) !== contentAddress(admission)) {
            throw new ValidationError('retained owner admission conflicts with its committed phase')
          }
          return
        }
        await args.journal.appendEvent(args.rootId, {
          kind: 'execution-admitted',
          id: args.nodeId,
          admission: detachedSnapshot(admission, 'retained owner admission'),
          seq: ++sequence,
          at: new Date(args.now()).toISOString(),
        })
        scope.signal.throwIfAborted()
        admissions.push(detachedSnapshot(admission, 'retained owner admission'))
      },
      onEvidence: executorEvidenceWriter({
        journal: args.journal,
        blobs: args.blobs,
        rootId: args.rootId,
        nodeId: args.nodeId,
        nextSequence: () => state.nextSequence(),
        now: args.now,
        traceRoots,
      }),
      onWorkspaceCapture: (capture) => ownerCaptureWriter(state).onWorkspaceCapture(capture),
      // The turn's own capture goes first: it cuts short the captures a checkpoint rotation runs.
      onWorkspaceCaptureStarted: (capture) => {
        preemptRotationCaptures(state)
        return ownerCaptureWriter(state).onWorkspaceCaptureStarted(capture)
      },
      onEndOfTurnWork: (work) => {
        // The handed-over work starts with the turn's final session copy, before its workspace
        // capture: on test-acceptance-canary-20261019m (Runtime 0.331.0) that copy ran 77 s beside
        // a rotation capture, which ran to its 120 s bound, so the capture started 77.8 s after the
        // turn ended. The rotation yields when the turn ends, not when its capture starts.
        preemptRotationCaptures(state)
        const prior = state.turnEnd
        const settled = work.catch(() => undefined)
        state.turnEnd = prior === undefined ? settled : Promise.all([prior, settled]).then(() => {})
      },
      onResult: async (result) => {
        scope.signal.throwIfAborted()
        assertValidSpend(result.spent, 'retained owner result')
        executorFailureReason(result)
        const outRef = contentAddress(result.out)
        await args.blobs.put(outRef, result.out)
        scope.signal.throwIfAborted()
        // The abort is decided once the result is stored. Hashing the completed turn's events
        // decides nothing, so an abort that arrives while they hash still commits the result.
        const traceRoot = await traceRoots.write(outRef, result.out)
        const event: Extract<SpawnEvent, { kind: 'execution-result' }> = {
          kind: 'execution-result',
          id: args.nodeId,
          outRef,
          ...(traceRoot === undefined ? {} : { traceRoot }),
          spent: detachedSnapshot(result.spent, 'retained owner spend'),
          ...(result.verdict ? { verdict: result.verdict } : {}),
          ...(result.outcome ? { outcome: result.outcome } : {}),
          seq: ++sequence,
          at: new Date(args.now()).toISOString(),
        }
        await args.journal.appendEvent(args.rootId, event)
        state.acceptedRef = event
        state.accepted = detachedSnapshot(result, 'retained owner result')
        state.acceptedConsumed = true
      },
    },
  }
  owners.set(scope, state)
}

/**
 * The environment admission an invocation that starts at `before` continues in: that of the
 * latest earlier invocation with a committed result, looking past invocations Runtime abandoned,
 * which never committed one. A live process keeps the same session across an abandonment, so a
 * resumed one must derive it the same way or its replay of the next invocation would not match
 * the material that invocation admitted.
 */
function committedSession(
  events: readonly SpawnEvent[],
  before: number,
): RetainedRunEnvironmentAdmission | undefined {
  let end = before
  for (;;) {
    const head = events.slice(0, end)
    const input = [...head].reverse().find((event) => event.kind === 'execution-input')
    if (input === undefined) return undefined
    const start = head.indexOf(input)
    const attempt = head.slice(start)
    const result = [...attempt].reverse().find((event) => event.kind === 'execution-result')
    if (result !== undefined) {
      return attempt
        .slice(0, attempt.indexOf(result))
        .reverse()
        .flatMap((event) =>
          event.kind === 'execution-admitted' && event.admission.phase === 'environment'
            ? [event.admission]
            : [],
        )[0]
    }
    if (!attempt.some((event) => event.kind === 'execution-abandoned')) return undefined
    end = start
  }
}

/** Bounds the stop Runtime asks for before abandoning a dispatched invocation. */
const ABANDON_STOP_TIMEOUT_MS = 30_000

/**
 * Abandon the owner's in-flight invocation, which the driver retry loop asks for when the same
 * reconciliation keeps failing the same way (`DriverRetryRun.resolvePending`).
 *
 * Runtime stops the invocation at the provider when it had dispatched, then journals what the
 * provider confirmed. The journal refuses every later admission or result of the invocation, so
 * only the replacement the next {@link prepareScopeRetainedOwnerTask} starts can commit a result.
 * Answers `false`, journaling nothing, when this owner has no unfinished invocation to abandon.
 */
export async function abandonScopeRetainedOwnerInvocation(
  scope: Scope<unknown>,
  failure: RetainedExecutionPendingError,
  failures: number,
): Promise<boolean> {
  const state = owners.get(scope)
  if (state === undefined || state.inputSequence === undefined) return false
  const { args } = state
  const owned = ((await args.journal.loadTree(args.rootId)) ?? []).filter(
    (event) => event.id === args.nodeId,
  )
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput?.kind !== 'execution-input' || latestInput.seq !== state.inputSequence)
    return false
  const attempt = owned.slice(owned.indexOf(latestInput))
  if (
    attempt.some(
      (event) => event.kind === 'execution-result' || event.kind === 'execution-abandoned',
    )
  )
    return false
  const dispatched = [...attempt]
    .reverse()
    .flatMap((event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'dispatched'
        ? [event.admission]
        : [],
    )[0]
  const stop =
    dispatched === undefined || state.provider === undefined
      ? undefined
      : await stopRetainedNativeExecution({
          provider: state.provider,
          controlRef: dispatched.controlRef,
          signal: AbortSignal.any([scope.signal, AbortSignal.timeout(ABANDON_STOP_TIMEOUT_MS)]),
          now: args.now,
        })
  scope.signal.throwIfAborted()
  const stopped = stop?.effect === 'cancelled' || stop?.effect === 'not_live'
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-abandoned',
    id: args.nodeId,
    inputSeq: latestInput.seq,
    pendingCause: failure.pendingCause,
    failures,
    detail: errorText(errMessage(failure)).slice(0, 2_048),
    outcome: stopped ? 'stopped' : 'uncertain',
    ...(stop === undefined
      ? {}
      : {
          stop: {
            executionId: stop.executionId,
            effect: stop.effect,
            ...(stop.error === undefined ? {} : { error: stop.error }),
          },
        }),
    seq: state.nextSequence(),
    at: new Date(args.now()).toISOString(),
  })
  return true
}

/** Resume the original backend prompt; rebuilt coordination observations cannot replace it.
 *  `session: 'fresh'` makes every invocation after the first start a new harness session in the
 *  environment it continues. */
export async function prepareScopeRetainedOwnerTask(
  scope: Scope<unknown>,
  task: unknown,
  session: 'native' | 'fresh' = 'native',
): Promise<unknown> {
  const state = owners.get(scope)
  if (!state) return task
  const { args } = state
  state.freshSessions = session === 'fresh'
  scope.signal.throwIfAborted()
  const journal = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = journal.filter((event) => event.id === args.nodeId)
  // A restarted supervisor resumes the capture retries of evidence this node may still owe.
  if (owned.some((event) => event.kind === 'evidence-pending')) retryOwnerEvidence(state)
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  if (latestInput?.kind === 'execution-input') {
    const attempt = owned.slice(owned.indexOf(latestInput))
    state.taskRef = latestInput.taskRef
    state.inputSequence = latestInput.seq
    state.admissions.splice(
      0,
      state.admissions.length,
      ...attempt.flatMap((event) => (event.kind === 'execution-admitted' ? [event.admission] : [])),
    )
    const accepted = [...attempt].reverse().find((event) => event.kind === 'execution-result')
    if (accepted?.kind === 'execution-result') state.acceptedRef = accepted
  }
  // Older coordinators could admit the next input before the previous capture finished.
  // Recovery must not dispatch that pending input over an uncertified historical workspace.
  if (state.taskRef !== undefined && state.acceptedRef === undefined) {
    const indebted = await reconcileOwnerWorkspaceBeforeReuse(state, scope.signal)
    await abandonInputAdmittedIntoDebt(state, indebted)
  }
  const unusable = unusableEnvironmentIds(owned)
  const inFlight = continuedEnvironment(owned)
  if (inFlight?.inFlight && unusable.has(inFlight.admission.environmentId)) {
    // An in-flight invocation in an absent or terminal environment cannot be recovered, and
    // nothing is left running to pay for twice. The next drive is a new invocation.
    delete state.inputSequence
    delete state.taskRef
    state.admissions.length = 0
    delete state.priorSession
  }
  if (
    latestInput?.kind === 'execution-input' &&
    state.inputSequence === latestInput.seq &&
    owned.slice(owned.indexOf(latestInput)).some((event) => event.kind === 'execution-abandoned')
  ) {
    // Nothing of an abandoned invocation is recovered. The next drive is a new invocation in the
    // session the abandoned one continued, and the journal admits its input.
    delete state.inputSequence
    delete state.taskRef
    state.admissions.length = 0
  }
  if (state.prepared && state.acceptedRef && state.acceptedConsumed) {
    await reconcileOwnerWorkspaceBeforeReuse(state, scope.signal)
    const currentEnvironment = [...state.admissions]
      .reverse()
      .find((admission) => admission.phase === 'environment')
    if (currentEnvironment?.phase === 'environment') state.priorSession = currentEnvironment
    delete state.inputSequence
    delete state.taskRef
    delete state.acceptedRef
    delete state.accepted
    // A deliberate later drive starts a distinct invocation after an accepted result.
    state.admissions.length = 0
    delete state.acceptedConsumed
  }
  // A later invocation never reuses an environment the provider confirmed unusable.
  if (state.priorSession !== undefined && unusable.has(state.priorSession.environmentId)) {
    delete state.priorSession
  }
  const segmentStarts = owned.filter(
    (event): event is Extract<SpawnEvent, { kind: 'seat-segment' }> =>
      event.kind === 'seat-segment' && event.phase === 'started',
  )
  const latestSeat = segmentStarts.at(-1)
  const previousSeat = segmentStarts.at(-2)
  if (
    latestSeat &&
    previousSeat &&
    latestSeat.provider !== previousSeat.provider &&
    owned.indexOf(latestSeat) > owned.indexOf(latestInput as SpawnEvent)
  ) {
    // A coordinator that died after recording the new segment but before dispatch still starts
    // a fresh native session from the committed checkpoint, never the old provider's session.
    state.forceNewSession = true
  }
  const rootSegment = owned
    .filter(
      (event): event is Extract<SpawnEvent, { kind: 'root-segment' }> =>
        event.kind === 'root-segment',
    )
    .at(-1)
  if (
    rootSegment?.from !== undefined &&
    rootSegment.from.harness !== rootSegment.to.harness &&
    owned.indexOf(rootSegment) > owned.indexOf(latestInput as SpawnEvent)
  ) {
    // A root resumed in another harness: a native session of one harness cannot continue in
    // another. An in-flight turn of the old harness is still recovered as it committed; every
    // invocation after it starts a new session, from the latest checkpoint when the provider holds
    // one, exactly as a seat that changed provider does.
    state.forceNewSession = true
  }
  if (state.forceNewSession) {
    delete state.priorSession
    delete state.forceNewSession
  }
  state.prepared = true
  // The invocation's restore point is fixed by the journal before its input, so a recovered
  // invocation replays the same create it committed.
  const capable = await restoreCapable(state.provider)
  const restoreFor = (inputIndex: number): RetainedWorkspaceRestore | undefined => {
    if (!capable || state.priorSession !== undefined) return undefined
    const point = restoreBefore(owned, inputIndex)
    return point === undefined
      ? undefined
      : {
          checkpoint: point.checkpoint,
          ...(point.marker === undefined ? {} : { marker: point.marker }),
        }
  }
  if (state.taskRef !== undefined) {
    const original = await args.blobs.get(state.taskRef)
    if (original === undefined || contentAddress(original) !== state.taskRef) {
      throw new ValidationError('retained owner task is missing or corrupt')
    }
    const inputIndex = owned.findIndex(
      (event) => event.kind === 'execution-input' && event.seq === state.inputSequence,
    )
    const restore = restoreFor(inputIndex)
    if (restore === undefined) delete state.restore
    else state.restore = restore
    return original
  }
  const restore = restoreFor(-1)
  if (restore === undefined) delete state.restore
  else state.restore = restore
  const snapshot = detachedSnapshot(task, 'retained owner task')
  const taskRef = contentAddress(snapshot)
  await args.blobs.put(taskRef, snapshot)
  scope.signal.throwIfAborted()
  const inputSequence = state.nextSequence()
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-input',
    id: args.nodeId,
    taskRef,
    ...(state.workspaceRetention ? { workspaceRetention: true } : {}),
    seq: inputSequence,
    at: new Date(args.now()).toISOString(),
  })
  state.taskRef = taskRef
  state.inputSequence = inputSequence
  return snapshot
}

/** Accepted backend output remains evidence, never the supervisor's finalized output. */
export async function scopeRetainedOwnerResult(
  scope: Scope<unknown>,
): Promise<ExecutorResult<unknown> | undefined> {
  const state = owners.get(scope)
  if (!state?.acceptedRef) return undefined
  if (state.accepted) return state.accepted
  const event = state.acceptedRef
  const out = await state.args.blobs.get(event.outRef)
  if (out === undefined || contentAddress(out) !== event.outRef) {
    throw new ValidationError('retained owner result is missing or corrupt')
  }
  assertValidSpend(event.spent, 'replayed retained owner result')
  return {
    outRef: event.outRef,
    out,
    spent: event.spent,
    ...(event.verdict ? { verdict: event.verdict } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
  }
}

export async function scopeRetainedOwnerPriorSpend(scope: Scope<unknown>) {
  const state = owners.get(scope)
  if (!state) return zeroSpend()
  const events = ((await state.args.journal.loadTree(state.args.rootId)) ?? []).filter(
    (event) => event.id === state.args.nodeId,
  )
  const input = [...events].reverse().find((event) => event.kind === 'execution-input')
  if (!input) return zeroSpend()
  return events
    .slice(events.indexOf(input))
    .reduce(
      (total, event) => (event.kind === 'metered' ? addSpend(total, event.spend) : total),
      zeroSpend(),
    )
}

/** Called only after the scope verifies the accepted invocation's materialization. */
export function consumeScopeRetainedOwnerResult(scope: Scope<unknown>): void {
  const state = owners.get(scope)
  if (!state?.acceptedRef) throw new ValidationError('retained owner has no accepted result')
  state.acceptedConsumed = true
}
