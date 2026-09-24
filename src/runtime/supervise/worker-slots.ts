/**
 * Worker slots: the one bound on how many spawned agents work at the same time.
 *
 * Every scope of a supervised tree draws from one allocator. A host that runs several trees in one
 * process can pass the same allocator to each of them, and the bound then holds across all of them.
 *
 * A spawn past the bound is never refused. It keeps its reserved budget slice and waits in a queue,
 * and it starts when a slot frees. The queue releases the deepest spawn first and then the oldest,
 * so a subtree that is already paid for finishes before the tree grows wider.
 *
 * A slot counts a working agent: a spawned agent that runs with no running child of its own. A
 * manager whose children are all running is waiting on them, so its first running child takes over
 * the manager's slot and the manager takes it back when its last running child ends. This makes
 * nested waits deadlock-free: a manager can always run one child on its own slot, so a queued subtree
 * always keeps a path to completion, whatever the bound and however deep the tree.
 *
 * The bound therefore limits working agents, not environments. The environments alive at one time
 * can exceed it by the number of managers that have a running child. The conserved budget pool and
 * the deadline bound the total work; this allocator only bounds how much of it runs at once.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'

/** A fleet-wide bound on concurrently working agents, with a queue for the spawns past it. */
export interface WorkerSlots {
  /** The bound on working agents, or `undefined` when only the budget bounds concurrency. */
  readonly max: number | undefined
  /** Working agents that hold a slot now. */
  readonly working: number
  /** Spawns that hold a budget slice and wait for a slot. */
  readonly queued: number
}

/**
 * One held or awaited slot. `ready` resolves when the slot is granted; `granted` reads whether it
 * has been. `release` returns the slot, or withdraws a request that is still queued, and is
 * idempotent.
 */
export interface SlotPermit {
  readonly ready: Promise<void>
  readonly granted: boolean
  release(): void
}

/** The children of one scope. A root scope has no owner; a nested scope's owner is the permit its
 *  own manager holds in the parent scope. */
export interface SlotGroup {
  /** Request a slot for one child spawned at `depth`. `force` grants at once past the bound, for
   *  a recovered execution that already runs remotely. */
  acquire(depth: number, options?: { readonly force?: boolean }): SlotPermit
  /** This group's children that hold a slot or a lent slot. */
  readonly running: number
  /** This group's children that wait for a slot. */
  readonly queued: number
}

interface PermitState {
  readonly group: GroupState
  granted: boolean
  released: boolean
  /** Whether this permit is one of the allocator's working units now. False while one of its own
   *  children works on its slot. */
  counted: boolean
  /** The group of this permit's own children, once its scope is open. */
  children?: GroupState
}

interface GroupState {
  readonly owner: PermitState | undefined
  running: number
  queued: number
}

interface Waiter {
  readonly permit: PermitState
  readonly depth: number
  readonly order: number
  readonly grant: () => void
}

interface AllocatorState {
  readonly max: number | undefined
  working: number
  order: number
  readonly waiters: Waiter[]
}

const allocatorStates = new WeakMap<WorkerSlots, AllocatorState>()

/**
 * Create a worker-slot allocator. `max` omitted, `0`, or negative leaves concurrency bounded by the
 * budget alone, and every spawn starts at once. Pass the returned allocator as `workerSlots` to each
 * run that should share one bound.
 */
export function createWorkerSlots(max?: number): WorkerSlots {
  const bound = normalizeWorkerSlotBound(max)
  const state: AllocatorState = { max: bound, working: 0, order: 0, waiters: [] }
  const slots: WorkerSlots = Object.freeze({
    max: bound,
    get working() {
      return state.working
    },
    get queued() {
      return state.waiters.length
    },
  })
  allocatorStates.set(slots, state)
  return slots
}

/** Accept a bound or an allocator; a number creates an allocator for one tree. */
export function resolveWorkerSlots(value: number | WorkerSlots | undefined): WorkerSlots {
  if (value === undefined || typeof value === 'number') return createWorkerSlots(value)
  if (!allocatorStates.has(value)) {
    throw new ValidationError('workerSlots must be a number or an allocator from createWorkerSlots')
  }
  return value
}

/** @internal Open the group of one scope's children. */
export function openSlotGroup(slots: WorkerSlots, owner?: SlotPermit): SlotGroup {
  const state = allocatorStates.get(slots)
  if (state === undefined) {
    throw new ValidationError('openSlotGroup: allocator was not created by createWorkerSlots')
  }
  const issued = owner === undefined ? undefined : (deferredPermits.get(owner)?.() ?? owner)
  const ownerState = issued === undefined ? undefined : permitStates.get(issued)
  if (owner !== undefined && ownerState === undefined) {
    throw new ValidationError('openSlotGroup: owner permit was not issued by this allocator')
  }
  const group: GroupState = { owner: ownerState, running: 0, queued: 0 }
  if (ownerState !== undefined) {
    if (ownerState.children !== undefined) {
      throw new ValidationError('openSlotGroup: a permit owns at most one group of children')
    }
    ownerState.children = group
  }
  return {
    acquire: (depth, options) => acquire(state, group, depth, options?.force === true),
    get running() {
      return group.running
    },
    get queued() {
      return group.queued
    },
  }
}

const permitStates = new WeakMap<SlotPermit, PermitState>()
/** Each deferred permit's reader of the permit it acquired, once it has acquired one. */
const deferredPermits = new WeakMap<SlotPermit, () => SlotPermit | undefined>()

/**
 * @internal A slot requested only once `after` resolves. A spawn that waits for budget takes no
 * slot while it waits, so it cannot hold a slot that the work it waits on needs. `ready` rejects
 * when `after` does; `release` before then withdraws the request.
 */
export function deferSlot(after: Promise<void>, acquire: () => SlotPermit): SlotPermit {
  let inner: SlotPermit | undefined
  let released = false
  const ready = after.then(() => {
    if (released) return
    inner = acquire()
    return inner.ready
  })
  // A spawn that is withdrawn before it awaits `ready` never reads a refusal of `after`.
  ready.catch(() => undefined)
  const handle: SlotPermit = {
    ready,
    get granted() {
      return inner?.granted ?? false
    },
    release() {
      if (released) return
      released = true
      inner?.release()
    },
  }
  deferredPermits.set(handle, () => inner)
  return handle
}

function acquire(
  state: AllocatorState,
  group: GroupState,
  depth: number,
  force: boolean,
): SlotPermit {
  if (!Number.isSafeInteger(depth) || depth < 0) {
    throw new ValidationError(`worker slots: depth must be a non-negative integer, got ${depth}`)
  }
  const permit: PermitState = { group, granted: false, released: false, counted: false }
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const grant = () => {
    grantPermit(state, permit)
    resolveReady()
  }
  if (force || costOf(group) === 0 || hasCapacity(state)) {
    grant()
  } else {
    group.queued += 1
    const waiter: Waiter = { permit, depth, order: state.order++, grant }
    state.waiters.push(waiter)
  }
  const handle: SlotPermit = {
    ready,
    get granted() {
      return permit.granted
    },
    release() {
      if (permit.released) return
      permit.released = true
      if (!permit.granted) {
        withdraw(state, permit)
        return
      }
      releasePermit(state, permit)
      pump(state)
    },
  }
  permitStates.set(handle, permit)
  return handle
}

/** A child of `group` adds a working unit unless its manager is working on its own slot now, in
 *  which case the child takes that slot over. */
function costOf(group: GroupState): 0 | 1 {
  const owner = group.owner
  return owner?.granted && !owner.released && owner.counted ? 0 : 1
}

function hasCapacity(state: AllocatorState): boolean {
  return state.max === undefined || state.working < state.max
}

function grantPermit(state: AllocatorState, permit: PermitState): void {
  const group = permit.group
  if (costOf(group) === 0) {
    group.owner!.counted = false
  } else {
    state.working += 1
  }
  permit.granted = true
  permit.counted = true
  group.running += 1
}

function releasePermit(state: AllocatorState, permit: PermitState): void {
  // A manager that ends while its own children still run keeps its place in the chain of lent
  // slots until the last of them ends; the slot then passes up as if the manager ended then.
  if ((permit.children?.running ?? 0) > 0) return
  const group = permit.group
  group.running -= 1
  if (group.running < 0)
    throw new ValidationError('worker slots: a group released more than it ran')
  if (!permit.counted) return
  permit.counted = false
  const owner = group.owner
  if (group.running === 0 && owner !== undefined && owner.granted) {
    // The manager's last running child ended: the slot returns to the manager.
    owner.counted = true
    if (owner.released) releasePermit(state, owner)
    return
  }
  state.working -= 1
  if (state.working < 0) throw new ValidationError('worker slots: released more than granted')
}

function withdraw(state: AllocatorState, permit: PermitState): void {
  const index = state.waiters.findIndex((waiter) => waiter.permit === permit)
  if (index === -1) return
  state.waiters.splice(index, 1)
  permit.group.queued -= 1
}

/** Grant every waiter that can run: any waiter whose manager is working on its own slot, and then
 *  the deepest and oldest waiters while capacity remains. */
function pump(state: AllocatorState): void {
  for (;;) {
    let chosen: number | undefined
    for (let index = 0; index < state.waiters.length; index++) {
      const waiter = state.waiters[index]!
      if (costOf(waiter.permit.group) === 0) {
        chosen = index
        break
      }
      if (!hasCapacity(state)) continue
      const best = chosen === undefined ? undefined : state.waiters[chosen]!
      if (
        best === undefined ||
        waiter.depth > best.depth ||
        (waiter.depth === best.depth && waiter.order < best.order)
      ) {
        chosen = index
      }
    }
    if (chosen === undefined) return
    const [waiter] = state.waiters.splice(chosen, 1)
    waiter!.permit.group.queued -= 1
    waiter!.grant()
  }
}

function normalizeWorkerSlotBound(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) return undefined
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(
      `workerSlots must be a positive safe integer, or 0 or less for no bound, got ${String(value)}`,
    )
  }
  return value
}
