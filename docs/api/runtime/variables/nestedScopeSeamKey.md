[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / nestedScopeSeamKey

# Variable: nestedScopeSeamKey

> `const` **nestedScopeSeamKey**: `"nested-scope"` = `'nested-scope'`

Defined in: [runtime/supervise/scope.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L140)

The recursion seam key. A `Scope` seeds a value of this on each child's
`ExecutorContext.seams` so a child whose executor is a DRIVER can mount a NESTED `Scope`
over the SAME conserved pool at `depth+1`. A leaf executor never reads it. Single-sourced
here so the scope and the driver-executor agree on the seam without a circular import.
