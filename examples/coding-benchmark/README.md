# coding-benchmark

**Run the same coding task across coding agents — fairly, honestly, with real statistics — in 7 files of pure composition.** Every moving part is an `agent-runtime` or `agent-eval` primitive. Zero bespoke harness code, no hand-rolled scorer, no hand-rolled statistics.

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
| **scenario** | the held-out coding tasks (a token-bucket rate limiter, an RFC-4180 CSV parser) | `scenarios.ts` |
| **tool surface** | `none` / `web` / `search-mcp` — folded in as a one-line knob (`--tools`) | `profiles.ts` |

The agent gets up to **3 refine rounds** in **one persistent box**: round N+1's prompt is built from round N's *check failures* (and nothing else — see the firewall). It stops the moment the deterministic checks pass.

The output is a leaderboard with confidence bands and a significance matrix:

```
Harness leaderboard (mean composite, 95% CI; pass-rate, Wilson CI):
  claude-code-baseline   composite 0.813 [0.813, 0.813]  pass 100% [34%, 100%]  (n=2)
  ...
Pairwise (paired delta + bootstrap CI; paired-test p, BH-corrected):
  opencode-baseline − claude-code-baseline: Δ=0.000 [0.000, 0.000] p=1.000 n.s.
```

> **Offline, every harness writes the same scripted solution and is scored by the same deterministic mock judge, so all deltas are 0.000** — the honest no-variance result, not a bug. The whole pipeline (matrix, verifier, realness gate, judge wiring, stats, firewall) runs for real; only the agent and the judge model are stubbed offline. `--live` swaps in real harness boxes and a real judge model and the harnesses separate.

### The offline "agent" is a scripted stand-in

Offline there is no model, so each scenario's box writes a **canned solution** instead of calling a coding agent — a deterministic stand-in so the example runs with no creds. The scripts are honest: `rate-limiter` **improves across rounds** — round 0 is a genuinely hollow `return true` stub (no refill math, the constructor args unused) that the realness gate **gates to composite 0** on the actual run, and round 1+ is the real token-bucket. That's a real refine demo where the anti-cheat gate fires on the benchmark's **own data**, not only in a unit test. Offline the toolchain (`tsc` / `biome` / `node --test`) isn't on PATH, so the checks fail fast and all 3 rounds run — which is exactly when you want to see refinement.

## How a tool swap works (one line)

A tool surface is a **preset**, not forked code. Each preset authors the same two fields onto the profile — native web tools on/off (`profile.tools`) and an optional mounted MCP (`profile.mcp`) — and the sandbox substrate materializes them into each harness's real config:

```ts
withTools(profile, 'none')       // baseline: no web tools, no MCP
withTools(profile, 'web')        // native websearch + webfetch on
withTools(profile, 'search-mcp') // mount a search MCP instead
```

On the CLI it's `--tools none|web|search-mcp`. **Honesty caveat:** a preset only takes effect for a `(harness, lever)` pair the sandbox actually materializes — if a harness has no native `webfetch`, `--tools web` is a no-op *there*. That's a substrate fact, not something this example papers over. Check `@tangle-network/sandbox` for the materialization matrix before trusting a tool swap on a given harness.

## How it stays honest (the no-cheat firewall)

**The agent's context is the task prompt — and nothing else.** The grading criteria never reach the box.

- A `CodingScenario` (`scenarios.ts`) splits into `prompt` (the **only** field the agent sees) and eval-only fields: the hidden test fixture, the realness signals, the rubric note. Because they're different fields on one object, "the agent reads the answer key" becomes something you can **see in one place** — it would require the dispatch to write a non-`prompt` field into the agent's context.
- **It does not.** The firewall is one labeled block in **`dispatch.ts`** (`THE NO-CHEAT FIREWALL LIVES HERE`): the only thing the agent reads is `scenario.prompt`, plus next-round prompts built **only** from check pass/fail + output. The hidden test is *seeded* into the box (so `node --test` has a file to run) but its assertions are never described to the agent; the rubric, the realness signals, and the judge are read *after* the loop, never written in.
- The realness gate runs **after** the loop and is recorded on the run — the agent can't steer toward a metric it can't read.

## How it scores (validators before judge)

Scoring runs in strict order, cheapest and most objective first — an `agent-eval` primitive at each layer:

1. **Deterministic checks (first, in the box, ~$0).** An ordered **`MultiLayerVerifier`** pipeline: `typecheck → test → lint`, with dependency-based skip (test never runs on a type error) and a blended score. typecheck + test gate `allPass` (and the refine loop); lint is advisory. These pass/fail booleans are the only thing that steers the next round. The test layer runs `node --experimental-transform-types --test`, not plain `node --test`: the fixture imports the solution as a `.ts` file, and Node's default type-*stripping* throws on constructor parameter properties (`constructor(private x: number)`) — the exact style the canonical impl uses — so a correct solution would otherwise score as a test failure. (`eval.ts` · `runChecks`)
2. **Realness gate (no LLM, and it GATES).** `scoreAuthenticity` + `gateRealness` — a pure structural scan that catches a stub that compiles but fakes the hard part. It is not just recorded: a **gated** artifact short-circuits the judge to composite **0 with no model call** (a hollow `return true` rate-limiter cannot earn a score, however confident a judge would be). On the sample tasks it scores a real impl realness **85** and the offline round-0 stub **gated → composite 0** — and the smoke test asserts the gate against the **exact stub the dispatch writes**, so the demo fires on the benchmark's own data, not only on a hand-built strawman. (`eval.ts` · `realnessGate`)
3. **LLM judge (last, only on the band the checks can't resolve).** A 4-dimension weighted rubric — correctness 0.40 · completeness 0.25 · code_quality 0.20 · robustness 0.15. The rubric text + anchors live **with the judge**, never in the workdir. (`eval.ts`)

**How many judges:**
- **Default: 1** — `singleCodeJudge`, built from `llmJudge` (one model call). Cheap, for the leaderboard sweep.
- **`--ensemble`: 3** — `ensembleCodeJudge`, built from `ensembleJudge`, three **cross-family** models (deepseek + openai + google). `crossFamily: true` rejects a same-family panel at construction, so the ensemble is genuinely independent. The panel sees the **same full context** (code + check results + rubric note) the single judge does. Use it only for a ship/no-ship claim.

## How the stats are real (`stats.ts`)

Every number is one `agent-eval` primitive call — **no hand-rolled statistics and no fake p-values**:

- per-harness **mean composite + bootstrap CI** (`confidenceInterval`)
- per-harness **pass-rate + Wilson binomial CI** (`wilson`) — the correct interval for a proportion
- every harness **pair** compared on **matched scenarios** with a **real paired test** (`pairedTTest`, or `wilcoxonSignedRank` for the non-parametric path) for the p-value, and a **paired bootstrap** (`pairedBootstrap`) for the effect size + CI, then **BH-corrected** across all pairs (`benjaminiHochberg`) so running many comparisons doesn't manufacture a false winner.
- **Reps don't fake independent n — anywhere.** The paired unit is the *scenario*, and **the leaderboard uses the same unit**: with `--reps > 1`, a harness produces several records per scenario, so BOTH the leaderboard CI/Wilson AND the pairing collapse reps to **one mean per (harness, scenario)** before computing anything. Reps tighten the per-cell *estimate*; they are not independent samples, so they never narrow the interval out of zero new information. The reported `n` is the number of distinct scenarios, not the record count. (A regression test asserts identical reps leave the CI unchanged.)

The leaderboard labels are the readable harness names, not the matrix's internal profile hashes.

## The files

| File | What it owns |
|---|---|
| `scenarios.ts` | the held-out task corpus + the firewall-as-a-type (`prompt` vs eval-only fields) + the seeded test fixtures + the check commands |
| `profiles.ts` | the harness axis (one bare baseline `AgentProfile` per harness) **and** the one-line tool knob (`withTools` + presets) |
| `eval.ts` | the scoring stack: `runChecks` (`MultiLayerVerifier`) + `realnessGate` + `singleCodeJudge` (`llmJudge`) / `ensembleCodeJudge` (`ensembleJudge`) |
| `dispatch.ts` | renders one matrix cell: persistent box + multi-round refine + token metering. **The firewall lives here.** |
| `offline-box.ts` | an in-process `SandboxClient` so the whole thing runs with no creds |
| `stats.ts` | leaderboard + `pairedTTest` / `pairedBootstrap` / `benjaminiHochberg` / `confidenceInterval` / `wilson` |
| `benchmark.ts` | the entrypoint: build the axes, hand the matrix the dispatch + judges, run, print stats |
| `coding-benchmark.test.ts` | offline smoke — the matrix produces `harnesses × scenarios × reps` records, and the realness gate catches a stub |

## Primitives composed

- **matrix:** `runProfileMatrix({ profiles, scenarios, dispatch, judges, reps, integrity, costCeiling })` (`@tangle-network/agent-eval/campaign`) with a `ProfileDispatchFn` rendering each cell
- **box + multi-round:** `openSandboxRun(client, opts, deliverable)` → `.start()` / `.resume()` over one persistent, resumable session (`@tangle-network/agent-runtime/loops`)
- **deterministic layer:** `MultiLayerVerifier` — ordered `typecheck → test → lint` with dependency-based skip and a blended score (`@tangle-network/agent-eval`)
- **token metering:** `extractLlmCallEvent` (`@tangle-network/agent-runtime/loops`) — reads usage off **every** backend event shape (`done` / `result` / `llm_call` / `usage`) so the integrity guard sees a real run
- **realness:** `scoreAuthenticity` + `gateRealness` (`@tangle-network/agent-eval/authenticity`)
- **judges:** `llmJudge` (single model call → canonical `JudgeConfig`) and `ensembleJudge` for the cross-family panel (`@tangle-network/agent-eval`); the judge transport is a `ChatClient` (`createChatClient` — a `mock` handler offline, the `router` live)
- **integrity:** `integrity: 'assert'` on the matrix proves a real backend ran (no stubbed cell) — `'off'` only for the offline mock
- **stats:** `pairedTTest`, `wilcoxonSignedRank`, `pairedBootstrap`, `benjaminiHochberg`, `confidenceInterval`, `wilson`

## Going live

`--live` is not "flip a flag and nothing else changes" — it swaps two stubs for real infra. To run it you need:

1. **`TANGLE_API_KEY` + `SANDBOX_BASE_URL`** — the dispatch lazily `import()`s `@tangle-network/sandbox` (behind the live flag, so the offline path never needs the SDK) and creates a real harness box per cell.
2. **A real judge model** — the judge's `ChatClient` becomes `createChatClient({ transport: 'router', apiKey })`; set `JUDGE_MODEL` (and optionally `TANGLE_ROUTER_URL`) to point it at your router. `--ensemble` then calls three real cross-family models.
3. The matrix runs with `integrity: 'assert'`, so a cell that produced no real token usage fails loudly instead of reporting a clean stub leaderboard.

Everything else — the dispatch, the verifier, the realness gate, the stats — is identical between offline and live. That's the point: only the agent and the judge model change.

**Note on codex:** codex emits no structured tool calls, so per-tool progress is unavailable there. It still runs and scores; that's a harness property, not a gap in this example.
