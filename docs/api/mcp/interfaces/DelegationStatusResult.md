[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationStatusResult

# Interface: DelegationStatusResult

Defined in: [mcp/types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L244)

**`Experimental`**

## Properties

### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L245)

**`Experimental`**

***

### profile

> **profile**: [`DelegationProfile`](../type-aliases/DelegationProfile.md)

Defined in: [mcp/types.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L246)

**`Experimental`**

***

### status

> **status**: [`DelegationStatus`](../type-aliases/DelegationStatus.md)

Defined in: [mcp/types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L247)

**`Experimental`**

***

### progress?

> `optional` **progress?**: [`DelegationProgress`](DelegationProgress.md)

Defined in: [mcp/types.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L248)

**`Experimental`**

***

### result?

> `optional` **result?**: [`DelegationResultPayload`](../type-aliases/DelegationResultPayload.md)

Defined in: [mcp/types.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L249)

**`Experimental`**

***

### error?

> `optional` **error?**: [`DelegationError`](DelegationError.md)

Defined in: [mcp/types.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L250)

**`Experimental`**

***

### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L251)

**`Experimental`**

***

### startedAt

> **startedAt**: `string`

Defined in: [mcp/types.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L252)

**`Experimental`**

***

### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/types.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L253)

**`Experimental`**

***

### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](DelegationTraceSpan.md)[]

Defined in: [mcp/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L255)

**`Experimental`**

Compact loop-trace span tree; present only when `includeTrace: true` was passed and spans were recorded.

***

### traceTruncated?

> `optional` **traceTruncated?**: `true`

Defined in: [mcp/types.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L257)

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/types.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L259)

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/types.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L261)

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.
