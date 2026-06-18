[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / AnalystRegistryStreamingLike

# Interface: AnalystRegistryStreamingLike

Defined in: [analyst-loop/types.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L179)

Narrow the `AnalystRegistryLike` further when we need streaming: the
loop checks if the registry exposes `runStream` and uses it when
present, falling back to `run()` otherwise. This keeps the type
surface backwards-compatible — older registry shims that only
implement `run` still work; they just don't forward per-analyst
events.

## Extends

- [`AnalystRegistryLike`](AnalystRegistryLike.md)

## Methods

### list()

> **list**(): readonly `object`[]

Defined in: [analyst-loop/types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L150)

#### Returns

readonly `object`[]

#### Inherited from

[`AnalystRegistryLike`](AnalystRegistryLike.md).[`list`](AnalystRegistryLike.md#list)

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

#### Inherited from

[`AnalystRegistryLike`](AnalystRegistryLike.md).[`run`](AnalystRegistryLike.md#run)

***

### runStream()?

> `optional` **runStream**(`runId`, `inputs`, `opts?`): `AsyncIterable`\<`AnalystRunEvent`\>

Defined in: [analyst-loop/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L180)

#### Parameters

##### runId

`string`

##### inputs

`AnalystRunInputs`

##### opts?

###### priorFindings?

readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

#### Returns

`AsyncIterable`\<`AnalystRunEvent`\>
