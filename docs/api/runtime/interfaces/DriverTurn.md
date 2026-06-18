[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / DriverTurn

# Interface: DriverTurn

Defined in: [runtime/supervise/coordination-driver.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L49)

What the driver LLM returns each turn. No `toolCalls` => the driver is finished.

## Properties

### toolCalls?

> `readonly` `optional` **toolCalls?**: readonly [`DriverToolCall`](DriverToolCall.md)[]

Defined in: [runtime/supervise/coordination-driver.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L50)

***

### content?

> `readonly` `optional` **content?**: `string`

Defined in: [runtime/supervise/coordination-driver.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L52)

The driver's natural-language output — the answer when there are no tool calls.

***

### usage?

> `readonly` `optional` **usage?**: `object`

Defined in: [runtime/supervise/coordination-driver.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L56)

The driver LLM's OWN token usage for THIS turn — metered against the conserved pool so the
 driver's inference counts toward equal-k AND the in-loop budget guard. Omit for a scripted/
 mock turn (no real inference); production `routerDriverChat` forwards it from the router.

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

***

### costUsd?

> `readonly` `optional` **costUsd?**: `number`

Defined in: [runtime/supervise/coordination-driver.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L58)

The turn's inference cost (usd), when the provider priced it.
