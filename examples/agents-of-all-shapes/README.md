# Agents of all shapes → one Tangle Intelligence pipe

Proof that Tangle Intelligence works with **any agent, not just our sandbox**.
Every shape — the Tangle runtime, an OpenAI-compatible router (tcloud /
OpenRouter), a Mastra agent, the Claude Agent SDK, a Python agno agent —
converges on the **same** canonical OpenTelemetry GenAI spans, and the **same**
in-process engine produces the decision packet:

```
your agent (any framework)
   → OTel GenAI spans (gen_ai.request.model, gen_ai.usage.*, score)
      → fromOtelSpans()  →  RunRecord[]
         → analyzeRuns() →  InsightReport   (composite, lift CI, Pareto,
                                             failureModes, recommendations)
```

No sandbox. No deploy. No server. The analysis runs **in-process**.

## Run it

```bash
# Verified QA path — in-process, no key, no infra:
npx tsx examples/agents-of-all-shapes/run.ts

# CI verification (what proves it):
pnpm test -- tests/agents-of-all-shapes.test.ts
```

Set `TANGLE_API_KEY=sk-tan-...` to *also* POST the same spans to the hosted
`/v1/otlp/v1/traces` ingest for the dashboard — identical analysis, server-side.

## The one contract every shape meets

`shared/intelligence.ts` is the whole integration surface. A shape only has to
emit OTel spans carrying the standard GenAI attributes plus a `score`:

| attribute | meaning |
|---|---|
| `gen_ai.request.model` | model snapshot (also `llm.model`, `tangle.model`) |
| `gen_ai.usage.input_tokens` / `output_tokens` | token usage |
| `gen_ai.usage.cost_usd` | cost (also `cost.usd`) |
| `score` | your eval/judge/rubric outcome 0..1 (also `tangle.score`, `eval.score`) |
| an `ERROR`-status span's `name` | → `RunRecord.failureMode` |

These are **standard OpenTelemetry GenAI semantic conventions** — most
frameworks already emit them; you add `score`.

## The shapes

| Shape | File | Live wiring |
|---|---|---|
| **Tangle runtime / router (tcloud)** | `shapes.ts` → `tangleRuntimeRuns` | `createOtelExporter` + `loopEventToOtelSpan` (see `examples/intelligence-export`) |
| **OpenAI-compatible** (tcloud / OpenRouter / OpenAI / vLLM) | `shapes.ts` → `openAiCompatibleRuns` | any OpenAI client at the router's `baseURL`; emit a GenAI span per call |
| **Mastra** | `shapes.ts` → `mastraRuns` | Mastra's native OTLP exporter → `${INTELLIGENCE_BASE}/v1/otlp/v1/traces` |
| **Claude Agent SDK** | `shapes.ts` → `claudeAgentSdkRuns` | wrap `query()`, one GenAI span per turn from `msg.usage` |
| **Python agno** | `python-agno/agno_to_intelligence.py` | agno run → OTLP/HTTP POST (or `pip install agent-eval-rpc`) |

The TypeScript shapes ship deterministic batches so the showcase is
**verifiable in CI with no key** (`tests/agents-of-all-shapes.test.ts`). Each
shape's header comment shows the exact live wiring — swap the batch for your
framework's real telemetry and it lands on the identical engine.

## Why this matters

The integration point is the **OTel wire**, not the Tangle SDK or sandbox. Any
team with agent traces — whatever framework, whatever runtime — gets the full
`InsightReport` (failure clustering, cost/quality Pareto, ranked
recommendations, and lift CI once they emit two cohorts) without adopting our
execution stack.
