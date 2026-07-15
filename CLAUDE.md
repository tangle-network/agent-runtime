# agent-runtime

Shared task-lifecycle skeleton for domain agents, generated agents, red-team harnesses, and coding agents. Standardizes the lifecycle (`runAgentTask`, `runAgentTaskStream`, the round-synchronous loop kernel `runLoop`, and the recursive execution atom `Scope`/`Supervisor`) and the self-improvement spine on top of it (driver→worker topology, trace-analyst findings, eval-gated ship); delegates all domain behavior to adapters.

Imports `@tangle-network/agent-eval` for the control loop, knowledge-readiness scoring, and run-record types. Does NOT own domain policy, models, tools, connectors, UI, or the optimizer/corpus/judge substrate.

> **This file is the timeless contract — pointers, not state.** No gate numbers, no "as of this writing", no run ids, no evidence claims, no session/generation status. Those live in `.evolve/current.json` (live state) and `memory/` (the evidence ledger); link to them, never inline them here. If you catch yourself writing a number or a result into this file, it belongs in one of those instead.

## Reporting results in plain language — the agent-profile frame

The global style rule (lead with the answer, define every term, no stacked jargon) lives in `~/.claude/AGENTS.md`. This is the project's glossary that rule points to — translate every result into these words, never the raw harness terms.

**The one-sentence frame:** we are making an agent **self-improve across its whole profile** — the parts that make it what it is. Every experiment turns ONE of these knobs; every result says which knob, and whether the agent measurably solved more problems on tasks it never practiced on.

| Profile lever | Plain meaning | "improving it" = |
|---|---|---|
| **prompt** | the agent's standing instructions | reword/restructure what we tell it |
| **skills** | reusable how-to notes injected into it | add a written tactic ("check state first") |
| **tools** | the actions it's allowed to take | grant/build the right actions (or an **MCP** = a server that hands it tools/data) |
| **memory / RAG** | what it can recall or look up | give it a notebook / a search-the-docs ability |

**Say the right column, never the left:**
- "holdout" → "the held-back exam — fresh problems it never practiced on, so a good score isn't memorization."
- "the screen / train set" → "the practice problems."
- "certified candidate" → "an option that passed the practice round."
- "compose / stack the certified set" → "give it all the passing options at once."
- "baseline" → "the agent's default setup — what we measure against."
- "marginal lift" → "extra points this one change earns on its own."
- "equal-k / compute-matched" → "same amount of work both times, so it's a fair test."
- "the gate / significant" → "beat the default by enough that it isn't luck."

## Orient first — read these, don't re-derive the repo from source

This repo's bottleneck is agents paying a **re-discovery tax**: re-reading 15 files to rebuild a mental model that already exists. Before exploring, read, in order:

0. **`docs/canonical-api.md`** — THE API reference + anti-reinvention decision table ("I want to ___ → use ___ → NOT ___"). The genome→run→optimize→gate spine, the recursive atom (persona=driver, `spawnChild`=worker|sub-driver, isolated|`Workspace` artifact, conserved sub-budgets, analyst dimensions+gaps), every signature `file:line`-verified. **Read before writing ANY orchestration/optimization/measurement code** — if you're about to write `runConversation`, a "skill optimizer", a "profile-seam", or a `new Sandbox(...)` loop, it already exists. **§1.5 is the AgentProfile law we keep forgetting:** an agent IS its full profile (prompt+skills+tools+mcp+subagents+hooks); you change behavior by AUTHORING the profile and letting the sandbox substrate materialize it into harness shapes — never write a verify-loop or harness-specific config (self-verification is a hook/process, not code; opencode is only the cli-bridge test target — generalize, never specialize).
1. **`docs/architecture.md`** — the canonical spine (one recursive `Agent` atom; two timescales; benchmark-as-adapter; selector≠judge). Wins on any architecture conflict. `docs/README.md` indexes the rest; `docs/roadmap-rsi.md` is the dependency-ordered build plan; `docs/architecture-interpretations.md` defines **the decision gate**.
   **`docs/agent-managed-compute/README.md`** is the active audit and implementation plan for distributed coordination, provider-backed workers, recovery, and run-API convergence.
2. **`bench/HARNESS.md`** — the experiment-harness map: commands, the `rollout → corpus → selector → CI → gate` data flow, the wired/needs-creds/scaffolded matrix, and run-the-gate-in-2-lines. Read it before touching `bench/`.
3. **`.evolve/current.json`** — the single source of truth for the active goal + generation + the live science state. Then `.evolve/progress.md` and the newest `.evolve/pursuits/*.md`.
4. **Persistent memory** (`MEMORY.md` + the `memory/` notes) — the code-map and the evidence ledger. Start with the map; verify it, don't rebuild it.

**The anti-staleness law:** these maps are kept short and code-adjacent. If a map disagrees with the code, the **code wins** — fix the map in the *same* turn. Discovery is paid once, by whoever records it. When you learn something undocumented, write it to the map/memory before moving on. **For `docs/canonical-api.md` this is now ENFORCED, not aspirational:** the mechanical leaves (per-symbol signatures + `file:line`) are GENERATED into `docs/api/` by TypeDoc — never hand-edit them — and a CI freshness gate (`pnpm docs:check` → `scripts/check-docs-freshness.mjs`) turns a stale version pin, a broken `file:line` citation, or a decision-table symbol that no longer exists into a RED BUILD. The judgment layer (§2 decision table, when-to-use, every "Do NOT") stays hand-curated and the gate never touches it. Local fix path on a red docs gate: `pnpm run docs:api` then commit, or fix the cited line — see `docs/MAINTAINING.md`.

## Repo layering

- `agent-interface` owns portable contracts.
- `agent-eval` depends on `agent-interface` and owns evaluation data and decisions.
- `agent-knowledge` depends on `agent-interface` and `agent-eval`, and never on this runtime.
- `agent-runtime` depends on those lower packages and composes optional knowledge workflows from `src/knowledge/`.

**Rule: lower packages MUST NOT import from agent-runtime.** No `peerDependencies` in `agent-eval` or `agent-knowledge` pointing here, and no `import type { X } from '@tangle-network/agent-runtime'` inside either package. A spotted upward import is a bug. Move a portable contract into `agent-interface`, an evaluation concept into `agent-eval`, or inject runtime behavior through a callback.

`agent-eval` is declared a required `peerDependency` here.
Keep its range aligned with the APIs the runtime consumes.
`agent-knowledge` is a direct dependency because `src/knowledge/improvement-job.ts` provides the batteries-included composition, while the pure knowledge package remains independently usable.

Substrate primitives CONSUMED from agent-eval: `DefaultVerdict`, `RunRecord`, `AgentEvalError` + taxonomy, `AnalystFinding`/`AnalystRunResult`/`FindingsDiff`, `TraceAnalystKindSpec`, `KnowledgeReadinessReport`, and the campaign types (`DispatchContext`/`ProfileDispatchFn`/`Scenario`, type-only).

Types that stay in THIS repo because they're runtime-shaped (coupled to a running loop): `Validator<Output,Verdict>` (coupled to `ValidationCtx`), `AgentRunSpec`, `OutputAdapter`, `Driver`, `LoopResult`, `Program`/`ProgramResult`, `RuntimeRunHandle`.

**Where does a type live?** Does the concept make sense WITHOUT a running agent loop? Yes → substrate (agent-eval). No → runtime (here). When in doubt, lean substrate.

## Code map — the loop kernel & the recursive atom (src/runtime/)

- `run-loop.ts` — `runLoop`, the round-synchronous leaf kernel. Per round: `driver.plan()`→N tasks→one sandbox/iteration (bounded by `maxConcurrency`, round-robin `agentRuns`)→`streamPrompt`→`output.parse`→`validator.validate`→`driver.decide`. Owns iteration accounting, concurrency, abort, cost+token aggregation, trace emission, box teardown. Exports `defaultSelectWinner` (best-valid-score, ties→earliest) — the single-sourced selection the personify combinators reuse.
- `supervise/` — the recursive execution atom (keystone): `Scope` + `Supervisor` over the open `Executor` port, spawn/settle on a **conserved budget pool** so equal-compute holds by construction; the journal replays completed settlements, but live supervised-tree recovery after coordinator restart is not implemented. `runtime.ts` also holds `createExecutor({backend})` — the ONE built-in executor (backend-as-data: `router`/`router-tools`/`bridge`/`cli`/`sandbox`; `router-tools` is the off-box tool-using agentic loop — chat→tool_calls→`executeToolCall`→repeat — over the router's tool-calling, no sandbox); the per-backend bodies are internal case-arms, BYO agents implement `Executor` directly.
- `personify/` — the content-free generic combinators (`fanout`/`loopUntil`/`widen`/`panel`/`verify`/`pipeline`) + `definePersona`/`runPersonified` + the cross-run `Corpus` + `createScopeAnalyst` (the analyst-on-scope steer firewall).
- the **agent-driver** is the canonical "drive an agent" path: an `AgentProfile` driving another `AgentProfile` via the coordination toolbox (`createCoordinationTools`, `src/mcp/tools/coordination.ts`) over the `Scope`/`Supervisor`, plus `runAgentic`/`defineStrategy`/`runPersonified` (`strategy.ts`/`personify/persona.ts`) on the Supervisor. Child→parent messages ride ONE typed pipe — `createEventBus` (`supervise/event-bus.ts`): settled outputs, `ask_parent` questions, and analyst findings are all `CoordinationEvent` kinds, delivered pass-through (`subscribe`/`onEvent`, immediate) AND queued for the driver to pull (`await_event({kinds?})` — the ONE wait verb; `kinds:['settled']` = next finished worker, omit = also questions/findings). The pull queue is **priority-ordered** — a blocking question (urgency→priority: `blocks-run`=20/`blocks-step`=10) is bumped ahead of queued settles/findings; ties FIFO by `seq`. The bus is **bidirectional**: UP (settled/question/finding) is queued+pullable; DOWN (`steer_agent` for any live worker — instruction/correction/continuation; `answer_question` routes an answer down) goes to the child inbox via `scope.send`→`deliver` AND records a `queue:false` event (history + subscribers, never pulled back). The receive end is `createInbox` (`supervise/inbox.ts`), which the owned tool-loop executor (`routerToolsInlineExecutor`) exposes as `Executor.deliver`: QUEUED messages flush at each step boundary AND before the worker may settle (it can't finish with an unread steer); a FORCEFUL `steer_agent({interrupt:true})` aborts the in-flight turn so the worker re-plans immediately. Black-box CLI harnesses can't be interrupted mid-step, so there the down-leg degrades to the next spawn. Observability is first-class: every event both ways is stamped (`seq`/`at`/`priority`), the full `history()` is an audit/replay trail, `stats()` counts throughput (both surfaced on `CoordinationTools` and the MCP handle). `analyzeOnSettle` auto-fires trace analysts when a worker settles `done`, re-entering each result as a `finding` on the same bus (cost-governed opt-in; the firewall stays in the analyst registry). Trace analysis is **substrate- AND harness-agnostic** via `TraceSource` (`supervise/trace-source.ts`) — a worker's tool calls as agent-eval `ToolSpan`s from EITHER an owned loop (`createPushTraceSource`; `routerToolsInlineExecutor`'s `onToolStep` feeds `record`) OR a sandbox/fleet box (`sandboxSessionTraceSource(box, sessionId, {harness})` reads `box.messages()` session parts). Harness wire-shapes are decoded by a **per-harness adapter registry** (`toolPartDecoders`): `decodeOpencodePart` decodes against the **canonical `ToolPart`/`ToolState` published by `@tangle-network/agent-interface`** (the type every adc sdk-provider normalizes into — single source of truth, so a status adc adds/renames is a compile error here, not a silent miss; terminal-state + callId-dedup; also live-box-validated), `decodeAnthropicPart` (claude-code/kimi `{type:'tool_use', id|tool_use_id, name|tool, input}` confirmed vs `cli-bridge/src/backends/claude.ts`+`kimi.ts`), `decodeOpenAiPart` (router/kimi top-level `function`). **codex emits NO structured tool calls** (bridge `codex.ts` never yields `tool_calls` — text+shell only) → per-tool detection unavailable for codex from any path (harness property, not a gap). `decodeToolPart(part, harness?)` picks the adapter or tries all. Add a harness = add a decoder + one entry, validated against the cli-bridge backend. Two consumers ride a source: ONLINE `watchTrace` (`detector-monitor.ts`) folds live spans through agent-eval's published streaming kernel (`repeatedActionDetector`/`errorStreakDetector`, the SAME kernel `control-runtime` folds) → `onSignal` → a `finding`; SETTLE `analyzeTrace` (`trajectory-recorder.ts`) collects the spans and runs the published BATCH analyzers (`buildTrajectory`/`stuckLoopView`/`toolWasteView`). `ToolSpan` is the common currency; detection logic + the failure taxonomy live in agent-eval — never reimplement here. Production target = sandbox/fleet; the owned-loop push path is for local/router/cli-bridge. The in-process queue and a future cross-box durable mailbox share this one interface. `assertTraceDerivedFindings` (`personify/analyst.ts`) is the steer-firewall (selector≠judge). `types.ts` holds `Driver`/`AgentRunSpec`/`OutputAdapter`/`Validator`/`Iteration`/`LoopResult`/`SandboxClient` + the `LoopTraceEvent` union. `sandbox-run.ts` is `openSandboxRun` — the one run/stream/resume sandbox seam; `inline-sandbox-client.ts` is `inlineSandboxClient` — the one adapter presenting any non-box `Executor` as a `SandboxClient` for `runLoop`. `loop-dispatch.ts` adapts `runLoop`→agent-eval campaigns; `report-usage.ts` forwards token usage so the integrity guard sees a real backend.

Two substrates coexist for the same "recursive agent decision" atom: the round-synchronous `runLoop` kernel (the leaf, what most sandbox benches drive today) and the reactive `Scope`/`Supervisor`+combinators (the canonical core — the agent-driver, `runAgentic`/`defineStrategy`/`runPersonified`). Prefer the latter for new recursive/keystone work. Both run over the one `Executor` port.

Headline entrypoints: `runAgentTask`/`runAgentTaskStream` (`src/run.ts`), the multi-agent conversation engine (`src/conversation/`), `handleChatTurn` (`src/durable/`), the named delegated loops (`src/loop-runner.ts`).

## Commands

- `pnpm run lint` (Biome — **not** `npx biome`), `pnpm run build`, `pnpm test`, `pnpm run typecheck`. Tests live next to code and under `tests/`; the loops kernel is covered by `tests/loops/`.
- **Publish gotcha (Tangle obfuscate step):** never give a module-global `const` an UPPERCASE-prefixed name — the obfuscator (`--rename-globals false`) trips `pnpm pack`/verify-dist on a banned UPPERCASE pattern. (e.g. `SIDECAR_PERMISSION_KEYS` → `CANONICAL_PERMISSION_KEYS`.) Lowercase or rename module-globals.
- Verify with the dedicated tools (Edit/Read errors if a change failed) — don't re-read files just to confirm an edit landed.

## Self-improvement state & discipline (.evolve/ + the gate)

This repo is the empirical home of the RSI/learning-flywheel thesis, but **mechanism is not evidence**. The binding question is the **gate**: *does any non-blind topology beat blind compute at EQUAL k, under a deployable (non-oracle) selector, on a domain with a correctable middle band, at significant n (paired-bootstrap + BH)?*

**The live science state — every number, what's proven/disproven, the current goal — lives in `.evolve/current.json` + the `memory/` evidence ledger. Read them; do not mirror them here.** `docs/eval-substrate.md` holds the north star (the RSI runtime + its eval substrate) and the measurement non-negotiables.

**Process discipline:** stable build rules live in `docs/BUILDING.md`; named failure modes live in `docs/ANTI_PATTERNS.md`. `CLAUDE.md` is the bootloader, not the whole policy manual.

## Memory discipline

Persistent memory must hold the **code-map** and the **evidence ledger**, not just conclusions — so the next agent starts with the map, not a blank slate. When you finish a generation or learn a durable fact, record: the gen/state pointer (what shipped, what `current.json`'s goal is now), where the relevant code lives + the one-line command to run it, and the evidence ledger (what's proven/disproven with the numbers + run id). When two notes conflict, the **dated controlled-result note supersedes a stale optimistic update** — cross-check the ⭐ notes and `current.json` rather than trusting an inline "moonshot answered" block. Keep `bench/HARNESS.md`, `.evolve/current.json`, and memory mutually consistent.

## House rules (repo deltas over global ~/.claude/AGENTS.md — don't restate the globals)

- **No AI-attribution trailers** (`Co-Authored-By:` or any tool line) on commits, PRs, or artifacts in this repo — including subagent output. Author = the human running the session.
- **No historical narrative in the source tree.** Comments say what the code does and why, never what it replaced or which audit found a bug (`// fix for the silent-zero bug` ✗). History belongs in commits/PRs. Applies to docstrings, READMEs, this file.
- **No fallbacks; fail loud.** No silent zeros, no `?? default` on required fields, no `try/catch { return null }` that erases diagnostics, no back-compat mode defaulted on for new code. External-boundary calls (LLM, network, FS, subprocess) return typed outcomes (`{ succeeded, value, error }`) — inspect `succeeded` before `value`. Named, opted-in fallback rotations (`policy.fallbackModels`) are fine; deep `?? "kimi"` helpers are not.
