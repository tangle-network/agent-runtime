---
name: agent-runtime-adoption
description: Adopt @tangle-network/agent-runtime in a product — the driven-loop kernel (runLoop), topology drivers (refine / fanout-vote / dynamic agent-authored), the loopDispatch campaign bridge, MCP delegation, and the code-surface improvementDriver for agent-eval's selfImprove (the optimization entry point). Self-contained; needs only the published package + @tangle-network/agent-eval. Use when wiring runLoop, choosing a topology driver, optimizing a system/planner prompt or code surface, or exposing delegation tools.
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

### Topology drivers — `@tangle-network/agent-runtime/loops`

> **Stale-name correction (gen-6 consolidation, #165):** the standalone
> `createRefineDriver` / `createFanoutVoteDriver` factories were **removed** —
> refine/fanout collapsed into the one recursive agent tree. Canonical today:
> the personify combinators `loopUntil`(depth/refine) / `fanout`(breadth/vote)
> and the `Strategy` values `refine` / `sample`, plus `createDriver` for an
> agent-authored topology. Verify names in `src/runtime/index.ts`; see
> `build-with-agent-runtime` + `docs/canonical-api.md` §3.1/§3.3 for the live
> signatures. Likewise `createSandboxPlanner` is gone — pass a `TopologyPlanner`
> to `createDriver({ planner })` directly.

- **`refine` / `loopUntil`** — one attempt/round, validator-gated; iterate over
  one evolving artifact until valid or budget-capped. Use for incremental
  patches, document revision, anything monotonic. (Replaces `createRefineDriver`.)
- **`sample` / `fanout`** — N attempts at equal budget, score once, pick the
  winner via the single-sourced selector. Use for multi-harness coder fanout,
  redundant research with disagreement detection. (Replaces `createFanoutVoteDriver`.)
- **`createDriver({ planner, maxIterations?, maxFanout? })`** — **the
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

### Wiring an LLM planner — inject a `TopologyPlanner`

`createDriver({ planner })` takes an injected `TopologyPlanner` (the standalone
`createSandboxPlanner` factory was removed in the gen-6 consolidation — verify
the live shape in `src/runtime/driver.ts` / `src/runtime/index.ts`). The planner
is the brain (it may call any harness/LLM to author the move); the driver maps
each `TopologyMove` onto kernel structure.

```ts
import { createDriver, runLoop, type TopologyPlanner } from '@tangle-network/agent-runtime/loops'

const planner: TopologyPlanner<Task, Out> = {/* plan() → one {kind:'refine'|'fanout'|'stop',…} per round */}
const result = await runLoop({
  driver: createDriver({ planner, maxIterations: 8 }),
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

## Campaign bridge — `loopDispatch`

To run `runLoop` as an agent-eval campaign cell, do NOT hand-build the ExecCtx +
forward trace + report usage every time (the third is silent — forgetting it
yields a `{0,0}` cell `assertRealBackend` reads as a stub). Use the one bridge,
`loopDispatch` (the old `loopCampaignDispatch` name was consolidated away; verify
in `src/runtime/index.ts`):

```ts
import { loopDispatch } from '@tangle-network/agent-runtime/loops'
const dispatch = loopDispatch({
  sandboxClient,
  toLoopOptions: (scenario, profile) => ({ driver, agentRun, output, validator, task: toTask(scenario) }),
  // toArtifact? — defaults to result.winner?.output
})
// pass `dispatch` to runCampaign / runEvalCampaign; usage + trace are auto-forwarded
```

`loopDispatch` doubles as the `runProfileMatrix` variant (the `profile` arg is an axis).

## Identity-gated optimization — agent-eval's `selfImprove`

The optimization entry point is **`selfImprove`** (`@tangle-network/agent-eval/contract`),
NOT agent-runtime — agent-runtime contributes the code-surface `improvementDriver`
(`/improvement`, the git-worktree path) you pass to it as `driver` to optimize CODE
instead of a string. `selfImprove` optimizes any text/config surface (system /
planner / judge rubric) and is **identity-gated by construction**: it runs evals,
proposes candidates (default driver `gepaDriver`), and a held-out gate ships a winner
only if it beats the baseline. `result.winner.surface` is the **baseline unless
`result.gateDecision === 'ship'`** — so registering a surface for optimization can
never regress it; it only improves when held-out data earns it.

```ts
import { selfImprove } from '@tangle-network/agent-eval/contract'
const result = await selfImprove({
  baselineSurface: CURRENT_SYSTEM_PROMPT,
  agent: (surface, scenario, ctx) => runYourThing(surface, scenario),  // sandbox / runLoop / direct call
  scenarios,
  judge,
  budget: { holdoutScenarios, generations: 3, populationSize: 2 },
  llm: { baseUrl, apiKey, model: REFLECTION_MODEL },   // drives the default gepaDriver
  // driver? — pass agent-runtime's improvementDriver to optimize CODE (worktree) instead of a string
  // gate?   — defaults to a held-out gate; pass defaultProductionGate for red-team hardening
})
// use result.winner.surface unconditionally: it's the baseline until a candidate genuinely wins
```

### selfImprove gotchas — read before wiring

- **`gepaDriver` mutates TEXT only**, and its only structural guard is `##` H2
  headings (`preserveSections`) + `maxSentenceEdits`. Make load-bearing sections
  of your prompt real `##` headings, and treat the output schema as fixed code —
  GEPA optimizes the prose, never the envelope/contract.
- **Scenarios must be domain-real.** Derive them from the surface's own traces /
  ground truth, not from unrelated corpora. Cross-domain examples are noise.
- **Extend, don't fork.** If the product already wires `selfImprove` /
  `runImprovementLoop` (e.g. for a main-agent prompt), add the new surface as
  another target in that harness rather than bolting on a second optimizer.
- `agent` is the only domain seam — the optimizer never assumes how a surface
  runs. Report cost via `ctx.cost` inside it so the integrity guard sees real activity.
- A live run needs a real backend (`TANGLE_API_KEY` / router, or local
  cli-bridge) and real spend; it is not free.

## MCP delegation — `@tangle-network/agent-runtime/mcp`

`agent-runtime-mcp` (stdio) exposes delegation tools (`delegate_code`,
`delegate_research`, …) that drive `runLoop` behind the scenes (refine or
fanout-vote per `variants`). Env: `TANGLE_API_KEY`, `SANDBOX_BASE_URL`,
`TANGLE_FLEET_ID` (sibling vs fleet placement), `MCP_CODER_FANOUT_HARNESSES`.
Mount it on a production `AgentProfile.mcp`; do not re-implement delegation.

## Acceptance checklist

- [ ] Topology is a `Driver`/combinator, not hard-coded control flow. Reuse
      `refine`/`loopUntil`, `sample`/`fanout`, or the agent-authored `createDriver`;
      build a custom `Driver` against `loops/types.ts:Driver` only when none fit —
      never fork the kernel.
- [ ] `runLoop` is bridged to campaigns via `loopDispatch` (usage + trace
      auto-forwarded), not a hand-rolled ExecCtx.
- [ ] Every optimizable prompt is registered through `selfImprove` (or the
      product's existing `runImprovementLoop`), identity-gated on a held-out set.
- [ ] Boundaries fail loud: no `null` sandbox client, no silent adapter return,
      no unguarded planner envelope.

For the full self-improving pipeline (trace sink → analyst loop → scorecard →
production loop → CI), see the broader `agent-eval-adoption` skill.
