[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / OpenSandboxRunOptions

# Interface: OpenSandboxRunOptions

Defined in: [runtime/sandbox-run.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L79)

**`Experimental`**

## Properties

### agentRun

> **agentRun**: [`AgentRunSpec`](AgentRunSpec.md)\<`string`\>

Defined in: [runtime/sandbox-run.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L81)

**`Experimental`**

Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness.

***

### signal

> **signal**: `AbortSignal`

Defined in: [runtime/sandbox-run.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L82)

**`Experimental`**

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/sandbox-run.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L84)

**`Experimental`**

Optional execution-scoped observers. Hook failures never fail the run.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/sandbox-run.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L86)

**`Experimental`**

Stable run id for trace joins. Defaults to a short runtime-minted id.

***

### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime/sandbox-run.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L88)

**`Experimental`**

Optional benchmark/scenario id carried into emitted hook events.

***

### now?

> `optional` **now?**: () => `number`

Defined in: [runtime/sandbox-run.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L90)

**`Experimental`**

Test seam for deterministic hook timestamps. Defaults to `Date.now`.

#### Returns

`number`

***

### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [runtime/sandbox-run.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L92)

**`Experimental`**

Bounds box-creation bursts inside lineage fanout. Default from lineage.

***

### readRetryDelayMs?

> `optional` **readRetryDelayMs?**: `number`

Defined in: [runtime/sandbox-run.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L95)

**`Experimental`**

Base backoff (ms) for retrying a transient artifact `fs.read` failure; the i-th
 retry waits `readRetryDelayMs * i`. Default 1000. Set 0 to disable the wait (tests).
