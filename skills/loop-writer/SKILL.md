---
name: loop-writer
description: Author clean recursive agent loops on @tangle-network/agent-runtime. Use for defineLoop, Pi/sandbox driver orchestration, fanout, trace analysts, verifiers/judges, question escalation, live messages, and self-improving loop recipes.
---

# loop-writer

Design the smallest loop that can honestly solve the objective. Start with
`defineLoop(...).run(task)`. Reach lower only when the loop needs a real runtime
primitive.

## Mental Model

```txt
user -> Pi/top driver -> supervisor loop -> sandbox driver -> worker -> leaf harness
```

Each level may spawn below, wait below, analyze below, steer below, and escalate
questions upward. The substrate owns budget, trace, abort, journal, and replay;
the driver owns strategy.

## Blessed Surface

```ts
const loop = defineLoop({
  name: 'secure-build',
  async run(task, ctx) {
    // use conversations, Scope, runLoop, MCP tools, sandboxes, or delegated loops
    await ctx.record({ source: 'worker-a', output, trace, verdict })
    return output
  },
  analysts: [traceCompleteness],
  verifier: executableGate,
  judge: heldOutScore,
  questionPolicy: 'failClosed',
})

const result = await loop.run(task)
```

Use `loop.start(task)` when Pi/root needs `handle.control.send(...)`, live
artifact snapshots, or trace snapshots while the loop runs.

Read `docs/loop-authoring.md` before changing the public API. See
`examples/define-loop/` for the current developer example.

## Pick The Shape

| Objective | Shape |
|---|---|
| Try N independent attempts, pick best | `fanout` / best-of-n |
| Research several angles then synthesize | `fanout + synthesize` |
| Build through ordered stages | `pipeline` |
| Improve until executable check passes | `loopUntil + verifier` |
| Review one artifact from several perspectives | `panel` |
| Simulated user/product-agent eval | `defineConversation` + `runConversation` inside `defineLoop` |
| Driver decides topology dynamically | `dynamicLoopRunner`, `createDriver`, or sandbox driver with coordination tools |
| Mutate a shared codebase | git branch/clone loop with typed merge outcomes |

If `pipeline` or `fanout` solves the objective, do not use a dynamic driver.

## Use Existing Primitives

- **Conversations**: `defineConversation` + `runConversation`.
- **Direct substrate**: `Agent.act(task, scope)` + supervisor/`Scope`.
- **Driven sandbox loop**: `runLoop` + `createDriver` + `Validator`.
- **Sandbox driver tools**: `createCoordinationTools` exposes
  `spawn_worker`, `await_next`, `observe_worker`, `steer_worker`,
  `list_questions`, `answer_question`, `ask_parent`, `stop`, and optional
  analyst tools.
- **Trace DB audits**: `runAnalystLoop` / agent-eval trace stores.

Do not create a parallel runtime. `defineLoop` only records the outer envelope:
artifacts, events, findings, questions, messages, verifier, judge, blockers,
timing, and output.

## Evaluator Placement

- **Verifier**: executable shippability gate. It returns `DefaultVerdict` and
  controls `result.ok`.
- **Judge**: held-out score only. It runs after the loop body and must never
  steer the current loop.
- **Analyst**: trace-derived diagnosis after `ctx.record(...)` or final. It may
  emit findings, questions, messages, or blockers.
- **Driver/reviewer**: consumes evidence and chooses continue, steer, spawn,
  answer, escalate, or stop.

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
`failClosed` for production or eval loops.

## Message Policy

Do not steer every worker. Send live messages only when:

- an analyst finds a concrete mistake in a running worker
- a loop is duplicating work, drifting, or wasting budget
- a parent/Pi answers a blocking question
- a verifier reveals a specific fix a running worker can still use

Every message records `delivered`, `queued`, or `rejected`. If no router is
wired, the correct outcome is `queued`.

## Workspace Loops

For codebase-mutating loops, git is the durable workspace seam:

- one branch/clone per worker
- explicit commit per worker
- typed merge result: `merged | conflict | stale-base | rejected | verifier-failed`
- resume derives completion from git state, not only a side journal
- conflicting edits become blockers/questions, not silent overwrite

Until cloud branch/merge conflict handling is proven, only claim serial
git-accumulation, not parallel migration safety.

## Authoring Rules

- Keep the loop body boring async code.
- Record meaningful products with `ctx.record(...)`.
- Emit extra facts with `ctx.event(...)` only when they are useful for trace
  slicing or UI replay.
- Reuse `Scope.send`, MCP coordination, runtime hooks, topology view, journals,
  `Validator`, and agent-eval trace stores instead of inventing replacements.
- Stop only after verifier success or an explicit blocker/no-winner result.
- Bubble questions upward instead of guessing.
- Optimize prompts/skills/drivers only against real verifier/judge outcomes and
  trace evidence.

## Minimal Recipe

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
        if (event.type !== 'turn_end') return
        await ctx.record({
          source: event.turn.speaker,
          label: `${event.turn.speaker} turn ${event.turn.index}`,
          kind: 'conversation-turn',
          output: event.turn.text,
          trace: { turn: event.turn },
        })
      },
    })
    return result
  },
  verifier: executableGate,
  judge: heldOutJudge,
})
```

## Final Check

- Does every meaningful worker/subloop/conversation result become an artifact?
- Are verifier, judge, analyst, and driver roles separated?
- Can blocking questions move up the chain?
- Can Pi/parent send messages without bypassing verification?
- Is workspace mutation transactional if workers edit shared code?
- Can `selectLoopTrace` isolate agents, pairwise interactions, and the full run?
- Is the loop small enough that an agent can author it without inventing hidden
  substrate behavior?
