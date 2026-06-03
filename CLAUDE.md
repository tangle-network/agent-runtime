# agent-runtime

Shared task-lifecycle skeleton for domain agents, generated agents, red-team harnesses, and coding agents. Standardizes the lifecycle (`runAgentTask`, `runAgentTaskStream`, the sandbox-driven loop kernel `runLoop`/`runProgram`) and the self-improvement spine on top of it (driver→worker topology, trace-analyst findings, eval-gated ship); delegates all domain behavior to adapters.

Imports `@tangle-network/agent-eval` for the control loop, knowledge-readiness scoring, and run-record types. Does NOT own domain policy, models, tools, connectors, UI, or the optimizer/corpus/judge substrate.

## Orient first — read these, don't re-derive the repo from source

This repo's bottleneck is agents paying a **re-discovery tax**: re-reading 15 files to rebuild a mental model that already exists. Before exploring, read, in order:

1. **`docs/architecture.md`** — the canonical spine (one recursive `Agent` atom; two timescales; benchmark-as-adapter; selector≠judge). Wins on any architecture conflict. `docs/README.md` indexes the rest; `docs/roadmap-rsi.md` is the dependency-ordered build plan; `docs/architecture-interpretations.md` defines **the decision gate**.
2. **`bench/HARNESS.md`** — the experiment-harness map: commands, the `rollout → corpus → selector → CI → gate` data flow, the wired/needs-creds/scaffolded matrix, and run-the-gate-in-2-lines. Read it before touching `bench/`.
3. **`.evolve/current.json`** — the single source of truth for the active goal + generation + the live science state. Then `.evolve/progress.md` and the newest `.evolve/pursuits/*.md`.
4. **Persistent memory** (`MEMORY.md` + the `memory/` notes) — the code-map and the evidence ledger. Start with the map; verify it, don't rebuild it.

**The anti-staleness law:** these maps are kept short and code-adjacent. If a map disagrees with the code, the **code wins** — fix the map in the *same* turn. Discovery is paid once, by whoever records it. When you learn something undocumented, write it to the map/memory before moving on.

## Repo layering — this package depends on agent-eval, never the reverse

```
agent-knowledge ─┐
                 ├──► agent-eval (substrate — the bottom)
agent-runtime ───┘   (this repo — wraps the substrate)
```

**Rule: agent-runtime depends on agent-eval. agent-eval MUST NOT import from agent-runtime.** No upward imports, no `peerDependencies` in agent-eval pointing here, no `import type { X } from '@tangle-network/agent-runtime'` inside agent-eval. A spotted upward import is a bug — file an issue and move the type into agent-eval. agent-eval is declared a **required `peerDependency`** (pinned `^0.76.0`), not a hard dependency — keep it in sync with the `optimizePrompt`/`heldoutSignificance`/`loopDispatch` APIs the code uses.

Substrate primitives CONSUMED from agent-eval: `DefaultVerdict`, `RunRecord`, `AgentEvalError` + taxonomy, `AnalystFinding`/`AnalystRunResult`/`FindingsDiff`, `TraceAnalystKindSpec`, `KnowledgeReadinessReport`, and the campaign types (`DispatchContext`/`ProfileDispatchFn`/`Scenario`, type-only).

Types that stay in THIS repo because they're runtime-shaped (coupled to a running loop): `Validator<Output,Verdict>` (coupled to `ValidationCtx`), `AgentRunSpec`, `OutputAdapter`, `Driver`, `LoopResult`, `Program`/`ProgramResult`, `RuntimeRunHandle`.

**Where does a type live?** Does the concept make sense WITHOUT a running agent loop? Yes → substrate (agent-eval). No → runtime (here). When in doubt, lean substrate.

## Code map — the loop kernel & topology (src/loops/)

- `run-loop.ts` — `runLoop`, the topology-agnostic kernel. Per round: `driver.plan()`→N tasks→one sandbox/iteration (bounded by `maxConcurrency`, round-robin `agentRuns`)→`streamPrompt`→`output.parse`→`validator.validate`→`driver.decide`. Owns iteration accounting, concurrency, abort, cost+token aggregation, trace emission, box teardown. Exports `defaultSelectWinner` (best-valid-score, ties→earliest) — single-sourced selection.
- `program.ts` — the Program op-set `{sample,steer,fork,parallel,select,seq,stop}` + `runProgram` tree executor + `runAgent`. Two parallelisms: **worker-layer** `fork`/`sample(n)` (N attempts in one fanout round of one loop); **loop-layer** `parallel{branches:Program[]}` (N concurrent multi-round SUB-LOOPS). `compileProgram` fails loud on `parallel` and on select-after-parallel. `isStraightLine` gates which executor runs.
- `types.ts` — `Driver`/`AgentRunSpec`/`OutputAdapter`/`Validator`/`Iteration`/`LoopResult`/`ExecCtx`/`LoopSandboxClient` + the `LoopTraceEvent` union.
- `drivers/dynamic.ts` — `createDynamicDriver` (agent authors topology via a `TopologyPlanner`); `PlannerContext.analyses` is the analyst→driver wire; `assertTraceDerivedFindings` is the steer-firewall (selector≠judge). `drivers/sandbox-planner.ts` is the live LLM-backed planner. `loop-dispatch.ts` adapts `runLoop`→agent-eval campaigns; `report-usage.ts` forwards token usage so the integrity guard sees a real backend.

Headline entrypoints: `runAgentTask`/`runAgentTaskStream` (`src/run.ts`), the multi-agent conversation engine (`src/conversation/`), `handleChatTurn` (`src/durable/`), the named delegated loops (`src/loop-runner.ts`).

## Commands

- `pnpm run lint` (Biome — **not** `npx biome`), `pnpm run build`, `pnpm test`, `pnpm run typecheck`. Tests live next to code and under `tests/`; the loops kernel is covered by `tests/loops/`.
- **Publish gotcha (Tangle obfuscate step):** never give a module-global `const` an UPPERCASE-prefixed name — the obfuscator (`--rename-globals false`) trips `pnpm pack`/verify-dist on a banned UPPERCASE pattern. (e.g. `SIDECAR_PERMISSION_KEYS` → `CANONICAL_PERMISSION_KEYS`.) Lowercase or rename module-globals.
- Verify with the dedicated tools (Edit/Read errors if a change failed) — don't re-read files just to confirm an edit landed.

## Self-improvement state & discipline (.evolve/ + the gate)

This repo is the empirical home of the RSI/learning-flywheel thesis, but **mechanism is not evidence**. The binding question is the **gate**: *does any non-blind topology beat blind compute at EQUAL k, under a deployable (non-oracle) selector, on a domain with a correctable middle band, at significant n (paired-bootstrap + BH)?*

Live science state lives in `.evolve/current.json` + memory (read them for the numbers; they update each generation). The durable shape as of this writing: within-run **steering loses** at equal compute (rung-0, controlled n=40); **more-compute wins** (random@k > blind); **driver/topology headroom on coding ≈ 0** (no correctable middle band); the recursive `runProgram` mechanism shipped (#141) but **moved no metric, by design**. The parallel-**diverse-strategies** vs blind gate is still **untested** — that's the open question, distinct from the within-run-steer family rung-0 falsified.

**Process discipline (the anti-patterns that have bitten this repo):**
- **Don't build mechanism ahead of the gate.** Per-branch adaptive sub-agents, learned planners, the outer flywheel — all wait for a *positive* gate result. Expressiveness was the closed gap; the open one is evidentiary.
- **Don't re-run a settled measurement.** The instrument already returned 0 coding-headroom (3 runs) and steering-loses on FinSearchComp. Read the dated controlled-result memory note before proposing to "test if steering helps" again.
- **Estimate cost before launch.** cells × per-cell-time / concurrency. A cell is a multi-min rollout; GEPA multiplies it (POP×GENS×cells). FinSearchComp-over-sandbox ≈ 3hr/run with ~14% stream-drop loss — budget it or use the offline corpus / local gate (conc≤2).
- **Confounds before causal claims.** Never claim a win where treatment got more compute than control. Isolate via refine@k vs random@k at EQUAL k; exclude infra-errored cells; report the discordant count; apply BH across arms; prefer deterministic-judge domains. Run the cheapest decisive check first.
- **No overclaim.** "Validates the concept" ≠ "validates the product." Route through the real kernel (`runLoop` + `createDynamicDriver` + judge-as-`Validator`) to claim the product. Underpowered splits (n≈20) are not wins. The earlier "+20pp steering proven" was confounded compute — a cautionary precedent.

## Memory discipline

Persistent memory must hold the **code-map** and the **evidence ledger**, not just conclusions — so the next agent starts with the map, not a blank slate. When you finish a generation or learn a durable fact, record: the gen/state pointer (what shipped, what `current.json`'s goal is now), where the relevant code lives + the one-line command to run it, and the evidence ledger (what's proven/disproven with the numbers + run id). When two notes conflict, the **dated controlled-result note supersedes a stale optimistic update** — cross-check the ⭐ notes and `current.json` rather than trusting an inline "moonshot answered" block. Keep `bench/HARNESS.md`, `.evolve/current.json`, and memory mutually consistent.

## House rules (repo deltas over global ~/.claude/AGENTS.md — don't restate the globals)

- **No AI-attribution trailers** (`Co-Authored-By:` or any tool line) on commits, PRs, or artifacts in this repo — including subagent output. Author = the human running the session.
- **No historical narrative in the source tree.** Comments say what the code does and why, never what it replaced or which audit found a bug (`// fix for the silent-zero bug` ✗). History belongs in commits/PRs. Applies to docstrings, READMEs, this file.
- **No fallbacks; fail loud.** No silent zeros, no `?? default` on required fields, no `try/catch { return null }` that erases diagnostics, no back-compat mode defaulted on for new code. External-boundary calls (LLM, network, FS, subprocess) return typed outcomes (`{ succeeded, value, error }`) — inspect `succeeded` before `value`. Named, opted-in fallback rotations (`policy.fallbackModels`) are fine; deep `?? "kimi"` helpers are not.
