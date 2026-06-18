[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / createRuntimeStreamEventCollector

# Function: createRuntimeStreamEventCollector()

> **createRuntimeStreamEventCollector**(`options?`): [`RuntimeStreamEventCollector`](../interfaces/RuntimeStreamEventCollector.md)

Defined in: [sanitize.ts:557](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L557)

## Parameters

### options?

[`RuntimeTelemetryOptions`](../interfaces/RuntimeTelemetryOptions.md) = `{}`

## Returns

[`RuntimeStreamEventCollector`](../interfaces/RuntimeStreamEventCollector.md)

## Stable

Streaming-event counterpart of `createRuntimeEventCollector`. Pass each
event yielded by `runAgentTaskStream` through `onEvent` and read the
sanitized copies off `events`; the same `RuntimeTelemetryOptions` redaction
flags apply. Kept distinct from `createRuntimeEventCollector` because the
stream and non-stream event shapes overlap on `type` literals — dispatching
on `type` alone would misroute events.
