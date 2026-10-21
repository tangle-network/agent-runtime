import type { AgentProfile } from '@tangle-network/agent-interface'
import type { Scope, Settled } from '../../runtime'
import { errMessage } from '../../runtime/supervise/error-message'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type {
  CoordinationToolsOptions,
  SettledWorker,
  SpawnAdmission,
} from './coordination-contracts'
import type { CoordinationEvent } from './coordination-events'
import { safeJsonText } from './coordination-json'
import type { MapOnSettleRoute, MapTraversalEvent } from './coordination-map-contracts'
import { admitRuntimeSpawn } from './coordination-runtime-spawn'

interface MapExpansion {
  readonly route: MapOnSettleRoute
  readonly sourceWorker: string
  /** The source node's 1-based done-settle count: its spawns' keys are
   *  `map:<edge>#<expansion>:<index>` and `map:<edge>#<expansion>:join`. */
  readonly expansion: number
  readonly items: ReadonlyArray<unknown>
  readonly settlements: Array<WorkerSettlement | undefined>
  /** The next index to start. */
  next: number
  inFlight: number
  /** Set by a failed item under all-or-refuse: no further item starts. */
  stopped: boolean
  finished: boolean
}

interface MapMember {
  readonly expansion: MapExpansion
  readonly role: 'item' | 'join'
  readonly index?: number
  readonly bytes: number
}

type MapDeps = {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly admitSpawn: (input: SpawnAdmission) => Promise<unknown>
  /** The node a worker of this manager runs, by profile name. */
  readonly nodeOf: (workerId: string) => string | undefined
  /** Run a committed spawn's journaled settle through the live settle path. */
  readonly settleCommitted: (workerId: string, node: string) => Promise<void>
  /** End a flow whose map spawn is in doubt twice, at the node and source worker named. */
  readonly endInDoubt: (node: string, source: string) => Promise<void>
}

/** The map state one manager owns; every function below reads and writes it by reference. */
type MapState = MapDeps & {
  readonly mapRoutes: ReadonlyArray<MapOnSettleRoute>
  readonly mapMembers: Map<string, MapMember>
  readonly liveExpansions: Map<string, number>
}

// ── Map routes: fan-out over a run-time list, then one join ──
// A map's items and its join are runtime spawns, like analyst runs: each takes the admission a
// `spawn_worker` call takes, so the pool, the pre-flight and the pinning authority judge it, and
// no manager turn is spent starting it.
export function createMapRouting(deps: MapDeps) {
  const state: MapState = {
    ...deps,
    mapRoutes: deps.opts.mapOnSettle ?? [],
    mapMembers: new Map(),
    liveExpansions: new Map(),
  }
  return {
    isItem: (workerId: string) => state.mapMembers.get(workerId)?.role === 'item',
    settleMapMember: (settled: Settled<unknown>, worker: SettledWorker, advance: boolean) =>
      settleMapMember(state, settled, worker, advance),
    expandMaps: (settled: Settled<unknown>, worker: SettledWorker) =>
      expandMaps(state, settled, worker),
    runMapStep: (step: () => Promise<void>, worker: SettledWorker) =>
      runMapStep(state, step, worker),
  }
}

const textBytes = (value: unknown): number => Buffer.byteLength(safeJsonText(value), 'utf8')

async function publishMap(
  { bus }: MapState,
  event: MapTraversalEvent,
  wake = false,
): Promise<void> {
  const record = detachedFrozen<CoordinationEvent>({ type: 'map', map: event })
  if (wake) await bus.publish(record)
  else await bus.publish(record, { queue: false })
}

// The run's worker-slot bound, or undefined when only the pool bounds concurrency.
function workerSlotBound({ opts }: MapState): number | undefined {
  const capacity = (opts.scope as Partial<Scope<unknown>>).workerCapacity
  if (capacity === undefined || capacity.freeSlots === null) return undefined
  return capacity.working + capacity.freeSlots
}

// A started spawn is a map member until it settles. A committed one (its key's done settlement
// is on disk from a prior process) settles at once through the live settle path, so a restarted
// manager re-expanding a map runs only the items with no done settlement, then the join once.
// A spawn in doubt twice is refused, and ends a flow.
async function startMapSpawn(
  state: MapState,
  expansion: MapExpansion,
  role: 'item' | 'join',
  profile: AgentProfile,
  task: unknown,
  index: number | undefined,
): Promise<{ readonly workerId: string } | { readonly refused: string }> {
  const { opts } = state
  const { route } = expansion
  const name = typeof profile.name === 'string' && profile.name.length > 0 ? profile.name : 'worker'
  const spawned = await admitRuntimeSpawn(state.admitSpawn, {
    profile,
    args: {
      label: index === undefined ? name : `${name}#${index}`,
      ...(role === 'item' && route.itemBudget !== undefined ? { budget: route.itemBudget } : {}),
    },
    task,
    key: `map:${route.edge}#${expansion.expansion}:${index ?? 'join'}`,
    continuity: { continuity: 'fresh' },
    successorOf: undefined,
    preflightProfile: () =>
      opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
    resourcesFromPath: [],
    defaultLabel: name,
    map: Object.freeze({ edge: route.edge, role, ...(index === undefined ? {} : { index }) }),
  })
  if ('inDoubt' in spawned) {
    await state.endInDoubt(name, expansion.sourceWorker)
    return { refused: `in-doubt:${name}` }
  }
  if ('refused' in spawned) return spawned
  state.mapMembers.set(spawned.workerId, {
    expansion,
    role,
    ...(index === undefined ? {} : { index }),
    bytes: textBytes(task),
  })
  if (role === 'item') expansion.inFlight += 1
  if (spawned.committed) await state.settleCommitted(spawned.workerId, name)
  return { workerId: spawned.workerId }
}

// A graph item starts the way `run_graph` starts a graph: the run prepares the same root profile.
async function mapItemProfile(
  { opts }: MapState,
  route: MapOnSettleRoute,
): Promise<{ readonly profile: AgentProfile } | { readonly refused: string }> {
  if ('profile' in route.item) return { profile: route.item.profile }
  if (!opts.graphs) {
    return { refused: 'a graph item starts through run_graph, which this manager does not serve' }
  }
  const prepared = await opts.graphs.prepare({ graph: route.item.graph })
  return prepared.ok ? { profile: detachedFrozen(prepared.profile) } : { refused: prepared.reason }
}

/** Record an item that never ran, and tell the manager. */
async function recordUnstartedItem(
  state: MapState,
  expansion: MapExpansion,
  index: number,
  reason: string,
): Promise<void> {
  expansion.settlements[index] = { outcome: 'unpropagated', reason }
  await publishMap(state, {
    edge: expansion.route.edge,
    phase: 'item',
    outcome: 'unpropagated',
    sourceWorker: expansion.sourceWorker,
    index,
    bytes: 0,
    reason,
  })
}

async function startMapItem(
  state: MapState,
  expansion: MapExpansion,
  index: number,
): Promise<void> {
  const { route } = expansion
  const resolved = await mapItemProfile(state, route)
  const started =
    'refused' in resolved
      ? resolved
      : await startMapSpawn(
          state,
          expansion,
          'item',
          resolved.profile,
          expansion.items[index],
          index,
        )
  if ('workerId' in started) return
  if (route.onItemFailure === 'all-or-refuse') expansion.stopped = true
  await recordUnstartedItem(state, expansion, index, `item spawn refused: ${started.refused}`)
}

// Start items until the concurrency cap is reached, the list is exhausted, or all-or-refuse
// stopped the map; once nothing is in flight, the map finishes.
async function pumpMap(state: MapState, expansion: MapExpansion): Promise<void> {
  const { route, items } = expansion
  while (
    !expansion.stopped &&
    expansion.inFlight < route.concurrency &&
    expansion.next < items.length
  ) {
    const index = expansion.next
    expansion.next += 1
    await startMapItem(state, expansion, index)
  }
  if (expansion.inFlight === 0) await finishMap(state, expansion)
}

// Every item settled or was never started: record the unstarted ones, then start the join with
// the ordered results, or refuse it. `closed` names why a manager that already stopped does not
// run the join; nobody would read it.
async function finishMap(state: MapState, expansion: MapExpansion, closed?: string): Promise<void> {
  if (expansion.finished) return
  expansion.finished = true
  const { route, items, sourceWorker } = expansion
  for (let index = expansion.next; index < items.length; index += 1) {
    const reason = closed ?? 'not started: all-or-refuse stopped this map after an item failed'
    await recordUnstartedItem(state, expansion, index, reason)
  }
  expansion.next = items.length
  const { results, failures } = collectJoinInputs(expansion)
  const refusal =
    closed ??
    (route.onItemFailure === 'all-or-refuse' && failures.length > 0
      ? `all-or-refuse: ${failures.length} of ${items.length} items did not deliver (${failures
          .map((failure) => `#${failure.index} ${failure.outcome}: ${failure.reason}`)
          .join('; ')}); the join did not run`
      : undefined)
  if (refusal !== undefined) {
    // No settlement follows a refused join, so this event is what wakes the manager.
    await publishMap(
      state,
      {
        edge: route.edge,
        phase: 'join',
        outcome: 'unpropagated',
        sourceWorker,
        bytes: 0,
        reason: refusal,
      },
      closed === undefined,
    )
    return
  }
  const task = { map: route.edge, source: sourceWorker, items: items.length, results, failures }
  const started = await startMapSpawn(state, expansion, 'join', route.join, task, undefined)
  if ('refused' in started) {
    await publishMap(
      state,
      {
        edge: route.edge,
        phase: 'join',
        outcome: 'unpropagated',
        sourceWorker,
        bytes: 0,
        reason: `join spawn refused: ${started.refused}`,
      },
      true,
    )
  }
  // A started join is recorded when it settles; its outcome is not known before.
}

/** Split an expansion's settlements into the delivered results and the failures, in item order. */
function collectJoinInputs(expansion: MapExpansion) {
  const results: Array<{ index: number; item: unknown; result: unknown }> = []
  const failures: Array<{ index: number; item: unknown; outcome: string; reason: string }> = []
  expansion.items.forEach((item, index) => {
    const settlement = expansion.settlements[index]
    if (settlement?.outcome === 'delivered') {
      results.push({ index, item, result: settlement.result })
    } else {
      failures.push({
        index,
        item,
        outcome: settlement?.outcome ?? 'unpropagated',
        reason: settlement?.reason ?? 'never settled',
      })
    }
  })
  return { results, failures }
}

// A map item or join settled. `advance` is false once the manager stopped: no further item or
// join starts, and what never started is recorded as such.
async function settleMapMember(
  state: MapState,
  settled: Settled<unknown>,
  worker: SettledWorker,
  advance: boolean,
): Promise<void> {
  const member = state.mapMembers.get(worker.id)
  if (member === undefined) return
  state.mapMembers.delete(worker.id)
  const { expansion, role, index, bytes } = member
  const settlement = workerSettlement(settled, worker)
  await publishMap(state, {
    edge: expansion.route.edge,
    phase: role,
    outcome: settlement.outcome,
    sourceWorker: expansion.sourceWorker,
    ...(index === undefined ? {} : { index }),
    workerId: worker.id,
    bytes,
    ...(settlement.reason === undefined ? {} : { reason: settlement.reason }),
  })
  if (role === 'join' || index === undefined) return
  expansion.inFlight -= 1
  expansion.settlements[index] = settlement
  if (settlement.outcome !== 'delivered' && expansion.route.onItemFailure === 'all-or-refuse') {
    expansion.stopped = true
  }
  if (advance) await pumpMap(state, expansion)
  else if (expansion.inFlight === 0) {
    await finishMap(state, expansion, 'not started: the manager stopped before this map finished')
  }
}

// The expansion number of a source's done settle. A settle a prior process committed keeps the
// number it had there (its rank among the resumed done settles of that node), so a replay
// re-derives the keys that process journaled. A new settle counts on past every prior settle and
// every journaled expansion: a root-driven graph replays no prior settle, and its driver may
// label a worker other than by its node.
function expansionOf(state: MapState, source: string, workerId: string): number {
  const resume = state.opts.scope.resume
  const labels = new Map(resume?.view.nodes.map((node) => [node.id, node.label]) ?? [])
  const prior = (resume?.settled ?? [])
    .filter((s) => s.kind === 'done' && labels.get(s.handle.id) === source)
    .map((s) => s.handle.id)
  const rank = prior.indexOf(workerId)
  if (rank >= 0) return rank + 1
  let journaled = 0
  for (const route of state.mapRoutes) {
    if (route.from !== source) continue
    const prefix = `key:map:${route.edge}#`
    for (const node of resume?.view.nodes ?? []) {
      if (!node.assignmentId?.startsWith(prefix)) continue
      const n = Number.parseInt(node.assignmentId.slice(prefix.length), 10)
      if (Number.isSafeInteger(n)) journaled = Math.max(journaled, n)
    }
  }
  const live = (state.liveExpansions.get(source) ?? 0) + 1
  state.liveExpansions.set(source, live)
  return Math.max(prior.length, journaled) + live
}

/** The list a map expands over, or the reason no item runs. */
function resolveMapItems(
  state: MapState,
  out: unknown,
  route: MapOnSettleRoute,
): { readonly items: ReadonlyArray<unknown> } | { readonly refusal: string } {
  const selected = resolveJsonPointer(out, route.pointer)
  if (!selected.found) {
    return {
      refusal: `pointer ${JSON.stringify(route.pointer)} does not resolve in the source result: ${selected.reason}; no item ran`,
    }
  }
  const items = selected.value
  if (!Array.isArray(items)) {
    return {
      refusal: `pointer ${JSON.stringify(route.pointer)} resolves to ${items === null ? 'null' : typeof items}, not an array; no item ran`,
    }
  }
  if (items.length > route.maxItems) {
    return {
      refusal: `max-items-exceeded: the list holds ${items.length} items and this map admits at most ${route.maxItems}; no item ran`,
    }
  }
  const slots = workerSlotBound(state)
  if (slots !== undefined && route.concurrency > slots) {
    return {
      refusal: `concurrency-unsatisfiable: concurrency ${route.concurrency} exceeds this run's ${slots} worker slots, so the cap could never be honored; no item ran`,
    }
  }
  return { items }
}

// A source settled `done`: expand every map that names it.
async function expandMaps(
  state: MapState,
  settled: Settled<unknown>,
  worker: SettledWorker,
): Promise<void> {
  const { mapRoutes } = state
  if (settled.kind !== 'done' || mapRoutes.length === 0) return
  const name = state.nodeOf(worker.id)
  if (name === undefined || !mapRoutes.some((route) => route.from === name)) return
  const expansion = expansionOf(state, name, worker.id)
  for (const route of mapRoutes) {
    if (route.from !== name) continue
    const resolved = resolveMapItems(state, settled.out, route)
    if ('refusal' in resolved) {
      await publishMap(
        state,
        {
          edge: route.edge,
          phase: 'expand',
          outcome: 'unpropagated',
          sourceWorker: worker.id,
          bytes: 0,
          reason: resolved.refusal,
        },
        true,
      )
      continue
    }
    const { items } = resolved
    await publishMap(state, {
      edge: route.edge,
      phase: 'expand',
      outcome: items.length === 0 ? 'empty' : 'delivered',
      sourceWorker: worker.id,
      bytes: textBytes(items),
      items: items.length,
      ...(items.length === 0 ? { reason: 'the list is empty; the join runs with no results' } : {}),
    })
    await pumpMap(state, {
      route,
      sourceWorker: worker.id,
      expansion,
      items: detachedFrozen(items),
      settlements: [],
      next: 0,
      inFlight: 0,
      stopped: false,
      finished: false,
    })
  }
}

// Map steps run on the settlement path, which must never be taken down by them.
async function runMapStep(
  { opts }: MapState,
  step: () => Promise<void>,
  worker: SettledWorker,
): Promise<void> {
  try {
    await step()
  } catch (error) {
    console.error('Runtime map step failed', {
      managerId: opts.scope.view.root,
      worker: worker.id,
      error: errMessage(error),
    })
  }
}

/** What one settle delivered. A settle is usable (`delivered`) when it settled `done`, its
 *  deliverable check did not reject it, and its result is defined; maps and routes both read
 *  results through this one rule. */
interface WorkerSettlement {
  readonly outcome: 'delivered' | 'empty' | 'failed' | 'unpropagated'
  readonly result?: unknown
  readonly reason?: string
}

export function workerSettlement(
  settled: Settled<unknown>,
  worker: SettledWorker,
): WorkerSettlement {
  if (settled.kind !== 'done' || worker.status !== 'done') {
    return { outcome: 'failed', reason: worker.status === 'down' ? worker.reason : 'down' }
  }
  if (worker.valid === false) {
    return { outcome: 'failed', reason: 'its deliverable check rejected the result' }
  }
  if (settled.out === undefined) return { outcome: 'empty', reason: 'it settled with no result' }
  return { outcome: 'delivered', result: settled.out }
}

/** Resolve an RFC 6901 JSON pointer (`''` is the whole document). */
export function resolveJsonPointer(
  document: unknown,
  pointer: string,
):
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false; readonly reason: string } {
  if (pointer === '') return { found: true, value: document }
  if (!pointer.startsWith('/')) {
    return { found: false, reason: 'a JSON pointer is empty or starts with "/"' }
  }
  let value = document
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) >= value.length) {
        return {
          found: false,
          reason: `no index ${JSON.stringify(token)} in an array of ${value.length}`,
        }
      }
      value = value[Number(token)]
    } else if (typeof value === 'object' && value !== null && Object.hasOwn(value, token)) {
      value = (value as Record<string, unknown>)[token]
    } else {
      return { found: false, reason: `no member ${JSON.stringify(token)}` }
    }
  }
  return { found: true, value }
}
