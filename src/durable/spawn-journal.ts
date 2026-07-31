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
 * @experimental
 */

import { createHash } from 'node:crypto'
import type {
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
export function contentAddress(artifact: unknown): string {
  const hex = createHash('sha256').update(stableStringify(artifact), 'utf-8').digest('hex')
  return `sha256:${hex}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

// ── Result blob store ─────────────────────────────────────────────────────────

/**
 * In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied
 * `outRef` matches the artifact's hash so a stale/forged ref fails loud rather than
 * silently rehydrating the wrong payload. Idempotent on an identical re-put.
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
 */
export class FileSpawnJournal implements SpawnJournal {
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
    const lines = text.split('\n').filter((line) => line.length > 0)
    let begun = false
    const events: SpawnEvent[] = []
    for (const line of lines) {
      const record = JSON.parse(line) as SpawnJournalRecord
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
    const lines = text.split('\n').filter((line) => line.length > 0)
    for (const line of lines) {
      const record = JSON.parse(line) as SpawnJournalRecord
      if (record.root === root && record.kind === 'begin') return record.at
    }
    return undefined
  }

  private async appendRecord(record: SpawnJournalRecord): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const fh = await fs.open(this.path, 'a')
    try {
      await fh.write(`${JSON.stringify(record)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }
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
  return ev.kind === 'spawned' || ev.kind === 'waiting' || ev.kind === 'metered'
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
  for (const ev of ordered) {
    if (ev.kind === 'spawned' || ev.kind === 'waiting') labels.set(ev.id, ev.label)
  }
  const settled: Settled<unknown>[] = []
  for (const ev of ordered) {
    if (ev.kind === 'spawned') continue
    if (ev.kind === 'waiting') continue // arms a wait node; `woken` is its settlement
    if (ev.kind === 'metered') continue // a spend record, not a settlement — irrelevant to replay
    if (ev.kind === 'woken') {
      // A wait that was cancelled carries no outcome blob — it replays as a `down`, exactly as a
      // cancelled worker does. A fired/timed-out wait rehydrates its `WaitOutcome` and costs zero.
      if (ev.by === 'cancelled' || ev.outRef === undefined) {
        settled.push({
          kind: 'down',
          handle: replayHandle(ev.id, labels.get(ev.id) ?? ev.id, 'cancelled'),
          reason: 'wait cancelled',
          infra: false,
          restartCount: 0,
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
        handle: replayHandle(ev.id, labels.get(ev.id) ?? ev.id, 'done'),
        out: outcome,
        outRef: ev.outRef,
        spent: zeroSpend(),
        seq: ev.seq,
      })
      continue
    }
    if (ev.kind === 'cancelled') {
      settled.push({
        kind: 'down',
        handle: replayHandle(ev.id, labels.get(ev.id) ?? ev.id, 'cancelled'),
        reason: ev.reason,
        infra: false,
        restartCount: 0,
        seq: ev.seq,
      })
      continue
    }
    if (ev.status === 'down') {
      settled.push({
        kind: 'down',
        handle: replayHandle(ev.id, labels.get(ev.id) ?? ev.id, 'failed'),
        reason: ev.verdict?.notes ?? 'child down',
        infra: ev.infra === true,
        restartCount: 0,
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
    settled.push({
      kind: 'done',
      handle: replayHandle(ev.id, labels.get(ev.id) ?? ev.id, 'done'),
      out,
      outRef: ev.outRef,
      verdict: ev.verdict,
      spent: ev.spent,
      seq: ev.seq,
    })
  }
  return settled
}

function replayHandle(id: NodeId, label: string, status: NodeStatus) {
  return {
    id,
    label,
    status,
    abort() {
      throw new Error(`cannot abort node '${id}': replayed handles are terminal, not live`)
    },
  }
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
    .filter((ev) => ev.kind !== 'spawned' && ev.kind !== 'waiting' && ev.kind !== 'metered')
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
      spent: zeroSpend(),
    })
  }
  for (const ev of settlements) {
    if (ev.kind === 'settled') {
      const node = requireNode(nodes, ev.id)
      node.status = ev.status === 'done' ? 'done' : 'failed'
      node.spent = ev.spent
      node.outRef = ev.outRef
    } else if (ev.kind === 'woken') {
      const node = requireNode(nodes, ev.id)
      node.status = ev.by === 'cancelled' ? 'cancelled' : 'done'
      node.outRef = ev.outRef
    } else {
      const node = requireNode(nodes, ev.id)
      node.status = 'cancelled'
    }
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
  spent: Spend
  outRef?: string
}

function zeroSpend(): Spend {
  return { iterations: 0, tokens: zeroTokenUsage(), usd: 0, ms: 0 }
}

/** Add a `metered` spend record onto a node's accumulated spend (per channel). */
function addJournalSpend(a: Spend, b: Spend): Spend {
  return {
    iterations: a.iterations + b.iterations,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output },
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
    spent: node.spent,
    outRef: node.outRef,
  }
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
