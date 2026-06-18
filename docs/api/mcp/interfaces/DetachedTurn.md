[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DetachedTurn

# Interface: DetachedTurn

Defined in: [mcp/detached-turn.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L135)

**`Experimental`**

The terminal payload of a finished detached turn.

## Properties

### text

> **text**: `string`

Defined in: [mcp/detached-turn.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L137)

**`Experimental`**

Final assistant text.

***

### result

> **result**: `Record`\<`string`, `unknown`\>

Defined in: [mcp/detached-turn.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L139)

**`Experimental`**

The SDK's cached AgentExecutionResult-shape record for the turn.
