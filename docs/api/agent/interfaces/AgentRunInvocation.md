[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AgentRunInvocation

# Interface: AgentRunInvocation\<TRunOutput\>

Defined in: [agent/define-agent.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L187)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Type Parameters

### TRunOutput

`TRunOutput`

## Properties

### events

> **events**: `AsyncIterable`\<[`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md)\>

Defined in: [agent/define-agent.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L189)

Live stream of typed runtime events. Consumed by chat UX directly.

***

### output

> **output**: `Promise`\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L191)

Final structured output the rubric scores. Resolves after `events` drains.
