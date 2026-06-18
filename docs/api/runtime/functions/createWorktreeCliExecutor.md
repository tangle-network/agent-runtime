[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createWorktreeCliExecutor

# Function: createWorktreeCliExecutor()

> **createWorktreeCliExecutor**(`options`): [`Executor`](../interfaces/Executor.md)\<`WorktreeHarnessResult`\>

Defined in: [runtime/supervise/worktree-cli-executor.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L85)

**`Experimental`**

Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a
fanout of N profiles = N parallel worktrees that never clobber each other.

Fail-loud: an empty `repoRoot`/`harness`/`taskPrompt` throws at construction. `resultArtifact()`
before `execute()` resolves throws.

## Parameters

### options

[`WorktreeCliExecutorOptions`](../interfaces/WorktreeCliExecutorOptions.md)

## Returns

[`Executor`](../interfaces/Executor.md)\<`WorktreeHarnessResult`\>
