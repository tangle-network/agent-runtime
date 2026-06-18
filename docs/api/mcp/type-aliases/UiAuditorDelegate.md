[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / UiAuditorDelegate

# Type Alias: UiAuditorDelegate

> **UiAuditorDelegate** = (`args`, `ctx`) => `Promise`\<[`UiAuditorDelegationOutput`](../interfaces/UiAuditorDelegationOutput.md)\>

Defined in: [mcp/delegates.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L105)

**`Experimental`**

UI-auditor delegate — fully consumer-injected. agent-runtime ships no
default factory because the inputs are workspace path + judge function
+ (optionally) a `SandboxClient`, and the judge is the consumer's
model seam. See `createInProcessUiAuditClient` + `uiAuditorProfile` in
`@tangle-network/agent-runtime/profiles` for the canonical wiring.

## Parameters

### args

[`DelegateUiAuditArgs`](../interfaces/DelegateUiAuditArgs.md)

### ctx

[`DelegateRunCtx`](../interfaces/DelegateRunCtx.md)

## Returns

`Promise`\<[`UiAuditorDelegationOutput`](../interfaces/UiAuditorDelegationOutput.md)\>
