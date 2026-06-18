[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CoordinationToolsOptions

# Interface: CoordinationToolsOptions

Defined in: [mcp/tools/coordination.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L94)

## Properties

### scope

> `readonly` **scope**: [`Scope`](../../runtime/interfaces/Scope.md)\<`unknown`\>

Defined in: [mcp/tools/coordination.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L95)

***

### blobs

> `readonly` **blobs**: [`ResultBlobStore`](../../runtime/interfaces/ResultBlobStore.md)

Defined in: [mcp/tools/coordination.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L96)

***

### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](../type-aliases/MakeWorkerAgent.md)

Defined in: [mcp/tools/coordination.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L97)

***

### perWorker

> `readonly` **perWorker**: [`Budget`](../../runtime/interfaces/Budget.md)

Defined in: [mcp/tools/coordination.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L98)

***

### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](AnalystRegistry.md)

Defined in: [mcp/tools/coordination.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L99)

***

### onEvent?

> `readonly` `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [mcp/tools/coordination.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L100)

#### Parameters

##### event

[`CoordinationEvent`](../type-aliases/CoordinationEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### questionPolicy?

> `readonly` `optional` **questionPolicy?**: [`QuestionPolicy`](../type-aliases/QuestionPolicy.md)

Defined in: [mcp/tools/coordination.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L101)

***

### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: [mcp/tools/coordination.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L106)

Analyst kind ids to run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle
 hook). Each result is published as a `finding` event on the bus — pass-through to subscribers
 and queued for the driver to pull via `await_event`. Omit/empty = no auto-analysis (default;
 the driver can still run lenses on demand via `run_analyst`). Requires `analysts`.
