import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { detachedSnapshot } from '../runtime/supervise/snapshot'
import {
  type RuntimeDecisionPoint,
  type RuntimeHookEvent,
  type RuntimeHooks,
  withPursuitContext,
} from '../runtime-hooks'
import { appendCommittedJsonLine, readCommittedJsonLines } from './jsonl-file'
import { captureRunWriteContext } from './run-fence'

export type ObserverRecordKind = 'event' | 'decision'

/**
 * One immutable record in the observer plane. `sequence` is journal order, not
 * execution order; causal/runtime order remains available on the underlying event.
 * `previousDigest` + `digest` make deletion, reordering, or mutation detectable.
 */
export interface ObserverRecord {
  readonly schemaVersion: 1
  readonly pursuitId: string
  readonly sequence: number
  readonly kind: ObserverRecordKind
  readonly observedAt: number
  readonly previousDigest?: string
  readonly event?: RuntimeHookEvent
  readonly decision?: RuntimeDecisionPoint
  readonly digest: string
}

export interface ObserverJournal {
  appendEvent(event: RuntimeHookEvent): Promise<ObserverRecord>
  appendDecision(point: RuntimeDecisionPoint): Promise<ObserverRecord>
  read(): Promise<readonly ObserverRecord[]>
  hooks(): RuntimeHooks
}

type UnsignedObserverRecord = Omit<ObserverRecord, 'digest'>

/**
 * Durable, append-only third-person history for one concrete Runtime execution.
 * It consumes Runtime's existing hook stream and does not participate in execution
 * decisions. A broken observer therefore cannot change what an agent is allowed to do.
 *
 * The write discipline deliberately matches `FileSpawnJournal`: serialized appends,
 * torn-tail recovery, short-write handling, and fsync before acknowledgement. One
 * execution owns one journal file; higher-level pursuit aggregation joins isolated
 * journals by `pursuitId` instead of making independent processes share a write head.
 */
export class FileObserverJournal implements ObserverJournal {
  readonly path: string
  readonly pursuitId: string
  private readonly writeContext = captureRunWriteContext()
  private tail: Promise<void> = Promise.resolve()
  private initialized = false
  private sequence = 0
  private previousDigest: string | undefined
  private appendFailure: Error | undefined

  constructor(path: string, pursuitId: string) {
    const stableId = pursuitId.trim()
    if (stableId.length === 0) {
      throw new TypeError('FileObserverJournal: pursuitId must be non-empty')
    }
    this.path = resolve(path)
    this.pursuitId = stableId
  }

  /** Open existing committed history by its recorded identity; never creates a file. */
  static async open(path: string): Promise<FileObserverJournal | undefined> {
    for await (const record of readCommittedJsonLines<ObserverRecord>(path, {
      allowMissing: true,
    })) {
      if (typeof record?.pursuitId !== 'string')
        throw new TypeError('observer journal: missing pursuit identity')
      const journal = new FileObserverJournal(path, record.pursuitId)
      verifyObserverRecords([record], journal.pursuitId)
      return journal
    }
    return undefined
  }

  hooks(): RuntimeHooks {
    return withPursuitContext(this.pursuitId, {
      onEvent: (event) => this.appendEvent(event).then(() => undefined),
      onDecisionPoint: (point) => this.appendDecision(point).then(() => undefined),
    })
  }

  appendEvent(event: RuntimeHookEvent): Promise<ObserverRecord> {
    return this.enqueue('event', event)
  }

  appendDecision(point: RuntimeDecisionPoint): Promise<ObserverRecord> {
    return this.enqueue('decision', point)
  }

  async read(): Promise<readonly ObserverRecord[]> {
    await this.tail
    this.assertComplete()
    const records: ObserverRecord[] = []
    const verify = observerVerifier(this.pursuitId)
    for await (const record of this.readExistingUnsafe()) {
      verify(record)
      records.push(record)
    }
    return Object.freeze(records)
  }

  private async enqueue(
    kind: ObserverRecordKind,
    value: RuntimeHookEvent | RuntimeDecisionPoint,
  ): Promise<ObserverRecord> {
    if (value.pursuitId !== this.pursuitId) {
      throw new Error(
        `FileObserverJournal: ${kind} pursuitId ${String(value.pursuitId)} does not match ${this.pursuitId}`,
      )
    }

    // Other hooks receive this same input and may mutate it before queued I/O runs.
    // Detach now, not after awaiting the previous append or computing the digest.
    const snapshot = detachedSnapshot(value, 'observer record')

    const operation = this.tail
      .then(() =>
        this.writeContext(async () => {
          this.assertComplete()
          await this.initialize()

          const unsigned: UnsignedObserverRecord = {
            schemaVersion: 1,
            pursuitId: this.pursuitId,
            sequence: this.sequence + 1,
            kind,
            observedAt: Date.now(),
            ...(this.previousDigest ? { previousDigest: this.previousDigest } : {}),
            ...(kind === 'event'
              ? { event: snapshot as RuntimeHookEvent }
              : { decision: snapshot as RuntimeDecisionPoint }),
          }
          const record: ObserverRecord = Object.freeze({
            ...unsigned,
            digest: observerRecordDigest(unsigned),
          })
          const fs = await import('node:fs/promises')
          const { dirname } = await import('node:path')
          await fs.mkdir(dirname(this.path), { recursive: true })
          await appendCommittedJsonLine(this.path, record)
          this.sequence = record.sequence
          this.previousDigest = record.digest
          return record
        }),
      )
      .catch((error) => {
        this.appendFailure ??= toError(error)
        throw error
      })
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    const verify = observerVerifier(this.pursuitId)
    let tail: ObserverRecord | undefined
    for await (const record of this.readExistingUnsafe()) {
      verify(record)
      tail = record
    }
    this.sequence = tail?.sequence ?? 0
    this.previousDigest = tail?.digest
    // Only latch after recovery + verification succeed. A transient read error or
    // corruption must never leave an instance pretending it initialized cleanly.
    this.initialized = true
  }

  private readExistingUnsafe(): AsyncGenerator<ObserverRecord> {
    return readCommittedJsonLines<ObserverRecord>(this.path, { allowMissing: true })
  }

  private assertComplete(): void {
    if (!this.appendFailure) return
    throw new Error(
      'FileObserverJournal: a prior durable append failed; observer completeness is unknown',
      { cause: this.appendFailure },
    )
  }
}

/** Verify identity, monotonic sequence, payload shape, and the complete digest chain. */
export function verifyObserverRecords(
  records: readonly ObserverRecord[],
  pursuitId?: string,
): readonly ObserverRecord[] {
  const verify = observerVerifier(pursuitId)
  for (const record of records) verify(record)
  return Object.freeze([...records])
}

/** The same full chain validation is used for replay, startup and in-memory evidence. */
function observerVerifier(pursuitId?: string): (record: ObserverRecord) => void {
  let previousDigest: string | undefined
  let expectedSequence = 1
  return (record) => {
    if (record.schemaVersion !== 1) throw new Error('observer journal: unsupported schemaVersion')
    if (pursuitId !== undefined && record.pursuitId !== pursuitId) {
      throw new Error(`observer journal: pursuit identity mismatch at sequence ${record.sequence}`)
    }
    if (record.sequence !== expectedSequence) {
      throw new Error(
        `observer journal: non-contiguous sequence ${record.sequence}; expected ${expectedSequence}`,
      )
    }
    if (record.previousDigest !== previousDigest) {
      throw new Error(`observer journal: digest-chain break at sequence ${record.sequence}`)
    }
    for (const kind of ['event', 'decision'] as const) {
      const payload = record[kind]
      if ((record.kind === kind) === (payload === undefined)) {
        throw new Error(`observer journal: invalid ${kind} payload at sequence ${record.sequence}`)
      }
      if (payload !== undefined && payload.pursuitId !== record.pursuitId) {
        throw new Error(
          `observer journal: nested ${kind} pursuit mismatch at sequence ${record.sequence}`,
        )
      }
    }
    const { digest, ...unsigned } = record
    const expected = observerRecordDigest(unsigned)
    if (digest !== expected) {
      throw new Error(`observer journal: digest mismatch at sequence ${record.sequence}`)
    }
    previousDigest = digest
    expectedSequence += 1
  }
}

/** Compute the canonical SHA-256 digest for an unsigned observer record. */
export function observerRecordDigest(record: Omit<ObserverRecord, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

/** Build the canonical durable observer hook in one call. */
export function createFileObserverHooks(
  path: string,
  pursuitId: string,
): {
  readonly journal: FileObserverJournal
  readonly hooks: RuntimeHooks
} {
  const journal = new FileObserverJournal(path, pursuitId)
  return { journal, hooks: journal.hooks() }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
