[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SessionCapableBox

# Interface: SessionCapableBox

Defined in: [runtime/sandbox-lineage.ts:393](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L393)

**`Experimental`**

Loop-side widening of the box's optional session accessor. The real
`SandboxInstance` exposes `session(id).status()`; the loop reads it optionally
so `continue` can assert session liveness without requiring it of the test
fakes. `status()` resolves `null` when the id is unknown to the sandbox.

## Properties

### session?

> `optional` **session?**: (`id`) => `object`

Defined in: [runtime/sandbox-lineage.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L394)

**`Experimental`**

#### Parameters

##### id

`string`

#### Returns

`object`

##### status

> **status**: () => `Promise`\<`unknown`\>

###### Returns

`Promise`\<`unknown`\>
