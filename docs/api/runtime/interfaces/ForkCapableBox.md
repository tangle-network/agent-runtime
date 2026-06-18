[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ForkCapableBox

# Interface: ForkCapableBox

Defined in: [runtime/sandbox-lineage.ts:382](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L382)

**`Experimental`**

Loop-side widening of the box's optional fork method.

## Properties

### fork?

> `optional` **fork?**: (`checkpointId`, `options?`) => `Promise`\<`SandboxInstance`\>

Defined in: [runtime/sandbox-lineage.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L383)

**`Experimental`**

#### Parameters

##### checkpointId

`string`

##### options?

###### name?

`string`

#### Returns

`Promise`\<`SandboxInstance`\>
