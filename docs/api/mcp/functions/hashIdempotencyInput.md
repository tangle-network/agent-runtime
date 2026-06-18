[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / hashIdempotencyInput

# Function: hashIdempotencyInput()

> **hashIdempotencyInput**(`value`): `string`

Defined in: [mcp/task-queue.ts:799](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L799)

**`Experimental`**

Best-effort stable hash for use as `idempotencyKey`. Not cryptographic;
collisions only affect dedupe, never correctness.

## Parameters

### value

`unknown`

## Returns

`string`
