[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / isIntelligenceOff

# Function: isIntelligenceOff()

> **isIntelligenceOff**(`settings`): `boolean`

Defined in: [intelligence/effort.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L128)

True when these settings admit NO intelligence spawn — the passthrough
predicate the wrapper branches on. Every intelligence axis must be off:
analysts disabled, corpus off, no breadth, no loops, and a zero intelligence
budget. A caller who overrides any one of these back on is no longer at the
OFF floor and the wrapper treats them as an intelligence-enabled run.

## Parameters

### settings

[`EffortSettings`](../interfaces/EffortSettings.md)

## Returns

`boolean`
