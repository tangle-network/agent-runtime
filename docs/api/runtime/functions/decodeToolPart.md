[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / decodeToolPart

# Function: decodeToolPart()

> **decodeToolPart**(`part`, `harness?`): [`ToolStepInput`](../interfaces/ToolStepInput.md) \| `undefined`

Defined in: [runtime/supervise/trace-source.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L138)

Decode a part with a specific harness's adapter when known, else try every registered adapter
 (the composite — robust to mixed/unknown streams). Never throws.

## Parameters

### part

`unknown`

### harness?

`string`

## Returns

[`ToolStepInput`](../interfaces/ToolStepInput.md) \| `undefined`
