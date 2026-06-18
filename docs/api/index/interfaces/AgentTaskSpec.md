[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentTaskSpec

# Interface: AgentTaskSpec

Defined in: [types.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L26)

## Stable

## Properties

### id

> **id**: `string`

Defined in: [types.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L27)

***

### intent

> **intent**: `string`

Defined in: [types.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L28)

***

### domain?

> `optional` **domain?**: `string`

Defined in: [types.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L30)

Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc.

***

### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L31)

***

### requiredKnowledge?

> `optional` **requiredKnowledge?**: `KnowledgeRequirement`[]

Defined in: [types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L32)

***

### budget?

> `optional` **budget?**: `Partial`\<`ControlBudget`\>

Defined in: [types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L33)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L34)
