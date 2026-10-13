[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / workspace-store

# workspace-store

## Classes

### WorkspaceCodecError

A value did not open: unknown key, wrong tenant or path, tampering, or plaintext where a seal was required.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new WorkspaceCodecError**(`message`): [`WorkspaceCodecError`](#workspacecodecerror)

###### Parameters

###### message

`string`

###### Returns

[`WorkspaceCodecError`](#workspacecodecerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: `"codec"`

***

### WorkspaceConflictError

A write lost a compare-and-set race or targeted the wrong revision. Re-read and retry.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new WorkspaceConflictError**(`path`, `expected`, `actual`): [`WorkspaceConflictError`](#workspaceconflicterror)

###### Parameters

###### path

`string`

###### expected

`number` \| `null`

###### actual

`number` \| `null`

###### Returns

[`WorkspaceConflictError`](#workspaceconflicterror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: `"conflict"`

##### path

> `readonly` **path**: `string`

##### expected

> `readonly` **expected**: `number` \| `null`

##### actual

> `readonly` **actual**: `number` \| `null`

***

### WorkspacePolicyError

A policy or path rule refused the call.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new WorkspacePolicyError**(`message`): [`WorkspacePolicyError`](#workspacepolicyerror)

###### Parameters

###### message

`string`

###### Returns

[`WorkspacePolicyError`](#workspacepolicyerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: `"refused"`

## Interfaces

### WorkspaceCodecContext

Where a value lives; bound into the ciphertext.

#### Properties

##### tenant

> `readonly` **tenant**: `string`

##### path

> `readonly` **path**: `string`

##### operationId?

> `readonly` `optional` **operationId?**: `string`

The write's `operationId`, when it has one. A codec then seals the same
plaintext to the same bytes, so a replayed put is the same write.

***

### WorkspaceContentCodec

One versioned workspace store per tenant, shared by every executor: path
documents with compare-and-set revisions and erasure tombstones, memory and
file tools bound to a trusted turn, a default authority policy, the pinned
memory block, and the contract suite every adapter runs. Worker-safe.

#### Methods

##### seal()

> **seal**(`plain`, `context`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Parameters

###### plain

`Uint8Array`

###### context

[`WorkspaceCodecContext`](#workspacecodeccontext)

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

##### open()

> **open**(`sealed`, `context`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Parameters

###### sealed

`Uint8Array`

###### context

[`WorkspaceCodecContext`](#workspacecodeccontext)

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### ContentCodecOptions

One versioned workspace store per tenant, shared by every executor: path
documents with compare-and-set revisions and erasure tombstones, memory and
file tools bound to a trusted turn, a default authority policy, the pinned
memory block, and the contract suite every adapter runs. Worker-safe.

#### Properties

##### readPlaintext?

> `readonly` `optional` **readPlaintext?**: `boolean`

Return stored content that is not sealed as is, for a store being moved
onto a codec. Off by default: a regulated store refuses plaintext.

***

### WorkspaceStoreContractCase

#### Properties

##### name

> `readonly` **name**: `string`

#### Methods

##### run()

> **run**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

***

### WorkspaceStoreContractResult

#### Properties

##### name

> `readonly` **name**: `string`

##### passed

> `readonly` **passed**: `boolean`

##### error?

> `readonly` `optional` **error?**: `string`

***

### WorkspaceStoreContractOptions

#### Properties

##### idempotentOperations?

> `readonly` `optional` **idempotentOperations?**: `boolean`

Also check `operationId` replay; for a store that sets `idempotentOperations`.

***

### HarnessProvenance

Where a captured memory came from.

#### Properties

##### harness

> `readonly` **harness**: `string`

##### turnId

> `readonly` **turnId**: `string`

##### memberId

> `readonly` **memberId**: `string`

***

### HarnessIngestResult

#### Properties

##### saved

> `readonly` **saved**: [`WorkspaceEntry`](#workspaceentry)[]

##### duplicates

> `readonly` **duplicates**: `string`[]

Facts already in the store, by normalized text.

##### refused

> `readonly` **refused**: `object`[]

Facts the policy refused, with the reason.

###### text

> **text**: `string`

###### reason

> **reason**: `string`

***

### MemoryDivergence

#### Properties

##### total

> `readonly` **total**: `number`

Sum of the counts below; 0 means every native copy agrees with the store.

##### missing

> `readonly` **missing**: `number`

Store memories the turn sees that a native file's generated block omits.

##### stale

> `readonly` **stale**: `number`

Generated-block lines whose id is gone from the store or whose text differs.

##### uncaptured

> `readonly` **uncaptured**: `number`

Facts a harness wrote outside the generated block that the store does not hold.

##### files

> `readonly` **files**: `Record`\<`string`, \{ `missing`: `string`[]; `stale`: `string`[]; `uncaptured`: `string`[]; \}\>

***

### WorkspaceBytesRef

Large content kept outside the index, e.g. an R2 object. The adapter owns `key`.

#### Properties

##### key

> `readonly` **key**: `string`

##### size

> `readonly` **size**: `number`

##### contentType?

> `readonly` `optional` **contentType?**: `string`

##### sha256?

> `readonly` `optional` **sha256?**: `string`

***

### WorkspaceEntry

One live document. Exactly one of `content` and `bytes` is present.

#### Properties

##### workspaceId

> `readonly` **workspaceId**: `string`

##### id

> `readonly` **id**: `string`

Stable for the life of the path; kept across updates.

##### path

> `readonly` **path**: `string`

##### kind

> `readonly` **kind**: [`WorkspaceEntryKind`](#workspaceentrykind)

##### scope

> `readonly` **scope**: [`WorkspaceEntryScope`](#workspaceentryscope)

##### content?

> `readonly` `optional` **content?**: `string`

##### bytes?

> `readonly` `optional` **bytes?**: [`WorkspaceBytesRef`](#workspacebytesref)

##### revision

> `readonly` **revision**: `number`

Monotonic per path, including across delete and re-create.

##### createdBy

> `readonly` **createdBy**: `string`

##### createdAt

> `readonly` **createdAt**: `string`

##### updatedBy

> `readonly` **updatedBy**: `string`

##### updatedAt

> `readonly` **updatedAt**: `string`

***

### WorkspaceTombstone

Erasure record: the content and bytes are gone; only this audit row remains.

#### Properties

##### workspaceId

> `readonly` **workspaceId**: `string`

##### id

> `readonly` **id**: `string`

##### path

> `readonly` **path**: `string`

##### revision

> `readonly` **revision**: `number`

The revision the delete produced (last live revision + 1).

##### deletedBy

> `readonly` **deletedBy**: `string`

##### deletedAt

> `readonly` **deletedAt**: `string`

***

### WorkspacePutInput

#### Properties

##### workspaceId

> `readonly` **workspaceId**: `string`

##### path

> `readonly` **path**: `string`

##### kind

> `readonly` **kind**: [`WorkspaceEntryKind`](#workspaceentrykind)

##### ifRevision

> `readonly` **ifRevision**: `number` \| `null`

Revision the caller read, or `null` when the path must not hold a live entry.

##### actor

> `readonly` **actor**: `string`

##### content?

> `readonly` `optional` **content?**: `string`

##### bytes?

> `readonly` `optional` **bytes?**: [`WorkspaceBytesRef`](#workspacebytesref)

##### id?

> `readonly` `optional` **id?**: `string`

Id for a new entry; ignored on update. Defaults to a random UUID.

##### operationId?

> `readonly` `optional` **operationId?**: `string`

The caller's key for this write, for at-least-once callers such as a queue
consumer or a sidecar capture hook. While the path's live entry is the one
this operation wrote, with the same kind and content, repeating the call
returns that entry instead of a conflict. Honoured only by a store that sets
[WorkspaceStore.idempotentOperations](#idempotentoperations-1); others ignore it.

***

### WorkspaceDeleteInput

#### Properties

##### workspaceId

> `readonly` **workspaceId**: `string`

##### path

> `readonly` **path**: `string`

##### ifRevision?

> `readonly` `optional` **ifRevision?**: `number`

When present, the delete is refused unless the live revision matches.

##### actor

> `readonly` **actor**: `string`

##### operationId?

> `readonly` `optional` **operationId?**: `string`

The caller's key for this delete. While the path's latest tombstone is the
one this operation made, repeating the call returns that tombstone instead
of a conflict. Honoured only by a store that sets
[WorkspaceStore.idempotentOperations](#idempotentoperations-1).

***

### WorkspaceStore

Versioned path store for one or many tenants. Every write is a compare-and-set
on `revision`; a mismatch throws [WorkspaceConflictError](#workspaceconflicterror). Delete erases
content and bytes and records a [WorkspaceTombstone](#workspacetombstone).

#### Properties

##### idempotentOperations?

> `readonly` `optional` **idempotentOperations?**: `boolean`

True when put and delete honour `operationId`; the contract then checks it.

#### Methods

##### get()

> **get**(`workspaceId`, `path`): `Promise`\<[`WorkspaceEntry`](#workspaceentry) \| `null`\>

###### Parameters

###### workspaceId

`string`

###### path

`string`

###### Returns

`Promise`\<[`WorkspaceEntry`](#workspaceentry) \| `null`\>

##### list()

> **list**(`workspaceId`, `prefix`): `Promise`\<[`WorkspaceEntry`](#workspaceentry)[]\>

Live entries whose path starts with `prefix`, sorted by path.

###### Parameters

###### workspaceId

`string`

###### prefix

`string`

###### Returns

`Promise`\<[`WorkspaceEntry`](#workspaceentry)[]\>

##### put()

> **put**(`input`): `Promise`\<[`WorkspaceEntry`](#workspaceentry)\>

###### Parameters

###### input

[`WorkspacePutInput`](#workspaceputinput)

###### Returns

`Promise`\<[`WorkspaceEntry`](#workspaceentry)\>

##### delete()

> **delete**(`input`): `Promise`\<[`WorkspaceTombstone`](#workspacetombstone) \| `null`\>

Returns the tombstone, or `null` when nothing was live and no `ifRevision` was given.

###### Parameters

###### input

[`WorkspaceDeleteInput`](#workspacedeleteinput)

###### Returns

`Promise`\<[`WorkspaceTombstone`](#workspacetombstone) \| `null`\>

##### tombstones()

> **tombstones**(`workspaceId`, `prefix?`): `Promise`\<[`WorkspaceTombstone`](#workspacetombstone)[]\>

Erasure audit rows whose path starts with `prefix`, oldest first.

###### Parameters

###### workspaceId

`string`

###### prefix?

`string`

###### Returns

`Promise`\<[`WorkspaceTombstone`](#workspacetombstone)[]\>

***

### WorkspaceTurn

The speaker of the running turn, resolved by the host from its trusted session.

#### Properties

##### workspaceId

> `readonly` **workspaceId**: `string`

##### memberId

> `readonly` **memberId**: `string`

##### role

> `readonly` **role**: [`WorkspaceRole`](#workspacerole)

***

### WorkspaceToolDefinition

Structural tool shape, assignable to agent-app's `McpToolDefinition`
(`name`, `description`, JSON Schema `inputSchema`, `run(args)`), so a host
mounts it in-process or behind `createMcpToolHandler` without this package
depending on agent-app. `run` throws to report a refusal or conflict.

#### Properties

##### name

> **name**: `string`

##### description

> **description**: `string`

##### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\>

#### Methods

##### run()

> **run**(`args`): `Promise`\<`unknown`\>

###### Parameters

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`unknown`\>

***

### WorkspaceAccess

#### Properties

##### op

> `readonly` **op**: `"read"` \| `"write"` \| `"delete"`

##### path

> `readonly` **path**: `string`

##### kind?

> `readonly` `optional` **kind?**: [`WorkspaceEntryKind`](#workspaceentrykind)

***

### MemoryPolicy

#### Methods

##### authorize()

> **authorize**(`turn`, `access`): [`WorkspacePolicyDecision`](#workspacepolicydecision)

###### Parameters

###### turn

[`WorkspaceTurn`](#workspaceturn)

###### access

[`WorkspaceAccess`](#workspaceaccess)

###### Returns

[`WorkspacePolicyDecision`](#workspacepolicydecision)

##### admit()?

> `optional` **admit**(`turn`, `candidate`): [`WorkspacePolicyDecision`](#workspacepolicydecision) \| `Promise`\<[`WorkspacePolicyDecision`](#workspacepolicydecision)\>

Product content rule, e.g. refuse guest PII. Runs after `authorize` on every write.

###### Parameters

###### turn

[`WorkspaceTurn`](#workspaceturn)

###### candidate

###### path

`string`

###### kind

[`WorkspaceEntryKind`](#workspaceentrykind)

###### text

`string`

###### Returns

[`WorkspacePolicyDecision`](#workspacepolicydecision) \| `Promise`\<[`WorkspacePolicyDecision`](#workspacepolicydecision)\>

***

### WorkspaceToolContext

#### Properties

##### store

> **store**: [`WorkspaceStore`](#workspacestore)

##### policy?

> `optional` **policy?**: [`MemoryPolicy`](#memorypolicy)

Defaults to [defaultMemoryPolicy](#defaultmemorypolicy).

##### newId?

> `optional` **newId?**: () => `string`

Id for new entries. Defaults to a random UUID.

###### Returns

`string`

#### Methods

##### activeTurn()

> **activeTurn**(): `Promise`\<[`WorkspaceTurn`](#workspaceturn)\>

Resolve the running turn from the trusted server session; never from tool arguments.

###### Returns

`Promise`\<[`WorkspaceTurn`](#workspaceturn)\>

## Type Aliases

### MakeWorkspaceStore

> **MakeWorkspaceStore** = () => [`WorkspaceStore`](#workspacestore) \| `Promise`\<[`WorkspaceStore`](#workspacestore)\>

Make a fresh, empty store for one case.

#### Returns

[`WorkspaceStore`](#workspacestore) \| `Promise`\<[`WorkspaceStore`](#workspacestore)\>

***

### HarnessNativeFiles

> **HarnessNativeFiles** = `Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

Native files keyed by path, as the host read them. A missing file is absent or `undefined`.

***

### WorkspaceEntryKind

> **WorkspaceEntryKind** = `"fact"` \| `"preference"` \| `"instruction"` \| `"file"`

What an entry holds; memory kinds are written through `memory.remember`, files through `files.write`.

***

### WorkspaceEntryScope

> **WorkspaceEntryScope** = `"workspace"` \| `"member"`

`member` entries live under `/memories/members/<memberId>/`; everything else is `workspace`.

***

### WorkspaceRole

> **WorkspaceRole** = `"owner"` \| `"manager"` \| `"member"` \| `"viewer"` \| `"guest"`

`viewer` and `guest` are read-only under the default policy.

***

### WorkspacePolicyDecision

> **WorkspacePolicyDecision** = `string` \| `null`

`null` allows; a string refuses and is shown to the model as the reason.

## Variables

### SEALED\_CONTENT\_PREFIX

> `const` **SEALED\_CONTENT\_PREFIX**: `"wsc1:"` = `'wsc1:'`

Stored text of a sealed `content`: a prefix, then the sealed bytes in base64.

***

### HARNESS\_MEMORY\_BEGIN

> `const` **HARNESS\_MEMORY\_BEGIN**: `"<!-- workspace-store:memory begin. Generated from the workspace store; save memories with memory.remember. -->"` = `'<!-- workspace-store:memory begin. Generated from the workspace store; save memories with memory.remember. -->'`

Opening marker for the generated block in a harness's native memory file.

***

### HARNESS\_MEMORY\_END

> `const` **HARNESS\_MEMORY\_END**: `"<!-- workspace-store:memory end -->"` = `'<!-- workspace-store:memory end -->'`

Closing marker for the generated block in a harness's native memory file.

## Functions

### createAesGcmContentCodec()

> **createAesGcmContentCodec**(`options`): [`WorkspaceContentCodec`](#workspacecontentcodec)

AES-256-GCM with a key id per value. `keys` maps key id to 32 raw bytes
(base64 or base64url when a string). The encryption key and the key that
derives replay-stable IVs are both derived from the raw key with HKDF, so the
raw key is never used for two algorithms.

Without an `operationId` every seal uses a random 96-bit IV. With one, the IV
is an HMAC of the tenant, path, operation and plaintext, as in SIV: only an
identical write repeats it, and that repeat reveals only that the write was
repeated.

#### Parameters

##### options

###### keys

`Readonly`\<`Record`\<`string`, `string` \| `Uint8Array`\>\>

###### activeKeyId

`string`

#### Returns

[`WorkspaceContentCodec`](#workspacecontentcodec)

***

### aesGcmContentCodecFromEnv()

> **aesGcmContentCodecFromEnv**(`env`): [`WorkspaceContentCodec`](#workspacecontentcodec) \| `null`

The AES-256-GCM codec from an app's env, or `null` when neither variable is
set. `WORKSPACE_STORE_KEYS` is `id:base64,id:base64`; `WORKSPACE_STORE_KEY_ID`
names the key new writes use. Setting one without the other is refused.

#### Parameters

##### env

###### WORKSPACE_STORE_KEYS?

`string`

###### WORKSPACE_STORE_KEY_ID?

`string`

#### Returns

[`WorkspaceContentCodec`](#workspacecontentcodec) \| `null`

***

### sealWorkspaceBytes()

> **sealWorkspaceBytes**(`codec`, `context`, `bytes`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Seal bytes a host is about to upload (an R2 object) under the entry's tenant and path.

#### Parameters

##### codec

[`WorkspaceContentCodec`](#workspacecontentcodec)

##### context

[`WorkspaceCodecContext`](#workspacecodeccontext)

##### bytes

`Uint8Array`

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### openWorkspaceBytes()

> **openWorkspaceBytes**(`codec`, `context`, `sealed`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Open bytes a host downloaded for an entry's `bytes` reference.

#### Parameters

##### codec

[`WorkspaceContentCodec`](#workspacecontentcodec)

##### context

[`WorkspaceCodecContext`](#workspacecodeccontext)

##### sealed

`Uint8Array`

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### withContentCodec()

> **withContentCodec**(`store`, `codec`, `options?`): [`WorkspaceStore`](#workspacestore)

`store` with every entry's `content` sealed at rest. Index fields, `bytes`
references and tombstones pass through untouched; the host seals the bytes
themselves. `idempotentOperations` is the inner store's: a replayed put with
an `operationId` seals to the same bytes, so the inner replay check holds.

#### Parameters

##### store

[`WorkspaceStore`](#workspacestore)

##### codec

[`WorkspaceContentCodec`](#workspacecontentcodec)

##### options?

[`ContentCodecOptions`](#contentcodecoptions) = `{}`

#### Returns

[`WorkspaceStore`](#workspacestore)

***

### workspaceStoreContractCases()

> **workspaceStoreContractCases**(`makeStore`, `options?`): [`WorkspaceStoreContractCase`](#workspacestorecontractcase)[]

The contract as named cases; each case builds its own store.

#### Parameters

##### makeStore

[`MakeWorkspaceStore`](#makeworkspacestore)

##### options?

[`WorkspaceStoreContractOptions`](#workspacestorecontractoptions) = `{}`

#### Returns

[`WorkspaceStoreContractCase`](#workspacestorecontractcase)[]

***

### runWorkspaceStoreContract()

> **runWorkspaceStoreContract**(`makeStore`, `options?`): `Promise`\<[`WorkspaceStoreContractResult`](#workspacestorecontractresult)[]\>

Run every contract case against fresh stores; never throws for a failing case.

#### Parameters

##### makeStore

[`MakeWorkspaceStore`](#makeworkspacestore)

##### options?

[`WorkspaceStoreContractOptions`](#workspacestorecontractoptions) = `{}`

#### Returns

`Promise`\<[`WorkspaceStoreContractResult`](#workspacestorecontractresult)[]\>

***

### renderHarnessMemory()

> **renderHarnessMemory**(`entries`, `options?`): `string`

The generated block a host writes into a harness's native memory location.

#### Parameters

##### entries

readonly [`WorkspaceEntry`](#workspaceentry)[]

##### options?

###### maxTokens?

`number`

#### Returns

`string`

***

### projectHarnessMemory()

> **projectHarnessMemory**(`native`, `block`): `string`

Replace the generated block in `native`, or append one; text outside it is kept byte for byte.

#### Parameters

##### native

`string`

##### block

`string`

#### Returns

`string`

***

### normalizeMemoryText()

> **normalizeMemoryText**(`text`): `string`

Lowercase, collapse spaces, drop a leading "Remember:" and trailing punctuation: the duplicate key.

#### Parameters

##### text

`string`

#### Returns

`string`

***

### captureHarnessMemory()

> **captureHarnessMemory**(`before`, `after`): `string`[]

What the harness added during the turn, outside the generated block: new
lines in files that existed, and the body of new files (a Claude Code memory
directory entry). Lines removed or present before are ignored; a removal is
not a forget, which only `memory.forget` performs.

#### Parameters

##### before

[`HarnessNativeFiles`](#harnessnativefiles)

##### after

[`HarnessNativeFiles`](#harnessnativefiles)

#### Returns

`string`[]

***

### harnessActor()

> **harnessActor**(`__namedParameters`): `string`

The entry `actor` for a captured memory, so `createdBy` carries its provenance.

#### Parameters

##### \_\_namedParameters

[`HarnessProvenance`](#harnessprovenance)

#### Returns

`string`

***

### parseHarnessActor()

> **parseHarnessActor**(`actor`): [`HarnessProvenance`](#harnessprovenance) \| `null`

Read the harness, turn, and member provenance encoded by [harnessActor](#harnessactor).

#### Parameters

##### actor

`string`

#### Returns

[`HarnessProvenance`](#harnessprovenance) \| `null`

***

### ingestHarnessMemories()

> **ingestHarnessMemories**(`context`, `input`): `Promise`\<[`HarnessIngestResult`](#harnessingestresult)\>

Save captured facts as workspace memories through the same policy as
`memory.remember`, with the harness and turn as the actor. Duplicates of a
memory the turn can see, or of an earlier fact in the batch, are skipped.

#### Parameters

##### context

[`WorkspaceToolContext`](#workspacetoolcontext)

##### input

###### harness

`string`

###### turnId

`string`

###### facts

readonly `string`[]

#### Returns

`Promise`\<[`HarnessIngestResult`](#harnessingestresult)\>

***

### memoryDivergence()

> **memoryDivergence**(`store`, `turn`, `before`, `after`): `Promise`\<[`MemoryDivergence`](#memorydivergence)\>

Compare each native file with the store as `turn` sees it, after ingest ran.
`before` is the files as projected at session start, `after` as they are now:
only what the harness added since then can be uncaptured, so the profile's own
generated text in the same file never counts. Files that held a generated
block at session start are projection targets: losing the block counts every
visible memory as missing. Other files (a new memory-directory entry) can
only hold uncaptured facts.

#### Parameters

##### store

[`WorkspaceStore`](#workspacestore)

##### turn

[`WorkspaceTurn`](#workspaceturn)

##### before

[`HarnessNativeFiles`](#harnessnativefiles)

##### after

[`HarnessNativeFiles`](#harnessnativefiles)

#### Returns

`Promise`\<[`MemoryDivergence`](#memorydivergence)\>

***

### assertWorkspacePath()

> **assertWorkspacePath**(`path`): `void`

Refuse anything but an absolute, normalized path such as `/files/report.md`.

#### Parameters

##### path

`string`

#### Returns

`void`

***

### memberIdFromPath()

> **memberIdFromPath**(`path`): `string` \| `null`

The member a path belongs to, or `null` for workspace-scoped paths.

#### Parameters

##### path

`string`

#### Returns

`string` \| `null`

***

### checkWorkspacePut()

> **checkWorkspacePut**(`input`): `void`

Validate a put before any adapter touches storage; adapters call this first.

#### Parameters

##### input

[`WorkspacePutInput`](#workspaceputinput)

#### Returns

`void`

***

### checkOperationId()

> **checkOperationId**(`path`, `operationId`): `void`

Refuse an `operationId` that is present but empty, not a string, or over 256 chars.

#### Parameters

##### path

`string`

##### operationId

`unknown`

#### Returns

`void`

***

### isSameWorkspaceWrite()

> **isSameWorkspaceWrite**(`entry`, `input`): `boolean`

Whether `entry` is exactly what `input` would write: same kind, content and bytes.

#### Parameters

##### entry

[`WorkspaceEntry`](#workspaceentry)

##### input

[`WorkspacePutInput`](#workspaceputinput)

#### Returns

`boolean`

***

### createInMemoryWorkspaceStore()

> **createInMemoryWorkspaceStore**(`options?`): [`WorkspaceStore`](#workspacestore)

Process-local adapter for tests, previews, and single-instance hosts.

#### Parameters

##### options?

###### now?

() => `Date`

###### newId?

() => `string`

#### Returns

[`WorkspaceStore`](#workspacestore)

***

### defaultMemoryPolicy()

> **defaultMemoryPolicy**(`options?`): [`MemoryPolicy`](#memorypolicy)

Default authority. Reads: workspace memory, the speaker's own member memory,
`/knowledge/**`, `/files/**`. Writes: viewers and guests none; any member may
save workspace facts and own-scope facts or preferences, and write `/files/**`;
owners and managers also save instructions, workspace preferences, and
`/knowledge/**`. Nobody touches another member's scope. `admit` is the
product's content hook.

#### Parameters

##### options?

###### admit?

(`turn`, `candidate`) => [`WorkspacePolicyDecision`](#workspacepolicydecision) \| `Promise`\<[`WorkspacePolicyDecision`](#workspacepolicydecision)\>

#### Returns

[`MemoryPolicy`](#memorypolicy)

***

### readTurnMemories()

> **readTurnMemories**(`store`, `turn`): `Promise`\<[`WorkspaceEntry`](#workspaceentry)[]\>

Workspace memories plus the speaker's own member memories, the set a turn may see.

#### Parameters

##### store

[`WorkspaceStore`](#workspacestore)

##### turn

[`WorkspaceTurn`](#workspaceturn)

#### Returns

`Promise`\<[`WorkspaceEntry`](#workspaceentry)[]\>

***

### createMemoryTools()

> **createMemoryTools**(`context`): [`WorkspaceToolDefinition`](#workspacetooldefinition)[]

`memory.remember`, `memory.recall`, `memory.forget`.

#### Parameters

##### context

[`WorkspaceToolContext`](#workspacetoolcontext)

#### Returns

[`WorkspaceToolDefinition`](#workspacetooldefinition)[]

***

### createFileTools()

> **createFileTools**(`context`): [`WorkspaceToolDefinition`](#workspacetooldefinition)[]

`files.list`, `files.read`, `files.write`, `files.delete`, `files.search` over `/files/**` and `/knowledge/**`.

#### Parameters

##### context

[`WorkspaceToolContext`](#workspacetoolcontext)

#### Returns

[`WorkspaceToolDefinition`](#workspacetooldefinition)[]

***

### rankEntries()

> **rankEntries**(`entries`, `query`, `limit`): `object`[]

BM25 over entry text (and path words), highest score first, ties by path.
Entries without inline text match on path words only.

#### Parameters

##### entries

readonly [`WorkspaceEntry`](#workspaceentry)[]

##### query

`string`

##### limit

`number`

#### Returns

`object`[]

***

### renderPinnedMemory()

> **renderPinnedMemory**(`entries`, `options?`): `string`

Render the memories a turn sees as one stable block for the per-turn preamble.
Order: instructions, preferences, facts; workspace before member; then path.
Input order never changes the output, so identical memories give identical
bytes (cache- and digest-stable). Lines beyond `maxTokens` (≈4 chars per
token) are counted, not shown. The block ends with where to recall more.

#### Parameters

##### entries

readonly [`WorkspaceEntry`](#workspaceentry)[]

##### options?

###### maxTokens?

`number`

#### Returns

`string`
