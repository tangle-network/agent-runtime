[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / AnalystRegistryLike

# Interface: AnalystRegistryLike

Defined in: [analyst-loop/types.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L149)

Narrowed shape we accept for `AnalystRegistry` so the orchestrator
remains testable without instantiating the real class. The real
class satisfies this trivially.

## Extended by

- [`AnalystRegistryStreamingLike`](AnalystRegistryStreamingLike.md)

## Methods

### list()

> **list**(): readonly `object`[]

Defined in: [analyst-loop/types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L150)

#### Returns

readonly `object`[]

***

### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

Defined in: [analyst-loop/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L151)

#### Parameters

##### runId

`string`

##### inputs

`AnalystRunInputs`

##### opts?

###### priorFindings?

readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

#### Returns

`Promise`\<`AnalystRunResult`\>
