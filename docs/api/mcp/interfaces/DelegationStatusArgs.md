[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationStatusArgs

# Interface: DelegationStatusArgs

Defined in: [mcp/types.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L126)

**`Experimental`**

## Properties

### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L127)

**`Experimental`**

***

### includeTrace?

> `optional` **includeTrace?**: `boolean`

Defined in: [mcp/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L134)

**`Experimental`**

Return the delegation's compact loop-trace span tree alongside the
status. Default false — status polls stay light; opt in when you need
the topology (which iterations ran, where they were placed, what each
cost) rather than just the state machine.
