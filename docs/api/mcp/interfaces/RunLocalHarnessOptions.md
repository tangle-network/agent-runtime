[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / RunLocalHarnessOptions

# Interface: RunLocalHarnessOptions

Defined in: [mcp/local-harness.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L107)

**`Experimental`**

## Properties

### harness

> **harness**: [`LocalHarness`](../type-aliases/LocalHarness.md)

Defined in: [mcp/local-harness.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L108)

**`Experimental`**

***

### cwd

> **cwd**: `string`

Defined in: [mcp/local-harness.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L110)

**`Experimental`**

Working directory for the subprocess (typically a worktree path).

***

### taskPrompt

> **taskPrompt**: `string`

Defined in: [mcp/local-harness.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L112)

**`Experimental`**

Prompt forwarded as the harness CLI's task argument.

***

### invocation?

> `optional` **invocation?**: `object`

Defined in: [mcp/local-harness.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L120)

**`Experimental`**

Pre-built command + args (e.g. from `harnessInvocation` so the full authored
`AgentProfile` — systemPrompt + model — reaches the harness). When set it OVERRIDES the
default prompt-only `buildArgs(taskPrompt)` path; `command` defaults to the harness's
default binary when only `args` is supplied. When absent the legacy prompt-only shape
is used unchanged.

#### command?

> `optional` **command?**: `string`

#### args

> **args**: readonly `string`[]

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [mcp/local-harness.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L122)

**`Experimental`**

Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [mcp/local-harness.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L124)

**`Experimental`**

Caller cancellation. SIGTERM is sent on abort.

***

### env?

> `optional` **env?**: `ProcessEnv`

Defined in: [mcp/local-harness.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L126)

**`Experimental`**

Override env (defaults to inheriting from the parent).

***

### spawn?

> `optional` **spawn?**: (`command`, `args`, `opts`) => `ChildProcess`

Defined in: [mcp/local-harness.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L131)

**`Experimental`**

Test seam — inject a custom spawner so unit tests can mock the
subprocess without touching the OS. Defaults to node's `child_process.spawn`.

#### Parameters

##### command

`string`

##### args

readonly `string`[]

##### opts

###### cwd

`string`

###### env

`ProcessEnv`

###### stdio

`"pipe"`

#### Returns

`ChildProcess`
