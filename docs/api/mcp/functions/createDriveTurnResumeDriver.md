[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createDriveTurnResumeDriver

# Function: createDriveTurnResumeDriver()

> **createDriveTurnResumeDriver**(`options`): [`DelegationResumeDriver`](../interfaces/DelegationResumeDriver.md)

Defined in: [mcp/detached-turn.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L415)

**`Experimental`**

Build the `driveTurn`-backed [DelegationResumeDriver](../interfaces/DelegationResumeDriver.md). Each `tick()`
is one settle/poll/dispatch pass:

  - ref without a sandbox binding → `failed` (`DetachedSessionUnboundError`):
    the previous process died before a box existed; there is nothing to resume.
  - `driveTurn` `completed` → `settleOutput` → `completed` tick.
  - `running` → progress via `ctx.report`, `running` tick (queue re-ticks
    after `intervalMs`).
  - `failed` → `failed` tick (`DetachedTurnFailedError`) — terminal per the
    SDK's deterministic-failure contract.

Abort: the queue stops ticking once `cancel()` flips the record, so remote
cancellation is hooked onto `ctx.signal` (once per task) and fires
`_sessionCancel` when the SDK surface exposes it. The driver never deletes
boxes — it cannot know whether `sandboxId` is a disposable sibling or a
fleet machine, and destroying a fleet machine would be unrecoverable.

## Parameters

### options

[`DriveTurnResumeDriverOptions`](../interfaces/DriveTurnResumeDriverOptions.md)

## Returns

[`DelegationResumeDriver`](../interfaces/DelegationResumeDriver.md)
