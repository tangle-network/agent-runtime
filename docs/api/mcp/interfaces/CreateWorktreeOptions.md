[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CreateWorktreeOptions

# Interface: CreateWorktreeOptions

Defined in: [mcp/worktree.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L31)

**`Experimental`**

## Properties

### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/worktree.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L33)

**`Experimental`**

Absolute path to the main git checkout.

***

### runId

> **runId**: `string`

Defined in: [mcp/worktree.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L35)

**`Experimental`**

Unique id for the worktree path + branch. Use the delegation run id.

***

### variantsDir?

> `optional` **variantsDir?**: `string`

Defined in: [mcp/worktree.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L37)

**`Experimental`**

Parent directory the worktree lives under. Defaults to `.agent-worktrees`.

***

### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [mcp/worktree.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L39)

**`Experimental`**

Override the base ref (default `HEAD`).

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../type-aliases/GitRunner.md)

Defined in: [mcp/worktree.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L41)

**`Experimental`**

Test seam — inject a custom git runner.
