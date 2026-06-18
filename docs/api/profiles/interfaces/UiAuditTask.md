[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiAuditTask

# Interface: UiAuditTask

Defined in: [profiles/ui-auditor/task.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L54)

**`Experimental`**

One iteration's task: audit a single (lens × route) pair, capturing the
surfaces the lens needs.

`captures` lists the screenshots to take BEFORE the judge is invoked.
The judge sees all captures from this iteration plus the lens-specific
brief.

## Properties

### lens

> **lens**: [`UiLens`](../type-aliases/UiLens.md)

Defined in: [profiles/ui-auditor/task.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L56)

**`Experimental`**

The audit lens that scopes which findings are valid this iteration.

***

### captures

> **captures**: readonly [`UiAuditCaptureRequest`](UiAuditCaptureRequest.md)[]

Defined in: [profiles/ui-auditor/task.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L58)

**`Experimental`**

Required captures. Order is preserved; index 0 is the primary frame.

***

### productContext?

> `optional` **productContext?**: `string`

Defined in: [profiles/ui-auditor/task.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L63)

**`Experimental`**

Free-form context the consumer wants the judge to know about (product
name, target audience, copy tone). Surfaced as a prompt prelude.

***

### knownFindingIds?

> `optional` **knownFindingIds?**: readonly `number`[]

Defined in: [profiles/ui-auditor/task.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/task.ts#L69)

**`Experimental`**

IDs of findings already on file across earlier iterations. The judge
uses these to mark cross-references via `similarTo` instead of filing
pile-on duplicates.
