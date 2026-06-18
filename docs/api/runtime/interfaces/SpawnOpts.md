[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SpawnOpts

# Interface: SpawnOpts

Defined in: [runtime/supervise/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L227)

## Properties

### budget

> `readonly` **budget**: [`Budget`](Budget.md)

Defined in: [runtime/supervise/types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L228)

***

### label

> `readonly` **label**: `string`

Defined in: [runtime/supervise/types.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L229)

***

### restart?

> `readonly` `optional` **restart?**: [`Restart`](../type-aliases/Restart.md)

Defined in: [runtime/supervise/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L230)

***

### shutdown?

> `readonly` `optional` **shutdown?**: `number` \| `"brutalKill"` \| `"infinity"`

Defined in: [runtime/supervise/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L232)

Teardown grace handed to the executor when this node is reaped.
