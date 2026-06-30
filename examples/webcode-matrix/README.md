# webcode-matrix

Run the [WebCode benchmark](https://exa.ai/blog/webcode) across a **matrix of harnesses × models** — one `runProfileMatrix` call.

WebCode is 33 coding tasks across 9 languages, each targeting a library API released *after* the model's training cutoff, so the agent must **web-search** to find the current signatures. Each task is graded in a sandbox by a hidden unit-test suite (empty stubs fail).

This example sweeps the cartesian of **harness** (what drives the agent — claude-code / codex / opencode / gemini) × **model** (the LLM), runs each cell in its own sandbox with web search on, and scores on the hidden tests — no LLM judge. The whole benchmark is ~90 lines of logic: the axes plus the call. The runtime does the per-cell sandbox, web search, and grading.

## Run it

```bash
EXA_API_KEY=…           # in-box web search
SANDBOX_API_KEY=…       # the sandbox service
tsx examples/webcode-matrix/webcode-matrix.ts
```

Prints the per-(harness×model) pass rate over the tasks. Edit `grid` to change the harnesses/models and `tasks` to point at the full 33-task dataset (the three shown are representative).

## Why it's interesting

WebCode isolates one thing: can an agent retrieve and apply knowledge it was never trained on? The matrix answers *which harness+model does it best* — the harness controls how the agent searches and iterates, the model controls how well it reasons over what it finds, and the hidden tests keep everyone honest.

## Instrument it with the Intelligence SDK

Want the cost, the per-tool waterfall, and the exported trace for each cell — and an effort knob that gates spend? [`intelligence-coding-bench`](../intelligence-coding-bench) imports this exact grid + task set and wraps every cell in the full Tangle Intelligence stack (`withTangleIntelligence` + `createWaterfallCollector` + `createOtelExporter`).
