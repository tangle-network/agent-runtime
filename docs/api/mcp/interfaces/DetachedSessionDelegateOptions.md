[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DetachedSessionDelegateOptions

# Interface: DetachedSessionDelegateOptions

Defined in: [mcp/delegates.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L150)

**`Experimental`**

## Properties

### executor?

> `optional` **executor?**: [`DelegationExecutor`](DelegationExecutor.md)

Defined in: [mcp/delegates.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L157)

**`Experimental`**

Execution placement. Pass a [DelegationExecutor](DelegationExecutor.md) (sibling or fleet)
to control where worker iterations land. `sandboxClient` is a
convenience shorthand that wraps the client in a sibling executor — pass
one or the other, not both.

***

### sandboxClient?

> `optional` **sandboxClient?**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [mcp/delegates.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L162)

**`Experimental`**

Convenience shorthand for sibling placement. Equivalent to
`executor: createSiblingSandboxExecutor({ client: sandboxClient })`.

***

### harness?

> `optional` **harness?**: `string`

Defined in: [mcp/delegates.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L164)

**`Experimental`**

Backend harness for the single-coder path. Default comes from `coderProfile`.

***

### model?

> `optional` **model?**: `string`

Defined in: [mcp/delegates.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L166)

**`Experimental`**

Model override for the single-coder path.

***

### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [mcp/delegates.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L172)

**`Experimental`**

The worker's authored system prompt (§1.5). Flows onto `coderProfile`'s
`profile.prompt.systemPrompt` → through `runLoop` → the executor's `harnessInvocation`, so the
harness runs under this stance, not just the default coder prompt. Omit to keep the default.

***

### fanoutHarnesses?

> `optional` **fanoutHarnesses?**: `string`[]

Defined in: [mcp/delegates.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L174)

**`Experimental`**

Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1.

***

### fanoutModels?

> `optional` **fanoutModels?**: (`string` \| `undefined`)[]

Defined in: [mcp/delegates.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L176)

**`Experimental`**

Optional per-harness model override for `variants > 1`.

***

### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [mcp/delegates.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L178)

**`Experimental`**

Hard cap on the kernel's per-batch concurrency. Default 4.

***

### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](../type-aliases/CoderReviewer.md)

Defined in: [mcp/delegates.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L185)

**`Experimental`**

Optional adversarial reviewer. When set, a candidate must pass mechanical
validation AND `reviewer.approved` to be eligible to win — empty/secret/
test-failing patches are already gone; this catches the "compiles + passes
but wrong/unsafe" class the deterministic validator can't see.

***

### winnerSelection?

> `optional` **winnerSelection?**: [`DetachedWinnerSelection`](../type-aliases/DetachedWinnerSelection.md)

Defined in: [mcp/delegates.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L187)

**`Experimental`**

Winner-selection strategy among eligible candidates. Default `highest-score`.

***

### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md)

Defined in: [mcp/delegates.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L199)

**`Experimental`**

Loop trace emitter forwarded into every delegated `runLoop`. Wire
`createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
does) so delegated build-loops export their topology spans to the OTLP /
Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
are a cheap no-op when it isn't. Configurable by construction.

Detached single-variant turns (taken when `ctx.detachedSessionRef` is set)
bypass `runLoop`; `runDetachedTurn` synthesizes a single-iteration loop
event stream for them so this emitter observes detached work too.

***

### detachedTickIntervalMs?

> `optional` **detachedTickIntervalMs?**: `number`

Defined in: [mcp/delegates.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L201)

**`Experimental`**

Tick cadence (ms) for the detached single-variant path. Default 5000.

***

### detachedWallCapMs?

> `optional` **detachedWallCapMs?**: `number`

Defined in: [mcp/delegates.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L203)

**`Experimental`**

Wall-clock cap (ms) forwarded to `driveTurn` for detached turns.
