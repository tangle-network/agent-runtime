[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RetryableErrorPredicate

# Type Alias: RetryableErrorPredicate

> **RetryableErrorPredicate** = (`err`) => `boolean`

Defined in: [conversation/call-policy.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L17)

Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors.

## Parameters

### err

`unknown`

## Returns

`boolean`
