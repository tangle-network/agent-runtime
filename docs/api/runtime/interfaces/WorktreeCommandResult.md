[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WorktreeCommandResult

# Interface: WorktreeCommandResult

Defined in: [mcp/worktree-harness.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L39)

Outcome of one verification command run in the worktree (test or typecheck).

## Properties

### command

> **command**: `string`

Defined in: [mcp/worktree-harness.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L41)

The shell command line that was run.

***

### passed

> **passed**: `boolean`

Defined in: [mcp/worktree-harness.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L43)

Did the command exit 0? The PASS signal a deliverable gate / coder output reads.

***

### exitCode

> **exitCode**: `number` \| `null`

Defined in: [mcp/worktree-harness.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L45)

OS exit code, or `null` when killed before exit.

***

### output

> **output**: `string`

Defined in: [mcp/worktree-harness.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L47)

Combined stdout+stderr (capped) — surfaced in traces for diagnosis.
