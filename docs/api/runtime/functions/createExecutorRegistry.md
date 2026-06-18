[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createExecutorRegistry

# Function: createExecutorRegistry()

> **createExecutorRegistry**(): [`ExecutorRegistry`](../interfaces/ExecutorRegistry.md)

Defined in: [runtime/supervise/runtime.ts:1175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1175)

The open resolver/registry. Pre-registers the three built-ins under their
runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
factory)` for any additional runtime — and a BYO `AgentSpec.executor` resolves
without touching the registry at all. NOT a closed switch; registration + BYO
ARE the extension points.

`resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executor` →
`harness === null` → the `'router'` factory; else a registered factory for the
harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.

## Returns

[`ExecutorRegistry`](../interfaces/ExecutorRegistry.md)
