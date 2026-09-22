import type { TraceContext } from '../../mcp/trace-propagation'

export type { TraceContext }

/** Resolves the trace context a child should inherit from its spawning node. */
export type WorkerTraceResolver = (spawningNodeId: string) => TraceContext | undefined

/** Minimal seam shape needed to read an inherited trace context. */
export interface WorkerTraceSeamCarrier {
  readonly seams: Readonly<Record<string, unknown>>
}
