[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / StrategyCtx

# Interface: StrategyCtx

Defined in: [runtime/strategy.ts:717](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L717)

What a strategy body composes with: the artifact lifecycle, the budget, and the two steps.

## Properties

### surface

> `readonly` **surface**: `StrategyArtifacts`

Defined in: [runtime/strategy.ts:719](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L719)

Open/close artifacts the body manages itself (e.g. one persistent handle for depth).

***

### task

> `readonly` **task**: [`AgenticTask`](AgenticTask.md)

Defined in: [runtime/strategy.ts:720](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L720)

***

### opts

> `readonly` **opts**: [`AgenticOptions`](AgenticOptions.md)

Defined in: [runtime/strategy.ts:721](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L721)

***

### budget

> `readonly` **budget**: `number`

Defined in: [runtime/strategy.ts:722](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L722)

***

### scope

> `readonly` **scope**: [`Scope`](Scope.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:723](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L723)

## Methods

### shot()

> **shot**(`spec?`): `Promise`\<`ShotResult` \| `null`\>

Defined in: [runtime/strategy.ts:725](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L725)

Run ONE worker shot; its harness-scored result, or null if it went down.

#### Parameters

##### spec?

[`ShotSpec`](ShotSpec.md)

#### Returns

`Promise`\<`ShotResult` \| `null`\>

***

### critique()

> **critique**(`messages`): `Promise`\<`string` \| `null`\>

Defined in: [runtime/strategy.ts:727](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L727)

The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down.

#### Parameters

##### messages

`Msg`[]

#### Returns

`Promise`\<`string` \| `null`\>

***

### consult()

> **consult**(`messages`, `instruction`): `Promise`\<`string` \| `null`\>

Defined in: [runtime/strategy.ts:732](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L732)

The RAW analyst channel: the firewalled critic answers `instruction` over the
 trajectory verbatim — no findings extraction, so verdict-shaped formats
 (CONTINUE/STOP decisions, calibrated predictions) survive. Same firewall:
 trajectory in, never scores. Null when the analyst went down.

#### Parameters

##### messages

`Msg`[]

##### instruction

`string`

#### Returns

`Promise`\<`string` \| `null`\>

***

### listTools()

> **listTools**(`handle`): `Promise`\<`object`[]\>

Defined in: [runtime/strategy.ts:736](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L736)

The tools THIS artifact's task actually offers (names + descriptions only — never
 the implementations). Tool sets vary per task on heterogeneous domains; a strategy
 that restricts shots MUST select from this list, never from hardcoded names.

#### Parameters

##### handle

[`ArtifactHandle`](ArtifactHandle.md)

#### Returns

`Promise`\<`object`[]\>
