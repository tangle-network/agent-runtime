[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / audit

# audit

## Interfaces

### AuditRegistry

Defined in: [audit/issue-writer.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L30)

**`Experimental`**

#### Properties

##### schemaVersion

> **schemaVersion**: `1`

Defined in: [audit/issue-writer.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L31)

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](profiles.md#uifinding)[]

Defined in: [audit/issue-writer.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L32)

**`Experimental`**

##### routes

> **routes**: `Record`\<`string`, \{ `url?`: `string`; `captures`: [`AuditRegistryCapture`](#auditregistrycapture)[]; \}\>

Defined in: [audit/issue-writer.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L34)

**`Experimental`**

Route → URL + captures sidecar; preserved across runs.

***

### AuditRegistryCapture

Defined in: [audit/issue-writer.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L38)

**`Experimental`**

#### Properties

##### file

> **file**: `string`

Defined in: [audit/issue-writer.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L39)

**`Experimental`**

##### viewport?

> `optional` **viewport?**: `string`

Defined in: [audit/issue-writer.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L40)

**`Experimental`**

##### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: [audit/issue-writer.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L41)

**`Experimental`**

##### elementSelector?

> `optional` **elementSelector?**: `string`

Defined in: [audit/issue-writer.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L42)

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

Defined in: [audit/issue-writer.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L43)

**`Experimental`**

***

### AppendFindingsResult

Defined in: [audit/issue-writer.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L254)

**`Experimental`**

#### Properties

##### written

> **written**: [`UiFinding`](profiles.md#uifinding)[]

Defined in: [audit/issue-writer.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L256)

**`Experimental`**

Findings with id + createdAt assigned, in input order.

##### files

> **files**: `string`[]

Defined in: [audit/issue-writer.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L258)

**`Experimental`**

Workspace-relative path to each issue Markdown file, in input order.

***

### RegisterCapturesOptions

Defined in: [audit/issue-writer.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L336)

**`Experimental`**

#### Properties

##### route

> **route**: `string`

Defined in: [audit/issue-writer.ts:337](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L337)

**`Experimental`**

##### url?

> `optional` **url?**: `string`

Defined in: [audit/issue-writer.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L338)

**`Experimental`**

##### captures

> **captures**: readonly [`AuditRegistryCapture`](#auditregistrycapture)[]

Defined in: [audit/issue-writer.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L339)

**`Experimental`**

***

### AuditIndex

Defined in: [audit/issue-writer.ts:369](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L369)

**`Experimental`**

#### Properties

##### total

> **total**: `number`

Defined in: [audit/issue-writer.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L371)

**`Experimental`**

Total findings in the workspace.

##### bySeverity

> **bySeverity**: `Record`\<[`UiFinding`](profiles.md#uifinding)\[`"severity"`\], `number`\>

Defined in: [audit/issue-writer.ts:372](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L372)

**`Experimental`**

##### byLens

> **byLens**: `Partial`\<`Record`\<[`UiLens`](profiles.md#uilens), `number`\>\>

Defined in: [audit/issue-writer.ts:373](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L373)

**`Experimental`**

##### byRoute

> **byRoute**: `Record`\<`string`, `number`\>

Defined in: [audit/issue-writer.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L374)

**`Experimental`**

## Functions

### initAuditWorkspace()

> **initAuditWorkspace**(`workspaceDir`): `Promise`\<`void`\>

Defined in: [audit/issue-writer.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L78)

**`Experimental`**

#### Parameters

##### workspaceDir

`string`

#### Returns

`Promise`\<`void`\>

***

### readAuditRegistry()

> **readAuditRegistry**(`workspaceDir`): `Promise`\<[`AuditRegistry`](#auditregistry)\>

Defined in: [audit/issue-writer.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L92)

**`Experimental`**

#### Parameters

##### workspaceDir

`string`

#### Returns

`Promise`\<[`AuditRegistry`](#auditregistry)\>

***

### appendFindings()

> **appendFindings**(`workspaceDir`, `findings`): `Promise`\<[`AppendFindingsResult`](#appendfindingsresult)\>

Defined in: [audit/issue-writer.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L272)

**`Experimental`**

Append findings to a workspace, writing one Markdown file per finding
and updating registry.json. Assigns monotonically increasing ids to
findings that arrived without one.

Findings already carrying an id that collides with the registry are
rejected — callers must either freshly mint findings (id undefined) or
use a separate update path. This protects against accidental overwrite.

#### Parameters

##### workspaceDir

`string`

##### findings

readonly [`UiFinding`](profiles.md#uifinding)[]

#### Returns

`Promise`\<[`AppendFindingsResult`](#appendfindingsresult)\>

***

### registerCaptures()

> **registerCaptures**(`workspaceDir`, `options`): `Promise`\<`void`\>

Defined in: [audit/issue-writer.ts:349](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L349)

**`Experimental`**

Record screenshots taken for a route in the registry, without filing a
finding. Useful when the auditor wants to remember which captures
exist for resume / dedup purposes.

#### Parameters

##### workspaceDir

`string`

##### options

[`RegisterCapturesOptions`](#registercapturesoptions)

#### Returns

`Promise`\<`void`\>

***

### summarizeRegistry()

> **summarizeRegistry**(`reg`): [`AuditIndex`](#auditindex)

Defined in: [audit/issue-writer.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L378)

**`Experimental`**

#### Parameters

##### reg

[`AuditRegistry`](#auditregistry)

#### Returns

[`AuditIndex`](#auditindex)

***

### writeAuditIndex()

> **writeAuditIndex**(`workspaceDir`): `Promise`\<`string`\>

Defined in: [audit/issue-writer.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/audit/issue-writer.ts#L400)

**`Experimental`**

Regenerate `<workspace>/index.md` from registry.json.

#### Parameters

##### workspaceDir

`string`

#### Returns

`Promise`\<`string`\>
