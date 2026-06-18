[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / serveCoordinationMcp

# Function: serveCoordinationMcp()

> **serveCoordinationMcp**(`opts`): `Promise`\<[`CoordinationMcpHandle`](../interfaces/CoordinationMcpHandle.md)\>

Defined in: [runtime/supervise/coordination-mcp.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L51)

Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs
 opencode locally, same host); pass `host` to bind elsewhere when the harness is remote.

## Parameters

### opts

#### scope

[`Scope`](../interfaces/Scope.md)\<`unknown`\>

#### blobs

[`ResultBlobStore`](../interfaces/ResultBlobStore.md)

#### makeWorkerAgent

[`MakeWorkerAgent`](../../mcp/type-aliases/MakeWorkerAgent.md)

#### perWorker

[`Budget`](../interfaces/Budget.md)

#### port?

`number`

#### host?

`string`

#### analysts?

[`AnalystRegistry`](../../mcp/interfaces/AnalystRegistry.md)

Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle.

#### analyzeOnSettle?

readonly `string`[]

Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus.

#### onEvent?

(`event`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every bus event (settled / question / finding).

#### questionPolicy?

[`QuestionPolicy`](../../mcp/type-aliases/QuestionPolicy.md)

## Returns

`Promise`\<[`CoordinationMcpHandle`](../interfaces/CoordinationMcpHandle.md)\>
