[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AnalystConfig

# Interface: AnalystConfig

Defined in: [agent/define-agent.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L244)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Properties

### model

> **model**: `string`

Defined in: [agent/define-agent.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L246)

Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`.

***

### budgetUsd?

> `optional` **budgetUsd?**: `number`

Defined in: [agent/define-agent.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L248)

Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`.

***

### backend?

> `optional` **backend?**: `object`

Defined in: [agent/define-agent.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L250)

Backend hint for the AxAIService factory — same shape every kind uses.

#### name?

> `optional` **name?**: `"openai"` \| `"router"`

#### apiKey?

> `optional` **apiKey?**: `string`

#### baseUrl?

> `optional` **baseUrl?**: `string`
