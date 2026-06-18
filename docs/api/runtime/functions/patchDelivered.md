[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / patchDelivered

# Function: patchDelivered()

> **patchDelivered**(`options?`): [`DeliverableSpec`](../interfaces/DeliverableSpec.md)\<`WorktreeHarnessResult`\>

Defined in: [runtime/supervise/patch-deliverable.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L44)

**`Experimental`**

Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical
gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals and returns
whether the patch is DELIVERED (the `valid` conjunction).

## Parameters

### options?

[`PatchDeliverableOptions`](../interfaces/PatchDeliverableOptions.md) = `{}`

## Returns

[`DeliverableSpec`](../interfaces/DeliverableSpec.md)\<`WorktreeHarnessResult`\>
