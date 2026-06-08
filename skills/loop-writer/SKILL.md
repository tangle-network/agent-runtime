---
name: loop-writer
description: Author and run clean recursive agent loops on @tangle-network/agent-runtime. Use when a user asks to build loops, defineLoop/LoopCtx surfaces, Pi/sandbox driver orchestration, driver-worker fanout, trace analysts, verifiers/judges/reviewers, question escalation, live messages, or self-improving loop recipes.
---

# loop-writer

Design the smallest loop that can honestly solve the objective. The blessed
developer surface is `defineLoop(...).run(task)`; use lower-level primitives
inside the loop body only when the objective needs them.

## Mental Model

The stack is a command chain:

```txt
user -> Pi/top driver -> supervisor loop -> sandbox driver -> worker -> leaf harness
```

Each level may spawn below, wait below, analyze below, steer below, and escalate
questions upward. The substrate owns budget, trace, abort, journal, and replay;
the driver owns strategy.

## Blessed Surface

Start here:

```ts
const loop = defineLoop({
  name: 'secure-build',
  run: async (task, ctx) => {
    // use conversations, Scope, MCP tools, sandbox runs, or delegated loops
    // record each worker/subloop/conversation turn with ctx.packet(...)
    return output
  },
  analysts: [traceCompleteness],
  verifier: executableGate,
  judge: heldOutScore,
  questionPolicy: 'failClosed',
})

const result = await loop.run(task, { onEvent })
```

Use `loop.start(task)` when Pi/root needs a live handle for
`handle.control.send(...)`, packet snapshots, or trace snapshots while the loop
runs.

Read `docs/loop-authoring.md` when making public API or evaluator-placement
decisions. See `examples/define-loop/` for the current developer example.

## Pick The Loop Shape

Choose by objective:

| Objective | Shape |
|---|---|
| Try N independent attempts, pick best | `fanout` / best-of-n |
| Research several angles then synthesize | `fanout + synthesize` |
| Build through ordered stages | `pipeline` |
| Improve until executable check passes | `loopUntil + verifier` |
| Review one artifact from several perspectives | `panel` |
| Simulated user/product-agent eval | `defineConversation` + `runConversation` inside `defineLoop` |
| Driver decides topology dynamically | `dynamicLoopRunner` or sandbox driver with coordination tools |
| Mutate a shared codebase | workspace-backed loop only; require transactional branch/merge semantics |

If the objective can be solved by `pipeline` or `fanout`, do not use a dynamic
driver. Dynamic drivers are for genuinely task-dependent topology.

## Lower-Level Primitives

Use one of these inside `defineLoop`, never a parallel homemade runtime:

- **Conversations**: `defineConversation` + `runConversation` for simulated
  user/product-agent evals and multi-agent turn-taking.
- **Direct substrate**: `Agent.act(task, scope)` + `createSupervisor().run(...)`
  for deterministic recursive work and typed `Scope` control.
- **Sandbox driver**: prompt a driver agent and give it coordination tools:
  `spawn_worker`, `await_next`, `observe_worker`, `steer_worker`,
  `list_questions`, `answer_question`, `ask_parent`, plus analyst tools when
  wired. Use when the driver itself is an agent inside a sandbox.
- **Trace DB audits**: `runAnalystLoop` / agent-eval analyst registries for
  arbitrary trace-store analysis and cross-run diffs.

Every path should record the same outer shape: a `LoopRunResult` with packets,
trace graph, events, findings, questions, messages, verifier, judge, blockers,
and output.

## Evaluator Placement

Keep these roles separate:

- **Verifier**: checks an artifact/run can ship. Prefer executable checks:
  tests, typecheck, lint, real API calls, deterministic oracle. A verifier
  returns a verdict object and gates `result.ok`.
- **Judge**: held-out scoring/promotion only. It runs after the loop body and
  must never steer the current loop. Use for GEPA/HALO/autoresearch,
  release comparisons, and skill/prompt optimization.
- **Trace analyst**: runs after every worker/subloop packet. Reads trace and
  output behavior, emits findings and possible questions. It may steer because
  it is trace-derived, not judge-derived.
- **Loop analyst**: runs over a group/tree of `LoopPacket`s. Finds topology
  problems: duplicated work, missing verifier, stuck worker, overspent fanout,
  conflicting workspace edits, unresolved questions.
- **Reviewer/driver**: consumes verdicts + analyst findings + questions and
  decides the next move: continue, steer, spawn, answer, escalate, or stop.

## Question Protocol

Questions are first-class blockers, not prose hidden in output.

```ts
type LoopQuestion = {
  id: string
  from: string
  level: 'worker' | 'driver' | 'loop'
  question: string
  reason: string
  urgency: 'continue-without' | 'blocks-step' | 'blocks-run'
}
```

Default policy:

- A child asks the parent first.
- The parent answers if it has enough context.
- The parent escalates to Pi/user when answering would invent requirements.
- A loop with unresolved `blocks-run` questions must not report clean success.

Use `mustDecide` when a driver must answer/defer/escalate explicitly. Use
`failClosed` for production or eval loops. Wire `onEvent` when a parent/Pi
needs push-based question, packet, and trace ingestion instead of polling.

## Message Policy

Do not steer every worker. Let workers finish unless one of these fires:

- trace analyst finds a concrete mistake in a running worker
- loop analyst sees duplication, drift, budget waste, or stale assumptions
- parent/Pi answers a blocking question
- verifier reveals a specific fixable failure and a running worker can still use it

`kind: 'steer'` is a message to the worker inbox, not a replacement for verification.
Every message must record delivery as `delivered`, `queued`, or `rejected`.
If no message router is wired, the correct outcome is `queued`, not fake
delivery. If `steer_worker` returns `delivered: false`, spawn a new worker or
wait; do not pretend the message landed.

## Workspace Loops

For codebase-mutating loops, a shared filesystem is not a substrate. Require a
workspace handle with durable git semantics:

- one branch/clone per worker
- explicit commit per worker
- typed merge result: merged | conflict | stale-base | rejected
- resume derives completion from git state, not only a side journal
- conflicting edits become blockers/questions, not silent overwrite

Until branch/merge conflict handling is proven, only claim serial
git-accumulation, not parallel migration safety.

## Authoring Rules

- Keep the loop body boring async code; put complexity in reusable shapes and
  evaluator seams.
- Every worker/subloop/conversation turn settlement becomes a `ctx.packet(...)`.
- Run trace and loop analysis through `analysts` on `defineLoop`; when using
  sandbox coordination tools, wire `analysts.auto` and `analyzePacket` so
  findings, questions, and messages land on the packet.
- Put automatic trace analysts under `analysts.auto`; use `run_analyst` only
  when the driver needs an extra manual lens.
- Stop only after verifier success or an explicit no-winner/blocker result.
- Bubble questions upward instead of guessing.
- Optimize prompts/skills/drivers with GEPA/HALO/autoresearch only against real
  verifier/judge outcomes and packet traces.

## Minimal Developer Recipe

```ts
const loop = defineLoop({
  name: 'agentic-product-eval',
  questionPolicy: 'failClosed',
  analysts: [traceCompleteness],
  async run(task, ctx) {
    const conversation = defineConversation(...)
    const result = await runConversation(conversation, {
      seed: task.goal,
      runId: ctx.runId,
      onEvent: async (event) => {
        if (event.type === 'turn_end') {
          await ctx.packet({
            nodeId: event.turn.speaker,
            label: `${event.turn.speaker} turn ${event.turn.index}`,
            kind: 'conversation-turn',
            status: 'done',
            output: event.turn.text,
            trace: { turn: event.turn },
          })
        }
      },
    })
    return result
  },
  verifier: executableGate,
  judge: heldOutJudge,
})

const result = await loop.run(task)
```

Treat this as the starting point. Reach for MCP coordination only when the
driver itself must be an agent using tools inside a sandbox.

## Final Check

Before shipping a loop:

- Does every spawned worker/subloop produce a packet?
- Are verifier, judge, analyst, and reviewer roles separated?
- Can blocking questions move up the chain?
- Can Pi/parent send messages without bypassing verification?
- Is workspace mutation transactional if any worker edits shared code?
- Can `selectLoopTrace` isolate individual agents, pairwise interactions, and
  the full loop?
- Is the loop small enough that an agent can author it without inventing hidden
  substrate behavior?
