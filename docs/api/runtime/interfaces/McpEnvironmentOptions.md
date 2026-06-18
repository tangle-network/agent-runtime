[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / McpEnvironmentOptions

# Interface: McpEnvironmentOptions

Defined in: [runtime/mcp-environment.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L30)

## Properties

### name

> **name**: `string`

Defined in: [runtime/mcp-environment.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L31)

***

### maxResultChars?

> `optional` **maxResultChars?**: `number`

Defined in: [runtime/mcp-environment.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L41)

Cap on a tool result's text fed back to the worker. Default 1500 chars.

## Methods

### open()

> **open**(`task`): `Promise`\<\{ `handle`: [`ArtifactHandle`](ArtifactHandle.md); `endpoint`: [`McpEndpoint`](McpEndpoint.md); \}\>

Defined in: [runtime/mcp-environment.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L33)

Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it.

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

#### Returns

`Promise`\<\{ `handle`: [`ArtifactHandle`](ArtifactHandle.md); `endpoint`: [`McpEndpoint`](McpEndpoint.md); \}\>

***

### score()

> **score**(`task`, `handle`): `Promise`\<[`SurfaceScore`](SurfaceScore.md)\>

Defined in: [runtime/mcp-environment.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L35)

The deployable check over the artifact's current state.

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

#### Returns

`Promise`\<[`SurfaceScore`](SurfaceScore.md)\>

***

### close()?

> `optional` **close**(`handle`): `Promise`\<`void`\>

Defined in: [runtime/mcp-environment.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L37)

Teardown (delete the seeded artifact). Optional — omit for stateless servers.

#### Parameters

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

#### Returns

`Promise`\<`void`\>

***

### selectTools()?

> `optional` **selectTools**(`task`, `all`): [`AgenticTool`](AgenticTool.md)[]

Defined in: [runtime/mcp-environment.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L39)

Restrict/order the server's tools per task (e.g. the task's selected_tools). Default: all.

#### Parameters

##### task

[`AgenticTask`](AgenticTask.md)

##### all

[`AgenticTool`](AgenticTool.md)[]

#### Returns

[`AgenticTool`](AgenticTool.md)[]
