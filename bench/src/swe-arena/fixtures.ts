/**
 * Hermetic fixture loaders. All artifacts live under `./fixtures/` (copied
 * from the live experiment's scratchpad on 2026-07-15 so the replay survives
 * scratchpad deletion). Loaders fail loud on shape drift — a silent default
 * here would let the pinned reproduction pass against corrupted fixtures.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  HoldoutEntry,
  HoldoutRegistry,
  LedgerRow,
  RejudgeRow,
  RematchRow,
  WorkerTokens,
} from './types'

const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8')
}

function parseJsonl<T>(name: string): T[] {
  return readFixture(name)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as T
      } catch (err) {
        throw new Error(`${name}:${i + 1}: invalid JSON — ${(err as Error).message}`)
      }
    })
}

export function loadLedger(): LedgerRow[] {
  const rows = parseJsonl<LedgerRow>('ledger.jsonl')
  for (const r of rows) {
    if (typeof r.iid !== 'string' || typeof r.solo_resolved !== 'boolean') {
      throw new Error(`ledger.jsonl: malformed row ${JSON.stringify(r).slice(0, 80)}`)
    }
  }
  return rows
}

export function loadRejudge(): RejudgeRow[] {
  const rows = parseJsonl<RejudgeRow>('rejudge.jsonl')
  for (const r of rows) {
    if (typeof r.iid !== 'string' || typeof r.tag !== 'string') {
      throw new Error(`rejudge.jsonl: malformed row ${JSON.stringify(r).slice(0, 80)}`)
    }
  }
  return rows
}

/** Evolution rounds in order: SUP2, SUP3, SUP4. */
export function loadRematchRounds(): RematchRow[][] {
  return ['rematch.jsonl', 'rematch2.jsonl', 'rematch3.jsonl'].map((f) => parseJsonl<RematchRow>(f))
}

export function loadHoldout(): HoldoutRegistry {
  const entries = JSON.parse(readFixture('holdout.json')) as HoldoutEntry[]
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('holdout.json: expected a non-empty array')
  }
  const commits = new Set(entries.map((e) => e.selected_at_commit))
  if (commits.size !== 1) {
    throw new Error(`holdout.json: expected one selection commit, got ${[...commits].join(', ')}`)
  }
  return { entries, selectedAtCommit: entries[0].selected_at_commit }
}

export function loadPreregisterLog(): string[] {
  return readFixture('holdout-preregister.log')
    .split('\n')
    .filter((l) => l.trim().length > 0)
}

/** Per-instance worker-session token spend (instances with 0 workers are absent). */
export function loadWorkerTokens(): Record<string, WorkerTokens> {
  return JSON.parse(readFixture('worker-tokens.json')) as Record<string, WorkerTokens>
}

/**
 * Journal-true supervisor brain tokens per instance — extracted from the
 * supervisor journals' `metered` events with the same logic as
 * `analyze.py::_true_sup_tok`, captured into a fixture because the raw
 * journals (runs/) are too large to commit. `null` = no journal found.
 */
export function loadSupJournalTrue(): Record<string, number | null> {
  const raw = JSON.parse(readFixture('sup-journal-true.json')) as Record<string, unknown>
  const out: Record<string, number | null> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k === '_provenance') continue
    if (v !== null && typeof v !== 'number') {
      throw new Error(`sup-journal-true.json: ${k} must be number|null`)
    }
    out[k] = v as number | null
  }
  return out
}
