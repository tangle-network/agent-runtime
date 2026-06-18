[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationResultPayload

# Type Alias: DelegationResultPayload

> **DelegationResultPayload** = \{ `profile`: `"coder"`; `output`: `CoderOutput`; \} \| \{ `profile`: `"researcher"`; `output`: [`ResearchOutputShape`](../interfaces/ResearchOutputShape.md); \} \| \{ `profile`: `"ui-auditor"`; `output`: [`UiAuditorDelegationOutput`](../interfaces/UiAuditorDelegationOutput.md); \}

Defined in: [mcp/types.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L156)

**`Experimental`**

Polymorphic `result` field: `CoderOutput` when the underlying profile
is `'coder'`, a structurally-typed research output when `'researcher'`.
The MCP wire carries it as JSON either way.
