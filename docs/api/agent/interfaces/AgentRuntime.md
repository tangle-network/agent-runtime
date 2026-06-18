[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AgentRuntime

# Interface: AgentRuntime\<TPersona, TRunOutput\>

Defined in: [agent/define-agent.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L159)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Type Parameters

### TPersona

`TPersona`

### TRunOutput

`TRunOutput`

## Properties

### act

> **act**: (`persona`, `ctx`) => [`AgentRunInvocation`](AgentRunInvocation.md)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L184)

Invoke the agent against one persona. Returns BOTH:
  - `events`: an `AsyncIterable<RuntimeStreamEvent>` the chat-centric
    product consumes verbatim (SSE / WebSocket / inline render).
    **Streaming is mandatory — never collapse this to a single Promise.**
    The agent's existing `runChatTurn` (or equivalent async generator)
    plugs in here directly.
  - `output`: a `Promise<TRunOutput>` resolved AFTER the event stream
    drains. The eval substrate awaits this for rubric scoring; chat
    products usually ignore it (they already rendered incrementally).

Implementation contract:
  1. `act` MUST return immediately (synchronous construction of the
     `events` iterator + the `output` promise).
  2. Iterating `events` drives the underlying LLM/tool calls — the
     caller chooses when to consume.
  3. `output` resolves only after the iterator yields its terminal
     event (typically `task_end`); see `collectAgentRun` helper.

`ctx.emitter` is the substrate-threaded `TraceEmitter` — runtimes
SHOULD record LLM/tool spans through it for capture integrity.
`ctx.deadlineMs` is wall-clock; the runtime SHOULD honour for graceful
cancel. `ctx.signal` is the standard abort signal.

#### Parameters

##### persona

`TPersona`

##### ctx

[`AgentRunContext`](AgentRunContext.md)

#### Returns

[`AgentRunInvocation`](AgentRunInvocation.md)\<`TRunOutput`\>
