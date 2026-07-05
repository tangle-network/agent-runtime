# Benchmark coding agents fairly — with an anti-cheat they can't beat

Run the same coding task across several AI coding agents (Claude Code, opencode, Codex, a bare CLI
agent) and get an honest leaderboard: who solved it, how well, and whether the difference is real or
just noise. The centerpiece is the anti-cheat — **held-out tests**. The agent develops against a few
visible example tests, exactly like real test-driven development, but it's **graded on a hidden test
suite it never sees and cannot hardcode**. A solution that pattern-matched the visible cases still
fails the grade. Correctness is proven by *running the hidden tests*, not by asking a model whether
the code looks right.

```bash
# Offline — no keys, no network. Runs the whole pipeline in-process with a mock judge.
# The held-out tests execute for real (node --test).
pnpm tsx examples/coding-benchmark/benchmark.ts

# Add a web-tool surface, or a 3-model judge panel and more repetitions:
pnpm tsx examples/coding-benchmark/benchmark.ts --tools web
pnpm tsx examples/coding-benchmark/benchmark.ts --ensemble --reps 5

# Live — real agent boxes + a real judge model (see "Going live"):
TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... \
  pnpm tsx examples/coding-benchmark/benchmark.ts --live
```

## What it measures

One coding task, run across a matrix of three axes, scored, and compared with real statistics:

| axis | what varies |
|---|---|
| **harness** | claude-code / opencode / codex / cli, each on its bare default profile (no added skills or prompts — we measure the *agent*, not our scaffolding) |
| **scenario** | three tasks: a token-bucket rate limiter, an RFC-4180 CSV parser, and an LRU cache whose only passing path is the real eviction algorithm. Each ships a few visible example tests and a hidden grading suite |
| **tool surface** | `none` / `web` / `search-mcp` — flip web tools or a search plugin on with `--tools`, one flag, no forked code |

Each agent gets up to **3 refine rounds** in one persistent workspace: round N+1's prompt is built
only from round N's *visible-test* failures (nothing hidden leaks in — that's the anti-cheat below).
It stops the moment the visible checks pass.

The output is a leaderboard with confidence bands and a pairwise-significance matrix:

```
Harness leaderboard (mean composite, 95% CI; pass-rate, Wilson CI):
  claude-code-baseline   composite 0.944 [0.944, 0.944]  pass 100% [44%, 100%]  (n=3)
  ...
Pairwise (paired delta + bootstrap CI; paired-test p, BH-corrected):
  opencode-baseline − claude-code-baseline: Δ=0.000 [0.000, 0.000] p=1.000 n.s. (underpowered)

  NOTE: n=3 scenarios — below the power floor (6). Significance is suppressed at this size.
  Use 20-50 tasks for a real harness comparison.
```

> **Offline everything ties.** With no model, every harness writes the same scripted solution and is
> scored by the same deterministic mock judge, so all differences are exactly `0.000` — the honest
> no-variance result, not a bug. Real separation between harnesses is a *live-only* property;
> `--live` swaps in real agents and a real judge and they pull apart.

## The anti-cheat: held-out test execution

**An agent cannot game tests it never saw.** That's the whole thing, and it's execution truth, not a
text scan:

- Each scenario has two test files. The **visible** test (a few example cases) is placed in the
  workspace during the turn — the agent codes against it. The **held-out** test (same behavior, but
  *different inputs and extra edge cases*) is **never placed in the workspace while the agent works**.
- At grading time, after the refine loop, the hidden suite is copied into the workspace and run
  (`node --test`). Its **pass rate is the primary, ungameable correctness score.**
- A solution that hardcoded the visible examples' exact values passes the visible test but **fails
  the held-out inputs** (e.g. the rate-limiter's hidden tests use capacities `7/6/5/2`, not the
  visible `10/3/10`). A solution that faked the hard part fails them too. Only real behavior passes
  both.

To make this bulletproof, the code *checks that no hidden content leaked* into the agent's workspace
each round, and throws loudly if it ever did — so the firewall can't silently break. A regression
test asserts it throws when leakage is introduced on purpose.

## How it scores — correctness first, taste second

Scoring runs cheapest-and-most-objective first:

1. **Dev checks (in the workspace, ~$0).** `typecheck → run visible tests → lint`, in order (tests
   don't run if types fail). These pass/fail signals are the *only* thing that steers the next refine
   round — but passing the *visible* examples does **not** prove correctness.
2. **Held-out test execution (the primary score).** After the loop, the hidden suite is run in the
   same workspace. The hidden pass rate is the correctness number, and it's ungameable — the agent
   never saw these inputs.
3. **LLM judge (secondary, a quality tie-breaker).** A model scores the code on a weighted rubric
   (correctness 0.40, completeness 0.25, code quality 0.20, robustness 0.15). The rubric never enters
   the workspace. The judge grades *style*; it does not decide correctness.

The leaderboard ranks on a **composite = 0.7 × held-out-pass-rate + 0.3 × judge-quality** — hidden
correctness is load-bearing, the judge only breaks ties on style. On the rate-limiter task, a
hardcode-the-visible cheat scores 2/4 held-out → composite **0.59**; the real token-bucket scores 4/4
→ composite **0.94** (judge held equal). The cheat is visibly penalized.

**Judges:** `--ensemble` swaps the single judge for a **3-model panel from different model families**
(rejected at construction if they're the same family, so the panel is genuinely independent live).
Use it only for a ship/no-ship decision. Offline all three share the one mock judge, so the ensemble
is degenerate — a live-only property.

## The statistics are real, not decorative

Every number comes from a shared statistics engine — no hand-rolled math, no fake p-values:

- per-harness **mean composite with a bootstrap confidence interval**
- per-harness **pass-rate with a Wilson interval** (the correct interval for a proportion)
- every harness **pair** compared on **matched scenarios** with a real **paired test** for the
  p-value and a **paired bootstrap** for the effect size, then **corrected for multiple comparisons**
  so running many pairs can't manufacture a false winner
- **repetitions don't fake sample size** — reps collapse to one mean per (harness, scenario); the
  reported `n` is the number of distinct scenarios, not reps × scenarios
- a record missing its scenario id **throws** rather than silently corrupting the pairing

> **Power caveat.** The example ships **3 tasks** — below the statistical power floor of 6, so the
> `SIGNIFICANT` label is suppressed entirely. This example demonstrates the *wiring*; a real harness
> comparison wants **20–50 tasks**.

## The offline agent is a scripted stand-in

Offline there's no model, so each scenario's workspace writes a **canned solution** instead of
calling a real agent. They're honest: `rate-limiter` is a deliberate cheat/real pair — round 0
hardcodes the visible answers (no bucket math), round 1+ writes the real algorithm — so the smoke
test can assert the cheat *passes visible but fails held-out* while the real impl passes both.
`csv-parser` and `lru-cache` have no plausible fake, so they write the real impl from round 0. Live,
`--live` swaps the scripted client for a real agent box.

## Going live

`--live` swaps two stubs for real infrastructure. You need:

1. **`TANGLE_API_KEY` + `SANDBOX_BASE_URL`** — spins up a real agent box per matrix cell.
2. **A real judge model** — set `JUDGE_MODEL` (and optionally `TANGLE_ROUTER_URL`); `--ensemble` then
   calls three real cross-family models.
3. **Node ≥ 22.6 and a toolchain on the box's PATH** — the checks call bare `tsc`, `biome`, and
   `node --experimental-transform-types`. A missing advisory tool (`biome`) folds to 0.5; a missing
   `tsc` fails the dev checks. Sanity-check your box image before trusting a live leaderboard.

The live run also fails loudly if any cell produced no real token usage, so a broken stub can't
masquerade as a clean leaderboard. Everything else — the refine loop, the firewall, the held-out
execution, the stats — is identical offline and live. Only the agent and the judge model change.

> **Codex note:** Codex emits no structured tool-call events, so per-tool progress isn't available
> there. It still runs and scores — that's a harness property, not a gap in this example.

## Files

| file | what it owns |
|---|---|
| `benchmark.ts` | the entrypoint: builds the axes, runs the matrix, prints the leaderboard + significance |
| `scenarios.ts` | the 3-task corpus, the visible tests, the hidden grading suites, and the check commands |
| `profiles.ts` | the harness axis (one bare profile per agent) and the one-flag tool knob |
| `dispatch.ts` | runs one matrix cell: persistent workspace + refine loop + held-out grading + the firewall |
| `eval.ts` | the scoring stack: dev checks → held-out execution → LLM judge → composite |
| `offline-box.ts` | an in-process workspace so the whole thing runs with no credentials |
| `fixtures.ts` | the real offline solutions for csv-parser / lru-cache |
| `coding-benchmark.test.ts` | offline smoke test: matrix shape, the cheat fails held-out, no hidden leak, reps don't shrink the CI |
