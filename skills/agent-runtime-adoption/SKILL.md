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

### Topology — `@tangle-network/agent-runtime/loops`

Topology is the **one recursive agent tree**: each round an agent decides to refine, fan out, spawn a sub-agent, or stop — and a spawned child can itself be a driver. The surfaces:

- **`refine` / `loopUntil`** — one attempt/round, validator-gated; iterate over
  one evolving artifact until valid or budget-capped. Use for incremental
  patches, document revision, anything monotonic.
- **`sample` / `fanout`** — N attempts at equal budget, score once, pick the
  winner via the single-sourced selector. Use for multi-harness coder fanout,
  redundant research with disagreement detection.
- **`runAgentic({ surface, task, mode|strategy, budget })`** /
  **`defineStrategy(name, body)`** — author the topology as a `Strategy` on the
  keystone `Supervisor`. `runAgentic` runs a built-in `mode` (`'depth'`→refine,
  `'breadth'`→sample) or a custom `strategy`; `defineStrategy` composes
  `ctx.shot()` (one harness-scored attempt) + `ctx.critique()` (the firewalled
  analyst — trajectory in, never scores) in ~15 lines. Equal-k holds by
  construction; the body is harness-re-verified, so an authored strategy can't
  fabricate a win. Use when the right shape is task-dependent (scout-then-fanout,
  refine-then-branch, decompose).
- **`createCoordinationTools`** (from `@tangle-network/agent-runtime/mcp`) — the
  agent-driving-agent loop: a driver agent spawns / steers / awaits child agents
  (and sub-drivers) through MCP verbs over a live `Scope`, recursively. Use when a
  driver should reason about and orchestrate its workers in natural language. From
  `/loops` the equivalent surfaces are `serveCoordinationMcp` (the verbs as an HTTP
  MCP over a live `Scope`) and the offline `driverAgent`.

Topology is **orthogonal to harness** — a strategy decides the shape; the executor
decides which harness (claude-code / codex / opencode / pi / router) runs each
node. One driver spans all backends.

### Authoring an agent-chosen topology — `runAgentic` / `defineStrategy`

The agent authors its own topology by composing two firewalled steps inside a
`Strategy` on the keystone `Supervisor` — `ctx.shot()` (one harness-scored worker
attempt over an artifact) and `ctx.critique()` (the analyst — trajectory in,
never scores). `runAgentic` runs it over one `AgenticSurface` on a conserved
budget pool, so equal-k holds by construction.

```ts
import { runAgentic, defineStrategy } from '@tangle-network/agent-runtime/loops'

const sampleThenRefine = defineStrategy('sampleThenRefine', async (ctx) => {
  const h = await ctx.surface.open(ctx.task)
  let best = await ctx.shot({ handle: h })                 // one breadth attempt
  for (let i = 1; i < ctx.budget && best && best.score < 1; i++) {
    const steer = await ctx.critique(best.messages)        // analyst — trajectory only
    if (!steer) break
    best = await ctx.shot({ handle: h, messages: best.messages, steer })
  }
  await ctx.surface.close(h)
  return { score: best?.score ?? 0, resolved: (best?.score ?? 0) >= 1, completions: 0, progression: [], shots: 0 }
})

const result = await runAgentic({ surface, task, strategy: sampleThenRefine, budget: 4 })
```

The deliverable score is **harness-verified** — computed from the shots the
harness actually brokered and scored via `surface.score()`, never the value the
(possibly authored) body returns; an authored strategy can only report what its
real shots achieved. For an LLM driving *another* agent through MCP verbs (the
agent-driving-agent loop), expose `createCoordinationTools` over a live `Scope`
(see the recursive-driver section below) instead of authoring a fixed strategy.

### Driver gotchas

- `runLoop` validates `ctx.sandboxClient.create` exists or throws
  `ValidationError`. Never stub a `null` client.
- Build that client with `resolveSandboxClient({ backend })` (from
  `@tangle-network/agent-runtime/loops`) — the one call that selects the sandbox /
  bridge (cli-bridge) / router transport `runLoop` drives; do not hand-construct it.
  Its sibling `resolveAgentBackend` is a DIFFERENT resolver — it resolves the CHAT
  leg (`runChatThroughRuntime` / `runAgentTaskStream`) and returns an
  `AgentExecutionBackend`, not a feeder for `resolveSandboxClient`.
- The kernel emits `loop.started / iteration.dispatch / iteration.ended /
  decision / ended` via `ctx.traceEmitter`. Wire it to the same OTLP sink as the
  chat path so loop telemetry is queryable.
- The output adapter MUST return a typed value or throw. A `null`/`undefined`
  return silently drops the iteration from scoring.
- Dynamic driver: set the kernel's `runLoop` `maxIterations >=` the driver's so
  the driver's cap governs and the loop closes on a clean `'done'`.

## Campaign bridge — `loopCampaignDispatch` / `loopDispatch`

To run `runLoop` as an agent-eval campaign cell, do NOT hand-build the ExecCtx +
forward trace + report usage every time (the third is silent — forgetting it
yields a `{0,0}` cell `assertRealBackend` reads as a stub). Use the bridge. Both
are exported from `src/runtime/index.ts` and are distinct sibling adapters, NOT a
rename: `loopCampaignDispatch` returns a `DispatchFn` for plain `runCampaign` /
`runEvalCampaign`; `loopDispatch` returns a `ProfileDispatchFn` and is the
`runProfileMatrix` variant (it adds the profile axis).

```ts
import { loopCampaignDispatch } from '@tangle-network/agent-runtime/loops'
const dispatch = loopCampaignDispatch({
  sandboxClient,
  toLoopOptions: (scenario, profile) => ({ driver, agentRun, output, validator, task: toTask(scenario) }),
  // toArtifact? — defaults to result.winner?.output
})
// pass `dispatch` to runCampaign / runEvalCampaign; usage + trace are auto-forwarded
```

For the common shape — a fixed set of `cases` + a `prompt` builder + a `score`
fn, swept across profiles — prefer the declarative facade
`defineLeaderboard({ cases, prompt, score })` (from
`@tangle-network/agent-runtime/loops`). It composes
`expandProfileAxes × loopDispatch × naiveDriver` into one call, exposes
`.run(argv?)` (CLI-flag parsing + matrix) and `.toBenchmarkAdapter()`, and yields
a ranked leaderboard. Reach for raw `loopDispatch` only when a cell needs a custom
driver/validator.

## Identity-gated optimization — agent-runtime's `improve()` (facade over agent-eval's `selfImprove`)

**Start with `improve()`** — the one pluggable RSI verb, exported at the
`@tangle-network/agent-runtime` package ROOT (its own header: "the ONE public,
surface-pluggable RSI verb. A thin facade over agent-eval's `selfImprove`"). Real
signature is 3-arg, NOT a single options object:

```ts
improve<TScenario, TArtifact>(
  profile: AgentProfile,
  findings: unknown[],
  opts: ImproveOptions,
): Promise<ImproveResult>
```

`opts`: `surface?: 'prompt'|'skills'|'tools'|'mcp'|'hooks'|'code'` (default
`'prompt'`), `scenarios`, `judge`, `agent`, `gate?: 'holdout'|'none'` (default
`'holdout'`; `'none'` forces `generations = 0`), plus `budget?` / `llm?` /
`generator?` / `code?` / `skills?` / `runDir?`. It picks the default proposer for
the surface (`gepaProposer` for `'prompt'`, `skillOptProposer` for `'skills'`;
`'code'`/`'tools'`/`'mcp'`/`'hooks'` throw `ConfigError` unless you pass
`opts.generator` or `opts.code`), extracts the baseline from the profile, runs
`selfImprove` with the held-out gate, and on a ship verdict writes the winner back
into the profile field. Returns `ImproveResult { profile, shipped, lift,
gateDecision, raw }` — deploy with `if (out.shipped) deploy(out.profile)`:

```ts
import { improve } from '@tangle-network/agent-runtime'
const out = await improve(profile, findings, {
  surface: 'prompt', scenarios, judge, agent, gate: 'holdout', llm,
})
if (out.shipped) deploy(out.profile)
```

**Drop to `selfImprove`** (`@tangle-network/agent-eval/contract`) only when you
need finer control — a custom proposer/gate, or the code-surface git-worktree path
via agent-runtime's `improvementDriver` (`/improvement`), which you pass to it as
`proposer` to optimize CODE instead of a string. `selfImprove` optimizes any
text/config surface (system / planner / judge rubric) and is **identity-gated by
construction**: it runs evals, proposes candidates (default proposer
`gepaProposer`), and a held-out gate ships a winner only if it beats the baseline.
`result.winner.surface` is the **baseline unless `result.gateDecision === 'ship'`**
— so registering a surface for optimization can never regress it; it only improves
when held-out data earns it.

```ts
import { selfImprove } from '@tangle-network/agent-eval/contract'
const result = await selfImprove({
  baselineSurface: CURRENT_SYSTEM_PROMPT,
  agent: (surface, scenario, ctx) => runYourThing(surface, scenario),  // sandbox / runLoop / direct call
  scenarios,
  judge,
  budget: { holdoutScenarios, generations: 3, populationSize: 2 },
  llm: { baseUrl, apiKey, model: REFLECTION_MODEL },   // drives the default gepaProposer
  // proposer? — pass agent-runtime's improvementDriver to optimize CODE (worktree) instead of a string
  // gate?   — defaults to a held-out gate; pass defaultProductionGate for red-team hardening
})
// use result.winner.surface unconditionally: it's the baseline until a candidate genuinely wins
```

### selfImprove gotchas — read before wiring

- **`gepaProposer` mutates TEXT only**, and its only structural guard is `##` H2
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

- [ ] Topology is a combinator/`Strategy`, not hard-coded control flow. Reuse
      `refine`/`loopUntil`, `sample`/`fanout`, or author one with
      `runAgentic`/`defineStrategy` (or `createCoordinationTools` for an
      agent-driving-agent loop) — never fork the kernel.
- [ ] `runLoop` is bridged to campaigns via `loopDispatch` (usage + trace
      auto-forwarded), not a hand-rolled ExecCtx.
- [ ] Every optimizable prompt is registered through `selfImprove` (or the
      product's existing `runImprovementLoop`), identity-gated on a held-out set.
- [ ] Boundaries fail loud: no `null` sandbox client, no silent adapter return,
      no unguarded planner envelope.

For the full self-improving pipeline (trace sink → analyst loop → scorecard →
production loop → CI), see the broader `agent-eval-adoption` skill.
