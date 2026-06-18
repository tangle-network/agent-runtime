[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / iterationsToTraceStore

# Function: iterationsToTraceStore()

> **iterationsToTraceStore**\<`Task`, `Output`\>(`iterations`, `budgets?`): `TraceAnalysisStore`

Defined in: [analyst-loop/iterations-to-trace-store.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/iterations-to-trace-store.ts#L213)

Build an in-memory `TraceAnalysisStore` over a loop round's iterations. Fail-loud on an
empty round — there is nothing for an analyst to read, and a silent empty store would
mask a broken capture path.

## Type Parameters

### Task

`Task`

### Output

`Output`

## Parameters

### iterations

readonly [`Iteration`](../../runtime/interfaces/Iteration.md)\<`Task`, `Output`\>[]

### budgets?

`TraceAnalystByteBudgets` = `DEFAULT_TRACE_ANALYST_BUDGETS`

## Returns

`TraceAnalysisStore`
