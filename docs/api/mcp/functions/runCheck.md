[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / runCheck

# Function: runCheck()

> **runCheck**(`kind`, `trace`, `opts`, `producedAt`): `Promise`\<`AnalystFinding`[]\>

Defined in: [mcp/tools/checks.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L219)

Run ONE lens over a trace → findings. Generic over any kind: prompt = the lens + the agent-eval
 finding schema; the model's JSON array is parsed (`parseRawFinding`), lifted, and firewalled.

## Parameters

### kind

[`Check`](../interfaces/Check.md)

### trace

`unknown`

### opts

[`CheckRunnerOptions`](../interfaces/CheckRunnerOptions.md)

### producedAt

`string`

## Returns

`Promise`\<`AnalystFinding`[]\>
