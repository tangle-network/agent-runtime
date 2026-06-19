/**
 * @experimental
 *
 * Durable iteration history for the kernel `runLoop` — survives a driver process
 * crash mid-run. The kernel journals every COMMITTED iteration (one whose worker
 * stream drained and whose output/verdict were folded in) before the loop moves on,
 * so a resumed run reusing the same `runId` against the same journal replays the
 * committed iterations and continues from the first un-recorded one — it never redoes
 * committed work.
 *
 * This is the `ConversationJournal` pattern (`conversation/journal.ts`) applied to the
 * loop: begin / append / load, observed-committed appends only, the in-memory adapter
 * for tests and a JSONL file adapter (fsynced per append) for durability. The
 * interface is small enough that a D1 / R2 / postgres adapter is ~30 lines.
 *
 * A committed `Iteration` is journaled verbatim as JSON. Its `events` are already
 * JSON-shaped sandbox events (the same payloads the trace pipeline serializes); its
 * `error` — a non-JSON `Error` — is flattened to its message on write and rehydrated
 * to an `Error` on read, so a resumed driver sees the same failed-iteration shape it
 * would have seen live.
 */

import type { Iteration } from './types'

export interface LoopJournalEntry<Task, Output> {
  runId: string
  startedAt: string
  /** Set when the loop reaches a terminal state, so a reload returns final, not resume. */
  endedAt?: string
  iterations: Iteration<Task, Output>[]
}

export interface LoopJournal {
  /**
   * Load any prior state for `runId`. Returns `undefined` for a fresh run. The kernel
   * clones before continuing, so an adapter MAY return its own object; absence and an
   * empty `iterations` are treated identically ("fresh").
   */
  loadRun<Task, Output>(runId: string): Promise<LoopJournalEntry<Task, Output> | undefined>
  /**
   * Initialise journal state for a fresh run, before any `appendIteration`. Idempotent:
   * a re-`beginRun` with the same `startedAt` is a no-op; a different one fails loud.
   */
  beginRun(runId: string, startedAt: string): Promise<void>
  /**
   * Append a committed iteration. The kernel only calls this AFTER the iteration's
   * worker stream drained and its output/verdict were folded — so an appended
   * iteration is observed-committed, never speculative.
   */
  appendIteration<Task, Output>(runId: string, iteration: Iteration<Task, Output>): Promise<void>
  /**
   * Record the loop's terminal end time. Once called, the run is observed-final; a later
   * `loadRun` returns the same `endedAt` so the kernel can short-circuit a re-run.
   */
  recordEnd(runId: string, endedAt: string): Promise<void>
}

export class InMemoryLoopJournal implements LoopJournal {
  private readonly entries = new Map<string, LoopJournalEntry<unknown, unknown>>()

  async loadRun<Task, Output>(
    runId: string,
  ): Promise<LoopJournalEntry<Task, Output> | undefined> {
    const entry = this.entries.get(runId)
    if (!entry) return undefined
    // Defensive copy — the kernel MUST NOT mutate journal-owned arrays.
    return {
      runId: entry.runId,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      iterations: [...entry.iterations] as Iteration<Task, Output>[],
    }
  }

  async beginRun(runId: string, startedAt: string): Promise<void> {
    const existing = this.entries.get(runId)
    if (existing) {
      if (existing.startedAt !== startedAt) {
        throw new Error(
          `runId '${runId}' already exists with startedAt=${existing.startedAt}; refusing to overwrite with ${startedAt}`,
        )
      }
      return
    }
    this.entries.set(runId, { runId, startedAt, iterations: [] })
  }

  async appendIteration<Task, Output>(
    runId: string,
    iteration: Iteration<Task, Output>,
  ): Promise<void> {
    const entry = this.entries.get(runId)
    if (!entry) {
      throw new Error(
        `appendIteration called for unknown runId '${runId}'; call beginRun first (or use runLoop, which handles it)`,
      )
    }
    if (entry.endedAt) {
      throw new Error(`cannot append iteration to ended run '${runId}'`)
    }
    entry.iterations.push(iteration as Iteration<unknown, unknown>)
  }

  async recordEnd(runId: string, endedAt: string): Promise<void> {
    const entry = this.entries.get(runId)
    if (!entry) throw new Error(`recordEnd called for unknown runId '${runId}'`)
    entry.endedAt = endedAt
  }
}

/**
 * JSONL on disk. One line per record: first line `begin`, then a `iteration` line per
 * committed iteration, terminal line `end`. `loadRun` replays the whole file — cheap for
 * loop sizes (tens of iterations, not millions). Each append fsyncs so a crash between
 * writes never loses an acknowledged iteration.
 */
export class FileLoopJournal implements LoopJournal {
  constructor(private readonly path: string) {}

  async loadRun<Task, Output>(
    runId: string,
  ): Promise<LoopJournalEntry<Task, Output> | undefined> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return undefined
      throw err
    }
    const lines = text.split('\n').filter((line) => line.length > 0)
    let entry: LoopJournalEntry<Task, Output> | undefined
    for (const line of lines) {
      const record = JSON.parse(line) as JournalRecord
      if (record.runId !== runId) continue
      if (record.kind === 'begin') {
        entry = { runId, startedAt: record.startedAt, iterations: [] }
      } else if (record.kind === 'iteration') {
        if (!entry) {
          throw new Error(
            `loop journal corrupted: iteration record for runId '${runId}' precedes its begin record`,
          )
        }
        entry.iterations.push(rehydrateIteration<Task, Output>(record.iteration))
      } else if (record.kind === 'end') {
        if (!entry) {
          throw new Error(
            `loop journal corrupted: end record for runId '${runId}' precedes its begin record`,
          )
        }
        entry.endedAt = record.endedAt
      }
    }
    return entry
  }

  async beginRun(runId: string, startedAt: string): Promise<void> {
    const existing = await this.loadRun(runId)
    if (existing) {
      if (existing.startedAt !== startedAt) {
        throw new Error(
          `runId '${runId}' already exists in ${this.path} with startedAt=${existing.startedAt}; refusing to overwrite with ${startedAt}`,
        )
      }
      return
    }
    await this.appendRecord({ kind: 'begin', runId, startedAt })
  }

  async appendIteration<Task, Output>(
    runId: string,
    iteration: Iteration<Task, Output>,
  ): Promise<void> {
    await this.appendRecord({ kind: 'iteration', runId, iteration: serializeIteration(iteration) })
  }

  async recordEnd(runId: string, endedAt: string): Promise<void> {
    await this.appendRecord({ kind: 'end', runId, endedAt })
  }

  private async appendRecord(record: JournalRecord): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const fh = await fs.open(this.path, 'a')
    try {
      await fh.write(`${JSON.stringify(record)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }
}

/** The on-disk iteration shape: the `Iteration` with its non-JSON `error` flattened to a
 *  message string (rehydrated to an `Error` on load). Every other field is JSON-shaped. */
type SerializedIteration = Omit<Iteration<unknown, unknown>, 'error'> & { error?: string }

function serializeIteration<Task, Output>(
  iteration: Iteration<Task, Output>,
): SerializedIteration {
  const { error, ...rest } = iteration
  return { ...(rest as Omit<Iteration<unknown, unknown>, 'error'>), ...(error ? { error: error.message } : {}) }
}

function rehydrateIteration<Task, Output>(
  serialized: SerializedIteration,
): Iteration<Task, Output> {
  const { error, ...rest } = serialized
  return {
    ...(rest as unknown as Iteration<Task, Output>),
    ...(error !== undefined ? { error: new Error(error) } : {}),
  }
}

type JournalRecord =
  | { kind: 'begin'; runId: string; startedAt: string }
  | { kind: 'iteration'; runId: string; iteration: SerializedIteration }
  | { kind: 'end'; runId: string; endedAt: string }

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
