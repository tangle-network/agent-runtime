[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AuthoredHarness

# Interface: AuthoredHarness

Defined in: [runtime/supervise/worktree-fanout.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L30)

**`Experimental`**

One authored harness profile in a worktree fanout: the §1.5 profile + which local
 harness CLI drives it. The supervisor authors `profile` per sub-task; `harness` chooses the leaf.

## Properties

### name

> **name**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L32)

**`Experimental`**

A short label for the worktree branch + trace node.

***

### profile

> **profile**: `AgentProfile`

Defined in: [runtime/supervise/worktree-fanout.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L34)

**`Experimental`**

The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5).

***

### harness

> **harness**: `"claude"` \| `"codex"` \| `"opencode"`

Defined in: [runtime/supervise/worktree-fanout.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L36)

**`Experimental`**

Which local harness CLI drives this leaf.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L38)

**`Experimental`**

Per-harness model/runId/baseRef overrides flow through the profile + these.

***

### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L39)

**`Experimental`**
