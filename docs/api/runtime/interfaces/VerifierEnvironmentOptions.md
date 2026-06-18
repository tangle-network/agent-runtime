[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / VerifierEnvironmentOptions

# Interface: VerifierEnvironmentOptions

Defined in: [runtime/verifier-environment.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L34)

## Properties

### name

> **name**: `string`

Defined in: [runtime/verifier-environment.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L35)

***

### extraTools?

> `optional` **extraTools?**: [`AgenticTool`](AgenticTool.md)[]

Defined in: [runtime/verifier-environment.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L39)

Extra domain tools (read-only helpers: calculator, retrieval, style lookup).

## Methods

### check()

> **check**(`task`, `answer`): [`SurfaceScore`](SurfaceScore.md) \| `Promise`\<[`SurfaceScore`](SurfaceScore.md)\>

Defined in: [runtime/verifier-environment.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L37)

The deployable check over a submitted answer. Graded via passes/total.

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

##### answer

`string`

#### Returns

[`SurfaceScore`](SurfaceScore.md) \| `Promise`\<[`SurfaceScore`](SurfaceScore.md)\>

***

### callExtra()?

> `optional` **callExtra**(`task`, `name`, `args`): `string` \| `Promise`\<`string`\>

Defined in: [runtime/verifier-environment.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L41)

Executes the extra tools. Required when `extraTools` is set.

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

##### name

`string`

##### args

`Record`\<`string`, `unknown`\>

#### Returns

`string` \| `Promise`\<`string`\>
