[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeDecisionPoint

# Interface: RuntimeDecisionPoint

Defined in: [runtime-hooks.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L59)

## Properties

### id

> **id**: `string`

Defined in: [runtime-hooks.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L60)

***

### runId

> **runId**: `string`

Defined in: [runtime-hooks.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L61)

***

### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-hooks.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L62)

***

### stepIndex

> **stepIndex**: `number`

Defined in: [runtime-hooks.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L63)

***

### kind

> **kind**: [`RuntimeDecisionKind`](../type-aliases/RuntimeDecisionKind.md)

Defined in: [runtime-hooks.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L64)

***

### candidateActions

> **candidateActions**: `string`[]

Defined in: [runtime-hooks.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L65)

***

### context?

> `optional` **context?**: `string`

Defined in: [runtime-hooks.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L66)

***

### evidence

> **evidence**: [`RuntimeDecisionEvidenceRef`](RuntimeDecisionEvidenceRef.md)[]

Defined in: [runtime-hooks.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L67)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L68)
