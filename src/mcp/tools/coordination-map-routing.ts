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

export function createMapRouting({
  opts,
  bus,
  admitSpawn,
  profileNameByWorker,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly admitSpawn: (input: SpawnAdmission) => Promise<unknown>
  readonly profileNameByWorker: Map<string, string>
}) {
  // ── Map routes: fan-out over a run-time list, then one join ──
  // A map's items and its join are runtime spawns, like analyst runs: each takes the admission a
  // `spawn_worker` call takes, so the pool, the pre-flight and the pinning authority judge it, and
  // no manager turn is spent starting it.
  const mapRoutes = opts.mapOnSettle ?? []
  interface MapItemSettlement {
    readonly outcome: MapTraversalEvent['outcome']
    readonly result?: unknown
    readonly reason?: string
  }
  interface MapExpansion {
    readonly route: MapOnSettleRoute
    readonly sourceWorker: string
    readonly items: ReadonlyArray<unknown>
    readonly settlements: Array<MapItemSettlement | undefined>
    /** The next index to start. */
    next: number
    inFlight: number
    /** Set by a failed item under all-or-refuse: no further item starts. */
    stopped: boolean
    finished: boolean
  }
  const mapMembers = new Map<
    string,
    {
      readonly expansion: MapExpansion
      readonly role: 'item' | 'join'
      readonly index?: number
      readonly bytes: number
    }
  >()
  const textBytes = (value: unknown): number => Buffer.byteLength(safeJsonText(value), 'utf8')
  const publishMap = async (event: MapTraversalEvent, wake = false): Promise<void> => {
    const record = detachedFrozen<CoordinationEvent>({ type: 'map', map: event })
    if (wake) await bus.publish(record)
    else await bus.publish(record, { queue: false })
  }
  // The run's worker-slot bound, or undefined when only the pool bounds concurrency.
  const workerSlotBound = (): number | undefined => {
    const capacity = (opts.scope as Partial<Scope<unknown>>).workerCapacity
    if (capacity === undefined || capacity.freeSlots === null) return undefined
    return capacity.working + capacity.freeSlots
  }
  const mapSettlement = (settled: Settled<unknown>, worker: SettledWorker): MapItemSettlement => {
    if (settled.kind !== 'done' || worker.status !== 'done') {
      return { outcome: 'failed', reason: worker.status === 'down' ? worker.reason : 'down' }
    }
    if (worker.valid === false) {
      return { outcome: 'failed', reason: 'its deliverable check rejected the result' }
    }
    if (settled.out === undefined) return { outcome: 'empty', reason: 'it settled with no result' }
    return { outcome: 'delivered', result: settled.out }
  }
  const startMapSpawn = async (
    expansion: MapExpansion,
    role: 'item' | 'join',
    profile: AgentProfile,
    task: unknown,
    index: number | undefined,
  ): Promise<{ readonly workerId: string } | { readonly refused: string }> => {
    const { route } = expansion
    const name =
      typeof profile.name === 'string' && profile.name.length > 0 ? profile.name : 'worker'
    let response: unknown
    try {
      response = await admitSpawn({
        profile,
        args: {
          label: index === undefined ? name : `${name}#${index}`,
          ...(role === 'item' && route.itemBudget !== undefined
            ? { budget: route.itemBudget }
            : {}),
        },
        task,
        key: undefined,
        continuity: { continuity: 'fresh' },
        successorOf: undefined,
        preflightProfile: () =>
          opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
        resourcesFromPath: [],
        defaultLabel: name,
        map: Object.freeze({ edge: route.edge, role, ...(index === undefined ? {} : { index }) }),
      })
    } catch (error) {
      return { refused: errMessage(error) }
    }
    const started = response as { readonly workerId?: unknown; readonly reason?: unknown }
    if (typeof started.workerId === 'string') {
      mapMembers.set(started.workerId, {
        expansion,
        role,
        ...(index === undefined ? {} : { index }),
        bytes: textBytes(task),
      })
      return { workerId: started.workerId }
    }
    return { refused: typeof started.reason === 'string' ? started.reason : 'spawn refused' }
  }
  // A graph item starts the way `run_graph` starts a graph: the run prepares the same root profile.
  const mapItemProfile = async (
    route: MapOnSettleRoute,
  ): Promise<{ readonly profile: AgentProfile } | { readonly refused: string }> => {
    if ('profile' in route.item) return { profile: route.item.profile }
    if (!opts.graphs) {
      return { refused: 'a graph item starts through run_graph, which this manager does not serve' }
    }
    const prepared = await opts.graphs.prepare({ graph: route.item.graph })
    return prepared.ok
      ? { profile: detachedFrozen(prepared.profile) }
      : { refused: prepared.reason }
  }
  const startMapItem = async (expansion: MapExpansion, index: number): Promise<void> => {
    const { route } = expansion
    const resolved = await mapItemProfile(route)
    const started =
      'refused' in resolved
        ? resolved
        : await startMapSpawn(expansion, 'item', resolved.profile, expansion.items[index], index)
    if ('workerId' in started) {
      expansion.inFlight += 1
      return
    }
    const reason = `item spawn refused: ${started.refused}`
    expansion.settlements[index] = { outcome: 'unpropagated', reason }
    if (route.onItemFailure === 'all-or-refuse') expansion.stopped = true
    await publishMap({
      edge: route.edge,
      phase: 'item',
      outcome: 'unpropagated',
      sourceWorker: expansion.sourceWorker,
      index,
      bytes: 0,
      reason,
    })
  }
  // Start items until the concurrency cap is reached, the list is exhausted, or all-or-refuse
  // stopped the map; once nothing is in flight, the map finishes.
  const pumpMap = async (expansion: MapExpansion): Promise<void> => {
    const { route, items } = expansion
    while (
      !expansion.stopped &&
      expansion.inFlight < route.concurrency &&
      expansion.next < items.length
    ) {
      const index = expansion.next
      expansion.next += 1
      await startMapItem(expansion, index)
    }
    if (expansion.inFlight === 0) await finishMap(expansion)
  }
  // Every item settled or was never started: record the unstarted ones, then start the join with
  // the ordered results, or refuse it. `closed` names why a manager that already stopped does not
  // run the join; nobody would read it.
  const finishMap = async (expansion: MapExpansion, closed?: string): Promise<void> => {
    if (expansion.finished) return
    expansion.finished = true
    const { route, items, sourceWorker } = expansion
    for (let index = expansion.next; index < items.length; index += 1) {
      const reason = closed ?? 'not started: all-or-refuse stopped this map after an item failed'
      expansion.settlements[index] = { outcome: 'unpropagated', reason }
      await publishMap({
        edge: route.edge,
        phase: 'item',
        outcome: 'unpropagated',
        sourceWorker,
        index,
        bytes: 0,
        reason,
      })
    }
    expansion.next = items.length
    const results: Array<{ index: number; item: unknown; result: unknown }> = []
    const failures: Array<{ index: number; item: unknown; outcome: string; reason: string }> = []
    items.forEach((item, index) => {
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
    const started = await startMapSpawn(expansion, 'join', route.join, task, undefined)
    if ('refused' in started) {
      await publishMap(
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
  // A map item or join settled. `advance` is false once the manager stopped: no further item or
  // join starts, and what never started is recorded as such.
  const settleMapMember = async (
    settled: Settled<unknown>,
    worker: SettledWorker,
    advance: boolean,
  ): Promise<void> => {
    const member = mapMembers.get(worker.id)
    if (member === undefined) return
    mapMembers.delete(worker.id)
    const { expansion, role, index, bytes } = member
    const settlement = mapSettlement(settled, worker)
    await publishMap({
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
    if (advance) await pumpMap(expansion)
    else if (expansion.inFlight === 0) {
      await finishMap(expansion, 'not started: the manager stopped before this map finished')
    }
  }
  // A source settled `done`: expand every map that names it.
  const expandMaps = async (settled: Settled<unknown>, worker: SettledWorker): Promise<void> => {
    if (settled.kind !== 'done' || mapRoutes.length === 0) return
    const name = profileNameByWorker.get(worker.id)
    for (const route of mapRoutes) {
      if (route.from !== name) continue
      const refuse = (reason: string): Promise<void> =>
        publishMap(
          {
            edge: route.edge,
            phase: 'expand',
            outcome: 'unpropagated',
            sourceWorker: worker.id,
            bytes: 0,
            reason,
          },
          true,
        )
      const selected = resolveJsonPointer(settled.out, route.pointer)
      if (!selected.found) {
        await refuse(
          `pointer ${JSON.stringify(route.pointer)} does not resolve in the source result: ${selected.reason}; no item ran`,
        )
        continue
      }
      const items = selected.value
      if (!Array.isArray(items)) {
        await refuse(
          `pointer ${JSON.stringify(route.pointer)} resolves to ${items === null ? 'null' : typeof items}, not an array; no item ran`,
        )
        continue
      }
      if (items.length > route.maxItems) {
        await refuse(
          `max-items-exceeded: the list holds ${items.length} items and this map admits at most ${route.maxItems}; no item ran`,
        )
        continue
      }
      const slots = workerSlotBound()
      if (slots !== undefined && route.concurrency > slots) {
        await refuse(
          `concurrency-unsatisfiable: concurrency ${route.concurrency} exceeds this run's ${slots} worker slots, so the cap could never be honored; no item ran`,
        )
        continue
      }
      await publishMap({
        edge: route.edge,
        phase: 'expand',
        outcome: items.length === 0 ? 'empty' : 'delivered',
        sourceWorker: worker.id,
        bytes: textBytes(items),
        items: items.length,
        ...(items.length === 0
          ? { reason: 'the list is empty; the join runs with no results' }
          : {}),
      })
      await pumpMap({
        route,
        sourceWorker: worker.id,
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
  const runMapStep = async (step: () => Promise<void>, worker: SettledWorker): Promise<void> => {
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

  return {
    isItem: (workerId: string) => mapMembers.get(workerId)?.role === 'item',
    settleMapMember,
    expandMaps,
    runMapStep,
  }
}

/** Resolve an RFC 6901 JSON pointer (`''` is the whole document). */
function resolveJsonPointer(
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
