[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BusRecord

# Interface: BusRecord\<E\>

Defined in: [runtime/supervise/event-bus.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L32)

A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms).

## Type Parameters

### E

`E` *extends* [`BusEvent`](BusEvent.md)

## Properties

### seq

> `readonly` **seq**: `number`

Defined in: [runtime/supervise/event-bus.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L33)

***

### at

> `readonly` **at**: `number`

Defined in: [runtime/supervise/event-bus.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L34)

***

### priority

> `readonly` **priority**: `number`

Defined in: [runtime/supervise/event-bus.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L35)

***

### event

> `readonly` **event**: `E`

Defined in: [runtime/supervise/event-bus.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L36)
