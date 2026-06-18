[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopIterationEndedPayload

# Interface: LoopIterationEndedPayload

Defined in: [runtime/types.ts:427](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L427)

**`Experimental`**

## Properties

### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L428)

**`Experimental`**

***

### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:429](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L429)

**`Experimental`**

***

### outputHash?

> `optional` **outputHash?**: `string`

Defined in: [runtime/types.ts:430](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L430)

**`Experimental`**

***

### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/types.ts:431](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L431)

**`Experimental`**

***

### error?

> `optional` **error?**: `string`

Defined in: [runtime/types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L432)

**`Experimental`**

***

### costUsd

> **costUsd**: `number`

Defined in: [runtime/types.ts:433](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L433)

**`Experimental`**

***

### durationMs

> **durationMs**: `number`

Defined in: [runtime/types.ts:434](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L434)

**`Experimental`**

***

### tokenUsage?

> `optional` **tokenUsage?**: [`LoopTokenUsage`](LoopTokenUsage.md)

Defined in: [runtime/types.ts:437](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L437)

**`Experimental`**

Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
 branch span. Omitted when no `llm_call` events carried token counts.

***

### groupId?

> `optional` **groupId?**: `number`

Defined in: [runtime/types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L439)

**`Experimental`**

Plan round this iteration belongs to.

***

### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L441)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### outputPreview?

> `optional` **outputPreview?**: `string`

Defined in: [runtime/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L444)

**`Experimental`**

Truncated string preview of the parsed output — for a viewer's drawer.
 Bounded to ~280 chars; never the full payload.
