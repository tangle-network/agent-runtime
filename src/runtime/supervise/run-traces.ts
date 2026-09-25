/**
 * A manager's own run as one trace store: what the continuation's question panel reads.
 *
 * The panel asks about the director's own work and about its workers' (discovery
 * `docs/38-one-loop-and-continuation.md`, section 5), so it reads both: the director's root stream
 * (`root-stream.jsonl`) and each settled worker's structured tool trace. Each agent is one trace,
 * named by its node id, so a `{worker}` question and a `trace://<worker id>/<span id>` citation
 * name the same worker.
 *
 * The root stream is progress events, not spans. Each tool call becomes one span with its result,
 * and each run of the director's text, and of its reasoning, between two other events becomes one
 * span named for what it is (`assistant_text`, `assistant_reasoning`): the director's claims live in
 * its text, and a panel that saw only its tool calls could not check them. Span ids are the
 * record's `seq`, which is unique in the file and stable across reads.
 */

import {
  type ToolSpan,
  type TraceAnalysisStore,
  toolSpansToTraceAnalysisStore,
} from '@tangle-network/agent-eval'
import { ValidationError } from '../../errors'
import type { RootStreamRecord } from './root-stream'
import { parseWorkerToolTraceArtifact } from './trace-evidence'
import type { ResultBlobStore, WorkerTraceEvidence } from './types'

/** The span a run of the director's text becomes. */
export const ASSISTANT_TEXT_SPAN = 'assistant_text'
/** The span a run of the director's reasoning becomes. */
export const ASSISTANT_REASONING_SPAN = 'assistant_reasoning'

/** The director's root stream as tool spans in one trace named `traceId`. */
export function rootStreamToolSpans(
  records: ReadonlyArray<RootStreamRecord>,
  traceId: string,
): ToolSpan[] {
  const spans: ToolSpan[] = []
  // Open calls by attempt and call id, or by tool name for a harness that sends no call id.
  const open = new Map<string, ToolSpan>()
  let prose: { span: ToolSpan; text: string; kind: string; attempt: number } | undefined
  const at = (record: RootStreamRecord) => {
    const ms = Date.parse(record.at)
    if (!Number.isFinite(ms)) {
      throw new ValidationError(`root stream line ${record.seq} has no valid time`)
    }
    return ms
  }
  const base = (record: RootStreamRecord, name: string) => ({
    kind: 'tool' as const,
    spanId: `s${record.seq}`,
    runId: traceId,
    name,
    toolName: name,
    startedAt: at(record),
    attributes: { attempt: record.attempt, seq: record.seq },
  })
  for (const record of records) {
    if (!('event' in record)) {
      prose = undefined
      continue
    }
    const { event } = record
    if (event.kind === 'text_delta' || event.kind === 'reasoning_delta') {
      if (prose !== undefined && prose.kind === event.kind && prose.attempt === record.attempt) {
        prose.text += event.text
        prose.span.result = prose.text
        prose.span.endedAt = at(record)
        continue
      }
      const name = event.kind === 'text_delta' ? ASSISTANT_TEXT_SPAN : ASSISTANT_REASONING_SPAN
      const span: ToolSpan = {
        ...base(record, name),
        args: {},
        result: event.text,
        endedAt: at(record),
      }
      spans.push(span)
      prose = { span, text: event.text, kind: event.kind, attempt: record.attempt }
      continue
    }
    prose = undefined
    if (event.kind === 'tool_call') {
      const span: ToolSpan = {
        ...base(record, event.toolName),
        args: event.args,
        ...(event.args === undefined ? { argsCaptured: false } : {}),
        endedAt: at(record),
      }
      if (event.toolCallId !== undefined) {
        span.attributes = { ...span.attributes, toolCallId: event.toolCallId }
      }
      spans.push(span)
      open.set(`${record.attempt}\u0000${event.toolCallId ?? `name:${event.toolName}`}`, span)
      continue
    }
    if (event.kind === 'tool_result') {
      const key = `${record.attempt}\u0000${event.toolCallId ?? `name:${event.toolName}`}`
      const call = open.get(key)
      if (call !== undefined) {
        open.delete(key)
        call.result = event.result
        call.endedAt = at(record)
        continue
      }
      // A result whose call the stream never recorded keeps its own span.
      spans.push({
        ...base(record, event.toolName),
        args: undefined,
        argsCaptured: false,
        result: event.result,
        endedAt: at(record),
      })
    }
    // Interaction requests and native child-task updates are not tool evidence; the child's own
    // trace is the worker's, which this store reads separately.
  }
  return spans
}

/** One worker's persisted tool spans, re-keyed to the worker's node id. Unavailable: none. */
async function workerSpans(
  worker: { readonly id: string; readonly trace: WorkerTraceEvidence },
  blobs: Pick<ResultBlobStore, 'get'>,
): Promise<ToolSpan[]> {
  if (worker.trace.status !== 'available') return []
  const raw = await blobs.get(worker.trace.traceRef)
  if (raw === undefined) {
    throw new ValidationError(
      `worker ${worker.id}'s trace blob '${worker.trace.traceRef}' is missing; its settlement evidence is incomplete`,
    )
  }
  const { spans } = parseWorkerToolTraceArtifact(raw, worker.trace.traceRef)
  return spans.map((span) => ({
    ...span,
    runId: worker.id,
    ...(span.runId === worker.id
      ? {}
      : { attributes: { ...span.attributes, sourceRunId: span.runId } }),
  }))
}

/**
 * The store over a manager's run: its own root stream when it has one, and every settled worker's
 * tool trace. `undefined` when the run has recorded no span yet, which is not a store a panel can
 * read: agent-eval refuses an empty trace, because it cannot tell a tool-free run from a failed
 * capture.
 */
export async function runTraceAnalysisStore(input: {
  readonly root?: {
    readonly id: string
    readonly read: () => Promise<ReadonlyArray<RootStreamRecord> | undefined>
  }
  readonly workers: ReadonlyArray<{ readonly id: string; readonly trace: WorkerTraceEvidence }>
  readonly blobs: Pick<ResultBlobStore, 'get'>
}): Promise<TraceAnalysisStore | undefined> {
  const records = input.root === undefined ? undefined : await input.root.read()
  const spans = [
    ...(records === undefined || input.root === undefined
      ? []
      : rootStreamToolSpans(records, input.root.id)),
    ...(await Promise.all(input.workers.map((worker) => workerSpans(worker, input.blobs)))).flat(),
  ]
  return spans.length === 0 ? undefined : toolSpansToTraceAnalysisStore(spans)
}
