[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / VerifyResult

# Interface: VerifyResult

Defined in: [improvement/agentic-generator.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L41)

Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 failing test output) is fed into the next shot when `ok` is false.

## Properties

### ok

> **ok**: `boolean`

Defined in: [improvement/agentic-generator.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L42)

***

### feedback?

> `optional` **feedback?**: `string`

Defined in: [improvement/agentic-generator.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L43)
