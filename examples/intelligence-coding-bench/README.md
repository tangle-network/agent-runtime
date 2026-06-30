# intelligence-coding-bench

The [WebCode harness×model coding benchmark](../webcode-matrix) — every cell wrapped in the **full Tangle Intelligence SDK**. Same grid, same hidden-test-graded tasks; this file adds nothing but the instrumentation, so per harness×model you see: **did it pass, what it cost, where the cost went, and the exported trace.**

## The three layers (all on one cell)

| Layer | Primitive | What it gives you |
|---|---|---|
| **1 · Boundary** | `withTangleIntelligence(cell, { project, effort })` | The bill + the control. `effort ∈ off · eco · standard · thorough · max`; **`'off'` is the provable passthrough floor** — intelligence spend clamped to 0, the cell still runs. |
| **2 · Waterfall** | `createWaterfallCollector()` on the run | The cost truth, per tool/phase. The **sum of its spans IS the billed run cost** — no separate tally to drift. |
| **3 · OTLP** | `createOtelExporter()` + `loopEventToOtelSpan` | The production trace pipe. Streams every span to your OTLP/HTTP collector; a no-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. |

The intelligence attaches at **two seams**: the boundary wraps the whole cell (`withTangleIntelligence` works over any async function), and the internal trace rides `openSandboxRun`'s `hooks` (the one run-verb here that emits per-tool spans). The same pattern instruments a `runProfileMatrix` dispatch wholesale.

## Run

```bash
TANGLE_API_KEY=…  SANDBOX_API_KEY=…  EXA_API_KEY=…  [EFFORT=standard]  [OTEL_EXPORTER_OTLP_ENDPOINT=…] \
  tsx examples/intelligence-coding-bench/intelligence-coding-bench.ts
```

Prove the floor: run once with `EFFORT=standard`, once with `EFFORT=off` — same passes, zero intelligence spend on the second.

## Relationship to webcode-matrix

[`../webcode-matrix`](../webcode-matrix) is the **benchmark** — the harness×model × WebCode-task grid, graded by hidden tests, scored with paired stats. This example **imports that exact grid and task set** and answers a different question: not "which harness wins" but "what does each run cost, and what did it do" — the observability + billing view of the same benchmark.
