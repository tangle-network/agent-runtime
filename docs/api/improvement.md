[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / improvement

# improvement

## Interfaces

### VerifyResult

Defined in: [improvement/agentic-generator.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L41)

Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 failing test output) is fed into the next shot when `ok` is false.

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [improvement/agentic-generator.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L42)

##### feedback?

> `optional` **feedback?**: `string`

Defined in: [improvement/agentic-generator.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L43)

***

### AgenticGeneratorOptions

Defined in: [improvement/agentic-generator.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L51)

`@tangle-network/agent-runtime` improvement — the CODE-surface driver for
agent-eval's improvement loop.

The ONE entry point for optimization is agent-eval's `selfImprove`
(`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
`fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
cohorting. This module supplies only the one genuinely runtime-specific piece:
a CODE-surface `ImprovementDriver` you pass to `selfImprove` as `driver`, which
mutates a git worktree via a pluggable `CandidateGenerator`:
  - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
  - `agenticGenerator`     — full coding harness in the worktree, multi-shot

#### Properties

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [improvement/agentic-generator.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L53)

Local coding harness to run in the worktree. Default `claude`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/agentic-generator.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L55)

Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m).

##### buildPrompt?

> `optional` **buildPrompt?**: (`args`) => `string`

Defined in: [improvement/agentic-generator.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L58)

Build the harness task prompt from the report + findings. Override for
 domain phrasing; the default turns findings into a concrete coder task.

###### Parameters

###### args

###### report

`unknown`

###### findings

`AnalystFinding`[]

###### Returns

`string`

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Defined in: [improvement/agentic-generator.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L64)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
 the first dirty shot is the candidate. See `commandVerifier`.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [improvement/agentic-generator.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L66)

Test seam — inject the harness runner (defaults to `runLocalHarness`).

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

###### Parameters

###### options

[`RunLocalHarnessOptions`](mcp.md#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

##### isDirty?

> `optional` **isDirty?**: (`worktreePath`) => `boolean`

Defined in: [improvement/agentic-generator.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L68)

Test seam — inject the worktree-dirty check (defaults to `git status`).

###### Parameters

###### worktreePath

`string`

###### Returns

`boolean`

***

### CandidateGenerator

Defined in: [improvement/improvement-driver.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L35)

The byte-producing seam — the ONE thing that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

#### Properties

##### kind

> **kind**: `string`

Defined in: [improvement/improvement-driver.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L36)

#### Methods

##### generate()

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>

Defined in: [improvement/improvement-driver.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L37)

###### Parameters

###### args

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

###### Returns

`Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>

***

### ImprovementDriverOptions

Defined in: [improvement/improvement-driver.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L53)

#### Properties

##### worktree

> **worktree**: `WorktreeAdapter`

Defined in: [improvement/improvement-driver.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L54)

##### generator

> **generator**: [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/improvement-driver.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L55)

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [improvement/improvement-driver.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L57)

Base ref candidate worktrees fork from. Default `main`.

***

### McpServeSpec

Defined in: [improvement/mcp-serve-verifier.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L24)

#### Properties

##### command

> **command**: `string`

Defined in: [improvement/mcp-serve-verifier.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L26)

Command that starts the built MCP server in the worktree (stdio transport).

##### args?

> `optional` **args?**: `string`[]

Defined in: [improvement/mcp-serve-verifier.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L27)

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [improvement/mcp-serve-verifier.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L29)

Extra env for the server process (merged over `process.env`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/mcp-serve-verifier.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L31)

Handshake timeout (ms). Default 30s.

##### minTools?

> `optional` **minTools?**: `number`

Defined in: [improvement/mcp-serve-verifier.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L33)

Minimum tools the server must expose to pass. Default 1.

***

### ReflectiveGeneratorOptions

Defined in: [improvement/reflective-generator.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L20)

#### Properties

##### improvementAdapter

> **improvementAdapter**: [`ImprovementAdapter`](analyst-loop.md#improvementadapter)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

Defined in: [improvement/reflective-generator.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L21)

## Type Aliases

### Verifier

> **Verifier** = (`worktreePath`) => `Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

Defined in: [improvement/agentic-generator.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L49)

Verifies the edited worktree. Sync or async; throws only on a setup fault
 (a candidate that fails verification returns `{ok:false}`, it does not
 throw).

#### Parameters

##### worktreePath

`string`

#### Returns

`Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

## Functions

### agenticGenerator()

> **agenticGenerator**(`opts?`): [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/agentic-generator.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L71)

`@tangle-network/agent-runtime` improvement — the CODE-surface driver for
agent-eval's improvement loop.

The ONE entry point for optimization is agent-eval's `selfImprove`
(`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
`fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
cohorting. This module supplies only the one genuinely runtime-specific piece:
a CODE-surface `ImprovementDriver` you pass to `selfImprove` as `driver`, which
mutates a git worktree via a pluggable `CandidateGenerator`:
  - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
  - `agenticGenerator`     — full coding harness in the worktree, multi-shot

#### Parameters

##### opts?

[`AgenticGeneratorOptions`](#agenticgeneratoroptions) = `{}`

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](#verifier)

Defined in: [improvement/agentic-generator.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L159)

A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 FAILED candidate (a change that hangs the build is a bad change); a missing
 binary or spawn fault throws (a setup bug, not a failed candidate — no
 silent fallback).

#### Parameters

##### command

`string`

##### args?

`string`[] = `[]`

##### timeoutMs?

`number` = `300_000`

#### Returns

[`Verifier`](#verifier)

***

### toolBuildPrompt()

> **toolBuildPrompt**(`args`): `string`

Defined in: [improvement/build-prompts.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L30)

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### mcpBuildPrompt()

> **mcpBuildPrompt**(`args`): `string`

Defined in: [improvement/build-prompts.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L43)

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### improvementDriver()

> **improvementDriver**(`opts`): `ImprovementDriver`\<`AnalystFinding`\>

Defined in: [improvement/improvement-driver.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L60)

#### Parameters

##### opts

[`ImprovementDriverOptions`](#improvementdriveroptions)

#### Returns

`ImprovementDriver`\<`AnalystFinding`\>

***

### mcpServeVerifier()

> **mcpServeVerifier**(`spec`): [`Verifier`](#verifier)

Defined in: [improvement/mcp-serve-verifier.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L43)

#### Parameters

##### spec

[`McpServeSpec`](#mcpservespec)

#### Returns

[`Verifier`](#verifier)

***

### reflectiveGenerator()

> **reflectiveGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/reflective-generator.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L24)

#### Parameters

##### opts

[`ReflectiveGeneratorOptions`](#reflectivegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)
