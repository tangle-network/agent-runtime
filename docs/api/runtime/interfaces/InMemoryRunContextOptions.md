[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / InMemoryRunContextOptions

# Interface: InMemoryRunContextOptions

Defined in: [runtime/supervise/run-context.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L32)

Options for the in-memory run context.

## Properties

### withDriver?

> `readonly` `optional` **withDriver?**: `boolean`

Defined in: [runtime/supervise/run-context.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L39)

Wrap the executor registry with `withDriverExecutor` so a spawned child marked
`role: 'driver'` resolves to the recursive driver-executor (agents driving agents
over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
leaf workers. Default `false`.
