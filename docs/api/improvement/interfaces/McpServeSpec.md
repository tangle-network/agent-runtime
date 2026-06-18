[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / McpServeSpec

# Interface: McpServeSpec

Defined in: [improvement/mcp-serve-verifier.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L24)

## Properties

### command

> **command**: `string`

Defined in: [improvement/mcp-serve-verifier.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L26)

Command that starts the built MCP server in the worktree (stdio transport).

***

### args?

> `optional` **args?**: `string`[]

Defined in: [improvement/mcp-serve-verifier.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L27)

***

### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [improvement/mcp-serve-verifier.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L29)

Extra env for the server process (merged over `process.env`).

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/mcp-serve-verifier.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L31)

Handshake timeout (ms). Default 30s.

***

### minTools?

> `optional` **minTools?**: `number`

Defined in: [improvement/mcp-serve-verifier.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L33)

Minimum tools the server must expose to pass. Default 1.
