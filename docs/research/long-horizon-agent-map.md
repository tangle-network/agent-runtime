# The long-horizon steered-agent product — map + decisions

> Direction capture (2026-06-15). The product: an **autonomous supervisor agent** that decomposes a goal, drives a dynamically growing/shrinking tree of AgentProfile-drivers + workers (each in a sandbox, each possibly a different profile) to completion, and learns which decisions worked across runs — so the human isn't the steerer. Companion to [architecture.md](../architecture.md), [harness-compat.md](./harness-compat.md). Sources: 3 research tracks (harness-compat, Foreman post-mortem, surface audit).

## The corrected mental model (read first)

- **There is no `/goal` primitive.** "Run until done" is emergent + runaway, not a feature (see harness-compat). The driver decides *autonomy level*, not "invoke goal."
- **WE are the run-until-done loop.** `Supervisor` + conserved budget pool + a **completion-oracle `Validator`** = bounded, safe, recursive "until done." This is the layer the raw harnesses lack and the layer Foreman botched. It is the moat.
- **The atom is built; never tested on a real project.** `src/runtime/supervise/` (Scope, Supervisor, conserved budget, journal/replay, TreeView) is real. Every use to date = unit tests, isolated-task fanout, mocks. Recursion (driver spawns driver) is structurally present and **fenced off** in the one path that runs (dead-code throws).

## Decisions (locked unless revised)

1. **Completion oracle is mandatory.** A spawn isn't *settled* until an independent `Validator<Output,Verdict>` confirms the declared deliverable exists. Foreman scored "ran" (91.5%) not "delivered" (~56%; **0/18** on self-improvement) — that single gap was its whole failure. Define "done well" (checkable deliverable + on-intent + human-steers-avoided) **before** building any harness.
2. **One driver atom: the Supervisor.** Driver = an **AgentProfile** (sandbox- or router-specified) over `Scope`. "1-level driver↔workers" = the same atom with sub-driver spawning off (a depth knob, not a second API). `runLoop` is **demoted** to the synchronous leaf-exec kernel under the one `Executor` port — not a co-equal driver surface. (This sharpens the surface audit's "keep both co-equal" toward the canonical direction CLAUDE.md already states: prefer Supervisor for recursive/keystone work.)
3. **Driver autonomy is a per-harness steering decision** informed by harness-compat: bounded single-exec (safe, cli-bridge default) vs full-auto behind an external budget wall (codex/claude unbounded; opencode `steps`-bounded); never raise codex `max_depth` casually; clean tool-isolation only on claude.
4. **Surface cleanup (low-risk):** rename `createDriver`→`createLoopPlanner`, `depthDriver`/`breadthDriver`→`*Agent` (the "driver" name means two things today); **delete the dead unreachable fences** (strategy.ts:494, persona.ts:102 — the Supervisor never calls `act()` on a spawned agent). Keep `runPersonified`/`runAgentic` as conveniences.

## Foreman carry-forward (carry 3, drop the rest)

**Carry onto the Supervisor:** (a) **completion oracle** — declared deliverable + independent check = "settled requires delivered" → `Validator`; (b) **structured `mode→skill` action space** (advance/recover/verify/redesign/stop → skill) as the driver's steering vocabulary; (c) **mine the operator's real sessions** as the learning signal, relevance-scored through the analyst firewall.
**Free wins our atom already gives:** SpawnJournal/TreeView kills "N parallel sessions all do the same trivial refactor" (siblings read the live tree); conserved pool = cost caps by construction; scope enforcement belongs at the **executor boundary** (read-only mounts), not a prompt the agent routes around.
**Drop:** tmux/OAuth screen-scraping (ate ⅓ its budget), GEPA prompt-policy (null here repeatedly), the cross-project store (never showed transfer), the 20 endpoints. Foreman's honest meta-finding: its real competence was autonomous **analysis**, not autonomous coding → lean into observe/analyze as a first-class role (`createScopeAnalyst`).

## The product map (engine → proof)

```
goal/intent
  └─ Supervisor.run(rootDriver=AgentProfile, goal, {budget})   ← engine: BUILT
       ├─ driver decides: decompose · spawn child-driver · spawn worker · steer · stop   ← mode→skill
       │     worker = harness in a sandbox, bounded exec (autonomy = steering decision)  ← harness-compat
       ├─ every spawn carries a DeliverableSpec; settled ⟺ Validator confirms delivered  ← completion oracle (MISSING)
       ├─ SpawnJournal + TreeView = sibling coordination, replay, the steering trace      ← BUILT
       └─ across runs: which decompositions/decisions delivered → policy improves          ← the real RSI (Intelligence plane)
autonomy ladder: human-steered (works today, daily = rung-1 evidence) → agent-steered w/ checkpoints → autonomous supervisor
```

## Open — needs the lead
- **The first real target + its completion oracle.** A repo feature with a test suite (checkable "done") and/or a research topic with a gradeable deliverable. This is the blocker on the first long-horizon steering-data run.
- Where the product home is (agent-runtime as engine + a thin harness here, vs a product repo consuming it).
