[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Workspace

# Interface: Workspace

Defined in: [runtime/workspace.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L11)

## Properties

### ref

> `readonly` **ref**: `string`

Defined in: [runtime/workspace.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L12)

## Methods

### materialize()

> **materialize**(`dir`): `Promise`\<`void`\>

Defined in: [runtime/workspace.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L13)

#### Parameters

##### dir

`string`

#### Returns

`Promise`\<`void`\>

***

### commit()

> **commit**(`dir`, `message`): `Promise`\<[`WorkspaceCommit`](../type-aliases/WorkspaceCommit.md)\>

Defined in: [runtime/workspace.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L14)

#### Parameters

##### dir

`string`

##### message

`string`

#### Returns

`Promise`\<[`WorkspaceCommit`](../type-aliases/WorkspaceCommit.md)\>

***

### head()

> **head**(): `Promise`\<`string`\>

Defined in: [runtime/workspace.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L15)

#### Returns

`Promise`\<`string`\>
