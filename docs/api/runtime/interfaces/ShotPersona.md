[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ShotPersona

# Interface: ShotPersona

Defined in: [runtime/strategy.ts:682](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L682)

A role for one shot — multi-agent loops (researcher + engineer, a panel of k
 researchers) give each shot its own system prompt and optionally its own model.

## Properties

### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [runtime/strategy.ts:685](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L685)

Replaces the task's systemPrompt for a FRESH shot; on a carried conversation it is
 injected as a hand-off message (the transcript's earlier roles stay intact).

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/strategy.ts:687](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L687)

Per-shot model override (e.g. a stronger model for the engineer shot).
