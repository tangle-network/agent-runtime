[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / OutcomeMeasurementOpts

# Interface: OutcomeMeasurementOpts

Defined in: [agent/outcome.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L36)

## Properties

### baseline

> **baseline**: readonly `object`[]

Defined in: [agent/outcome.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L38)

Composite scores from the run that produced the findings.

***

### reRunCohort

> **reRunCohort**: (`personaIds`) => `Promise`\<readonly `object`[]\>

Defined in: [agent/outcome.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L47)

Re-run callback — the substrate invokes this after applies. The
agent author provides their `runAgentEval`-equivalent so the
substrate can ask "score this persona slice now."

The callback SHOULD reuse the same cohort + judges + variant as
the baseline run; only the agent's mutable surfaces have changed.

#### Parameters

##### personaIds

readonly `string`[]

#### Returns

`Promise`\<readonly `object`[]\>

***

### rollbackOnRegression?

> `optional` **rollbackOnRegression?**: `boolean`

Defined in: [agent/outcome.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L51)

When `true`, applied edits are reverted on negative delta. Default `false`.

***

### revert?

> `optional` **revert?**: (`paths`) => `Promise`\<`void`\>

Defined in: [agent/outcome.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L53)

Callback to revert a list of paths (typically `git checkout HEAD --`).

#### Parameters

##### paths

readonly `string`[]

#### Returns

`Promise`\<`void`\>
