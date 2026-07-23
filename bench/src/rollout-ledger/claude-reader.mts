/**
 * Backfill reader over Claude Code project transcripts
 * (~/.claude/projects/<cwd-slug>/<sessionId>.jsonl) → canonical
 * chat-with-tools messages plus per-session token usage.
 *
 * Transcript lines consumed: type:"user" (string content or content blocks —
 * text + tool_result) and type:"assistant" (content blocks — thinking, text,
 * tool_use; message.usage carries tokens). Sidechain lines (isSidechain=true,
 * subagent threads) are separate invocations and are excluded from the main
 * transcript. Everything else (queue-operation, attachment, last-prompt…) is
 * transport metadata, not conversation.
 */

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage, ChatToolCall } from './types.ts'

export const DEFAULT_CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

/** Claude Code's project-directory slug for a working directory. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-')
}

export interface ClaudeTranscriptRef {
  sessionId: string
  path: string
}

/** Transcript files recorded for sessions launched from `cwd`. */
export async function findClaudeTranscripts(
  cwd: string,
  projectsDir: string = DEFAULT_CLAUDE_PROJECTS_DIR,
): Promise<ClaudeTranscriptRef[]> {
  const dir = join(projectsDir, claudeProjectSlug(cwd))
  const names = await readdir(dir).catch(() => [])
  return names
    .filter((n) => n.endsWith('.jsonl'))
    .sort()
    .map((n) => ({ sessionId: n.replace(/\.jsonl$/, ''), path: join(dir, n) }))
}

export interface ClaudeUsageTotals {
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
}

export interface ClaudeTranscript {
  messages: ChatMessage[]
  usage: ClaudeUsageTotals
  /** Timestamp of the first conversation line; null = empty transcript. */
  startedAt: string | null
  endedAt: string | null
  model: string | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is Record<string, unknown> => isRecord(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

/** Parse one transcript jsonl into canonical messages + usage totals. */
export async function readClaudeTranscript(path: string): Promise<ClaudeTranscript> {
  const raw = await readFile(path, 'utf8')
  const messages: ChatMessage[] = []
  const usage: ClaudeUsageTotals = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }
  let startedAt: string | null = null
  let endedAt: string | null = null
  let model: string | null = null
  // Claude Code writes one jsonl line PER CONTENT BLOCK of an API message,
  // repeating message.id and usage on each — merge blocks into one canonical
  // assistant turn and count usage once per API message id.
  let lastAssistantApiId: string | null = null
  let lastAssistantIndex = -1

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed)) continue
      entry = parsed
    } catch {
      continue
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    if (entry.isSidechain === true) continue
    const message = entry.message
    if (!isRecord(message)) continue
    if (typeof entry.timestamp === 'string') {
      if (startedAt === null) startedAt = entry.timestamp
      endedAt = entry.timestamp
    }

    if (entry.type === 'user') {
      lastAssistantApiId = null
      lastAssistantIndex = -1
      const content = message.content
      if (typeof content === 'string') {
        messages.push({ role: 'user', content })
        continue
      }
      if (!Array.isArray(content)) continue
      // A user line may interleave tool_result blocks (answers to the prior
      // assistant tool_use) with plain text; preserve order.
      let userText = ''
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: blockText(block.content) || (typeof block.content === 'string' ? block.content : ''),
          })
        } else if (block.type === 'text' && typeof block.text === 'string') {
          userText += (userText.length > 0 ? '\n' : '') + block.text
        }
      }
      if (userText.length > 0) messages.push({ role: 'user', content: userText })
      continue
    }

    // assistant
    if (typeof message.model === 'string') model = message.model
    const apiId = typeof message.id === 'string' ? message.id : null
    const continuesTurn = apiId !== null && apiId === lastAssistantApiId && lastAssistantIndex >= 0
    const msgUsage = message.usage
    if (isRecord(msgUsage) && !continuesTurn) {
      usage.tokensIn += typeof msgUsage.input_tokens === 'number' ? msgUsage.input_tokens : 0
      usage.tokensOut += typeof msgUsage.output_tokens === 'number' ? msgUsage.output_tokens : 0
      usage.cacheRead += typeof msgUsage.cache_read_input_tokens === 'number' ? msgUsage.cache_read_input_tokens : 0
      usage.cacheWrite +=
        typeof msgUsage.cache_creation_input_tokens === 'number' ? msgUsage.cache_creation_input_tokens : 0
    }
    const content = message.content
    if (!Array.isArray(content)) continue
    let reasoning = ''
    let text = ''
    const toolCalls: ChatToolCall[] = []
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
        reasoning += (reasoning.length > 0 ? '\n' : '') + block.thinking
      } else if (block.type === 'text' && typeof block.text === 'string') {
        text += (text.length > 0 ? '\n' : '') + block.text
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: typeof block.name === 'string' ? block.name : 'unknown',
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
      }
    }
    if (reasoning.length === 0 && text.length === 0 && toolCalls.length === 0) continue
    if (continuesTurn) {
      const prev = messages[lastAssistantIndex]
      if (text.length > 0) prev.content = prev.content === null ? text : `${prev.content}\n${text}`
      if (reasoning.length > 0) {
        prev.reasoning_content =
          prev.reasoning_content === undefined ? reasoning : `${prev.reasoning_content}\n${reasoning}`
      }
      if (toolCalls.length > 0) prev.tool_calls = [...(prev.tool_calls ?? []), ...toolCalls]
      continue
    }
    messages.push({
      role: 'assistant',
      content: text.length > 0 ? text : null,
      ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    })
    lastAssistantApiId = apiId
    lastAssistantIndex = messages.length - 1
  }

  return { messages, usage, startedAt, endedAt, model }
}
