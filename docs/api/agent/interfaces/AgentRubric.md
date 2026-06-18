[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AgentRubric

# Interface: AgentRubric\<TRunOutput\>

Defined in: [agent/define-agent.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L118)

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

### dimensions

> **dimensions**: readonly [`RubricDimension`](RubricDimension.md)\<`TRunOutput`\>[]

Defined in: [agent/define-agent.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L120)

Dimensions composing the weighted score. Weights sum to 1.0 by convention.

***

### judges?

> `optional` **judges?**: readonly [`JudgeConfig`](JudgeConfig.md)\<`TRunOutput`\>[]

Defined in: [agent/define-agent.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L126)

Optional judges layered on top of deterministic dimensions. Each
judge returns a score per dimension; the substrate averages judges
(mean by default) for the LLM contribution.
