[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / decodeAnthropicPart

# Variable: decodeAnthropicPart

> `const` **decodeAnthropicPart**: [`ToolPartDecoder`](../type-aliases/ToolPartDecoder.md)

Defined in: [runtime/supervise/trace-source.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L91)

Anthropic / claude-code (also kimi's tool_use variant): a `{ type:'tool_use', id|tool_use_id,
 name|tool, input }` content block. CONFIRMED against the cli-bridge's authoritative parsers
 (claude.ts reads `block.type==='tool_use', block.id, block.name, block.input`; kimi.ts adds the
 `tool_use_id`/`tool` fallbacks) — the canonical readers of these harnesses' real native output.
