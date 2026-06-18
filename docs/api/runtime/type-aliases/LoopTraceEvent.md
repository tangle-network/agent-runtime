[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopTraceEvent

# Type Alias: LoopTraceEvent

> **LoopTraceEvent** = \{ `kind`: `"loop.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopStartedPayload`](../interfaces/LoopStartedPayload.md); \} \| \{ `kind`: `"loop.plan"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopPlanPayload`](../interfaces/LoopPlanPayload.md); \} \| \{ `kind`: `"loop.iteration.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationStartedPayload`](../interfaces/LoopIterationStartedPayload.md); \} \| \{ `kind`: `"loop.iteration.dispatch"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationDispatchPayload`](../interfaces/LoopIterationDispatchPayload.md); \} \| \{ `kind`: `"loop.iteration.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationEndedPayload`](../interfaces/LoopIterationEndedPayload.md); \} \| \{ `kind`: `"loop.decision"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopDecisionPayload`](../interfaces/LoopDecisionPayload.md); \} \| \{ `kind`: `"loop.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopEndedPayload`](../interfaces/LoopEndedPayload.md); \} \| \{ `kind`: `"loop.teardown.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopTeardownFailedPayload`](../interfaces/LoopTeardownFailedPayload.md); \}

Defined in: [runtime/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L326)

**`Experimental`**
