[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / detachedTurnEvents

# Function: detachedTurnEvents()

> **detachedTurnEvents**(`sessionId`, `turn`): `SandboxEvent`[]

Defined in: [mcp/detached-turn.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L150)

**`Experimental`**

Synthesize the terminal event array a detached turn settles through. Shaped
so the existing event-stream output adapters (coder, researcher) parse it:
`data.result` for adapters that read a structured terminal record, `data.text`
for adapters that scan assistant text for the fenced result block.

## Parameters

### sessionId

`string`

### turn

[`DetachedTurn`](../interfaces/DetachedTurn.md)

## Returns

`SandboxEvent`[]
