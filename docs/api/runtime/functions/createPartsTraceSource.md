[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createPartsTraceSource

# Function: createPartsTraceSource()

> **createPartsTraceSource**(`opts`): [`TraceSource`](../interfaces/TraceSource.md)

Defined in: [runtime/supervise/trace-source.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L198)

A source backed by harness message PARTS (sandbox session, cli-bridge). `collect` reads the full
 part list and decodes the tool calls; `subscribe`, when given, streams parts live for online
 detection. The caller supplies how to get parts (e.g. `box.session(id).messages()` flat-mapped to
 parts) — keeping this module free of any substrate SDK.

## Parameters

### opts

#### collectParts

() => `Promise`\<readonly `unknown`[]\>

#### subscribeParts?

(`onPart`) => () => `void`

#### harness?

`string`

The harness whose decoder to use (e.g. 'opencode'); omit to try every registered adapter.

#### runId?

`string`

#### now?

() => `number`

## Returns

[`TraceSource`](../interfaces/TraceSource.md)
