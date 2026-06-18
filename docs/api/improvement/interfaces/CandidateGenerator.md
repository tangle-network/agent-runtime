[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / CandidateGenerator

# Interface: CandidateGenerator

Defined in: [improvement/improvement-driver.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L35)

The byte-producing seam — the ONE thing that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

## Properties

### kind

> **kind**: `string`

Defined in: [improvement/improvement-driver.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L36)

## Methods

### generate()

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>

Defined in: [improvement/improvement-driver.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L37)

#### Parameters

##### args

###### worktreePath

`string`

The candidate worktree — a fresh checkout of baseRef. Write changes here.

###### report

`unknown`

Phase-2 research report (analyst findings + diff), opaque.

###### findings

`AnalystFinding`[]

Findings resolved from the report or the loop context.

###### dataset?

`LabeledScenarioStore`

Handle to all captured data, to ground the change.

###### maxShots

`number`

DEPTH: max iterations the generator may take (agentic uses this; the
 reflective generator ignores it).

###### signal

`AbortSignal`

#### Returns

`Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>
