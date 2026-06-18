[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / DriverMessage

# Interface: DriverMessage

Defined in: [runtime/supervise/coordination-driver.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L40)

A turn in the driver↔tools conversation. Tool results ride back as `role: 'tool'`.

## Properties

### role

> `readonly` **role**: `"tool"` \| `"user"` \| `"assistant"`

Defined in: [runtime/supervise/coordination-driver.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L41)

***

### content

> `readonly` **content**: `string`

Defined in: [runtime/supervise/coordination-driver.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L42)

***

### toolCalls?

> `readonly` `optional` **toolCalls?**: readonly [`DriverToolCall`](DriverToolCall.md)[]

Defined in: [runtime/supervise/coordination-driver.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L43)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [runtime/supervise/coordination-driver.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L44)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [runtime/supervise/coordination-driver.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L45)
