[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / builtinShapes

# Variable: builtinShapes

> `const` **builtinShapes**: [`ShapeRegistry`](../interfaces/ShapeRegistry.md)

Defined in: [runtime/personify/registry.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L49)

The default registry `runPersonified` resolves a shape name against. Empty by construction —
 a caller registers its own composed shapes; the engine ships no domain shape.
