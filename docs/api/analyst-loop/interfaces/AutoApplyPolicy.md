[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / AutoApplyPolicy

# Interface: AutoApplyPolicy

Defined in: [analyst-loop/types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L65)

Tunable safety rails for auto-apply.

## Properties

### knowledge?

> `optional` **knowledge?**: `boolean`

Defined in: [analyst-loop/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L67)

When true AND `knowledgeAdapter.apply` exists, write knowledge proposals.

***

### knowledgeConfidenceThreshold?

> `optional` **knowledgeConfidenceThreshold?**: `number`

Defined in: [analyst-loop/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L69)

Minimum source-finding confidence required to auto-apply a knowledge proposal.

***

### improvement?

> `optional` **improvement?**: `boolean`

Defined in: [analyst-loop/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L71)

When true AND `improvementAdapter.apply` exists, apply improvement edits.

***

### improvementConfidenceThreshold?

> `optional` **improvementConfidenceThreshold?**: `number`

Defined in: [analyst-loop/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L73)

Minimum source-finding confidence required to auto-apply an improvement edit.
