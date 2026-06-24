# coding-benchmark

**Run the same coding task across coding agents — fairly, honestly, with real statistics — as thin composition over `agent-runtime` / `agent-eval` primitives.** The anti-cheat is **held-out test execution** (SWE-bench / HumanEval style): the agent develops against a few visible example tests, then is graded on a **hidden test suite it never saw and cannot hardcode**. A real solution passes; a cheat (memorize the visible examples, fake the hard part) fails. The verifier, the stats, and the judges are all substrate calls, not reimplemented. The glue this example owns is small and named (an in-process offline box, the per-round refine loop, the leaderboard render); the load-bearing scoring and statistics are not hand-rolled.

```bash
# offline — no creds, no network. Runs the whole pipeline against an in-process box
# with a deterministic mock judge. The held-out tests run for real (node --test).
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
| **scenario** | the coding tasks (a token-bucket rate limiter, an RFC-4180 CSV parser, an LRU cache whose only passing path is the real eviction algorithm) — each carries a few **visible** example tests and a **held-out** grading suite | `scenarios.ts` |
| **tool surface** | `none` / `web` / `search-mcp` — folded in as a one-line knob (`--tools`) | `profiles.ts` |

The agent gets up to **3 refine rounds** in **one persistent box**: round N+1's prompt is built from round N's *visible-test failures* (and nothing else — see the firewall). It stops the moment the dev checks pass.

The output is a leaderboard with confidence bands and a significance matrix:

```
Harness leaderboard (mean composite, 95% CI; pass-rate, Wilson CI):
  claude-code-baseline   composite 0.944 [0.944, 0.944]  pass 100% [44%, 100%]  (n=3)
  ...
Pairwise (paired delta + bootstrap CI; paired-test p, BH-corrected):
  opencode-baseline − claude-code-baseline: Δ=0.000 [0.000, 0.000] p=1.000 n.s. (underpowered)

  NOTE: n=3 scenarios — below the power floor (6). The paired tests above cannot defensibly
  reach significance at this corpus size, so the SIGNIFICANT tag is suppressed (they
  demonstrate the wiring). Use 20-50 tasks for a real harness comparison.
```

> **Offline, every harness writes the same scripted solution and is scored by the same deterministic mock judge, so all deltas are 0.000** — the honest no-variance result, not a bug. The whole pipeline (matrix, verifier, held-out test execution, judge wiring, stats, firewall) runs for real; only the agent and the judge model are stubbed offline. **Offline the `--ensemble` panel is degenerate too: all three cross-family models share the one mock transport and return the identical verdict — cross-family independence is a live-only property.** `--live` swaps in real harness boxes, a real judge model, and (with `--ensemble`) three genuinely independent models, and the harnesses separate.

### The offline "agent" is a scripted stand-in

Offline there is no model, so each scenario's box writes a **canned solution** instead of calling a coding agent — a deterministic stand-in so the example runs with no creds. The scripts are honest: `rate-limiter` **improves across rounds** — round 0 is a **hardcode-the-visible cheat** (it memorizes the visible example answers, no bucket math) and round 1+ is the real token-bucket. The smoke test runs both against the real held-out suite and asserts the cheat **passes the visible test but fails the held-out** (it never saw those inputs), while the real impl passes the held-out outright. Offline `node` is present, so the held-out execution is genuine; `tsc`/`biome` usually aren't, so the typecheck-gated dev checks never fully pass and all 3 rounds run — which is exactly when refinement shows.

## How a tool swap works (one line)

A tool surface is a **preset**, not forked code. Each preset authors the same two fields onto the profile — native web tools on/off (`profile.tools`) and an optional mounted MCP (`profile.mcp`) — and the sandbox substrate materializes them into each harness's real config:

```ts
withTools(profile, 'none')       // baseline: no web tools, no MCP
withTools(profile, 'web')        // native websearch + webfetch on
withTools(profile, 'search-mcp') // mount a search MCP instead
```

On the CLI it's `--tools none|web|search-mcp`. **Honesty caveat:** a preset only takes effect for a `(harness, lever)` pair the sandbox actually materializes — if a harness has no native `webfetch`, `--tools web` is a no-op *there*. That's a substrate fact, not something this example papers over. Check `@tangle-network/sandbox` for the materialization matrix before trusting a tool swap on a given harness.

## The anti-cheat: held-out test execution (the firewall)

**The agent cannot game tests it never saw.** That is the whole anti-cheat, and it is *execution truth*, not a text scan:

- Each scenario carries two test files. The **visible** test (a few example cases) is *seeded into the box during the turn* — the agent develops against it, exactly like real TDD. The **held-out** test (the same behavior, with **different inputs and extra edge cases** the visible examples don't cover) is **never seeded during the turn**.
- During the turn, the box has only: the task prompt + the visible example test. The held-out suite never enters the box while the agent is working — **that is the firewall**.
- At grading (after the refine loop), the harness copies the held-out suite into the box and runs it (`node --experimental-transform-types --test`). The **held-out pass rate is the PRIMARY, ungameable correctness score.**
- A solution that hardcoded the visible examples' exact values passes the visible test but **fails the held-out inputs** (e.g. the rate-limiter held-out uses capacities `7/6/5/2`, not the visible `10/3/10`). A solution that faked the hard part fails them too. Only real behavior passes both.

You can **see the firewall in one place** in `dispatch.ts` (`THE FIREWALL LIVES HERE`): the only thing the agent's context gets is `scenario.prompt`, the only test seeded during the loop is `scenario.visibleTest`, and `runHeldout` (the held-out seed + run) is called *after* the loop closes. The LLM-judge rubric note is read later by `eval.ts` and is never written into the box.

## How it scores (held-out correctness first, judge second)

Scoring runs in strict order, cheapest and most objective first — an `agent-eval` primitive at each layer:

1. **Dev checks (first, in the box, ~$0, advisory for the grade).** An ordered **`MultiLayerVerifier`** pipeline: `typecheck → test(visible) → lint`, with dependency-based skip (test never runs on a type error) and a blended score. These pass/fail booleans are the only thing that steers the next refine round — they tell the agent it's on track, but passing the visible examples does **not** prove correctness. The test layer runs `node --experimental-transform-types --test`, not plain `node --test`: the test imports the solution as a `.ts` file, and Node's default type-*stripping* throws on constructor parameter properties (`constructor(private x: number)`) — the exact style the canonical impl uses — so a correct solution would otherwise score as a test failure. (`eval.ts` · `runChecks`)
2. **Held-out test execution (the PRIMARY anti-cheat).** After the loop, the hidden suite is seeded and run in the same box; the **held-out pass rate** is the primary correctness number. It is ungameable: the agent never saw these inputs, so a hardcode-the-visible cheat or a faked impl fails. (`eval.ts` · `runHeldout`, `scenarios.ts` · `heldoutTest`)
3. **LLM judge (last, SECONDARY quality signal).** A 4-dimension weighted rubric — correctness 0.40 · completeness 0.25 · code_quality 0.20 · robustness 0.15. The rubric text + anchors live **with the judge**, never in the workdir. The judge scores code *quality*; it does not decide correctness. (`eval.ts`)

**The composite** the leaderboard ranks on is **`0.7 · held-out-pass-rate + 0.3 · judge-quality`** — held-out correctness is load-bearing, the judge is a tie-breaker on style. On the rate-limiter task the round-0 hardcode-the-visible cheat scores held-out 2/4 → composite **0.59**; the real token-bucket scores held-out 4/4 → composite **0.94** (with the judge held equal at 0.80). (`eval.ts` · `composeScore`)

**How many judges:**
- **Default: 1** — `singleCodeJudge`, built from `llmJudge` (one model call). Cheap, for the leaderboard sweep.
- **`--ensemble`: 3** — `ensembleCodeJudge`, built from `ensembleJudge`, three **cross-family**, snapshot-dated models (deepseek + openai + google). `crossFamily: true` rejects a same-family panel at construction, so the ensemble is genuinely independent **live**. The panel sees the **same full context** (code + check results + held-out pass rate + rubric note) the single judge does. Use it only for a ship/no-ship claim. (Offline, all three share the mock transport — see the offline note above.)

## How the stats are real (`stats.ts`)

Every number is one `agent-eval` primitive call — **no hand-rolled statistics and no fake p-values**:

- per-harness **mean composite + bootstrap CI** (`confidenceInterval`)
- per-harness **pass-rate + Wilson binomial CI** (`wilson`) — the correct interval for a proportion
- every harness **pair** compared on **matched scenarios** with a **real paired test** (`pairedTTest`, or `wilcoxonSignedRank` for the non-parametric path) for the p-value, and a **paired bootstrap** (`pairedBootstrap`) for the effect size + CI, then **BH-corrected** across all pairs (`benjaminiHochberg`) so running many comparisons doesn't manufacture a false winner.
- **Reps don't fake independent n — anywhere.** The paired unit is the *scenario*, and **the leaderboard uses the same unit**: with `--reps > 1`, a harness produces several records per scenario, so BOTH the leaderboard CI/Wilson AND the pairing collapse reps to **one mean per (harness, scenario)** before computing anything. Reps tighten the per-cell *estimate*; they are not independent samples, so they never narrow the interval out of zero new information. The reported `n` is the number of distinct scenarios, not the record count. (A regression test asserts identical reps leave the CI unchanged.)
- A record missing its `scenarioId` is a **loud throw**, not a silent merge — averaging distinct scenarios into one `''` bucket would corrupt the pairing, so it fails fast instead.

> **Power caveat.** The example corpus is **3 tasks** — far below what these tests need to separate harnesses. The Wilcoxon path returns `p=1` for fewer than 6 non-zero diffs, and the paired t-test has ~1 degree of freedom. Below the power floor (`n < 6`) `renderStats` **suppresses the `SIGNIFICANT` tag entirely** (a near-constant gap on a few scenarios can return `p<0.05` and still mean nothing — the small-n mirage), and a zero-variance pair (a collapsed bootstrap CI) never reads as a real effect either. At this corpus size the example demonstrates the *wiring*, not a defensible claim. A real harness comparison wants **20-50 tasks**.

The leaderboard labels are the readable harness names, not the matrix's internal profile hashes.

## The files

| File | What it owns |
|---|---|
| `scenarios.ts` | the 3-task corpus + the firewall-as-a-type (`prompt` vs `visibleTest` vs the held-out `heldoutTest` vs the judge rubric) + the seeded visible tests + the held-out grading suites + the check commands |
| `profiles.ts` | the harness axis (one bare baseline `AgentProfile` per harness) **and** the one-line tool knob (`withTools` + presets) |
| `eval.ts` | the scoring stack: `runChecks` (`MultiLayerVerifier`) + `runHeldout` (the held-out execution) + `composeScore` (held-out × judge blend) + `singleCodeJudge` (`llmJudge`) / `ensembleCodeJudge` (`ensembleJudge`) |
| `dispatch.ts` | renders one matrix cell: persistent box + multi-round refine + held-out grading + token metering. **The firewall lives here.** |
| `offline-box.ts` | an in-process `SandboxClient` so the whole thing runs with no creds |
| `stats.ts` | leaderboard + `pairedTTest` / `pairedBootstrap` / `benjaminiHochberg` / `confidenceInterval` / `wilson`, with the small-n SIGNIFICANT-suppression guard |
| `benchmark.ts` | the entrypoint: build the axes, hand the matrix the dispatch + judges, run, print stats |
| `coding-benchmark.test.ts` | offline smoke — the matrix produces `harnesses × scenarios × reps` records; a hardcode-the-visible cheat fails the held-out suite while the real solution passes (by execution); the held-out test is never seeded during the turn (firewall); reps don't narrow the CI |

## Primitives composed

- **matrix:** `runProfileMatrix({ profiles, scenarios, dispatch, judges, reps, integrity, costCeiling })` (`@tangle-network/agent-eval/campaign`) with a `ProfileDispatchFn` rendering each cell
- **box + multi-round:** `openSandboxRun(client, opts, deliverable)` → `.start()` / `.resume()` over one persistent, resumable session (`@tangle-network/agent-runtime/loops`)
- **dev layer:** `MultiLayerVerifier` — ordered `typecheck → test → lint` with dependency-based skip and a blended score (`@tangle-network/agent-eval`)
- **held-out execution:** the hidden suite is seeded after the loop and run with `node --experimental-transform-types --test`; the pass rate is the primary score (`eval.ts` · `runHeldout`)
- **token metering:** `extractLlmCallEvent` (`@tangle-network/agent-runtime/loops`) — reads usage off **every** backend event shape (`done` / `result` / `llm_call` / `usage`) so the integrity guard sees a real run
- **judges:** `llmJudge` (single model call → canonical `JudgeConfig`, imported from `@tangle-network/agent-eval/campaign` so it resolves across the whole peer range) and `ensembleJudge` for the cross-family panel (`@tangle-network/agent-eval`); the judge transport is a `ChatClient` (`createChatClient` — a `mock` handler offline, the `router` live)
- **integrity:** `integrity: 'assert'` on the matrix proves a real backend ran (no stubbed cell) — `'off'` only for the offline mock
- **stats:** `pairedTTest`, `wilcoxonSignedRank`, `pairedBootstrap`, `benjaminiHochberg`, `confidenceInterval`, `wilson`

## Going live

`--live` is not "flip a flag and nothing else changes" — it swaps two stubs for real infra. To run it you need:

1. **`TANGLE_API_KEY` + `SANDBOX_BASE_URL`** — the dispatch lazily `import()`s `@tangle-network/sandbox` (behind the live flag, so the offline path never needs the SDK) and creates a real harness box per cell.
2. **A real judge model** — the judge's `ChatClient` becomes `createChatClient({ transport: 'router', apiKey })`; set `JUDGE_MODEL` (and optionally `TANGLE_ROUTER_URL`) to point it at your router. `--ensemble` then calls three real cross-family models.
3. The matrix runs with `integrity: 'assert'`, so a cell that produced no real token usage fails loudly instead of reporting a clean stub leaderboard.
4. **The harness box image must provide the toolchain on `PATH`** — the checks invoke bare `tsc`, `biome`, and `node --experimental-transform-types`. The test layer **and the held-out grading** need **Node >= 22.6** (for `--experimental-transform-types` and `.ts`-import test execution); on an older Node a correct param-property solution would fail with no hint why. A missing **advisory** tool (`biome`) folds to 0.5 and doesn't gate; a missing **`tsc`** fails the dev checks — so sanity-check your box image before trusting a live leaderboard. (Offline, `tsc`/`biome` are absent so the dev checks fail fast, but `node` is present so the held-out grading still runs for real.)

Everything else — the dispatch, the verifier, the held-out execution, the stats — is identical between offline and live. That's the point: only the agent and the judge model change.

**Note on codex:** codex emits no structured tool calls, so per-tool progress is unavailable there. It still runs and scores; that's a harness property, not a gap in this example.
