[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / BackendTransportError

# Class: BackendTransportError

Defined in: [errors.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L65)

## Stable

A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
status. Distinct from `JudgeError` (which is structural / unrecoverable)
because backend failures are sometimes retryable and consumers may want to
branch on the upstream status code.

## Extends

- `AgentEvalError`

## Constructors

### Constructor

> **new BackendTransportError**(`backend`, `message`, `options?`): `BackendTransportError`

Defined in: [errors.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L76)

#### Parameters

##### backend

`string`

##### message

`string`

##### options?

###### cause?

`unknown`

###### status?

`number`

###### body?

`string`

#### Returns

`BackendTransportError`

#### Overrides

`AgentEvalError.constructor`

## Properties

### backend

> `readonly` **backend**: `string`

Defined in: [errors.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L66)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [errors.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L67)

***

### body?

> `readonly` `optional` **body?**: `string`

Defined in: [errors.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L74)

Truncated upstream response body (≤2 KiB) when available. Diagnostic
only — surfaces in `backend_error.error.body` and `final.error.body`
so operators can see "free_tier_limit", "invalid_api_key", etc. without
cracking the log line open.
