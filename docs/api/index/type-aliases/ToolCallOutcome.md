[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ToolCallOutcome

# Type Alias: ToolCallOutcome

> **ToolCallOutcome** = \{ `ok`: `true`; `result`: `unknown`; \} \| \{ `ok`: `false`; `code`: `string`; `message`: `string`; `status?`: `number`; \}

Defined in: [tool-loop.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L30)

Outcome of one tool dispatch — structurally compatible with a hub/integration
 tool-outcome union, so callers can fold either through the loop.
