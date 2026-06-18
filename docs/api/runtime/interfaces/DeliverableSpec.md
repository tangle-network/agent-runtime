[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / DeliverableSpec

# Interface: DeliverableSpec\<Out\>

Defined in: [runtime/supervise/completion-gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L31)

The deployable completion oracle passed to [gateOnDeliverable](../functions/gateOnDeliverable.md): a `check` that
decides DELIVERED (settles `valid` ⟺ it resolves true) plus an optional `describe` of
what the spawn was supposed to produce. The check reads the child's output — never the
model judging itself.

## Type Parameters

### Out

`Out` = `unknown`

## Properties

### check

> **check**: (`out`) => `boolean` \| `Promise`\<`boolean`\>

Defined in: [runtime/supervise/completion-gate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L33)

The deployable check that decides DELIVERED. `settled.valid ⟺ this resolves true`.

#### Parameters

##### out

`Out`

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### describe?

> `optional` **describe?**: `string`

Defined in: [runtime/supervise/completion-gate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L35)

What the spawn was supposed to produce — surfaced in traces/reports.
