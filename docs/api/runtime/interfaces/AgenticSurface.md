[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AgenticSurface

# Interface: AgenticSurface

Defined in: [runtime/strategy.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L76)

A stateful, checkable environment an agent operates over with tools. Open behind one interface.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [runtime/strategy.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L77)

## Methods

### open()

> **open**(`task`): `Promise`\<[`ArtifactHandle`](ArtifactHandle.md)\>

Defined in: [runtime/strategy.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L78)

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

#### Returns

`Promise`\<[`ArtifactHandle`](ArtifactHandle.md)\>

***

### tools()

> **tools**(`task`, `handle`): `Promise`\<[`AgenticTool`](AgenticTool.md)[]\>

Defined in: [runtime/strategy.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L79)

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

#### Returns

`Promise`\<[`AgenticTool`](AgenticTool.md)[]\>

***

### call()

> **call**(`handle`, `name`, `args`): `Promise`\<`string`\>

Defined in: [runtime/strategy.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L80)

#### Parameters

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

##### name

`string`

##### args

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`string`\>

***

### score()

> **score**(`task`, `handle`): `Promise`\<[`SurfaceScore`](SurfaceScore.md)\>

Defined in: [runtime/strategy.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L81)

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

#### Returns

`Promise`\<[`SurfaceScore`](SurfaceScore.md)\>

***

### close()

> **close**(`handle`): `Promise`\<`void`\>

Defined in: [runtime/strategy.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L82)

#### Parameters

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

#### Returns

`Promise`\<`void`\>
