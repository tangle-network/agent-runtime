[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createKbGate

# Function: createKbGate()

> **createKbGate**(`options?`): (`candidate`) => `Promise`\<[`KbGateResult`](../interfaces/KbGateResult.md)\>

Defined in: [mcp/kb-gate.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L137)

**`Experimental`**

Build a fail-closed KB gate. The returned function runs the built-in floor
(passage-non-empty → passage-present → value-in-passage → no-circular-citation)
then any consumer judges, returning on the first veto.

## Parameters

### options?

[`CreateKbGateOptions`](../interfaces/CreateKbGateOptions.md) = `{}`

## Returns

(`candidate`) => `Promise`\<[`KbGateResult`](../interfaces/KbGateResult.md)\>
