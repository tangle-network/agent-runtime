[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / CreateSurfaceImprovementAdapterOpts

# Interface: CreateSurfaceImprovementAdapterOpts

Defined in: [agent/improvement-adapter.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L66)

## Properties

### surfaces

> **surfaces**: [`AgentSurfaces`](AgentSurfaces.md)

Defined in: [agent/improvement-adapter.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L67)

***

### repoRoot

> **repoRoot**: `string`

Defined in: [agent/improvement-adapter.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L68)

***

### draftPatch

> **draftPatch**: (`input`) => `Promise`\<[`DraftPatchOutput`](DraftPatchOutput.md)\>

Defined in: [agent/improvement-adapter.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L77)

LLM-draft callback. Given a finding + current file content + the
resolved target, returns a unified-diff patch + summary + rationale.

Required — the substrate doesn't ship a hardcoded prompt; the agent
author picks the model (Haiku for cheap routine drafts, Sonnet for
substantive prompt rewrites, etc.) via this callback.

#### Parameters

##### input

[`DraftPatchInput`](DraftPatchInput.md)

#### Returns

`Promise`\<[`DraftPatchOutput`](DraftPatchOutput.md)\>

***

### mode?

> `optional` **mode?**: `"none"` \| `"write"` \| `"open-pr"`

Defined in: [agent/improvement-adapter.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L88)

Apply mode:
  `write` — `git apply` in-place; operator reviews via `git diff`
  `open-pr` — branch + commit + push + `gh pr create`
  `none` — never apply; collect proposals for the report only

The `apply` method honours this even when the loop calls it; the
effective behaviour is also gated on the per-finding confidence
threshold via `runAnalystLoop`'s `autoApply` policy.

***

### baseBranch?

> `optional` **baseBranch?**: `string`

Defined in: [agent/improvement-adapter.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L90)

When `mode === 'open-pr'`, the base branch new PRs target. Default: `main`.

***

### ghRepo?

> `optional` **ghRepo?**: `string`

Defined in: [agent/improvement-adapter.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L92)

Required for `mode === 'open-pr'` — the GH owner/repo (`tangle-network/tax-agent`).

***

### allowCreateForKinds?

> `optional` **allowCreateForKinds?**: readonly (`"knowledge.wiki"` \| `"knowledge.claim"` \| `"knowledge.raw"` \| `"knowledge.stale"` \| `"system-prompt"` \| `"tool-doc"` \| `"new-tool"` \| `"rag"` \| `"memory"` \| `"scaffolding"` \| `"output-schema"` \| `"websearch.outdated"` \| `"prior-run-summary"` \| `"cluster"`)[]

Defined in: [agent/improvement-adapter.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L100)

When the resolved target doesn't exist, allow the substrate to
CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
true for those kinds, false for `system-prompt` / `rubric` / etc.
(named sections that don't exist are a contract violation, not a
scaffolding opportunity).
