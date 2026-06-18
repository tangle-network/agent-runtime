[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / stopSentinel

# Function: stopSentinel()

> **stopSentinel**(`seed`): `string`

Defined in: [runtime/completion.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L73)

A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the
seed (no Math.random — reproducible + attributable to the node); the agent is instructed to
emit it VERBATIM when it judges itself done. Unguessable enough that content never trips it.

## Parameters

### seed

`string`

## Returns

`string`
