[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / adaptiveRefine

# Variable: adaptiveRefine

> `const` **adaptiveRefine**: [`Strategy`](../interfaces/Strategy.md)

Defined in: [runtime/strategy.ts:866](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L866)

A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 optimizations" path: a new technique, compact, with zero Supervisor ceremony.
