[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ObserveOptions

# Interface: ObserveOptions

Defined in: [runtime/observe.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L37)

## Properties

### chat

> **chat**: `ChatClient`

Defined in: [runtime/observe.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L39)

The model-call seam (agent-eval `createChatClient`: router / cli-bridge / …).

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/observe.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L40)

***

### corpus?

> `optional` **corpus?**: [`Corpus`](Corpus.md)

Defined in: [runtime/observe.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L42)

When set, learned facts are appended (idempotent) for the next run to read.

***

### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [runtime/observe.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L44)

Tags written onto learned facts + used by the next run's corpus query.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/observe.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L45)

***

### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: [runtime/observe.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L47)

Cap the trace lines fed to the observer (keeps the call cheap). Default 80.

***

### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/observe.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L53)

Override the analyst's system instruction — the prompt that turns a trace into
 findings + recommended_actions. The analyst IS the steerer, so this is the knob a
 prompt optimizer (GEPA) tunes. Omitted ⇒ the default observer instruction. The
 firewall (trace-only, never the verdict) is structural (input has no score), so a
 custom instruction cannot break it.
