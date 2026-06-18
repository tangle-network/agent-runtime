[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / sampleThenRefine

# Variable: sampleThenRefine

> `const` **sampleThenRefine**: [`Strategy`](../interfaces/Strategy.md)

Defined in: [runtime/strategy.ts:909](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L909)

The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 then refine the best-verifying line with the remaining budget. Sample's basin escape +
 refine's accumulation — the third built-in, authored from the public steps.
