[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / RemoveWorktreeOptions

# Interface: RemoveWorktreeOptions

Defined in: [mcp/worktree.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L65)

**`Experimental`**

## Properties

### worktree

> **worktree**: [`WorktreeHandle`](WorktreeHandle.md)

Defined in: [mcp/worktree.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L66)

**`Experimental`**

***

### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/worktree.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L67)

**`Experimental`**

***

### force?

> `optional` **force?**: `boolean`

Defined in: [mcp/worktree.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L69)

**`Experimental`**

Force removal even if dirty (default true; the loser of a fanout has uncommitted changes).

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../type-aliases/GitRunner.md)

Defined in: [mcp/worktree.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L71)

**`Experimental`**

Test seam.
