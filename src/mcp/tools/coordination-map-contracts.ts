import type { AgentProfile } from '@tangle-network/agent-interface'

/** What a map does when one of its items fails. See {@link MapOnSettleRoute.onItemFailure}. */
export type MapItemFailurePolicy = 'all-or-refuse' | 'settled-subset'

/**
 * One map-on-settle ROUTE: the coordination form of an AgentGraph `maps` edge. When a worker whose
 * profile name is `from` settles `done`, the runtime resolves `pointer` in its result, refuses
 * anything but an array no longer than `maxItems`, and starts one item per element — the element
 * is the item's task — at most `concurrency` at a time. Once every item settled it starts `join`
 * with the ordered results. Items and the join go through the same admission a `spawn_worker` call
 * takes (pre-flight, budget reservation from the conserved pool, `makeWorkerAgent`), carrying the
 * runtime-authored {@link WorkerSpawnContext.map} marker, so no manager turn is spent on them.
 *
 * Every step publishes a `map` event. Item settlements are recorded but not queued, so the
 * manager is woken by the join's settlement, or by a `map` event when the map was refused or its
 * join could not run. Map state is process-local, like analyst-run lineage: a restarted manager
 * does not re-expand a map whose source settled in a prior process.
 */
export interface MapOnSettleRoute {
  /** Stable edge identity carried on every `map` event. */
  readonly edge: string
  /** The source, by profile name. */
  readonly from: string
  /** RFC 6901 JSON pointer into the source's settled result. */
  readonly pointer: string
  /** What runs per item: a profile (pinned by the run's authority), or a graph started through the
   *  `run_graph` path. */
  readonly item: { readonly profile: AgentProfile } | { readonly graph: unknown }
  /** The node that receives `{ map, source, items, results, failures }`. */
  readonly join: AgentProfile
  readonly maxItems: number
  readonly concurrency: number
  /** `'all-or-refuse'`: after a failed item no further item starts, running items settle, and the
   *  join is refused with the failures listed. `'settled-subset'`: every item runs and the join
   *  receives the delivered results with the failures beside them. An item fails when it settles
   *  down, when its deliverable check rejects it, when it delivers nothing, or when its spawn is
   *  refused. */
  readonly onItemFailure: MapItemFailurePolicy
  /** Each item's budget, merged over the per-worker default as `spawn_worker`'s `budget` is. */
  readonly itemBudget?: Readonly<Record<string, unknown>>
}

/** The runtime marker on a map's item or join spawn. */
export interface MapSpawnMarker {
  readonly edge: string
  readonly role: 'item' | 'join'
  /** The item's position in the source list. Absent on the join. */
  readonly index?: number
}

/** One map step, published as a `map` event: the expansion of the source list, one item, or the
 *  join. A step that reached no worker is `unpropagated`, with its reason. */
export interface MapTraversalEvent {
  readonly edge: string
  readonly phase: 'expand' | 'item' | 'join'
  readonly outcome: 'delivered' | 'empty' | 'failed' | 'unpropagated'
  /** The settled source worker whose list this map expanded. */
  readonly sourceWorker: string
  readonly index?: number
  /** The item or join worker, when one was started. */
  readonly workerId?: string
  /** Bytes of the list (expand), the item (item), or the join task (join). */
  readonly bytes: number
  /** The list's length, on the expansion. */
  readonly items?: number
  readonly reason?: string
}
