[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ExecutorConfig

# Type Alias: ExecutorConfig

> **ExecutorConfig** = `object` & [`RouterSeam`](../interfaces/RouterSeam.md) \| `object` & [`RouterToolsSeam`](../interfaces/RouterToolsSeam.md) \| `object` & [`BridgeSeam`](../interfaces/BridgeSeam.md) \| `object` & [`CliSeam`](../interfaces/CliSeam.md) \| `object` & [`CliWorktreeSeam`](../interfaces/CliWorktreeSeam.md) \| `object` & [`SandboxSeam`](../interfaces/SandboxSeam.md)

Defined in: [runtime/supervise/runtime.ts:1121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1121)

Config for [createExecutor](../functions/createExecutor.md): the backend is DATA — the cost dial a profile,
an experiment config, or a replay journal can name — not an import choice. Each
variant carries its backend's seam (router/router-tools/bridge/cli/cli-worktree/sandbox).
