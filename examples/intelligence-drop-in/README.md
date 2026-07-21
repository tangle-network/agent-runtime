# One-line observability for any agent — and proof "off" costs nothing

Wrap any agent function in one line and every call ships a trace (a per-call record of what ran and
what it cost) to Tangle Intelligence. Two things make this worth a look:

1. **It's genuinely one hook** — `withIntelligence(agent, opts)` wraps your agent, ships a RunRecord
   per call, and receives the tenant's certified profile (fail-closed) — all invisibly.
2. **It's safe** — the tracing is best-effort. If Tangle Intelligence is down, your agent still answers.
   Telemetry never takes down the app.
3. **"Off" really means free** — turn intelligence off and you're billed only for the model call you'd
   pay for anyway. This example doesn't just claim that; it reads the exported trace back and *asserts*
   the extra charge is exactly zero.

## Run it

```bash
# $0, no credentials — spins up a throwaway local trace collector so you can see the trace without a key.
pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
```

It prints three results and **throws** if the last two aren't true:

```
1) wrapped an agent, got its answer: "You asked: how do I reset my password?. Here is a helpf…
2) survived a dead endpoint: true
3a) a trace landed on the collector: true
3b) OFF tier — intelligence_usd on the exported span: 0 (0 = the billing floor)
```

## Why it matters

Adding observability and billing to an agent usually means threading a tracing SDK through your code
and trusting a dashboard's word on what "off" costs. Here it's a single wrapper, and the "off" bill is
*proven by execution*: the example digs the `intelligence_usd` field out of the actual exported trace
and fails loudly if it isn't `0`. You get a number you can check, not a label you have to believe.

## The two APIs

- **`withIntelligence(agent, { project, target, apiKey, baseUrl })`** — the one hook. Wrap any
  `(input, applied) => Promise<output>` agent; each call fires off one RunRecord in the background,
  receives the certified profile, and returns as soon as your agent does.
- **`createIntelligenceClient(...).traceRun(meta, fn)`** — the explicit version, for when you want to
  record extra detail and flush traces on demand. Used here so the example can flush and read the trace
  back to prove the zero.

Two spend numbers show up in a trace: **inference** (the base model call you'd pay for regardless) and
**intelligence** (what Tangle's extra reasoning — analysts, corpus lookups, extra worker spawns — adds
on top). At the OFF tier, intelligence is clamped to 0; only inference costs anything.

## Going live

Drop the local collector: set `TANGLE_API_KEY` and point `endpoint` at your real collector (or omit
`endpoint` to use the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var). Raise `effort` from `'off'` to
`'standard'` or `'max'` to turn the intelligence tiers on — same wrapper, one field changed.

## Files

| file | what it is |
|---|---|
| `intelligence-drop-in.ts` | the wrapper demo, the throwaway local collector, and the three assertions |
