[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / SanitizedKnowledgeReadinessReport

# Interface: SanitizedKnowledgeReadinessReport

Defined in: [sanitize.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L67)

## Stable

## Properties

### taskId

> **taskId**: `string`

Defined in: [sanitize.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L68)

***

### readinessScore

> **readinessScore**: `number`

Defined in: [sanitize.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L69)

***

### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

Defined in: [sanitize.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L70)

***

### severity

> **severity**: `ControlSeverity`

Defined in: [sanitize.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L71)

***

### reason

> **reason**: `string`

Defined in: [sanitize.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L72)

***

### blockingMissingRequirements

> **blockingMissingRequirements**: `SanitizedKnowledgeRequirement`[]

Defined in: [sanitize.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L73)

***

### nonBlockingGaps

> **nonBlockingGaps**: `SanitizedKnowledgeRequirement`[]

Defined in: [sanitize.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L74)

***

### evidenceCount

> **evidenceCount**: `number`

Defined in: [sanitize.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L75)

***

### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

Defined in: [sanitize.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L76)

***

### missingRequirementIds

> **missingRequirementIds**: `string`[]

Defined in: [sanitize.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L77)
