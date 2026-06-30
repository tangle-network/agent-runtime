# webcode-matrix

Run the **real** [WebCode benchmark](https://exa.ai/blog/webcode) across a **matrix of harnesses × models**, scored by Exa's own graders, rendered as a publishable leaderboard.

WebCode is 33 coding tasks across 9 languages, each targeting a library API released *after* the model's training cutoff, so the agent must **web-search** to find the current signatures. Each task ships a prompt, the file to produce, and a pytest grader (`test_patch`).

## What this is — and what Exa ships

Exa open-sources the **dataset only**: *"No agent harness included — bring your own (e.g. mini-swe-agent)."* So this example is **the harness**: it sweeps the cartesian of **harness** (what drives the agent — claude-code / codex / opencode / gemini) × **model**, runs each (harness×model, task) cell in its own sandbox with web search on, writes the agent's solution, and runs **Exa's exact `test_patch`** — pass ⟺ pytest exits 0. No LLM judge; no invented tasks.

The real 33-task dataset (MIT) is **fetched, not committed** (it carries secret-shaped test fixtures) — run [`data/fetch.sh`](./data/fetch.sh) first, or set `WEBCODE_DATASET`. See [`data/SOURCE.md`](./data/SOURCE.md) for provenance.

> **Fidelity note.** Exa grades each task inside its own `dockerfile` toolchain image (Swift, Go, …). This example runs the grader in the harness's sandbox; where a task's toolchain isn't present, its tests fail — never a fake pass. Wiring the per-task image is the one remaining step to byte-for-byte parity.

## Run it

```bash
examples/webcode-matrix/data/fetch.sh   # one-time: download the 33-task dataset

EXA_API_KEY=…           # in-box web search
SANDBOX_API_KEY=…       # the sandbox service
LIMIT=3                 # optional: first N tasks for a cheap smoke (omit for all 33)
tsx examples/webcode-matrix/webcode-matrix.ts
```

Writes **`report.md` + `report.svg` + `report.html`** to `RUN_DIR` — a ranked leaderboard, the full profile×task score matrix, and embeddable charts. That rendering is the general [`leaderboard`](../../docs/canonical-api.md) engine (`@tangle-network/agent-runtime/loops`), which turns any `runProfileMatrix` result into the same report for **any** benchmark in any domain.

## The pieces

- [`webcode-dataset.ts`](./webcode-dataset.ts) — `loadWebCodeTasks()` loads the real 33 tasks (prompt + `test_patch` + solution file + dockerfile).
- [`webcode-matrix.ts`](./webcode-matrix.ts) — the harness×model grid, the dispatch (run → write solution → run Exa's grader), and the leaderboard render.
- [`../intelligence-coding-bench`](../intelligence-coding-bench) — the same benchmark with the full Tangle Intelligence SDK (cost, per-tool waterfall, OTLP) on every cell.

## Why it's interesting

WebCode isolates one thing: can an agent retrieve and apply knowledge it was never trained on? The matrix answers *which harness+model does it best* — the harness controls how the agent searches and iterates, the model controls how well it reasons over what it finds, and Exa's hidden tests keep everyone honest.
