[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / liftFindings

# Function: liftFindings()

> **liftFindings**(`kind`, `rows`, `producedAt`): `AnalystFinding`[]

Defined in: [mcp/tools/checks.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L143)

Lift validated raw rows into `AnalystFinding`s (agent-eval `makeFinding` stamps `finding_id`/
 `produced_at`), then enforce the trace-derived firewall (selector ≠ judge). Pure — no LLM.

## Parameters

### kind

[`Check`](../interfaces/Check.md)

### rows

`unknown`[]

### producedAt

`string`

## Returns

`AnalystFinding`[]
