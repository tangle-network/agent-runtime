[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ScopeWidenGate

# Interface: ScopeWidenGate\<D\>

Defined in: [runtime/personify/wave-types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L310)

The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read
trace FINDINGS instead of a raw verdict). `decide` is consulted per settled child; it MUST
derive `promising` from `findings`, never from `settled.verdict`, unless `judgeExempt` is
explicitly argued (the documented off-by-default escape hatch). Flat default never widens.

## Type Parameters

### D

`D`

## Properties

### judgeExempt?

> `readonly` `optional` **judgeExempt?**: `boolean`

Defined in: [runtime/personify/wave-types.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L318)

When true, `decide` may read `settled.verdict` directly — collides with the steer firewall,
 so it must be argued per cell, never defaulted on (mirrors the keystone `WidenGate`).

## Methods

### decide()

> **decide**(`settled`, `findings`, `budget`): [`WidenDecision`](../type-aliases/WidenDecision.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L311)

#### Parameters

##### settled

[`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

##### findings

readonly `AnalystFinding`[]

##### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

#### Returns

[`WidenDecision`](../type-aliases/WidenDecision.md)\<`D`\>
