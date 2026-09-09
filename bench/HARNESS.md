# agent-bench: supported integration harness

`bench/` exists to prove that the published Runtime and Eval contracts can execute real benchmark adapters. It is not the research archive and it is not where successive experiment generations should accumulate.

## Repository ownership

| Repository | Owns |
|---|---|
| **agent-runtime** | exact execution, reusable benchmark adapters, packed-consumer checks, one full-fidelity integration fixture |
| **discovery** | research questions, preregistrations, acceptance criteria, negative results, and decisions about what is worth testing |
| **supervisor-lab** | registered adaptive-agent and retained-learning comparisons, including carried versus revised profiles |
| **discovery-lab** | research campaigns and evidence for Discovery, including immutable inputs, run records, and result archives |

A benchmark implementation may begin here while it is becoming a reusable adapter. Once the question is “does method X improve benchmark Y?”, the campaign belongs in the consuming lab.
Supervisor Lab owns adaptive-learning comparisons; Discovery Lab owns research campaigns for Discovery.

## Evidence levels

Use these labels literally. Do not promote one level into another in prose.

| Level | What it establishes | Canonical path |
|---|---|---|
| **contract proof** | packages install; identities, budgets, callbacks, resume, and receipts have the expected shape | root `pnpm verify:official-optimizers`, `pnpm verify:bench` |
| **evaluator proof** | the benchmark's own evaluator can distinguish known fail/pass artifacts in the exact environment | adapter preflight and gold/self-check |
| **reproduction proof** | an upstream method is run at a pinned revision on its claimed benchmark under a matched protocol | Consuming lab reproduction manifest and runner |
| **value proof** | the integrated method beats the preregistered baseline on frozen evidence with uncertainty and complete cost accounting | Consuming lab result receipt |
| **production proof** | a promoted artifact transfers to real traffic under a canary or controlled rollout | product repository / platform telemetry |

A localization score, output-shape check, LLM quality judge, or toy deterministic reward can be useful for development. None is a substitute for the benchmark's outcome evaluator.

## Supported commands

### Package and integration contracts

From the repository root:

```bash
pnpm verify:bench
pnpm verify:official-optimizers
```

Set `AGENT_BENCH_PACKAGE_TEST_CONCURRENCY=1` to run Node source test files sequentially on memory-constrained hosts.
The value must be a positive safe integer; leaving it unset preserves Node's default concurrency.
Vitest uses the worker limit in `bench/vitest.config.ts`.

Packing resolves the Runtime dependency from `workspace:^` to a version range.
A new Runtime compatibility line does not update previously published Bench packages.
Check the packed dependency range and release Bench when consumers must receive that Runtime version.

`verify:official-optimizers` exercises the official Optimize Anything bridge, engine identities, equal input budgets, resume compatibility, candidate callbacks, accounting, and package provenance. Its deterministic candidate improvement is deliberately a fixture. It does **not** reproduce the published GEPA or Omni benchmark numbers.

### Bounded benchmark matrix

From `bench/`:

```bash
pnpm run run-benchmarks
```

`src/run-benchmarks-cli.mts` runs a selected subset of registered adapters across explicit agent cells. Each adapter owns task loading, output extraction, preflight, and judging. A missing dependency or failed gold self-check makes the benchmark unavailable; it never becomes a zero score.

Use `LOOP_ATTEMPTS=N` only when the benchmark's own visible feedback is allowed to enter later attempts. Hidden or gold material must remain outside the agent context.

`runBenchmarks()` returns each judged artifact, worker events, and observed usage in `perTask`.
Retry usage includes every attempt; missing receipts leave the measured subtotal explicitly incomplete.
Judge failures retain completed worker evidence.
Each task separates `execution` from `measurement` availability.
Captured empty output and explicit failed turns remain measured failures when the evaluator runs successfully.
Read, extraction, and judge failures leave measurement unavailable while retaining observed usage.
Missing dispatch evidence remains unknown; `ok: false` never establishes permission to retry.
Errors propagated by `close()` remain in `detail` beside the settled task outcome.
The current Runtime lineage suppresses sandbox deletion errors, so a returned result does not confirm resource deletion.
The caller's abort signal stops queued shots and reaches active sandbox turns.
`modelApiKey` supplies sandbox inference authorization separately from the `routerKey` used for sandbox control.

### Caller-controlled prompts within a task

`runBenchmarks({ execute })` invokes the callback inside each managed sandbox shot.
The context supplies the task prompt, executed profile, benchmark and task identities, attempt number, and abort signal.
Its managed `run` exposes Runtime's `start`, `resume`, `box`, and `sessionId`.
Use the live box for permitted working checks in the same session.
Submit worker prompts through managed `start` and `resume` so Bench captures their outcomes and usage.
Direct sandbox prompt calls bypass this accounting.
The callback must leave session lifecycle, extraction, and cleanup to Bench.
It receives no adapter, final grader, or task metadata containing gold material.
This callback is trusted consumer code, not an isolation boundary for arbitrary code.

Return after the final prompt completes.
Bench extracts the last captured prompt's artifact and applies the adapter's final grading outside the callback.
Start and resume calls must be sequential.
Bench waits for an unawaited active invocation before extraction and refuses calls after the callback settles.
The callback must use its signal to cancel external work.
Bench stops awaiting policy work when cancelled, but cannot stop external effects that ignore cancellation.

Each task's `prompts` retains ordered method, prompt, attempt, session identity, outcome, events, usage, and capture errors.
Prompt indices start at zero; attempt numbers start at one.
Usage sums each prompt separately, including failed and interrupted prompts.
A partial capture retains observed counters and marks accounting incomplete.
These counters cover sandbox workers only; consumers must account for policy and working-evaluator inference separately.
Consumers must bind their callback source, configuration, profiles, and initial state to their execution identity.

`execute` runs inside every `loopAttempts` shot.
Those outer attempts still create fresh sandboxes and use the existing checker feedback policy.
Use one outer attempt when final grading must remain unavailable to adaptation.
A custom `runShot` receives `execute` and owns whether it consumes the callback.

A sandbox prompt can contain multiple native model requests.
Same-session continuation does not prove a barrier before every native request, profile reload, coordinator restart, or fresh-session state transfer.
Offline fake-sandbox tests prove the managed contract and correction consumption only.
They establish no live learning gain or provider session restoration.

### Retained strategy driver

```bash
cd bench
pnpm tsx src/swe-self-improve.mts
```

This driver uses `runStrategyEvolution` with SWE-bench tasks and a frozen holdout.
It does not exercise `improve`, and it deletes its temporary run directory on exit.
It therefore cannot provide retained improvement or lineage evidence.
Use `examples/improve` for the maintained offline API fixture.
Use the consuming labs for registered learning campaigns with retained execution and comparison evidence.

### Offline diagnostics

```bash
cd bench
pnpm gate
pnpm gate-report
```

`corpus-replay.mts` and `corpus-report.mts` are retained for offline analysis of already-recorded attempts. They do not create new evidence and must not be presented as a live reproduction unless the source corpus itself has a pinned, independently verified receipt.

## Upstream-method reproduction requirements

A reproduction record is incomplete unless it binds all of the following:

1. upstream repository, package, and exact revision;
2. the upstream claim and benchmark protocol being reproduced;
3. adapter and evaluator identity;
4. dataset revision and split commitments;
5. baseline and treatment definitions;
6. models, harnesses, temperatures, seeds, and complete budgets;
7. optimization, candidate-execution, judge, and final-test costs separately;
8. raw outputs, evaluator reports, and terminal failure classes;
9. a parity criterion declared before the run;
10. an immutable receipt linking every artifact above.

Exact score equality is usually the wrong parity criterion for stochastic systems. Prefer a preregistered band, direction-of-effect, rank ordering, or confidence interval that is strong enough to detect an integration error.

## Method map

- **GEPA** — optimizer over explicit candidate surfaces and evaluation feedback.
- **AutoResearch / Prime Agent** — agentic search over an editable research surface. Treat the agent, tools, and external evaluator as separate identities.
- **Meta-Harness** — search over harness or orchestration behavior; preserve the same outcome evaluator.
- **Omni** — phase-one portfolio search followed by a fresh phase-two optimizer seeded from the best phase-one artifact. The matched phase-one budgets and the phase boundary are part of the protocol.
  Bench enables Eval’s metered Anthropic endpoint for the CLI engines and binds their model to the selected optimizer model.
  Each admitted optimizer request executes with its requested output limit; Eval enforces the configured ceiling.
- **Trace analysts** — evidence producers. Measure finding quality against labeled traces before using findings to steer search.
- **Prime Agent RLM and DSPy RLM** — alternative analyst/context engines, not optimization methods by themselves. Compare them on the same trace questions, evidence requirements, context budgets, and downstream decisions.

Do not put all of these into one undifferentiated “intelligence” arm. They intervene at different points in the causal chain.

## Admission rule for new bench code

A new file under `bench/src` must be one of:

- a reusable benchmark adapter;
- a shared execution/evaluator primitive used by more than one adapter;
- a package-consumer or evaluator calibration test;
- one canonical full-fidelity fixture that exercises a public Runtime contract.

A one-off campaign, generation-N optimizer script, bespoke dashboard, or historical result belongs in the consuming lab. If an older file has no package script, no importer, and no unique reusable primitive, delete it rather than adding another index entry.
