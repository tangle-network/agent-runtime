[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ResearchLoopRunnerOptions

# Interface: ResearchLoopRunnerOptions

Defined in: [loop-runner.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L260)

**`Experimental`**

Options for the default `research` runner.

## Properties

### research

> **research**: (`round`, `vetoed`) => `Promise`\<[`FactCandidate`](../../mcp/interfaces/FactCandidate.md)[]\>

Defined in: [loop-runner.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L267)

**`Experimental`**

The research engine (the consumer's web/doc searcher + extractor). Called
each round with the prior round's vetoes so it can re-research the gaps.
Returns fact candidates carrying their grounding (`verbatimPassage` +
`sourceText`).

#### Parameters

##### round

`number`

##### vetoed

[`VetoedFact`](VetoedFact.md)[]

#### Returns

`Promise`\<[`FactCandidate`](../../mcp/interfaces/FactCandidate.md)[]\>

***

### gate?

> `optional` **gate?**: [`CreateKbGateOptions`](../../mcp/interfaces/CreateKbGateOptions.md)

Defined in: [loop-runner.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L269)

**`Experimental`**

Gate config (extra judges, self-artifact kinds, …). The floor is always on.

***

### maxRounds?

> `optional` **maxRounds?**: `number`

Defined in: [loop-runner.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L271)

**`Experimental`**

Max research rounds (correct-on-veto remediation). Default 1.
