[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WorkspaceRun

# Interface: WorkspaceRun\<T\>

Defined in: [runtime/workspace.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L135)

## Type Parameters

### T

`T`

## Properties

### valid

> `readonly` **valid**: `boolean`

Defined in: [runtime/workspace.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L136)

***

### value

> `readonly` **value**: `T`

Defined in: [runtime/workspace.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L137)

***

### commit?

> `readonly` `optional` **commit?**: [`WorkspaceCommit`](../type-aliases/WorkspaceCommit.md)

Defined in: [runtime/workspace.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L139)

Present when a commit was attempted (valid, or `commitOnInvalid`).
