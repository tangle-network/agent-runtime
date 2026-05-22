# Concepts

agent-runtime is a thin substrate. It owns five things and delegates the
rest. Read this file once and the rest of the API falls into place.

## The five layers

```
                              ┌──────────────────────────┐
                              │   Domain code (yours)    │
                              │  tools, rubric, prompts  │
                              └────────────┬─────────────┘
                                           │
   ┌───────────────────────────────────────┴─────────────────┐
   │  Agent manifest  ─  defineAgent({ surfaces, run, … })   │
   └───────────────────────────────────────┬─────────────────┘
                                           │
   ┌───────────────────────────────────────┴─────────────────┐
   │  Task lifecycle  ─  runAgentTask / runAgentTaskStream   │
   │     observe → validate → decide → act → eval            │
   └───────────────────────────────────────┬─────────────────┘
                                           │
   ┌───────────────────────────────────────┴─────────────────┐
   │  Durability     ─  runDurableTurn / runSupervisedTurn   │
   │  + DurableRunStore + stream-event log + RunHandle        │
   └───────────────────────────────────────┬─────────────────┘
                                           │
   ┌───────────────────────────────────────┴─────────────────┐
   │  Backends + catalog                                     │
   │  createOpenAICompatibleBackend, createSandboxPromptBackend,
   │  getModels / resolveChatModel / validateChatModelId       │
   └─────────────────────────────────────────────────────────┘
```

Each layer composes the one below it. You can use the bottom layers
alone (a raw backend + the model catalog), or the whole stack
(`defineAgent` → `runSupervisedTurn`) — they're the same primitives
nested.

## The task lifecycle

Every `runAgentTask` is a small state machine over an `AgentAdapter`:

- **observe** → snapshot domain state (read-only).
- **validate** → score the snapshot against the eval rubric.
- **decide** → `act` (perform a domain action) | `ask` (ask the user
  something) | `stop` (this turn is done, here's the outcome).
- **act** → effect the action; loop.

The adapter is *yours*. The lifecycle, the eval lift, the stop semantics,
the cost ledger — all substrate. Streaming is the same shape:
`runAgentTaskStream` yields `RuntimeStreamEvent`s as the loop progresses.

## Durability — three levels

A turn that "completes" means the response reached the client AND the
side effects landed. A worker isolate can die anywhere in between. Pick
the level that matches your turn length and substrate:

| Level | Survives | When to reach for it |
|---|---|---|
| `runAgentTask` / `runAgentTaskStream` | nothing — a worker crash re-runs from the top | sub-second turns, no sandbox |
| `runDurableTurn` | a worker crash *after* the turn finished (cached replay) | medium turns, no sandbox-reconnect |
| `runSupervisedTurn` + `SessionSupervisorDO` | a worker crash *during* the turn — a fresh supervisor re-attaches to the in-flight sandbox run | long sandbox-backed turns |

`runSupervisedTurn` works because the sandbox container is
orchestrator-managed and **outlives** the worker. The supervisor:

1. Drains every event into the substrate's own ordered log
   (`appendStreamEvent`, idempotent on `eventId`).
2. Persists a `RunHandle` (`setRunHandle`) the moment the substrate
   yields a run id.
3. Heartbeats the lease while attached.

A fresh supervisor reads the log for its cursor and calls
`adapter.attach(handle, cursor)` to resume past it — events through
`cursor` are not re-delivered (the log's idempotency dedups the seam).

## The reconnect adapter contract

`SandboxReconnectAdapter` is one typed interface. Implement it **once
per substrate** (the Tangle sandbox SDK, an OpenAI Assistants thread,
whatever), never per product.

```ts
interface SandboxReconnectAdapter<TEvent> {
  start(): AsyncIterable<SupervisedEvent<TEvent>>
  attach(handle: RunHandle, afterEventId: string | undefined):
    AsyncIterable<SupervisedEvent<TEvent>>
}
```

`SupervisedEvent` carries an `eventId` (cursor + dedup key), a `payload`
(your event type), and an optional `handle` (carried on the first frame
once the substrate yields the run id).

Conformance assertions live in `src/durable/tests/supervisor.test.ts` —
copy them into your adapter's tests so substrate quirks surface there,
not in a 15-minute production turn.

## The agent manifest

`defineAgent(...)` is how a vertical declares the **surfaces** (prompt,
skills, tools — the levers `agent-eval`'s analyst loop can edit), the
**knowledge** requirements, the **rubric**, and the **run** function
that ties it all together. The manifest is what the eval harness
benchmarks, what the analyst loop improves, and (in time) what the
generated scaffold produces.

Keep `defineAgent` *declarative*. Domain logic — the actual tool calls,
the actual rubric scoring — lives in functions the manifest references,
not inline.

## Model resolution

Every product chat handler asks the same questions and gets the same
answers wrong (or differently). Substrate primitive:

- **`resolveChatModel(candidates, fallback)`** — first-non-blank
  precedence over caller-supplied candidates (`request → workspace →
  env`, in whatever order *you* want). Policy-free.
- **`validateChatModelId(modelId, { allowlist?, routerBaseUrl? })`** —
  rejects malformed ids and ids absent from both the caller's
  `allowlist` and the live router catalog. **Fails closed**: when the
  catalog can't be fetched, an unverifiable id is rejected.
- **`getModels` / `resolveRouterBaseUrl` / `withConfiguredModels`** —
  the catalog fetch + base-URL + injection helpers.

This module has **no React, no `process.env` assumption** — it runs
unchanged in Node and in Cloudflare Workers.

## Backends

`createOpenAICompatibleBackend({ baseUrl, model, apiKey })` and
`createSandboxPromptBackend({ ... })` are the two production backends.
Both stream. `policy.fallbackModels: [...]` rotates through a named list
on transient failure — that's the only fallback you should ever wire,
and it's explicit.

The doctrine is in `AGENTS.md`: **no silent fallbacks**. Required fields
fail loud; named rotations are opt-in.

## What this package does NOT own

Domain policy. Models. Tools. Connectors. UI. Prompts. Rubrics. Those
live in your vertical. The runtime is reusable across many kinds of
agents because nothing in this list is baked into it.

## Reading order for a new consumer

1. `examples/basic-task/` — the smallest end-to-end.
2. `examples/sandbox-stream-backend/` — what streaming looks like.
3. `examples/runtime-run/` — the production-run row + cost ledger.
4. `examples/model-resolution/` — pick + validate a model.
5. `examples/durable-supervisor/` — the cross-worker resume keystone.
6. `examples/agent-into-reviewer/` — pipe one runtime's stream into a reviewer agent.
7. The `README.md` entry-point table — every other primitive, one row each.
