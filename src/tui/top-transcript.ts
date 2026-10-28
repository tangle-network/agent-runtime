import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { PursuitNodeProjection } from '../durable/observer-projection'
import { FileResultBlobStore } from '../durable/spawn-journal/result-blob-store'
import { recordValue } from '../record-value'
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
  return [...rows, ...transcriptRows({ liveTail: readTranscriptTail(worker.eventFile) })]
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
  return (artifact?.files ?? []).flatMap((file) =>
    (typeof file.content === 'string' ? file.content.split('\n') : []).flatMap((text) => {
      try {
        const message = recordValue(JSON.parse(text))
        return message?.role === 'assistant' || message?.role === 'tool'
          ? [JSON.stringify({ at, message })]
          : []
      } catch {
        return []
      }
    }),
  )
}

/** Present the recorded tail through sandbox-ui's existing agent-stream contract. */
export function transcriptRows(worker: Pick<WorkerView, 'liveTail'>) {
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
    let value: Record<string, unknown> | undefined
    try {
      value = recordValue(JSON.parse(line))
    } catch {
      continue
    }
    const timestamp = value?.timestamp ?? value?.at
    const time = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp
    if (typeof time !== 'number' || !Number.isFinite(new Date(time).getTime())) continue
    const at = new Date(time).toISOString()
    const push = (event: (typeof rows)[number]['event']) => rows.push({ at, event })
    const event = recordValue(value?.event)
    if (typeof event?.kind === 'string') {
      const kind =
        (
          {
            text_delta: 'text',
            reasoning_delta: 'reasoning',
            tool_call: 'tool-call',
            tool_result: 'tool-result',
          } as Record<string, string>
        )[event.kind] ?? event.kind
      push({ ...event, kind })
      continue
    }
    const message = recordValue(value?.message)
    if (!message) continue
    if (message.role === 'tool') {
      push({
        kind: 'tool-result',
        toolCallId: String(message.tool_call_id),
        result: message.content,
      })
      continue
    }
    for (const item of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const call = recordValue(item),
        fn = recordValue(call?.function)
      if (call && fn)
        push({
          kind: 'tool-call',
          toolCallId: String(call.id),
          toolName: String(fn.name),
          args: fn.arguments,
        })
    }
    const parts =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? message.content
          : []
    for (const part of parts) {
      if (!recordValue(part)) continue
      if (part.type === 'text' && typeof part.text === 'string')
        push({ kind: message.role === 'user' ? 'user' : 'text', text: part.text })
      else if (part.type === 'thinking' && typeof part.thinking === 'string')
        push({ kind: 'reasoning', text: part.thinking })
      else if (part.type === 'tool_use')
        push({
          kind: 'tool-call',
          toolCallId: String(part.id),
          toolName: String(part.name),
          args: part.input,
        })
      else if (part.type === 'tool_result')
        push({ kind: 'tool-result', toolCallId: String(part.tool_use_id), result: part.content })
    }
  }
  return rows
}

/** The bounded native/normalized tail shared by snapshot adapters and selected streams. */
export function readTranscriptTail(file: string) {
  return readRecordedEvents(file, 200).lines
}

export function transcriptTail(worker: WorkerView) {
  return transcriptRows(
    worker.eventFile ? { ...worker, liveTail: readTranscriptTail(worker.eventFile) } : worker,
  )
}

/** Actual recorded event time and cadence; absence means no event evidence, never file mtime. */
export interface RecordedActivity {
  readonly lastActivityAt?: number
  readonly medianEventGapMs?: number
}

export interface RecordedEvents {
  readonly file: string
  readonly lines: string[]
  readonly activity: RecordedActivity
  readonly firstActivityAt?: number
}

interface Cursor {
  dev: number
  ino: number
  offset: number
  pending: string
  decoder: StringDecoder
  times: number[]
  result: RecordedEvents
}

const cursors = new Map<string, Cursor>()
const activityKinds = new Set([
  'text',
  'reasoning',
  'user',
  'tool-call',
  'tool-result',
  'interaction',
  'child_task',
])

/** Scan once, then read appended bytes. Commit only complete lines, including split UTF-8 rows. */
export function readRecordedEvents(file: string, maxLines = 8): RecordedEvents {
  const fd = openSync(file, 'r')
  try {
    const stat = fstatSync(fd)
    let cursor = cursors.get(file)
    if (
      !cursor ||
      cursor.dev !== stat.dev ||
      cursor.ino !== stat.ino ||
      stat.size < cursor.offset
    ) {
      cursor = {
        dev: stat.dev,
        ino: stat.ino,
        offset: 0,
        pending: '',
        decoder: new StringDecoder('utf8'),
        times: [],
        result: { file, lines: [], activity: {} },
      }
      cursors.set(file, cursor)
    }
    if (stat.size === cursor.offset)
      return { ...cursor.result, lines: cursor.result.lines.slice(-maxLines) }
    const lines = [...cursor.result.lines]
    const buffer = Buffer.alloc(Math.min(65_536, stat.size - cursor.offset))
    while (cursor.offset < stat.size) {
      const bytes = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, stat.size - cursor.offset),
        cursor.offset,
      )
      if (!bytes) break
      cursor.offset += bytes
      const rows = (cursor.pending + cursor.decoder.write(buffer.subarray(0, bytes))).split('\n')
      cursor.pending = rows.pop()!
      for (const line of rows) {
        if (!line.trim()) continue
        lines.push(line)
        if (lines.length > 200) lines.shift()
        // One source row is one instant even when a native message contains several parts.
        const activity = transcriptRows({ liveTail: [line] }).find((row) =>
          activityKinds.has(row.event.kind),
        )
        if (activity) cursor.times.push(Date.parse(activity.at))
      }
    }
    cursor.times.sort((a, b) => a - b)
    const gaps = cursor.times
      .slice(1)
      .map((at, i) => at - cursor.times[i]!)
      .sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    cursor.result = {
      file,
      lines,
      ...(cursor.times.length ? { firstActivityAt: cursor.times[0]! } : {}),
      activity: {
        ...(cursor.times.length ? { lastActivityAt: cursor.times.at(-1)! } : {}),
        ...(gaps.length
          ? { medianEventGapMs: (gaps[Math.floor((gaps.length - 1) / 2)]! + gaps[mid]!) / 2 }
          : {}),
      },
    }
    return { ...cursor.result, lines: lines.slice(-maxLines) }
  } catch (error) {
    cursors.delete(file)
    throw error
  } finally {
    closeSync(fd)
  }
}
