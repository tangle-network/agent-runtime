[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DiffOptions

# Interface: DiffOptions

Defined in: [mcp/worktree.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L45)

**`Experimental`**

## Properties

### worktree

> **worktree**: [`WorktreeHandle`](WorktreeHandle.md)

Defined in: [mcp/worktree.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L47)

**`Experimental`**

Worktree to diff.

***

### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [mcp/worktree.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L49)

**`Experimental`**

What to compare against. Default `worktree.baseSha`.

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../type-aliases/GitRunner.md)

Defined in: [mcp/worktree.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L51)

**`Experimental`**

Test seam.
