[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeTelemetryOptions

# Interface: RuntimeTelemetryOptions

Defined in: [sanitize.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L29)

## Stable

## Properties

### includeInputs?

> `optional` **includeInputs?**: `boolean`

Defined in: [sanitize.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L34)

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

***

### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Defined in: [sanitize.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L36)

Include requirement descriptions. Secret requirements are always redacted.

***

### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Defined in: [sanitize.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L38)

Include evidence IDs. Off by default; counts are safer for shared reports.

***

### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Defined in: [sanitize.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L40)

Include user answers from question preflight. Off by default.

***

### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Defined in: [sanitize.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L42)

Include action payloads and action results for control steps. Off by default.

***

### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Defined in: [sanitize.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L44)

Include task metadata. Off by default because metadata may carry IDs or policy internals.

***

### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Defined in: [sanitize.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L46)

Include eval detail/evidence strings. Off by default because validators may echo private input.
