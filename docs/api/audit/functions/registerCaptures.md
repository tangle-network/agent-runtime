[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [audit](../README.md) / registerCaptures

# Function: registerCaptures()

> **registerCaptures**(`workspaceDir`, `options`): `Promise`\<`void`\>

Defined in: [audit/issue-writer.ts:349](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L349)

**`Experimental`**

Record screenshots taken for a route in the registry, without filing a
finding. Useful when the auditor wants to remember which captures
exist for resume / dedup purposes.

## Parameters

### workspaceDir

`string`

### options

[`RegisterCapturesOptions`](../interfaces/RegisterCapturesOptions.md)

## Returns

`Promise`\<`void`\>
