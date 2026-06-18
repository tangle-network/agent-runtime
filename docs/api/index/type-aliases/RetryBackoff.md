[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RetryBackoff

# Type Alias: RetryBackoff

> **RetryBackoff** = `number` \| ((`attempt`) => `number`)

Defined in: [conversation/call-policy.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L20)

Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`.
