[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Spend

# Interface: Spend

Defined in: [runtime/supervise/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L208)

Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd
 are separate channels (never folded).

## Properties

### iterations

> **iterations**: `number`

Defined in: [runtime/supervise/types.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L209)

***

### tokens

> **tokens**: [`LoopTokenUsage`](LoopTokenUsage.md)

Defined in: [runtime/supervise/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L210)

***

### usd

> **usd**: `number`

Defined in: [runtime/supervise/types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L211)

***

### ms

> **ms**: `number`

Defined in: [runtime/supervise/types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L212)
