[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createExecutor

# Function: createExecutor()

> **createExecutor**(`config`): [`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`unknown`\>

Defined in: [runtime/supervise/runtime.ts:1137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1137)

The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
injects the matching seam, and delegates to that backend's built-in implementation.
The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly
and never pass through here. Use this (or `createExecutorRegistry`) instead of a
per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
`UsageEvent` reporting channel.

## Parameters

### config

[`ExecutorConfig`](../type-aliases/ExecutorConfig.md)

## Returns

[`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`unknown`\>
