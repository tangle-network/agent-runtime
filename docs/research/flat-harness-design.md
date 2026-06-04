> **Track:** Architecture (research) · **Role:** design synthesis · **Status:** subsumed — this is Plane A, recovered as the simplest `act` body on [recursive-execution-atom.md](./recursive-execution-atom.md)

# Flat experiment harness (Plane A)

Synthesis of the `wuh46e5zp` design pass (3 independent proposals → adversarial synthesis):
the durable, assumption-free **experiment harness** for comparing steer policies at equal
compute. All three proposals converged tightly and identically on the same surface.

This is **not** a competing v1. It is the flat plane — and the recursive atom *contains* it:
the harness below is the simplest possible `act` (spawn one child per profile, fixed budget,
select the best). Captured here because its mechanism/content split, its rip-out list, and its
`executionMode` primitive are directly reused by Plane B.

## The converged surface

```ts
const result = await runRsiExperiment({
  benchmark: adapter,                                  // researcher's task + deterministic judge
  profiles: AgentProfile[],                            // the arms — FULL profiles, not keyword strings
  steerPolicies: ((root, history, round) => prompt)[], // pure fns; read trace/events, never the verdict
  executionMode: { kind: 'fresh-box' | 'continued-session' | 'fork', maxTurns },
  allocation: { kind: 'round-robin' | 'adaptive-thompson' | 'variance-based', k },
  sandboxClient, n, concurrency, corpusPath,
})
```

- **Arms are full `AgentProfile`s** (model, tools, MCP, persona, capabilities) composed with
  `mergeAgentProfiles` — never keyword strings like `critical-audit`.
- **Steer is a pure function** `(rootPrompt, history, round) => nextPrompt`, fully visible to the
  researcher. No hidden directives.
- **The researcher's experiment is ~50 lines**; the framework is <500 LOC.

## Framework owns (mechanism) vs researcher supplies (content)

| Framework (once) | Researcher (per experiment) |
|---|---|
| `ExecutionMode` mechanics (box lifecycle per mode) | full `AgentProfile`s (the arms) |
| loop kernel (`runLoop`, `createDynamicDriver`) | steer policies (pure fns; their hypotheses) |
| measurement (`BenchmarkAdapter`, `OutputAdapter`, `Validator`) | the task adapter + deterministic judge |
| allocation scheduling (`thompson`/`variance` from agent-eval) | execution-mode + allocation choice (explicit) |
| corpus (`RunRecord`, paired bootstrap + BH) | optional `OutputAdapter`/`Validator` overrides |
| **steer firewall** (selector ≠ judge, type-level) | — |
| **compute-control enforcement** (control arm required to compile) | — |

## `executionMode` — the one new runtime primitive

A required field on the kernel; default `fresh-box` (today's behavior). This is the
"continued-session execution dial," and it plugs into the existing `collectBox` seam in
`src/loops/run-loop.ts`.

- **`fresh-box`** — new sandbox per iteration; stateless; the **compute control** (bandit-like; k independent samples).
- **`continued-session`** — one sandbox reused across turns; filesystem/shell state persists; steering compounds (MDP-like). The kernel creates the box once and reuses it; the driver rewrites the prompt per turn via the steer policy.
- **`fork`** — checkpoint + branch (what-if / counterfactual); deferred (needs sandbox checkpoint/restore).

Allocation composes orthogonally: `round-robin` (fair, the baseline), `adaptive-thompson`,
`variance-based`. The corpus `condition` field logs mode + allocation so offline analysis can
reject mismatched comparisons (a policy is only comparable within the same `executionMode`).

## Rip out (hardcoded content → researcher config)

- `bench/src/directives.ts` — **delete** all `DEFAULT_*` directive constants + `DIVERSE_STRATEGY_LENSES`. Keep only `composeStrategies()` as a helper. Directives are researcher hypotheses, not framework policy.
- `bench/src/run.ts` — **delete** the `batch-blind` / `batch-oracle` / `batch-compare` presets and the env-driven dispatch (`BACKEND`, `WORKER_MODEL`, `ANALYST`). One entry point loads a researcher config.
- `bench/src/experiment.ts` — **move** `randomArm`/`refineArm`/`diverseArm`/`llmAnalyst`/`loopAnalyst`/`analystArm` to examples; they are templates, not framework.
- `WorkerBackendType` enum — **delete**. Backend is part of the `AgentProfile` (the cost dial is a backend type, not a separate knob).
- `ADAPTERS[key]` lookup — **delete**. The config imports the adapter directly.

## Baked assumptions explicitly rejected

Arms-are-keywords; directives-are-framework-policy; one-box-per-iteration-is-the-only-model;
diverse-lenses-are-fixed; allocation-is-always-fixed-k; the-task-is-always-a-string;
backend-is-a-separate-knob; the-firewall-is-a-soft-rule (→ make `PlannerContext` carry only
`output`+`events`, never `verdict`, at the type level); control-is-optional (→ `runSteeringExperiment`
requires a control arm; omitting it is a compile error).

## Durability argument (why it survives 2 years)

Content/mechanism split isolates the framework from trend-chasing (new domains need adapters,
not rewrites); substrate-maximal leverage (`AgentProfile` from the sandbox SDK, `runLoop` from
runtime) tracks upstream not internal drift; profiles-as-versioning (a config file in git
reproduces a run 18 months later); `RunRecord` decouples sweeps from analysis (replay the
corpus under new hypotheses without re-running); `executionMode` as an axis (if
continued-session is a dead end, no framework bloat); only two contracts (`BenchmarkAdapter`,
`AgentProfile`); no hardcoded strings.

## Migration phases (from the synthesis)

Dependency-ordered, each small and verifiable: (1) add `ExecutionMode` to `agent-runtime`
types, default `fresh-box`, behavior unchanged; (2) implement `continued-session` on the
`collectBox` seam; (3) extract `SteerPolicy`, move arm factories to examples; (4) rip out
directives; (5) flow `executionMode` into the corpus; (6) `RsiExperimentConfig` +
`runRsiExperiment`; (7) allocation strategies as plugins; (8) firewall type-enforcement;
(9) delete `batch-*`; (10) docs + examples + migration guide.

## Top risks flagged

Session leaks if `executionMode` unset (→ default `fresh-box`, required field); continued-session
state explosion (→ SDK memory cap + cleanup flag); adaptive allocation overfits at low n (→ loud
docs, fixed-k for n<20); "arm beats control" ≠ "steering beats compute" without paired CI (→
control required by the type signature; corpus-report pairs the delta).
