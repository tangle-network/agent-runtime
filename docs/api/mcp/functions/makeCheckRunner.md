[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / makeCheckRunner

# Function: makeCheckRunner()

> **makeCheckRunner**(`kinds`, `opts`): (`kindId`, `trace`, `producedAt`) => `Promise`\<`AnalystFinding`[] \| \{ `error`: `string`; \}\>

Defined in: [mcp/tools/checks.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L271)

Build a `run_analyst` runner over a kind directory.
Returns findings, or a typed error for an unknown kind. `producedAt` is
passed in because replay-safe paths must not read `Date.now`.

## Parameters

### kinds

`Record`\<`string`, [`Check`](../interfaces/Check.md)\>

### opts

[`CheckRunnerOptions`](../interfaces/CheckRunnerOptions.md)

## Returns

(`kindId`, `trace`, `producedAt`) => `Promise`\<`AnalystFinding`[] \| \{ `error`: `string`; \}\>
