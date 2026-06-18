[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AutoApplyPolicy

# Interface: AutoApplyPolicy

Defined in: [agent/define-agent.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L257)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Properties

### knowledge?

> `optional` **knowledge?**: `object`

Defined in: [agent/define-agent.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L258)

#### enabled

> **enabled**: `boolean`

#### confidenceThreshold?

> `optional` **confidenceThreshold?**: `number`

#### mode?

> `optional` **mode?**: `"write"` \| `"open-pr"`

***

### improvement?

> `optional` **improvement?**: `object`

Defined in: [agent/define-agent.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L263)

#### enabled

> **enabled**: `boolean`

#### confidenceThreshold?

> `optional` **confidenceThreshold?**: `number`

#### mode?

> `optional` **mode?**: `"write"` \| `"open-pr"`
