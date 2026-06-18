[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AuditIntentOptions

# Interface: AuditIntentOptions

Defined in: [runtime/audit-intent.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L42)

## Properties

### chat

> **chat**: `ChatClient`

Defined in: [runtime/audit-intent.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L43)

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/audit-intent.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L44)

***

### auditorInstruction?

> `optional` **auditorInstruction?**: `string`

Defined in: [runtime/audit-intent.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L46)

Override the auditor instruction (optimizable like any analyst prompt).

***

### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: [runtime/audit-intent.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L48)

Cap trace lines fed to the auditor. Default 80.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/audit-intent.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L49)
