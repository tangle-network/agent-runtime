[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / McpServer

# Interface: McpServer

Defined in: [mcp/server.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L121)

**`Experimental`**

## Properties

### tools

> `readonly` **tools**: `ReadonlyMap`\<`string`, [`McpToolDescriptor`](McpToolDescriptor.md)\>

Defined in: [mcp/server.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L123)

**`Experimental`**

Tools currently registered (depend on which delegates were wired).

***

### queue

> `readonly` **queue**: [`DelegationTaskQueue`](../classes/DelegationTaskQueue.md)

Defined in: [mcp/server.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L125)

**`Experimental`**

The underlying queue — exposed so tests can introspect it.

***

### feedbackStore

> `readonly` **feedbackStore**: [`FeedbackStore`](FeedbackStore.md)

Defined in: [mcp/server.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L127)

**`Experimental`**

The feedback store — exposed for the same reason.

## Methods

### handle()

> **handle**(`message`): `Promise`\<[`JsonRpcResponse`](JsonRpcResponse.md) \| `null`\>

Defined in: [mcp/server.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L129)

**`Experimental`**

Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications).

#### Parameters

##### message

[`JsonRpcMessage`](JsonRpcMessage.md)

#### Returns

`Promise`\<[`JsonRpcResponse`](JsonRpcResponse.md) \| `null`\>

***

### serve()

> **serve**(`transport?`): `Promise`\<`void`\>

Defined in: [mcp/server.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L131)

**`Experimental`**

Drive the server on a stdio-shaped transport until `stop()` is called.

#### Parameters

##### transport?

[`McpTransport`](McpTransport.md)

#### Returns

`Promise`\<`void`\>

***

### stop()

> **stop**(): `void`

Defined in: [mcp/server.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L133)

**`Experimental`**

Stop a `serve` call. Subsequent requests are rejected.

#### Returns

`void`
