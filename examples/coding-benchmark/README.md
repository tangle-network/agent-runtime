# coding-benchmark

**Run the same coding task across coding agents — fairly, honestly, with real statistics — in ~8 files of pure composition.** Every moving part is an `agent-runtime` or `agent-eval` primitive. Zero bespoke harness code.

```bash
# offline — no creds, no network. Runs the whole pipeline against an in-process box.
pnpm tsx examples/coding-benchmark/benchmark.ts

# swap a tool surface, add the 3-model judge, run more reps
pnpm tsx examples/coding-benchmark/benchmark.ts --tools web --ensemble --reps 5

# live — real harness boxes + a real judge model
TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... \
  pnpm tsx examples/coding-benchmark/benchmark.ts --live
```

## What it measures

One coding task, run across a **matrix** of three axes, scored, and compared with real stats:

| Axis | What varies | Where |
|---|---|---|
| **harness** | claude-code / opencode / codex / cli, each on its **baseline default profile** (no skills, no injected prompt — we measure the harness, not our scaffolding) | `profiles.ts` |
| **scenario** | the held-out coding tasks (a token-bucket rate limiter, an RFC-4180 CSV parser) | `scenarios.ts` |
| **tool surface** | `none` / `web` / `search-mcp` — folded in as a one-line knob | `tools.ts` |

The agent gets up to **3 refine rounds** in **one persistent box**: round N+1's prompt is built from round N's *check failures* (and nothing else — see the firewall). It stops the moment the deterministic checks pass.

The output is a leaderboard with confidence bands and a significance matrix:

```
Harness leaderboard (mean composite, 95% CI; pass-rate, Wilson CI):
  claude-code-baseline  composite 0.813 [0.813, 0.813]  pass 100% [34%, 100%]  (n=2)
  ...
Pairwise (paired bootstrap on matched scenarios, BH-corrected):
  opencode − claude-code: Δ=0.000 [0.000, 0.000] n.s.
```

> Offline, every harness runs the **same** scripted solution through the **same** stub judge, so all deltas are 0.000 — that's the honest no-variance result, not a bug. The plumbing (matrix, validators, judge, stats, firewall) all runs for real; only the model is stubbed. Add `--live` for real models and the harnesses separate.

## How a tool swap works (one line)

A tool surface is a **preset**, not forked code. Each preset authors the same two fields onto the profile — native web tools on/off and an optional mounted MCP — and the sandbox substrate materializes them into each harness's real config:

```ts
withTools(profile, 'web')        // native websearch + webfetch on
withTools(profile, 'search-mcp') // mount a search MCP instead
withTools(profile, 'none')       // baseline: no web, no MCP
```

On the CLI it's `--tools none|web|search-mcp`. **Honesty caveat:** a preset only takes effect for a `(harness, lever)` pair the sandbox actually materializes — if a harness has no native `webfetch`, `--tools web` is a no-op *there*. That's a substrate fact, not something this example papers over.

## How it stays honest (the no-cheat firewall)

**The agent's context is the task prompt — and nothing else.** The grading criteria never reach the box.

- A `CodingScenario` (`scenarios.ts`) splits into `prompt` (the **only** field the agent sees) and eval-only fields: the validator commands, the realness signals, the rubric note. Because they're different fields on one object, "the agent reads the answer key" becomes something you can **see in one place** — it would require the dispatch to write a non-`prompt` field into the box.
- **It does not.** The firewall is one labeled block in **`dispatch.ts`** (`THE NO-CHEAT FIREWALL LIVES HERE`): the only thing that reaches the box is `scenario.prompt`, plus next-round prompts built **only** from validator pass/fail + stderr. The rubric, the realness score, and the judge are read *after* the loop, never written in.
- The realness anchor runs **after** the loop and is written **write-only** to the record (`ctx.artifacts`) — the agent can't steer toward a metric it can't read.

## How it scores (validators before judge)

Scoring runs in strict order, cheapest and most objective first:

1. **Deterministic validators (run first, in the box, ~$0).** `typecheck` → `test` → `lint` as shell commands; pass/fail from the exit code. These steer the refine loop. (`validators.ts` · `runBoxChecks`)
2. **Realness anchor (write-only).** `scoreAuthenticity` + `gateRealness` — catches a stub that compiles but fakes the hard part. On the sample tasks it scores a real impl **85** and a `return true` stub **35 (gated)**. (`validators.ts` · `realnessValidator`)
3. **LLM judge (last, only on the band the checks can't resolve).** A 4-dimension weighted rubric — correctness 0.40 · completeness 0.25 · code_quality 0.20 · robustness 0.15. The rubric text + anchors live **with the judge**, never in the workdir. (`judges.ts`)

**How many judges:**
- **Default: 1** — `singleCodeJudge`, one model. Cheap, for the leaderboard sweep.
- **`--ensemble`: 3** — `ensembleCodeJudge`, three **cross-family** models (deepseek + openai + google). `crossFamily: true` rejects a same-family panel at construction, so the ensemble is genuinely independent. Use it only for a ship/no-ship claim.

**Validators per cell:** 3 deterministic checks + 1 realness anchor = **4**, all before the judge.

## How the stats are real (`stats.ts`)

Every number is one `agent-eval` primitive call — no hand-rolled statistics:

- per-harness **mean composite + bootstrap CI** (`confidenceInterval`)
- per-harness **pass-rate + Wilson binomial CI** (`wilson`) — the correct interval for a proportion
- every harness **pair** compared on **matched scenarios** with a **paired bootstrap** (`pairedBootstrap`), then **BH-corrected** across all pairs (`benjaminiHochberg`) so running many comparisons doesn't manufacture a false winner

## The files

| File | What it owns |
|---|---|
| `scenarios.ts` | the held-out task corpus + the firewall-as-a-type (`prompt` vs eval-only fields) |
| `profiles.ts` | the harness axis — one bare baseline `AgentProfile` per harness |
| `tools.ts` | the one-line tool knob (`withTools` + presets) |
| `validators.ts` | deterministic checks (`runBoxChecks`) + the realness anchor (`realnessValidator`) |
| `judges.ts` | the rubric + `singleCodeJudge` (1) and `ensembleCodeJudge` (3) |
| `dispatch.ts` | renders one matrix cell: persistent box + multi-round refine. **The firewall lives here.** |
| `offline-box.ts` | an in-process `SandboxClient` so the whole thing runs with no creds |
| `benchmark.ts` | the entrypoint: build the axes, hand the matrix the dispatch + judges, run, print stats |
| `stats.ts` | pairs harnesses → `pairedBootstrap` / `benjaminiHochberg` / `confidenceInterval` / `wilson` |

## Primitives composed

- **matrix:** `runProfileMatrix({ profiles, scenarios, dispatch, judges, reps, integrity, costCeiling })` (`@tangle-network/agent-eval/campaign`) with a `ProfileDispatchFn` rendering each cell
- **box + multi-round:** `openSandboxRun(client, opts, deliverable)` → `.start()` / `.resume()` over one persistent, resumable session (`@tangle-network/agent-runtime/loops`)
- **deterministic layer:** the runtime `Validator<Output, Verdict>` seam, run before the judge
- **realness:** `scoreAuthenticity` + `gateRealness` (`@tangle-network/agent-eval/authenticity`)
- **judges:** a hand-built `JudgeConfig`, and `ensembleJudge` + `aggregateJudgeVerdicts` for the panel
- **integrity:** `integrity: 'assert'` on the matrix proves a real backend ran (no stubbed cell) — `'off'` only for the offline stub
- **stats:** `pairedBootstrap`, `benjaminiHochberg`, `confidenceInterval`, `wilson`

## Going live

Swap `offlineSandboxClient(...)` for a real `@tangle-network/sandbox` client (the `--live` path in `benchmark.ts`) and point the judge's `complete` / `scoreOne` at your router. **Nothing else in the example changes** — same dispatch, same matrix, same stats. That's the point.

**Note on codex:** codex emits no structured tool calls, so per-tool progress is unavailable there. It still runs and scores; that's a harness property, not a gap in this example.
