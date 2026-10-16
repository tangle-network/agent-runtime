import { randomUUID } from 'node:crypto'
import { defaultRedactor } from '../../redact'
import type { ExecutorProgressEvent } from './types'

/** Live observation is bounded and process-local. A reconnect explicitly reports expired history. */
export interface WorkerEventCursor {
  readonly epoch: string
  readonly next: number
}

export interface WorkerEventEntry {
  readonly sequence: number
  readonly at: number
  readonly event: unknown
  readonly omitted?: 'event-too-large' | 'event-not-serializable'
}

export type WorkerEventPage =
  | { readonly status: 'unavailable'; readonly reason: 'unknown-worker' | 'not-captured' }
  | {
      readonly status: 'available'
      readonly entries: readonly WorkerEventEntry[]
      readonly cursor: WorkerEventCursor
      readonly reset: boolean
      readonly historyExpired: boolean
      readonly remaining: number
    }

const MAX_EVENTS = 256
const MAX_BYTES = 262_144

/** One worker's already-redacted live output. Accounting stays on Scope's existing usage channel. */
export class WorkerEvents {
  readonly #epoch = randomUUID()
  readonly #entries: { entry: WorkerEventEntry; bytes: number }[] = []
  #next = 0
  #capturing = false

  start(): void {
    this.#capturing = true
  }
  #bytes = 0

  append(event: ExecutorProgressEvent, at: number): void {
    let entry: WorkerEventEntry = { sequence: this.#next++, at, event: defaultRedactor(event) }
    let bytes: number
    try {
      bytes = Buffer.byteLength(JSON.stringify(entry))
    } catch {
      entry = { sequence: entry.sequence, at, event: null, omitted: 'event-not-serializable' }
      bytes = Buffer.byteLength(JSON.stringify(entry))
    }
    if (bytes > MAX_BYTES) {
      entry = { sequence: entry.sequence, at, event: null, omitted: 'event-too-large' }
      bytes = Buffer.byteLength(JSON.stringify(entry))
    }
    this.#entries.push({ entry, bytes })
    this.#bytes += bytes
    while (this.#entries.length > MAX_EVENTS || this.#bytes > MAX_BYTES) {
      this.#bytes -= this.#entries.shift()!.bytes
    }
  }

  read(cursor?: WorkerEventCursor): WorkerEventPage {
    if (!this.#capturing) return { status: 'unavailable', reason: 'not-captured' }
    if (cursor && (!Number.isSafeInteger(cursor.next) || cursor.next < 0)) {
      throw new Error('worker event cursor must name a non-negative safe integer')
    }
    const reset = cursor !== undefined && cursor.epoch !== this.#epoch
    const first = this.#entries[0]?.entry.sequence ?? this.#next
    const start = reset ? first : (cursor?.next ?? first)
    if (!reset && start > this.#next) throw new Error('worker event cursor is ahead of this stream')
    return {
      status: 'available',
      entries: this.#entries
        .filter(({ entry }) => entry.sequence >= start)
        .map(({ entry }) => structuredClone(entry)),
      cursor: { epoch: this.#epoch, next: this.#next },
      reset,
      historyExpired: start < first || (cursor === undefined && first > 0),
      remaining: 0,
    }
  }
}
