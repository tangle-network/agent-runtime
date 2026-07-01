# webcode-matrix

Run the **real** [WebCode benchmark](https://exa.ai/blog/webcode) across a **matrix of harnesses × models**, scored by Exa's own graders, rendered as a publishable leaderboard.

WebCode is 33 coding tasks across 9 languages, each targeting a library API released *after* the model's training cutoff, so the agent must **web-search** to find the current signatures. Each task ships a prompt, the file to produce, and a pytest grader (`test_patch`).

## What this is — and what Exa ships

Exa open-sources the **dataset only**: *"No agent harness included — bring your own (e.g. mini-swe-agent)."* So this example is **the harness**: it sweeps the cartesian of **harness** (what drives the agent — claude-code / codex / opencode / gemini) × **model**, runs each (harness×model, task) cell in its own sandbox with web search on, writes the agent's solution, and runs **Exa's exact `test_patch`** — pass ⟺ pytest exits 0. No LLM judge; no invented tasks.

The real 33-task dataset (MIT) is **fetched, not committed** (it carries secret-shaped test fixtures) — run [`data/fetch.sh`](./data/fetch.sh) first, or set `WEBCODE_DATASET`. See [`data/SOURCE.md`](./data/SOURCE.md) for provenance.

### Grading toolchain — three tiers (pick by fidelity need)

Each task ships a Dockerfile pinning its toolchain (Swift 6.1, Go 1.23, …) plus python/pytest to run the grader. How the sandbox provides that toolchain:

1. **`environment: 'universal'`** *(default here)* — one multi-language Nix stack (python+pytest + Go/Py/TS/Java/C++), the same default the `commit0`/`clbench` gates use. Zero per-task work; covers the common languages.
2. **Per-task image** — exotic toolchains universal lacks (Swift/Elixir/Kotlin) ship their own base in `task.baseImage` (parsed from the task's `FROM`); pass it as `sandboxOverrides.image`. Already plumbed; no new code.
3. **Pre-built per-task image** — for byte-exact parity with Exa's Dockerfile, pre-build each into a registry image and reference it by tag.

A missing toolchain surfaces as a **failing test, never a fake pass**.

## Run it

```bash
examples/webcode-matrix/data/fetch.sh   # one-time: download the 33-task dataset

TANGLE_API_KEY=…        # ONE key — sandbox + model router + router-backed web_search
SANDBOX_API_KEY=…       # the sandbox service (omit if your TANGLE_API_KEY also provisions sandboxes)
LIMIT=3                 # optional: first N tasks for a cheap smoke (omit for all 33)
tsx examples/webcode-matrix/webcode-matrix.ts
```

Search is **router-backed** — the agent's `web_search` goes through the Tangle router on `TANGLE_API_KEY` (provider picked by `TANGLE_SEARCH_DEFAULT_PROVIDER`, default `exa`); no separate Exa key. `you`/`perplexity`/`tavily`/`parallel`/`brave` work the same way.

Writes **`report.md` + `report.svg` + `report.html`** to `RUN_DIR` — a ranked leaderboard, the full profile×task score matrix, and embeddable charts. That rendering is the general [`leaderboard`](../../docs/canonical-api.md) engine (`@tangle-network/agent-runtime/loops`), which turns any `runProfileMatrix` result into the same report for **any** benchmark in any domain.

## The pieces

- [`webcode-dataset.ts`](./webcode-dataset.ts) — `loadWebCodeTasks()` loads the real 33 tasks (prompt + `test_patch` + solution file + dockerfile).
- [`webcode-matrix.ts`](./webcode-matrix.ts) — the harness×model grid, the dispatch (run → write solution → run Exa's grader), and the leaderboard render.
- [`../intelligence-webcode`](../intelligence-webcode) — the same benchmark with the full Tangle Intelligence SDK (cost, per-tool waterfall, OTLP) on every cell.

## Why it's interesting

WebCode isolates one thing: can an agent retrieve and apply knowledge it was never trained on? The matrix answers *which harness+model does it best* — the harness controls how the agent searches and iterates, the model controls how well it reasons over what it finds, and Exa's hidden tests keep everyone honest.
