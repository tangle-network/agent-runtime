import { RuntimeRunStateError } from '../../errors'
import type { BudgetPool } from './budget'
import {
  type LifecycleNoWinnerReason,
  type SpawnedEvent,
  uncertainSpawnBudgets,
} from './supervisor-replay'
import type { Scope, SpawnEvent, SpawnJournal, Spend, SupervisorOpts, TreeView } from './types'

export interface IntensityBreaker {
  recordDown(at: number): void
  tripped(): boolean
  downCount(): number
}

export function createIntensityBreaker(opts: SupervisorOpts, trip: () => void): IntensityBreaker {
  const max = opts.maxRestarts
  const within = opts.withinMs
  const armed = max !== undefined && within !== undefined
  const recent: number[] = []
  let total = 0
  let isTripped = false
  return {
    recordDown(at): void {
      total += 1
      if (!armed || isTripped) return
      recent.push(at)
      const cutoff = at - within
      while (recent.length > 0 && recent[0]! < cutoff) recent.shift()
      if (recent.length > max) {
        isTripped = true
        trip()
      }
    },
    tripped: () => isTripped,
    downCount: () => total,
  }
}

export function wrapJournalForBreaker(
  journal: SpawnJournal,
  breaker: IntensityBreaker,
): SpawnJournal {
  return {
    loadTree: (root) => journal.loadTree(root),
    beginTree: (root, at) => journal.beginTree(root, at),
    appendEvent: (root, event: SpawnEvent) => {
      if (event.kind === 'settled' && event.status === 'down') {
        breaker.recordDown(Date.parse(event.at))
      }
      return journal.appendEvent(root, event)
    },
  }
}

export async function drainLiveChildren(
  scope: Scope<unknown>,
  controller: AbortController,
): Promise<void> {
  const view = scope.view
  const hasLive = view.inFlight > 0 || view.waiting > 0
  if (!hasLive) {
    if (scope.workerCapacity.live > 0) {
      throw new RuntimeRunStateError(
        `supervisor: cleanup ended with ${scope.workerCapacity.live} executor resource(s) not confirmed destroyed`,
      )
    }
    return
  }
  if (!controller.signal.aborted) controller.abort()
  await drainCursor(scope)
  const after = scope.view
  if (after.inFlight > 0 || after.waiting > 0 || scope.workerCapacity.live > 0) {
    throw new RuntimeRunStateError(
      `supervisor: cleanup ended with ${after.inFlight} running, ${after.waiting} waiting, and ${scope.workerCapacity.live} executor resource(s) not confirmed destroyed`,
    )
  }
}

async function drainCursor(scope: Scope<unknown>): Promise<void> {
  for (;;) {
    const settled = await scope.next()
    if (settled === null) return
  }
}

export async function runAbortable<T>(act: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw supervisorAbortError(signal)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(supervisorAbortError(signal))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    let work: Promise<T>
    try {
      work = Promise.resolve(act())
    } catch (error) {
      cleanup()
      reject(error)
      return
    }
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

export function supervisorAbortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.length > 0
        ? reason
        : reason === undefined
          ? 'supervisor aborted'
          : String(reason),
    reason instanceof Error ? { cause: reason } : undefined,
  )
  error.name = 'AbortError'
  return error
}

export function classifyNoWinner(
  controller: AbortController,
  pool: BudgetPool,
  opts: SupervisorOpts,
  breaker: IntensityBreaker,
  deadlineExceeded: boolean,
  tree: TreeView,
): LifecycleNoWinnerReason | undefined {
  if (breaker.tripped()) return 'all-children-down'
  if (deadlineExceeded) return 'budget-exhausted'
  if (controller.signal.aborted) return 'aborted'
  if (allSpawnedChildrenDown(tree)) return 'all-children-down'
  if (poolExhausted(pool, opts)) return 'budget-exhausted'
  if (breaker.downCount() > 0) return 'all-children-down'
  return undefined
}

function allSpawnedChildrenDown(tree: TreeView): boolean {
  const children = tree.nodes.filter((node) => node.id !== tree.root)
  return children.length > 0 && children.every((node) => node.status === 'failed')
}

function poolExhausted(pool: BudgetPool, opts: SupervisorOpts): boolean {
  const readout = pool.readout()
  if (readout.iterationsLeft <= 0 || readout.tokensLeft <= 0) return true
  if (opts.budget.maxUsd !== undefined && readout.usdLeft <= 0) return true
  return (
    opts.budget.deadlineMs !== undefined &&
    readout.deadlineMs > 0 &&
    (opts.now ?? Date.now)() >= readout.deadlineMs
  )
}

export async function spentFromJournal(
  journal: SpawnJournal,
  root: string,
): Promise<{ childWork: Spend; driverInference: Spend }> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new RuntimeRunStateError(
      `supervisor: spawn tree '${root}' is missing from the journal after run (corrupted log)`,
    )
  }
  return sumSpendFromEvents(events)
}

export function sumSpendFromEvents(events: SpawnEvent[]): {
  childWork: Spend
  driverInference: Spend
} {
  const totals = sumMeasuredSpendFromEvents(events)
  const rootBudget = events.find(
    (event): event is SpawnedEvent => event.kind === 'spawned' && event.parent === undefined,
  )?.budget
  let remainingRootUsd = Math.max(
    0,
    (rootBudget?.maxUsd ?? 0) - totals.childWork.usd - totals.driverInference.usd,
  )
  for (const budget of uncertainSpawnBudgets(events)) {
    totals.childWork.iterations += budget.maxIterations
    totals.childWork.tokens.input += budget.maxTokens
    totals.childWork.tokensKnown = false
    const usdCharge = budget.maxUsd ?? (rootBudget?.maxUsd !== undefined ? remainingRootUsd : 0)
    totals.childWork.usd += usdCharge
    totals.childWork.usdKnown = false
    remainingRootUsd = Math.max(0, remainingRootUsd - usdCharge)
  }
  return totals
}

export function sumMeasuredSpendFromEvents(events: SpawnEvent[]): {
  childWork: Spend
  driverInference: Spend
} {
  const childWork: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  const driverInference: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  for (const event of events) {
    if (event.kind === 'settled') accumulate(childWork, event.spent)
    else if (event.kind === 'metered') accumulate(driverInference, event.spend)
  }
  return { childWork, driverInference }
}

function accumulate(a: Spend, b: Spend): void {
  a.iterations += b.iterations
  a.tokens.input += b.tokens.input
  a.tokens.output += b.tokens.output
  if (b.tokensKnown === false) a.tokensKnown = false
  a.usd += b.usd
  if (b.usdKnown === false) a.usdKnown = false
  a.ms += b.ms
}

export function addSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output },
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: a.usd + b.usd,
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ms: a.ms + b.ms,
  }
}

export function isNonEmptySpend(s: Spend): boolean {
  return (
    s.iterations > 0 ||
    s.tokens.input > 0 ||
    s.tokens.output > 0 ||
    s.usd > 0 ||
    s.ms > 0 ||
    s.tokensKnown === false ||
    s.usdKnown === false
  )
}
