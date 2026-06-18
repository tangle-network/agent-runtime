[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / driverExecutorFactory

# Variable: driverExecutorFactory

> `const` **driverExecutorFactory**: [`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`unknown`\>

Defined in: [runtime/supervise/driver-executor.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/driver-executor.ts#L125)

The recursive driver-executor factory. `withDriverExecutor` routes a child marked
`role: 'driver'` here; any other child resolves to a leaf built-in. On `execute`, it
reads the `nested-scope` seam the SCOPE seeded, mounts a nested `Scope` one `depth`
deeper over the shared pool/journal/blobs/registry, runs the driver
`Agent.act(task, nestedScope)`, and reports the conserved spend summed off the nested
tree's settled events — so the parent scope's reconcile rolls the whole sub-tree's spend
into the conserved total.

A `down` from the nested driver (a thrown `act` or an aborted scope) propagates as a
thrown executor, which the parent scope types into a `down` settlement — the same
fail-loud-into-typed-down discipline a leaf gets.
