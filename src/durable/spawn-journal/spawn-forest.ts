import { detachedSnapshot } from '../../runtime/supervise/snapshot'
import { nestedDriverTreeRoot } from '../../runtime/supervise/tree-key'
import type {
  NodeId,
  NodeSnapshot,
  Runtime,
  SpawnEvent,
  SpawnJournal,
  TreeView,
} from '../../runtime/supervise/types'
import { materializeTreeView } from './tree-view'

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
    /** Parent-tree spawn that establishes the root node omitted from an owned journal tree. */
    readonly ownerSpawn?: Extract<SpawnEvent, { kind: 'spawned' }>
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
    const viewEvents =
      current.ownerSpawn === undefined ||
      stableEvents.some((event) => event.kind === 'spawned' && event.id === current.ownerSpawn?.id)
        ? [...stableEvents]
        : [ownedTreeRootSpawn(current.ownerSpawn), ...stableEvents]
    const view = detachedSnapshot(
      materializeTreeView(viewEvents),
      `loadSpawnForest view ${JSON.stringify(current.root)}`,
    )
    trees.push({
      root: current.root,
      ...(current.ownerNodeId === undefined ? {} : { ownerNodeId: current.ownerNodeId }),
      ...(current.parentTreeRoot === undefined ? {} : { parentTreeRoot: current.parentTreeRoot }),
      events: stableEvents,
      view,
    })
    // The owner is already a real node in its parent tree. Keep it in this tree's local view so
    // metered root events have a node, but omit the synthetic duplicate from the flattened list.
    nodes.push(
      ...view.nodes
        .filter((node) => current.ownerNodeId === undefined || node.id !== current.ownerNodeId)
        .map((node) => ({ treeRoot: current.root, ...node })),
    )
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
        ownerSpawn: spawn,
      })
    }
  }

  return detachedSnapshot(
    { root, trees, nodes, events, inDoubt, missingTrees },
    'loadSpawnForest result',
  )
}

/** Owned journal trees record the owner's turns and descendants, but the owner's spawn belongs to
 * the parent tree. Supply a view-only parentless copy so strict materialization can fold root
 * metering without weakening its missing-spawn corruption check for ordinary event lists. */
/** @internal Exact parentless root for a Runtime-owned subtree. */
export function ownedTreeRootSpawn(
  spawn: Extract<SpawnEvent, { kind: 'spawned' }>,
): Extract<SpawnEvent, { kind: 'spawned' }> {
  const { parent: _parent, ownedTreeRoot: _ownedTreeRoot, ...root } = spawn
  return root
}
