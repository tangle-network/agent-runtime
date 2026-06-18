[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DetachedWinnerSelection

# Type Alias: DetachedWinnerSelection

> **DetachedWinnerSelection** = `"highest-score"` \| `"smallest-diff"` \| `"highest-readiness"` \| `"first-approved"`

Defined in: [mcp/delegates.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L143)

**`Experimental`**

Winner-selection strategy among validated (+ reviewed) candidates on the
sandbox-session path. The base strategies (`highest-score` / `smallest-diff` /
`first-approved`) delegate to the shared `selectValidWinner`; `highest-readiness` is the
reviewer-only strategy this path keeps that the generic selector does not express. Default
`highest-score`.
