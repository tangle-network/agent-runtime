# The self-designing atom — cut-list + build-list

> Build plan (2026-06-15). Goal: ONE recursive, self-designing agent atom — succinct, simple, powerful. Secondary: net-negative LOC. Grounded against the real dependency inventory (`wc -l` + `grep -rl` over src/bench/tests). Companion to [long-horizon-agent-map.md](./long-horizon-agent-map.md).

## The atom (target)

> A **driver = a unified AgentProfile** (router-tools or sandbox, one type) whose primary verb is **`spawn(composedChildProfile)`** — each decision it *authors* a child profile (worker or sub-driver) for the sub-goal, steered by a **multi-turn analyst-agent's** grounded findings, **recursively**, each spawn **settled only when a completion-oracle confirms the declared deliverable**, on the **conserved budget**. Recursive *and* self-designing.

## Honest LOC reality (read before the lists)

`runLoop` (run-loop.ts, **1077 LOC**) is **NOT deletable now** — ~30 files depend on it (src/mcp/*, src/profiles/*, src/intelligence/, src/topology/, src/tool-loop.ts, src/loop-runner.ts, the sandbox-run seam) and it is already the **leaf-exec kernel** the Supervisor's sandbox executor composes under each worker. It stays. The deletable dumbness is the *driver policy layer* and the duplicate wrappers, not the kernel. So net-negative is achievable but **moderate, not dramatic** — claiming we delete 1000+ lines would be the lie.

## CUT LIST (delete / collapse)

| # | Delete | Where | ~LOC | Migration |
|---|---|---|---|---|
| 1 | **`createDriver` + `TopologyPlanner`** — the dumb code-policy "driver" (decides from score, generic refine) | `driver.ts` | ~280 of 350 | Callers (`loop-runner.ts`, `bench/{steering-experiment,experiment,improve-prompt,research-loop,generate-eval}`, tests) migrate to `defineStrategy` on the Supervisor. **Preserve** the `analyze`/`complete` hook *concepts* — re-home on the Supervisor driver (don't lose the analyst + completion seams). |
| 2 | **Dead recursion fences** — unreachable `throw` "spawned … run as a driver" | `strategy.ts:494`, `persona.ts:102` | ~10 | Pure deletion; a spawned child becoming a driver is now legal. |
| 3 | **`runAgentic` ≡ `runPersonified` dup** — both are `createSupervisor().run` | `strategy.ts:985` + `persona.ts:127` | ~60 | Keep ONE (`runPersonified` — it already does shape resolution); `runAgentic` callers (`run-benchmark`, `waterfall`, tests) pass a strategy-shaped persona. |
| 4 | **Flat-loop bench driver wiring** — benches that drive `runLoop`+`createDriver` directly | `bench/src/{steering-experiment,experiment}.ts` | ~150–250 | Fold into `defineStrategy` programs; the `random@k` control becomes a strategy, not bespoke driver glue. |

**Cut ≈ 500–700 LOC.** `runLoop` (1077) is untouched — it's the kernel, not the dumbness.

## KEEP (the real substrate — do not rebuild)

`Scope`/`Supervisor`/`budget` (the recursive engine + conserved pool), `runLoop` (demoted: the leaf-exec kernel), `router-tools` + `sandbox` executors, `observe()` + the analyst firewall, the **operator-driver coordination tools** (`src/mcp/tools/coordination.ts` — the LLM-agent-driver verbs already exist), `composeCertifiedProfile` + the AgentProfile-coordinate optimizer (`src/intelligence/`, `bench/src/profile-coord-sandbox.mts`), `completion.ts` (the completion-analyst seam).

## BUILD LIST (add — mostly wiring existing pieces)

| # | Build | Reuses | ~LOC | Why |
|---|---|---|---|---|
| A | **Make agent-eval's `AgentProfile` a true SUPERSET of the SDK's** (genome ⊇ execution). They are DISJOINT today, not super/subset: agent-eval's = the prompt genome `{role,environment,toolConventions,skills[],domain[]}` → `renderProfile()`; the SDK's = the execution manifest `{model,tools,mcp,subagents,permissions,hooks,resources,modes,prompt}`. The name collision is the bug. Extend agent-eval's `AgentProfile` to carry the SDK execution fields ON TOP of its genome fields; add `toSandboxProfile(p) → SDK.AgentProfile` (render genome → `prompt`, execution fields pass through); reconcile with the existing `SandboxAgentProfileLike`. Result: ONE type that is both optimizable (the loop evolves role/skills/domain) AND deployable (carries model/tools/mcp/subagents). **Harness stays the thin `AgentSpec` field** (portable; the eval axis needs it). | agent-eval (substrate — "no running loop" → lives there) + the import sites | + fields on one type, − the dual shape | Kills the AgentProfile collision; the genome IS the deployable. |
| B | **`spawn(composedProfile)` = the driver's first-class verb** — the supervisor *authors* each child's profile | `composeCertifiedProfile` + coordination tools | +120 | The self-designing core: the supervisor composes a child genome (model/tools/mcp/prompt/harness) per sub-goal. Wiring, not new science. |
| C | **Analyst = multi-turn investigating agent** — kill `budget: perChild(1)`; give it a turn budget + tools (re-read the failing output, run a check, inspect state) | `strategy.ts` analyst leaf + `observe()` | +60 / −15 | The single biggest steer-quality lever — replaces a one-shot transcript skim with an investigation. |
| D | **Completion-oracle = the settle condition** — every spawn carries a `DeliverableSpec`; `settled ⟺ Validator confirms delivered` | `completion.ts`, `Validator` | +80 | Foreman's one lesson: "ran" ≠ "delivered." Makes the loop honest. |
| E | **The driver IS the operator-driver** (LLM agent; verbs = spawn(composedProfile)/steer/check_done/stop) reasoning over the analyst findings | `src/mcp/tools/coordination.ts` | +40 | Promote the existing LLM-agent-driver to THE driver; delete the `switch`-statement planner (cut #1). |

**Build ≈ +350 / −45 LOC.**

## Net

≈ **−500–700 deleted, +350 added → net ~−200 to −350 LOC**, and the result is the one recursive self-designing atom. Honest: the win is *simpler + powerful*, not a giant LOC bonfire (the 1077-line kernel stays).

## Sequence (each step shippable, tests green)

1. Cut #2 + #3 (fences + dup) — trivial, immediate.
2. Build A (unify profile) — unblocks B.
3. Build C (analyst-as-agent) + D (completion-oracle) — independently testable on the existing depth path.
4. Build B + E (spawn-composes-profile + operator-driver as THE driver) — the self-designing core.
5. Cut #1 + #4 (delete the dumb planner + migrate benches) — *after* the Supervisor path covers their cases.
6. Prove on the **first real target** (open) with the completion-oracle as the gate.

## Open (needs the lead)
- **First real target + its machine-checkable done** — a repo feature with a test suite. Without it, step 6 is a toy.
