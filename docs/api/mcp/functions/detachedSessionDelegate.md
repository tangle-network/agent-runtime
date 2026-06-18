[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / detachedSessionDelegate

# Function: detachedSessionDelegate()

> **detachedSessionDelegate**(`options`): [`CoderDelegate`](../type-aliases/CoderDelegate.md)

Defined in: [mcp/delegates.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L223)

**`Experimental`**

Build the sandbox-session coder delegate. It drives `runLoop` against the project's
sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
topology.

This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
`SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
(driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.

For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate stays as the
MCP server's built-in `delegate_code` path; it runs held-stream by default and only its OPTIONAL
cross-restart resume (the `driveTurn` tick) is opt-in behind `MCP_ENABLE_DETACHED_RESUME`.

## Parameters

### options

[`DetachedSessionDelegateOptions`](../interfaces/DetachedSessionDelegateOptions.md)

## Returns

[`CoderDelegate`](../type-aliases/CoderDelegate.md)
