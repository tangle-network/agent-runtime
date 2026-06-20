# RSI self-designing agent atom — masterplan + build tracker

> **Single source of truth** for the architecture decided across the 2026-06-15 design session and the systematic checklist to a clean, deduplicated, properly-layered 11/10. Subsumes and links the supporting docs. Status legend: ✅ done · 🔨 building · ⬜ todo · ⏸ deferred (gated). Every item names its file + the gate that proves it.

## 0. The one-sentence architecture

A **supervisor that is itself an agent** authors and spawns child agents — each a unified **AgentProfile** (router or sandbox) — that are either **workers** (leaves) or **sub-driver-agents** that recursively spawn their own children; every driver is an agent that writes **rich, harness-aware, high-signal instructions** to drive its children to use their harness's full power (parallelize / workflows / `/goal` / sub-agents); each spawn is **settled only when a completion-oracle confirms the deliverable**; all on a **conserved budget**. Agents driving agents driving agents — driven *more intelligently than a human drives Claude*.

## 0.5 Why the control plane is NOT "wrapped around" a sandbox agent — it's ONE dual-purpose substrate

A bare sandbox agent already spawns/drives child boxes, recurses, parallelizes. The control plane (`Scope`/conserved-budget/journal/coordination-verbs/completion-oracle) is justified **only because every piece serves BOTH the product runtime AND the rigorous proof — there is no separate research apparatus** (the separable one, `experiment.ts`, was the bullshit; deleted `2101f2d`, −3,492 LOC). The proof *rides* the product:

| Substrate piece | Product use | Proof use |
|---|---|---|
| Conserved budget pool | tree-wide anti-runaway cost ceiling (full-auto fleets run away) | **equal-compute by construction** — the only honest "smart vs blind at the same k" |
| Journal | replay/resume a crashed long run | provenance — trust + re-run a result |
| Completion-oracle | "done" = a check passed (Foreman 0/18) | the honest settle (no self-judged wins) |
| Coordination verbs + recursion | agents spawn/drive child agents | the controlled, observable tree to measure |

**The driver** is an AgentProfile, two flavors: **(capable, primary)** a sandbox agent with the coordination verbs mounted **as an MCP** — its native loop drives our recursion; **(cheap/offline)** `coordinationDriverAgent` — an in-process router-tools loop (no box/creds), the offline-test + cheap path. Product = run the atom; proof = run it at equal budget + compare. **Same harness, no duplication.**

## 1. Layering (obeys "no running loop → substrate", agent-runtime ⟶ agent-eval, never reverse)

| Layer | Owns | Key primitives |
|---|---|---|
| **@tangle-network/sandbox (SDK)** | execution manifest + harness | `AgentProfile` (model/tools/mcp/subagents/…), `BackendType`, `mergeAgentProfiles`, `defineAgentProfile` |
| **@tangle-network/agent-eval (substrate)** | **the DRIVER** (meta-agent intelligence) + the genome | `AgentDriver`, `decideNextUserTurn`, `DualAgentBench`, `buildDriverSystemPrompt`, the steering optimizers (`AxGepaSteeringOptimizer`/`PairwiseSteeringOptimizer`); the genome `AgentProfile` (role/skills/domain) |
| **@tangle-network/agent-runtime (this repo)** | **the RECURSION** | `Scope`/`Supervisor` (conserved budget, journal, maxDepth), `createCoordinationTools` (spawn/steer/await/ask/analyze/stop), the recursive driver-executor (wraps the agent-eval driver per node) |

**The driver primitive is general — RSI driver = simulated user = adversarial pentester are the SAME thing** (`AgentDriver`/`decideNextUserTurn`). Reuse it; do NOT rebuild a driver in agent-runtime.

## 2. AgentProfile — one genome that deploys

agent-eval's `AgentProfile` (today: prompt-genome `{role,environment,toolConventions,skills,domain}`) and the SDK's `AgentProfile` (execution manifest `{model,tools,mcp,subagents,…}`) are **disjoint, colliding on a name**. Decision: make **agent-eval's a structural superset** = genome ∪ execution, with `toSandboxProfile(p) → SDK.AgentProfile` (render genome → `prompt`, execution fields pass through). **Harness stays the thin `AgentSpec` field** (portable; the eval "which-harness-is-best" axis needs it). One genome the supervisor authors via `mergeAgentProfiles` + `composeCertifiedProfile`.

## 3. Build checklist (ordered; each step shippable + gate-verified)

| # | Item | Where | Status | Gate |
|---|---|---|---|---|
| 1 | **Driver-prompt GENERATOR (software 3.0)** — collapse the N hand-coded prompt builders into ONE `generateDriverSystemPrompt(spec)`: a (fused) router call that *generates* the driver system prompt from `{role, goal, target, harness+caps, stance}`. New roles = a spec, zero new code. The hand-authored `buildWorkerDriverSystemPrompt` (✅ `ec8c991`, agent-eval) is now the generator's **seed methodology**; its 5 contract tests become the **invariants** the generated prompt must satisfy (gate against drift). The generator's **meta-prompt is the single optimizable surface** the steering optimizer learns. **Cache every generated prompt for semantic fast reuse** — key = `hashContent(canonicalize(spec))` (role+harness+goal-class+stance, NOT the exact goal text, so similar contexts share), stored via the existing `PromptRegistry` + a file/JSON backing (the `fileVerdictCache` pattern) or a DB: generate-once → content-hash lookup forever; cached prompts are versioned, inspectable `PromptHandle` artifacts (determinism + testability back). Depends on the tangle-router **"fusion"** primitive (compose N completions → 1) — a separate router issue. | agent-eval `src/driver.ts` (generator) + `PromptRegistry` (cache) + tangle-router (fusion) | 🔨 (seed done; generator + cache + fusion next) | invariant tests pass on the GENERATED+CACHED prompt; one generator subsumes all roles |
| 2a | **Recursive driver-executor (the MECHANISM)** — `driverExecutorFactory` mounts a nested `Scope` over the SAME conserved pool + journal (`scope.ts` `NestedScopeSeam`) one depth deeper; a `role:'driver'` child resolves recursively (`withDriverExecutor`), a worker → leaf. The 2 fences now route a driver child to it (compose), not throw. Reuses the atom — no new budget/journal/selection. | agent-runtime `supervise/driver-executor.ts` | ✅ `9d188e1` | depth-2 PROVEN **offline** (`rec:s0:s0:s0` node chain, fail-closed budget conservation across depth, spend roll-up = worker's exact spend, nested-journal trees, maxDepth); 911 tests |
| 2b | **Cheap/offline driver** — `coordinationDriverAgent`: an in-process LLM tool-loop over `createCoordinationTools` (injected chat seam, injected prompt). The offline-testable + cheap-orchestration variant; NOT the primary. | agent-runtime `supervise/coordination-driver.ts` | ✅ `7e14003` | offline PROVEN (mock chat → real spawns, fed back; a driver-agent spawns a driver-agent) |
| 2c | **Capable driver (primary)** — a SANDBOX agent with the coordination verbs mounted **as an MCP**; its native harness loop drives the recursion over our `Scope`. The box→Scope bridge. | agent-runtime `mcp/` + sandbox | ⬜ | a sandbox driver spawns/steers a child agent through the MCP (needs creds) |
| 3 | **Completion-oracle settle** (the dual-purpose non-negotiable — product quality + proof honesty) — `settled ⟺ a deployable check confirms delivered`, never self-report (Foreman's 0/18). `gateOnDeliverable` (leaf) + `finalize` returns the best DELIVERED child (no self-declared done via prose) + driver-child verdict derived from direct settlements (delivery composes UP the recursion) + supervisor: a winner must carry a real `Out`. | `supervise/completion-gate.ts` + driver-executor + coordination-driver + supervisor | ✅ `bd58761` | 8 offline tests: gate (both execute shapes, fail-closed), ran-but-didn't-deliver → no winner, gate dominates score, delivery propagates up the recursion |
| 4 | **AgentProfile superset** (§2) | agent-eval (substrate) | ⏸ (after 1–3 prove the path) | `toSandboxProfile` round-trips; fleet builds |
| 5 | ~~Retire `createDriver`~~ — **DONE via full nuke** (`2101f2d`, −3,492 LOC): deleted `createDriver` + the whole old string-prompt/`experiment.ts` paradigm outright (not migrated). | — | ✅ `2101f2d` | gates green; zero refs |
| 6 | **Collapse `runAgentic` ≡ `runPersonified`** — real merge (different executors/results), not a thin dedup. | agent-runtime | ⏸ | callers green |
| 7 | **Prove on commit0** — recursive supervisor over a commit0 task; completion-oracle = the deterministic `commit0_judge.py` (no LLM, no creds to score; worker needs router creds). | agent-runtime `bench/` | ⬜ | offline fixtures smoke, then a real run |

## 4. The quality bar (non-negotiable)

The driver must **never** send one-word/two-sentence steers. It writes amazing, in-depth, high-signal-to-noise prompts that drive the worker to use its harness's full capabilities — the way a power user drives Claude, but better. This intelligence lives in #1's prompt and is *learned further* by the steering optimizers. The old `depthStrategy` steer ("A reviewer flagged unfinished items: {findings}") is the anti-pattern being replaced.

## 5. Done this session (✅) + cleanup tracking

- ✅ **Dead-code clean: 432 LOC** — mock loop + orphan re-exports/interface (`bdae618`). Gates hand-verified. See [deletion-ledger](./deletion-ledger.md).
- ✅ **Safe dep bumps** (@types/node, playwright) (`743525f`). ⏸ biome 2.5 (13 new lint warnings → own fix-pass), TS 6 + vitest 4 (majors), agent-eval 0.92 (bump *with* #4).
- ✅ **Design docs** (`472904a`): [atom-compression-plan](./atom-compression-plan.md), [harness-compat](./harness-compat.md), [long-horizon-agent-map](./long-horizon-agent-map.md).
- **Correction banked:** the 2 "dead fences" are **load-bearing fail-loud guards**, NOT dead code — they are the recursion *cap*, replaced by #2 (not deleted blindly).
- **"Old nonsense" is gated, not skipped:** `createDriver` / the fences / the dedup are load-bearing for the *current* (wrong) shape; they retire as #2/#5/#6 land — tracked above, not lost.

## 6. ACTIVE PUSH (this session) — RUN · DELETE · IMPROVE, minimize BUILD

Bias (standing rule): **run what exists, delete the cruft slowing us + the agents down, improve the arch. Do NOT build new where a thing already exists.** Gates (build+test+lint) green after every step; nothing merged red; revert-on-red, never force.

| Track | Action | Status (workflow `wqwmzxpmv`, 6 agents) |
|---|---|---|
| **RUN commit0** | ran the EXISTING commit0 adapter + gate (Supervisor path), `COMMIT0_FIXTURES=1`, no creds, **no new code**. | ✅ **RAN** — fixtures smoke 5/5 pass; the existing harness runs end-to-end |
| **DELETE `createDriver`** | attempt to migrate 12 callers → delete. | ⛔ **BLOCKED (real, not caution): 13/15 callers can't migrate.** `createDriver` is a *different PARADIGM* — string-prompt→string-answer over a `SandboxClient`, judged by `adapter.judge` (round-synchronous `runLoop`). `defineStrategy`/`runAgentic` operate over an `AgenticSurface` (stateful tool-call env, `shot()`/`critique()`, passes/total). The **entire bench gate/experiment harness** (`experiment.ts` Arm=`TopologyPlanner`, equal-k control, RunRecord corpus, vacuity guard) sits on the createDriver paradigm. You can't delete a *line* — you'd delete/re-paradigm the whole old **measurement** harness. Executor correctly deleted NOTHING; gates green, zero breakage. |
| **DEEP-CLEAN** | confirmed-dead bench scripts. | ✅ none new (already clean from `bdae618`) |
| **DEDUP** | `runAgentic` ≡ `runPersonified`. | ⛔ not a clean delegation — different executors/domains/results |

### ✅ FULL NUKE DONE (`2101f2d`, net −3,492 LOC)
Deleted `createDriver` + the entire old string-prompt/`experiment.ts` measurement + eval-gen apparatus (15 files). Survivors (`search-bench`/`cloud-loop`/`fleet`/`commit0-gate`) re-homed onto the new pure helper `bench/src/sandbox-run.ts`. **Kernel (`runLoop`) + `Scope`/`Supervisor` untouched.** Gates hand-verified: build 0, typecheck 0 (root+bench), lint 0, 905 tests pass; zero dangling code refs.
- **Accepted casualties** (rebuild on the agent-driver/Supervisor path when wanted): `generate-eval` (eval data engine), `profile-coord` (AgentProfile-coordinate optimizer #293), `run.ts` non-experiment subcommands (preflight/verify-judge/solve-one/ui-review).
- **Measurement rigor is NOT lost** — `pairedBootstrap`/`heldoutSignificance`/`promotionGate`/`runEvalCampaign`/`Scorecard` live in agent-eval; re-wire them to `gate` (the Supervisor path that already RUNS).

### 🔨 Follow-up — doc/skill rot (finishes the nuke)
~15 docs + 3 skills still describe deleted `createDriver`/`TopologyPlanner`/`runExperiment` as live API (CLAUDE.md code-map, docs/canonical-api, glossary, architecture*, roadmap-rsi, README, bench/HARNESS, skills/{agent-runtime-adoption,loop-writer,build-with-agent-runtime}). Update to the agent-driver/Supervisor reality before they mislead.

Then #2 (recursion) → #1 generator + cache → AgentProfile superset (#4) + fusion **last**.
