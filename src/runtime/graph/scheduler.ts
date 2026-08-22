/**
 * The engine scheduler (agent-runtime#980, durable per #974/#976): run a compiled graph by hosting
 * every node instance on one kernel `Scope` — the pool, the journal, the blob store and
 * cancellation are the kernel's, never re-implemented. The scheduler owns only what a graph adds:
 * joins over guarded edges, traversal and visit caps, directive/payload delivery, suspensions,
 * terminals and the finalizer reduce.
 *
 * DURABILITY MODEL — fold, never checkpoint. Every scheduling decision is journaled BEFORE its
 * effect is visible (blob-then-journal where a ref is minted), then applied to in-memory state
 * through the SAME pure reducer (`applyGraphFoldEvent`) a restart replays the journal through.
 * Kill the process at any journal boundary and a restart with the same journal re-enters the exact
 * state: settled nodes restore from `outRef` and are never re-executed; a released-but-unspawned
 * instance re-enters from its pinned `inputRef`; an in-flight instance is in-doubt and re-enters
 * per its kind's `onCrash`.
 *
 * Engine `woken` ordinals live in a reserved high band (`ENGINE_WOKEN_SEQ_BASE`+) so they can
 * never collide with the kernel scope's cursor counter, which the kernel owns and advances
 * concurrently.
 */
import { contentAddress } from '../../durable/content-address'
import {
  closesCursorSlot,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { addSpend } from '../../runtime/util'
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
import {
  maxSeqOf,
  sumMeasuredSpendFromEvents,
  uncertainSpawnBudgets,
} from '../supervise/supervisor'
import type { Budget, ResultBlobStore, Settled, SpawnEvent, SpawnJournal } from '../supervise/types'
import { type CompiledEdge, type CompiledGraph, compileGraph } from './compile'
import { evaluateCondition } from './condition'
import type { EngineGraphSpec } from './definition'
import type { GraphEngine } from './engine'
import {
  applyGraphFoldEvent,
  emptyFoldState,
  type FoldSuspension,
  type GraphFoldState,
} from './fold'
import { narrowEffects } from './kind'
import { applyProjection } from './projection'
import type {
  GraphEdgeTraversal,
  GraphNodeSettle,
  GraphRunReason,
  GraphRunResult,
} from './scheduler-types'

export type {
  GraphEdgeTraversal,
  GraphNodeSettle,
  GraphRunReason,
  GraphRunResult,
} from './scheduler-types'

/** Engine-appended `woken` ordinals start here — far above any kernel cursor counter. */
export const ENGINE_WOKEN_SEQ_BASE = 10_000_000

const SUSPEND_MARK = '__graphSuspension'

export interface SuspensionRequest {
  readonly [SUSPEND_MARK]: true
  readonly onExpire: 'wait' | 'fail' | 'default'
  /** Milliseconds from the suspension's journaling instant; absent with `onExpire: 'wait'`. */
  readonly expiresInMs?: number
  readonly default?: unknown
}

/** What a kind's executor returns to park its node on a host wake (agent-runtime#976). */
export function suspended(
  options: {
    readonly onExpire?: 'wait' | 'fail' | 'default'
    readonly expiresInMs?: number
    readonly default?: unknown
  } = {},
): SuspensionRequest {
  const onExpire = options.onExpire ?? 'wait'
  if (onExpire !== 'wait' && options.expiresInMs === undefined) {
    throw new ValidationError(`suspended: onExpire '${onExpire}' requires expiresInMs`)
  }
  if (onExpire === 'wait' && options.expiresInMs !== undefined) {
    throw new ValidationError("suspended: onExpire 'wait' never expires — remove expiresInMs")
  }
  if (onExpire === 'default' && options.default === undefined) {
    throw new ValidationError("suspended: onExpire 'default' requires a default payload")
  }
  return {
    [SUSPEND_MARK]: true,
    onExpire,
    ...(options.expiresInMs !== undefined ? { expiresInMs: options.expiresInMs } : {}),
    ...(options.default !== undefined ? { default: options.default } : {}),
  }
}

function isSuspensionRequest(value: unknown): value is SuspensionRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[SUSPEND_MARK] === true
  )
}

/** Admission for every value crossing an edge (#971): JSON round-trip, `undefined` stripped, a
 *  non-representable value becomes a RECORD of that fact — a degraded record beats a vanished
 *  edge. */
export function admitPayload(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return { nonCanonical: `payload of type ${typeof value}` }
    return JSON.parse(text)
  } catch (error) {
    return { nonCanonical: error instanceof Error ? error.message : String(error) }
  }
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

/** Run a graph to its result: `createGraphRun` awaited — the one-call form for a run that needs
 *  no live host wakes. */
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
  const compiled: CompiledGraph =
    'nodes' in spec && spec.nodes instanceof Map
      ? (spec as CompiledGraph)
      : compileGraph(engine, spec as EngineGraphSpec)
  const wakes: Array<{
    token: string
    payload?: unknown
    expire: boolean
    settle: () => void
    fail: (e: unknown) => void
  }> = []
  let notifyWake: (() => void) | undefined
  const handleState = { finished: false }
  const done = runGraphLoop(
    engine,
    compiled,
    task,
    options,
    wakes,
    () => notifyWake?.(),
    (fn) => {
      notifyWake = fn
    },
  ).finally(() => {
    handleState.finished = true
  })
  const queue = (token: string, payload: unknown, expire: boolean): Promise<void> => {
    if (handleState.finished) {
      return Promise.reject(
        new ValidationError(
          `graph resume: run completed; start a new run over the same journal to wake '${token}'`,
        ),
      )
    }
    return new Promise<void>((settle, fail) => {
      wakes.push({ token, payload, expire, settle, fail })
      notifyWake?.()
    })
  }
  return {
    done,
    resume: (token, payload) => queue(token, payload, false),
    expire: (token) => queue(token, undefined, true),
  }
}

// ── The run loop ─────────────────────────────────────────────────────────────────

async function runGraphLoop(
  engine: GraphEngine,
  compiled: CompiledGraph,
  task: string,
  options: GraphRunOptions,
  wakes: Array<{
    token: string
    payload?: unknown
    expire: boolean
    settle: () => void
    fail: (e: unknown) => void
  }>,
  _notify: () => void,
  onWakeSignal: (fn: () => void) => void,
): Promise<GraphRunResult> {
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
  const journal = options.journal ?? new InMemorySpawnJournal()
  const blobs = options.blobs ?? new InMemoryResultBlobStore()
  const runId = options.runId ?? `graph:${contentAddress({ task }).slice(0, 18)}`

  // ── Begin or resume the journaled tree ─────────────────────────────────────────
  const prior = await journal.loadTree(runId)
  if (prior !== undefined && options.resume !== true) {
    throw new ValidationError(
      `${context}: runId '${runId}' already exists; pass resume: true to continue it or use a new runId`,
    )
  }
  const resuming = options.resume === true && prior !== undefined && prior.length > 0
  let runEpochMs = now()
  let rootBudget = options.budget
  if (prior === undefined) {
    await journal.beginTree(runId, new Date(runEpochMs).toISOString())
  }
  if (!resuming) {
    // The engine's root marker: the anchor a restart reads the epoch and deadline from, exactly
    // as the kernel supervisor journals its own root. A begun-but-empty journal (killed before
    // its first event) writes it here too.
    await journal.appendEvent(runId, {
      kind: 'spawned',
      id: runId,
      label: 'graph-root',
      budget: options.budget,
      runtime: 'inline',
      seq: 0,
      at: new Date(runEpochMs).toISOString(),
    })
  }
  if (resuming) {
    const root = prior.find((ev) => ev.kind === 'spawned' && ev.id === runId)
    if (root?.kind === 'spawned') {
      runEpochMs = Date.parse(root.at)
      rootBudget = root.budget
    }
  }

  // ── Pool + scope, resume-aware exactly like the kernel supervisor ──────────────
  const elapsed = () => now() - runEpochMs
  const pool = resuming
    ? createBudgetPool(rootBudget, elapsed, {
        committed: (() => {
          const measured = sumMeasuredSpendFromEvents(prior)
          return addSpend(measured.childWork, measured.driverInference)
        })(),
        uncertainReservations: uncertainSpawnBudgets(prior),
        ...(rootBudget.deadlineMs !== undefined
          ? { absoluteDeadlineMs: runEpochMs + rootBudget.deadlineMs }
          : {}),
      })
    : createBudgetPool(rootBudget, elapsed)
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
    ...(resuming
      ? {
          resumeFrom: {
            settled: await replaySpawnTree(journal, blobs, runId),
            view: materializeTreeView(prior),
            maxSpawnOrdinal: maxSeqOf(prior, (ev) => ev.kind === 'spawned'),
            maxCursorSeq: maxSeqOf(prior, closesCursorSlot),
            maxWaitOrdinal: maxSeqOf(prior, (ev) => ev.kind === 'waiting'),
            waits: pendingWaits(prior),
            keys: new Map(),
            priorSpend: sumMeasuredSpendFromEvents(prior),
          },
        }
      : {}),
  })

  // Every path out of this function — a winner, a refusal, a kill at a journal boundary — tears
  // the scope down; a crashed append must never leak live children.
  try {
    return await runToResult()
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort)
    abort.abort('run complete')
  }

  async function runToResult(): Promise<GraphRunResult> {
    // ── State: ONE reducer builds it, live and on restart ──────────────────────────
    const state: GraphFoldState = emptyFoldState(compiled)
    if (resuming) for (const ev of prior) applyGraphFoldEvent(state, ev, compiled)

    let engineSeq = resuming ? maxEngineSeq(prior) + 1 : 0
    let engineWokenSeq =
      ENGINE_WOKEN_SEQ_BASE +
      (resuming
        ? prior.filter((ev) => ev.kind === 'woken' && ev.seq >= ENGINE_WOKEN_SEQ_BASE).length
        : 0)
    const appendAndApply = async (ev: SpawnEvent): Promise<void> => {
      await journal.appendEvent(runId, ev)
      applyGraphFoldEvent(state, ev, compiled)
    }

    const ledger: GraphEdgeTraversal[] = []
    const liveHandles = new Map<string, string>() // scope handle id -> instance label
    const waitingForBudget: string[] = []
    const outCache = new Map<string, unknown>() // outRef -> admitted out, for guard/check evaluation
    let ledgerSeq = resuming ? prior.filter((ev) => ev.kind === 'edge').length : 0
    let liveCount = 0
    let failure: { reason: GraphRunReason; error?: { name: string; message: string } } | undefined

    const recordLedger = async (
      edge: CompiledEdge,
      traversal: number,
      outcome: GraphEdgeTraversal['outcome'],
      reason?: string,
    ): Promise<void> => {
      const spec = edge.spec
      const entry: GraphEdgeTraversal = {
        edge: edge.id,
        kind: spec.kind,
        from: spec.from.node,
        to: spec.to.node,
        traversal,
        outcome,
        ...(spec.directive !== undefined
          ? { directive: `${spec.directive.surface}/v${spec.directive.version}` }
          : {}),
        ...(spec.kind === 'data' ? { port: edge.toPort } : {}),
        ...(reason !== undefined ? { reason } : {}),
      }
      ledger.push(entry)
      await journal.appendEvent(runId, {
        kind: 'edge',
        id: `graph:${spec.to.node}`,
        edge: {
          kind: spec.kind,
          from: spec.from.node,
          to: spec.to.node,
          ...(entry.directive !== undefined ? { directive: entry.directive } : {}),
          ...(entry.port !== undefined ? { port: entry.port } : {}),
        },
        traversal,
        outcome: outcome === 'delivered' ? 'delivered' : outcome,
        bytes: 0,
        ...(reason !== undefined ? { reason } : {}),
        seq: ledgerSeq++,
        at: new Date(now()).toISOString(),
      })
    }

    /** Spawn one released instance from its journaled envelope — the ONE entry path, used for a
     *  fresh release, a budget-parked retry, and a restart re-entry alike. */
    const spawnInstance = async (instanceLabel: string): Promise<void> => {
      if (failure) return
      const instance = state.instances.get(instanceLabel)
      const node = instance === undefined ? undefined : compiled.nodes.get(instance.node)
      if (!instance || !node || instance.inputRef === undefined) {
        throw new ValidationError(`${context}: instance ${instanceLabel} has no journaled envelope`)
      }
      const envelope = (await blobs.get(instance.inputRef)) as
        | { task: string; inputs: Record<string, unknown> }
        | undefined
      if (envelope === undefined) {
        throw new ValidationError(
          `${context}: envelope ${instance.inputRef} is not in the blob store`,
        )
      }
      const effects = narrowEffects(
        node.kind.effects,
        engine.effects,
        `${context}: node ${node.id}`,
      )
      const agent = node.kind.run({
        config: node.config,
        profile: { name: node.id, ...(node.spec.profile ?? {}) },
        inputs: envelope.inputs,
        effects,
      })
      const budget = node.spec.budget ?? (options.perNode as Budget)
      const spawned = scope.spawn(agent, envelope.task, { label: instanceLabel, budget })
      if (spawned.ok) {
        liveCount += 1
        liveHandles.set(spawned.handle.id, instanceLabel)
        applyGraphFoldEvent(
          state,
          // The kernel journaled its own `spawned` row inside `scope.spawn`; mirror the two fields
          // the reducer folds so live state matches what a restart will reconstruct.
          {
            kind: 'spawned',
            id: spawned.handle.id,
            label: instanceLabel,
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
        // Never overcommit: park the entry and retry after the next settle frees capacity (#972).
        waitingForBudget.push(instanceLabel)
        return
      }
      failure = {
        reason: 'driver-failed',
        error: { name: 'SpawnRefused', message: `node ${node.id}: ${spawned.reason}` },
      }
      abort.abort(`spawn refused: ${node.id}`)
    }

    /** Release a node: journal the wave (join-state + envelope) then spawn. */
    const release = async (
      nodeId: string,
      satisfiedBy: CompiledEdge[],
      consumedPending: string[],
    ): Promise<void> => {
      const node = compiled.nodes.get(nodeId)
      const folded = state.nodes.get(nodeId)
      if (!node || !folded) return
      const visit = folded.visits + 1
      if (visit > node.maxVisits) {
        failure = {
          reason: 'cycle-budget-exceeded',
          error: {
            name: 'GraphCycleBudget',
            message: `node ${nodeId} entered ${visit} times; maxVisits ${node.maxVisits}`,
          },
        }
        abort.abort(`cycle-budget-exceeded: ${nodeId}`)
        return
      }
      const instanceLabel = `${nodeId}#${visit}`
      // Build the envelope from the wave: data payloads projected and admitted, directives resolved,
      // trace refs lined up — then pinned by content address BEFORE anything spawns.
      const inputs: Record<string, unknown> = {}
      const directives: string[] = []
      const traces: string[] = []
      for (const edge of satisfiedBy) {
        const foldedEdge = state.edges.get(edge.id)
        const spec = edge.spec
        if (spec.kind === 'data' && foldedEdge?.state === 'satisfied') {
          let payload =
            foldedEdge.payloadRef === undefined ? undefined : outCache.get(foldedEdge.payloadRef)
          if (payload === undefined && foldedEdge.payloadRef !== undefined) {
            payload = admitPayload(await blobs.get(foldedEdge.payloadRef))
          }
          let outcome: GraphEdgeTraversal['outcome'] = 'delivered'
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
          if (payload === undefined && outcome === 'delivered') outcome = 'empty'
          await recordLedger(edge, (foldedEdge?.traversals ?? 0) + 1, outcome, reason)
          if (payload !== undefined) inputs[edge.toPort] = payload
        } else {
          if (spec.directive !== undefined && options.prompts !== undefined) {
            directives.push(options.prompts.resolve(spec.directive).text)
          }
          if (spec.kind === 'analyzes' && foldedEdge?.state === 'satisfied') {
            traces.push(`trace of ${spec.from.node}: ${foldedEdge.payloadRef ?? '(no traceRef)'}`)
          }
          await recordLedger(edge, (foldedEdge?.traversals ?? 0) + 1, 'delivered')
        }
      }
      const nodeTask = [nodeId === compiled.root ? task : '', ...directives, ...traces]
        .filter((part) => part.length > 0)
        .join('\n\n')
      const envelope = { task: nodeTask.length > 0 ? nodeTask : task, inputs }
      const inputRef = contentAddress(envelope)
      await blobs.put(inputRef, envelope)
      const at = new Date(now()).toISOString()
      await appendAndApply({
        kind: 'node-inputs-resolved',
        id: instanceLabel,
        node: nodeId,
        instance: instanceLabel,
        inputRef,
        seq: engineSeq++,
        at,
      })
      await appendAndApply({
        kind: 'join-state',
        id: instanceLabel,
        node: nodeId,
        rule: node.join,
        satisfiedBy: satisfiedBy.map((edge) => edge.id),
        consumedPending,
        instance: instanceLabel,
        seq: engineSeq++,
        at,
      })
      await spawnInstance(instanceLabel)
    }

    /** Join evaluation per ADC's rules over the folded edge states. */
    const tryRelease = async (nodeId: string): Promise<void> => {
      const node = compiled.nodes.get(nodeId)
      const folded = state.nodes.get(nodeId)
      if (!node || !folded || folded.blocked || failure) return
      const gating = node.inbound
      if (gating.length === 0) return
      const states = gating.map((edge) => ({ edge, folded: state.edges.get(edge.id) }))
      const settled = states.filter((entry) => entry.folded && entry.folded.state !== 'pending')
      const satisfied = states.filter((entry) => entry.folded?.state === 'satisfied')
      const failed = states.filter((entry) => entry.folded?.state === 'failed')
      const allSettled = settled.length === gating.length
      let releaseNow = false
      switch (node.join) {
        case 'all':
          releaseNow =
            satisfied.length === gating.length &&
            !states.some(
              (entry) => entry.folded?.state === 'dead' || entry.folded?.state === 'failed',
            )
          break
        case 'any':
          releaseNow = satisfied.length > 0
          if (!releaseNow && allSettled) folded.blocked = true
          break
        case 'any_failed':
          releaseNow = failed.length > 0
          if (!releaseNow && allSettled) folded.blocked = true
          break
        case 'all_done':
          releaseNow = allSettled
          break
      }
      if (!releaseNow) return
      const consuming =
        node.join === 'any'
          ? [satisfied[0] as (typeof states)[number]]
          : node.join === 'any_failed'
            ? [failed[0] as (typeof states)[number]]
            : settled
      // Caps judged on the consuming edges BEFORE anything else happens; a refusal is fold-visible.
      for (const entry of consuming) {
        const cap = entry.edge.spec.maxTraversals
        if (cap !== undefined && (entry.folded?.traversals ?? 0) >= cap) {
          recordLedger(
            entry.edge,
            (entry.folded?.traversals ?? 0) + 1,
            'unpropagated',
            `traversal-cap-exhausted (max ${cap})`,
          )
          await appendAndApply({
            kind: 'edge-verdict',
            id: `graph:${nodeId}`,
            edge: entry.edge.id,
            fired: false,
            sourceStatus: 'done',
            capped: true,
            seq: engineSeq++,
            at: new Date(now()).toISOString(),
          })
          return
        }
      }
      const consumedPending = states
        .filter(
          (entry) =>
            entry.folded?.state === 'pending' &&
            hasLiveInstance(state, liveHandles, entry.edge.spec.from.node),
        )
        .map((entry) => entry.edge.id)
      await release(
        nodeId,
        consuming.map((entry) => entry.edge),
        consumedPending,
      )
    }

    /** Judge every outbound edge of a settle: journal the verdict, apply, then try the joins. */
    const propagate = async (instanceLabel: string, settle: GraphNodeSettle): Promise<void> => {
      const node = compiled.nodes.get(settle.node)
      if (!node) return
      const succeeded = settle.status === 'done' && settle.valid !== false
      const sourceSettles = state.nodes.get(settle.node)?.settles.length ?? 0
      for (const edge of node.outbound) {
        const folded = state.edges.get(edge.id)
        if (!folded) continue
        if (folded.judgedSourceSettles >= sourceSettles) {
          // Accounted — by an earlier verdict, or absorbed by the wave that consumed it. This is
          // what makes propagate idempotent, so a restart may re-propagate every settled node.
          continue
        }
        let fired = false
        let inputRef: string | undefined
        if (succeeded) {
          const guardContext = {
            node: settle.node,
            out: settle.out,
            visits: state.nodes.get(settle.node)?.visits ?? 0,
            valid: settle.valid ?? true,
          }
          fired = edge.spec.guard === undefined || evaluateCondition(edge.spec.guard, guardContext)
          if (fired) {
            inputRef =
              edge.spec.kind === 'analyzes'
                ? ((settle as { traceRef?: string }).traceRef ?? undefined)
                : settle.outRef
          }
        }
        await appendAndApply({
          kind: 'edge-verdict',
          id: instanceLabel,
          edge: edge.id,
          fired,
          sourceStatus: settle.status === 'down' ? 'down' : succeeded ? 'done' : 'invalid',
          ...(inputRef !== undefined ? { inputRef } : {}),
          seq: engineSeq++,
          at: new Date(now()).toISOString(),
        })
      }
      for (const edge of node.outbound) await tryRelease(edge.spec.to.node)
    }

    // ── Suspensions (#976) ─────────────────────────────────────────────────────────
    const mintToken = (instanceLabel: string): string =>
      contentAddress({ runId, instance: instanceLabel, kind: 'graph-suspension' })

    const journalSuspension = async (
      instanceLabel: string,
      request: SuspensionRequest,
    ): Promise<void> => {
      const token = mintToken(instanceLabel)
      let defaultRef: string | undefined
      if (request.default !== undefined) {
        const admitted = admitPayload(request.default)
        defaultRef = contentAddress(admitted)
        await blobs.put(defaultRef, admitted)
      }
      await appendAndApply({
        kind: 'waiting',
        id: `graphwait:${token}`,
        label: instanceLabel,
        spec: {
          kind: 'token',
          token,
          onExpire: request.onExpire,
          ...(request.expiresInMs !== undefined
            ? { expiresAtMs: now() + request.expiresInMs }
            : {}),
          ...(defaultRef !== undefined ? { defaultRef } : {}),
        },
        armedAt: now(),
        seq: engineSeq++,
        at: new Date(now()).toISOString(),
      })
    }

    const wake = async (
      suspension: FoldSuspension,
      by: 'fired' | 'expired',
      outRef?: string,
    ): Promise<void> => {
      await appendAndApply({
        kind: 'woken',
        id: `graphwait:${suspension.token}`,
        by,
        ...(outRef !== undefined ? { outRef } : {}),
        seq: engineWokenSeq++,
        at: new Date(now()).toISOString(),
      })
      const settle = state.instances.get(suspension.instance)?.settle
      if (settle !== undefined) {
        const enriched: GraphNodeSettle = {
          ...settle,
          ...(settle.outRef !== undefined
            ? { out: admitPayload(await blobs.get(settle.outRef)) }
            : {}),
        }
        if (enriched.outRef !== undefined && enriched.out !== undefined)
          outCache.set(enriched.outRef, enriched.out)
        await propagate(suspension.instance, enriched)
      }
    }

    /** Expiries are engine-clocked: judged on every loop turn and before parking (#976). */
    const sweepExpiries = async (): Promise<void> => {
      for (const suspension of [...state.suspensions.values()]) {
        if (suspension.status !== 'pending') continue
        if (suspension.expiresAtMs === undefined || now() < suspension.expiresAtMs) continue
        if (suspension.onExpire === 'fail') await wake(suspension, 'expired')
        else if (suspension.onExpire === 'default')
          await wake(suspension, 'fired', suspension.defaultRef)
      }
    }

    const processWakes = async (): Promise<void> => {
      while (wakes.length > 0) {
        const request = wakes.shift()
        if (!request) break
        try {
          const suspension = state.suspensions.get(request.token)
          if (!suspension) {
            throw new ValidationError(`graph resume: unknown token '${request.token}'`)
          }
          if (suspension.status !== 'pending') {
            throw new ValidationError(`graph resume: token '${request.token}' already woken`)
          }
          if (request.expire) {
            if (suspension.onExpire === 'fail') await wake(suspension, 'expired')
            else if (suspension.onExpire === 'default')
              await wake(suspension, 'fired', suspension.defaultRef)
            else await wake(suspension, 'expired')
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

    // ── Settle handling ────────────────────────────────────────────────────────────
    const handleSettle = async (settled: Settled<unknown>): Promise<void> => {
      const instanceLabel = liveHandles.get(settled.handle.id)
      if (instanceLabel === undefined) return
      liveHandles.delete(settled.handle.id)
      liveCount -= 1
      const instance = state.instances.get(instanceLabel)
      const node = instance === undefined ? undefined : compiled.nodes.get(instance.node)
      if (!instance || !node) return
      if (settled.kind === 'done' && isSuspensionRequest(settled.out)) {
        await journalSuspension(instanceLabel, settled.out)
        return
      }
      // Mirror the kernel's own journaled settle through the reducer, then enrich for judging.
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
      const folded = state.instances.get(instanceLabel)?.settle
      if (!folded) return
      let enriched: GraphNodeSettle = folded
      if (settled.kind === 'done') {
        const admitted = admitPayload(settled.out)
        if (settled.outRef !== undefined) outCache.set(settled.outRef, admitted)
        let valid: boolean | undefined
        if (node.deliverable !== undefined) {
          try {
            valid = await node.deliverable.check(admitted)
          } catch {
            valid = false
          }
        }
        enriched = { ...folded, out: admitted, ...(valid !== undefined ? { valid } : {}) }
        ;(state.instances.get(instanceLabel) as { settle?: GraphNodeSettle }).settle = enriched
        const settles = state.nodes.get(instance.node)?.settles
        if (settles) settles[settles.length - 1] = enriched
      }
      // Root completion ends the run the moment its check passes (#973).
      if (
        instance.node === compiled.root &&
        enriched.status === 'done' &&
        enriched.valid === true
      ) {
        abort.abort('root delivered')
        return
      }
      await propagate(instanceLabel, enriched)
    }

    // ── Entry / restart ────────────────────────────────────────────────────────────
    const enterEntryNode = async (nodeId: string): Promise<void> => {
      const folded = state.nodes.get(nodeId)
      if (!folded) return
      const visit = folded.visits + 1
      const node = compiled.nodes.get(nodeId)
      if (!node) return
      if (visit > node.maxVisits) return
      const instanceLabel = `${nodeId}#${visit}`
      const envelope = { task, inputs: {} as Record<string, unknown> }
      const inputRef = contentAddress(envelope)
      await blobs.put(inputRef, envelope)
      await appendAndApply({
        kind: 'node-inputs-resolved',
        id: instanceLabel,
        node: nodeId,
        instance: instanceLabel,
        inputRef,
        seq: engineSeq++,
        at: new Date(now()).toISOString(),
      })
      await spawnInstance(instanceLabel)
    }

    if (!resuming) {
      for (const id of compiled.entries) await enterEntryNode(id)
    } else {
      // Kill-anywhere re-entry: a released instance that never spawned re-enters from its envelope;
      // an in-flight instance at the crash is in-doubt and re-enters per its kind's `onCrash` —
      // both from the pinned `inputRef`, never through re-derivation (#974).
      for (const instance of [...state.instances.values()]) {
        if (instance.status === 'released') await spawnInstance(instance.instance)
        else if (instance.status === 'live') {
          const node = compiled.nodes.get(instance.node)
          const folded = state.nodes.get(instance.node)
          if (!node || !folded) continue
          const visit = folded.visits + 1
          if (visit > node.maxVisits) {
            failure = {
              reason: 'cycle-budget-exceeded',
              error: {
                name: 'GraphCycleBudget',
                message: `node ${instance.node} entered ${visit} times; maxVisits ${node.maxVisits}`,
              },
            }
            break
          }
          const restartLabel = `${instance.node}#${visit}`
          instance.status = 'down' // in-doubt: the journal's reservation stays charged (kernel rule)
          const at = new Date(now()).toISOString()
          await journal.appendEvent(runId, {
            kind: 'node-inputs-resolved',
            id: restartLabel,
            node: instance.node,
            instance: restartLabel,
            inputRef: instance.inputRef as string,
            seq: engineSeq++,
            at,
          })
          applyGraphFoldEvent(
            state,
            {
              kind: 'node-inputs-resolved',
              id: restartLabel,
              node: instance.node,
              instance: restartLabel,
              inputRef: instance.inputRef as string,
              seq: 0,
              at,
            },
            compiled,
          )
          await spawnInstance(restartLabel)
        }
      }
      // A settle whose verdicts never landed (killed between the kernel settle and the engine's
      // propagate) is re-judged now; `judgedSourceSettles` makes this a no-op for judged edges.
      for (const [nodeId, foldedNode] of state.nodes) {
        const latest = foldedNode.settles.at(-1)
        if (latest === undefined) continue
        const instanceLabel = `${nodeId}#${latest.visit}`
        let enriched: GraphNodeSettle = latest
        if (latest.status === 'done' && latest.outRef !== undefined) {
          const out = admitPayload(await blobs.get(latest.outRef))
          if (isSuspensionRequest(out)) {
            // Killed between the kernel settle and the `waiting` event: finish the half-done
            // transition now instead of propagating the marker as data.
            foldedNode.settles.pop()
            const instance = state.instances.get(instanceLabel)
            if (instance) instance.settle = undefined
            await journalSuspension(instanceLabel, out)
            continue
          }
          outCache.set(latest.outRef, out)
          const nodeSpec = compiled.nodes.get(nodeId)
          let valid: boolean | undefined
          if (nodeSpec?.deliverable !== undefined) {
            try {
              valid = await nodeSpec.deliverable.check(out)
            } catch {
              valid = false
            }
          }
          enriched = { ...latest, out, ...(valid !== undefined ? { valid } : {}) }
        }
        await propagate(instanceLabel, enriched)
      }
      // An entry node the crashed process never released enters now — run start is its release.
      for (const id of compiled.entries) {
        if ((state.nodes.get(id)?.visits ?? 0) === 0) await enterEntryNode(id)
      }
      // A restart may also land after new settles are already judged: re-try every join once.
      for (const id of compiled.nodes.keys()) await tryRelease(id)
    }

    // ── The loop ───────────────────────────────────────────────────────────────────
    const allTerminalsSettled = () =>
      compiled.terminals.every((id) => (state.nodes.get(id)?.settles.length ?? 0) > 0)

    let wakeSignal: Promise<void> = Promise.resolve()
    let armWake: () => void = () => {}
    const rearmWakeSignal = () => {
      wakeSignal = new Promise<void>((fire) => {
        armWake = fire
      })
      onWakeSignal(() => armWake())
    }
    rearmWakeSignal()

    let inFlightNext: Promise<Settled<unknown> | null> | undefined
    while (!failure) {
      await sweepExpiries()
      if (wakes.length > 0) {
        await processWakes()
        continue
      }
      if (allTerminalsSettled()) break
      if (liveCount === 0) {
        const pendingSuspensions = [...state.suspensions.values()].filter(
          (suspension) => suspension.status === 'pending',
        )
        if (pendingSuspensions.length > 0) {
          const nearest = Math.min(
            ...pendingSuspensions.map(
              (suspension) => suspension.expiresAtMs ?? Number.POSITIVE_INFINITY,
            ),
          )
          if (Number.isFinite(nearest) && now() >= nearest) continue // sweep will transition it
          if (options.waitForWakes) {
            rearmWakeSignal()
            await wakeSignal
            continue
          }
          // Offline (#976): no host will ever answer, so an `onExpire: 'default'` suspension
          // auto-resolves with its default now; `wait` and a future `fail` deadline park the run.
          const defaulting = pendingSuspensions.filter(
            (suspension) => suspension.onExpire === 'default',
          )
          if (defaulting.length > 0) {
            for (const suspension of defaulting)
              await wake(suspension, 'fired', suspension.defaultRef)
            continue
          }
          break // fully parked: a legitimate offline terminal state
        }
        break // stuck or complete: classified below
      }
      inFlightNext ??= scope.next()
      const raced = await Promise.race([
        inFlightNext.then((settle) => ({ settle })),
        wakeSignal.then(() => 'wake' as const),
      ])
      if (raced === 'wake') {
        rearmWakeSignal()
        continue // wakes queue processed on the next turn; inFlightNext stays armed
      }
      inFlightNext = undefined
      if (raced.settle === null) break
      await handleSettle(raced.settle)
      for (const parked of waitingForBudget.splice(0)) await spawnInstance(parked)
    }

    abort.abort('graph loop complete')
    while ((await (inFlightNext ?? scope.next())) !== null) inFlightNext = undefined

    // ── Result assembly ────────────────────────────────────────────────────────────
    const rehydrate = async (settle: GraphNodeSettle): Promise<GraphNodeSettle> => {
      if (settle.out !== undefined || settle.outRef === undefined) return settle
      const out = outCache.get(settle.outRef) ?? admitPayload(await blobs.get(settle.outRef))
      const node = compiled.nodes.get(settle.node)
      let valid = settle.valid
      if (valid === undefined && node?.deliverable !== undefined && settle.status === 'done') {
        try {
          valid = await node.deliverable.check(out)
        } catch {
          valid = false
        }
      }
      return { ...settle, out, ...(valid !== undefined ? { valid } : {}) }
    }
    const settles = await Promise.all(
      [...compiled.nodes.keys()].flatMap((id) => state.nodes.get(id)?.settles ?? []).map(rehydrate),
    )
    const terminals = settles.filter((settle) => compiled.nodes.get(settle.node)?.terminal)

    const finish = (result: GraphRunResult): GraphRunResult => {
      if (result.kind === 'no-winner' && state.exhaustedEdges.size > 0) {
        throw new GraphEdgeCapError(
          Object.freeze([...state.exhaustedEdges]),
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
    const pendingTokens = [...state.suspensions.values()]
      .filter((suspension) => suspension.status === 'pending')
      .map((suspension) => suspension.token)
    if (pendingTokens.length > 0 && !allTerminalsSettled()) {
      return { kind: 'suspended', tokens: pendingTokens, terminals, settles, ledger }
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
    const anyDelivered = terminals.some(
      (settle) => settle.status === 'done' && settle.valid !== false,
    )
    const out = anyDelivered
      ? await runFinalizer(
          options.finalizer === undefined || options.finalizer === 'bestDelivered'
            ? bestDelivered
            : options.finalizer === 'collectDelivered'
              ? collectDelivered
              : options.finalizer,
          {
            settled: terminals.map(
              (settle): FinalizerSettled => ({
                id: settle.node,
                status: settle.status,
                valid: settle.status === 'done' && settle.valid !== false,
                ...(settle.outRef !== undefined ? { outRef: settle.outRef } : {}),
              }),
            ),
            blobs,
            tree: scope.view,
            budget: scope.budget,
          },
        )
      : undefined
    if (out !== undefined) return { kind: 'winner', out, terminals, settles, ledger }
    const unreachable = [...compiled.nodes.keys()].filter(
      (id) => (state.nodes.get(id)?.settles.length ?? 0) === 0,
    )
    const reason: GraphRunReason = compiled.terminals.some((id) => unreachable.includes(id))
      ? unreachable.length === compiled.nodes.size
        ? 'budget-exhausted'
        : 'unreachable-terminal'
      : 'all-children-down'
    return finish({ kind: 'no-winner', reason, terminals, settles, ledger, unreachable })
  }
}

// ── Small helpers ────────────────────────────────────────────────────────────────

function hasLiveInstance(
  state: GraphFoldState,
  liveHandles: Map<string, string>,
  node: string,
): boolean {
  for (const label of liveHandles.values()) {
    if (state.instances.get(label)?.node === node) return true
  }
  return false
}

function maxEngineSeq(events: ReadonlyArray<SpawnEvent>): number {
  let max = -1
  for (const ev of events) {
    if (
      ev.kind === 'node-inputs-resolved' ||
      ev.kind === 'edge-verdict' ||
      ev.kind === 'join-state'
    ) {
      if (ev.seq > max) max = ev.seq
    }
    if (ev.kind === 'waiting' && ev.spec.kind === 'token' && ev.seq > max) max = ev.seq
  }
  return max
}
