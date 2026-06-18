[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BusStats

# Interface: BusStats

Defined in: [runtime/supervise/event-bus.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L49)

## Properties

### published

> `readonly` **published**: `number`

Defined in: [runtime/supervise/event-bus.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L50)

***

### pulled

> `readonly` **pulled**: `number`

Defined in: [runtime/supervise/event-bus.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L51)

***

### byKind

> `readonly` **byKind**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [runtime/supervise/event-bus.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L53)

Count published per event `type`.
