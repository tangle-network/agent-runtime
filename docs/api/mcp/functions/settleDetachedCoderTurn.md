[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / settleDetachedCoderTurn

# Function: settleDetachedCoderTurn()

> **settleDetachedCoderTurn**(`turn`, `options`): `Promise`\<`CoderOutput`\>

Defined in: [mcp/delegates.ts:468](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L468)

**`Experimental`**

Settle a completed detached coder turn through the same gate the streaming
path applies: parse the terminal payload with the coder output adapter,
run the mechanical validator (tests/typecheck/forbidden/diff/no-op/secrets),
then the optional reviewer. Throws when nothing survives — a resumed or
detached run must not return an unvalidated patch.

SCOPE NOTE (detached/resume): the detached `driveTurn`-tick + cross-restart resume path is
bound to the `runLoop` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
`createDriveTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.

## Parameters

### turn

[`DetachedTurn`](../interfaces/DetachedTurn.md)

### options

[`SettleDetachedCoderTurnOptions`](../interfaces/SettleDetachedCoderTurnOptions.md)

## Returns

`Promise`\<`CoderOutput`\>
