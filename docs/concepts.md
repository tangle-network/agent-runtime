# Concepts

> **In plain terms:** This is the one-page mental model of agent-runtime —
> read it first if you're meeting the package cold. agent-runtime is a small
> shared foundation that handles the plumbing every AI agent needs — running a
> task, streaming a chat reply, reconnecting a dropped connection, executing an
> model — so you only write the parts unique to your agent. The one takeaway:
> it owns a handful of reusable building blocks and leaves all the
> domain-specific work — your tools, prompts, and scoring rules — to you.

agent-runtime is a thin, shared foundation layer. It owns five things and
delegates the rest. Read this file once and the rest of the API falls into
place.

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
   │  Profile-bound model execution + catalog                │
   │  profileChatClient, profileOptimizerModelCall,           │
   │  createSandboxPromptBackend,                             │
   │  getModels / resolveChatModel / validateChatModelId       │
   └─────────────────────────────────────────────────────────┘
```

Each layer composes the one below it. You can use the bottom layers
alone (a profile-bound adapter + the model catalog), or the whole stack
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

Long-running execution durability — reconnect, replay, and dispatch deduplication — is the
substrate's job, not agent-runtime's. The `@tangle-network/sandbox`
SDK + orchestrator already handle it:

- **In-call reconnect**: `box.streamPrompt` extracts `executionId` from
  the response's `execution.started` event and replays via the runtime
  endpoint if the stream drops. Transparent — callers do nothing.
- **Cross-process reconnect**: a fresh Worker can resume a prior
  Worker's execution by passing `PromptOptions.executionId` with
  `lastEventId`; the SDK replays events strictly after that cursor
  without dispatching the prompt again.
- **Detached execution**: `PromptOptions.detach: true` keeps the run
  executing server-side when the caller's stream closes so another
  Worker can reconnect.
- **Dispatch idempotency**: `PromptOptions.turnId` plus `sessionId`
  makes a repeated logical-turn dispatch return the completed result
  instead of issuing another model call. `executionId` alone does not.

agent-runtime owns one helper, `deriveExecutionId({ projectId,
sessionId, turnIndex })`, that produces the stable id the product
persists and passes as both `executionId` and `turnId` on the first
dispatch. Replay uses the same `executionId` plus `lastEventId`.

What lives in the Worker: auth, access control, product DB writes,
prompt composition, routing. What lives in the substrate: the
long-running execution, event buffering, replay-on-reconnect, dedup.
The Worker stays a routing + persistence layer — it does not host
execution state.

## The agent manifest

`defineAgent(...)` is how a vertical declares the **surfaces** (the full
`AgentProfile`: prompt, skills, tools, MCP, hooks, subagents, and extensions), the
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

## Model execution

`profileChatClient({ profile, executor, context })` adapts one exact
`AgentProfile` to agent-eval's chat contract.
`profileOptimizerModelCall({ profile, executor, context })` does the same for
external optimizer calls, while `createSandboxPromptBackend({ ... })`
normalizes a caller-owned sandbox stream.
The Runtime executor owns credentials, routing, retries, and usage evidence;
request fields cannot override the profile's model policy.
An explicit `policy.fallbackModels: [...]` list may rotate through named models
on transient failure; no unnamed fallback is allowed.

The doctrine is in `AGENTS.md`: **no silent fallbacks**. Required fields
fail loud; named rotations are opt-in.

## What this package does NOT own

Domain policy. Models. Tools. Connectors. UI. Prompts. Rubrics. Those
live in your vertical. The runtime is reusable across many kinds of
agents because nothing in this list is baked into it.

## Next

Run the one example that shows the core move — a driver reading a worker's
output and composing the next step from it: `pnpm tsx examples/driver-loop/driver-loop.ts`
(offline, no creds). Then the [examples map](../examples/README.md) and
[canonical-api.md](./canonical-api.md) — "I want to ___ → use ___".
