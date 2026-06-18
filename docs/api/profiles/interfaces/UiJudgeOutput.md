[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiJudgeOutput

# Interface: UiJudgeOutput

Defined in: [profiles/ui-auditor/judge.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L50)

**`Experimental`**

## Properties

### findings

> **findings**: [`UiFinding`](UiFinding.md)[]

Defined in: [profiles/ui-auditor/judge.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L51)

**`Experimental`**

***

### notes?

> `optional` **notes?**: `string`

Defined in: [profiles/ui-auditor/judge.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L53)

**`Experimental`**

Optional triage commentary.

***

### tokenUsage?

> `optional` **tokenUsage?**: [`UiJudgeTokenUsage`](UiJudgeTokenUsage.md)

Defined in: [profiles/ui-auditor/judge.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L55)

**`Experimental`**

Optional usage; folded into the kernel cost ledger when present.

***

### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [profiles/ui-auditor/judge.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L57)

**`Experimental`**

Optional total cost in USD.
