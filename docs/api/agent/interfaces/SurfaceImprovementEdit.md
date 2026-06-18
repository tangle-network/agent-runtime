[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / SurfaceImprovementEdit

# Interface: SurfaceImprovementEdit

Defined in: [agent/improvement-adapter.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L43)

## Properties

### id

> **id**: `string`

Defined in: [agent/improvement-adapter.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L45)

Stable id derived from the source finding so re-proposals are idempotent.

***

### sourceFindingId

> **sourceFindingId**: `string`

Defined in: [agent/improvement-adapter.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L47)

The finding that produced this edit — for revert + audit trail.

***

### subject

> **subject**: `FindingSubject`

Defined in: [agent/improvement-adapter.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L49)

Parsed subject; included so the apply step doesn't re-parse.

***

### target

> **target**: [`ResolvedSurface`](ResolvedSurface.md)

Defined in: [agent/improvement-adapter.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L51)

Resolved on-disk target.

***

### baseSha256

> **baseSha256**: `string`

Defined in: [agent/improvement-adapter.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L53)

SHA-256 of the current file content the patch was drafted against.

***

### patch

> **patch**: `string`

Defined in: [agent/improvement-adapter.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L55)

Unified-diff patch the LLM drafted (relative to `target.absolutePath`).

***

### summary

> **summary**: `string`

Defined in: [agent/improvement-adapter.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L57)

One-line summary the operator sees in the report / PR title.

***

### rationale

> **rationale**: `string`

Defined in: [agent/improvement-adapter.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L59)

Multi-line rationale for the PR body — finding context + LLM reasoning.

***

### confidence

> **confidence**: `number`

Defined in: [agent/improvement-adapter.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L61)

Carry-forward from the finding so the apply gate can check the threshold.

***

### severity

> **severity**: `AnalystSeverity`

Defined in: [agent/improvement-adapter.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L63)

Carry-forward severity for prioritization.
