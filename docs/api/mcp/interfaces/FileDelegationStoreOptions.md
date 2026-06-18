[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FileDelegationStoreOptions

# Interface: FileDelegationStoreOptions

Defined in: [mcp/delegation-store.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L99)

**`Experimental`**

## Properties

### filePath

> **filePath**: `string`

Defined in: [mcp/delegation-store.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L101)

**`Experimental`**

Absolute path of the JSON state file. Parent directories are created on first write.

***

### recoverCorrupt?

> `optional` **recoverCorrupt?**: `boolean`

Defined in: [mcp/delegation-store.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L107)

**`Experimental`**

When the state file exists but cannot be parsed, archive it to
`<filePath>.corrupt-<timestamp>` and start empty instead of
throwing `DelegationStateCorruptError`. Default false.
