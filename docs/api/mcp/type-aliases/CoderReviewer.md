[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CoderReviewer

# Type Alias: CoderReviewer

> **CoderReviewer** = (`output`, `task`, `ctx`) => `Promise`\<[`CoderReview`](../interfaces/CoderReview.md)\> \| [`CoderReview`](../interfaces/CoderReview.md)

Defined in: [mcp/delegates.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L130)

**`Experimental`**

Optional adversarial reviewer over a coder candidate that already passed
mechanical validation (tests/typecheck/forbidden/diff/no-op/secrets). Folded
from the ai-trading-blueprint delegation MCP: a candidate is only eligible to
win if the reviewer approves it. The reviewer is the consumer's seam — an LLM
judge, a `pnpm review` command, anything returning a `CoderReview`.

## Parameters

### output

`CoderOutput`

### task

[`CoderTask`](../../profiles/interfaces/CoderTask.md)

### ctx

#### signal

`AbortSignal`

## Returns

`Promise`\<[`CoderReview`](../interfaces/CoderReview.md)\> \| [`CoderReview`](../interfaces/CoderReview.md)
