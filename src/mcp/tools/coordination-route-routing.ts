import type { AgentProfile } from '@tangle-network/agent-interface'
import type { Settled } from '../../runtime'
import { errMessage } from '../../runtime/supervise/error-message'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type {
  CoordinationToolsOptions,
  ResolvedContinuity,
  SettledWorker,
  SpawnAdmission,
} from './coordination-contracts'
import type { CoordinationEvent } from './coordination-events'
import { safeJsonText } from './coordination-json'
import { resolveJsonPointer, workerSettlement } from './coordination-map-routing'
import type { ContinuityMode } from './coordination-messages'
import type {
  RouteFlowEvent,
  RouteMatch,
  RouteOnSettleEdge,
  RouteSpawnMarker,
  RouteWhen,
} from './coordination-route-contracts'

/**
 * The flow scheduler of one manager: entry and route spawns are runtime spawns, like map items.
 * It has two call sites. `start` spawns every entry when the manager's coordination opens, before
 * the manager's first turn, so a manager that makes no tool call still has open work. `route` runs
 * on each settle beside the map expansion and fires at most one edge leaving the settled node; that
 * edge may start several nodes at once (a fork), or wait for several sources (a join).
 */
export function createRouteRouting({
  opts,
  bus,
  admitSpawn,
  resolveContinuity,
  profileNameByWorker,
  stop,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly admitSpawn: (input: SpawnAdmission) => Promise<unknown>
  readonly resolveContinuity: (
    requested: ContinuityMode | undefined,
    profileName: string | undefined,
    key: string | undefined,
  ) => ResolvedContinuity
  readonly profileNameByWorker: ReadonlyMap<string, string>
  /** End the manager: the flow spawns nothing more and the manager takes no further turn. */
  readonly stop: (reason: string) => void
}) {
  const flow = opts.routeFlow
  const flowNodes = new Set(flow?.nodes ?? [])
  const terminals = new Set(flow?.terminals ?? [])
  const routesFrom = new Map<string, RouteOnSettleEdge[]>()
  for (const edge of flow?.routes ?? []) {
    for (const from of edge.from) routesFrom.set(from, [...(routesFrom.get(from) ?? []), edge])
  }
  // The latest usable result of every flow node: what a match and a task's evidence read.
  const latest = new Map<string, unknown>()
  // Fired traversals per edge: what the cap judges and what each route spawn's key counts.
  const fired = new Map<string, number>()
  // Per join edge, the members that settled usably since it last fired.
  const joined = new Map<string, Set<string>>()
  // Flow workers still running, by node: a route into one of them is refused as `target-live`.
  const live = new Map<string, Set<string>>()
  const setLive = (node: string, workerId: string): void => {
    live.set(node, (live.get(node) ?? new Set()).add(workerId))
  }
  let ended = false
  let started: Promise<void> | undefined

  const textBytes = (value: unknown): number => Buffer.byteLength(safeJsonText(value), 'utf8')
  const publish = (event: RouteFlowEvent): Promise<void> =>
    bus
      .publish(detachedFrozen<CoordinationEvent>({ type: 'route', route: event }), { queue: false })
      .then(() => undefined)
  const end = async (event: RouteFlowEvent, reason: string): Promise<void> => {
    ended = true
    await publish(event)
    stop(reason)
  }

  const spawnNode = async (
    marker: RouteSpawnMarker,
    profile: AgentProfile,
    task: unknown,
    key: string,
    continuity: Exclude<ResolvedContinuity, { readonly error: string }>,
  ): Promise<{ readonly workerId: string } | { readonly refused: string }> => {
    let response: unknown
    try {
      response = await admitSpawn({
        profile,
        args: { label: marker.node },
        task,
        key,
        continuity,
        successorOf: undefined,
        preflightProfile: () =>
          opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
        resourcesFromPath: [],
        defaultLabel: marker.node,
        route: Object.freeze({ ...marker }),
      })
    } catch (error) {
      return { refused: errMessage(error) }
    }
    const started = response as { readonly workerId?: unknown; readonly reason?: unknown }
    if (typeof started.workerId === 'string') return { workerId: started.workerId }
    return { refused: typeof started.reason === 'string' ? started.reason : 'spawn refused' }
  }

  // Every entry at once, each with its own task, under its own key.
  const start = (): Promise<void> => {
    started ??= (async () => {
      for (const entry of flow?.entries ?? []) {
        const spawned = await spawnNode(
          { edge: entry.edge, node: entry.node },
          entry.profile,
          entry.task,
          entry.key,
          { continuity: 'fresh' },
        )
        if ('workerId' in spawned) setLive(entry.node, spawned.workerId)
        await publish({
          kind: 'traversal',
          edge: entry.edge,
          from: 'entry',
          to: entry.node,
          outcome: 'workerId' in spawned ? 'delivered' : 'unpropagated',
          continuity: 'fresh',
          bytes: 'workerId' in spawned ? textBytes(entry.task) : 0,
          ...('workerId' in spawned
            ? { workerId: spawned.workerId }
            : { reason: `entry spawn refused: ${spawned.refused}` }),
        })
      }
    })()
    return started
  }

  const matches = (match: RouteMatch, from: string): boolean => {
    const node = match.node ?? from
    if (!latest.has(node)) return false
    const selected = resolveJsonPointer(latest.get(node), match.pointer)
    if ('exists' in match) return selected.found === match.exists
    if (!selected.found) return false
    if ('equals' in match) return selected.value === match.equals
    return match.in.some((value) => value === selected.value)
  }
  const holds = (when: RouteWhen | undefined, from: string): boolean =>
    when === undefined ||
    ('all' in when ? when.all.every((match) => matches(match, from)) : matches(when, from))

  const targetName = (to: RouteOnSettleEdge['to']): string =>
    'nodes' in to
      ? to.nodes.map((target) => target.node).join('+')
      : 'stop' in to
        ? `stop:${to.stop}`
        : `finish:${to.finish}`

  const fire = async (
    edge: RouteOnSettleEdge,
    node: string,
    worker: SettledWorker,
    result: unknown,
  ): Promise<void> => {
    const traversal = (fired.get(edge.edge) ?? 0) + 1
    fired.set(edge.edge, traversal)
    const from = edge.from.join('+')
    const row = { kind: 'traversal' as const, edge: edge.edge, from, sourceWorker: worker.id }
    if ('stop' in edge.to) {
      await publish({
        ...row,
        to: `stop:${edge.to.stop}`,
        outcome: 'delivered',
        continuity: 'fresh',
        bytes: textBytes(result),
      })
      await end(
        { kind: 'stopped', edge: edge.edge, at: node, workerId: worker.id, reason: edge.to.stop },
        `route ${edge.edge}: ${edge.to.stop}`,
      )
      return
    }
    if ('finish' in edge.to) {
      await publish({
        ...row,
        to: `finish:${edge.to.finish}`,
        outcome: 'delivered',
        continuity: 'fresh',
        bytes: textBytes(result),
      })
      await publish({ kind: 'output', node, workerId: worker.id, result, edge: edge.edge })
      return
    }
    // Converging branches use a join: a second spawn of a running node would race the first.
    const busy = edge.to.nodes.find((target) => (live.get(target.node)?.size ?? 0) > 0)
    if (busy !== undefined) {
      await end(
        {
          kind: 'unrouted',
          reason: 'target-live',
          node,
          workerId: worker.id,
          detail: `${edge.edge} fired into '${busy.node}', which still has a running worker`,
          result,
        },
        `flow: ${edge.edge} fired into live node '${busy.node}'`,
      )
      return
    }
    // The members of a join ride its evidence beside the nodes the edge lists.
    const evidence: Record<string, unknown> = {}
    for (const id of [...(edge.from.length > 1 ? edge.from : []), ...edge.evidence]) {
      if (latest.has(id)) evidence[id] = latest.get(id)
    }
    const task = { from: { node, result }, evidence }
    const fork = edge.to.nodes.length > 1
    for (const target of edge.to.nodes) {
      // A resume edge re-attaches to the target's latest settled session; a target that never
      // settled starts fresh, as a delegates edge's declared resume does.
      const resolved =
        edge.continuity === 'resume'
          ? resolveContinuity('resume', target.node, undefined)
          : { continuity: 'fresh' as const }
      const continuity =
        'error' in resolved && resolved.error === 'resume-no-prior'
          ? { continuity: 'fresh' as const }
          : resolved
      const spawned =
        'error' in continuity
          ? { refused: `${continuity.error}: ${continuity.hint}` }
          : await spawnNode(
              { edge: edge.edge, node: target.node },
              target.profile,
              task,
              fork
                ? `route:${edge.edge}#${traversal}:${target.node}`
                : `route:${edge.edge}#${traversal}`,
              continuity,
            )
      if ('workerId' in spawned) setLive(target.node, spawned.workerId)
      await publish({
        ...row,
        to: target.node,
        outcome: 'workerId' in spawned ? 'delivered' : 'unpropagated',
        continuity: 'continuity' in continuity ? continuity.continuity : edge.continuity,
        bytes: 'workerId' in spawned ? textBytes(task) : 0,
        ...('workerId' in spawned
          ? { workerId: spawned.workerId }
          : { reason: `route spawn refused: ${spawned.refused}` }),
      })
    }
  }

  const routeSettle = async (settled: Settled<unknown>, worker: SettledWorker): Promise<void> => {
    if (ended) return
    const node = profileNameByWorker.get(worker.id)
    if (node === undefined || !flowNodes.has(node)) return
    live.get(node)?.delete(worker.id)
    const settlement = workerSettlement(settled, worker)
    if (worker.status === 'down' || settled.kind !== 'done') {
      const reason = `down: ${settlement.reason ?? 'down'}`
      await end({ kind: 'stopped', at: node, workerId: worker.id, reason }, `flow ${reason}`)
      return
    }
    const edges = routesFrom.get(node) ?? []
    if (settlement.outcome !== 'delivered') {
      // A terminal's unusable settle is simply not output. Anywhere else the flow cannot go on, so
      // it ends exactly as a down settle does: no edge, and the run is `all-children-down`.
      if (edges.length === 0) return
      const reason = `unusable: ${settlement.reason ?? 'no usable result'}`
      await end({ kind: 'stopped', at: node, workerId: worker.id, reason }, `flow ${reason}`)
      return
    }
    const result = settlement.result
    latest.set(node, result)
    if (terminals.has(node)) {
      await publish({ kind: 'output', node, workerId: worker.id, result })
      return
    }
    for (const edge of edges) {
      if (!holds(edge.when, node)) continue
      if (edge.from.length > 1) {
        // A join is the only edge leaving its members: it fires once each has settled since it
        // last fired, and until then this settle simply waits.
        const settled = (joined.get(edge.edge) ?? new Set<string>()).add(node)
        joined.set(edge.edge, settled)
        if (settled.size < edge.from.length) return
        joined.delete(edge.edge)
      }
      if ((fired.get(edge.edge) ?? 0) >= edge.maxTraversals) {
        await publish({
          kind: 'traversal',
          edge: edge.edge,
          from: edge.from.join('+'),
          to: targetName(edge.to),
          outcome: 'unpropagated',
          continuity: edge.continuity,
          bytes: 0,
          reason: `traversal-cap-exhausted (max ${edge.maxTraversals})`,
          sourceWorker: worker.id,
        })
        continue
      }
      await fire(edge, node, worker, result)
      return
    }
    // A node left only by maps edges is routed by its maps; one with routes edges must match one.
    if (edges.length === 0) return
    await end(
      {
        kind: 'unrouted',
        reason: 'unrouted',
        node,
        workerId: worker.id,
        detail: `no routes edge leaving '${node}' matched its result`,
        result,
      },
      `flow: no routes edge leaving '${node}' matched`,
    )
  }

  // Route steps run on the settlement path, which they must never take down; a step that throws
  // ends the flow loudly instead of leaving the manager waiting on a spawn that never happens.
  const route = async (settled: Settled<unknown>, worker: SettledWorker): Promise<void> => {
    try {
      await routeSettle(settled, worker)
    } catch (error) {
      if (ended) return
      await end(
        {
          kind: 'stopped',
          at: profileNameByWorker.get(worker.id) ?? worker.id,
          workerId: worker.id,
          reason: `route-step-failed: ${errMessage(error)}`,
        },
        `flow route step failed: ${errMessage(error)}`,
      )
    }
  }

  return { start, route }
}
