import { createHash } from 'node:crypto'
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  type RuntimeDecisionPoint,
  type RuntimeHookEvent,
  type RuntimeHooks,
  withPursuitContext,
} from '../runtime-hooks'

export type ObserverRecordKind = 'event' | 'decision'

/**
 * One immutable record in the observer plane. `sequence` is observer order, not
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
 * Durable, append-only third-person history for one pursuit. It consumes Runtime's
 * existing hook stream and does not participate in execution decisions. A broken
 * observer therefore cannot change what an agent is allowed to do.
 */
export class FileObserverJournal implements ObserverJournal {
  readonly path: string
  readonly pursuitId: string
  private tail: Promise<void> = Promise.resolve()
  private initialized = false
  private sequence = 0
  private previousDigest: string | undefined

  constructor(path: string, pursuitId: string) {
    const stableId = pursuitId.trim()
    if (stableId.length === 0) throw new TypeError('FileObserverJournal: pursuitId must be non-empty')
    this.path = resolve(path)
    this.pursuitId = stableId
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
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isNoEnt(error)) return []
      throw error
    }
    return verifyObserverRecords(parseCommittedLines(text, this.path), this.pursuitId)
  }

  private enqueue(
    kind: ObserverRecordKind,
    value: RuntimeHookEvent | RuntimeDecisionPoint,
  ): Promise<ObserverRecord> {
    let result: ObserverRecord | undefined
    const operation = this.tail.then(async () => {
      await this.initialize()
      if (value.pursuitId !== this.pursuitId) {
        throw new Error(
          `FileObserverJournal: ${kind} pursuitId ${String(value.pursuitId)} does not match ${this.pursuitId}`,
        )
      }

      const unsigned: UnsignedObserverRecord = {
        schemaVersion: 1,
        pursuitId: this.pursuitId,
        sequence: this.sequence + 1,
        kind,
        observedAt: Date.now(),
        ...(this.previousDigest ? { previousDigest: this.previousDigest } : {}),
        ...(kind === 'event'
          ? { event: value as RuntimeHookEvent }
          : { decision: value as RuntimeDecisionPoint }),
      }
      const record: ObserverRecord = Object.freeze({
        ...unsigned,
        digest: observerRecordDigest(unsigned),
      })
      await mkdir(dirname(this.path), { recursive: true })
      await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8')
      this.sequence = record.sequence
      this.previousDigest = record.digest
      result = record
    })
    this.tail = operation.catch(() => undefined)
    return operation.then(() => {
      if (!result) throw new Error('FileObserverJournal: append completed without a record')
      return result
    })
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    const records = await this.readExistingUnsafe()
    const verified = verifyObserverRecords(records, this.pursuitId)
    const tail = verified.at(-1)
    this.sequence = tail?.sequence ?? 0
    this.previousDigest = tail?.digest
  }

  private async readExistingUnsafe(): Promise<ObserverRecord[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isNoEnt(error)) return []
      throw error
    }
    return parseCommittedLines(text, this.path)
  }
}

/** Verify identity, monotonic sequence, and the complete digest chain. */
export function verifyObserverRecords(
  records: readonly ObserverRecord[],
  pursuitId?: string,
): readonly ObserverRecord[] {
  let previousDigest: string | undefined
  let expectedSequence = 1
  for (const record of records) {
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
    if ((record.kind === 'event') === (record.event === undefined)) {
      throw new Error(`observer journal: invalid event payload at sequence ${record.sequence}`)
    }
    if ((record.kind === 'decision') === (record.decision === undefined)) {
      throw new Error(`observer journal: invalid decision payload at sequence ${record.sequence}`)
    }
    const { digest, ...unsigned } = record
    const expected = observerRecordDigest(unsigned)
    if (digest !== expected) throw new Error(`observer journal: digest mismatch at sequence ${record.sequence}`)
    previousDigest = digest
    expectedSequence += 1
  }
  return Object.freeze([...records])
}

export function observerRecordDigest(record: UnsignedObserverRecord): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

/** Build the canonical durable observer hook in one call. */
export function createFileObserverHooks(path: string, pursuitId: string): {
  readonly journal: FileObserverJournal
  readonly hooks: RuntimeHooks
} {
  const journal = new FileObserverJournal(path, pursuitId)
  return { journal, hooks: journal.hooks() }
}

function parseCommittedLines(text: string, path: string): ObserverRecord[] {
  const lines = text.split('\n')
  const out: ObserverRecord[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line?.trim()) continue
    try {
      out.push(JSON.parse(line) as ObserverRecord)
    } catch (error) {
      // A torn final append was never a committed observer record; older malformed
      // records are corruption and must fail loud.
      const isLastNonEmpty = lines.slice(index + 1).every((entry) => !entry.trim())
      if (isLastNonEmpty) break
      throw new Error(`${path}: malformed observer record ${index + 1}`, { cause: error })
    }
  }
  return out
}

function isNoEnt(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
