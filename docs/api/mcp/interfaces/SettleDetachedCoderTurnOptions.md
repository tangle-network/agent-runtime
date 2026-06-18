[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / SettleDetachedCoderTurnOptions

# Interface: SettleDetachedCoderTurnOptions

Defined in: [mcp/delegates.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L442)

**`Experimental`**

## Properties

### task

> **task**: [`CoderTask`](../../profiles/interfaces/CoderTask.md)

Defined in: [mcp/delegates.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L443)

**`Experimental`**

***

### sessionId

> **sessionId**: `string`

Defined in: [mcp/delegates.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L445)

**`Experimental`**

Session id of the detached turn — used as the synthesized event id.

***

### signal

> **signal**: `AbortSignal`

Defined in: [mcp/delegates.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L446)

**`Experimental`**

***

### harness?

> `optional` **harness?**: `string`

Defined in: [mcp/delegates.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L447)

**`Experimental`**

***

### model?

> `optional` **model?**: `string`

Defined in: [mcp/delegates.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L448)

**`Experimental`**

***

### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](../type-aliases/CoderReviewer.md)

Defined in: [mcp/delegates.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L450)

**`Experimental`**

Same gate as the streaming path: an unapproved candidate cannot win.
