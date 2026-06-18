[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiJudgeInput

# Interface: UiJudgeInput

Defined in: [profiles/ui-auditor/judge.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L36)

**`Experimental`**

## Properties

### lens

> **lens**: [`UiLens`](../type-aliases/UiLens.md)

Defined in: [profiles/ui-auditor/judge.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L37)

**`Experimental`**

***

### captures

> **captures**: readonly [`UiAuditCapture`](UiAuditCapture.md)[]

Defined in: [profiles/ui-auditor/judge.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L38)

**`Experimental`**

***

### productContext?

> `optional` **productContext?**: `string`

Defined in: [profiles/ui-auditor/judge.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L40)

**`Experimental`**

Free-form product context the consumer wants the judge to know.

***

### knownFindingIds?

> `optional` **knownFindingIds?**: readonly `number`[]

Defined in: [profiles/ui-auditor/judge.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L42)

**`Experimental`**

Findings already on file across earlier iterations — for similarTo linkage.

***

### promptText

> **promptText**: `string`

Defined in: [profiles/ui-auditor/judge.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L44)

**`Experimental`**

The full prompt the loop kernel synthesized for this iteration.

***

### signal

> **signal**: `AbortSignal`

Defined in: [profiles/ui-auditor/judge.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/judge.ts#L46)

**`Experimental`**

Cooperative cancellation.
