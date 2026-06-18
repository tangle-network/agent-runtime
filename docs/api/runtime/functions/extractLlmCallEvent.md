[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / extractLlmCallEvent

# Function: extractLlmCallEvent()

> **extractLlmCallEvent**(`event`, `agentRunName`): RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

Defined in: [runtime/sandbox-events.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L32)

Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
the event carries usage/cost data. Returns `undefined` for non-cost events
so the kernel can iterate the full stream without branching.

Canonical cost-carrying types observed in the wild:
  - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
  - `message.completed` / `result` — `data: { usage: { inputTokens,
     outputTokens, totalCostUsd? } }`
  - `cost.usage` / `usage` — same shape under a dedicated type

Numeric coercion is strict: `Number.isFinite` gates every accumulator write
so a sentinel `NaN` from a misbehaving backend cannot poison the ledger.

## Parameters

### event

`SandboxEvent`

### agentRunName

`string`

## Returns

RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`
