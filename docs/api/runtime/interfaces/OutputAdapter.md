[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / OutputAdapter

# Interface: OutputAdapter\<Output\>

Defined in: [runtime/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L105)

**`Experimental`**

Stream of `SandboxEvent`s → typed `Output`.

Adapters are pure functions over the already-collected event array; they
do not receive the live AsyncIterable so they can be replayed against
persisted streams during tests / replays.

## Type Parameters

### Output

`Output`

## Methods

### parse()

> **parse**(`events`): `Output`

Defined in: [runtime/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L106)

**`Experimental`**

#### Parameters

##### events

`SandboxEvent`[]

#### Returns

`Output`
