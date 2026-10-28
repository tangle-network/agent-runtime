import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readCommittedJsonLines } from '../durable/jsonl-file'
import type { PursuitNodeProjection } from '../durable/observer-projection'
import { FileResultBlobStore } from '../durable/spawn-journal/result-blob-store'
import type { WorkerView } from './top-snapshot'

/** Read selected history on demand, leaving the live topology snapshot bounded and fast. */
export async function transcriptHistory(
  worker: WorkerView,
  runDir?: string,
  node?: PursuitNodeProjection,
) {
  const rows: ReturnType<typeof transcriptRows> = []
  const identity = node?.identity as { taskDigest?: unknown; profileDigest?: unknown } | undefined
  if (runDir && typeof identity?.taskDigest === 'string' && worker.startedAt) {
    const task = await new FileResultBlobStore(join(runDir, 'blobs')).get(identity.taskDigest)
    if (task !== undefined)
      rows.unshift({
        at: worker.startedAt,
        event: {
          kind: 'notice',
          provenance: 'delegated-input',
          source: `parent ${node?.parentId ?? 'run caller'}; task ${identity.taskDigest}${typeof identity.profileDigest === 'string' ? `; profile ${identity.profileDigest}` : ''}; Runtime FileResultBlobStore`,
          text: typeof task === 'string' ? task : JSON.stringify(task, null, 2),
        },
      })
  }
  if (!worker.eventFile) {
    const retained = runDir ? await retainedTranscriptLines(worker, runDir) : []
    const native = transcriptRows(retained.length ? { ...worker, liveTail: retained } : worker)
    if (!native.length && worker.startedAt)
      rows.push({
        at: worker.startedAt,
        event: {
          kind: 'notice',
          provenance: 'capture-unavailable',
          text: 'Native conversation was not captured for this agent.',
          source: 'Runtime recorded capture',
        },
      })
    // Without its conversation, the agent's settled result is still what it delivered.
    const result =
      runDir && node?.outRef && worker.endedAt
        ? await new FileResultBlobStore(join(runDir, 'blobs')).get(node.outRef)
        : undefined
    if (result !== undefined)
      native.push({
        at: worker.endedAt!,
        event: {
          kind: 'notice',
          provenance: 'recorded-result',
          source: `result ${node!.outRef}; Runtime FileResultBlobStore`,
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      })
    return [...rows, ...native]
  }
  const lines: string[] = []
  for await (const row of readCommittedJsonLines<unknown>(worker.eventFile)) {
    lines.push(JSON.stringify(row))
    if (lines.length > 200) lines.shift()
  }
  return [...rows, ...transcriptRows({ ...worker, liveTail: lines })]
}

/**
 * A settled worker's retained Router conversation as progress lines, for an executor that ran its
 * tool loop in process and so streamed nothing. The messages carry no times; each takes the
 * worker's settlement time. Other harnesses' session files have their own formats and stay unread.
 */
async function retainedTranscriptLines(worker: WorkerView, runDir: string): Promise<string[]> {
  const at = worker.endedAt
  if (worker.transcript?.harness !== 'router' || at === undefined) return []
  const artifact = (await new FileResultBlobStore(join(runDir, 'blobs')).get(
    worker.transcript.ref,
  )) as { files?: { content?: unknown }[] } | undefined
  const line = (event: Record<string, unknown>) => JSON.stringify({ at, event })
  return (artifact?.files ?? []).flatMap((file) =>
    (typeof file.content === 'string' ? file.content.split('\n') : []).flatMap((text) => {
      let message: {
        role?: string
        content?: unknown
        tool_call_id?: string
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
      }
      try {
        message = JSON.parse(text)
      } catch {
        return []
      }
      if (message.role === 'tool')
        return [
          line({ kind: 'tool_result', toolCallId: message.tool_call_id, result: message.content }),
        ]
      if (message.role !== 'assistant') return []
      return [
        ...(typeof message.content === 'string' && message.content.length > 0
          ? [line({ kind: 'text_delta', text: message.content })]
          : []),
        ...(message.tool_calls ?? []).map((call) =>
          line({
            kind: 'tool_call',
            toolCallId: call.id,
            toolName: call.function?.name,
            args: call.function?.arguments,
          }),
        ),
      ]
    }),
  )
}

/** Present the recorded tail through sandbox-ui's existing agent-stream contract. */
export function transcriptRows(worker: WorkerView) {
  const rows: {
    at: string
    event: {
      kind: string
      text?: string
      provenance?: string
      source?: string
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

/** The bounded native/normalized tail shared by snapshot adapters and selected streams. */
export function readTranscriptTail(file: string) {
  const fd = openSync(file, 'r')
  try {
    const size = statSync(file).size
    const buffer = Buffer.alloc(Math.min(size, 65_536))
    readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length))
    const lines = buffer.toString().split('\n')
    lines.pop() // An uncommitted final row is not an event.
    if (size > buffer.length) lines.shift()
    return lines.filter(Boolean).slice(-200)
  } finally {
    closeSync(fd)
  }
}

export function transcriptTail(worker: WorkerView) {
  return transcriptRows(
    worker.eventFile ? { ...worker, liveTail: readTranscriptTail(worker.eventFile) } : worker,
  )
}
