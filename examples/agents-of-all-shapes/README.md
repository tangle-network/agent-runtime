# Analyze any agent, no matter what framework it's built on

You have agents built with different frameworks and want one report across them.
This example converts each run to the same OpenTelemetry and `RunRecord` contract without moving execution onto this runtime.

Each task attempt emits one root span.
Model calls are children of that root.
The root carries run, candidate, scenario, terminal, and task-quality facts.
The child carries model, token, and cost facts.

```
your agent
   -> OpenTelemetry spans
      -> fromOtelSpans()
         -> analyzeRuns()
```

## Run it

```bash
# In-process, no key, no infra. Runs four agent shapes through the same engine:
pnpm tsx examples/agents-of-all-shapes/run.ts

# The CI proof that it works:
pnpm test -- tests/agents-of-all-shapes.test.ts
```

The command prints one merged report and one result per integration:

```
=== Fleet InsightReport (all shapes) ===
runs:            <total across all frameworks>
composite mean:  <mean quality score 0..1>
failure classes: [...canonical task failures...]
recommendations: <count>
  [P1] <top ranked recommendation>

=== Per-shape composite ===
tangle-runtime       n=.. mean=..
openai-compatible    n=.. mean=..
mastra               n=.. mean=..
claude-agent-sdk     n=.. mean=..
```

Set `TANGLE_API_KEY=sk-tan-...` to send the same spans to the hosted ingest.
The command prints the delivery message only after the collector accepts every span.

## The one contract every framework meets

There is one integration surface in `shared/intelligence.ts`.
Each task run emits one root span, and each model call emits a child span.

| span | attribute | meaning |
|---|---|---|
| run root | `openinference.span.kind=AGENT` | identifies the task run |
| run root and children | `tangle.runId` | unique attempt identity |
| run root and children | `tangle.candidateId` | stable agent and configuration identity |
| run root and children | `tangle.scenarioId` | stable task identity shared across candidates |
| run root | `tangle.terminal.outcome` | `succeeded` or `failed` execution |
| run root | `tangle.task.score` | task quality from 0 to 1, omitted when unmeasured |
| run root | `tangle.task.failure_class` | optional canonical task failure |
| model child | `openinference.span.kind=LLM` | identifies a model call |
| model child | `gen_ai.request.model` | model identifier |
| model child | `gen_ai.usage.input_tokens` / `output_tokens` | measured token usage |
| run root and model child | `tangle.cost.provenance` | `observed` or `uncaptured` |
| model child | `gen_ai.usage.cost_usd` | observed dollar cost, omitted when uncaptured |

The model and token `gen_ai.*` fields follow OpenTelemetry GenAI conventions.
`gen_ai.usage.cost_usd` and the `tangle.*` fields are explicit extensions consumed by `agent-eval`.
A wrong answer is a task failure, not a crashed process, so task labels belong on the root while model-call errors remain on the child that failed.
Trace IDs are 32 lowercase hexadecimal characters.
Span IDs are 16 lowercase hexadecimal characters, and each model span names its root through `parentSpanId`.

## The integrations it proves

| shape | what it is | how it feeds the engine live |
|---|---|---|
| **Tangle runtime** | agents on this repo's runtime | retain runtime spans and add one task root |
| **OpenAI-compatible** | any OpenAI-style client (OpenRouter, vLLM, OpenAI) | emit one GenAI span per model call |
| **Mastra** | the Mastra agent framework | Mastra's native OTLP exporter, pointed at the ingest URL |
| **Claude Agent SDK** | Anthropic's agent SDK | wrap `query()`, one span per turn from its usage data |
| **Python agno** | a non-TS Python agent | POST the same spans over OTLP/HTTP |

The four TypeScript shapes use deterministic fixtures that model observed run data so CI can check the integration with no key.
Each shape's header comment shows the live wiring needed to replace the sample batch with real telemetry.

The Python file at `python-agno/agno_to_intelligence.py` is a live Agno example.
It targets Agno `2.8.3` and requires `agno`, `openai`, `OPENAI_API_KEY`, and `TANGLE_API_KEY`.
It does not use a Tangle Python SDK.

```bash
python -m pip install 'agno==2.8.3' openai
```

## Sending it to the hosted dashboard (live)

`shipToTangleOtlp()` uses the runtime exporter and rejects failed delivery:

```ts
import { allShapes } from './shapes'
import { shipToTangleOtlp, spansForRuns } from './shared/intelligence'

const apiKey = process.env.TANGLE_API_KEY
if (!apiKey) throw new Error('TANGLE_API_KEY is required')
const runs = Object.values(allShapes()).flat()
await shipToTangleOtlp(spansForRuns(runs), {
  endpoint: 'https://intelligence.tangle.tools/v1/otlp',
  apiKey,
  serviceName: 'my-agent',
})
console.log('Delivered spans')
```

Anything not on this runtime can post the same OTLP/HTTP JSON to the ingest URL with a Bearer key.
The tenant comes from the key, not the payload.

## Why this matters

The integration point is the OpenTelemetry wire format, not our SDK.
Any team with agent traces gets the same analysis without adopting our execution stack.

## Files

| file | what it is |
|---|---|
| `run.ts` | the entrypoint: merges all shapes, runs the in-process engine, prints the fleet + per-shape reports |
| `shapes.ts` | the four TypeScript agent shapes, each producing OTel spans |
| `shared/intelligence.ts` | the whole integration surface: spans to run records to report |
| `python-agno/agno_to_intelligence.py` | live Agno run and OTLP/HTTP POST |
