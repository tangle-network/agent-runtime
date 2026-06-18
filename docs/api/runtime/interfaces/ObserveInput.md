[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ObserveInput

# Interface: ObserveInput

Defined in: [runtime/observe.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L23)

## Properties

### task

> **task**: `string`

Defined in: [runtime/observe.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L25)

What the worker was asked to do.

***

### output

> **output**: `string`

Defined in: [runtime/observe.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L27)

What it produced (its final answer / artifact summary).

***

### trace

> **trace**: readonly `unknown`[]

Defined in: [runtime/observe.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L29)

The worker's trace — any event array (sandbox events, tool-call records).

***

### outcome?

> `optional` **outcome?**: `"failed"` \| `"unknown"` \| `"passed"`

Defined in: [runtime/observe.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L32)

Terminal status only (passed/failed/unknown) — NOT a judge score; the
 observer never reads the verdict, it reads behavior.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/observe.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L34)

Provenance back to the run.
