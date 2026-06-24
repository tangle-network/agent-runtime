# coding-benchmark

**Run the same coding task across coding agents — fairly, honestly, with real statistics — as thin composition over `agent-runtime` / `agent-eval` primitives.** The scorer, the stats, the verifier, and the realness gate are all substrate calls, not reimplemented. The glue this example owns is small and named (an in-process offline box, the per-round refine loop, the leaderboard render); the load-bearing scoring and statistics are not hand-rolled.

```bash
# offline — no creds, no network. Runs the whole pipeline against an in-process box
# with a deterministic mock judge.
pnpm tsx examples/coding-benchmark/benchmark.ts

# pick a tool surface, add the 3-model judge panel, run more reps
pnpm tsx examples/coding-benchmark/benchmark.ts --tools web
pnpm tsx examples/coding-benchmark/benchmark.ts --ensemble --reps 5

# live — real harness boxes + a real judge model (see "Going live" for the exact reqs)
TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... \
  pnpm tsx examples/coding-benchmark/benchmark.ts --live
```

## What it measures

One coding task, run across a **matrix** of three axes, scored, and compared with real stats:

| Axis | What varies | Where |
|---|---|---|
| **harness** | claude-code / opencode / codex / cli, each on its **baseline default profile** (no skills, no injected prompt — we measure the harness, not our scaffolding) | `profiles.ts` |
| **scenario** | the held-out coding tasks (a token-bucket rate limiter, an RFC-4180 CSV parser, an LRU cache whose only passing path is the real eviction algorithm) | `scenarios.ts` |
| **tool surface** | `none` / `web` / `search-mcp` — folded in as a one-line knob (`--tools`) | `profiles.ts` |

The agent gets up to **3 refine rounds** in **one persistent box**: round N+1's prompt is built from round N's *check failures* (and nothing else — see the firewall). It stops the moment the deterministic checks pass.

The output is a leaderboard with confidence bands and a significance matrix:

```
Harness leaderboard (mean composite, 95% CI; pass-rate, Wilson CI):
  claude-code-baseline   composite 0.813 [0.813, 0.813]  pass 100% [44%, 100%]  (n=3)
  ...
Pairwise (paired delta + bootstrap CI; paired-test p, BH-corrected):
  opencode-baseline − claude-code-baseline: Δ=0.000 [0.000, 0.000] p=1.000 n.s.

  NOTE: n=3 scenarios — below the power floor. The paired tests above cannot reach
  significance at this corpus size (they demonstrate the wiring). Use 20-50 tasks for
  a real harness comparison.
```

> **Offline, every harness writes the same scripted solution and is scored by the same deterministic mock judge, so all deltas are 0.000** — the honest no-variance result, not a bug. The whole pipeline (matrix, verifier, realness gate, judge wiring, stats, firewall) runs for real; only the agent and the judge model are stubbed offline. **Offline the `--ensemble` panel is degenerate too: all three cross-family models share the one mock transport and return the identical verdict — cross-family independence is a live-only property.** `--live` swaps in real harness boxes, a real judge model, and (with `--ensemble`) three genuinely independent models, and the harnesses separate.

### The offline "agent" is a scripted stand-in

Offline there is no model, so each scenario's box writes a **canned solution** instead of calling a coding agent — a deterministic stand-in so the example runs with no creds. The scripts are honest: `rate-limiter` **improves across rounds** — round 0 is a genuinely hollow `return true` stub (no refill math, the constructor args unused) and round 1+ is the real token-bucket. The smoke test asserts the realness gate **gates that exact round-0 stub to composite 0** (the anti-cheat demo fires on the dispatch's own content, not a hand-built strawman). In the offline *run*, the refine loop then advances past round 0 to the real impl, so **no leaderboard cell ends up gated** — the gate-to-0 is proven against the dispatch's round-0 content, not produced as a gated row in the scored output. Offline the toolchain (`tsc` / `biome` / `node --test`) isn't on PATH, so the checks fail fast and all 3 rounds run — which is exactly when you want to see refinement.

## How a tool swap works (one line)

A tool surface is a **preset**, not forked code. Each preset authors the same two fields onto the profile — native web tools on/off (`profile.tools`) and an optional mounted MCP (`profile.mcp`) — and the sandbox substrate materializes them into each harness's real config:

```ts
withTools(profile, 'none')       // baseline: no web tools, no MCP
withTools(profile, 'web')        // native websearch + webfetch on
withTools(profile, 'search-mcp') // mount a search MCP instead
```

On the CLI it's `--tools none|web|search-mcp`. **Honesty caveat:** a preset only takes effect for a `(harness, lever)` pair the sandbox actually materializes — if a harness has no native `webfetch`, `--tools web` is a no-op *there*. That's a substrate fact, not something this example papers over. Check `@tangle-network/sandbox` for the materialization matrix before trusting a tool swap on a given harness.

## How it stays honest (the grading-criteria firewall)

**The LLM-judge rubric, the grading note, and the realness signals never reach the box** — so the agent cannot steer toward the criteria it is scored on. The test fixture is a different case, and the example is precise about it: the test is *seeded* into the box and a multi-round agent **can** read it, exactly as in real TDD.

- A `CodingScenario` (`scenarios.ts`) splits by where each field flows: `prompt` (the only field copied into the agent's **context**), the `fixture` (the deterministic test — **seeded into the workspace**, so `node --test` has a file to run), and the rubric note + realness signals (read **after** the loop by `eval.ts`, **never written into the box**).
- The firewall is one labeled block in **`dispatch.ts`** (`THE GRADING-CRITERIA FIREWALL LIVES HERE`): the only thing the agent's context gets is `scenario.prompt`, plus next-round prompts built **only** from check pass/fail + output. Because the criteria are different fields that the dispatch never writes into the profile, you can **see in one place** that the rubric/realness can't reach the agent.
- **What this protects, precisely:** the agent cannot read the LLM-judge rubric or the realness signals (the metric it would otherwise game). It **can** read the seeded test fixture — that is intentional. The test is a *spec the agent is asked to satisfy*, not a hidden answer key; a coding harness has native file-read tools, and across the 3 refine rounds the agent (and the next-round prompt, which includes the test runner's failure output) sees the assertions. That is the same contract as TDD and is honest for a benchmark: the protected secret is the *grading rubric*, not the tests.
- The realness gate runs **after** the loop and is recorded on the run — the agent can't steer toward a metric it can't read.

## How it scores (validators before judge)

Scoring runs in strict order, cheapest and most objective first — an `agent-eval` primitive at each layer:

1. **Deterministic checks (first, in the box, ~$0).** An ordered **`MultiLayerVerifier`** pipeline: `typecheck → test → lint`, with dependency-based skip (test never runs on a type error) and a blended score. typecheck + test gate `allPass` (and the refine loop); lint is advisory. These pass/fail booleans are the only thing that steers the next round. The test layer runs `node --experimental-transform-types --test`, not plain `node --test`: the fixture imports the solution as a `.ts` file, and Node's default type-*stripping* throws on constructor parameter properties (`constructor(private x: number)`) — the exact style the canonical impl uses — so a correct solution would otherwise score as a test failure. (`eval.ts` · `runChecks`)
2. **Realness gate (no LLM, and it GATES).** `scoreAuthenticity` + `gateRealness` — a pure structural scan that catches the stub shapes each task's signals encode. It is not just recorded: a **gated** artifact short-circuits the judge to composite **0 with no model call**. The gate fires on `fakeShim && !realImpl`, so each task's `realImpl` is anchored to the actual hard-part work (refill *math*, quote-state tracking, capacity eviction) and its `fakeShim` to the natural shortcut — tuned so the **natural cheat gates, not just one strawman**: a `return true` rate-limiter whose only "refill" is a constructor param name, a `for (… input.split('\n'))` CSV split, and a no-eviction `Map` wrapper all gate. It is **not** a general "any fake is caught" guarantee — it catches the specific shapes listed (the smoke test asserts each natural cheat is gated, on the dispatch's own content). On the sample tasks a real impl scores realness **85** and each cheat is **gated → composite 0**. (`eval.ts` · `realnessGate`, `scenarios.ts` · `realnessSignals`)
3. **LLM judge (last, only on the band the checks can't resolve).** A 4-dimension weighted rubric — correctness 0.40 · completeness 0.25 · code_quality 0.20 · robustness 0.15. The rubric text + anchors live **with the judge**, never in the workdir. (`eval.ts`)

**How many judges:**
- **Default: 1** — `singleCodeJudge`, built from `llmJudge` (one model call). Cheap, for the leaderboard sweep.
- **`--ensemble`: 3** — `ensembleCodeJudge`, built from `ensembleJudge`, three **cross-family**, snapshot-dated models (deepseek + openai + google). `crossFamily: true` rejects a same-family panel at construction, so the ensemble is genuinely independent **live**. The panel sees the **same full context** (code + check results + rubric note) the single judge does. Use it only for a ship/no-ship claim. (Offline, all three share the mock transport — see the offline note above.)

## How the stats are real (`stats.ts`)

Every number is one `agent-eval` primitive call — **no hand-rolled statistics and no fake p-values**:

- per-harness **mean composite + bootstrap CI** (`confidenceInterval`)
- per-harness **pass-rate + Wilson binomial CI** (`wilson`) — the correct interval for a proportion
- every harness **pair** compared on **matched scenarios** with a **real paired test** (`pairedTTest`, or `wilcoxonSignedRank` for the non-parametric path) for the p-value, and a **paired bootstrap** (`pairedBootstrap`) for the effect size + CI, then **BH-corrected** across all pairs (`benjaminiHochberg`) so running many comparisons doesn't manufacture a false winner.
- **Reps don't fake independent n — anywhere.** The paired unit is the *scenario*, and **the leaderboard uses the same unit**: with `--reps > 1`, a harness produces several records per scenario, so BOTH the leaderboard CI/Wilson AND the pairing collapse reps to **one mean per (harness, scenario)** before computing anything. Reps tighten the per-cell *estimate*; they are not independent samples, so they never narrow the interval out of zero new information. The reported `n` is the number of distinct scenarios, not the record count. (A regression test asserts identical reps leave the CI unchanged.)
- A record missing its `scenarioId` is a **loud throw**, not a silent merge — averaging distinct scenarios into one `''` bucket would corrupt the pairing, so it fails fast instead.

> **Power caveat.** The example corpus is **3 tasks** — far below what these tests need to separate harnesses. The Wilcoxon path returns `p=1` for fewer than 6 non-zero diffs, and the paired t-test has ~1 degree of freedom, so at this corpus size the significance machinery is structurally **non-significant**; it demonstrates the *wiring*, not a defensible claim. `renderStats` prints this caveat whenever `n < 6`. A real harness comparison wants **20-50 tasks**.

The leaderboard labels are the readable harness names, not the matrix's internal profile hashes.

## The files

| File | What it owns |
|---|---|
| `scenarios.ts` | the 3-task held-out corpus + the firewall-as-a-type (`prompt` vs rubric/realness vs the seeded fixture) + the seeded test fixtures + the check commands + the realness signals (tuned so the natural cheat gates) |
| `profiles.ts` | the harness axis (one bare baseline `AgentProfile` per harness) **and** the one-line tool knob (`withTools` + presets) |
| `eval.ts` | the scoring stack: `runChecks` (`MultiLayerVerifier`) + `realnessGate` + `singleCodeJudge` (`llmJudge`) / `ensembleCodeJudge` (`ensembleJudge`) |
| `dispatch.ts` | renders one matrix cell: persistent box + multi-round refine + token metering. **The firewall lives here.** |
| `offline-box.ts` | an in-process `SandboxClient` so the whole thing runs with no creds |
| `stats.ts` | leaderboard + `pairedTTest` / `pairedBootstrap` / `benjaminiHochberg` / `confidenceInterval` / `wilson` |
| `benchmark.ts` | the entrypoint: build the axes, hand the matrix the dispatch + judges, run, print stats |
| `coding-benchmark.test.ts` | offline smoke — the matrix produces `harnesses × scenarios × reps` records; the realness gate gates the dispatch's round-0 stub AND each natural cheat (per task); reps don't narrow the CI |

## Primitives composed

- **matrix:** `runProfileMatrix({ profiles, scenarios, dispatch, judges, reps, integrity, costCeiling })` (`@tangle-network/agent-eval/campaign`) with a `ProfileDispatchFn` rendering each cell
- **box + multi-round:** `openSandboxRun(client, opts, deliverable)` → `.start()` / `.resume()` over one persistent, resumable session (`@tangle-network/agent-runtime/loops`)
- **deterministic layer:** `MultiLayerVerifier` — ordered `typecheck → test → lint` with dependency-based skip and a blended score (`@tangle-network/agent-eval`)
- **token metering:** `extractLlmCallEvent` (`@tangle-network/agent-runtime/loops`) — reads usage off **every** backend event shape (`done` / `result` / `llm_call` / `usage`) so the integrity guard sees a real run
- **realness:** `scoreAuthenticity` + `gateRealness` (`@tangle-network/agent-eval/authenticity`)
- **judges:** `llmJudge` (single model call → canonical `JudgeConfig`, imported from `@tangle-network/agent-eval/campaign` so it resolves across the whole peer range) and `ensembleJudge` for the cross-family panel (`@tangle-network/agent-eval`); the judge transport is a `ChatClient` (`createChatClient` — a `mock` handler offline, the `router` live)
- **integrity:** `integrity: 'assert'` on the matrix proves a real backend ran (no stubbed cell) — `'off'` only for the offline mock
- **stats:** `pairedTTest`, `wilcoxonSignedRank`, `pairedBootstrap`, `benjaminiHochberg`, `confidenceInterval`, `wilson`

## Going live

`--live` is not "flip a flag and nothing else changes" — it swaps two stubs for real infra. To run it you need:

1. **`TANGLE_API_KEY` + `SANDBOX_BASE_URL`** — the dispatch lazily `import()`s `@tangle-network/sandbox` (behind the live flag, so the offline path never needs the SDK) and creates a real harness box per cell.
2. **A real judge model** — the judge's `ChatClient` becomes `createChatClient({ transport: 'router', apiKey })`; set `JUDGE_MODEL` (and optionally `TANGLE_ROUTER_URL`) to point it at your router. `--ensemble` then calls three real cross-family models.
3. The matrix runs with `integrity: 'assert'`, so a cell that produced no real token usage fails loudly instead of reporting a clean stub leaderboard.
4. **The harness box image must provide the toolchain on `PATH`** — the deterministic checks invoke bare `tsc`, `biome`, and `node --experimental-transform-types`. The test layer needs **Node >= 22.6** (for `--experimental-transform-types` and `.ts`-import test execution); on an older Node a correct param-property solution would fail with no hint why. A missing **advisory** tool (`biome`) folds to 0.5 and doesn't gate; a missing **`tsc`** gates the cell — so sanity-check your box image before trusting a live leaderboard. (Offline, a missing tool reads as a fail-fast, which is the honest no-toolchain signal.)

Everything else — the dispatch, the verifier, the realness gate, the stats — is identical between offline and live. That's the point: only the agent and the judge model change.

**Note on codex:** codex emits no structured tool calls, so per-tool progress is unavailable there. It still runs and scores; that's a harness property, not a gap in this example.
