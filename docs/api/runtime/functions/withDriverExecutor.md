[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / withDriverExecutor

# Function: withDriverExecutor()

> **withDriverExecutor**(`base`): [`ExecutorRegistry`](../interfaces/ExecutorRegistry.md)

Defined in: [runtime/supervise/driver-executor.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/driver-executor.ts#L211)

Register the driver-executor so a child marked `role: 'driver'` resolves to it. The base
registry resolves by harness alone (it does not read `role`), so a recursive run needs a
registry that routes the driver tag here FIRST. Returns a registry decorator: a
driver-role spec → the driver-executor; everything else → the base registry's resolution
(leaf built-ins + BYO).

## Parameters

### base

[`ExecutorRegistry`](../interfaces/ExecutorRegistry.md)

## Returns

[`ExecutorRegistry`](../interfaces/ExecutorRegistry.md)
