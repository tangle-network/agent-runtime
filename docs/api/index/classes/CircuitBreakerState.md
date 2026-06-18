[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / CircuitBreakerState

# Class: CircuitBreakerState

Defined in: [conversation/call-policy.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L83)

Live circuit-breaker state — one instance per (participant, conversation run).

## Constructors

### Constructor

> **new CircuitBreakerState**(`config`): `CircuitBreakerState`

Defined in: [conversation/call-policy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L87)

#### Parameters

##### config

[`CircuitBreakerConfig`](../interfaces/CircuitBreakerConfig.md) \| `undefined`

#### Returns

`CircuitBreakerState`

## Methods

### preflight()

> **preflight**(`participant`, `now?`): `void`

Defined in: [conversation/call-policy.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L93)

Check whether the next call is allowed. Throws `CircuitOpenError` when
the breaker is open and the cooldown hasn't elapsed.

#### Parameters

##### participant

`string`

##### now?

`number` = `...`

#### Returns

`void`

***

### recordSuccess()

> **recordSuccess**(): `void`

Defined in: [conversation/call-policy.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L103)

#### Returns

`void`

***

### recordFailure()

> **recordFailure**(`now?`): `void`

Defined in: [conversation/call-policy.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L108)

#### Parameters

##### now?

`number` = `...`

#### Returns

`void`
