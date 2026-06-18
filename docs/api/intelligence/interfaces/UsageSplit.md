[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / UsageSplit

# Interface: UsageSplit

Defined in: [intelligence/index.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L103)

The per-class cost split carried by every trace and outcome. `off` ⇒
`intelligenceUsd: 0` by construction — there is no intelligence spawn to
bill. This is a classification on the trace, NOT a budget-pool split.

## Properties

### inferenceUsd

> **inferenceUsd**: `number`

Defined in: [intelligence/index.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L105)

Base-stream (model) spend in USD.

***

### intelligenceUsd

> **intelligenceUsd**: `number`

Defined in: [intelligence/index.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L107)

Intelligence-spawn spend in USD. Provably `0` at the OFF tier.
