[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / JsonSchema

# Type Alias: JsonSchema

> **JsonSchema** = `Record`\<`string`, `unknown`\>

Defined in: [intelligence/capability.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L36)

A JSON Schema object describing a tool's parameters. Kept structural — the
 resolver forwards it verbatim into a `ToolSpec` / MCP `tools/list` check.
