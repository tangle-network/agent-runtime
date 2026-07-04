---
name: loop-writer
description: Author clean recursive agent loops on @tangle-network/agent-runtime. Use for Scope/supervisor orchestration, runLoop, Pi/sandbox drivers, fanout, trace analysts, verifiers/judges, question escalation, live messages, and self-improving loop recipes.
---

# loop-writer

Design the smallest loop that can honestly solve the objective. The blessed
surface is the substrate: `fanout`/`pipeline` for fixed shapes, `runLoop` for
round-synchronous sandbox loops, and `Scope`/Supervisor for recursive
driver/worker trees. Do not create a second loop grammar.

## Mental Model

```txt
user -> Pi/root driver -> supervisor -> sandbox driver -> worker -> leaf harness
```

Each level may spawn below, wait below, analyze below, steer below, and escalate
questions upward. The substrate owns budget, trace, abort, journal, and replay.
The driver owns strategy.

## Pick The Primitive

| Objective | Use |
|---|---|
| Try N attempts, pick best | `fanout` (or the `sample` strategy) |
| Ordered stages | `pipeline` |
| Improve until executable check passes | `loopUntil` + verifier |
| Review from several lenses | `panel` |
| Simulated user/product eval | `defineConversation` + `runConversation` |
| Dynamic topology / drivers of drivers | `Scope` or sandbox driver + `createCoordinationTools` |
| **A coded multi-round loop spawned + steered like a worker** | `defineLoop` + `loopChild` (the loop atom) |
| Mutate a shared repo | git branch/clone loop with typed merge outcomes |

If a fixed combinator solves it, do not use a dynamic driver.

## Minimal Sandbox Loop

```ts
// runLoop takes a caller-supplied Driver directly (plan() → Task[]; decide() → terminal).
// `[task]` → refine, N copies → fanout, `[]` → stop. Keep it this small or use a Strategy.
const refineDriver: Driver<Task, Out, 'done' | 'fail'> = {
  name: 'refine',
  plan: async (task, history) => (history.at(-1)?.verdict?.valid ? [] : [task]),
  decide: (history) => (history.at(-1)?.verdict?.valid ? 'done' : 'fail'),
}

const trace: unknown[] = []
const result = await runLoop({
  driver: refineDriver,
  agentRun: agentRunSpec,
  output,
  validator: executableGate,
  task,
  ctx: {
    sandboxClient,
    traceEmitter: { emit: async (event) => trace.push(event) },
  },
})

const observation = await observe(
  {
    task: String(task),
    output: JSON.stringify(result.winner?.output ?? result.decision),
    trace,
    outcome: result.winner ? 'passed' : 'failed',
    runId,
  },
  { chat, model, corpus },
)
```

## Minimal Recursive Driver

```ts
const driver: Agent<Task, Output> = {
  name: 'secure-build-driver',
  async act(task, scope) {
    const spawned = scope.spawn(workerAgent, task, { budget: perWorker, label: 'worker-a' })
    if (!spawned.ok) throw new Error(spawned.reason)

    const settled = await scope.next()
    const observation = await observe(
      {
        task: String(task),
        output: JSON.stringify(settled),
        trace: [settled, scope.view],
        outcome: settled?.kind === 'done' ? 'passed' : 'failed',
        runId,
      },
      { chat, model, corpus },
    )

    const steer = observation.findings[0]?.recommended_action
    if (!steer) return synthesize(settled, observation)

    const correction = scope.spawn(workerAgent, { task, prior: settled }, {
      budget: perWorker,
      label: 'worker-corrected',
    })
    if (!correction.ok) throw new Error(correction.reason)
    if (!scope.send(correction.handle.id, { steer })) throw new Error('steer delivery failed')

    const fixed = await scope.next()
    return synthesize(fixed, observation)
  },
}

const result = await createSupervisor<Task, Output>().run(driver, task, supervisorOpts)
```

When the driver lives in a sandbox, expose the same verbs through
`createCoordinationTools`: `spawn_worker`, `await_event`, `observe_worker`,
`steer_worker`, `list_questions`, `answer_question`, `ask_parent`, `stop`, and
optional analyst tools.

## The Loop Atom — a coded loop spawned like a worker

When the loop itself is the reusable unit (a research loop, a verify loop, an
evolve loop), make it a spawnable atom instead of a hand-driver. `defineLoop`
authors the body; the runtime owns the round ceiling, the conserved budget, the
gate, and steer-between-rounds. A supervisor spawns / observes / steers it with
the SAME coordination verbs as a worker.

```ts
// The author writes ONE round (arbitrary code — may spawn children); the runtime
// iterates it up to maxRounds, stops the instant `check` passes, and folds any
// steer_agent message into the NEXT round's ctx.steer. Settles valid ⟺ check passed.
const research = defineLoop('two-agent-research', {
  maxRounds: 3,
  round: async ({ scope, round, steer }) => {
    const w = scope.spawn(researcher, { round, steer }, { budget: perRound, label: `r${round}` })
    if (!w.ok) throw new Error(w.reason)
    const found = await scope.next()               // conserved child work
    return { out: found, done: false }             // `done: true` also stops early
  },
  check: (out) => readinessPasses(out),            // the deployable completion oracle
})

// Spawn it exactly like a worker (role:'loop' resolves to the loop-executor).
const r = scope.spawn(loopChild(research, journal), task, { budget, label: 'research-loop' })
// Wire once at the top: createInMemoryRunContext({ withDriver: true, withLoop: true }).
```

Rules: `round` is code, not the model's judgment — that is what makes maxRounds,
the budget, and the gate ENFORCED rather than hoped-for. Give the loop a real
`check` (an executable oracle, never a self-judged score). Budget nests: the pool
reserves each spawn's full ceiling until it settles, so pool > loop > per-round.

### Codemode — an LLM authors the loop at runtime

When the supervisor should WRITE the loop for a novel goal (not pick a hand-built
one), use `authorLoop` — the codemode seam over the atom, the sibling of
`authorStrategy`. It shows the model `loopAuthorContract` (the exact `defineLoop`
module shape, exported so a skill/GEPA pass can evolve it), extracts the fenced
module, lints it with `assertStrategyContract` (only the loops import; no
require/eval/fetch/process/node builtins), writes it, dynamic-imports it, and
validates the default export is a `LoopDef` — ready for `loopChild`.

```ts
const { loop } = await authorLoop({ chat, goal, maxRounds, outDir, fallbackModel })
const spawned = scope.spawn(loopChild(loop, journal), task, { budget, label: 'authored-loop' })
```

Safety is structural, same as `authorStrategy`: the authored body can be WRONG
but cannot overspend (conserved pool), cannot skip the check (the runtime gates
it), and cannot reach outside the loops surface (the lint). Do not build a
per-product loop-code generator or a VM sandbox around authored loops — `authorLoop`
is that seam.

## Role Boundaries

- **Verifier**: executable shippability gate; controls accept/reject.
- **Judge**: held-out score only; never steers the current run.
- **Analyst**: trace-derived diagnosis over worker, pairwise, subtree, or full
  loop traces; may emit findings, questions, messages, or blockers.
- **Driver/reviewer**: consumes evidence and chooses continue, steer, spawn,
  answer, escalate, or stop.

## Questions And Steering

Questions are blockers, not prose hidden in output. A child asks its parent; the
parent answers when it has evidence, defers when safe, or escalates to Pi/user
when answering would invent requirements. `failClosed` loops must not stop clean
with unresolved `blocks-run` questions.

Steer sparingly: only when an analyst finds a concrete mistake, a loop is
duplicating work, a parent/Pi answers a blocker, or a verifier reveals a specific
fix a running worker can still use. Delivery is through `Scope.send` or
`steer_worker`; failed delivery means spawn a fresh corrected attempt.

## Workspace Loops

Git is the durable workspace seam:

- one branch/clone per worker
- `gitWorkspace({ ref })` when host and sandbox need the same clone/commit/push contract
- explicit commit per worker
- typed merge result: `merged | conflict | stale-base | rejected | verifier-failed`
- resume derives completion from git state, not only a side journal
- conflicts become blockers/questions, not silent overwrite

Proof command (real sandbox, real observe→steer join):

```bash
TANGLE_API_KEY=... pnpm exec tsx bench/src/cloud-loop.mts
```

It proves `openSandboxRun -> observe -> steer -> corrective worker` over a live
sandbox. The old `observe-steer-workspace-loop.mts` used mock executors and is
deleted — the live proof is the only valid one.

## Final Check

- Does every meaningful product land in result blobs, journals, commits,
  conversation journals, or trace events?
- Are verifier, judge, analyst, and driver roles separated?
- Can blocking questions move up the chain?
- Can Pi/parent steer without bypassing verification?
- Is workspace mutation transactional if workers edit shared code?
- Can existing trace/journal views isolate agents, pairs, subtrees, and the full
  run?
- Is the loop small enough that an agent can author it without inventing hidden
  runtime behavior?
