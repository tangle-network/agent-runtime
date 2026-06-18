[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CliWorktreeSeam

# Interface: CliWorktreeSeam

Defined in: [runtime/supervise/runtime.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L107)

cli-worktree seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI
(claude / codex / opencode) on its own git worktree — the leaf `createWorktreeCliExecutor`
named as data. `harness` + `repoRoot` + `taskPrompt` are required; the authored
`profile.prompt.systemPrompt` + `profile.model.default` reach the harness via the §1.5
`harnessInvocation` mapper. Everything else mirrors `WorktreeCliExecutorOptions`.

## Properties

### repoRoot

> **repoRoot**: `string`

Defined in: [runtime/supervise/runtime.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L108)

***

### harness

> **harness**: [`LocalHarness`](../../mcp/type-aliases/LocalHarness.md)

Defined in: [runtime/supervise/runtime.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L109)

***

### taskPrompt

> **taskPrompt**: `string`

Defined in: [runtime/supervise/runtime.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L110)

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/supervise/runtime.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L111)

***

### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [runtime/supervise/runtime.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L112)

***

### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [runtime/supervise/runtime.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L113)
