[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / spendFromUsageEvents

# Function: spendFromUsageEvents()

> **spendFromUsageEvents**(`events`): [`Spend`](../interfaces/Spend.md)

Defined in: [runtime/supervise/budget.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L92)

Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate
 channels; iterations come from `'iteration'` events. Pure; `ms` stays zero (the
 pool does not read wall-clock).

## Parameters

### events

[`UsageEvent`](../type-aliases/UsageEvent.md)[]

## Returns

[`Spend`](../interfaces/Spend.md)
