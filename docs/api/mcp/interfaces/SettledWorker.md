[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / SettledWorker

# Interface: SettledWorker

Defined in: [mcp/tools/coordination.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L21)

A worker the driver has drained via `await_event`.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L22)

***

### status

> `readonly` **status**: `"done"` \| `"down"`

Defined in: [mcp/tools/coordination.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L23)

***

### score?

> `readonly` `optional` **score?**: `number`

Defined in: [mcp/tools/coordination.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L24)

***

### valid?

> `readonly` `optional` **valid?**: `boolean`

Defined in: [mcp/tools/coordination.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L25)

***

### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [mcp/tools/coordination.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L26)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [mcp/tools/coordination.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L27)
