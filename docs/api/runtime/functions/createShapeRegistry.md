[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createShapeRegistry

# Function: createShapeRegistry()

> **createShapeRegistry**(): [`ShapeRegistry`](../interfaces/ShapeRegistry.md)

Defined in: [runtime/personify/registry.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L25)

Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.

## Returns

[`ShapeRegistry`](../interfaces/ShapeRegistry.md)
