[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / BuildDelegationMcpServerOptions

# Interface: BuildDelegationMcpServerOptions

Defined in: [mcp/delegation-profile.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L50)

## Properties

### sandboxApiKey?

> `optional` **sandboxApiKey?**: `string`

Defined in: [mcp/delegation-profile.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L54)

Sandbox API key forwarded as `TANGLE_API_KEY` to the MCP child. The
 agent-runtime MCP bin reads `TANGLE_API_KEY` and passes it straight to
 `new Sandbox({ apiKey })`. Defaults to `env.TANGLE_API_KEY`.

***

### sandboxBaseUrl?

> `optional` **sandboxBaseUrl?**: `string`

Defined in: [mcp/delegation-profile.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L58)

Sandbox base URL forwarded as `SANDBOX_BASE_URL`. Defaults to
 `env.SANDBOX_BASE_URL`, then `env.SANDBOX_API_URL`, then the public
 sandbox endpoint.

***

### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [mcp/delegation-profile.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L61)

Environment source for key + OTEL resolution. Defaults to `process.env`;
 injectable for tests and non-process callers.
