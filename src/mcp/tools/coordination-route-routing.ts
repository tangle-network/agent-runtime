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
  GateDecision,
  RouteFlowEvent,
  RouteMatch,
  RouteOnSettleEdge,
  RouteSpawnMarker,
  RouteWhen,
} from './coordination-route-contracts'
import { admitRuntimeSpawn, type RuntimeSpawnOutcome } from './coordination-runtime-spawn'

/**
 * The flow scheduler of one manager: entry and route spawns are runtime spawns, like map items.
 * It has two call sites. `start` spawns every entry when the manager's coordination opens, before
 * the manager's first turn, so a manager that makes no tool call still has open work. `route` runs
 * on each settle beside the map expansion and fires at most one edge leaving the settled node; that
 * edge may start several nodes at once (a fork), or wait for several sources (a join). An edge into
 * a gate awaits `decideGate`, and the decision `{ choice, by }` is routed as the gate's result.
 *
 * Every spawn is keyed, so a restarted manager replays the flow from its spawn journal by walking
 * it again from its entries: a key whose done settlement is on disk comes back committed, and its
 * result takes the live settle path at once through `settleCommitted` (routes, maps, gates); an
 * in-doubt key is re-admitted once under `<key>#2`, and a second in-doubt ends the flow as
 * `in-doubt:<node>`. The walk re-derives every key a prior process used, because each one counts
 * traversals and settles that the replay repeats in the same order.
 */
export function createRouteRouting({
  opts,
  bus,
  admitSpawn,
  resolveContinuity,
  nodeOf,
  settleCommitted,
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
  /** The node a worker of this manager runs, by profile name. */
  readonly nodeOf: (workerId: string) => string | undefined
  /** Run a committed spawn's journaled settle through the live settle path. */
  readonly settleCommitted: (workerId: string, node: string) => Promise<void>
  /** End the manager: the flow spawns nothing more and the manager takes no further turn. */
  readonly stop: (reason: string) => void
}) {
  const flow = opts.routeFlow
  const flowNodes = new Set(flow?.nodes ?? [])
  const terminals = new Set(flow?.terminals ?? [])
  const gates = new Map((flow?.gates ?? []).map((gate) => [gate.id, gate]))
  // How many times the run reached each gate: the `visit` a decision is asked and journaled under.
  const visits = new Map<string, number>()
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
  // The latest settled worker of each flow node, live or replayed from the journal: the
  // predecessor a routes edge names when it spawns that node again.
  const settledWorker = new Map<string, string>()
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
  ): Promise<RuntimeSpawnOutcome> => {
    const spawned = await admitRuntimeSpawn(admitSpawn, {
      profile,
      args: { label: marker.node },
      task,
      key,
      continuity,
      // A back edge re-spawns a node that already settled in this flow; the new worker succeeds it.
      successorOf: settledWorker.get(marker.node),
      preflightProfile: () =>
        opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
      resourcesFromPath: [],
      defaultLabel: marker.node,
      route: Object.freeze({ ...marker }),
    })
    // A committed spawn is no running worker: a later route into its node is not `target-live`.
    if ('workerId' in spawned && !spawned.committed) setLive(marker.node, spawned.workerId)
    return spawned
  }
  // A spawn whose key is in doubt twice: the flow cannot tell whether that step is still running,
  // so it ends. A manager with no flow (a map of a root-driven graph) records the refusal only.
  const endInDoubt = async (node: string, source: string): Promise<void> => {
    if (flow === undefined || ended) return
    await end(
      { kind: 'stopped', at: node, workerId: source, reason: `in-doubt:${node}` },
      `flow in-doubt:${node}`,
    )
  }
  const refusal = (spawned: RuntimeSpawnOutcome): string =>
    'refused' in spawned ? spawned.refused : 'in-doubt'

  // Every entry at once, each with its own task, under its own key. Committed entries settle once
  // every entry is spawned, the order in which their live settles would arrive at the earliest.
  const start = (): Promise<void> => {
    started ??= (async () => {
      const committed: Array<{ readonly workerId: string; readonly node: string }> = []
      for (const entry of flow?.entries ?? []) {
        const spawned = await spawnNode(
          { edge: entry.edge, node: entry.node },
          entry.profile,
          entry.task,
          entry.key,
          { continuity: 'fresh' },
        )
        if ('inDoubt' in spawned) {
          await endInDoubt(entry.node, 'entry')
          return
        }
        if ('workerId' in spawned && spawned.committed) {
          committed.push({ workerId: spawned.workerId, node: entry.node })
        }
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
            : { reason: `entry spawn refused: ${refusal(spawned)}` }),
        })
      }
      for (const step of committed) {
        if (ended) return
        await settleCommitted(step.workerId, step.node)
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
      : 'gate' in to
        ? to.gate
        : 'stop' in to
          ? `stop:${to.stop}`
          : `finish:${to.finish}`

  // A node's settle names its worker; a gate's decision names `gate:<id>#<visit>`.
  const fire = async (
    edge: RouteOnSettleEdge,
    node: string,
    source: string,
    result: unknown,
  ): Promise<void> => {
    const traversal = (fired.get(edge.edge) ?? 0) + 1
    fired.set(edge.edge, traversal)
    const from = edge.from.join('+')
    const row = { kind: 'traversal' as const, edge: edge.edge, from, sourceWorker: source }
    if ('stop' in edge.to) {
      await publish({
        ...row,
        to: `stop:${edge.to.stop}`,
        outcome: 'delivered',
        continuity: 'fresh',
        bytes: textBytes(result),
      })
      await end(
        { kind: 'stopped', edge: edge.edge, at: node, workerId: source, reason: edge.to.stop },
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
      await publish({ kind: 'output', node, workerId: source, result, edge: edge.edge })
      return
    }
    // The members of a join ride its evidence beside the nodes the edge lists.
    const evidence: Record<string, unknown> = {}
    for (const id of [...(edge.from.length > 1 ? edge.from : []), ...edge.evidence]) {
      if (latest.has(id)) evidence[id] = latest.get(id)
    }
    if ('gate' in edge.to) {
      const reached = { [node]: result, ...evidence }
      await publish({
        ...row,
        to: edge.to.gate,
        outcome: 'delivered',
        continuity: 'fresh',
        bytes: textBytes(reached),
      })
      await decide(edge.to.gate, reached)
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
          workerId: source,
          detail: `${edge.edge} fired into '${busy.node}', which still has a running worker`,
          result,
        },
        `flow: ${edge.edge} fired into live node '${busy.node}'`,
      )
      return
    }
    // A join's task names every member in declared order, never the member that happened to
    // settle last: a resume replays members in another order and must derive the same task.
    const task =
      edge.from.length > 1
        ? { from: { nodes: edge.from }, evidence }
        : { from: { node, result }, evidence }
    const fork = edge.to.nodes.length > 1
    const committed: Array<{ readonly workerId: string; readonly node: string }> = []
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
      if ('inDoubt' in spawned) {
        await endInDoubt(target.node, source)
        return
      }
      if ('workerId' in spawned && spawned.committed) {
        committed.push({ workerId: spawned.workerId, node: target.node })
      }
      await publish({
        ...row,
        to: target.node,
        outcome: 'workerId' in spawned ? 'delivered' : 'unpropagated',
        continuity: 'continuity' in continuity ? continuity.continuity : edge.continuity,
        bytes: 'workerId' in spawned ? textBytes(task) : 0,
        ...('workerId' in spawned
          ? { workerId: spawned.workerId }
          : { reason: `route spawn refused: ${refusal(spawned)}` }),
      })
    }
    // A committed target settles after every target of a fork is spawned, as live settles would.
    for (const step of committed) {
      if (ended) return
      await settleCommitted(step.workerId, step.node)
    }
  }

  const routeSettle = async (settled: Settled<unknown>, worker: SettledWorker): Promise<void> => {
    if (ended) return
    const node = nodeOf(worker.id)
    if (node === undefined || !flowNodes.has(node)) return
    live.get(node)?.delete(worker.id)
    settledWorker.set(node, worker.id)
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
    await select(node, worker.id, result)
  }

  // Fire the first edge leaving `node` whose `when` holds over its latest result.
  const select = async (node: string, source: string, result: unknown): Promise<void> => {
    const edges = routesFrom.get(node) ?? []
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
          sourceWorker: source,
        })
        continue
      }
      await fire(edge, node, source, result)
      return
    }
    // A node left only by maps edges is routed by its maps; one with routes edges must match one.
    if (edges.length === 0) return
    await end(
      {
        kind: 'unrouted',
        reason: 'unrouted',
        node,
        workerId: source,
        detail: `no routes edge leaving '${node}' matched its result`,
        result,
      },
      `flow: no routes edge leaving '${node}' matched`,
    )
  }

  // Ask the caller for one gate visit while the process holds the run, then route the decision as
  // the gate's result. The wait counts against the run's deadline: an undecided gate at the
  // deadline ends the flow as a timed-out node does, and an aborted run records nothing.
  const decide = async (id: string, evidence: Record<string, unknown>): Promise<void> => {
    const gate = gates.get(id)
    if (gate === undefined || opts.decideGate === undefined) {
      throw new Error(`gate '${id}' has no decideGate to ask`)
    }
    const visit = (visits.get(id) ?? 0) + 1
    visits.set(id, visit)
    const source = `gate:${id}#${visit}`
    const asked = opts.decideGate({
      gate: id,
      visit,
      question: gate.question,
      choices: gate.choices,
      evidence,
    })
    const answer = await untilDeadline(asked)
    if (ended || answer === 'aborted') return
    if (answer === 'deadline') {
      const reason = `deadline: gate '${id}' visit ${visit} was not decided`
      await end({ kind: 'stopped', at: id, workerId: source, reason }, `flow ${reason}`)
      return
    }
    const decision = gateDecision(answer, gate.choices)
    if (typeof decision === 'string') {
      throw new Error(`decideGate answered gate '${id}' visit ${visit} with ${decision}`)
    }
    const replayed = answer.replayed === true ? { replayed: true } : {}
    await publish({
      kind: 'traversal',
      edge: `gate:${id}`,
      from: id,
      to: decision.kind === 'choose' ? `choice:${decision.choice}` : `stop:${decision.reason}`,
      outcome: 'delivered',
      continuity: 'fresh',
      bytes: textBytes(decision),
      gate:
        decision.kind === 'choose'
          ? { by: decision.by, choice: decision.choice, ...replayed }
          : { by: decision.by, stop: decision.reason, ...replayed },
    })
    if (decision.kind === 'stop') {
      await end(
        { kind: 'stopped', edge: `gate:${id}`, at: id, workerId: source, reason: decision.reason },
        `gate ${id}: ${decision.reason}`,
      )
      return
    }
    const result = { choice: decision.choice, by: decision.by }
    latest.set(id, result)
    await select(id, source, result)
  }

  // A gate wait ends with the run: its abort signal, or its absolute deadline when it has one.
  const untilDeadline = <T>(asked: Promise<T>): Promise<T | 'aborted' | 'deadline'> => {
    const signal = opts.scope.signal
    if (signal.aborted) return Promise.resolve('aborted')
    const deadlineMs = opts.scope.budget.deadlineMs
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = (): void => settle(() => resolve('aborted'))
      const settle = (done: () => void): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        done()
      }
      if (deadlineMs > 0) {
        const left = Math.max(0, deadlineMs - Date.now())
        timer = setTimeout(() => settle(() => resolve('deadline')), left)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      asked.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      )
    })
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
          at: nodeOf(worker.id) ?? worker.id,
          workerId: worker.id,
          reason: `route-step-failed: ${errMessage(error)}`,
        },
        `flow route step failed: ${errMessage(error)}`,
      )
    }
  }

  return { start, route, endInDoubt }
}

/** The caller's decision, checked against the gate's choices, or why it is not one. */
function gateDecision(answer: unknown, choices: ReadonlyArray<string>): GateDecision | string {
  const value = answer as Partial<{ kind: unknown; choice: unknown; reason: unknown; by: unknown }>
  const shown = safeJsonText(answer)
  if (typeof value !== 'object' || value === null || typeof value.by !== 'string' || !value.by) {
    return `${shown} — a decision names who decided in a non-empty by`
  }
  if (value.kind === 'choose' && typeof value.choice === 'string') {
    if (choices.includes(value.choice)) {
      return { kind: 'choose', choice: value.choice, by: value.by }
    }
    return `${shown} — choice is not one of ${choices.join(', ')}`
  }
  if (value.kind === 'stop' && typeof value.reason === 'string' && value.reason.length > 0) {
    return { kind: 'stop', reason: value.reason, by: value.by }
  }
  return `${shown} — expected { kind: 'choose', choice, by } or { kind: 'stop', reason, by }`
}
