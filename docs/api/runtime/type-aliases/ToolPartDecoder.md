[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ToolPartDecoder

# Type Alias: ToolPartDecoder

> **ToolPartDecoder** = (`part`) => [`ToolStepInput`](../interfaces/ToolStepInput.md) \| `undefined`

Defined in: [runtime/supervise/trace-source.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L60)

Decode one harness message part into a tool step, or `undefined` if it is not a (completed) tool
 call. ONE adapter per harness family — each owns its real wire shape; the flow downstream is
 identical. Add a harness = add a decoder + register it; no other code changes.

## Parameters

### part

`Record`\<`string`, `unknown`\>

## Returns

[`ToolStepInput`](../interfaces/ToolStepInput.md) \| `undefined`
