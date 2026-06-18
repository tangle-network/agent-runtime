[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationExecutor

# Interface: DelegationExecutor

Defined in: [mcp/executor.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L25)

**`Experimental`**

## Properties

### client

> `readonly` **client**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [mcp/executor.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L27)

**`Experimental`**

Sandbox client the kernel calls. Returned with `describePlacement` set.

***

### placement?

> `readonly` `optional` **placement?**: `"sibling"` \| `"fleet"` \| `"in-process"`

Defined in: [mcp/executor.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L37)

**`Experimental`**

Where delegated work physically runs. `sibling` and `fleet` placements are
session-backed (boxes expose `driveTurn`, so detached dispatch + resume
apply); `in-process` spawns local harness CLIs with no sandbox session to
detach. Optional so consumer-implemented executors stay source-compatible;
absent means "unknown" and detached dispatch is not enabled for it.

## Methods

### describe()

> **describe**(): `string`

Defined in: [mcp/executor.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L29)

**`Experimental`**

Best-effort one-liner used in stderr boot logs and diagnostics.

#### Returns

`string`
