# Glossary — the canonical vocabulary

> **In plain terms:** This page is a dictionary of the exact words this codebase uses for the moving parts of running agents — driver, worker, iteration, rollout, and so on. It's for anyone reading or writing code in this package, especially newcomers who keep tripping over words that sound interchangeable but aren't. The one thing to take away: when two terms seem to mean the same thing, this page tells you which one to use, and every definition links to the real line of code so you can check it yourself.

**Track:** reference · **Role:** canonical (terms). One definition per concept, grounded to `file:line`. When a term has drifted into synonyms, the **canonical** word is marked and the synonyms are listed as "avoid / say X instead". If code and this file disagree, the code wins — fix this file the same turn (the anti-staleness law, `CLAUDE.md`).

Two substrates run the same "recursive agent decision" atom — the round-synchronous `runAgentRounds` and the reactive `Scope`/`Supervisor`. Terms below note which substrate they belong to; several are shared.
`runAgentRounds` is distinct from `runToolLoop`/`streamToolLoop` in `/tool-loop`, which run ONE chat turn and fold its tool calls back in.

## The execution units (most-confused — read first)

| Term | Canonical meaning | Anchor | Not |
|---|---|---|---|
| **Iteration** | ONE `driver.plan → dispatch → output.parse → validator.validate → driver.decide` cycle. The kernel's official accounting unit; trace events are `loop.iteration.*`. | `types.ts:119` (`Iteration`), `run-loop.ts` (the loop body) | not a "rollout" (that's what happens *inside* it); not a "turn" |
| **Round** | Informal synonym for **iteration**. **Avoid — say "iteration".** | docstrings only | — |
| **Rollout** | ONE agent execution in a box: one `streamPrompt` (or one executor `execute`) producing an answer/patch/artifact. The **worker's** unit, nested *inside* one iteration. | `sandbox-run.ts:30` ("a SINGLE rollout") | NOT the driver↔worker round (that's an iteration); a fanout iteration contains N rollouts |
| **Attempt** | A rollout as the steer/analyst sees it (its output + verdict + trace). Same event, steer-side view. | `bench/src/sandbox-run.ts:39` (`SteerHistory`) | — |
| **Turn** | One prompt→response over a persistent session (multi-turn `resume`). Conversation/`openSandboxRun` term, not the kernel-loop unit. | `sandbox-run.ts` (`TurnResult`, `resume`) | not an iteration |

**The nesting, stated once:** a **driver↔worker round is an _iteration_**; what the worker *does* in it is a **_rollout_**; a fanout iteration has many rollouts; the steer reading a past rollout calls it an **_attempt_**.

## The roles

| Term | Meaning | Anchor |
|---|---|---|
| **Driver** | Owns topology. `plan(task, history) → Task[]` (1 = refine, N = fanout, 0 = stop) and `decide(history) → Decision`. The authority on what runs next. **Live and central.** | `types.ts:138` |
| **Worker** | The agent run dispatched within an iteration (round-robin over `agentRuns`). "worker box", "finished worker". **Live term.** | `run-loop.ts:88,107` (`AgentRunSpec` `types.ts:67`) |
| **Validator** | Owns scoring: `validate(output) → Verdict {valid, score}`. The judge. Selector ≠ judge: the driver selects, the validator judges. | `types.ts:52` |
| **OutputAdapter** | Owns event-stream decode: `parse(events) → Output`. | `types.ts:105` |
| **Analyst** | An `Agent.act` over the trace that returns a steer (never reads the verdict — the steer firewall). `llmAnalyst` (one router call); a strategy reads it via `ctx.critique`. | `bench/src/sandbox-run.ts:58` (`llmAnalyst`); firewall `personify/analyst.ts` (`assertTraceDerivedFindings`) |

**The vocabulary law (ends the overload):** "driver" and "worker" are roles of one `Agent`, so "driver↔worker loop" must always be qualified by **timescale** — inference (within a run) vs optimization (across runs). A benchmark is an **adapter**; the thing that picks the answer is the **selector**, never the judge.

## Topology (how the shape grows — by LLM decision, not a fixed script)

The shape grows by LLM decision through the **coordination toolbox** over a live `Scope`: the driver `AgentProfile` calls `spawn_agent` (branch), `await_event` (react), `steer_agent` (interrupt), `stop` — and `runAgentic`/`defineStrategy` package the common depth/breadth shapes on the Supervisor.

| Term | Meaning | Anchor |
|---|---|---|
| **Strategy** (`sample`/`refine`) | A `defineStrategy(name, body)` value run through the Supervisor as one recursive `Agent.act`: `sample` = breadth/best-of-N, `refine` = depth/iterate-with-feedback. The harness-verified topology, NOT a fixed script. | `strategy.ts` (`defineStrategy`, `sample`, `refine`) |
| **Coordination toolbox** | The driver's per-step move set as MCP tools over a live `Scope`: `spawn_agent` (branch N) · `await_event` (react) · `steer_agent` (interrupt) · `observe_agent` · `stop`. This **is** "topology grown through LLM decisions". | `mcp/tools/coordination.ts` (`createCoordinationTools`) |
| **AnalystFn / `critique`** | `(history, task?) → correction`. The firewalled steer — trajectory in, never the score. `llmAnalyst` (one router call); the strategy author calls it via `ctx.critique`. | `bench/src/sandbox-run.ts:50,58` (`llmAnalyst`); `strategy.ts` (`ctx.critique`) |

## The executor port (the unified execution seam)

| Term | Meaning | Anchor |
|---|---|---|
| **Executor** | The OPEN port that runs one unit of work: `execute → ExecutorResult | AsyncIterable<UsageEvent>`, optional `deliver` (steer inbox), `teardown`, `resultArtifact`. BYO agents implement this directly. (was `LeafExecutor`.) | `supervise/types.ts:69` |
| **createExecutor** | The ONE built-in: `createExecutor({backend: 'router'|'bridge'|'cli'|'sandbox', …seam})` — backend as **data**, not an import. Per-backend bodies are internal case-arms. | `supervise/runtime.ts` |
| **SandboxClient** | The box-shaped structural contract (`create → box.streamPrompt → delete`, optional sessions/fs/fork). What `runAgentRounds` drives. (was `LoopSandboxClient`.) | `types.ts` (`SandboxClient`) |
| **inlineSandboxClient** | The ONE adapter presenting any non-box `Executor` as a `SandboxClient`, so `runAgentRounds` drives router/bridge/BYO without re-faking a box. | `inline-sandbox-client.ts` |
| **openSandboxRun** | The one run/stream/**resume** seam over a persistent box (sessions + fs-artifact deliverables). | `sandbox-run.ts` |

## Budget & accounting

| Term | Meaning | Anchor |
|---|---|---|
| **Budget** | A ceiling envelope on a spawn/root: `{maxIterations, maxTokens, maxUsd?, deadlineMs?}`. (Keystone substrate.) `deadlineMs` is currently classify-only, does not fire an abort — known gap. | `supervise/types.ts:189` |
| **Spend** | Conserved actual cost reconciled from `UsageEvent`s: `{iterations, tokens, usd, ms}`. Tokens and usd are separate channels, never folded. | `supervise/types.ts:198` |
| **BudgetPool / ReservationTicket** | The **conserved reservation pool**: each spawn *reserves* against the root then settles to actual `Spend`. This is what makes **equal-compute hold by construction** (the anti-confound invariant for the gate). | `supervise/budget.ts:48,29` |
| **UsageEvent** | The normalized usage increment every executor emits, so the pool meters all runtimes identically. | `supervise/types.ts:120` |
| `runAgentRounds`'s budget | Only `maxIterations` (count) + `maxConcurrency` (in-flight cap) + per-`Iteration` cost aggregation. The rigorous reservation pool is the keystone's, not `runAgentRounds`'s. | `run-loop.ts:88` |

## Agent-to-agent

| Term | Meaning | Anchor |
|---|---|---|
| **Agent.act** | The recursive atom: `act(task, scope) → Out`. A driver IS an `act` that spawns into its `scope`; replay-safe. The Supervisor calls `root.act(task, scope)`. | `supervise/types.ts:50`; `supervisor.ts:145` |
| **Coordination toolbox ("Scope-as-MCP")** | The operator/driver verbs exposed as MCP tools over a live `Scope`: `spawn_agent`→`scope.spawn`, `await_event`→`scope.next` (the wake event), `steer_agent`→`scope.send` (chat/interrupt a running child), `observe_agent`→`scope.view`, `stop`, `list_analysts`/`run_analyst`. **Built + tested**, public on the `./mcp` subpath. This is how an LLM driver spawns and talks to its sub-agents. | `mcp/tools/coordination.ts`; tests `tests/kernel/coordination.test.ts` |
| **Scope.send / deliver** | The "steer a live worker" verb the toolbox's `steer_agent` binds to: `scope.send(nodeId, msg)` → child executor's `deliver()` inbox. **In-process binding is real**; the cross-box (A2A) binding is task #13. | `supervise/scope.ts:290` |
| **Agent Bus / A2A** | The cross-process agent↔agent transport for the same verbs — **designed, not adopted**. The in-process toolbox works today; this is the unfinished edge. | task #13; `docs/agent-bus-protocol.md` |

**One agent CALLING another** today = the coordination toolbox (`spawn_agent`/`steer_agent`/`await_event`) over a live `Scope`, in-process — real and tested. The cross-box transport (A2A) is the thin part. The dominant *control* model is **topology-by-LLM-decision** (the driver's coordination-tool moves, packaged as `runAgentic`/`defineStrategy` shapes). `src/conversation/` is multi-*turn*, not agent-to-agent.
