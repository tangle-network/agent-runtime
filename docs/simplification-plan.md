# agent-runtime simplification — MASTER TRACKER

> **Living doc. State: end of design, start of build — the design is converged, nothing of the refactor is built yet.** The bar is what a world-class staff-eng org ships: **SIMPLE**. A competent engineer derives the call path in *seconds*. Every line is `file:line`-grounded; no vibes. **THINK BIG (§0) · THINK SIMPLE (§1).**

---

## §0 — THINK BIG: the north star

**The foremost *unopinionated* RSI agentic runtime/harness.** It runs **any** coding harness under the hood (opencode/claude-code/codex/…), across **any number of governed sandboxes**, **supervisor-manages-compute**, and it **self-improves honestly** (certified on a frozen holdout, never fakes a win). Products, benchmarks, and user-sim evals are **one primitive pointed three ways**. The runtime is *mechanism*; the *intelligence* (how to plan/decompose/drive) is **skills** the supervisor uses and authors. supervisor-lab (`~/code/supervisor-lab`) is the product/experiment layer on top; agent-runtime stays clean. Differentiator no competitor packages: **backend-as-data + a governed sandbox-fleet + a frozen-holdout gate, as one unopinionated primitive.**

---

## §1 — THINK SIMPLE: the converged design (DON'T FORGET)

- **The atom: `AgentProfile`** = `{ prompt, tools, model|harness, skills, mcp }`. Worker/driver/supervisor are **not types** — a *driver* is a profile whose tools spawn; a *supervisor* **authors its children's profiles** ("recursive profile authoring" — supervisor-lab's core primitive). Everything spawned is an AgentProfile. No `role` flags, no `{name, systemPrompt}` shims.
- **THREE public verbs:**
  - `run(workerProfile, against, scope?) → { result, trace, spend }` — the one driven loop; recurses when the worker spawns. **The counterparty axis:** `against` = a **TASK** (benchmark; oracle = `score()` passes) | a **DRIVER profile** (user-sim eval; oracle = persona signs off DONE) | a **HUMAN** (product; oracle = human approves, via the turn boundary + persisted sandbox session).
  - `improve(profile, findings, opts) → profile'` — honest **facade over 3 engines** (in-flight steer / across-round skills + per-workspace memory / across-generation genome), **boundary-gated**, optimizes the **whole** profile (not just a prompt string).
  - `gate(profile, { baseline?, holdout? }) → verdict` — relative certification (with baseline+holdout) **or** static refusal (without). Honest: returns `improved:false` rather than ship a fake win.
- **Invariants:** `analyze` is **internal** (auto-runs the analyst on settle; findings flow UP the one event bus — *not* a public verb). Backend is **DATA** (router/sandbox/cli-bridge). Compute is **agent-managed** under a fail-closed `ComputeGovernor` (proven 8/8). Durability = **lean on the sandbox session + the existing supervisor journal** (do NOT build a new event log). **Skills = policy.**

---

## §2 — SCRATCHED (decided NOT to do — do not re-propose)

| Scratched | Why |
|---|---|
| `await_human` as a verb | turn-boundary + persisted sandbox session + the harness's own human-tool on the existing bus. No new primitive. |
| A new **durability event log** | the sandbox session + the supervisor journal already persist; #346 tried to rebuild this and was reverted **broken**. |
| `analyze` / `author` / `gateArtifact` as separate public verbs | analyze = internal; author = a supervisor authoring a child (recursive profile authoring); gateArtifact = `gate` with no baseline. |
| `DriverChat` / `routerDriverChat` / `sandboxDriverChat` | the brain is profile-driven; backend inferred — not a named seam. |
| My over-split 6+ verb set | the honest minimal set is **3** (run/improve/gate). When in doubt: it's a profile, a skill, or already-there — not a new verb. |

---

## §3 — DOC inventory (26 hand-maintained + 13 generated). done-when each row is true.

| Doc | Action | Why / completion criterion |
|---|---|---|
| `canonical-api.md` (981 lines) | **DELETE (eventually)** | documents the whole *stack* (agent-eval/sandbox symbols as if runtime's) → package-blur + drift. Interim: shrink to the conceptual spine + a machine-verified decision matrix. **Done:** <100 lines OR deleted; every symbol gate-verified; generated `docs/api/` is the reference. |
| `architecture.md` | **KEEP + UPDATE** | the canonical spine. **Done:** reflects the 3-verb + counterparty model; wins any conflict. |
| `architecture-vision.md` | **KEEP → MERGE** | the new visual (tree/up-flow/improvement). **Done:** merged with architecture.md into ONE architecture doc. |
| `architecture-visual.md` | **MERGE/DELETE** | overlaps `architecture-vision.md`. **Done:** one architecture doc remains. |
| `architecture-interpretations.md` | **KEEP + UPDATE** | "the decision gate." **Done:** updated to the converged gate. |
| `concepts.md` | **KEEP + UPDATE** | **Done:** 3 verbs + AgentProfile + counterparty, nothing stale. |
| `glossary.md` | **KEEP + UPDATE** | **Done:** terms match the rename (one word, one meaning). |
| `PLAIN.md` | **MERGE/DELETE** | plain-language overview → fold into README "getting started". |
| `ANTI_PATTERNS.md` | **KEEP** | named failure modes; add the new ones (over-split verbs, package-blur). |
| `BUILDING.md` | **KEEP** | build rules. |
| `MAINTAINING.md` | **KEEP + UPDATE** | docs-maintenance contract. **Done:** describes the extended gate (every backticked symbol resolves). |
| `README.md` (docs index) | **KEEP + UPDATE** | re-index after the cull. |
| `refactor-roadmap.md` | **MERGE → this doc** | this IS the refactor plan. **Done:** content folded here, file deleted. |
| `roadmap-rsi.md` | **UPDATE/MERGE** | RSI build plan → reconcile with §6/§7. |
| `learning-flywheel.md` | **UPDATE** | the flywheel → the `improve()` 3-engine model. |
| `execution-model.md` | **UPDATE** | → `run()` + the counterparty axis. |
| `agent-bus-protocol.md` | **KEEP + UPDATE** | the up-flow bus; keep, it's load-bearing. |
| `durability-adapters.md` | **UPDATE** | → "lean on sandbox session + journal"; drop the new-event-log framing. |
| `eval-substrate.md` | **KEEP** | the eval north star + measurement non-negotiables. |
| `intelligence-sdk.md` | **KEEP/REVIEW** | product intelligence layer; may move to supervisor-lab. |
| `capability-delivery-manifest.md` | **REVIEW** | likely stale; archive if so. |
| `conversation-economics.md` | **REVIEW/ARCHIVE** | niche. |
| `artifact-lifecycle-frontier.md` | **REVIEW/ARCHIVE** | niche/frontier notes. |
| `go-live-plan.md` | **ARCHIVE** | likely stale ops plan. |
| `results.md` | **ARCHIVE** | results log → move out of docs/. |
| `docs/api/*` (13 generated) | **KEEP (generated)** | regenerate via `pnpm docs:api`; never hand-edit. |
| root `README.md` | **REWRITE** | one honest "3 ways to run an agent" + layer table + import paths. **Done:** 5-line offline getting-started for the 3 cores. |
| root `AGENTS.md`/`CLAUDE.md` | **UPDATE** | the bootloader/code-map → the converged model; drop stale pointers. |

**Net target: ~26 hand docs → ~12.** One architecture doc, no canonical-api, niche docs archived.

---

## §4 — PUBLIC SURFACE inventory (13 subpaths / 998 exports → ~6 subpaths / ~450). done-when each is true.

| Subpath / module | Action | Completion criterion |
|---|---|---|
| `.` (main) | **KEEP, shrink** | core: AgentProfile + run/improve/gate + handleChatTurn. Hide conversation plumbing + journal types. |
| `./runtime` (362 symbols) | **KEEP, SHRINK hard** | → ~100. Move seams/factories/recursion-plumbing to `./supervise/internal`. |
| `./loops` | **KEEP/MERGE** | the strategy+benchmark surface (refine/sample/runBenchmark/gate). |
| `./mcp` (178) | **KEEP, shrink** | coordination + delegation tools; hide trace collectors + task-queue internals. |
| `./agent` | **KEEP** | `defineAgent` / profile authoring. |
| `./profiles` | **MERGE → ./agent** | one profile surface. |
| `./intelligence` (76) | **REVIEW → supervisor-lab?** | product layer; runtime stays unopinionated. |
| `./improvement` | **INTERNALIZE → improve()** | the 3 engines are internal; one verb out. |
| `./analyst-loop` | **INTERNALIZE** | analyze is internal (auto-on-settle). |
| `./topology` | **INTERNALIZE** | replay/debug tooling, not public. |
| `./workflow` (63) | **REVIEW** | keep only if it's a real user surface. |
| `./platform` / `./audit` | **REVIEW/INTERNALIZE** | likely internal. |

**Module-level (the load-bearing cuts):**

| File/module | Action | Completion criterion |
|---|---|---|
| `supervise/router-driver-chat.ts` (`DriverChat`/`routerDriverChat`) | **DELETE** | brain is profile-driven; backend inferred. Build green without it. |
| `supervise/coordination-driver.ts` loop (161-211) · `supervise/runtime.ts` routerToolsInlineExecutor (337-452) · `router-client.ts` routerToolLoop (207) | **COLLAPSE → ONE** `runToolLoop` | one metered tool-loop; KEEP the turn-metering (it's how equal-k holds); both call sites become thin adapters. ~150 dup lines gone. |
| `run-loop.ts` (the round-synchronous kernel) | **INTERNALIZE** | public substrate = Scope/Supervisor; runLoop is an internal leaf executor. |
| `strategy.ts` (`depthDriver`/`breadthDriver`/`sample`/`refine`/`runAgentic`) | **KEEP + RENAME** | depth/breadth are *Strategy*, not *Driver*. |
| `supervise/` leaked internals: `driverChild`, `driverExecutorFactory`, `driverRuntime`, `isDriverSpec`, `withDriverExecutor`, the `*Seam` types, `SpawnJournal`/`FileSpawnJournal`/`InMemorySpawnJournal`, `nestedScopeSeamKey`, `ExecutorFactory` | **INTERNALIZE** | not exported from any public subpath. |
| `improvement/` (6 files) | **INTERNALIZE behind `improve()`** | one verb; engines private. |
| `analyst-loop/` (4 files) | **INTERNALIZE** | auto-on-settle. |
| `conversation/run-persona.ts` (`runPersonaConversation`) | **KEEP + RENAME → `evaluateWithUser`** | weld `haltOn` to the persona's DONE oracle (currently caps on maxTurns only). |
| `conversation/` (other 16) | **AUDIT** | keep multi-turn chat; internalize the rest. |
| `mcp/` (22) | **KEEP** | coordination (`serveCoordinationMcp`) + delegation. |
| `durable/` (`handleChatTurn`) | **KEEP** | the product chat-turn primitive = `run` for a leaf turn. |
| `runtime/supervise/coordination-mcp.ts` (`analyzeOnSettle`) | **KEEP + make UNIFORM** | analyst fires on settle at EVERY layer (worker/driver/loop), not just worker. |
| compute: `ComputeGovernor` | **KEEP + ROUTE workloads through it** | the benchmark grind runs on the governed fleet, not a host-local Docker. |

---

## §5 — EXAMPLE inventory (16). done-when: each runs offline first-try + has CI.

| Example | Action |
|---|---|
| `chat-handler/` | KEEP (clean, offline) — add 5-line README. |
| `recursive-supervisor/` | KEEP (exemplary, offline). |
| `strategy-suite/` | FIX — add offline/scripted variant (needs `TANGLE_API_KEY` today). |
| `mcp-delegation/` | FIX — remove the prior-`pnpm build` requirement. |
| `supervisor-loop/` | KEEP + surface `run-supervisor-mcp` (the real harness-as-brain path). |
| `self-improving-loop/` | KEEP (mark pedagogical). |
| `agents-of-all-shapes/` | KEEP (the only CI-tested one). |
| `coder-loop`, `researcher-loop`, `runtime-run`, `stream-backends`, `knowledge-gating`, `sanitized-telemetry-streaming`, `fleet-delegation`, `ui-audit`, `intelligence-drop-in` | AUDIT + CI; prune/relabel redundant; gate the optional-peer ones gracefully. |

**Done:** every example runs from a clean clone, offline-first, with a CI job.

---

## §6 — Workstreams (completion criteria per WS)

- **WS1 — Unify the brain + one tool-loop.** Delete `DriverChat`; collapse the 3 tool-loops to 1 (keep metering); brain inferred from the profile. **Done:** `routerDriverChat` gone; one `runToolLoop`; 1055 tests green.
- **WS2 — One public substrate.** Scope/Supervisor public; `runLoop` internal; merge `runAgentic`/`runPersonified`. **Done:** one documented "run an agent" path.
- **WS3 — Shrink surface 998→~450.** Internalize the WS4-listed modules. **Done:** export count ≤ ~450; gate-counted.
- **WS4 — Naming taxonomy.** depth/breadth→Strategy; improvementDriver→improve; supervisorSkill→supervisorInstructions; DriverChat deleted; `AgentRunSpec`→`SandboxIterationSpec`. Ship deprecation aliases one release + fleet sweep. **Done:** grep "Driver" = one concept.
- **WS5 — Docs truth + gate.** Separate packages (runtime doc = runtime exports only); extend the gate to EVERY backticked symbol; execute §3. **Done:** a doc symbol that doesn't resolve = red build; canonical-api shrunk/deleted.
- **WS6 — Examples.** §5. **Done:** offline-first + CI all.
- **WS7 — RSI is one verb.** `improve()` facade over the 3 engines, boundary-gated, whole-profile (skills/tools/mcp in the loop); per-workspace memory as the across-round engine; keep `explore`/fuzz a SEPARATE proposer. **Done:** one `improve` entrypoint; products use it instead of bespoke string-tuning.
- **WS8 — Product primitives.** `evaluateWithUser(product, persona)` (rename + oracle weld); the counterparty axis on `run`; route the harness human-tool to the product via the bus; `author(spec)` as recursive-profile-authoring helper; profile-as-worker-behind-an-Environment + route benchmark to the governed fleet. **Done:** the 4 product shapes (product/benchmark/user-sim/builder) use the same primitive.

---

## §7 — Long-horizon plan-driver + skills (THINK BIG) — *red-team workflow pending*

**Goal:** a supervisor autonomously drives a large multi-day plan to 100% — plans, parallelizes milestones, spawns a driver per parallel milestone, each driver drives a worker, finishes without days of babysitting. **It is `run(supervisorProfile, goal)` where the planning/parallelizing/driving/completion-checking is a SKILL the supervisor uses and authors into its children.** Runtime = mechanism (tree + governed parallel sandboxes + up-flow + completion oracle); skills = policy. *(Exact topology, completion-oracle status, and the skills to vendor from oh-my-codex → supervisor-lab: filled by the running red-team; `~/code/supervisor-lab` already centers recursive profile authoring + skill ingestion.)*

---

## §8 — DX acceptance test (the definition of DONE)

- [ ] A new engineer runs an agent on a task in **≤5 offline lines**, copied from the README, first try.
- [ ] "Drive a supervisor with a sandboxed harness" = author a profile. No `router`/`sandbox` brain choice exists.
- [ ] User-sim eval = `evaluateWithUser(product, persona)` — one line; no fuzz/persona/matrix zoo.
- [ ] A supervisor finishes a multi-day parallel plan with the user steering **zero** times.
- [ ] Every symbol in every doc resolves (gate-enforced) — the docs **cannot** lie.
- [ ] Public surface skimmable in one sitting (~450, not 998). `grep "Driver"` = one concept.
- [ ] `improve()` ships a win only when it **proves** it on a frozen holdout (never `improved:true` without evidence).
