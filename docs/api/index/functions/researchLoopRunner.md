[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / researchLoopRunner

# Function: researchLoopRunner()

> **researchLoopRunner**(`o`): [`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<[`ResearchLoopResult`](../interfaces/ResearchLoopResult.md)\>

Defined in: [loop-runner.ts:282](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L282)

**`Experimental`**

`research` mode — research-in-a-loop with valid-only KB growth.

Each round: research → gate every candidate (fail-closed; passage MUST be in
the source) → accept the clean ones → re-research the vetoed ones next round,
up to `maxRounds`. Vetoed facts in the final round are RETURNED (escalate,
never silently dropped) so the caller audits vs retries.

## Parameters

### o

[`ResearchLoopRunnerOptions`](../interfaces/ResearchLoopRunnerOptions.md)

## Returns

[`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<[`ResearchLoopResult`](../interfaces/ResearchLoopResult.md)\>
