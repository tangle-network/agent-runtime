[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / startRuntimeRun

# Function: startRuntimeRun()

> **startRuntimeRun**(`options`): [`RuntimeRunHandle`](../interfaces/RuntimeRunHandle.md)

Defined in: [runtime-run.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L148)

## Parameters

### options

`RuntimeRunOptions`

## Returns

[`RuntimeRunHandle`](../interfaces/RuntimeRunHandle.md)

## Stable

Construct a runtime-run handle. The returned handle is mutable across its
lifetime; consumers should not share it across requests.
