[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createInProcessTransport

# Function: createInProcessTransport()

> **createInProcessTransport**(): `object`

Defined in: [mcp/server.ts:367](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L367)

**`Experimental`**

In-process pair of `Readable` + `Writable` streams suitable for driving
`server.serve(...)` from a test. Returns the agent-side stream (the
client writes to it) and the server-side stream (the test reads from it).

## Returns

`object`

### transport

> **transport**: [`McpTransport`](../interfaces/McpTransport.md)

### clientWrite()

> **clientWrite**(`line`): `void`

#### Parameters

##### line

`string`

#### Returns

`void`

### clientClose()

> **clientClose**(): `void`

#### Returns

`void`

### readServer()

> **readServer**(): `Promise`\<[`JsonRpcResponse`](../interfaces/JsonRpcResponse.md)[]\>

#### Returns

`Promise`\<[`JsonRpcResponse`](../interfaces/JsonRpcResponse.md)[]\>
