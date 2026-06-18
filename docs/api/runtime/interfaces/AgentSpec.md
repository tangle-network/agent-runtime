[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AgentSpec

# Interface: AgentSpec

Defined in: [runtime/supervise/types.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L152)

`AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the
sandbox SDK's `BackendConfig`, not the portable profile. So an agent is mapped to its
executor through this MINIMAL wrapper, never by fabricating a field onto `AgentProfile`.

Resolution (in `runtime.ts`):
 - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 - `harness === null`        → router/inline: a direct Router call, no box.
 - `harness` is a `BackendType` → sandbox: compose `runLoop` against `profile` on that backend.
Fail loud on an unresolvable spec (no executor and an unknown harness).

## Properties

### profile

> `readonly` **profile**: `AgentProfile`

Defined in: [runtime/supervise/types.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L153)

***

### harness

> `readonly` **harness**: `BackendType` \| `null`

Defined in: [runtime/supervise/types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L155)

`null` selects router/inline; a `BackendType` selects the sandboxed harness.

***

### executor?

> `readonly` `optional` **executor?**: [`Executor`](Executor.md)\<`unknown`\>

Defined in: [runtime/supervise/types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L157)

Bring-your-own executor: when set, overrides harness-based resolution entirely.
