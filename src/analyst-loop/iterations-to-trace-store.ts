/**
 * @experimental
 *
 * The read seam that closes the autonomous loop: project a round's `Iteration[]`
 * (each carrying its raw `SandboxEvent[]`) into an in-memory `TraceAnalysisStore`, the
 * read interface the trace analysts query. `runAnalystLoop` has had zero consumers
 * because nothing turned a loop's iterations into a store — this is that bridge.
 *
 * One iteration → one trace. The iteration is the root AGENT span; each `SandboxEvent`
 * becomes a child span (LLM for llm_call events, TOOL for tool events, else SPAN), so an
 * analyst can walk a shot's trace, cluster its errors, and emit findings the driver
 * steers on. Projection is best-effort over the FLAT SandboxEvent shape (no per-event
 * lineage yet — that's the richer-trace gap); it never fabricates — an errored iteration
 * surfaces a real ERROR span carrying the real message.
 */

import {
  type DatasetOverview,
  DEFAULT_TRACE_ANALYST_BUDGETS,
  type QueryTracesPage,
  type SearchSpanResult,
  type SearchTraceResult,
  type SpanMatchRecord,
  TRACE_ANALYST_TRUNCATION_MARKER_PREFIX,
  type TraceAnalysisStore,
  type TraceAnalystByteBudgets,
  type TraceAnalystFilters,
  type TraceAnalystSpan,
  type TraceAnalystSpanKind,
  type TraceAnalystTraceSummary,
  type ViewSpansResult,
  type ViewTraceResult,
} from '@tangle-network/agent-eval'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { AnalystError } from '../errors'
import { extractLlmCallEvent } from '../runtime/sandbox-events'
import type { Iteration } from '../runtime/types'

/** ErrorCluster isn't re-exported from the agent-eval root; derive it from the overview. */
type ErrorCluster = DatasetOverview['error_clusters'][number]

interface ProjectedTrace {
  summary: TraceAnalystTraceSummary
  spans: TraceAnalystSpan[]
  /** raw JSONL bytes of this trace's spans — the byte-budget accounting unit. */
  rawBytes: number
}

const bytesOf = (v: unknown): number => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8')
const iso = (ms: number): string => new Date(ms).toISOString()

/** Normalize volatile tokens out of a status message so semantically identical failures
 *  collapse to one signature (digits, hex/uuids, paths, durations → placeholders). */
function normalizeSignature(message: string): string {
  return message
    .replace(/0x[0-9a-fA-F]+/g, 'HEX')
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, 'UUID')
    .replace(/(\/[\w.-]+){2,}/g, 'PATH')
    .replace(/\b\d+(\.\d+)?(ms|s|m|h)\b/g, 'DUR')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function spanKindFor(
  event: SandboxEvent,
  agentRunName: string,
): {
  kind: TraceAnalystSpanKind
  model: string | null
  tool: string | null
} {
  const llm = extractLlmCallEvent(event, agentRunName)
  if (llm) return { kind: 'LLM', model: llm.model ?? null, tool: null }
  const type = String(event?.type ?? '')
  if (/tool/i.test(type)) {
    const d = event?.data as { name?: unknown; tool?: unknown } | undefined
    const tool = typeof d?.name === 'string' ? d.name : typeof d?.tool === 'string' ? d.tool : type
    return { kind: 'TOOL', model: null, tool }
  }
  return { kind: 'SPAN', model: null, tool: null }
}

function errorMessageOf(event: SandboxEvent): string | undefined {
  const type = String(event?.type ?? '')
  const d = event?.data as { error?: unknown; message?: unknown } | undefined
  if (/error|fail/i.test(type) || d?.error) {
    const m = d?.error ?? d?.message
    return typeof m === 'string' ? m : `${type} error`
  }
  return undefined
}

/** Project one iteration → one trace: root AGENT span + a child span per event. */
function projectIteration<Task, Output>(iter: Iteration<Task, Output>): ProjectedTrace {
  const traceId =
    (
      iter.events.find((e) => (e?.data as { sandboxId?: string } | undefined)?.sandboxId)?.data as
        | { sandboxId?: string }
        | undefined
    )?.sandboxId ?? `iter-${iter.index}`
  const start = iso(iter.startedAt)
  const end = iso(iter.endedAt || iter.startedAt)
  const durationMs = Math.max(0, (iter.endedAt || iter.startedAt) - iter.startedAt)
  const rootId = `${traceId}:root`
  const iterErrored = Boolean(iter.error) || iter.verdict?.valid === false
  const spans: TraceAnalystSpan[] = [
    {
      trace_id: traceId,
      span_id: rootId,
      parent_span_id: null,
      name: iter.agentRunName,
      kind: 'AGENT',
      start_time: start,
      end_time: end,
      duration_ms: durationMs,
      status: iter.error ? 'ERROR' : 'OK',
      status_message: iter.error?.message,
      service_name: 'agent-runtime',
      agent_name: iter.agentRunName,
      model_name: null,
      tool_name: null,
      attributes: {
        'iteration.index': iter.index,
        'verdict.valid': iter.verdict?.valid,
        'verdict.score': iter.verdict?.score,
        'output.preview':
          iter.output === undefined ? undefined : String(iter.output).slice(0, 2000),
      },
    },
  ]
  const models = new Set<string>()
  const tools = new Set<string>()
  iter.events.forEach((event, i) => {
    const { kind, model, tool } = spanKindFor(event, iter.agentRunName)
    if (model) models.add(model)
    if (tool) tools.add(tool)
    const errMsg = errorMessageOf(event)
    spans.push({
      trace_id: traceId,
      span_id: `${traceId}:e${i}`,
      parent_span_id: rootId,
      name: String(event?.type ?? 'event'),
      kind,
      start_time: start,
      end_time: end,
      duration_ms: 0,
      status: errMsg ? 'ERROR' : 'OK',
      status_message: errMsg,
      service_name: 'agent-runtime',
      agent_name: iter.agentRunName,
      model_name: model,
      tool_name: tool,
      attributes: (event?.data as Record<string, unknown> | undefined) ?? {},
    })
  })
  const hasErrors = spans.some((s) => s.status === 'ERROR') || iterErrored
  const summary: TraceAnalystTraceSummary = {
    trace_id: traceId,
    service_name: 'agent-runtime',
    agent_name: iter.agentRunName,
    span_count: spans.length,
    has_errors: hasErrors,
    start_time: start,
    end_time: end,
    duration_ms: durationMs,
    raw_jsonl_bytes: bytesOf(spans),
    models: [...models],
    tools: [...tools],
  }
  return { summary, spans, rawBytes: summary.raw_jsonl_bytes }
}

function matchesFilters(t: ProjectedTrace, f?: TraceAnalystFilters): boolean {
  if (!f) return true
  if (f.has_errors !== undefined && t.summary.has_errors !== f.has_errors) return false
  if (f.service_names?.length && !f.service_names.includes(t.summary.service_name ?? ''))
    return false
  if (f.agent_names?.length && !f.agent_names.includes(t.summary.agent_name ?? '')) return false
  if (f.model_names?.length && !f.model_names.some((m) => t.summary.models.includes(m)))
    return false
  if (f.tool_names?.length && !f.tool_names.some((tn) => t.summary.tools.includes(tn))) return false
  if (f.start_time_after && t.summary.start_time < f.start_time_after) return false
  if (f.start_time_before && t.summary.start_time > f.start_time_before) return false
  if (f.regex_pattern && !new RegExp(f.regex_pattern).test(JSON.stringify(t.spans))) return false
  return true
}

function capAttributes(
  attributes: Record<string, unknown>,
  perAttrCap: number,
): { capped: Record<string, unknown>; truncated: number } {
  let truncated = 0
  const capped: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attributes)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    if (typeof s === 'string' && s.length > perAttrCap) {
      truncated += 1
      capped[k] = `${TRACE_ANALYST_TRUNCATION_MARKER_PREFIX} ${s.length}b]${s.slice(0, perAttrCap)}`
    } else {
      capped[k] = v
    }
  }
  return { capped, truncated }
}

/**
 * Build an in-memory `TraceAnalysisStore` over a loop round's iterations. Fail-loud on an
 * empty round — there is nothing for an analyst to read, and a silent empty store would
 * mask a broken capture path.
 */
export function iterationsToTraceStore<Task, Output>(
  iterations: ReadonlyArray<Iteration<Task, Output>>,
  budgets: TraceAnalystByteBudgets = DEFAULT_TRACE_ANALYST_BUDGETS,
): TraceAnalysisStore {
  if (iterations.length === 0) {
    throw new AnalystError('iterationsToTraceStore: no iterations to analyze (empty round)')
  }
  const traces = iterations.map((it) => projectIteration(it))
  const byId = new Map(traces.map((t) => [t.summary.trace_id, t]))

  const buildClusters = (set: ProjectedTrace[]): ErrorCluster[] => {
    const map = new Map<string, ErrorCluster>()
    for (const t of set) {
      for (const s of t.spans) {
        if (s.status !== 'ERROR' || !s.status_message) continue
        const sig = normalizeSignature(s.status_message)
        const c = map.get(sig) ?? {
          signature: sig,
          status_message_sample: s.status_message,
          span_name: s.name,
          tool_name: s.tool_name,
          trace_count: 0,
          span_count: 0,
          prevalence: 0,
          exemplar_trace_ids: [],
          exemplar_span_ids: [],
        }
        c.span_count += 1
        if (
          !c.exemplar_trace_ids.includes(t.summary.trace_id) &&
          c.exemplar_trace_ids.length < 10
        ) {
          c.exemplar_trace_ids.push(t.summary.trace_id)
          c.trace_count += 1
        }
        if (c.exemplar_span_ids.length < 10) c.exemplar_span_ids.push(s.span_id)
        map.set(sig, c)
      }
    }
    const errorTraces = set.filter((t) => t.summary.has_errors).length || 1
    const clusters = [...map.values()].map((c) => ({
      ...c,
      prevalence: c.trace_count / errorTraces,
    }))
    return clusters.sort((a, b) => b.trace_count - a.trace_count)
  }

  return {
    async getOverview(filters?: TraceAnalystFilters): Promise<DatasetOverview> {
      const set = traces.filter((t) => matchesFilters(t, filters))
      const services = new Set<string>()
      const agents = new Set<string>()
      const models = new Set<string>()
      const tools = new Set<string>()
      let errorSpans = 0
      for (const t of set) {
        if (t.summary.service_name) services.add(t.summary.service_name)
        if (t.summary.agent_name) agents.add(t.summary.agent_name)
        for (const m of t.summary.models) models.add(m)
        for (const tn of t.summary.tools) tools.add(tn)
        errorSpans += t.spans.filter((s) => s.status === 'ERROR').length
      }
      const times = set.map((t) => t.summary.start_time).sort()
      return {
        total_traces: set.length,
        raw_jsonl_bytes: set.reduce((n, t) => n + t.rawBytes, 0),
        services: [...services],
        agents: [...agents],
        models: [...models],
        tool_names: [...tools],
        sample_trace_ids: set.slice(0, 20).map((t) => t.summary.trace_id),
        errors: {
          trace_count: set.filter((t) => t.summary.has_errors).length,
          span_count: errorSpans,
        },
        error_clusters: buildClusters(set),
        time_range: times.length ? { earliest: times[0]!, latest: times[times.length - 1]! } : null,
      }
    },

    async queryTraces(opts): Promise<QueryTracesPage> {
      const set = traces.filter((t) => matchesFilters(t, opts.filters))
      const offset = opts.offset ?? 0
      const page = set.slice(offset, offset + opts.limit)
      return {
        traces: page.map((t) => t.summary),
        total: set.length,
        has_more: offset + opts.limit < set.length,
      }
    },

    async countTraces(filters?: TraceAnalystFilters): Promise<number> {
      return traces.filter((t) => matchesFilters(t, filters)).length
    },

    async viewTrace(opts): Promise<ViewTraceResult> {
      const t = byId.get(opts.trace_id)
      if (!t) return { trace_id: opts.trace_id, spans: [] }
      const cap = opts.per_attribute_byte_cap ?? budgets.perAttributeViewBudget
      const projected = t.spans.map((s) => ({
        ...s,
        attributes: capAttributes(s.attributes, cap).capped,
      }))
      if (bytesOf(projected) > budgets.perCallByteCeiling) {
        const names = new Map<string, number>()
        for (const s of t.spans) names.set(s.name, (names.get(s.name) ?? 0) + 1)
        return {
          trace_id: opts.trace_id,
          oversized: {
            span_count: t.spans.length,
            top_span_names: [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
            span_response_bytes_max: Math.max(...t.spans.map((s) => bytesOf(s))),
            error_span_count: t.spans.filter((s) => s.status === 'ERROR').length,
          },
        }
      }
      return { trace_id: opts.trace_id, spans: projected }
    },

    async viewSpans(opts): Promise<ViewSpansResult> {
      const t = byId.get(opts.trace_id)
      const cap = opts.per_attribute_byte_cap ?? budgets.perAttributeSpanBudget
      const want = new Set(opts.span_ids)
      const found = (t?.spans ?? []).filter((s) => want.has(s.span_id))
      let truncated = 0
      const spans = found.map((s) => {
        const { capped, truncated: n } = capAttributes(s.attributes, cap)
        truncated += n
        return { ...s, attributes: capped }
      })
      const foundIds = new Set(found.map((s) => s.span_id))
      return {
        trace_id: opts.trace_id,
        spans,
        missing_span_ids: opts.span_ids.filter((id) => !foundIds.has(id)),
        truncated_attribute_count: truncated,
      }
    },

    async searchTrace(opts): Promise<SearchTraceResult> {
      const t = byId.get(opts.trace_id)
      const max = opts.max_matches ?? 50
      const hits: SpanMatchRecord[] = []
      for (const s of t?.spans ?? []) {
        for (const hit of searchSpanAttrs(s, opts.regex_pattern, budgets.perMatchTextBudget)) {
          if (hits.length >= max) break
          hits.push(hit)
        }
      }
      return {
        trace_id: opts.trace_id,
        hits,
        total_matches: hits.length,
        has_more: hits.length >= max,
      }
    },

    async searchSpan(opts): Promise<SearchSpanResult> {
      const t = byId.get(opts.trace_id)
      const max = opts.max_matches ?? 50
      const span = (t?.spans ?? []).find((s) => s.span_id === opts.span_id)
      const hits = span
        ? searchSpanAttrs(span, opts.regex_pattern, budgets.perMatchTextBudget).slice(0, max)
        : []
      return {
        trace_id: opts.trace_id,
        span_id: opts.span_id,
        hits,
        total_matches: hits.length,
        has_more: false,
      }
    },
  }
}

function searchSpanAttrs(
  span: TraceAnalystSpan,
  pattern: string,
  textCap: number,
): SpanMatchRecord[] {
  const re = new RegExp(pattern, 'g')
  const hits: SpanMatchRecord[] = []
  for (const [k, v] of Object.entries(span.attributes)) {
    const text = typeof v === 'string' ? v : JSON.stringify(v)
    if (typeof text !== 'string') continue
    re.lastIndex = 0
    const m = re.exec(text)
    if (!m) continue
    const at = m.index
    hits.push({
      trace_id: span.trace_id,
      span_id: span.span_id,
      span_name: span.name,
      span_kind: span.kind,
      attribute_path: `attributes.${k}`,
      matched_text: m[0].slice(0, textCap),
      context_before: text.slice(Math.max(0, at - textCap / 2), at),
      context_after: text.slice(at + m[0].length, at + m[0].length + textCap / 2),
      match_offset: at,
    })
  }
  return hits
}
