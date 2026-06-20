# agent-runtime simplification — MASTER TRACKER

> **Living doc. State: SHIPPING on `feat/usability-overhaul` (clean-merges origin/main, all gates green).** Done: **WS1a+1b** (`supervisorAgent(profile, deps)` resolves the brain from `profile.harness` — `null`→in-process router tool-loop, a coding-CLI harness→a sandboxed harness driving the verbs; `DriverChat` deleted, `routerBrain` now internal; both arms proven offline), **WS3** (runtime barrel 355→277, subpaths 13→6), **WS5** (canonical-api 984→76, 26→17 docs +5 archived, CLASS 6 prose-symbol gate so docs can't lie). Next: WS2, WS4, WS6, WS7-9. The bar is what a world-class staff-eng org ships: **SIMPLE**. A competent engineer derives the call path in *seconds*. **THINK BIG (§0) · THINK SIMPLE (§1).**

---

## §0 — THINK BIG: the north star

**The foremost *unopinionated* RSI agentic runtime/harness.** It runs **any** coding harness under the hood (opencode/claude-code/codex/…), across **any number of governed sandboxes**, **supervisor-manages-compute**, and it **self-improves honestly** (certified on a frozen holdout, never fakes a win). Products, benchmarks, and user-sim evals are **one primitive pointed three ways**. The runtime is *mechanism*; the *intelligence* (how to plan/decompose/drive) is **skills** the supervisor uses and authors. supervisor-lab (`~/code/supervisor-lab`) is the product/experiment layer on top; agent-runtime stays clean. Differentiator no competitor packages: **backend-as-data + a governed sandbox-fleet + a frozen-holdout gate, as one unopinionated primitive.**

---

## §1 — THINK SIMPLE: the converged design (DON'T FORGET)

- **The atom: `AgentProfile`** = `{ prompt, tools, model|harness, skills, mcp }`. Worker/driver/supervisor are **not types** — a *driver* is a profile whose tools spawn; a *supervisor* **authors its children's profiles** ("recursive profile authoring" — supervisor-lab's core primitive). Everything spawned is an AgentProfile. No `role` flags, no `{name, systemPrompt}` shims.
- **FOUR honest public verbs** (red-team-corrected: four honest beat three lying; each wraps a REAL existing function — TARGET, not yet built):
  - `run(profile, against, scope?) → Result(against)` — the one driven loop; recurses when the worker spawns. **Counterparty axis:** `against` = a **TASK** (benchmark; oracle = `score()`) | a **DRIVER profile** (user-sim; oracle = persona DONE) | a **HUMAN** (product; oracle = the turn boundary + persisted sandbox session). **In-flight STEER lives HERE** — it's loop control (a per-shot string, `strategy.ts pendingSteer`), never a profile change. *Caveat: the return type leaks the counterparty (BenchmarkReport vs transcript vs turn) → a tagged union narrowed on `against`, never `any`.* Wraps `runAgentTask`/`runBenchmark`/`runAgentic`/`runPersonaConversation`/`handleChatTurn`. The per-worker settlement oracle `gateOnDeliverable` lives INSIDE `against` — it is NOT a verb.
  - `improve(profile, findings, { generator?, surface?, gate? }) → profile'` — **ONE verb, PLUGGABLE** (not "one engine" — the optimizers are real and already built). The SHAPE is uniform (findings → candidate profile → optionally gate); the ALGORITHM is a pluggable **`CandidateGenerator`** (`improvement-driver.ts:35`, 3 fields): **GEPA** (`gepaDriver`, prompt) · **skillOpt** (`skillOptDriver`, skills) · **autoresearch** (`createResearchExecutor`) · **reflective**/**agentic** (code) · BYO. The **`surface`** is a param: `prompt | skills | tools | mcp | hooks | code` — the §1.5 whole profile, including *building* tools/mcp/hooks. `gate: 'holdout' | 'none'`. The win is ONE clean plug-in shape for all your optimizers, not erasing them.
  - `certify(profile, { baseline?, holdout? }) → verdict` — POST-run statistical cert = `promotionGate` (paired bootstrap + min-tasks floor + CI-low). The real "never fakes a win."
  - `refuse(task) → verdict` — PRE-run static readiness = `decideKnowledgeReadiness`. SEPARATE from certify on purpose (different input/timing/question); fusing them under one `gate` name is the over-MERGE failure.
- **Invariants:** `analyze` is **internal** (auto-on-settle; findings UP the bus — not a verb). Backend is **DATA**. **Durability:** turn/leaf resume = sandbox session + journal (real); a half-finished **multi-generation `improve` run is NOT resumable today** (port `loops`' disk-observable phase state — NOT a new event log). **Compute:** the `ComputeGovernor` (8/8) lives in `loops/`, **NOT this repo yet** — migrating it is a real, unstarted task. **Skills = policy.**

---

## §2 — SCRATCHED (decided NOT to do — do not re-propose)

| Scratched | Why |
|---|---|
| `await_human` as a verb | turn-boundary + persisted sandbox session + the harness's own human-tool on the existing bus. No new primitive. |
| A new **durability event log** | the sandbox session + the supervisor journal already persist; #346 tried to rebuild this and was reverted **broken**. |
| `analyze` / `author` / `gateArtifact` as separate public verbs | analyze = internal; author = a supervisor authoring a child (recursive profile authoring); gateArtifact = `gate` with no baseline. |
| `DriverChat` / `routerDriverChat` / `sandboxDriverChat` | the brain is profile-driven; backend inferred — not a named seam. |
| My over-split 6+ verb set | the honest minimal set is **4** (run/improve/certify/refuse). When in doubt: it's a profile, a skill, or already-there — not a new verb. |
| `improve` as "**three engines**" (the CADENCE framing) | the *cadence* framing (in-flight/round/gen) was wrong — in-flight *steer* is loop control → moves to `run`. But do NOT collapse to "one engine" either: the **optimizer is genuinely pluggable** (GEPA/skillOpt/autoresearch/reflective/agentic via `CandidateGenerator`) over a **`surface`** param. One verb, pluggable algorithm + surface. |
| `gate` as **one verb** (over-MERGE) | three incompatible signatures: `promotionGate`(BenchmarkReport, post-run) ≠ `decideKnowledgeReadiness`(KnowledgeReadinessReport, pre-run) ≠ `gateOnDeliverable`(wraps an Executor, per-run settlement). A verb that switches its whole body/input on an optional arg is a router pretending to be an abstraction → split into `certify` + `refuse`; `gateOnDeliverable` is `run`'s oracle. |
| "durability is **handled**" | true for turn/leaf resume; **false** for a half-finished multi-generation `improve` run (corpus + generation pointer + holdout assignment have no resume). Reverting #346 was right; concluding done is not. Fix = **port `loops`' disk-observable phase state**, not a new event log. |
| "compute is agent-managed **here** (ComputeGovernor 8/8)" | the governor lives in `loops/`, **NOT agent-runtime**; today's only fence is the conserved BudgetPool + maxDepth + deadline. Migrating the governor is real + **unstarted** — not a done fact. |
| the verbs as **current state** | zero top-level exports of run/improve/certify/refuse; every WS box is unchecked. The verbs are the **TARGET**, validated against the messy real functions — do NOT freeze as the public contract until they wrap those functions. |

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
| `strategy.ts` (`depthStrategy`/`breadthStrategy`/`sample`/`refine`/`runAgentic`) | **KEEP + RENAME** | depth/breadth are *Strategy*, not *Driver*. |
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

- **WS1 — Unify the brain (TWO phases).**
  - **1a ✓ DONE** (`0f505e2`): delete `DriverChat`; the brain is the canonical `ToolLoopChat`; the coordination-driver loop runs through the one `runToolLoop`; metering preserved exactly; `routerDriverChat` (60 lines) → `routerBrain` (4); 1051 tests green. *One seam — but the caller still hand-builds the brain.*
  - **1b — brain-FROM-profile (harness-as-data), the real "create a supervisor on any harness".** `createSupervisor(profile)` resolves the brain from `profile.harness`/`backend` EXACTLY like `createExecutor({backend})` resolves a worker: `router-tools` → the in-process `ToolLoopChat` loop (**`routerBrain` becomes internal**, not caller-facing); `sandbox` + `harness: claude-code|opencode|codex` → the harness drives the coordination verbs in its sandbox via `serveCoordinationMcp` (already exists, `coordination-mcp.ts:51`). Closes critique **A2** ("driver brain is router-ONLY"); the supervisor stops being special — just an `AgentProfile` materialized by the one backend-as-data resolver. **Done:** a supervisor runs on EITHER the router OR a sandboxed CLI harness from its profile alone, no hand-built brain; an example proves both.
- **WS2 — One public substrate.** Scope/Supervisor public; `runLoop` internal; merge `runAgentic`/`runPersonified`. **Done:** one documented "run an agent" path.
- **WS3 — Shrink surface 998→~450.** Internalize the WS4-listed modules. **Done:** export count ≤ ~450; gate-counted.
- **WS4 — Naming taxonomy.** depth/breadth→Strategy; improvementDriver→improve; supervisorInstructions→supervisorInstructions; DriverChat deleted; `AgentRunSpec`→`SandboxIterationSpec`. Ship deprecation aliases one release + fleet sweep. **Done:** grep "Driver" = one concept.
- **WS5 — Docs truth + gate.** Separate packages (runtime doc = runtime exports only); extend the gate to EVERY backticked symbol; execute §3. **Done:** a doc symbol that doesn't resolve = red build; canonical-api shrunk/deleted.
- **WS6 — Examples.** §5. **Done:** offline-first + CI all.
- **WS7 — RSI is one verb, PLUGGABLE.** `improve(profile, findings, {generator?, surface?, gate?})` — one SHAPE, pluggable `CandidateGenerator` (GEPA/skillOpt/autoresearch/reflective/agentic/BYO) over a `surface` (prompt/skills/tools/mcp/hooks/code); in-flight steer moved to `run`. `certify`=`promotionGate`, `refuse`=`decideKnowledgeReadiness` kept separate. **Done:** one `improve` entrypoint exposes every existing agent-eval optimizer cleanly; products improve the WHOLE profile, not just a string.
- **WS8 — Product primitives.** `evaluateWithUser(product, persona)` (rename `runPersonaConversation` + weld the DONE oracle); the counterparty axis on `run` (tagged-union return); route the harness human-tool to the product via the bus; profile-as-worker-behind-an-Environment + route benchmark to the governed fleet. **Done:** the 4 product shapes (product/benchmark/user-sim/builder) use the same primitive.
- **WS9 — Long-horizon plan-driver (§7).** Build the **milestone primitive + completion-oracle rollup** (worker `gateOnDeliverable` → milestone acceptance → plan 100%, reusing `CompletionAnalyst`); **vendor the 8 oh-my-codex skills** into supervisor-lab; **port `loops`' disk-observable phase state** for multi-generation `improve`-run resume; **ticket the `ComputeGovernor` migration** (loops→agent-runtime). **Done:** a supervisor finishes a multi-milestone parallel plan with **zero** human steers.

### §WS4 closed decisions (naming taxonomy — DECIDED, some DEFERRED on timing)

The naming work converged on these calls. Each is settled — do not re-propose; where a rename is DEFERRED the reason is the blast radius, not indecision.

1. **`AgentRunSpec` → `SandboxIterationSpec` — name DECIDED, rename DEFERRED.** The target name is right (it is the per-iteration sandbox spec, not a generic "agent run"), but the symbol is PUBLIC at `src/runtime/index.ts` with a ~28-file blast radius across the fleet. A rename needs a major bump + consumer migration PRs (the §9 non-goal: no public rename without that), so it is OUT of a usability PR. Ship the rename in its own breaking release with deprecation aliases one cycle.
2. **`improvementDriver` KEEPS its name.** `improve()` is now the public RSI verb (the WS7 facade); `improvementDriver` is the internal code-surface driver behind it, not a public `Driver` export. The "reserve `Driver` for orchestration" goal is met because `improvementDriver` is not surfaced as an orchestration driver — it is the generator seam `improve()`/`selfImprove` consume.
3. **`runLoop` KEEPS its name AND stays public.** It is a published `/loops` primitive (the round-synchronous leaf kernel the sandbox benches drive); internalizing or renaming it would break consumers for no taxonomy gain. The Scope/Supervisor core is the PREFERRED path for new recursive work, but `runLoop` is not deprecated.
4. **`runAgentic` and `runPersonified` BOTH stay.** They are distinct contracts (one-shot agentic run vs persona-driven cross-run combinator), not duplicates — a merge would conflate two real shapes. WS2's "one documented run path" is satisfied by `supervise()` as the one-call entry; the lower-level combinators remain for power use.
5. **`improve()` surface ∈ {`tools`, `mcp`, `hooks`, `code`} accepts only a BYO `generator` — fail-loud otherwise (designed boundary).** Only `prompt` (→ `gepaDriver`) and `skills` (→ `skillOptDriver`) have a zero-config default driver, because both are derivable from `opts.llm`. A code/config driver needs caller-supplied wiring (a worktree repo root, a candidate generator, a serializer) the facade cannot invent; inventing one would be exactly the silent fallback the house rules forbid, so the facade throws a `ConfigError` when `opts.generator` is absent for those surfaces.

---

## §7 — Long-horizon plan-driver + skills (THINK BIG) — VERDICT: **NO today; gaps are POLICY/PRIMITIVE, not architecture**

**Goal:** a supervisor autonomously drives a large multi-day **parallel** plan to 100% with **zero** babysitting. It is `run(supervisorProfile, goal)` where planning/parallelizing/driving/completion-checking is a **SKILL**. Runtime = mechanism; skills = policy.

**Topology (verified real):** root = `createSupervisor().run(rootAgent, task)`; `act()` IS the supervisor brain, driven EITHER in-process (`coordinationDriverAgent`, an LLM tool-loop over `createCoordinationTools`) OR by a coding harness mounting `serveCoordinationMcp`. `Scope.spawn/next` runs N children in PARALLEL gated only by the conserved budget pool (`scope.ts:202,345`).

**MISSING (the binding gaps):**
- **No plan/milestone primitive anywhere** — grep returns only prose; the "decompose → one driver per parallel milestone" layer is neither code nor skill.
- **Completion oracle is WORKER-level only** (`gateOnDeliverable`) — no MILESTONE/PLAN-level "100% done" rollup. This is *the* thing that makes "is the plan done" unanswerable → it can't close autonomously.
- **Decomposition + scoping skills don't exist** in supervisor-lab (it has only `authoring-agent-profiles`).

**BUILD #1 (the binding fix):** a thin **milestone primitive + completion-oracle rollup** in agent-runtime (mechanism): `milestone = { acceptanceCriteria, deliverables[] }`, `plan = ordered milestones`; the oracle rolls up worker `gateOnDeliverable` → milestone acceptance → plan 100%. **Reuse `gateOnDeliverable` + `CompletionAnalyst` as the leaf — do not reinvent.** Fed by a plan-decomposition SKILL in supervisor-lab (policy).

**SKILLS to vendor (oh-my-codex → `supervisor-lab/vendor/`, the policy layer):**
| Skill | Fills |
|---|---|
| **ralplan** | decomposition: goal → ordered, approved, individually-verifiable stories (adversarial Planner/Architect/Critic). Gap #2, highest value. |
| **ultragoal** | durable one-story-at-a-time ledger, checkpoint-each-step. Maps onto the existing journal/sandbox session (+ port `loops` phase state for gen-resume). |
| **ralph** | persistence loop: delegate → verify-with-fresh-evidence → sign-off → re-verify, until *genuinely* done. |
| **ultraqa** | adversarial e2e QA that refuses the build/lint/test checklist + catches misleading-success — hardens the honest oracle. |
| **deep-interview** | ambiguity-scored Socratic scoping → execution-ready spec w/ non-goals. The `against = HUMAN` intake. Gap #1. |
| **autopilot** | the phase topology (interview→plan→drive→review→QA) as POLICY — STRIP the OMX/tmux transport, re-point at coordination tools. |
| **team** | closed-loop delegation protocol (ACK-readback, claim-before-work, terminal-state gate) — INGEST the discipline, DROP the tmux/mailbox transport → the one event bus. |
| **best-practice-research** | cited, version-aware research-before-build feeding the planner. |

**Do NOT vendor:** swarm/trace/build-fix/note/ecomode (dead shims), tdd/ai-slop-cleaner/analyze (covered), surface skills (frontend/design/hud/doctor).
**Method:** `git submodule add` oh-my-codex under `supervisor-lab/vendor/` (mirrors `vendor/everyinc`) + ONE ingester line in `src/ingest/skills.ts` + the 8-skill allowlist + transport-strip team/autopilot + tag `{source, license:MIT, redistributable}`. Land as `resources.skills` on a driver profile. **Nothing into agent-runtime; supervisor-lab holds all policy.**

---

## §7.5 — TABLED: the supervisor/driver/worker multi-round design (revisit after the simplification PR)

The product vision, parked here so the simplification work stays focused. NOT in scope for this PR.

- **Topology:** a supervisor spawns a fleet of **driver↔worker loops**. Both driver and worker are sandbox agents. A driver drives its worker across a **multi-round, stateful conversation** over a persistent artifact (the worker keeps its session/workspace across rounds; the driver re-engages, it does not restart).
- **Two limits, named distinctly (glossary, WS4):** a **turn** = one agent's own internal agentic step (`maxTurns = 0` ⇒ inner loop bounded by budget, not a turn count); a **round** = one driver↔worker exchange. "Max rounds per loop" caps the OUTER conversation; the worker's `maxTurns` is the INNER loop. Do not conflate (the runtime today exposes only the driver-loop cap; the round cap belongs on the driver's PROFILE the supervisor authors).
- **Retry / self-correction is the driver's PROMPT-POLICY, not a verb** — fed by REAL-TIME trace analysis: worker settles → `analyzeOnSettle` raises a finding → the driver pulls it (`await_event`) → diagnoses → re-steers / re-spawns → repeats until the gate passes or budget/rounds run out. The seam exists (`analyzeOnSettle` + the finding bus + `steer_agent`); what's missing is the driver prompt that USES it. NO `retryWithDiagnosis` verb.
- **Completion = a checkable predicate against REAL state** (CI green / tests pass / PR merged), run by the agent as a tool call — grounded, fail-closed, never the model judging itself. The supervisor DISCOVERS the criteria from the user's prompt (read the repo/CI), not from a hardcoded contract.
- **The intelligence is in the prompts/skills (supervisor-lab):** the supervisor THINKS, PLANS, and considers ALTERNATIVES when it authors its drivers/loops/workers (spawn drivers for anything needing more than one shot); each driver does the same to author substantial, cohesive, capable workers. Recursive profile authoring is the capability.
- **Thin runtime support to add when we revisit:** per-spawn `budget` on `spawn_agent` (the pool already reserves arbitrary per-child budget, fail-closed); the **round cap as a field on the driver profile** the supervisor authors (§1.5); verify + prove the trace-analysis → driver real-time wiring with a test. Plus the Symphony control taxonomy (§ build-first: per-dispatch controls, a learned allocator on the holdout gate) captured from the deep-dive.
- **The supervisor selecting model + hyperparameters** (a cost/quality-aware learned policy — complete a task with the cheapest model that still passes the gate) is the eventual direction. **There is SEPARATE active research on this; do NOT build it here.** The simplification's only obligation is to keep the per-dispatch control seam ADDABLE (don't foreclose it) — which `spawn_agent`'s optional-args design already does.
- **Symphony-replacement framing (proven by the fetched deep-dive):** Symphony is a static-config reconciler whose "done" is a board state and whose retries are identical → ~50-60% fail, never learns. We win with the completion oracle + the real-time self-correcting driver + the learned allocation policy.

---

## §8 — DX acceptance test (the definition of DONE)

- [ ] A new engineer runs an agent on a task in **≤5 offline lines**, copied from the README, first try.
- [ ] "Drive a supervisor with a sandboxed harness" = author a profile. No `router`/`sandbox` brain choice exists.
- [ ] User-sim eval = `evaluateWithUser(product, persona)` — one line; no fuzz/persona/matrix zoo.
- [ ] A supervisor finishes a multi-day parallel plan with the user steering **zero** times.
- [ ] Every symbol in every doc resolves (gate-enforced) — the docs **cannot** lie.
- [ ] Public surface skimmable in one sitting (~450, not 998). `grep "Driver"` = one concept.
- [ ] `improve()` ships a win only when it **proves** it on a frozen holdout (never `improved:true` without evidence).

---

## §9 — Internal refactor backlog (leverage-ordered)

Structural-debt items that are not surface changes. Reference the relevant `Rn` from a refactor PR; close an item by deleting its row when the work ships.

**Preserve through any refactor:** `handleChatTurn` (the production centerpiece — six consumer products lean on it; keep it stable); `runLoop` + `Driver` + `Validator` (the multi-shot kernel, cleanly separated from substrate concerns); the `/mcp` server + executor + worktrees (genuine in-sandbox delegation); opt-in OTEL export; `sanitize.ts` + redaction (well-isolated); `/agent` (`defineAgent`, declarative domain agents).

### Tier 1 — structural debt that compounds

**R2. `runtime-run.ts` is doing four jobs** (persistence + cost ledger + handle lifecycle + cross-process resume). Split into `runtime-run/{handle,persistence,cost-ledger,resume}.ts`, keep `runtime-run.ts` as the barrel re-export. No surface change; internal navigation improves. Est 3–4h, low risk.

### Tier 2 — surface cleanup

**R6. `examples/` has more directories than the README references**; the unreferenced ones bit-rot. Keep one per consumer pattern (chat-handler, knowledge-readiness, sanitized-telemetry, coder-loop, researcher-loop, mcp-fleet, distributed-driver) and archive the rest under `examples/archive/`. Est 2h.

### Tier 3 — hygiene

**R7.** Test files mix locations: `src/model-resolution.test.ts` lives in `src/`; move to `tests/` for consistency.
**R9.** `src/durable/` keeps its tests under `src/durable/tests/`; move to `tests/durable/` for parity with the rest of the suite.

### Non-goals (do NOT do these)

- **Do NOT rename anything in the public surface** without an explicit major bump + consumer migration PRs. Surface stability matters more than perfect naming.
- **Do NOT add new entry points** without first asking whether the feature belongs in agent-eval (the substrate). The test is "does this make sense WITHOUT a running agent loop?" → yes = substrate.
- **Do NOT add direct dependencies on consumer packages** (`agent-builder`, `gtm`, …) into agent-runtime — that creates a new inversion class.
- **agent-eval is a REQUIRED peer dependency** — moving it to a hard dep would break workspace installs.
