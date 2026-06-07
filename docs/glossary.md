# Glossary — the canonical vocabulary

**Track:** reference · **Role:** canonical (terms). One definition per concept, grounded to `file:line`. When a term has drifted into synonyms, the **canonical** word is marked and the synonyms are listed as "avoid / say X instead". If code and this file disagree, the code wins — fix this file the same turn (the anti-staleness law, `CLAUDE.md`).

Two substrates run the same "recursive agent decision" atom — the round-synchronous `runLoop` and the reactive `Scope`/`Supervisor`. Terms below note which substrate they belong to; several are shared.

## The execution units (most-confused — read first)

| Term | Canonical meaning | Anchor | Not |
|---|---|---|---|
| **Iteration** | ONE `driver.plan → dispatch → output.parse → validator.validate → driver.decide` cycle. The kernel's official accounting unit; trace events are `loop.iteration.*`. | `types.ts:104` (`Iteration`), `run-loop.ts` (the loop body) | not a "rollout" (that's what happens *inside* it); not a "turn" |
| **Round** | Informal synonym for **iteration**. **Avoid — say "iteration".** | docstrings only | — |
| **Rollout** | ONE agent execution in a box: one `streamPrompt` (or one executor `execute`) producing an answer/patch/artifact. The **worker's** unit, nested *inside* one iteration. | `sandbox-run.ts:30` ("a SINGLE rollout") | NOT the driver↔worker round (that's an iteration); a fanout iteration contains N rollouts |
| **Attempt** | A rollout as the steer/arm sees it (its output + verdict + trace). Same event, steer-side view. | `experiment.ts:73` (`SteerHistory`) | — |
| **Turn** | One prompt→response over a persistent session (multi-turn `resume`). Conversation/`openSandboxRun` term, not the kernel-loop unit. | `sandbox-run.ts` (`TurnResult`, `resume`) | not an iteration |

**The nesting, stated once:** a **driver↔worker round is an _iteration_**; what the worker *does* in it is a **_rollout_**; a fanout iteration has many rollouts; the steer reading a past rollout calls it an **_attempt_**.

## The roles

| Term | Meaning | Anchor |
|---|---|---|
| **Driver** | Owns topology. `plan(task, history) → Task[]` (1 = refine, N = fanout, 0 = stop) and `decide(history) → Decision`. The authority on what runs next. **Live and central.** | `types.ts:123` |
| **Worker** | The agent run dispatched within an iteration (round-robin over `agentRuns`). "worker box", "finished worker". **Live term.** | `run-loop.ts:88,107` (`AgentRunSpec` `types.ts:61`) |
| **Validator** | Owns scoring: `validate(output) → Verdict {valid, score}`. The judge. Selector ≠ judge: the driver selects, the validator judges. | `types.ts:46` |
| **OutputAdapter** | Owns event-stream decode: `parse(events) → Output`. | `types.ts:90` |
| **Analyst** | An `Agent.act` over the trace that returns a steer (never reads the verdict — the steer firewall). `llmAnalyst` (one call) / `loopAnalyst` (a sub-loop). | `experiment.ts` (`AnalystFn`); firewall `personify/analyst.ts` (`assertTraceDerivedFindings`) |

## Topology (how the shape grows — by LLM decision, not a fixed script)

| Term | Meaning | Anchor |
|---|---|---|
| **TopologyMove** | The driver's per-iteration decision, a union: `refine` (continue one) · `fanout` (branch N) · `select` (pick a winner) · `stop`. This union **is** "topology grown through LLM decisions". | `driver.ts:52` |
| **TopologyPlanner** | `(ctx) → TopologyMove`. The injected function the driver calls each round; the LLM authors the move here. | `driver.ts:89` |
| **createDriver** | Builds a `Driver` from a `TopologyPlanner` (+ optional analyst/completion). (was `createDynamicDriver`.) | `driver.ts` |
| **Arm** | A labelled topology for an experiment = a `Steer` wrapped in the shared stop/topology shell. `randomArm` (no steer = compute control), `refineArm`, `analystArm`, `diverseArm`. | `experiment.ts:85` |
| **Steer** | `(rootPrompt, history, round) → nextPrompt`. The one thing that varies between arms — "the optimizable core". | `experiment.ts:82` |

## The executor port (the unified execution seam)

| Term | Meaning | Anchor |
|---|---|---|
| **Executor** | The OPEN port that runs one unit of work: `execute → ExecutorResult | AsyncIterable<UsageEvent>`, optional `deliver` (steer inbox), `teardown`, `resultArtifact`. BYO agents implement this directly. (was `LeafExecutor`.) | `supervise/types.ts:69` |
| **createExecutor** | The ONE built-in: `createExecutor({backend: 'router'|'bridge'|'cli'|'sandbox', …seam})` — backend as **data**, not an import. Per-backend bodies are internal case-arms. | `supervise/runtime.ts` |
| **SandboxClient** | The box-shaped structural contract (`create → box.streamPrompt → delete`, optional sessions/fs/fork). What `runLoop` drives. (was `LoopSandboxClient`.) | `types.ts` (`SandboxClient`) |
| **inlineSandboxClient** | The ONE adapter presenting any non-box `Executor` as a `SandboxClient`, so `runLoop` drives router/bridge/BYO without re-faking a box. | `inline-sandbox-client.ts` |
| **openSandboxRun** | The one run/stream/**resume** seam over a persistent box (sessions + fs-artifact deliverables). | `sandbox-run.ts` |

## Budget & accounting

| Term | Meaning | Anchor |
|---|---|---|
| **Budget** | A ceiling envelope on a spawn/root: `{maxIterations, maxTokens, maxUsd?, deadlineMs?}`. (Keystone substrate.) `deadlineMs` is currently classify-only, does not fire an abort — known gap. | `supervise/types.ts:189` |
| **Spend** | Conserved actual cost reconciled from `UsageEvent`s: `{iterations, tokens, usd, ms}`. Tokens and usd are separate channels, never folded. | `supervise/types.ts:198` |
| **BudgetPool / ReservationTicket** | The **conserved reservation pool**: each spawn *reserves* against the root then settles to actual `Spend`. This is what makes **equal-compute hold by construction** (the anti-confound invariant for the gate). | `supervise/budget.ts:48,29` |
| **UsageEvent** | The normalized usage increment every executor emits, so the pool meters all runtimes identically. | `supervise/types.ts:120` |
| `runLoop`'s budget | Only `maxIterations` (count) + `maxConcurrency` (in-flight cap) + per-`Iteration` cost aggregation. The rigorous reservation pool is the keystone's, not `runLoop`'s. | `run-loop.ts:88` |

## Agent-to-agent

| Term | Meaning | Anchor |
|---|---|---|
| **Agent.act** | The recursive atom: `act(task, scope) → Out`. A driver IS an `act` that spawns into its `scope`; replay-safe. The Supervisor calls `root.act(task, scope)`. | `supervise/types.ts:50`; `supervisor.ts:145` |
| **Coordination toolbox ("Scope-as-MCP")** | The operator/driver verbs exposed as MCP tools over a live `Scope`: `spawn_worker`→`scope.spawn`, `await_next`→`scope.next` (the wake event), `steer_worker`→`scope.send` (chat/interrupt a running child), `observe_worker`→`scope.view`, `stop`, `list_analysts`/`run_analyst`. **Built + tested**, public on the `./mcp` subpath. This is how an LLM driver spawns and talks to its sub-agents. | `mcp/tools/coordination.ts`; tests `tests/loops/coordination.test.ts` |
| **Scope.send / deliver** | The "steer a live worker" verb the toolbox's `steer_worker` binds to: `scope.send(nodeId, msg)` → child executor's `deliver()` inbox. **In-process binding is real**; the cross-box (A2A) binding is task #13. | `supervise/scope.ts:290` |
| **Agent Bus / A2A** | The cross-process agent↔agent transport for the same verbs — **designed, not adopted**. The in-process toolbox works today; this is the unfinished edge. | task #13; `docs/agent-bus-protocol.md` |

**One agent CALLING another** today = the coordination toolbox (`spawn_worker`/`steer_worker`/`await_next`) over a live `Scope`, in-process — real and tested. The cross-box transport (A2A) is the thin part. The dominant *control* model is still **topology-by-LLM-decision** (the driver's `TopologyMove`). `src/conversation/` is multi-*turn*, not agent-to-agent.
