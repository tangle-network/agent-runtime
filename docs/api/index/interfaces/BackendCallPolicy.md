[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / BackendCallPolicy

# Interface: BackendCallPolicy

Defined in: [conversation/call-policy.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L28)

## Properties

### perAttemptDeadlineMs?

> `optional` **perAttemptDeadlineMs?**: `number`

Defined in: [conversation/call-policy.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L30)

Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure.

***

### maxRetries?

> `optional` **maxRetries?**: `number`

Defined in: [conversation/call-policy.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L32)

Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0.

***

### retryBackoffMs?

> `optional` **retryBackoffMs?**: [`RetryBackoff`](../type-aliases/RetryBackoff.md)

Defined in: [conversation/call-policy.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L34)

Backoff between attempts. Default 250ms with jitter.

***

### isRetryable?

> `optional` **isRetryable?**: [`RetryableErrorPredicate`](../type-aliases/RetryableErrorPredicate.md)

Defined in: [conversation/call-policy.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L36)

Custom retry classifier. Defaults to [defaultIsRetryable](../variables/defaultIsRetryable.md).

***

### circuitBreaker?

> `optional` **circuitBreaker?**: [`CircuitBreakerConfig`](CircuitBreakerConfig.md)

Defined in: [conversation/call-policy.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L38)

Circuit breaker that opens after N consecutive failures per participant.
