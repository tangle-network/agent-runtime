[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / watchTrace

# Function: watchTrace()

> **watchTrace**(`source`, `opts?`): () => `void`

Defined in: [runtime/supervise/detector-monitor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L43)

Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an
 unsubscribe. A defensive `argHash` failure (circular args) never throws out of the side-channel.

## Parameters

### source

[`TraceSource`](../interfaces/TraceSource.md)

### opts?

[`WatchTraceOptions`](../interfaces/WatchTraceOptions.md) = `{}`

## Returns

() => `void`
