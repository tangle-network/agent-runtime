[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PublishOptions

# Interface: PublishOptions

Defined in: [runtime/supervise/event-bus.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L39)

## Properties

### priority?

> `readonly` `optional` **priority?**: `number`

Defined in: [runtime/supervise/event-bus.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L42)

Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
 this so it bumps to the front of the driver's inbox.

***

### queue?

> `readonly` `optional` **queue?**: `boolean`

Defined in: [runtime/supervise/event-bus.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L46)

Whether the event enters the pull queue (default true). Set `false` for record-only events —
 the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
 `subscribe` observers, but the parent must never `pull` its own outbound message back.
