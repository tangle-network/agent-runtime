[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CompletionPolicy

# Interface: CompletionPolicy

Defined in: [runtime/completion.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L57)

When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 probabilistic → validate by confidence threshold (the driver's check).

## Properties

### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: [runtime/completion.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L59)

Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8.
