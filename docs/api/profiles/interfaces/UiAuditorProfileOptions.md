[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / UiAuditorProfileOptions

# Interface: UiAuditorProfileOptions

Defined in: [profiles/ui-auditor/profile.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/profile.ts#L22)

**`Experimental`**

## Properties

### name?

> `optional` **name?**: `string`

Defined in: [profiles/ui-auditor/profile.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/profile.ts#L26)

**`Experimental`**

Stable name surfaced in trace events. Defaults to `ui-auditor`.

***

### model?

> `optional` **model?**: `string`

Defined in: [profiles/ui-auditor/profile.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/profile.ts#L31)

**`Experimental`**

Optional model identifier passed in `AgentProfile.model.default`.
The consumer's `SandboxClient` chooses how to interpret it.

***

### task?

> `optional` **task?**: [`UiAuditTask`](UiAuditTask.md)

Defined in: [profiles/ui-auditor/profile.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/profile.ts#L37)

**`Experimental`**

Task bound to the validator. Without it the validator uses the lens
embedded in the iteration output as its expectation — fine for one-off
use; less strict than passing the task explicitly.
