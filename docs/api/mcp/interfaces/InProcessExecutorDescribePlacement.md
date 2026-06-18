[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / InProcessExecutorDescribePlacement

# Interface: InProcessExecutorDescribePlacement

Defined in: [mcp/in-process-executor.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L60)

**`Experimental`**

## Extends

- [`LoopSandboxPlacement`](../../runtime/interfaces/LoopSandboxPlacement.md)

## Properties

### worktreePath?

> `optional` **worktreePath?**: `string`

Defined in: [mcp/in-process-executor.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L62)

**`Experimental`**

Worktree path in the parent sandbox's filesystem (set so traces correlate to on-disk artifacts).

***

### harness?

> `optional` **harness?**: [`LocalHarness`](../type-aliases/LocalHarness.md)

Defined in: [mcp/in-process-executor.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L64)

**`Experimental`**

Which harness handled this delegation.

***

### kind

> **kind**: `"sibling"` \| `"fleet"`

Defined in: [runtime/types.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L314)

**`Experimental`**

#### Inherited from

[`LoopSandboxPlacement`](../../runtime/interfaces/LoopSandboxPlacement.md).[`kind`](../../runtime/interfaces/LoopSandboxPlacement.md#kind)

***

### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L315)

**`Experimental`**

#### Inherited from

[`LoopSandboxPlacement`](../../runtime/interfaces/LoopSandboxPlacement.md).[`sandboxId`](../../runtime/interfaces/LoopSandboxPlacement.md#sandboxid)

***

### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [runtime/types.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L316)

**`Experimental`**

#### Inherited from

[`LoopSandboxPlacement`](../../runtime/interfaces/LoopSandboxPlacement.md).[`fleetId`](../../runtime/interfaces/LoopSandboxPlacement.md#fleetid)

***

### machineId?

> `optional` **machineId?**: `string`

Defined in: [runtime/types.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L317)

**`Experimental`**

#### Inherited from

[`LoopSandboxPlacement`](../../runtime/interfaces/LoopSandboxPlacement.md).[`machineId`](../../runtime/interfaces/LoopSandboxPlacement.md#machineid)
