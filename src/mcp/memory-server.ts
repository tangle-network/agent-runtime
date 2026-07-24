/**
 * Memory MCP server — the LIVE serving half of the `memory` profile surface
 * (Phase 5). A curated memory (lessons distilled from prior runs) is only
 * real if the DRIVEN agent can query it mid-task; this module serves a flat
 * store of `MemoryItem` rows as `memory_search` / `memory_get` tools over the
 * ONE in-repo stdio JSON-RPC core (`createStdioToolServer`), so the exact
 * wire protocol the same-host client (`connectStdioMcp` /
 * `materializeLocalMcp`, runtime/stdio-mcp-client.ts) speaks is guaranteed by
 * construction — serve and consume cannot drift.
 *
 * Retrieval is DETERMINISTIC lexical overlap (no vectors, no LLM): a lift
 * measured with this memory mounted is attributable to the lessons
 * themselves, never to retrieval-model noise. Every
 * `memory_search` can append one JSONL row to a retrieval log (`logPath`) —
 * the per-query record an off-policy retrieval estimator (agent-knowledge's
 * `RetrievalHoldout`) consumes. agent-knowledge is NOT a dependency of this
 * repo, so the log file is the flagged cross-package seam, not an import.
 *
 * Fail-loud discipline (mirrors `materializeLocalMcp`): an EMPTY memory is
 * never served — a profile without memory simply omits the artifact, and
 * silently serving zero rows would fake the with/without ablation.
 *
 * @experimental
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentProfileMcpServer } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { createStdioToolServer, type McpToolDescriptor, type StdioToolServer } from './tool-server'

/** One row of agent memory: a crisp lesson/fact with provenance. */
export interface MemoryItem {
  /** Stable id (content-hash by convention; see `memoryArtifactFromLessons`). */
  id: string
  /** The lesson itself — one imperative or observation the agent should recall. */
  text: string
  /** Optional retrieval tags, matched by `memory_search` alongside the text. */
  tags?: string[]
  /** Provenance: the finding / trace / curation pass this row came from. */
  source?: string
}

/**
 * The `memory` artifact payload — HOW a profile's memory is stored and served:
 *
 *   - `store: 'file'` — served by the in-repo memory bin
 *     (`agent-runtime-memory-mcp`, src/mcp/memory-bin.ts): rows load from
 *     `path` (a JSON array or JSONL file of `MemoryItem`) and/or the inline
 *     `items` seed (inline wins on id collision). At least one of
 *     `path`/`items` is required.
 *   - `store: 'mcp'`  — an EXTERNAL, already-runnable MCP server that exposes
 *     the memory tools itself; `server` is required and mounts verbatim.
 *
 * `logPath` makes the served memory append one JSONL row per `memory_search`
 * — the retrieval log a holdout estimator reads (see module doc).
 */
export interface AgentMemorySpec {
  store: 'file' | 'mcp'
  /** `store:'file'` — host path to the durable row store (JSON array or JSONL). */
  path?: string
  /** Inline seed rows, served alongside (and winning over) `path` rows. */
  items?: MemoryItem[]
  /** `store:'mcp'` — the external server that already serves memory tools. */
  server?: AgentProfileMcpServer
  /** JSONL retrieval log: one row per `memory_search` (ts, query, k, returned). */
  logPath?: string
}

/** Env var naming the durable row store file the memory bin loads (the
 *  `memoryMcpServer` ↔ memory-bin contract). */
export const MEMORY_FILE_ENV = 'AGENT_MEMORY_FILE'
/** Env var carrying inline JSON `MemoryItem` rows (win over file rows on id). */
export const MEMORY_ITEMS_ENV = 'AGENT_MEMORY_ITEMS'
/** Env var naming the JSONL retrieval log (one row per `memory_search`). */
export const MEMORY_LOG_ENV = 'AGENT_MEMORY_LOG'
/** Env var overriding the served display name (default 'agent-memory'). */
export const MEMORY_NAME_ENV = 'AGENT_MEMORY_NAME'

export interface CreateMemoryToolServerOptions {
  /** The rows to serve. MUST be non-empty (an empty memory is never served). */
  items: readonly MemoryItem[]
  /** Server display name surfaced via `initialize`. Default 'agent-memory'. */
  serverName?: string
  /** Server version surfaced via `initialize`. Default '0'. */
  serverVersion?: string
  /** Default result count for `memory_search`. Default 5. */
  defaultK?: number
  /** Append one JSONL row per `memory_search` (the retrieval-holdout seam). */
  logPath?: string
}

/**
 * Build the memory MCP server: `memory_search` (lexical top-k over the rows)
 * and `memory_get` (one row by id) on the generic stdio JSON-RPC core.
 */
export function createMemoryToolServer(opts: CreateMemoryToolServerOptions): StdioToolServer {
  if (opts.items.length === 0) {
    throw new ValidationError(
      'createMemoryToolServer: refusing to serve an EMPTY memory — a profile without memory omits the artifact; serving zero rows would fake the with/without ablation',
    )
  }
  const byId = new Map<string, MemoryItem>()
  for (const item of opts.items) {
    if (byId.has(item.id)) {
      throw new ValidationError(`createMemoryToolServer: duplicate memory item id '${item.id}'`)
    }
    byId.set(item.id, item)
  }
  const items = [...byId.values()]
  const defaultK = opts.defaultK ?? 5
  const logPath = opts.logPath
  if (logPath) mkdirSync(dirname(logPath), { recursive: true })

  const search: McpToolDescriptor = {
    name: 'memory_search',
    description:
      'Search the agent memory of lessons learned from prior runs. Give what you are about to do or the problem you face; returns the top-k lessons ranked by relevance. Consult it BEFORE repeating work a prior run already learned from.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The task/problem at hand — matched against lesson text and tags.',
        },
        k: { type: 'number', description: `Max results (default ${defaultK}).` },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only return items carrying at least one of these tags.',
        },
      },
      required: ['query'],
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as { query?: unknown; k?: unknown; tags?: unknown }
      if (typeof args.query !== 'string' || args.query.trim().length === 0) {
        throw new TypeError('memory_search: query must be a non-empty string')
      }
      const k = args.k === undefined ? defaultK : Math.floor(Number(args.k))
      if (!Number.isFinite(k) || k < 1) {
        throw new TypeError('memory_search: k must be a positive integer')
      }
      let tagFilter: string[] | undefined
      if (args.tags !== undefined) {
        if (!Array.isArray(args.tags) || args.tags.some((t) => typeof t !== 'string')) {
          throw new TypeError('memory_search: tags must be an array of strings')
        }
        tagFilter = args.tags as string[]
      }
      const queryTokens = tokenize(args.query)
      const pool = tagFilter
        ? items.filter((i) => (i.tags ?? []).some((t) => tagFilter.includes(t)))
        : items
      const results = pool
        .map((item) => ({ item, score: scoreItem(queryTokens, item) }))
        .filter((r) => r.score > 0)
        // Highest score first; stable on ties (curation order is the tiebreak).
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ item, score }) => ({
          id: item.id,
          text: item.text,
          score: Number(score.toFixed(4)),
          ...(item.tags ? { tags: item.tags } : {}),
          ...(item.source ? { source: item.source } : {}),
        }))
      if (logPath) {
        // The retrieval log: what was asked, what came back, at what rank —
        // exactly the per-query record an off-policy estimator needs.
        appendFileSync(
          logPath,
          `${JSON.stringify({
            ts: new Date().toISOString(),
            query: args.query,
            k,
            returned: results.map((r) => ({ id: r.id, score: r.score })),
          })}\n`,
        )
      }
      return { query: args.query, results }
    },
  }

  const get: McpToolDescriptor = {
    name: 'memory_get',
    description: 'Fetch one memory item verbatim by its id (ids come from memory_search results).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The memory item id.' } },
      required: ['id'],
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as { id?: unknown }
      if (typeof args.id !== 'string' || args.id.trim().length === 0) {
        throw new TypeError('memory_get: id must be a non-empty string')
      }
      const item = byId.get(args.id)
      if (!item) throw new Error(`memory_get: no memory item with id '${args.id}'`)
      return item
    },
  }

  return createStdioToolServer({
    serverName: opts.serverName ?? 'agent-memory',
    serverVersion: opts.serverVersion ?? '0',
    tools: [search, get],
  })
}

/** Coerce an untrusted JSON array into validated `MemoryItem` rows. */
export function parseMemoryItems(value: unknown, source: string): MemoryItem[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${source}: expected a JSON array of memory items`)
  }
  return value.map((row, i) => coerceMemoryItem(row, `${source}[${i}]`))
}

/** Read a memory store file: a JSON array, or JSONL (one `MemoryItem` per line). */
export function readMemoryItemsFile(path: string): MemoryItem[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new ValidationError(
      `readMemoryItemsFile: cannot read '${path}': ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return []
  if (trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      throw new ValidationError(
        `readMemoryItemsFile: '${path}' is not valid JSON: ${(err as Error).message}`,
      )
    }
    return parseMemoryItems(parsed, path)
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (err) {
        throw new ValidationError(
          `readMemoryItemsFile: '${path}' line ${i + 1} is not valid JSON: ${(err as Error).message}`,
        )
      }
      return coerceMemoryItem(parsed, `${path}:${i + 1}`)
    })
}

/** What the memory bin resolved from its environment. */
export interface ResolvedMemoryEnv {
  items: MemoryItem[]
  serverName?: string
  logPath?: string
}

/**
 * Resolve the bin's memory from `AGENT_MEMORY_FILE` (durable store) and/or
 * `AGENT_MEMORY_ITEMS` (inline JSON rows; wins on id collision). Zero rows is
 * a boot FAILURE, matching the fail-closed materialization discipline.
 */
export function resolveMemoryFromEnv(env: Record<string, string | undefined>): ResolvedMemoryEnv {
  const filePath = env[MEMORY_FILE_ENV]
  const inlineRaw = env[MEMORY_ITEMS_ENV]
  const fromFile = filePath ? readMemoryItemsFile(filePath) : []
  let inline: MemoryItem[] = []
  if (inlineRaw) {
    let parsed: unknown
    try {
      parsed = JSON.parse(inlineRaw)
    } catch (err) {
      throw new ValidationError(
        `${MEMORY_ITEMS_ENV} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    inline = parseMemoryItems(parsed, MEMORY_ITEMS_ENV)
  }
  const byId = new Map<string, MemoryItem>()
  for (const item of fromFile) byId.set(item.id, item)
  for (const item of inline) byId.set(item.id, item)
  if (byId.size === 0) {
    throw new ValidationError(
      `memory bin: no memory items — set ${MEMORY_FILE_ENV} and/or ${MEMORY_ITEMS_ENV}; an EMPTY memory must never be served (a profile without memory omits the artifact)`,
    )
  }
  const serverName = env[MEMORY_NAME_ENV]
  const logPath = env[MEMORY_LOG_ENV]
  return {
    items: [...byId.values()],
    ...(serverName ? { serverName } : {}),
    ...(logPath ? { logPath } : {}),
  }
}

function coerceMemoryItem(row: unknown, at: string): MemoryItem {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new ValidationError(`${at}: memory item must be an object`)
  }
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.trim().length === 0) {
    throw new ValidationError(`${at}: 'id' must be a non-empty string`)
  }
  if (typeof r.text !== 'string' || r.text.trim().length === 0) {
    throw new ValidationError(`${at}: 'text' must be a non-empty string`)
  }
  let tags: string[] | undefined
  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== 'string')) {
      throw new ValidationError(`${at}: 'tags' must be an array of strings`)
    }
    tags = r.tags as string[]
  }
  if (r.source !== undefined && typeof r.source !== 'string') {
    throw new ValidationError(`${at}: 'source' must be a string`)
  }
  return {
    id: r.id,
    text: r.text,
    ...(tags ? { tags } : {}),
    ...(typeof r.source === 'string' ? { source: r.source } : {}),
  }
}

/** Unique lowercase alphanumeric tokens of length >= 2. */
function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2),
    ),
  ]
}

/** Fraction of query tokens present in the item's text + tags (0..1). */
function scoreItem(queryTokens: readonly string[], item: MemoryItem): number {
  if (queryTokens.length === 0) return 0
  const hay = new Set(tokenize(`${item.text} ${(item.tags ?? []).join(' ')}`))
  let hit = 0
  for (const t of queryTokens) if (hay.has(t)) hit += 1
  return hit / queryTokens.length
}
