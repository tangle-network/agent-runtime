[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [audit](../README.md) / AppendFindingsResult

# Interface: AppendFindingsResult

Defined in: [audit/issue-writer.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L254)

**`Experimental`**

## Properties

### written

> **written**: [`UiFinding`](../../profiles/interfaces/UiFinding.md)[]

Defined in: [audit/issue-writer.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L256)

**`Experimental`**

Findings with id + createdAt assigned, in input order.

***

### files

> **files**: `string`[]

Defined in: [audit/issue-writer.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L258)

**`Experimental`**

Workspace-relative path to each issue Markdown file, in input order.
