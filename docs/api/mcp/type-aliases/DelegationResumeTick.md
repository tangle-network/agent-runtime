[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationResumeTick

# Type Alias: DelegationResumeTick

> **DelegationResumeTick** = \{ `state`: `"running"`; \} \| \{ `state`: `"completed"`; `output`: [`DelegationResultPayload`](DelegationResultPayload.md)\[`"output"`\]; `costUsd?`: `number`; \} \| \{ `state`: `"failed"`; `error`: [`DelegationError`](../interfaces/DelegationError.md); \}

Defined in: [mcp/task-queue.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L171)

**`Experimental`**

One observation of a detached run, mapped 1:1 from a single-tick driver
(e.g. the sandbox SDK's `driveTurn`, which reports
completed | running | failed per pass). `running` schedules another tick
after `intervalMs`; `completed` / `failed` settle the record.
