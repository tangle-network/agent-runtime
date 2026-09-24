import type { SqlAdapter } from '../../conversation/journal-sql'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import {
  openSqlRunStore,
  SqlRunOwnershipError,
  type SqlRunStoreOptions,
} from '../../durable/sql-run-store'
import type { CoordinationEvent } from '../../mcp/tools/coordination'
import { type CoordinationOwnerId, foldCoordinationRecords } from './coordination-log'
import type { BusRecord } from './event-bus'
import {
  createInMemoryRunContext,
  type InMemoryRunContextOptions,
  type RunContext,
  type RunContextLease,
} from './run-context'
import { detachedSnapshot } from './snapshot'
import type { SpawnEvent } from './types'

export { SqlRunOwnershipError } from '../../durable/sql-run-store'

export interface SqlRunContextOptions extends SqlRunStoreOptions, InMemoryRunContextOptions {}

/** SQL stores are read-only outside an acquired ownership capability. runGraph acquires it. */
export interface SqlRunContext extends RunContext {
  readonly durability: 'sql'
  readonly runId: string
  acquire(signal?: AbortSignal): Promise<RunContextLease>
}

type Entry =
  | { kind: 'begin'; root: string; at: string }
  | { kind: 'events'; root: string; events: SpawnEvent[] }
  | { kind: 'blobs'; ref: string; value: unknown }
  | {
      kind: 'coordination'
      runId: string
      ownerId?: CoordinationOwnerId
      record: BusRecord<CoordinationEvent>
    }

type CoordinationRecord = Extract<Entry, { kind: 'coordination' }>

/**
 * A cross-machine run context on the existing autocommit SqlAdapter. Reuse the same database,
 * tablePrefix and runId on every host; no runDir or shared filesystem is required.
 *
 * Each ownership generation gets fresh store capabilities. The public context can inspect SQL
 * at any time, but cannot write without acquire(). runGraph/supervise acquire and release it.
 * Retained provider execution supplies external admission/result idempotency; SQL does not turn
 * an arbitrary unkeyed network effect into an exactly-once operation.
 * @experimental
 */
export async function createSqlRunContext(
  db: SqlAdapter,
  runId: string,
  options: SqlRunContextOptions = {},
): Promise<SqlRunContext> {
  const store = await openSqlRunStore<Entry>(db, runId, options)
  const { executors } = createInMemoryRunContext({ withDriver: options.withDriver ?? true })
  const cold = async () => projection(await store.read())
  const unowned = async (): Promise<never> => {
    throw new SqlRunOwnershipError(`SQL run '${runId}' requires an acquired lease before writing`)
  }
  const context: SqlRunContext = {
    durability: 'sql',
    runId,
    namespace: store.namespace,
    resume: true,
    executors,
    journal: {
      loadTree: async (root) => (await cold()).journal.loadTree(root),
      beginTree: unowned,
      appendEvent: unowned,
      appendEvents: unowned,
    },
    blobs: {
      get: async (ref) => (await cold()).blobs.get(ref),
      put: unowned,
    },
    coordinationLog: {
      load: async (id, owner) => (await cold()).loadCoordination(id, owner),
      append: unowned,
    },
    async acquire(signal) {
      const lease = await store.acquire(signal)
      try {
        const failureController = new AbortController()
        const leaseSignal = AbortSignal.any([lease.signal, failureController.signal])
        const view = await projection(lease.records)
        let tail: Promise<void> = Promise.resolve()
        let accepting = true
        let failed: unknown
        let hasFailed = false
        const check = () => {
          leaseSignal.throwIfAborted()
          if (hasFailed) throw failed
        }
        const read = async <T>(operation: () => Promise<T>): Promise<T> => {
          await tail
          check()
          return operation()
        }
        const commit = (entry: Entry): Promise<void> => {
          if (!accepting) return unowned()
          // Reuse the in-memory stores' validation and snapshots. Their projection is not
          // observable while a publication is pending; a failed publication poisons this lease.
          const captured = detachedSnapshot(entry, 'SQL run record')
          const write = tail.then(async () => {
            check()
            if (await view.apply(captured)) await lease.append(captured)
          })
          tail = write.catch((error) => {
            hasFailed = true
            failed = error
            failureController.abort(error)
          })
          return write
        }
        const bound: RunContext = {
          durability: 'sql',
          runId,
          namespace: store.namespace,
          resume: true,
          executors,
          journal: {
            loadTree: (root) => read(() => view.journal.loadTree(root)),
            beginTree: (root, at) => commit({ kind: 'begin', root, at }),
            appendEvent: (root, event) => commit({ kind: 'events', root, events: [event] }),
            appendEvents: (root, events) => commit({ kind: 'events', root, events: [...events] }),
          },
          blobs: {
            get: (ref) => read(() => view.blobs.get(ref)),
            put: (ref, value) => commit({ kind: 'blobs', ref, value }),
          },
          coordinationLog: {
            load: (id, owner) => read(() => view.loadCoordination(id, owner)),
            append: (id, record, ownerId) =>
              commit({
                kind: 'coordination',
                runId: id,
                record,
                ...(ownerId === undefined ? {} : { ownerId }),
              }),
          },
        }
        return {
          context: Object.freeze(bound),
          signal: leaseSignal,
          async release() {
            accepting = false
            await tail
            await lease.release()
          },
        }
      } catch (error) {
        await lease.release().catch(() => undefined)
        throw error
      }
    },
  }
  return Object.freeze(context)
}

/** Reuse the existing journal's uniqueness/sequence rules and blob hash validation verbatim. */
async function projection(entries: readonly Entry[]) {
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  const beginnings = new Map<string, string>()
  const coordination: CoordinationRecord[] = []
  const apply = async (entry: Entry): Promise<boolean> => {
    switch (entry.kind) {
      case 'begin': {
        const prior = beginnings.get(entry.root)
        await journal.beginTree(entry.root, entry.at)
        beginnings.set(entry.root, entry.at)
        return prior === undefined
      }
      case 'events':
        for (const event of entry.events) await journal.appendEvent(entry.root, event)
        return entry.events.length > 0
      case 'blobs': {
        const existing = await blobs.get(entry.ref)
        await blobs.put(entry.ref, entry.value)
        return existing === undefined
      }
      case 'coordination':
        if (entry.record.event.type === 'settled') return false
        coordination.push(entry)
        return true
      default:
        throw new Error('Unknown SQL run record kind')
    }
  }
  for (const entry of entries) await apply(entry)
  return {
    journal,
    blobs,
    apply,
    loadCoordination(id: string, ownerId?: CoordinationOwnerId) {
      return foldCoordinationRecords(
        coordination.map(({ runId, ownerId, record }) => ({
          runId,
          ...record,
          ...(ownerId === undefined ? {} : { ownerId }),
        })),
        id,
        ownerId,
      )
    },
  }
}
