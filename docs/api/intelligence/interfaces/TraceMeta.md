[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / TraceMeta

# Interface: TraceMeta

Defined in: [intelligence/index.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L151)

Metadata describing one traced run. `runId`/`traceId` default to fresh ids.

## Properties

### input?

> `optional` **input?**: `unknown`

Defined in: [intelligence/index.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L153)

The run's input — exported through the redactor.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [intelligence/index.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L155)

Stable run id. Defaults to a fresh id.

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [intelligence/index.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L157)

32-hex trace id. Defaults to a fresh id.

***

### model?

> `optional` **model?**: `string`

Defined in: [intelligence/index.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L159)

Model id, when known — stamped on the span.

***

### provider?

> `optional` **provider?**: `string`

Defined in: [intelligence/index.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L161)

Provider name, when known — stamped on the span.

***

### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [intelligence/index.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L163)

Arbitrary extra labels (string/number/boolean) stamped on the span.
