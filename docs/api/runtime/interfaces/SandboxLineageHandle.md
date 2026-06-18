[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SandboxLineageHandle

# Interface: SandboxLineageHandle

Defined in: [runtime/sandbox-lineage.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L113)

**`Experimental`**

A live box plus the session that threads its iterations together. Handed back
by `start`/`fork`, passed into `continue`/`fork` to descend from. Opaque to
the kernel beyond `box` (for placement/teardown) and `sessionId` (trace).

## Properties

### box

> **box**: `SandboxInstance`

Defined in: [runtime/sandbox-lineage.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L115)

**`Experimental`**

The owned, running sandbox this handle drives.

***

### sessionId

> **sessionId**: `string`

Defined in: [runtime/sandbox-lineage.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L122)

**`Experimental`**

Stable session id threaded through this box's `streamPrompt` calls. Minted
by the lineage on `start`; reused on `continue` so the server continues the
same conversation. A forked handle starts a fresh session on its new box —
the shared context comes from the checkpoint, not a shared session id.
