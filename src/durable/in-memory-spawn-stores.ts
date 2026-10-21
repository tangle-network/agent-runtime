/** In-process decision and payload retention; no acknowledged state survives process exit. */

import { detachedSnapshot } from '../runtime/supervise/snapshot'
import type { NodeId, ResultBlobStore, SpawnEvent, SpawnJournal } from '../runtime/supervise/types'
import { SpawnEventIndex } from './spawn-journal/event-index'
import { encodeResultBlob } from './spawn-journal/result-blob-store'

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
    const { snapshot } = encodeResultBlob(outRef, artifact)
    this.blobs.set(outRef, snapshot)
  }

  async get(outRef: string): Promise<unknown | undefined> {
    return this.blobs.has(outRef) ? structuredClone(this.blobs.get(outRef)) : undefined
  }
}

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
  private readonly trees = new Map<
    NodeId,
    { begunAt: string; events: SpawnEvent[]; index: SpawnEventIndex }
  >()

  async loadTree(root: NodeId): Promise<SpawnEvent[] | undefined> {
    const tree = this.trees.get(root)
    if (!tree) return undefined
    return structuredClone(tree.events)
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
    this.trees.set(root, { begunAt: at, events: [], index: new SpawnEventIndex(root) })
  }

  async appendEvent(root: NodeId, ev: SpawnEvent): Promise<void> {
    const tree = this.trees.get(root)
    if (!tree) {
      throw new Error(`appendEvent called for unknown spawn tree '${root}'; call beginTree first`)
    }
    const event = detachedSnapshot(ev, 'spawn event')
    tree.index.assert(event)
    tree.events.push(event)
    tree.index.add(event)
  }
}
