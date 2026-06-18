[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / AgenticGeneratorOptions

# Interface: AgenticGeneratorOptions

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

## Properties

### harness?

> `optional` **harness?**: [`LocalHarness`](../../mcp/type-aliases/LocalHarness.md)

Defined in: [improvement/agentic-generator.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L53)

Local coding harness to run in the worktree. Default `claude`.

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/agentic-generator.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L55)

Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m).

***

### buildPrompt?

> `optional` **buildPrompt?**: (`args`) => `string`

Defined in: [improvement/agentic-generator.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L58)

Build the harness task prompt from the report + findings. Override for
 domain phrasing; the default turns findings into a concrete coder task.

#### Parameters

##### args

###### report

`unknown`

###### findings

`AnalystFinding`[]

#### Returns

`string`

***

### verify?

> `optional` **verify?**: [`Verifier`](../type-aliases/Verifier.md)

Defined in: [improvement/agentic-generator.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L64)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
 the first dirty shot is the candidate. See `commandVerifier`.

***

### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](../../mcp/interfaces/LocalHarnessResult.md)\>

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

#### Parameters

##### options

[`RunLocalHarnessOptions`](../../mcp/interfaces/RunLocalHarnessOptions.md)

#### Returns

`Promise`\<[`LocalHarnessResult`](../../mcp/interfaces/LocalHarnessResult.md)\>

***

### isDirty?

> `optional` **isDirty?**: (`worktreePath`) => `boolean`

Defined in: [improvement/agentic-generator.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L68)

Test seam — inject the worktree-dirty check (defaults to `git status`).

#### Parameters

##### worktreePath

`string`

#### Returns

`boolean`
