[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AgentRunSpec

# Interface: AgentRunSpec\<Task\>

Defined in: [runtime/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L67)

**`Experimental`**

Sandbox-SDK-shaped agent specification.

The kernel uses `profile` to instantiate a sandbox per iteration, formats
`task` into a prompt via `taskToPrompt`, and merges `sandboxOverrides` into
the `CreateSandboxOptions` it passes to `client.create`. Heterogeneous
fanout supplies multiple `AgentRunSpec`s and the kernel round-robins
through them when the driver plans N tasks.

## Type Parameters

### Task

`Task`

## Properties

### profile

> **profile**: `AgentProfile`

Defined in: [runtime/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L69)

**`Experimental`**

Sandbox SDK profile — what kind of agent runs the task.

***

### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

Defined in: [runtime/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L71)

**`Experimental`**

Task → prompt formatter. Pure and deterministic.

#### Parameters

##### task

`Task`

#### Returns

`string`

***

### prepareBox?

> `optional` **prepareBox?**: (`box`, `ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L80)

**`Experimental`**

Optional pre-prompt sandbox provisioner. Runs after the sandbox is acquired
and before the first prompt is streamed into that box. Use this for
domain-agnostic setup such as repo snapshots, benchmark fixtures, policy
files, or seed datasets. The hook is part of the runtime surface so loop
consumers do not hand-roll Sandbox SDK orchestration just to prepare a
workspace before the agent sees it.

#### Parameters

##### box

`SandboxInstance`

##### ctx

###### signal

`AbortSignal`

#### Returns

`void` \| `Promise`\<`void`\>

***

### name?

> `optional` **name?**: `string`

Defined in: [runtime/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L85)

**`Experimental`**

Per-spec stable name. Surfaced in trace events and the default winner
selector tiebreak. Falls back to `profile.name ?? 'agent'`.

***

### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [runtime/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L91)

**`Experimental`**

Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
the kernel's defaults. `backend.profile` is set to `profile` by the
kernel and cannot be overridden here — use `profile` itself for that.

#### Type Declaration

##### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>
