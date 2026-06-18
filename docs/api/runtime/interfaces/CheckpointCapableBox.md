[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CheckpointCapableBox

# Interface: CheckpointCapableBox

Defined in: [runtime/sandbox-lineage.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L375)

**`Experimental`**

Loop-side widening of the box's optional checkpoint method. The
`SandboxClient`/`SandboxInstance` surface the kernel relies on does not
require checkpointing; this reads it optionally so the lineage can probe-gate
without importing sandbox-backend specifics.

## Properties

### checkpoint?

> `optional` **checkpoint?**: (`options?`) => `Promise`\<\{ `checkpointId`: `string`; \}\>

Defined in: [runtime/sandbox-lineage.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L376)

**`Experimental`**

#### Parameters

##### options?

###### leaveRunning?

`boolean`

###### tags?

`string`[]

#### Returns

`Promise`\<\{ `checkpointId`: `string`; \}\>
