import { readCommittedJsonLines } from '../durable/jsonl-file'
import type { WorkerView } from './top-snapshot'

/** Read selected history on demand, leaving the live topology snapshot bounded and fast. */
export async function transcriptHistory(worker: WorkerView) {
  if (!worker.eventFile) return transcriptRows(worker)
  const lines: string[] = []
  for await (const row of readCommittedJsonLines<unknown>(worker.eventFile)) {
    lines.push(JSON.stringify(row))
    if (lines.length > 200) lines.shift()
  }
  return transcriptRows({ ...worker, liveTail: lines })
}

/** Present the recorded tail through sandbox-ui's existing agent-stream contract. */
export function transcriptRows(worker: WorkerView) {
  const rows: {
    at: string
    event: {
      kind: string
      text?: string
      toolCallId?: string
      toolName?: string
      args?: unknown
      result?: unknown
    }
  }[] = []
  for (const line of worker.liveTail) {
    let value: Record<string, unknown>
    try {
      value = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const at =
      typeof value.timestamp === 'string'
        ? value.timestamp
        : typeof value.at === 'string'
          ? value.at
          : undefined
    if (!at || !Number.isFinite(Date.parse(at))) continue
    const event = value.event as
      | {
          kind?: string
          text?: string
          toolName?: string
          toolCallId?: string
          args?: unknown
          result?: unknown
        }
      | undefined
    if (event?.kind) {
      const kind =
        (
          {
            text_delta: 'text',
            reasoning_delta: 'reasoning',
            tool_call: 'tool-call',
            tool_result: 'tool-result',
          } as Record<string, string>
        )[event.kind] ?? event.kind
      rows.push({ at, event: { ...event, kind } })
      continue
    }
    const message = value.message as
      | { role?: string; content?: string | Record<string, unknown>[] }
      | undefined
    if (!message) continue
    const parts =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : (message.content ?? [])
    for (const part of parts) {
      if (part.type === 'text' && typeof part.text === 'string')
        rows.push({
          at,
          event: { kind: message.role === 'user' ? 'user' : 'text', text: part.text },
        })
      else if (part.type === 'thinking' && typeof part.thinking === 'string')
        rows.push({ at, event: { kind: 'reasoning', text: part.thinking } })
      else if (part.type === 'tool_use')
        rows.push({
          at,
          event: {
            kind: 'tool-call',
            toolCallId: String(part.id),
            toolName: String(part.name),
            args: part.input,
          },
        })
      else if (part.type === 'tool_result')
        rows.push({
          at,
          event: {
            kind: 'tool-result',
            toolCallId: String(part.tool_use_id),
            result: part.content,
          },
        })
    }
  }
  return rows
}
