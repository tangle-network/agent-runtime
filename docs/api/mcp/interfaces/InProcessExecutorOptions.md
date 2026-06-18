[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / InProcessExecutorOptions

# Interface: InProcessExecutorOptions

Defined in: [mcp/in-process-executor.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L33)

**`Experimental`**

## Properties

### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/in-process-executor.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L35)

**`Experimental`**

Absolute path to the git repo (the workspace). Worktrees go under `<repoRoot>/.agent-worktrees/`.

***

### harnesses?

> `optional` **harnesses?**: readonly [`LocalHarness`](../type-aliases/LocalHarness.md)[]

Defined in: [mcp/in-process-executor.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L37)

**`Experimental`**

Harnesses to round-robin across `create()` calls. One entry = no fanout. Default `['claude']`.

***

### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [mcp/in-process-executor.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L39)

**`Experimental`**

Optional per-delegation test command run in the worktree after the harness exits.

***

### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [mcp/in-process-executor.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L41)

**`Experimental`**

Optional per-delegation typecheck command. Same shape as `testCmd`.

***

### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [mcp/in-process-executor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L43)

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5min.

***

### postCheckTimeoutMs?

> `optional` **postCheckTimeoutMs?**: `number`

Defined in: [mcp/in-process-executor.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L45)

**`Experimental`**

Wall-clock cap per test/typecheck subprocess (ms). Default 2min.

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../type-aliases/GitRunner.md)

Defined in: [mcp/in-process-executor.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L47)

**`Experimental`**

Test seam — override the git runner used by the worktree helpers.

***

### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](LocalHarnessResult.md)\>

Defined in: [mcp/in-process-executor.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L49)

**`Experimental`**

Test seam — override the harness runner (defaults to the real CLI via `runLocalHarness`).

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

[`RunLocalHarnessOptions`](RunLocalHarnessOptions.md)

#### Returns

`Promise`\<[`LocalHarnessResult`](LocalHarnessResult.md)\>

***

### runPostCheck?

> `optional` **runPostCheck?**: (`cmd`, `cwd`, `signal?`) => `Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

Defined in: [mcp/in-process-executor.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L52)

**`Experimental`**

Test seam — override the post-check runner (defaults to a `sh -c` spawn). A throw is folded
 into a non-fatal `{exitCode:-1}` so a broken check command fails the signal, not the run.

#### Parameters

##### cmd

`string`

##### cwd

`string`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>
