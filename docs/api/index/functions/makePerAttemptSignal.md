[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / makePerAttemptSignal

# Function: makePerAttemptSignal()

> **makePerAttemptSignal**(`parentSignal`, `deadlineMs`): `object`

Defined in: [conversation/call-policy.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L126)

Build a per-attempt AbortSignal linked to the parent signal AND fired when
the deadline elapses. The returned `dispose()` MUST be called in a
`finally` (clears the timer, detaches the listener) so we don't leak.

When the deadline fires, the signal's `reason` is a `DeadlineExceededError`
— callers can detect timeout-vs-cancel by reading `signal.reason` after
the underlying operation throws.

## Parameters

### parentSignal

`AbortSignal` \| `undefined`

### deadlineMs

`number` \| `undefined`

## Returns

`object`

### signal

> **signal**: `AbortSignal`

### dispose

> **dispose**: () => `void`

#### Returns

`void`

### getDeadlineError()

> **getDeadlineError**(): [`DeadlineExceededError`](../classes/DeadlineExceededError.md) \| `undefined`

#### Returns

[`DeadlineExceededError`](../classes/DeadlineExceededError.md) \| `undefined`
