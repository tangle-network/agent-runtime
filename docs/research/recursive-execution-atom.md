> **Track:** Architecture (research) · **Role:** design research (in progress) · **Status:** surface proposed; keystone build plan pending the `wnrxtvdta` design pass + 4 user forks

# Recursive execution atom

The next architecture generation. Today the loop is one level deep: a driver drives one
agent over rounds. The target is **full generality**: an agent that *is* a driver, fanning
out sub-loops of drivers-driving-agents, recursively — with analysts watching at every
level, dynamic asynchronous spawning, and a conversational, observable root.

**Frame it as the canon does ([../architecture.md §0.5](../architecture.md)):** the atom is a
recursive **decision** — at each level, given the solution-so-far, the feedback, and the budget,
choose the best next move toward a **multi-objective** goal (correct · fast · secure · cheap).
*Spawn* is one move; "driver / worker / analyst" are roles a profile plays, not types. So this
doc's "driver/policy layer" is shorthand for *the decision policy*, and "fan out sub-loops" is one
decision it can make — not the primitive.

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
| Round-synchronous planner | `src/loops/drivers/dynamic.ts` (`createDriver`, `PlannerContext.analyses`, selector≠judge firewall) | **evolve** | Planner is round-synchronous (plan → run a batch → observe all → plan). Need async-streaming reaction (`scope.next()` on *individual* completions). |
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

## Design pass `wnrxtvdta` — reconciled (the frozen contract)

6 prior-art lenses + 4 codebase mappers → synthesis → adversarial critique → reconcile.

**BLUF.** The mechanism is agreed: `scope.next()` = a ray.wait cursor over a structured-concurrency
nursery. The critique then landed **3 blockers + 3 majors**, all on one fault line: *the headline
property (durable + queryable + reproducible replay) and the reason-to-exist (a clean equal-k gate)
both break for the same root cause — budget was a **ceiling** not a **reservation**, and the journal
recorded **decisions** but not the **evidence** those decisions consumed.* Two invariants make the
keystone survive: (1) **budget is an atomically-reserved conserved pool**, so `Σk(treatment) ≡ Σk(blind)`
by construction; (2) **the journal records a content-addressed `outRef`** per child result, so replay
rehydrates the exact `Settled` the driver branched on. The keystone is the **budget-conserving reactive
`Scope`** — not the LLM meta-driver.

### The frozen surface (build against this)

```ts
// One self-similar atom. A leaf is an Agent that never calls scope.spawn.
interface Agent<Task, Out> { readonly name: string; act(task: Task, scope: Scope<Out>): Promise<Out> }

// The runtime is ONE OPEN INTERFACE, not a closed union (operator's refinement). A Executor
// is anything with an `execute` that returns a Promise OR an async stream of normalized usage.
// Our built-ins are just the initial IMPLEMENTATIONS; a user's own agent (mastra, agno, a raw
// HTTP call, anything) is first-class the moment it implements the interface. NO per-vendor
// adapters, no "future adapter" code — the interface IS the extension point.
//   - router/inline : a direct Router/HTTP inference call, no box   (an agent with harness: null)
//   - sandbox       : COMPOSES the existing runLoop kernel as a leaf (+ PR #150's `lineage`
//                     passthrough for leaf-level continue/fork — does NOT reinvent checkpoint/fork)
//   - cli           : Halo/RLM subprocess; budgetExempt, excluded from equal-k by construction
// An agent selects its executor via its AgentProfile (harness: null => router/inline; harness:
// <sandbox> => sandbox), OR carries a custom Executor / executor-factory directly (BYO).
interface Executor<Out> {
  // returns a Promise<LeafResult> for one-shot executors, OR an async stream of UsageEvents for
  // streaming ones; the architect picks the minimal shape that supports both with normalized usage.
  execute(task: unknown, signal: AbortSignal): Promise<LeafResult<Out>> | AsyncIterable<UsageEvent>
  teardown(grace: number | 'brutalKill' | 'infinity'): Promise<{ destroyed: boolean }>
  resultArtifact(): { outRef: string; out: Out; verdict?: DefaultVerdict; spent: Spend }  // B1: replay source
}
type UsageEvent = { kind: 'tokens'; input: number; output: number } | { kind: 'cost'; usd: number } | { kind: 'iteration' }
//   M3/B3: LoopTokenUsage is {input,output} ONLY — usd is a SEPARATE channel.

interface Budget { readonly maxIterations: number; readonly maxTokens: number; readonly maxUsd?: number; readonly deadlineMs?: number }
interface Spend  { iterations: number; tokens: LoopTokenUsage; usd: number; ms: number }

type Restart = 'temporary' | 'transient' | 'permanent'                          // OTP child_spec
type NodeStatus = 'pending' | 'acquiring' | 'running' | 'done' | 'failed' | 'cancelled'  // M1: 'acquiring' first-class
interface SpawnOpts { readonly budget: Budget; readonly label: string; readonly restart?: Restart; readonly shutdown?: number | 'brutalKill' | 'infinity' }
interface Handle<Out> { readonly id: NodeId; readonly label: string; readonly status: NodeStatus; abort(reason?: string): void }
//   M1: abort() is defined over the ACQUIRE lifecycle (chains into acquireSandbox signal + reaps find-by-name orphan box).

type Settled<Out> =
  | { kind: 'done'; handle: Handle<Out>; out: Out; outRef: string; verdict?: DefaultVerdict; spent: Spend; seq: number }
  | { kind: 'down'; handle: Handle<Out>; reason: string; infra: boolean; restartCount: number; seq: number }
//   B2: seq = monotonic cursor order next() yielded (NOT wall-clock); replay delivers strictly in seq order.

interface Scope<Out> {
  // M5: reserves budget atomically from the shared pool; FAILS CLOSED when the pool can't cover it; refunds unspent on settle.
  spawn<C extends Out>(agent: Agent<unknown, C>, task: unknown, opts: SpawnOpts):
    { ok: true; handle: Handle<C> } | { ok: false; reason: 'budget-exhausted' | 'depth-exceeded' }
  next(): Promise<Settled<Out> | null>          // ray.wait n=1 over THIS scope's IN-MEMORY live set; null when empty
  readonly view: TreeView                        // reads the in-memory nursery (NOT the log); O(live)
  readonly budget: Readonly<{ tokensLeft: number; usdLeft: number; deadlineMs: number; reservedTokens: number }>
}

// Event source — the decision/payload split the replay argument rests on (B1/B2):
type SpawnEvent =
  | { kind: 'spawned'; id: NodeId; parent?: NodeId; label: string; budget: Budget; runtime: Runtime; seq: number; at: string }
  | { kind: 'settled'; id: NodeId; status: 'done' | 'down'; outRef?: string; verdict?: DefaultVerdict; spent: Spend; infra?: boolean; seq: number; at: string }
  | { kind: 'cancelled'; id: NodeId; reason: string; seq: number; at: string }
interface SpawnJournal { loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>; beginTree(root: NodeId, at: string): Promise<void>; appendEvent(root: NodeId, ev: SpawnEvent): Promise<void> }
interface ResultBlobStore { put(outRef: string, artifact: unknown): Promise<void>; get(outRef: string): Promise<unknown | undefined> }

// Supervisor — owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker, the root handle.
interface Supervisor<Task, Out> { run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>; attach(h: RootHandle<Out>): void }
type SupervisedResult<Out> =
  | { kind: 'winner'; out: Out; outRef: string; verdict?: DefaultVerdict; tree: TreeView; spentTotal: Spend }
  | { kind: 'no-winner'; reason: 'all-children-down' | 'budget-exhausted' | 'aborted'; tree: TreeView; downCount: number }  // M2: typed, never best!
interface RootHandle<Out> { view(): TreeView; signal(msg: RootSignal): void; abort(reason?: string): void }  // Q2 substrate
```

**Replay invariant (now enforceable):** a driver's `act()` may read `verdict`, `spent`, and `out`
(rehydrated by `outRef`); it MUST NOT read anything not delivered through `Settled` — no `Date.now`,
no `Math.random`, no unordered collections. `next()` delivers strictly in recorded `seq` order.

### Build order (v1 = the instrument)

| # | Step | Net-new/Evolve | File | Fixes |
|---|------|---|---|---|
| 1 | `mapPool` one-for-all → one-for-one: a thrown child becomes a `down` record, excluded from merge `n`; survivors still reach `concatRuns`. | Evolve | `program.ts:408-433` | infra-exclusion |
| 2 | **Conserved budget pool**: `Spend` from a normalized `UsageEvent` stream (tokens + usd separate); atomic reserve-on-spawn / reconcile-on-settle; fail-closed admission. | Evolve | `types.ts`, `drivers/report-usage.ts` | **M5,B3** |
| 3 | `SpawnJournal` + `ResultBlobStore` (in-mem + JSONL/FS); sink over the existing `LoopTraceEvent` lineage. | Net-new/Evolve | `src/durable/spawn-journal.ts` (new); wire `run-loop.ts:183` | **B1** |
| 4 | **`Scope` impl** (KEYSTONE): ray.wait cursor over in-memory nursery; `spawn` reserves from step-2 pool; deterministic `${parent}:s${seq}` ids; `view`/`inFlight` read memory. | Net-new | `src/loops/scope.ts` (new) | **B2,m1,m2** |
| 5 | **`Supervisor` impl** (KEYSTONE): nursery join barrier (generalize run-loop's `finally{allSettled(destroy)}`); abort cascade; abort-chains-into-`acquireSandbox` + find-by-name reap; OTP intensity breaker; typed `SupervisedResult`. | Net-new | `src/loops/supervisor.ts` (new) | **M1,M2** |
| 6 | `Executor` + per-harness impls (`inline`/`sandbox`/`cli`), each emitting normalized `UsageEvent`; `sandbox` = existing `runLoop` as a leaf; `cli`-without-accounting = `budgetExempt` + excluded from equal-k. | Evolve | `types.ts`, `src/loops/runtime.ts` (new) | **M3** |
| 7 | Replay executor: re-feed `SpawnJournal` + rehydrate `out` from `ResultBlobStore` in `seq` order; `view()` materializer for resume. | Net-new | `src/durable/spawn-journal.ts` | **B1,B2** |
| 8 | `Settled.done → Iteration` adapter at the merge boundary so `defaultSelectWinner` stays single-sourced. | Net-new (small) | `src/loops/scope.ts` | **M4** |
| — | `flatHarness` driver (Plane-A control) + **equal-k assertion** `Σiterations(treatment) ≡ Σiterations(blind)` per task or the cell is excluded. | Net-new | `bench/` | **B3** |
| — | **LLM meta-driver** (treatment) + coded progressive-widening — `WidenGate` **defaults to flat** (never widens) so the firewall conflict stays dormant; widening, when on, derives "promising" from **trace findings, not raw `verdict`**, or carries an explicit argued `judgeExempt`. | Net-new | `bench/` | **R2** |

**Deferred** (gated on a *positive* diverse-strategy result): a tuned MCTS-PW algorithm, learned
widening, per-branch adaptive sub-agents, a Temporal/DBOS durable backend, the OTP strategy matrix,
deleting `runProgram`'s loop-layer `parallel` op (supersede-vs-coexist is fork F1).

### Resolved / risks / verdict

- **Resolved by the surface:** B1 (outRef + replay invariant), B2 (in-memory live set + seq cursor), M1 (`acquiring` + acquire-aware abort), M2 (typed `SupervisedResult`), M3 (`Executor` + normalized usage), M5 (atomic reservation, fail-closed).
- **Residual risks (measure, don't hide):** R1 — the recorded interleaving is *one* sample; equal-*k* is enforceable, equal-*topology* is not → report realized tree shape per cell. R2 — widening-from-`verdict` *is* steering-from-the-judge (collides with `assertTraceDerivedFindings`, dynamic.ts:344); dormant while `WidenGate` is flat. R3 — runtime `maxDepth` is weaker than the static guard; pair it with the conserved pool so runaway recursion hits budget-exhaustion first.
- **Pass verdict (advisory):** "ship the keystone, make the LLM meta-driver wait." **Operator override (2026-06-04): build the LLM meta-driver now, as the treatment, on top of the budget-reservation invariant** — the invariant is what keeps the result valid; the coded progressive-widening + flat-harness are the controls; `WidenGate` defaults to flat for gate runs.

## Decisions resolved (the 4 forks)

- **Q1 — yes, event-sourced** (SpawnJournal + ResultBlobStore + replay; budget-pool conserved).
- **Q2 — substrate now** (`TreeView` + `RootHandle.view`/`signal` + the event stream; chatbot/pi-viz is a later thin client).
- **Q3 — LLM meta-driver built now** (operator call), as the treatment, with coded progressive-widening + flat-harness as controls. The runtime is **one open `Executor` interface** (`execute` → promise or async stream), not a closed union — built-ins (router/inline, sandbox, cli) are implementations, and any user agent (mastra/agno/HTTP/custom) is first-class by implementing it. An agent selects its executor via `AgentProfile` (`harness: null` = direct Router call; `harness: <sandbox>` = sandboxed) or carries a custom executor directly.
- **Q4 — hard ceiling, yes — sharpened to a conserved *reservation* pool** (atomic reserve/refund, fail-closed), tokens + usd, enforced at the root.

## Relationship to PR #150 (leaf-level continued-session + fork)

PR #150 (`feat/runloop-session-continuation-and-fork`) adds `RunLoopOptions.lineage` — opt-in,
default-OFF, backend-blind — so a *single* `runLoop` can continue a session across its iterations
(`sessionContinuity`) or fork a parent checkpoint across a fanout (`forkFanout`, gated on
`criuStatus().canFork`). That is the **leaf-level** depth/breadth dial. The recursive atom sits
**on top**: the `sandbox` `Executor` *composes* `runLoop` and forwards this `lineage`
passthrough — it does **not** reinvent checkpoint/fork. (Reviewed 2026-06-04: approve-to-land;
before enabling, verify the platform honors a client-minted `sessionId` (else `continue` is a
silent no-op), bound fork box-creation by `maxConcurrency`, and document that `forkFanout`
inherits the parent image so heterogeneous-profile branches must not use it.)
