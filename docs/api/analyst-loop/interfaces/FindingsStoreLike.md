[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / FindingsStoreLike

# Interface: FindingsStoreLike

Defined in: [analyst-loop/types.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L162)

Narrowed shape we accept for `FindingsStore`.

## Methods

### loadAll()

> **loadAll**(): readonly `AnalystFinding` & `object`[]

Defined in: [analyst-loop/types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L163)

#### Returns

readonly `AnalystFinding` & `object`[]

***

### loadRun()

> **loadRun**(`runId`): readonly `AnalystFinding` & `object`[]

Defined in: [analyst-loop/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L164)

#### Parameters

##### runId

`string`

#### Returns

readonly `AnalystFinding` & `object`[]

***

### append()

> **append**(`runId`, `findings`): `Promise`\<`void`\>

Defined in: [analyst-loop/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L165)

#### Parameters

##### runId

`string`

##### findings

readonly `AnalystFinding`[]

#### Returns

`Promise`\<`void`\>
