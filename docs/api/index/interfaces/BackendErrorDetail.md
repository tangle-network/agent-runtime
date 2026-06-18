[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / BackendErrorDetail

# Interface: BackendErrorDetail

Defined in: [types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L210)

## Stable

Typed transport / backend failure detail. Carried on `backend_error` and
`final` events when the backend's stream throws or the upstream HTTP call
returns a non-success status. Lets consumers (a) distinguish "stream
completed with no text" from "stream never reached the model" and
(b) reconstruct the precise upstream signal (status + truncated body) when
building a `RunRecord.error`.

`body` is truncated to 2 KiB by the backend so an HTML error page from a
misconfigured proxy never bloats event payloads or logs. Consumers needing
the full body should inspect the underlying `BackendTransportError.body`
via a custom `mapEvent` or backend wrapper.

## Properties

### kind

> **kind**: `"transport"` \| `"backend"`

Defined in: [types.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L216)

`'transport'` — upstream HTTP / network failure with optional status code.
`'backend'` — the backend's `stream()` generator threw for a non-transport
reason (e.g. a custom adapter error, sandbox crash).

***

### message

> **message**: `string`

Defined in: [types.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L217)

***

### status?

> `optional` **status?**: `number`

Defined in: [types.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L219)

Upstream HTTP status when known. `0` for connection / abort errors.

***

### body?

> `optional` **body?**: `string`

Defined in: [types.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L221)

Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed.
