/**
 * Campaign `spans.jsonl` → OTLP-flat JSONL — the missing converter between
 * what the substrate RECORDS and what its trace analysts READ.
 *
 * agent-eval's `runCampaign` durably records one `spans.jsonl` per cell
 * (`defaultBuildTraceWriter`): flat records
 * `{ name, cellId, startMs, durationMs?, ...attributes }` with no trace/span
 * ids. Its trace consumers (`OtlpFileTraceStore`, the trace-analyst registry,
 * `haloProposer`/`traceAnalystProposer` via `resolveTraces`) read OTLP-flat
 * JSONL (`trace_id`/`span_id`/ISO times/status/attributes — the shape
 * `projectOtlpFlatLine` parses). Nothing shipped converts between the two, so
 * the traces real optimization runs write could never reach the trace-native
 * proposers. This module is that wire adapter:
 *
 *   - {@link campaignCellSpansToOtlp} — one cell's `spans.jsonl` content →
 *     OTLP lines (a per-cell root AGENT anchor span + one child per record).
 *   - {@link convertCampaignDirToOtlp} — walk any campaign run/generation dir
 *     for `spans.jsonl` files and concatenate their OTLP lines.
 *   - {@link campaignTraceResolver} — the `resolveTraces` implementation for
 *     `traceAnalystProposer`/`haloProposer`: proposing generation g reads the
 *     traces the loop just recorded (`gen-<g-1>`, or `baseline` for g = 0)
 *     under the same `runDir` handed to `improve()`/`selfImprove()`.
 *
 * Trace identity: one trace per CELL, keyed on the cell's on-disk path — the
 * same sanitized `cellId` recurs across the baseline and every candidate
 * campaign, so folding the id alone would merge distinct runs into one trace.
 * Ids are deterministic FNV-1a folds to OTLP's 32/16-hex width, so re-converts
 * are stable and byte-identical.
 */

import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { ProposeContext } from '@tangle-network/agent-eval/campaign'
import { OPENINFERENCE_SPAN_KIND } from '@tangle-network/agent-eval/traces'

/** How deep {@link convertCampaignDirToOtlp} recurses looking for
 *  `spans.jsonl`. The deepest shipped layout is
 *  `<runDir>/gen-<g>/candidate-<i>/<cell>/spans.jsonl` (3 levels); one spare
 *  level tolerates a wrapper dir without letting a mis-pointed root scan a
 *  whole filesystem. */
const MAX_WALK_DEPTH = 4

export interface CampaignOtlpOptions {
  /** OTLP `service.name` on every emitted span. Default `'campaign'`. */
  serviceName?: string
}

interface CampaignSpanRecord {
  name: string
  cellId: string
  startMs: number
  durationMs?: number
  attributes: Record<string, unknown>
  error?: string
}

/**
 * Convert ONE cell's `spans.jsonl` content to OTLP-flat JSONL lines.
 * `cellKey` is the identity the trace id folds from — pass the cell's on-disk
 * path (unique per campaign); `cellId` is the display/attribute label.
 * Returns `[]` for empty/recordless content (a dispatch that never touched
 * `ctx.trace`/`ctx.cost` writes an empty file — that is data, not an error).
 */
export function campaignCellSpansToOtlp(
  content: string,
  cell: { cellId: string; cellKey?: string },
  opts: CampaignOtlpOptions = {},
): string[] {
  const records = parseCampaignSpans(content, cell.cellId)
  if (records.length === 0) return []

  const serviceName = opts.serviceName ?? 'campaign'
  const key = cell.cellKey ?? cell.cellId
  const traceId = foldTo32Hex(key)
  const rootSpanId = foldTo16Hex(`${key}::root`)

  const startMs = Math.min(...records.map((r) => r.startMs))
  const endMs = Math.max(...records.map((r) => r.startMs + (r.durationMs ?? 0)))
  const anyError = records.some((r) => r.error !== undefined)

  const resource = {
    attributes: {
      'service.name': serviceName,
      'campaign.cell_id': cell.cellId,
      ...(cell.cellKey ? { 'campaign.cell_dir': cell.cellKey } : {}),
    },
  }

  const lines: string[] = [
    JSON.stringify({
      trace_id: traceId,
      span_id: rootSpanId,
      parent_span_id: '',
      name: `cell.${cell.cellId}`,
      start_time: msToIso(startMs),
      end_time: msToIso(endMs),
      status: anyError
        ? { code: 'STATUS_CODE_ERROR', message: 'one or more spans errored' }
        : { code: 'STATUS_CODE_OK', message: '' },
      resource,
      attributes: {
        [OPENINFERENCE_SPAN_KIND]: 'AGENT',
        'agent.name': cell.cellId,
      },
    }),
  ]

  for (let i = 0; i < records.length; i++) {
    const r = records[i]!
    lines.push(
      JSON.stringify({
        trace_id: traceId,
        span_id: foldTo16Hex(`${key}::${i}`),
        parent_span_id: rootSpanId,
        name: r.name,
        start_time: msToIso(r.startMs),
        end_time: msToIso(r.startMs + (r.durationMs ?? 0)),
        status:
          r.error === undefined
            ? { code: 'STATUS_CODE_OK', message: '' }
            : { code: 'STATUS_CODE_ERROR', message: r.error },
        resource,
        attributes: r.attributes,
      }),
    )
  }
  return lines
}

/**
 * Walk `dir` (a campaign run dir, a generation dir, or a whole `selfImprove`
 * run root) for `spans.jsonl` files and return their concatenated OTLP-flat
 * JSONL — the exact string the `resolveTraces` contract expects. `''` when no
 * spans exist (the proposers fail loud on empty by design).
 */
export function convertCampaignDirToOtlp(dir: string, opts: CampaignOtlpOptions = {}): string {
  const root = resolve(dir)
  const files = findSpansFiles(root, MAX_WALK_DEPTH)
  const lines: string[] = []
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const cellDir = dirname(file)
    lines.push(
      ...campaignCellSpansToOtlp(content, { cellId: basename(cellDir), cellKey: cellDir }, opts),
    )
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

export interface CampaignTraceResolverOptions extends CampaignOtlpOptions {
  /** The `selfImprove`/`improve()` run root — the SAME `runDir` the loop
   *  records under (`<runDir>/baseline/...`, `<runDir>/gen-<g>/candidate-<i>/...`).
   *  Must be a real path; a `mem://` run records nothing to resolve. */
  runDir: string
}

/**
 * Build the `resolveTraces` function `traceAnalystProposer`/`haloProposer`
 * take: proposing generation g reads the traces of the campaigns the loop just
 * scored — `gen-<g-1>` (or `baseline` when g = 0), falling back to every trace
 * under the run root when that directory has none (e.g. a caller pointing at a
 * single campaign dir rather than a loop root).
 *
 *   traceAnalystProposer({ ..., resolveTraces: campaignTraceResolver({ runDir }) })
 */
export function campaignTraceResolver(
  opts: CampaignTraceResolverOptions,
): (ctx: Pick<ProposeContext, 'generation'>) => string {
  return (ctx) => {
    const priorDir =
      ctx.generation <= 0
        ? join(opts.runDir, 'baseline')
        : join(opts.runDir, `gen-${ctx.generation - 1}`)
    const prior = convertCampaignDirToOtlp(priorDir, opts)
    if (prior) return prior
    return convertCampaignDirToOtlp(opts.runDir, opts)
  }
}

/** Parse `spans.jsonl` content into records, splitting the trace writer's
 *  reserved fields from the free-form attributes. Malformed lines are skipped
 *  (one torn write must not censor the rest of the cell). */
function parseCampaignSpans(content: string, cellId: string): CampaignSpanRecord[] {
  const out: CampaignSpanRecord[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: unknown
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const o = raw as Record<string, unknown>
    if (typeof o.name !== 'string' || typeof o.startMs !== 'number') continue

    const attributes: Record<string, unknown> = { 'campaign.cell_id': cellId }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'name' || k === 'cellId' || k === 'startMs' || k === 'durationMs') continue
      attributes[k] = v
    }
    out.push({
      name: o.name,
      cellId,
      startMs: o.startMs,
      ...(typeof o.durationMs === 'number' ? { durationMs: o.durationMs } : {}),
      attributes,
      ...(typeof o.error === 'string' ? { error: o.error } : {}),
    })
  }
  return out
}

/** All `spans.jsonl` files under `dir`, depth-bounded, symlink-dirs skipped
 *  (a cycle under a run dir must not hang the proposal round). Sorted for a
 *  deterministic concatenation order. */
function findSpansFiles(dir: string, depth: number): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === 'spans.jsonl') {
      out.push(full)
    } else if (depth > 0 && entry.isDirectory() && !entry.isSymbolicLink()) {
      out.push(...findSpansFiles(full, depth - 1))
    }
  }
  return out.sort()
}

function msToIso(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date(0).toISOString()
}

/** Deterministic FNV-1a fold to OTLP's 16-hex span-id width. */
function foldTo16Hex(s: string): string {
  const a = fnv1a(s)
  const b = fnv1a(`${s}::salt`)
  return a + b
}

/** Deterministic FNV-1a fold to OTLP's 32-hex trace-id width. */
function foldTo32Hex(s: string): string {
  return foldTo16Hex(s) + foldTo16Hex(`${s}::trace`)
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
