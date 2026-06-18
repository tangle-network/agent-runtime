[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AuditIntentInput

# Interface: AuditIntentInput

Defined in: [runtime/audit-intent.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L29)

## Properties

### declaredIntent

> **declaredIntent**: `string`

Defined in: [runtime/audit-intent.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L31)

The declared intent: the task text / acceptance criteria the agent was given.

***

### trace

> **trace**: readonly `unknown`[]

Defined in: [runtime/audit-intent.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L33)

The trajectory so far — tool calls + results + assistant turns (any event shapes).

***

### userIntent?

> `optional` **userIntent?**: `string`

Defined in: [runtime/audit-intent.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L35)

The principal's actual intent when it differs from the literal task (the contract).

***

### metaIntent?

> `optional` **metaIntent?**: `string`

Defined in: [runtime/audit-intent.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L38)

The loop-level purpose (meta-intent): what the WHOLE run is for — lets the auditor
 flag locally-sensible work that serves the wrong larger objective.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/audit-intent.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L39)
