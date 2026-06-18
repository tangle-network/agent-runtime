[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / auditLoopRunner

# Function: auditLoopRunner()

> **auditLoopRunner**\<`TProposal`, `TEdit`\>(`options`): [`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<[`RunAnalystLoopResult`](../../analyst-loop/interfaces/RunAnalystLoopResult.md)\<`TProposal`, `TEdit`\>\>

Defined in: [loop-runner.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L316)

**`Experimental`**

`audit` mode — analyst loop over captured trace/run data.

## Type Parameters

### TProposal

`TProposal` = `unknown`

### TEdit

`TEdit` = `unknown`

## Parameters

### options

[`RunAnalystLoopOpts`](../../analyst-loop/interfaces/RunAnalystLoopOpts.md)

## Returns

[`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<[`RunAnalystLoopResult`](../../analyst-loop/interfaces/RunAnalystLoopResult.md)\<`TProposal`, `TEdit`\>\>
