/**
 * @experimental
 *
 * Trajectory trace + cost ledger — the post-hoc tree reconstructor (§4 of `wave-types`).
 *
 * `trajectoryReport` rebuilds the WHOLE realized spawn tree from the durable
 * `SpawnJournal` (+ optionally the `ResultBlobStore` for `done` artifacts): every node
 * (driver AND leaf), the real parent/child edges, each node's terminal status, its OWN
 * conserved `Spend`, and the `Spend` ROLLED UP over its subtree. Roll-up is a post-order
 * fold over the parent edges: a node's `rolledUpSpend` is its own spend plus every
 * descendant's, so a driver is charged for the fanout it caused — the root's roll-up is
 * the whole run's conserved total (tokens + usd + iterations + ms).
 *
 * `equalKOnCost` compares separate runs (arms) on that conserved COST, not on raw
 * iteration COUNT. The sandbox executor reports tokens/usd INCLUSIVE of a leaf's internal
 * sub-agent fanout, so charging an arm by `total.tokens`/`total.usd` (not by how many
 * `next()` cursors it logged) closes the leaf-fanout confound: a treatment leaf that fanned
 * out internally pays for it in cost, where a per-iteration count would hide it. The
 * within-run conserved pool already guarantees `Σk` equal by construction; this check is the
 * CROSS-run analogue the pool cannot reach — proving equal compute before any win is claimed.
 *
 * Pure over the journal/blobs — no live agent calls; safe to run on a finished run's log.
 */

import type {
  DefaultVerdict,
  NodeId,
  ResultBlobStore,
  SpawnEvent,
  SpawnJournal,
  Spend,
} from '../supervise/types'
import { addTokenUsage, zeroTokenUsage } from '../util'
import type {
  EqualKArm,
  EqualKOnCostOptions,
  EqualKVerdict,
  TrajectoryNode,
  TrajectoryReport,
  TrajectoryReportOptions,
} from './wave-types'

const defaultEqualKTolerance = 0.05

/**
 * Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the
 * journal for structure + spend and, when `withOutputs`, the blob store for each `done`
 * node's artifact. Fail loud on a tree that was never journaled, a settle/cancel for an
 * un-spawned node (a corrupted log), or — under `withOutputs` — a `done` node whose blob the
 * store cannot rehydrate (a silent gap would mis-cost or mis-evidence the tree).
 */
export async function trajectoryReport(
  journal: SpawnJournal,
  blobs: ResultBlobStore,
  root: NodeId,
  options: TrajectoryReportOptions = {},
): Promise<TrajectoryReport> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new Error(`trajectoryReport: no journaled tree for root '${root}'`)
  }

  // Spawns (ordinal seq) create the nodes; settlements/cancellations (cursor seq) close
  // them. The two seq namespaces overlap, so create every node from its `spawned` event
  // first, then apply settlements/cancellations — mirrors `materializeTreeView`.
  const spawns = events.filter(isSpawned).sort(bySeq)
  const closes = events.filter((ev) => ev.kind !== 'spawned').sort(bySeq)

  const nodes = new Map<NodeId, MutableNode>()
  for (const ev of spawns) {
    nodes.set(ev.id, {
      id: ev.id,
      parent: ev.parent,
      label: ev.label,
      runtime: ev.runtime,
      status: 'pending',
      ownSpend: zeroSpend(),
      children: [],
    })
  }
  for (const ev of closes) {
    const node = requireNode(nodes, ev.id, root)
    if (ev.kind === 'cancelled') {
      node.status = 'cancelled'
      continue
    }
    node.status = ev.status === 'done' ? 'done' : 'failed'
    node.ownSpend = ev.spent
    node.verdict = ev.verdict
    node.outRef = ev.outRef
  }

  if (!nodes.has(root)) {
    throw new Error(
      `trajectoryReport: root '${root}' has no spawned event in its journaled tree (corrupted log)`,
    )
  }

  // Wire the realized parent/child edges in spawn order, then roll spend up the tree.
  for (const ev of spawns) {
    if (ev.parent === undefined) continue
    requireNode(nodes, ev.parent, root).children.push(ev.id)
  }
  // Fold the drivers' own metered inference (un-journaled — not a spawned child) onto the root
  // node BEFORE roll-up, so `total` matches `SupervisedResult.spentTotal` and the equal-k gate
  // counts the driver's tokens. Omitted ⇒ pure journal cost (the fanout/combinator arm case).
  if (options.extraRootSpend) {
    const r = requireNode(nodes, root, root)
    const e = options.extraRootSpend
    r.ownSpend = {
      iterations: r.ownSpend.iterations + e.iterations,
      tokens: {
        input: r.ownSpend.tokens.input + e.tokens.input,
        output: r.ownSpend.tokens.output + e.tokens.output,
      },
      usd: r.ownSpend.usd + e.usd,
      ms: r.ownSpend.ms + e.ms,
    }
  }
  const rolledUp = rollUpSpend(nodes, root)

  if (options.withOutputs) {
    await attachOutputs(nodes, blobs)
  }

  // Emit in spawn order so the node list reads as the realized tree, root first.
  const ordered = spawns.map((ev) => nodes.get(ev.id)).filter(isNode)
  const reported: TrajectoryNode[] = ordered.map((node) =>
    freezeNode(node, requireSpend(rolledUp, node.id, root)),
  )

  return {
    root,
    nodes: reported,
    total: requireSpend(rolledUp, root, root),
    statusCounts: countStatuses(reported),
  }
}

/**
 * Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration
 * count. Compares each arm's root-rolled-up `total` on the two conserved channels: an arm is
 * within-tolerance when the per-channel spread (max − min across arms) over the median is
 * `≤ tolerance`. Pure over the reports — no I/O. Fails loud on an empty arm list (nothing to
 * compare) so a vacuous "equal" is never returned.
 */
export function equalKOnCost(
  arms: ReadonlyArray<EqualKArm>,
  options: EqualKOnCostOptions = {},
): EqualKVerdict {
  if (arms.length === 0) {
    throw new Error('equalKOnCost: no arms to compare')
  }
  const tolerance = options.tolerance ?? defaultEqualKTolerance

  const armCosts = arms.map((arm) => ({
    label: arm.label,
    tokens: arm.report.total.tokens.input + arm.report.total.tokens.output,
    usd: arm.report.total.usd,
    iterations: arm.report.total.iterations,
  }))

  const tokenValues = armCosts.map((a) => a.tokens)
  const usdValues = armCosts.map((a) => a.usd)
  const spread = {
    tokens: spreadOf(tokenValues),
    usd: spreadOf(usdValues),
  }
  const withinTolerance =
    fractionalSpread(tokenValues) <= tolerance && fractionalSpread(usdValues) <= tolerance

  return {
    withinTolerance,
    arms: armCosts,
    spread,
    tolerance,
  }
}

// ── Tree fold internals ────────────────────────────────────────────────────────

interface MutableNode {
  id: NodeId
  parent?: NodeId
  label: string
  runtime: string
  status: TrajectoryNode['status']
  ownSpend: Spend
  children: NodeId[]
  verdict?: DefaultVerdict
  output?: unknown
  outRef?: string
}

/**
 * Post-order fold: a node's rolled-up spend is its own spend plus every child's rolled-up
 * spend. Iterative (an explicit stack) so a deep tree never overflows the call stack; a node
 * is finalized only after all its children are, so the parent edges are honored exactly.
 */
function rollUpSpend(nodes: Map<NodeId, MutableNode>, root: NodeId): Map<NodeId, Spend> {
  const rolled = new Map<NodeId, Spend>()
  const stack: { id: NodeId; expanded: boolean }[] = [{ id: root, expanded: false }]
  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) continue
    const node = requireNode(nodes, frame.id, root)
    if (!frame.expanded) {
      stack.push({ id: frame.id, expanded: true })
      for (const child of node.children) stack.push({ id: child, expanded: false })
      continue
    }
    const sum = cloneSpend(node.ownSpend)
    for (const child of node.children) addSpend(sum, requireSpend(rolled, child, root))
    rolled.set(frame.id, sum)
  }
  return rolled
}

/**
 * Rehydrate each `done` node's artifact from the blob store. Fail loud on a `done` node whose
 * blob the store cannot resolve — a missing payload under `withOutputs` is a corrupted store,
 * not an absent output (a `down`/`cancelled` node legitimately has none).
 */
async function attachOutputs(
  nodes: Map<NodeId, MutableNode>,
  blobs: ResultBlobStore,
): Promise<void> {
  for (const node of nodes.values()) {
    if (node.status !== 'done' || node.outRef === undefined) continue
    const out = await blobs.get(node.outRef)
    if (out === undefined) {
      throw new Error(
        `trajectoryReport: blob store has no artifact for outRef '${node.outRef}' (node '${node.id}')`,
      )
    }
    node.output = out
  }
}

function freezeNode(node: MutableNode, rolledUpSpend: Spend): TrajectoryNode {
  return {
    id: node.id,
    parent: node.parent,
    children: [...node.children],
    label: node.label,
    runtime: node.runtime,
    status: node.status,
    ownSpend: node.ownSpend,
    rolledUpSpend,
    verdict: node.verdict,
    output: node.output,
    outRef: node.outRef,
  }
}

function countStatuses(
  reported: ReadonlyArray<TrajectoryNode>,
): Readonly<Record<TrajectoryNode['status'], number>> {
  const counts: Record<TrajectoryNode['status'], number> = {
    done: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
  }
  for (const node of reported) counts[node.status] += 1
  return counts
}

// ── Spend arithmetic (single-sourced on `addTokenUsage`) ─────────────────────────

function zeroSpend(): Spend {
  return { iterations: 0, tokens: zeroTokenUsage(), usd: 0, ms: 0 }
}

function cloneSpend(spend: Spend): Spend {
  return {
    iterations: spend.iterations,
    tokens: { input: spend.tokens.input, output: spend.tokens.output },
    usd: spend.usd,
    ms: spend.ms,
  }
}

/** Add `delta` into `acc` in place across every conserved channel. */
function addSpend(acc: Spend, delta: Spend): void {
  acc.iterations += delta.iterations
  addTokenUsage(acc.tokens, delta.tokens)
  acc.usd += delta.usd
  acc.ms += delta.ms
}

// ── Cross-arm spread ─────────────────────────────────────────────────────────────

function spreadOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}

/**
 * Fractional spread on one channel: `(max − min) / median`. A zero-median channel (every arm
 * spent zero on it) is trivially equal — spread is also zero, so it never trips the tolerance.
 */
function fractionalSpread(values: ReadonlyArray<number>): number {
  const spread = spreadOf(values)
  if (spread === 0) return 0
  const median = medianOf(values)
  if (median === 0) {
    throw new Error(
      'equalKOnCost: arms have a non-zero cost spread on a zero-median channel; cannot express it as a fraction',
    )
  }
  return spread / median
}

function medianOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) {
    throw new Error('equalKOnCost: cannot take the median of an empty channel')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] as number
  if (sorted.length % 2 !== 0) return hi
  const lo = sorted[mid - 1] as number
  return (lo + hi) / 2
}

// ── Guards + narrowers ───────────────────────────────────────────────────────────

function isSpawned(ev: SpawnEvent): ev is Extract<SpawnEvent, { kind: 'spawned' }> {
  return ev.kind === 'spawned'
}

function isNode(node: MutableNode | undefined): node is MutableNode {
  return node !== undefined
}

function bySeq(a: SpawnEvent, b: SpawnEvent): number {
  return a.seq - b.seq
}

function requireNode(nodes: Map<NodeId, MutableNode>, id: NodeId, root: NodeId): MutableNode {
  const node = nodes.get(id)
  if (!node) {
    throw new Error(
      `trajectoryReport: tree '${root}' references node '${id}' with no prior spawn (corrupted log)`,
    )
  }
  return node
}

function requireSpend(rolled: Map<NodeId, Spend>, id: NodeId, root: NodeId): Spend {
  const spend = rolled.get(id)
  if (!spend) {
    throw new Error(
      `trajectoryReport: node '${id}' was never rolled up in tree '${root}' (unreachable from root)`,
    )
  }
  return spend
}
