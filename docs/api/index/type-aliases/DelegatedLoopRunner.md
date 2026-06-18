[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / DelegatedLoopRunner

# Type Alias: DelegatedLoopRunner\<T\>

> **DelegatedLoopRunner**\<`T`\> = (`signal`) => `Promise`\<`T`\>

Defined in: [loop-runner.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L67)

**`Experimental`**

A pre-configured loop for one mode. Returns the mode's raw
 output; the dispatcher wraps it in a [DelegatedLoopResult](../interfaces/DelegatedLoopResult.md).

## Type Parameters

### T

`T` = `unknown`

## Parameters

### signal

`AbortSignal`

## Returns

`Promise`\<`T`\>
