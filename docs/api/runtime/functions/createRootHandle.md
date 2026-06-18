[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createRootHandle

# Function: createRootHandle()

> **createRootHandle**\<`Out`\>(): [`RootHandle`](../interfaces/RootHandle.md)\<`Out`\>

Defined in: [runtime/supervise/supervisor.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor.ts#L254)

Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a
chat/pi-viz client attaches to (Q2): `view()` reads the live tree, `signal()` delivers
an out-of-band message, `abort()` cascades. Before `run` binds it (and after `run`
unbinds it) the handle is fail-loud: a client that talks to a handle that is not
driving a live run gets a typed error, never a silent no-op.

## Type Parameters

### Out

`Out`

## Returns

[`RootHandle`](../interfaces/RootHandle.md)\<`Out`\>
