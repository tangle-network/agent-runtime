import { createHash } from 'node:crypto'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import type { PursuitNodeProjection } from '../durable/observer-projection'
import { FileResultBlobStore } from '../durable/spawn-journal/result-blob-store'
import { recordValue } from '../record-value'
import {
  type HarnessTranscriptArtifact,
  type HarnessTranscriptMetadata,
  harnessTranscriptArtifact,
} from '../runtime/harness-transcript'
import { ROOT_STREAM_FILE } from '../runtime/supervise/root-stream'
import type { ResultBlobStore } from '../runtime/supervise/types'
import type { SupervisorView, TopSnapshotDiagnostic, WorkerView } from './top-snapshot'

type BaselineAuthority = {
  readonly kind: 'retained-workspace' | 'git-object' | 'git-diff'
  readonly ref: string
}
type FileIdentity = { readonly sha256: string; readonly byteLength: number }
export interface TopInspection {
  readonly coverage: {
    readonly status: 'complete' | 'partial' | 'missing'
    readonly source: string
    readonly reason?: string
    readonly code?: 'source-mismatch' | 'source-unbound'
    readonly ref?: string
  }
  readonly rows?: readonly (TopTranscriptRow & {
    readonly id: string
    readonly sessionId: string
    readonly part: number
  })[]
  readonly context?: Readonly<ReturnType<typeof transcriptRows>>
  readonly files?: {
    readonly scope: 'workspace' | 'none'
    readonly complete: boolean
    readonly reason?: string
    readonly entries: readonly (FileIdentity & {
      readonly path: string
      readonly before?: FileIdentity & { readonly source: BaselineAuthority }
    })[]
  }
  readonly file?: FileIdentity & {
    readonly path: string
    readonly content: string
    readonly before?: FileIdentity & {
      readonly content: string
      readonly source: BaselineAuthority
    }
  }
}

export type TopTranscriptRow = ReturnType<typeof transcriptRows>[number]
export type TopSessionReader = (
  artifact: HarnessTranscriptArtifact,
  signal?: AbortSignal,
) => Promise<readonly HarnessRowsSession[]>

/** Read selected history on demand, leaving the live topology snapshot bounded and fast. */
export async function transcriptHistory(
  worker: WorkerView,
  runDir?: string,
  node?: PursuitNodeProjection,
) {
  return readTopAgentHistory(
    worker,
    runDir ? new FileResultBlobStore(join(runDir, 'blobs')) : undefined,
    node,
  )
}

/** Task, result and progress use the same projection for file-backed and SQL-backed runs. */
export async function readTopAgentHistory(
  worker: WorkerView,
  blobs?: Pick<ResultBlobStore, 'get'>,
  node?: PursuitNodeProjection,
) {
  const rows: TopTranscriptRow[] = []
  const identity = recordValue(node?.identity ?? worker.identity)
  if (blobs && typeof identity?.taskDigest === 'string' && worker.startedAt) {
    const task = await blobs.get(identity.taskDigest)
    if (task !== undefined)
      rows.push({
        at: worker.startedAt,
        event: {
          kind: 'notice',
          provenance: 'delegated-input',
          source: `parent ${worker.parent ?? node?.parentId ?? 'run caller'}; task ${identity.taskDigest}; profile ${identity.profileDigest}`,
          text: `Request from ${worker.parent ?? node?.parentId ?? 'run caller'}\n${typeof task === 'string' ? task : JSON.stringify(task, null, 2)}`,
        },
      })
  }
  const progress = transcriptTail(worker)
  if (worker.startedAt)
    rows.push({
      at: worker.startedAt,
      event: {
        kind: 'notice',
        provenance: 'capture-unavailable',
        text: 'Full conversation capture has not been verified in this progress tail.',
        source: 'Runtime progress evidence',
      },
    })
  const outRef = node?.outRef ?? worker.outRef
  const result = blobs && outRef && worker.endedAt ? await blobs.get(outRef) : undefined
  if (result !== undefined)
    progress.push({
      at: worker.endedAt!,
      event: {
        kind: 'notice',
        provenance: 'recorded-result',
        source: `result ${outRef}; Runtime ResultBlobStore`,
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      },
    })
  return [...rows, ...progress]
}

/** Resolve ordinary Runtime transcript evidence, never a product-specific capture registry. */
export async function readTopAgentInspection({
  worker,
  runId,
  blobs,
  readSessions,
  artifacts,
  signal,
}: {
  worker: WorkerView
  runId: string
  blobs: Pick<ResultBlobStore, 'get'>
  readSessions: TopSessionReader
  artifacts?: AgentCandidateArtifactPort
  signal?: AbortSignal
}): Promise<TopInspection> {
  const evidence = worker.harnessTranscript
  const files = {
    scope: 'none' as const,
    complete: true,
    reason: 'Transcript evidence does not include a workspace inventory',
    entries: [],
  }
  if (!evidence || evidence.status !== 'available')
    return {
      coverage: {
        status: 'missing',
        source: 'Runtime transcript receipt',
        reason: evidence?.reason ?? 'No transcript receipt was recorded',
      },
      files,
    }
  const metadata = await harnessTranscriptArtifact(evidence, blobs, { content: false, signal })
  if (!metadata) throw new Error('Available transcript receipt has no metadata')
  const binding = inspectionBinding(metadata, worker, runId)
  if (binding.mismatch.length)
    return {
      coverage: {
        status: 'missing',
        source: 'Runtime transcript receipt',
        code: 'source-mismatch',
        reason: binding.mismatch.join('; '),
      },
      files,
    }
  const artifact = await harnessTranscriptArtifact(evidence, blobs, { artifacts, signal })
  if (!artifact) throw new Error('Available transcript receipt has no artifact')
  const projection = harnessSessionRows(await readSessions(artifact, signal))
  const reasons = [
    ...binding.missing,
    ...(evidence.missing ?? []),
    ...artifact.skipped.map((file) => `${file.path}: ${file.reason}`),
    ...projection.gaps.map((gap) => `${gap.sessionId}/${gap.recordId}: ${gap.reason}`),
  ]
  const complete =
    evidence.coverageComplete === true && reasons.length === 0 && projection.rows.length > 0
  return {
    coverage: {
      status: complete ? 'complete' : 'partial',
      source: `${artifact.harness} Runtime transcript`,
      ref: `urn:${evidence.transcriptRef}`,
      ...(binding.missing.length ? { code: 'source-unbound' as const } : {}),
      ...(!complete
        ? { reason: reasons.join('; ') || 'Source completeness was not attested' }
        : {}),
    },
    rows: projection.rows,
    files,
  }
}

/** Verify the receipt belongs to the selected node before resolving any native/archive bytes. */
function inspectionBinding(metadata: HarnessTranscriptMetadata, worker: WorkerView, runId: string) {
  const mismatch: string[] = [],
    missing: string[] = []
  if (metadata.binding !== undefined && !recordValue(metadata.binding))
    mismatch.push('Capture Bridge binding is malformed')
  if (metadata.source && metadata.binding) mismatch.push('Capture has conflicting source bindings')
  const source = metadata.source ?? metadata.binding
  if (!source) return { mismatch, missing: ['Capture has no recorded node binding'] }
  const node = recordValue(source.node)
  if (!node) {
    if (source.node !== undefined) mismatch.push('Capture node binding is malformed')
    else missing.push('Capture has no recorded node identity')
  } else {
    for (const [key, expected] of [
      ['rootId', runId],
      ['nodeId', worker.id],
      ['parentId', worker.parent],
    ] as const) {
      if (expected !== undefined && node[key] !== expected)
        mismatch.push(`Capture ${key} does not match selected node`)
    }
    const attempt = worker.executionBindings?.at(-1)?.attemptId
    if (typeof node.attemptId !== 'string' || !node.attemptId)
      mismatch.push('Capture attempt identity is malformed')
    else if (attempt && node.attemptId !== attempt)
      mismatch.push('Capture attempt does not match selected node')
    else if (!attempt) missing.push('Selected node has no recorded execution attempt')
    const identity = recordValue(node.identity)
    for (const key of ['profileDigest', 'taskDigest'] as const) {
      const expected = worker.identity?.[key]
      if (expected && identity?.[key] === undefined) missing.push(`Capture has no recorded ${key}`)
      else if (expected && identity?.[key] !== expected)
        mismatch.push(`Capture ${key} does not match selected node`)
    }
  }
  const materialization = worker.materialization
  if (materialization?.status !== 'known')
    missing.push('Selected node has no known materialization')
  else {
    if (source.profileDigest !== materialization.effectiveProfileDigest)
      mismatch.push('Capture profile does not match selected materialization')
    const execution = materialization.execution
    const kind = metadata.source ? 'environment' : 'session'
    const id = metadata.source?.environmentId ?? metadata.binding?.sessionId
    if (execution.kind !== kind || execution.id !== id)
      mismatch.push('Capture execution does not match selected materialization')
  }
  if (
    metadata.binding &&
    (metadata.binding.kind !== 'bridge' ||
      !metadata.binding.nativeSessionId ||
      !metadata.binding.sessionId)
  )
    mismatch.push('Capture Bridge binding is malformed')
  return { mismatch, missing }
}

/** One selected-agent mapping for filesystem and API transports; no execution or I/O. */
export function topAgentWorker(run: SupervisorView, workerId: string): WorkerView | undefined {
  const child = run.workers.find((worker) => worker.id === workerId)
  if (child || run.id !== workerId) return child
  return {
    id: run.id,
    label: 'root',
    status:
      run.status === 'cancelled'
        ? 'cancelled'
        : ['done', 'succeeded'].includes(run.status)
          ? 'done'
          : ['down', 'failed'].includes(run.status)
            ? 'down'
            : 'running',
    startedAt: run.startedAt,
    endedAt: run.completedAt,
    latencyMs: run.totals.latencyMs,
    spend: run.driverSpend,
    metered: { iterations: 0, tokensInput: 0, tokensOutput: 0, usd: 0, ms: 0 },
    liveTail: run.progressTail,
  }
}

export type TopAgentMetadata = Omit<TopInspection, 'rows' | 'context'> & {
  readonly context: readonly TopTranscriptRow[]
}

/** Metadata keeps full recorded context while the conversation can show compact attribution. */
export function topAgentMetadata(
  inspection: TopInspection | undefined,
  recorded: readonly TopTranscriptRow[],
): TopAgentMetadata {
  const { rows, ...metadata }: TopInspection = inspection ?? {
    coverage: {
      status: 'missing' as const,
      source: 'Runtime',
      reason: 'Verified conversation inspection was not provided',
    },
  }
  return {
    ...metadata,
    context: [
      ...(metadata.context ?? []),
      ...recorded.filter((row) => row.event.provenance === 'delegated-input'),
      ...(rows ?? []).filter((row) => row.event.provenance === 'system-instructions'),
    ],
  }
}

export interface TopAgentRowsFrame {
  readonly generation: number
  readonly events: readonly (TopTranscriptRow & { readonly seq: number })[]
  readonly lastSeq: number
  readonly alive: boolean
  readonly window: 'verified-native' | 'recorded-tail'
  readonly coverage?: TopInspection['coverage']
}

/** Both HTTP transports share conversation selection, stable identity, sequence and batching. */
export type TopAgentStreamFrame =
  | { readonly event: 'reset'; readonly data: { readonly generation: number } }
  | { readonly event: 'rows'; readonly data: TopAgentRowsFrame }

export function createTopAgentStream(generation: number) {
  let representation: string | undefined
  let initiatingInput: TopTranscriptRow | undefined
  const seen = new Set<string>()
  let lastSeq = 0
  return {
    reset: { generation },
    frame({
      recorded,
      inspection,
      alive,
      includeContext,
    }: {
      recorded: readonly TopTranscriptRow[]
      inspection?: TopInspection
      alive: boolean
      includeContext?: boolean
    }): readonly TopAgentStreamFrame[] {
      initiatingInput =
        recorded.find((row) => row.event.provenance === 'delegated-input') ?? initiatingInput
      const input = initiatingInput?.event.text
      const task = input?.includes('\n') ? input.slice(input.indexOf('\n') + 1) : undefined
      const hasNativePrompt =
        !!task &&
        !!inspection?.rows?.some(
          (row) =>
            row.event.kind === 'user' && row.event.actor !== 'injected' && row.event.text === task,
        )
      const shownInput =
        initiatingInput && hasNativePrompt && !includeContext
          ? {
              ...initiatingInput,
              event: {
                ...initiatingInput.event,
                text: input!.slice(0, input!.indexOf('\n')),
                provenance: 'recorded-sender',
              },
            }
          : initiatingInput
      const next = inspection?.rows?.length
        ? `capture:${inspection.coverage.ref ?? inspection.coverage.source}:${hasNativePrompt}`
        : 'progress'
      const frames: TopAgentStreamFrame[] = []
      if (representation !== undefined && representation !== next) {
        seen.clear()
        lastSeq = 0
        generation += 1
        frames.push({ event: 'reset', data: { generation } })
      }
      representation = next
      const rows = inspection?.rows?.length
        ? [
            ...(shownInput ? [shownInput] : []),
            ...recorded.filter(
              (row) =>
                inspection.coverage.status !== 'complete' &&
                row.event.provenance === 'recorded-result',
            ),
            ...inspection.rows.filter(
              (row) => includeContext || row.event.provenance !== 'system-instructions',
            ),
          ]
        : recorded
      const events = rows.flatMap((row) => {
        const key =
          'id' in row && typeof row.id === 'string'
            ? row.id
            : createHash('sha256').update(JSON.stringify(row)).digest('hex')
        if (seen.has(key)) return []
        seen.add(key)
        if (next === 'progress' && seen.size > 2000) seen.delete(seen.values().next().value!)
        return [{ ...row, seq: ++lastSeq }]
      })
      for (let offset = 0; offset < Math.max(events.length, 1); offset += 100) {
        const batch = events.slice(offset, offset + 100)
        frames.push({
          event: 'rows',
          data: {
            generation,
            events: batch,
            lastSeq: batch.at(-1)?.seq ?? lastSeq,
            alive,
            window:
              inspection?.coverage.status === 'complete' ? 'verified-native' : 'recorded-tail',
            ...(inspection ? { coverage: inspection.coverage } : {}),
          },
        })
      }
      return frames
    },
  }
}

/** Router records are Runtime's canonical ToolLoopMessageRecord, not a native file heuristic. */
export async function retainedRouterInspection(worker: WorkerView, runDir?: string) {
  const evidence = worker.harnessTranscript
  if (
    !runDir ||
    evidence?.status !== 'available' ||
    evidence.harness !== 'router' ||
    !worker.endedAt
  )
    return undefined
  const artifact = await harnessTranscriptArtifact(
    evidence,
    new FileResultBlobStore(join(runDir, 'blobs')),
  )
  if (!artifact || !('files' in artifact)) return undefined
  const records = artifact.files.flatMap((file) =>
    'content' in file
      ? file.content
          .split('\n')
          .filter(Boolean)
          .map((line) => recordValue(JSON.parse(line)))
          .filter((row) => row && typeof row.role === 'string')
      : [],
  )
  const rows = records.flatMap((message, index) =>
    transcriptRows({ liveTail: [JSON.stringify({ at: worker.endedAt, message })] }).map(
      (row, part) => ({
        ...row,
        id: JSON.stringify([evidence.transcriptRef, index, part]),
        sessionId: `router:${worker.id}`,
        part,
        event: {
          ...row.event,
          provenance: 'router-transcript',
          source: 'Message time unknown; shown at captured settlement time',
        },
      }),
    ),
  )
  return {
    coverage: {
      status: 'partial' as const,
      source: 'Runtime Router conversation, displayed at recorded settlement time',
      reason: 'Per-message times were not captured',
      ref: `urn:${evidence.transcriptRef}`,
    },
    rows,
    files: {
      scope: 'none' as const,
      complete: true,
      reason: 'This in-process conversation has no sandbox workspace inventory',
      entries: [],
    },
  }
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
      actor?: string
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
    }
    if (event?.kind) continue
    const legacy = (event: (typeof rows)[number]['event']) =>
      push({
        ...event,
        provenance: 'unverified-progress',
        source: 'Legacy progress only; full capture is unverified',
      })
    const message = recordValue(value?.message)
    if (!message) continue
    if (message.role === 'tool') {
      legacy({
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
        legacy({
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
      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > 0)
        legacy({ kind: message.role === 'user' ? 'user' : 'text', text: part.text })
      else if (part.type === 'thinking' && typeof part.thinking === 'string')
        legacy({ kind: 'reasoning', text: part.thinking })
      else if (part.type === 'tool_use')
        legacy({
          kind: 'tool-call',
          toolCallId: String(part.id),
          toolName: String(part.name),
          args: part.input,
        })
      else if (part.type === 'tool_result')
        legacy({ kind: 'tool-result', toolCallId: String(part.tool_use_id), result: part.content })
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
  lines: string[]
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

function recordedActivity(line: string) {
  return transcriptRows({ liveTail: [line] }).find((row) => activityKinds.has(row.event.kind))
}

/** Read appended UTF-8 bytes once; complete EOF JSON follows the durable reader contract. */
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
        lines: [],
        result: { file, lines: [], activity: {} },
      }
      cursors.set(file, cursor)
    }
    if (stat.size === cursor.offset)
      return { ...cursor.result, lines: cursor.result.lines.slice(-maxLines) }
    const lines = [...cursor.lines]
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
        const activity = recordedActivity(line)
        if (activity) cursor.times.push(Date.parse(activity.at))
      }
    }
    cursor.lines = lines
    // A complete EOF row is valid durable JSONL. Keep it separate until its newline arrives.
    let pending: string[] = []
    if (cursor.pending.trim()) {
      try {
        JSON.parse(cursor.pending)
        pending = [cursor.pending]
      } catch {
        // A torn row is still private to its writer.
      }
    }
    const final = pending.length ? recordedActivity(pending[0]!) : undefined
    const times = (final ? [...cursor.times, Date.parse(final.at)] : cursor.times).sort(
      (a, b) => a - b,
    )
    const gaps = times
      .slice(1)
      .map((at, i) => at - times[i]!)
      .sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    cursor.result = {
      file,
      lines: [...lines, ...pending].slice(-200),
      ...(times.length ? { firstActivityAt: times[0]! } : {}),
      activity: {
        ...(times.length ? { lastActivityAt: times.at(-1)! } : {}),
        ...(gaps.length
          ? { medianEventGapMs: (gaps[Math.floor((gaps.length - 1) / 2)]! + gaps[mid]!) / 2 }
          : {}),
      },
    }
    return { ...cursor.result, lines: cursor.result.lines.slice(-maxLines) }
  } catch (error) {
    cursors.delete(file)
    throw error
  } finally {
    closeSync(fd)
  }
}

/** Read native progress files with bounded, path-only diagnostics. */
export function readWorkerEventTails(dir: string) {
  const out = new Map<string, RecordedEvents>()
  const diagnostics: TopSnapshotDiagnostic[] = []
  const read = (path: string, key = join(dir, path)) => {
    try {
      if (existsSync(join(dir, path))) out.set(key, readRecordedEvents(join(dir, path)))
    } catch {
      diagnostics.push({ source: 'worker-tail', path, reason: 'unreadable' })
    }
  }
  read(ROOT_STREAM_FILE)
  for (const folder of ['workers', 'streams']) {
    if (!existsSync(join(dir, folder))) continue
    try {
      for (const entry of readdirSync(join(dir, folder))) {
        // Inbox steer requests are not evidence that the executor emitted progress.
        if (folder === 'workers' && entry.endsWith('.ndjson') && !entry.endsWith('.inbox.ndjson'))
          read(join(folder, entry), entry.slice(0, -'.ndjson'.length))
        else if (folder === 'streams' && entry.endsWith('.jsonl')) read(join(folder, entry))
      }
    } catch {
      diagnostics.push({ source: 'worker-tail', path: folder, reason: 'unreadable' })
    }
  }
  return { value: out, diagnostics }
}

/** The normalized subset consumed here; native decoding stays with harness-sessions. */
export interface HarnessRowsSession {
  readonly nativeSessionId: string
  readonly messages: readonly {
    readonly id: string
    readonly at?: string | null
    readonly role: string
    readonly actor?: string
    readonly parts: readonly {
      readonly type: string
      readonly text?: string
      readonly toolCallId?: string
    }[]
  }[]
  readonly toolCalls: readonly {
    readonly id: string
    readonly name: string
    readonly startedAt?: string | null
    readonly endedAt?: string | null
    readonly input?: unknown
    readonly inputText?: string | null
    readonly result?: { readonly output?: unknown; readonly text?: string | null } | null
  }[]
}
export type HarnessRowsGap = {
  readonly sessionId: string
  readonly recordId: string
  readonly reason: string
}
export type HarnessSessionRow = ReturnType<typeof transcriptRows>[number] & {
  readonly id: string
  readonly sessionId: string
  readonly part: number
}

/** One ordered projection for every strict native reader, with explicit unrenderable evidence. */
export function harnessSessionRows(sessions: readonly HarnessRowsSession[]) {
  const rows: HarnessSessionRow[] = []
  const gaps: HarnessRowsGap[] = []
  for (const session of sessions) {
    const emitted = new Set<string>()
    const push = (
      recordId: string,
      part: number,
      value: string | null | undefined,
      event: HarnessSessionRow['event'],
    ) => {
      if (!value || !Number.isFinite(Date.parse(value))) {
        gaps.push({
          sessionId: session.nativeSessionId,
          recordId,
          reason: 'Native record has no valid recorded time',
        })
        return
      }
      rows.push({
        id: JSON.stringify([session.nativeSessionId, event.kind, recordId, part]),
        sessionId: session.nativeSessionId,
        part,
        at: new Date(value).toISOString(),
        event: event.actor === 'injected' ? { ...event, provenance: 'system-instructions' } : event,
      })
    }
    const tool = (
      id: string,
      result: boolean,
      at?: string | null,
      recordId = id,
      part = 0,
      actor?: string,
    ) => {
      const call = session.toolCalls.find((item) => item.id === id)
      if (!call || (result && !call.result)) {
        gaps.push({
          sessionId: session.nativeSessionId,
          recordId: id,
          reason: 'Referenced tool evidence is missing',
        })
        return
      }
      const key = `${result ? 'result' : 'call'}:${id}`
      if (emitted.has(key)) return
      emitted.add(key)
      const toolCallId = `${session.nativeSessionId}:${id}`
      push(
        recordId,
        part,
        at ?? (result ? call.endedAt : call.startedAt),
        result
          ? {
              kind: 'tool-result',
              toolCallId,
              result: call.result?.output ?? call.result?.text,
              actor,
              ...(actor ? { source: `Native actor ${actor}` } : {}),
            }
          : {
              kind: 'tool-call',
              toolCallId,
              toolName: call.name,
              args: call.input ?? call.inputText,
              actor,
              ...(actor ? { source: `Native actor ${actor}` } : {}),
            },
      )
    }
    for (const message of session.messages)
      for (const [part, value] of message.parts.entries()) {
        if (value.type === 'tool-call' || value.type === 'tool-result')
          tool(
            value.toolCallId ?? '',
            value.type === 'tool-result',
            message.at,
            message.id,
            part,
            message.actor,
          )
        else if ((value.type === 'text' || value.type === 'reasoning') && value.text)
          push(message.id, part, message.at, {
            kind:
              value.type === 'reasoning'
                ? 'reasoning'
                : message.role === 'user'
                  ? 'user'
                  : message.role === 'assistant'
                    ? 'text'
                    : 'notice',
            text: value.text,
            actor: message.actor,
            ...(message.actor ? { source: `Native actor ${message.actor}` } : {}),
            ...(!['user', 'assistant', 'tool'].includes(message.role)
              ? { provenance: 'system-instructions', source: message.role }
              : {}),
          })
        else if (value.type !== 'text' && value.type !== 'reasoning')
          gaps.push({
            sessionId: session.nativeSessionId,
            recordId: message.id,
            reason: `Native ${value.type} content is retained but not projected inline`,
          })
      }
    for (const call of session.toolCalls) {
      if (!emitted.has(`call:${call.id}`)) {
        gaps.push({
          sessionId: session.nativeSessionId,
          recordId: call.id,
          reason: 'Tool call has no ordered message-part reference',
        })
        tool(call.id, false)
      }
      if (call.result && !emitted.has(`result:${call.id}`)) {
        gaps.push({
          sessionId: session.nativeSessionId,
          recordId: call.id,
          reason: 'Tool result has no ordered message-part reference',
        })
        tool(call.id, true)
      }
    }
  }
  // Stable sort preserves the recorded session/message/part order when clocks are equal.
  return { rows: rows.sort((a, b) => a.at.localeCompare(b.at)), gaps }
}
