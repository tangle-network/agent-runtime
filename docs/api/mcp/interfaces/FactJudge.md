[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FactJudge

# Interface: FactJudge

Defined in: [mcp/kb-gate.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L45)

**`Experimental`**

A pluggable fact validator. Throw is NOT allowed — return a
 verdict; a thrown judge is a programmer error, not a veto.

## Properties

### name

> **name**: `string`

Defined in: [mcp/kb-gate.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L46)

**`Experimental`**

## Methods

### judge()

> **judge**(`candidate`): [`FactJudgeVerdict`](FactJudgeVerdict.md) \| `Promise`\<[`FactJudgeVerdict`](FactJudgeVerdict.md)\>

Defined in: [mcp/kb-gate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L47)

**`Experimental`**

#### Parameters

##### candidate

[`FactCandidate`](FactCandidate.md)

#### Returns

[`FactJudgeVerdict`](FactJudgeVerdict.md) \| `Promise`\<[`FactJudgeVerdict`](FactJudgeVerdict.md)\>
