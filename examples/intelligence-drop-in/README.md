# intelligence-drop-in

The Observe + Mode-0 slice of the Tangle Intelligence SDK: wrap an existing agent, ship one trace per
call, and pay **only inference** (the base model stream) at the OFF tier. **Why it matters:** you get
per-call observability + billing with a one-line wrapper, and you can prove — not just assert — that
turning intelligence *off* charges nothing extra. The wrapper is best-effort: a live agent never fails
because Intelligence is down.

> **Mode 0** = the OFF tier: telemetry stays on, but intelligence spend (analysts, corpus, extra spawns)
> is clamped to 0. **Inference spend** = the base model stream you'd pay anyway; **intelligence spend** =
> what the SDK's extra reasoning adds on top.

## Run

```bash
# $0, no creds — stands up a throwaway local OTLP collector so the trace is visible without a key.
pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
```

It prints three proofs and **asserts** the last two (throws if they don't hold):
1. wrap any `(input) => Promise<output>` in one line and it ships a trace;
2. point it at a dead endpoint — the agent still answers (export failure swallowed);
3. at `effort: 'off'`, read the exported span BACK off the collector and confirm `intelligence_usd = 0`.

## What it shows

- `withTangleIntelligence(agent, { project, apiKey, endpoint })` — wrap any agent; the call shape is
  preserved and one trace span is exported per call, fire-and-forget.
- `createIntelligenceClient(...).traceRun(meta, fn)` — the explicit-trace API (`trace.recordOutput` /
  `trace.recordOutcome`), used here so we can `flush()` and read the span back.
- **The OFF proof, by execution** — at OFF there is no intelligence spawn, so the exported span's
  `intelligence_usd` is `0` by construction. The example digs it out of the OTLP payload and asserts it.

## Going live

Drop the local collector: set `TANGLE_API_KEY` and point `endpoint` at your real OTLP/HTTP collector
(or omit `endpoint` to use `OTEL_EXPORTER_OTLP_ENDPOINT`). Raise `effort` from `off` to `standard`/`max`
to enable the intelligence tiers — the same wrapper, one field changed.
