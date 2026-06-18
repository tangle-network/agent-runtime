[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / uiAuditorProfile

# Function: uiAuditorProfile()

> **uiAuditorProfile**(`options?`): `object`

Defined in: [profiles/ui-auditor/profile.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/profile.ts#L41)

**`Experimental`**

## Parameters

### options?

[`UiAuditorProfileOptions`](../interfaces/UiAuditorProfileOptions.md) = `{}`

## Returns

`object`

### profile

> **profile**: `AgentProfile`

### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

#### Parameters

##### task

[`UiAuditTask`](../interfaces/UiAuditTask.md)

#### Returns

`string`

### output

> **output**: [`OutputAdapter`](../../runtime/interfaces/OutputAdapter.md)\<[`UiAuditOutput`](../interfaces/UiAuditOutput.md)\>

### validator

> **validator**: [`Validator`](../../runtime/interfaces/Validator.md)\<[`UiAuditOutput`](../interfaces/UiAuditOutput.md)\>

### agentRunSpec

> **agentRunSpec**: [`AgentRunSpec`](../../runtime/interfaces/AgentRunSpec.md)\<[`UiAuditTask`](../interfaces/UiAuditTask.md)\>
