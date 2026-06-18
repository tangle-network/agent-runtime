[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / sandboxSessionTraceSource

# Function: sandboxSessionTraceSource()

> **sandboxSessionTraceSource**(`box`, `sessionId`, `opts?`): [`TraceSource`](../interfaces/TraceSource.md)

Defined in: [runtime/supervise/trace-source.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L278)

The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool
 calls into spans. `collect` (settle) is the solid path — `box.messages({sessionId})` → parts → spans;
 black-box harnesses aren't mid-step interruptible, so online steering is the owned-loop's job and a
 live `subscribe` is opt-in (pass `subscribeParts` from `streamPrompt` when the harness streams parts).

## Parameters

### box

[`SessionTraceBox`](../interfaces/SessionTraceBox.md)

### sessionId

`string`

### opts?

#### harness?

`string`

The box's harness (e.g. 'opencode', 'claude-code') → selects its decoder adapter.

#### subscribeParts?

(`onPart`) => () => `void`

#### runId?

`string`

#### now?

() => `number`

## Returns

[`TraceSource`](../interfaces/TraceSource.md)
