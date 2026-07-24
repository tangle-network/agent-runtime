/**
 * Pinned fixture loaders. All artifacts live under `./fixtures/` (copied
 * from the live experiment's scratchpad on 2026-07-15 so the replay survives
 * scratchpad deletion). Loaders fail loud on shape drift — a silent default
 * here would let the pinned reproduction pass against corrupted fixtures.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  FactoryInstance,
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

// ---------------------------------------------------------------------------
// Factory-bench instance source (manifest dirs, one per harvested PR).
// The 3 calibrated pilots ship under ./fixtures/factory/; any directory with
// the same layout (manifest.json + spec.md) loads identically.
// ---------------------------------------------------------------------------

/** Default shipped instance root: `./fixtures/factory`. */
export const FACTORY_INSTANCES_DIR = fixturePath('factory')

/**
 * A FactoryInstance plus what the runner needs beyond the raw manifest: its
 * directory (the judge child re-loads it by path), the spec text, and the
 * calibrated judge-test denominator parsed from `resolved_criterion` — kept
 * OUT of vitest's reported total so a judge file that fails to collect still
 * scores against the full calibrated count instead of shrinking the divisor.
 */
export interface LoadedFactoryInstance extends FactoryInstance {
  dir: string
  spec: string
  judgeTestTotal: number
}

const SHA_RE = /^[0-9a-f]{40}$/
const IMAGE_DIGEST_RE = /^.+@sha256:[0-9a-f]{64}$/

function requireStringArray(dir: string, field: string, v: unknown, minLen: number): string[] {
  if (!Array.isArray(v) || v.length < minLen || v.some((x) => typeof x !== 'string' || x.length === 0)) {
    throw new Error(`${dir}/manifest.json: ${field} must be a string[] with ≥${minLen} non-empty entries`)
  }
  return v as string[]
}

/** Load + validate one instance dir (fail-loud on any shape drift). */
export function loadFactoryInstance(dir: string): LoadedFactoryInstance {
  const manifestPath = join(dir, 'manifest.json')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    throw new Error(`${manifestPath}: unreadable or invalid JSON — ${(err as Error).message}`)
  }
  const m = raw as Record<string, unknown>
  for (const field of [
    'id',
    'repo',
    'repo_local_mirror',
    'base_commit',
    'judge_ref',
    'spec_md',
    'command_image',
    'resolved_criterion',
  ] as const) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      throw new Error(`${manifestPath}: missing or empty required string field '${field}'`)
    }
  }
  if (!(m.id as string).startsWith('factory.')) {
    throw new Error(`${manifestPath}: id '${m.id as string}' must start with 'factory.'`)
  }
  for (const field of ['base_commit', 'judge_ref'] as const) {
    if (!SHA_RE.test(m[field] as string)) {
      throw new Error(`${manifestPath}: ${field} '${m[field] as string}' is not a full 40-hex sha`)
    }
  }
  if (!IMAGE_DIGEST_RE.test(m.command_image as string)) {
    throw new Error(
      `${manifestPath}: command_image must be pinned as '<image>@sha256:<64 hex>'`,
    )
  }
  const judge_tests = requireStringArray(dir, 'judge_tests', m.judge_tests, 1)
  const excluded_tests = requireStringArray(dir, 'excluded_tests', m.excluded_tests ?? [], 0)
  const setup_cmds = requireStringArray(dir, 'setup_cmds', m.setup_cmds ?? [], 0)
  const judge_cmds = requireStringArray(dir, 'judge_cmds', m.judge_cmds, 1)
  if (typeof m.timeout_s !== 'number' || !Number.isFinite(m.timeout_s) || m.timeout_s <= 0) {
    throw new Error(`${manifestPath}: timeout_s must be a positive number`)
  }
  const totalMatch = /passed\s*\/\s*(\d+)/.exec(m.resolved_criterion as string)
  const judgeTestTotal = totalMatch ? Number(totalMatch[1]) : 0
  if (judgeTestTotal <= 0) {
    throw new Error(
      `${manifestPath}: resolved_criterion '${m.resolved_criterion as string}' must state the calibrated ` +
        `denominator as 'passed/<N>' — partial credit needs a stable divisor`,
    )
  }
  const specPath = join(dir, m.spec_md as string)
  let spec: string
  try {
    spec = readFileSync(specPath, 'utf8')
  } catch (err) {
    throw new Error(`${specPath}: unreadable spec — ${(err as Error).message}`)
  }
  if (spec.trim().length === 0) throw new Error(`${specPath}: spec is empty`)
  return {
    id: m.id as string,
    repo: m.repo as string,
    repo_local_mirror: m.repo_local_mirror as string,
    base_commit: m.base_commit as string,
    judge_ref: m.judge_ref as string,
    spec_md: m.spec_md as string,
    judge_tests,
    excluded_tests,
    command_image: m.command_image as string,
    setup_cmds,
    judge_cmds,
    resolved_criterion: m.resolved_criterion as string,
    timeout_s: m.timeout_s,
    ...(typeof m.worker_visible_paths_note === 'string' ? { worker_visible_paths_note: m.worker_visible_paths_note } : {}),
    ...(typeof m.runtime === 'string' ? { runtime: m.runtime } : {}),
    ...(m.calibration !== undefined ? { calibration: m.calibration as FactoryInstance['calibration'] } : {}),
    dir,
    spec,
    judgeTestTotal,
  }
}

/** Load every `manifest.json` instance dir under `rootDir`. Fail-loud, ids must be unique. */
export function loadFactoryInstances(rootDir: string = FACTORY_INSTANCES_DIR): LoadedFactoryInstance[] {
  const entries = readdirSync(rootDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(rootDir, e.name))
    .sort()
  const instances = entries.map((dir) => loadFactoryInstance(dir))
  if (instances.length === 0) throw new Error(`${rootDir}: no factory instance directories found`)
  const ids = new Set<string>()
  for (const inst of instances) {
    if (ids.has(inst.id)) throw new Error(`${rootDir}: duplicate instance id ${inst.id}`)
    ids.add(inst.id)
  }
  return instances
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
