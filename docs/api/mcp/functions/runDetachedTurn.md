[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / runDetachedTurn

# Function: runDetachedTurn()

> **runDetachedTurn**(`options`): `Promise`\<[`DetachedTurn`](../interfaces/DetachedTurn.md)\>

Defined in: [mcp/detached-turn.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L211)

**`Experimental`**

Dispatch one detached turn and advance it to a terminal state with
`driveTurn` ticks. The first tick dispatches (idempotent on `sessionId`);
subsequent ticks poll. On abort the remote session is cancelled via
`_sessionCancel` when the box exposes it. The box is torn down on every
in-process exit path (success, failure, abort) — only a process death skips
teardown, which is exactly the case the resume driver re-attaches to.

## Parameters

### options

[`RunDetachedTurnOptions`](../interfaces/RunDetachedTurnOptions.md)

## Returns

`Promise`\<[`DetachedTurn`](../interfaces/DetachedTurn.md)\>
