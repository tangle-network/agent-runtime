[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [audit](../README.md) / AuditRegistry

# Interface: AuditRegistry

Defined in: [audit/issue-writer.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L30)

**`Experimental`**

## Properties

### schemaVersion

> **schemaVersion**: `1`

Defined in: [audit/issue-writer.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L31)

**`Experimental`**

***

### findings

> **findings**: [`UiFinding`](../../profiles/interfaces/UiFinding.md)[]

Defined in: [audit/issue-writer.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L32)

**`Experimental`**

***

### routes

> **routes**: `Record`\<`string`, \{ `url?`: `string`; `captures`: [`AuditRegistryCapture`](AuditRegistryCapture.md)[]; \}\>

Defined in: [audit/issue-writer.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L34)

**`Experimental`**

Route → URL + captures sidecar; preserved across runs.
