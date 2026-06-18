[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WidenGate

# Interface: WidenGate\<Out\>

Defined in: [runtime/supervise/types.ts:507](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L507)

The progressive-widening gate (MCTS-PW). Decides whether a settled child is
`promising` enough to spawn another under the remaining pool. DEFAULTS TO FLAT
(`shouldWiden` always false) so a gate run never widens and the selector≠judge
firewall conflict (R2) stays dormant. When widening IS enabled, `promising` MUST be
derived from TRACE findings (`analyses`), never raw `verdict` — or the gate carries
an explicit, argued `judgeExempt: true` (the documented escape hatch, off by default).

## Type Parameters

### Out

`Out`

## Properties

### judgeExempt?

> `readonly` `optional` **judgeExempt?**: `boolean`

Defined in: [runtime/supervise/types.ts:512](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L512)

When true, widening may read `verdict` directly (collides with the steer firewall —
 must be explicitly argued per cell, never defaulted on).

## Methods

### shouldWiden()

> **shouldWiden**(`settled`, `budget`): `boolean`

Defined in: [runtime/supervise/types.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L509)

Default impl returns false for every settlement (flat — never widens).

#### Parameters

##### settled

[`Settled`](../type-aliases/Settled.md)\<`Out`\>

##### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

#### Returns

`boolean`
