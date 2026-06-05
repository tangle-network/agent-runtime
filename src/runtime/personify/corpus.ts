/**
 * @experimental
 *
 * The cross-run corpus (G2) — the learning-flywheel's durable accreted-fact store.
 *
 * `Corpus` is DISTINCT from the per-run `SpawnJournal` (decisions/replay) and `ResultBlobStore`
 * (payloads): a `CorpusRecord` is a FACT one run LEARNED that a FUTURE run reads back (the
 * world-model), not a replay input. This module owns the two impls the wave surface pins —
 * `InMemoryCorpus` and `FileCorpus` (JSONL, append-only) — plus `renderCorpusToInstructions`,
 * the READ side that projects accreted facts into a fresh `AgentProfile`'s instruction seams.
 *
 * The boundary is fail-loud, typed-outcome: `append` is idempotent on an identical record and
 * returns a typed error (never throws, never a silent overwrite) on a conflicting re-append under
 * the same `id`. Malformed records — a structurally-invalid `CorpusRecord` from disk or a caller —
 * fail loud (the validator throws), since a corpus that silently accepts garbage would poison
 * every downstream run that reads it back.
 */

import type { AgentProfile } from '@tangle-network/sandbox'
import type {
  Corpus,
  CorpusFilter,
  CorpusRecord,
  RenderCorpusToInstructionsOptions,
} from './wave-types'

// ── Record validation ────────────────────────────────────────────────────────

const corpusSchemaVersion = '1.0.0'

/**
 * Assert a value is a well-formed `CorpusRecord`. A PROVENANCE-and-shape check: every
 * identity/render-gating field must be present and typed, `confidence` must be a finite 0..1,
 * `evidence` (when present) must be `{ kind, uri }[]`. Throws on any violation — a corpus that
 * silently accepted a malformed fact would project garbage into a future run's prompt. The
 * thrown message names the offending field so a bad on-disk line is diagnosable.
 */
export function assertCorpusRecord(value: unknown, where: string): asserts value is CorpusRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${where}: corpus record is not an object`)
  }
  const r = value as Record<string, unknown>
  if (r.schemaVersion !== corpusSchemaVersion) {
    throw new Error(
      `${where}: corpus record schemaVersion '${String(r.schemaVersion)}' != '${corpusSchemaVersion}'`,
    )
  }
  requireNonEmptyString(r.id, `${where}.id`)
  requireNonEmptyString(r.runId, `${where}.runId`)
  requireNonEmptyString(r.producedAt, `${where}.producedAt`)
  requireNonEmptyString(r.area, `${where}.area`)
  requireNonEmptyString(r.claim, `${where}.claim`)
  if (r.rationale !== undefined && typeof r.rationale !== 'string') {
    throw new Error(`${where}.rationale: expected string, got ${typeof r.rationale}`)
  }
  if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== 'string')) {
    throw new Error(`${where}.tags: expected string[]`)
  }
  if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) {
    throw new Error(`${where}.confidence: expected a finite number, got ${String(r.confidence)}`)
  }
  if (r.confidence < 0 || r.confidence > 1) {
    throw new Error(`${where}.confidence: ${r.confidence} is outside the [0, 1] range`)
  }
  if (r.evidence !== undefined) {
    if (!Array.isArray(r.evidence)) {
      throw new Error(`${where}.evidence: expected an array`)
    }
    for (let i = 0; i < r.evidence.length; i++) {
      const ev = r.evidence[i] as Record<string, unknown> | null
      if (typeof ev !== 'object' || ev === null) {
        throw new Error(`${where}.evidence[${i}]: not an object`)
      }
      requireNonEmptyString(ev.kind, `${where}.evidence[${i}].kind`)
      requireNonEmptyString(ev.uri, `${where}.evidence[${i}].uri`)
    }
  }
}

function requireNonEmptyString(value: unknown, where: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: expected a non-empty string, got ${describe(value)}`)
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return `'${value}'`
  return typeof value
}

// ── Identity + idempotence ───────────────────────────────────────────────────

/**
 * Two records collide IFF they share an `id`. An append under an already-stored `id` is idempotent
 * only when the new record is byte-identical to the stored one (same fact, re-learned); any other
 * field differing under the same `id` is a CONFLICT — a typed-error append, never a silent
 * overwrite. The identity field is `id`; the producer mints it over its identity-defining fields
 * (claim + tags) so a re-learned fact dedups.
 */
function recordsEqual(a: CorpusRecord, b: CorpusRecord): boolean {
  return stableStringify(a) === stableStringify(b)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Apply a `CorpusFilter` as an AND-narrowing over a record list and sort most-confident first
 * (ties → most-recent `producedAt`, so the freshest of two equally-confident facts wins). Pure —
 * the in-mem and file impls both route their reads through this so query semantics are
 * single-sourced. An empty result is valid (not an error).
 */
function applyFilter(
  records: ReadonlyArray<CorpusRecord>,
  filter: CorpusFilter,
): ReadonlyArray<CorpusRecord> {
  const matched = records.filter((r) => {
    if (filter.area !== undefined && r.area !== filter.area) return false
    if (filter.runId !== undefined && r.runId !== filter.runId) return false
    if (filter.minConfidence !== undefined && r.confidence < filter.minConfidence) return false
    if (filter.tags !== undefined && !filter.tags.every((t) => r.tags.includes(t))) return false
    return true
  })
  const ordered = [...matched].sort((a, b) =>
    b.confidence !== a.confidence
      ? b.confidence - a.confidence
      : b.producedAt < a.producedAt
        ? -1
        : b.producedAt > a.producedAt
          ? 1
          : 0,
  )
  if (filter.limit !== undefined) {
    if (!Number.isInteger(filter.limit) || filter.limit < 0) {
      throw new Error(
        `corpus query: filter.limit must be a non-negative integer, got ${filter.limit}`,
      )
    }
    return ordered.slice(0, filter.limit)
  }
  return ordered
}

// ── In-memory corpus ────────────────────────────────────────────────────────

/**
 * In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an
 * identical re-append, and returns a typed `{ succeeded: false }` on a conflicting re-append under
 * the same `id` (never overwrites). `query` routes through the single-sourced `applyFilter`.
 */
export class InMemoryCorpus implements Corpus {
  private readonly byId = new Map<string, CorpusRecord>()

  async append(
    record: CorpusRecord,
  ): Promise<{ succeeded: true } | { succeeded: false; error: string }> {
    try {
      assertCorpusRecord(record, 'append: record')
    } catch (err) {
      return { succeeded: false, error: err instanceof Error ? err.message : String(err) }
    }
    const existing = this.byId.get(record.id)
    if (existing) {
      if (recordsEqual(existing, record)) return { succeeded: true }
      return {
        succeeded: false,
        error:
          `corpus conflict: id '${record.id}' is already stored with a different record; ` +
          'a learned fact is append-only — re-mint the id or reconcile before re-appending',
      }
    }
    this.byId.set(record.id, freeze(record))
    return { succeeded: true }
  }

  async query(filter: CorpusFilter): Promise<ReadonlyArray<CorpusRecord>> {
    return applyFilter([...this.byId.values()], filter)
  }
}

// ── File corpus (JSONL, append-only) ──────────────────────────────────────────

/**
 * JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole
 * file, validating every line (a malformed line fails loud — a corrupted corpus must never read
 * back silently) and folding by `id`: a later identical line dedups, a later conflicting line
 * under the same `id` is a corruption (fail loud). `append` first replays to enforce the same
 * idempotence/conflict contract as the in-mem impl, then fsyncs the new line so a crash between
 * writes never loses an acknowledged fact. Shares the JSONL append-line spine with the spawn
 * journal, but the interface stays separate (a learned fact is not a replay record).
 */
export class FileCorpus implements Corpus {
  constructor(private readonly path: string) {}

  async append(
    record: CorpusRecord,
  ): Promise<{ succeeded: true } | { succeeded: false; error: string }> {
    try {
      assertCorpusRecord(record, 'append: record')
    } catch (err) {
      return { succeeded: false, error: err instanceof Error ? err.message : String(err) }
    }
    let stored: Map<string, CorpusRecord>
    try {
      stored = await this.load()
    } catch (err) {
      return { succeeded: false, error: err instanceof Error ? err.message : String(err) }
    }
    const existing = stored.get(record.id)
    if (existing) {
      if (recordsEqual(existing, record)) return { succeeded: true }
      return {
        succeeded: false,
        error:
          `corpus conflict: id '${record.id}' is already stored in ${this.path} with a different ` +
          'record; a learned fact is append-only — re-mint the id or reconcile before re-appending',
      }
    }
    await this.appendLine(record)
    return { succeeded: true }
  }

  async query(filter: CorpusFilter): Promise<ReadonlyArray<CorpusRecord>> {
    const stored = await this.load()
    return applyFilter([...stored.values()], filter)
  }

  private async load(): Promise<Map<string, CorpusRecord>> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return new Map()
      throw err
    }
    const lines = text.split('\n').filter((line) => line.length > 0)
    const byId = new Map<string, CorpusRecord>()
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (err) {
        throw new Error(
          `corpus corrupted: ${this.path} line ${i + 1} is not valid JSON: ` +
            (err instanceof Error ? err.message : String(err)),
        )
      }
      assertCorpusRecord(parsed, `corpus ${this.path} line ${i + 1}`)
      const existing = byId.get(parsed.id)
      if (existing && !recordsEqual(existing, parsed)) {
        throw new Error(
          `corpus corrupted: ${this.path} has two different records for id '${parsed.id}'; ` +
            'an append-only corpus must never hold a conflicting re-append under one id',
        )
      }
      byId.set(parsed.id, freeze(parsed))
    }
    return byId
  }

  private async appendLine(record: CorpusRecord): Promise<void> {
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

// ── Render-back: project accreted facts into a profile's instruction seams ─────

/**
 * The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts
 * (most-confident first, capped by `maxLines`) into instruction lines, and returns a FRESH
 * `AgentProfile` with them merged in — never mutates the input profile. Default `target: 'prompt'`
 * appends the lines to `prompt.instructions[]` (the additive append-line seam); `target:
 * 'resources'` folds them into the single-blob `resources.instructions` string (preserving any
 * existing blob, but failing loud on a non-string existing blob — a `resources.instructions` that
 * was already an `AgentProfileResourceRef` cannot be string-appended without dropping it).
 *
 * An empty query result returns a fresh COPY of the profile with no instruction change (a valid
 * "nothing learned yet" read, not an error).
 */
export async function renderCorpusToInstructions(
  opts: RenderCorpusToInstructionsOptions,
): Promise<AgentProfile> {
  const { corpus, filter, profile, target = 'prompt', maxLines } = opts
  if (maxLines !== undefined && (!Number.isInteger(maxLines) || maxLines < 0)) {
    throw new Error(
      `renderCorpusToInstructions: maxLines must be a non-negative integer, got ${maxLines}`,
    )
  }
  const matched = await corpus.query(filter)
  const capped = maxLines !== undefined ? matched.slice(0, maxLines) : matched
  const lines = capped.map(renderLine)

  if (lines.length === 0) return structuredClone(profile)

  const next = structuredClone(profile)
  if (target === 'resources') {
    const resources = next.resources ?? {}
    const prior = resources.instructions
    if (prior !== undefined && typeof prior !== 'string') {
      throw new Error(
        'renderCorpusToInstructions: resources.instructions is an AgentProfileResourceRef, not a ' +
          'string; cannot string-append corpus facts without dropping the ref (pass target: ' +
          "'prompt' or pre-resolve the ref)",
      )
    }
    const blob = [prior, ...lines].filter((s): s is string => typeof s === 'string' && s.length > 0)
    next.resources = { ...resources, instructions: blob.join('\n') }
    return next
  }

  const prompt = next.prompt ?? {}
  next.prompt = { ...prompt, instructions: [...(prompt.instructions ?? []), ...lines] }
  return next
}

/** One corpus fact → one instruction line. The claim is the line; a rationale (when present) is
 *  appended in parentheses so a reader sees the why without a second line. Content-only — no
 *  metric/score/verdict text is synthesized (the corpus holds facts, not selector evidence). */
function renderLine(record: CorpusRecord): string {
  return record.rationale ? `${record.claim} (${record.rationale})` : record.claim
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function freeze(record: CorpusRecord): CorpusRecord {
  return Object.freeze({ ...record })
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
