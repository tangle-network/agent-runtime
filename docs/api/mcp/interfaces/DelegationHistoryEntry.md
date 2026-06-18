[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationHistoryEntry

# Interface: DelegationHistoryEntry

Defined in: [mcp/types.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L285)

**`Experimental`**

## Properties

### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L286)

**`Experimental`**

***

### profile

> **profile**: [`DelegationProfile`](../type-aliases/DelegationProfile.md)

Defined in: [mcp/types.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L287)

**`Experimental`**

***

### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:288](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L288)

**`Experimental`**

***

### args

> **args**: [`DelegateCodeArgs`](DelegateCodeArgs.md) \| [`DelegateResearchArgs`](DelegateResearchArgs.md) \| [`DelegateUiAuditArgs`](DelegateUiAuditArgs.md)

Defined in: [mcp/types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L289)

**`Experimental`**

***

### status

> **status**: [`DelegationStatus`](../type-aliases/DelegationStatus.md)

Defined in: [mcp/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L290)

**`Experimental`**

***

### feedback?

> `optional` **feedback?**: [`DelegationFeedbackSnapshot`](DelegationFeedbackSnapshot.md)[]

Defined in: [mcp/types.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L291)

**`Experimental`**

***

### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/types.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L292)

**`Experimental`**

***

### startedAt

> **startedAt**: `string`

Defined in: [mcp/types.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L293)

**`Experimental`**

***

### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/types.ts:294](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L294)

**`Experimental`**

***

### hasTrace

> **hasTrace**: `boolean`

Defined in: [mcp/types.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L300)

**`Experimental`**

True when the record carries a journaled loop trace. History stays
light by design — fetch the spans via
`delegation_status { taskId, includeTrace: true }`.

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/types.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L302)

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.
