[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / OutcomeMeasurement

# Interface: OutcomeMeasurement

Defined in: [agent/outcome.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L23)

## Properties

### baselineComposite

> **baselineComposite**: `number`

Defined in: [agent/outcome.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L25)

Baseline composite before applies — captured from the most-recent eval run.

***

### afterComposite

> **afterComposite**: `number`

Defined in: [agent/outcome.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L27)

Composite after re-running the cohort with applied edits.

***

### delta

> **delta**: `number`

Defined in: [agent/outcome.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L29)

`afterComposite - baselineComposite`. Positive = the loop improved the agent.

***

### perPersona

> **perPersona**: readonly `object`[]

Defined in: [agent/outcome.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L31)

Per-persona deltas for finer-grained review.

***

### rolledBackPaths

> **rolledBackPaths**: readonly `string`[]

Defined in: [agent/outcome.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L33)

When the substrate rolled back applies due to regression, the paths reverted.
