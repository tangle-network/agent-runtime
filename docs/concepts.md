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
   │  Chat-turn engine  ─  ChatTurnEngine.runTurn(...)        │
   │  NDJSON + session.run.* envelope + persist/trace hooks    │
   └───────────────────────────────────────┬─────────────────┘
                                           │
   ┌───────────────────────────────────────┴─────────────────┐
   │  Execution continuity (substrate-owned)                  │
   │  box.streamPrompt({ executionId, lastEventId })          │
   │  agent-runtime provides: AgentExecutionHandle + deriveExecutionId
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
(`defineAgent` → `chatTurnEngine`) — they're the same primitives
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

## Execution continuity — substrate-owned

Long-running execution durability — reconnect, replay, dedup — is the
substrate's job, not agent-runtime's. The `@tangle-network/sandbox` SDK
+ orchestrator already implements every primitive a 15-minute turn
needs:

- `box.streamPrompt(prompt, { executionId, lastEventId })` buffers the
  event stream by `executionId` at the orchestrator.
- On reconnect with the same `executionId` and a known `lastEventId`,
  the orchestrator replays strictly after that id without spawning a
  duplicate execution.
- The SDK dedupes replayed text deltas and tool completions on the
  client side; observers see exactly one of each.

agent-runtime owns the typed pointer products persist:

```ts
interface AgentExecutionHandle {
  executionId: string
  sessionId?: string
  lastEventId?: string
}

deriveExecutionId({ projectId, sessionId, turnIndex }): string
```

The product persists `executionId` on its session row so a client retry
of the same turn lands on the same substrate execution — the
orchestrator replays its buffer instead of starting a second prompt.
A retry with a stale `lastEventId` (or none) replays from the start of
the buffer.

What lives in the Worker:

- auth / access control
- product DB writes (the assistant message, run row, side effects)
- prompt / profile composition
- routing (which backend handles this turn)

What lives in the substrate:

- the long-running execution
- event buffering keyed by `executionId`
- replay-on-reconnect
- dedup across the reconnect seam

The Worker stays a routing + persistence layer. It does not host
execution state.

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
3. `examples/chat-handler/` — `chatTurnEngine` + `deriveExecutionId` — the centerpiece chat handler.
4. `examples/runtime-run/` — the production-run row + cost ledger.
5. `examples/model-resolution/` — pick + validate a model.
6. `examples/agent-into-reviewer/` — pipe one runtime's stream into a reviewer agent.
7. The `README.md` entry-point table — every other primitive, one row each.
