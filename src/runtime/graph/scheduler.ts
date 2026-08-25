/**
 * The engine scheduler (agent-runtime#980, durable per #974/#976): run a compiled graph by hosting
 * every node instance on one kernel `Scope`. The pool, the journal, the blob store and
 * cancellation are the kernel's; the scheduler owns only what a graph adds — releasing nodes over
 * guarded edges, delivering payloads and directives, the two cycle caps, and suspensions.
 *
 * DURABILITY — fold, never checkpoint. Every decision is journaled BEFORE its effect is visible
 * (blob-then-journal where a ref is minted), then applied to live state through the SAME reducer
 * (`applyGraphFoldEvent`) a restart replays the journal through. Kill the process at any journal
 * boundary and a restart re-enters the exact state: settled nodes restore from `outRef` and never
 * re-execute; a released-but-unspawned instance re-enters from its pinned `inputRef`; an in-flight
 * instance is in-doubt and re-enters per its kind's `onCrash`.
 *
 * The parts this file does NOT own, so it stays a loop and not a god object: payload admission
 * (`admit.ts`), the edge ledger (`ledger.ts`), the join rule (`join.ts`), suspension vocabulary
 * (`suspension.ts`), the journal/pool/scope bootstrap (`run-context.ts`), and result assembly
 * (`result.ts`).
 */
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type { PromptRegistry } from '../supervise/prompt-registry'
import type { Budget, ResultBlobStore, Settled, SpawnEvent, SpawnJournal } from '../supervise/types'
import { admitPayload } from './admit'
import { type CompiledGraph, compileGraph, isEngineFired } from './compile'
import { evaluateCondition } from './condition'
import type { EngineGraphSpec } from './definition'
import type { GraphEngine } from './engine'
import { applyGraphFoldEvent, type FoldInstance, type FoldSuspension } from './fold'
import { decideJoin, type GatingEdge } from './join'
import { narrowEffects } from './kind'
import { createEdgeLedger } from './ledger'
import { applyProjection } from './projection'
import { assembleGraphResult, type FinalizerChoice } from './result'
import { openGraphRun } from './run-context'
import type { GraphNodeSettle, GraphRunReason, GraphRunResult } from './scheduler-types'
import {
  isSuspensionRequest,
  mintSuspensionToken,
  type SuspensionRequest,
  suspensionNodeId,
} from './suspension'

export { admitPayload } from './admit'
export { ENGINE_WOKEN_SEQ_BASE } from './run-context'
export type {
  GraphEdgeTraversal,
  GraphNodeSettle,
  GraphRunReason,
  GraphRunResult,
} from './scheduler-types'
export { type SuspensionRequest, suspended } from './suspension'

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
  readonly finalizer?: FinalizerChoice
  readonly signal?: AbortSignal
  readonly now?: () => number
  readonly runId?: string
  /** Continue an existing journaled run. An existing tree without this refuses, like the kernel. */
  readonly resume?: boolean
  /** Hold a fully-suspended run open for live `resume()` calls instead of returning
   *  `{ kind: 'suspended' }`. Offline callers leave this off and restart later (#976). */
  readonly waitForWakes?: boolean
}

/** A live run: await `done`; deliver host wakes through `resume`/`expire` (#976). */
export interface GraphRunHandle {
  readonly done: Promise<GraphRunResult>
  resume(token: string, payload: unknown): Promise<void>
  expire(token: string): Promise<void>
}

interface QueuedWake {
  readonly token: string
  readonly payload?: unknown
  readonly expire: boolean
  readonly settle: () => void
  readonly fail: (error: unknown) => void
}

/** Run a graph to its result: `createGraphRun` awaited — the one-call form for a run that needs no
 *  live host wakes. */
export async function runEngineGraph(
  engine: GraphEngine,
  spec: EngineGraphSpec | CompiledGraph,
  task: string,
  options: GraphRunOptions,
): Promise<GraphRunResult> {
  return createGraphRun(engine, spec, task, options).done
}

/**
 * Start (or resume) a graph run and return its handle: await `done` for the result; deliver host
 * wakes through `resume`/`expire` while it runs (#976).
 */
export function createGraphRun(
  engine: GraphEngine,
  spec: EngineGraphSpec | CompiledGraph,
  task: string,
  options: GraphRunOptions,
): GraphRunHandle {
  const compiled = asCompiled(engine, spec)
  const wakes: QueuedWake[] = []
  let signalWake: () => void = () => {}
  let finished = false
  const done = runGraphLoop(engine, compiled, task, options, wakes, (fn) => {
    signalWake = fn
  }).finally(() => {
    finished = true
  })
  const queue = (token: string, payload: unknown, expire: boolean): Promise<void> => {
    if (finished) {
      return Promise.reject(
        new ValidationError(
          `graph resume: run completed; start a new run over the same journal to wake '${token}'`,
        ),
      )
    }
    return new Promise<void>((settle, fail) => {
      wakes.push({ token, payload, expire, settle, fail })
      signalWake()
    })
  }
  return {
    done,
    resume: (token, payload) => queue(token, payload, false),
    expire: (token) => queue(token, undefined, true),
  }
}

function asCompiled(engine: GraphEngine, spec: EngineGraphSpec | CompiledGraph): CompiledGraph {
  return 'nodes' in spec && spec.nodes instanceof Map
    ? (spec as CompiledGraph)
    : compileGraph(engine, spec as EngineGraphSpec)
}

/** Everything a run must be able to satisfy before it spends anything. */
function assertRunnable(
  engine: GraphEngine,
  compiled: CompiledGraph,
  options: GraphRunOptions,
): void {
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
    // Only an ENGINE-fired edge's directive is the scheduler's to resolve; a `delegates` directive
    // is resolved by the supervisor that spawns the target (#971).
    if (isEngineFired(edge) && edge.spec.directive !== undefined && options.prompts === undefined) {
      throw new ValidationError(
        `${context}: edge ${edge.id} carries a directive but options.prompts is absent`,
      )
    }
  }
}

async function runGraphLoop(
  engine: GraphEngine,
  compiled: CompiledGraph,
  task: string,
  options: GraphRunOptions,
  wakes: QueuedWake[],
  onWakeSignal: (fn: () => void) => void,
): Promise<GraphRunResult> {
  assertRunnable(engine, compiled, options)
  const now = options.now ?? Date.now
  const runId = options.runId ?? `graph:${contentAddress({ task }).slice(0, 18)}`
  let detachOuterAbort: () => void = () => {}
  const context = await openGraphRun({
    compiled,
    runId,
    budget: options.budget,
    ...(options.journal !== undefined ? { journal: options.journal } : {}),
    ...(options.blobs !== undefined ? { blobs: options.blobs } : {}),
    now,
    ...(options.resume !== undefined ? { resume: options.resume } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    onAbort: (detach) => {
      detachOuterAbort = detach
    },
  })
  const { abort, blobs, journal, scope, state } = context
  const ledger = createEdgeLedger({ journal, runId, now, startSeq: context.ledgerSeq })
  let engineSeq = context.engineSeq
  let wokenSeq = context.engineWokenSeq

  const liveHandles = new Map<string, string>() // kernel node id -> engine instance label
  const waitingForBudget: string[] = []
  const outCache = new Map<string, unknown>()
  let liveCount = 0
  let failure: { reason: GraphRunReason; error?: { name: string; message: string } } | undefined

  /** Journal one engine event, then apply it through the reducer a restart will replay. */
  const emit = async (ev: SpawnEvent): Promise<void> => {
    await journal.appendEvent(runId, ev)
    applyGraphFoldEvent(state, ev, compiled)
  }
  const stamp = () => new Date(now()).toISOString()

  const fail = (reason: GraphRunReason, name: string, message: string): void => {
    failure = { reason, error: { name, message } }
    abort.abort(`${reason}: ${message}`)
  }

  // ── Spawning ───────────────────────────────────────────────────────────────────

  /** The ONE entry path: spawn a released instance from its journaled envelope. Used by a fresh
   *  release, a budget-parked retry, and a restart re-entry alike. */
  const spawnInstance = async (label: string): Promise<void> => {
    if (failure) return
    const instance = state.instances.get(label)
    const node = instance === undefined ? undefined : compiled.nodes.get(instance.node)
    if (!instance || !node || instance.inputRef === undefined) {
      throw new ValidationError(`runEngineGraph: instance ${label} has no journaled envelope`)
    }
    const envelope = (await blobs.get(instance.inputRef)) as
      | { task: string; inputs: Record<string, unknown> }
      | undefined
    if (envelope === undefined) {
      throw new ValidationError(
        `runEngineGraph: envelope ${instance.inputRef} is not in the blob store`,
      )
    }
    const agent = node.kind.run({
      config: node.config,
      profile: { name: node.id, ...(node.spec.profile ?? {}) },
      inputs: envelope.inputs,
      effects: narrowEffects(node.kind.effects, engine.effects, `runEngineGraph: node ${node.id}`),
      // A nesting kind (`subgraph`) runs its inner graph on THIS engine — same kinds, same
      // effects — with its own scope, pool and journal tree under a derived run id.
      host: {
        runNested: (inner, task, opts) =>
          runEngineGraph(engine, inner as EngineGraphSpec, task, {
            budget: opts.budget as Budget,
            ...(opts.perNode === undefined ? {} : { perNode: opts.perNode as Budget }),
            journal,
            blobs,
            ...(options.prompts === undefined ? {} : { prompts: options.prompts }),
            runId: `${runId}:${opts.runId}`,
            ...(opts.signal === undefined ? {} : { signal: opts.signal }),
            now,
          }).then((result) => ({
            kind: result.kind,
            ...(result.kind === 'winner' ? { out: result.out } : {}),
          })),
      },
    })
    const budget = node.spec.budget ?? (options.perNode as Budget)
    const spawned = scope.spawn(agent, envelope.task, { label, budget })
    if (spawned.ok) {
      liveCount += 1
      liveHandles.set(spawned.handle.id, label)
      // The kernel journaled its own `spawned` row inside `scope.spawn`; mirror the two fields the
      // reducer folds, so live state matches what a restart reconstructs.
      applyGraphFoldEvent(
        state,
        {
          kind: 'spawned',
          id: spawned.handle.id,
          label,
          budget,
          runtime: 'inline',
          seq: 0,
          at: '',
        },
        compiled,
      )
      return
    }
    if (spawned.reason === 'budget-exhausted' || spawned.reason === 'max-live-workers') {
      waitingForBudget.push(label) // never overcommit: retry after the next settle frees capacity
      return
    }
    fail('driver-failed', 'SpawnRefused', `node ${node.id}: ${spawned.reason}`)
  }

  /** Pin an instance's envelope (inputs + task) by content address; answers the instance label. */
  const openInstance = async (
    nodeId: string,
    visit: number,
    envelope: { task: string; inputs: Record<string, unknown> },
  ): Promise<string> => {
    const label = `${nodeId}#${visit}`
    const inputRef = contentAddress(envelope)
    await blobs.put(inputRef, envelope)
    await emit({
      kind: 'node-inputs-resolved',
      id: label,
      node: nodeId,
      instance: label,
      inputRef,
      seq: engineSeq++,
      at: stamp(),
    })
    return label
  }

  const enterEntryNode = async (nodeId: string): Promise<void> => {
    const node = compiled.nodes.get(nodeId)
    const folded = state.nodes.get(nodeId)
    if (!node || !folded) return
    const visit = folded.visits + 1
    if (visit > node.maxVisits) return
    await spawnInstance(await openInstance(nodeId, visit, { task, inputs: {} }))
  }

  // ── Releasing ──────────────────────────────────────────────────────────────────

  /** Build the released instance's envelope from its wave: data payloads projected and admitted,
   *  directives resolved, trace refs lined up — every consumption ledgered as it is taken. */
  const consumeWave = async (
    nodeId: string,
    consuming: ReadonlyArray<GatingEdge>,
  ): Promise<{ task: string; inputs: Record<string, unknown> }> => {
    const inputs: Record<string, unknown> = {}
    const directives: string[] = []
    const traces: string[] = []
    for (const { edge, folded } of consuming) {
      const spec = edge.spec
      const traversal = (folded?.traversals ?? 0) + 1
      if (spec.kind === 'data' && folded?.state === 'satisfied') {
        let payload =
          folded.payloadRef === undefined
            ? undefined
            : (outCache.get(folded.payloadRef) ?? admitPayload(await blobs.get(folded.payloadRef)))
        let outcome: 'delivered' | 'empty' = 'delivered'
        let reason: string | undefined
        if (spec.projection !== undefined) {
          try {
            payload = admitPayload(applyProjection(payload, spec.projection, `edge ${edge.id}`))
          } catch (error) {
            outcome = 'empty'
            reason = error instanceof Error ? error.message : String(error)
            payload = undefined
          }
        }
        if (payload === undefined) outcome = 'empty'
        await ledger.record(edge, traversal, outcome, reason)
        if (payload !== undefined) inputs[edge.toPort] = payload
        continue
      }
      if (spec.directive !== undefined && options.prompts !== undefined) {
        directives.push(options.prompts.resolve(spec.directive).text)
      }
      if (spec.kind === 'analyzes' && folded?.state === 'satisfied') {
        traces.push(`trace of ${spec.from.node}: ${folded.payloadRef ?? '(no traceRef)'}`)
      }
      await ledger.record(edge, traversal, 'delivered')
    }
    const composed = [nodeId === compiled.root ? task : '', ...directives, ...traces]
      .filter((part) => part.length > 0)
      .join('\n\n')
    return { task: composed.length > 0 ? composed : task, inputs }
  }

  const release = async (
    nodeId: string,
    consuming: ReadonlyArray<GatingEdge>,
    consumedPending: ReadonlyArray<string>,
  ): Promise<void> => {
    const node = compiled.nodes.get(nodeId)
    const folded = state.nodes.get(nodeId)
    if (!node || !folded) return
    const visit = folded.visits + 1
    if (visit > node.maxVisits) {
      fail(
        'cycle-budget-exceeded',
        'GraphCycleBudget',
        `node ${nodeId} entered ${visit} times; maxVisits ${node.maxVisits}`,
      )
      return
    }
    const envelope = await consumeWave(nodeId, consuming)
    const label = await openInstance(nodeId, visit, envelope)
    await emit({
      kind: 'join-state',
      id: label,
      node: nodeId,
      rule: node.join,
      satisfiedBy: consuming.map(({ edge }) => edge.id),
      consumedPending: [...consumedPending],
      instance: label,
      seq: engineSeq++,
      at: stamp(),
    })
    await spawnInstance(label)
  }

  /**
   * Journal the `join-state` a crashed release never wrote. The consuming set
   * is re-derived from the SAME decision the crashed process made: its gating
   * edges are still folded exactly as they were when it released (their
   * verdicts were journaled first), so `decideJoin` answers identically.
   */
  const consumeWaveAfterCrash = async (instance: FoldInstance): Promise<void> => {
    const node = compiled.nodes.get(instance.node)
    if (!node) return
    const gating: GatingEdge[] = node.inbound.map((edge) => ({
      edge,
      folded: state.edges.get(edge.id),
    }))
    const decision = decideJoin(node.join, gating)
    if (!decision.release) return
    const consumedPending = gating
      .filter((entry) => entry.folded?.state === 'pending')
      .map((entry) => entry.edge.id)
    await emit({
      kind: 'join-state',
      id: instance.instance,
      node: instance.node,
      rule: node.join,
      satisfiedBy: decision.consuming.map(({ edge }) => edge.id),
      consumedPending,
      instance: instance.instance,
      seq: engineSeq++,
      at: stamp(),
    })
  }

  const tryRelease = async (nodeId: string): Promise<void> => {
    const node = compiled.nodes.get(nodeId)
    const folded = state.nodes.get(nodeId)
    if (!node || !folded || folded.blocked || failure) return
    const gating: GatingEdge[] = node.inbound.map((edge) => ({
      edge,
      folded: state.edges.get(edge.id),
    }))
    const decision = decideJoin(node.join, gating)
    if (decision.blocked) folded.blocked = true
    if (!decision.release) return
    // Caps are judged on the consuming edges BEFORE anything else happens, and the refusal is
    // journaled so a restart sees the same exhaustion.
    for (const entry of decision.consuming) {
      const cap = entry.edge.spec.maxTraversals
      if (cap !== undefined && (entry.folded?.traversals ?? 0) >= cap) {
        await ledger.record(
          entry.edge,
          (entry.folded?.traversals ?? 0) + 1,
          'unpropagated',
          `traversal-cap-exhausted (max ${cap})`,
        )
        await emit({
          kind: 'edge-verdict',
          id: `graph:${nodeId}`,
          edge: entry.edge.id,
          fired: false,
          sourceStatus: 'done',
          capped: true,
          seq: engineSeq++,
          at: stamp(),
        })
        return
      }
    }
    const consumedPending = gating
      .filter(
        (entry) => entry.folded?.state === 'pending' && hasLiveInstance(entry.edge.spec.from.node),
      )
      .map((entry) => entry.edge.id)
    await release(nodeId, decision.consuming, consumedPending)
  }

  const hasLiveInstance = (nodeId: string): boolean => {
    for (const label of liveHandles.values()) {
      if (state.instances.get(label)?.node === nodeId) return true
    }
    return false
  }

  // ── Judging ────────────────────────────────────────────────────────────────────

  /** Journal a verdict for every unaccounted outbound edge of a settle, then try the joins. */
  const propagate = async (label: string, settle: GraphNodeSettle): Promise<void> => {
    const node = compiled.nodes.get(settle.node)
    if (!node) return
    const succeeded = settle.status === 'done' && settle.valid !== false
    const sourceSettles = state.nodes.get(settle.node)?.settles.length ?? 0
    for (const edge of node.outbound) {
      // A `delegates` target is spawned by its supervisor inside the kernel's authorized path,
      // with the pin and the directive applied there — the scheduler judges nothing (#971).
      if (!isEngineFired(edge)) continue
      const folded = state.edges.get(edge.id)
      if (!folded || folded.judgedSourceSettles >= sourceSettles) {
        // Accounted — by an earlier verdict, or absorbed by the wave that consumed it. This is
        // what makes propagate idempotent, so a restart may re-propagate every settled node.
        continue
      }
      let fired = false
      let inputRef: string | undefined
      if (succeeded) {
        fired =
          edge.spec.guard === undefined ||
          evaluateCondition(edge.spec.guard, {
            node: settle.node,
            out: settle.out,
            visits: state.nodes.get(settle.node)?.visits ?? 0,
            valid: settle.valid ?? true,
          })
        if (fired) {
          inputRef =
            edge.spec.kind === 'analyzes'
              ? (settle as { traceRef?: string }).traceRef
              : settle.outRef
        }
      }
      await emit({
        kind: 'edge-verdict',
        id: label,
        edge: edge.id,
        fired,
        sourceStatus: settle.status === 'down' ? 'down' : succeeded ? 'done' : 'invalid',
        ...(inputRef !== undefined ? { inputRef } : {}),
        seq: engineSeq++,
        at: stamp(),
      })
    }
    for (const edge of node.outbound) {
      if (isEngineFired(edge)) await tryRelease(edge.spec.to.node)
    }
  }

  // ── Suspensions ────────────────────────────────────────────────────────────────

  const park = async (label: string, request: SuspensionRequest): Promise<void> => {
    const token = mintSuspensionToken(runId, label)
    let defaultRef: string | undefined
    if (request.default !== undefined) {
      const admitted = admitPayload(request.default)
      defaultRef = contentAddress(admitted)
      await blobs.put(defaultRef, admitted)
    }
    await emit({
      kind: 'waiting',
      id: suspensionNodeId(token),
      label,
      spec: {
        kind: 'token',
        token,
        onExpire: request.onExpire,
        ...(request.expiresInMs !== undefined ? { expiresAtMs: now() + request.expiresInMs } : {}),
        ...(defaultRef !== undefined ? { defaultRef } : {}),
      },
      armedAt: now(),
      seq: engineSeq++,
      at: stamp(),
    })
  }

  const wake = async (
    suspension: FoldSuspension,
    by: 'fired' | 'expired',
    outRef?: string,
  ): Promise<void> => {
    await emit({
      kind: 'woken',
      id: suspensionNodeId(suspension.token),
      by,
      ...(outRef !== undefined ? { outRef } : {}),
      seq: wokenSeq++,
      at: stamp(),
    })
    const settle = state.instances.get(suspension.instance)?.settle
    if (settle === undefined) return
    const out =
      settle.outRef === undefined ? undefined : admitPayload(await blobs.get(settle.outRef))
    if (settle.outRef !== undefined && out !== undefined) outCache.set(settle.outRef, out)
    await propagate(suspension.instance, out === undefined ? settle : { ...settle, out })
  }

  /** Expiries are engine-clocked, so an offline run transitions them without a host sweep (#976). */
  const expireDue = async (): Promise<boolean> => {
    let transitioned = false
    for (const suspension of [...state.suspensions.values()]) {
      if (suspension.status !== 'pending') continue
      if (suspension.expiresAtMs === undefined || now() < suspension.expiresAtMs) continue
      if (suspension.onExpire === 'fail') await wake(suspension, 'expired')
      else if (suspension.onExpire === 'default')
        await wake(suspension, 'fired', suspension.defaultRef)
      else continue
      transitioned = true
    }
    return transitioned
  }

  const drainWakes = async (): Promise<void> => {
    while (wakes.length > 0) {
      const request = wakes.shift()
      if (!request) return
      try {
        const suspension = state.suspensions.get(request.token)
        if (!suspension) throw new ValidationError(`graph resume: unknown token '${request.token}'`)
        if (suspension.status !== 'pending') {
          throw new ValidationError(`graph resume: token '${request.token}' already woken`)
        }
        if (request.expire) {
          await wake(
            suspension,
            suspension.onExpire === 'default' ? 'fired' : 'expired',
            suspension.onExpire === 'default' ? suspension.defaultRef : undefined,
          )
        } else {
          const admitted = admitPayload(request.payload)
          const outRef = contentAddress(admitted)
          await blobs.put(outRef, admitted)
          outCache.set(outRef, admitted)
          await wake(suspension, 'fired', outRef)
        }
        request.settle()
      } catch (error) {
        request.fail(error)
      }
    }
  }

  // ── Settling ───────────────────────────────────────────────────────────────────

  const handleSettle = async (settled: Settled<unknown>): Promise<void> => {
    const label = liveHandles.get(settled.handle.id)
    if (label === undefined) return
    liveHandles.delete(settled.handle.id)
    liveCount -= 1
    const instance = state.instances.get(label)
    const node = instance === undefined ? undefined : compiled.nodes.get(instance.node)
    if (!instance || !node) return
    if (settled.kind === 'done' && isSuspensionRequest(settled.out)) {
      await park(label, settled.out)
      return
    }
    // Mirror the kernel's own journaled settle through the reducer, then enrich it for judging.
    applyGraphFoldEvent(
      state,
      {
        kind: 'settled',
        id: settled.handle.id,
        status: settled.kind === 'done' ? 'done' : 'down',
        ...(settled.kind === 'done' ? { outRef: settled.outRef } : {}),
        ...(settled.kind === 'down' ? { reason: settled.reason } : {}),
        ...(settled.kind === 'done' && settled.trace?.status === 'available'
          ? { trace: settled.trace }
          : {}),
        spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        seq: 0,
        at: '',
      },
      compiled,
    )
    const folded = state.instances.get(label)?.settle
    if (!folded) return
    let enriched = folded
    if (settled.kind === 'done') {
      const admitted = admitPayload(settled.out)
      if (settled.outRef !== undefined) outCache.set(settled.outRef, admitted)
      enriched = { ...folded, out: admitted, ...(await checkDeliverable(node, admitted)) }
      const settles = state.nodes.get(instance.node)?.settles
      if (settles) settles[settles.length - 1] = enriched
      ;(state.instances.get(label) as { settle?: GraphNodeSettle }).settle = enriched
    }
    // Root completion ends the run the moment its check passes (#973).
    if (instance.node === compiled.root && enriched.status === 'done' && enriched.valid === true) {
      abort.abort('root delivered')
      return
    }
    await propagate(label, enriched)
  }

  const checkDeliverable = async (
    node: CompiledGraph['nodes'] extends ReadonlyMap<string, infer N> ? N : never,
    out: unknown,
  ): Promise<{ valid?: boolean }> => {
    if (node.deliverable === undefined) return {}
    try {
      return { valid: await node.deliverable.check(out) }
    } catch {
      return { valid: false }
    }
  }

  // ── Entry / restart ────────────────────────────────────────────────────────────

  if (!context.resuming) {
    for (const id of compiled.entries) await enterEntryNode(id)
  } else {
    await reenterAfterCrash()
  }

  /** Kill-anywhere re-entry: finish every half-done transition the crashed process left, from the
   *  pinned envelopes and journaled settles only — never by re-deriving anything (#974). */
  async function reenterAfterCrash(): Promise<void> {
    for (const instance of [...state.instances.values()]) {
      if (instance.status === 'released') {
        // The envelope was pinned but the wave consumption may not have been
        // journaled — the crash window between the two events. Finish that
        // release first: its gating edges stay satisfied otherwise, and the
        // catch-up `tryRelease` below would release the node a SECOND time
        // and execute it twice.
        if (instance.waveConsumed !== true) await consumeWaveAfterCrash(instance)
        await spawnInstance(instance.instance)
        continue
      }
      if (instance.status !== 'live') continue
      const node = compiled.nodes.get(instance.node)
      const folded = state.nodes.get(instance.node)
      if (!node || !folded) continue
      const visit = folded.visits + 1
      if (visit > node.maxVisits) {
        fail(
          'cycle-budget-exceeded',
          'GraphCycleBudget',
          `node ${instance.node} entered ${visit} times; maxVisits ${node.maxVisits}`,
        )
        return
      }
      // In-doubt: the journal keeps its reservation charged (the kernel's rule), and the restart
      // re-enters from the SAME pinned envelope.
      instance.status = 'down'
      const label = `${instance.node}#${visit}`
      await emit({
        kind: 'node-inputs-resolved',
        id: label,
        node: instance.node,
        instance: label,
        inputRef: instance.inputRef as string,
        seq: engineSeq++,
        at: stamp(),
      })
      await spawnInstance(label)
    }
    for (const [nodeId, folded] of state.nodes) {
      const latest = folded.settles.at(-1)
      if (latest === undefined) continue
      const label = `${nodeId}#${latest.visit}`
      if (latest.status === 'done' && latest.outRef !== undefined) {
        const out = admitPayload(await blobs.get(latest.outRef))
        if (isSuspensionRequest(out)) {
          // Killed between the kernel settle and the `waiting` event: finish the transition
          // instead of propagating the park marker as data.
          folded.settles.pop()
          const instance = state.instances.get(label)
          if (instance) instance.settle = undefined
          await park(label, out)
          continue
        }
        outCache.set(latest.outRef, out)
        const node = compiled.nodes.get(nodeId)
        await propagate(label, {
          ...latest,
          out,
          ...(node === undefined ? {} : await checkDeliverable(node, out)),
        })
        continue
      }
      await propagate(label, latest)
    }
    for (const id of compiled.entries) {
      if ((state.nodes.get(id)?.visits ?? 0) === 0) await enterEntryNode(id)
    }
    for (const id of compiled.nodes.keys()) await tryRelease(id)
  }

  // ── The loop ───────────────────────────────────────────────────────────────────

  const allTerminalsSettled = () =>
    compiled.terminals.every((id) => (state.nodes.get(id)?.settles.length ?? 0) > 0)

  let wakeSignal = Promise.resolve()
  const rearmWakeSignal = () => {
    wakeSignal = new Promise<void>((fire) => {
      onWakeSignal(fire)
    })
  }
  rearmWakeSignal()
  // An abort must reach a PARKED run too: nothing is live, no wake is coming, and the host is
  // shutting the run down — the wait ends now and the loop exits on the aborted signal.
  const abortWake = new Promise<void>((fire) => {
    if (abort.signal.aborted) fire()
    else abort.signal.addEventListener('abort', () => fire(), { once: true })
  })

  let pendingNext: Promise<Settled<unknown> | null> | undefined
  while (!failure) {
    if (abort.signal.aborted) break
    if (await expireDue()) continue
    if (wakes.length > 0) {
      await drainWakes()
      continue
    }
    if (allTerminalsSettled()) break
    if (liveCount === 0) {
      const parked = [...state.suspensions.values()].filter(
        (suspension) => suspension.status === 'pending',
      )
      if (parked.length === 0) break // stuck or complete: `assembleGraphResult` classifies it
      if (options.waitForWakes) {
        rearmWakeSignal()
        await Promise.race([wakeSignal, abortWake])
        continue
      }
      // Offline (#976): no host will answer, so a `default` suspension resolves now; `wait` and a
      // future `fail` deadline park the run as a resumable artifact.
      const defaulting = parked.filter((suspension) => suspension.onExpire === 'default')
      if (defaulting.length === 0) break
      for (const suspension of defaulting) await wake(suspension, 'fired', suspension.defaultRef)
      continue
    }
    pendingNext ??= scope.next()
    const raced = await Promise.race([
      pendingNext.then((settle) => ({ settle })),
      wakeSignal.then(() => 'wake' as const),
    ])
    if (raced === 'wake') {
      rearmWakeSignal()
      continue // the queued wakes run on the next turn; `pendingNext` stays armed
    }
    pendingNext = undefined
    if (raced.settle === null) break
    await handleSettle(raced.settle)
    for (const label of waitingForBudget.splice(0)) await spawnInstance(label)
  }

  detachOuterAbort()
  abort.abort('graph loop complete')
  while ((await (pendingNext ?? scope.next())) !== null) pendingNext = undefined

  return assembleGraphResult({
    compiled,
    state,
    blobs,
    scope,
    outCache,
    ledger: ledger.entries,
    ...(options.finalizer !== undefined ? { finalizer: options.finalizer } : {}),
    ...(failure !== undefined ? { failure } : {}),
    aborted: options.signal?.aborted ?? false,
  })
}
