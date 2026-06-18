[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TraceSource

# Interface: TraceSource

Defined in: [runtime/supervise/trace-source.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L33)

## Methods

### onSpan()

> **onSpan**(`handler`): () => `void`

Defined in: [runtime/supervise/trace-source.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L36)

Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
 only exposes its trace at the end registers nothing and returns a no-op.

#### Parameters

##### handler

(`span`) => `void`

#### Returns

() => `void`

***

### collect()

> **collect**(): `Promise`\<`ToolSpan`[]\>

Defined in: [runtime/supervise/trace-source.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L38)

The full set of tool spans for the run (SETTLE / batch). Always available.

#### Returns

`Promise`\<`ToolSpan`[]\>
