[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegateCodeConfig

# Interface: DelegateCodeConfig

Defined in: [mcp/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L34)

**`Experimental`**

Minimal `CoderTask` overrides exposed over the MCP wire. The full
`CoderTask` carries fields the kernel synthesizes from `goal` +
`repoRoot` — the agent only edits the few that materially gate
validator behavior.

## Properties

### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [mcp/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L35)

**`Experimental`**

***

### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [mcp/types.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L36)

**`Experimental`**

***

### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [mcp/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L37)

**`Experimental`**

***

### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [mcp/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L38)

**`Experimental`**
