[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CoordinationTools

# Interface: CoordinationTools

Defined in: [mcp/tools/coordination.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L116)

The supervisor-side toolbox returned by [createCoordinationTools](../functions/createCoordinationTools.md): the MCP tool
descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
`raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
choice, steerable counterpart to the one-shot own-sandbox delegation MCP.

## Properties

### tools

> `readonly` **tools**: [`McpToolDescriptor`](McpToolDescriptor.md)[]

Defined in: [mcp/tools/coordination.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L117)

## Methods

### isStopped()

> **isStopped**(): `boolean`

Defined in: [mcp/tools/coordination.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L118)

#### Returns

`boolean`

***

### stopReason()

> **stopReason**(): `string` \| `undefined`

Defined in: [mcp/tools/coordination.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L119)

#### Returns

`string` \| `undefined`

***

### settled()

> **settled**(): readonly [`SettledWorker`](SettledWorker.md)[]

Defined in: [mcp/tools/coordination.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L120)

#### Returns

readonly [`SettledWorker`](SettledWorker.md)[]

***

### questions()

> **questions**(): readonly [`QuestionRecord`](QuestionRecord.md)[]

Defined in: [mcp/tools/coordination.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L121)

#### Returns

readonly [`QuestionRecord`](QuestionRecord.md)[]

***

### history()

> **history**(): readonly [`BusRecord`](../../runtime/interfaces/BusRecord.md)\<[`CoordinationEvent`](../type-aliases/CoordinationEvent.md)\>[]

Defined in: [mcp/tools/coordination.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L125)

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

#### Returns

readonly [`BusRecord`](../../runtime/interfaces/BusRecord.md)\<[`CoordinationEvent`](../type-aliases/CoordinationEvent.md)\>[]

***

### stats()

> **stats**(): [`BusStats`](../../runtime/interfaces/BusStats.md)

Defined in: [mcp/tools/coordination.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L127)

Bus throughput counters (published / pulled / by-kind) for live dashboards.

#### Returns

[`BusStats`](../../runtime/interfaces/BusStats.md)

***

### raiseFinding()

> **raiseFinding**(`finding`): `Promise`\<`void`\>

Defined in: [mcp/tools/coordination.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L131)

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

#### Parameters

##### finding

`AnalystFindingEvent`

#### Returns

`Promise`\<`void`\>
