[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / DriverChat

# Interface: DriverChat

Defined in: [runtime/supervise/coordination-driver.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L62)

The injected driver-LLM seam: one turn over the conversation + the coordination tool specs.

## Methods

### next()

> **next**(`input`): `Promise`\<[`DriverTurn`](DriverTurn.md)\>

Defined in: [runtime/supervise/coordination-driver.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L63)

#### Parameters

##### input

###### system

`string`

###### messages

readonly [`DriverMessage`](DriverMessage.md)[]

###### tools

readonly `object`[]

#### Returns

`Promise`\<[`DriverTurn`](DriverTurn.md)\>
