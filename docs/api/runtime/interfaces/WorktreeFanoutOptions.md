[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WorktreeFanoutOptions

# Interface: WorktreeFanoutOptions

Defined in: [runtime/supervise/worktree-fanout.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L43)

**`Experimental`**

## Extends

- [`PatchDeliverableOptions`](PatchDeliverableOptions.md)

## Properties

### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [runtime/supervise/patch-checks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L38)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

#### Inherited from

[`PatchDeliverableOptions`](PatchDeliverableOptions.md).[`maxDiffLines`](PatchDeliverableOptions.md#maxdifflines)

***

### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [runtime/supervise/patch-checks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L40)

**`Experimental`**

Literal path prefixes the patch must not touch.

#### Inherited from

[`PatchDeliverableOptions`](PatchDeliverableOptions.md).[`forbiddenPaths`](PatchDeliverableOptions.md#forbiddenpaths)

***

### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [runtime/supervise/patch-deliverable.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L34)

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

#### Inherited from

[`PatchDeliverableOptions`](PatchDeliverableOptions.md).[`require`](PatchDeliverableOptions.md#require)

***

### repoRoot

> **repoRoot**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L45)

**`Experimental`**

Absolute path to the git checkout each worktree is cut from.

***

### taskPrompt

> **taskPrompt**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L47)

**`Experimental`**

The per-task instruction handed to every harness (composed under each profile's systemPrompt).

***

### harnesses

> **harnesses**: readonly [`AuthoredHarness`](AuthoredHarness.md)[]

Defined in: [runtime/supervise/worktree-fanout.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L49)

**`Experimental`**

The authored harness profiles — one fanout item (and one worktree-CLI leaf) each.

***

### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](DeliverableSpec.md)\<`WorktreeHarnessResult`\>

Defined in: [runtime/supervise/worktree-fanout.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L55)

**`Experimental`**

The completion check each leaf is gated on. Defaults to `patchDelivered(opts)` (the mechanical
no-op/secret/forbidden/diff-size + required test/typecheck gate). Pass any
`DeliverableSpec<WorktreePatchArtifact>` to customize "is it delivered" as DATA.

***

### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L57)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

***

### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L59)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

***

### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [runtime/supervise/worktree-fanout.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L61)

**`Experimental`**

Wall-clock cap per harness subprocess (ms).

***

### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](../type-aliases/WinnerStrategy.md)

Defined in: [runtime/supervise/worktree-fanout.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L63)

**`Experimental`**

Winner-selection strategy. Default `highest-score`.

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../../mcp/type-aliases/GitRunner.md)

Defined in: [runtime/supervise/worktree-fanout.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L66)

**`Experimental`**

Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
 whole fanout runs offline). Production callers leave these unset.

***

### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](../../mcp/interfaces/LocalHarnessResult.md)\>

Defined in: [runtime/supervise/worktree-fanout.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L67)

**`Experimental`**

**`Experimental`**

Spawn a local coding harness CLI as a subprocess + collect its output.

NOT responsible for parsing the harness's output or extracting a diff —
the in-process executor's `streamPrompt` orchestrates `git diff` against
the worktree after this resolves. This function is intentionally narrow:
spawn, wait, capture, return.

Fails loud — throws when:
  - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
  - the harness binary is not on PATH (ENOENT)

Does NOT throw when:
  - the subprocess exits non-zero (`result.exitCode` carries the code)
  - the subprocess is aborted / timed out (`result.killedBySignal` /
    `result.timedOut` carries the reason)

#### Parameters

##### options

[`RunLocalHarnessOptions`](../../mcp/interfaces/RunLocalHarnessOptions.md)

#### Returns

`Promise`\<[`LocalHarnessResult`](../../mcp/interfaces/LocalHarnessResult.md)\>

***

### runCommand?

> `optional` **runCommand?**: `WorktreeCheckRunner`

Defined in: [runtime/supervise/worktree-fanout.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L68)

**`Experimental`**
