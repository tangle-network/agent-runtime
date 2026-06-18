[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DriveTurnTick

# Type Alias: DriveTurnTick

> **DriveTurnTick** = \{ `state`: `"completed"`; `text`: `string`; `result`: `Record`\<`string`, `unknown`\>; \} \| \{ `state`: `"running"`; `startedAt?`: `Date`; `elapsedMs?`: `number`; \} \| \{ `state`: `"failed"`; `error`: `string`; \}

Defined in: [mcp/detached-turn.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L53)

**`Experimental`**

Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6).
Discriminated on `state`; `failed` is terminal and deterministic per the
SDK contract — re-invoking with the same ids returns the same outcome.
