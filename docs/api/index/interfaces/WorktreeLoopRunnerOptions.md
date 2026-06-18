[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / WorktreeLoopRunnerOptions

# Interface: WorktreeLoopRunnerOptions

Defined in: [loop-runner.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L158)

**`Experimental`**

Options for the local-repo `code` runner over the GENERIC recursive path.

## Properties

### repoRoot

> **repoRoot**: `string`

Defined in: [loop-runner.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L160)

**`Experimental`**

Absolute path to the local git checkout each worktree is cut from.

***

### taskPrompt

> **taskPrompt**: `string`

Defined in: [loop-runner.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L162)

**`Experimental`**

The instruction handed to every authored harness (composed under each profile's systemPrompt).

***

### harnesses

> **harnesses**: readonly [`AuthoredHarness`](../../runtime/interfaces/AuthoredHarness.md)[]

Defined in: [loop-runner.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L164)

**`Experimental`**

The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each.

***

### budget

> **budget**: [`Budget`](../../runtime/interfaces/Budget.md)

Defined in: [loop-runner.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L166)

**`Experimental`**

Conserved budget pool bounding the fanout (equal-k holds by construction).

***

### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [loop-runner.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L168)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

***

### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [loop-runner.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L170)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

***

### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [loop-runner.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L172)

**`Experimental`**

Which verification signals the deliverable REQUIRES present-and-passing (default none).

***

### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [loop-runner.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L174)

**`Experimental`**

Diff-size cap (lines).

***

### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [loop-runner.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L176)

**`Experimental`**

Literal path prefixes the patch must not touch (the secret-floor is always on regardless).

***

### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](../../runtime/type-aliases/WinnerStrategy.md)

Defined in: [loop-runner.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L178)

**`Experimental`**

Winner-selection strategy among gated candidates. Default `highest-score`.

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../../mcp/type-aliases/GitRunner.md)

Defined in: [loop-runner.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L180)

**`Experimental`**

Test seams forwarded to the worktree-CLI leaves so the runner drives offline.

***

### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](../../mcp/interfaces/LocalHarnessResult.md)\>

Defined in: [loop-runner.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L181)

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

Defined in: [loop-runner.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L182)

**`Experimental`**
