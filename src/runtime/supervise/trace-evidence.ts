/**
 * Durable structured tool evidence for supervised workers.
 *
 * The executor-owned `TraceSource` is collected before teardown, snapshotted into the shared
 * content-addressed blob store, and only then referenced by a settlement. Analysis reconstructs
 * agent-eval's bounded `TraceAnalysisStore` from those exact bytes. Worker output is never accepted
 * as a substitute for tool evidence.
 *
 * @experimental
 */

import {
  isToolSpan,
  type Span,
  type ToolSpan,
  type TraceAnalysisStore,
  toolSpansToTraceAnalysisStore,
} from '@tangle-network/agent-eval'
import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import type { TraceSource } from './trace-source'
import type { ResultBlobStore, WorkerTraceEvidence } from './types'

/** Schema version for content-addressed worker tool-trace artifacts. */
export const WORKER_TOOL_TRACE_SCHEMA_VERSION = 1 as const

/** Bytes stored under `WorkerTraceEvidence.traceRef`. */
export interface WorkerToolTraceArtifact {
  readonly schemaVersion: typeof WORKER_TOOL_TRACE_SCHEMA_VERSION
  readonly spans: ReadonlyArray<ToolSpan>
}

/** Collect and persist one executor's structured tool trace without changing its task outcome. */
export async function captureWorkerTraceEvidence(
  readSource: (() => TraceSource | undefined) | undefined,
  blobs: ResultBlobStore,
  executed: boolean,
): Promise<WorkerTraceEvidence> {
  if (!executed) return unavailable('execution-did-not-start')
  if (readSource === undefined) return unavailable('executor-did-not-expose-trace-source')

  let source: TraceSource | undefined
  try {
    source = readSource()
  } catch {
    return unavailable('trace-source-unavailable')
  }
  if (source === undefined) return unavailable('trace-source-unavailable')

  let collected: unknown
  try {
    collected = await source.collect()
  } catch {
    return unavailable('trace-collection-failed')
  }
  if (!Array.isArray(collected) || collected.some((span) => !isToolSpanValue(span))) {
    return unavailable('invalid-tool-spans')
  }
  if (collected.length === 0) return unavailable('no-tool-spans-captured')

  let artifact: WorkerToolTraceArtifact
  let traceRef: string
  try {
    const snapshot = structuredClone(collected) as ToolSpan[]
    // Use agent-eval's canonical adapter as the full integrity check before the durable receipt
    // claims these spans are analyzable. `isToolSpan` only narrows the discriminated union.
    toolSpansToTraceAnalysisStore(snapshot)
    artifact = {
      schemaVersion: WORKER_TOOL_TRACE_SCHEMA_VERSION,
      spans: snapshot,
    }
    traceRef = contentAddress(artifact)
  } catch {
    return unavailable('invalid-tool-spans')
  }
  try {
    await blobs.put(traceRef, artifact)
  } catch {
    return unavailable('trace-persistence-failed')
  }
  return Object.freeze({ status: 'available', traceRef, spanCount: artifact.spans.length })
}

/** Rehydrate exact persisted spans through agent-eval's one bounded trace-analysis adapter. */
export async function workerTraceAnalysisStore(
  evidence: WorkerTraceEvidence,
  blobs: Pick<ResultBlobStore, 'get'>,
): Promise<TraceAnalysisStore> {
  if (evidence.status === 'unavailable') {
    // The published adapter owns the missing-evidence error and its classification.
    return toolSpansToTraceAnalysisStore(undefined)
  }
  const raw = await blobs.get(evidence.traceRef)
  if (raw === undefined) {
    throw new ValidationError(
      `worker trace blob '${evidence.traceRef}' is missing; the settlement evidence is incomplete`,
    )
  }
  const artifact = parseWorkerToolTraceArtifact(raw, evidence.traceRef)
  if (artifact.spans.length !== evidence.spanCount) {
    throw new ValidationError(
      `worker trace blob '${evidence.traceRef}' has ${artifact.spans.length} spans but its settlement records ${evidence.spanCount}`,
    )
  }
  return toolSpansToTraceAnalysisStore(artifact.spans)
}

/** Validate a stored trace artifact before an analyst or replay trusts it. */
export function parseWorkerToolTraceArtifact(
  value: unknown,
  traceRef = '<unknown>',
): WorkerToolTraceArtifact {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { schemaVersion?: unknown }).schemaVersion !== WORKER_TOOL_TRACE_SCHEMA_VERSION ||
    !Array.isArray((value as { spans?: unknown }).spans)
  ) {
    throw new ValidationError(
      `worker trace blob '${traceRef}' is not a version-${WORKER_TOOL_TRACE_SCHEMA_VERSION} tool trace artifact`,
    )
  }
  const spans = (value as { spans: unknown[] }).spans
  if (spans.length === 0) {
    // Missing spans cannot prove a tool-free run; preserve agent-eval's explicit integrity error.
    return {
      schemaVersion: WORKER_TOOL_TRACE_SCHEMA_VERSION,
      spans: spans as ToolSpan[],
    }
  }
  if (spans.some((span) => !isToolSpanValue(span))) {
    throw new ValidationError(`worker trace blob '${traceRef}' contains a non-tool span`)
  }
  return {
    schemaVersion: WORKER_TOOL_TRACE_SCHEMA_VERSION,
    spans: spans as ToolSpan[],
  }
}

function unavailable(reason: Extract<WorkerTraceEvidence, { status: 'unavailable' }>['reason']) {
  return Object.freeze({ status: 'unavailable' as const, reason })
}

function isToolSpanValue(value: unknown): value is ToolSpan {
  try {
    return isToolSpan(value as Span)
  } catch {
    return false
  }
}
