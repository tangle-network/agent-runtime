# intelligence-recommend

The intelligence loop, end to end and offline: a recorded **trace** → derived **findings** → a gated
improvement **candidate**.

The branch ships the two halves of this loop disconnected — Observe (`createIntelligenceClient` +
`recordTrace`, which exports a run's loop topology as a trace) on one side, and `improve()` (the
held-out-gated RSI verb) on the other. This is the first example that connects them, the seam a
Recommend mode runs in production:

1. **Observe** — `recordTrace(events)` records a run's `LoopTraceEvent` stream as one trace. Export is
   best-effort; with no OTLP endpoint configured it is a no-op, so this runs offline with no creds.
2. **Analyze** — derive `AnalystFinding`s from that trace. In production a trace analyst reads the
   spans; here two findings are hand-derived, each citing the recorded trace via an `EvidenceRef`.
3. **Improve** — feed the findings (the REQUIRED positional `findings` arg) to `improve()` with a
   scripted generator + deterministic judge, and print the gated candidate.

## Run

```bash
pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
```

Runs **offline, no credentials**. Prints the recorded trace id, the number of findings derived, and
the gated candidate's ship verdict.

## Going live

Set `endpoint` (or `INTELLIGENCE_OTLP_ENDPOINT`) on `createIntelligenceClient` to actually export the
trace; replace the hand-derived findings with a real trace analyst's output; and swap the scripted
`generator` for the reflective `gepaDriver` (omit `generator` and pass `llm`) so the loop reflects on
the findings to propose the candidate.
