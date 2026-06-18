[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / AppliedIntelligence

# Interface: AppliedIntelligence

Defined in: [intelligence/delivery.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L181)

What the delivery wrapper hands the agent each run.

## Properties

### certified

> **certified**: [`CertifiedProfile`](CertifiedProfile.md) \| `null`

Defined in: [intelligence/delivery.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L184)

The certified profile in effect (null when none promoted / pull failed —
 fail-closed: the agent runs on its base surface).

## Methods

### composePrompt()

> **composePrompt**(`base`): `string`

Defined in: [intelligence/delivery.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L186)

Fold the certified prompt surface into a base system prompt.

#### Parameters

##### base

`string`

#### Returns

`string`
