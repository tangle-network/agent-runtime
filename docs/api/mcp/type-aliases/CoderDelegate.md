[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CoderDelegate

# Type Alias: CoderDelegate

> **CoderDelegate** = (`args`, `ctx`) => `Promise`\<`CoderOutput`\>

Defined in: [mcp/delegates.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L88)

**`Experimental`**

The server's coder-profile delegate slot — the closure the queue invokes for a
 `delegate_code` task. `detachedSessionDelegate` is the built-in implementation.

## Parameters

### args

[`DelegateCodeArgs`](../interfaces/DelegateCodeArgs.md)

### ctx

[`DelegateRunCtx`](../interfaces/DelegateRunCtx.md)

## Returns

`Promise`\<`CoderOutput`\>
