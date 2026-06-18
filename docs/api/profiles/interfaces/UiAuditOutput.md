[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiAuditOutput

# Interface: UiAuditOutput

Defined in: [profiles/ui-auditor/task.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L93)

**`Experimental`**

Output of one iteration. `findings` is the headline payload; `captures`
is the screenshot manifest the writer needs to link evidence. `notes`
carries judge commentary that didn't rise to a finding.

## Properties

### lens

> **lens**: [`UiLens`](../type-aliases/UiLens.md)

Defined in: [profiles/ui-auditor/task.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L94)

**`Experimental`**

***

### findings

> **findings**: [`UiFinding`](UiFinding.md)[]

Defined in: [profiles/ui-auditor/task.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L95)

**`Experimental`**

***

### captures

> **captures**: [`UiAuditCapture`](UiAuditCapture.md)[]

Defined in: [profiles/ui-auditor/task.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L96)

**`Experimental`**

***

### notes?

> `optional` **notes?**: `string`

Defined in: [profiles/ui-auditor/task.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L98)

**`Experimental`**

Optional judge commentary (debug / triage aid).
