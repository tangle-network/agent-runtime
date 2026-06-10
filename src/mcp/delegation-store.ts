/**
 * @experimental
 *
 * Persistence port for the MCP delegation queue.
 *
 * `DelegationTaskQueue` keeps its working set in memory (status/history
 * reads stay synchronous) and journals every record mutation through a
 * `DelegationStore`. `DelegationTaskQueue.restore({ store })` is the load
 * path: it reads the full record set once at construction and rehydrates
 * the queue from it. After that the store only sees writes.
 *
 * Records MUST be JSON-safe — `FileDelegationStore` round-trips them
 * through `JSON.stringify`/`JSON.parse`, so a `Date`, `Map`, or function
 * smuggled into `args`/`result` would corrupt the journal.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AgentEvalError } from '../errors'
import type { DelegationRecord } from './task-queue'

/** @experimental */
export interface DelegationStore {
  /**
   * Read every persisted record. Called once, by
   * `DelegationTaskQueue.restore`, before any write. A missing backing
   * file is an empty store; an unparseable one throws
   * `DelegationStateCorruptError`.
   */
  loadAll(): Promise<DelegationRecord[]>
  /** Insert or replace the record keyed by `record.taskId`. */
  upsert(record: DelegationRecord): Promise<void>
  /**
   * Resolve an idempotency key to the taskId that claimed it, if any.
   * The queue serves submit-time dedupe from its rehydrated in-memory
   * index; this read exists for consumers that share a store across
   * processes without holding the full record set.
   */
  lookupIdempotencyKey(key: string): Promise<string | undefined>
  /** Delete the named records — the retention-cap eviction path. */
  remove(taskIds: readonly string[]): Promise<void>
}

/**
 * The persisted delegation state exists but cannot be parsed into
 * records. Fail loud: silently starting empty over a corrupt journal
 * would erase delegation history and re-run idempotent work. Opt into
 * recovery explicitly via `FileDelegationStoreOptions.recoverCorrupt`
 * (the bin maps `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` onto it),
 * which archives the corrupt file and starts fresh.
 *
 * @experimental
 */
export class DelegationStateCorruptError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('validation', message, options)
  }
}

/**
 * A delegation-store read or write failed (filesystem error, store
 * called before `loadAll`, ...). Once the queue observes one, it stops
 * accepting new submissions — accepting work it cannot journal would
 * silently demote durable mode to in-memory mode.
 *
 * @experimental
 */
export class DelegationPersistenceError extends AgentEvalError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('config', message, options)
  }
}

/** @experimental */
export class InMemoryDelegationStore implements DelegationStore {
  private readonly records = new Map<string, DelegationRecord>()

  async loadAll(): Promise<DelegationRecord[]> {
    return [...this.records.values()].map(cloneRecord)
  }

  async upsert(record: DelegationRecord): Promise<void> {
    this.records.set(record.taskId, cloneRecord(record))
  }

  async lookupIdempotencyKey(key: string): Promise<string | undefined> {
    for (const record of this.records.values()) {
      if (record.idempotencyKey === key) return record.taskId
    }
    return undefined
  }

  async remove(taskIds: readonly string[]): Promise<void> {
    for (const taskId of taskIds) this.records.delete(taskId)
  }
}

/** @experimental */
export interface FileDelegationStoreOptions {
  /** Absolute path of the JSON state file. Parent directories are created on first write. */
  filePath: string
  /**
   * When the state file exists but cannot be parsed, archive it to
   * `<filePath>.corrupt-<timestamp>` and start empty instead of
   * throwing `DelegationStateCorruptError`. Default false.
   */
  recoverCorrupt?: boolean
}

interface PersistedDelegationState {
  version: 1
  records: DelegationRecord[]
}

const STATE_FORMAT_VERSION = 1

/**
 * JSON-file persistence for the delegation queue. Each write serializes
 * the full record set and lands it atomically (write to a sibling tmp
 * file, then `rename`), so readers never observe a torn file — a crash
 * mid-write leaves the previous snapshot intact. Writes are serialized
 * internally; concurrent `upsert`/`remove` calls cannot interleave.
 *
 * Built for the MCP server's scale (one stdio process, hundreds of
 * records): full-snapshot writes keep the format trivially inspectable
 * and corruption-detectable without a database dependency.
 *
 * @experimental
 */
export class FileDelegationStore implements DelegationStore {
  private readonly filePath: string
  private readonly recoverCorrupt: boolean
  private readonly records = new Map<string, DelegationRecord>()
  private loaded = false
  private writeTail: Promise<void> = Promise.resolve()
  private tmpSeq = 0

  constructor(options: FileDelegationStoreOptions) {
    this.filePath = options.filePath
    this.recoverCorrupt = options.recoverCorrupt ?? false
  }

  async loadAll(): Promise<DelegationRecord[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true
        return []
      }
      throw new DelegationPersistenceError(
        `FileDelegationStore: failed to read ${this.filePath}: ${errorMessage(err)}`,
        { cause: err },
      )
    }
    let state: PersistedDelegationState
    try {
      state = parsePersistedState(raw)
    } catch (err) {
      if (!this.recoverCorrupt) {
        throw new DelegationStateCorruptError(
          `FileDelegationStore: state file ${this.filePath} is corrupt (${errorMessage(err)}). ` +
            'Repair or archive the file, or opt into automatic recovery ' +
            '(recoverCorrupt / AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1) to archive it and start empty.',
          { cause: err },
        )
      }
      const archivePath = `${this.filePath}.corrupt-${Date.now()}`
      await rename(this.filePath, archivePath)
      this.loaded = true
      return []
    }
    this.records.clear()
    for (const record of state.records) this.records.set(record.taskId, record)
    this.loaded = true
    return [...this.records.values()].map(cloneRecord)
  }

  async upsert(record: DelegationRecord): Promise<void> {
    this.assertLoaded('upsert')
    this.records.set(record.taskId, cloneRecord(record))
    await this.enqueueWrite()
  }

  async lookupIdempotencyKey(key: string): Promise<string | undefined> {
    this.assertLoaded('lookupIdempotencyKey')
    for (const record of this.records.values()) {
      if (record.idempotencyKey === key) return record.taskId
    }
    return undefined
  }

  async remove(taskIds: readonly string[]): Promise<void> {
    this.assertLoaded('remove')
    let changed = false
    for (const taskId of taskIds) {
      if (this.records.delete(taskId)) changed = true
    }
    if (changed) await this.enqueueWrite()
  }

  private assertLoaded(op: string): void {
    if (this.loaded) return
    // Writing before load would snapshot only the new records and clobber
    // whatever the file already holds.
    throw new DelegationPersistenceError(
      `FileDelegationStore: ${op} called before loadAll() — the on-disk state has not been read yet`,
    )
  }

  private enqueueWrite(): Promise<void> {
    const write = this.writeTail.then(() => this.writeSnapshot())
    this.writeTail = write.catch(() => {})
    return write
  }

  private async writeSnapshot(): Promise<void> {
    const state: PersistedDelegationState = {
      version: STATE_FORMAT_VERSION,
      records: [...this.records.values()],
    }
    const payload = `${JSON.stringify(state)}\n`
    this.tmpSeq += 1
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${this.tmpSeq}`
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(tmpPath, payload, 'utf8')
      await rename(tmpPath, this.filePath)
    } catch (err) {
      throw new DelegationPersistenceError(
        `FileDelegationStore: failed to write ${this.filePath}: ${errorMessage(err)}`,
        { cause: err },
      )
    }
  }
}

function parsePersistedState(raw: string): PersistedDelegationState {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('top-level value is not an object')
  }
  const state = parsed as Record<string, unknown>
  if (state.version !== STATE_FORMAT_VERSION) {
    throw new Error(`unsupported state version ${JSON.stringify(state.version)}`)
  }
  if (!Array.isArray(state.records)) {
    throw new Error('`records` is not an array')
  }
  for (const record of state.records) {
    if (record === null || typeof record !== 'object') {
      throw new Error('a record entry is not an object')
    }
    const candidate = record as Record<string, unknown>
    if (typeof candidate.taskId !== 'string' || typeof candidate.status !== 'string') {
      throw new Error('a record entry is missing `taskId`/`status`')
    }
  }
  return { version: STATE_FORMAT_VERSION, records: state.records as DelegationRecord[] }
}

function cloneRecord(record: DelegationRecord): DelegationRecord {
  return structuredClone(record)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
