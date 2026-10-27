import type { Scope } from '../../runtime'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import { projectEvent } from './coordination-event-projection'
import {
  type AwaitWakeInput,
  type CoordinationEvent,
  type ManagerWake,
  wakeEventKinds,
} from './coordination-events'
import type { ManagerState } from './coordination-manager-state'
import type { createSettlementDrain } from './coordination-settlement-drain'
import type { createWorkerObservation } from './coordination-worker-observation'

// A manager with nothing to do ends its turn, and Runtime waits for it. A bounded poll spent 18 of
// 88 model turns on waiting alone (two Discovery roots); this wait blocks on the bus
// and spends no model turn.

type WaitingEnv = {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly state: ManagerState
  readonly ledger: ReadonlyArray<SettledWorker>
  readonly workers: ReturnType<typeof createWorkerObservation>
  readonly settlements: ReturnType<typeof createSettlementDrain>
  readonly ready: () => Promise<void>
  readonly nodeForWorker: (id: string) => unknown
  readonly leadPublishing: () => number
  readonly openReceiptCount: () => number
}

export function createManagerWaiting(env: WaitingEnv) {
  return {
    ensureDrain: ensureDrain.bind(null, env),
    hasOpenWork: hasOpenWork.bind(null, env),
    awaitWake: awaitWake.bind(null, env),
    awaitSettlement: awaitSettlement.bind(null, env),
  }
}

function ensureDrain({ state, settlements }: WaitingEnv): Promise<boolean> {
  if (!state.inFlightDrain)
    state.inFlightDrain = settlements.drainSettlement().finally(() => {
      state.inFlightDrain = null
    })
  return state.inFlightDrain
}

async function settledWithoutDrain({ state, settlements }: WaitingEnv): Promise<void> {
  // Move children that already settled onto the bus. Only when no blocking drain holds the
  // cursor: that drain publishes whatever it takes itself.
  if (state.inFlightDrain) return
  state.inFlightDrain = (async () => {
    let drained = false
    while (await settlements.drainSettlement('nextResolved')) drained = true
    return drained
  })().finally(() => {
    state.inFlightDrain = null
  })
  await state.inFlightDrain
}

function hasOpenWork(env: WaitingEnv, options?: { readonly includeSettled?: boolean }): boolean {
  const { running, unqueued, queued } = env.workers.openWork()
  const includeSettled = options?.includeSettled !== false
  const queuedWork = includeSettled
    ? queued.length > 0
    : queued.some((record) => record.event.type !== 'settled')
  const pending = includeSettled
    ? env.bus.pending(wakeEventKinds) > 0
    : env.bus
        .queued([...wakeEventKinds, 'question'])
        .some((record) => record.event.type !== 'settled')
  return (
    running.length > 0 ||
    unqueued.length > 0 ||
    queuedWork ||
    pending ||
    env.openReceiptCount() > 0 ||
    env.leadPublishing() > 0 ||
    // A settlement taken from the cursor and still being published, with its analysis.
    env.settlements.isBusy()
  )
}

// Every live worker reports progress and none is stalled; unknown progress counts as stalled.
function liveWorkersProgressing({ workers }: WaitingEnv): boolean {
  const running = workers.openWork().running
  return (
    running.length > 0 && running.every((node) => workers.readProgress(node.id)?.stalled === false)
  )
}

// A question one of this manager's workers raised wakes it: a child manager still working would
// otherwise wait for the heartbeat, or for that child to settle and so never need the answer.
// The manager's own ask_parent is recorded on the same bus and wakes nothing.
const isWorkerQuestion = ({ nodeForWorker }: WaitingEnv, event: CoordinationEvent): boolean =>
  event.type === 'question' && nodeForWorker(event.question.from) !== undefined

const workerQuestionPending = (env: WaitingEnv): boolean =>
  env.bus.queued(['question']).some((record) => isWorkerQuestion(env, record.event))

/** What a finished wait reports: the wake it ended on, beyond the events it will pull. */
type WaitOutcome = {
  readonly outsideWake: boolean
  readonly quietHeartbeats: number
  readonly deadlineAt: number
}

async function awaitWake(env: WaitingEnv, input: AwaitWakeInput): Promise<ManagerWake | undefined> {
  const { bus, state } = env
  const startedAt = Date.now()
  await env.ready()
  await settledWithoutDrain(env)
  if (!hasOpenWork(env) || input.signal.aborted) return undefined
  const waited = await waitForWakeCondition(env, input, startedAt)
  if (waited === undefined) return undefined
  const { outsideWake, quietHeartbeats, deadlineAt } = waited
  const events: Array<Record<string, unknown> & { readonly eventSeq: number }> = []
  const pulledKinds: ReadonlyArray<CoordinationEvent['type']> = workerQuestionPending(env)
    ? [...wakeEventKinds, 'question']
    : wakeEventKinds
  for (let next = bus.pullRecord(pulledKinds); next; next = bus.pullRecord(pulledKinds)) {
    state.deliveries.push({
      record: next,
      attempt: input.attempt ?? state.driverAttempt,
      acknowledged: false,
    })
    events.push({ ...projectEvent(next.event), eventSeq: next.seq })
  }
  if (events.length === 0 && !outsideWake && !hasOpenWork(env)) return undefined
  // A due deadline warning names the wake even when events ride along; otherwise the manager is
  // woken once for the events and again, at once, for the warning.
  const reason =
    Date.now() >= deadlineAt
      ? 'deadline'
      : events.length > 0 || outsideWake
        ? 'events'
        : 'heartbeat'
  if (reason === 'deadline') state.deadlineNoticeDelivered = true
  return detachedFrozen<ManagerWake>({
    reason,
    events,
    live: env.workers.liveSnapshot(),
    freeSlots: env.workers.freeWorkerSlots(),
    idleMs: Date.now() - startedAt,
    ...(quietHeartbeats === 0 ? {} : { quietHeartbeats }),
  })
}

/**
 * Block until an event, the heartbeat, the deadline, an outside wake or an abort. `undefined`
 * means the manager was aborted. A heartbeat with nothing new costs no model turn while every live
 * worker is still making progress: Runtime re-arms it and keeps waiting. magnetar-rust-20261018b
 * spent 58 of its root's 79 turns, about 37% of root spend, on 15-minute wakes that changed
 * nothing. A stalled worker, no live worker, or the deadline still wakes the manager.
 */
async function waitForWakeCondition(
  env: WaitingEnv,
  input: AwaitWakeInput,
  startedAt: number,
): Promise<WaitOutcome | undefined> {
  const { bus, workers } = env
  let quietHeartbeats = 0
  let heartbeatAt = startedAt + Math.max(0, input.heartbeatMs)
  const deadlineAt = input.deadlineAt ?? Number.POSITIVE_INFINITY
  let wakeAt = Math.min(heartbeatAt, deadlineAt)
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  let outsideWake = false
  try {
    const queuedEvent = new Promise<void>((resolve) => {
      // Once the record is pull-visible: a subscriber runs before the record is queued.
      unsubscribe = bus.onQueued((record) => {
        if (
          (wakeEventKinds as ReadonlyArray<string>).includes(record.event.type) ||
          isWorkerQuestion(env, record.event)
        )
          resolve()
      })
    })
    let elapsed: Promise<void> = Promise.resolve()
    const armTimer = (): void => {
      if (timer) clearTimeout(timer)
      elapsed = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, wakeAt - Date.now()))
        // Held: a manager waiting for its workers is live work, and must keep its process up.
      })
    }
    armTimer()
    const aborted = new Promise<void>((resolve) => {
      onAbort = () => resolve()
      input.signal.addEventListener('abort', onAbort, { once: true })
    })
    const outside = (input.alsoWakeOn ?? new Promise<never>(() => undefined)).then(() => {
      outsideWake = true
    })
    // Set once the cursor reports no child it can wait on, so a node it does not drain cannot
    // turn this loop into a spin.
    let cursorIdle = false
    for (;;) {
      while (
        bus.pending(wakeEventKinds) === 0 &&
        !workerQuestionPending(env) &&
        !outsideWake &&
        !input.signal.aborted &&
        Date.now() < wakeAt
      ) {
        const running = !cursorIdle && workers.openWork().running.length > 0
        // A live worker can only reach the bus through the blocking drain. With none live, the
        // open work is a question or a tool outcome, which publishes itself.
        const drained = running ? ensureDrain(env) : new Promise<boolean>(() => undefined)
        const done = await Promise.race([
          drained.then((value) => (value ? 'drained' : 'idle')),
          queuedEvent.then(() => 'queued' as const),
          elapsed.then(() => 'elapsed' as const),
          aborted.then(() => 'aborted' as const),
          outside.then(() => 'outside' as const),
        ])
        if (done === 'idle') {
          cursorIdle = true
          if (!hasOpenWork(env)) break
        }
      }
      if (
        input.quietWhileProgressing === true &&
        input.heartbeatMs > 0 &&
        bus.pending(wakeEventKinds) === 0 &&
        !workerQuestionPending(env) &&
        !outsideWake &&
        !input.signal.aborted &&
        Date.now() >= heartbeatAt &&
        Date.now() < deadlineAt &&
        liveWorkersProgressing(env)
      ) {
        quietHeartbeats += 1
        heartbeatAt = Date.now() + input.heartbeatMs
        wakeAt = Math.min(heartbeatAt, deadlineAt)
        armTimer()
        continue
      }
      break
    }
    if (input.signal.aborted) return undefined
    // A settlement queued mid-flush still has its analysis to publish: let that bounded flush
    // finish, so the settlement and the finding it triggers ride one wake.
    if (env.settlements.isFlushing() && env.state.inFlightDrain !== null) {
      await env.state.inFlightDrain.catch(() => false)
    }
    // Coalesce: whatever else lands within the debounce rides the same wake. Only while other
    // workers still run: with none, nothing else is coming. The debounce never runs past the
    // deadline warning: a 2 s wait there pushed a late settlement past the deadline itself.
    const debounceMs = Math.min(input.debounceMs, Math.max(0, deadlineAt - Date.now()))
    if (
      bus.pending(wakeEventKinds) > 0 &&
      debounceMs > 0 &&
      workers.openWork().running.length > 0
    ) {
      await Promise.race([
        new Promise<void>((resolve) => {
          setTimeout(resolve, debounceMs)
        }),
        aborted,
      ])
      if (input.signal.aborted) return undefined
      await settledWithoutDrain(env)
    }
    return { outsideWake, quietHeartbeats, deadlineAt }
  } finally {
    unsubscribe?.()
    if (timer) clearTimeout(timer)
    if (onAbort) input.signal.removeEventListener('abort', onAbort)
  }
}

async function awaitSettlement(
  env: WaitingEnv,
  workerIds: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<ReadonlyArray<string>> {
  const { opts, ledger } = env
  const wanted = new Set(workerIds)
  const settledIds = () => ledger.filter((worker) => wanted.has(worker.id)).map((w) => w.id)
  await env.ready()
  for (;;) {
    await settledWithoutDrain(env)
    const hit = settledIds()
    if (hit.length > 0) return hit
    signal?.throwIfAborted()
    const live = ((opts.scope as Partial<Scope<unknown>>).view?.nodes ?? []).some(
      (node) => wanted.has(node.id) && isLiveNodeStatus(node.status),
    )
    if (!live) return []
    const drained = await (signal === undefined
      ? ensureDrain(env)
      : Promise.race([
          ensureDrain(env),
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
        ]))
    if (!drained && settledIds().length === 0) return []
  }
}
