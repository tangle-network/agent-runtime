[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WorktreeCliExecutorOptions

# Interface: WorktreeCliExecutorOptions

Defined in: [runtime/supervise/worktree-cli-executor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L43)

**`Experimental`**

## Properties

### repoRoot

> **repoRoot**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L45)

**`Experimental`**

Absolute path to the git checkout the worktree is cut from.

***

### profile

> **profile**: `AgentProfile`

Defined in: [runtime/supervise/worktree-cli-executor.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L47)

**`Experimental`**

The SUPERVISOR-AUTHORED profile (the §1.5 payload: systemPrompt + model).

***

### harness

> **harness**: [`LocalHarness`](../../mcp/type-aliases/LocalHarness.md)

Defined in: [runtime/supervise/worktree-cli-executor.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L49)

**`Experimental`**

Which local harness CLI drives this leaf (`claude` | `codex` | `opencode`).

***

### taskPrompt

> **taskPrompt**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L51)

**`Experimental`**

The per-task instruction handed to the harness (composed under the system prompt).

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L53)

**`Experimental`**

Unique id for the worktree path + branch. Defaults to a fresh UUID.

***

### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L55)

**`Experimental`**

Override the base ref the worktree is cut from (default `HEAD`).

***

### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [runtime/supervise/worktree-cli-executor.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L57)

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5 min (the `runLocalHarness` default).

***

### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L62)

**`Experimental`**

Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).

***

### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L64)

**`Experimental`**

Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`).

***

### checkTimeoutMs?

> `optional` **checkTimeoutMs?**: `number`

Defined in: [runtime/supervise/worktree-cli-executor.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L66)

**`Experimental`**

Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min.

***

### runGit?

> `optional` **runGit?**: [`GitRunner`](../../mcp/type-aliases/GitRunner.md)

Defined in: [runtime/supervise/worktree-cli-executor.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L68)

**`Experimental`**

Test seam — inject a git runner so unit tests drive the worktree helpers without git.

***

### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](../../mcp/interfaces/LocalHarnessResult.md)\>

Defined in: [runtime/supervise/worktree-cli-executor.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L70)

**`Experimental`**

Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`.

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

Defined in: [runtime/supervise/worktree-cli-executor.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L73)

**`Experimental`**

Test seam — inject the verification-command runner so unit tests script test/typecheck
 outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree.
