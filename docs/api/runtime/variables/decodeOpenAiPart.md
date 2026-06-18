[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / decodeOpenAiPart

# Variable: decodeOpenAiPart

> `const` **decodeOpenAiPart**: [`ToolPartDecoder`](../type-aliases/ToolPartDecoder.md)

Defined in: [runtime/supervise/trace-source.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L109)

OpenAI-compatible (router / kimi's top-level form / glm): `{ type:'function'|'tool_call', id,
 function:{ name, arguments:<JSON string> } }`. CONFIRMED against the cli-bridge (kimi.ts surfaces
 kimi's top-level `tool_calls:[{type:'function', id, function:{name,arguments}}]` exactly this way).
 NOTE: codex does NOT emit structured tool calls (the bridge's codex.ts never yields `tool_calls` —
 it runs shell internally and surfaces only text), so per-tool detection is unavailable for codex
 from any path — a harness property, not a decoder gap.
