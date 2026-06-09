# intelligence-export

Ship agent-runtime traces to **Tangle Intelligence** and get back insights:
failure correlations (relative risk + p-value), latency percentiles, and an
agent-eval quality report.

Two paths, both into the same pipeline:

- **Built-in exporter** — `createOtelExporter({ endpoint, headers })` +
  `exporter.exportSpan(loopEventToOtelSpan(event, traceId))` per loop event.
  The exporter POSTs to `${endpoint}/v1/traces`, so point `endpoint` at
  `https://intelligence.tangle.tools/v1/otlp` (it becomes the
  `/v1/otlp/v1/traces` ingest route).
- **Raw OTLP** — POST OTel spans straight to `/v1/otlp/v1/traces` with your
  `sk-tan-*` key. Works with no runtime at all.

The tenant is resolved from the Bearer key, never the payload. Read insights
back from the dashboard or `GET /v1/insights/outputs?kind=report`.

```bash
TANGLE_API_KEY=sk-tan-... npx tsx examples/intelligence-export/intelligence-export.ts
```
