/**
 * Hook agent-runtime into Tangle Intelligence — one clean block.
 *
 * agent-runtime already records every loop event; this ships them to the
 * hosted intelligence backend, which turns them into insights (failure
 * correlations with p-values, latency percentiles, an agent-eval quality
 * report). Two ways, both end in the same pipeline:
 *
 *   BUILT-IN exporter — `createOtelExporter({ endpoint, headers })` then
 *     `exporter.exportSpan(loopEventToOtelSpan(event, traceId))` per event.
 *     IMPORTANT: the exporter POSTs to `${endpoint}/v1/traces`, so point it
 *     at `.../v1/otlp` (becomes `.../v1/otlp/v1/traces`, the ingest route).
 *
 *   RAW OTLP — for anything agent-runtime doesn't emit, POST OTel spans
 *     yourself (see `sendTracesToTangle` below). Works with no runtime at
 *     all.
 *
 * Read insights back from the dashboard or `GET /v1/insights/outputs` with
 * the same key. Tenant resolves from the Bearer key, never the payload.
 *
 * Run: TANGLE_API_KEY=sk-tan-... npx tsx examples/with-intelligence-export/with-intelligence-export.ts
 */
import {
  type AgentBackendInput,
  createIterableBackend,
  createOtelExporter,
  loopEventToOtelSpan,
  type RuntimeStreamEvent,
  runAgentTaskStream,
} from '@tangle-network/agent-runtime'

const API_KEY = process.env.TANGLE_API_KEY ?? 'sk-tan-...'
// The exporter appends `/v1/traces`; the hosted ingest is `/v1/otlp/v1/traces`.
const INTELLIGENCE_BASE =
  process.env.INTELLIGENCE_BASE ?? 'https://intelligence.tangle.tools/v1/otlp'

// A synthetic backend so the example runs standalone. In a real product
// this is your sandbox, OpenAI-compatible router, or CLI bridge.
const backend = createIterableBackend<AgentBackendInput>({
  kind: 'intel-demo',
  async *stream(_input, ctx) {
    yield { type: 'text_delta', task: ctx.task, session: ctx.session, text: 'working...\n', timestamp: new Date().toISOString() }
    yield { type: 'tool_call', task: ctx.task, session: ctx.session, toolName: 'web_search', args: {}, timestamp: new Date().toISOString() }
    yield { type: 'tool_result', task: ctx.task, session: ctx.session, toolName: 'web_search', result: { ok: true }, timestamp: new Date().toISOString() }
    yield { type: 'text_delta', task: ctx.task, session: ctx.session, text: 'done.\n', timestamp: new Date().toISOString() }
  },
})

async function main() {
  // ── Built-in exporter → Tangle Intelligence ───────────────────────
  const exporter = createOtelExporter({
    endpoint: INTELLIGENCE_BASE,
    headers: { authorization: `Bearer ${API_KEY}` },
    serviceName: 'agent-runtime-demo',
  })
  if (!exporter) throw new Error('no OTLP endpoint configured')

  const traceId = `run${Date.now().toString(16).padStart(29, '0')}`
  const runId = 'demo-run-1'
  for await (const event of runAgentTaskStream({
    task: { id: runId, intent: 'demo task', domain: 'demo', inputs: {} },
    backend,
    input: { message: 'go' } as Partial<AgentBackendInput>,
  })) {
    const e = event as RuntimeStreamEvent & { type: string; timestamp?: string }
    exporter.exportSpan(
      loopEventToOtelSpan(
        {
          kind: e.type,
          runId,
          timestamp: e.timestamp ? Date.parse(e.timestamp) : Date.now(),
          payload: event as object,
        },
        traceId,
      ),
    )
  }
  await exporter.flush()
  console.log('Shipped run to Tangle Intelligence via the built-in exporter.')

  // ── Or the universal raw block (no runtime required) ──────────────
  await sendTracesToTangle([
    {
      traceId: 'byo0000000000000000000000000001',
      spanId: 'span000000000001',
      name: 'llm.call',
      startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
      endTimeUnixNano: String(BigInt(Date.now() + 800) * 1_000_000n),
      attributes: [
        { key: 'llm.model', value: { stringValue: 'gpt-4o-mini' } },
        { key: 'score', value: { doubleValue: 0.91 } },
      ],
      status: { code: 'STATUS_CODE_OK' },
    },
  ])
  console.log('Also sent a BYO trace via raw OTLP.')
}

// The raw OTLP one-block hook — POST straight to the ingest route.
async function sendTracesToTangle(
  spans: Array<Record<string, unknown>>,
  serviceName = 'byo-agent',
) {
  const res = await fetch(`${INTELLIGENCE_BASE}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeSpans: [{ scope: { name: 'byo' }, spans }],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`intelligence ingest failed: ${res.status} ${await res.text()}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
