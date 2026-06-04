> **Track:** Architecture (research) · **Role:** design research (in progress) · **Status:** surface proposed; keystone build plan pending the `wnrxtvdta` design pass + 4 user forks

# Recursive execution atom

The next architecture generation. Today the loop is one level deep: a driver drives one
agent over rounds. The target is **full generality**: an agent that *is* a driver, fanning
out sub-loops of drivers-driving-agents, recursively — with analysts watching at every
level, dynamic asynchronous spawning, and a conversational, observable root.

This doc holds the vision, the proposed surface, the honest gap vs the current code, and the
open forks. It supersedes nothing in [`../architecture.md`](../architecture.md) until a design ships.

## The vision (the intent, distilled from the operator)

- **Agents run tasks. Drivers drive agents. Analysts watch.** Traces from the agents flow to
  the driver; analysts turn traces into findings the driver steers on.
- **Analysts come in three runtimes.** An external CLI/RLM (e.g. Halo), our inline trace-analyst
  (a bare LLM call, not a sandboxed agent), or a full agent in a sandbox tasked with "analyze
  these traces and metadata, emit an output." These are *not* three types.
- **Nested: an agent is a driver of drivers.** An agent can fan out multiple loops of
  drivers-driving-agents; that agent is then itself a driver. Recursive, self-similar.
- **The "tensor" is dynamic and asynchronous, not eager fan-out.** We do **not** want an agent
  exploding into 20 sub-drivers up front. We want: when one branch completes, the agent can
  spawn a *new* branch (possibly a different flow); the agent can say "run driver A for n
  shots and driver B for k shots" (heterogeneous per-child budgets); branches run async.
- **Leaves are opaque, self-parallelizing coding harnesses.** The coding agents sit at the
  bottom. They are full harnesses that parallelize *inside themselves* (their own sub-agents).
  The recursion we build is the *driver/policy* layer above them.
- **The root is eventually conversational + observable.** You hook the root agent to a chatbot
  (a pi extension with a live visualization of the spawning tree). You ask it "what's currently
  in flow?" while branches run asynchronously.
- **Test 100% of the problem space, disciplined.** Build the general mechanism now — not a thing
  that traps us testing 5% today and tomorrow — but keep it focused, not crazy.

## Two planes — and B contains A

| | Plane A — experiment harness | Plane B — recursive execution atom |
|---|---|---|
| Shape | flat: compare N arms at equal compute | recursive: agent → drivers → agents, async |
| Surface | `profiles × steer × executionMode × allocation` | one `Agent` atom + a `Scope` + a `Supervisor` |
| Built by | `wuh46e5zp` (see [flat-harness-design.md](./flat-harness-design.md)) | this doc |
| Answers | the gate (diverse@k vs blind@k) | the full vision |

**Decision: Plane B contains Plane A.** The flat harness is recovered as *the simplest possible
`act` body* — a root driver that spawns one child per profile at a fixed budget and selects the
best. So the `wuh46e5zp` design is not a competing v1; it becomes the canonical example program
over the atom, and its `executionMode`/`allocation` axes become spawn options.

## The thesis: one recursive atom, run as a durable, observable supervision tree

Not three subsystems — **one atom + one executor**, plus two things this repo already has
(the durable journal in `src/durable/`, the conversation engine in `src/conversation/`) wired
in as the observability skin. The shape is the intersection of three mature systems:

- **Structured concurrency** (Trio nursery / Swift TaskGroup / Ray dynamic task graph): `act`
  runs inside a *scope* that can `spawn` children dynamically and react to them **as each
  finishes**. This is "spawn-on-completion" and "driver A for n shots, B for k shots."
- **Durable execution** (Temporal): the tree is **event-sourced** — every spawn/complete is
  journaled, so it is resumable, queryable ("what's in flow?"), and a chat/signal handle can
  attach to the live root. Observability falls out of the event log; you don't build it twice.
- **MCTS progressive widening**: the reason you do *not* fan out to 20 at once — a node widens
  (spawns more children) only as a branch proves promising, under a global budget. This is the
  governor that keeps "full generality" from becoming "boil the ocean."

### The atom (one self-similar type)

```ts
interface Agent<Task, Out> {
  act(task: Task, scope: Scope): Promise<Out>
}
```

- **Coder** = an `Agent` that does not spawn (a leaf). The coding harness self-parallelizes; opaque to us.
- **Driver** = an `Agent` whose `act` spawns child agents and runs a policy over their streaming
  results. "An agent is a driver" = a driver is just an `Agent` that spawns.
- **Analyst** = an `Agent` whose task is "read these traces → findings." The CLI/inline/sandbox
  question collapses to a `runtime` on the spawn (below). Same type, three backends.

### The `Scope` — the only new mechanism

```ts
scope.spawn(agent, task, { budget, runtime, label }) // -> Handle ; dynamic, async
scope.next()  // resolves as each child finishes -> react, spawn more   (ray.wait)
scope.view()  // the live tree: every node's id / parent / status / budget / partial result
```

```ts
type Runtime = 'sandbox' | 'cli' | 'inline'
// 'cli'    = Halo / an external RLM invoked as a subprocess
// 'inline' = a bare LLM call (today's trace-analyst), no box
// 'sandbox'= a full coding/analysis agent in a box
```

The **analyst answer**: an analyst is an `Agent`; *where it runs* is the `runtime`. Halo is
`runtime: 'cli'`, our trace-analyst is `runtime: 'inline'`, a sandboxed analysis agent is
`runtime: 'sandbox'`. One type, three handlers — no `Analyst` subsystem.

### Plane A as the simplest `act` (sketch)

```ts
// The flat harness, recovered: spawn one child per profile, fixed budget, pick the best.
const flatHarness: Agent<Bench, Result> = {
  async act(bench, scope) {
    for (const p of bench.profiles) scope.spawn(coder(p), bench.task, { budget: bench.k, runtime: 'sandbox', label: p.name })
    const results = []
    while (results.length < bench.profiles.length) results.push(await scope.next())
    return selectBest(results)
  },
}
```

### Spawn-on-completion + progressive widening (the dynamic shape)

```ts
// A driver that widens toward promising branches under a global budget, async.
async act(task, scope) {
  let live = seedChildren(task).map((c) => scope.spawn(c.agent, c.task, { budget: c.shots, runtime: 'sandbox' }))
  const done = []
  while (scope.budget.remaining() > 0 && live.length) {
    const ev = await scope.next()            // a child finished
    done.push(ev)
    if (promising(ev) && scope.budget.remaining() > THRESH)
      live.push(scope.spawn(widen(ev), nextTask(ev), { budget: ev.shots, runtime: 'sandbox' }))  // widen, don't pre-fan
  }
  return synthesize(done)
}
```

## What exists vs the gap (file-grounded; verify before building)

| Component | File | Status | Gap |
|---|---|---|---|
| The atom signature | `src/loops/program.ts` (`Agent.act → Output \| Program`, op-set, `runProgram`, `maxDepth=4`) | **right shape** | `act` returns a *static `Program`*; need `act(task, scope)` with **dynamic** `spawn`/`next` (not a pre-authored tree). |
| Leaf execution | `src/loops/run-loop.ts` (box create / `streamPrompt` / teardown; the `collectBox` same-sandbox seam) | **keep** | The leaf already runs a coding harness; `runtime: 'sandbox'` maps here. |
| Round-synchronous planner | `src/loops/drivers/dynamic.ts` (`createDynamicDriver`, `PlannerContext.analyses`, selector≠judge firewall) | **evolve** | Planner is round-synchronous (plan → run a batch → observe all → plan). Need async-streaming reaction (`scope.next()` on *individual* completions). |
| Durable journal | `src/durable/` (`handleChatTurn`, journal/resume) | **wire-in** | Candidate **event source** for the Supervisor (every spawn/complete journaled → replay + query). Needs node-level events. |
| Conversation engine | `src/conversation/` (turn loop, `selectSpeaker`, `ConversationJournal`) | **wire-in** | Candidate **chat handle** over a live Supervisor ("talk to the root / what's in flow"). |
| Supervisor executor | — | **net-new** | The keystone: a live node registry running `act`, async, on the journal. Replaces the batch `runProgram` tree-walk. |
| `Scope` | — | **net-new** | The keystone capability: `spawn` / `next` / `view` + budget. |

**The keystone is `Scope` + `Supervisor`.** Leaves, the analyst hook, Plane A, observability,
and the chat handle all fall out of it (or already exist).

## Open forks (recommended answers; awaiting the operator)

1. **Event-sourced supervisor?** _Recommended: yes, from day one._ This repo's science needs a
   reproducible corpus (paired bootstrap + BH), but a free-running async supervisor is
   nondeterministic. Build the Supervisor on `src/durable/`'s journal as the source of truth →
   replayable (science) *and* queryable/resumable (the chat handle). Temporal proves you get
   observability for free from the event log; don't build two executors. **Most load-bearing.**
2. **Conversation now, or substrate-now / client-later?** _Recommended: substrate now._ Build
   `scope.view()` + a node-event channel in v1; defer the chatbot/pi-viz to a thin client.
   "Eventually" → make a rewrite unnecessary, don't pay for the UI now.
3. **Spawn policy: code, LLM, or both — default?** _Recommended: `act` is code; LLM-decided
   spawning is the researcher's choice._ v1 ships coded policies (fixed / round-robin /
   progressive-widening); the **LLM meta-driver** is opt-in, not default — a learned/LLM
   meta-controller is exactly the "mechanism ahead of the gate" the repo warns against, and it
   is nondeterministic.
4. **Global budget as a hard ceiling?** _Recommended: yes, fail-closed at the root._ One root
   budget (tokens / $ / wall); the Supervisor enforces it; policies widen within it.

## Decision log

- **Full tensor now** (the recursive atom is v1, built as durable mechanism). _(2026-06-04)_
- **B contains A** (flat harness = simplest `act`). _(2026-06-04)_
- **Analyst = Agent + `runtime`** (`cli`/`inline`/`sandbox`). _(2026-06-04)_
- **Leaves = opaque self-parallelizing coding harnesses.** _(2026-06-04)_

## Pending

The `wnrxtvdta` design pass (6 prior-art lenses + 4 codebase mappers → synthesis → adversarial
critique → reconcile) refines this surface, attacks it (replay-vs-async determinism,
cancellation/orphans, budget blowout, analyst-runtime leakiness, `view()` consistency under
concurrency, Plane-A equal-compute preservation, collision with `runProgram`/`maxDepth`), and
distills the 5 sharpest user questions. **Its final surface + build order will be appended here.**
