# intelligence-drop-in

The Observe + Mode-0 slice of the Tangle Intelligence SDK: wrap an existing
agent, ship one trace per call, and pay only inference at the OFF tier. The
wrapper is best-effort — a live agent never fails because Intelligence is down.

## Run

```bash
pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts
```

The example stands up a throwaway local OTLP collector, so it runs with no
credentials.

## What it shows

- `withTangleIntelligence(agent, { project, apiKey, endpoint })` — wrap any
  `(input) => Promise<output>` agent; the shape is preserved and one trace span
  is exported per call.
- `createIntelligenceClient(...).traceRun(meta, fn)` — the explicit-trace API:
  `trace.recordOutput` / `trace.recordOutcome` inside the body.
- **Best-effort export** — pointed at a dead endpoint, the agent still returns
  its answer; the export failure is swallowed.
- **Mode 0 / OFF** (`effort: 'off'`) — pure passthrough, zero intelligence
  spawns. The exported trace carries `{ inferenceUsd, intelligenceUsd }` and
  `intelligenceUsd` is clamped to `0` — the mechanism that proves an OFF
  customer paid inference-only.
- `client.doctor()` — network-free readiness: Observe is always reachable;
  Recommend and Gated-PR report the inputs they still need.
