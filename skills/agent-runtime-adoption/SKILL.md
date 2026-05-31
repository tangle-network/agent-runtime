---
name: agent-runtime-adoption
description: Adopt @tangle-network/agent-runtime in a product — the driven-loop kernel (runLoop), topology drivers (refine / fanout-vote / dynamic agent-authored), the loopDispatch campaign bridge, MCP delegation, and identity-gated prompt-surface optimization (optimizePrompt). Self-contained; needs only the published package + @tangle-network/agent-eval. Use when wiring runLoop, choosing a topology driver, optimizing a system/planner prompt, or exposing delegation tools.
---

# agent-runtime adoption — driven loops, topology drivers, prompt optimization

`@tangle-network/agent-runtime` is the task-lifecycle skeleton: it owns the loop
kernel and orchestration seams; it delegates domain behavior (models, tools,
scoring) to adapters you supply. It depends on `@tangle-network/agent-eval`
(substrate); never the reverse. This skill is self-contained — you need only the
two published packages.

## Principle

The kernel owns iteration accounting, concurrency, abort, cost/token aggregation,
and trace emission. It does NOT own *what the agent runs* (sandbox SDK + profile),
*how output is decoded* (output adapter), *how it's scored* (validator), or
*topology* (driver). Keep those four as injected seams — do not fork the kernel.

**Fail loud.** External-boundary calls return typed outcomes; a `null` sandbox
client, a `null` output adapter return, or a malformed planner move must throw,
never silently produce a `{0,0}` cell the integrity guard reads as a stub.

## The Driver seam — `runLoop` + topology

`runLoop({ driver, agentRun | agentRuns, output, validator?, task, ctx })` runs
each iteration: `driver.plan(task, history) → Task[]` → per task spawn a sandbox
on an `AgentRunSpec.profile` + `streamPrompt` → `output.parse(events)` →
`validator?.validate(...)` → `driver.decide(history)`. Terminal decisions:
`'stop' | 'pick-winner' | 'fail' | 'done'`. Returns
`LoopResult { decision, iterations, winner, costUsd, tokenUsage }`.

A `Driver<Task, Output, Decision>` is just `plan(task, history) → Task[]`
(`[task]`→refine, N copies→fanout, `[]`→stop) + `decide(history) → Decision`.
Topology is data; the kernel is topology-agnostic.

### Three shipped drivers — `@tangle-network/agent-runtime/loops`

- **`createRefineDriver({ maxIterations?, refineTask? })`** — one task/iteration,
  validator-gated; replay or rewrite the task until valid or capped. Use for
  incremental patches, document revision, anything monotonic.
- **`createFanoutVoteDriver({ n, selector? })`** — N parallel attempts in
  iteration 0, score once, pick the winner (default: highest valid score). Use
  for multi-harness coder fanout, redundant research with disagreement detection.
- **`createDynamicDriver({ planner, maxIterations?, maxFanout? })`** — **the
  agent authors the topology.** `plan`/`decide` are backed by an injected
  `TopologyPlanner` that emits one `TopologyMove` per round
  (`{kind:'refine',task}` | `{kind:'fanout',tasks}` | `{kind:'stop'}`). The
  planner is invoked once per round in `plan()`; `decide()` reads the cached move
  so an LLM planner is never double-called. Use when the right shape is
  task-dependent (scout-then-fanout, refine-then-branch, decompose).

Topology is **orthogonal to harness**: a driver returns `Task[]`; the kernel
round-robins `agentRuns[]` to decide which harness (claude-code / codex /
opencode / pi) runs each branch. One driver spans all backends, including
fanning a single round across several.

### Wiring an LLM planner — `createSandboxPlanner`

```ts
import { createDynamicDriver, createSandboxPlanner, runLoop } from '@tangle-network/agent-runtime/loops'

const planner = createSandboxPlanner<Task, Out>({
  client, profile: plannerProfile,          // any harness; cheap model is fine
  decodeTask: (raw) => raw as Task,          // envelope task → domain Task
  // buildPrompt?  — defaults to a history-summary prompt; override to customize
})
const result = await runLoop({
  driver: createDynamicDriver({ planner, maxIterations: 8 }),
  agentRuns: workerSpecs, output, validator, task, ctx: { sandboxClient: client },
})
```

The planner emits a JSON envelope (`{ kind, tasks?, n?, rationale }`); a missing,
unparseable, or unknown-kind envelope throws `PlannerError` — the loop never runs
a topology nobody chose.

### Driver gotchas

- `runLoop` validates `ctx.sandboxClient.create` exists or throws
  `ValidationError`. Never stub a `null` client.
- The kernel emits `loop.started / iteration.dispatch / iteration.ended /
  decision / ended` via `ctx.traceEmitter`. Wire it to the same OTLP sink as the
  chat path so loop telemetry is queryable.
- The output adapter MUST return a typed value or throw. A `null`/`undefined`
  return silently drops the iteration from scoring.
- Dynamic driver: set the kernel's `runLoop` `maxIterations >=` the driver's so
  the driver's cap governs and the loop closes on a clean `'done'`.

## Campaign bridge — `loopDispatch` / `loopCampaignDispatch`

To run `runLoop` as an agent-eval campaign cell, do NOT hand-build the ExecCtx +
forward trace + report usage every time (the third is silent — forgetting it
yields a `{0,0}` cell `assertRealBackend` reads as a stub). Use the adapter:

```ts
import { loopCampaignDispatch } from '@tangle-network/agent-runtime/loops'
const dispatch = loopCampaignDispatch({
  sandboxClient,
  toLoopOptions: (scenario) => ({ driver, agentRun, output, validator, task: toTask(scenario) }),
  // toArtifact? — defaults to result.winner?.output
})
// pass `dispatch` to runCampaign / runEvalCampaign; usage + trace are auto-forwarded
```

`loopDispatch` is the `runProfileMatrix` variant (profile is an axis).

## Identity-gated prompt optimization — `optimizePrompt`

`@tangle-network/agent-runtime/improvement`. The text-surface entry point onto
agent-eval's `runImprovementLoop` — sibling to `improvementDriver` (the
code/worktree path). Optimizes any prompt surface (system / planner / judge
rubric) and is **identity-gated by construction**: it runs evals, proposes
candidates (default driver `gepaDriver`), and the held-out gate compares
candidate vs baseline. `result.prompt` is the **baseline unless the gate decided
`'ship'`** — so registering a prompt for optimization can never regress it; it
only improves when held-out data earns it.

```ts
import { optimizePrompt } from '@tangle-network/agent-runtime/improvement'
const { prompt, improved, decision, delta } = await optimizePrompt({
  baselinePrompt: CURRENT_SYSTEM_PROMPT,
  runWithPrompt: (prompt, scenario, ctx) => runYourThing(prompt, scenario),  // sandbox / runLoop / direct call
  scenarios, holdoutScenarios, judges, runDir,
  reflection: { llm, model: REFLECTION_MODEL },   // builds the default gepaDriver
  // gate? — defaults to heldOutGate; pass defaultProductionGate for red-team hardening
})
// use `prompt` unconditionally: it's the baseline until a candidate genuinely wins
```

### optimizePrompt gotchas — read before wiring

- **`gepaDriver` mutates TEXT only**, and its only structural guard is `##` H2
  headings (`preserveSections`) + `maxSentenceEdits`. Make load-bearing sections
  of your prompt real `##` headings, and treat the output schema as fixed code —
  GEPA optimizes the prose, never the envelope/contract.
- **Scenarios must be domain-real.** Derive them from the surface's own traces /
  ground truth, not from unrelated corpora. Cross-domain examples are noise.
- **Extend, don't fork.** If the product already wires `runImprovementLoop`
  (e.g. for a main-agent prompt), add the new surface as another target in that
  harness rather than bolting on a second optimizer.
- `runWithPrompt` is the only domain seam — the optimizer never assumes how a
  prompt runs. Report cost via `ctx.cost` inside it so the integrity guard sees
  real activity.
- A live run needs a real backend (`TANGLE_API_KEY` / router, or local
  cli-bridge) and real spend; it is not free.

## MCP delegation — `@tangle-network/agent-runtime/mcp`

`agent-runtime-mcp` (stdio) exposes delegation tools (`delegate_code`,
`delegate_research`, …) that drive `runLoop` behind the scenes (refine or
fanout-vote per `variants`). Env: `TANGLE_API_KEY`, `SANDBOX_BASE_URL`,
`TANGLE_FLEET_ID` (sibling vs fleet placement), `MCP_CODER_FANOUT_HARNESSES`.
Mount it on a production `AgentProfile.mcp`; do not re-implement delegation.

## Acceptance checklist

- [ ] Topology is a `Driver`, not hard-coded control flow. Reuse refine /
      fanout-vote / dynamic; build a custom `Driver` against
      `loops/types.ts:Driver` only when none fit — never fork the kernel.
- [ ] `runLoop` is bridged to campaigns via `loopDispatch` / `loopCampaignDispatch`
      (usage + trace auto-forwarded), not a hand-rolled ExecCtx.
- [ ] Every optimizable prompt is registered through `optimizePrompt` (or the
      product's existing `runImprovementLoop`), identity-gated on a held-out set.
- [ ] Boundaries fail loud: no `null` sandbox client, no silent adapter return,
      no unguarded planner envelope.

For the full self-improving pipeline (trace sink → analyst loop → scorecard →
production loop → CI), see the broader `agent-eval-adoption` skill.
