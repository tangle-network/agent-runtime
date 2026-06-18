[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ExecutorFactory

# Type Alias: ExecutorFactory\<Out\>

> **ExecutorFactory**\<`Out`\> = (`spec`, `ctx`) => [`Executor`](../interfaces/Executor.md)\<`Out`\>

Defined in: [runtime/supervise/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L165)

Builds a fresh `Executor` for one spawn from the resolved spec. Per-spawn (not
shared) so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a
user supply construction args without pre-instantiating.

## Type Parameters

### Out

`Out`

## Parameters

### spec

[`AgentSpec`](../interfaces/AgentSpec.md)

### ctx

[`ExecutorContext`](../interfaces/ExecutorContext.md)

## Returns

[`Executor`](../interfaces/Executor.md)\<`Out`\>
