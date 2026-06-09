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
   │  Chat-turn lifecycle ─  handleChatTurn(...)                 │
   │  NDJSON + session.run.* envelope + persist/trace hooks   │
   └───────────────────────────────────────┬─────────────────┘
                                           │
   ┌───────────────────────────────────────┴─────────────────┐
   │  Execution continuity (substrate-owned)                  │
   │  box.streamPrompt — auto-reconnect in-call; X-Execution-ID
   │  header for cross-process. deriveExecutionId is the
   │  convention helper.                                       │
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
(`defineAgent` → `handleChatTurn`) — they're the same primitives
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
substrate's job, not agent-runtime's. The `@tangle-network/sandbox`
SDK + orchestrator already handle it:

- **In-call reconnect**: `box.streamPrompt` extracts `executionId` from
  the response's `execution.started` event and replays via the runtime
  endpoint if the stream drops. Transparent — callers do nothing.
- **Cross-process reconnect**: a fresh Worker can resume a prior
  Worker's execution by POSTing to the orchestrator's
  `/agents/run/stream` with the `X-Execution-ID` header. The SDK's
  public `PromptOptions` does not yet surface this; products bypass the
  SDK and call the orchestrator directly when they need it (see
  tax-agent's `sessions.ts`).
- The orchestrator's buffer is 10k events / 2-min post-completion. A
  retry past that window gets `execution_not_found` and re-runs.

agent-runtime owns one helper, `deriveExecutionId({ projectId,
sessionId, turnIndex })`, that produces the stable id the product
persists on its session row.

What lives in the Worker: auth, access control, product DB writes,
prompt composition, routing. What lives in the substrate: the
long-running execution, event buffering, replay-on-reconnect, dedup.
The Worker stays a routing + persistence layer — it does not host
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
- **`getModels` / `resolveRouterBaseUrl`** —
  the catalog fetch + base-URL helpers.

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
3. `examples/chat-handler/` — `handleChatTurn` — the centerpiece chat handler.
4. `examples/runtime-run/` — the production-run row + cost ledger.
5. `examples/agent-into-reviewer/` — pipe one runtime's stream into a reviewer agent.
6. The `README.md` entry-point table — model resolution + every other primitive, one row each.
