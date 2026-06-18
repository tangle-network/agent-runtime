[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / runLocalHarness

# Function: runLocalHarness()

> **runLocalHarness**(`options`): `Promise`\<[`LocalHarnessResult`](../interfaces/LocalHarnessResult.md)\>

Defined in: [mcp/local-harness.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L179)

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

## Parameters

### options

[`RunLocalHarnessOptions`](../interfaces/RunLocalHarnessOptions.md)

## Returns

`Promise`\<[`LocalHarnessResult`](../interfaces/LocalHarnessResult.md)\>
