/**
 * The engine scheduler (agent-runtime#980): run a compiled graph by hosting every node instance on
 * one kernel `Scope` — the pool, the journal, the blob store and cancellation are the kernel's,
 * never re-implemented. The scheduler owns only what a graph adds: joins over guarded edges,
 * traversal and visit caps, directive/payload delivery, terminals and the finalizer reduce.
 *
 * Edge semantics are adopted from ADC's workflow graph (agent-runtime#968): an edge settles
 * SATISFIED / DEAD / FAILED per its source's LATEST completion; join rules `all | any | any_failed
 * | all_done` decide release; a release CONSUMES the outcomes that produced it (settled edges
 * re-arm; a pending edge at release is consumed-once, so an OR-diamond's second completer never
 * double-fires). Per-edge `maxTraversals` refuses the consumption and ledgers `unpropagated`; a
 * node entered past `maxVisits` fails the run `cycle-budget-exceeded` (#973).
 */
import { contentAddress } from '../../durable/content-address'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { createBudgetPool } from '../supervise/budget'
import {
  bestDelivered,
  collectDelivered,
  type FinalizerSettled,
  runFinalizer,
  type SupervisorFinalizer,
} from '../supervise/finalizer'
import { GraphEdgeCapError } from '../supervise/graph'
import type { PromptRegistry } from '../supervise/prompt-registry'
import { createExecutorRegistry } from '../supervise/runtime'
import { createScope } from '../supervise/scope'
import type { Budget, ResultBlobStore, Settled, SpawnJournal } from '../supervise/types'
import { type CompiledEdge, type CompiledGraph, compileGraph } from './compile'
import { evaluateCondition } from './condition'
import type { EngineGraphSpec } from './definition'
import type { GraphEngine } from './engine'
import { narrowEffects } from './kind'
import { applyProjection } from './projection'

export type GraphRunReason =
  | 'all-children-down'
  | 'budget-exhausted'
  | 'aborted'
  | 'driver-failed'
  | 'cycle-budget-exceeded'
  | 'unreachable-terminal'

/** One node settlement as the graph result reports it. */
export interface GraphNodeSettle {
  readonly node: string
  readonly visit: number
  readonly status: 'done' | 'down'
  /** The node's completion check verdict; `undefined` when the node declares no check. */
  readonly valid?: boolean
  readonly out?: unknown
  readonly outRef?: string
  readonly reason?: string
}

/** One ledgered edge firing (or refusal) — the run's observable data flow. */
export interface GraphEdgeTraversal {
  readonly edge: string
  readonly kind: 'delegates' | 'analyzes' | 'data'
  readonly from: string
  readonly to: string
  readonly traversal: number
  readonly outcome: 'delivered' | 'empty' | 'unpropagated'
  readonly directive?: string
  readonly port?: string
  readonly reason?: string
}

export type GraphRunResult =
  | {
      readonly kind: 'winner'
      readonly out: unknown
      readonly terminals: ReadonlyArray<GraphNodeSettle>
      readonly settles: ReadonlyArray<GraphNodeSettle>
      readonly ledger: ReadonlyArray<GraphEdgeTraversal>
    }
  | {
      readonly kind: 'no-winner'
      readonly reason: GraphRunReason
      readonly error?: { readonly name: string; readonly message: string }
      readonly terminals: ReadonlyArray<GraphNodeSettle>
      readonly settles: ReadonlyArray<GraphNodeSettle>
      readonly ledger: ReadonlyArray<GraphEdgeTraversal>
      /** Nodes provably stuck when the run ended: every upstream settled, no release possible. */
      readonly unreachable: ReadonlyArray<string>
    }

export interface GraphRunOptions {
  /** The run's conserved pool. */
  readonly budget: Budget
  /** Default per-instance reservation for nodes that declare no `budget` of their own.
   *  Required when any such node exists — the engine invents no split. */
  readonly perNode?: Budget
  readonly journal?: SpawnJournal
  readonly blobs?: ResultBlobStore
  /** Resolves `delegates`/`analyzes` directives; required when any edge carries one. */
  readonly prompts?: PromptRegistry
  /** How terminal settles reduce to `out`. Default `bestDelivered`. */
  readonly finalizer?: 'bestDelivered' | 'collectDelivered' | SupervisorFinalizer
  readonly signal?: AbortSignal
  readonly now?: () => number
  readonly runId?: string
}

/** Admission for every value crossing an edge (#971): JSON round-trip, `undefined` stripped, a
 *  non-representable value becomes a RECORD of that fact — a degraded record beats a vanished
 *  edge. */
export function admitPayload(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    // JSON.stringify returns undefined for bare functions/symbols — record, never vanish.
    if (text === undefined) return { nonCanonical: `payload of type ${typeof value}` }
    return JSON.parse(text)
  } catch (error) {
    return { nonCanonical: error instanceof Error ? error.message : String(error) }
  }
}

type EdgeState = 'pending' | 'satisfied' | 'dead' | 'failed'

interface EdgeRuntime {
  readonly edge: CompiledEdge
  state: EdgeState
  /** Set when this edge was pending at a release it fed into: its in-flight completion belongs to
   *  the wave that already fired, so it re-arms without releasing again. */
  consumedOnce: boolean
  traversals: number
  /** The admitted payload of the source completion this state reflects. */
  payload?: unknown
}

interface NodeRuntime {
  visits: number
  live: number
  settles: GraphNodeSettle[]
  /** Latest admitted value per input port, from consumed `data` edges. */
  inputs: Map<string, unknown>
  /** Directive texts consumed by the next entry, in consumption order. */
  directives: string[]
  /** Trace refs delivered by consumed `analyzes` edges. */
  traces: Array<{ readonly node: string; readonly traceRef?: string }>
  blocked: boolean
}

/**
 * Run a graph: host every node instance on one kernel `Scope`, resolve joins over guarded edges,
 * enforce the traversal and visit caps, and reduce the terminal settlements through the finalizer.
 */
export async function runEngineGraph(
  engine: GraphEngine,
  spec: EngineGraphSpec | CompiledGraph,
  task: string,
  options: GraphRunOptions,
): Promise<GraphRunResult> {
  const compiled: CompiledGraph =
    'nodes' in spec && spec.nodes instanceof Map
      ? (spec as CompiledGraph)
      : compileGraph(engine, spec as EngineGraphSpec)
  const context = 'runEngineGraph'
  for (const node of compiled.nodes.values()) {
    const missing = node.kind.effects.filter((name) => !(name in engine.effects))
    if (missing.length > 0) {
      throw new ValidationError(
        `${context}: node ${node.id} needs effect(s) ${missing.join(', ')} the host did not provide`,
      )
    }
    if (node.spec.budget === undefined && options.perNode === undefined) {
      throw new ValidationError(
        `${context}: node ${node.id} declares no budget and options.perNode is absent — the engine invents no split`,
      )
    }
  }
  for (const edge of compiled.edges) {
    if (edge.spec.directive !== undefined && options.prompts === undefined) {
      throw new ValidationError(
        `${context}: edge ${edge.id} carries a directive but options.prompts is absent`,
      )
    }
  }

  const now = options.now ?? Date.now
  const started = now()
  const runId = options.runId ?? `graph:${contentAddress({ task, at: started }).slice(0, 18)}`
  const pool = createBudgetPool(options.budget, () => now() - started)
  const journal = options.journal ?? new InMemorySpawnJournal()
  const blobs = options.blobs ?? new InMemoryResultBlobStore()
  await journal.beginTree(runId, new Date(started).toISOString())
  const abort = new AbortController()
  const onOuterAbort = () => abort.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', onOuterAbort, { once: true })
  if (options.signal?.aborted) abort.abort(options.signal.reason)
  const scope = createScope<unknown>({
    parentId: runId,
    root: runId,
    pool,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: abort.signal,
    now,
  })

  const nodes = new Map<string, NodeRuntime>()
  for (const id of compiled.nodes.keys()) {
    nodes.set(id, {
      visits: 0,
      live: 0,
      settles: [],
      inputs: new Map(),
      directives: [],
      traces: [],
      blocked: false,
    })
  }
  const edges = new Map<string, EdgeRuntime>()
  for (const edge of compiled.edges) {
    edges.set(edge.id, {
      edge,
      state: 'pending',
      consumedOnce: false,
      traversals: 0,
      payload: undefined,
    })
  }
  const ledger: GraphEdgeTraversal[] = []
  const exhaustedEdges = new Set<string>()
  const settles: GraphNodeSettle[] = []
  const liveHandles = new Map<string, string>() // scope handle id -> node id
  const waitingForBudget: string[] = []
  let ledgerSeq = 0
  let liveCount = 0
  let failure: { reason: GraphRunReason; error?: { name: string; message: string } } | undefined

  const record = (
    runtime: EdgeRuntime,
    outcome: GraphEdgeTraversal['outcome'],
    reason?: string,
  ): void => {
    runtime.traversals += 1
    const spec = runtime.edge.spec
    const entry: GraphEdgeTraversal = {
      edge: runtime.edge.id,
      kind: spec.kind,
      from: spec.from.node,
      to: spec.to.node,
      traversal: runtime.traversals,
      outcome,
      ...(spec.directive !== undefined
        ? { directive: `${spec.directive.surface}/v${spec.directive.version}` }
        : {}),
      ...(spec.kind === 'data' ? { port: runtime.edge.toPort } : {}),
      ...(reason !== undefined ? { reason } : {}),
    }
    ledger.push(entry)
    void journal.appendEvent(runId, {
      kind: 'edge',
      id: `graph:${spec.to.node}`,
      edge: {
        kind: spec.kind,
        from: spec.from.node,
        to: spec.to.node,
        ...(entry.directive !== undefined ? { directive: entry.directive } : {}),
        ...(entry.port !== undefined ? { port: entry.port } : {}),
      },
      traversal: entry.traversal,
      outcome: outcome === 'delivered' ? 'delivered' : outcome,
      bytes: 0,
      ...(reason !== undefined ? { reason } : {}),
      seq: ledgerSeq++,
      at: new Date(now()).toISOString(),
    })
  }

  /** Enter a node: count the visit, build its Agent from consumed inputs, spawn on the Scope. */
  const enter = (id: string): void => {
    if (failure) return
    const node = compiled.nodes.get(id)
    const runtime = nodes.get(id)
    if (!node || !runtime) throw new ValidationError(`${context}: unknown node ${id}`)
    runtime.visits += 1
    if (runtime.visits > node.maxVisits) {
      failure = {
        reason: 'cycle-budget-exceeded',
        error: {
          name: 'GraphCycleBudget',
          message: `node ${id} entered ${runtime.visits} times; maxVisits ${node.maxVisits}`,
        },
      }
      abort.abort(`cycle-budget-exceeded: ${id}`)
      return
    }
    const inputs: Record<string, unknown> = {}
    for (const [port, value] of runtime.inputs) inputs[port] = value
    const directives = runtime.directives.splice(0)
    const traces = runtime.traces.splice(0)
    const nodeTask = [
      id === compiled.root ? task : '',
      ...directives,
      ...traces.map((trace) => `trace of ${trace.node}: ${trace.traceRef ?? '(no traceRef)'}`),
    ]
      .filter((part) => part.length > 0)
      .join('\n\n')
    const effects = narrowEffects(node.kind.effects, engine.effects, `${context}: node ${id}`)
    const agent = node.kind.run({
      config: node.config,
      profile: { name: id, ...(node.spec.profile ?? {}) },
      inputs,
      effects,
    })
    const budget = node.spec.budget ?? (options.perNode as Budget)
    const spawned = scope.spawn(agent, nodeTask.length > 0 ? nodeTask : task, { label: id, budget })
    if (spawned.ok) {
      liveCount += 1
      runtime.live += 1
      liveHandles.set(spawned.handle.id, id)
      return
    }
    if (spawned.reason === 'budget-exhausted' || spawned.reason === 'max-live-workers') {
      // Never overcommit: park the entry and retry after the next settle frees capacity (#972).
      // The consumed directives/traces are restored so the retry enters with the same wave.
      waitingForBudget.push(id)
      runtime.visits -= 1
      runtime.directives.unshift(...directives)
      runtime.traces.unshift(...traces)
      return
    }
    failure = {
      reason: 'driver-failed',
      error: { name: 'SpawnRefused', message: `node ${id}: ${spawned.reason}` },
    }
    abort.abort(`spawn refused: ${id}`)
  }

  /** Join evaluation per ADC's rules; returns whether the node released. */
  const tryRelease = (id: string): boolean => {
    const node = compiled.nodes.get(id)
    const runtime = nodes.get(id)
    if (!node || !runtime || runtime.blocked || failure) return false
    const gating = node.inbound.map((edge) => edges.get(edge.id)) as EdgeRuntime[]
    if (gating.length === 0) return false
    const settled = gating.filter((edge) => edge.state !== 'pending')
    const satisfied = gating.filter((edge) => edge.state === 'satisfied')
    const failed = gating.filter((edge) => edge.state === 'failed')
    const allSettled = settled.length === gating.length
    let release = false
    switch (node.join) {
      case 'all':
        if (gating.some((edge) => edge.state === 'dead' || edge.state === 'failed')) {
          // A dead or failed edge can never satisfy an `all` join again this wave; the node is
          // blocked until (and unless) a later source completion re-judges that edge.
          release = false
        } else release = satisfied.length === gating.length
        break
      case 'any':
        release = satisfied.length > 0
        if (!release && allSettled) runtime.blocked = true
        break
      case 'any_failed':
        release = failed.length > 0
        if (!release && allSettled) runtime.blocked = true
        break
      case 'all_done':
        release = allSettled
        break
    }
    if (!release) return false
    // Consume the wave: check caps on the edges whose outcome produced the release, deliver their
    // payloads, then re-arm every settled edge; a still-pending edge is consumed-once.
    const consuming =
      node.join === 'any'
        ? [satisfied[0] as EdgeRuntime]
        : node.join === 'any_failed'
          ? [failed[0] as EdgeRuntime]
          : settled
    for (const runtimeEdge of consuming) {
      const cap = runtimeEdge.edge.spec.maxTraversals
      if (cap !== undefined && runtimeEdge.traversals >= cap) {
        record(runtimeEdge, 'unpropagated', `traversal-cap-exhausted (max ${cap})`)
        // Undo the count: a refusal is ledgered but does not consume a traversal slot.
        runtimeEdge.traversals -= 1
        exhaustedEdges.add(runtimeEdge.edge.id)
        runtime.blocked = node.join === 'any' || node.join === 'any_failed' ? runtime.blocked : true
        return false
      }
    }
    for (const runtimeEdge of consuming) {
      const spec = runtimeEdge.edge.spec
      if (runtimeEdge.state === 'satisfied' && spec.kind === 'data') {
        let payload = runtimeEdge.payload
        let outcome: GraphEdgeTraversal['outcome'] = 'delivered'
        let reason: string | undefined
        if (spec.projection !== undefined) {
          try {
            payload = admitPayload(
              applyProjection(payload, spec.projection, `edge ${runtimeEdge.edge.id}`),
            )
          } catch (error) {
            outcome = 'empty'
            reason = error instanceof Error ? error.message : String(error)
            payload = undefined
          }
        }
        if (payload === undefined && outcome === 'delivered') outcome = 'empty'
        record(runtimeEdge, outcome, reason)
        if (payload !== undefined) runtime.inputs.set(runtimeEdge.edge.toPort, payload)
      } else if (
        runtimeEdge.state === 'satisfied' ||
        node.join === 'any_failed' ||
        node.join === 'all_done'
      ) {
        if (spec.directive !== undefined && options.prompts !== undefined) {
          runtime.directives.push(options.prompts.resolve(spec.directive).text)
        }
        if (spec.kind === 'analyzes' && runtimeEdge.state === 'satisfied') {
          const trace = runtimeEdge.payload as { traceRef?: string } | undefined
          runtime.traces.push({
            node: spec.from.node,
            ...(trace?.traceRef !== undefined ? { traceRef: trace.traceRef } : {}),
          })
        }
        record(runtimeEdge, 'delivered')
      }
    }
    for (const runtimeEdge of gating) {
      if (runtimeEdge.state !== 'pending') {
        runtimeEdge.state = 'pending'
        runtimeEdge.payload = undefined
      } else if ((nodes.get(runtimeEdge.edge.spec.from.node)?.live ?? 0) > 0) {
        // Only an IN-FLIGHT completion belongs to the wave that just fired (the OR-diamond's
        // second completer). An idle source has nothing in flight; its next completion is new.
        runtimeEdge.consumedOnce = true
      }
    }
    enter(id)
    return true
  }

  /** Settle every outbound edge of a completed source per its LATEST completion, then try joins. */
  const propagate = (id: string, settle: GraphNodeSettle): void => {
    const node = compiled.nodes.get(id)
    if (!node) return
    const succeeded = settle.status === 'done' && settle.valid !== false
    for (const edge of node.outbound) {
      const runtime = edges.get(edge.id)
      if (!runtime) continue
      if (runtime.consumedOnce && runtime.state === 'pending') {
        // This completion belongs to a wave that already fired; absorb it and re-arm.
        runtime.consumedOnce = false
        continue
      }
      if (!succeeded) {
        runtime.state = 'failed'
        runtime.payload = undefined
      } else {
        const guardContext = {
          node: id,
          out: settle.out,
          visits: nodes.get(id)?.visits ?? 0,
          valid: settle.valid ?? true,
        }
        const pass =
          edge.spec.guard === undefined || evaluateCondition(edge.spec.guard, guardContext)
        runtime.state = pass ? 'satisfied' : 'dead'
        runtime.payload = pass
          ? edge.spec.kind === 'analyzes'
            ? { traceRef: (settle as { traceRef?: string }).traceRef }
            : settle.out
          : undefined
      }
    }
    for (const edge of node.outbound) tryRelease(edge.spec.to.node)
  }

  const allTerminalsSettled = () =>
    compiled.terminals.every((id) => (nodes.get(id)?.settles.length ?? 0) > 0)

  // ── The run ────────────────────────────────────────────────────────────────────
  for (const id of compiled.entries) enter(id)

  while (!failure && liveCount > 0) {
    const settled: Settled<unknown> | null = await scope.next()
    if (settled === null) break
    const nodeId = liveHandles.get(settled.handle.id)
    if (nodeId === undefined) continue
    liveHandles.delete(settled.handle.id)
    liveCount -= 1
    const node = compiled.nodes.get(nodeId)
    const runtime = nodes.get(nodeId)
    if (!node || !runtime) continue
    runtime.live -= 1
    let entry: GraphNodeSettle
    if (settled.kind === 'done') {
      const admitted = admitPayload(settled.out)
      let valid: boolean | undefined
      if (node.deliverable !== undefined) {
        try {
          valid = await node.deliverable.check(admitted)
        } catch (error) {
          valid = false
        }
      }
      entry = {
        node: nodeId,
        visit: runtime.visits,
        status: 'done',
        ...(valid !== undefined ? { valid } : {}),
        out: admitted,
        outRef: settled.outRef,
      }
      if (settled.trace?.status === 'available') {
        ;(entry as { traceRef?: string }).traceRef = settled.trace.traceRef
      }
    } else if (settled.kind === 'down') {
      entry = { node: nodeId, visit: runtime.visits, status: 'down', reason: settled.reason }
    } else {
      continue
    }
    runtime.settles.push(entry)
    settles.push(entry)
    // Root completion ends the run the moment its check passes (#973).
    if (nodeId === compiled.root && entry.status === 'done' && entry.valid === true) {
      abort.abort('root delivered')
      break
    }
    propagate(nodeId, entry)
    if (allTerminalsSettled()) break
    // Capacity freed: retry parked entries in arrival order.
    for (const parked of waitingForBudget.splice(0)) enter(parked)
    if (liveCount === 0 && !failure) {
      // Nothing live and nothing released: the graph is stuck; the loop exit will classify it.
      break
    }
  }

  options.signal?.removeEventListener('abort', onOuterAbort)
  abort.abort('run complete')
  // Drain whatever teardown produced so the scope owns no live child when we return.
  while ((await scope.next()) !== null) {
    /* drained */
  }

  const finalize = async (): Promise<unknown | undefined> => {
    const rows: FinalizerSettled[] = compiled.terminals.flatMap((id) =>
      (nodes.get(id)?.settles ?? []).map((settle) => ({
        id: settle.node,
        status: settle.status,
        // A terminal with no check delivers on `done` — the check's absence was accepted at
        // compile because ANOTHER terminal carries one (#973).
        valid: settle.status === 'done' && settle.valid !== false,
        ...(settle.outRef !== undefined ? { outRef: settle.outRef } : {}),
      })),
    )
    const finalizer =
      options.finalizer === undefined || options.finalizer === 'bestDelivered'
        ? bestDelivered
        : options.finalizer === 'collectDelivered'
          ? collectDelivered
          : options.finalizer
    return runFinalizer(finalizer, { settled: rows, blobs, tree: scope.view, budget: scope.budget })
  }

  const terminals = compiled.terminals.flatMap((id) => nodes.get(id)?.settles ?? [])
  const finish = (result: GraphRunResult): GraphRunResult => {
    // A capped edge that left the run winnerless is a NAMED failure, not a quiet no-winner (#973).
    if (result.kind === 'no-winner' && exhaustedEdges.size > 0) {
      throw new GraphEdgeCapError(
        Object.freeze([...exhaustedEdges]),
        Object.freeze([...ledger]) as never,
        result as never,
      )
    }
    return result
  }

  if (failure) {
    return finish({
      kind: 'no-winner',
      reason: failure.reason,
      ...(failure.error ? { error: failure.error } : {}),
      terminals,
      settles,
      ledger,
      unreachable: [],
    })
  }
  if (options.signal?.aborted) {
    return finish({
      kind: 'no-winner',
      reason: 'aborted',
      terminals,
      settles,
      ledger,
      unreachable: [],
    })
  }
  const anyDelivered = compiled.terminals.some((id) =>
    (nodes.get(id)?.settles ?? []).some(
      (settle) => settle.status === 'done' && settle.valid !== false,
    ),
  )
  const out = anyDelivered ? await finalize() : undefined
  if (out !== undefined) {
    return { kind: 'winner', out, terminals, settles, ledger }
  }
  // No delivered terminal. Name the honest cause: an unreachable terminal beats a generic down.
  const unreachable = [...compiled.nodes.keys()].filter(
    (id) => (nodes.get(id)?.settles.length ?? 0) === 0,
  )
  const reason: GraphRunReason = compiled.terminals.some((id) => unreachable.includes(id))
    ? unreachable.length === compiled.nodes.size
      ? 'budget-exhausted'
      : 'unreachable-terminal'
    : 'all-children-down'
  return finish({ kind: 'no-winner', reason, terminals, settles, ledger, unreachable })
}
