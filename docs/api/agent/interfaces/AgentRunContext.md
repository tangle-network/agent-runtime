[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AgentRunContext

# Interface: AgentRunContext

Defined in: [agent/define-agent.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L231)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Properties

### emitter

> **emitter**: `TraceEmitter`

Defined in: [agent/define-agent.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L233)

Substrate-managed trace emitter.

***

### runId

> **runId**: `string`

Defined in: [agent/define-agent.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L235)

Stable run id for this persona × variant cell.

***

### variantId?

> `optional` **variantId?**: `string`

Defined in: [agent/define-agent.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L237)

Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`).

***

### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [agent/define-agent.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L239)

Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [agent/define-agent.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L241)

Optional abort signal.
