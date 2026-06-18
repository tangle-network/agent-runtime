[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / ResolvedSurface

# Interface: ResolvedSurface

Defined in: [agent/surfaces.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L58)

## Properties

### absolutePath

> **absolutePath**: `string`

Defined in: [agent/surfaces.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L60)

Absolute filesystem path the operator can `cat` / `vim`.

***

### repoRelativePath

> **repoRelativePath**: `string`

Defined in: [agent/surfaces.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L62)

Repo-relative path for PR descriptions, diffs, audit logs.

***

### exists

> **exists**: `boolean`

Defined in: [agent/surfaces.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L64)

Whether the path currently exists on disk.

***

### intent

> **intent**: `"edit-existing"` \| `"create-new"`

Defined in: [agent/surfaces.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L66)

The substrate's intent: edit an existing file or create a new one.
