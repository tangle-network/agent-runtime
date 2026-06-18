[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / DeliveredAgent

# Type Alias: DeliveredAgent\<I, O\>

> **DeliveredAgent**\<`I`, `O`\> = (`input`, `applied`) => `Promise`\<`O`\>

Defined in: [intelligence/delivery.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L191)

An agent wrapped by [withCertifiedDelivery](../functions/withCertifiedDelivery.md): receives the input plus
 the certified intelligence delivered for this run.

## Type Parameters

### I

`I`

### O

`O`

## Parameters

### input

`I`

### applied

[`AppliedIntelligence`](../interfaces/AppliedIntelligence.md)

## Returns

`Promise`\<`O`\>
