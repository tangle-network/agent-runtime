# agent-bench: supported integration harness

`bench/` exists to prove that the published Runtime and Eval contracts can execute real benchmark adapters. It is not the research archive and it is not where successive experiment generations should accumulate.

## Repository ownership

| Repository | Owns |
|---|---|
| **agent-runtime** | exact execution, reusable benchmark adapters, packed-consumer checks, one full-fidelity integration fixture |
| **discovery** | research questions, preregistrations, acceptance criteria, negative results, and decisions about what is worth testing |
| **discovery-lab** | paid campaigns, upstream method reproductions, long-horizon hill climbs, immutable receipts, and result archives |

A benchmark implementation may begin here while it is becoming a reusable adapter. Once the question is “does method X improve benchmark Y?”, the campaign belongs in Discovery Lab.

## Evidence levels

Use these labels literally. Do not promote one level into another in prose.

| Level | What it establishes | Canonical path |
|---|---|---|
| **contract proof** | packages install; identities, budgets, callbacks, resume, and receipts have the expected shape | root `pnpm verify:official-optimizers`, `pnpm verify:primeintellect`, `pnpm verify:bench` |
| **evaluator proof** | the benchmark's own evaluator can distinguish known fail/pass artifacts in the exact environment | adapter preflight and gold/self-check |
| **reproduction proof** | an upstream method is run at a pinned revision on its claimed benchmark under a matched protocol | Discovery Lab reproduction manifest and runner |
| **value proof** | the integrated method beats the preregistered baseline on frozen evidence with uncertainty and complete cost accounting | Discovery Lab result receipt |
| **production proof** | a promoted artifact transfers to real traffic under a canary or controlled rollout | product repository / platform telemetry |

A localization score, output-shape check, LLM quality judge, or toy deterministic reward can be useful for development. None is a substitute for the benchmark's outcome evaluator.

## Supported commands

### Package and integration contracts

From the repository root:

```bash
pnpm verify:bench
pnpm verify:official-optimizers
pnpm verify:primeintellect
```

`verify:official-optimizers` exercises the official Optimize Anything bridge, engine identities, equal input budgets, resume compatibility, candidate callbacks, accounting, and package provenance. Its deterministic candidate improvement is deliberately a fixture. It does **not** reproduce the published GEPA or Omni benchmark numbers.

### Bounded benchmark matrix

From `bench/`:

```bash
pnpm run run-benchmarks
```

`src/run-benchmarks-cli.mts` runs a selected subset of registered adapters across explicit agent cells. Each adapter owns task loading, output extraction, preflight, and judging. A missing dependency or failed gold self-check makes the benchmark unavailable; it never becomes a zero score.

Use `LOOP_ATTEMPTS=N` only when the benchmark's own visible feedback is allowed to enter later attempts. Hidden or gold material must remain outside the agent context.

### Full-fidelity improvement fixture

```bash
cd bench
pnpm tsx src/swe-self-improve.mts
```

This is the canonical real-task Runtime fixture:

- SWE-bench Verified instances;
- repository state as the produced artifact;
- the official Docker judge outside the candidate agent;
- explicit train, selection, and frozen final-test partitions;
- Runtime's `improve()` boundary and complete cost receipts.

It proves the integrated execution path can support a real value campaign. A paid powered result still belongs in Discovery Lab.

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
- **Trace analysts** — evidence producers. Measure finding quality against labeled traces before using findings to steer search.
- **Prime Agent RLM and DSPy RLM** — alternative analyst/context engines, not optimization methods by themselves. Compare them on the same trace questions, evidence requirements, context budgets, and downstream decisions.

Do not put all of these into one undifferentiated “intelligence” arm. They intervene at different points in the causal chain.

## Admission rule for new bench code

A new file under `bench/src` must be one of:

- a reusable benchmark adapter;
- a shared execution/evaluator primitive used by more than one adapter;
- a package-consumer or evaluator calibration test;
- one canonical full-fidelity fixture that exercises a public Runtime contract.

A one-off campaign, generation-N optimizer script, bespoke dashboard, or historical result belongs in Discovery Lab. If an older file has no package script, no importer, and no unique reusable primitive, delete it rather than adding another index entry.
