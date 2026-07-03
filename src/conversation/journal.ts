/**
 *
 * Durable conversation transcript — survives a driver process crash mid-run.
 * The runner journals every committed turn before yielding `turn_end`, so a
 * resumed run replays the same `runId` against the same journal and picks up
 * from the first un-recorded turn. Combined with the deterministic
 * `turnId(runId, index, speaker)`, a retried turn collides with the prior
 * attempt's id and any caching gateway can dedupe.
 *
 * The interface is small enough that a Cloudflare D1 / R2 / postgres adapter
 * is ~30 lines. The in-memory adapter is the default for tests and scratch.
 * The file adapter (JSONL on disk) is the default-durable choice when no
 * upstream store is wired.
 *
 * @stable
 */

import type { ConversationTurn, HaltReason } from './types'

export interface ConversationJournalEntry {
  runId: string
  startedAt: string
  /** Set when the run reaches a terminal state. */
  halted?: HaltReason
  endedAt?: string
  turns: ConversationTurn[]
}

export interface ConversationJournal {
  /**
   * Load any prior state for `runId`. Returns `undefined` for a fresh run.
   * Implementations MUST NOT mutate the returned object — the runner clones
   * before continuing — but the runtime treats absence and emptiness
   * identically, so a journal with zero turns is equivalent to "fresh."
   */
  loadRun(runId: string): Promise<ConversationJournalEntry | undefined>

  /**
   * Initialise journal state for a fresh run. Called once per run, before any
   * `appendTurn`. Idempotent: calling with an existing runId is a no-op if
   * the entry already exists with the same `startedAt`.
   */
  beginRun(runId: string, startedAt: string): Promise<void>

  /**
   * Append a committed turn. The runner only calls this AFTER the turn's
   * backend stream completed and the credit total has been updated, so an
   * appended turn is observed-committed and never speculative.
   */
  appendTurn(runId: string, turn: ConversationTurn): Promise<void>

  /**
   * Record the run's terminal halt reason + end time. Once called, the run
   * is observed-final; subsequent `loadRun` returns the same halt.
   */
  recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void>
}

/** In-memory `ConversationJournal` — suitable for testing and single-process runs. */
export class InMemoryConversationJournal implements ConversationJournal {
  private readonly entries = new Map<string, ConversationJournalEntry>()

  async loadRun(runId: string): Promise<ConversationJournalEntry | undefined> {
    const entry = this.entries.get(runId)
    if (!entry) return undefined
    // Defensive copy — callers MUST NOT mutate journal-owned arrays.
    return {
      runId: entry.runId,
      startedAt: entry.startedAt,
      halted: entry.halted,
      endedAt: entry.endedAt,
      turns: [...entry.turns],
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
    this.entries.set(runId, { runId, startedAt, turns: [] })
  }

  async appendTurn(runId: string, turn: ConversationTurn): Promise<void> {
    const entry = this.entries.get(runId)
    if (!entry) {
      throw new Error(
        `appendTurn called for unknown runId '${runId}'; call beginRun first or use the runner which handles it`,
      )
    }
    if (entry.halted) {
      throw new Error(
        `cannot append turn to halted run '${runId}' (halt reason: ${JSON.stringify(entry.halted)})`,
      )
    }
    entry.turns.push(turn)
  }

  async recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void> {
    const entry = this.entries.get(runId)
    if (!entry) {
      throw new Error(`recordHalt called for unknown runId '${runId}'`)
    }
    entry.halted = halt
    entry.endedAt = endedAt
  }
}

/**
 * JSONL on disk. One line per record; first line is the `begin`, subsequent
 * lines are `turn` records, terminal line is `halt`. Replays the whole file
 * on `loadRun` — cheap for the conversation sizes this is designed for
 * (thousands of turns, not millions). For huge runs, plug in a real DB
 * adapter; the interface is small.
 *
 * Each `appendTurn` / `recordHalt` calls `fsync` after the write so a
 * process crash between writes never loses an acknowledged turn.
 */
export class FileConversationJournal implements ConversationJournal {
  constructor(private readonly path: string) {}

  async loadRun(runId: string): Promise<ConversationJournalEntry | undefined> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return undefined
      throw err
    }
    const lines = text.split('\n').filter((line) => line.length > 0)
    let entry: ConversationJournalEntry | undefined
    for (const line of lines) {
      const record = JSON.parse(line) as JournalRecord
      if (record.runId !== runId) continue
      if (record.kind === 'begin') {
        entry = { runId, startedAt: record.startedAt, turns: [] }
      } else if (record.kind === 'turn') {
        if (!entry) {
          throw new Error(
            `journal corrupted: turn record for runId '${runId}' precedes its begin record`,
          )
        }
        entry.turns.push(record.turn)
      } else if (record.kind === 'halt') {
        if (!entry) {
          throw new Error(
            `journal corrupted: halt record for runId '${runId}' precedes its begin record`,
          )
        }
        entry.halted = record.halted
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

  async appendTurn(runId: string, turn: ConversationTurn): Promise<void> {
    await this.appendRecord({ kind: 'turn', runId, turn })
  }

  async recordHalt(runId: string, halt: HaltReason, endedAt: string): Promise<void> {
    await this.appendRecord({ kind: 'halt', runId, halted: halt, endedAt })
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

type JournalRecord =
  | { kind: 'begin'; runId: string; startedAt: string }
  | { kind: 'turn'; runId: string; turn: ConversationTurn }
  | { kind: 'halt'; runId: string; halted: HaltReason; endedAt: string }

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
