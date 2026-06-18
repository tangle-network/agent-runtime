[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [audit](../README.md) / AuditIndex

# Interface: AuditIndex

Defined in: [audit/issue-writer.ts:369](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L369)

**`Experimental`**

## Properties

### total

> **total**: `number`

Defined in: [audit/issue-writer.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L371)

**`Experimental`**

Total findings in the workspace.

***

### bySeverity

> **bySeverity**: `Record`\<[`UiFinding`](../../profiles/interfaces/UiFinding.md)\[`"severity"`\], `number`\>

Defined in: [audit/issue-writer.ts:372](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L372)

**`Experimental`**

***

### byLens

> **byLens**: `Partial`\<`Record`\<[`UiLens`](../../profiles/type-aliases/UiLens.md), `number`\>\>

Defined in: [audit/issue-writer.ts:373](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L373)

**`Experimental`**

***

### byRoute

> **byRoute**: `Record`\<`string`, `number`\>

Defined in: [audit/issue-writer.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L374)

**`Experimental`**
