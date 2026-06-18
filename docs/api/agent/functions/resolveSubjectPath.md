[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / resolveSubjectPath

# Function: resolveSubjectPath()

> **resolveSubjectPath**(`subject`, `surfaces`, `repoRoot`): [`ResolvedSurface`](../interfaces/ResolvedSurface.md) \| `null`

Defined in: [agent/surfaces.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L86)

Resolve a parsed `FindingSubject` to the file path the substrate
should edit (or create) on disk.

Returns `null` when:
  - the subject targets a surface the agent didn't declare
    (e.g. `rag:*` when `surfaces.rag` is undefined), OR
  - the subject is a `cluster` (failure-mode emits these as evidence,
    not actionable mutations — they don't route to a file).

Returns a `ResolvedSurface` with `intent: 'create-new'` when the
subject names a path that doesn't yet exist (e.g. a new wiki page).
The caller chooses whether to honour the create — for tightly-managed
surfaces like `systemPrompt` it's usually a contract violation
(the analyst named a section that doesn't exist); for `knowledge`
it's the whole point.

## Parameters

### subject

`FindingSubject`

### surfaces

[`AgentSurfaces`](../interfaces/AgentSurfaces.md)

### repoRoot

`string`

## Returns

[`ResolvedSurface`](../interfaces/ResolvedSurface.md) \| `null`
