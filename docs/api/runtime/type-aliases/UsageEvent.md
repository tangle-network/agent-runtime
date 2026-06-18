[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / UsageEvent

# Type Alias: UsageEvent

> **UsageEvent** = \{ `kind`: `"tokens"`; `input`: `number`; `output`: `number`; \} \| \{ `kind`: `"cost"`; `usd`: `number`; \} \| \{ `kind`: `"iteration"`; \}

Defined in: [runtime/supervise/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L130)

Normalized usage event — the single channel every executor reports through, so the
conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
`{ input, output }`; `usd` is a SEPARATE channel (never folded into tokens).
