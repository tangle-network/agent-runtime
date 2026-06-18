[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / TraceHandle

# Interface: TraceHandle

Defined in: [intelligence/index.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L172)

The trace handle a `traceRun` body records into. `recordOutput` captures the
agent's result (redacted on export); `recordOutcome` captures the scored
outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
an un-recorded run still exports a span with whatever was set.

## Methods

### recordOutput()

> **recordOutput**(`output`): `void`

Defined in: [intelligence/index.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L174)

Capture the run's output. Exported through the redactor.

#### Parameters

##### output

`unknown`

#### Returns

`void`

***

### recordOutcome()

> **recordOutcome**(`outcome`): `void`

Defined in: [intelligence/index.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L181)

Capture the run's outcome. `usage` defaults to inference-only
(`intelligenceUsd: 0`) — the OFF baseline; an intelligence-enabled run
fills `intelligenceUsd` itself. `costUsd`, when given without a split, is
treated as pure inference.

#### Parameters

##### outcome

###### success?

`boolean`

###### score?

`number`

###### costUsd?

`number`

###### usage?

`Partial`\<[`UsageSplit`](UsageSplit.md)\>

#### Returns

`void`
