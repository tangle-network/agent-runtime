[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / deterministicCompletion

# Function: deterministicCompletion()

> **deterministicCompletion**\<`Task`, `Output`\>(`check`): [`CompletionAnalyst`](../interfaces/CompletionAnalyst.md)\<`Task`, `Output`\>

Defined in: [runtime/completion.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L111)

Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check
passes. Ground truth — the driver ends directly, no validation. The check reads the output
(a verifier), never the judge verdict — selector ≠ judge stays intact.

## Type Parameters

### Task

`Task`

### Output

`Output`

## Parameters

### check

(`output`, `history`) => `object`

## Returns

[`CompletionAnalyst`](../interfaces/CompletionAnalyst.md)\<`Task`, `Output`\>
