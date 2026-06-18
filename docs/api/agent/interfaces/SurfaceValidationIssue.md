[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / SurfaceValidationIssue

# Interface: SurfaceValidationIssue

Defined in: [agent/surfaces.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L191)

Validate that every declared surface exists on disk under `repoRoot`.

Returns an array of `SurfaceValidationIssue` — empty when all required
surfaces resolve. `defineAgent` throws with the issues rendered, so
a misconfigured manifest fails at startup (not at the first finding
the loop produces 20 minutes later).

## Properties

### surface

> **surface**: keyof [`AgentSurfaces`](AgentSurfaces.md)

Defined in: [agent/surfaces.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L192)

***

### path

> **path**: `string`

Defined in: [agent/surfaces.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L193)

***

### reason

> **reason**: `"missing"` \| `"not-directory"` \| `"not-file"`

Defined in: [agent/surfaces.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L194)
