/**
 * SQL-backed durable stores for supervised runs — `SqlSpawnJournal` and `SqlResultBlobStore`
 * over the same minimal statement seam `SqlConversationJournal` uses (D1, postgres, sqlite,
 * libSQL; positional `?` placeholders). This closes the orchestration-durability gap recorded in
 * `conformance/durability/STATUS.md`: until now the spawn layer was file-only.
 *
 * Parity with the JSONL file stores, by construction:
 *   • same corruption guards — `beginTree` precedes events (enforced by the schema: an event row
 *     names a tree row), duplicate cursor seqs and duplicate materialization receipts are refused
 *     by the same `SpawnEventIndex` the file journal replays through, on both append and load;
 *   • same content-address law for blobs — a `put` whose ref does not hash to the artifact is
 *     refused, a re-put of the same ref asserts the identical bytes;
 *   • load order is insertion order (`INTEGER PRIMARY KEY AUTOINCREMENT`), the SQL analogue of
 *     the JSONL append-only spine.
 *
 * Durability note: this suite and its process-kill test run against `node:sqlite`, whose
 * autocommit commits survive SIGKILL (process death, not OS crash). A deployment that must
 * survive power loss sets its driver's synchronous mode (`PRAGMA synchronous=FULL` + WAL) at the
 * adapter; agent-runtime takes no opinion.
 *
 * @experimental — draft: cross-process ownership is single-writer by convention (the same
 * limitation `createFileRunContext` documents); a machine-visible ownership lease is follow-up.
 */

import { detachedSnapshot } from '../runtime/supervise/snapshot'
import type { NodeId, ResultBlobStore, SpawnEvent, SpawnJournal } from '../runtime/supervise/types'
import { assertContentAddress, encodeResultBlob, SpawnEventIndex } from './spawn-journal'

/** The minimal statement seam; structurally the same shape `SqlConversationJournal` accepts. */
export interface SqlStatements {
  /** Execute a write statement (INSERT/UPDATE/DELETE/DDL). */
  exec(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>
  /** Execute a read statement (SELECT). Returns rows as plain objects. */
  query<TRow = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<TRow[]>
}

const TREES_DDL = (table: string) => `
  CREATE TABLE IF NOT EXISTS ${table}_trees (
    root TEXT PRIMARY KEY,
    begun_at TEXT NOT NULL
  )
`
const EVENTS_DDL = (table: string) => `
  CREATE TABLE IF NOT EXISTS ${table}_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root TEXT NOT NULL REFERENCES ${table}_trees (root),
    body TEXT NOT NULL
  )
`
const BLOBS_DDL = (table: string) => `
  CREATE TABLE IF NOT EXISTS ${table}_blobs (
    ref TEXT PRIMARY KEY,
    body TEXT NOT NULL
  )
`

/** SQL-backed `SpawnJournal`. One row per event; insertion order is replay order. */
export class SqlSpawnJournal implements SpawnJournal {
  private readonly table: string
  // Rebuildable validation state, lazily keyed by the tree's max event id (the SQL analogue of
  // the file journal's stamp check): an unacknowledged append cannot advance it.
  private readonly cache = new Map<NodeId, { maxId: number; index: SpawnEventIndex }>()
  private appendTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly db: SqlStatements,
    table = 'runtime_spawn_journal',
  ) {
    this.table = table
  }

  /** Create the journal's tables if absent. Idempotent. */
  async migrate(): Promise<void> {
    await this.db.exec(TREES_DDL(this.table))
    await this.db.exec(EVENTS_DDL(this.table))
  }

  async loadTree(root: NodeId): Promise<SpawnEvent[] | undefined> {
    const trees = await this.db.query<{ begun_at: string }>(
      `SELECT begun_at FROM ${this.table}_trees WHERE root = ?`,
      [root],
    )
    if (trees.length === 0) return undefined
    const rows = await this.db.query<{ id: number; body: string }>(
      `SELECT id, body FROM ${this.table}_events WHERE root = ? ORDER BY id`,
      [root],
    )
    const index = new SpawnEventIndex(root)
    const events: SpawnEvent[] = []
    for (const row of rows) {
      const event = JSON.parse(row.body) as SpawnEvent
      index.assert(event)
      index.add(event)
      events.push(event)
    }
    return events
  }

  async beginTree(root: NodeId, at: string): Promise<void> {
    return this.serializeAppend(async () => {
      await this.ensureMigrated()
      const existing = await this.db.query<{ begun_at: string }>(
        `SELECT begun_at FROM ${this.table}_trees WHERE root = ?`,
        [root],
      )
      if (existing.length > 0) {
        const begunAt = existing[0]?.begun_at
        if (begunAt !== at) {
          throw new Error(
            `spawn tree '${root}' already begun in SQL at ${begunAt}; refusing to overwrite with ${at}`,
          )
        }
        return
      }
      await this.db.exec(`INSERT INTO ${this.table}_trees (root, begun_at) VALUES (?, ?)`, [
        root,
        at,
      ])
      this.cache.set(root, { maxId: 0, index: new SpawnEventIndex(root) })
    })
  }

  async appendEvent(root: NodeId, ev: SpawnEvent): Promise<void> {
    const event = detachedSnapshot(ev, 'spawn event')
    return this.serializeAppend(async () => {
      await this.ensureMigrated()
      const state = await this.validationIndex(root)
      // Assert BEFORE the write, exactly as the file journal does: a refused event must never
      // reach the table, or a later replay would find the corruption it refused.
      state.index.assert(event)
      const written = await this.db.exec(
        `INSERT INTO ${this.table}_events (root, body) VALUES (?, ?)`,
        [root, JSON.stringify(event)],
      )
      if (written.rowsAffected !== 1) {
        throw new Error(`spawn journal SQL: append of an event for tree '${root}' affected no rows`)
      }
      state.index.add(event)
      state.maxId = await this.maxEventId(root)
    })
  }

  private async validationIndex(root: NodeId): Promise<{ maxId: number; index: SpawnEventIndex }> {
    const begun = await this.db.query<{ begun_at: string }>(
      `SELECT begun_at FROM ${this.table}_trees WHERE root = ?`,
      [root],
    )
    if (begun.length === 0) {
      throw new Error(`appendEvent called for unknown spawn tree '${root}'; call beginTree first`)
    }
    const max = await this.maxEventId(root)
    const cached = this.cache.get(root)
    if (cached && cached.maxId === max) return cached
    const index = new SpawnEventIndex(root)
    if (max > 0) {
      const rows = await this.db.query<{ body: string }>(
        `SELECT body FROM ${this.table}_events WHERE root = ? ORDER BY id`,
        [root],
      )
      for (const row of rows) {
        const event = JSON.parse(row.body) as SpawnEvent
        index.assert(event)
        index.add(event)
      }
    }
    const state = { maxId: max, index }
    this.cache.set(root, state)
    return state
  }

  private async maxEventId(root: NodeId): Promise<number> {
    const rows = await this.db.query<{ max: number | null }>(
      `SELECT MAX(id) AS max FROM ${this.table}_events WHERE root = ?`,
      [root],
    )
    return rows[0]?.max ?? 0
  }

  private migrated = false

  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return
    await this.migrate()
    this.migrated = true
  }

  private serializeAppend(operation: () => Promise<void>): Promise<void> {
    const append = this.appendTail.then(operation)
    this.appendTail = append.catch(() => undefined)
    return append
  }
}

/** SQL-backed `ResultBlobStore`. One content-addressed row per settled result. */
export class SqlResultBlobStore implements ResultBlobStore {
  private migrated = false

  constructor(
    private readonly db: SqlStatements,
    private readonly table = 'runtime_result_blobs',
  ) {}

  async migrate(): Promise<void> {
    await this.db.exec(BLOBS_DDL(this.table))
  }

  async put(outRef: string, artifact: unknown): Promise<void> {
    await this.ensureMigrated()
    const { text } = encodeResultBlob(outRef, artifact)
    const written = await this.db.exec(
      `INSERT OR IGNORE INTO ${this.table}_blobs (ref, body) VALUES (?, ?)`,
      [outRef, text],
    )
    if (written.rowsAffected === 1) return
    // Same ref seen twice: the content-address law must hold for BOTH writers.
    assertContentAddress(outRef, await this.get(outRef))
  }

  async get(outRef: string): Promise<unknown | undefined> {
    await this.ensureMigrated()
    const rows = await this.db.query<{ body: string }>(
      `SELECT body FROM ${this.table}_blobs WHERE ref = ?`,
      [outRef],
    )
    if (rows.length === 0) return undefined
    const artifact: unknown = JSON.parse(rows[0]?.body ?? 'null')
    assertContentAddress(outRef, artifact)
    return artifact
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return
    await this.migrate()
    this.migrated = true
  }
}
