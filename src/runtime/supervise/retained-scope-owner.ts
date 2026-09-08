import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import type { RetainedRunAdmission } from '../retained-run-types'
import { addSpend, zeroSpend } from '../util'
import { assertValidSpend } from './budget'
import { executorFailureReason } from './executor-outcome'
import type { RetainedExecutorContext } from './retained-executor'
import { detachedSnapshot } from './snapshot'
import type {
  ExecutorResult,
  NodeId,
  ResultBlobStore,
  Scope,
  SpawnEvent,
  SpawnJournal,
} from './types'

interface OwnerState {
  readonly admissions: RetainedRunAdmission[]
  readonly context: RetainedExecutorContext
  readonly args: OwnerRegistration
  inputSequence?: number
  prepared?: boolean
  acceptedConsumed?: boolean
  nextSequence: () => number
  taskRef?: string
  accepted?: ExecutorResult<unknown>
  acceptedRef?: Extract<SpawnEvent, { kind: 'execution-result' }>
}
interface OwnerRegistration {
  readonly rootId: NodeId
  readonly nodeId: NodeId
  readonly journal: SpawnJournal
  readonly blobs: ResultBlobStore
  readonly priorEvents: readonly SpawnEvent[]
  readonly now: () => number
}
const owners = new WeakMap<object, OwnerState>()

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
  let sequence = Math.max(0, ...events.map((event) => ('seq' in event ? event.seq : 0)))
  const state: OwnerState = {
    args,
    admissions,
    nextSequence: () => ++sequence,
    ...(taskEvent?.kind === 'execution-input'
      ? { taskRef: taskEvent.taskRef, inputSequence: taskEvent.seq }
      : {}),
    ...(acceptedRef?.kind === 'execution-result' ? { acceptedRef } : {}),
    context: {
      get executionId() {
        if (state.inputSequence === undefined)
          throw new ValidationError('retained owner input was not committed')
        return `${args.nodeId}:input:${state.inputSequence}`
      },
      admissions,
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
      onResult: async (result) => {
        scope.signal.throwIfAborted()
        assertValidSpend(result.spent, 'retained owner result')
        executorFailureReason(result)
        const outRef = contentAddress(result.out)
        await args.blobs.put(outRef, result.out)
        scope.signal.throwIfAborted()
        const event: Extract<SpawnEvent, { kind: 'execution-result' }> = {
          kind: 'execution-result',
          id: args.nodeId,
          outRef,
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

export function scopeRetainedOwnerContext(
  scope: Scope<unknown>,
): RetainedExecutorContext | undefined {
  return owners.get(scope)?.context
}

/** Resume the original backend prompt; rebuilt coordination observations cannot replace it. */
export async function prepareScopeRetainedOwnerTask(
  scope: Scope<unknown>,
  task: unknown,
): Promise<unknown> {
  const state = owners.get(scope)
  if (!state) return task
  const { args } = state
  scope.signal.throwIfAborted()
  const journal = (await args.journal.loadTree(args.rootId)) ?? []
  const owned = journal.filter((event) => event.id === args.nodeId)
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
  if (state.prepared && state.acceptedRef && state.acceptedConsumed) {
    delete state.inputSequence
    delete state.taskRef
    delete state.acceptedRef
    delete state.accepted
    // A deliberate later drive starts a distinct invocation after an accepted result.
    state.admissions.length = 0
    delete state.acceptedConsumed
  }
  state.prepared = true
  if (state.taskRef !== undefined) {
    const original = await args.blobs.get(state.taskRef)
    if (original === undefined || contentAddress(original) !== state.taskRef) {
      throw new ValidationError('retained owner task is missing or corrupt')
    }
    return original
  }
  const snapshot = detachedSnapshot(task, 'retained owner task')
  const taskRef = contentAddress(snapshot)
  await args.blobs.put(taskRef, snapshot)
  scope.signal.throwIfAborted()
  const inputSequence = state.nextSequence()
  await args.journal.appendEvent(args.rootId, {
    kind: 'execution-input',
    id: args.nodeId,
    taskRef,
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
