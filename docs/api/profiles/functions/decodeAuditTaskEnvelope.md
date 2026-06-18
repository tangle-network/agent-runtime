[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / decodeAuditTaskEnvelope

# Function: decodeAuditTaskEnvelope()

> **decodeAuditTaskEnvelope**(`prompt`): [`UiAuditTask`](../interfaces/UiAuditTask.md) \| `undefined`

Defined in: [profiles/ui-auditor/prompt.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/prompt.ts#L36)

**`Experimental`**

Parse a task envelope back out of a prompt string. Returns undefined if
the prompt does not contain a complete envelope OR if the payload is
not valid JSON.

## Parameters

### prompt

`string`

## Returns

[`UiAuditTask`](../interfaces/UiAuditTask.md) \| `undefined`
