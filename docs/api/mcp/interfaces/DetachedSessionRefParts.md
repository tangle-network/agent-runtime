[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DetachedSessionRefParts

# Interface: DetachedSessionRefParts

Defined in: [mcp/detached-turn.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L83)

**`Experimental`**

Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between
submit and box acquisition — a record restored in that window is not
resumable (there is no box to resume on) and the resume driver fails it
loud rather than dispatching onto a guessed box.

## Properties

### sessionId

> **sessionId**: `string`

Defined in: [mcp/detached-turn.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L84)

**`Experimental`**

***

### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [mcp/detached-turn.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L85)

**`Experimental`**
