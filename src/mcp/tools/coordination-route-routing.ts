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
  RouteFlow,
  RouteFlowEvent,
  RouteGate,
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
export function createRouteRouting(deps: RouteDeps) {
  const flow = deps.opts.routeFlow
  const routesFrom = new Map<string, RouteOnSettleEdge[]>()
  for (const edge of flow?.routes ?? []) {
    for (const from of edge.from) routesFrom.set(from, [...(routesFrom.get(from) ?? []), edge])
  }
  const state: FlowState = {
    ...deps,
    flow,
    flowNodes: new Set(flow?.nodes ?? []),
    terminals: new Set(flow?.terminals ?? []),
    gates: new Map((flow?.gates ?? []).map((gate) => [gate.id, gate])),
    // How many times the run reached each gate: the `visit` a decision is asked and journaled under.
    visits: new Map(),
    routesFrom,
    // The latest usable result of every flow node: what a match and a task's evidence read.
    latest: new Map(),
    // Fired traversals per edge: what the cap judges and what each route spawn's key counts.
    fired: new Map(),
    // Per join edge, the members that settled usably since it last fired.
    joined: new Map(),
    // Flow workers still running, by node: a route into one of them is refused as `target-live`.
    live: new Map(),
    // The latest settled worker of each flow node, live or replayed from the journal: the
    // predecessor a routes edge names when it spawns that node again.
    settledWorker: new Map(),
    ended: false,
    started: undefined,
  }
  return {
    start: () => start(state),
    route: (settled: Settled<unknown>, worker: SettledWorker) => route(state, settled, worker),
    endInDoubt: (node: string, source: string) => endInDoubt(state, node, source),
  }
}

type RouteDeps = {
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
}

/** The flow state one manager owns; every function below reads and writes it by reference. */
type FlowState = RouteDeps & {
  readonly flow: RouteFlow | undefined
  readonly flowNodes: Set<string>
  readonly terminals: Set<string>
  readonly gates: Map<string, RouteGate>
  readonly visits: Map<string, number>
  readonly routesFrom: Map<string, RouteOnSettleEdge[]>
  readonly latest: Map<string, unknown>
  readonly fired: Map<string, number>
  readonly joined: Map<string, Set<string>>
  readonly live: Map<string, Set<string>>
  readonly settledWorker: Map<string, string>
  ended: boolean
  started: Promise<void> | undefined
}

type RouteTargets = Extract<RouteOnSettleEdge['to'], { readonly nodes: unknown }>['nodes']
type CommittedStep = { readonly workerId: string; readonly node: string }

const textBytes = (value: unknown): number => Buffer.byteLength(safeJsonText(value), 'utf8')

const setLive = ({ live }: FlowState, node: string, workerId: string): void => {
  live.set(node, (live.get(node) ?? new Set()).add(workerId))
}

const publish = ({ bus }: FlowState, event: RouteFlowEvent): Promise<void> =>
  bus
    .publish(detachedFrozen<CoordinationEvent>({ type: 'route', route: event }), { queue: false })
    .then(() => undefined)

async function end(state: FlowState, event: RouteFlowEvent, reason: string): Promise<void> {
  state.ended = true
  await publish(state, event)
  state.stop(reason)
}

async function spawnNode(
  state: FlowState,
  marker: RouteSpawnMarker,
  profile: AgentProfile,
  task: unknown,
  key: string,
  continuity: Exclude<ResolvedContinuity, { readonly error: string }>,
): Promise<RuntimeSpawnOutcome> {
  const { opts } = state
  const spawned = await admitRuntimeSpawn(state.admitSpawn, {
    profile,
    args: { label: marker.node },
    task,
    key,
    continuity,
    // A back edge re-spawns a node that already settled in this flow; the new worker succeeds it.
    successorOf: state.settledWorker.get(marker.node),
    preflightProfile: () =>
      opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
    resourcesFromPath: [],
    defaultLabel: marker.node,
    route: Object.freeze({ ...marker }),
  })
  // A committed spawn is no running worker: a later route into its node is not `target-live`.
  if ('workerId' in spawned && !spawned.committed) setLive(state, marker.node, spawned.workerId)
  return spawned
}

// A spawn whose key is in doubt twice: the flow cannot tell whether that step is still running,
// so it ends. A manager with no flow (a map of a root-driven graph) records the refusal only.
async function endInDoubt(state: FlowState, node: string, source: string): Promise<void> {
  if (state.flow === undefined || state.ended) return
  await end(
    state,
    { kind: 'stopped', at: node, workerId: source, reason: `in-doubt:${node}` },
    `flow in-doubt:${node}`,
  )
}

const refusal = (spawned: RuntimeSpawnOutcome): string =>
  'refused' in spawned ? spawned.refused : 'in-doubt'

/** Settle the committed steps a spawn loop collected, stopping once the flow has ended. */
async function settleCommittedSteps(
  state: FlowState,
  committed: ReadonlyArray<CommittedStep>,
): Promise<void> {
  for (const step of committed) {
    if (state.ended) return
    await state.settleCommitted(step.workerId, step.node)
  }
}

// Every entry at once, each with its own task, under its own key. Committed entries settle once
// every entry is spawned, the order in which their live settles would arrive at the earliest.
function start(state: FlowState): Promise<void> {
  state.started ??= (async () => {
    const committed: CommittedStep[] = []
    for (const entry of state.flow?.entries ?? []) {
      const spawned = await spawnNode(
        state,
        { edge: entry.edge, node: entry.node },
        entry.profile,
        entry.task,
        entry.key,
        { continuity: 'fresh' },
      )
      if ('inDoubt' in spawned) {
        await endInDoubt(state, entry.node, 'entry')
        return
      }
      if ('workerId' in spawned && spawned.committed) {
        committed.push({ workerId: spawned.workerId, node: entry.node })
      }
      await publish(state, {
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
    await settleCommittedSteps(state, committed)
  })()
  return state.started
}

function matches({ latest }: FlowState, match: RouteMatch, from: string): boolean {
  const node = match.node ?? from
  if (!latest.has(node)) return false
  const selected = resolveJsonPointer(latest.get(node), match.pointer)
  if ('exists' in match) return selected.found === match.exists
  if (!selected.found) return false
  if ('equals' in match) return selected.value === match.equals
  return match.in.some((value) => value === selected.value)
}

const holds = (state: FlowState, when: RouteWhen | undefined, from: string): boolean =>
  when === undefined ||
  ('all' in when
    ? when.all.every((match) => matches(state, match, from))
    : matches(state, when, from))

const targetName = (to: RouteOnSettleEdge['to']): string =>
  'nodes' in to
    ? to.nodes.map((target) => target.node).join('+')
    : 'gate' in to
      ? to.gate
      : 'stop' in to
        ? `stop:${to.stop}`
        : `finish:${to.finish}`

/** One fired edge: its identity on every traversal row it publishes. */
type Firing = {
  readonly edge: RouteOnSettleEdge
  readonly node: string
  readonly source: string
  readonly result: unknown
  readonly row: {
    readonly kind: 'traversal'
    readonly edge: string
    readonly from: string
    readonly sourceWorker: string
  }
}

// A node's settle names its worker; a gate's decision names `gate:<id>#<visit>`.
async function fire(
  state: FlowState,
  edge: RouteOnSettleEdge,
  node: string,
  source: string,
  result: unknown,
): Promise<void> {
  const traversal = (state.fired.get(edge.edge) ?? 0) + 1
  state.fired.set(edge.edge, traversal)
  const from = edge.from.join('+')
  const row = { kind: 'traversal' as const, edge: edge.edge, from, sourceWorker: source }
  const firing: Firing = { edge, node, source, result, row }
  if ('stop' in edge.to) {
    await publish(state, {
      ...row,
      to: `stop:${edge.to.stop}`,
      outcome: 'delivered',
      continuity: 'fresh',
      bytes: textBytes(result),
    })
    await end(
      state,
      { kind: 'stopped', edge: edge.edge, at: node, workerId: source, reason: edge.to.stop },
      `route ${edge.edge}: ${edge.to.stop}`,
    )
    return
  }
  if ('finish' in edge.to) {
    await publish(state, {
      ...row,
      to: `finish:${edge.to.finish}`,
      outcome: 'delivered',
      continuity: 'fresh',
      bytes: textBytes(result),
    })
    await publish(state, { kind: 'output', node, workerId: source, result, edge: edge.edge })
    return
  }
  // The members of a join ride its evidence beside the nodes the edge lists.
  const evidence: Record<string, unknown> = {}
  for (const id of [...(edge.from.length > 1 ? edge.from : []), ...edge.evidence]) {
    if (state.latest.has(id)) evidence[id] = state.latest.get(id)
  }
  if ('gate' in edge.to) {
    const reached = { [node]: result, ...evidence }
    await publish(state, {
      ...row,
      to: edge.to.gate,
      outcome: 'delivered',
      continuity: 'fresh',
      bytes: textBytes(reached),
    })
    await decide(state, edge.to.gate, reached)
    return
  }
  await fireNodes(state, firing, edge.to.nodes, traversal, evidence)
}

/** Spawn the nodes a fired edge targets: one, or every branch of a fork. */
async function fireNodes(
  state: FlowState,
  { edge, node, source, result, row }: Firing,
  targets: RouteTargets,
  traversal: number,
  evidence: Record<string, unknown>,
): Promise<void> {
  // Converging branches use a join: a second spawn of a running node would race the first.
  const busy = targets.find((target) => (state.live.get(target.node)?.size ?? 0) > 0)
  if (busy !== undefined) {
    await end(
      state,
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
  const fork = targets.length > 1
  const committed: CommittedStep[] = []
  for (const target of targets) {
    // A resume edge re-attaches to the target's latest settled session; a target that never
    // settled starts fresh, as a delegates edge's declared resume does.
    const resolved =
      edge.continuity === 'resume'
        ? state.resolveContinuity('resume', target.node, undefined)
        : { continuity: 'fresh' as const }
    const continuity =
      'error' in resolved && resolved.error === 'resume-no-prior'
        ? { continuity: 'fresh' as const }
        : resolved
    const spawned =
      'error' in continuity
        ? { refused: `${continuity.error}: ${continuity.hint}` }
        : await spawnNode(
            state,
            { edge: edge.edge, node: target.node },
            target.profile,
            task,
            fork
              ? `route:${edge.edge}#${traversal}:${target.node}`
              : `route:${edge.edge}#${traversal}`,
            continuity,
          )
    if ('inDoubt' in spawned) {
      await endInDoubt(state, target.node, source)
      return
    }
    if ('workerId' in spawned && spawned.committed) {
      committed.push({ workerId: spawned.workerId, node: target.node })
    }
    await publish(state, {
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
  await settleCommittedSteps(state, committed)
}

async function routeSettle(
  state: FlowState,
  settled: Settled<unknown>,
  worker: SettledWorker,
): Promise<void> {
  if (state.ended) return
  const node = state.nodeOf(worker.id)
  if (node === undefined || !state.flowNodes.has(node)) return
  state.live.get(node)?.delete(worker.id)
  state.settledWorker.set(node, worker.id)
  const settlement = workerSettlement(settled, worker)
  if (worker.status === 'down' || settled.kind !== 'done') {
    const reason = `down: ${settlement.reason ?? 'down'}`
    await end(state, { kind: 'stopped', at: node, workerId: worker.id, reason }, `flow ${reason}`)
    return
  }
  const edges = state.routesFrom.get(node) ?? []
  if (settlement.outcome !== 'delivered') {
    // A terminal's unusable settle is simply not output. Anywhere else the flow cannot go on, so
    // it ends exactly as a down settle does: no edge, and the run is `all-children-down`.
    if (edges.length === 0) return
    const reason = `unusable: ${settlement.reason ?? 'no usable result'}`
    await end(state, { kind: 'stopped', at: node, workerId: worker.id, reason }, `flow ${reason}`)
    return
  }
  const result = settlement.result
  state.latest.set(node, result)
  if (state.terminals.has(node)) {
    await publish(state, { kind: 'output', node, workerId: worker.id, result })
    return
  }
  await select(state, node, worker.id, result)
}

// Fire the first edge leaving `node` whose `when` holds over its latest result.
async function select(
  state: FlowState,
  node: string,
  source: string,
  result: unknown,
): Promise<void> {
  const edges = state.routesFrom.get(node) ?? []
  for (const edge of edges) {
    if (!holds(state, edge.when, node)) continue
    if (edge.from.length > 1) {
      // A join is the only edge leaving its members: it fires once each has settled since it
      // last fired, and until then this settle simply waits.
      const settled = (state.joined.get(edge.edge) ?? new Set<string>()).add(node)
      state.joined.set(edge.edge, settled)
      if (settled.size < edge.from.length) return
      state.joined.delete(edge.edge)
    }
    if ((state.fired.get(edge.edge) ?? 0) >= edge.maxTraversals) {
      await publish(state, {
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
    await fire(state, edge, node, source, result)
    return
  }
  // A node left only by maps edges is routed by its maps; one with routes edges must match one.
  if (edges.length === 0) return
  await end(
    state,
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
async function decide(
  state: FlowState,
  id: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  const { opts } = state
  const gate = state.gates.get(id)
  if (gate === undefined || opts.decideGate === undefined) {
    throw new Error(`gate '${id}' has no decideGate to ask`)
  }
  const visit = (state.visits.get(id) ?? 0) + 1
  state.visits.set(id, visit)
  const source = `gate:${id}#${visit}`
  const asked = opts.decideGate({
    gate: id,
    visit,
    question: gate.question,
    choices: gate.choices,
    evidence,
  })
  const answer = await untilDeadline(opts, asked)
  if (state.ended || answer === 'aborted') return
  if (answer === 'deadline') {
    const reason = `deadline: gate '${id}' visit ${visit} was not decided`
    await end(state, { kind: 'stopped', at: id, workerId: source, reason }, `flow ${reason}`)
    return
  }
  const decision = gateDecision(answer, gate.choices)
  if (typeof decision === 'string') {
    throw new Error(`decideGate answered gate '${id}' visit ${visit} with ${decision}`)
  }
  const replayed = answer.replayed === true ? { replayed: true } : {}
  await publish(state, {
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
      state,
      { kind: 'stopped', edge: `gate:${id}`, at: id, workerId: source, reason: decision.reason },
      `gate ${id}: ${decision.reason}`,
    )
    return
  }
  const result = { choice: decision.choice, by: decision.by }
  state.latest.set(id, result)
  await select(state, id, source, result)
}

// A gate wait ends with the run: its abort signal, or its absolute deadline when it has one.
function untilDeadline<T>(
  opts: CoordinationToolsOptions,
  asked: Promise<T>,
): Promise<T | 'aborted' | 'deadline'> {
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
async function route(
  state: FlowState,
  settled: Settled<unknown>,
  worker: SettledWorker,
): Promise<void> {
  try {
    await routeSettle(state, settled, worker)
  } catch (error) {
    if (state.ended) return
    await end(
      state,
      {
        kind: 'stopped',
        at: state.nodeOf(worker.id) ?? worker.id,
        workerId: worker.id,
        reason: `route-step-failed: ${errMessage(error)}`,
      },
      `flow route step failed: ${errMessage(error)}`,
    )
  }
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
