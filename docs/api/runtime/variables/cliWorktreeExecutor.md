[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / cliWorktreeExecutor

# Variable: cliWorktreeExecutor

> `const` **cliWorktreeExecutor**: [`ExecutorFactory`](../type-aliases/ExecutorFactory.md)\<`unknown`\>

Defined in: [runtime/supervise/runtime.ts:1096](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1096)

The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
`AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.
