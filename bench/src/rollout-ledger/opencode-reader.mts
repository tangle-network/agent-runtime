/**
 * Read-only backfill reader over the opencode sqlite store
 * (~/.local/share/opencode/opencode.db) → canonical chat-with-tools messages.
 *
 * Schema consumed (observed, 2026-07): `session` rows carry directory /
 * parent_id / agent / model / cost / tokens_*; `message` rows carry a JSON
 * `data` blob ({role, modelID, providerID, tokens, cost, finish}); `part`
 * rows carry the actual content ({type: text|reasoning|tool|step-start|
 * step-finish|snapshot…}). Tool parts hold {callID, state:{input, output,
 * status}} — both the call and its result, which we split into an assistant
 * tool_call plus a role:"tool" result message.
 *
 * The store is mutable and can be corrupt (a `.corrupt-bak` sibling ships
 * next to it in the wild), so `openOpencodeDb` returns null instead of
 * throwing — callers record a gap line, never crash the backfill.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ChatMessage, ChatToolCall } from './types.ts'

export const DEFAULT_OPENCODE_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

export interface OpencodeSessionRow {
  id: string
  parentId: string | null
  directory: string
  agent: string | null
  /** Raw session.model JSON: {id, providerID, variant} where present. */
  model: { id?: string; providerID?: string } | null
  costUsd: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
  timeCreated: number
  timeUpdated: number
}

/** Open the store read-only; null = unavailable/corrupt (caller records a gap). */
export async function openOpencodeDb(path: string = DEFAULT_OPENCODE_DB): Promise<DatabaseSync | null> {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path, { readOnly: true })
    // Probe: a corrupt store can open() fine and fail on first page read.
    db.prepare('SELECT id FROM session LIMIT 1').get()
    return db
  } catch {
    return null
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function parseSessionRow(row: Record<string, unknown>): OpencodeSessionRow {
  let model: OpencodeSessionRow['model'] = null
  if (typeof row.model === 'string' && row.model.length > 0) {
    try {
      const parsed: unknown = JSON.parse(row.model)
      if (isRecord(parsed)) model = parsed as { id?: string; providerID?: string }
    } catch {
      model = null
    }
  }
  return {
    id: String(row.id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    directory: String(row.directory),
    agent: row.agent === null || row.agent === undefined ? null : String(row.agent),
    model,
    costUsd: Number(row.cost ?? 0),
    tokensInput: Number(row.tokens_input ?? 0),
    tokensOutput: Number(row.tokens_output ?? 0),
    tokensReasoning: Number(row.tokens_reasoning ?? 0),
    tokensCacheRead: Number(row.tokens_cache_read ?? 0),
    tokensCacheWrite: Number(row.tokens_cache_write ?? 0),
    timeCreated: Number(row.time_created ?? 0),
    timeUpdated: Number(row.time_updated ?? 0),
  }
}

const SESSION_COLUMNS =
  'id, parent_id, directory, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated'

/** Sessions whose cwd is `directory` (the worker-clone join key). */
export function findOpencodeSessionsByDirectory(db: DatabaseSync, directory: string): OpencodeSessionRow[] {
  const rows = db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE directory = ? ORDER BY time_created`)
    .all(directory) as Array<Record<string, unknown>>
  return rows.map(parseSessionRow)
}

export function findOpencodeSessionById(db: DatabaseSync, sessionId: string): OpencodeSessionRow | null {
  const row = db.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE id = ?`).get(sessionId) as
    | Record<string, unknown>
    | undefined
  return row === undefined ? null : parseSessionRow(row)
}

interface OpencodePart {
  type?: string
  text?: string
  tool?: string
  callID?: string
  state?: { status?: string; input?: unknown; output?: unknown }
}

function toolResultContent(output: unknown): string {
  if (typeof output === 'string') return output
  if (output === null || output === undefined) return ''
  return JSON.stringify(output)
}

/**
 * Convert one session's message+part rows into canonical messages.
 * An opencode assistant message row spans several model steps; each step's
 * parts (reasoning → text → tool …) become one assistant message followed by
 * the role:"tool" results of its calls, preserving order.
 */
export function readOpencodeSessionMessages(db: DatabaseSync, sessionId: string): ChatMessage[] {
  const messageRows = db
    .prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id')
    .all(sessionId) as Array<{ id: string; data: string }>
  const partsStmt = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id')

  const messages: ChatMessage[] = []
  for (const messageRow of messageRows) {
    let data: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(messageRow.data)
      if (!isRecord(parsed)) continue
      data = parsed
    } catch {
      continue
    }
    const parts: OpencodePart[] = []
    for (const row of partsStmt.all(messageRow.id) as Array<{ data: string }>) {
      try {
        const parsed: unknown = JSON.parse(row.data)
        if (isRecord(parsed)) parts.push(parsed as OpencodePart)
      } catch {
        // Malformed part payload: skip the part, keep the message.
      }
    }

    if (data.role === 'user') {
      const text = parts
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n')
      messages.push({ role: 'user', content: text })
      continue
    }
    if (data.role !== 'assistant') continue

    // Split the row into steps at step-start boundaries; parts before the
    // first step-start (none observed, but tolerated) form an implicit step.
    const steps: OpencodePart[][] = []
    let current: OpencodePart[] = []
    for (const part of parts) {
      if (part.type === 'step-start') {
        if (current.length > 0) steps.push(current)
        current = []
        continue
      }
      if (part.type === 'step-finish' || part.type === 'snapshot' || part.type === 'patch') continue
      current.push(part)
    }
    if (current.length > 0) steps.push(current)

    for (const step of steps) {
      const reasoning = step
        .filter((p) => p.type === 'reasoning' && typeof p.text === 'string' && p.text.length > 0)
        .map((p) => p.text as string)
        .join('\n')
      const text = step
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('\n')
      const toolParts = step.filter((p) => p.type === 'tool' && typeof p.callID === 'string')
      const toolCalls: ChatToolCall[] = toolParts.map((p) => ({
        id: p.callID as string,
        type: 'function',
        function: {
          name: p.tool ?? 'unknown',
          arguments: JSON.stringify(p.state?.input ?? {}),
        },
      }))
      if (reasoning.length === 0 && text.length === 0 && toolCalls.length === 0) continue
      messages.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      for (const p of toolParts) {
        messages.push({
          role: 'tool',
          tool_call_id: p.callID as string,
          name: p.tool ?? 'unknown',
          content: toolResultContent(p.state?.output),
        })
      }
    }
  }
  return messages
}
