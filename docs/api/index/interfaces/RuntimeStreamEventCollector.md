[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeStreamEventCollector

# Interface: RuntimeStreamEventCollector

Defined in: [sanitize.ts:522](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L522)

## Stable

## Properties

### onEvent

> **onEvent**: `RuntimeStreamEventSink`

Defined in: [sanitize.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L523)

***

### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [sanitize.ts:524](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L524)

## Methods

### summary()

> **summary**(): `RuntimeStreamEventSummary`

Defined in: [sanitize.ts:526](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L526)

Snapshot of a small streaming-flavored summary derived from collected events.

#### Returns

`RuntimeStreamEventSummary`
