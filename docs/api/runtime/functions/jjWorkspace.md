[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / jjWorkspace

# Function: jjWorkspace()

> **jjWorkspace**(`opts`): [`Workspace`](../interfaces/Workspace.md)

Defined in: [runtime/workspace.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L90)

A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote).
 Same port, same `Shell` — a drop-in for `gitWorkspace`. jj suits agent loops:
 no staging area, and a first-class operation log (native resume/undo). Live use
 requires `jj` on the `Shell`'s host.

## Parameters

### opts

[`GitWorkspaceOptions`](../interfaces/GitWorkspaceOptions.md)

## Returns

[`Workspace`](../interfaces/Workspace.md)
