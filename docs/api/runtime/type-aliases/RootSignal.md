[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RootSignal

# Type Alias: RootSignal

> **RootSignal** = \{ `kind`: `"pause"`; \} \| \{ `kind`: `"resume"`; \} \| \{ `kind`: `"cancel"`; `reason?`: `string`; \} \| \{ `kind`: `"ask"`; `question`: `string`; \}

Defined in: [runtime/supervise/types.ts:491](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L491)

Out-of-band message to a running root. Open by intent — a client extends it.
