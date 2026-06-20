# The tree, the up-flow, and where improvement comes from

> One picture of the whole system. Every node is an **`AgentProfile`**. The shape is recursive. Trace analysis flows **up** the tree after every rollout. Self-improvement is the tree **rewriting profiles**. Everything is one data structure, durable by design.
>
> Each claim is tagged **REAL** (built + tested, `file:line`) or **TO-BUILD** (designed, not yet wired). No aspirational-as-fact.

## 1. The tree — one recursive atom

```
            ┌──────────────────────────────────────────────┐
            │  SUPERVISOR   = an AgentProfile               │
            │  • can work a task itself                     │
            │  • breaks the task down (its own prompt)      │
            │  • AUTHORS the AgentProfile of each child     │
            │    it spawns (prompt / tools / mcp / skills)  │
            └───────────────┬──────────────────────────────┘
                            │ spawn(child = a profile it wrote)
        ┌───────────────────┼────────────────────────┐
        ▼                   ▼                         ▼
  ┌───────────┐      ┌────────────────┐        ┌───────────┐
  │ DRIVER    │      │ SUB-SUPERVISOR │        │ WORKER    │
  │ = profile │      │ = profile      │        │ = profile │
  │ works a   │      │ spawns anything│        │ works a   │
  │ task AND  │      │ (recurses —    │        │ task      │
  │ drives    │      │  same atom)    │        │           │
  │ workers   │      └──────┬─────────┘        └───────────┘
  └────┬──────┘             ▼
       ▼            (driver | sub-supervisor | worker)*
   ┌───────┐
   │WORKER*│        Three roles, ONE atom: an Agent node that
   └───────┘        `act(task, scope)`s — it may settle a result
                    (leaf) OR spawn children (driver/supervisor).
```

- **REAL** — one recursive `Agent` node, not two types: `architecture.md:3,58`; `Agent.act(task, scope)` in `supervise/types.ts`. The roles (worker/driver/supervisor) are the *same* atom; a node is a "driver" only because its tools spawn children.
- **REAL** — every node materializes in its backend (sandbox / cli-bridge / router / worktree-cli) via the one backend-as-data factory `createExecutor({ backend })` (`supervise/runtime.ts:1137`). The profile says what it is; the executor says where it runs.
- **REAL** — the supervisor **authoring** child profiles is the §1.5 law: a supervisor's intelligence is *writing full AgentProfiles for its children* (`canonical-api.md` §1.5). The coordination toolbox `spawn_worker` carries the child profile (`mcp/tools/coordination.ts`).
- **SIMPLIFY (WS1)** — today a "driver brain" is a separate `DriverChat` seam, not a profile. Target: a driver/supervisor is just an AgentProfile whose tools are the coordination verbs; how its brain runs is inferred from the profile. Then this picture is literally true with zero special cases.

## 2. The up-flow — trace analysis after every rollout, flowing up like a tree

```
   worker rollout settles ─[analyst]→ finding ─┐
   driver rollout settles ─[analyst]→ finding ─┤  ONE typed pipe (the event bus)
   loop / subloop settles ─[analyst]→ finding ─┘  kinds: settled | ask_parent | finding
                                                   priority-queued, stamped (seq/at)
                    │
                    ▼  flows UP to the parent (driver ← worker, supervisor ← driver, …)
            ┌───────────────┐
            │ parent pulls   │  await_event({kinds}) — the ONE wait verb
            │ or subscribes  │  (immediate push) — folds the child's analysis
            └───────────────┘  into its own next decision
```

- **REAL** — the single up pipe: `createEventBus` (`supervise/event-bus.ts`). Child→parent rides ONE channel — settled outputs, `ask_parent` questions, and trace-analyst `finding`s are all `CoordinationEvent` kinds; priority-queued (a blocking question jumps the queue), ties FIFO by `seq`. This is your "clean data structure."
- **REAL** — analysts auto-fire on settle: `analyzeOnSettle` runs trace analysts when a node settles `done` and **re-enters each result as a `finding` on the same bus** (`supervise/coordination-mcp.ts:60`). So "run an analyst after every rollout and send it up" is built — for workers, and because every node is the same atom, the mechanism is uniform across layers.
- **REAL** — the analysis itself is substrate- and harness-agnostic: `TraceSource` turns a rollout's tool calls into agent-eval `ToolSpan`s from EITHER an owned loop OR a sandbox box; online `watchTrace` and on-settle `analyzeTrace` both fold them (`supervise/trace-source.ts`, `trajectory-recorder.ts:27`).
- **GAP (uniformity)** — confirm `analyzeOnSettle` fires at the *driver* and *loop* settle, not only worker settle. The atom supports it; the wiring should be made uniform so "ANY LAYER, ANY SUBLOOP" is literally one rule.

## 3. Where self-improvement comes from — the tree rewriting profiles

The AgentProfile changes at **three timescales**. This is the part that is real but **fragmented** — unifying it is "RSI must be smart and SIMPLE" (WS7).

```
  ① IN-FLIGHT (within one node's loop, between shots)
     analyst finding ──▶ STEER the next shot's prompt
     → changes the NEXT message, not the stored profile
     REAL: grounded steer in the depth loop (strategy.ts), steer_worker down-leg

  ② ACROSS-ROUND (between rounds of a loop)
     harvest this run's traces ──▶ corpus ──▶ render as SKILLS ──▶ inject into next round's profile.systemPrompt
     → creates/grows the profile's SKILLS from its own experience
     REAL: harvestCorpus (harvest-corpus.ts), renderCorpusToInstructions (personify/corpus.ts)

  ③ ACROSS-GENERATION (the flywheel)
     holdout-gated ──▶ AUTHOR a new profile (the genome: prompt + skills + tools + …)
     → rewrites the whole AgentProfile; certified on a frozen holdout, never the training set
     REAL: the improvement loop (improvement/), gated by promotion/heldout gates
```

- So, to your question directly: **yes — we both improve existing skills and create new ones, and we modify the AgentProfile both in-flight (as a steer) and after-flight (as injected skills, and as a re-authored genome).** The "self-improvement" comes from the **analyst findings that flow up** (§2): they are the signal that steers (①), mines skills (②), and drives the next-generation authoring (③).
- **REAL** — the firewall holds at every layer: the analyst is the *steerer*, never the *judge* — `assertTraceDerivedFindings` (`personify/analyst.ts`). Improvement reacts to behavior, not to the score it's optimizing.
- **SIMPLIFY (WS7)** — these three are separate code paths today. Target: **one `improve(profile, …)` verb** with the three timescales as internal composition, so "are we improving skills in the loop?" has one obvious answer and one place to look.

## 4. Durability — by design, not yet end-to-end

```
  same box   : in-process queue   ── REAL (tested)
  cross box  : durable mailbox on the parent's box ── TO-BUILD (the interface is ready)
```

- **REAL** — the event bus is transport-agnostic *on purpose*: "same box → this in-process queue; cross box → the SAME publish/pull/subscribe surface backed by a durable mailbox on the parent's box" (`supervise/event-bus.ts:20`). The data structure is already shaped for durability.
- **TO-BUILD** — the cross-box (distributed-sandbox) durable binding is **task #13** (`glossary.md:65`); in-process is real and tested, the cross-box transport is the thin unbuilt part. Your "this should be durable" = finish #13 so the up-flow survives across distributed boxes and restarts. (And the run itself becomes durable once the resume work — reverted from the broken #346 — is redone correctly on this architecture.)

## The one-line model

**A recursive tree of AgentProfiles, materialized in their backends, where every rollout's trace-analysis flows up one typed pipe, and that analysis is what rewrites the profiles — as an in-flight steer, as injected skills, and as a re-authored genome — durably.** The simplification's job is to make every clause of that sentence literally one primitive with one name.
