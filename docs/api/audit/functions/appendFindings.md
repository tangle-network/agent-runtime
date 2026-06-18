[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [audit](../README.md) / appendFindings

# Function: appendFindings()

> **appendFindings**(`workspaceDir`, `findings`): `Promise`\<[`AppendFindingsResult`](../interfaces/AppendFindingsResult.md)\>

Defined in: [audit/issue-writer.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L272)

**`Experimental`**

Append findings to a workspace, writing one Markdown file per finding
and updating registry.json. Assigns monotonically increasing ids to
findings that arrived without one.

Findings already carrying an id that collides with the registry are
rejected — callers must either freshly mint findings (id undefined) or
use a separate update path. This protects against accidental overwrite.

## Parameters

### workspaceDir

`string`

### findings

readonly [`UiFinding`](../../profiles/interfaces/UiFinding.md)[]

## Returns

`Promise`\<[`AppendFindingsResult`](../interfaces/AppendFindingsResult.md)\>
