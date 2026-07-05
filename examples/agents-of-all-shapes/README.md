# Analyze any agent, no matter what framework it's built on

You have AI agents running in production. Some are ours, some are LangChain-style, some are a
Mastra agent, some the Claude Agent SDK, some a Python script. You want **one** report across all of
them: which are failing and why, which are burning money for little quality, and which changes to
make first. This example proves you can get that report from **any** of them without rewriting them
onto our stack.

The trick: every agent already emits (or can emit) **OpenTelemetry spans** — the industry-standard
trace records for a program's operations. As long as each agent tags its spans with a few standard
fields (which model ran, tokens used, cost, and a quality score), they all pour into the **same**
analysis engine and produce the **same** report. That engine runs **in-process** — no server, no
deploy, no sandbox.

```
your agent (any framework)
   → OpenTelemetry spans (model, tokens, cost, score)
      → fromOtelSpans()   turns raw spans into structured run records
         → analyzeRuns()  produces the report: failure clusters, cost/quality
                          tradeoffs, ranked recommendations
```

## Run it

```bash
# In-process, no key, no infra. Runs five agent "shapes" through the same engine:
pnpm tsx examples/agents-of-all-shapes/run.ts

# The CI proof that it works:
pnpm test -- tests/agents-of-all-shapes.test.ts
```

You'll see one **fleet report** merging every framework's runs, then a per-shape breakdown proving
the same engine works on each framework alone:

```
=== Fleet InsightReport (all shapes) ===
runs:            <total across all frameworks>
composite mean:  <mean quality score 0..1>
failure modes:   [...clustered failure names...]
recommendations: <count>
  [P1] <top ranked recommendation>

=== Per-shape composite ===
tangleRuntimeRuns    n=.. mean=..
openAiCompatibleRuns n=.. mean=..
mastraRuns           n=.. mean=..
claudeAgentSdkRuns   n=.. mean=..
```

To *also* send the same spans to the hosted dashboard, set `TANGLE_API_KEY=sk-tan-...`; the analysis
is identical, just server-side.

## The one contract every framework meets

There's a single integration surface (`shared/intelligence.ts`). An agent only has to emit OTel spans
carrying these standard fields plus a `score`:

| span attribute | meaning |
|---|---|
| `gen_ai.request.model` | which model ran |
| `gen_ai.usage.input_tokens` / `output_tokens` | token usage |
| `gen_ai.usage.cost_usd` | dollar cost |
| `score` | your quality outcome, 0 to 1 (from your eval, judge, or rubric) |
| an error span's name | becomes the run's failure mode, so failures cluster |

The first four are **standard OpenTelemetry GenAI conventions** that most agent frameworks already
emit — you only add `score`, your own measure of how good the run was.

## The five shapes it proves

| shape | what it is | how it feeds the engine live |
|---|---|---|
| **Tangle runtime** | agents on this repo's runtime | built-in OTel exporter, one call in your product |
| **OpenAI-compatible** | any OpenAI-style client (OpenRouter, vLLM, OpenAI) | emit one GenAI span per model call |
| **Mastra** | the Mastra agent framework | Mastra's native OTLP exporter, pointed at the ingest URL |
| **Claude Agent SDK** | Anthropic's agent SDK | wrap `query()`, one span per turn from its usage data |
| **Python agno** | a non-TS Python agent | POST the same spans over OTLP/HTTP |

The four TypeScript shapes ship **deterministic sample data** so the demo is verifiable in CI with no
key. Each shape's header comment shows the exact live wiring — swap the sample batch for your
framework's real telemetry and it lands on the identical engine.

> The Python file (`python-agno/agno_to_intelligence.py`) is an illustrative snippet of the HTTP POST
> a non-TS agent makes. It is not run by `run.ts` and not part of the TypeScript typecheck — it just
> shows the wire format for a Python agent.

## Sending it to the hosted dashboard (live)

For agents already on this runtime, the live leg is one block — the built-in exporter POSTs your
spans to the hosted ingest:

```ts
import { createOtelExporter, loopEventToOtelSpan } from '@tangle-network/agent-runtime'

const exporter = createOtelExporter({
  endpoint: 'https://intelligence.tangle.tools/v1/otlp',
  headers: { authorization: `Bearer ${process.env.TANGLE_API_KEY}` },
  serviceName: 'my-agent',
})
// per loop/stream event:
exporter.exportSpan(loopEventToOtelSpan({ kind, runId, timestamp, payload }, traceId))
await exporter.flush()
```

Anything not on this runtime just POSTs the same OTel spans raw to the ingest URL with a Bearer key
(the tenant is resolved from the key, never the payload). Read the report back from the dashboard or
the insights endpoint with the same key.

## Why this matters

The integration point is the **OpenTelemetry wire format**, not our SDK. Any team with agent traces —
whatever framework, whatever runtime — gets the full report (failure clustering, cost-vs-quality
tradeoffs, ranked fixes, and A/B lift with confidence once they tag two cohorts) without adopting our
execution stack at all.

## Files

| file | what it is |
|---|---|
| `run.ts` | the entrypoint: merges all shapes, runs the in-process engine, prints the fleet + per-shape reports |
| `shapes.ts` | the five agent shapes, each producing OTel spans (with live-wiring notes in the header) |
| `shared/intelligence.ts` | the whole integration surface: spans → run records → report |
| `python-agno/agno_to_intelligence.py` | illustrative POST for a non-TS Python agent |
