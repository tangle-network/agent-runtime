[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / withTangleIntelligence

# Function: withTangleIntelligence()

> **withTangleIntelligence**\<`TInput`, `TOutput`\>(`agent`, `clientOrConfig`): [`Agent`](../type-aliases/Agent.md)\<`TInput`, `TOutput`\>

Defined in: [intelligence/index.ts:530](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L530)

Wrap a generic `agent` with best-effort Observe-mode tracing, returning the
SAME shape. Each call runs the agent under a trace and exports one span; an
export failure is swallowed (the live agent never fails because Intelligence
is down) but an error from the agent itself propagates unchanged.

At `effort: 'off'` this is pure passthrough plus best-effort telemetry —
zero intelligence spawns, `intelligenceUsd: 0` on the trace.

## Type Parameters

### TInput

`TInput`

### TOutput

`TOutput`

## Parameters

### agent

[`Agent`](../type-aliases/Agent.md)\<`TInput`, `TOutput`\>

### clientOrConfig

[`ClientOrConfig`](../type-aliases/ClientOrConfig.md)

## Returns

[`Agent`](../type-aliases/Agent.md)\<`TInput`, `TOutput`\>
