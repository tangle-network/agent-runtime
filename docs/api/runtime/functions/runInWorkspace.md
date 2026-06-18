[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / runInWorkspace

# Function: runInWorkspace()

> **runInWorkspace**\<`T`\>(`ws`, `body`, `opts?`): `Promise`\<[`WorkspaceRun`](../interfaces/WorkspaceRun.md)\<`T`\>\>

Defined in: [runtime/workspace.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L149)

Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back
so the next worker (or the supervisor) builds on it. This is the seam that turns isolated
per-worker cwds into one compounding artifact — `body` gets a real materialized dir, its
delivery is committed to the shared ref iff it's valid (a conflict is returned, never thrown).
The clone is removed after; durable state lives only in the ref.

## Type Parameters

### T

`T`

## Parameters

### ws

[`Workspace`](../interfaces/Workspace.md)

### body

(`cwd`) => `Promise`\<\{ `valid`: `boolean`; `value`: `T`; `message?`: `string`; \}\>

### opts?

#### tmpPrefix?

`string`

#### commitOnInvalid?

`boolean`

## Returns

`Promise`\<[`WorkspaceRun`](../interfaces/WorkspaceRun.md)\<`T`\>\>
