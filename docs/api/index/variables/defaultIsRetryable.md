[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / defaultIsRetryable

# Variable: defaultIsRetryable

> `const` **defaultIsRetryable**: [`RetryableErrorPredicate`](../type-aliases/RetryableErrorPredicate.md)

Defined in: [conversation/call-policy.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L62)

Default retryable classification — network/timeout class errors. Errors
a model deliberately throws (validation, refusal, 4xx) are not retried;
those represent real outcomes, not transient infrastructure faults.
