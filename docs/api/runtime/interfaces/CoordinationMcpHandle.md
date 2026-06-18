[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CoordinationMcpHandle

# Interface: CoordinationMcpHandle

Defined in: [runtime/supervise/coordination-mcp.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L33)

## Properties

### url

> `readonly` **url**: `string`

Defined in: [runtime/supervise/coordination-mcp.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L35)

The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`.

***

### port

> `readonly` **port**: `number`

Defined in: [runtime/supervise/coordination-mcp.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L36)

***

### history

> **history**: () => readonly [`BusRecord`](BusRecord.md)\<[`CoordinationEvent`](../../mcp/type-aliases/CoordinationEvent.md)\>[]

Defined in: [runtime/supervise/coordination-mcp.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L41)

The full ordered bus-event log — observability audit + replay trail.

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

#### Returns

readonly [`BusRecord`](BusRecord.md)\<[`CoordinationEvent`](../../mcp/type-aliases/CoordinationEvent.md)\>[]

***

### stats

> **stats**: () => [`BusStats`](BusStats.md)

Defined in: [runtime/supervise/coordination-mcp.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L43)

Bus throughput counters for live dashboards.

Bus throughput counters (published / pulled / by-kind) for live dashboards.

#### Returns

[`BusStats`](BusStats.md)

***

### raiseFinding

> **raiseFinding**: (`finding`) => `Promise`\<`void`\>

Defined in: [runtime/supervise/coordination-mcp.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L45)

Raise a `finding` on the bus from an online detector watching a worker's live pipe.

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

#### Parameters

##### finding

`AnalystFindingEvent`

#### Returns

`Promise`\<`void`\>

## Methods

### settled()

> **settled**(): readonly `object`[]

Defined in: [runtime/supervise/coordination-mcp.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L38)

The coordination tools' settled-worker ledger (for the driver's finalize).

#### Returns

readonly `object`[]

***

### isStopped()

> **isStopped**(): `boolean`

Defined in: [runtime/supervise/coordination-mcp.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L39)

#### Returns

`boolean`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [runtime/supervise/coordination-mcp.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L46)

#### Returns

`Promise`\<`void`\>
