[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / Verifier

# Type Alias: Verifier

> **Verifier** = (`worktreePath`) => `Promise`\<[`VerifyResult`](../interfaces/VerifyResult.md)\> \| [`VerifyResult`](../interfaces/VerifyResult.md)

Defined in: [improvement/agentic-generator.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L49)

Verifies the edited worktree. Sync or async; throws only on a setup fault
 (a candidate that fails verification returns `{ok:false}`, it does not
 throw).

## Parameters

### worktreePath

`string`

## Returns

`Promise`\<[`VerifyResult`](../interfaces/VerifyResult.md)\> \| [`VerifyResult`](../interfaces/VerifyResult.md)
