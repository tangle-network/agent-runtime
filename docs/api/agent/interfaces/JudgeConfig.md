[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / JudgeConfig

# Interface: JudgeConfig\<TRunOutput\>

Defined in: [agent/define-agent.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L144)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Type Parameters

### TRunOutput

`TRunOutput`

## Properties

### id

> **id**: `string`

Defined in: [agent/define-agent.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L146)

Judge identifier — appears in trace spans + manifest.

***

### model

> **model**: `string`

Defined in: [agent/define-agent.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L148)

Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases.

***

### dimensions

> **dimensions**: readonly `string`[]

Defined in: [agent/define-agent.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L150)

Dimensions this judge scores.

***

### anchors?

> `optional` **anchors?**: readonly `object`[]

Defined in: [agent/define-agent.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L156)

Optional rubric anchors — text examples the judge sees as a
few-shot prompt to calibrate. STRONGLY recommended for subjective
dimensions; required by the calibration gate (Pearson ≥0.7).
