/**
 *
 * Event-sourced spawn journal for the recursive execution atom (build steps 3 + 7).
 *
 * The supervision tree is journaled as an append-only event log: every `spawned`,
 * `settled`, and `cancelled` is recorded AFTER it is observed-committed (never
 * speculative), mirroring `ConversationJournal`'s begin/append/load shape. The log
 * holds only the THIN decision record — ids, parentage, budget, the spend a decision
 * consumed, and a content-addressed `outRef`. The payloads the driver branched on
 * (the `out` artifacts) live in a separate `ResultBlobStore`, keyed by `outRef`, so
 * the journal stays small (decisions) and replay rehydrates the exact `Settled` from
 * the blob store (evidence). This is the decision/payload split the replay argument
 * rests on (B1/B2).
 *
 * Replay determinism (B2): `seq` is the monotonic cursor order `scope.next()` yielded
 * each settlement — NOT wall-clock. `replaySpawnTree` sorts strictly by `seq` before
 * touching the blob store, so the order in which rehydration `get`s resolve can never
 * reorder the replayed `Settled[]`; the result is identical regardless of blob latency.
 *
 * @stable
 */

import { detachedSnapshot } from '../runtime/supervise/snapshot'
import { workerTraceAnalysisStore } from '../runtime/supervise/trace-evidence'
import { nestedDriverTreeRoot } from '../runtime/supervise/tree-key'
import type {
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ResultBlobStore,
  Runtime,
  Settled,
  SpawnEvent,
  SpawnJournal,
  Spend,
  TreeView,
} from '../runtime/supervise/types'
import type { PendingWait } from '../runtime/supervise/wait'
import { zeroTokenUsage } from '../runtime/util'
import { contentAddress } from './content-address'
import { parseCommittedJsonLines, prepareJsonlAppend, writeAllBytes } from './jsonl-file'

export { contentAddress } from './content-address'

/** One journal tree in a recursively loaded supervision forest. */
export interface SpawnForestTree {
  readonly root: NodeId
  /** Driver node that owns this tree; absent for the requested root tree. */
  readonly ownerNodeId?: NodeId
  /** Journal tree containing `ownerNodeId`; absent for the requested root tree. */
  readonly parentTreeRoot?: NodeId
  readonly events: ReadonlyArray<SpawnEvent>
  readonly view: TreeView
}

/** One event with the journal tree that establishes its cursor namespace. */
export interface SpawnForestEvent {
  readonly treeRoot: NodeId
  readonly event: SpawnEvent
}

/** One flattened node with the journal tree that owns its records. */
export interface SpawnForestNode extends NodeSnapshot {
  readonly treeRoot: NodeId
}

/** A spawned worker with no terminal record in a cold snapshot. Resume treats the same state as
 * in-doubt and conservatively retains its reservation. Root nodes and armed waits are excluded. */
export interface SpawnForestInDoubtNode {
  readonly treeRoot: NodeId
  readonly nodeId: NodeId
  readonly label: string
  readonly runtime: Runtime
}

/** A driver spawn whose owned journal tree was never begun before the process stopped. */
export interface SpawnForestMissingTree {
  readonly parentTreeRoot: NodeId
  readonly ownerNodeId: NodeId
  readonly root: NodeId
}

/** Complete cold-readable view of one recursive supervision run. */
export interface SpawnForest {
  readonly root: NodeId
  readonly trees: ReadonlyArray<SpawnForestTree>
  readonly nodes: ReadonlyArray<SpawnForestNode>
  readonly events: ReadonlyArray<SpawnForestEvent>
  readonly inDoubt: ReadonlyArray<SpawnForestInDoubtNode>
  readonly missingTrees: ReadonlyArray<SpawnForestMissingTree>
}

// ── Content addressing ──────────────────────────────────────────────────────

/**
 * Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a
 * stable JSON encoding. Producers call this to derive the `outRef` they journal and
 * `put`; the FS/in-mem stores re-derive it on `put` to verify the supplied ref
 * matches (fail loud on a mismatch — a forged ref breaks the replay invariant).
 *
 * Stable encoding: object keys are sorted recursively so two structurally-equal
 * artifacts hash identically regardless of key insertion order.
 */
// ── Result blob store ─────────────────────────────────────────────────────────

/**
 * In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied
 * `outRef` matches the artifact's hash so a stale/forged ref fails loud rather than
 * silently rehydrating the wrong payload. Idempotent on an identical re-put.
 *
 * @stable
 */
export class InMemoryResultBlobStore implements ResultBlobStore {
  private readonly blobs = new Map<string, unknown>()

  async put(outRef: string, artifact: unknown): Promise<void> {
    assertContentAddress(outRef, artifact)
    this.blobs.set(outRef, artifact)
  }

  async get(outRef: string): Promise<unknown | undefined> {
    return this.blobs.has(outRef) ? this.blobs.get(outRef) : undefined
  }
}

/**
 * FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
 * filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
 * `put` fsyncs so a crash between writes never loses an acknowledged blob.
 *
 * @stable
 */
export class FileResultBlobStore implements ResultBlobStore {
  constructor(private readonly dir: string) {}

  async put(outRef: string, artifact: unknown): Promise<void> {
    assertContentAddress(outRef, artifact)
    const fs = await import('node:fs/promises')
    await fs.mkdir(this.dir, { recursive: true })
    const fh = await fs.open(this.blobPath(outRef), 'w')
    try {
      await fh.write(JSON.stringify(artifact))
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  async get(outRef: string): Promise<unknown | undefined> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.blobPath(outRef), 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return undefined
      throw err
    }
    return JSON.parse(text)
  }

  private blobPath(outRef: string): string {
    return `${this.dir}/${outRef.replace(/:/g, '-')}.json`
  }
}

function assertContentAddress(outRef: string, artifact: unknown): void {
  const expected = contentAddress(artifact)
  if (outRef !== expected) {
    throw new Error(
      `blob outRef '${outRef}' does not match the artifact content hash '${expected}'; ` +
        'a content-addressed store refuses a mismatched ref (breaks the replay invariant)',
    )
  }
}

// ── Spawn journal ──────────────────────────────────────────────────────────────

/**
 * In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces
 * the corruption guards a durable replay rests on:
 *  - an event before `beginTree` is a corrupted tree (fail loud),
 *  - a duplicate `seq` within a tree is a corrupted cursor (fail loud) — two
 *    settlements cannot share the cursor position replay orders by.
 *
 * @stable
 */
export class InMemorySpawnJournal implements SpawnJournal {
  private readonly trees = new Map<NodeId, { begunAt: string; events: SpawnEvent[] }>()

  async loadTree(root: NodeId): Promise<SpawnEvent[] | undefined> {
    const tree = this.trees.get(root)
    if (!tree) return undefined
    return tree.events.map((ev) => ({ ...ev }))
  }

  async beginTree(root: NodeId, at: string): Promise<void> {
    const existing = this.trees.get(root)
    if (existing) {
      if (existing.begunAt !== at) {
        throw new Error(
          `spawn tree '${root}' already begun at ${existing.begunAt}; refusing to overwrite with ${at}`,
        )
      }
      return
    }
    this.trees.set(root, { begunAt: at, events: [] })
  }

  async appendEvent(root: NodeId, ev: SpawnEvent): Promise<void> {
    const tree = this.trees.get(root)
    if (!tree) {
      throw new Error(`appendEvent called for unknown spawn tree '${root}'; call beginTree first`)
    }
    assertSeqUnique(root, tree.events, ev)
    tree.events.push({ ...ev })
  }
}

/**
 * JSONL on disk. One line per record: the first record is `begin`, subsequent records
 * are `event` envelopes wrapping a `SpawnEvent`. `loadTree` replays the whole file,
 * filtering by `root`, and applies the same begin-precedes-events + unique-seq
 * corruption guards as the in-memory impl. Each append fsyncs so a crash between
 * writes never loses an acknowledged event.
 *
 * @stable
 */
export class FileSpawnJournal implements SpawnJournal {
  private appendTail: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async loadTree(root: NodeId): Promise<SpawnEvent[] | undefined> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return undefined
      throw err
    }
    let begun = false
    const events: SpawnEvent[] = []
    for (const record of parseCommittedJsonLines<SpawnJournalRecord>(text, this.path)) {
      if (record.root !== root) continue
      if (record.kind === 'begin') {
        begun = true
      } else {
        if (!begun) {
          throw new Error(
            `spawn journal corrupted: event for tree '${root}' precedes its begin record`,
          )
        }
        assertSeqUnique(root, events, record.event)
        events.push(record.event)
      }
    }
    return begun ? events : undefined
  }

  async beginTree(root: NodeId, at: string): Promise<void> {
    const existing = await this.loadTreeBegin(root)
    if (existing) {
      if (existing !== at) {
        throw new Error(
          `spawn tree '${root}' already begun in ${this.path} at ${existing}; refusing to overwrite with ${at}`,
        )
      }
      return
    }
    await this.appendRecord({ kind: 'begin', root, at })
  }

  async appendEvent(root: NodeId, ev: SpawnEvent): Promise<void> {
    const events = await this.loadTree(root)
    if (events === undefined) {
      throw new Error(`appendEvent called for unknown spawn tree '${root}'; call beginTree first`)
    }
    assertSeqUnique(root, events, ev)
    await this.appendRecord({ kind: 'event', root, event: ev })
  }

  private async loadTreeBegin(root: NodeId): Promise<string | undefined> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return undefined
      throw err
    }
    for (const record of parseCommittedJsonLines<SpawnJournalRecord>(text, this.path)) {
      if (record.root === root && record.kind === 'begin') return record.at
    }
    return undefined
  }

  private async appendRecord(record: SpawnJournalRecord): Promise<void> {
    const append = this.appendTail.then(() => this.writeRecord(record))
    this.appendTail = append.catch(() => undefined)
    return append
  }

  private async writeRecord(record: SpawnJournalRecord): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const needsSeparator = await prepareJsonlAppend(this.path)
    const fh = await fs.open(this.path, 'a')
    try {
      await writeAllBytes(fh, `${needsSeparator ? '\n' : ''}${JSON.stringify(record)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }
}

/**
 * Load every journal tree owned by one recursive supervision run and flatten its nodes/events.
 *
 * Nested driver tree keys are a Runtime implementation detail; callers should use this reader
 * instead of deriving or scanning keys themselves. The reader follows only the explicit
 * `ownedTreeRoot` written after Runtime privately attested a recursive executor; the open runtime
 * string `driver` is never treated as ownership. Legacy records without `ownedTreeRoot` are
 * intentionally treated as leaves rather than guessing or scanning convention-derived keys.
 * This preserves each tree's independent cursor namespace on flattened events.
 * A driver whose subtree was never begun is reported in `missingTrees`; any spawned non-root node
 * without a terminal record is reported in `inDoubt`, matching resume's conservative lost-work
 * interpretation.
 *
 * This is a cold/quiescent reader, not a transaction across an actively mutating file. Every value
 * returned is a detached immutable snapshot, so later journal writes or caller mutation cannot
 * change the result already observed.
 */
export async function loadSpawnForest(journal: SpawnJournal, root: NodeId): Promise<SpawnForest> {
  const rootEvents = await journal.loadTree(root)
  if (rootEvents === undefined) {
    throw new Error(`loadSpawnForest: no journaled tree for root '${root}'`)
  }

  const trees: SpawnForestTree[] = []
  const nodes: SpawnForestNode[] = []
  const events: SpawnForestEvent[] = []
  const inDoubt: SpawnForestInDoubtNode[] = []
  const missingTrees: SpawnForestMissingTree[] = []
  const visited = new Set<NodeId>()
  const queue: Array<{
    readonly root: NodeId
    readonly events: SpawnEvent[]
    readonly ownerNodeId?: NodeId
    readonly parentTreeRoot?: NodeId
  }> = [{ root, events: rootEvents }]

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!
    if (visited.has(current.root)) {
      throw new Error(`loadSpawnForest: recursive journal tree '${current.root}' was reached twice`)
    }
    visited.add(current.root)
    const stableEvents = detachedSnapshot(
      current.events,
      `loadSpawnForest tree ${JSON.stringify(current.root)}`,
    )
    const view = detachedSnapshot(
      materializeTreeView([...stableEvents]),
      `loadSpawnForest view ${JSON.stringify(current.root)}`,
    )
    trees.push({
      root: current.root,
      ...(current.ownerNodeId === undefined ? {} : { ownerNodeId: current.ownerNodeId }),
      ...(current.parentTreeRoot === undefined ? {} : { parentTreeRoot: current.parentTreeRoot }),
      events: stableEvents,
      view,
    })
    nodes.push(...view.nodes.map((node) => ({ treeRoot: current.root, ...node })))
    events.push(...stableEvents.map((event) => ({ treeRoot: current.root, event })))

    const terminal = new Set<NodeId>()
    for (const event of stableEvents) {
      if (event.kind === 'settled' || event.kind === 'cancelled') terminal.add(event.id)
    }
    const spawns = stableEvents
      .filter(
        (event): event is Extract<SpawnEvent, { kind: 'spawned' }> => event.kind === 'spawned',
      )
      .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
    for (const spawn of spawns) {
      if (spawn.parent !== undefined && !terminal.has(spawn.id)) {
        inDoubt.push({
          treeRoot: current.root,
          nodeId: spawn.id,
          label: spawn.label,
          runtime: spawn.runtime,
        })
      }
      if (spawn.ownedTreeRoot === undefined) continue
      const expectedRoot = nestedDriverTreeRoot(current.root, spawn.id)
      if (spawn.ownedTreeRoot !== expectedRoot) {
        throw new Error(
          `loadSpawnForest: node '${spawn.id}' owns non-canonical tree '${spawn.ownedTreeRoot}'; expected '${expectedRoot}'`,
        )
      }
      const nestedRoot = spawn.ownedTreeRoot
      const nestedEvents = await journal.loadTree(nestedRoot)
      if (nestedEvents === undefined) {
        missingTrees.push({
          parentTreeRoot: current.root,
          ownerNodeId: spawn.id,
          root: nestedRoot,
        })
        continue
      }
      queue.push({
        root: nestedRoot,
        events: nestedEvents,
        ownerNodeId: spawn.id,
        parentTreeRoot: current.root,
      })
    }
  }

  return detachedSnapshot(
    { root, trees, nodes, events, inDoubt, missingTrees },
    'loadSpawnForest result',
  )
}

type SpawnJournalRecord =
  | { kind: 'begin'; root: NodeId; at: string }
  | { kind: 'event'; root: NodeId; event: SpawnEvent }

/**
 * Two `seq` namespaces share the journal: a `spawned` event's `seq` is the spawn ordinal
 * (the order children were created), and a `settled`/`cancelled` event's `seq` is the
 * monotonic CURSOR order `scope.next()` yielded that settlement (B2). The uniqueness
 * replay rests on is the cursor namespace — two settlements cannot share the position
 * replay orders by — so the guard checks only settled/cancelled events. A `spawned`
 * ordinal legitimately equals a later `settled` cursor seq and is not a collision.
 */
function assertSeqUnique(root: NodeId, events: SpawnEvent[], ev: SpawnEvent): void {
  if (ev.kind === 'materialized') {
    if (events.some((event) => event.kind === 'materialized' && event.id === ev.id)) {
      throw new Error(
        `spawn journal corrupted: duplicate materialization receipt for node '${ev.id}' in tree '${root}'`,
      )
    }
    if (!events.some((event) => event.kind === 'spawned' && event.id === ev.id)) {
      throw new Error(
        `spawn journal corrupted: materialization for node '${ev.id}' precedes its spawn in tree '${root}'`,
      )
    }
  }
  if (ev.kind === 'execution-bound') {
    if (
      events.some(
        (event) =>
          event.kind === 'execution-bound' &&
          event.id === ev.id &&
          event.binding.attemptId === ev.binding.attemptId,
      )
    ) {
      throw new Error(
        `spawn journal corrupted: duplicate execution binding for node '${ev.id}' attempt '${ev.binding.attemptId}' in tree '${root}'`,
      )
    }
    if (!events.some((event) => event.kind === 'materialized' && event.id === ev.id)) {
      throw new Error(
        `spawn journal corrupted: execution binding for node '${ev.id}' precedes materialization in tree '${root}'`,
      )
    }
  }
  // `spawned` (ordinal namespace), `waiting` (the wait-ordinal namespace — it CREATES a node, it
  // does not settle one), and `metered` (informational spend, no settlement order) live outside
  // the cursor-uniqueness namespace replay relies on. `woken` IS a settlement and does not.
  if (outsideCursorNamespace(ev)) return
  if (events.some((e) => !outsideCursorNamespace(e) && e.seq === ev.seq)) {
    throw new Error(
      `spawn journal corrupted: duplicate cursor seq ${ev.seq} in tree '${root}'; ` +
        'the cursor order replay relies on is not unique',
    )
  }
}

/** Node-CREATION and informational records — outside the cursor namespace whose uniqueness replay
 *  ordering rests on. The single predicate both the guard's sides read, so a new event kind is
 *  classified once. */
function outsideCursorNamespace(ev: SpawnEvent): boolean {
  return (
    ev.kind === 'spawned' ||
    ev.kind === 'waiting' ||
    ev.kind === 'metered' ||
    ev.kind === 'materialized' ||
    ev.kind === 'execution-bound' ||
    ev.kind === 'edge' ||
    ev.kind === 'trace-unpropagated'
  )
}

// ── Replay executor (build step 7) ───────────────────────────────────────────────

/**
 * Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled
 * child's `out` from the blob store by `outRef`, and return the `Settled[]` exactly
 * as `scope.next()` originally delivered them.
 *
 * Determinism (B2): the events are sorted by `seq` BEFORE any blob `get`, so the
 * replay order is the recorded cursor order regardless of how fast each rehydration
 * resolves. `at` (wall-clock) is never a replay input. Fail loud on a tree that was
 * never begun, a settled-done event missing its `outRef`, or a blob the store can't
 * rehydrate — a silent gap would let `act` branch on the wrong evidence.
 *
 * @stable
 */
export async function replaySpawnTree(
  journal: SpawnJournal,
  blobs: ResultBlobStore,
  root: NodeId,
): Promise<Settled<unknown>[]> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new Error(`replaySpawnTree: no journaled tree for root '${root}'`)
  }
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const labels = new Map<NodeId, string>()
  const assignmentIds = new Map<NodeId, string>()
  const identities = new Map<NodeId, NodeExecutionIdentity>()
  const materializations = new Map<NodeId, NodeSnapshot['materialization']>()
  const executionBindings = new Map<
    NodeId,
    NonNullable<NodeSnapshot['executionBindings']>[number][]
  >()
  for (const ev of ordered) {
    if (ev.kind === 'spawned' || ev.kind === 'waiting') labels.set(ev.id, ev.label)
    if (ev.kind === 'spawned' && ev.assignmentId !== undefined) {
      assignmentIds.set(ev.id, ev.assignmentId)
    }
    if (ev.kind === 'spawned' && ev.identity !== undefined) {
      identities.set(ev.id, copyFrozenIdentity(ev.identity))
    }
    if (ev.kind === 'materialized') materializations.set(ev.id, ev.receipt)
    if (ev.kind === 'execution-bound') {
      const bindings = executionBindings.get(ev.id) ?? []
      bindings.push(ev.binding)
      executionBindings.set(ev.id, bindings)
    }
  }
  const handleFor = (id: NodeId, status: NodeStatus) =>
    replayHandle(id, labels.get(id) ?? id, status, {
      assignmentId: assignmentIds.get(id),
      identity: identities.get(id),
      materialization: materializations.get(id),
      executionBindings: executionBindings.get(id),
    })
  const settlementTime = (at: string): { readonly settledAt?: number } => {
    const settledAt = Date.parse(at)
    return Number.isFinite(settledAt) ? { settledAt } : {}
  }
  const settled: Settled<unknown>[] = []
  for (const ev of ordered) {
    if (ev.kind === 'spawned') continue
    if (ev.kind === 'waiting') continue // arms a wait node; `woken` is its settlement
    if (ev.kind === 'metered') continue // a spend record, not a settlement — irrelevant to replay
    if (ev.kind === 'materialized') continue // wire receipt, not a settlement
    if (ev.kind === 'execution-bound') continue // attempt transport, not a settlement
    if (ev.kind === 'edge') continue // edge-ledger observability, not a settlement
    if (ev.kind === 'trace-unpropagated') continue // severed-hop marker, not a settlement
    if (ev.kind === 'woken') {
      // A wait that was cancelled carries no outcome blob — it replays as a `down`, exactly as a
      // cancelled worker does. A fired/timed-out wait rehydrates its `WaitOutcome` and costs zero.
      if (ev.by === 'cancelled' || ev.outRef === undefined) {
        settled.push({
          kind: 'down',
          handle: handleFor(ev.id, 'cancelled'),
          reason: 'wait cancelled',
          infra: false,
          restartCount: 0,
          trace: { status: 'unavailable', reason: 'not-an-executor' },
          ...settlementTime(ev.at),
          seq: ev.seq,
        })
        continue
      }
      const outcome = await blobs.get(ev.outRef)
      if (outcome === undefined) {
        throw new Error(
          `replaySpawnTree: blob store has no wait outcome for outRef '${ev.outRef}' (node '${ev.id}', seq ${ev.seq})`,
        )
      }
      settled.push({
        kind: 'done',
        handle: handleFor(ev.id, 'done'),
        out: outcome,
        outRef: ev.outRef,
        spent: zeroSpend(),
        trace: { status: 'unavailable', reason: 'not-an-executor' },
        ...settlementTime(ev.at),
        seq: ev.seq,
      })
      continue
    }
    if (ev.kind === 'cancelled') {
      settled.push({
        kind: 'down',
        handle: handleFor(ev.id, 'cancelled'),
        reason: ev.reason,
        infra: false,
        restartCount: 0,
        trace: { status: 'unavailable', reason: 'execution-did-not-start' },
        ...settlementTime(ev.at),
        seq: ev.seq,
      })
      continue
    }
    if (ev.status === 'down') {
      const trace = traceEvidenceFor(ev)
      if (trace.status === 'available') await workerTraceAnalysisStore(trace, blobs)
      settled.push({
        kind: 'down',
        handle: handleFor(ev.id, 'failed'),
        // `reason` is written by every current scope. The verdict fallback preserves the
        // pre-field convention and the generic text keeps still-older reasonless journals usable.
        reason: ev.reason ?? ev.verdict?.notes ?? 'child down',
        infra: ev.infra === true,
        restartCount: 0,
        trace,
        ...settlementTime(ev.at),
        seq: ev.seq,
      })
      continue
    }
    if (ev.outRef === undefined) {
      throw new Error(
        `replaySpawnTree: settled-done event for '${ev.id}' (seq ${ev.seq}) has no outRef; ` +
          'cannot rehydrate the result the driver branched on',
      )
    }
    const out = await blobs.get(ev.outRef)
    if (out === undefined) {
      throw new Error(
        `replaySpawnTree: blob store has no artifact for outRef '${ev.outRef}' (node '${ev.id}', seq ${ev.seq})`,
      )
    }
    const trace = traceEvidenceFor(ev)
    if (trace.status === 'available') await workerTraceAnalysisStore(trace, blobs)
    settled.push({
      kind: 'done',
      handle: handleFor(ev.id, 'done'),
      out,
      outRef: ev.outRef,
      verdict: ev.verdict,
      spent: ev.spent,
      trace,
      ...settlementTime(ev.at),
      seq: ev.seq,
    })
  }
  return settled
}

function replayHandle(
  id: NodeId,
  label: string,
  status: NodeStatus,
  evidence: {
    readonly assignmentId?: string
    readonly identity?: NodeExecutionIdentity
    readonly materialization?: NodeSnapshot['materialization']
    readonly executionBindings?: ReadonlyArray<
      NonNullable<NodeSnapshot['executionBindings']>[number]
    >
  } = {},
) {
  return Object.freeze({
    id,
    label,
    status,
    ...(evidence.assignmentId === undefined ? {} : { assignmentId: evidence.assignmentId }),
    ...(evidence.identity === undefined ? {} : { identity: evidence.identity }),
    ...(evidence.materialization === undefined
      ? {}
      : { materialization: evidence.materialization }),
    ...(evidence.executionBindings === undefined
      ? {}
      : { executionBindings: Object.freeze([...evidence.executionBindings]) }),
    abort() {
      throw new Error(`cannot abort node '${id}': replayed handles are terminal, not live`)
    },
  })
}

/** A replayed handle must not retain mutable references into the loaded journal event. */
function copyFrozenIdentity(identity: NodeExecutionIdentity): NodeExecutionIdentity {
  const correlation =
    identity.correlation === undefined ? undefined : Object.freeze({ ...identity.correlation })
  return Object.freeze({
    ...(identity.profileDigest === undefined ? {} : { profileDigest: identity.profileDigest }),
    ...(identity.taskDigest === undefined ? {} : { taskDigest: identity.taskDigest }),
    ...(identity.candidateDigest === undefined
      ? {}
      : { candidateDigest: identity.candidateDigest }),
    ...(correlation === undefined ? {} : { correlation }),
  })
}

/**
 * Materialize a recorded `TreeView` from a journaled event list for inspection. Folds
 * `spawned`/`settled`/`cancelled` into a per-node snapshot in `seq` order, then adds each
 * `metered` event's driver-inference spend onto its node in a separate additive pass so the view
 * matches the recorded cursor. It does not recover live executors or driver state after restart.
 */
export function materializeTreeView(events: SpawnEvent[]): TreeView {
  const nodes = new Map<NodeId, MutableSnapshot>()
  let root: NodeId | undefined
  // `spawned` (ordinal namespace) and `settled`/`cancelled` (cursor namespace) carry
  // overlapping `seq` values, so create every node before any update — process spawns in
  // ordinal order, then settlements/cancellations in cursor order. A settle/cancel for an
  // un-spawned node is a corrupted log (fail loud via requireNode).
  const spawns = events
    .filter(
      (ev): ev is Extract<SpawnEvent, { kind: 'spawned' | 'waiting' }> =>
        ev.kind === 'spawned' || ev.kind === 'waiting',
    )
    .sort((a, b) => a.seq - b.seq)
  const settlements = events
    .filter(
      (ev) =>
        ev.kind !== 'spawned' &&
        ev.kind !== 'waiting' &&
        ev.kind !== 'metered' &&
        ev.kind !== 'materialized' &&
        ev.kind !== 'execution-bound' &&
        ev.kind !== 'edge' &&
        ev.kind !== 'trace-unpropagated',
    )
    .sort((a, b) => a.seq - b.seq)
  for (const ev of spawns) {
    if (ev.kind === 'waiting') {
      // An ARMED wait reads `waiting` until a `woken` event lands. That is the whole durability
      // claim: a materialized tree from a journal whose process died mid-wait still shows the wait.
      nodes.set(ev.id, {
        id: ev.id,
        parent: ev.parent,
        label: ev.label,
        status: 'waiting',
        runtime: 'wait',
        budget: { maxIterations: 0, maxTokens: 0 },
        spent: zeroSpend(),
      })
      continue
    }
    if (ev.parent === undefined && root === undefined) root = ev.id
    nodes.set(ev.id, {
      id: ev.id,
      parent: ev.parent,
      label: ev.label,
      status: 'pending',
      runtime: ev.runtime,
      budget: ev.budget,
      ...(ev.ownedTreeRoot === undefined ? {} : { ownedTreeRoot: ev.ownedTreeRoot }),
      ...(ev.assignmentId === undefined ? {} : { assignmentId: ev.assignmentId }),
      ...(ev.identity ? { identity: ev.identity } : {}),
      spent: zeroSpend(),
    })
  }
  for (const ev of settlements) {
    if (ev.kind === 'settled') {
      const node = requireNode(nodes, ev.id)
      node.status = ev.status === 'done' ? 'done' : 'failed'
      node.spent = ev.spent
      node.outRef = ev.outRef
      node.trace = traceEvidenceFor(ev)
      const settledAt = Date.parse(ev.at)
      if (Number.isFinite(settledAt)) node.settledAt = settledAt
    } else if (ev.kind === 'woken') {
      const node = requireNode(nodes, ev.id)
      node.status = ev.by === 'cancelled' ? 'cancelled' : 'done'
      node.outRef = ev.outRef
      node.trace = { status: 'unavailable', reason: 'not-an-executor' }
      const settledAt = Date.parse(ev.at)
      if (Number.isFinite(settledAt)) node.settledAt = settledAt
    } else {
      const node = requireNode(nodes, ev.id)
      node.status = 'cancelled'
      node.trace = { status: 'unavailable', reason: 'execution-did-not-start' }
      const settledAt = Date.parse(ev.at)
      if (Number.isFinite(settledAt)) node.settledAt = settledAt
    }
  }
  // Materialization is node evidence, not a settlement. Fold it after node creation and before
  // freezing the view; exactly one receipt per node is enforced by the journal corruption guard.
  for (const ev of events) {
    if (ev.kind !== 'materialized') continue
    const node = requireNode(nodes, ev.id)
    node.materialization = ev.receipt
    node.runtime = ev.receipt.runtime
  }
  for (const ev of events) {
    if (ev.kind !== 'execution-bound') continue
    const node = requireNode(nodes, ev.id)
    node.executionBindings ??= []
    node.executionBindings.push(ev.binding)
  }
  // Driver inference: a separate pass so it accumulates ONTO the settled child-work base (no
  // dependence on metered-vs-settled seq order) without touching node status.
  for (const ev of events) {
    if (ev.kind !== 'metered') continue
    const node = requireNode(nodes, ev.id)
    node.spent = addJournalSpend(node.spent, ev.spend)
  }
  const snapshots = [...nodes.values()].map(freezeSnapshot)
  return {
    root: root ?? snapshots[0]?.id ?? '',
    nodes: snapshots,
    inFlight: snapshots.filter((n) => n.status === 'running' || n.status === 'acquiring').length,
    waiting: snapshots.filter((n) => n.status === 'waiting').length,
  }
}

/**
 * The waits a journaled tree shows as ARMED but never woken — what a resumed run re-arms with the
 * ORIGINAL absolute deadline. Reading it from the journal (rather than from any live state) is
 * what makes "SIGKILL a waiting tree, a new process keeps waiting to the same instant" true.
 */
export function pendingWaits(events: SpawnEvent[]): PendingWait[] {
  const woken = new Set<NodeId>()
  for (const ev of events) if (ev.kind === 'woken') woken.add(ev.id)
  const pending: PendingWait[] = []
  for (const ev of events) {
    if (ev.kind !== 'waiting' || woken.has(ev.id)) continue
    pending.push({
      id: ev.id,
      label: ev.label,
      spec: ev.spec,
      armedAt: ev.armedAt,
      ordinal: ev.seq,
    })
  }
  return pending.sort((a, b) => a.ordinal - b.ordinal)
}

interface MutableSnapshot {
  id: NodeId
  parent?: NodeId
  label: string
  status: NodeStatus
  runtime: Runtime
  budget: NodeSnapshot['budget']
  ownedTreeRoot?: NodeSnapshot['ownedTreeRoot']
  assignmentId?: string
  identity?: NodeSnapshot['identity']
  materialization?: NodeSnapshot['materialization']
  executionBindings?: NonNullable<NodeSnapshot['executionBindings']>[number][]
  spent: Spend
  outRef?: string
  trace?: NodeSnapshot['trace']
  settledAt?: number
}

function zeroSpend(): Spend {
  return { iterations: 0, tokens: zeroTokenUsage(), usd: 0, ms: 0 }
}

/** Add a `metered` spend record onto a node's accumulated spend (per channel). */
function addJournalSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output },
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: a.usd + b.usd,
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ms: a.ms + b.ms,
  }
}

function requireNode(nodes: Map<NodeId, MutableSnapshot>, id: NodeId): MutableSnapshot {
  const node = nodes.get(id)
  if (!node) {
    throw new Error(`spawn journal corrupted: settle/cancel for node '${id}' with no prior spawn`)
  }
  return node
}

function freezeSnapshot(node: MutableSnapshot): NodeSnapshot {
  return {
    id: node.id,
    parent: node.parent,
    label: node.label,
    status: node.status,
    runtime: node.runtime,
    budget: node.budget,
    ownedTreeRoot: node.ownedTreeRoot,
    assignmentId: node.assignmentId,
    identity: node.identity,
    materialization: node.materialization,
    executionBindings:
      node.executionBindings === undefined ? undefined : Object.freeze([...node.executionBindings]),
    spent: node.spent,
    outRef: node.outRef,
    trace: node.trace,
    settledAt: node.settledAt,
  }
}

function traceEvidenceFor(
  event: Extract<SpawnEvent, { kind: 'settled' }>,
): NonNullable<NodeSnapshot['trace']> {
  return (
    event.trace ?? {
      status: 'unavailable',
      reason: 'legacy-settlement-without-trace-evidence',
    }
  )
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
