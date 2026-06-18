[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / coderTaskFromArgs

# Function: coderTaskFromArgs()

> **coderTaskFromArgs**(`args`): [`CoderTask`](../../profiles/interfaces/CoderTask.md)

Defined in: [mcp/delegates.ts:430](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L430)

**`Experimental`**

Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for
the delegate's live dispatch AND the resume driver's settle/message
rebuilding, so a resumed record reproduces exactly the task the original
process dispatched.

## Parameters

### args

[`DelegateCodeArgs`](../interfaces/DelegateCodeArgs.md)

## Returns

[`CoderTask`](../../profiles/interfaces/CoderTask.md)
