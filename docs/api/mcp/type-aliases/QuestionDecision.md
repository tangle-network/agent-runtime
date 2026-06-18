[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / QuestionDecision

# Type Alias: QuestionDecision

> **QuestionDecision** = \{ `kind`: `"answer"`; `answer`: `string`; `by`: `string`; \} \| \{ `kind`: `"defer"`; `reason`: `string`; \} \| \{ `kind`: `"escalate"`; `to`: `"parent"` \| `"user"` \| `string`; `reason`: `string`; \}

Defined in: [mcp/tools/coordination.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L48)
