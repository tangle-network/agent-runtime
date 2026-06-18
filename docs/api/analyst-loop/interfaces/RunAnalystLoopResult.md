[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / RunAnalystLoopResult

# Interface: RunAnalystLoopResult\<TProposal, TEdit\>

Defined in: [analyst-loop/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L119)

## Type Parameters

### TProposal

`TProposal` = `unknown`

### TEdit

`TEdit` = `unknown`

## Properties

### runId

> **runId**: `string`

Defined in: [analyst-loop/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L120)

***

### baselineRunId

> **baselineRunId**: `string` \| `null`

Defined in: [analyst-loop/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L121)

***

### analystResult

> **analystResult**: `AnalystRunResult`

Defined in: [analyst-loop/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L122)

***

### diff

> **diff**: `FindingsDiff` \| `null`

Defined in: [analyst-loop/types.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L123)

***

### knowledge

> **knowledge**: [`KnowledgeReport`](KnowledgeReport.md)\<`TProposal`\> \| `null`

Defined in: [analyst-loop/types.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L124)

***

### improvement

> **improvement**: [`ImprovementReport`](ImprovementReport.md)\<`TEdit`\> \| `null`

Defined in: [analyst-loop/types.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L125)
