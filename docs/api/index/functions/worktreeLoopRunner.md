[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / worktreeLoopRunner

# Function: worktreeLoopRunner()

> **worktreeLoopRunner**(`options`): [`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<`WorktreeHarnessResult`\>

Defined in: [loop-runner.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L197)

**`Experimental`**

`code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a
`worktreeFanout` (N `createWorktreeCliExecutor` leaves, each `gateOnDeliverable`) through
`runPersonified` on the keystone Supervisor. This is the local-repo counterpart to
[coderLoopRunner](coderLoopRunner.md) (which drives the in-box harness over a `SandboxClient`): no `runLoop`
driver, no role-coupled delegate — the harness list is the fanout, the gate is `patchDelivered`,
the winner is the shared valid-only selector (NOT `defaultSelectWinner`, whose non-valid fallback
would surface an ungated patch). Equal-k holds by the conserved budget pool. Returns the winning
patch artifact, or throws when no candidate is delivered (fail loud, never a vacuous done).

## Parameters

### options

[`WorktreeLoopRunnerOptions`](../interfaces/WorktreeLoopRunnerOptions.md)

## Returns

[`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<`WorktreeHarnessResult`\>
