[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiFinding

# Interface: UiFinding

Defined in: [profiles/ui-auditor/substrate.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L81)

A single UI audit finding — the unit of work a contributor can act on.

Every field except the documented optionals is required. The auditor
validator + writer hard-fail on missing screenshot evidence, missing
lens, missing title, etc.

## Properties

### id?

> `optional` **id?**: `number`

Defined in: [profiles/ui-auditor/substrate.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L83)

Monotonic id assigned by the writer when persisting. Optional in-transit.

***

### title

> **title**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L84)

***

### lens

> **lens**: [`UiLens`](../type-aliases/UiLens.md)

Defined in: [profiles/ui-auditor/substrate.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L85)

***

### severity

> **severity**: [`UiFindingSeverity`](../type-aliases/UiFindingSeverity.md)

Defined in: [profiles/ui-auditor/substrate.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L86)

***

### route

> **route**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L88)

Logical route the finding was observed on (e.g. `home`, `checkout-step-2`).

***

### url?

> `optional` **url?**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L90)

Fully qualified URL the finding was observed at.

***

### viewport?

> `optional` **viewport?**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L92)

Viewport string the offending capture was taken at (e.g. `1280x800`).

***

### selector?

> `optional` **selector?**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L94)

CSS selector pinning the offending element, when one can be identified.

***

### observation

> **observation**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L96)

1–3 sentences describing what the screenshot shows that is wrong.

***

### impact

> **impact**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L98)

Who is affected and how.

***

### suggestedFix

> **suggestedFix**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L100)

A specific change a contributor could apply without asking back.

***

### reproSteps?

> `optional` **reproSteps?**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L102)

Optional explicit reproduction steps. Writer synthesizes from route/url/selector when omitted.

***

### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [profiles/ui-auditor/substrate.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L104)

Free-form tags.

***

### screenshots

> **screenshots**: readonly [`UiFindingScreenshot`](UiFindingScreenshot.md)[]

Defined in: [profiles/ui-auditor/substrate.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L106)

Screenshot references — must be non-empty for actionable findings.

***

### similarTo?

> `optional` **similarTo?**: readonly `number`[]

Defined in: [profiles/ui-auditor/substrate.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L108)

Cross-references to similar findings already on file, by id.

***

### createdAt?

> `optional` **createdAt?**: `string`

Defined in: [profiles/ui-auditor/substrate.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/substrate.ts#L110)

ISO-8601 creation timestamp set by the writer when persisted.
