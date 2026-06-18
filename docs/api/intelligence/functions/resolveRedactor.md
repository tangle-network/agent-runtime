[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / resolveRedactor

# Function: resolveRedactor()

> **resolveRedactor**(`redact`): [`Redactor`](../type-aliases/Redactor.md)

Defined in: [intelligence/redact.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/redact.ts#L91)

Resolve the redactor a client uses. A caller-supplied hook replaces the
default entirely (the customer owns their PII rules); absent one, the
built-in `defaultRedactor` runs. Returning `false` is the explicit opt-out —
NO redaction, for a caller who has already sanitized upstream and wants raw
fidelity. Opt-out is loud (an explicit `false`), never a silent default.

## Parameters

### redact

`false` \| [`Redactor`](../type-aliases/Redactor.md) \| `undefined`

## Returns

[`Redactor`](../type-aliases/Redactor.md)
